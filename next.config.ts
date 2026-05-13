import path from "path";
import type { NextConfig } from "next";

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
const dbMigrateStubAbs = path.resolve("./lib/db/migrate-stub");

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
            "@/lib/db/migrate": "@/lib/db/migrate-stub",
          },
        },
        webpack: (config: { resolve: { alias: Record<string, string> } }) => {
          config.resolve.alias["@/lib/auth-actions"] = authActionsStubAbs;
          config.resolve.alias["@/lib/db/client"] = dbClientStubAbs;
          config.resolve.alias["@/lib/db/designs"] = dbDesignsStubAbs;
          config.resolve.alias["@/lib/db/migrate"] = dbMigrateStubAbs;
          return config;
        },
      }
    : {
        output: "standalone",
      }),
};

export default nextConfig;
