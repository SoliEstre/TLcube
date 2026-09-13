import test from 'node:test';
import assert from 'node:assert/strict';
import {hScreenSpin,composeHRotation,hRotationPeriodMs} from '../src/h-rotation.js';

const CAMERA=[-1/Math.sqrt(3),-1/Math.sqrt(3),-1/Math.sqrt(3)];
const RIGHT=[1/Math.sqrt(2),-1/Math.sqrt(2),0];
const DOWN=[-1/Math.sqrt(6),-1/Math.sqrt(6),2/Math.sqrt(6)];
const NORMALS={ZM:[0,0,-1],XM:[-1,0,0],YM:[0,-1,0],ZP:[0,0,1],XP:[1,0,0],YP:[0,1,0]};
const TAU=Math.PI*2;
const wrap=a=>{const t=a%TAU;return t<0?t+TAU:t;};
function mul(a,b){const o=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++)o[i][j]=a[i][0]*b[0][j]+a[i][1]*b[1][j]+a[i][2]*b[2][j];return o;}
function about(u,angle){const t=wrap(angle),c=Math.cos(t),s=Math.sin(t),k=1-c,[x,y,z]=u;return [[c+x*x*k,x*y*k-z*s,x*z*k+y*s],[y*x*k+z*s,c+y*y*k,y*z*k-x*s],[z*x*k-y*s,z*y*k+x*s,c+z*z*k]];}
function rx(a){const t=wrap(a),c=Math.cos(t),s=Math.sin(t);return [[1,0,0],[0,c,-s],[0,s,c]];}
function ry(a){const t=wrap(a),c=Math.cos(t),s=Math.sin(t);return [[c,0,s],[0,1,0],[-s,0,c]];}
function rz(a){const t=wrap(a),c=Math.cos(t),s=Math.sin(t);return [[c,-s,0],[s,c,0],[0,0,1]];}
function fromEuler(e){return mul(rz(e.rotateZ),mul(ry(e.rotateY),rx(e.rotateX)));}
function apply(R,v){return [R[0][0]*v[0]+R[0][1]*v[1]+R[0][2]*v[2],R[1][0]*v[0]+R[1][1]*v[1]+R[1][2]*v[2],R[2][0]*v[0]+R[2][1]*v[1]+R[2][2]*v[2]];}
function closeMat(a,b,eps=1e-9){for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(a[i][j]-b[i][j])<eps,`${i}${j}`);}
function closeEuler(a,b,eps=1e-9){closeMat(fromEuler(a),fromEuler(b),eps);}
function angleOf(R){const tr=R[0][0]+R[1][1]+R[2][2];return Math.acos(Math.min(1,Math.max(-1,(tr-1)/2)));}
function expectedSpin(axis,a,dx=1,dy=1){
  const tilt=35*Math.PI/180*Math.sin((axis==='gyro'?2:3)*a);
  if(axis==='x')return mul(about(DOWN,dx*tilt),about(RIGHT,dx*a));
  if(axis==='y')return mul(about(RIGHT,dy*tilt),about(DOWN,dy*a));
  return mul(mul(about(DOWN,dy*tilt),about(RIGHT,dx*tilt)),mul(about(DOWN,dy*2*a),about(RIGHT,dx*a)));
}

test('hScreenSpin X/Y와 2:1 gyro에 정수 주기 읽기용 S 기울임을 합성해요',()=>{
  const ms=1234,speed=15,ax=ms*speed*Math.PI/180000;
  closeMat(fromEuler(hScreenSpin(ms,{axis:'x',speed})),expectedSpin('x',ax));
  closeMat(fromEuler(hScreenSpin(ms,{axis:'y',speed:30})),expectedSpin('y',ms*30*Math.PI/180000));
  const g=hScreenSpin(2000,{axis:'gyro',speed:15}),ag=2000*15*Math.PI/180000;
  closeMat(fromEuler(g),expectedSpin('gyro',ag));
});

test('gyro 2:1은 네 방향 조합에서 identity로 닫히고 경계 양쪽 미분이 연속이에요',()=>{
  const speed=75,period=hRotationPeriodMs({axis:'gyro',speed}),dt=.01;
  assert.equal(period,360000/speed);
  for(const directionX of [-1,1])for(const directionY of [-1,1]){
    const options={axis:'gyro',speed,directionX,directionY};
    closeMat(fromEuler(hScreenSpin(0,options)),fromEuler(hScreenSpin(period,options)));
    closeMat(fromEuler(hScreenSpin(dt,options)),expectedSpin('gyro',dt*speed*Math.PI/180000,directionX,directionY));
    const left=fromEuler(hScreenSpin(period-dt,options)),end=fromEuler(hScreenSpin(period,options)),right=fromEuler(hScreenSpin(period+dt,options));
    const leftStep=mul(end,[[left[0][0],left[1][0],left[2][0]],[left[0][1],left[1][1],left[2][1]],[left[0][2],left[1][2],left[2][2]]]);
    const rightStep=mul(right,[[end[0][0],end[1][0],end[2][0]],[end[0][1],end[1][1],end[2][1]],[end[0][2],end[1][2],end[2][2]]]);
    closeMat(leftStep,rightStep,1e-8);
  }
});

test('연속 프레임 각이 점프하지 않아요',()=>{
  const speed=15,dt=16;let prev=null;
  for(let t=0;t<4000;t+=dt){
    const R=fromEuler(hScreenSpin(t,{axis:'x',speed}));
    const ang=angleOf(R);
    if(prev!==null){const step=ang-prev;const wrapped=Math.min(Math.abs(step),Math.abs(Math.abs(step)-Math.PI));assert.ok(wrapped<0.05);}
    prev=ang;assert.ok([R[0][0],R[1][2],R[2][1]].every(Number.isFinite));
  }
  const far=hScreenSpin(1e10,{axis:'gyro',speed:90});assert.ok([far.rotateX,far.rotateY,far.rotateZ].every(Number.isFinite));
});

test('합성은 extra*base 이고 elapsed 0 동결은 수동자세와 같아요',()=>{
  const base={rotateX:.4,rotateY:-.7,rotateZ:.2};
  const extra=hScreenSpin(800,{axis:'x',speed:15});
  closeMat(fromEuler(composeHRotation(base,extra)),mul(fromEuler(extra),fromEuler(base)));
  closeEuler(composeHRotation(base,hScreenSpin(0,{axis:'x'})),base);
  closeEuler(composeHRotation(base,hScreenSpin(0,{axis:'y'})),base);
  closeEuler(composeHRotation({rotateX:0,rotateY:0,rotateZ:0},extra),extra);
  const lock=Math.PI/2,g=composeHRotation({rotateX:lock,rotateY:lock,rotateZ:0},{rotateX:.01,rotateY:0,rotateZ:0});
  assert.ok([g.rotateX,g.rotateY,g.rotateZ].every(Number.isFinite));
});

test('화면 X/Y 한 주기 안에 여섯 면 법선이 카메라에 보여요',()=>{
  const speed=15,period=hRotationPeriodMs({axis:'x',speed}),threshold=.025;
  for(const axis of ['x','y']){
    const seen=new Set();
    for(let k=0;k<=120;k++){
      const R=fromEuler(hScreenSpin(period*k/120,{axis,speed}));
      for(const [face,n] of Object.entries(NORMALS)){const q=apply(R,n),vis=q[0]*CAMERA[0]+q[1]*CAMERA[1]+q[2]*CAMERA[2];if(vis>threshold)seen.add(face);}
    }
    assert.deepEqual(seen,new Set(Object.keys(NORMALS)),axis);
  }
});

test('입력 검증',()=>{
  assert.throws(()=>hScreenSpin(Number.NaN,{axis:'x'}),RangeError);
  assert.throws(()=>hScreenSpin(-1,{axis:'x'}),RangeError);
  assert.throws(()=>hScreenSpin(0,{axis:'z'}),RangeError);
  assert.throws(()=>hScreenSpin(0,{axis:'x',speed:0}),RangeError);
  assert.throws(()=>hScreenSpin(0,{axis:'x',speed:91}),RangeError);
  assert.throws(()=>hScreenSpin(0,{axis:'x',directionX:0}),RangeError);
  assert.throws(()=>hScreenSpin(0,{wobble:'false'}),TypeError);
  assert.throws(()=>hRotationPeriodMs({axis:'z',speed:15}),RangeError);
  assert.throws(()=>composeHRotation(null,{rotateX:0,rotateY:0,rotateZ:0}),TypeError);
  assert.throws(()=>composeHRotation({rotateX:Infinity,rotateY:0,rotateZ:0},{rotateX:0,rotateY:0,rotateZ:0}),RangeError);
});

test('양/음 짐벌 자세에서도 합성 행렬이 보존되고 큰 시각도 유한해요',()=>{
  for(const y of [Math.PI/2,-Math.PI/2,Math.PI/2-1e-7,-Math.PI/2+1e-7]){
    const base={rotateX:.4,rotateY:y,rotateZ:.2},extra={rotateX:0,rotateY:0,rotateZ:.1};
    closeMat(fromEuler(composeHRotation(base,extra)),mul(fromEuler(extra),fromEuler(base)),1e-8);
  }
  assert.ok(Object.values(hScreenSpin(Number.MAX_VALUE,{axis:'gyro',speed:90})).every(Number.isFinite));
});
