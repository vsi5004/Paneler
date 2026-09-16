// A stitcher's order items: the things their shop offers.
// See next.config.ts for why this is named route.server.ts.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { createItem, listItems } from "@/lib/db/orderItems";
import { getDesign } from "@/lib/db/designs";
import { getUserProfile } from "@/lib/db/users";
import { MAX_ITEMS, OrderFormError, validateItem } from "@/lib/orderForm";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUser(): Promise<
  { kind: "ok"; userSub: string } | { kind: "err"; res: NextResponse }
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
  return { kind: "ok", userSub };
}

export async function GET() {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;
  return NextResponse.json({ items: await listItems(r.userSub) });
}

export async function POST(req: Request) {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;

  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "body_too_large" }, { status: 413 });
  }

  let body: { designId?: unknown; item?: unknown };
  try {
    body = (await req.json()) as { designId?: unknown; item?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.designId !== "string" || !UUID_RE.test(body.designId)) {
    return NextResponse.json({ error: "invalid_design_id" }, { status: 400 });
  }
  // RLS would reject a foreign design as a constraint violation anyway, but
  // that surfaces as a 500. Resolving it first turns someone else's id into an
  // honest 404.
  if (!(await getDesign(r.userSub, body.designId))) {
    return NextResponse.json({ error: "design_not_found" }, { status: 404 });
  }

  const existing = await listItems(r.userSub);
  if (existing.length >= MAX_ITEMS) {
    return NextResponse.json(
      { error: "too_many_items", detail: `max ${MAX_ITEMS}` },
      { status: 400 },
    );
  }

  let input;
  try {
    input = validateItem(body.item);
  } catch (err) {
    if (err instanceof OrderFormError) {
      return NextResponse.json(
        { error: "invalid_item", detail: err.message },
        { status: 400 },
      );
    }
    throw err;
  }


  // An item may only go live if the shop is live. setShop() already enforces
  // the other direction (taking a shop offline unpublishes its items), which is
  // what lets order_items_public_read gate on `published` alone without a
  // cross-table EXISTS that RLS would hide. Without this, that invariant held
  // in one direction only: the UI disabled the checkbox but the API did not.
  if (input.published) {
    const profile = await getUserProfile(r.userSub);
    if (!profile?.shopPublished) {
      return NextResponse.json(
        {
          error: "shop_not_live",
          detail: "Make your shop live before publishing an item.",
        },
        { status: 400 },
      );
    }
  }

  const item = await createItem(r.userSub, body.designId, input);
  if (!item) {
    return NextResponse.json({ error: "not_created" }, { status: 500 });
  }
  return NextResponse.json({ item }, { status: 201 });
}
