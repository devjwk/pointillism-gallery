// Visible-surface baseline only. This does NOT complete object backsides or occluded background.
// Input depth is normalized relative inverse depth, NOT metric camera distance.
export function srgbToLinear(byte) {
  const c=Math.min(255,Math.max(0,byte))/255;
  return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
}
function bilinear(data,w,h,channels,x,y,channel=0){
  x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),tx=x-x0,ty=y-y0;
  const at=(xx,yy)=>data[(yy*w+xx)*channels+channel];
  return (at(x0,y0)*(1-tx)+at(x1,y0)*tx)*(1-ty)+(at(x0,y1)*(1-tx)+at(x1,y1)*tx)*ty;
}
const round=v=>Math.round(v*1e6)/1e6;
export function createVisibleSurface(input,{maxSide=256,fovX=55,near=1,far=4,maxDepthJump=.12,budget=8000,seed=42}={}){
  const {depthWidth:dw,depthHeight:dh,rgbWidth:rw,rgbHeight:rh,depth,rgb}=input;
  if(![dw,dh,rw,rh].every(x=>Number.isInteger(x)&&x>=2)||depth?.length!==dw*dh||rgb?.length!==rw*rh*3)throw new Error('Depth/RGB grid dimensions do not match data.');
  if(!Number.isInteger(maxSide)||maxSide<8||maxSide>512||!(fovX>10&&fovX<140)||!(near>0&&far>near)||!(maxDepthJump>0&&maxDepthJump<=1))throw new Error('Invalid camera/mesh settings.');
  if(!Number.isInteger(budget)||budget<1000||budget>150000||!Number.isSafeInteger(seed))throw new Error('Invalid point budget or seed.');
  if(!Array.from(depth).every(x=>Number.isFinite(x)&&x>=0&&x<=1)||!Array.from(rgb).every(x=>Number.isFinite(x)&&x>=0&&x<=255))throw new Error('Nonfinite/out-of-range depth or RGB.');
  if(Math.abs(dw/dh-rw/rh)>.01)throw new Error('RGB/depth aspect ratio mismatch.');
  const scale=Math.min(1,maxSide/Math.max(dw,dh));
  const w=Math.max(2,Math.round(dw*scale)),h=Math.max(2,Math.round(dh*scale));
  const fx=.5*w/Math.tan(fovX*Math.PI/360),fy=fx,cx=(w-1)/2,cy=(h-1)/2;
  const positions=[],colors=[],zs=new Float64Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const d=bilinear(depth,dw,dh,1,(x+.5)*dw/w-.5,(y+.5)*dh/h-.5);
    const z=1/(1/far+d*(1/near-1/far));zs[y*w+x]=z;
    positions.push(round((x-cx)*z/fx),round((y-cy)*z/fy),round(z));
    for(let c=0;c<3;c++)colors.push(round(srgbToLinear(bilinear(rgb,rw,rh,3,(x+.5)*rw/w-.5,(y+.5)*rh/h-.5,c))));
  }
  const indices=[];let rejected=0;
  for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){
    const a=y*w+x,b=a+1,c=a+w,d=c+1;
    for(const tri of [[a,c,b],[b,c,d]]){
      const values=tri.map(i=>zs[i]);
      if((Math.max(...values)-Math.min(...values))/Math.min(...values)>maxDepthJump){rejected++;continue;}
      indices.push(...tri);
    }
  }
  if(!indices.length)throw new Error('No continuous surface triangles.');
  let maxReprojectionError=0;
  for(let i=0;i<w*h;i++){
    const u=fx*positions[i*3]/positions[i*3+2]+cx,v=fy*positions[i*3+1]/positions[i*3+2]+cy;
    maxReprojectionError=Math.max(maxReprojectionError,Math.hypot(u-i%w,v-Math.floor(i/w)));
  }
  const statistics={vertices:w*h,triangles:indices.length/3,rejectedTriangles:rejected,triangleKeepFraction:(indices.length/3)/(2*(w-1)*(h-1)),maxAnalyticReprojectionErrorPixels:maxReprojectionError,
    meaning:'This checks the camera construction, not accuracy of predicted depth or unseen geometry.'};
  const scene={schema_version:'scene-first/0.1',coordinate_frame:'opencv_camera',point_budget:budget,seed,synthetic:false,completion_scope:'visible_surface_only',generation_completed:true,
    reference:{width:w,height:h,intrinsics:[fx,fy,cx,cy],...(input.source_image_data_url?{image_data_url:input.source_image_data_url}:{})},
    assets:[{id:'photo-visible-surface',role:'background',geometry_source:'monocular_depth',geometry:{positions,indices,colors,vertex_reference_visible:new Array(w*h).fill(1)}}],
    conversion:{method:'camera_backprojection_of_relative_inverse_depth',depthModel:input.depthProvenance||null,assumedCamera:true,horizontalFovDegrees:fovX,distanceUnits:'arbitrary relative units',nearDistance:near,farDistance:far,sourceOrientedSize:[input.imageWidth,input.imageHeight],meshSize:[w,h],validation:statistics},
    warnings:['Visible-surface baseline only: unseen backsides and occluded background are NOT reconstructed.','Camera FOV and depth-to-distance mapping are assumptions, not recovered calibration.','Reference-supported color does not make the geometry measured ground truth.','A rear point view shows front-surface points from behind, not a generated object backside.','Cut discontinuity triangles are left as gaps rather than connecting unrelated surfaces.']};
  return {scene,statistics};
}
