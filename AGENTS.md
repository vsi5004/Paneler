<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:paneler-data-model -->
# GLB is the source of truth

A Paneler design is a binary glTF (`.glb`). Geometry, panel boundaries, and per-panel colors all live inside the GLB — one mesh primitive per panel, one material per primitive, colors as `baseColorFactor`. The `__seams` node is a single LINES primitive baked alongside the panels; it has no `panelId`.

- Canonical panel identity is on `node.extras.panelId` (e.g. `"panel_001_pentagon"`) and mirrored in the material name (`panel_001_pentagon_mat`). Not on `primitive.extras` — Three.js GLTFLoader can drop those when geometry attributes are shared (issues #14343, #29768, #29753).
- The Postgres `designs` row is metadata only (`name`, `glb_key`, `panel_count`, `palette_hash`, `shape_signature`, `starred`, `published`, …). The GLB itself lives in Cloudflare R2 at `designs/{id}.glb`. Bytes flow client ↔ R2 directly via short-lived presigned URLs minted by `app/api/designs/[id]/glb*` routes — never proxied through the pod.
- Static-export mode is files-only: templates ship in `/public/presets/` (output of `npm run bake:glb`), the user saves/opens designs from their own disk via the File System Access API (`browser-fs-access` wraps the fallback for Firefox/Safari).
- There is no `modelType` field, no `panelColors` JSON record, no OBJ parser, no URL-hash share codec. If you find yourself reaching for any of those, you are reaching for a deleted concept.
- `PanelTopology` is a runtime structure parsed from the GLB by `lib/topology/gltf.ts` — used by the flat unwrap view. It is not persisted.
- Color mutation: `material.color.set(hex)` on the live Three.js material for instant render, and `setMaterialColor(document, panelId, hex)` on the parallel `@gltf-transform/core` Document so the next `serialize()` captures the change. `useGlbDesign` keeps both in sync; React state (`panelColors`) is the source of truth at edit time and gets mirrored into the GLB document by an effect.
- R2 client config sets `requestChecksumCalculation: "WHEN_REQUIRED"` (AWS SDK v3 ≥ 3.729 sends CRC32 by default that R2 historically rejected) and presigned PUT URLs do not include `Content-Type` in signed headers (otherwise browsers trip silent `SignatureDoesNotMatch` 403s).
<!-- END:paneler-data-model -->
