/**
 * Order references and the stitcher's notification email.
 *
 * No database sits behind an order: the email IS the order. So the reference
 * exists purely for a human to quote - the customer pastes it into the
 * stitcher's checkout note, and that is what ties a design to a payment.
 * Nothing looks it up, so nothing needs it to be unique in a database; it needs
 * to survive being read aloud, retyped, and copied out of a phone screenshot.
 */
import { randomInt } from "node:crypto";

import type { PaletteEntry } from "@/lib/types";

/**
 * Crockford-style alphabet with the ambiguous characters removed: no O/0, no
 * I/1/L, no U. A reference gets retyped by hand from a phone, and "was that an
 * O or a zero" is a support conversation nobody needs.
 */
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const REF_GROUPS = 2;
const REF_GROUP_LEN = 4;

/** e.g. "K4P2-9WQX". About 39 bits, which is far more than a human reference
 *  needs given nothing resolves it. */
export function generateOrderRef(): string {
  const groups: string[] = [];
  for (let g = 0; g < REF_GROUPS; g += 1) {
    let s = "";
    for (let i = 0; i < REF_GROUP_LEN; i += 1) {
      s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
    }
    groups.push(s);
  }
  return groups.join("-");
}

export interface OrderEmailInput {
  ref: string;
  shopName: string;
  itemTitle: string;
  size: number;
  fill: string;
  note: string;
  contact: string;
  panelColors: Record<string, string>;
  /** The stitcher's stocked fabrics, for naming colours they recognise. */
  fabrics: PaletteEntry[];
}

/**
 * Count panels per fabric, named the way the stitcher named them.
 *
 * A raw hex list is useless at the bench: "12 x Ultrasuede LX Red" is what
 * gets cut. Any colour not in their shelf is reported as a bare hex rather
 * than dropped, so a mismatch is visible instead of silently rounded away.
 */
export function fabricBreakdown(
  panelColors: Record<string, string>,
  fabrics: PaletteEntry[],
): { label: string; count: number }[] {
  const byHex = new Map<string, string>();
  for (const f of fabrics) byHex.set(f.color.toLowerCase(), f.label);

  const counts = new Map<string, number>();
  for (const hex of Object.values(panelColors)) {
    const key = byHex.get(hex.toLowerCase()) ?? hex.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Plain text, deliberately. No HTML means no escaping bug can turn a
 *  customer's note into markup in the stitcher's mail client. */
export function composeOrderEmail(input: OrderEmailInput): {
  subject: string;
  text: string;
} {
  const breakdown = fabricBreakdown(input.panelColors, input.fabrics);
  const total = Object.keys(input.panelColors).length;

  const lines: string[] = [];
  lines.push("New order: " + input.itemTitle);
  lines.push("");
  lines.push("Reference   " + input.ref);
  lines.push("Size        " + input.size.toFixed(1) + " in");
  lines.push("Fill        " + input.fill);
  lines.push("Contact     " + (input.contact || "(none given)"));
  lines.push("");
  lines.push("Fabrics (" + total + " panels)");
  for (const b of breakdown) {
    lines.push("  " + String(b.count).padStart(3, " ") + "  x  " + b.label);
  }
  if (input.note) {
    lines.push("");
    lines.push("Special requests");
    for (const l of input.note.split("\n")) lines.push("  " + l);
  }
  lines.push("");
  lines.push("The two images attached show the front and back of the ball.");
  lines.push("");
  lines.push(
    "The customer was shown this reference and asked to include it with their",
  );
  lines.push("payment, so you can match this order to it.");
  lines.push("");

  return {
    // The title is the stitcher's own text, not the customer's, so it is safe
    // in a header - but still bounded, because a header is a header.
    subject: "New order " + input.ref + " - " + input.itemTitle.slice(0, 60),
    text: lines.join("\n"),
  };
}
