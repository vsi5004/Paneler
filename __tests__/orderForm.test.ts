import { describe, it, expect } from "vitest";
import { ORDER_SIZES, validateSize, validateOrder, validateShop, validateItem } from "@/lib/orderForm";

describe("ORDER_SIZES", () => {
  it("is the eleven 0.1in steps, exactly", () => {
    expect(ORDER_SIZES).toEqual([1.5,1.6,1.7,1.8,1.9,2.0,2.1,2.2,2.3,2.4,2.5]);
  });
  it("has no float drift", () => {
    for (const s of ORDER_SIZES) expect(s).toBe(Math.round(s * 10) / 10);
  });
  it("accepts a drifted 1.8 rather than rejecting a size the stitcher offers", () => {
    expect(validateSize(1.7999999999999998)).toBe(1.8);
  });
  it("rejects off-ladder and out-of-range", () => {
    expect(() => validateSize(1.85)).toThrow();
    expect(() => validateSize(3.0)).toThrow();
    expect(() => validateSize("1.8")).toThrow();
  });
});

describe("validators reject junk", () => {
  it("unknown fill style", () => {
    expect(() => validateOrder({ itemId: "0".repeat(8)+"-0000-0000-0000-"+"0".repeat(12), size: 1.8, fill: "sand", note: "" })).toThrow(/fill must be/);
  });
  it("published shop needs a name", () => {
    expect(() => validateShop({ displayName: null, fillMaterials: [], shopPublished: true })).toThrow(/display name/);
  });
  it("item drops unknown keys and dedups sizes", () => {
    const r = validateItem({ title: "T", sizes: [2.1, 1.8, 2.1], published: true, evil: "x" });
    expect(r.sizes).toEqual([1.8, 2.1]);
    expect(r).not.toHaveProperty("evil");
  });
});
