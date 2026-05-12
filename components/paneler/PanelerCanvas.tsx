"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Color, type Group, type Mesh } from "three";

import type { PanelColors, PanelTopology } from "@/lib/types";
import { subdivideTopology } from "@/lib/mesh/subdivide";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { buildMeshGroup } from "@/lib/mesh/buildMeshGroup";

const SPHERE_RADIUS = 2;
const SUBDIVISION_LEVELS = 6;
// Pixel drag threshold above which a pointer-down→pointer-up sequence is
// treated as a camera drag, not a panel click. Matches Footbag-3D-Visualizer.
const CLICK_DRAG_THRESHOLD = 5;

interface PanelerCanvasProps {
  topology: PanelTopology;
  panelColors: PanelColors;
  onPanelClick: (panelId: string) => void;
}

export default function PanelerCanvas({
  topology,
  panelColors,
  onPanelClick,
}: PanelerCanvasProps) {
  const group = useMemo(() => {
    const subdivided = subdivideTopology(topology, SUBDIVISION_LEVELS);
    projectToSphere(subdivided, SPHERE_RADIUS);
    return buildMeshGroup(subdivided);
  }, [topology]);

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
        onPanelClick={onPanelClick}
      />
      <OrbitControls enablePan={false} minDistance={3} maxDistance={12} />
    </Canvas>
  );
}

function PanelGroup({
  group,
  panelColors,
  onPanelClick,
}: {
  group: Group;
  panelColors: PanelColors;
  onPanelClick: (panelId: string) => void;
}) {
  // Track pointer-down origin so we can distinguish click from camera drag.
  const downRef = useRef<{ x: number; y: number } | null>(null);

  // Sync per-panel material colors from React state whenever panelColors changes.
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
