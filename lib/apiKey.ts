import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// -----------------------------------------------------------------------------
// API keys. One per account, minted on demand, shown to the user exactly once.
//
// Only the hash is ever stored. There is no recovery path for a lost key —
// regenerating is the recovery path, which is why the rotation grace window in
// `users.prev_key_hash` exists.
// -----------------------------------------------------------------------------

/**
 * Identifiable prefix. Costs nothing and buys two things: a support request
 * quoting the first few characters is unambiguous, and secret scanners can be
 * taught to recognize one if a key ever lands in a public repo.
 */
export const API_KEY_PREFIX = "pnlr_live_";

/** Characters after the prefix. 32 chars of base32hex ≈ 165 bits. */
const KEY_CHARS = "0123456789abcdefghijklmnopqrstuv";
const KEY_BODY_LEN = 32;

/**
 * Mint a key. Uses rejection sampling over `randomBytes` so the alphabet stays
 * uniform — `byte % 32` happens to be exact here, but writing it this way means
 * changing the alphabet length later can't silently introduce modulo bias.
 */
export function generateApiKey(): string {
  const max = 256 - (256 % KEY_CHARS.length);
  let body = "";
  while (body.length < KEY_BODY_LEN) {
    for (const byte of randomBytes(KEY_BODY_LEN)) {
      if (byte >= max) continue;
      body += KEY_CHARS[byte % KEY_CHARS.length];
      if (body.length === KEY_BODY_LEN) break;
    }
  }
  return API_KEY_PREFIX + body;
}

/**
 * Mint a public shop id — the opaque token in a shop's URL.
 *
 * Deliberately NOT `user_sub`: for the Google connector that is the user's
 * Google account id, and this value gets pasted into Instagram bios. Ten
 * base32hex characters is ~50 bits, plenty for an unguessable-but-typeable
 * handle. The UNIQUE constraint is still the authority; callers retry on 23505.
 *
 * Shares the rejection-sampling loop with generateApiKey for the same reason:
 * a future alphabet change must not silently introduce modulo bias.
 */
export function generateShopId(): string {
  const max = 256 - (256 % KEY_CHARS.length);
  let out = "";
  while (out.length < 10) {
    for (const byte of randomBytes(10)) {
      if (byte >= max) continue;
      out += KEY_CHARS[byte % KEY_CHARS.length];
      if (out.length === 10) break;
    }
  }
  return out;
}

/**
 * Hash for storage and lookup. Plain SHA-256, deliberately — this is a
 * high-entropy random token, not a password, so there is nothing for bcrypt's
 * work factor to defend against, and lookup needs to be a single indexed
 * equality match.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Shape check, before spending a database round-trip on an obvious non-key. */
export function looksLikeApiKey(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  const body = key.slice(API_KEY_PREFIX.length);
  if (body.length !== KEY_BODY_LEN) return false;
  for (const ch of body) if (!KEY_CHARS.includes(ch)) return false;
  return true;
}

/**
 * Constant-time hash comparison, for any caller that compares in application
 * code rather than via an indexed lookup.
 */
export function apiKeyHashEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
