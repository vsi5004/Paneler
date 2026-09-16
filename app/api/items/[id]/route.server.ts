// Update or remove one order item. RLS scopes both to the owner.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { deleteItem, updateItem } from "@/lib/db/orderItems";
import { getUserProfile } from "@/lib/db/users";
import { OrderFormError, validateItem } from "@/lib/orderForm";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

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

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;

  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "body_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let input;
  try {
    input = validateItem((body as { item?: unknown }).item);
  } catch (err) {
    if (err instanceof OrderFormError) {
      return NextResponse.json(
        { error: "invalid_item", detail: err.message },
        { status: 400 },
      );
    }
    throw err;
  }


  // Same shop-must-be-live rule as POST /api/items; see the comment there.
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

  const { id } = await params;
  const item = await updateItem(r.userSub, id, input);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await resolveUser();
  if (r.kind === "err") return r.res;
  const { id } = await params;
  const ok = await deleteItem(r.userSub, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
