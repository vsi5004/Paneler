"use client";

import { cn } from "@/lib/utils";
import { DEFAULT_PALETTE } from "@/lib/defaultPalettes";

interface ColorPaletteProps {
  selected: string;
  onSelect: (color: string) => void;
}

export function ColorPalette({ selected, onSelect }: ColorPaletteProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-7 gap-1.5">
        {DEFAULT_PALETTE.map((entry) => {
          const isSelected =
            selected.toLowerCase() === entry.color.toLowerCase();
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry.color)}
              aria-label={entry.label}
              title={entry.label}
              className={cn(
                "group relative size-7 rounded-md transition-all",
                "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_-4px_8px_rgba(0,0,0,0.25)]",
                "hover:scale-110 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_-4px_8px_rgba(0,0,0,0.25),0_0_12px_var(--current-color)]",
                isSelected &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110",
              )}
              style={
                {
                  backgroundColor: entry.color,
                  "--current-color": entry.color,
                } as React.CSSProperties
              }
            />
          );
        })}
      </div>
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
