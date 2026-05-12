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
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-md border border-border bg-background/40 p-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleShare}
          className="h-7 gap-1.5 px-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-primary/10 hover:text-primary"
        >
          {copied ? (
            <>
              <CheckIcon />
              Copied
            </>
          ) : (
            <>
              <LinkIcon />
              Share link
            </>
          )}
        </Button>
        <span className="h-4 w-px bg-border" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownload}
          className="h-7 gap-1.5 px-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-primary/10 hover:text-primary"
        >
          <DownloadIcon />
          Export
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="h-7 gap-1.5 px-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-primary/10 hover:text-primary"
        >
          <UploadIcon />
          Import
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
        <span
          role="alert"
          className="font-mono text-[10px] uppercase tracking-[0.15em] text-destructive"
        >
          {error}
        </span>
      )}
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
