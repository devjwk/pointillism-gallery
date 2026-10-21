/** Local scene documents are data only. Never fetch a URL from them. */
export const BUDGETS=Object.freeze([4000,8000,16000,60000]);
export function validateBudget(value){if(!Number.isInteger(value)||value<1000||value>150000)throw new Error('point_budget must be an integer in 1000..150000');return value;}
export function safeRelativePath(value){
 if(typeof value!=='string'||!value||value!==value.trim()||/[\\?#:%\u0000-\u001f\u007f]/.test(value)||value.startsWith('/'))throw new Error('Only plain relative local paths allowed');
 if(value.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Unsafe local path');return value;
}
export function createLocalResolver(files,manifestPath){
 const map=new Map();for(const file of files){const p=safeRelativePath(file.webkitRelativePath||file.name);if(map.has(p))throw new Error('Ambiguous duplicate local file: '+p);map.set(p,file);}
 const path=safeRelativePath(manifestPath),slash=path.lastIndexOf('/'),dir=slash<0?'':path.slice(0,slash+1);if(!map.has(path))throw new Error('Scene document is missing');
 return value=>{const relative=safeRelativePath(value),exact=dir+relative,alias=relative.startsWith('files/')?dir+relative.slice(6):null;const hits=[exact,alias].filter((p,i,a)=>p&&a.indexOf(p)===i&&map.has(p));if(hits.length>1)throw new Error('Ambiguous local asset: '+relative);if(!hits.length)throw new Error('Missing local asset inside manifest directory: '+relative);return map.get(hits[0]);};
}
function array(value,name,multiple=1){if(!Array.isArray(value)||!value.length||value.length%multiple||!value.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=3e38))throw new Error('Invalid '+name);}
export function validateGeometry(g){
 if(!g||typeof g!=='object')throw new Error('Missing geometry');array(g.positions,'positions',3);const n=g.positions.length/3;if(n<3)throw new Error('At least three vertices required');
 if(g.indices!==undefined){array(g.indices,'indices',3);if(g.indices.some(i=>!Number.isInteger(i)||i<0||i>=n))throw new Error('Index out of range');}else if(n%3)throw new Error('Unindexed vertices must be triangles');
 for(const k of ['colors','normals'])if(g[k]!==undefined){array(g[k],k,3);if(g[k].length!==g.positions.length)throw new Error(k+' length mismatch');}
 if(g.colors?.some(x=>x<0||x>1))throw new Error('Colors must be linear RGB in 0..1');
 if(g.vertex_reference_visible!==undefined&&(!Array.isArray(g.vertex_reference_visible)||g.vertex_reference_visible.length!==n||g.vertex_reference_visible.some(x=>x!==0&&x!==1)))throw new Error('Invalid visibility tags');return g;
}
export function validateManifest(m,{local=true}={}){
 if(!m||m.schema_version!=='scene-first/0.1'||m.coordinate_frame!=='opencv_camera'||!Array.isArray(m.assets)||!m.assets.length)throw new Error('Invalid scene-first/0.1 manifest');validateBudget(m.point_budget);
 if(m.synthetic!==undefined&&typeof m.synthetic!=='boolean')throw new Error('synthetic must be boolean');if(m.completion_scope!==undefined&&!['visible_surface_only','generated_objects_layered_background'].includes(m.completion_scope))throw new Error('Invalid completion_scope');if(m.seed!==undefined&&(!Number.isInteger(m.seed)||m.seed<0||m.seed>4294967295))throw new Error('Invalid seed');
 const ids=new Set();for(const a of m.assets){if(!a||!['object','background'].includes(a.role)||!['generated','monocular_depth'].includes(a.geometry_source))throw new Error('Invalid asset role or geometry_source');if(typeof a.id!=='string'||!a.id||ids.has(a.id))throw new Error('Asset IDs must be unique nonempty strings');ids.add(a.id);if(a.geometry!==undefined)validateGeometry(a.geometry);else if(!a.mesh_url)throw new Error('Asset needs geometry or mesh_url');if(local)for(const k of ['mesh_url','tags_url'])if(a[k]!==undefined)safeRelativePath(a[k]);}
 if(m.reference!==undefined){const r=m.reference;if(!r||typeof r!=='object')throw new Error('Invalid reference');if(local&&r.image_url!==undefined)safeRelativePath(r.image_url);if(r.image_data_url!==undefined&&(typeof r.image_data_url!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(r.image_data_url)))throw new Error('Only embedded PNG/JPEG/WebP reference images allowed');if(r.intrinsics!==undefined&&(!Array.isArray(r.intrinsics)||r.intrinsics.length!==4||!r.intrinsics.every(Number.isFinite)||r.intrinsics[0]<=0||r.intrinsics[1]<=0||!(r.width>0)||!(r.height>0)))throw new Error('Invalid reference camera');}return m;
}
export function validationReport({manifest,models,sample,inputKind,budget,seed,generation}){
 const counts=models.map(m=>({id:m.id,vertices:m.positions.length/3,triangles:(m.indices?.length??m.positions.length/3)/3,points:0,referenceSupported:0,generatedUnknown:0}));if(sample)for(let i=0;i<sample.count;i++){const c=counts[sample.assetIndex[i]];c.points++;if(sample.provenance[i]===1)c.referenceSupported++;else c.generatedUnknown++;}
 return {schemaVersion:'scene-validation/0.1',inputKind,synthetic:manifest?.synthetic===true,completionScope:manifest?.completion_scope??'generated_objects_layered_background',budget,seed,meshCount:models.length,pointCount:sample?.count??0,countsPerAsset:counts,finite:!!sample&&[sample.positions,sample.normals,sample.colors].every(a=>a.every(Number.isFinite)),generatedSupportCounts:{referenceSupported:counts.reduce((s,c)=>s+c.referenceSupported,0),generatedUnknown:counts.reduce((s,c)=>s+c.generatedUnknown,0)},pointBufferGeneration:generation,coordinateFrame:'opencv_camera',provenanceMeaning:'Reference visibility support is not measured geometry, confidence, or perceptual quality',gpuInferenceRun:false};
}
