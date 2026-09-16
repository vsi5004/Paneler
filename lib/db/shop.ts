import "server-only";

import { withPublicSession } from "@/lib/db/client";
import { resolveFabrics } from "@/lib/fabrics";
import type { FabricEntry, OrderItem, PublicShop } from "@/lib/types";

/**
 * The only module in the app that reads another user's data.
 *
 * It is small on purpose, and it is the whole reason `paneler_public` exists:
 * the shop pages render before anyone signs in, so there is no `app.user_sub`
 * to scope RLS with. Every query here runs through `withPublicSession`, which
 * sets no GUC — so the `TO paneler_public` policies are the only doors open,
 * and this role's column-level grants mean `email` and `api_key_hash` are not
 * merely filtered but unreachable.
 *
 * Both functions return purpose-built shapes rather than rows, so nothing can
 * leak by accident through a widened SELECT later.
 */

interface ShopRow {
  user_sub: string;
  shop_id: string;
  display_name: string | null;
  avatar_key: string | null;
  fabrics: FabricEntry[];
  fill_materials: string[];
}

/** Null when the shop doesn't exist OR isn't published — the caller 404s either
 *  way, and deliberately cannot tell the difference. */
export async function getPublicShop(
  shopId: string,
): Promise<PublicShop | null> {
  return withPublicSession(async (client) => {
    const { rows } = await client.query<ShopRow>(
      `SELECT user_sub, shop_id, display_name, avatar_key, fabrics,
              fill_materials
         FROM users WHERE shop_id = $1`,
      [shopId],
    );
    const shop = rows[0];
    if (!shop) return null;

    // Filter by owner: paneler_public can see every published item in the
    // database, so the shop scoping is this WHERE clause, not the policy.
    const { rows: items } = await client.query<OrderItem>(
      `SELECT id, design_id, title, description, sizes, position, published
         FROM order_items
        WHERE user_sub = $1
        ORDER BY position, created_at`,
      [shop.user_sub],
    );

    return {
      shopId: shop.shop_id,
      displayName: shop.display_name ?? "Shop",
      hasAvatar: shop.avatar_key !== null,
      fillMaterials: shop.fill_materials ?? [],
      fabrics: resolveFabrics(shop.fabrics ?? []),
      items,
    };
  });
}

export interface PublicItem {
  item: OrderItem;
  /** The stitcher, for the order insert. Never sent to the browser. */
  stitcherSub: string;
  /** R2 key of the pinned design, for minting a presigned GET. */
  glbKey: string;
  panelCount: number | null;
}

/**
 * One item, scoped to its shop.
 *
 * The shopId argument is not decoration: without it a published item id from
 * any shop would resolve here, since paneler_public can read all of them.
 */
export async function getPublicItem(
  shopId: string,
  itemId: string,
): Promise<PublicItem | null> {
  return withPublicSession(async (client) => {
    const { rows } = await client.query<
      OrderItem & { user_sub: string; glb_key: string; panel_count: number | null }
    >(
      `SELECT i.id, i.design_id, i.title, i.description, i.sizes, i.position,
              i.published, i.user_sub, d.glb_key, d.panel_count
         FROM order_items i
         JOIN users u ON u.user_sub = i.user_sub
         JOIN designs d ON d.id = i.design_id
        WHERE i.id = $1 AND u.shop_id = $2`,
      [itemId, shopId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      item: {
        id: r.id,
        design_id: r.design_id,
        title: r.title,
        description: r.description,
        sizes: r.sizes,
        position: r.position,
        published: r.published,
      },
      stitcherSub: r.user_sub,
      glbKey: r.glb_key,
      panelCount: r.panel_count,
    };
  });
}
