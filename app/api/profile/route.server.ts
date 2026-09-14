// Per-user settings: the stocked fabric list, plus API key metadata.
// Named `route.server.ts` so the static export's pageExtensions filter skips it
// (see next.config.ts). Resolves to /app/api/profile in the standalone build.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { ensureUserProfile, setFabrics } from "@/lib/db/users";
import { FabricValidationError, validateFabrics } from "@/lib/fabrics";

export const dynamic = "force-dynamic";

/**
 * Body cap, enforced before parsing. Nothing else in the app limits request
 * size, and validateFabrics() only runs after req.json() has already
 * materialized the whole payload into memory. 64 KB is generous for a list
 * bounded at 60 entries.
 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * CSRF: no token here, matching the existing designs routes. These are
 * cookie-authenticated, but Auth.js v5 sets the session cookie SameSite=Lax,
 * which excludes cross-site PUT, and the application/json content type forces a
 * preflight this app never answers. Both are load-bearing — if the cookie ever
 * moves to SameSite=None, this route needs a real CSRF token.
 */
async function resolveUser(): Promise<
  | { kind: "ok"; userSub: string; email: string | null }
  | { kind: "err"; res: NextResponse }
> {
  if (!isDbEnabled()) {
    return {
      kind: "err",
      res: NextResponse.json({ error: "db_disabled" }, { status: 503 }),
    };
  }
  const session = await auth();
  const userSub = getCurrentUserSub(session);
  if (!userSub) {
    return {
      kind: "err",
      res: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { kind: "ok", userSub, email: session?.user?.email ?? null };
}

export async function GET() {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;
  const profile = await ensureUserProfile(r.userSub, r.email);
  return NextResponse.json({ profile });
}

export async function PUT(req: Request) {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "body_too_large" }, { status: 413 });
  }

  let body: { fabrics?: unknown };
  try {
    body = (await req.json()) as { fabrics?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let fabrics;
  try {
    fabrics = validateFabrics(body.fabrics);
  } catch (err) {
    if (err instanceof FabricValidationError) {
      return NextResponse.json(
        { error: "invalid_fabrics", detail: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  // Creates the row first if this is the user's very first write.
  await ensureUserProfile(r.userSub, r.email);
  const profile = await setFabrics(r.userSub, fabrics);
  if (!profile) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ profile });
}
