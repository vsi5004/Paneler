import path from "path";
import type { NextConfig } from "next";
import { withPlausibleProxy } from "next-plausible";

import { buildCsp } from "./lib/csp";

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
    return [
      {
        // `/:path*` matches every path including the root. `/(.*)` only matched
        // non-empty paths, which left the root page (`/app` after basePath
        // stripping) without the security headers.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            // Always 'none' here, including for shop pages. headers() is
            // evaluated at BUILD time and frozen into routes-manifest.json, so
            // it cannot see the deployment's embed allow-list. proxy.ts widens
            // this per request for /shop/* — and because this stays restrictive,
            // a middleware that fails to run leaves the page unframeable rather
            // than open.
            value: buildCsp("'none'"),
          },
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
          // X-Frame-Options is deliberately absent. It is DENY-or-nothing —
          // ALLOW-FROM is dead — so sending DENY would override the
          // frame-ancestors allow-list on shop pages and block the embed with
          // nothing in the CSP to explain why. Any browser too old for
          // frame-ancestors is also too old for WebGL.
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
