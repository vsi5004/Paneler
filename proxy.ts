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
  // /app and everything under it. Exclusions:
  //   - api/health: the readiness/liveness probes are unauthenticated.
  //   - _next/static, _next/image, _next/data: hashed bundles served to
  //     every visitor. Gating them sends unauthed browsers' CSS / JS /
  //     RSC payload requests to the landing instead of the file, and
  //     the app renders unstyled until the user signs in. Cookie-aware
  //     auth happens on the page request, not the asset requests.
  //   - textures/: public PNG normal/roughness maps loaded by Three.js
  //     via TextureLoader (<img>). Same class of problem as _next/ — if
  //     the session check ever 307s the image request, the load fails
  //     silently and panels render without suede.
  //   - icon.svg: the favicon. Browser fetches it as soon as the HTML
  //     loads, often before any cookie roundtrip resolves. Add any
  //     future top-level public assets (robots.txt, manifest.json,
  //     apple-touch-icon.png, etc.) to this list as they're introduced.
  matcher: ["/((?!api/health|_next/|textures/|icon\\.svg).*)"],
};
