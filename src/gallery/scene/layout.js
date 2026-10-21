// ---------- 레이아웃 (월드 좌표는 스테이지 중심 기준) ----------
function imageBox() {
  // 원근 때문에 앞으로 튀어나온 부분이 화면 밖으로 넘치지 않도록 그림 틀을 미리 줄여 둔다
  let maxW = W*S.boxFrac, maxH = H*0.9;
  if (!S.flat) { const a0 = Math.min(maxW, maxH), pf = 1500 / (1500 - 0.5 * S.params.depth * a0 * 0.6 * 0.8); maxW /= pf; maxH /= pf; }
  let bw = maxW, bh = bw / S.aspect;
  if (bh > maxH) { bh = maxH; bw = bh * S.aspect; }
  return { x: (W-bw)/2, y: (H-bh)/2, w: bw, h: bh };
}
function drawDepthMap(depth, w, h) {
  const c = document.getElementById('dmap'); if (!c) return;
  const k = 120 / Math.max(w, h);
  c.width = Math.max(1, Math.round(w*k)); c.height = Math.max(1, Math.round(h*k));
  const g = c.getContext('2d'), id = g.createImageData(c.width, c.height);
  for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++) {
    const v = Math.round(255 * depth[Math.min(h-1, Math.floor(y/k))*w + Math.min(w-1, Math.floor(x/k))]);
    const o = (y*c.width + x)*4; id.data[o] = id.data[o+1] = id.data[o+2] = v; id.data[o+3] = 255;
  }
  g.putImageData(id, 0, 0);
}
function mapTargets() {
  const b = imageBox();
  const amp = S.params.depth * Math.min(b.w, b.h) * 0.6 * (S.invert ? -1 : 1) * (S.flat ? 0 : 1);
  for (let i=0;i<S.n;i++) {
    S.tx[i] = (S.nx[i]-0.5) * b.w;
    S.ty[i] = (S.ny[i]-0.5) * b.h;
    S.tz[i] = -(S.dep[i]-0.5) * amp;
  }
}
function randomScatter(i) {
  S.sx[i] = (Math.random()-0.5) * W * 1.25;
  S.sy[i] = (Math.random()-0.5) * H * 1.25;
  S.sz[i] = (Math.random()-0.5) * 1300;
}
function retargetDepth() {
  if (!S.n) return;
  mapTargets();
  if (S.mode === 'form') {
    const now = performance.now(); snapshot(now);
    for (let i=0;i<S.n;i++) { S.fx[i]=S.rx[i]; S.fy[i]=S.ry[i]; S.fz[i]=S.rz[i]; S.t0[i]=now; S.dur[i]=650; }
    uploadMotion();
  }
}

