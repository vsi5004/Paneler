"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Color,
  type Group,
  type LineSegments,
  type Mesh,
  type MeshStandardMaterial,
  type Texture,
} from "three";

import type { PanelColors, PanelTopology } from "@/lib/types";
import { subdivideTopology } from "@/lib/mesh/subdivide";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { buildMeshGroup } from "@/lib/mesh/buildMeshGroup";
import { loadSuedeTextures } from "@/lib/mesh/suedeTexture";

const SPHERE_RADIUS = 2;
const SUBDIVISION_LEVELS = 6;
// Pixel drag threshold above which a pointer-down→pointer-up sequence is
// treated as a camera drag, not a panel click. Matches Footbag-3D-Visualizer.
const CLICK_DRAG_THRESHOLD = 5;

interface PanelerCanvasProps {
  topology: PanelTopology;
  panelColors: PanelColors;
  selectedPanelId: string | null;
  suedeEnabled: boolean;
  onPanelClick: (panelId: string) => void;
}

export default function PanelerCanvas({
  topology,
  panelColors,
  selectedPanelId,
  suedeEnabled,
  onPanelClick,
}: PanelerCanvasProps) {
  const group = useMemo(() => {
    const subdivided = subdivideTopology(topology, SUBDIVISION_LEVELS);
    projectToSphere(subdivided, SPHERE_RADIUS);
    return buildMeshGroup(subdivided);
  }, [topology]);

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
      <PanelGroup
        group={group}
        panelColors={panelColors}
        selectedPanelId={selectedPanelId}
        suedeMaps={suedeEnabled ? maps : null}
        onPanelClick={onPanelClick}
      />
      <OrbitControls enablePan={false} minDistance={3} maxDistance={12} />
    </Canvas>
  );
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

  // Sync per-panel material colors from React state.
  useEffect(() => {
    group.traverse((obj) => {
      if (!(obj as Mesh).isMesh) return;
      const mesh = obj as Mesh;
      const panelId = mesh.userData.panelId as string | undefined;
      if (!panelId) return;
      const targetHex =
        panelColors[panelId] ?? (mesh.userData.originalColor as string);
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      if ("color" in mat) {
        (mat.color as Color).set(targetHex);
      }
    });
  }, [group, panelColors]);

  // Sync selected-panel edge highlight visibility.
  useEffect(() => {
    group.traverse((obj) => {
      const outlineFor = obj.userData?.outlineFor as string | undefined;
      if (!outlineFor) return;
      (obj as LineSegments).visible = outlineFor === selectedPanelId;
    });
  }, [group, selectedPanelId]);

  // Sync suede normal/roughness maps onto every panel material.
  useEffect(() => {
    group.traverse((obj) => {
      if (!(obj as Mesh).isMesh) return;
      const mat = (obj as Mesh).material as MeshStandardMaterial | undefined;
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
