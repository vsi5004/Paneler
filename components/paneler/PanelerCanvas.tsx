"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

import type { PanelTopology } from "@/lib/types";
import { subdivideTopology } from "@/lib/mesh/subdivide";
import { projectToSphere } from "@/lib/mesh/projectToSphere";
import { buildMeshGroup } from "@/lib/mesh/buildMeshGroup";

const SPHERE_RADIUS = 2;
const SUBDIVISION_LEVELS = 6;

export default function PanelerCanvas({ topology }: { topology: PanelTopology }) {
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
      <primitive object={group} />
      <OrbitControls enablePan={false} minDistance={3} maxDistance={12} />
    </Canvas>
  );
}
