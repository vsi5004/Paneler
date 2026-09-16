// Per-user settings: the stocked fabric list, plus API key metadata.
// Named `route.server.ts` so the static export's pageExtensions filter skips it
// (see next.config.ts). Resolves to /app/api/profile in the standalone build.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { ensureUserProfile, setFabrics, setShop } from "@/lib/db/users";
import { FabricValidationError, validateFabrics } from "@/lib/fabrics";
import { OrderFormError, validateShop } from "@/lib/orderForm";
import { generateShopId } from "@/lib/apiKey";

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

  let body: { fabrics?: unknown; shop?: unknown };
  try {
    body = (await req.json()) as { fabrics?: unknown; shop?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Both sections are optional so the page can save whichever changed, but at
  // least one must be present — an empty PUT is a caller bug worth surfacing.
  if (body.fabrics === undefined && body.shop === undefined) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  // Creates the row first if this is the user's very first write.
  await ensureUserProfile(r.userSub, r.email);
  let profile = null;

  if (body.fabrics !== undefined) {
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
    profile = await setFabrics(r.userSub, fabrics);
  }

  if (body.shop !== undefined) {
    let shop;
    try {
      shop = validateShop(body.shop);
    } catch (err) {
      if (err instanceof OrderFormError) {
        return NextResponse.json(
          { error: "invalid_shop", detail: err.message },
          { status: 400 },
        );
      }
      throw err;
    }
    // A candidate id is always supplied; setShop COALESCEs it away unless the
    // row has none yet, so an existing shop_id is never disturbed and links
    // already pasted in public keep working.
    profile = await setShop(r.userSub, {
      ...shop,
      candidateShopId: generateShopId(),
    });
  }

  if (!profile) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ profile });
}
