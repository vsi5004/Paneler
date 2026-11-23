"use client";

import { ChevronDown, Redo2, Undo2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PanelSelection } from "@/lib/designState";
import type { PanelClass } from "@/lib/laser/types";

interface PaneToolsProps {
  /** Every panel type on the ball, as the Summary groups them. */
  classes: PanelClass[];
  selection: PanelSelection | null;
  onSelectAll: (shape: PanelClass) => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/** "Hexagon" → "hexagons"; "Hexagon A" (one of two hexagon sizes) → "Hexagon A panels". */
export function shapeNamePlural(label: string, count = 2): string {
  if (count === 1) return / [A-Z]$/.test(label) ? `${label} panel` : label.toLowerCase();
  return / [A-Z]$/.test(label) ? `${label} panels` : `${label.toLowerCase()}s`;
}

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-[#030610]/80 px-2.5 font-mono text-xs uppercase tracking-[0.12em] text-foreground/80 backdrop-blur transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-35";

/**
 * Tools over the 3D pane: Undo and Redo, and "Select all" of one panel type.
 * A selection (a whole type, or panels shift-clicked one by one) shows below
 * them; the next palette color paints all of it.
 */
export function PaneTools({ classes, selection, onSelectAll, onClear, canUndo, canRedo, onUndo, onRedo }: PaneToolsProps) {
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1.5">
        <button type="button" className={chip} onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z / Ctrl+Z)">
          <Undo2 className="size-3.5" />
          Undo
        </button>
        <button type="button" className={chip} onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z / Ctrl+Y)">
          <Redo2 className="size-3.5" />
          Redo
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className={chip} disabled={classes.length === 0}>
            Select all
            <ChevronDown className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                Panel type
              </DropdownMenuLabel>
              {classes.map((c) => (
                <DropdownMenuItem key={c.key} onClick={() => onSelectAll(c)} className="justify-between font-mono text-xs uppercase tracking-[0.1em]">
                  <span>{shapeNamePlural(c.label, c.panelIds.length)}</span>
                  <span className="text-muted-foreground">{c.panelIds.length}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <div className="mt-1 border-t border-border px-1.5 pb-1 pt-2 text-[11px] leading-snug text-muted-foreground">
              Or shift-click panels to pick several.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {selection && (
        <div className="flex items-center gap-2 rounded-md border border-primary/50 bg-[#030610]/85 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-primary backdrop-blur">
          <span>
            {selection.panelIds.length} {selection.label ? shapeNamePlural(selection.label, selection.panelIds.length) : selection.panelIds.length === 1 ? "panel" : "panels"} selected · pick a color
          </span>
          <button type="button" onClick={onClear} className="text-muted-foreground transition-colors hover:text-foreground">
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
