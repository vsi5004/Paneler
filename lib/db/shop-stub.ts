// Static-export stub. See client-stub.ts.

import type { PublicShop } from "@/lib/types";

function unreachable(): never {
  throw new Error("shop repo called in static export build — should be unreachable");
}

export async function getPublicShop(): Promise<PublicShop | null> { return unreachable(); }
export async function getPublicItem(): Promise<never> { return unreachable(); }
