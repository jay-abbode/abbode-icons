# Abbode Icon Library

Internal web app for browsing and downloading embroidery icons from the team's
Google Sheet catalog. Sign-in restricted to @shopabbode.com Workspace accounts
plus invited 3PL partners (managed via a sheet tab).

- ✅ **Batch 1:** Project scaffold, Google Sheets reader, diagnostic page
- ✅ **Batch 2:** Polished UI — landing, browse, search, filters, downloads
- ✅ **Batch 3 (current):** Auth + Vercel deployment

---

## Local setup (one time)

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

For local dev to work you need both:

1. `google-credentials.json` in the project root (service-account JSON from
   Google Cloud — read access to your sheet + Drive folders)
2. `.env.local` filled in with `AUTH_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, and
   `GOOGLE_OAUTH_CLIENT_SECRET` (see batch-3 setup walkthrough for how to
   create the OAuth client)

---

## Managing who can sign in

There are two ways someone gets access:

1. **They have a `@shopabbode.com` Google account.** Automatic — nothing to do.
2. **They're on the ACCESS allowlist.** Add a tab to the sheet named exactly
   `ACCESS`, with this structure:

   | Email                | Name           | Company  |
   | -------------------- | -------------- | -------- |
   | jane@acme-3pl.com    | Jane Doe       | Acme 3PL |
   | mike@example.com     | Mike Johnson   | Other    |

   Add or remove rows whenever you want to add or revoke a partner's access.
   Changes take effect within 60 seconds (cached).

Note: external users must sign in with a **Google account** (either their own
Workspace email or a Gmail). The email address Google reports back to us must
match what's in the ACCESS sheet — case-insensitive, but otherwise exact.

---

## Deploying to Vercel

See the batch-3 walkthrough message for the full step-by-step. In brief:

1. Push this project to a GitHub repo.
2. Import the repo into Vercel.
3. Add these env vars in Vercel project settings:
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SHEET_TAB` (= `MASTER`)
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` (from your service-account JSON)
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (from your service-account JSON, with quotes)
   - `AUTH_SECRET`
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `ALLOWED_DOMAIN` (= `shopabbode.com`)
4. Deploy.
5. Add your Vercel URL as an authorized redirect URI back in Google Cloud
   (Credentials → OAuth client → Authorized redirect URIs).

---

## Project structure

```
abbode-icons/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts   # NextAuth handlers
│   │   ├── download/[fileId]/route.ts    # Download proxy
│   │   ├── icons/route.ts                # Catalog JSON
│   │   └── image/[fileId]/route.ts       # Image proxy
│   ├── browse/page.tsx
│   ├── login/page.tsx
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── FilterControls.tsx
│   ├── Header.tsx
│   ├── IconDetailModal.tsx
│   ├── IconGrid.tsx
│   └── SearchBar.tsx
├── lib/
│   ├── google.ts
│   └── sheets.ts                # Catalog + allowlist reader
├── auth.ts                      # NextAuth config (gatekeeper logic)
├── middleware.ts                # Route protection
└── package.json
```
