# Scene validation subtool · 장면의 결

This is an optional validation tool inside **pointillism-gallery**, not a replacement for the root gallery. Open [`./index.html`](./index.html), or return to the [gallery](../../).

## Scope and limits

- The browser-local photo converter estimates monocular depth and saves a reusable **2.5D visible-surface mesh**. It does **not** reconstruct hidden surfaces, the back of an object, or a complete 360°/full-3D scene. Camera and scale are estimates.
- Surface dots are sampled on actual mesh triangles, with a fixed seed and exact point budget. Rotating the view keeps the same geometry and points. Reference-projected density and screen-compensated dot size are optional comparison aids, not confidence probabilities or perceptual-quality scores.
- **Full GPU scene completion is unverified.** This UI does not bundle or claim to have run a GPU completion pipeline. Synthetic fixtures are labeled synthetic, not photo reconstruction results.

## Run

Serve the repository over HTTP and open `/pointillism-gallery/tools/scene-validation/` when hosted under that repository prefix. All local assets use relative paths, including the `../../` gallery backlink; `file://` is not supported for ES modules.

Three.js and addons load at runtime from the CDN, pinned to **0.170.0**. The photo converter loads Transformers.js **3.5.1** and depth-model weights only when conversion is requested. The first conversion therefore needs network access and can be slow; “local” means photos are processed in the browser without uploading, not that the first run requires no downloads. No libraries or model weights are vendored here.

## Existing controls

1. **Local photo:** select a JPG/PNG/WebP (up to 20 MiB), then explicitly convert it to a visible-surface scene. Save the scene JSON for reuse without re-estimating depth.
2. **Saved scene:** open an inline scene JSON, or select a folder containing one `manifest.json` / `*.scene.json` and its local assets. Selection alone does not read or upload the scene. Local manifests reject external URLs and traversal; GLB assets must be embedded, uncompressed, static meshes.
3. **Synthetic check:** generate a sphere and plane in memory to check the renderer and sampler without a photograph or inference.
4. Compare surface/dots, visibility diagnostics, point budgets, density policies and point-size compensation. Use fit, reference view, front/±30°/rear views. Export scene JSON, point PLY, comparison PNG or validation JSON through their buttons. No sample scenes, photographs or exported outputs are included in this repository.
5. **Optional remote API:** the collapsed section preserves the original explicit server-origin, token and photo-consent workflow. Health GET requires a click; job POST requires both consent and the submit button. No API request is made automatically. Credentials remain in memory, not URLs or browser storage. A public static host does not provide this backend; HTTPS/mixed-content and CORS rules still apply. No remote generation or photo upload was performed while restructuring this tool.

## Source layout

- `index.html`: markup and pinned import map; `styles.css`: presentation.
- `src/app.js`: viewer, input handlers, local/remote scene loading and exports.
- `src/geometry/visible-surface.js`: depth-to-visible-mesh conversion.
- `src/inference/local-photo-converter.js`: lazy browser-local depth inference.
- `src/sampling/`: triangle sampling and fixed-reference density.
- `src/io/offline-scene.js`: local schema, path safety and validation reports.

From the repository root:

```sh
node --test tests/js/{surface-sampler,offline-scene,visible-surface,reference-density}.test.mjs
```

The suites exercise geometry, sampling, local-file safety, honest validation metadata, extraction and subpath resolution without fetching models or making API requests.
