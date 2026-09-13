/** 화면 기준 H 자동회전. 외부 import 없음. 물체 Euler는 Rz(z)·Ry(y)·Rx(x) 예요. */
const TAU=Math.PI*2;
const RIGHT=[1/Math.sqrt(2),-1/Math.sqrt(2),0];
const DOWN=[-1/Math.sqrt(6),-1/Math.sqrt(6),2/Math.sqrt(6)];
const CAMERA=[-1/Math.sqrt(3),-1/Math.sqrt(3),-1/Math.sqrt(3)];
export const H_ROTATION_TILT_MAX_DEG=35;
export const H_ROTATION_TILT_DEFAULT_DEG=H_ROTATION_TILT_MAX_DEG/2;
const SCAN_TILT=H_ROTATION_TILT_MAX_DEG*Math.PI/180;
// Y의 orbit state는 RIGHT/UP/화면법선의 Euler 각이에요. H wire 좌표와 분리해요.
const ORBIT_BASIS=RIGHT.map((v,i)=>[v,-DOWN[i],-CAMERA[i]]);
const transpose=R=>R[0].map((_,i)=>R.map(row=>row[i]));
const I=[[1,0,0],[0,1,0],[0,0,1]];

function wrap(a){
  const t=a%TAU;
  return t<0?t+TAU:t;
}
function mul(a,b){
  const o=[[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)o[i][j]=a[i][0]*b[0][j]+a[i][1]*b[1][j]+a[i][2]*b[2][j];
  return o;
}
function about(u,angle){
  const t=wrap(angle),c=Math.cos(t),s=Math.sin(t),k=1-c,[x,y,z]=u;
  return [
    [c+x*x*k,x*y*k-z*s,x*z*k+y*s],
    [y*x*k+z*s,c+y*y*k,y*z*k-x*s],
    [z*x*k-y*s,z*y*k+x*s,c+z*z*k],
  ];
}
function rx(a){const t=wrap(a),c=Math.cos(t),s=Math.sin(t);return [[1,0,0],[0,c,-s],[0,s,c]];}
function ry(a){const t=wrap(a),c=Math.cos(t),s=Math.sin(t);return [[c,0,s],[0,1,0],[-s,0,c]];}
function rz(a){const t=wrap(a),c=Math.cos(t),s=Math.sin(t);return [[c,-s,0],[s,c,0],[0,0,1]];}
function fromEuler(e){return mul(rz(e.rotateZ),mul(ry(e.rotateY),rx(e.rotateX)));}
function toEuler(R){
  const r20=R[2][0],cy=Math.hypot(R[0][0],R[1][0]);
  if(cy<1e-12)return {rotateX:Math.atan2(r20<0?R[0][1]:-R[0][1],R[1][1]),rotateY:r20<0?Math.PI/2:-Math.PI/2,rotateZ:0};
  const y=Math.atan2(-r20,cy);
  return {rotateX:Math.atan2(R[2][1],R[2][2]),rotateY:y,rotateZ:Math.atan2(R[1][0],R[0][0])};
}
function readEuler(value,label){
  if(!value||typeof value!=='object')throw new TypeError(`${label} 회전이 필요해요`);
  const rotateX=value.rotateX??0,rotateY=value.rotateY??0,rotateZ=value.rotateZ??0;
  if(![rotateX,rotateY,rotateZ].every(Number.isFinite))throw new RangeError(`${label} 각은 유한해야 해요`);
  return {rotateX,rotateY,rotateZ};
}
function finiteEuler(e){
  if(![e.rotateX,e.rotateY,e.rotateZ].every(Number.isFinite))throw new RangeError('회전 각이 유한하지 않아요');
  return e;
}
function direction(value,label){
  if(value!==1&&value!==-1)throw new RangeError(`${label} 는 +1|-1 이어야 해요`);
  return value;
}
function rotationOptions(axis,speed){
  if(!['x','y','gyro'].includes(axis))throw new RangeError('axis 는 x|y|gyro 여야 해요');
  if(!Number.isFinite(speed)||speed<1||speed>90)throw new RangeError('speed 는 1..90 deg/s 여야 해요');
}

/** 기본축 360°/speed에 부축의 정수 주기를 맞춰 자세·속도·가속도가 함께 닫혀요. */
export function hRotationPeriodMs({axis='x',speed=15}={}){
  rotationOptions(axis,speed);
  return 360000/speed;
}

/** 화면 RIGHT=X, DOWN=Y. speed는 기본축의 평균 deg/s예요.
 * X/Y에 최대 ±35° S자 부축(3주기), gyro에 두 부축(2주기)을 더해 좁게 보이던 면을 펼쳐요.
 * 최대값에서 iso·원근4°의 6면 최소 peak/정면면적: X>.75, Y>.86, gyro>.95 (임의 수동 자세 보장은 아니에요).
 * 낮은 수준 API의 생략값은 호환용 35°이고, 생성기는 사용자 상태(기본17.5°)를 명시 전달해요.
 * 정렬 배치의 cap 숨김은 wobble:false로 보존해요. export도 같은 함수를 사용해요.
 */
export function hScreenSpin(elapsedMs,{axis='x',speed=15,directionX=1,directionY=1,wobble=true,tiltDeg=H_ROTATION_TILT_MAX_DEG}={}){
  if(!Number.isFinite(elapsedMs)||elapsedMs<0)throw new RangeError('elapsedMs 는 0 이상 유한값이어야 해요');
  rotationOptions(axis,speed);
  direction(directionX,'directionX');direction(directionY,'directionY');
  if(typeof wobble!=='boolean')throw new TypeError('wobble 은 boolean 이어야 해요');
  if(!Number.isFinite(tiltDeg)||tiltDeg<0||tiltDeg>H_ROTATION_TILT_MAX_DEG)throw new RangeError('tiltDeg 는 0..35° 이어야 해요');
  const period=hRotationPeriodMs({axis,speed});
  const a=(elapsedMs%period)*speed*Math.PI/180000;
  let R=I;
  // 이 조절은 X/Y 전용이에요. gyro의 두 축 보정은 기존 최대 진폭을 유지해요.
  const amplitude=axis==='gyro'?SCAN_TILT:tiltDeg*Math.PI/180;
  const tilt=wobble?amplitude*Math.sin((axis==='gyro'?2:3)*a):0;
  if(axis==='x')R=mul(about(DOWN,directionX*tilt),about(RIGHT,directionX*a));
  else if(axis==='y')R=mul(about(RIGHT,directionY*tilt),about(DOWN,directionY*a));
  else{
    const spin=mul(about(DOWN,directionY*2*a),about(RIGHT,directionX*a));
    R=mul(mul(about(DOWN,directionY*tilt),about(RIGHT,directionX*tilt)),spin);
  }
  return finiteEuler(toEuler(R));
}

/** Y와 같은 화면 궤도 각을 H의 물리 좌표 회전으로 바꿔요. */
export function hOrbitRotation({yaw=0,pitch=0,roll=0}={}) {
  const e=readEuler({rotateX:pitch,rotateY:yaw,rotateZ:roll},'orbit');
  if(yaw===0&&pitch===0&&roll===0)return {rotateX:0,rotateY:0,rotateZ:0};
  return finiteEuler(toEuler(mul(ORBIT_BASIS,mul(fromEuler(e),transpose(ORBIT_BASIS)))));
}
/** 자동회전 동결/드래그 뒤에도 상태의 화면 궤도 의미를 유지해요. */
export function hOrbitFromRotation(rotation) {
  const physical=readEuler(rotation,'physical');
  if(physical.rotateX===0&&physical.rotateY===0&&physical.rotateZ===0)return {yaw:0,pitch:0,roll:0};
  const R=fromEuler(physical);
  const e=finiteEuler(toEuler(mul(transpose(ORBIT_BASIS),mul(R,ORBIT_BASIS))));
  return {yaw:e.rotateY,pitch:e.rotateX,roll:e.rotateZ};
}
/** XM/YM 두 면과 중앙 심지를 맞추고 Z± cap을 화면 회전축 끝으로 보내요. */
export function hAlignmentRotation(arrangement='isometric') {
  if(arrangement==='isometric')return {rotateX:0,rotateY:0,rotateZ:0};
  if(!['horizontal','vertical'].includes(arrangement))throw new RangeError('H alignment');
  const across=arrangement==='horizontal'?RIGHT:DOWN.map(v=>-v);
  const seam=arrangement==='horizontal'?DOWN:RIGHT;
  const x=CAMERA.map((v,i)=>(-v+across[i])/Math.sqrt(2));
  const y=CAMERA.map((v,i)=>(-v-across[i])/Math.sqrt(2));
  return finiteEuler(toEuler(x.map((v,i)=>[v,y[i],seam[i]])));
}
/** 마우스 증분을 화면축에서 왼쪽 합성해 가까운 표면이 손을 따라오게 해요. */
export function hDragRotation(base,{dx=0,dy=0,rollDelta=0}={}) {
  if(![dx,dy,rollDelta].every(Number.isFinite))throw new RangeError('유한한 포인터 증분이 필요해요');
  const R=mul(about(CAMERA,rollDelta),mul(about(DOWN,dx*.01),about(RIGHT,-dy*.01)));
  return composeHRotation(base,finiteEuler(toEuler(R)));
}

/** extra·base 모두 RzRyRx. 결과는 extra*base 의 Euler 예요. */
export function composeHRotation(base,extra){
  const b=readEuler(base,'base'),e=readEuler(extra,'extra');
  if(e.rotateX===0&&e.rotateY===0&&e.rotateZ===0)return b;
  return finiteEuler(toEuler(mul(fromEuler(e),fromEuler(b))));
}
