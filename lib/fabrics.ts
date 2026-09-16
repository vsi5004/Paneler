import { DEFAULT_PALETTE } from "@/lib/defaultPalettes";
import catalog from "@/lib/fabrics/catalog.json";
import type { FabricEntry, PaletteEntry } from "@/lib/types";

// -----------------------------------------------------------------------------
// The fabric catalog a user picks from, and the validation that guards what
// gets stored in `users.fabrics`.
//
// Runs on both sides: the profile page uses it to render, the PUT route uses it
// to validate. Keep it free of `server-only` and of any DOM dependency.
// -----------------------------------------------------------------------------

/**
 * Catalog groups, in the order the profile page and designer present them.
 *
 * The real fabrics come from lib/fabrics/catalog.json, generated out of the
 * colour library (gwbischof/ultrasuede-color-library) by its
 * export/to_paneler.py. Vendored rather than fetched: this builds with that
 * repo absent, and a fabric a stitcher has already picked cannot vanish
 * because an upstream page changed.
 *
 * Standard trails the real cloth because it is not cloth — twenty-one generic
 * colours to sketch with, kept from before the library existed.
 *
 * Every hex here is sampled from a photograph and approximate. Entries the
 * library marked `lifted` carry the documented brightness correction; the
 * fourteen LX entries without it are hand-tuned against the real fabric and
 * are passed through the importer untouched. See catalog.json's `_note`.
 */
export const FABRIC_GROUPS: { label: string; entries: PaletteEntry[] }[] = [
  ...(catalog.groups as { label: string; entries: PaletteEntry[] }[]),
  { label: "Standard", entries: DEFAULT_PALETTE },
];

/** id → catalog entry. Built from the palettes, never a second copy of them. */
// Flattened for lookup, but each entry keeps the group it came from. The group
// is the product line, and it is the half of a fabric's name that says what to
// order; losing it here is why an order email once read "32 x Red".
export const FABRIC_CATALOG: ReadonlyMap<string, PaletteEntry> = new Map(
  FABRIC_GROUPS.flatMap((g) =>
    g.entries.map((e) => [e.id, { ...e, line: g.label }] as const),
  ),
);

/** Bounds. The list is a handful of fabrics, not a data store. */
export const MAX_FABRICS = 60;
export const MAX_LABEL_CHARS = 40;

const HEX_RE = /^#[0-9a-f]{6}$/i;
const CUSTOM_ID_RE = /^custom:[a-z0-9]{6}$/;
// Anything in the C0/C1 control ranges — these have no business in a label and
// would otherwise ride along into headings, aria-labels, and the cut list.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

/** Mint an id for a user-defined fabric. */
export function newCustomFabricId(): string {
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += "abcdefghijklmnopqrstuvwxyz0123456789"[
      Math.floor(Math.random() * 36)
    ];
  }
  return `custom:${id}`;
}

/**
 * Turn stored entries into renderable palette entries.
 *
 * Catalog entries resolve against the live catalog, so a corrected color (the
 * Forest Green re-measure, say) reaches everyone holding it. Ids no longer in
 * the catalog are dropped rather than rendered blank — a retired fabric should
 * disappear, not become a colorless hole in someone's shelf.
 */
export function resolveFabrics(entries: FabricEntry[]): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "catalog") {
      const found = FABRIC_CATALOG.get(entry.id);
      if (found) out.push(found);
    } else {
      out.push({ id: entry.id, label: entry.label, color: entry.color });
    }
  }
  return out;
}

export class FabricValidationError extends Error {}

function fail(message: string): never {
  throw new FabricValidationError(message);
}

/**
 * Validate and normalize a client-supplied fabric list.
 *
 * Every entry is REBUILT field by field rather than passed through, so unknown
 * keys are dropped instead of persisted. That matters most for `swatch`: a
 * catalog entry's image path comes from our own constants, and letting a client
 * supply one would put an arbitrary URL in the palette. CSP `img-src 'self'`
 * would refuse to load it, but it shouldn't be storable in the first place.
 *
 * This is the only thing between a PUT and unbounded jsonb, so it belongs on
 * the server — the form calling it too is a convenience, not the control.
 */
export function validateFabrics(input: unknown): FabricEntry[] {
  if (!Array.isArray(input)) fail("fabrics must be an array");
  if (input.length > MAX_FABRICS) {
    fail(`too many fabrics (max ${MAX_FABRICS})`);
  }

  const seen = new Set<string>();
  const out: FabricEntry[] = [];

  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) fail("entry must be an object");
    const e = raw as Record<string, unknown>;

    if (typeof e.id !== "string") fail("entry.id must be a string");
    if (seen.has(e.id)) fail(`duplicate fabric id: ${e.id}`);
    seen.add(e.id);

    if (e.kind === "catalog") {
      if (!FABRIC_CATALOG.has(e.id)) fail(`unknown catalog fabric: ${e.id}`);
      out.push({ kind: "catalog", id: e.id });
    } else if (e.kind === "custom") {
      if (!CUSTOM_ID_RE.test(e.id)) fail(`malformed custom id: ${e.id}`);
      if (typeof e.label !== "string") fail("custom fabric needs a label");
      const label = e.label.trim();
      if (label.length === 0) fail("custom fabric label cannot be empty");
      if (label.length > MAX_LABEL_CHARS) {
        fail(`label too long (max ${MAX_LABEL_CHARS})`);
      }
      if (CONTROL_RE.test(label)) fail("label contains control characters");
      if (typeof e.color !== "string" || !HEX_RE.test(e.color)) {
        fail("custom fabric color must be #rrggbb");
      }
      out.push({
        kind: "custom",
        id: e.id,
        label,
        color: e.color.toLowerCase(),
      });
    } else {
      fail("entry.kind must be 'catalog' or 'custom'");
    }
  }

  return out;
}
