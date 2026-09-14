"use client";

import { cn } from "@/lib/utils";
import type { PaletteEntry } from "@/lib/types";

// Public assets live under the configured basePath (/app in the server
// build, /Paneler on the GH Pages export) — absolute URLs 404 without it.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface PaletteGroup {
  label: string;
  entries: PaletteEntry[];
}

interface ColorPaletteProps {
  selected: string;
  onSelect: (color: string) => void;
  /**
   * Rendered top to bottom, empty groups skipped. Driven by a prop rather than
   * importing the palettes directly so the same component can serve the
   * designer (built-ins plus the user's own fabrics) and, later, an embedded
   * order form restricted to one stitcher's stock.
   */
  groups: PaletteGroup[];
}

/** Single fabric chip. Exported so the profile page's catalog grid reuses it. */
export function Swatch({
  entry,
  selected,
  onSelect,
}: {
  entry: PaletteEntry;
  selected: string;
  onSelect: (color: string) => void;
}) {
  const isSelected = selected.toLowerCase() === entry.color.toLowerCase();
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.color)}
      aria-label={entry.label}
      title={entry.label}
      className={cn(
        "group relative size-7 rounded-md bg-cover bg-center transition-all",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_-4px_8px_rgba(0,0,0,0.25)]",
        "hover:scale-110 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_-4px_8px_rgba(0,0,0,0.25),0_0_12px_var(--current-color)]",
        isSelected &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110",
      )}
      style={
        {
          backgroundColor: entry.color,
          backgroundImage: entry.swatch
            ? `url(${BASE_PATH}${entry.swatch})`
            : undefined,
          "--current-color": entry.color,
        } as React.CSSProperties
      }
    />
  );
}

export function ColorPalette({
  selected,
  onSelect,
  groups,
}: ColorPaletteProps) {
  return (
    <div className="flex flex-col gap-4">
      {groups
        .filter((group) => group.entries.length > 0)
        .map((group) => (
          <div key={group.label}>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {group.label}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {group.entries.map((entry) => (
                <Swatch
                  key={entry.id}
                  entry={entry}
                  selected={selected}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ))}
      <div className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Custom
        </span>
        <input
          type="color"
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Custom color"
          className="size-7 cursor-pointer rounded-md border border-border bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-md"
        />
        <code className="ml-auto font-mono text-xs tracking-wider text-foreground/80">
          {selected.toUpperCase()}
        </code>
      </div>
    </div>
  );
}
