import NextAuth from "next-auth";
import authConfig from "@/auth.config";

/**
 * Middleware uses ONLY the edge-safe `authConfig`, not the full `auth.ts`,
 * so we never pull `googleapis` (or any Node-only module) into the Edge bundle.
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  // If the request has no session and isn't headed for /login, redirect to it.
  if (!req.auth) {
    const url = new URL("/login", req.nextUrl.origin);
    // Preserve where the user was trying to go so we can send them back after sign-in.
    if (req.nextUrl.pathname !== "/") {
      url.searchParams.set("from", req.nextUrl.pathname + req.nextUrl.search);
    }
    return Response.redirect(url);
  }
});

// Anything NOT matched here is public. We protect everything except:
//   - /api/auth/*  (NextAuth's own routes)
//   - /login       (the sign-in page itself)
//   - /_next/*     (Next.js internals, static assets, etc.)
//   - /favicon.ico
export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
