"""One-shot GPU conversion, no HTTP server or API token required.
python -m pipelines.scene_reconstruction.batch --input photo.jpg --output runs/photo-001
GPU model integration is source-derived and still needs a real CUDA test.
"""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import time

MODEL_FIELDS=('SAM3D_REPO','SAM3D_CONFIG','SAM2_CHECKPOINT','LAMA_CHECKPOINT','LAMA_SHA256')


def parse_args(argv=None):
    parser=argparse.ArgumentParser(description='Convert one saved photo to a reusable 3D scene without running a server.')
    parser.add_argument('--input',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--check-environment',action='store_true')
    parser.add_argument('--max-objects',type=int,default=4)
    parser.add_argument('--candidates',type=int,default=2)
    parser.add_argument('--seed',type=int,default=42,help='Model candidate seed')
    parser.add_argument('--sampling-seed',type=int,default=42,help='Independent surface sampling seed saved in the scene')
    parser.add_argument('--point-budget',type=int,default=8000)
    parser.add_argument('--max-side',type=int,default=1024)
    args=parser.parse_args(argv)
    if not args.check_environment and (args.input is None or args.output is None):
        parser.error('--input and --output are required unless --check-environment is used.')
    for key,low,high in [('max_objects',1,8),('candidates',1,3),('seed',0,2**31-1),('sampling_seed',0,2**31-1),('point_budget',1000,150000),('max_side',256,1024)]:
        if not low<=getattr(args,key)<=high:
            parser.error(f'{key} must be in {low}..{high}.')
    return args


def model_file_status(environ=None):
    env=os.environ if environ is None else environ
    result={}
    for key in MODEL_FIELDS:
        value=env.get(key,'')
        if key=='LAMA_SHA256':
            result[key]=len(value)==64 and all(c in '0123456789abcdefABCDEF' for c in value)
        else:
            result[key]=bool(value) and (Path(value).is_dir() if key=='SAM3D_REPO' else Path(value).is_file())
    return result


def environment_report():
    files=model_file_status()
    report={'model_files_present':files,'gpu_inference_run':False,'network_service_required':False,'cuda_available':False}
    try:
        torch=importlib.import_module('torch')
        report['cuda_available']=bool(torch.cuda.is_available())
        if report['cuda_available']:
            report['gpu_name']=torch.cuda.get_device_name(0)
            report['gpu_memory_bytes']=int(torch.cuda.get_device_properties(0).total_memory)
    except (ImportError,OSError,RuntimeError) as exc:
        report['runtime_error_type']=type(exc).__name__
    report['preflight_ready']=all(files.values()) and report['cuda_available']
    report['warning']='Preflight is not a model inference or quality test.'
    return report


def input_digest(path):
    hasher=hashlib.sha256()
    with Path(path).open('rb') as source:
        while chunk:=source.read(1024*1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def validation_plan(sampling_seed=42):
    return {'status':'not_evaluated','reference_views_degrees':[0,-30,30,180],
            'point_budgets':[4000,8000,16000],'sampling_seed':sampling_seed,
            'comparisons':['source photo vs 3D reference render','same mesh vs surface dots at each budget','side view gaps and shape stability','camera movement does not change point positions','reference-supported appearance vs generated appearance'],
            'not_observable_from_one_photo':['true hidden backside geometry','true occluded background appearance'],
            'warning':'Consistency or reprojection scores are not ground-truth hidden-surface accuracy.'}


def run(args):
    input_path=args.input.resolve()
    output_path=args.output.resolve()
    if not input_path.is_file():
        raise ValueError('Input photo does not exist.')
    if input_path.stat().st_size>20*1024*1024:
        raise ValueError('Input photo exceeds 20 MiB.')
    if output_path.exists() and (not output_path.is_dir() or any(output_path.iterdir())):
        raise ValueError('Output must be a new or empty directory. Existing runs are never overwritten.')
    env=environment_report()
    if not env['preflight_ready']:
        raise RuntimeError('GPU/model preflight incomplete. Run --check-environment; no conversion was performed.')
    # No model/network setup is performed here. Prepare approved weights/caches first.
    os.environ.setdefault('HF_HUB_OFFLINE','1')
    os.environ.setdefault('TRANSFORMERS_OFFLINE','1')
    import numpy as np
    from PIL import Image,ImageOps
    from .pipeline import ModelPaths,ScenePipeline
    Image.MAX_IMAGE_PIXELS=50_000_000
    with Image.open(input_path) as original:
        if original.format not in ('JPEG','PNG','WEBP') or min(original.size)<64 or original.width*original.height>50_000_000:
            raise ValueError('Use JPEG/PNG/WebP, >=64px each side, <=50 megapixels.')
        source_size=list(original.size)
        oriented=ImageOps.exif_transpose(original).convert('RGB')
        oriented_size=list(oriented.size)
        oriented.thumbnail((args.max_side,args.max_side),Image.Resampling.LANCZOS)
        rgb=np.asarray(oriented).copy()
    paths=ModelPaths(os.environ['SAM3D_REPO'],os.environ['SAM3D_CONFIG'],os.environ['SAM2_CHECKPOINT'],os.environ.get('SAM2_CONFIG','configs/sam2.1/sam2.1_hiera_s.yaml'),os.environ['LAMA_CHECKPOINT'],os.environ['LAMA_SHA256'])
    output_path.mkdir(parents=True,exist_ok=True)
    record={'schema_version':'conversion-record/0.1','input_name':input_path.name,'input_sha256':input_digest(input_path),
            'input_stored_size':source_size,'oriented_size':oriented_size,'working_size':[rgb.shape[1],rgb.shape[0]],
            'mode':'one_shot_gpu_generated_objects','status':'running','options':{'max_objects':args.max_objects,'candidates':args.candidates,'seed':args.seed,'point_budget':args.point_budget},
            'sampling_seed':args.sampling_seed,'validation_status':'not_evaluated','permanent_server':False}
    record_path=output_path/'conversion-record.json'
    record_path.write_text(json.dumps(record,ensure_ascii=False,indent=2))
    start=time.monotonic()
    try:
        manifest=ScenePipeline(paths).run(rgb,record['options'],output_path,lambda stage:print(json.dumps({'stage':stage}),flush=True))
        manifest['completion_scope']='generated_objects_layered_background'
        manifest['synthetic']=False
        manifest['seed']=args.sampling_seed
        manifest['generation_completed']=True
        manifest['conversion_record']='conversion-record.json'
        (output_path/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,allow_nan=False))
        record['status']='converted';record['elapsed_seconds']=time.monotonic()-start
        (output_path/'validation-plan.json').write_text(json.dumps(validation_plan(args.sampling_seed),ensure_ascii=False,indent=2))
        return {'status':'converted','output':str(output_path),'manifest':'manifest.json','quality_verified':False,'permanent_server':False}
    except Exception as exc:
        record['status']='failed';record['error_type']=type(exc).__name__
        raise
    finally:
        record_path.write_text(json.dumps(record,ensure_ascii=False,indent=2))


def main(argv=None):
    args=parse_args(argv)
    if args.check_environment:
        print(json.dumps(environment_report(),ensure_ascii=False,indent=2))
        return 0
    try:
        print(json.dumps(run(args),ensure_ascii=False,indent=2))
        return 0
    except Exception as exc:
        # Do not echo environment values, source paths or arbitrary backend error strings.
        print(json.dumps({'status':'blocked_or_failed','error_type':type(exc).__name__,
                          'hint':'Check local input/output, --check-environment and model-specific logs. No successful conversion is claimed.'}),file=sys.stderr)
        return 2

if __name__=='__main__':
    raise SystemExit(main())
