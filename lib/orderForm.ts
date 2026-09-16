/**
 * Shared vocabulary and validators for shops, order items, and orders.
 *
 * No database, no React - imported by the API routes (where the validation is
 * the actual control), by the profile page, and by the public order form.
 *
 * Every validator REBUILDS its result field by field rather than passing the
 * parsed object through, the same discipline as `validateFabrics` in
 * lib/fabrics.ts: unknown keys are dropped instead of persisted.
 */
import { MAX_DIAMETER_IN, MIN_DIAMETER_IN } from "@/lib/laser/constants";

/**
 * sessionStorage key prefix for an in-progress order.
 *
 * Lives here rather than in OrderDesigner so ResumeOrder (mounted on /app) can
 * read it without importing the 3D designer's whole module graph for one string.
 */
export const ORDER_STASH_PREFIX = "paneler:order:";

export class OrderFormError extends Error {}

function fail(message: string): never {
  throw new OrderFormError(message);
}

/**
 * Matches lib/fabrics.ts. Written as escapes, never as literal bytes - literal
 * control characters silently turn a source file into binary.
 */
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

export const MAX_TITLE_CHARS = 80;
export const MAX_DESCRIPTION_CHARS = 400;
export const MAX_NOTE_CHARS = 1000;
export const MAX_DISPLAY_NAME_CHARS = 60;
export const MAX_ITEMS = 20;
export const MAX_FILL_MATERIALS = 20;
export const MAX_FILL_MATERIAL_CHARS = 40;

/**
 * Finished diameters a customer may choose, inches.
 *
 * DERIVED from the designer's own slider bounds rather than written out, so the
 * ladder cannot drift from what the laser code considers a valid ball. The
 * rounding is not cosmetic: accumulating `+= 0.1` in binary floating point
 * reaches 1.7999999999999998, and an equality check against a stored 1.8 then
 * fails - rejecting a size the stitcher plainly offers.
 */
export const ORDER_SIZES: number[] = (() => {
  const out: number[] = [];
  const steps = Math.round((MAX_DIAMETER_IN - MIN_DIAMETER_IN) / 0.1);
  for (let i = 0; i <= steps; i += 1) {
    out.push(Math.round((MIN_DIAMETER_IN + i * 0.1) * 10) / 10);
  }
  return out;
})();

/**
 * Fill styles, fixed for every stitcher.
 *
 * Distinct from a stitcher's fill *materials* (a free list on their profile):
 * this is how the ball is built, that is what it is built from.
 */
export const FILL_STYLES = ["freestyle", "hybrid", "kicking"] as const;
export type FillStyle = (typeof FILL_STYLES)[number];

function cleanText(value: unknown, max: number, what: string): string {
  if (typeof value !== "string") fail(`${what} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${what} too long (max ${max})`);
  if (CONTROL_RE.test(trimmed)) fail(`${what} contains control characters`);
  return trimmed;
}

/**
 * One size value, snapped to the ladder.
 *
 * A TOLERANCE, not a rounding. Rounding to one decimal would tolerate float
 * drift as intended but would also silently turn 1.85 into 1.9 - handing the
 * customer a different ball than they asked for, with nothing anywhere saying
 * so. Drift is on the order of 1e-15; a genuinely off-ladder value is at least
 * 0.05 away. Accept the first, reject the second.
 */
export function validateSize(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    fail("size must be a number");
  }
  const match = ORDER_SIZES.find((s) => Math.abs(s - input) < 1e-6);
  if (match === undefined) fail(`unsupported size: ${input}`);
  return match;
}

export interface ItemInput {
  title: string;
  description: string | null;
  sizes: number[];
  published: boolean;
}

/**
 * An order item as the stitcher configures it. `designId` is not checked here -
 * the route resolves it against their own designs, where RLS makes a foreign id
 * simply unresolvable.
 */
export function validateItem(input: unknown): ItemInput {
  if (typeof input !== "object" || input === null) {
    fail("item must be an object");
  }
  const e = input as Record<string, unknown>;

  const title = cleanText(e.title, MAX_TITLE_CHARS, "title");
  if (title.length === 0) fail("title cannot be empty");

  const description =
    e.description == null
      ? null
      : cleanText(e.description, MAX_DESCRIPTION_CHARS, "description") || null;

  if (!Array.isArray(e.sizes)) fail("sizes must be an array");
  if (e.sizes.length === 0) fail("pick at least one size");
  const sizes: number[] = [];
  for (const s of e.sizes) {
    const size = validateSize(s);
    if (!sizes.includes(size)) sizes.push(size);
  }
  sizes.sort((a, b) => a - b);

  return { title, description, sizes, published: e.published === true };
}

export interface OrderInput {
  itemId: string;
  size: number;
  fill: FillStyle;
  note: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A customer's submission. The route must still check `size` against the item's
 * own offered list; this only proves it is a size Paneler can build at all.
 */
export function validateOrder(input: unknown): OrderInput {
  if (typeof input !== "object" || input === null) {
    fail("order must be an object");
  }
  const e = input as Record<string, unknown>;

  if (typeof e.itemId !== "string" || !UUID_RE.test(e.itemId)) {
    fail("malformed itemId");
  }
  const fill = e.fill;
  if (typeof fill !== "string" || !FILL_STYLES.includes(fill as FillStyle)) {
    fail("fill must be one of: " + FILL_STYLES.join(", "));
  }

  return {
    itemId: e.itemId.toLowerCase(),
    size: validateSize(e.size),
    fill: fill as FillStyle,
    note: cleanText(e.note ?? "", MAX_NOTE_CHARS, "note"),
  };
}

export interface ShopInput {
  displayName: string | null;
  fillMaterials: string[];
  shopPublished: boolean;
}

export function validateShop(input: unknown): ShopInput {
  if (typeof input !== "object" || input === null) {
    fail("shop must be an object");
  }
  const e = input as Record<string, unknown>;

  const displayName =
    e.displayName == null
      ? null
      : cleanText(e.displayName, MAX_DISPLAY_NAME_CHARS, "display name") || null;

  if (!Array.isArray(e.fillMaterials)) fail("fillMaterials must be an array");
  if (e.fillMaterials.length > MAX_FILL_MATERIALS) {
    fail(`too many fill materials (max ${MAX_FILL_MATERIALS})`);
  }
  const fillMaterials: string[] = [];
  for (const raw of e.fillMaterials) {
    const m = cleanText(raw, MAX_FILL_MATERIAL_CHARS, "fill material");
    if (m.length > 0 && !fillMaterials.includes(m)) fillMaterials.push(m);
  }

  const shopPublished = e.shopPublished === true;
  // Publishing with nothing to show is a dead link, and the failure would only
  // surface to the customer who opened it.
  if (shopPublished && !displayName) {
    fail("a published shop needs a display name");
  }

  return { displayName, fillMaterials, shopPublished };
}
