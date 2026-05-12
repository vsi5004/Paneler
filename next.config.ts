import type { NextConfig } from "next";

// Two build modes:
//   default          → Node.js server output (.next/standalone) for the
//                      container deploy at paneler.app/app.
//   STATIC_EXPORT=1  → Static HTML export (.out/) for the Phase 2 GitHub
//                      Pages preview at vsi5004.github.io/Paneler. The
//                      auth proxy isn't included in static builds, so the
//                      preview ships fully open.
const isStaticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  // three.js is published as ESM and Drei pulls in un-transpiled paths the
  // Next bundler can't statically analyze otherwise.
  transpilePackages: ["three"],
  ...(isStaticExport
    ? {
        output: "export",
        images: { unoptimized: true },
        basePath: "/Paneler",
      }
    : {
        output: "standalone",
      }),
};

export default nextConfig;
