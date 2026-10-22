function rotateRGB(src, rot) {
  let { w, h, data } = src;
  for (let r=0; r<rot; r++) {
    const out = new Uint8Array(w*h*3);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) { const a = (y*w + x)*3, b = (x*h + (h-1-y))*3; out[b] = data[a]; out[b+1] = data[a+1]; out[b+2] = data[a+2]; }
    data = out; const tt = w; w = h; h = tt;
  }
  return { w, h, data };
}
function rotateIds(ids, w, h, rot) {
  for (let r=0; r<rot; r++) {
    const out = new Uint8Array(w*h);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) out[x*h + (h-1-y)] = ids[y*w+x];
    ids = out; const tt = w; w = h; h = tt;
  }
  return { ids, w, h };
}
// 구성요소(segment)별 면적, 중심, 대표 깊이(중앙값)
function computeSegStats(map) {
  const { w, h, segIds, depth0 } = map, n = w*h;
  let maxId = 0; for (let i=0;i<n;i++) if (segIds[i] > maxId) maxId = segIds[i];
  const K = maxId + 1, hist = new Uint32Array(K*256), area = new Float64Array(K), sx = new Float64Array(K), sy = new Float64Array(K);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i = y*w + x, id = segIds[i];
    hist[id*256 + Math.min(255, (depth0[i]*255)|0)]++; area[id]++; sx[id] += x; sy[id] += y;
  }
  const st = [];
  for (let id=0; id<K; id++) {
    let med = 0.5;
    if (area[id] > 0) { let acc = 0; for (let b=0;b<256;b++) { acc += hist[id*256+b]; if (acc >= area[id]/2) { med = b/255; break; } } }
    st[id] = { id, area: area[id], frac: area[id]/n, med, cx: area[id] ? sx[id]/area[id]/w : 0.5, cy: area[id] ? sy[id]/area[id]/h : 0.5 };
  }
  map.segStat = st;
  let acc = 0; for (let i=0;i<n;i++) acc += depth0[i]; map.gmed = acc / n;
}
function boxBlur(src, w, h, r) {   // 슬라이딩 윈도우: 반경과 무관하게 O(N)
  const tmp = new Float32Array(w*h), out = new Float32Array(w*h);
  for (let y=0;y<h;y++) {
    const row = y*w; let sum = 0, cnt = 0;
    for (let x=0;x<=r && x<w;x++) { sum += src[row+x]; cnt++; }
    for (let x=0;x<w;x++) {
      tmp[row+x] = sum / cnt;
      const a = x + r + 1, b = x - r;
      if (a < w) { sum += src[row+a]; cnt++; }
      if (b >= 0) { sum -= src[row+b]; cnt--; }
    }
  }
  for (let x=0;x<w;x++) {
    let sum = 0, cnt = 0;
    for (let y=0;y<=r && y<h;y++) { sum += tmp[y*w+x]; cnt++; }
    for (let y=0;y<h;y++) {
      out[y*w+x] = sum / cnt;
      const a = y + r + 1, b = y - r;
      if (a < h) { sum += tmp[a*w+x]; cnt++; }
      if (b >= 0) { sum -= tmp[b*w+x]; cnt--; }
    }
  }
  return out;
}
function gaussBlur(src, w, h, sigma) {   // 상자 흐림 3번 = 가우시안 근사
  if (sigma < 0.5) return Float32Array.from(src);
  const n = 3, wIdeal = Math.sqrt(12*sigma*sigma/n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12*sigma*sigma - n*wl*wl - 4*n*wl - 3*n) / (-4*wl - 4));
  let out = src;
  for (let i=0;i<n;i++) out = boxBlur(out, w, h, ((i < m ? wl : wu) - 1) / 2);
  return out;
}
function guidedFilter(I, p, w, h, r, eps) {   // 가이드 필터: 그림의 경계를 따라 깊이 경계를 정렬
  const N = w*h, Ip = new Float32Array(N), II = new Float32Array(N);
  for (let i=0;i<N;i++) { Ip[i] = I[i]*p[i]; II[i] = I[i]*I[i]; }
  const mI = boxBlur(I, w, h, r), mP = boxBlur(p, w, h, r), cIp = boxBlur(Ip, w, h, r), cII = boxBlur(II, w, h, r);
  const a = new Float32Array(N), b = new Float32Array(N);
  for (let i=0;i<N;i++) { const v = cII[i] - mI[i]*mI[i], c = cIp[i] - mI[i]*mP[i]; a[i] = c / (v + eps); b[i] = mP[i] - a[i]*mI[i]; }
  const mA = boxBlur(a, w, h, r), mB = boxBlur(b, w, h, r), q = new Float32Array(N);
  for (let i=0;i<N;i++) q[i] = mA[i]*I[i] + mB[i];
  return q;
}
function percentiles(arr, lo, hi) {   // 정렬 대신 히스토그램: O(N)
  let mn = Infinity, mx = -Infinity;
  for (let i=0;i<arr.length;i++) { const v = arr[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const B = 2048, sc = (B-1) / Math.max(1e-6, mx - mn), hist = new Uint32Array(B);
  for (let i=0;i<arr.length;i++) hist[((arr[i]-mn)*sc) | 0]++;
  const at = q => { let acc = 0; const t = q*arr.length; for (let b=0;b<B;b++) { acc += hist[b]; if (acc >= t) return mn + b/sc; } return mx; };
  return [at(lo), at(hi)];
}
function normalizeRange(arr, lo, hi) {
  const [a0, a1] = percentiles(arr, lo, hi), sp = Math.max(0.05, a1 - a0), out = new Float32Array(arr.length);
  for (let i=0;i<arr.length;i++) out[i] = clamp((arr[i] - a0) / sp, 0, 1);
  return out;
}
function analyzeImage(gray, rotation, p) {
  const rot = ((rotation % 4) + 4) % 4;
  const { w, h, lum: src } = rotateGray(gray, rot);
  const lum = new Float32Array(src);
  const blur = boxBlur(lum, w, h, 1);
  for (let i=0;i<w*h;i++) lum[i] = clamp(lum[i] + 0.9*(lum[i] - blur[i]), 0, 1);
  if (p.localContrast > 0) {   // 지역 대비: 얼굴처럼 전체가 밝은 곳 안의 미세한 명암(눈, 코, 입, 볼)을 끌어올린다
    const lg = gaussBlur(lum, w, h, 0.03*Math.max(w, h));
    for (let i=0;i<w*h;i++) lum[i] = clamp(lum[i] + p.localContrast*1.3*(lum[i] - lg[i]), 0, 1);
  }
  const lv = normalizeRange(lum, 0.02, 0.98);
  // 점 배치용 중요도만 반전할 수 있다. 표시 RGB와 원본 명암·깊이에는 적용하지 않는다.
  if (p.samplingInvert) for (let i=0;i<w*h;i++) lv[i] = 1 - lv[i];
  const out = new Float32Array(w*h);
  for (let i=0;i<w*h;i++) out[i] = Math.pow(clamp((lv[i] - 0.5)*p.contrast + 0.5, 0, 1), p.gamma);
  // 선 분석과 디테일 지도 (원본 명암 기준, 회전별로 캐시)
  gray._an = gray._an || {};
  const akey = 'r' + rot;
  if (!gray._an[akey]) {
    const lines = extractLines(src, w, h), d0 = computeDetail(src, w, h);
    const dl = normalizeRange(gaussBlur(lines.strength, w, h, 3.0), 0.5, 0.995), detail = new Float32Array(w*h);
    for (let i=0;i<w*h;i++) detail[i] = Math.max(d0[i], 0.9*dl[i]);      // 기울기 + 선 밀도: 옅은 선이 모인 곳도 디테일로
    gray._an[akey] = { lines, detail };
  }
  const an = gray._an[akey];
  if (p.lineTone > 0) {   // 선이 점 밀도에서도 또렷하게: 어두운 선은 파고, 반전 모드에서는 밝게 돋운다
    const sg = p.samplingInvert ? 1 : -1, kk = p.lineTone*0.85, M = an.lines.mask;
    for (let i=0;i<w*h;i++) out[i] = clamp(out[i] + sg*kk*M[i], 0, 1);
  }
  let d0;
  if (gray.depth) {
    d0 = normalizeRange(rotateGray({ w: gray.w, h: gray.h, lum: gray.depth }, rot).lum, 0.01, 0.99);
    // 모델 깊이의 경계를 그림 자체의 경계에 맞춘다 (경계가 번져 보이는 문제 완화)
    d0 = normalizeRange(guidedFilter(src, d0, w, h, Math.max(2, Math.round(0.007*Math.max(w, h))), 0.004), 0.003, 0.997);
  } else {
    const big = boxBlur(src, w, h, 12), small = boxBlur(src, w, h, 3), dr = new Float32Array(w*h);
    for (let i=0;i<w*h;i++) dr[i] = 0.7*big[i] + 0.3*small[i];
    d0 = normalizeRange(dr, 0.02, 0.98);
  }
  const dens = new Float32Array(w*h), dk = p.detail;
  let densitySum = 0;
  for (let i=0;i<w*h;i++) { dens[i] = densityOf(out[i])*(1 + dk*an.detail[i]); densitySum += dens[i]; }
  // 완전한 검정처럼 중요도가 전부 0인 입력도 원본 색을 가진 점으로 표시한다.
  if (densitySum < 1e-6) dens.fill(1);
  const map = { rgb: gray.rgb ? rotateRGB(gray.rgb, rot) : null, w, h, lum: new Float32Array(src), samplingLum: out, dens, detail: an.detail, lines: an.lines, depth0: d0, depthReal: !!gray.depth, bands: null, segIds: null, segStat: null, gmed: 0.5 };
  if (gray.segIds) { map.segIds = rotateIds(gray.segIds, gray.w, gray.h, rot).ids; computeSegStats(map); }
  map.depth = composeDepth(map, p);
  return map;
}
// 깊이 = 모델 깊이 + 그림 자체의 단서(명암 -> 높이, 필치 -> 미세 부조)
// 사진으로 학습된 모델은 수묵화/풍속화를 거의 평평한 경사면으로 보기 때문에 그림의 명암과 필치를 보조 단서로 쓴다
function composeDepth(map, p) {
  const { w, h, lum, depth0 } = map, n = w*h, L = Math.max(w, h);
  if (!map.bands) {
    const s1 = gaussBlur(lum, w, h, 1.2), s2 = gaussBlur(lum, w, h, 3), s3 = gaussBlur(lum, w, h, 8), s4 = gaussBlur(lum, w, h, 0.04*L);
    const R = new Float32Array(n);
    for (let i=0;i<n;i++) R[i] = 0.45*(s1[i]-s2[i]) + 0.35*(s2[i]-s3[i]) + 0.2*(s3[i]-s4[i]);   // 다중 스케일 DoG
    const [r0, r1] = percentiles(R, 0.01, 0.99), sc = Math.max(1e-4, Math.max(Math.abs(r0), Math.abs(r1)));
    for (let i=0;i<n;i++) R[i] = clamp(R[i]/sc, -1, 1);
    map.bands = { R, T: normalizeRange(gaussBlur(lum, w, h, 0.012*L), 0.01, 0.99) };
  }
  const out = new Float32Array(n), tw = clamp(p.tone, 0, 1)*0.6, rw = p.relief*0.18, T = map.bands.T, R = map.bands.R;
  const ids = map.segIds, st = map.segStat, u = ids ? clamp(p.unify, 0, 1)*0.8 : 0, sp = ids ? p.sep*0.4 : 0;
  for (let i=0;i<n;i++) {
    let d = depth0[i];
    if (ids && ids[i]) {
      const m = st[ids[i]].med;
      d += (m - d)*u;                    // 같은 피사체는 하나의 덩어리로 (모델의 노이즈 억제)
      d += (m - map.gmed)*sp;            // 피사체 사이 간격을 벌려 층을 분리
    }
    out[i] = clamp(d*(1-tw) + T[i]*tw + rw*R[i], 0, 1);
  }
  return out;
}

