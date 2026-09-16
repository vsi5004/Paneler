import { connection } from "next/server";
import { notFound } from "next/navigation";

import { isDbEnabled } from "@/lib/dbMode";
import { getPublicItem, getPublicShop } from "@/lib/db/shop";
import { OrderDesigner } from "@/components/paneler/OrderDesigner";

// PUBLIC, like the shop page above, and so is POST /api/orders - ordering
// requires no account at all. The order is emailed to the stitcher rather than
// stored, so there is no row to own and nobody to attribute it to but the
// reference the customer is given.

export const dynamic = "force-dynamic";

export default async function OrderRoute({
  params,
}: {
  params: Promise<{ shopId: string; itemId: string }>;
}) {
  await connection();
  if (!isDbEnabled()) notFound();

  const { shopId, itemId } = await params;
  const [shop, found] = await Promise.all([
    getPublicShop(shopId),
    getPublicItem(shopId, itemId),
  ]);
  if (!shop || !found || !found.item.published) notFound();
  if (found.item.sizes.length === 0) notFound();

  // No session is read at all. Ordering is anonymous: a stitcher's customer
  // should not need a Paneler account to buy a footbag, and requiring one was
  // the single biggest source of friction in this flow.
  return <OrderDesigner shop={shop} item={found.item} />;
}
