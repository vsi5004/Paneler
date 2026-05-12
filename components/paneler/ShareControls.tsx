"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  encodeDesignToHash,
  exportDesign,
  importDesign,
} from "@/lib/designState";
import type { PanelColors } from "@/lib/types";

interface ShareControlsProps {
  modelType: string;
  panelColors: PanelColors;
  onImport: (modelType: string, colors: PanelColors) => void;
}

export function ShareControls({
  modelType,
  panelColors,
  onImport,
}: ShareControlsProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync the design into the URL hash so deep-linking + browser-back work.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = encodeDesignToHash(exportDesign(modelType, panelColors));
    history.replaceState(null, "", `${window.location.pathname}${hash}`);
  }, [modelType, panelColors]);

  const handleShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const hash = encodeDesignToHash(exportDesign(modelType, panelColors));
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to clipboard");
      window.setTimeout(() => setError(null), 2500);
    }
  }, [modelType, panelColors]);

  const handleDownload = useCallback(() => {
    const design = exportDesign(modelType, panelColors);
    const blob = new Blob([JSON.stringify(design, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paneler-design-${modelType}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [modelType, panelColors]);

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const design = importDesign(text);
        onImport(design.modelType, design.panelColors);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
        window.setTimeout(() => setError(null), 4000);
      }
    },
    [onImport],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleShare}>
          {copied ? "Copied!" : "Copy share link"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          Export JSON
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          Import JSON
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
