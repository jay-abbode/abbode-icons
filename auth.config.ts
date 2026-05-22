import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe auth config.
 *
 * This file is imported by `middleware.ts`, which runs on the Edge runtime
 * and CANNOT depend on Node-only modules like `googleapis`. Anything that
 * touches the Google Sheets API (e.g. the signIn callback that checks the
 * ACCESS tab) must live in `auth.ts` instead, NOT here.
 */
const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 14, // 14 days
  },
} satisfies NextAuthConfig;

export default authConfig;
