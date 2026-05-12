# Paneler — Plan

Living roadmap for Paneler. Updated as scope, phase boundaries, or design decisions change.

For product-level "what is this and how do I run it" info, see [README.md](./README.md).

## Context

Paneler unifies three prior repos into one web app:

- [`Footbag-3D-Visualizer`](https://github.com/gwbischof/Footbag-3D-Visualizer) — Astro/React app that paints pre-baked Blender-generated GLB footbag models.
- [`paneler-old`](https://github.com/gwbischof/paneler-old) — Python tool that projects OBJ files onto a sphere and unfolds them into 2D cutting patterns.
- [`Footbag-Panel-Generator`](https://github.com/vsi5004/Footbag-Panel-Generator) — Vite/TS app that emits printable SVG cutting templates for individual panel shapes.

The new architecture: one Next.js app does 3D design (Phase 1) and 2D cutting-pattern generation (Phase 2), with shared panel topology between the two views. Python and Blender are removed; everything runs in JS in the browser.

## Phases

### Phase 1 — 3D Designer + Optional Auth *(current)*

Ship the 3D viewer with runtime panel generation. Auth.js v5 is wired in, optional, and off by default in local dev.

**Features:**
- Built-in shape library (tetrahedron, cube, octahedron, cuboctahedron, dodecahedron, icosahedron, soccer ball, GP(2,0)/42, GP(3,0)/92, GP(4,0)/162).
- OBJ file upload — any polyhedron whose faces become panels.
- Click-to-paint panels with a 21-color fabric palette + custom hex picker.
- Per-shape paint tools ("paint all hexagons", "fill unpainted", reset).
- Suede texture toggle with per-panel deterministic UV rotation.
- Light/dark background toggle.
- Export/import design JSON; shareable URL hash.
- Auth.js v5 with optional OIDC sign-in. Path `/app/*` is gated when `AUTH_SECRET` is set; the landing path `/` is public.
- **Auth-off mode**: setting `AUTH_DISABLED=true` (or omitting `AUTH_SECRET`) skips the proxy gate so anyone can use `/app/*`. Default for local dev and static-export preview builds.

**Out of scope for Phase 1** (deferred to Phase 2+):
- Puffed panels (panel-interior outward displacement).
- Seam stitching (sine-wave displacement along edges).
- Edge relaxation (hex-edge-ratio solver — produces footbag-style silhouettes vs uniform soccer ball).
- Live styling sliders (puff amount, stitch amplitude, subdivision count).
- 2D panel-net view and SVG cutting-pattern export.
- Per-user design persistence.

### Phase 2 — 2D Cutting Patterns + Static Preview Build

The "SVG renderer" that meshes with the 3D view: an unfolded flat layout of the panels, sharing the same panel ID space and color state. Click/paint syncs between 3D and 2D.

- Port spherical-unfold algorithm from `paneler-old` (Python → TS).
- 2D panel-net view as a sibling component reading from the same `PanelTopology` and `panelColors` state.
- View toggle: 3D ↔ 2D (selection preserved across toggle).
- SVG cutting-pattern export with seam allowance + stitch holes (port from `Footbag-Panel-Generator`).
- Print/laser-cut output (LaserWeb/LightBurn-compatible).

**Also in Phase 2 — static-export preview build**

Ship a second deploy target alongside the server build. The same codebase produces two artifacts:

| Target | Build | Auth | Notes |
|---|---|---|---|
| Server | `next build` (`output: "standalone"`) | Auth.js + OIDC, optional | Containerized; runs anywhere that runs Docker. |
| Static preview | `STATIC_EXPORT=1 next build` (`output: "export"`) | Always off (no server proxy) | Drop the `out/` directory on any static host (GitHub Pages, Netlify, S3, Cloudflare Pages, …). |

**Mechanism.** Next.js 16's static export supports the App Router. Most of the codebase already works statically — R3F is client-only, all topology/mesh code runs in the browser, designState is pure functions, the URL-hash share format is client-side. The only Phase 1 piece that can't run statically is the Auth.js middleware (renamed to **Proxy** in Next 16), and the static build excludes it by construction.

**Config approach.** A `STATIC_EXPORT=1` env var flips `next.config.ts` into export mode (`output: 'export'`, `images.unoptimized: true`, configurable `basePath` for project-page URLs). The `/app` route ships fully open.

**Trade-offs to keep in mind:**
- Static preview means anyone can use the full designer without an account. Acceptable for Paneler's purpose; revisit if abuse becomes a concern.
- Future Phase 3 persistence won't be available in the static build — designs only persist via URL hash / JSON export. That's already the Phase 1 behavior so no regression for preview users.
- The two builds must stay buildable from the same source. CI should run both on every push so divergence is caught immediately.

### Phase 3 — Per-user Persistence

Dual-backend storage layer selected by `DATABASE_URL`:
- `file:./paneler.db` → SQLite (standalone, no auth required — useful for self-host).
- `postgres://…` → Postgres (production deployments).

Schema sketch: `designs(id, owner_email, model_type, panel_colors_json, created_at, updated_at)`. App-side UI: "My Designs" list, save/load buttons.

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
| Soccer ball (32) | Hand-rolled `goldberg11()` via direct truncated-icosahedron construction (`lib/topology/goldberg.ts`). No third-party code. |
| GP(2,0)=42 / GP(3,0)=92 / GP(4,0)=162 | `goldbergClassI(m)` = sphericalize ∘ dual ∘ trisub_m ∘ icosahedron. `trisub` + `dual` adapted from [polyhedronisme](https://github.com/levskaya/polyhedronisme) (MIT). Attribution in `NOTICE`. |
| Class II/III Goldberg (GP(m,n), m≠0, n≠0, m≠n) | Not implemented; would handle chiral panel patterns. Defer until requested. |
| **Custom shapes** | **Open design question — see below.** |

### Geometry notes

- **No T-junctions** — build the subdivided icosahedral mesh *once* and group triangles by dual cell. Subdividing each panel face independently risks cracks at shared edges.
- **Recompute normals** after sphere projection — don't reuse pre-projection normals.
- **Goldberg panel winding** — `dualToTopology` produces some panels CCW-from-outside and some CW depending on the input triangle order; `buildMeshGroup` rejects wrong-wound panels by normalizing them at construction so raycasts hit the near hemisphere and back-face culling renders the right side.
- **Spherical-surface only in Phase 1** — every vertex (corner + interior) is on the sphere; no puff outward. Puff and stitch are Phase 4.
- **Seam-line offset** — panel-boundary lines are emitted at a slight radius boost outside the sphere (`SEAM_RADIUS_BOOST = 1.004`) so back-hemisphere seams don't bleed through front-facing panels.

## Key library decisions

| Concern | Decision | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Matches the rest of the stack; replaces Astro from the prior repo. |
| 3D engine | three.js (latest) | Industry standard for WebGL. |
| 3D React layer | `@react-three/fiber` ^9 | v8 hits a `ReactCurrentOwner` bug on React 19 / Next 15+ ([vercel/next.js#71836](https://github.com/vercel/next.js/issues/71836)). Add `transpilePackages: ['three']` in `next.config.ts`. |
| R3F SSR pattern | `dynamic({ssr:false})` from inside a `'use client'` wrapper | App Router footgun: `ssr:false` is disallowed in Server Components. |
| Camera controls | `TrackballControls` (not `OrbitControls`) | OrbitControls clamps polar angle to `[0, π]` so the sphere can't roll past the poles. Trackball allows free rotation. |
| UI primitives | shadcn/ui (Base UI v1 backend) | Base UI is the recommended primitive layer in 2026 (Radix lost momentum post-WorkOS acquisition). |
| Styling | Tailwind v4 | Note: `tailwindcss-animate` → `tw-animate-css`; default `border-color` is `currentColor`, always use `border-border`. |
| Motion | framer-motion | |
| 2D / SVG (Phase 2) | Raw React SVG + framer-motion, optional `d3-path` | Avoid svg.js / Snap.svg — imperative DOM libs fight React. |
| State | React hooks + pure functions | Port `designState.ts` from `Footbag-3D-Visualizer` verbatim. Already passes Vitest tests. |
| Auth | Auth.js v5 (optional, OIDC) | **NOT NextAuth v4.** v5 cookie prefix is `authjs.` (not `next-auth.`) and HKDF derivation differs. v5 also rejects GET on `/api/auth/signin/<provider>` — start sign-in via a `"use server"` action wrapping `signIn()`, not an anchor. Next.js 16 renamed `middleware.ts` to `proxy.ts`. |
| Tests | Vitest | |

## Auth flow (when enabled)

1. Visitor clicks "Sign in" → `<form action={serverAction}>` calls `signIn("oidc-provider", { redirectTo: "/app" })`.
2. Auth.js redirects to the configured OIDC provider, runs the OAuth flow, and lands at `/api/auth/callback/<provider>`.
3. Callback handler sets a JWE session cookie on the root path.
4. `redirect("/app")` lands the user in the designer.
5. `proxy.ts` on every `/app/*` request calls `auth()` → admits any valid session. Unauthed requests 307-redirect to `/`.

No subscription tier, no `isAdmin` check — any authenticated user is admitted.

**Auth-off mode.** The proxy short-circuits and lets every request through when:
- `AUTH_DISABLED=true` is set explicitly, **or**
- `AUTH_SECRET` is unset (the proxy has no key to decrypt sessions with anyway).

Three typical scenarios:

| Scenario | `AUTH_DISABLED` | `AUTH_SECRET` | Result |
|---|---|---|---|
| Local dev (`npm run dev`) | usually `true` in `.env.local` | unset | `/app/*` open, no OIDC |
| Static-export preview (Phase 2) | n/a — proxy doesn't exist in static export | n/a | `/app/*` open by construction |
| Auth-on deploy | unset | set | `/app/*` gated by Auth.js |

This matters for first-time contributors: they can clone, `npm install`, `npm run dev`, and have a fully functional designer without setting up any OIDC provider.

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
