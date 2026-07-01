FIX — cropped / re-uploaded icons now refresh on their own
==========================================================

The problem
  The image route served every icon with `Cache-Control: ...immutable` and a
  long lifetime, keyed on the Drive file ID. Auto-crop overwrites a PNG *in
  place* (same ID), so the URL never changed — your browser (1h) and Vercel's
  CDN (24h) kept serving the pre-crop image, and "immutable" told the browser
  not to even re-check. The crop worked; the delivery was stale.

The fix (one file: app/api/image/[fileId]/route.ts)
  * The response now carries an ETag built from the file's Drive md5 checksum,
    which changes whenever the bytes change (i.e. on every crop/overwrite).
  * "immutable" is dropped and the cache window is short (60s) with
    stale-while-revalidate, so caches re-check quickly and non-blocking.
  * Unchanged files still return a cheap 304 (no re-download; recolor variants
    skip the re-render too), so this stays fast — it only refetches when a file
    has actually changed.
  * The in-memory raw cache is trimmed from 5 min to 60s so the server itself
    reflects an overwrite within about a minute.

Net effect: after you crop (or re-upload) an icon, the site picks up the new
image on its own within ~a minute. No redeploys, no cache-busting, no new
columns.

ONE-TIME NOTE
  Images your browser already cached under the old "immutable" rule are still
  held for up to an hour. After you deploy this, do a single hard refresh
  (Ctrl+Shift+R) to flush those. From then on it self-heals — you won't need to.

Push:
  cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons"
  git add -A
  git commit -m "Image route: ETag revalidation so overwritten (cropped) PNGs refresh"
  git push
