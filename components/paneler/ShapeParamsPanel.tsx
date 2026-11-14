"use client";

import { Slider } from "@/components/ui/slider";
import { SPHERE_RADIUS } from "@/lib/glb/generate";
import { mmPerUnit } from "@/lib/laser/constants";
import type { PresetParamDef, PresetParams } from "@/lib/topology/presets";
import type { RegenQuality } from "@/lib/glb/useGlbDesign";

interface ShapeParamsPanelProps {
  paramDefs: PresetParamDef[];
  values: PresetParams;
  onChange: (key: string, value: number, quality: RegenQuality) => void;
  /** Footbag diameter, for params shown as a length (see lengthAngle). */
  diameterIn: number;
  /**
   * Per param key: the length the laser templates actually label for that
   * edge (its sides span minMm–maxMm), measured on the geometry built at
   * `atValue`. A length param reads this instead of the bare seam length,
   * shifted by how far the slider has moved since — exact once the
   * geometry catches up.
   */
  templateLengths?: Record<string, { atValue: number; minMm: number; maxMm: number }>;
  /** Present for animated presets (the Kaleidoscope): Play/Pause + Speed. */
  playback?: {
    playing: boolean;
    onPlay: () => void;
    onPause: () => void;
    speed: number;
    onSpeedChange: (speed: number) => void;
  };
}

/**
 * One slider per shape degree of freedom the loaded design's preset declares.
 * Dragging emits draft-quality updates (coarse mesh, debounced); releasing
 * emits a full-quality update.
 */
export function ShapeParamsPanel({
  paramDefs,
  values,
  onChange,
  playback,
  diameterIn,
  templateLengths,
}: ShapeParamsPanelProps) {
  const visibleDefs = paramDefs.filter((def) => !def.hidden);
  const lengthText = (def: PresetParamDef, value: number, lengthAngle: (v: number) => number) => {
    const mm = (v: number) => lengthAngle(v) * SPHERE_RADIUS * mmPerUnit(diameterIn);
    const measured = templateLengths?.[def.key];
    if (!measured) return `${mm(value).toFixed(1)}mm`;
    // One number, to the hundredth: the middle of the sides' small spread.
    const shift = mm(value) - mm(measured.atValue);
    return `${Math.max(0, (measured.minMm + measured.maxMm) / 2 + shift).toFixed(2)}mm`;
  };
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-heading text-lg tracking-[0.15em] text-foreground">
          Shape
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {visibleDefs.length} {visibleDefs.length === 1 ? "param" : "params"}
        </span>
      </div>
      {playback && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={playback.playing ? playback.onPause : playback.onPlay}
            aria-label={playback.playing ? "Pause" : "Play"}
            className="flex h-7 items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2.5 font-mono text-[10px] uppercase tracking-[0.15em] text-primary transition-colors hover:border-primary hover:bg-primary/20"
          >
            {playback.playing ? <PauseIcon /> : <PlayIcon />}
            {playback.playing ? "Pause" : "Play"}
          </button>
          <div className="flex-1">
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                Speed
              </label>
              <span className="font-mono text-[10px] tabular-nums text-foreground">
                {playback.speed.toFixed(1)}×
              </span>
            </div>
            <Slider
              value={[playback.speed]}
              min={0.5}
              max={10}
              step={0.5}
              onValueChange={(next) => {
                playback.onSpeedChange(Array.isArray(next) ? next[0] : next);
              }}
            />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-4">
        {visibleDefs.map((def) => {
          const value = values[def.key] ?? def.defaultValue;
          return (
            <div key={def.key}>
              <div className="mb-2 flex items-baseline justify-between">
                <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  {def.label}
                </label>
                <span className="font-mono text-[10px] tabular-nums text-foreground">
                  {def.valueLabels
                    ? def.valueLabels[Math.round(value - def.min)]
                    : def.lengthAngle
                      ? lengthText(def, value, def.lengthAngle)
                      : `${value.toFixed(def.step >= 1 ? 0 : 1)}${def.unit ?? ""}`}
                </span>
              </div>
              <Slider
                value={[value]}
                min={def.min}
                max={def.max}
                step={def.step}
                onValueChange={(next) => {
                  const v = Array.isArray(next) ? next[0] : next;
                  onChange(def.key, v, "draft");
                }}
                onValueCommitted={(next) => {
                  const v = Array.isArray(next) ? next[0] : next;
                  onChange(def.key, v, "full");
                }}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 4l14 8-14 8z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
    </svg>
  );
}
