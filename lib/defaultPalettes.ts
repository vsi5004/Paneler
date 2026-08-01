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
// and lifted +15% brightness: the pile's micro-shadows bias the photos
// darker than the fabric reads in person. Each swatch shows the photo
// itself (64px thumb).
export const ULTRASUEDE_LX_PALETTE: PaletteEntry[] = [
  { id: "lx-white", label: "LX White", color: "#fffef7", swatch: "/lx/thumbs/white.webp" },
  { id: "lx-ivory", label: "LX Ivory", color: "#d5c0a7", swatch: "/lx/thumbs/ivory.webp" },
  { id: "lx-black", label: "LX Black", color: "#181818", swatch: "/lx/thumbs/black.webp" },
  { id: "lx-citron", label: "LX Citron", color: "#aea24b", swatch: "/lx/thumbs/citron.webp" },
  { id: "lx-orange", label: "LX Orange", color: "#ae5526", swatch: "/lx/thumbs/orange.webp" },
  { id: "lx-red", label: "LX Red", color: "#9a0506", swatch: "/lx/thumbs/red.webp" },
  { id: "lx-rose", label: "LX Rose", color: "#912452", swatch: "/lx/thumbs/rose.webp" },
  { id: "lx-burgundy", label: "LX Burgundy", color: "#561e2e", swatch: "/lx/thumbs/burgundy.webp" },
  { id: "lx-purple", label: "LX Purple", color: "#2e0c24", swatch: "/lx/thumbs/purple.webp" },
  { id: "lx-sky", label: "LX Sky", color: "#6d85a1", swatch: "/lx/thumbs/sky.webp" },
  { id: "lx-blue", label: "LX Blue", color: "#154062", swatch: "/lx/thumbs/blue.webp" },
  { id: "lx-turquoise", label: "LX Turquoise", color: "#337584", swatch: "/lx/thumbs/turquoise.webp" },
];
