"""Camera-frame consistency, background depth alignment, and observation support.
No score is a probability that an unseen surface is correct.
"""
import numpy as np


def vertex_colors(mesh):
    visual=mesh.visual
    if getattr(visual,'kind',None)=='texture':
        visual=visual.to_color()
    return np.asarray(visual.vertex_colors).copy()


def backproject(depth, k):
    depth = np.asarray(depth, dtype=np.float32)
    h,w = depth.shape
    yy,xx = np.mgrid[:h,:w]
    rays = np.stack([xx,yy,np.ones_like(xx)],axis=-1) @ np.linalg.inv(k).T
    return rays * depth[...,None]


def align_background_depth(original, completed, known, holes, valid, margin=.02):
    """Fit positive affine Z alignment on unchanged background, then preserve its Z exactly.
    The fit and thresholds are provisional consistency heuristics, not hidden-depth truth.
    """
    original = np.asarray(original,dtype=np.float32)
    completed = np.asarray(completed,dtype=np.float32)
    anchors = known & valid & np.isfinite(original) & np.isfinite(completed) & (original>0) & (completed>0)
    if anchors.sum() < 64 or anchors.mean() < .08:
        raise ValueError('Insufficient unchanged background anchors for depth alignment.')
    x,y = completed[anchors], original[anchors]
    # Robust trimmed least squares. Flat regions require scale-only alignment.
    if np.std(x) < 1e-4*np.median(x):
        a,b = float(np.median(y/x)),0.
    else:
        a,b = np.linalg.lstsq(np.c_[x,np.ones_like(x)],y,rcond=None)[0]
        for _ in range(3):
            residual = np.abs(a*x+b-y)
            keep = residual <= np.quantile(residual,.8)+1e-6
            a,b = np.linalg.lstsq(np.c_[x[keep],np.ones(keep.sum())],y[keep],rcond=None)[0]
    if not np.isfinite([a,b]).all() or a<=0:
        raise ValueError('Background depth alignment has a nonpositive scale.')
    residual = float(np.median(np.abs(a*x+b-y))/max(1e-5,float(np.median(y))))
    if residual > .15:
        raise ValueError('Completed background depth contradicts unchanged background anchors.')
    result = a*completed+b
    result[known & valid] = original[known & valid]
    foreground_valid = holes & valid & np.isfinite(original) & (original>0)
    # Occlusion ordering: inferred background must lie behind observed foreground.
    result[foreground_valid] = np.maximum(result[foreground_valid],original[foreground_valid]*(1+margin))
    fill_valid = np.isfinite(result) & (result>0)
    return result.astype(np.float32),fill_valid,{'scale':float(a),'shift':float(b),'relative_anchor_residual':residual}


def grid_mesh(points, colors, valid, reference_visible, max_side=256, max_relative_jump=.15):
    """An LDI/background surface, NOT a closed 360-degree room model."""
    import trimesh
    h,w = valid.shape
    stride = max(1,int(np.ceil(max(h,w)/max_side)))
    ys = np.arange(0,h,stride); xs=np.arange(0,w,stride)
    pp=points[np.ix_(ys,xs)].reshape(-1,3)
    cc=colors[np.ix_(ys,xs)].reshape(-1,3)
    vv=valid[np.ix_(ys,xs)].reshape(-1)
    tags=reference_visible[np.ix_(ys,xs)].reshape(-1).astype(np.uint8)
    gh,gw=len(ys),len(xs)
    faces=[]
    for y in range(gh-1):
        for x in range(gw-1):
            a=y*gw+x; b=a+1; c=a+gw; d=c+1
            for ids in ((a,c,b),(b,c,d)):
                idx=np.array(ids)
                z=pp[idx,2]
                if vv[idx].all() and np.isfinite(pp[idx]).all() and (z.max()-z.min())/max(1e-6,z.min())<=max_relative_jump:
                    faces.append(ids)
    if not faces:
        raise ValueError('No continuous valid background triangles.')
    faces=np.asarray(faces,dtype=np.int64)
    used,inverse=np.unique(faces.reshape(-1),return_inverse=True)
    mesh=trimesh.Trimesh(vertices=pp[used],faces=inverse.reshape(-1,3),vertex_colors=cc[used],process=False)
    return mesh,tags[used]


def rasterize_gpu(mesh,k,image_shape,max_side=256):
    """Rasterize posed CV geometry with PyTorch3D; perspective-correct camera Z."""
    import torch
    from pytorch3d.structures import Meshes
    from pytorch3d.renderer.mesh import rasterize_meshes
    h,w=image_shape
    factor=min(1.,max_side/max(h,w)); rh=max(8,round(h*factor));rw=max(8,round(w*factor))
    kk=np.diag([rw/w,rh/h,1.]) @ k
    p=np.asarray(mesh.vertices,dtype=np.float32)
    good_faces=(p[np.asarray(mesh.faces),2]>1e-5).all(axis=1)
    ff=np.asarray(mesh.faces)[good_faces]
    if not len(ff):
        return np.full((rh,rw),np.inf,dtype=np.float32),factor
    projection=p @ kk.T
    uv=projection[:,:2]/np.maximum(projection[:,2:3],1e-5)
    s=min(rh,rw)
    ndc=np.c_[(rw-1-2*uv[:,0])/s,(rh-1-2*uv[:,1])/s,p[:,2]]
    packed=Meshes(verts=[torch.as_tensor(ndc,dtype=torch.float32,device='cuda')],faces=[torch.as_tensor(ff,dtype=torch.int64,device='cuda')])
    with torch.inference_mode():
        pix,z,_,_=rasterize_meshes(packed,image_size=(rh,rw),blur_radius=0.,faces_per_pixel=1,perspective_correct=True,cull_backfaces=False)
    result=z[0,:,:,0].cpu().numpy()
    result[pix[0,:,:,0].cpu().numpy()<0]=np.inf
    return result,factor


def candidate_metrics(z_render, reference_depth, reference_valid, target_mask, instance_map, target_id):
    from PIL import Image
    h,w=z_render.shape
    def nearest(x):
        return np.asarray(Image.fromarray(np.asarray(x)).resize((w,h),Image.Resampling.NEAREST))
    z_ref=nearest(reference_depth.astype(np.float32)); valid=nearest(reference_valid.astype(np.uint8)).astype(bool)
    target=nearest(target_mask.astype(np.uint8)).astype(bool); ids=nearest(instance_map.astype(np.int32))
    prediction=np.isfinite(z_render)
    # Only an observed different foreground object may explain hidden candidate pixels.
    occluded=prediction & valid & (ids>0) & (ids!=target_id) & (z_ref*1.05<z_render)
    prediction &= ~occluded
    intersection=(prediction & target).sum(); union=(prediction|target).sum()
    iou=float(intersection/max(1,union))
    overlap=prediction & target & valid
    depth_error=float(np.median(np.abs(z_render[overlap]-z_ref[overlap]))/max(1e-6,np.median(z_ref[overlap]))) if overlap.any() else 10.
    return {'silhouette_iou':iou,'relative_depth_error':depth_error,'consistency_cost':1-iou+.25*min(4.,depth_error)}


def observation_support(mesh,k,rgb,target_mask,z_render):
    """Conservative visible-reference support. Depth remains estimated even where RGB is observed."""
    p=np.asarray(mesh.vertices)
    projected=p @ k.T
    uv=projected[:,:2]/np.maximum(projected[:,2:3],1e-6)
    h,w=target_mask.shape; rh,rw=z_render.shape
    finite=np.isfinite(p).all(axis=1) & (p[:,2]>0)
    inside=finite & (uv[:,0]>=0)&(uv[:,0]<w)&(uv[:,1]>=0)&(uv[:,1]<h)
    ids=np.flatnonzero(inside); tags=np.zeros(len(p),dtype=np.uint8)
    if not len(ids):
        return tags
    ix=np.clip(uv[ids,0].astype(int),0,w-1);iy=np.clip(uv[ids,1].astype(int),0,h-1)
    rx=np.clip((uv[ids,0]*rw/w).astype(int),0,rw-1);ry=np.clip((uv[ids,1]*rh/h).astype(int),0,rh-1)
    z=z_render[ry,rx]
    selected=target_mask[iy,ix] & np.isfinite(z) & (np.abs(p[ids,2]-z)<=np.maximum(.01,.025*z))
    tags[ids[selected]]=1
    # Project original observed RGB only on supported front vertices; retain generated backside appearance.
    colors=vertex_colors(mesh)
    colors[ids[selected],:3]=rgb[iy[selected],ix[selected]]
    mesh.visual.vertex_colors=colors
    return tags
