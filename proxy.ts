import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

// Next.js 16 renamed `middleware.ts` to `proxy.ts`. This file gates the
// `/app/*` routes when auth is enabled, and passes everything through when
// it isn't.
//
// Matcher paths are RELATIVE to basePath. The Next config sets
// basePath="/app", so matcher: ["/:path*"] resolves to /app/:path* — every
// app route is gated.
//
// Auth-off mode (the gate is bypassed) is active when EITHER:
//   - AUTH_DISABLED=true is set explicitly, OR
//   - AUTH_SECRET is unset (the proxy has no key to decode sessions
//     with anyway, so demanding auth would be infinite-loop-prone)
const authDisabled =
  process.env.AUTH_DISABLED === "true" || !process.env.AUTH_SECRET;

export default auth((req) => {
  if (authDisabled) return;
  if (req.auth) return;
  // Unauthed → bounce to the landing for sign-in. Bypass basePath because
  // the landing is a SEPARATE service mounted at /, not under the app's
  // /app basePath.
  return NextResponse.redirect(new URL("/", req.nextUrl.origin));
});

export const config = {
  // Matcher is relative to basePath; with basePath="/app" this matches
  // /app and everything under it. Exclude /api/health so the readiness/
  // liveness probes don't get redirected.
  matcher: ["/((?!api/health).*)"],
};
