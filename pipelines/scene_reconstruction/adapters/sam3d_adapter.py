"""Source-derived SAM 3D adapter. NOT GPU-inference-verified in this delivery.
Only local, operator-vetted checkpoints are accepted. Official repo must be installed.
All exported meshes and pointmaps are OpenCV camera frame: x right, y down, z forward.
"""
from pathlib import Path
import subprocess
import sys
import numpy as np

UPSTREAM_COMMIT = 'f91db411c50efee93d8db7aeb323885650f6f722'
F = np.diag([-1., -1., 1.]).astype(np.float32)
A = np.array([[1.,0.,0.],[0.,0.,-1.],[0.,1.,0.]], dtype=np.float32)

class Sam3DAdapter:
    def __init__(self, repo_root, config_path, device='cuda'):
        self.repo = Path(repo_root).resolve()
        self.config = Path(config_path).resolve()
        self.device = device
        self.inference = None

    def load(self):
        if self.inference is not None:
            return
        import torch
        if not torch.cuda.is_available() or self.device != 'cuda':
            raise RuntimeError('This adapter requires one visible CUDA GPU; CPU fallback is not implemented.')
        if not self.config.is_file():
            raise RuntimeError('Local SAM3D pipeline.yaml/checkpoints are missing.')
        revision = subprocess.check_output(['git','-C',str(self.repo),'rev-parse','HEAD'], text=True).strip()
        if revision != UPSTREAM_COMMIT:
            raise RuntimeError('SAM3D source revision differs from the audited pin. Review adapter before changing it.')
        sys.path.insert(0, str(self.repo / 'notebook'))
        from inference import Inference
        self.inference = Inference(str(self.config), compile=False)
        pipeline_device = str(getattr(self.inference._pipeline, 'device', 'cuda'))
        if not pipeline_device.startswith('cuda'):
            raise RuntimeError('Checkpoint configuration selected a non-CUDA pipeline.')

    def estimate_scene(self, rgb_uint8):
        self.load()
        import torch
        rgb = np.asarray(rgb_uint8, dtype=np.uint8)
        h,w = rgb.shape[:2]
        rgba = self.inference.merge_mask_to_rgba(rgb, np.ones((h,w), dtype=bool))
        with torch.inference_mode():
            output = self.inference._pipeline.compute_pointmap(rgba)
        points = output['pointmap'].detach().cpu().numpy()
        if points.shape != (3,h,w):
            raise RuntimeError(f'Unexpected shared pointmap shape: {points.shape}')
        points = points.transpose(1,2,0) @ F
        k = output['intrinsics'].detach().cpu().numpy()
        if k.shape == (1,3,3):
            k = k[0]
        if k.shape != (3,3) or not np.isfinite(k).all():
            raise RuntimeError('Invalid predicted camera intrinsics.')
        k = np.diag([w,h,1.]) @ k
        if k[0,0] <= 0 or k[1,1] <= 0:
            raise RuntimeError('Camera focal length is not positive.')
        valid = np.isfinite(points).all(axis=2) & (points[...,2] > 1e-5)
        if valid.mean() < .1:
            raise RuntimeError('Too little valid scene geometry.')
        yy,xx = np.mgrid[:h,:w]
        projected = points[valid] @ k.T
        uv = projected[:,:2] / projected[:,2:3]
        residual = np.linalg.norm(uv - np.stack([xx,yy],axis=-1)[valid],axis=1)
        median_px = float(np.median(residual))
        # This is a provisional consistency gate, not a calibrated confidence estimate.
        if median_px > max(h,w)*.05:
            raise RuntimeError(f'Pointmap/camera reprojection mismatch: median {median_px:.1f}px.')
        return {'points':points, 'depth':points[...,2], 'intrinsics':k, 'valid':valid,
                'projection_median_px':median_px,
                'warnings':['Camera/depth are learned estimates, not measured geometry.',
                            'SAM3D internal MoGe uses force_projection=False; projection is checked, not assumed exact.']}

    def generate(self, rgb_uint8, mask_bool, seed, pointmap_cv):
        self.load()
        import torch
        from pytorch3d.transforms import quaternion_to_matrix
        from sam3d_objects.data.dataset.tdfy.transforms_3d import compose_transform
        rgb = np.asarray(rgb_uint8, dtype=np.uint8)
        mask = np.asarray(mask_bool, dtype=bool)
        points_cv = np.asarray(pointmap_cv, dtype=np.float32)
        if mask.shape != rgb.shape[:2] or points_cv.shape != (*mask.shape,3) or not mask.any():
            raise ValueError('Image, mask and shared pointmap must use the same nonempty pixel grid.')
        shared = torch.from_numpy(np.ascontiguousarray(points_cv @ F))
        with torch.inference_mode():
            out = self.inference(rgb, mask, seed=int(seed), pointmap=shared)
        if any(key not in out for key in ('glb','scale','rotation','translation')):
            raise RuntimeError('SAM3D did not return a complete mesh and decoded pose.')
        mesh = out['glb'].copy()
        if not len(mesh.vertices) or not len(mesh.faces):
            raise RuntimeError('SAM3D returned an empty mesh.')
        for key in ('scale','rotation','translation'):
            if not torch.isfinite(out[key]).all():
                raise RuntimeError('SAM3D pose contains nonfinite values.')
        canonical = np.asarray(mesh.vertices) @ A.T  # Undo official to_glb axis conversion.
        tensor = torch.as_tensor(canonical, dtype=out['scale'].dtype, device=out['scale'].device)[None]
        transform = compose_transform(scale=out['scale'], rotation=quaternion_to_matrix(out['rotation']), translation=out['translation'])
        mesh.vertices = transform.transform_points(tensor)[0].detach().cpu().numpy() @ F
        if not np.isfinite(mesh.vertices).all() or np.median(mesh.vertices[:,2]) <= 0:
            raise RuntimeError('Posed mesh is invalid or behind the original camera.')
        return mesh
