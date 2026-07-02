#!/usr/bin/env python3
"""
Abbode Icon Library — Add Icons (one command runs all three steps)
==================================================================

Every time you add new icons you normally run three scripts. This runs them
for you, in the right order, from a single command:

  1. Backfill    links the new OFM / DST / PNG files into the MASTER sheet
                 (fills only blank cells, matched by icon name).
  2. Auto-crop   trims empty space around the catalog PNGs in Drive
                 (in place; originals backed up locally first).
  3. Auto-tag    generates thematic tags for any icon missing from tags.csv
                 and appends them (so new icons are never left untagged).
  4. Tags        writes the MASTER "Tags" column from tags.csv for search.

Order matters: backfill runs first so a brand-new PNG is linked before auto-crop
looks for it, and auto-tag runs before the tags write so new rows get pushed to
the sheet in the same run.

SAFE BY DEFAULT. With no flags this previews all three (a dry run) and writes
nothing. Add --apply to actually make changes; you're asked to confirm once.

Typical use
  cd scripts/add_icons
  python add_icons.py            # preview everything, no changes
  python add_icons.py --apply    # do it for real

Speed: on a real run, auto-crop only touches the PNGs that backfill just linked,
so you're not re-downloading all ~700 icons every time. Pass --crop-all to force
a full re-crop of the whole catalog.

Where settings come from (checked in this order): a command-line flag, then an
environment variable, then the repo-root .env.local file. Put the values you
reuse in .env.local once and the bare command above is all you need:

  GOOGLE_SHEET_ID=...     (already there)
  OFM_FOLDER_ID=...       Drive folder holding the .ofm files
  DST_FOLDER_ID=...       Drive folder holding the .dst files
  PNG_FOLDER_ID=...       Drive folder holding the .png files

Needs: google-credentials.json at the repo root — a service account with Edit
access to the sheet and to those Drive folders (the same file the other scripts
use).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
ENV_LOCAL = PROJECT_ROOT / ".env.local"

BACKFILL = PROJECT_ROOT / "scripts" / "backfill_blanks" / "backfill_blanks.py"
CROP = PROJECT_ROOT / "scripts" / "crop_pngs" / "crop_pngs.py"
TAGS = PROJECT_ROOT / "scripts" / "icon_tags" / "populate_tags.py"
AUTOTAG = PROJECT_ROOT / "scripts" / "icon_tags" / "autotag_new.py"
DEFAULT_CSV = PROJECT_ROOT / "scripts" / "icon_tags" / "tags.csv"

BAR = "=" * 66


# ── config helpers ──────────────────────────────────────────────────────────

def load_env_local(path: Path) -> dict:
    """Parse simple KEY=VALUE lines from .env.local (quotes stripped)."""
    out: dict = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def resolve(name: str, cli_value, env_local: dict, default=None):
    """CLI flag > real env var > .env.local > default."""
    if cli_value:
        return cli_value
    if os.environ.get(name):
        return os.environ[name]
    if env_local.get(name):
        return env_local[name]
    return default


def _fmt(argv: list[str]) -> str:
    """Human-readable command line (quote args with spaces, for display only)."""
    return " ".join(f'"{a}"' if " " in a else a for a in argv)


# ── command builders (pure — easy to test) ──────────────────────────────────

def build_backfill(cfg: dict, report_path: str | None) -> list[str]:
    argv = [cfg["python"], str(BACKFILL),
            "--sheet-id", cfg["sheet_id"], "--creds", cfg["creds"], "--tab", cfg["tab"]]
    for flag, key in (("--ofm-folder", "ofm"), ("--dst-folder", "dst"), ("--png-folder", "png")):
        if cfg.get(key):
            argv += [flag, cfg[key]]
    if report_path:
        argv += ["--report-json", report_path]
    if not cfg["apply"]:
        argv.append("--dry-run")
    return argv


def build_crop(cfg: dict, only_file: str | None) -> list[str]:
    argv = [cfg["python"], str(CROP), "--sheet-id", cfg["sheet_id"], "--creds", cfg["creds"]]
    if cfg["apply"]:
        argv.append("--apply")
    if only_file:
        argv += ["--only-file", only_file]
    if cfg.get("limit"):
        argv += ["--limit", str(cfg["limit"])]
    if cfg.get("padding") is not None:
        argv += ["--padding", str(cfg["padding"])]
    if cfg.get("no_backup"):
        argv.append("--no-backup")
    if cfg.get("backup_root"):
        argv += ["--backup-root", cfg["backup_root"]]
    return argv


def build_autotag(cfg: dict) -> list[str]:
    argv = [cfg["python"], str(AUTOTAG),
            "--sheet-id", cfg["sheet_id"], "--creds", cfg["creds"],
            "--tab", cfg["tab"], "--csv", cfg["csv"]]
    if not cfg["apply"]:
        argv.append("--dry-run")
    return argv


def build_tags(cfg: dict) -> list[str]:
    argv = [cfg["python"], str(TAGS),
            "--sheet-id", cfg["sheet_id"], "--creds", cfg["creds"],
            "--tab", cfg["tab"], "--csv", cfg["csv"]]
    if cfg.get("overwrite"):
        argv.append("--overwrite")
    if not cfg["apply"]:
        argv.append("--dry-run")
    return argv


def read_png_icons(path: str) -> list[str]:
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        return list(d.get("png_icons", []))
    except Exception:
        return []


# ── runner ──────────────────────────────────────────────────────────────────

def run_step(name: str, argv: list[str], child_env: dict) -> str:
    print(f"\n{BAR}\n  STEP: {name}\n{BAR}")
    print("  $ " + _fmt(argv) + "\n")
    # Feed 'yes' so the sub-script's own confirm prompt auto-accepts — we already
    # confirmed once at the top. Harmless for steps that never read stdin.
    proc = subprocess.run(argv, input="yes\n", text=True, env=child_env)
    if proc.returncode == 0:
        return "ok"
    print(f"\n  !! {name} exited with code {proc.returncode}. Continuing to the next step.")
    return f"FAILED (exit {proc.returncode})"


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true",
                   help="actually make changes (default: preview all three)")
    p.add_argument("--sheet-id")
    p.add_argument("--creds")
    p.add_argument("--tab")
    p.add_argument("--ofm-folder")
    p.add_argument("--dst-folder")
    p.add_argument("--png-folder")
    p.add_argument("--csv")
    p.add_argument("--overwrite", action="store_true",
                   help="tags: replace existing Tags cells (default: keep them)")
    p.add_argument("--padding", type=int, help="crop: px of margin kept (default 5)")
    p.add_argument("--limit", type=int, help="crop: process at most N icons (testing)")
    p.add_argument("--no-backup", action="store_true",
                   help="crop: skip local backups (not recommended)")
    p.add_argument("--backup-root", help="crop: local folder for original backups")
    p.add_argument("--crop-all", action="store_true",
                   help="crop the whole catalog, not just the newly-linked icons")
    p.add_argument("--skip-backfill", action="store_true")
    p.add_argument("--skip-crop", action="store_true")
    p.add_argument("--skip-autotag", action="store_true",
                   help="don't auto-generate tags for icons missing from tags.csv")
    p.add_argument("--skip-tags", action="store_true")
    p.add_argument("--print-commands", action="store_true",
                   help="show the sub-commands that would run, then exit")
    args = p.parse_args()

    env_local = load_env_local(ENV_LOCAL)
    cfg = {
        "python": sys.executable or "python",
        "apply": args.apply,
        "sheet_id": resolve("GOOGLE_SHEET_ID", args.sheet_id, env_local),
        "tab": args.tab or os.environ.get("GOOGLE_SHEET_TAB") or env_local.get("GOOGLE_SHEET_TAB") or "MASTER",
        "creds": args.creds or str(DEFAULT_CREDS),
        "ofm": resolve("OFM_FOLDER_ID", args.ofm_folder, env_local),
        "dst": resolve("DST_FOLDER_ID", args.dst_folder, env_local),
        "png": resolve("PNG_FOLDER_ID", args.png_folder, env_local),
        "csv": args.csv or str(DEFAULT_CSV),
        "overwrite": args.overwrite, "padding": args.padding, "limit": args.limit,
        "no_backup": args.no_backup, "backup_root": args.backup_root,
    }
    if not cfg["sheet_id"]:
        sys.exit("ERROR: no sheet id. Set GOOGLE_SHEET_ID in .env.local or pass --sheet-id.")

    has_folders = bool(cfg["ofm"] or cfg["dst"] or cfg["png"])

    # Decide whether each step runs, with a reason when it doesn't.
    do_backfill, why_bf = True, ""
    if args.skip_backfill:
        do_backfill, why_bf = False, "--skip-backfill"
    elif not BACKFILL.exists():
        do_backfill, why_bf = False, f"script missing: {BACKFILL}"
    elif not has_folders:
        do_backfill, why_bf = False, "no OFM/DST/PNG folder IDs (set them in .env.local or pass --ofm-folder ...)"

    do_crop, why_crop = True, ""
    if args.skip_crop:
        do_crop, why_crop = False, "--skip-crop"
    elif not CROP.exists():
        do_crop, why_crop = False, f"script missing: {CROP}"

    do_autotag, why_autotag = True, ""
    if args.skip_autotag:
        do_autotag, why_autotag = False, "--skip-autotag"
    elif not AUTOTAG.exists():
        do_autotag, why_autotag = False, f"script missing: {AUTOTAG}"

    do_tags, why_tags = True, ""
    if args.skip_tags:
        do_tags, why_tags = False, "--skip-tags"
    elif not TAGS.exists():
        do_tags, why_tags = False, f"script missing: {TAGS}"
    elif not do_autotag and not Path(cfg["csv"]).exists():
        do_tags, why_tags = False, f"tags.csv missing: {cfg['csv']}"

    crop_scope = "whole catalog" if args.crop_all else "newly-linked PNGs only"

    # Banner
    print(f"\n{BAR}\n  ADD ICONS — {'APPLY (writes changes)' if args.apply else 'DRY RUN (preview only)'}\n{BAR}")
    print(f"  Sheet tab   : {cfg['tab']}")
    print(f"  Credentials : {cfg['creds']}")
    print(f"  Folders     : OFM={'set' if cfg['ofm'] else '—'}  "
          f"DST={'set' if cfg['dst'] else '—'}  PNG={'set' if cfg['png'] else '—'}")
    print(f"  Plan        : "
          f"[{'✓' if do_backfill else '·'}] backfill   "
          f"[{'✓' if do_crop else '·'}] auto-crop ({crop_scope})   "
          f"[{'✓' if do_autotag else '·'}] auto-tag   "
          f"[{'✓' if do_tags else '·'}] tags")
    for label, ok, why in (("backfill", do_backfill, why_bf),
                           ("auto-crop", do_crop, why_crop),
                           ("auto-tag", do_autotag, why_autotag),
                           ("tags", do_tags, why_tags)):
        if not ok:
            print(f"     - {label} will be skipped: {why}")

    # --print-commands: show what would run and stop.
    if args.print_commands:
        show_report = do_backfill and do_crop and not args.crop_all and args.apply
        print(f"\n{BAR}\n  COMMANDS\n{BAR}")
        if do_backfill:
            print("  1) " + _fmt(build_backfill(cfg, "<report.json>" if show_report else None)))
        if do_crop:
            if args.crop_all:
                print("  2) " + _fmt(build_crop(cfg, None)))
            elif not args.apply:
                print("  2) auto-crop skipped in dry-run (needs links); use --apply, or --crop-all to preview all")
            else:
                print("  2) " + _fmt(build_crop(cfg, "<newly-linked.json>")) + "   (names from backfill's report)")
        if do_autotag:
            print("  3) " + _fmt(build_autotag(cfg)))
        if do_tags:
            print("  4) " + _fmt(build_tags(cfg)))
        return

    if not (do_backfill or do_crop or do_autotag or do_tags):
        sys.exit("Nothing to run.")

    # One confirmation for the whole run.
    if args.apply:
        print("\nAPPLY MODE — this will write to the sheet and OVERWRITE PNGs in Drive.")
        if input("Type 'yes' to run all steps for real: ").strip().lower() != "yes":
            sys.exit("Aborted — nothing changed.")

    child_env = os.environ.copy()
    child_env["GOOGLE_SHEET_ID"] = cfg["sheet_id"]
    child_env["GOOGLE_SHEET_TAB"] = cfg["tab"]

    results: list[tuple[str, str]] = []
    tmpdir = tempfile.mkdtemp(prefix="add_icons_")
    report_path = os.path.join(tmpdir, "backfill_report.json")
    # Only ask backfill for a report when auto-crop needs the "new" set.
    want_report = do_backfill and do_crop and not args.crop_all and args.apply

    # 1) Backfill
    if do_backfill:
        results.append(("Backfill", run_step(
            "Backfill", build_backfill(cfg, report_path if want_report else None), child_env)))
    else:
        print(f"\n=== Backfill: SKIPPED — {why_bf} ===")
        results.append(("Backfill", "skipped"))

    # 2) Auto-crop
    if do_crop:
        if args.crop_all:
            results.append(("Auto-crop", run_step("Auto-crop (all)", build_crop(cfg, None), child_env)))
        elif not args.apply:
            print("\n=== Auto-crop: SKIPPED in dry-run ===")
            print("   New PNGs aren't linked until backfill actually writes, so there's nothing")
            print("   to preview here. Run with --apply, or use --crop-all to preview the whole catalog.")
            results.append(("Auto-crop", "skipped (dry-run)"))
        elif not do_backfill:
            print("\n=== Auto-crop: SKIPPED — backfill didn't run, so there's no 'new' set ===")
            print("   Use --crop-all to re-crop the whole catalog.")
            results.append(("Auto-crop", "skipped"))
        else:
            new_names = read_png_icons(report_path)
            if not new_names:
                print("\n=== Auto-crop: nothing to do — no newly-linked PNGs this run ===")
                print("   (Use --crop-all to re-crop the whole catalog.)")
                results.append(("Auto-crop", "ok (nothing new)"))
            else:
                only_file = os.path.join(tmpdir, "new_pngs.json")
                Path(only_file).write_text(json.dumps(new_names), encoding="utf-8")
                print(f"\n  Auto-crop will process {len(new_names)} newly-linked icon(s).")
                results.append(("Auto-crop", run_step(
                    "Auto-crop (new icons)", build_crop(cfg, only_file), child_env)))
    else:
        print(f"\n=== Auto-crop: SKIPPED — {why_crop} ===")
        results.append(("Auto-crop", "skipped"))

    # 3) Auto-tag: append any icons missing from tags.csv (before the sheet write).
    if do_autotag:
        results.append(("Auto-tag", run_step("Auto-tag new icons", build_autotag(cfg), child_env)))
    else:
        print(f"\n=== Auto-tag: SKIPPED — {why_autotag} ===")
        results.append(("Auto-tag", "skipped"))

    # 4) Tags
    if do_tags:
        results.append(("Tags", run_step("Tags", build_tags(cfg), child_env)))
    else:
        print(f"\n=== Tags: SKIPPED — {why_tags} ===")
        results.append(("Tags", "skipped"))

    # Summary
    print(f"\n{BAR}\n  SUMMARY — {'APPLIED' if args.apply else 'DRY RUN'}\n{BAR}")
    for name, status in results:
        print(f"  {name:12s} {status}")
    if not args.apply:
        print("\nThis was a preview. Re-run with --apply to make the changes.")


if __name__ == "__main__":
    main()
