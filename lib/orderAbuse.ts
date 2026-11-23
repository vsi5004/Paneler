/**
 * Abuse controls for order submission.
 *
 * Pure logic, no database and no React, so the rules are testable without a
 * live endpoint. Two separate concerns, deliberately kept apart:
 *
 *   rate limiting : how OFTEN one client may submit
 *   deduplication : whether they may submit the SAME thing twice
 *
 * Both are IN-PROCESS: per pod, lost on restart, not shared across replicas.
 * That is honest about what they are. They stop a script hammering the
 * endpoint, and stop a double-click becoming two orders, which is the abuse
 * that actually happens. A determined attacker timing requests around a deploy
 * gets through; the answer to that is a shared store, not a bigger Map.
 *
 * What bounds the damage regardless is that an order's destination is fixed by
 * the item: a submission can only ever reach the stitcher who published it, so
 * this can never be used to reach an arbitrary third party.
 */
import { createHash } from "node:crypto";

/** Submissions per client per window. */
export const MAX_SUBMISSIONS = 5;
export const WINDOW_MS = 60 * 60 * 1000;

/**
 * Orders per shop per window, from all clients together. Backstops the
 * per-client limit, whose key a sender who reaches the pod without passing
 * through Cloudflare could forge.
 */
export const MAX_SHOP_SUBMISSIONS = 20;

/** Most distinct clients tracked before stale entries are swept. */
const MAX_TRACKED = 5000;

export type SubmissionVerdict =
  | { ok: true }
  | { ok: false; reason: "rate_limited" | "duplicate" };

interface ClientRecord {
  hits: number[];
  seen: Map<string, number>;
}

const clients = new Map<string, ClientRecord>();
const shops = new Map<string, number[]>();

/**
 * Identify the submitting client.
 *
 * CLIENT_IP_HEADER names a header a trusted edge sets on every request
 * (paneler.app: `cf-connecting-ip`, set by Cloudflare). Set it whenever the
 * last proxy hop is not the client: behind k3s ServiceLB, Traefik's peer is a
 * svclb pod, so the last X-Forwarded-For entry is the same for every visitor
 * and all customers would share one bucket. Only name a header the edge
 * overwrites, or clients can pick their own key.
 *
 * Without it, X-Forwarded-For: a client may send their own header, and the
 * proxy APPENDS the peer it actually saw, so the LAST entry is the one the
 * proxy vouches for. Taking the first would let anyone reset their own limit.
 *
 * Falls back to a fixed string rather than anything spoofable, so a missing
 * header degrades to one shared bucket instead of to no limit at all.
 */
export function clientKey(
  headers: Headers,
  ipHeader: string | undefined = process.env.CLIENT_IP_HEADER,
): string {
  if (ipHeader) {
    const ip = headers.get(ipHeader)?.trim();
    if (ip) return ip;
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * A stable digest of what was ordered.
 *
 * Panel colours are sorted so the same ball serialises identically regardless
 * of the order the customer happened to paint in. Without that, painting the
 * same design twice would produce two different digests and slip straight past
 * the duplicate check.
 */
export function fingerprintOrder(order: {
  itemId: string;
  size: number;
  fill: string;
  note: string;
  panelColors: Record<string, string>;
}): string {
  const parts = Object.keys(order.panelColors)
    .sort()
    .map((k) => k + ":" + order.panelColors[k].toLowerCase())
    .join(",");
  const payload = [
    order.itemId,
    order.size.toFixed(1),
    order.fill,
    order.note,
    parts,
  ].join(" ");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Record a submission attempt and say whether it may proceed.
 *
 * Duplicates are checked BEFORE the rate limit, for two reasons: a double-click
 * then reports the honest reason ("you already sent this") rather than "slow
 * down", and a repeat does not burn the client's remaining quota.
 *
 * A rejected attempt is deliberately NOT recorded. Counting the retries of
 * someone already blocked only makes the block harder to escape by accident,
 * and it is the accidental case this mostly exists to catch.
 */
export function checkSubmission(
  key: string,
  fingerprint: string,
  now: number = Date.now(),
): SubmissionVerdict {
  const record = clients.get(key) ?? { hits: [], seen: new Map() };

  record.hits = record.hits.filter((t) => now - t < WINDOW_MS);
  for (const [fp, t] of record.seen) {
    if (now - t >= WINDOW_MS) record.seen.delete(fp);
  }

  if (record.seen.has(fingerprint)) {
    clients.set(key, record);
    return { ok: false, reason: "duplicate" };
  }
  if (record.hits.length >= MAX_SUBMISSIONS) {
    clients.set(key, record);
    return { ok: false, reason: "rate_limited" };
  }

  record.hits.push(now);
  record.seen.set(fingerprint, now);
  clients.set(key, record);

  if (clients.size > MAX_TRACKED) sweep(now);
  return { ok: true };
}

/**
 * Record an order to a shop and say whether the shop may take another this
 * window. Called after checkSubmission passes, so a client already refused
 * never uses up a shop's allowance. Entries are bounded by published shops:
 * the route looks the shop up first.
 */
export function checkShopVolume(shopId: string, now: number = Date.now()): boolean {
  const hits = (shops.get(shopId) ?? []).filter((t) => now - t < WINDOW_MS);
  const ok = hits.length < MAX_SHOP_SUBMISSIONS;
  if (ok) hits.push(now);
  shops.set(shopId, hits);
  return ok;
}

/**
 * Drop clients with nothing left inside the window. Without this the map grows
 * one entry per IP forever on a long-lived pod, which is a slow leak rather
 * than a crash and so would go unnoticed.
 */
function sweep(now: number): void {
  for (const [key, rec] of clients) {
    const live =
      rec.hits.some((t) => now - t < WINDOW_MS) ||
      [...rec.seen.values()].some((t) => now - t < WINDOW_MS);
    if (!live) clients.delete(key);
  }
}

/** Test seam. Never called by the app. */
export function __resetAbuseState(): void {
  clients.clear();
  shops.clear();
}
