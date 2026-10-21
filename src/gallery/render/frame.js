// =====================================================================
//  프레임 루프: 움직임이 없으면 그리지 않는다 (절전)
// =====================================================================
let drawnFrames = 0, fpsStamp = performance.now();
// 제한 모드에만 적용합니다. 자유 회전은 각도를 정규화할 뿐 상한을 두지 않습니다.
const LIM = () => ({ yaw: 0.95, pitch: 0.6 });
function softK(a, lim) { const t = Math.abs(a) / lim; return t < 0.6 ? 1 : Math.max(0.12, 1 - (t - 0.6) / 0.5); }
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); rafTicks++;
  if (now - fpsStamp > 700) {
    const fpsNow = drawnFrames * 1000 / (now - fpsStamp);
    fpsEl.textContent = drawnFrames === 0 ? '대기 · 렌더 중단(절전)' : Math.round(fpsNow) + ' fps';
    adaptQuality(fpsNow, drawnFrames, rafTicks, now);
    drawnFrames = 0; rafTicks = 0; fpsStamp = now;
  }
  if (!gl || !S.n || gl.isContextLost()) return;

  // 카메라 (한계 근처에서는 저항, 놓으면 부드럽게 되돌아옴)
  const L = LIM();
  let camMoving = false;
  if (S.dragging) camMoving = true;
  else if (S.interacted) {
    if (S.limit) {
      const ey = Math.abs(S.yaw) - L.yaw*0.9, ep = Math.abs(S.pitch) - L.pitch*0.9;
      if (ey > 0) S.vyaw -= Math.sign(S.yaw) * ey * 0.06;
      if (ep > 0) S.vpitch -= Math.sign(S.pitch) * ep * 0.06;
    }
    if (Math.abs(S.vyaw) > 1e-4 || Math.abs(S.vpitch) > 1e-4) {
      rotateCamera(S.yaw + S.vyaw, S.pitch + S.vpitch, 1.1);
      S.vyaw *= 0.92; S.vpitch *= 0.92; camMoving = true;
    }
  } else {
    const t = now / 1000;
    const yawT = S.sway ? Math.sin(t*0.45)*0.34 : 0, pitchT = S.sway ? Math.sin(t*0.31+1)*0.1 : 0;
    if (S.sway || Math.abs(S.yaw - yawT) > 1e-3 || Math.abs(S.pitch - pitchT) > 1e-3) {
      S.yaw += (yawT - S.yaw)*0.05; S.pitch += (pitchT - S.pitch)*0.05; camMoving = true;
    }
  }
  if (Math.abs(S.zoomT - S.zoom) > 5e-4) { S.zoom += (S.zoomT - S.zoom)*0.12; camMoving = true; } else S.zoom = S.zoomT;

  // 마우스 반응 세기
  const mt = (S.mouse.on && !S.dragging) ? 1 : 0;
  let mouseAnim = false;
  if (Math.abs(mt - S.mouse.pow) > 0.01) { S.mouse.pow += (mt - S.mouse.pow)*0.15; mouseAnim = true; }
  else if (S.mouse.pow !== mt) { S.mouse.pow = mt; mouseAnim = true; }

  let panAnim = false;
  for (const k of ['x','y','z']) { const dd = S.panT[k] - S.pan[k]; if (Math.abs(dd) > 0.05) { S.pan[k] += dd*0.12; panAnim = true; } else S.pan[k] = S.panT[k]; }
  const st = S.sel >= 0 ? 1 : 0; let selAnim = false;
  if (Math.abs(st - S.selPow) > 0.01) { S.selPow += (st - S.selPow)*0.18; selAnim = true; } else if (S.selPow !== st) { S.selPow = st; selAnim = true; }

  if (S.statusPending && now >= S.endTime) { S.statusPending = false; setStatus(S.mode === 'form' ? '모인 상태' : '흩어진 상태'); }
  const animating = now < S.endTime + 80 || S.mode === 'scatter';
  if (!(camMoving || animating || mouseAnim || selAnim || panAnim || S.dirty)) return;
  S.dirty = false; drawnFrames++;

  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(GLP);
  const bind = (k, loc, size) => { gl.bindBuffer(gl.ARRAY_BUFFER, GLB[k]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
  bind('from', 0, 3); bind('to', 1, 3); bind('anim', 2, 4); bind('misc', 3, 4); bind('col', 4, 3);
  gl.uniform1f(GLU.u_time, now / 1000);
  gl.uniform1f(GLU.u_form, S.mode === 'form' ? 1 : 0);
  gl.uniform1f(GLU.u_size, S.params.size);
  gl.uniform1f(GLU.u_glow, S.params.glow);
  gl.uniform1f(GLU.u_dof, S.params.dof);
  gl.uniform1f(GLU.u_zoom, S.zoom);
  gl.uniform1f(GLU.u_dpr, DPR);
  gl.uniform1f(GLU.u_mpow, S.mouse.pow);
  gl.uniform1f(GLU.u_sel, S.sel >= 0 ? S.sel : -1);
  gl.uniform1f(GLU.u_selpow, S.selPow);
  gl.uniform1f(GLU.u_line, S.params.lineDots);
  gl.uniform1f(GLU.u_color, S.params.color);
  gl.uniform1f(GLU.u_sat, S.params.sat);
  gl.uniform1f(GLU.u_split, S.params.split*3.0);
  gl.uniform1f(GLU.u_chan, 0);
  gl.uniform1f(GLU.u_lineview, S.lineView ? 1 : 0);
  gl.uniform3f(GLU.u_pan, S.pan.x, S.pan.y, S.pan.z);
  gl.uniform2f(GLU.u_mouse, S.mouse.x, S.mouse.y);
  gl.uniform2f(GLU.u_half, W/2, H/2);
  gl.uniform4f(GLU.u_cam, Math.cos(S.yaw), Math.sin(S.yaw), Math.cos(S.pitch), Math.sin(S.pitch));
  if (S.params.glow > 0.01) {
    gl.blendFunc(gl.ONE, gl.ONE); gl.uniform1f(GLU.u_pass, 1); gl.drawArrays(gl.POINTS, 0, S.n);
  }
  gl.uniform1f(GLU.u_pass, 0);
  if (S.params.split > 0.01) {                       // RGB 분리: R, G, B를 따로 그려 더한다
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let ch = 1; ch <= 3; ch++) { gl.uniform1f(GLU.u_chan, ch); gl.drawArrays(gl.POINTS, 0, S.n); }
    gl.uniform1f(GLU.u_chan, 0);
  } else {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, S.n);
  }
}

