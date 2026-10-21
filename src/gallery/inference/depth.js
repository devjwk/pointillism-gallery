// 업로드 이미지용 깊이 추정 (Depth Anything V2 small, 브라우저에서 실행, 인터넷 필요)
// transformers.js를 한 번만 불러오고 설정을 공유 (모델 계산은 워커에서 실행해 화면이 멈추지 않게 함)
let _T = null;
async function getT() {
  if (_T) return _T;
  const T = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1');
  T.env.allowLocalModels = false;
  T.env.backends.onnx.wasm.proxy = true;
  _T = T;
  return T;
}
let _depthPipe = null;
async function getDepthPipe() {
  if (_depthPipe) return _depthPipe;
  const T = await getT();
  _depthPipe = await T.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'q8' });
  return _depthPipe;
}
async function runDepthEstimate(idx, url) {
  statusEl.textContent = '깊이 추정 중... (처음에는 모델 다운로드로 수십 초 걸려요)';
  try {
    const pipe = await getDepthPipe();
    const out = await pipe(url);
    const g = ART[idx].gray, d = out.depth, gw = g.w, gh = g.h;
    const lum = new Float32Array(gw*gh);
    for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) {
      const sx = Math.min(d.width-1, Math.floor((x+0.5)*d.width/gw)), sy = Math.min(d.height-1, Math.floor((y+0.5)*d.height/gh));
      lum[y*gw+x] = d.data[(sy*d.width + sx)*d.channels] / 255;
    }
    g.depth = lum;
    if (S.cur === idx) rebuild(true, false);
  } catch (e) { statusEl.textContent = '깊이 추정 실패 (인터넷 필요) · 밝기 기반 깊이로 표시: ' + e.message; }
}
