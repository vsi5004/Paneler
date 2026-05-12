# Paneler

An online tool for designing and producing cutting templates for sewn spherical objects — footbags, juggling balls, and similar.

Live at **[paneler.app](https://paneler.app)** (once deployed).

## What it does

- **3D Designer** — interactive 3D viewer for spherical panel layouts. Click panels to paint them; rotate to inspect; toggle suede texture; share designs by URL.
- **Runtime panel generation** — built-in shape library (tetrahedron through 92+ panel Goldberg bags) generated procedurally in JS. No pre-baked models.
- **OBJ upload** — bring your own polyhedron; every face becomes a clickable panel.
- **2D cutting patterns** *(coming)* — unfold the 3D design into a flat SVG cutting template with seam allowance and stitch holes, ready for laser cutting.

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
app/                     # Next.js App Router pages
components/              # React components
  paneler/               # The 3D designer (Canvas, Model, UI)
lib/
  topology/              # Panel-graph generators (presets, Goldberg, OBJ parser)
  mesh/                  # subdivide → projectToSphere → buildMeshGroup
  designState.ts         # Pure-function state helpers (ported from Footbag-3D-Visualizer)
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
