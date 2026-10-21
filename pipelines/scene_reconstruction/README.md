# One-shot scene reconstruction (GPU path, unverified)

This optional, source-derived CLI converts one local photo into saved meshes and a manifest, then exits. There is no permanent server, FastAPI app, or API token. It is separate from the executable visible-surface baseline in `tools/scene-validation`.

**Actual SAM 3D / SAM2 / LaMa GPU inference has never been executed or validated for this delivery.** No checkpoints, input photos, generated scenes, private configuration, or secrets are bundled. Passing CLI tests does not establish that model loading, CUDA rasterization, mesh generation, or reconstruction quality works.

## External GPU setup required

Review [model sources, pinned revisions, setup and license boundaries](../../docs/model-sources.md) before installation or use. Install the official SAM 3D Objects and SAM2 environments, compatible PyTorch/CUDA and PyTorch3D, and their model-specific/native dependencies externally. This repository does not install these components or download model weights. `requirements.txt` contains only NumPy, Pillow (the `PIL` import), and trimesh for CPU-side geometry/export helpers. It is **not** a complete model runtime.

The audited official SAM 3D setup requires Linux 64-bit and an NVIDIA GPU with at least 32 GB VRAM. That is an upstream prerequisite, not a tested memory guarantee for this combined pipeline. There is no CPU inference fallback. The adapter checks SAM 3D revision `f91db411c50efee93d8db7aeb323885650f6f722` and uses a private helper, so source/runtime compatibility still needs a real integration test. Approved local checkpoint access, cached model dependencies and LaMa checkpoint provenance/license review are operator responsibilities. A matching SHA-256 does not establish trust or license clearance.

### Expected environment (placeholders only)

Replace these illustrative values with operator-vetted local files outside the repository. Do not commit actual environment values or credentials.

```sh
export SAM3D_REPO='<local-sam3d-checkout>'
export SAM3D_CONFIG='<local-sam3d-checkpoint-directory>/pipeline.yaml'
export SAM2_CHECKPOINT='<local-checkpoints>/sam2.1_hiera_small.pt'
export SAM2_CONFIG='configs/sam2.1/sam2.1_hiera_s.yaml'
export LAMA_CHECKPOINT='<local-checkpoints>/vetted-lama-torchscript.pt'
export LAMA_SHA256='<64-hex-digit-sha256-of-vetted-checkpoint>'
```

`SAM2_CONFIG` defaults to the value shown. The preflight checks required path existence, hash syntax and CUDA availability only. It does not validate checkpoint contents, LaMa's actual digest, pinned source compatibility, native dependencies or quality. The LaMa digest and SAM 3D revision are checked later by their adapters.

## CLI

From the repository root, in the separately prepared environment:

```sh
PYTHONPATH=. python3 -m pipelines.scene_reconstruction.batch --check-environment
PYTHONPATH=. python3 -m pipelines.scene_reconstruction.batch \
  --input '<local-photo>.jpg' --output pipelines/outputs/new-run \
  --max-objects 4 --candidates 2 --seed 42 --sampling-seed 42 \
  --point-budget 8000 --max-side 1024
```

- `--check-environment`: print preflight JSON without inference; input/output are optional in this mode. Inspect `preflight_ready`, not just the process exit code.
- `--input`, `--output`: required for conversion; JPEG/PNG/WebP, at most 20 MiB, each side at least 64 pixels, at most 50 megapixels. EXIF orientation is applied. Output must be new or empty; existing runs are never overwritten.
- `--max-objects`: 1–8, default 4; automatic masks are not semantic object labels.
- `--candidates`: 1–3 per object, default 2.
- `--seed`: candidate-generation base seed, default 42.
- `--sampling-seed`: independent saved surface-sampling seed, default 42. Both seed flags accept 0–2147483647.
- `--point-budget`: saved sampling budget, 1000–150000, default 8000; this does not itself export a point cloud.
- `--max-side`: working image limit, 256–1024, default 1024.

The CLI does not set up models or fetch checkpoints. It defaults `HF_HUB_OFFLINE` and `TRANSFORMERS_OFFLINE` to `1` before conversion, unless already set by the operator; this is not a general network sandbox. Prepare approved local model caches first. A preflight failure does not create an output directory or claim conversion. Later runtime failures may leave partial files plus a failed conversion record; choose a new output directory when retrying.

Successful conversion is intended to write `manifest.json`, object/background GLBs and per-vertex support tags, working/reference images, `conversion-record.json`, and `validation-plan.json`. Use the ignored `pipelines/outputs/` or `pipelines/runs/` locations; scoped ignore rules exclude those outputs and local checkpoints/caches. Never stage generated/private files from arbitrary alternative output locations.

Generated unseen object surfaces are hypotheses. The background is a front-oriented layered surface, not a recovered 360-degree room. Reference-visible tags and consistency costs are neither ground truth nor calibrated probabilities. A saved validation plan is explicitly `not_evaluated`; a successful conversion would not verify quality.

## Tests and execution boundary

Use a writable temporary directory **outside the repository** for both `TMPDIR` and `PYTHONPYCACHEPREFIX`, then run:

```sh
PYTHONPATH=. python3 -m unittest discover -s tests/python -p test_batch_stdlib.py
```

The 10 standard-library tests cover argument parsing/defaults/bounds, independent seeds, local model path/hash syntax checks, input hashing, honest validation metadata, output non-overwrite and safe blocked preflight. They do not load models or execute GPU inference.

`tests/python/test_core.py` contains 9 additional CPU-side NumPy/trimesh geometry/export tests. They require the minimal helper dependencies and are separate from the dependency-free suite. They do not test GPU adapters, CUDA rasterization, native installation or model quality. During this migration, the 10 standard-library tests and Python syntax compilation passed; the core suite could not import because NumPy was absent. No dependencies were installed to bypass that blocker.

## Visible-only conversion script

The independent `scripts/convert-visible.mjs` imports `createVisibleSurface` directly from `tools/scene-validation/src/geometry/visible-surface.js`, without the old wrapper. It reads an existing local RGB/depth JSON grid; it does not estimate depth or invoke SAM 3D.

```sh
node scripts/convert-visible.mjs \
  --input '<local-rgb-depth>.json' --output pipelines/outputs/new.scene.json \
  --max-side 256 --budget 8000 --seed 42
```

Optional `--source '<local-photo>.jpg'` records only the file basename and SHA-256. This path exports a visible 2.5D surface, not completed hidden geometry, and refuses an existing output file.

Migration smoke checks also verified the direct-import visible converter on a synthetic 2×2 RGB/depth fixture (4 vertices, 2 triangles, saved budget/seed), plus existing-output refusal with unchanged output bytes. This was not photo inference or a perceptual-quality test. Temporary fixtures and bytecode caches were kept outside the repository.
