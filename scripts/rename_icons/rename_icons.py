#!/usr/bin/env python3
"""Rename an icon's files in Google Drive (in place).

Use this when you rename an icon: it finds the icon's OFM / DST / PNG files in
Drive and renames them to the new name, keeping the SAME file IDs (so any sheet
links keep working). Because this only changes the file *name* — not its
contents — it works even though the service account has no storage of its own
(the thing that blocks new uploads into a personal My Drive).

After running this, run the normal pipeline with --skip-upload to re-link the
sheet cells:  python scripts\\add_icons\\add_icons.py --skip-upload --apply

Examples
  # preview (default: shows what it would rename, changes nothing)
  python scripts\\rename_icons\\rename_icons.py ^
      --rename "Boston Adirondak Chair" "Boston Adirondack Chair" ^
      --rename "Boston Canolli" "Boston Cannoli"

  # do it
  python scripts\\rename_icons\\rename_icons.py --apply ^
      --rename "Boston Adirondak Chair" "Boston Adirondack Chair" ^
      --rename "Boston Canolli" "Boston Cannoli"

It matches any file whose name starts with the OLD name followed by a space or a
dot — so "Boston Canolli.png", "Boston Canolli SMALL.ofm", "Boston Canolli
MEDIUM.dst" all get renamed, and the size/extension part is preserved.
"""
import argparse
import re
import os
import sys
from collections import defaultdict
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
ENV_LOCAL = PROJECT_ROOT / ".env.local"
SCOPES = ["https://www.googleapis.com/auth/drive"]
FOLDER_MIME = "application/vnd.google-apps.folder"


def load_env_local(path):
    out = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def load_creds(path):
    if not path.exists():
        sys.exit(f"ERROR: service account creds not found at {path}")
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


def walk_files(svc, folder_id):
    """Yield (id, name) for every file under folder_id (recursively)."""
    stack, seen = [folder_id], set()
    while stack:
        fid = stack.pop()
        if fid in seen:
            continue
        seen.add(fid)
        token = None
        while True:
            resp = svc.files().list(
                q=f"'{fid}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType)",
                pageSize=1000, pageToken=token,
                supportsAllDrives=True, includeItemsFromAllDrives=True,
            ).execute()
            for f in resp.get("files", []):
                if f["mimeType"] == FOLDER_MIME:
                    stack.append(f["id"])
                else:
                    yield f["id"], f["name"]
            token = resp.get("nextPageToken")
            if not token:
                break


def matches(name, old):
    """True if `name` is exactly this icon's file: `<old>.ext` or `<old> SIZE.ext`
    (SIZE being a single word like SMALL/MEDIUM/LARGE). Case-insensitive on the
    name; avoids catching a different icon that merely shares the prefix."""
    if name.lower().startswith(old.lower()):
        rest = name[len(old):]
        return bool(re.fullmatch(r"\.[A-Za-z0-9]+", rest)
                    or re.fullmatch(r" [^ ]+\.[A-Za-z0-9]+", rest))
    return False


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    env = load_env_local(ENV_LOCAL)
    p.add_argument("--rename", nargs=2, action="append", metavar=("OLD", "NEW"),
                   required=True, help='an OLD/NEW icon name pair (repeatable)')
    p.add_argument("--ofm-folder", default=env.get("OFM_FOLDER_ID"))
    p.add_argument("--dst-folder", default=env.get("DST_FOLDER_ID"))
    p.add_argument("--png-folder", default=env.get("PNG_FOLDER_ID"))
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--apply", action="store_true", help="actually rename (default: preview)")
    args = p.parse_args()

    folders = [f for f in (args.ofm_folder, args.dst_folder, args.png_folder) if f]
    if not folders:
        sys.exit("ERROR: no folder IDs. Set OFM_FOLDER_ID / DST_FOLDER_ID / PNG_FOLDER_ID in .env.local.")

    svc = build("drive", "v3", credentials=load_creds(Path(args.creds)),
                cache_discovery=False)

    # Gather every file once (across the three folders), de-duped by id.
    all_files = {}
    for fid in folders:
        for id_, name in walk_files(svc, fid):
            all_files[id_] = name

    # Build the rename plan.
    plan = []           # (id, old_name, new_name)
    unmatched = []
    for old, new in args.rename:
        hits = [(id_, nm) for id_, nm in all_files.items() if matches(nm, old)]
        if not hits:
            unmatched.append(old)
            continue
        for id_, nm in hits:
            new_name = new + nm[len(old):]   # keep the size/extension suffix
            if new_name != nm:
                plan.append((id_, nm, new_name))

    if unmatched:
        print("No files found for: " + ", ".join(f'"{u}"' for u in unmatched))
        print("(Check the spelling matches the current Drive file names exactly.)\n")

    if not plan:
        print("Nothing to rename.")
        return

    print(f"{len(plan)} file(s) to rename:")
    for _id, old_name, new_name in plan:
        print(f"  {old_name}\n     -> {new_name}")

    if not args.apply:
        print("\nPREVIEW — nothing changed. Re-run with --apply to rename.")
        return

    print()
    ok = fail = 0
    for id_, old_name, new_name in plan:
        try:
            svc.files().update(fileId=id_, body={"name": new_name},
                               supportsAllDrives=True, fields="id").execute()
            ok += 1
            print(f"  renamed  {old_name}  ->  {new_name}")
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"  FAILED   {old_name}: {e}")

    print(f"\nDone — {ok} renamed, {fail} failed.")
    if ok:
        print("Now re-link the sheet cells:")
        print(r"  python scripts\add_icons\add_icons.py --skip-upload --apply")


if __name__ == "__main__":
    main()
