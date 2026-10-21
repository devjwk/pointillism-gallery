import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
const cameraSource = await fs.readFile(new URL('src/gallery/interaction/camera.js', root), 'utf8');
const frameSource = await fs.readFile(new URL('src/gallery/render/frame.js', root), 'utf8');
const close = (a,b) => assert(Math.abs(a-b)<1e-9, `${a} != ${b}`);
function harness(touch=false) {
  const stageEvents={},docEvents={},elements=new Map();
  const makeElement=()=>({textContent:'',title:'',classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(k,v){this[k]=v;},addEventListener(){}});
  const stage={...makeElement(),setPointerCapture(){},getBoundingClientRect(){return {left:0,top:0};},addEventListener(k,fn){stageEvents[k]=fn;}};
  const S={limit:false,yaw:0,pitch:0,vyaw:0,vpitch:0,interacted:true,dragging:false,mouse:{},zoom:1,zoomT:1,panT:{},sway:false,dirty:false};
  const document={getElementById(id){if(!elements.has(id))elements.set(id,makeElement());return elements.get(id);},addEventListener(k,fn){docEvents[k]=fn;}};
  const context=vm.createContext({S,stage,document,TOUCH:touch,PROFILE:{sens:0.005},W:1000,H:800,rootEl:makeElement(),side:{dataset:{}},cv:makeElement(),performance:{now:()=>1000},setTimeout:()=>0,clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),onStageClick(){}});
  vm.runInContext(frameSource.slice(0,frameSource.indexOf('function frame()')),context);
  vm.runInContext(cameraSource,context);
  const cameraBlock=frameSource.slice(frameSource.indexOf('  // 카메라'),frameSource.indexOf('  // 마우스'));
  vm.runInContext('function cameraTick(){ const now=performance.now(); '+cameraBlock+' }',context);
  return {context,S,stageEvents,docEvents,elements};
}
const keyEvent=key=>({key,target:{closest(){return null;}},preventDefault(){}});

test('free rotation normalizes many full turns without changing their orientation',()=>{
  const h=harness();
  for(const a of [-1000*Math.PI,-7.2,-Math.PI,0,Math.PI,9.1,1000*Math.PI]){
    const out=h.context.constrainRotationAngle(a);
    assert(out>=-Math.PI&&out<=Math.PI);
    close(Math.sin(out),Math.sin(a));close(Math.cos(out),Math.cos(a));
  }
});
test('mouse and touch dragging pass both old limits and the full-turn boundary',()=>{
  for(const touch of [false,true]){
    const h=harness(touch),kind=touch?'touch':'mouse';
    h.stageEvents.pointerdown({pointerType:kind,button:0,pointerId:1,clientX:0,clientY:0});
    for(let i=1;i<=20;i++)h.stageEvents.pointermove({pointerType:kind,pointerId:1,clientX:i*100,clientY:i*100});
    close(h.S.yaw,Math.atan2(Math.sin(-10),Math.cos(-10)));
    close(h.S.pitch,Math.atan2(Math.sin(10),Math.cos(10)));
  }
});
test('keyboard rotation continues through 360 degrees on both axes',()=>{
  const h=harness();
  for(let i=0;i<80;i++){h.docEvents.keydown(keyEvent('ArrowRight'));h.docEvents.keydown(keyEvent('ArrowDown'));}
  close(h.S.yaw,Math.atan2(Math.sin(7.2),Math.cos(7.2)));
  close(h.S.pitch,Math.atan2(Math.sin(7.2),Math.cos(7.2)));
});
test('free inertia crosses the seam smoothly instead of clamping or bouncing',()=>{
  const h=harness();h.S.yaw=Math.PI-0.01;h.S.pitch=-Math.PI+0.01;h.S.vyaw=0.04;h.S.vpitch=-0.04;
  h.context.cameraTick();
  close(h.S.yaw,-Math.PI+0.03);close(h.S.pitch,Math.PI-0.03);
  close(h.S.vyaw,0.04*0.92);close(h.S.vpitch,-0.04*0.92);
});
test('optional limited mode preserves old bounds and clears inertia on toggle',()=>{
  const h=harness();h.S.yaw=2.7;h.S.pitch=-2.4;h.S.vyaw=0.04;h.S.vpitch=-0.03;
  h.context.setRotationMode(true);
  close(h.S.yaw,0.95);close(h.S.pitch,-0.6);close(h.S.vyaw,0);close(h.S.vpitch,0);
  assert.equal(h.elements.get('bLimit')['aria-pressed'],'true');
  h.context.rotateCamera(10,-10,1.1);close(h.S.yaw,0.95*1.1);close(h.S.pitch,-0.6*1.1);
  h.docEvents.keydown(keyEvent('ArrowRight'));close(h.S.yaw,0.95);
  h.context.setRotationMode(false);h.context.rotateCamera(2.7,-2.4);
  close(h.S.yaw,2.7);close(h.S.pitch,-2.4);
  assert.equal(h.elements.get('bLimit').textContent,'회전: 360° 자유');
});
test('initial state and button both default to free rotation',async()=>{
  const state=await fs.readFile(new URL('src/gallery/core/state.js',root),'utf8');
  const html=await fs.readFile(new URL('index.html',root),'utf8');
  assert.match(state,/limit: false/);
  assert.match(html,/id="bLimit" aria-pressed="false"[^>]*>회전: 360° 자유/);
});
