"""Research/prototype GPU pipeline. Source-derived adapters, not GPU-validated here.
Object completion is full generated geometry. Background completion is a layered front-view
surface for limited disocclusion, NOT a complete 360-degree environment.
"""
from pathlib import Path
from dataclasses import dataclass
import json
import io
import gc
import numpy as np
from PIL import Image
from .adapters.sam3d_adapter import Sam3DAdapter
from .adapters.background import automatic_masks,inpaint_rgb,release_gpu
from .geometry import backproject,align_background_depth,grid_mesh,rasterize_gpu,candidate_metrics,observation_support,vertex_colors

@dataclass
class ModelPaths:
    sam3d_repo: str
    sam3d_config: str
    sam2_checkpoint: str
    sam2_config: str
    lama_checkpoint: str
    lama_sha256: str


def save_mesh(out_dir,name,mesh,tags,role,geometry_source):
    import trimesh
    # One identity-node mesh, vertex colors, no external textures. Keep tag ordering fixed.
    clean=trimesh.Trimesh(vertices=np.asarray(mesh.vertices),faces=np.asarray(mesh.faces),vertex_colors=vertex_colors(mesh),process=False)
    if not np.isfinite(clean.vertices).all():
        raise RuntimeError('Nonfinite mesh vertices cannot be exported.')
    payload=clean.export(file_type='glb')
    check=trimesh.load(io.BytesIO(payload),file_type='glb',process=False)
    geometries=list(check.geometry.values()) if isinstance(check,trimesh.Scene) else [check]
    if len(geometries)!=1 or len(geometries[0].vertices)!=len(clean.vertices) or not np.allclose(geometries[0].vertices,clean.vertices,atol=1e-5):
        raise RuntimeError('GLB export changed vertex ordering; provenance cannot be attached safely.')
    (out_dir/f'{name}.glb').write_bytes(payload)
    (out_dir/f'{name}-tags.json').write_text(json.dumps({'vertex_reference_visible':np.asarray(tags,dtype=np.uint8).tolist()}))
    return {'id':name,'role':role,'mesh_url':f'files/{name}.glb','tags_url':f'files/{name}-tags.json','geometry_source':geometry_source}


class ScenePipeline:
    def __init__(self,paths):
        self.paths=paths

    def run(self,rgb,options,out_dir,progress):
        out_dir=Path(out_dir);out_dir.mkdir(parents=True,exist_ok=True)
        rgb=np.asarray(rgb,dtype=np.uint8);h,w=rgb.shape[:2]
        p=self.paths
        progress('segmenting')
        masks=automatic_masks(rgb,p.sam2_checkpoint,p.sam2_config,options['max_objects'])
        instance_map=np.zeros((h,w),dtype=np.int32)
        for index,mask in enumerate(masks,1):
            instance_map[mask]=index
        holes=instance_map>0
        progress('inpainting_background_rgb')
        completed=inpaint_rgb(rgb,holes,p.lama_checkpoint,p.lama_sha256)
        Image.fromarray(rgb).save(out_dir/'source.png')
        Image.fromarray(completed).save(out_dir/'background-filled.png')
        Image.fromarray((holes*255).astype(np.uint8)).save(out_dir/'completion-mask.png')
        adapter=Sam3DAdapter(p.sam3d_repo,p.sam3d_config)
        try:
            progress('estimating_shared_scene_geometry')
            source=adapter.estimate_scene(rgb)
            background=adapter.estimate_scene(completed)
            z,valid,alignment=align_background_depth(source['depth'],background['depth'],~holes,holes,source['valid'] & background['valid'])
            known=(~holes)&source['valid']
            z[known]=source['depth'][known];valid[known]=True
            if (holes & ~valid).sum()>max(1,.05*holes.sum()):
                raise RuntimeError('Too much of the hidden background has no usable depth prediction.')
            points=backproject(z,source['intrinsics'])
            points[known]=source['points'][known]
            bg_mesh,bg_tags=grid_mesh(points,completed,valid,known,max_side=256)
            assets=[save_mesh(out_dir,'background',bg_mesh,bg_tags,'background','monocular_depth')]
            diagnostics=[]
            for number,mask in enumerate(masks,1):
                best=None;tested=[]
                for candidate in range(options['candidates']):
                    progress(f'generating_object_{number}_candidate_{candidate+1}')
                    seed=options['seed']+number*1009+candidate
                    mesh=adapter.generate(rgb,mask,seed,source['points'])
                    z_render,_=rasterize_gpu(mesh,source['intrinsics'],(h,w))
                    metrics=candidate_metrics(z_render,source['depth'],source['valid'],mask,instance_map,number)
                    metrics.update({'seed':seed,'candidate':candidate+1})
                    tested.append(metrics)
                    if best is None or metrics['consistency_cost']<best[0]['consistency_cost']:
                        best=(metrics,mesh,z_render)
                metrics,mesh,z_render=best
                # Provisional gates require calibration on actual images before production/research use.
                if metrics['silhouette_iou']<.15 or metrics['relative_depth_error']>.60:
                    raise RuntimeError(f'Object {number}: no candidate passes provisional reference-view consistency gates. Inspect masks/camera rather than showing a fake success.')
                tags=observation_support(mesh,source['intrinsics'],rgb,mask,z_render)
                assets.append(save_mesh(out_dir,f'object-{number}',mesh,tags,'object','generated'))
                diagnostics.append({'object':number,'candidates':tested,'selected_seed':metrics['seed']})
            warnings=list(source['warnings'])+[
                'Unseen object surfaces and filled background are hypotheses, not recovered truth.',
                'Reference-visible tags indicate support by the input view, not measured or certain geometry.',
                'Background is a front-oriented layered surface. Large rotations may reveal unmodelled scene regions.',
                'Automatic masks are not semantic object names and require visual review.',
                'Candidate costs are provisional consistency measures, not calibrated confidence probabilities.',
                'Known RGB is preserved at the resized working resolution; geometry and camera are estimated.'
            ]
            k=source['intrinsics']
            manifest={'schema_version':'scene-first/0.1','coordinate_frame':'opencv_camera',
                      'reference':{'image_url':'files/source.png','width':w,'height':h,'intrinsics':[float(k[0,0]),float(k[1,1]),float(k[0,2]),float(k[1,2])]},
                      'assets':assets,'warnings':warnings,'diagnostics':{'background_alignment':alignment,'objects':diagnostics,'pointmap_projection_median_px':source['projection_median_px']},
                      'point_budget':options['point_budget'],'synthetic':False,'generation_completed':True}
            (out_dir/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,allow_nan=False))
            return manifest
        finally:
            adapter.inference=None
            gc.collect();release_gpu()
