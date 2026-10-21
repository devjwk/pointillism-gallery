// View-conditioned sampling on EXISTING 3D triangles. No 2D point positions are generated.
// Weights use a fixed reference camera, never the interactive/orbit camera.
export function createReferenceDensity(assets,reference,{unknownFloor=.15}={}){
  const k=reference?.intrinsics;
  if(!Array.isArray(k)||k.length!==4||!k.every(Number.isFinite)||k[0]<=0||k[1]<=0)return{importance:undefined,policy:'surface_area',supported:false};
  const [fx,fy,cx,cy]=k,entries=new Map();let worldSum=0,pixelSum=0,supportedFaces=0;
  for(const asset of assets){const p=asset.positions,ix=asset.indices,n=(ix?ix.length:p.length/3)/3;const rows=[];
    for(let t=0;t<n;t++){
      const ids=ix?[ix[t*3],ix[t*3+1],ix[t*3+2]]:[t*3,t*3+1,t*3+2];
      const a=ids.map(i=>[p[i*3],p[i*3+1],p[i*3+2]]),u=a[1].map((v,i)=>v-a[0][i]),v=a[2].map((v,i)=>v-a[0][i]);
      const area=.5*Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
      const supported=!!asset.vertexReferenceVisible&&ids.every(i=>asset.vertexReferenceVisible[i]===1)&&a.every(p=>p.every(Number.isFinite)&&p[2]>1e-6);
      let pixels=0;
      if(supported){const uv=a.map(p=>[fx*p[0]/p[2]+cx,fy*p[1]/p[2]+cy]);pixels=.5*Math.abs((uv[1][0]-uv[0][0])*(uv[2][1]-uv[0][1])-(uv[1][1]-uv[0][1])*(uv[2][0]-uv[0][0]));}
      rows.push({area,pixels,supported});if(supported&&area>1e-15&&Number.isFinite(pixels)&&pixels>0){worldSum+=area;pixelSum+=pixels;supportedFaces++;}
    }entries.set(asset,rows);
  }
  if(!(worldSum>0&&pixelSum>0))return{importance:undefined,policy:'surface_area',supported:false};
  const normalization=worldSum/pixelSum;
  const importance=(asset,triangle)=>{const row=entries.get(asset)?.[triangle];if(!row||!row.supported)return unknownFloor;if(!(row.area>1e-15))return 1;return row.pixels*normalization/row.area;};
  return{importance,importanceBounds:[.01,64],policy:'fixed_reference_projected_area',supported:true,referenceSupportedFaces:supportedFaces,unknownFloor,
    meaning:'Reference-view appearance density, not confidence or hidden-surface correctness.'};
}
export function referenceDotDiameter(budget,reference,viewportWidth,viewportHeight,{coverage=.65}={}){
  const w=reference?.width,h=reference?.height;
  if(!(w>0&&h>0&&budget>0&&viewportWidth>0&&viewportHeight>0))return 2;
  const referenceScale=Math.min(viewportWidth/w,viewportHeight/h);
  // IID point coverage approximation. This controls appearance, not geometry or quality scores.
  const diameter=Math.sqrt(4*(-Math.log(1-coverage))*w*h/(Math.PI*budget))*referenceScale;
  return Math.max(1,Math.min(18,diameter));
}
