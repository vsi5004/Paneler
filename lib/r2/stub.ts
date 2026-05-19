// Static-export stub. Aliased into the bundle when STATIC_EXPORT=1 so this
// file's runtime errors only fire on accidental imports — the static build
// doesn't ship API routes, so nothing should reach this code path.

export function bucket(): string {
  throw new Error("R2 unavailable in static export");
}
export function designKey(id: string): string {
  return `designs/${id}.glb`;
}
export async function presignedGetUrl(): Promise<string> {
  throw new Error("R2 unavailable in static export");
}
export async function presignedPutUrl(): Promise<string> {
  throw new Error("R2 unavailable in static export");
}
export async function putObject(): Promise<{ etag: string | undefined; size: number }> {
  throw new Error("R2 unavailable in static export");
}
export async function deleteObject(): Promise<void> {
  throw new Error("R2 unavailable in static export");
}
export async function readinessHeadObject(): Promise<void> {
  throw new Error("R2 unavailable in static export");
}
