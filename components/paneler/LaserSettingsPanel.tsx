"use client";

import { Slider } from "@/components/ui/slider";
import {
  MAX_BITE_DEPTH_MM,
  MAX_SHORT_EDGE_EXTENSION_MM,
  MIN_SHORT_EDGE_EXTENSION_MM,
  MAX_CORNER_MARGIN_MM,
  MAX_CURVATURE_PCT,
  MAX_DIAMETER_IN,
  MAX_HOLE_SPACING_MM,
  MIN_BITE_DEPTH_MM,
  MIN_CORNER_MARGIN_MM,
  MIN_CURVATURE_PCT,
  MIN_DIAMETER_IN,
  MIN_HOLE_SPACING_MM,
} from "@/lib/laser/constants";
import type { LaserSettings } from "@/lib/laser/types";

interface LaserSettingsPanelProps {
  values: LaserSettings;
  onChange: (partial: Partial<LaserSettings>) => void;
  /**
   * Whether the loaded design has simple polygon panels (≤6 corners).
   * Wavy imported shapes (trionda pinwheels, baseball) carry their
   * curvature in the boundary data itself, and their holes are laid
   * corner-anchored/evenly — so both the edge-bulge and corner-margin
   * sliders are meaningless there and hidden.
   */
  hasPolygonPanels: boolean;
}

/**
 * Sidebar "Laser" section: footbag size and bite depth. Everything else
 * (hole size/spacing/bunching, gather correction) is hard-coded to proven
 * values in lib/laser/constants.ts.
 */
export function LaserSettingsPanel({
  values,
  onChange,
  hasPolygonPanels,
}: LaserSettingsPanelProps) {
  const first = (v: number | readonly number[]) =>
    Array.isArray(v) ? v[0] : (v as number);
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-lg tracking-[0.15em] text-foreground">
          Laser
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          cut templates
        </span>
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Footbag size
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.diameterIn.toFixed(2)}in
            </span>
          </div>
          <Slider
            value={[values.diameterIn]}
            min={MIN_DIAMETER_IN}
            max={MAX_DIAMETER_IN}
            step={0.05}
            onValueChange={(v) => onChange({ diameterIn: first(v) })}
          />
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Bite depth
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.biteDepthMm.toFixed(1)}mm
            </span>
          </div>
          <Slider
            value={[values.biteDepthMm]}
            min={MIN_BITE_DEPTH_MM}
            max={MAX_BITE_DEPTH_MM}
            step={0.1}
            onValueChange={(v) => onChange({ biteDepthMm: first(v) })}
          />
        </div>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Hole spacing
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.holeSpacingMm.toFixed(1)}mm
            </span>
          </div>
          <Slider
            value={[values.holeSpacingMm]}
            min={MIN_HOLE_SPACING_MM}
            max={MAX_HOLE_SPACING_MM}
            step={0.1}
            onValueChange={(v) => onChange({ holeSpacingMm: first(v) })}
          />
        </div>
        <div className="flex items-center justify-between">
          <label
            className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground"
            htmlFor="short-edge-holes"
          >
            Short-edge holes
          </label>
          <button
            id="short-edge-holes"
            type="button"
            role="switch"
            aria-checked={values.shortEdgeHoles}
            onClick={() => onChange({ shortEdgeHoles: !values.shortEdgeHoles })}
            className={`relative h-4 w-8 rounded-full border transition-colors ${
              values.shortEdgeHoles
                ? "border-primary bg-primary/30"
                : "border-border bg-muted"
            }`}
          >
            <span
              className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all ${
                values.shortEdgeHoles
                  ? "left-[calc(100%-0.75rem)] bg-primary"
                  : "left-1 bg-muted-foreground"
              }`}
            />
          </button>
        </div>
        {!values.shortEdgeHoles && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Short edge extension
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.shortEdgeExtensionMm.toFixed(1)}mm
            </span>
          </div>
          <Slider
            value={[values.shortEdgeExtensionMm]}
            min={MIN_SHORT_EDGE_EXTENSION_MM}
            max={MAX_SHORT_EDGE_EXTENSION_MM}
            step={0.5}
            onValueChange={(v) => onChange({ shortEdgeExtensionMm: first(v) })}
          />
        </div>
        )}
        {hasPolygonPanels && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Corner margin
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.cornerMarginMm.toFixed(2)}mm
            </span>
          </div>
          <Slider
            value={[values.cornerMarginMm]}
            min={MIN_CORNER_MARGIN_MM}
            max={MAX_CORNER_MARGIN_MM}
            step={0.25}
            onValueChange={(v) => onChange({ cornerMarginMm: first(v) })}
          />
        </div>
        )}
        {hasPolygonPanels && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Panel curvature
            </label>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {values.curvaturePct.toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[values.curvaturePct]}
            min={MIN_CURVATURE_PCT}
            max={MAX_CURVATURE_PCT}
            step={5}
            onValueChange={(v) => onChange({ curvaturePct: first(v) })}
          />
        </div>
        )}
      </div>
    </section>
  );
}
