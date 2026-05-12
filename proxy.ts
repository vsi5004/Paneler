import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

// Next.js 16 renamed `middleware.ts` to `proxy.ts`. This file gates the
// /app/* routes when auth is enabled, and passes everything through when
// it isn't.
//
// Auth-off mode (the gate is bypassed) is active when EITHER:
//   - AUTH_DISABLED=true is set explicitly, OR
//   - AUTH_SECRET is unset (the proxy has no key to decode sessions
//     with anyway, so demanding auth would be infinite-loop-prone)
//
// In production, `paneler-secrets.auth_secret` is mounted as AUTH_SECRET
// and AUTH_DISABLED is unset, so the gate is active. In local dev, both
// are unset by default and the designer is open without Dex.
const authDisabled =
  process.env.AUTH_DISABLED === "true" || !process.env.AUTH_SECRET;

export default auth((req) => {
  if (authDisabled) return;
  if (req.auth) return;
  // Unauthed request to a /app/* path → bounce to the landing for sign-in.
  return NextResponse.redirect(new URL("/", req.url));
});

export const config = {
  matcher: ["/app/:path*"],
};
