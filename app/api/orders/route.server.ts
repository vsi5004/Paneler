// Place an order.
//
// PUBLIC and unauthenticated: a stitcher's customer should not need a Paneler
// account to buy a footbag, and requiring one was the single biggest source of
// friction and of machinery in this feature.
//
// Nothing is stored. The email IS the order - the stitcher already owns the
// design and its laser templates, so all they are missing is the customisation.
// That also means no order history accumulates in Postgres or R2.
//
// See next.config.ts for why this is named route.server.ts.

import { NextResponse } from "next/server";

import { isDbEnabled } from "@/lib/dbMode";
import { getPublicItem, getPublicShop, getShopNotifyEmail } from "@/lib/db/shop";
import { isMailEnabled, sendMail } from "@/lib/email";
import { composeOrderEmail, generateOrderRef } from "@/lib/orderEmail";
import { OrderFormError, validateOrder } from "@/lib/orderForm";
import { checkSubmission, clientKey, fingerprintOrder } from "@/lib/orderAbuse";

export const dynamic = "force-dynamic";

/**
 * One animated GIF of the ball turning, rendered in the customer's browser.
 * 400px x 24 frames lands in the hundreds of KB; 8 MB is far above any real
 * one and still far below anything that troubles the pod.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

/**
 * CSRF is not a concern here in the usual sense: there is no session and no
 * privileged action to ride on. The endpoint's own abuse controls (IP rate
 * limit, duplicate rejection) are what bound it, plus the fact that an order's
 * destination is fixed by the item - a submission can only ever reach the
 * stitcher who published it, never an address of the sender's choosing.
 */

export async function POST(req: Request) {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "db_disabled" }, { status: 503 });
  }
  // Checked before any work: with nothing stored, a send we cannot make is an
  // order that silently never existed.
  if (!isMailEnabled()) {
    return NextResponse.json({ error: "mail_unavailable" }, { status: 503 });
  }

  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "body_too_large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
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

  const [shop, found] = await Promise.all([
    getPublicShop(shopId),
    getPublicItem(shopId, order.itemId),
  ]);
  if (!shop || !found || !found.item.published) {
    return NextResponse.json({ error: "item_not_found" }, { status: 404 });
  }
  if (!found.item.sizes.some((s) => Math.abs(s - order.size) < 1e-6)) {
    return NextResponse.json({ error: "size_not_offered" }, { status: 400 });
  }

  // Anonymous, so the client IP is the only handle there is.
  const verdict = checkSubmission(clientKey(req.headers), fingerprintOrder(order));
  if (!verdict.ok) {
    return verdict.reason === "duplicate"
      ? NextResponse.json(
          { error: "duplicate", detail: "That exact order has already been sent." },
          { status: 409 },
        )
      : NextResponse.json(
          { error: "rate_limited", detail: "Try again in an hour." },
          { status: 429 },
        );
  }

  const to = await getShopNotifyEmail(shopId);
  if (!to) {
    return NextResponse.json({ error: "shop_unreachable" }, { status: 503 });
  }

  const attachments = [];
  const animation = form.get("animation");
  if (
    animation instanceof File &&
    animation.size > 0 &&
    animation.size <= MAX_IMAGE_BYTES
  ) {
    attachments.push({
      filename: "design.gif",
      content: Buffer.from(await animation.arrayBuffer()),
      contentType: "image/gif",
    });
  }

  const ref = generateOrderRef();
  const { subject, text } = composeOrderEmail({
    ref,
    hasAnimation: attachments.length > 0,
    shopName: shop.displayName,
    itemTitle: found.item.title,
    size: order.size,
    fill: order.fill,
    note: order.note,
    contact: order.contact,
    panelColors: order.panelColors,
    fabrics: shop.fabrics,
  });

  // Not caught. A failed send must reach the customer as an error: with no row
  // behind it, showing them a reference for an order that never arrived is the
  // worst outcome available.
  await sendMail({ to, subject, text, attachments });

  return NextResponse.json({ ref }, { status: 201 });
}
