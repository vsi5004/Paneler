// Readiness probe. Returns 200 only when migrations are done (or the app
// is running in files-only mode and migrations aren't needed). A stuck
// migration keeps the pod un-ready so ArgoCD/k8s holds the old replica
// serving traffic.

import { isDbEnabled } from "@/lib/dbMode";
import { getMigrationStatus } from "@/lib/db/migrate";

export const dynamic = "force-dynamic";

export function GET() {
  if (!isDbEnabled()) {
    return Response.json({ status: "ready", db: false });
  }
  const status = getMigrationStatus();
  if (status.state === "ready") {
    return Response.json({ status: "ready", db: true });
  }
  if (status.state === "error") {
    return Response.json(
      { status: "error", message: status.message },
      { status: 503 },
    );
  }
  return Response.json({ status: "pending" }, { status: 503 });
}
