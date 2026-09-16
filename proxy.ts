import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildCsp, frameAncestorsFromEnv } from "@/lib/csp";

// Next.js 16 renamed `middleware.ts` to `proxy.ts`. This file gates the
// `/app/*` routes when auth is enabled, and passes everything through when
// it isn't. Proxy always runs on Node.js runtime in Next.js 16, so
// process.env reads happen at request time.
//
// Matcher paths are RELATIVE to basePath. The Next config sets
// basePath="/app", so matcher: ["/:path*"] resolves to /app/:path* — every
// app route is gated.
//
// Optimistic cookie check only — no crypto, no env vars baked at build time.
// The real JWT verification happens in page.tsx / API routes via auth().
/**
 * Rewrite frame-ancestors on shop pages, at REQUEST time.
 *
 * next.config.ts cannot do this. Its headers() runs during `next build` and the
 * result is frozen into routes-manifest.json, so a runtime env var on the pod is
 * invisible to it — the first version of this shipped with 'none' baked in while
 * EMBED_ALLOWED_ORIGINS sat correctly set in the deployment, and the embed
 * simply never worked.
 *
 * Fails CLOSED. next.config.ts still emits frame-ancestors 'none' for these
 * paths, so if this middleware does not run, or the env var is unset or
 * malformed, the header stays as it was and the page is unframeable. Nothing
 * here can make a page MORE framable by failing.
 */
function withEmbedPolicy(res: NextResponse, request: NextRequest): NextResponse {
  // Shop pages only. The designer, profile and API are never framable, whatever
  // is configured.
  if (!request.nextUrl.pathname.startsWith("/shop/")) return res;

  const frameAncestors = frameAncestorsFromEnv(
    process.env.EMBED_ALLOWED_ORIGINS,
  );
  if (frameAncestors === "'none'") return res;

  // The FULL policy, not just frame-ancestors. A header set here REPLACES the
  // one from next.config rather than merging with it, so emitting only
  // frame-ancestors would strip script-src, img-src and the rest while leaving
  // the page looking like it still had a CSP. Verified by response inspection,
  // after doing exactly that.
  res.headers.set("content-security-policy", buildCsp(frameAncestors));
  return res;
}

export function proxy(request: NextRequest) {
  // Shop pages are public and must never be auth-gated; they are in the matcher
  // only so the embed policy above can be applied at request time.
  const isShop = request.nextUrl.pathname.startsWith("/shop/");
  if (isShop) return withEmbedPolicy(NextResponse.next(), request);

  // Auth-off mode (gate is bypassed) when EITHER:
  //   - AUTH_DISABLED=true is set explicitly, OR
  //   - AUTH_SECRET is unset (local dev with no auth configured — there
  //     is no landing page to redirect to and no session cookie to check)
  const authDisabled =
    process.env.AUTH_DISABLED === "true" || !process.env.AUTH_SECRET;
  if (authDisabled) return NextResponse.next();

  const hasSession = request.cookies.has(
    process.env.NODE_ENV === "production"
      ? "__Secure-authjs.session-token"
      : "authjs.session-token",
  );

  if (!hasSession) {
    return NextResponse.redirect(new URL("/", request.nextUrl.origin));
  }

  return NextResponse.next();
}

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
  //   - fabrics/, lx/: fabric swatch images for the palette and the
  //     profile page. Exactly the failure the textures/ note predicts, and
  //     it did happen: fabrics/ shipped without this line and every swatch
  //     came back 307 to /. A signed-in browser sends its cookie on a
  //     same-origin <img> so it mostly works, which is what makes the
  //     omission easy to miss — the images are public product photos, not
  //     user data, so gating them buys nothing and costs a silent failure.
  //   - icon.svg: the favicon. Browser fetches it as soon as the HTML
  //     loads, often before any cookie roundtrip resolves. Add any
  //     future top-level public assets (robots.txt, manifest.json,
  //     apple-touch-icon.png, etc.) to this list as they're introduced.
  //   - api/shop/, api/orders: the public storefront's data endpoints and
  //     order submission. NOTE that `shop/` itself is NOT excluded any more:
  //     those pages must reach this middleware so the embed policy can be
  //     applied at request time (see withEmbedPolicy). proxy() returns early
  //     for them, so they are still never auth-gated — the matcher change
  //     moves where that decision is made, not whether they are public.
  //
  //     Previously: a stitcher's public storefront and the order
  //     form on it. These are the ONLY deliberately public pages in the
  //     app, and the exclusion is the whole mechanism — the pages render
  //     for a customer who has never signed in, which is the point: they
  //     browse and design freely, and only placing the order (POST
  //     /api/orders, which is NOT excluded) requires an account.
  //     Everything these routes can reach goes through the paneler_public
  //     database role, which can read published shops and nothing else.
  //     Verify by opening a shop link in a private window; with a session
  //     cookie present a missing exclusion here cannot fail.
  //   - api/orders: submission is anonymous too. The order is emailed to the
  //     stitcher rather than stored, so there is no account to attribute it to
  //     and nothing for a session to authorise. Gating it would 307 every
  //     submission away — and, because a signed-in browser sends its cookie,
  //     it would appear to work for whoever tested it.
  matcher: [
    "/((?!api/health|_next/|textures/|presets/|fabrics/|lx/|api/shop/|api/orders|icon\\.svg).*)",
  ],
};
