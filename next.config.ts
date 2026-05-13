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

// Absolute path for the webpack alias (webpack requires absolute paths).
// Turbopack uses the @/ specifier directly so it bundles the stub as a normal
// project module rather than externalising it as a runtime require().
const authActionsStubAbs = path.resolve("./lib/auth-actions-stub");

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
  ...(isStaticExport
    ? {
        output: "export",
        images: { unoptimized: true },
        // Swap auth-actions.ts for a no-op stub so the "use server" file never
        // enters the build graph and the serverActionsManifest stays empty.
        // See lib/auth-actions-stub.ts and PLAN.md for the full rationale.
        turbopack: {
          resolveAlias: {
            "@/lib/auth-actions": "@/lib/auth-actions-stub",
          },
        },
        webpack: (config: { resolve: { alias: Record<string, string> } }) => {
          config.resolve.alias["@/lib/auth-actions"] = authActionsStubAbs;
          return config;
        },
      }
    : {
        output: "standalone",
      }),
};

export default nextConfig;
