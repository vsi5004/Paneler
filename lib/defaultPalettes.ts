import type { PaletteEntry } from "@/lib/types";

// 21 fabric-friendly colors ported from Footbag-3D-Visualizer.
export const DEFAULT_PALETTE: PaletteEntry[] = [
  { id: "white", label: "White", color: "#f8f8f8" },
  { id: "grey", label: "Grey", color: "#888888" },
  { id: "black", label: "Black", color: "#1a1a1a" },
  { id: "wine", label: "Wine", color: "#722f37" },
  { id: "red", label: "Red", color: "#c41e3a" },
  { id: "orange-red", label: "Orange Red", color: "#e8502a" },
  { id: "orange", label: "Orange", color: "#e87622" },
  { id: "golden", label: "Golden", color: "#e8b800" },
  { id: "lime-yellow", label: "Lime Yellow", color: "#a8c000" },
  { id: "grass-green", label: "Grass Green", color: "#4a8c1c" },
  { id: "forest-green", label: "Forest Green", color: "#1a5c28" },
  { id: "teal", label: "Teal", color: "#1a6b5c" },
  { id: "turquoise", label: "Turquoise", color: "#1a9688" },
  { id: "sky-blue", label: "Sky Blue", color: "#3090c8" },
  { id: "royal-blue", label: "Royal Blue", color: "#2040a0" },
  { id: "navy", label: "Navy", color: "#0a1a50" },
  { id: "indigo", label: "Indigo", color: "#2d1b69" },
  { id: "purple", label: "Purple", color: "#602080" },
  { id: "pink", label: "Pink", color: "#c8407a" },
  { id: "tan", label: "Tan", color: "#c4965a" },
  { id: "brown", label: "Brown", color: "#7a4820" },
];

// LOAD-BEARING, despite nothing importing it any more.
//
// The fabric catalogue Paneler actually renders is lib/fabrics/catalog.json,
// generated from the colour library. But these fourteen hexes are the ONLY
// copy of the hand-tuning — every one was matched by eye against the real
// cloth, and the library upstream stores the raw photo measurement instead.
// The importer (export/to_paneler.py in the library repo) reads this file,
// matches these fourteen to their colour codes, and passes them through
// untouched while lifting everything else.
//
// So deleting this array as dead code silently reverts LX to raw photo values
// and loses the tuning. If it ever has to move, move it into
// lib/fabrics/catalog.json by hand and teach the importer to preserve it there.
//
// NOTE ON PURPLE: it sits at 2.12x its raw photo measurement (#27081d),
// well outside the 1.32-1.51x the rest of this palette occupies, and that is
// deliberate rather than a slip to tidy up. Purple was already the most
// lifted of the fourteen at 1.51x and still read far too dark against the
// real cloth -- which is what the pile's micro-shadows do to a colour this
// dark and this saturated, more than to any mid-tone. The value was chosen by
// holding the fabric against the screen, the same way the other twelve were.
//
// NOTE ON FOREST GREEN AND BROWNSTONE: these two arrived later than the
// other twelve (commit 8ba5326) and were entered WITHOUT the +32% lift, so
// they rendered roughly 30% darker than every other LX color. Measuring all
// fourteen against Toray's own swatch photographs showed the other twelve
// sitting at 1.32-1.51x their raw photo value while these two sat at 1.06x
// and 1.02x. They now carry the documented two-x1.15 lift applied to that
// raw value. The twelve were tuned by eye and average ~1.39x, so these two
// are still a few percent conservative against their neighbours -- but the
// documented procedure is the reproducible one, and 5% beats 30%.
// Ultrasuede LX — the fabric footbags are actually sewn from. Colors
// are measured from the fabric photos in public/lx (center-crop mean)
// and lifted +32% brightness (two ×1.15 passes, tuned by eye against
// the real fabric): the pile's micro-shadows bias the photos darker
// than the fabric reads in person. Each swatch shows the photo itself
// (64px thumb).
export const ULTRASUEDE_LX_PALETTE: PaletteEntry[] = [
  { id: "lx-white", label: "LX White", color: "#ffffff", swatch: "/lx/thumbs/white.webp", swatchLarge: "/lx/white.webp" },
  { id: "lx-ivory", label: "LX Ivory", color: "#f5ddc0", swatch: "/lx/thumbs/ivory.webp", swatchLarge: "/lx/ivory.webp" },
  { id: "lx-black", label: "LX Black", color: "#1c1c1c", swatch: "/lx/thumbs/black.webp", swatchLarge: "/lx/black.webp" },
  { id: "lx-citron", label: "LX Citron", color: "#c8ba56", swatch: "/lx/thumbs/citron.webp", swatchLarge: "/lx/citron.webp" },
  { id: "lx-orange", label: "LX Orange", color: "#c8622c", swatch: "/lx/thumbs/orange.webp", swatchLarge: "/lx/orange.webp" },
  { id: "lx-red", label: "LX Red", color: "#b10607", swatch: "/lx/thumbs/red.webp", swatchLarge: "/lx/red.webp" },
  { id: "lx-rose", label: "LX Rose", color: "#a7295e", swatch: "/lx/thumbs/rose.webp", swatchLarge: "/lx/rose.webp" },
  { id: "lx-burgundy", label: "LX Burgundy", color: "#632335", swatch: "/lx/thumbs/burgundy.webp", swatchLarge: "/lx/burgundy.webp" },
  { id: "lx-purple", label: "LX Purple", color: "#4a1439", swatch: "/lx/thumbs/purple.webp", swatchLarge: "/lx/purple.webp" },
  { id: "lx-sky", label: "LX Sky", color: "#7d99b9", swatch: "/lx/thumbs/sky.webp", swatchLarge: "/lx/sky.webp" },
  { id: "lx-blue", label: "LX Blue", color: "#184a71", swatch: "/lx/thumbs/blue.webp", swatchLarge: "/lx/blue.webp" },
  { id: "lx-turquoise", label: "LX Turquoise", color: "#3b8798", swatch: "/lx/thumbs/turquoise.webp", swatchLarge: "/lx/turquoise.webp" },
  { id: "lx-forest-green", label: "LX Forest Green", color: "#34432e", swatch: "/lx/thumbs/forest-green.webp" },
  { id: "lx-brownstone", label: "LX Brownstone", color: "#7a4928", swatch: "/lx/thumbs/brownstone.webp" },
];
