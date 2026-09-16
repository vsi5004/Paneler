import { describe, it, expect } from "vitest";
import {
  ORDER_SIZES,
  orderBlocker,
  validateSize,
  validateOrder,
  validateShop,
  validateItem,
} from "@/lib/orderForm";

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

describe("orderBlocker — what stops a customer submitting", () => {
  const ready = {
    loaded: true,
    fabricCount: 6,
    totalPanels: 32,
    paintedPanels: 32,
    size: 1.8,
    fill: "freestyle",
  };

  it("allows submission only when everything is chosen", () => {
    expect(orderBlocker(ready)).toBeNull();
  });

  it("requires EVERY panel, not just some", () => {
    expect(orderBlocker({ ...ready, paintedPanels: 31 })).toBe(
      "1 panel left to colour",
    );
    expect(orderBlocker({ ...ready, paintedPanels: 0 })).toBe(
      "32 panels left to colour",
    );
  });

  it("requires an explicit size and fill, not a default", () => {
    expect(orderBlocker({ ...ready, size: null })).toBe("Choose a size");
    expect(orderBlocker({ ...ready, fill: null })).toBe("Choose a fill");
  });

  it("reports blockers in the order a customer would fix them", () => {
    // Unpainted panels come before size, so a customer is not sent to the
    // bottom of the form while the ball is still half blank.
    expect(
      orderBlocker({ ...ready, paintedPanels: 10, size: null, fill: null }),
    ).toBe("22 panels left to colour");
  });

  it("does not claim panels are unpainted before the design has loaded", () => {
    expect(orderBlocker({ ...ready, loaded: false, totalPanels: 0 })).toMatch(
      /Loading/,
    );
  });

  it("catches a shop whose shelf was emptied after publishing", () => {
    expect(orderBlocker({ ...ready, fabricCount: 0 })).toMatch(/no fabrics/);
  });
});
