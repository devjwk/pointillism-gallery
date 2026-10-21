import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL(path,import.meta.url))).toString('base64'));
const {safeRelativePath,createLocalResolver,validateManifest,validateGeometry,validateBudget,BUDGETS,validationReport}=await load('../../tools/scene-validation/src/io/offline-scene.js');
const {sampleSurface}=await load('../../tools/scene-validation/src/sampling/surface-sampler.js');
const geometry={positions:[0,0,2,1,0,2,0,1,2],indices:[0,1,2],colors:[1,0,0,0,1,0,0,0,1],vertex_reference_visible:[1,1,1]};
const manifest=()=>({schema_version:'scene-first/0.1',coordinate_frame:'opencv_camera',point_budget:8000,seed:42,synthetic:false,completion_scope:'visible_surface_only',assets:[{id:'photo',role:'background',geometry_source:'monocular_depth',geometry:structuredClone(geometry)}]});
const file=p=>({name:p.split('/').at(-1),webkitRelativePath:p});
test('safe exact and pipeline virtual files alias stay in manifest directory',()=>{const doc=file('selected/scene/manifest.json'),asset=file('selected/scene/mesh.glb'),outside=file('selected/mesh.glb');const resolve=createLocalResolver([doc,asset,outside],doc.webkitRelativePath);assert.equal(resolve('files/mesh.glb'),asset);assert.equal(resolve('mesh.glb'),asset);assert.throws(()=>resolve('../mesh.glb'));assert.throws(()=>resolve('selected/mesh.glb'),/Missing/);});
test('reject duplicate and ambiguous alias rather than guessing',()=>{const doc=file('scene/manifest.json');assert.throws(()=>createLocalResolver([doc,doc],doc.webkitRelativePath),/duplicate/);const resolve=createLocalResolver([doc,file('scene/x.glb'),file('scene/files/x.glb')],doc.webkitRelativePath);assert.throws(()=>resolve('files/x.glb'),/Ambiguous/);});
test('reject traversal, URLs, credentials, encodings, query and fragment',()=>{for(const p of ['https://x/a','http://localhost/a','//host/a','data:abc','blob:x','../x','a/../x','a/./x','a//x','/root','a\\b','%2e%2e/x','a?token=secret','a#fragment',' a','a/','a:'+String.fromCharCode(0)])assert.throws(()=>safeRelativePath(p),p);});
test('inline manifest accepts raw arrays and preserves visible-only and seed',()=>{const m=manifest();assert.equal(validateManifest(m),m);assert.equal(m.synthetic,false);assert.equal(m.completion_scope,'visible_surface_only');m.reference={image_data_url:'data:image/png;base64,AAAA',width:1,height:1,intrinsics:[1,1,0.5,0.5]};assert.equal(validateManifest(m),m);});
test('schema rejects invalid budgets, metadata and geometry',()=>{for(const mutate of [m=>m.point_budget=999,m=>m.point_budget=150001,m=>m.point_budget=4.5,m=>m.schema_version='bad',m=>m.coordinate_frame='world',m=>m.synthetic='false',m=>m.completion_scope='full360',m=>m.assets.push(m.assets[0]),m=>m.assets[0].geometry.positions[0]=NaN,m=>m.assets[0].geometry.indices[0]=100,m=>m.assets[0].geometry.colors=[1],m=>m.assets[0].geometry.vertex_reference_visible=[true,true,true]]){const m=manifest();mutate(m);assert.throws(()=>validateManifest(m));}for(const b of BUDGETS)assert.equal(validateBudget(b),b);assert.throws(()=>validateGeometry({positions:[0,0,0]}));});
test('local schema denies external URLs including unused mesh paths and references',()=>{for(const field of ['mesh_url','tags_url']){const m=manifest();m.assets[0][field]='https://example.com/private';assert.throws(()=>validateManifest(m));}for(const ref of [{image_url:'https://example.com/a.png'},{image_data_url:'data:image/svg+xml;base64,AAAA'},{image_data_url:'https://example.com/a.png'}]){const m=manifest();m.reference=ref;assert.throws(()=>validateManifest(m));}});
test('budgets reuse same geometry and seed, deterministic prefixes, report finite and honest counts',()=>{const m=manifest(),asset={id:'photo',positions:geometry.positions,indices:geometry.indices,colors:geometry.colors,vertexReferenceVisible:geometry.vertex_reference_visible};let previous;for(const budget of BUDGETS){const a=sampleSurface([asset],{budget,seed:42}),b=sampleSurface([asset],{budget,seed:42});assert.deepEqual(a.positions,b.positions);if(previous)assert.deepEqual(a.positions.subarray(0,previous.length),previous);previous=a.positions;const r=validationReport({manifest:m,models:[asset],sample:a,inputKind:'inline',budget,seed:42,generation:1});assert.equal(r.pointCount,budget);assert.equal(r.finite,true);assert.equal(r.completionScope,'visible_surface_only');assert.equal(r.synthetic,false);assert.equal(r.generatedSupportCounts.referenceSupported,budget);assert.equal(r.gpuInferenceRun,false);assert.ok(!('perceptualQualityScore' in r));}});
test('rotation handlers do not regenerate points and debug API reports fingerprint',async()=>{const html=await readFile(new URL('../../tools/scene-validation/src/app.js',import.meta.url),'utf8');const code=html.match(/function presetAngle\(degrees\)\{([\s\S]*?)\n\$\('angleFront'\)/)[1];assert.ok(!code.includes('sampleSurface'));assert.ok(!code.includes('finish('));assert.match(html,/pointFingerprint:positionsFingerprint/);assert.match(html,/Object.defineProperty\(window,'__sceneValidation'/);assert.match(html,/Object.defineProperty\(window,'__loadInlineScene'/);});

test('validation page keeps markup separate from styles and UI implementation',async()=>{
 const base=new URL('../../tools/scene-validation/',import.meta.url);
 const html=await readFile(new URL('index.html',base),'utf8');
 const app=await readFile(new URL('src/app.js',base),'utf8');
 const css=await readFile(new URL('styles.css',base),'utf8');
 assert.match(html,/<link rel="stylesheet" href="\.\/styles\.css">/);
 assert.match(html,/<script type="module" src="\.\/src\/app\.js"><\/script>/);
 assert.match(html,/href="\.\.\/\.\.\/"/);
 assert.doesNotMatch(html,/<style\b|\sstyle=|onclick=|function\s+|const\s+renderer=/);
 assert.match(css,/\.viewport\{/);
 assert.match(app,/\$\('fixture'\)\.onclick=/);
 for(const id of ['convertPhoto','loadSceneFile','saveLocalScene','loadLocal','surface','dots','diagnostic','fit','referenceView','download','capturePNG','report','angleFront','angleLeft','angleRight','angleRear','health','submit']){
  assert.ok(html.includes(`id="${id}"`),`markup control: ${id}`);
  assert.ok(app.includes(`$('${id}')`),`UI wiring: ${id}`);
 }
});

test('all local module and stylesheet URLs resolve under the GitHub Pages tool subpath',async()=>{
 const disk=new URL('../../tools/scene-validation/',import.meta.url);
 const hosted=new URL('https://example.test/pointillism-gallery/tools/scene-validation/');
 const html=await readFile(new URL('index.html',disk),'utf8');
 const importmap=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
 assert.equal(importmap.imports.three,'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');
 assert.equal(importmap.imports['three/addons/'],'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/');
 assert.equal(new URL('../../',hosted).pathname,'/pointillism-gallery/');
 const seen=new Set();
 async function inspect(relative){
  if(seen.has(relative))return;seen.add(relative);
  const source=await readFile(new URL(relative,disk),'utf8');
  for(const match of source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)){
   const resolved=new URL(match[1],new URL(relative,hosted));
   assert.ok(resolved.pathname.startsWith(hosted.pathname),resolved.href);
   await inspect(resolved.pathname.slice(hosted.pathname.length));
  }
 }
 for(const asset of ['./styles.css','./src/app.js']){
  const resolved=new URL(asset,hosted);assert.ok(resolved.pathname.startsWith(hosted.pathname));
  await readFile(new URL(asset,disk));
 }
 await inspect('src/app.js');
 assert.equal(seen.size,6);
 const inference=await readFile(new URL('src/inference/local-photo-converter.js',disk),'utf8');
 const versions=[...inference.matchAll(/@huggingface\/transformers@([^?'"/]+)/g)].map(m=>m[1]);
 assert.deepEqual(versions,['3.5.1','3.5.1']);
 assert.doesNotMatch(inference,/method\s*:\s*['"]POST['"]/i);
});
