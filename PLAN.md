# Paneler — Plan

Living roadmap for Paneler. Updated as scope, phase boundaries, or design decisions change.

For product-level "what is this and how do I run it" info, see [README.md](./README.md).

## Context

Paneler unifies three prior repos into one auth-gated web app + marketing landing:

- [`Footbag-3D-Visualizer`](https://github.com/gwbischof/Footbag-3D-Visualizer) — Astro/React app that paints pre-baked Blender-generated GLB footbag models.
- [`paneler-old`](https://github.com/gwbischof/paneler-old) — Python tool that projects OBJ files onto a sphere and unfolds them into 2D cutting patterns.
- [`Footbag-Panel-Generator`](https://github.com/vsi5004/Footbag-Panel-Generator) — Vite/TS app that emits printable SVG cutting templates for individual panel shapes.

The new architecture: one Next.js app does 3D design (Phase 1) and 2D cutting-pattern generation (Phase 2), with shared panel topology between the two views. Python and Blender are removed; everything runs in JS in the browser.

## Phases

### Phase 1 — 3D Designer + Auth + Deploy *(current)*

Ship the 3D viewer with runtime panel generation, gated behind auth at `paneler.app`.

**Features:**
- Built-in shape library (tetrahedron, cube, octahedron, cuboctahedron, dodecahedron, icosahedron, soccer ball, GP(2,0)/42, GP(2,1)/72, GP(3,0)/92).
- OBJ file upload — any polyhedron whose faces become panels.
- Click-to-paint panels with a 21-color fabric palette + custom hex picker.
- Per-shape paint tools ("paint all hexagons", "fill unpainted", reset).
- Suede texture toggle with per-panel deterministic UV rotation.
- Light/dark background toggle.
- Export/import design JSON; shareable URL hash.
- Auth.js v5 + Dex OIDC (Google sign-in). Path `/app/*` is gated in production; landing at `/` is public.
- **Auth-off mode**: setting `AUTH_DISABLED=true` (or omitting `AUTH_SECRET`) skips the proxy/middleware gate so anyone can use `/app/*`. Default for local dev and the Phase 2 GitHub Pages preview build. Production paneler.app sets `AUTH_DISABLED=false` (or unset, which is treated as "auth on" only when `AUTH_SECRET` is present).

**Out of scope for Phase 1** (deferred to Phase 2+):
- Puffed panels (panel-interior outward displacement).
- Seam stitching (sine-wave displacement along edges).
- Edge relaxation (hex-edge-ratio solver — produces footbag-style silhouettes vs uniform soccer ball).
- Live styling sliders (puff amount, stitch amplitude, subdivision count).
- 2D panel-net view and SVG cutting-pattern export.
- Per-user design persistence.

### Phase 2 — 2D Cutting Patterns + Public Preview Deploy

The "SVG renderer" that meshes with the 3D view: an unfolded flat layout of the panels, sharing the same panel ID space and color state. Click/paint syncs between 3D and 2D.

- Port spherical-unfold algorithm from `paneler-old` (Python → TS).
- 2D panel-net view as a sibling component reading from the same `PanelTopology` and `panelColors` state.
- View toggle: 3D ↔ 2D (selection preserved across toggle).
- SVG cutting-pattern export with seam allowance + stitch holes (port from `Footbag-Panel-Generator`).
- Print/laser-cut output (LaserWeb/LightBurn-compatible).

**Also in Phase 2 — Public GitHub Pages preview**

Ship a second deploy target alongside the auth-gated k3s production. The same codebase produces two artifacts:

| Target | URL | Build | Distribution | Auth |
|---|---|---|---|---|
| Production | `paneler.app/app` | container (Next.js server) | GHCR → ArgoCD → k3s | Auth.js + Dex |
| Public preview | `vsi5004.github.io/Paneler` (or `demo.paneler.app` CNAME) | `next build` with `output: 'export'` | GH Actions → `gh-pages` branch → GH Pages | None (preview is open) |

**Mechanism.** Next.js 16's static export supports the App Router. Most of the codebase already works statically — R3F is client-only, all topology/mesh code runs in the browser, designState is pure functions, the URL-hash share format is client-side. The only Phase 1 piece that can't run statically is the Auth.js middleware (renamed to **Proxy** in Next 16), and that's exactly what we want excluded from the public preview.

**Config approach.** A `STATIC_EXPORT=1` env var flips `next.config.ts` into export mode:
- `output: 'export'`, `images.unoptimized: true`, `basePath: '/Paneler'` (set for project-page URL; empty for custom domain).
- The proxy file is excluded from the static build via a conditional in `next.config.ts` (Next allows skipping middleware/proxy when statically exporting).
- The `/app` route ships fully open — anyone landing on the GH Pages URL goes straight to the designer.

**GH Actions workflow** (separate from the GHCR/k3s workflow):
```yaml
# .github/workflows/gh-pages.yml
on: { push: { branches: [main] } }
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions: { contents: read, pages: write, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci && STATIC_EXPORT=1 npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: out }
      - uses: actions/deploy-pages@v4
```

**Trade-offs to keep in mind:**
- Public preview means anyone can use the full designer without an account. Acceptable for Paneler's purpose; revisit if abuse becomes a concern.
- Future Phase 3 persistence (SQLite/Postgres) won't be available in the GH Pages build — designs only persist via URL hash / JSON export. That's already the Phase 1 behavior so no regression for preview users.
- The two builds must stay buildable from the same source. CI runs both on every push so divergence is caught immediately.

### Phase 3 — Per-user Persistence

Dual-backend storage layer selected by `DATABASE_URL`:
- `file:./paneler.db` → SQLite (standalone, no auth required — useful for self-host).
- `postgres://…` → Postgres (paneler.app prod, CNPG cluster).

Schema: `designs(id, owner_email, model_type, panel_colors_json, created_at, updated_at)`. App-side UI: "My Designs" list, save/load buttons.

### Phase 4 — Styling Realism

Add the visual fidelity deferred from Phase 1: puff, stitch wobble, edge relaxation. Expose as live sliders.

## Architecture

### Runtime mesh generation pipeline

All shapes — built-ins and uploads — flow through the same pipeline. No pre-baked GLB files.

```
PanelTopology  →  Subdivide  →  ProjectToSphere  →  BufferGeometry  →  R3F
```

`PanelTopology` is the source-of-truth data structure:

```ts
type PanelShape = 'triangle' | 'quad' | 'pentagon' | 'hexagon' | 'polygon';

interface PanelTopology {
  vertices: Vector3[];                                                // shared pool
  panels: { id: string; vertexIndices: number[]; shape: PanelShape }[];
  edges: { vertexA: number; vertexB: number; panelA: string; panelB: string }[];
}
```

This same structure feeds the Phase 2 SVG view. The 3D and 2D renderers share state and panel IDs.

### Topology sources

| Shape | Source |
|---|---|
| Tetra, cube, octa, cubocta, dodeca, icosa | Hand-coded vertex tables |
| Soccer ball (32), 42, 72, 92, … | `goldberg(m, n)` — vendor [`@flyskypie/goldberg-polyhedron`](https://www.npmjs.com/package/@flyskypie/goldberg-polyhedron) or transliterate Babylon.js's `CreateGoldberg`. |
| **Custom shapes** | **Open design question — see below.** |

### Geometry notes

- **No T-junctions** — build the subdivided icosahedral mesh *once* and group triangles by dual cell. Subdividing each panel face independently risks cracks at shared edges.
- **Recompute normals** after sphere projection — don't reuse pre-projection normals.
- **Spherical-surface only in Phase 1** — every vertex (corner + interior) is on the sphere; no puff outward. Puff and stitch are Phase 4.

## Key library decisions

| Concern | Decision | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Matches the rest of the stack; replaces Astro from the prior repo. |
| 3D engine | three.js (latest) | Industry standard for WebGL. |
| 3D React layer | `@react-three/fiber` ^9 | v8 hits a `ReactCurrentOwner` bug on React 19 / Next 15+ ([vercel/next.js#71836](https://github.com/vercel/next.js/issues/71836)). Add `transpilePackages: ['three']` in `next.config.js`. |
| R3F SSR pattern | `dynamic({ssr:false})` from inside a `'use client'` wrapper | App Router footgun: `ssr:false` is disallowed in Server Components. |
| UI primitives | shadcn/ui (Base UI v1 backend) | Base UI is the recommended primitive layer in 2026 (Radix lost momentum post-WorkOS acquisition). |
| Styling | Tailwind v4 | Note: `tailwindcss-animate` → `tw-animate-css`; default `border-color` is `currentColor`, always use `border-border`. |
| Motion | framer-motion | |
| 2D / SVG (Phase 2) | Raw React SVG + framer-motion, optional `d3-path` | Avoid svg.js / Snap.svg — imperative DOM libs fight React. |
| State | React hooks + pure functions | Port `designState.ts` from `Footbag-3D-Visualizer` verbatim. Already passes Vitest tests. |
| Auth | Auth.js v5 + Dex OIDC | **NOT NextAuth v4.** v5 cookie prefix is `authjs.` (not `next-auth.`) and HKDF derivation differs. Share a tiny `auth.ts` module between this repo and `paneler-business`; use the v5 `auth()` helper inside `proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`). |
| Tests | Vitest | |

## Repos

- **`vsi5004/Paneler`** (this repo) — the 3D app.
- **`gwbischof/paneler-business`** (private) — marketing landing page at `paneler.app/`. Uses the NYFA design system (Bebas Neue / DM Sans, OKLCH neon green primary, dark forced).

## Deployment

| | App (this repo) | Landing (`paneler-business`) |
|---|---|---|
| Container | `ghcr.io/vsi5004/paneler:<sha>` | `registry.korroni.com/paneler-business:<sha>` |
| GH Actions | Build on push to `main` | Build on push to `main` |
| K8s manifests | `~/code/kube/prod/paneler/paneler-app.yml` | `~/code/kube/prod/paneler/paneler-landing.yml` |
| ArgoCD app | `~/code/kube/prod/paneler/argocd-app.yml` | (same) |
| Namespace | `paneler` | `paneler` |
| Domain | `paneler.app/app/*` | `paneler.app/` |

Single Traefik ingress at `paneler.app` with path-based routing (longest prefix first):

| Path | Service |
|---|---|
| `/api/auth/*` | `paneler-landing` (Auth.js routes) |
| `/app/*` | `paneler-app` |
| `/` (catch-all) | `paneler-landing` |

Both services share `AUTH_SECRET` and `AUTH_URL=https://paneler.app` via a single `paneler-secrets` k8s Secret synced from 1Password. The session cookie set by the landing-side Auth.js callback is automatically readable by the app side (same root host, default cookie `Path=/`).

Rate-limit middleware: 60 req/min avg, 120 burst (matches the fancy-waitlist pattern).

TLS: cert-manager DNS-01 challenge via a scoped Cloudflare API Token (`Zone:DNS:Edit` on `paneler.app`). Controller args include `--dns01-recursive-nameservers=1.1.1.1:53,9.9.9.9:53 --dns01-recursive-nameservers-only=true` to dodge split-horizon DNS issues.

## Auth flow

1. Visitor lands on `paneler.app/`.
2. Clicks "Sign In" → Auth.js v5 → Dex at `dex.korroni.com` → Google.
3. Dex callback → landing `/api/auth/callback/dex-google` → JWE session cookie set at `paneler.app` root.
4. Landing's session check → `redirect("/app")`.
5. App `proxy.ts` calls `auth()` → admits any valid session. Unauthed requests to `/app/*` 307-redirect back to `paneler.app/`.

No subscription tier, no `isAdmin` check — any authenticated user is admitted.

**Auth-off mode.** The proxy short-circuits and lets every request through when:
- `AUTH_DISABLED=true` is set explicitly, **or**
- `AUTH_SECRET` is unset (the proxy has no key to decrypt sessions with anyway).

Three deployment scenarios:

| Scenario | `AUTH_DISABLED` | `AUTH_SECRET` | Result |
|---|---|---|---|
| Local dev (`npm run dev`) | usually `true` in `.env.local` | unset | `/app/*` open, no Dex |
| GitHub Pages preview (Phase 2) | n/a — proxy doesn't exist in static export | n/a | `/app/*` open by construction |
| Production `paneler.app` | unset | set via k8s Secret | `/app/*` gated by Auth.js + Dex |

This matters for first-time contributors: they can clone, `npm install`, `npm run dev`, and have a fully functional designer without setting up Dex or copying secrets. Same property holds for the public GH Pages preview.

## Open design questions

These are unresolved decisions blocking implementation work. Each lists the candidates and trade-offs as we currently see them; pick (or merge) approaches in follow-up PRs.

### How do users define custom panel shapes?

Built-in shapes (presets + Goldberg) cover the common cases. For anything beyond that we need a "user-defined shape" path. Two candidates so far:

**Option A — OBJ file upload**

User authors a polyhedron in Blender/MeshLab/whatever, exports OBJ, drags it into Paneler. The OBJ's faces become the panels.

- **Pros:** Familiar pattern. Reuses existing 3D-modelling tools. Implementation is ~30 LOC (hand-rolled face parser preserving n-gon arity — `three-stdlib`'s `OBJLoader` fan-triangulates and is unsuitable as a topology source).
- **Cons:** Requires the user to know an external tool. Users without 3D-modelling background can't make custom bags. Doesn't enforce that faces sit on a sphere.

**Option B — Coloring on the sphere surface**

User paints arbitrary regions on the sphere with a brush directly in Paneler. Each contiguous painted region becomes a panel; region boundaries become panel edges. Topology *emerges* from paint strokes instead of being declared in a separate tool.

- **Pros:** No external tools. Lowest barrier — anyone who can paint can design a bag. Highly creative — you can draw stylised non-symmetric layouts that no polyhedron-based approach can express. Naturally produces curved panel boundaries on the sphere (no flat-face approximation).
- **Cons:** Harder to implement. Needs: an offscreen sphere-aligned paint buffer (cubemap or unwrapped UV texture), a region-extraction step to turn pixel regions into vector boundaries, a boundary-smoothing/simplification step, and a way to ensure regions are well-formed (closed, non-self-intersecting). The result must still produce a valid `PanelTopology` for the rest of the pipeline.

The two are **not mutually exclusive** — we could ship both as alternate input methods. Decision and prioritization pending. Also worth considering a third option (a panel-count slider that picks a Goldberg `(m, n)` — already in the plan via the Goldberg generator, but UI-wise a slider would be a low-effort addition).

## Document conventions

- **README.md** stays user-/developer-facing: what Paneler is, how to run it, how to develop on it.
- **PLAN.md** stays collaborator-facing: roadmap, phase scope, design decisions, deferred work.
- Both are living documents. PRs that change scope, stack, or structure should update both.
