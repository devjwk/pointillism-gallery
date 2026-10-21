// Client-only visible-surface baseline. Public GETs download model code/weights;
// input photos are decoded and inferred locally and are never sent to an API.
import {createVisibleSurface} from '../geometry/visible-surface.js';
let pipePromise=null,workQueue=Promise.resolve();
function check(signal){if(signal?.aborted)throw new DOMException('Aborted','AbortError');}
async function loadPipe(progress){
  if(pipePromise)return pipePromise;
  pipePromise=(async()=>{
    const initialize=async(suffix,proxy)=>{
      const T=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1?offline-visible='+suffix);
      T.env.allowLocalModels=false;T.env.backends.onnx.wasm.proxy=proxy;T.env.backends.onnx.wasm.numThreads=1;
      T.env.backends.onnx.wasm.wasmPaths='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/';
      return T.pipeline('depth-estimation','onnx-community/depth-anything-v2-small',{dtype:'q8',progress_callback:p=>{if(p.status==='progress'&&Number.isFinite(p.progress))progress?.('깊이 모델 준비 · '+Math.round(p.progress)+'%');}});
    };
    try{return await initialize('worker-v1',location.protocol!=='file:');}
    catch(error){if(!/backend|worker|wasm/i.test(String(error?.message||error)))throw error;progress?.('호환 실행 방식으로 깊이 모델을 다시 준비합니다.');return initialize('main-thread-v1',false);}
  })().catch(error=>{pipePromise=null;throw error;});
  return pipePromise;
}
export async function estimateLocalPhoto(file,{signal,onProgress,maxSide=256,budget=8000,seed=42}={}){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('20 MiB 이하 JPG·PNG·WebP 사진을 선택하세요.');
  check(signal);onProgress?.('사진을 브라우저 안에서 읽는 중…');
  const url=URL.createObjectURL(file),image=new Image();
  try{
    image.src=url;await image.decode();check(signal);
    const iw=image.naturalWidth,ih=image.naturalHeight;
    if(Math.min(iw,ih)<64||iw*ih>50_000_000)throw new Error('한 변 64px 이상, 50메가픽셀 이하 사진을 사용하세요.');
    const ratio=Math.min(1,900/Math.max(iw,ih));const source=document.createElement('canvas');source.width=Math.round(iw*ratio);source.height=Math.round(ih*ratio);source.getContext('2d').drawImage(image,0,0,source.width,source.height);
    const scale=Math.min(1,maxSide/Math.max(source.width,source.height));const color=document.createElement('canvas');color.width=Math.max(2,Math.round(source.width*scale));color.height=Math.max(2,Math.round(source.height*scale));
    const ctx=color.getContext('2d');ctx.drawImage(image,0,0,color.width,color.height);const rgba=ctx.getImageData(0,0,color.width,color.height).data;
    const rgb=[];for(let i=0;i<rgba.length;i++)if(i%4!==3)rgb.push(rgba[i]);
    const input={rgbWidth:color.width,rgbHeight:color.height,rgb,imageWidth:iw,imageHeight:ih,source_image_data_url:color.toDataURL('image/png')};
    const sourceURL=source.toDataURL('image/jpeg',.96);image.src='';
    onProgress?.('로컬 AI 깊이 추정 준비 중 · 첫 실행은 모델 다운로드가 필요합니다.');
    const pending=workQueue.catch(()=>{}).then(async()=>{check(signal);const pipe=await loadPipe(onProgress);check(signal);onProgress?.('사진의 가시 표면 깊이를 로컬에서 계산 중…');await new Promise(r=>setTimeout(r,40));check(signal);return pipe(sourceURL);});
    workQueue=pending.then(()=>{},()=>{});
    const result=await pending;check(signal);
    const d=result.depth;if(!d?.data||!(d.width>0&&d.height>0))throw new Error('깊이 지도 생성에 실패했습니다.');
    const channels=d.channels||1;input.depthWidth=d.width;input.depthHeight=d.height;input.depth=Array.from({length:d.width*d.height},(_,i)=>d.data[i*channels]/255);
    input.depthProvenance={model:'onnx-community/depth-anything-v2-small',dtype:'q8',execution:'browser-local; photo not uploaded',inputWorkingSize:[source.width,source.height],completedAt:new Date().toISOString()};
    let sha=null;try{const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());sha=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');}catch{}
    check(signal);onProgress?.('깊이에서 3D 표면을 만든 뒤 점 배치 준비 중…');
    const {scene,statistics}=createVisibleSurface(input,{maxSide,budget,seed});
    scene.conversion.sourceName=file.name;scene.conversion.sourceSha256=sha;
    return {scene,statistics};
  }finally{image.src='';URL.revokeObjectURL(url);}
}
