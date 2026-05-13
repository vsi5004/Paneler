import "server-only";
import type { Session } from "next-auth";

// Sentinel user_sub used in dev mode without auth. Every design created in
// this mode is scoped to the same fixed identity so the RLS path still
// exercises end-to-end.
export const DEV_LOCAL_SUB = "dev-local";

/**
 * True when the app should run with Postgres-backed persistence — DATABASE_URL
 * is set, and we're not building the static GH Pages export. Used by both the
 * server (page.tsx, route handlers) and the boot hook in instrumentation.ts.
 */
export function isDbEnabled(): boolean {
  if (process.env.STATIC_EXPORT === "1") return false;
  return !!process.env.DATABASE_URL;
}

/**
 * Returns the OIDC subject we'll scope this request to, or null if the
 * caller should be rejected (401). Three cases:
 *
 *   - AUTH_DISABLED=true        → dev mode; everyone is `dev-local`.
 *   - signed-in session present → use session.user.id (= token.sub).
 *   - otherwise                 → null (no identity to scope on).
 */
export function getCurrentUserSub(session: Session | null): string | null {
  if (process.env.AUTH_DISABLED === "true") {
    return DEV_LOCAL_SUB;
  }
  const id = session?.user?.id;
  return id && id.length > 0 ? id : null;
}
