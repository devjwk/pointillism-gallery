// =====================================================================
//  이미지 -> 밝기/깊이 분석
// =====================================================================
function grayFromImage(img) {
  const LONG = 900;
  const k = LONG / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  // 투명 PNG는 흰 바탕에 합성한다. 정상적인 검정 이미지를 읽기 실패로 오인하지 않는다.
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w*h);
  for (let i=0;i<w*h;i++) lum[i] = (0.2126*data[i*4] + 0.7152*data[i*4+1] + 0.0722*data[i*4+2]) / 255;
  const ck = Math.min(1, 280/Math.max(w, h)), cw = Math.max(4, Math.round(w*ck)), ch = Math.max(4, Math.round(h*ck));
  const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
  const g2 = c2.getContext('2d', { willReadFrequently: true }); g2.imageSmoothingQuality = 'high'; g2.drawImage(c, 0, 0, cw, ch);
  const px = g2.getImageData(0, 0, cw, ch).data, rgb = new Uint8Array(cw*ch*3);
  for (let i=0;i<cw*ch;i++) { rgb[3*i] = px[4*i]; rgb[3*i+1] = px[4*i+1]; rgb[3*i+2] = px[4*i+2]; }
  return { w, h, lum, rgb: { w: cw, h: ch, data: rgb } };
}
function bytesToGray(bytes, w, h) {
  const lum = new Float32Array(w*h);
  for (let i=0;i<lum.length;i++) lum[i] = bytes[i] / 255;
  return { w, h, lum };
}
async function inflateB64(b64) {
  if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축 해제를 지원하지 않아요');
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// 추가 작품은 선택할 때만 지도를 받는다. 기존 4점의 내장 데이터 형식은 그대로 지원한다.
async function loadArtworkMaps(m) {
  if (!m.dataPath) return m;
  if (!/^\.\/assets\/artworks\/maps\/[a-z0-9-]+\.json$/.test(m.dataPath)) throw new Error('올바르지 않은 작품 데이터 경로');
  const response = await fetch(m.dataPath);
  if (!response.ok) throw new Error('작품 이미지 지도 로딩 실패 (HTTP ' + response.status + ')');
  const data = await response.json();
  for (const key of ['id', 'w', 'h', 'dw', 'dh', 'rw', 'rh']) if (data[key] !== m[key]) throw new Error('작품 이미지 지도 정보 불일치: ' + key);
  for (const key of ['gray', 'depth', 'rgb']) if (typeof data[key] !== 'string' || !data[key]) throw new Error('작품 이미지 지도 누락: ' + key);
  return data;
}
async function decodeArtworkMaps(a) {
  const m = a.meta, data = await loadArtworkMaps(m);
  const [g, d, rgb] = await Promise.all([inflateB64(data.gray), inflateB64(data.depth), data.rgb ? inflateB64(data.rgb) : null]);
  const dw = m.dw || m.w, dh = m.dh || m.h;
  if (g.length !== m.w*m.h || d.length !== dw*dh || (rgb && rgb.length !== m.rw*m.rh*3)) throw new Error('작품 이미지 지도 크기가 맞지 않아요');
  const gray = bytesToGray(g, m.w, m.h), dm = bytesToGray(d, dw, dh);
  gray.depth = (dm.w === m.w && dm.h === m.h) ? dm.lum : resizeBilinear(dm.lum, dm.w, dm.h, m.w, m.h);
  if (rgb) gray.rgb = { w: m.rw, h: m.rh, data: rgb };
  if (m.seg) {
    const ids = await inflateB64(m.seg.ids);
    const sw0 = m.seg.w || m.w, sh0 = m.seg.h || m.h;
    if (ids.length !== sw0*sh0) throw new Error('구성요소 지도 크기가 맞지 않아요');
    a.seg = { w: sw0, h: sh0, ids, segs: m.seg.segs, context: m.seg.context || '' };
    gray.segIds = (sw0 === m.w && sh0 === m.h) ? ids : resizeIdsNearest(ids, sw0, sh0, m.w, m.h);
  }
  // 모든 압축 해제와 검증을 마친 뒤에만 캐시한다. 실패한 요청은 다음 선택에서 재시도할 수 있다.
  a.gray = gray;
  return gray;
}
async function ensureGray(i) {
  const a = ART[i];
  if (a.gray) return a.gray;
  if (!a.grayTask) a.grayTask = decodeArtworkMaps(a).finally(() => { a.grayTask = null; });
  return a.grayTask;
}
function rotateGray(g, rot) {
  let { w, h, lum } = g;
  for (let r=0; r<rot; r++) { // 90도 시계방향
    const out = new Float32Array(w*h);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) out[x*h + (h-1-y)] = lum[y*w+x];
    lum = out; const t = w; w = h; h = t;
  }
  return { w, h, lum };
}
function resizeBilinear(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw*dh);
  for (let y=0;y<dh;y++) {
    const fy = Math.min(sh-1, Math.max(0, (y+0.5)*sh/dh - 0.5)), y0 = fy|0, y1 = Math.min(sh-1, y0+1), ty = fy - y0;
    for (let x=0;x<dw;x++) {
      const fx = Math.min(sw-1, Math.max(0, (x+0.5)*sw/dw - 0.5)), x0 = fx|0, x1 = Math.min(sw-1, x0+1), tx = fx - x0;
      const a = src[y0*sw+x0]*(1-tx) + src[y0*sw+x1]*tx, b = src[y1*sw+x0]*(1-tx) + src[y1*sw+x1]*tx;
      out[y*dw+x] = a*(1-ty) + b*ty;
    }
  }
  return out;
}
function resizeIdsNearest(ids, sw, sh, dw, dh) {
  const out = new Uint8Array(dw*dh);
  for (let y=0;y<dh;y++) { const sy = Math.min(sh-1, Math.floor((y+0.5)*sh/dh)); for (let x=0;x<dw;x++) out[y*dw+x] = ids[sy*sw + Math.min(sw-1, Math.floor((x+0.5)*sw/dw))]; }
  return out;
}
