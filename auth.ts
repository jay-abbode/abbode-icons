import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { getAllowedEmails } from "@/lib/sheets";

const ALLOWED_DOMAIN = (process.env.ALLOWED_DOMAIN || "shopabbode.com")
  .toLowerCase()
  .replace(/^@/, "");

/**
 * Full auth config — used by API routes and server components.
 * Extends the edge-safe `authConfig` with the signIn callback,
 * which talks to the Google Sheet for the external allowlist.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    /**
     * Gatekeeper: decides whether a Google account is allowed to sign in.
     *  - Anyone with an @ALLOWED_DOMAIN address is auto-approved.
     *  - Otherwise the email must appear in the ACCESS tab of the sheet.
     *  - All other sign-ins are rejected.
     */
    async signIn({ user, account }) {
      if (account?.provider !== "google" || !user?.email) {
        return false;
      }

      const email = user.email.toLowerCase().trim();

      // 1. Domain auto-approval
      if (email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        return true;
      }

      // 2. External allowlist (3PL partners, etc.)
      try {
        const allowed = await getAllowedEmails();
        if (allowed.includes(email)) {
          return true;
        }
      } catch (err) {
        console.error("Allowlist lookup failed:", err);
        // Fail closed: if we can't verify, deny.
        return false;
      }

      // Redirect with a query so /login can show a useful message.
      return `/login?error=AccessDenied&email=${encodeURIComponent(email)}`;
    },
  },
});
