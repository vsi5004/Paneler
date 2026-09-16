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
import {
  checkSubmission,
  clientKey,
  fingerprintOrder,
} from "@/lib/orderAbuse";
import { deleteObject, designKey, putObject } from "@/lib/r2/client";

export const dynamic = "force-dynamic";

/**
 * CSRF: this route is multipart, which is a CORS "simple request" — unlike the
 * JSON routes it triggers no preflight, so the content-type half of the defense
 * described in app/api/profile/route.server.ts does NOT apply here. What remains
 * is Auth.js's SameSite=Lax session cookie, which browsers withhold on
 * cross-site POST, so a forged submission arrives with no session and 401s.
 *
 * That is one layer, not two. If the cookie ever moves to SameSite=None this
 * route needs a real CSRF token before the JSON ones do.
 */

/**
 * A 32-panel ball serializes to a few hundred KB. 8 MB is far above any real
 * design and far below anything that threatens the pod.
 */
const MAX_GLB_BYTES = 8 * 1024 * 1024;

/**
 * Multipart overhead on top of the file itself: part headers and boundaries.
 * 64 KB is generous for the three small fields this request carries.
 */
const MAX_BODY_BYTES = MAX_GLB_BYTES + 64 * 1024;

/**
 * A GLB starts with the ASCII magic "glTF" and a little-endian version.
 *
 * These bytes are written into the STITCHER's account and later parsed by
 * GLTFLoader in the stitcher's browser, so "whatever the customer sent" is not
 * an acceptable content contract — a malformed file breaks their designer, and
 * they have no way to tell it apart from a design they made themselves. This
 * mirrors the isWebp() check the avatar route already does.
 *
 * It is a shape check, not a safety proof: a well-formed GLB can still contain
 * nonsense. CSP (connect-src 'self' plus R2) is what stops a crafted glTF
 * fetching anything external.
 */
function isGlb(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
  return magic === "glTF" && view.getUint32(4, true) === 2;
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

  // BEFORE parsing. req.formData() buffers the entire body into memory, so a
  // size check afterwards has already paid the cost it is meant to avoid. The
  // JSON routes do this too; the multipart ones originally did not.
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "body_too_large" }, { status: 413 });
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

  // Keyed on the signed-in subject where there is one, falling back to the
  // client IP. The fallback is not dead code: this route is moving to anonymous
  // submission, where the IP is the only handle there is.
  const verdict = checkSubmission(
    customerSub ?? clientKey(req.headers),
    fingerprintOrder(order),
  );
  if (!verdict.ok) {
    return verdict.reason === "duplicate"
      ? NextResponse.json(
          {
            error: "duplicate",
            detail: "That exact order has already been sent.",
          },
          { status: 409 },
        )
      : NextResponse.json(
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
  if (!isGlb(bytes)) {
    return NextResponse.json({ error: "not_a_glb" }, { status: 400 });
  }
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
