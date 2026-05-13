// Static-export stub. See client-stub.ts.

import type { Design } from "@/lib/types";

export interface DesignRow {
  id: string;
  name: string;
  payload: Design;
  starred: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
}

function unreachable(): never {
  throw new Error("designs repo called in static export build — should be unreachable");
}

export async function listDesigns(_sub: string): Promise<DesignRow[]> { return unreachable(); }
export async function getDesign(_sub: string, _id: string): Promise<DesignRow | null> { return unreachable(); }
export async function createDesign(_sub: string, _e: string | null, _n: string, _p: Design): Promise<DesignRow> { return unreachable(); }
export async function updateDesign(_sub: string, _id: string, _patch: { name?: string; payload?: Design; starred?: boolean; published?: boolean }): Promise<DesignRow | null> { return unreachable(); }
export async function deleteDesign(_sub: string, _id: string): Promise<boolean> { return unreachable(); }
