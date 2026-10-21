"""Local-checkpoint adapters. No automatic checkpoint download; no hosted image service.
LaMa RGB completion is not 3D completion. Geometry is separately estimated and checked.
"""
from pathlib import Path
import hashlib
import gc
import numpy as np


def release_gpu():
    import torch
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def automatic_masks(rgb, checkpoint, config, max_objects):
    import torch
    from sam2.build_sam import build_sam2
    from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
    if not Path(checkpoint).is_file():
        raise RuntimeError('Local SAM2 checkpoint is missing.')
    model=build_sam2(config,checkpoint,device='cuda',apply_postprocessing=False)
    try:
        generator=SAM2AutomaticMaskGenerator(model,points_per_side=24,pred_iou_thresh=.9,stability_score_thresh=.95)
        with torch.inference_mode():
            candidates=generator.generate(rgb)
        total=rgb.shape[0]*rgb.shape[1]
        candidates=[c for c in candidates if .01*total<=c['area']<=.65*total]
        candidates.sort(key=lambda c:float(c['stability_score'])*np.sqrt(c['area']),reverse=True)
        accepted=[];covered=np.zeros(rgb.shape[:2],dtype=bool)
        for c in candidates:
            mask=np.asarray(c['segmentation'],dtype=bool)
            remaining=mask & ~covered
            if remaining.sum()<.01*total or remaining.sum()<.65*mask.sum():
                continue
            accepted.append(remaining);covered|=remaining
            if len(accepted)>=max_objects:
                break
        if not accepted:
            raise RuntimeError('No usable automatic object masks. Inspect segmentation or supply a different photo.')
        return accepted
    finally:
        model.to('cpu')
        del model
        release_gpu()


def inpaint_rgb(rgb,holes,checkpoint,expected_sha256):
    import torch
    path=Path(checkpoint)
    if not path.is_file() or len(expected_sha256)!=64:
        raise RuntimeError('A vetted local LaMa checkpoint and LAMA_SHA256 are required.')
    hasher=hashlib.sha256()
    with path.open('rb') as f:
        while chunk:=f.read(4*1024*1024):
            hasher.update(chunk)
    if hasher.hexdigest().lower()!=expected_sha256.lower():
        raise RuntimeError('LaMa checkpoint hash mismatch.')
    h,w=holes.shape
    if holes.mean()>.85:
        raise RuntimeError('Too little visible background for conservative background completion.')
    pad_h=(-h)%8;pad_w=(-w)%8
    image=np.pad(rgb.astype(np.float32)/255.,((0,pad_h),(0,pad_w),(0,0)),mode='symmetric')
    mask=np.pad(holes.astype(np.float32),((0,pad_h),(0,pad_w)),mode='symmetric')
    model=torch.jit.load(str(path),map_location='cuda').eval()
    try:
        with torch.inference_mode():
            result=model(torch.from_numpy(image.transpose(2,0,1)[None]).cuda(),torch.from_numpy(mask[None,None]).cuda())
        filled=np.clip(result[0].permute(1,2,0).cpu().numpy()[:h,:w]*255,0,255).astype(np.uint8)
        # Known RGB is explicitly preserved at the working resolution.
        output=rgb.copy();output[holes]=filled[holes]
        return output
    finally:
        model.to('cpu')
        del model
        release_gpu()
