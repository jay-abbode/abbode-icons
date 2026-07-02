#!/usr/bin/env python3
"""Upload locally-processed icon files to the right Google Drive folders.

Point it at your ICON LAUNCHPAD folder. It walks the whole folder (subfolders
included) and sends each file to Drive by its type:

  *.ofm  -> the OFM folder
  *.dst  -> the DST folder
  *.png  -> the PNG folder

The important part — it NEVER makes duplicates:

  * New file (name not in the Drive folder yet)      -> uploaded fresh.
  * Replacement (one file with that name exists)      -> that same Drive file is
                                                         OVERWRITTEN in place, so
                                                         its file ID doesn't change
                                                         and the sheet link keeps
                                                         working.
  * Name already duplicated in Drive (2+ copies)      -> SKIPPED with a warning,
                                                         so a pre-existing mess
                                                         isn't made worse. Clean it
                                                         up, then re-run.

Matching is case-insensitive on the full file name (so "Needlepoint.png" and
"needlepoint.png" are treated as the same file).

Safe workflow (preview first):
  python upload_icons.py --dry-run     # shows exactly what it would do
  python upload_icons.py               # upload for real

Needs
  google-credentials.json  service account at the repo root, with EDIT
                           (Content Manager) access to the three folders.
  Folder IDs + the launchpad path come from flags, env vars, or .env.local:
     OFM_FOLDER_ID, DST_FOLDER_ID, PNG_FOLDER_ID, LAUNCHPAD_DIR
"""
import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
ENV_LOCAL = PROJECT_ROOT / ".env.local"

# Write scope (backfill only reads; uploading needs full drive).
SCOPES = ["https://www.googleapis.com/auth/drive"]
FOLDER_MIME = "application/vnd.google-apps.folder"

# Default launchpad location (override in .env.local with LAUNCHPAD_DIR=...).
DEFAULT_LAUNCHPAD = r"C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON LAUNCHPAD"

# ext -> (config key for the target folder, upload mime type)
ROUTING = {
    ".ofm": ("ofm", "application/octet-stream"),  # proprietary/opaque: store bytes as-is
    ".dst": ("dst", "application/octet-stream"),
    ".png": ("png", "image/png"),
}
# Files we never upload (OS/office cruft, temp/lock files).
IGNORE_EXACT = {"thumbs.db", "desktop.ini", ".ds_store"}


def load_env_local(path):
    out = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def load_creds(path):
    if not path.exists():
        sys.exit(f"ERROR: service account creds not found at {path}")
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


def is_junk(name):
    low = name.lower()
    return (low in IGNORE_EXACT or name.startswith("~$")
            or name.startswith(".") or name.endswith(".tmp") or name.startswith("$"))


def scan_local(root):
    """Return {ext: [Path, ...]} for the file types we upload."""
    found = defaultdict(list)
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if is_junk(fn):
                continue
            ext = os.path.splitext(fn)[1].lower()
            if ext in ROUTING:
                found[ext].append(Path(dirpath) / fn)
    return found


def list_folder_by_name(drive, folder_id):
    """Walk folder + subfolders. Returns (by_name_lower -> id, dupes set(lower))."""
    name_to_ids = defaultdict(set)
    stack, seen = [folder_id], set()
    while stack:
        fid = stack.pop()
        if fid in seen:
            continue
        seen.add(fid)
        token = None
        while True:
            resp = drive.files().list(
                q=f"'{fid}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType)",
                pageSize=1000, pageToken=token,
                supportsAllDrives=True, includeItemsFromAllDrives=True,
            ).execute()
            for f in resp.get("files", []):
                if f["mimeType"] == FOLDER_MIME:
                    stack.append(f["id"])
                else:
                    name_to_ids[f["name"].lower()].add(f["id"])
            token = resp.get("nextPageToken")
            if not token:
                break
    by_name = {n: next(iter(ids)) for n, ids in name_to_ids.items() if len(ids) == 1}
    dupes = {n for n, ids in name_to_ids.items() if len(ids) > 1}
    return by_name, dupes


def can_write(drive, folder_id):
    """True if the service account may add children to this folder."""
    try:
        meta = drive.files().get(fileId=folder_id, fields="name,capabilities(canAddChildren)",
                                 supportsAllDrives=True).execute()
        return bool(meta.get("capabilities", {}).get("canAddChildren")), meta.get("name", folder_id)
    except Exception as e:  # noqa: BLE001
        return False, f"{folder_id} (error: {e})"


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    env = load_env_local(ENV_LOCAL)
    p.add_argument("--launchpad", default=os.environ.get("LAUNCHPAD_DIR")
                   or env.get("LAUNCHPAD_DIR") or DEFAULT_LAUNCHPAD)
    p.add_argument("--ofm-folder", default=os.environ.get("OFM_FOLDER_ID") or env.get("OFM_FOLDER_ID"))
    p.add_argument("--dst-folder", default=os.environ.get("DST_FOLDER_ID") or env.get("DST_FOLDER_ID"))
    p.add_argument("--png-folder", default=os.environ.get("PNG_FOLDER_ID") or env.get("PNG_FOLDER_ID"))
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--report-json", help="write a JSON summary of what was uploaded")
    p.add_argument("--dry-run", action="store_true", help="preview only; upload nothing")
    args = p.parse_args()

    folders = {"ofm": args.ofm_folder, "dst": args.dst_folder, "png": args.png_folder}

    root = Path(args.launchpad)
    if not root.exists():
        print(f"Launchpad folder not found: {root}")
        print("Create it (or set LAUNCHPAD_DIR in .env.local) and drop your processed files inside.")
        return

    local = scan_local(root)
    total_local = sum(len(v) for v in local.values())
    print(f"Launchpad: {root}")
    print(f"Found {total_local} file(s) to upload: "
          f"{len(local.get('.ofm', []))} ofm, {len(local.get('.dst', []))} dst, "
          f"{len(local.get('.png', []))} png")
    if not total_local:
        print("Nothing to upload.")
        return

    drive = build("drive", "v3", credentials=load_creds(Path(args.creds)),
                  cache_discovery=False)
    svc = drive.files()

    # Plan per type.
    plan = {"new": [], "replace": [], "skip_dup": [], "no_folder": []}
    caps = {}
    for ext, paths in sorted(local.items()):
        key, mime = ROUTING[ext]
        folder_id = folders.get(key)
        if not folder_id:
            plan["no_folder"] += [(pp, key) for pp in paths]
            continue
        if folder_id not in caps:
            ok, fname = can_write(svc, folder_id)
            caps[folder_id] = (ok, fname)
        by_name, dupes = list_folder_by_name(svc, folder_id)
        for pp in paths:
            low = pp.name.lower()
            if low in dupes:
                plan["skip_dup"].append((pp, key, folder_id))
            elif low in by_name:
                plan["replace"].append((pp, key, folder_id, by_name[low], mime))
            else:
                plan["new"].append((pp, key, folder_id, mime))

    # Report write-permission up front.
    print("\nFolder write access (service account):")
    for fid, (ok, fname) in caps.items():
        print(f"  [{'OK ' if ok else 'NO '}] {fname}")
    blocked = [fname for _fid, (ok, fname) in caps.items() if not ok]

    def line(pp, folder_id):
        return f"{pp.name}  ->  {caps.get(folder_id, (None, folder_id))[1]}"

    if plan["new"]:
        print(f"\nNEW ({len(plan['new'])}):")
        for pp, _k, fid, _m in plan["new"]:
            print("  + " + line(pp, fid))
    if plan["replace"]:
        print(f"\nREPLACE in place ({len(plan['replace'])}):")
        for pp, _k, fid, _id, _m in plan["replace"]:
            print("  ~ " + line(pp, fid))
    if plan["skip_dup"]:
        print(f"\nSKIP — already duplicated in Drive ({len(plan['skip_dup'])}), clean up first:")
        for pp, _k, fid in plan["skip_dup"]:
            print("  ! " + line(pp, fid))
    if plan["no_folder"]:
        print(f"\nSKIP — no folder ID configured for these ({len(plan['no_folder'])}):")
        for pp, key in plan["no_folder"]:
            print(f"  ? {pp.name}  ({key} folder not set)")

    if blocked:
        print("\n*** The service account can't write to: " + ", ".join(blocked))
        print("    Share each of those Drive folders with the service account's client_email")
        print("    (in google-credentials.json) as 'Content Manager', then re-run.")

    if args.dry_run:
        print("\nDRY RUN — nothing uploaded.")
        return
    if blocked:
        sys.exit("Aborting: fix folder sharing above, then re-run.")

    # Apply.
    uploaded, replaced, failed = [], [], []
    for pp, _k, folder_id, mime in plan["new"]:
        try:
            media = MediaFileUpload(str(pp), mimetype=mime, resumable=True)
            svc.create(body={"name": pp.name, "parents": [folder_id]},
                       media_body=media, fields="id",
                       supportsAllDrives=True).execute()
            uploaded.append(pp.name)
            print(f"  uploaded  {pp.name}")
        except Exception as e:  # noqa: BLE001
            failed.append((pp.name, str(e)))
            print(f"  FAILED    {pp.name}: {e}")
    for pp, _k, folder_id, file_id, mime in plan["replace"]:
        try:
            media = MediaFileUpload(str(pp), mimetype=mime, resumable=True)
            svc.update(fileId=file_id, media_body=media, fields="id",
                       supportsAllDrives=True).execute()
            replaced.append(pp.name)
            print(f"  replaced  {pp.name}")
        except Exception as e:  # noqa: BLE001
            failed.append((pp.name, str(e)))
            print(f"  FAILED    {pp.name}: {e}")

    print(f"\nDone — {len(uploaded)} uploaded, {len(replaced)} replaced, "
          f"{len(plan['skip_dup'])} skipped (dupes), {len(failed)} failed.")

    if args.report_json:
        # icon names (no extension) of PNGs that changed — so the runner can crop them.
        png_names = [os.path.splitext(n)[0] for n in (uploaded + replaced)
                     if n.lower().endswith(".png")]
        Path(args.report_json).write_text(json.dumps({
            "uploaded": uploaded, "replaced": replaced,
            "skipped_dupes": [pp.name for pp, _k, _f in plan["skip_dup"]],
            "png_icons": png_names,
        }), encoding="utf-8")


if __name__ == "__main__":
    main()
