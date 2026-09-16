// Place an order. The one cross-account write in the app: the row it creates is
// owned by the STITCHER, not by the signed-in customer who submits it.
//
// See next.config.ts for why this is named route.server.ts.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { createOrderDesign } from "@/lib/db/designs";
import { getPublicItem } from "@/lib/db/shop";
import { OrderFormError, validateOrder } from "@/lib/orderForm";
import { deleteObject, designKey, putObject } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

/**
 * A 32-panel ball serializes to a few hundred KB. 8 MB is far above any real
 * design and far below anything that threatens the pod.
 */
const MAX_GLB_BYTES = 8 * 1024 * 1024;

/**
 * Rate limit, in process.
 *
 * This is the first endpoint in Paneler where one user writes into another's
 * account, so it is the first that can be used to bury someone: an unbounded
 * customer could fill a stitcher's design list and their R2 bucket, and the
 * only cleanup is deleting rows by hand.
 *
 * Deliberately NOT counted in the database. The insert lands in the stitcher's
 * account, so a counting query in the customer's session is hidden by
 * designs_isolate and would silently return zero — a rate limit that looks
 * present and enforces nothing. The database alternatives are both worse than
 * the problem: a policy letting customers read order rows would surface them in
 * the customer's own design list, and counting as the stitcher would hand the
 * app a read-anyone primitive for the sake of a counter.
 *
 * What this is: per pod, lost on restart, and not shared across replicas. That
 * stops a script hammering the endpoint, which is the realistic abuse. It would
 * not stop a determined attacker timing requests around a deploy — if that ever
 * matters, the answer is a real shared limiter, not a fake DB one.
 */
const MAX_ORDERS_PER_HOUR = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const recentOrders = new Map<string, number[]>();

function rateLimited(customerSub: string, itemId: string): boolean {
  const key = `${customerSub}:${itemId}`;
  const now = Date.now();
  const hits = (recentOrders.get(key) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  if (hits.length >= MAX_ORDERS_PER_HOUR) {
    recentOrders.set(key, hits);
    return true;
  }
  hits.push(now);
  recentOrders.set(key, hits);
  // Bound the map: without this it grows one entry per (customer, item) pair
  // forever, which is a slow leak on a long-lived pod.
  if (recentOrders.size > 5000) {
    for (const [k, v] of recentOrders) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) recentOrders.delete(k);
    }
  }
  return false;
}

export async function POST(req: Request) {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "db_disabled" }, { status: 503 });
  }
  const session = await auth();
  const customerSub = getCurrentUserSub(session);
  if (!customerSub) {
    // The order form is public; only submitting requires an account.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const file = form.get("glb");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_glb" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_GLB_BYTES) {
    return NextResponse.json({ error: "glb_too_large" }, { status: 413 });
  }

  const shopId = form.get("shopId");
  if (typeof shopId !== "string") {
    return NextResponse.json({ error: "missing_shop" }, { status: 400 });
  }

  let order;
  try {
    order = validateOrder(JSON.parse(String(form.get("order") ?? "{}")));
  } catch (err) {
    if (err instanceof OrderFormError) {
      return NextResponse.json(
        { error: "invalid_order", detail: err.message },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_order" }, { status: 400 });
  }

  // Resolves through paneler_public, so an unpublished item — or a published
  // item whose shop is unpublished, since the join to users is itself filtered
  // by users_public_read — comes back null and 404s. The stitcher is learned
  // here and never taken from the request body.
  const found = await getPublicItem(shopId, order.itemId);
  if (!found || !found.item.published) {
    return NextResponse.json({ error: "item_not_found" }, { status: 404 });
  }
  if (!found.item.sizes.some((s) => Math.abs(s - order.size) < 1e-6)) {
    return NextResponse.json({ error: "size_not_offered" }, { status: 400 });
  }

  if (rateLimited(customerSub, order.itemId)) {
    return NextResponse.json(
      { error: "rate_limited", detail: "Try again in an hour." },
      { status: 429 },
    );
  }

  // The id is minted here so the R2 key can be derived before upload, and it
  // doubles as the order's name — one identifier for the row, the object, the
  // reference the customer quotes, and any future /o/{id} lookup.
  const id = randomUUID();
  const key = designKey(id);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { etag, size } = await putObject(key, bytes);

  try {
    await createOrderDesign(customerSub, {
      id,
      stitcherSub: found.stitcherSub,
      itemId: order.itemId,
      customerEmail: session?.user?.email ?? null,
      glbKey: key,
      name: id,
      fill: order.fill,
      note: order.note || null,
      panelCount: found.panelCount,
      glbEtag: etag?.replace(/"/g, "") ?? null,
      glbSizeBytes: size,
    });
  } catch (err) {
    // Bytes land before the row so the row can carry their etag. If the insert
    // is refused — designs_order_insert re-checks the item in SQL — drop the
    // object rather than leaving it orphaned.
    await deleteObject(key).catch(() => {});
    throw err;
  }

  return NextResponse.json({ id }, { status: 201 });
}
