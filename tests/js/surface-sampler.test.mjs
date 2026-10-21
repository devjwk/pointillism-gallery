import {test} from 'node:test';
import assert from 'node:assert/strict';
// Data import keeps this test runnable without package.json type:module.
import {readFile} from 'node:fs/promises';
const {sampleSurface}=await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../../tools/scene-validation/src/sampling/surface-sampler.js',import.meta.url))).toString('base64'));
const triangle={id:'small',positions:[0,0,0,1,0,0,0,1,0],vertexReferenceVisible:[1,1,1]};
test('exact count, deterministic, actual triangle barycentrics and finite unit normals',()=>{
 const a=sampleSurface([triangle],{budget:2000,seed:17}),b=sampleSurface([triangle],{budget:2000,seed:17});
 assert.equal(a.count,2000);assert.deepEqual(a,b);
 for(let i=0;i<a.count;i++){const [x,y,z]=a.positions.subarray(i*3,i*3+3);assert.ok(x>=0&&y>=0&&x+y<=1.000001);assert.equal(z,0);assert.ok(Math.abs(Math.hypot(...a.normals.subarray(i*3,i*3+3))-1)<1e-6);assert.equal(a.provenance[i],1);assert.equal(a.sourceAsset[i],'small');}
 const xs=Array.from({length:a.count},(_,i)=>a.positions[i*3]);assert.ok(Math.abs(xs.reduce((x,y)=>x+y,0)/a.count-1/3)<0.025);
});
test('global area weighting and fixed total across assets',()=>{
 const large={id:'large',positions:[10,0,0,12,0,0,10,2,0]};
 const s=sampleSurface([triangle,large],{budget:20000,seed:42});
 assert.equal(s.count,20000);const largeN=s.sourceAsset.filter(x=>x==='large').length;
 assert.ok(Math.abs(largeN/20000-0.8)<0.015);assert.equal(s.totalArea,2.5);assert.ok(s.triangleIndex.every(i=>i===0));
});
test('degenerate skipped, all-degenerate rejected, empty zero allowed',()=>{
 const d={id:'bad',positions:[0,0,0,0,0,0,1,1,1]};assert.throws(()=>sampleSurface([d],{budget:1}),/non-degenerate/);
 assert.equal(sampleSurface([d,triangle],{budget:31}).count,31);const mixed={id:'mixed',positions:[...d.positions,...triangle.positions]};assert.ok(sampleSurface([mixed],{budget:31}).triangleIndex.every(i=>i===1));assert.equal(sampleSurface([],{budget:0}).count,0);
});
test('conservative visibility and unknown defaults are not truth labels',()=>{
 assert.ok(sampleSurface([{...triangle,vertexReferenceVisible:[1,0,1]}],{budget:20}).provenance.every(v=>v===0));
 const s=sampleSurface([{...triangle,vertexReferenceVisible:undefined}],{budget:20});assert.ok(s.provenance.every(v=>v===0));assert.match(s.provenanceMeaning,/not geometry truth/);
});
test('invalid tags and indices rejected, optional importance bounded and not probability',()=>{
 assert.throws(()=>sampleSurface([{...triangle,vertexReferenceVisible:[1]}]),/length/);
 assert.throws(()=>sampleSurface([{...triangle,indices:[0,1,5]}]),/range/);
 assert.throws(()=>sampleSurface([triangle],{budget:-1}),/budget/);
 const a=sampleSurface([triangle],{budget:20,importance:()=>10000}),b=sampleSurface([triangle],{budget:20,importance:()=>4});assert.deepEqual(a,b);assert.match(a.weightMeaning,/not calibrated probability/);
});
test('indexed triangle coverage follows area within a single mesh',()=>{
 const mesh={id:'two-triangles',positions:[0,0,0,1,0,0,0,1,0,10,0,0,13,0,0,10,1,0],indices:[0,1,2,3,4,5],normals:[0,0,0,0,0,0,0,0,0,0,0,4,0,0,4,0,0,4]};
 const s=sampleSurface([mesh],{budget:16000});let second=0;
 for(let i=0;i<s.count;i++){if(s.positions[i*3]>9)second++;assert.ok(Array.from(s.normals.subarray(i*3,i*3+3)).every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...s.normals.subarray(i*3,i*3+3))-1)<1e-6);}
 assert.ok(Math.abs(second/s.count-0.75)<0.015);assert.ok(s.triangleIndex.includes(0)&&s.triangleIndex.includes(1));
});
