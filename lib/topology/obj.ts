import { Vector3 } from "three";
import {
  type PanelEdge,
  type PanelTopology,
  panelId,
  shapeForVertexCount,
} from "@/lib/types";

/**
 * Parse an OBJ file's text into a PanelTopology, preserving n-gon polygon
 * arity (each `f` line becomes one panel of N vertices, not auto-triangulated).
 *
 * three-stdlib's OBJLoader fan-triangulates everything, which is unsuitable
 * here — Goldberg-style topologies rely on the original pentagon / hexagon
 * face polygons. So we roll our own minimal parser. Lines we recognize:
 *   v X Y Z       → vertex
 *   f a b c …     → face (1-indexed; supports v, v/vt, v/vt/vn, v//vn)
 * Everything else (vn, vt, #, mtllib, g, s, o, …) is ignored.
 *
 * Vertices are projected onto a sphere of the given radius so the rest of
 * the pipeline behaves the same as for the built-in presets.
 */
export function parseObjToTopology(
  text: string,
  radius = 1,
): PanelTopology {
  const vertices: Vector3[] = [];
  const faces: number[][] = [];

  const lines = text.split(/\r?\n/);
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const rawLine = lines[lineNo];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/).slice(1);
      if (parts.length < 3) {
        throw new Error(`Malformed vertex on line ${lineNo + 1}: "${rawLine}"`);
      }
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      const z = parseFloat(parts[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`Non-numeric vertex on line ${lineNo + 1}: "${rawLine}"`);
      }
      vertices.push(new Vector3(x, y, z));
      continue;
    }

    if (line.startsWith("f ")) {
      const tokens = line.split(/\s+/).slice(1);
      if (tokens.length < 3) {
        throw new Error(`Face has fewer than 3 vertices on line ${lineNo + 1}`);
      }
      const idx: number[] = [];
      for (const tok of tokens) {
        // OBJ face tokens look like "v", "v/vt", "v/vt/vn", or "v//vn".
        const vStr = tok.split("/")[0];
        let v = parseInt(vStr, 10);
        if (!Number.isFinite(v)) {
          throw new Error(`Bad face vertex "${tok}" on line ${lineNo + 1}`);
        }
        // Negative indices in OBJ count from the end.
        if (v < 0) v = vertices.length + v + 1;
        if (v < 1 || v > vertices.length) {
          throw new Error(
            `Face references unknown vertex ${v} on line ${lineNo + 1}`,
          );
        }
        idx.push(v - 1); // OBJ is 1-indexed; we use 0-indexed.
      }
      faces.push(idx);
      continue;
    }

    // Silently skip everything else (vn, vt, mtllib, g, s, o, etc.).
  }

  if (vertices.length === 0) {
    throw new Error("OBJ file has no vertices");
  }
  if (faces.length === 0) {
    throw new Error("OBJ file has no faces");
  }

  // Project all vertices to the sphere. The rest of the pipeline assumes
  // every vertex sits on a sphere of the requested radius.
  for (const v of vertices) {
    if (v.lengthSq() === 0) continue;
    v.setLength(radius);
  }

  // Build panels with our standard ID format.
  const panels = faces.map((vertexIndices, idx) => {
    const shape = shapeForVertexCount(vertexIndices.length);
    return {
      id: panelId(idx, shape),
      vertexIndices: [...vertexIndices],
      shape,
    };
  });

  // Edge adjacency.
  const edgeMap = new Map<string, PanelEdge>();
  for (const panel of panels) {
    const loop = panel.vertexIndices;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.panelB = panel.id;
      } else {
        edgeMap.set(key, {
          vertexA: Math.min(a, b),
          vertexB: Math.max(a, b),
          panelA: panel.id,
          panelB: null,
        });
      }
    }
  }

  return { vertices, panels, edges: [...edgeMap.values()] };
}
