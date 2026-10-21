// =====================================================================
//  구성요소 분석: SAM(slimsam)에 격자 점을 프롬프트로 주고 마스크를 모아 피사체 지도를 만든다
//  (브라우저에서 실행, 처음에는 모델 다운로드 필요)
// =====================================================================
let _sam = null;
async function getSam() {
  if (_sam) return _sam;
  const T = await getT();
  const model = await T.SamModel.from_pretrained('Xenova/slimsam-77-uniform');
  const processor = await T.AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
  _sam = { T, model, processor };
  return _sam;
}
function loadImageEl(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
async function runSegmentation(idx, PTS) {
  const a = ART[idx]; if (!a) return;
  PTS = PTS || 8;
  const bAn = document.getElementById('bAnalyze'); bAn.disabled = true;
  try {
    await ensureGray(idx);
    const g = a.gray, kk = Math.min(1, 520/Math.max(g.w, g.h)), gw = Math.max(8, Math.round(g.w*kk)), gh = Math.max(8, Math.round(g.h*kk)), total = gw*gh;   // SAM은 520px 격자에서 돌린다
    statusEl.textContent = '구성요소 분석 중... (모델 내려받기와 계산에 1~3분 걸려요)';
    const { T, model, processor } = await getSam();
    const sc = document.createElement('canvas'); sc.width = gw; sc.height = gh;
    const sg = sc.getContext('2d');
    if (a.url) { const im = await loadImageEl(a.url); sg.drawImage(im, 0, 0, gw, gh); }
    else { const hc = document.createElement('canvas'); hc.width = g.w; hc.height = g.h; const hg = hc.getContext('2d'); const id = hg.createImageData(g.w, g.h); for (let i=0;i<g.w*g.h;i++) { const v = Math.round(g.lum[i]*255); id.data[4*i] = id.data[4*i+1] = id.data[4*i+2] = v; id.data[4*i+3] = 255; } hg.putImageData(id, 0, 0); sg.imageSmoothingQuality = 'high'; sg.drawImage(hc, 0, 0, gw, gh); }
    const image = await T.RawImage.fromURL(sc.toDataURL('image/png'));
    const emb = await model.get_image_embeddings(await processor(image));
    const cands = [];
    for (let py = 0; py < PTS; py++) for (let px = 0; px < PTS; px++) {
      statusEl.textContent = `구성요소 분석 중... ${py*PTS + px + 1}/${PTS*PTS}`;
      await sleep(0);
      const inputs = await processor(image, { input_points: [[[(px + 0.5)/PTS*image.width, (py + 0.5)/PTS*image.height]]] });
      const out = await model({ ...emb, ...inputs });
      const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
      const m = masks[0], H = m.dims[2], Wd = m.dims[3], scores = out.iou_scores.data;
      for (let k = 0; k < 3; k++) {
        const mk = new Uint8Array(total); let area = 0;
        for (let yy = 0; yy < gh; yy++) { const sy = Math.min(H-1, Math.floor((yy+0.5)*H/gh));
          for (let xx = 0; xx < gw; xx++) { const sx = Math.min(Wd-1, Math.floor((xx+0.5)*Wd/gw)); if (m.data[k*H*Wd + sy*Wd + sx]) { mk[yy*gw+xx] = 1; area++; } } }
        cands.push({ mk, area, score: scores[k] });
      }
    }
    statusEl.textContent = '구성요소 정리 중...';
    await sleep(0);
    const kept = cands.filter(c => c.score >= 0.72 && c.area >= total*0.003 && c.area <= total*0.6).sort((p, q) => q.score - p.score);
    const sel = [];
    for (const c of kept) {
      let dup = false;
      for (const s of sel) { let inter = 0; for (let i=0;i<total;i++) if (c.mk[i] && s.mk[i]) inter++; if (inter/(c.area + s.area - inter) > 0.7) { dup = true; break; } }
      if (!dup) sel.push(c);
    }
    sel.sort((p, q) => q.area - p.area);                       // 큰 것부터 칠하고 작은 것을 위에 덮는다
    const ids = new Uint8Array(total);
    sel.slice(0, 24).forEach((c, k) => { for (let i=0;i<total;i++) if (c.mk[i]) ids[i] = k + 1; });
    const cnt = new Array(sel.length + 2).fill(0); for (let i=0;i<total;i++) cnt[ids[i]]++;
    const segs = [{ id: 0, ko: '바탕·배경', desc: '분리되지 않은 나머지 영역' }];
    let n = 0;
    for (let id = 1; id <= Math.min(24, sel.length); id++) {
      if (cnt[id] < total*0.012) { for (let i=0;i<total;i++) if (ids[i] === id) ids[i] = 0; continue; }
      segs.push({ id, ko: '피사체 ' + (++n), desc: '' });
    }
    a.seg = { w: gw, h: gh, ids, segs, context: '' };
    a.gray.segIds = resizeIdsNearest(ids, gw, gh, g.w, g.h); a.cache = null;
    await rebuild(true, false);
    renderSegPanel();
    setStatus(S.mode === 'form' ? '모인 상태' : '흩어진 상태');
  } catch (e) { statusEl.textContent = '구성요소 분석 실패 (인터넷 필요): ' + e.message; }
  bAn.disabled = false;
}
document.getElementById('bAnalyze').addEventListener('click', () => { if (TOUCH && !confirm('구성요소 분석(SAM)은 휴대폰에서 1~3분 걸리고 메모리를 많이 써요. PC에서 쓰는 걸 권장해요. 계속할까요?')) return; if (S.cur >= 0) runSegmentation(S.cur, 8); });

