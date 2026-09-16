// 302 to a presigned R2 GET for the design an order item is pinned to.
//
// Public: this is the geometry the customer is about to recolor, and the order
// form renders before anyone signs in. Reached only through paneler_public, so
// an unpublished item — or one whose shop is unpublished — 404s.

import { NextResponse } from "next/server";

import { isDbEnabled } from "@/lib/dbMode";
import { getPublicItem } from "@/lib/db/shop";
import { presignedGetUrl } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shopId: string; itemId: string }> },
) {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "db_disabled" }, { status: 503 });
  }
  const { shopId, itemId } = await params;
  const found = await getPublicItem(shopId, itemId);
  if (!found || !found.item.published) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.redirect(await presignedGetUrl(found.glbKey), 302);
}
