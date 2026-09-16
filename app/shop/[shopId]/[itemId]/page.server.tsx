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
  searchParams,
}: {
  params: Promise<{ shopId: string; itemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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
  // ?embed=1 is how a stitcher's own checkout renders this in an iframe. The
  // embedded form asks for no contact details - their checkout already collects
  // those - and hands the reference back to the parent page instead of being
  // the end of the journey.
  const { embed, theme } = await searchParams;
  const embedded = embed === "1";
  // Light is opt-in per URL rather than tied to embed: a stitcher may want it
  // on the standalone link too, and someone embedding into a dark site should
  // not be forced out of the app's own theme.
  const light = theme === "light";

  // Read at request time, not baked at build: this is a runtime env var on the
  // pod. Passed down rather than exposed as NEXT_PUBLIC_* so there is exactly
  // one source of truth shared with the frame-ancestors list in next.config.ts.
  const allowedParents = (process.env.EMBED_ALLOWED_ORIGINS ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);

  return (
    <OrderDesigner
      shop={shop}
      item={found.item}
      embedded={embedded}
      light={light}
      allowedParents={allowedParents}
    />
  );
}
