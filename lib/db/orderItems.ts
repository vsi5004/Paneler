import "server-only";

import { withUserSession } from "@/lib/db/client";
import type { ItemInput } from "@/lib/orderForm";
import type { OrderItem } from "@/lib/types";

/** Columns backing OrderItem. user_sub is deliberately not among them. */
const ITEM_COLUMNS = `
  id, design_id, title, description, sizes, position, published
`;

/**
 * A stitcher's items, in display order.
 *
 * No WHERE clause: order_items_isolate is the filter, the same convention as
 * listDesigns. Ordering by position then created_at keeps newly added items
 * (all position 0 until reordered) in a stable, predictable place.
 */
export async function listItems(userSub: string): Promise<OrderItem[]> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<OrderItem>(
      `SELECT ${ITEM_COLUMNS} FROM order_items
        ORDER BY position, created_at`,
    );
    return rows;
  });
}

/**
 * Pin a new item to one of the stitcher's designs.
 *
 * `designId` is not validated against their designs here and does not need to
 * be: the FK requires the row to exist, and designs_isolate means a design
 * belonging to someone else is unresolvable from this session, so a foreign id
 * fails as a constraint violation rather than silently succeeding.
 */
export async function createItem(
  userSub: string,
  designId: string,
  input: ItemInput,
): Promise<OrderItem | null> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<OrderItem>(
      `INSERT INTO order_items
         (user_sub, design_id, title, description, sizes, published, position)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6,
               COALESCE((SELECT max(position) + 1 FROM order_items), 0))
       RETURNING ${ITEM_COLUMNS}`,
      [
        userSub,
        designId,
        input.title,
        input.description,
        JSON.stringify(input.sizes),
        input.published,
      ],
    );
    return rows[0] ?? null;
  });
}

export async function updateItem(
  userSub: string,
  id: string,
  input: ItemInput,
): Promise<OrderItem | null> {
  return withUserSession(userSub, async (client) => {
    const { rows } = await client.query<OrderItem>(
      `UPDATE order_items
          SET title = $2, description = $3, sizes = $4::jsonb,
              published = $5, updated_at = now()
        WHERE id = $1
       RETURNING ${ITEM_COLUMNS}`,
      [
        id,
        input.title,
        input.description,
        JSON.stringify(input.sizes),
        input.published,
      ],
    );
    return rows[0] ?? null;
  });
}

export async function deleteItem(userSub: string, id: string): Promise<boolean> {
  return withUserSession(userSub, async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM order_items WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}
