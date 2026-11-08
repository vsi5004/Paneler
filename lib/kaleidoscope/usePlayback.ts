"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RegenQuality } from "@/lib/glb/useGlbDesign";

/**
 * Animation loop for presets that declare `animation` (the Kaleidoscope):
 * while playing, advance the time param by real elapsed time × speed and
 * regenerate. Frames are paced by the regen itself — the next frame is
 * requested only after the previous one lands (`frameKey` changes), so a
 * slow machine drops frame rate instead of queueing work.
 *
 * Pausing re-applies the current time rounded to the slider's step, so the
 * saved value is tidy and what is on screen is the design that saves.
 */
export function usePlayback({
  timeParam,
  period,
  time,
  frameKey,
  setDesignParam,
}: {
  /** Undefined when the loaded design doesn't animate. */
  timeParam: string | undefined;
  /** Time wraps at this value; Infinity runs forever. */
  period: number;
  time: number;
  /** Changes whenever a regenerated frame lands (e.g. the GLB bytes). */
  frameKey: unknown;
  setDesignParam: (key: string, value: number, quality: RegenQuality) => void;
}) {
  const [playing, setPlaying] = useState(false);
  /** Time units per second. */
  const [speed, setSpeed] = useState(2);
  const lastTickRef = useRef<number | null>(null);
  // Read through a ref so the loop is paced by landed frames only: `time`
  // updates as soon as a frame is requested, before its regen lands.
  const timeRef = useRef(time);
  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  useEffect(() => {
    if (!playing || !timeParam) return;
    const raf = requestAnimationFrame((now) => {
      const last = lastTickRef.current ?? now;
      lastTickRef.current = now;
      // Cap the step so a stall (tab hidden, slow regen) doesn't jump.
      const dt = Math.min(0.25, (now - last) / 1000);
      const next = (timeRef.current + dt * speed) % period;
      setDesignParam(timeParam, next, "play");
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, timeParam, period, speed, frameKey, setDesignParam]);

  const pause = useCallback(() => {
    if (!playing) return;
    setPlaying(false);
    lastTickRef.current = null;
    if (timeParam) {
      // Snap to the slider's step so the saved value is tidy.
      setDesignParam(timeParam, Math.round(timeRef.current * 10) / 10, "full");
    }
  }, [playing, timeParam, setDesignParam]);

  const play = useCallback(() => {
    lastTickRef.current = null;
    setPlaying(true);
  }, []);

  // A design that doesn't animate (another template loaded) is never
  // playing, whatever the flag says.
  return { playing: playing && Boolean(timeParam), play, pause, speed, setSpeed };
}
