// Kubernetes readiness + liveness probe endpoint.
// Returns 200 with a small JSON body. Excluded from the static export build
// (route handlers don't run on GH Pages).

export const dynamic = "force-static";

export function GET() {
  return Response.json({ status: "ok" });
}
