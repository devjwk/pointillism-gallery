import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL(path,import.meta.url))).toString('base64'));
const {createReferenceDensity,referenceDotDiameter}=await load('../../tools/scene-validation/src/sampling/reference-density.js');
const {sampleSurface}=await load('../../tools/scene-validation/src/sampling/surface-sampler.js');
const near={id:'near',positions:[0,0,1,1,0,1,0,1,1],vertexReferenceVisible:[1,1,1]};
const far={id:'far',positions:[8,0,4,12,0,4,8,4,4],vertexReferenceVisible:[1,1,1]};
const reference={width:400,height:200,intrinsics:[100,100,0,0]};
test('fixed reference weighting compensates distance but samples real 3D triangles',()=>{
 const plan=createReferenceDensity([near,far],reference),sample=sampleSurface([near,far],{budget:20000,seed:42,importance:plan.importance,importanceBounds:plan.importanceBounds});
 assert.equal(plan.policy,'fixed_reference_projected_area');
 const count=sample.assetIndex.reduce((a,i)=>a+(i===0),0);assert.ok(Math.abs(count/20000-.5)<.02);
 for(let i=0;i<sample.count;i++)assert.equal(sample.positions[i*3+2],sample.assetIndex[i]===0?1:4);
});
test('no reference camera or supported faces falls back rather than inventing weights',()=>{
 assert.equal(createReferenceDensity([near],null).policy,'surface_area');
 assert.equal(createReferenceDensity([{...near,vertexReferenceVisible:undefined}],reference).supported,false);
});
test('unseen faces receive a geometry floor, not a confidence probability',()=>{
 const unknown={...far,vertexReferenceVisible:[0,0,0]};const plan=createReferenceDensity([near,unknown],reference);
 assert.equal(plan.importance(unknown,0),.15);assert.match(plan.meaning,/not confidence/);
});
test('dot coverage formula is deterministic and changes footprint, not geometry',()=>{
 const a=referenceDotDiameter(4000,reference,1000,800),b=referenceDotDiameter(16000,reference,1000,800);
 assert.ok(a>b);assert.ok(a<=18&&b>=1);assert.equal(referenceDotDiameter(16000,reference,1000,800),b);
});
