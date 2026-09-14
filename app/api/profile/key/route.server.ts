// Mint or rotate the account's API key. One key per account.
//
// The plaintext is returned exactly once, here, and never stored — only its
// SHA-256 goes to the database. Regenerating is the only recovery path for a
// lost key, which is why rotateApiKey() keeps the previous hash alive for 24
// hours rather than cutting a live site off the instant the button is clicked.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCurrentUserSub, isDbEnabled } from "@/lib/dbMode";
import { ensureUserProfile, rotateApiKey } from "@/lib/db/users";
import { generateApiKey, hashApiKey } from "@/lib/apiKey";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "db_disabled" }, { status: 503 });
  }
  const session = await auth();
  const userSub = getCurrentUserSub(session);
  if (!userSub) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await ensureUserProfile(userSub, session?.user?.email ?? null);

  const key = generateApiKey();
  const ok = await rotateApiKey(userSub, hashApiKey(key));

  // rotateApiKey's WHERE clause carries `AND api_key_enabled`, so no rows
  // updated means the account isn't permitted a key. This is the enforcement
  // point — the profile page hiding the section is presentation, not access
  // control. The flag is granted by hand as the DB owner; schema.sql revokes
  // the column from the runtime role so the app cannot grant it to itself.
  if (!ok) {
    return NextResponse.json({ error: "key_not_enabled" }, { status: 403 });
  }

  const profile = await ensureUserProfile(userSub, session?.user?.email ?? null);
  return NextResponse.json({ key, profile });
}
