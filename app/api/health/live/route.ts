// Liveness probe. Returns 200 as long as the Node process is running.
// MUST stay independent of migration status — gating liveness on migrations
// would crash-loop the pod while the DB bootstraps.

export const dynamic = "force-static";

export function GET() {
  return Response.json({ status: "alive" });
}
