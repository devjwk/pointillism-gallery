/** Dependency-free, area-weighted sampling of actual triangle meshes.
 * assets: [{id, positions, indices?, normals?, colors?, vertexReferenceVisible?}]
 * Arrays are flat xyz, indices are triangle triplets. Input must already be in
 * the shared scene coordinate frame. Provenance 1 means all triangle vertices
 * have reference-view visibility support, NOT measured/true geometry.
 * importance(asset, triangleIndex) is an optional bounded density multiplier
 * (clamped 0.25..4), never a calibrated probability or confidence score.
 */
export function seededRandom(seed = 42) {
  let a = Number(seed) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function sampleSurface(assets, { budget = 60000, seed = 42, importance, importanceBounds = [0.25, 4] } = {}) {
  if (!Array.isArray(importanceBounds) || importanceBounds.length !== 2 || !importanceBounds.every(Number.isFinite) || importanceBounds[0] <= 0 || importanceBounds[1] < importanceBounds[0] || importanceBounds[1] > 100) throw new RangeError('invalid importance bounds');
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 2000000) throw new RangeError('budget must be an integer in 0..2000000');
  const triangles = []; let totalWeight = 0, totalArea = 0;
  assets.forEach((asset, ai) => {
    const p = asset.positions;
    if (!p || p.length % 3) throw new Error('positions must contain xyz triplets');
    const n = p.length / 3, ix = asset.indices;
    if ((ix ? ix.length : n) % 3) throw new Error('triangle indices/vertices must be triplets');
    for (const key of ['normals', 'colors']) if (asset[key] && asset[key].length !== p.length) throw new Error(`${key} length mismatch`);
    if (asset.vertexReferenceVisible && asset.vertexReferenceVisible.length !== n) throw new Error('visibility tag length mismatch');
    const count = (ix ? ix.length : n) / 3;
    for (let t = 0; t < count; t++) {
      const ids = ix ? [ix[t*3], ix[t*3+1], ix[t*3+2]] : [t*3, t*3+1, t*3+2];
      if (ids.some(i => !Number.isInteger(i) || i < 0 || i >= n)) throw new Error('index out of range');
      const [a,b,c] = ids.map(i => [p[i*3], p[i*3+1], p[i*3+2]]);
      if (![...a,...b,...c].every(Number.isFinite)) throw new Error('non-finite vertex');
      const u=b.map((v,i)=>v-a[i]), v=c.map((v,i)=>v-a[i]);
      const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      const length=Math.hypot(...cross); if (!(length > 1e-15)) continue;
      const area=length/2;
      const raw=importance ? Number(importance(asset,t)) : 1;
      const multiplier=Number.isFinite(raw) ? Math.min(importanceBounds[1],Math.max(importanceBounds[0],raw)) : 1;
      totalArea+=area; totalWeight+=area*multiplier;
      triangles.push({ ai, ids, triangle:t, face:cross.map(x=>x/length), cumulative:totalWeight });
    }
  });
  if (budget && !triangles.length) throw new Error('no non-degenerate triangles');
  const positions=new Float32Array(budget*3), normals=new Float32Array(budget*3), colors=new Float32Array(budget*3);
  const provenance=new Uint8Array(budget), assetIndex=new Uint32Array(budget), sourceAsset=new Array(budget), triangleIndex=new Uint32Array(budget);
  const rng=seededRandom(seed);
  for (let i=0;i<budget;i++) {
    const target=rng()*totalWeight; let lo=0,hi=triangles.length-1;
    while(lo<hi){const mid=(lo+hi)>>>1;if(target<triangles[mid].cumulative)hi=mid;else lo=mid+1;}
    const tr=triangles[lo], a=assets[tr.ai], root=Math.sqrt(rng()), r=rng(), w=[1-root,root*(1-r),root*r];
    const nn=[0,0,0];
    for(let d=0;d<3;d++){
      let pos=0,col=0;
      for(let k=0;k<3;k++){const off=tr.ids[k]*3+d;pos+=a.positions[off]*w[k];col+=(a.colors ? a.colors[off] : 1)*w[k];nn[d]+=(a.normals ? a.normals[off] : tr.face[d])*w[k];}
      positions[i*3+d]=pos;colors[i*3+d]=Number.isFinite(col)?col:1;
    }
    const len=Math.hypot(...nn), normal=Number.isFinite(len)&&len>1e-12 ? nn.map(v=>v/len) : tr.face;
    normals.set(normal,i*3); assetIndex[i]=tr.ai; sourceAsset[i]=String(a.id ?? tr.ai); triangleIndex[i]=tr.triangle;
    provenance[i]=a.vertexReferenceVisible && tr.ids.every(v=>a.vertexReferenceVisible[v]===1) ? 1 : 0;
  }
  return {positions,normals,colors,provenance,assetIndex,sourceAsset,triangleIndex,count:budget,totalArea,weightMeaning:'relative sampling density, not calibrated probability',provenanceMeaning:'reference visibility support, not geometry truth'};
}
