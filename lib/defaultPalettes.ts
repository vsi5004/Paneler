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

// Ultrasuede LX — the fabric footbags are actually sewn from. Colors
// are measured from the fabric photos in public/lx (center-crop mean)
// and lifted +32% brightness (two ×1.15 passes, tuned by eye against
// the real fabric): the pile's micro-shadows bias the photos darker
// than the fabric reads in person. Each swatch shows the photo itself
// (64px thumb).
export const ULTRASUEDE_LX_PALETTE: PaletteEntry[] = [
  { id: "lx-white", label: "LX White", color: "#ffffff", swatch: "/lx/thumbs/white.webp" },
  { id: "lx-ivory", label: "LX Ivory", color: "#f5ddc0", swatch: "/lx/thumbs/ivory.webp" },
  { id: "lx-black", label: "LX Black", color: "#1c1c1c", swatch: "/lx/thumbs/black.webp" },
  { id: "lx-citron", label: "LX Citron", color: "#c8ba56", swatch: "/lx/thumbs/citron.webp" },
  { id: "lx-orange", label: "LX Orange", color: "#c8622c", swatch: "/lx/thumbs/orange.webp" },
  { id: "lx-red", label: "LX Red", color: "#b10607", swatch: "/lx/thumbs/red.webp" },
  { id: "lx-rose", label: "LX Rose", color: "#a7295e", swatch: "/lx/thumbs/rose.webp" },
  { id: "lx-burgundy", label: "LX Burgundy", color: "#632335", swatch: "/lx/thumbs/burgundy.webp" },
  { id: "lx-purple", label: "LX Purple", color: "#350e29", swatch: "/lx/thumbs/purple.webp" },
  { id: "lx-sky", label: "LX Sky", color: "#7d99b9", swatch: "/lx/thumbs/sky.webp" },
  { id: "lx-blue", label: "LX Blue", color: "#184a71", swatch: "/lx/thumbs/blue.webp" },
  { id: "lx-turquoise", label: "LX Turquoise", color: "#3b8798", swatch: "/lx/thumbs/turquoise.webp" },
];
