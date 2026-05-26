// Next.js calls register() once at server startup. We use it to kick off
// schema migration before the readiness probe flips to 200.
//
// Guards:
//   - STATIC_EXPORT=1 → no server, instrumentation never runs at runtime
//     (but be defensive; aliased to the migrate stub at build time too).
//   - DATABASE_URL unset → app is files-only; no migration to run.
//
// The import is dynamic so the static-export bundle never statically
// references pg. The static-export branch of next.config.ts also aliases
// @/lib/db/migrate to a no-op stub — belt and suspenders.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.STATIC_EXPORT === "1") return;
  if (!process.env.DATABASE_URL) return;
  const { startMigration } = await import("@/lib/db/migrate");
  // Fire-and-forget; readiness probe (app/api/health/ready) reflects status.
  startMigration();
}
