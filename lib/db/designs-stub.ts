// Static-export stub. See client-stub.ts.

import type { DesignMeta } from "@/lib/types";

function unreachable(): never {
  throw new Error("designs repo called in static export build — should be unreachable");
}

export async function listDesigns(_sub: string): Promise<DesignMeta[]> { return unreachable(); }
export async function getDesign(_sub: string, _id: string): Promise<DesignMeta | null> { return unreachable(); }
export async function createDesign(): Promise<DesignMeta> { return unreachable(); }
export async function updateDesign(): Promise<DesignMeta | null> { return unreachable(); }
export async function deleteDesign(): Promise<boolean> { return unreachable(); }
