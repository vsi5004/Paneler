import type { Vec2 } from "./types";

/**
 * Compute the rigid (rotation + translation, with optional mirror) 2D
 * transform that maps `srcA → dstA` and `srcB → dstB` exactly. Uniformly
 * scaled by `|dstB - dstA| / |srcB - srcA|` to absorb the tiny
 * per-panel projection mismatch where adjacent panels see the same 3D
 * edge at slightly different tangent-plane lengths.
 *
 * If `mirror` is true, the src point is reflected across the src edge
 * axis before rotation, so the unfolded neighbour lands on the opposite
 * side of the dst edge from the parent.
 *
 * Mirror correctness: the rotation angle is derived from the
 * POST-mirror src direction, so srcB still lands on dstB exactly.
 */
export function rigidEdgeAlign(
  srcA: Vec2,
  srcB: Vec2,
  dstA: Vec2,
  dstB: Vec2,
  mirror: boolean,
): (p: Vec2) => Vec2 {
  const srcDx = srcB.x - srcA.x;
  const srcDyRaw = srcB.y - srcA.y;
  const srcDy = mirror ? -srcDyRaw : srcDyRaw;
  const dstDx = dstB.x - dstA.x;
  const dstDy = dstB.y - dstA.y;
  const srcLen = Math.hypot(srcDx, srcDy);
  const dstLen = Math.hypot(dstDx, dstDy);
  if (srcLen === 0 || dstLen === 0) {
    return (p) => ({ x: p.x, y: p.y });
  }
  const scale = dstLen / srcLen;
  const srcAngle = Math.atan2(srcDy, srcDx);
  const dstAngle = Math.atan2(dstDy, dstDx);
  const rot = dstAngle - srcAngle;
  const cos = Math.cos(rot) * scale;
  const sin = Math.sin(rot) * scale;
  return (p) => {
    let x = p.x - srcA.x;
    let y = p.y - srcA.y;
    if (mirror) y = -y;
    return {
      x: cos * x - sin * y + dstA.x,
      y: sin * x + cos * y + dstA.y,
    };
  };
}

/** Cross product of (B - A) × (P - A) — sign tells which side of AB P sits on. */
export function sideOf(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}
