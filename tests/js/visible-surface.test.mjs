import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {createVisibleSurface,srgbToLinear}=await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../../tools/scene-validation/src/geometry/visible-surface.js',import.meta.url))).toString('base64'));
const input=()=>({depthWidth:16,depthHeight:16,depth:new Array(256).fill(.5),rgbWidth:16,rgbHeight:16,rgb:new Array(768).fill(128)});
test('visible surface is a mesh first, with known winding, exact grid projection and honest scope',()=>{
 const {scene,statistics}=createVisibleSurface(input(),{maxSide:16,budget:4000});
 assert.equal(scene.synthetic,false);assert.equal(scene.completion_scope,'visible_surface_only');
 assert.equal(scene.assets[0].geometry.positions.length,256*3);assert.equal(statistics.triangles,450);
 assert.ok(statistics.maxAnalyticReprojectionErrorPixels<1e-3);assert.equal(scene.conversion.assumedCamera,true);
 const g=scene.assets[0].geometry,[a,b,c]=g.indices.slice(0,3),p=i=>g.positions.slice(i*3,i*3+3),A=p(a),B=p(b),C=p(c);
 const normalZ=(B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]);assert.ok(normalZ<0);
 assert.ok(g.vertex_reference_visible.every(v=>v===1));assert.ok(scene.warnings.some(s=>s.includes('NOT reconstructed')));
});
test('depth edge is cut, not bridged into a fake side surface',()=>{
 const i=input();i.depth=i.depth.map((_,n)=>n%16<8?0:1);const {statistics,scene}=createVisibleSurface(i,{maxSide:16});
 assert.ok(statistics.rejectedTriangles>0);assert.ok(statistics.triangleKeepFraction<1);
 const g=scene.assets[0].geometry;for(let n=0;n<g.indices.length;n+=3){const zs=g.indices.slice(n,n+3).map(x=>g.positions[x*3+2]);assert.ok((Math.max(...zs)-Math.min(...zs))/Math.min(...zs)<=.12001);}
});
test('RGB conversion is linear for Three.js, not double gamma corrected',()=>{
 assert.equal(srgbToLinear(0),0);assert.equal(srgbToLinear(255),1);assert.ok(Math.abs(srgbToLinear(128)-.2158605)<1e-6);
 const {scene}=createVisibleSurface(input(),{maxSide:16});assert.ok(Math.abs(scene.assets[0].geometry.colors[0]-.215861)<1e-6);
});
test('determinism and budget changes preserve geometry instead of estimating again',()=>{
 const a=createVisibleSurface(input(),{maxSide:16,budget:4000}),b=createVisibleSurface(input(),{maxSide:16,budget:16000});
 assert.deepEqual(a.scene.assets,b.scene.assets);assert.equal(a.scene.point_budget,4000);assert.equal(b.scene.point_budget,16000);
});
test('invalid/unaligned maps and invalid camera settings fail instead of fabricating depth',()=>{
 const nan=input();nan.depth[2]=NaN;assert.throws(()=>createVisibleSurface(nan),/depth or RGB/);
 assert.throws(()=>createVisibleSurface({...input(),rgbWidth:8}),/dimensions/);
 assert.throws(()=>createVisibleSurface(input(),{near:4,far:1}),/settings/);
 assert.throws(()=>createVisibleSurface(input(),{fovX:180}),/settings/);
 assert.throws(()=>createVisibleSurface(input(),{budget:0}),/budget/);
});
