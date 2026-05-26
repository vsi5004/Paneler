"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { TrackballControls } from "@react-three/drei";
import {
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Mesh,
  type MeshStandardMaterial,
  type Texture,
} from "three";
import { GLTFLoader } from "three-stdlib";

import type { PanelColors } from "@/lib/types";
import { loadSuedeTextures } from "@/lib/mesh/suedeTexture";
import { generatePanelUVsOnGeometry } from "@/lib/mesh/panelUVs";

// Pixel drag threshold above which a pointer-down→pointer-up sequence is
// treated as a camera drag, not a panel click. Matches Footbag-3D-Visualizer.
const CLICK_DRAG_THRESHOLD = 5;
const SEAM_NODE_NAME = "__seams";

interface PanelerCanvasProps {
  /** The GLB bytes for the current design. Null while loading. */
  glbBytes: Uint8Array | null;
  panelColors: PanelColors;
  selectedPanelId: string | null;
  suedeEnabled: boolean;
  onPanelClick: (panelId: string) => void;
}

export default function PanelerCanvas({
  glbBytes,
  panelColors,
  selectedPanelId,
  suedeEnabled,
  onPanelClick,
}: PanelerCanvasProps) {
  const group = useGlbGroup(glbBytes);

  // Lazy-load the suede maps the first time the toggle is flipped on.
  const [maps, setMaps] = useState<{ normal: Texture; roughness: Texture } | null>(null);
  useEffect(() => {
    if (!suedeEnabled || maps) return;
    let cancelled = false;
    loadSuedeTextures().then((m) => {
      if (!cancelled) setMaps(m);
    });
    return () => {
      cancelled = true;
    };
  }, [suedeEnabled, maps]);

  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 45 }}
      gl={{ antialias: true }}
      className="flex-1"
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} />
      <directionalLight position={[-3, -2, -4]} intensity={0.3} />
      {group && (
        <PanelGroup
          group={group}
          panelColors={panelColors}
          selectedPanelId={selectedPanelId}
          suedeMaps={suedeEnabled ? maps : null}
          onPanelClick={onPanelClick}
        />
      )}
      {/* TrackballControls (not OrbitControls) so the sphere can roll past
          the poles and keep spinning. OrbitControls clamps polar angle to
          [0, π] and won't go upside-down. */}
      <TrackballControls
        noPan
        rotateSpeed={3}
        zoomSpeed={1.2}
        minDistance={3}
        maxDistance={12}
        staticMoving
      />
    </Canvas>
  );
}

/**
 * Parse a GLB byte buffer into a Three.js scene Group. Returns null until the
 * first parse completes. Disposes previous geometry on input change so we
 * don't leak GPU memory when switching templates.
 */
function useGlbGroup(bytes: Uint8Array | null): Group | null {
  const [group, setGroup] = useState<Group | null>(null);

  useEffect(() => {
    if (!bytes) {
      setGroup(null);
      return;
    }
    let cancelled = false;
    const loader = new GLTFLoader();
    // GLTFLoader.parse wants an ArrayBuffer aligned to the GLB header — copy
    // to a fresh standalone ArrayBuffer to avoid offset gotchas when the
    // upload path reuses a larger buffer (and to satisfy TS, since Uint8Array
    // .buffer is now typed as ArrayBuffer | SharedArrayBuffer).
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    loader.parse(
      ab,
      "",
      (gltf) => {
        if (cancelled) return;
        // Disable raycast on the baked seam mesh so clicks pass through it
        // to the panels behind. Also record the template's original color on
        // each panel mesh so reset/derived UI can recover it.
        gltf.scene.traverse((obj) => {
          if (obj.name === SEAM_NODE_NAME) {
            obj.raycast = () => {};
            return;
          }
          const mesh = obj as Mesh;
          if (!mesh.isMesh) return;
          const panelId = mesh.userData?.panelId as string | undefined;
          if (!panelId) return;
          // Fallbacks for user-uploaded GLBs that may be missing normals or
          // UVs. Template GLBs already carry both, but a Blender export
          // without "Generate UVs" still needs to render and accept the
          // suede texture, so we patch them in here.
          const geom = mesh.geometry;
          if (!geom.attributes.normal) {
            geom.computeVertexNormals();
          }
          if (!geom.attributes.uv) {
            generatePanelUVsOnGeometry(geom, panelId);
          }
          const mat = mesh.material as MeshStandardMaterial;
          if (mat && "color" in mat) {
            mesh.userData.originalColor = `#${mat.color.getHexString()}`;
          }
        });
        setGroup(gltf.scene as unknown as Group);
      },
      (err) => {
        if (!cancelled) console.error("GLB parse error", err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  // Dispose old group resources when we get a new one (or when unmounting).
  const prevRef = useRef<Group | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = group;
    if (!prev || prev === group) return;
    prev.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
  }, [group]);

  return group;
}

function PanelGroup({
  group,
  panelColors,
  selectedPanelId,
  suedeMaps,
  onPanelClick,
}: {
  group: Group;
  panelColors: PanelColors;
  selectedPanelId: string | null;
  suedeMaps: { normal: Texture; roughness: Texture } | null;
  onPanelClick: (panelId: string) => void;
}) {
  // Track pointer-down origin so we can distinguish click from camera drag.
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const outlineRef = useRef<LineSegments | null>(null);

  // Sync per-panel material colors from React state.
  useEffect(() => {
    group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const panelId = mesh.userData?.panelId as string | undefined;
      if (!panelId) return;
      const targetHex =
        panelColors[panelId] ?? (mesh.userData.originalColor as string | undefined);
      if (!targetHex) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      if ("color" in mat) {
        (mat.color as Color).set(targetHex);
      }
    });
  }, [group, panelColors]);

  // Highlight the selected panel with a tinted emissive boost (preserves
  // the panel's own color instead of washing to white) and a border outline.
  useEffect(() => {
    group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const panelId = mesh.userData?.panelId as string | undefined;
      if (!panelId) return;
      const mat = mesh.material as MeshStandardMaterial | undefined;
      if (!mat || Array.isArray(mat) || !("emissive" in mat)) return;
      if (panelId === selectedPanelId) {
        mat.emissive.copy(mat.color).multiplyScalar(0.3);

        // Border outline from the panel boundary edges. EdgesGeometry with
        // a 30° threshold picks up only the panel boundary (no adjacent face)
        // and skips smooth interior subdivision edges.
        const edges = new EdgesGeometry(mesh.geometry, 30);
        const lineMat = new LineBasicMaterial({ color: 0xffffff });
        const outline = new LineSegments(edges, lineMat);
        outline.raycast = () => {};
        outline.scale.setScalar(1.005);
        mesh.add(outline);
        outlineRef.current = outline;
      } else {
        mat.emissive.setRGB(0, 0, 0);
      }
    });

    return () => {
      if (outlineRef.current) {
        outlineRef.current.geometry.dispose();
        (outlineRef.current.material as LineBasicMaterial).dispose();
        outlineRef.current.removeFromParent();
        outlineRef.current = null;
      }
    };
  }, [group, selectedPanelId, panelColors]);

  // Sync suede normal/roughness maps onto every panel material — skipping the
  // baked seam mesh, which doesn't shade like fabric.
  useEffect(() => {
    group.traverse((obj) => {
      if (obj.name === SEAM_NODE_NAME) return;
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const panelId = mesh.userData?.panelId as string | undefined;
      if (!panelId) return;
      const mat = mesh.material as MeshStandardMaterial | undefined;
      if (!mat || Array.isArray(mat)) return;
      if (suedeMaps) {
        mat.normalMap = suedeMaps.normal;
        mat.normalScale.set(3, 3);
        mat.roughnessMap = suedeMaps.roughness;
        mat.roughness = 1;
      } else {
        mat.normalMap = null;
        mat.roughnessMap = null;
        mat.roughness = 0.85;
      }
      mat.needsUpdate = true;
    });
  }, [group, suedeMaps]);

  return (
    <primitive
      object={group}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        downRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        const start = downRef.current;
        downRef.current = null;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) return;
        const hit = e.object as Mesh;
        const panelId = hit?.userData?.panelId as string | undefined;
        if (panelId) {
          e.stopPropagation();
          onPanelClick(panelId);
        }
      }}
    />
  );
}
