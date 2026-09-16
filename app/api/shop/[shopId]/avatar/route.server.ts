// Serve a shop's photo, same-origin and public.
//
// Not a presigned R2 redirect, for two reasons: CSP is `img-src 'self'`
// (next.config.ts), and a presigned URL expires, which would rot inside any
// cached page. Avatars are capped at 256px webp so the bytes through the pod
// are negligible.

import { NextResponse } from "next/server";

import { isDbEnabled } from "@/lib/dbMode";
import { getPublicShop } from "@/lib/db/shop";
import { avatarKey, getObjectBytes } from "@/lib/r2/client";
import { withPublicSession } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shopId: string }> },
) {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "db_disabled" }, { status: 503 });
  }
  const { shopId } = await params;

  const shop = await getPublicShop(shopId);
  if (!shop || !shop.hasAvatar) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // getPublicShop deliberately does not expose user_sub, so resolve the key in
  // its own scoped read rather than widening that shape for one caller.
  const sub = await withPublicSession(async (client) => {
    const { rows } = await client.query<{ user_sub: string }>(
      `SELECT user_sub FROM users WHERE shop_id = $1`,
      [shopId],
    );
    return rows[0]?.user_sub ?? null;
  });
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bytes = await getObjectBytes(avatarKey(sub));
  if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      // Hardcoded, never echoed from what was stored. Paired with the global
      // X-Content-Type-Options: nosniff, this is what keeps an uploaded object
      // from ever being interpreted as anything but an image.
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
