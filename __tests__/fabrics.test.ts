import { describe, it, expect } from "vitest";

import {
  FABRIC_CATALOG,
  FabricValidationError,
  MAX_FABRICS,
  newCustomFabricId,
  resolveFabrics,
  validateFabrics,
} from "@/lib/fabrics";
import {
  API_KEY_PREFIX,
  apiKeyHashEquals,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
} from "@/lib/apiKey";
import type { FabricEntry } from "@/lib/types";

const custom = (id: string, label = "Seafoam", color = "#c0ffee"): FabricEntry =>
  ({ kind: "custom", id, label, color });

describe("resolveFabrics", () => {
  it("preserves the stored order — it is the palette order", () => {
    const out = resolveFabrics([
      { kind: "catalog", id: "lx-red" },
      { kind: "catalog", id: "lx-black" },
      { kind: "catalog", id: "white" },
    ]);
    expect(out.map((e) => e.id)).toEqual(["lx-red", "lx-black", "white"]);
  });

  it("resolves catalog entries against the live catalog", () => {
    const [entry] = resolveFabrics([{ kind: "catalog", id: "lx-red" }]);
    expect(entry.label).toBe(FABRIC_CATALOG.get("lx-red")!.label);
    expect(entry.color).toBe(FABRIC_CATALOG.get("lx-red")!.color);
    expect(entry.swatch).toBeDefined();
  });

  it("drops retired catalog ids rather than rendering a blank swatch", () => {
    const out = resolveFabrics([
      { kind: "catalog", id: "lx-red" },
      { kind: "catalog", id: "lx-discontinued" },
    ]);
    expect(out.map((e) => e.id)).toEqual(["lx-red"]);
  });

  it("passes custom entries through with their own label and color", () => {
    const [entry] = resolveFabrics([custom("custom:a1b2c3")]);
    expect(entry).toEqual({
      id: "custom:a1b2c3",
      label: "Seafoam",
      color: "#c0ffee",
    });
  });
});

describe("validateFabrics", () => {
  it("accepts a well-formed mixed list", () => {
    const input = [{ kind: "catalog", id: "lx-red" }, custom("custom:a1b2c3")];
    expect(validateFabrics(input)).toEqual(input);
  });

  it("strips unknown keys instead of persisting them", () => {
    // A client-supplied `swatch` would otherwise put an arbitrary image URL
    // into the stored palette.
    const out = validateFabrics([
      { kind: "catalog", id: "lx-red", swatch: "https://evil.example/x.png" },
      {
        kind: "custom",
        id: "custom:a1b2c3",
        label: "Seafoam",
        color: "#c0ffee",
        swatch: "https://evil.example/y.png",
        extra: 1,
      },
    ]);
    expect(out[0]).toEqual({ kind: "catalog", id: "lx-red" });
    expect(out[1]).toEqual({
      kind: "custom",
      id: "custom:a1b2c3",
      label: "Seafoam",
      color: "#c0ffee",
    });
    expect(out.some((e) => "swatch" in e)).toBe(false);
  });

  it("normalizes label whitespace and color case", () => {
    const [entry] = validateFabrics([
      { kind: "custom", id: "custom:a1b2c3", label: "  Seafoam  ", color: "#C0FFEE" },
    ]);
    expect(entry).toEqual({
      kind: "custom",
      id: "custom:a1b2c3",
      label: "Seafoam",
      color: "#c0ffee",
    });
  });

  it.each([
    ["not an array", "nope"],
    ["a non-object entry", ["lx-red"]],
    ["an unknown catalog id", [{ kind: "catalog", id: "lx-nope" }]],
    ["an unknown kind", [{ kind: "sparkly", id: "lx-red" }]],
    ["a malformed custom id", [custom("custom:TOOLONG!")]],
    ["a bad hex color", [custom("custom:a1b2c3", "Seafoam", "red")]],
    ["a short hex color", [custom("custom:a1b2c3", "Seafoam", "#fff")]],
    ["an empty label", [custom("custom:a1b2c3", "   ")]],
    ["an over-long label", [custom("custom:a1b2c3", "x".repeat(41))]],
    ["a control character in a label", [custom("custom:a1b2c3", "Sea\u0000foam")]],
    [
      "duplicate ids",
      [
        { kind: "catalog", id: "lx-red" },
        { kind: "catalog", id: "lx-red" },
      ],
    ],
  ])("rejects %s", (_name, input) => {
    expect(() => validateFabrics(input)).toThrow(FabricValidationError);
  });

  it("rejects a list over the cap", () => {
    const ids = [...FABRIC_CATALOG.keys()];
    const over = Array.from({ length: MAX_FABRICS + 1 }, (_, i) =>
      // Unique ids so it fails on the cap, not on duplicates.
      i < ids.length
        ? { kind: "catalog" as const, id: ids[i] }
        : custom(`custom:${String(i).padStart(6, "0")}`),
    );
    expect(() => validateFabrics(over)).toThrow(/too many/);
  });

  it("accepts ids that newCustomFabricId produces", () => {
    for (let i = 0; i < 50; i++) {
      expect(() =>
        validateFabrics([custom(newCustomFabricId())]),
      ).not.toThrow();
    }
  });
});

describe("api keys", () => {
  it("mints keys with the expected prefix and shape", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key).toHaveLength(API_KEY_PREFIX.length + 32);
    expect(looksLikeApiKey(key)).toBe(true);
  });

  it("mints distinct keys", () => {
    const keys = new Set(Array.from({ length: 500 }, generateApiKey));
    expect(keys.size).toBe(500);
  });

  it("uses the whole alphabet — a biased generator would miss characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const ch of generateApiKey().slice(API_KEY_PREFIX.length)) {
        seen.add(ch);
      }
    }
    expect(seen.size).toBe(32);
  });

  it("hashes stably and differently per key", () => {
    const a = generateApiKey();
    expect(hashApiKey(a)).toBe(hashApiKey(a));
    expect(hashApiKey(a)).toHaveLength(64);
    expect(hashApiKey(a)).not.toBe(hashApiKey(generateApiKey()));
  });

  it("never returns the plaintext from the hash", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).not.toContain(key.slice(API_KEY_PREFIX.length));
  });

  it.each([
    ["a foreign prefix", "sk_live_" + "a".repeat(32)],
    ["a short body", API_KEY_PREFIX + "abc"],
    ["an out-of-alphabet character", API_KEY_PREFIX + "z".repeat(32)],
    ["an empty string", ""],
  ])("rejects %s", (_name, candidate) => {
    expect(looksLikeApiKey(candidate)).toBe(false);
  });

  it("compares hashes safely, including mismatched lengths", () => {
    const h = hashApiKey(generateApiKey());
    expect(apiKeyHashEquals(h, h)).toBe(true);
    expect(apiKeyHashEquals(h, hashApiKey(generateApiKey()))).toBe(false);
    expect(apiKeyHashEquals(h, "short")).toBe(false);
  });
});
