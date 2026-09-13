import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGeneratorState,GENERATOR_STATE_SCHEMA} from '../src/generator-state.js';
import {clampHRotationTiltMode,selectHRotationTiltMode,normalizeHViewControls,hPreviewOptions,H_ROTATION_TILT_MODE_DEFAULT} from '../src/generator-h.js';
import {hScreenSpin,hRotationPeriodMs,H_ROTATION_TILT_MODES} from '../src/h-rotation.js';
import {cubeVideoDurationMs} from '../src/cube-video-export.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const RIGHT=[1/Math.sqrt(2),-1/Math.sqrt(2),0],DOWN=[-1/Math.sqrt(6),-1/Math.sqrt(6),2/Math.sqrt(6)];
const TAU=Math.PI*2;
const mul=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((s,v,k)=>s+v*b[k][j],0)));
const about=(u,a)=>{const c=Math.cos(a),s=Math.sin(a),k=1-c,[x,y,z]=u;return [[c+x*x*k,x*y*k-z*s,x*z*k+y*s],[y*x*k+z*s,c+y*y*k,y*z*k-x*s],[z*x*k-y*s,z*y*k+x*s,c+z*z*k]];};
const fromEuler=e=>{const x=e.rotateX,y=e.rotateY,z=e.rotateZ,cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  return mul([[cz,-sz,0],[sz,cz,0],[0,0,1]],mul([[cy,0,sy],[0,1,0],[-sy,0,cy]],[[1,0,0],[0,cx,-sx],[0,sx,cx]]));};
const closeM=(a,b,eps=1e-9)=>{for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(a[i][j]-b[i][j])<eps,`${i},${j} ${a[i][j]} / ${b[i][j]}`);};
const closeE=(a,b)=>{for(const key of ['rotateX','rotateY','rotateZ'])assert.ok(Math.abs(a[key]-b[key])<1e-9,`${key} ${a[key]} / ${b[key]}`);};
const relAngle=(A,B)=>{let t=0;for(let i=0;i<3;i++)for(let j=0;j<3;j++)t+=A[i][j]*B[i][j];return Math.acos(Math.min(1,Math.max(-1,(t-1)/2)));};
const VERTS=[-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>[x,y,z])));
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const project=R=>VERTS.map(v=>{const q=[0,1,2].map(i=>R[i][0]*v[0]+R[i][1]*v[1]+R[i][2]*v[2]);return [dot(q,RIGHT),dot(q,DOWN)];});
/** 한 주기를 N 등분해 이웃 자세 사이의 3D 각·화면 이동량(꼭짓점 평균)을 재요. */
function profile(opts,N=720){
  const period=hRotationPeriodMs(opts);const ang=[],proj=[];let prev=null,prevP=null;
  for(let i=0;i<=N;i++){const R=fromEuler(hScreenSpin(period*i/N,opts));const P=project(R);
    if(prev){ang.push(relAngle(R,prev));proj.push(P.reduce((s,p,k)=>s+Math.hypot(p[0]-prevP[k][0],p[1]-prevP[k][1]),0)/P.length);}
    prev=R;prevP=P;}
  const ratio=v=>Math.max(...v)/Math.min(...v),mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
  return {angRatio:ratio(ang),projRatio:ratio(proj),projMean:mean(proj)};
}
/** X/Y 기울임을 자세에서 되읽어요: R = about(부축, dir·tilt)·about(주축, dir·a) 라 주축 회전을 벗기면 부축 회전만 남아요. */
function tiltOf(euler,axis,a,dir=1){
  const main=axis==='x'?RIGHT:DOWN,other=axis==='x'?DOWN:RIGHT;
  const S=mul(fromEuler(euler),about(main,-dir*a));
  // about(other, θ) 에서 θ 는 other 에 수직인 벡터의 회전각 — RIGHT/DOWN 은 서로 수직이라 main 벡터를 돌려 각을 읽어요.
  const v=[0,1,2].map(i=>S[i][0]*main[0]+S[i][1]*main[1]+S[i][2]*main[2]);
  const cross=[other[1]*main[2]-other[2]*main[1],other[2]*main[0]-other[0]*main[2],other[0]*main[1]-other[1]*main[0]];
  return Math.atan2(dot(v,cross),dot(v,main))*dir;
}
const state=overrides=>createGeneratorState({type:'Y',yRepresentation:'3d',orbitView:'3d',hAutoRotate:true,...overrides});

test('보정 방식 상수·기본값·정규화 — 저수준 API 기본은 옛 «면마다», 생성기 기본은 «회전마다»',()=>{
  assert.deepEqual([...H_ROTATION_TILT_MODES],['none','turn','face']);
  assert.equal(H_ROTATION_TILT_MODE_DEFAULT,'turn');
  assert.equal(GENERATOR_STATE_SCHEMA.hRotationTiltMode.defaultValue,'turn');
  assert.equal(state().hRotationTiltMode,'turn');
  for(const bad of [undefined,null,'',0,'wobble','TURN'])assert.equal(clampHRotationTiltMode(bad),'turn');
  for(const mode of H_ROTATION_TILT_MODES)assert.equal(clampHRotationTiltMode(mode),mode);
  assert.equal(normalizeHViewControls({hRotationTiltMode:'bad'}).hRotationTiltMode,'turn');
  const next=selectHRotationTiltMode(state({hRotationSpeed:39,hRotationSpeedIntent:'manual'}),'face');
  assert.equal(next.hRotationTiltMode,'face');assert.equal(next.hRotationSpeed,39);assert.equal(next.hRotationSpeedIntent,'manual');
  for(const axis of ['x','y'])for(const t of [0,379,2499]){
    const opts={axis,speed:60,tiltDeg:17.5};
    closeE(hScreenSpin(t,opts),hScreenSpin(t,{...opts,tiltMode:'face'}));
    closeE(hScreenSpin(t,{...opts,tiltMode:'none'}),hScreenSpin(t,{...opts,wobble:false}));
  }
  assert.throws(()=>hScreenSpin(0,{tiltMode:'spiral'}),RangeError);
  assert.throws(()=>hRotationPeriodMs({axis:'y',speed:60,tiltMode:'spiral'}),RangeError);
  assert.throws(()=>hScreenSpin(0,{axis:'gyro',uniformSpeed:'yes'}),TypeError);
});

test('회전마다: 두 바퀴가 한 주기이고, 첫 바퀴는 + 둘째 바퀴는 − 로 기울며 바퀴 경계에서 기울임이 0 이에요',()=>{
  for(const axis of ['x','y'])for(const dir of [-1,1]){
    const opts={axis,speed:60,tiltDeg:17.5,tiltMode:'turn',directionX:dir,directionY:dir};
    const period=hRotationPeriodMs(opts);
    assert.equal(period,720000/60);
    assert.equal(hRotationPeriodMs({axis,speed:60,tiltMode:'face'}),360000/60);
    assert.equal(hRotationPeriodMs({axis:'gyro',speed:60,tiltMode:'turn'}),360000/60,'gyro 는 보정 방식과 무관해요');
    closeM(fromEuler(hScreenSpin(0,opts)),fromEuler(hScreenSpin(period,opts)));
    closeM(fromEuler(hScreenSpin(379,opts)),fromEuler(hScreenSpin(379+period,opts)));
    const amp=17.5*Math.PI/180,samples=[];
    for(let i=0;i<=200;i++){const a=(i/200)*2*TAU;samples.push({a,tilt:tiltOf(hScreenSpin(period*i/200,opts),axis,a,dir)});}
    const first=samples.filter(s=>s.a<TAU),second=samples.filter(s=>s.a>=TAU);
    assert.ok(first.every(s=>s.tilt>-1e-9),'첫 바퀴는 음수 기울임이 없어요');
    assert.ok(second.every(s=>s.tilt<1e-9),'둘째 바퀴는 양수 기울임이 없어요');
    for(const k of [0,100,200])assert.ok(Math.abs(samples[k].tilt)<1e-9,'바퀴 경계 기울임 0');
    assert.ok(Math.abs(samples[50].tilt-amp)<1e-9&&Math.abs(samples[150].tilt+amp)<1e-9,'바퀴 중간은 최대 기울임');
    // 가운데 50% 는 최대 유지: 한 바퀴 안에서 |tilt| ≥ 0.999·amp 인 비율 ≥ 0.49 (옛 S자는 0.1 미만)
    const plateau=first.filter(s=>Math.abs(s.tilt)>=.999*amp).length/first.length;
    assert.ok(plateau>=.49,`plateau ${plateau}`);
    const faceOpts={...opts,tiltMode:'face'},facePeriod=hRotationPeriodMs(faceOpts);
    const faceSamples=[];for(let i=0;i<=100;i++){const a=(i/100)*TAU;faceSamples.push(Math.abs(tiltOf(hScreenSpin(facePeriod*i/100,faceOpts),axis,a,dir)));}
    assert.ok(faceSamples.filter(v=>v>=.999*amp).length/faceSamples.length<.1);
  }
});

test('회전마다 보정은 면마다보다 회전 속도 요동이 작아요(3D 각·화면 이동량)',()=>{
  for(const axis of ['x','y']){
    const turn=profile({axis,speed:60,tiltDeg:17.5,tiltMode:'turn'}),face=profile({axis,speed:60,tiltDeg:17.5,tiltMode:'face'});
    assert.ok(turn.angRatio<face.angRatio&&turn.angRatio<1.1,`${axis} ang ${turn.angRatio} vs ${face.angRatio}`);
    assert.ok(turn.projRatio<face.projRatio,`${axis} proj ${turn.projRatio} vs ${face.projRatio}`);
  }
});

test('gyro uniformSpeed: 주기·평균 이동량은 그대로이고 화면 이동량이 균일해져요',()=>{
  for(const directionX of [-1,1])for(const directionY of [-1,1])for(const wobble of [true,false]){
    const base={axis:'gyro',speed:45,directionX,directionY,wobble};
    const plain=profile(base),uniform=profile({...base,uniformSpeed:true});
    assert.equal(hRotationPeriodMs({...base,uniformSpeed:true}),hRotationPeriodMs(base));
    assert.ok(uniform.projRatio<1.01,`proj ratio ${uniform.projRatio}`);
    assert.ok(Math.abs(uniform.projMean-plain.projMean)<1e-6,'평균 화면 이동량 보존');
    if(wobble)assert.ok(plain.projRatio>1.8,`옛 경로는 요동해요 ${plain.projRatio}`);
    const period=hRotationPeriodMs(base),opts={...base,uniformSpeed:true};
    closeM(fromEuler(hScreenSpin(0,opts)),fromEuler(hScreenSpin(period,opts)));
    closeE(hScreenSpin(0,opts),hScreenSpin(0,base));
  }
});

test('생성기는 상태의 보정 방식을 넘기고 gyro 를 균일 속도로 돌리며, 영상 길이는 회전마다에서 두 바퀴예요',()=>{
  for(const axis of ['x','y'])for(const tiltMode of H_ROTATION_TILT_MODES){
    const s=state({hRotationMode:axis,hRotationSpeed:60,hRotationTiltMode:tiltMode});
    closeE(hPreviewOptions(s,{elapsedMs:379}),hScreenSpin(379,{axis,speed:60,tiltDeg:17.5,tiltMode}));
    assert.equal(cubeVideoDurationMs({axis,speed:60,tiltMode}),tiltMode==='turn'?12000:6000);
  }
  const g=state({hRotationMode:'gyro',hRotationSpeed:45});
  closeE(hPreviewOptions(g,{elapsedMs:379}),hScreenSpin(379,{axis:'gyro',speed:45,tiltDeg:17.5,uniformSpeed:true}));
  assert.equal(cubeVideoDurationMs({axis:'gyro',speed:45,tiltMode:'turn'}),8000);
  // 정렬 4면 배치의 cap 숨김(wobble:false)은 보정 방식과 무관하게 유지돼요.
  for(const tiltMode of H_ROTATION_TILT_MODES){
    const h=state({hArrangement:'horizontal',hRotationMode:'y',hFaces:4,hRotationTiltMode:tiltMode});
    closeE(hPreviewOptions(h,{elapsedMs:379}),hPreviewOptions({...h,hRotationTiltDeg:35},{elapsedMs:379}));
  }
});

test('UI: 세 버튼 토글은 기울임 행 앞에 있고 회전마다가 기본이며 저장 키·영상 길이가 배선돼요',()=>{
  assert.match(html,/id="hRotationTiltModeCards"[^>]*role="group"/);
  assert.match(html,/id="hRotationTiltModeRow"[\s\S]*id="hRotationTiltRow"/);
  for(const mode of ['none','turn','face'])assert.match(html,new RegExp(`data-h-tilt-mode="${mode}"[^>]*data-h-label="tilt(None|Turn|Face)"`));
  assert.match(html,/data-h-tilt-mode="turn"[^>]*aria-pressed="true"/);
  assert.match(html,/data-state-keys="[^"]*\bhRotationTiltMode\b[^"]*"/);
  assert.match(html,/selectHRotationTiltMode\(generatorState,button\.dataset\.hTiltMode\)/);
  assert.match(html,/\$\('hRotationTiltModeRow'\)\.hidden=axis==='gyro'/);
  assert.match(html,/\$\('hRotationTilt'\)\.disabled=!tiltReady\|\|tiltMode==='none'/);
  assert.equal((html.match(/cubeVideoDurationMs\(\{[^}]*tiltMode:clampHRotationTiltMode\(/g)||[]).length,2,'영상 길이 두 호출 모두 보정 방식을 넘겨요');
});
