# Paneler

An online tool for designing and producing cutting templates for sewn spherical objects — footbags, juggling balls, and similar.

Live at **[paneler.app](https://paneler.app)** (once deployed).

## What it does

- **3D Designer** — interactive 3D viewer for spherical panel layouts. Click panels to paint them with a 21-color fabric palette (or any custom hex); per-shape paint tools ("paint all hexagons", "fill unpainted", reset); per-panel coloring is carried over from [Footbag-3D-Visualizer](https://github.com/gwbischof/Footbag-3D-Visualizer).
- **Runtime panel generation** — built-in shape library (tetrahedron through 92+ panel Goldberg bags) generated procedurally in JS. No pre-baked models.
- **Custom panel shapes** *(design still being figured out)* — see [Open design questions](#open-design-questions) below. Two ideas in play: OBJ file upload (each face = a panel), or coloring-on-the-sphere (paint regions directly on the sphere surface, and the regions themselves become the panels).
- **2D cutting patterns** *(coming)* — unfold the 3D design into a flat SVG cutting template with seam allowance and stitch holes, ready for laser cutting.

## Open design questions

These need to be settled before the corresponding implementation work starts. See [PLAN.md](./PLAN.md#open-design-questions) for context and trade-offs.

- **How do users define custom panel shapes?** Two candidates:
  1. **OBJ upload** — user uploads a polyhedron file; each face becomes a clickable panel. Familiar pattern, leans on existing OBJ tools (Blender, MeshLab, etc.). Limited to whatever the user can build in another program.
  2. **Coloring on the sphere surface** — user paints arbitrary regions directly on the sphere with a brush; each contiguous region becomes a panel. No external tool needed; very approachable. Implementation is harder (region extraction, boundary tracing, topology emerging from paint strokes).
  
  The two are not mutually exclusive — we could support both. Decision pending.

## Status

**Phase 1 (in progress):** 3D designer + auth + deploy. See [PLAN.md](./PLAN.md) for the full roadmap and phase-by-phase scope.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| 3D | `three.js`, `@react-three/fiber` ^9, `@react-three/drei` |
| UI | Tailwind v4, shadcn/ui, framer-motion |
| Auth | Auth.js v5 + Dex OIDC |
| Tests | Vitest |
| Deploy | GitHub Actions → GHCR → ArgoCD → k3s |

Companion landing page: [`paneler-business`](https://github.com/gwbischof/paneler-business) (separate private repo, served at `paneler.app/`).

## Repo layout

```
app/
  page.tsx               # Public marketing-y landing for the app sub-route
  app/page.tsx           # The 3D designer (gated by /app/* middleware in prod)
  layout.tsx, globals.css
components/
  paneler/               # PanelerDesigner (client wrapper), PanelerCanvas (R3F)
  ui/                    # shadcn primitives (button, card, popover, slider, …)
lib/
  topology/              # Panel-graph generators (presets, Goldberg, OBJ parser)
  mesh/                  # subdivide → projectToSphere → buildMeshGroup
  utils.ts               # cn() helper
public/textures/         # Suede normal + roughness maps
__tests__/               # Vitest
```

## Development

Requires Node 20+ and npm.

```bash
npm install
npm run dev              # http://localhost:3000
npm run build            # production build
npm test                 # vitest
npm run lint             # eslint
```

To work on the gated `/app/*` routes locally without going through Dex, set `AUTH_DISABLED=true` in `.env.local`.

## Deployment

Push to `main` → GitHub Actions builds a container, pushes to `ghcr.io/vsi5004/paneler:<sha>` → ArgoCD picks up the new tag → rolling deploy to the k3s cluster at `paneler.app/app/*`.

See [PLAN.md](./PLAN.md) for the full infra topology (ingress, Dex client, cert-manager, etc.).

## License

See [LICENSE](./LICENSE).
