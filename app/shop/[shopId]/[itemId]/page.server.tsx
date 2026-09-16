import { connection } from "next/server";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { getPublicItem, getPublicShop } from "@/lib/db/shop";
import { OrderDesigner } from "@/components/paneler/OrderDesigner";

// PUBLIC, like the shop page above. The customer designs without an account;
// only POST /api/orders requires one, which is why that route is NOT in the
// proxy.ts exclusion list while these pages are.

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

  // Read the session only to decide the button's wording. A missing session is
  // not an error here — it's the expected first visit.
  const session = await auth();
  const signedIn = getCurrentUserSub(session) !== null;

  return <OrderDesigner shop={shop} item={found.item} signedIn={signedIn} />;
}
