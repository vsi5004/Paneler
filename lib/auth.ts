import "server-only";
import NextAuth from "next-auth";

// App-side Auth.js v5 config. This is the *reader* side — sign-in happens
// over on the paneler-business landing repo. We share the cookie via the
// AUTH_SECRET env var (same value injected into both deployments by the
// `paneler-secrets` k8s Secret), so the JWT set by the landing's
// /api/auth/callback/* route is decodable here.
//
// No providers configured: this app never initiates sign-in.

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 }, // 30d, matches landing
});
