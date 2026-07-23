import { Vector3 } from "three";
import type { Panel, PanelTopology } from "@/lib/types";
import { shapeForVertexCount } from "@/lib/types";
import type { PanelClass } from "./types";

/**
 * Relative tolerance for congruence clustering. Imported topologies carry
 * small numeric spread (trionda's four congruent panels differ ~0.5% in
 * perimeter); genuinely distinct classes differ much more (GP(3,0)'s two
 * hexagon classes by ~3.5%). 1.5% sits comfortably between.
 */
const CONGRUENCE_TOLERANCE = 0.015;

interface Signature {
  panel: Panel;
  cornerCount: number;
  perimeter: number;
  areaMag: number;
}

/**
 * Group a topology's panels into congruence classes — panels whose
 * templates are interchangeable. Classification is purely geometric
 * (corner count + great-arc perimeter + spherical area with relative
 * tolerance): panel ids must NOT be used because their shape suffixes are
 * frozen to each preset's default member (a morphed cuboctahedron's
 * hexagons keep `_triangle` ids).
 *
 * Labels use the true shape name; when several classes share one shape,
 * they get " A"/" B"… suffixes ordered by descending panel count.
 */
export function groupPanelsByCongruence(topo: PanelTopology): PanelClass[] {
  const sigs: Signature[] = topo.panels.map((panel) => {
    const loop = panel.vertexIndices;
    const sphereRadius = topo.vertices[loop[0]].length() || 1;
    let perimeter = 0;
    const areaVec = new Vector3();
    const cross = new Vector3();
    for (let i = 0; i < loop.length; i++) {
      const a = topo.vertices[loop[i]];
      const b = topo.vertices[loop[(i + 1) % loop.length]];
      perimeter += a.angleTo(b) * sphereRadius;
      cross.crossVectors(a, b);
      areaVec.add(cross);
    }
    return {
      panel,
      cornerCount: loop.length,
      perimeter,
      areaMag: areaVec.length() / 2,
    };
  });

  // Greedy clustering: assign each panel to the first cluster whose
  // centroid signature matches within tolerance, else start a new one.
  interface Cluster {
    cornerCount: number;
    perimeterSum: number;
    areaSum: number;
    members: Signature[];
  }
  const clusters: Cluster[] = [];
  for (const sig of sigs) {
    let placed = false;
    for (const cluster of clusters) {
      if (cluster.cornerCount !== sig.cornerCount) continue;
      const n = cluster.members.length;
      const meanPerimeter = cluster.perimeterSum / n;
      const meanArea = cluster.areaSum / n;
      if (
        Math.abs(sig.perimeter - meanPerimeter) / meanPerimeter <=
          CONGRUENCE_TOLERANCE &&
        Math.abs(sig.areaMag - meanArea) / meanArea <= CONGRUENCE_TOLERANCE
      ) {
        cluster.members.push(sig);
        cluster.perimeterSum += sig.perimeter;
        cluster.areaSum += sig.areaMag;
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        cornerCount: sig.cornerCount,
        perimeterSum: sig.perimeter,
        areaSum: sig.areaMag,
        members: [sig],
      });
    }
  }

  // Sort by descending member count (stable primary ordering for labels
  // and for the carousel), then by corner count for determinism.
  clusters.sort(
    (a, b) =>
      b.members.length - a.members.length || a.cornerCount - b.cornerCount,
  );

  // Label: capitalized shape name, "polygon" → "Panel"; disambiguate
  // repeats with " A"/" B"… in the sorted (descending-count) order.
  const nameOf = (cornerCount: number): string => {
    const shape = shapeForVertexCount(cornerCount);
    if (shape === "polygon") return "Panel";
    return shape.charAt(0).toUpperCase() + shape.slice(1);
  };
  const nameTotals = new Map<string, number>();
  for (const c of clusters) {
    const name = nameOf(c.cornerCount);
    nameTotals.set(name, (nameTotals.get(name) ?? 0) + 1);
  }
  const nameSeen = new Map<string, number>();
  return clusters.map((cluster, index) => {
    const base = nameOf(cluster.cornerCount);
    const seen = nameSeen.get(base) ?? 0;
    nameSeen.set(base, seen + 1);
    const label =
      (nameTotals.get(base) ?? 1) > 1
        ? `${base} ${String.fromCharCode(65 + seen)}`
        : base;
    return {
      key: `${cluster.cornerCount}-${index}`,
      label,
      cornerCount: cluster.cornerCount,
      panelIds: cluster.members.map((m) => m.panel.id),
      representative: cluster.members[0].panel,
    };
  });
}
