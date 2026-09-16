/**
 * The app's Content-Security-Policy, in one place.
 *
 * Shared by next.config.ts and proxy.ts because BOTH have to emit it, and a
 * second copy would drift: a header set in middleware replaces the one from
 * next.config entirely rather than merging with it, so the middleware path has
 * to repeat every directive or shop pages silently lose script-src, img-src and
 * the rest while appearing to have a CSP.
 *
 * Why middleware emits it at all: next.config's headers() is evaluated during
 * `next build` and frozen into routes-manifest.json, so it cannot read a
 * runtime env var. The embed allow-list is deployment configuration, so it has
 * to be applied per request.
 */

/** Everything except frame-ancestors, which varies by route. */
const DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // Google avatar URLs come from several googleusercontent subdomains. blob:
  // covers OBJ-upload preview thumbnails; data: covers small inline images.
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com",
  "font-src 'self' data:",
  // R2 presigned URLs for GLB download go straight from the browser to
  // Cloudflare R2, bypassing the pod.
  "connect-src 'self' blob: https://*.r2.cloudflarestorage.com",
  "base-uri 'self'",
  "object-src 'none'",
];

/**
 * @param frameAncestors e.g. "'none'" or "https://example.com https://www.example.com"
 */
export function buildCsp(frameAncestors: string): string {
  return [...DIRECTIVES, `frame-ancestors ${frameAncestors}`].join("; ");
}

/**
 * Parse EMBED_ALLOWED_ORIGINS into a frame-ancestors value.
 *
 * Returns "'none'" for anything empty or unset, so a missing or malformed
 * setting fails closed rather than leaving a page framable.
 */
export function frameAncestorsFromEnv(raw: string | undefined): string {
  const origins = (raw ?? "").split(/[\s,]+/).filter(Boolean);
  return origins.length > 0 ? origins.join(" ") : "'none'";
}
