"use client";

import { cn } from "@/lib/utils";
import { DEFAULT_PALETTE } from "@/lib/defaultPalettes";

interface ColorPaletteProps {
  selected: string;
  onSelect: (color: string) => void;
}

export function ColorPalette({ selected, onSelect }: ColorPaletteProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-1.5">
        {DEFAULT_PALETTE.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.color)}
            aria-label={entry.label}
            title={entry.label}
            className={cn(
              "size-7 rounded-md border-2 transition-transform hover:scale-110",
              selected.toLowerCase() === entry.color.toLowerCase()
                ? "border-foreground"
                : "border-transparent",
            )}
            style={{ backgroundColor: entry.color }}
          />
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Custom
        <input
          type="color"
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="h-7 w-12 cursor-pointer rounded border border-input bg-transparent"
        />
        <code className="font-mono text-foreground">{selected.toUpperCase()}</code>
      </label>
    </div>
  );
}
