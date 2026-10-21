# Source audit and model boundaries

These sources were inspected to design the integration. No third-party model weights or source repositories are bundled. The SAM3D/SAM2/LaMa GPU integration was not executed. The browser-only visible-surface baseline was executed separately, as recorded below.

## SAM 3D Objects

- Official repository: https://github.com/facebookresearch/sam-3d-objects
- Audited commit: `f91db411c50efee93d8db7aeb323885650f6f722`
- Setup: https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/doc/setup.md
- Notebook wrapper: https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/notebook/inference.py
- Public call: `Inference(config_file, compile=False)(image, mask, seed=..., pointmap=...)`
- Complete object generation is separate from the earlier browser SlimSAM segmentation feature.
- Linux 64-bit and at least 32GB NVIDIA VRAM are official prerequisites. This does not establish memory requirements of the combined pipeline.
- Checkpoint access requires user-side approval/authentication. SAM License is custom, not MIT/Apache. Review the license before installation/use; research publications using SAM Materials must acknowledge it.
- License: https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/LICENSE

### Frame conversion, from inspected source

For row vectors, canonical GLB axes are undone with `A.T`, then official `compose_transform(scale, rotation, translation)` is applied, then `F=diag(-1,-1,1)` changes PyTorch3D camera to OpenCV camera. The shared pointmap uses the same F.

- GLB axis conversion: https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/sam3d_objects/model/backbone/tdfy_dit/utils/postprocessing_utils.py
- Official inverse and layout: https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/sam3d_objects/pipeline/layout_post_optimization_utils.py
- Pose order: https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/sam3d_objects/data/dataset/tdfy/transforms_3d.py
- MoGe/PyTorch3D signs: https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/notebook/mesh_alignment.py
- Pointmap/K helper: https://github.com/facebookresearch/sam-3d-objects/blob/f91db411c50efee93d8db7aeb323885650f6f722/sam3d_objects/pipeline/inference_pipeline_pointmap.py

The current wrapper disables mesh, texture-baking, and layout postprocessing. The internal MoGe uses `force_projection=False`. K and pointmaps are estimated and may not reproject exactly. The adapter depends on a private helper, is revision-pinned, checks shapes and reprojection, and still requires a real GPU integration test.

## SAM2 automatic masks

- Official repository: https://github.com/facebookresearch/sam2
- Audited HEAD: `2b90b9f5ceec907a1c18123530e92e794ad901a4`
- API: `build_sam2` and `SAM2AutomaticMaskGenerator.generate(rgb)`.
- Local checkpoint/config required. Source and checkpoint compatibility with the SAM3D environment must be tested.
- It supplies visible masks, not semantic names or hidden object geometry.

## LaMa background RGB

- Original authors: https://github.com/advimman/lama
- Original audited HEAD: `786f5936b27fb3dacd2b1ad799e4de968ea697e7`
- Practical third-party wrapper, NOT the original-author implementation: https://github.com/enesmsahin/simple-lama-inpainting
- Audited wrapper commit: `0790c455160991a6a1417723a68d3d48e3c859e5`
- TorchScript call inspected here: https://github.com/enesmsahin/simple-lama-inpainting/blob/0790c455160991a6a1417723a68d3d48e3c859e5/simple_lama_inpainting/models/model.py
- The integration performs compatible local tensor preparation and `model(image, mask)`, crops padding, then explicitly preserves RGB outside the hole.
- Original and wrapper code declare Apache-2.0. A dedicated license/digest for the particular third-party TorchScript asset was not conclusively established. A maintainer discussion and mirror give Apache indications, but checkpoint origin/terms need operator review. Do not claim all weight/data rights have been cleared.
- Discussions: https://github.com/advimman/lama/issues/230 and https://github.com/advimman/lama/issues/366
- Require a vetted local file and SHA-256. A matching locally supplied hash establishes file consistency, not legal or security trust by itself.
- LaMa produces RGB, not depth or 3D. The second geometry pass, anchor alignment and occlusion constraints are additional, unvalidated integration logic.

## MoGe boundary

- Official repository: https://github.com/microsoft/MoGe
- Inspected HEAD: `74fbce054ebed49800de42d0ad0e83495065719a`
- Current standalone MoGe has different dependency requirements from the LaMa wrapper and SAM3D environment. This pipeline does not install it separately; it shares the pointmap model already configured by SAM3D.
- Pointmap coordinates are camera-frame estimates, not measured ground truth. Avoid mixing independent normalized depths or canonical meshes without alignment.

## Background-completion precedent

- CVPR 2020 3D Photography using Context-aware Layered Depth Inpainting: https://github.com/vt-vl-lab/3d-photo-inpainting
- This precedent synthesizes occluded color and depth layers for motion parallax. The present prototype is not an implementation or reproduction of that paper and makes no comparative performance or novelty claim.
- Layered background completion must not be described as a fully reconstructed 360-degree scene.

## Renderer

Three.js 0.170.0 is loaded from a pinned jsDelivr URL in the viewer. The sampler is independent of Three.js. GPU/browser compatibility, CDN availability, color fidelity and reference-view projection still need deployment-level testing beyond the local synthetic fixture.

## Local visible-surface baseline added in the offline phase

- Browser SDK: @huggingface/transformers 3.5.1, version-pinned CDN.
- Model: https://huggingface.co/onnx-community/depth-anything-v2-small (q8). The browser downloads model/code for local inference; photos are not sent to a hosted image API. Weights are not bundled in the repository.
- This produces relative depth, not completed object geometry or measured distance. The visible baseline assumes horizontal FOV 55 degrees and an arbitrary inverse-depth distance range.
- Actual saved-photo inference and file-based sampling were executed in this phase. This does not change the unverified status of the SAM3D CUDA adapter above.
