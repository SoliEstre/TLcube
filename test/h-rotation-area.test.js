import test from 'node:test';
import assert from 'node:assert/strict';
import {hScreenSpin,hRotationPeriodMs,hAlignmentRotation,composeHRotation} from '../src/h-rotation.js';
import {hProjection} from '../src/h-render.js';
import {hFacePoint} from '../src/h-layout.js';
import {hPreviewOptions} from '../src/generator-h.js';
import {createGeneratorState} from '../src/generator-state.js';
import {cubeVideoDurationMs} from '../src/cube-video-export.js';

const faces=['ZM','XM','YM','ZP','XP','YP'];
const quadArea=p=>Math.abs(p.reduce((a,v,i)=>{const q=p[(i+1)%4];return a+v.x*q.y-v.y*q.x;},0))/2;
const n=45,samples=480;
function peaks(axis,directionX,directionY,perspective,wobble=true,base=null){
  const result=Object.fromEntries(faces.map(face=>[face,0]));
  const front=n*n/(1-Math.sin(perspective*Math.PI/3)/Math.sqrt(3))**2;
  for(let i=0;i<samples;i++){
    let pose=hScreenSpin(hRotationPeriodMs({axis,speed:50})*i/samples,{axis,speed:50,directionX,directionY,wobble});
    if(base)pose=composeHRotation(base,pose);
    const view=hProjection(n,{...pose,perspective});
    for(const face of view.visible){
      const area=quadArea([[0,0],[0,n],[n,n],[n,0]].map(([u,v])=>view.project(hFacePoint(face,u,v,n))));
      result[face]=Math.max(result[face],area/front);
    }
  }
  return result;
}

test('최대 기울임에서 기본 구도 모든 면의 한 주기 최대 투영 면적을 축·방향별로 확보해요',t=>{
  for(const perspective of [0,4/60])for(const axis of ['x','y','gyro']){
    const directions=axis==='gyro'?[[-1,-1],[-1,1],[1,-1],[1,1]]:axis==='x'?[[-1,1],[1,1]]:[[1,-1],[1,1]];
    const floor={x:.75,y:.86,gyro:.95}[axis];
    let worst=1;
    for(const [dx,dy] of directions){
      const current=peaks(axis,dx,dy,perspective),old=peaks(axis,dx,dy,perspective,false);
      for(const [face,value] of Object.entries(current))assert.ok(value>floor,`${axis}/${dx}/${dy}/${face}/${perspective}: ${value}`);
      assert.ok(Math.min(...Object.values(current))>Math.min(...Object.values(old))+.08,`${axis}: min peak improvement`);
      worst=Math.min(worst,...Object.values(current));
    }
    t.diagnostic(`${axis} perspective=${perspective}: minimum six-face peak/front=${worst.toFixed(6)}`);
  }
});

test('표시 면적 기준은 임의 수동 자세나 화면 크롭까지 보장한다고 오해하지 않아요',()=>{
  // 화면 X축에 Z cap을 정확히 맞추면 ±35° 작은 tilt만으로는 .75에 닿지 않아요.
  const base=hAlignmentRotation('vertical');
  const values=peaks('x',1,1,4/60,true,base);
  assert.ok(Object.values(values).every(v=>Number.isFinite(v)&&v>=0&&v<=1.01));
  assert.ok(Math.min(...Object.values(values))<.75,'임의 자세까지의 잘못된 보장 방지');
});

test('실제 미리보기와 영상은 모든 속도·모드에서 같은 닫힌 경로를 사용해요',()=>{
  for(const version of [6,7,8])for(const axis of ['x','y','gyro']){
    const state=createGeneratorState({type:'Y',yRepresentation:'3d',versionH:version,orbitView:'3d',hAutoRotate:true,hRotationMode:axis});
    const period=cubeVideoDurationMs({axis,speed:state.hRotationSpeed});
    for(const offset of [0,317,2401]){
      const before=hPreviewOptions(state,{elapsedMs:offset}),after=hPreviewOptions(state,{elapsedMs:offset+period});
      for(const field of ['rotateX','rotateY','rotateZ'])assert.ok(Math.abs(before[field]-after[field])<1e-9,`${axis}/${version}/${offset}/${field}`);
    }
  }
});
