import { describe, it, expect } from "vitest";

import {
  composeOrderEmail,
  fabricBreakdown,
  generateOrderRef,
} from "@/lib/orderEmail";
import type { PaletteEntry } from "@/lib/types";

const fabrics: PaletteEntry[] = [
  { id: "lx-red", label: "Red", color: "#c41e3a", line: "Ultrasuede LX" },
  { id: "lx-white", label: "White", color: "#f2efe9", line: "Ultrasuede LX" },
];

describe("generateOrderRef", () => {
  it("is grouped and readable", () => {
    expect(generateOrderRef()).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it("never uses characters that are ambiguous when retyped", () => {
    // A reference gets read off a phone and typed into a checkout box.
    const ambiguous = /[O0I1LU]/;
    const sample = Array.from({ length: 300 }, () => generateOrderRef()).join("");
    expect(sample).not.toMatch(ambiguous);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateOrderRef()));
    expect(seen.size).toBe(200);
  });
});

describe("fabricBreakdown", () => {
  it("counts panels per fabric and names them as the stitcher named them", () => {
    const colors = { p1: "#c41e3a", p2: "#c41e3a", p3: "#f2efe9" };
    expect(fabricBreakdown(colors, fabrics)).toEqual([
      { label: "Ultrasuede LX - Red", count: 2 },
      { label: "Ultrasuede LX - White", count: 1 },
    ]);
  });

  it("matches regardless of hex casing", () => {
    expect(fabricBreakdown({ p1: "#C41E3A" }, fabrics)[0].label).toBe(
      "Ultrasuede LX - Red",
    );
  });

  it("keeps a custom fabric's own name, which has no product line", () => {
    const custom: PaletteEntry[] = [
      { id: "custom:abc123", label: "Lance's grey", color: "#808080" },
    ];
    expect(fabricBreakdown({ p1: "#808080" }, custom)[0].label).toBe(
      "Lance's grey",
    );
  });

  it("surfaces an unknown colour as a hex rather than dropping it", () => {
    // Silently discarding it would mean the stitcher cuts the wrong count.
    const out = fabricBreakdown({ p1: "#123456" }, fabrics);
    expect(out).toEqual([{ label: "#123456", count: 1 }]);
  });

  it("orders by count so the dominant fabric reads first", () => {
    const colors = { a: "#f2efe9", b: "#c41e3a", c: "#c41e3a", d: "#c41e3a" };
    expect(fabricBreakdown(colors, fabrics)[0]).toEqual({
      label: "Ultrasuede LX - Red",
      count: 3,
    });
  });
});

describe("composeOrderEmail", () => {
  const base = {
    ref: "K4P2-9WQX",
    hasAnimation: true,
    shopName: "Footbags",
    itemTitle: "Classic 32-panel",
    size: 2.1,
    fill: "freestyle",
    note: "",
    contact: "@someone",
    panelColors: { p1: "#c41e3a", p2: "#f2efe9" },
    fabrics,
  };

  it("puts the reference in the subject so it is searchable", () => {
    expect(composeOrderEmail(base).subject).toContain("K4P2-9WQX");
  });

  it("carries everything the stitcher needs to make the ball", () => {
    const { text } = composeOrderEmail(base);
    expect(text).toContain("K4P2-9WQX");
    expect(text).toContain("2.1 in");
    expect(text).toContain("freestyle");
    expect(text).toContain("@someone");
    expect(text).toContain("Ultrasuede LX - Red");
  });

  it("says so plainly when no contact was given", () => {
    const { text } = composeOrderEmail({ ...base, contact: "" });
    expect(text).toContain("(none given)");
  });

  it("includes special requests only when there are some", () => {
    expect(composeOrderEmail(base).text).not.toContain("Special requests");
    const withNote = composeOrderEmail({ ...base, note: "extra tight" });
    expect(withNote.text).toContain("Special requests");
    expect(withNote.text).toContain("extra tight");
  });

  it("says so plainly when no preview could be rendered", () => {
    // Claiming an attachment that is not there sends the stitcher hunting for
    // one; saying nothing leaves them wondering if they missed it.
    const { text } = composeOrderEmail({ ...base, hasAnimation: false });
    expect(text).toContain("No preview was attached");
    expect(text).not.toContain("The attached animation");
  });

  it("mentions the animation when one is attached", () => {
    expect(composeOrderEmail(base).text).toContain("The attached animation");
  });

  it("bounds the subject even though the title is the stitcher's own text", () => {
    const long = composeOrderEmail({ ...base, itemTitle: "x".repeat(300) });
    expect(long.subject.length).toBeLessThan(120);
  });
});
