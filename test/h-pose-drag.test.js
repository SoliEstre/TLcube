/** 실제 Y 투영과 물리 표면으로 H 정위치·프리셋·포인터 방향을 검증해요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {projectPoint,orbitPoint} from '../src/y3d-viewer.js';
import {createGeneratorState} from '../src/generator-state.js';
import {SHOT_PRESETS,applyShotPresetToState} from '../src/generator-shot-presets.js';
import {defineOrbitViewAccessors} from '../src/generator-orbit-view.js';
import {hProjection} from '../src/h-render.js';
import {hPreviewOptions,hPointerDragPose,hPointerDragDelta,hOrbitFromRotation} from '../src/generator-h.js';
import {hOrbitRotation,hDragRotation,hScreenSpin} from '../src/h-rotation.js';

const C=[-1,-1,-1].map(v=>v/Math.sqrt(3)),n=41;
const layout={size:Math.sqrt(2/3),originX:0,originY:0},center={x:n/2,y:n/2,z:n/2};
const mul=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((s,v,k)=>s+v*b[k][j],0)));
const apply=(R,p)=>R.map(row=>row.reduce((s,v,i)=>s+v*p[i],0));
const transpose=R=>R[0].map((_,i)=>R.map(r=>r[i]));
function matrix(e){const x=e.rotateX,y=e.rotateY,z=e.rotateZ,c=Math.cos,s=Math.sin;return mul([[c(z),-s(z),0],[s(z),c(z),0],[0,0,1]],mul([[c(y),0,s(y)],[0,1,0],[-s(y),0,c(y)]],[[1,0,0],[0,c(x),-s(x)],[0,s(x),c(x)]]));}
const vertices=[0,n].flatMap(x=>[0,n].flatMap(y=>[0,n].map(z=>[x,y,z])));
const relative=(view,p)=>{const q=view.project(p);return{x:q.x-view.width/2,y:q.y-view.height/2};};
const defaults=()=>createGeneratorState({type:'Y',yRepresentation:'3d',orbitView:'3d'});
function parity(state){
  const opts=hPreviewOptions(state),view=hProjection(n,opts),yaw=state.orbitYaw*Math.PI/180,pitch=state.orbitPitch*Math.PI/180,roll=state.orbitRoll*Math.PI/180;
  for(const [x,y,z]of vertices){
    const p=orbitPoint({x,y,z},yaw,pitch,center,roll);
    const expected=projectPoint(p,layout,center,Math.sin(state.orbitPersp/100*Math.PI/3)/(n*Math.sqrt(3)/2));
    const actual=relative(view,[x,y,z]);assert.ok(Math.hypot(actual.x-expected.x,actual.y-expected.y)<1e-10,JSON.stringify({state,actual,expected}));
  }
}
function nearSurface(pose){const local=apply(transpose(matrix(pose)),C),distance=n/2/Math.max(...local.map(Math.abs));return local.map(v=>n/2+v*distance);}
function samePose(a,b){for(const v of [[1,0,0],[0,1,0],[0,0,1]])assert.ok(Math.hypot(...apply(matrix(a),v).map((q,i)=>q-apply(matrix(b),v)[i]))<1e-9);}

test('H 정위치는 기존 Y의 T/L/R 대응 꼭짓점과 같고 ZM 면이 위예요',()=>{
  for(const hFaces of [3,6])for(const orbitPersp of [0,15,50,100]){
    const state={...defaults(),hFaces,orbitPersp};parity(state);
    const view=hProjection(n,hPreviewOptions(state));assert.deepEqual(view.visible,['ZM','XM','YM']);
    assert.ok(relative(view,[n/2,n/2,0]).y<0);assert.ok(relative(view,[0,n/2,n/2]).x<0);assert.ok(relative(view,[n/2,0,n/2]).x>0);
  }
});
test('실제 16개 H 프리셋은 yaw/pitch/roll을 기존 Y와 같은 화면축으로 해석해요',()=>{
  assert.equal(SHOT_PRESETS.length,16);
  for(const preset of SHOT_PRESETS)parity(applyShotPresetToState(preset.id,defaults()));
});
test('임의 자세·원근의 가장 가까운 실제 표면이 마우스 여섯 방향을 따라가요',()=>{
  for(const yaw of [0,45,90,-128,179])for(const pitch of [0,60,-90])for(const roll of [0,93,-147])for(const perspective of [0,18,50,100]){
    const state={...defaults(),orbitYaw:yaw,orbitPitch:pitch,orbitRoll:roll,orbitPersp:perspective};
    const opts=hPreviewOptions(state),p=nearSurface(opts),start=hProjection(n,opts).project(p);
    for(const [dx,dy]of [[.01,0],[-.01,0],[0,.01],[0,-.01],[.007,.007],[-.007,.007]]){
      const next=hPointerDragPose({yaw:yaw*Math.PI/180,pitch:pitch*Math.PI/180,roll:roll*Math.PI/180},{dx,dy});
      const nextState={...state,orbitYaw:next.yaw*180/Math.PI,orbitPitch:next.pitch*180/Math.PI,orbitRoll:next.roll*180/Math.PI};
      const end=hProjection(n,hPreviewOptions(nextState)).project(p),mx=end.x-start.x,my=end.y-start.y;
      assert.ok(mx*dx+my*dy>0,JSON.stringify({yaw,pitch,roll,perspective,dx,dy,mx,my}));
      assert.ok(Math.abs(mx*dy-my*dx)<1e-9);
    }
  }
});
test('H roll은 임의 자세의 화면에서 포인터 각만큼 회전하고 반경을 보존해요',()=>{
  for(const perspective of [0,.18,.5,1])for(const pose of [{yaw:0,pitch:0,roll:0},{yaw:1.2,pitch:-.7,roll:2.1}]){
    const base=hOrbitRotation(pose),view=hProjection(n,{...base,perspective}),point=[0,n*.35,n*.15],start=relative(view,point),angle=.17;
    const next=hPointerDragPose(pose,{rollDelta:angle}),end=relative(hProjection(n,{...hOrbitRotation(next),perspective}),point);
    assert.ok(Math.abs(end.x-(start.x*Math.cos(angle)-start.y*Math.sin(angle)))<1e-10);
    assert.ok(Math.abs(end.y-(start.x*Math.sin(angle)+start.y*Math.cos(angle)))<1e-10);
  }
});
test('실제 드래그 callback은 자동 자세를 동결하고 3/6면·원근을 보존해요',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const section=(a,b)=>{const start=html.indexOf(a),end=html.indexOf(b,start);assert.ok(start>=0&&end>start);return html.slice(start,end);};
  for(const mode of [3,6])for(const running of [false,true])for(const dragMode of ['orbit','roll']){
    const state={...defaults(),hFaces:mode,hAutoRotate:running&&mode===6,hRotationMode:'y',hRotationSpeed:15,orbitYaw:33,orbitPitch:-47,orbitRoll:82,orbitPersp:33};
    const viewer={mode:'field',dragging:false};defineOrbitViewAccessors(viewer,state);const handlers={},animation={elapsed:7213};
    const el={addEventListener:(key,fn)=>handlers[key]=fn,setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};
    const ctx=vm.createContext({y3dPreview:viewer,generatorState:state,hAnimation:animation,els:{view3d:el},hGeneratorActive:()=>true,hPreviewOptions,hOrbitFromRotation,hPointerDragPose,hPointerDragDelta,stopHAnimation(){},syncHUi(){},paintY3dPreview(){}});
    vm.runInContext(section('function freezeHSpin(){','function syncHUi(){'),ctx);
    vm.runInContext(section('function y3dPointerAngle(ev) {',"els.view3d.addEventListener('pointerup'"),ctx);
    const start=hPreviewOptions(state,{elapsedMs:animation.elapsed}),p=nearSurface(start),point=hProjection(n,start).project(p);
    const event=(x,y)=>({clientX:x,clientY:y,pointerId:1,shiftKey:dragMode==='roll',stopPropagation(){}});
    handlers.pointerdown(event(75,50));samePose(start,hPreviewOptions(state,{elapsedMs:animation.elapsed}));
    if(dragMode==='orbit'){handlers.pointermove(event(75.1,50.1));const end=hProjection(n,hPreviewOptions(state)).project(p);assert.ok(end.x>point.x&&end.y>point.y);}
    else{const base=hPreviewOptions(state),point=[0,n*.35,n*.15],v=hProjection(n,base),a=relative(v,point);handlers.pointermove(event(75,51));handlers.pointermove(event(75,52));const b=relative(hProjection(n,hPreviewOptions(state)),point),angle=Math.atan2(2,25);assert.ok(Math.abs(b.x-(a.x*Math.cos(angle)-a.y*Math.sin(angle)))<1e-9);assert.ok(Math.abs(b.y-(a.x*Math.sin(angle)+a.y*Math.cos(angle)))<1e-9);}
    assert.equal(state.orbitPersp,33);assert.equal(state.hFaces,mode);assert.equal(state.hAutoRotate,false);
  }
});
test('정위치 X/Y 자동회전은 여섯 면과 한 주기 복귀를 유지해요',()=>{
  for(const axis of ['x','y'])for(const perspective of [0,.5,1]){const seen=new Set();for(let k=0;k<=120;k++){const view=hProjection(n,{...hScreenSpin(k*200,{axis,speed:15}),perspective});view.visible.forEach(f=>seen.add(f));}assert.equal(seen.size,6);samePose(hScreenSpin(0,{axis}),hScreenSpin(24000,{axis}));}
  samePose(hScreenSpin(0,{axis:'gyro'}),hScreenSpin(48000,{axis:'gyro'}));
});
test('화면 궤도↔물리 회전 왕복은 짐벌 자세를 보존하고 비유한 drag는 거부해요',()=>{
  for(const yaw of [Math.PI/2,-Math.PI/2,Math.PI/2-1e-7]){const p=hOrbitRotation({yaw,pitch:.4,roll:-.7});samePose(hOrbitRotation(hOrbitFromRotation(p)),p);}
  assert.throws(()=>hDragRotation({rotateX:0,rotateY:0,rotateZ:0},{dx:Infinity}),RangeError);
});
