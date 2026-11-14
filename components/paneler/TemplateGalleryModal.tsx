"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { GLTFLoader } from "three-stdlib";

interface TemplateEntry {
  slug: string;
  label: string;
  glbPath: string;
  panelCount: number;
  shapeSignature: string;
}

interface TemplateGalleryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: TemplateEntry[];
  onSelect: (slug: string) => void;
}

export function TemplateGalleryModal({
  open,
  onOpenChange,
  templates,
  onSelect,
}: TemplateGalleryModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] border-border bg-[oklch(0.08_0_0)] p-0 xl:max-w-7xl">
        <DialogHeader className="border-b border-hairline px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
            <DialogTitle className="font-heading text-xl tracking-[0.22em] text-foreground">
              SPECIMEN CATALOG
            </DialogTitle>
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70">
            Select a topology to instantiate · {templates.length} archived
          </p>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {templates.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12">
              <span className="size-2 animate-pulse rounded-full bg-primary shadow-[0_0_10px_var(--primary)]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/70">
                Loading specimens…
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {templates.map((t, i) => (
                <SpecimenCard
                  key={t.slug}
                  index={i}
                  template={t}
                  visible={open}
                  onSelect={() => {
                    onSelect(t.slug);
                    onOpenChange(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SpecimenCard({
  index,
  template,
  visible,
  onSelect,
}: {
  index: number;
  template: TemplateEntry;
  visible: boolean;
  onSelect: () => void;
}) {
  const serial = `TPL-${String(index + 1).padStart(3, "0")}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ animationDelay: `${index * 35}ms` }}
      className="specimen-card group relative flex flex-col items-stretch overflow-hidden rounded-sm border border-border bg-[oklch(0.1_0.003_85)] p-3 text-left transition-all duration-200 hover:border-primary/60 hover:bg-[oklch(0.12_0.005_85)]"
    >
      <CornerBracket position="tl" />
      <CornerBracket position="tr" />
      <CornerBracket position="bl" />
      <CornerBracket position="br" />

      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground/60 transition-colors group-hover:text-primary/80">
          {serial}
        </span>
        <span className="size-1 rounded-full bg-muted-foreground/30 transition-all group-hover:bg-primary group-hover:shadow-[0_0_6px_var(--primary)]" />
      </div>

      <div className="relative mx-auto my-2 aspect-square w-full max-w-[140px]">
        {visible ? (
          <GlbThumbnail glbPath={template.glbPath} label={template.label} />
        ) : (
          <div className="size-full rounded bg-muted/10" />
        )}
      </div>

      <div className="mt-2 text-center">
        <h3 className="font-heading text-base tracking-[0.18em] text-foreground/95 transition-colors group-hover:text-primary">
          {template.label}
        </h3>
      </div>

      <div className="mt-3 border-t border-hairline pt-2">
        <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <span>Panels</span>
          <span className="text-foreground/80">{template.panelCount}</span>
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
          <span>Shape</span>
          <span className="font-mono text-[9px] text-foreground/70">
            {template.shapeSignature}
          </span>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 translate-y-full bg-primary py-1 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-primary-foreground transition-transform duration-200 group-hover:translate-y-0">
        Instantiate →
      </div>
    </button>
  );
}

function CornerBracket({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  const map = {
    tl: "left-1 top-1 border-l border-t",
    tr: "right-1 top-1 border-r border-t",
    bl: "left-1 bottom-1 border-l border-b",
    br: "right-1 bottom-1 border-r border-b",
  };
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute size-2 border-primary/50 transition-colors duration-200 group-hover:border-primary ${map[position]}`}
    />
  );
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const sceneCache = new Map<string, Group>();

// Thumbnails are still images drawn by one shared renderer. A live canvas
// per card meant a WebGL context per template, and browsers keep only ~16:
// past that the oldest cards' contexts were dropped and showed as broken.
// The hovered card alone gets a live, spinning canvas.
const SNAPSHOT_PX = 280;
const CAMERA = { fov: 30, near: 0.1, far: 100, z: 4 };
/** The still's turn about the vertical; the live canvas starts here too. */
const SNAPSHOT_TURN = 0.6;
const snapshotCache = new Map<string, string>();
let snapshotRenderer: WebGLRenderer | null = null;

/** Center a model and scale its largest side to 1.8, as the card frames it. */
function fitModel(obj: Object3D) {
  const box = new Box3().setFromObject(obj);
  const center = new Vector3();
  box.getCenter(center);
  obj.position.sub(center);
  const size = new Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) obj.scale.setScalar(1.8 / maxDim);
}

/** The model as a still image, lit and framed like the live canvas. */
function snapshot(glbPath: string, scene: Group): string {
  const cached = snapshotCache.get(glbPath);
  if (cached) return cached;
  // Match the live canvas's (react-three-fiber's) renderer defaults.
  snapshotRenderer ??= new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  const renderer = snapshotRenderer;
  renderer.setSize(SNAPSHOT_PX, SNAPSHOT_PX, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const stage = new Scene();
  stage.add(new AmbientLight(0xffffff, 0.6));
  const key = new DirectionalLight(0xffffff, 1.0);
  key.position.set(3, 4, 5);
  const fill = new DirectionalLight(0xffffff, 0.3);
  fill.position.set(-2, -1, -3);
  stage.add(key, fill);
  const model = scene.clone();
  fitModel(model);
  model.rotation.y = SNAPSHOT_TURN;
  stage.add(model);

  const camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(0, 0, CAMERA.z);
  renderer.render(stage, camera);
  const url = renderer.domElement.toDataURL("image/png");
  snapshotCache.set(glbPath, url);
  return url;
}

function GlbThumbnail({ glbPath, label }: { glbPath: string; label: string }) {
  const [scene, setScene] = useState<Group | null>(
    () => sceneCache.get(glbPath)?.clone() ?? null,
  );
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (sceneCache.has(glbPath)) {
      setScene(sceneCache.get(glbPath)!.clone());
      return;
    }
    let cancelled = false;
    fetch(BASE + glbPath)
      .then((r) => r.arrayBuffer())
      .then((ab) => {
        if (cancelled) return;
        const loader = new GLTFLoader();
        loader.parse(
          ab,
          "",
          (gltf) => {
            if (cancelled) return;
            gltf.scene.traverse((obj: Object3D) => {
              if (obj.name === "__seams") {
                obj.visible = false;
              }
            });
            sceneCache.set(glbPath, gltf.scene);
            setScene(gltf.scene.clone());
          },
          (err) => {
            if (!cancelled) console.error("GLB thumb load error", err);
          },
        );
      })
      .catch((err) => {
        if (!cancelled) console.error("GLB thumb fetch error", err);
      });
    return () => {
      cancelled = true;
    };
  }, [glbPath]);

  if (!scene) {
    return (
      <div className="flex size-full items-center justify-center">
        <span className="size-2 animate-pulse rounded-full bg-primary/40" />
      </div>
    );
  }

  return (
    <div
      className="size-full"
      onPointerEnter={() => setLive(true)}
      onPointerLeave={() => setLive(false)}
    >
      {live ? (
        <Canvas
          frameloop="always"
          gl={{ antialias: true, alpha: true }}
          camera={{ fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far, position: [0, 0, CAMERA.z] }}
          style={{ background: "transparent" }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 4, 5]} intensity={1.0} />
          <directionalLight position={[-2, -1, -3]} intensity={0.3} />
          <AutoRotatingModel scene={scene} />
        </Canvas>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data URL, not an asset to optimize
        <img src={snapshot(glbPath, scene)} alt={label} className="size-full" draggable={false} />
      )}
    </div>
  );
}

function AutoRotatingModel({ scene }: { scene: Group }) {
  const ref = useRef<Group>(null);

  useEffect(() => {
    if (!ref.current) return;
    fitModel(ref.current);
    ref.current.rotation.y = SNAPSHOT_TURN;
  }, [scene]);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.5;
    }
  });

  return <primitive ref={ref} object={scene} />;
}
