// Static-export stub. See client-stub.ts.

import type { OrderItem } from "@/lib/types";

function unreachable(): never {
  throw new Error("order items repo called in static export build — should be unreachable");
}

export async function listItems(): Promise<OrderItem[]> { return unreachable(); }
export async function createItem(): Promise<OrderItem | null> { return unreachable(); }
export async function updateItem(): Promise<OrderItem | null> { return unreachable(); }
export async function deleteItem(): Promise<boolean> { return unreachable(); }
export async function reorderItems(): Promise<void> { return unreachable(); }
