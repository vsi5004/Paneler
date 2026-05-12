import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for three.js in App Router — drei and other ecosystem packages ship
  // un-transpiled ESM that can't be statically analyzed by Next's bundler.
  transpilePackages: ["three"],
};

export default nextConfig;
