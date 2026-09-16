"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { TrackballControls } from "@react-three/drei";
import { useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type DirectionalLight,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  PointsMaterial,
  Vector3 as Vec3,
  type Mesh,
  type MeshStandardMaterial,
  type Texture,
} from "three";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";

import type { PanelColors } from "@/lib/types";
import { loadSuedeTextures } from "@/lib/mesh/suedeTexture";
import { generatePanelUVsOnGeometry } from "@/lib/mesh/panelUVs";

// Pixel drag threshold above which a pointer-down→pointer-up sequence is
// treated as a camera drag, not a panel click. Matches Footbag-3D-Visualizer.
const CLICK_DRAG_THRESHOLD = 5;
// A finger is not a mouse: even a deliberate tap wanders several pixels, and
// rotating the ball on a phone starts as a touch that has to travel before it
// reads as a drag. At 5px a touch rotation repaints the panel it started on.
// Measured against thumb taps on a 390px viewport; 12px keeps a tap a tap
// without making a slow drag paint.
const TOUCH_DRAG_THRESHOLD = 12;

function dragThreshold(pointerType: string): number {
  return pointerType === "touch" || pointerType === "pen"
    ? TOUCH_DRAG_THRESHOLD
    : CLICK_DRAG_THRESHOLD;
}
const SEAM_NODE_NAME = "__seams";

interface PanelerCanvasProps {
  /** The GLB bytes for the current design. Null while loading. */
  glbBytes: Uint8Array | null;
  panelColors: PanelColors;
  selectedPanelId: string | null;
  suedeEnabled: boolean;
  onPanelClick: (panelId: string) => void;
  /**
   * Opt-in still-image capture, used only by the public order form so the
   * stitcher's email can show the ball.
   *
   * preserveDrawingBuffer has a real cost on mobile GPUs - it forces the
   * browser to keep the framebuffer after compositing - so it is enabled ONLY
   * when a caller actually wants pictures, never for the main designer.
   */
  onCaptureReady?: (capture: (rotateY: number) => Promise<string | null>) => void;
}

export default function PanelerCanvas({
  glbBytes,
  panelColors,
  selectedPanelId,
  suedeEnabled,
  onPanelClick,
  onCaptureReady,
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
      camera={{ position: [0, 0, 8], fov: 45 }}
      gl={{ antialias: true, preserveDrawingBuffer: Boolean(onCaptureReady) }}
      className="flex-1"
    >
      {onCaptureReady && <CaptureRig onReady={onCaptureReady} />}
      <ambientLight intensity={0.6} />
      <CameraLights />
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
        zoomSpeed={3}
        minDistance={3}
        maxDistance={12}
        staticMoving
      />
    </Canvas>
  );
}

/** Stars that follow the camera so they stay fixed while the sphere rotates. */
function Starfield({ count = 200, radius = 50 }: { count?: number; radius?: number }) {
  const ref = useRef<THREE.Points>(null);
  const { geometry, material } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius * (0.8 + Math.random() * 0.2);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      const roll = Math.random();
      if (roll < 0.4) {
        colors[i * 3] = 0.7 + Math.random() * 0.15;
        colors[i * 3 + 1] = 0.75 + Math.random() * 0.15;
        colors[i * 3 + 2] = 0.9 + Math.random() * 0.1;
      } else if (roll < 0.7) {
        colors[i * 3] = 0.95 + Math.random() * 0.05;
        colors[i * 3 + 1] = 0.9 + Math.random() * 0.05;
        colors[i * 3 + 2] = 0.8 + Math.random() * 0.1;
      } else if (roll < 0.85) {
        colors[i * 3] = 0.95 + Math.random() * 0.05;
        colors[i * 3 + 1] = 0.75 + Math.random() * 0.15;
        colors[i * 3 + 2] = 0.3 + Math.random() * 0.2;
      } else {
        colors[i * 3] = 0.9 + Math.random() * 0.1;
        colors[i * 3 + 1] = 0.5 + Math.random() * 0.2;
        colors[i * 3 + 2] = 0.5 + Math.random() * 0.3;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const mat = new PointsMaterial({
      size: 0.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      vertexColors: true,
    });
    return { geometry: geo, material: mat };
  }, [count, radius]);

  // Keep the star sphere centered on the camera each frame
  useFrame(({ camera }) => {
    if (ref.current) {
      ref.current.position.copy(camera.position);
    }
  });

  return <points ref={ref} geometry={geometry} material={material} />;
}

// Offsets in camera-local space for key and fill lights.
const KEY_OFFSET = new Vec3(3, 5, 4);
const FILL_OFFSET = new Vec3(-3, -2, -4);
const _v = new Vec3(); // reusable scratch vector

/** Directional lights that follow the camera so the sphere is lit
 *  consistently regardless of orbit angle. */
function CameraLights() {
  const keyRef = useRef<DirectionalLight>(null);
  const fillRef = useRef<DirectionalLight>(null);
  useFrame(({ camera }) => {
    if (keyRef.current) {
      _v.copy(KEY_OFFSET).applyQuaternion(camera.quaternion).add(camera.position);
      keyRef.current.position.copy(_v);
      keyRef.current.target.position.set(0, 0, 0);
      keyRef.current.target.updateMatrixWorld();
    }
    if (fillRef.current) {
      _v.copy(FILL_OFFSET).applyQuaternion(camera.quaternion).add(camera.position);
      fillRef.current.position.copy(_v);
      fillRef.current.target.position.set(0, 0, 0);
      fillRef.current.target.updateMatrixWorld();
    }
  });
  return (
    <>
      <directionalLight ref={keyRef} intensity={1.2} />
      <directionalLight ref={fillRef} intensity={0.3} />
    </>
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

/**
 * Extract a panel mesh's boundary as line-segment geometry: the edges that
 * belong to exactly one triangle. Vertices are welded by quantized position
 * first — the subdivision grid duplicates interior fan-line vertices between
 * adjacent fan sectors (coincident positions, distinct indices), so a purely
 * index-based edge count would report every fan line as open and the outline
 * would spray across the panel interior.
 */
function buildOpenEdgesGeometry(geom: BufferGeometry): BufferGeometry {
  const pos = geom.getAttribute("position") as BufferAttribute;
  const index = geom.getIndex();

  // Weld by quantized position → representative vertex id.
  const weld = new Map<string, number>();
  const welded = new Array<number>(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = i;
      weld.set(key, id);
    }
    welded[i] = id;
  }

  // Triangle vertex ids after welding.
  let ids: ArrayLike<number>;
  if (index) {
    const arr = index.array;
    const mapped = new Array<number>(arr.length);
    for (let i = 0; i < arr.length; i++) mapped[i] = welded[arr[i]];
    ids = mapped;
  } else {
    ids = welded;
  }

  // Count occurrences per undirected edge; keep a representative (a, b).
  const counts = new Map<string, { a: number; b: number; n: number }>();
  for (let i = 0; i + 2 < ids.length; i += 3) {
    const tri = [ids[i], ids[i + 1], ids[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { a, b, n: 1 });
    }
  }

  const positions: number[] = [];
  for (const { a, b, n } of counts.values()) {
    if (n !== 1) continue;
    positions.push(
      pos.getX(a), pos.getY(a), pos.getZ(a),
      pos.getX(b), pos.getY(b), pos.getZ(b),
    );
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return out;
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
        // Border outline from the panel's OPEN edges (each panel is its own
        // mesh, so its true border is exactly the edges with only one
        // adjacent triangle). An angle-threshold EdgesGeometry broke here:
        // steep puff-bevel walls on large panels exceeded any threshold and
        // sprayed white lines across the panel interior.
        const edges = buildOpenEdgesGeometry(mesh.geometry);
        const lineMat = new LineBasicMaterial({ color: 0xffffff });
        const outline = new LineSegments(edges, lineMat);
        outline.raycast = () => {};
        outline.scale.setScalar(1.005);
        mesh.add(outline);
        outlineRef.current = outline;
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
        if (Math.hypot(dx, dy) > dragThreshold(e.pointerType)) return;
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

/**
 * Hands the parent a function that renders the scene from a given angle and
 * returns a PNG data URL.
 *
 * It must live INSIDE the Canvas: useThree only resolves within the R3F tree,
 * and the renderer is what holds the framebuffer being read back.
 *
 * The explicit gl.render() before reading is load-bearing. Even with
 * preserveDrawingBuffer the buffer holds whatever was composited last, so
 * moving the camera and immediately calling toDataURL captures the PREVIOUS
 * frame - which would silently email two identical pictures of the same side.
 */
function CaptureRig({
  onReady,
}: {
  onReady: (capture: (rotateY: number) => Promise<string | null>) => void;
}) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    const radius = camera.position.length();
    const original = camera.position.clone();

    onReady(async (rotateY: number) => {
      try {
        camera.position.set(
          Math.sin(rotateY) * radius,
          0,
          Math.cos(rotateY) * radius,
        );
        camera.lookAt(0, 0, 0);
        gl.render(scene, camera);
        const url = gl.domElement.toDataURL("image/png");
        camera.position.copy(original);
        camera.lookAt(0, 0, 0);
        gl.render(scene, camera);
        return url;
      } catch {
        // A tainted or lost context should cost the pictures, not the order.
        return null;
      }
    });
  }, [gl, scene, camera, onReady]);

  return null;
}
