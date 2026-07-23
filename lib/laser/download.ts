/**
 * Trigger a browser download of an SVG document. A plain anchor click is
 * the right tool here (tiny files, no save-in-place semantics needed —
 * unlike the GLB path in lib/files/glbFile.ts).
 */
export function downloadSvg(filename: string, svg: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
