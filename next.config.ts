import path from "path";
import type { NextConfig } from "next";
import { withPlausibleProxy } from "next-plausible";

// Two build modes:
//   default          → Node.js server output (.next/standalone) for the
//                      container deploy. The reverse proxy in production
//                      routes `/app/*` to this service, so we mount the
//                      whole Next app under `basePath: "/app"` — that way
//                      asset URLs (/_next/static/...) emit as
//                      /app/_next/... and follow the same path rule.
//                      Without this, the browser fetches /_next from the
//                      landing service and the app renders unstyled.
//   STATIC_EXPORT=1  → Static HTML export (.out/) for the GitHub Pages
//                      preview at vsi5004.github.io/Paneler. The auth
//                      proxy isn't included in static builds, so the
//                      preview ships fully open. Uses /Paneler basePath
//                      to match the GH Pages project URL.
const isStaticExport = process.env.STATIC_EXPORT === "1";
const basePath = isStaticExport ? "/Paneler" : "/app";

// Absolute paths for webpack aliases (webpack requires absolute paths).
// Turbopack uses the @/ specifier directly so it bundles each stub as a
// normal project module rather than externalising it as a runtime require().
const authActionsStubAbs = path.resolve("./lib/auth-actions-stub");
const dbClientStubAbs = path.resolve("./lib/db/client-stub");
const dbDesignsStubAbs = path.resolve("./lib/db/designs-stub");
const dbUsersStubAbs = path.resolve("./lib/db/users-stub");
const dbShopStubAbs = path.resolve("./lib/db/shop-stub");
const dbOrderItemsStubAbs = path.resolve("./lib/db/orderItems-stub");
const dbMigrateStubAbs = path.resolve("./lib/db/migrate-stub");
const r2ClientStubAbs = path.resolve("./lib/r2/stub");

const nextConfig: NextConfig = {
  // three.js is published as ESM and Drei pulls in un-transpiled paths the
  // Next bundler can't statically analyze otherwise.
  transpilePackages: ["three"],
  basePath,
  // Surface the basePath to client code so raw fetches (TextureLoader,
  // OBJ uploads, etc.) can prefix it onto `/textures/...` etc. Without
  // this the browser hits /textures/... directly and our reverse proxy
  // routes that to the wrong service.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // Standalone picks up *.server.ts so /api/designs/*/route.server.ts
  // registers as a route. Static export uses only the defaults, so files
  // ending in `.server.ts` resolve to a name like `route.server` (not the
  // expected `route`) and Next.js ignores them — keeping POST/PUT/DELETE
  // handlers out of the static-export build graph.
  pageExtensions: isStaticExport
    ? ["tsx", "ts"]
    : ["server.ts", "server.tsx", "tsx", "ts"],
  // Security response headers. Only applied in the standalone build —
  // GH Pages serves headers from its own infra and ignores this hook. The
  // CSP keeps script/style 'unsafe-inline' because Next.js's hydration
  // bootstrap inlines small chunks; defense for *script* injection here
  // rests on RLS (XSS can't reach other users' data) + httpOnly cookies
  // (XSS can't steal the session). Tighter to nonce-based CSP is doable
  // later if we ever render untrusted markdown or similar.
  async headers() {
    if (isStaticExport) return [];

    // Origins permitted to iframe a stitcher's order form, e.g.
    // "https://lovesacksfootbags.com,https://www.lovesacksfootbags.com".
    //
    // Empty by default, which keeps the default-deny posture: with nothing set,
    // shop pages are exactly as unframeable as the rest of the app. An explicit
    // allow-list, never '*' and never a wildcard host — frame-ancestors is the
    // whole clickjacking defense for a page that takes orders, and a wildcard
    // would let anyone frame a stitcher's form inside their own checkout.
    const embedOrigins = (process.env.EMBED_ALLOWED_ORIGINS ?? "")
      .split(/[\s,]+/)
      .filter(Boolean);

    // Shared by both route groups so a future change to img-src or connect-src
    // cannot silently apply to only half the app.
    const commonCsp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // Google avatar URLs come from several googleusercontent subdomains.
      // blob: covers OBJ-upload preview thumbnails; data: covers any small
      // inline images Next.js emits.
      "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com",
      "font-src 'self' data:",
      // R2 presigned URLs for GLB download go directly from the browser to
      // Cloudflare R2, bypassing our pod.
      "connect-src 'self' blob: https://*.r2.cloudflarestorage.com",
      "base-uri 'self'",
      "object-src 'none'",
    ];

    // X-Frame-Options is deliberately absent everywhere.
    //
    // It is DENY-or-nothing: ALLOW-FROM is dead and no browser honours it. So
    // sending DENY on the broad rule would survive onto shop pages, where it
    // would override the frame-ancestors allow-list and block the embed with
    // nothing in the CSP to explain why. frame-ancestors is the modern control
    // and covers every browser that can run this app at all — a client too old
    // to parse it is also too old for WebGL, so it could never reach a page
    // worth framing.
    const commonHeaders = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "geolocation=(), microphone=(), camera=()",
      },
    ];

    return [
      {
        // `/:path*` matches every path including the root. `/(.*)` only matched
        // non-empty paths, which left the root page (`/app` after basePath
        // stripping) without the security headers. A negative lookahead to
        // exclude shop pages has the same defect — path-to-regexp will not
        // match the empty root with one — so this stays broad and the shop rule
        // that follows overrides it.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [...commonCsp, "frame-ancestors 'none'"].join("; "),
          },
          ...commonHeaders,
        ],
      },
      {
        // Shop pages only: the public order form, which a stitcher may embed
        // in their own checkout.
        //
        // MUST come after the broad rule. Next applies every matching rule and
        // the last value for a header wins, so listing this first meant the
        // rule above silently re-asserted frame-ancestors 'none' and the embed
        // would never have worked. Verified with curl rather than assumed,
        // after getting it backwards on the first attempt.
        source: "/shop/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              ...commonCsp,
              embedOrigins.length > 0
                ? `frame-ancestors ${embedOrigins.join(" ")}`
                : "frame-ancestors 'none'",
            ].join("; "),
          },
          ...commonHeaders,
        ],
      },
    ];
  },

  ...(isStaticExport
    ? {
        output: "export",
        images: { unoptimized: true },
        // Alias server-only modules to no-op stubs so static export never
        // pulls `pg`, "use server", or other Node-only code into the bundle.
        // See lib/auth-actions-stub.ts + lib/db/*-stub.ts and PLAN.md.
        turbopack: {
          resolveAlias: {
            "@/lib/auth-actions": "@/lib/auth-actions-stub",
            "@/lib/db/client": "@/lib/db/client-stub",
            "@/lib/db/designs": "@/lib/db/designs-stub",
            "@/lib/db/users": "@/lib/db/users-stub",
            "@/lib/db/shop": "@/lib/db/shop-stub",
            "@/lib/db/orderItems": "@/lib/db/orderItems-stub",
            "@/lib/db/migrate": "@/lib/db/migrate-stub",
            "@/lib/r2/client": "@/lib/r2/stub",
          },
        },
        webpack: (config: { resolve: { alias: Record<string, string> } }) => {
          config.resolve.alias["@/lib/auth-actions"] = authActionsStubAbs;
          config.resolve.alias["@/lib/db/client"] = dbClientStubAbs;
          config.resolve.alias["@/lib/db/designs"] = dbDesignsStubAbs;
          config.resolve.alias["@/lib/db/users"] = dbUsersStubAbs;
          config.resolve.alias["@/lib/db/shop"] = dbShopStubAbs;
          config.resolve.alias["@/lib/db/orderItems"] = dbOrderItemsStubAbs;
          config.resolve.alias["@/lib/db/migrate"] = dbMigrateStubAbs;
          config.resolve.alias["@/lib/r2/client"] = r2ClientStubAbs;
          return config;
        },
      }
    : {
        output: "standalone",
      }),
};

// Proxy the Plausible script + event endpoint through this origin (same
// pattern as the landing/nyfa sites): CSP stays at 'self' and blockers
// don't see stats.korroni.com. Rewrites don't exist in static exports,
// and the GH Pages preview shouldn't be tracked anyway, so the wrapper
// only applies to the server build (the layout also skips the provider).
export default isStaticExport
  ? nextConfig
  : withPlausibleProxy({ customDomain: "https://stats.korroni.com" })(
      nextConfig,
    );
