"use client";

import { Button } from "@/components/ui/button";
import type { PanelSelection } from "@/lib/designState";
import type { PanelClass } from "@/lib/laser/types";

interface ShapeSelectionProps {
  /** Several panels to paint together; null when only one is selected. */
  selection: PanelSelection | null;
  /** The shape of the panel last clicked, if any. */
  selectedClass: PanelClass | null;
  onSelectAll: (shape: PanelClass) => void;
  onClear: () => void;
}

/** "Hexagon" → "hexagons"; "Hexagon A" (one of two hexagon sizes) → "Hexagon A panels". */
export function shapeNamePlural(label: string): string {
  return / [A-Z]$/.test(label) ? `${label} panels` : `${label.toLowerCase()}s`;
}

/**
 * Select several panels, then one palette color paints them all: every panel
 * of the clicked panel's shape, or panels shift-clicked one by one. Shapes
 * are the geometric classes the Summary uses, not panel names.
 */
export function ShapeSelection({ selection, selectedClass, onSelectAll, onClear }: ShapeSelectionProps) {
  const selectAll =
    selectedClass && selectedClass.panelIds.length > 1 && selection?.label !== selectedClass.label ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSelectAll(selectedClass)}
        className="h-8 w-full justify-start rounded-md border border-border bg-background/40 px-3 font-mono text-[11px] uppercase tracking-[0.12em] hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
      >
        Select all {selectedClass.panelIds.length} {shapeNamePlural(selectedClass.label)}
      </Button>
    ) : null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="mb-1 font-heading text-lg tracking-[0.15em] text-foreground">Selection</h2>
      {selection ? (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-primary">
            {selection.panelIds.length}{" "}
            {selection.label ? shapeNamePlural(selection.label) : selection.panelIds.length === 1 ? "panel" : "panels"} selected
          </span>
          <span className="text-xs text-muted-foreground">Pick a color to paint them all.</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-7 self-start px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-background/40 hover:text-foreground"
          >
            Clear selection
          </Button>
        </div>
      ) : null}
      {selectAll}
      {!selection && !selectAll ? (
        <div className="rounded-md border border-dashed border-border/50 px-3 py-3">
          <span className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.18em] text-muted-foreground/60">
            Click a panel to paint it. Shift-click to select several.
          </span>
        </div>
      ) : null}
      {!selection && selectAll ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">
          Or shift-click to select several
        </span>
      ) : null}
    </section>
  );
}
