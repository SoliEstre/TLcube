import test from 'node:test';
import assert from 'node:assert/strict';
import {hRotationPeriodMs,hScreenSpin,composeHRotation,hOrbitRotation,hOrbitFromRotation,hDragRotation,hAlignmentRotation} from '../src/h-rotation.js';

const RIGHT=[1/Math.sqrt(2),-1/Math.sqrt(2),0];
const DOWN=[-1/Math.sqrt(6),-1/Math.sqrt(6),2/Math.sqrt(6)];
const TAU=Math.PI*2;
const mul=(a,b)=>a.map(row=>b[0].map((_,j)=>row.reduce((s,v,k)=>s+v*b[k][j],0)));
const transpose=R=>R[0].map((_,i)=>R.map(row=>row[i]));
const about=(u,a)=>{const c=Math.cos(a),s=Math.sin(a),k=1-c,[x,y,z]=u;return [[c+x*x*k,x*y*k-z*s,x*z*k+y*s],[y*x*k+z*s,c+y*y*k,y*z*k-x*s],[z*x*k-y*s,z*y*k+x*s,c+z*z*k]];};
const fromEuler=e=>{const x=e.rotateX,y=e.rotateY,z=e.rotateZ,cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);return [[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]];};
function close(a,b,eps=1e-9){for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(a[i][j]-b[i][j])<eps,`${i},${j}`);}
const B=35*Math.PI/180;
const expected=(axis,t,{directionX=1,directionY=1,wobble=true}={})=>{
  const a=TAU*t,w=wobble?B:0;
  if(axis==='x')return mul(about(DOWN,directionX*w*Math.sin(3*a)),about(RIGHT,directionX*a));
  if(axis==='y')return mul(about(RIGHT,directionY*w*Math.sin(3*a)),about(DOWN,directionY*a));
  return mul(about(DOWN,directionY*w*Math.sin(2*a)),mul(about(RIGHT,directionX*w*Math.sin(2*a)),mul(about(DOWN,directionY*2*a),about(RIGHT,directionX*a))));
};
const sub=(a,b)=>a.map((row,i)=>row.map((value,j)=>value-b[i][j]));
const add=(a,b)=>a.map((row,i)=>row.map((value,j)=>value+b[i][j]));
const scale=(a,k)=>a.map(row=>row.map(value=>value*k));
const sample=(period,fraction,options)=>fromEuler(hScreenSpin(period*fraction,options));

test('S-curve X/Y/gyro는 지정한 screen-axis matrix 순서를 그대로 지켜요',()=>{
  const speed=75,period=360000/speed;
  for(const wobble of [false,true])for(const t of [.037,.2,.49,.81])for(const directionX of [-1,1])for(const directionY of [-1,1])for(const axis of ['x','y','gyro']){
    close(sample(period,t,{axis,speed,directionX,directionY,wobble}),expected(axis,t,{directionX,directionY,wobble}));
  }
});
test('X/Y/gyro의 모든 관련 방향은 wobble 유무와 무관하게 정확히 한 cycle에 항등으로 돌아와요',()=>{
  const speed=75,period=360000/speed,I=[[1,0,0],[0,1,0],[0,0,1]];
  for(const wobble of [false,true]){
    for(const directionX of [-1,1])close(sample(period,1,{axis:'x',speed,directionX,wobble}),I);
    for(const directionY of [-1,1])close(sample(period,1,{axis:'y',speed,directionY,wobble}),I);
    for(const directionX of [-1,1])for(const directionY of [-1,1])close(sample(period,1,{axis:'gyro',speed,directionX,directionY,wobble}),I);
  }
  for(const axis of ['x','y','gyro'])assert.equal(hRotationPeriodMs({axis,speed}),period);
});
test('S-curve cycle seam은 모든 관련 방향에서 C1/C2 수치 연속이에요',()=>{
  const speed=75,period=360000/speed,d=1e-4;
  for(const wobble of [false,true])for(const axis of ['x','y','gyro'])for(const directionX of [-1,1])for(const directionY of [-1,1]){
    if((axis==='x'&&directionY===-1)||(axis==='y'&&directionX===-1))continue;
    const options={axis,speed,directionX,directionY,wobble},zero=sample(period,0,options),one=sample(period,1,options),before=sample(period,1-d,options),after=sample(period,d,options),before2=sample(period,1-2*d,options),after2=sample(period,2*d,options),before3=sample(period,1-3*d,options),after3=sample(period,3*d,options);
    close(one,zero);
    const leftD=scale(add(sub(scale(one,3),scale(before,4)),before2),1/(2*d)),rightD=scale(sub(add(scale(after,4),scale(after2,-1)),scale(zero,3)),1/(2*d));
    const leftD2=scale(add(add(sub(scale(one,2),scale(before,5)),scale(before2,4)),scale(before3,-1)),1/(d*d)),rightD2=scale(add(add(sub(scale(zero,2),scale(after,5)),scale(after2,4)),scale(after3,-1)),1/(d*d));
    close(leftD,rightD,3e-4);
    close(leftD2,rightD2,.02);
  }
});
test('X/Y 역방향은 같은 wobble 설정의 정방향 P-t와 같아요',()=>{
  const speed=75,period=360000/speed;
  for(const wobble of [false,true])for(const t of [0,.037,.2,.49,.81]){
    close(sample(period,t,{axis:'x',speed,directionX:-1,wobble}),sample(period,1-t,{axis:'x',speed,directionX:1,wobble}));
    close(sample(period,t,{axis:'y',speed,directionY:-1,wobble}),sample(period,1-t,{axis:'y',speed,directionY:1,wobble}));
  }
});
test('방향 입력은 정확히 +1 또는 -1이고 기존 orbit/drag/alignment 계약은 보존해요',()=>{
  for(const value of [0,2,.5,NaN])assert.throws(()=>hScreenSpin(0,{directionX:value}),RangeError);
  assert.throws(()=>hRotationPeriodMs({axis:'z'}),RangeError);
  close(fromEuler(hScreenSpin(0,{axis:'gyro'})),[[1,0,0],[0,1,0],[0,0,1]]);
  const base=hOrbitRotation({yaw:.4,pitch:-.2,roll:.1});
  const round=hOrbitRotation(hOrbitFromRotation(base));close(fromEuler(base),fromEuler(round));
  assert.ok(Object.values(hDragRotation(base,{dx:3,dy:-2,rollDelta:.1})).every(Number.isFinite));
  assert.ok(Object.values(hAlignmentRotation('horizontal')).every(Number.isFinite));
  assert.ok(Object.values(composeHRotation(base,hScreenSpin(200,{axis:'gyro'}))).every(Number.isFinite));
  assert.equal(TAU,Math.PI*2);
});
