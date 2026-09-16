import { describe, it, expect, beforeEach } from "vitest";

import {
  MAX_SUBMISSIONS,
  WINDOW_MS,
  __resetAbuseState,
  checkSubmission,
  clientKey,
  fingerprintOrder,
} from "@/lib/orderAbuse";

const order = {
  itemId: "11111111-1111-1111-1111-111111111111",
  size: 1.8,
  fill: "freestyle",
  note: "",
  panelColors: { a: "#ff0000", b: "#00ff00" },
};

beforeEach(() => __resetAbuseState());

describe("clientKey", () => {
  it("takes the LAST X-Forwarded-For entry, which is the one the proxy added", () => {
    // The first entries are whatever the client claimed. Trusting them would
    // let anyone reset their own rate limit with a header.
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9, 203.0.113.7" });
    expect(clientKey(h)).toBe("203.0.113.7");
  });

  it("does not let a spoofed header split one client into many buckets", () => {
    const a = clientKey(new Headers({ "x-forwarded-for": "evil-1, 203.0.113.7" }));
    const b = clientKey(new Headers({ "x-forwarded-for": "evil-2, 203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("falls back to a shared bucket, never to no limit", () => {
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("fingerprintOrder", () => {
  it("is stable regardless of the order panels were painted in", () => {
    const reversed = { ...order, panelColors: { b: "#00ff00", a: "#ff0000" } };
    expect(fingerprintOrder(order)).toBe(fingerprintOrder(reversed));
  });

  it("changes when any part of the order changes", () => {
    const base = fingerprintOrder(order);
    expect(fingerprintOrder({ ...order, size: 2.1 })).not.toBe(base);
    expect(fingerprintOrder({ ...order, fill: "kicking" })).not.toBe(base);
    expect(fingerprintOrder({ ...order, note: "hi" })).not.toBe(base);
    expect(
      fingerprintOrder({ ...order, panelColors: { a: "#ff0000", b: "#0000ff" } }),
    ).not.toBe(base);
  });
});

describe("checkSubmission", () => {
  it("accepts a first submission", () => {
    expect(checkSubmission("ip", "fp1")).toEqual({ ok: true });
  });

  it("rejects the same design submitted again (the double-click case)", () => {
    checkSubmission("ip", "fp1");
    expect(checkSubmission("ip", "fp1")).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("still accepts a genuinely different design from the same client", () => {
    checkSubmission("ip", "fp1");
    expect(checkSubmission("ip", "fp2")).toEqual({ ok: true });
  });

  it("rate limits after the cap", () => {
    for (let i = 0; i < MAX_SUBMISSIONS; i += 1) {
      expect(checkSubmission("ip", "fp" + i)).toEqual({ ok: true });
    }
    expect(checkSubmission("ip", "another")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("does not let a duplicate consume the rate-limit quota", () => {
    checkSubmission("ip", "fp1", 0);
    // Four duplicates, which should cost nothing.
    for (let i = 0; i < 4; i += 1) checkSubmission("ip", "fp1", 0);
    // Four genuinely new designs should still be accepted.
    for (let i = 2; i <= MAX_SUBMISSIONS; i += 1) {
      expect(checkSubmission("ip", "new" + i, 0)).toEqual({ ok: true });
    }
  });

  it("keeps clients independent", () => {
    for (let i = 0; i < MAX_SUBMISSIONS; i += 1) checkSubmission("a", "fp" + i);
    expect(checkSubmission("b", "fp0")).toEqual({ ok: true });
  });

  it("forgets both the count and the fingerprint after the window", () => {
    for (let i = 0; i < MAX_SUBMISSIONS; i += 1) {
      checkSubmission("ip", "fp" + i, 0);
    }
    expect(checkSubmission("ip", "fp0", 0)).toEqual({
      ok: false,
      reason: "duplicate",
    });
    const later = WINDOW_MS + 1;
    expect(checkSubmission("ip", "fp0", later)).toEqual({ ok: true });
  });
});
