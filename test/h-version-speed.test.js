import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeneratorState} from '../src/generator-state.js';
import {
  hRotationSpeedDefault,reconcileHRotationSpeed,selectHRotationMode,selectHRotationSpeedDefault,
} from '../src/generator-h.js';
import {encodeH,hCapacity} from '../src/h-codec.js';
import {cubeVideoDurationMs} from '../src/cube-video-export.js';
import {hScreenSpin} from '../src/h-rotation.js';

const AXES=['x','y','gyro'];
const speedFor=(version,axis)=>version===8?(axis==='gyro'?35:50):version>=6?(axis==='gyro'?45:60):(axis==='gyro'?60:75);
const autoState=(versionH='auto',axis='y')=>({
  type:'Y',yRepresentation:'3d',versionH,hRotationMode:axis,hRotationSpeedIntent:'auto',
  hAutoRotate:true,hRotationDirectionX:-1,hRotationDirectionY:1,
});

function matrix(e){
  const [x,y,z]=[e.rotateX,e.rotateY,e.rotateZ],cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  return [[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx],[sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx],[-sy,cy*sx,cy*cx]];
}
function samePose(a,b){
  const ma=matrix(a),mb=matrix(b);
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(ma[i][j]-mb[i][j])<1e-9,`${i}/${j}`);
}

test('H6 경계부터 H7까지와 H8의 기본 속도는 축별로 낮고, H0..H5는 기존 기본값이에요',()=>{
  for(const version of [...Array(9).keys()])for(const axis of AXES){
    assert.equal(hRotationSpeedDefault(version,axis),speedFor(version,axis),`H${version} ${axis}`);
    const state=createGeneratorState({...autoState(version,axis)});
    assert.equal(state.hRotationSpeed,speedFor(version,axis),`생성 H${version} ${axis}`);
  }
});

test('auto 해상도는 실제 encode 결과(H6 포함)를 따라가되, 명시 H 버전이 우선이에요',()=>{
  const profile={version:'auto',mode:6,tones:3,ecc:'H',mask:7,finder:'corners'};
  const compact=encodeH('A'.repeat(1),profile),dense=encodeH('A'.repeat(450),profile);
  const actualH6=encodeH('A'.repeat(hCapacity(5,6,{tones:profile.tones,ecc:profile.ecc,mask:profile.mask,finder:profile.finder}).maxPayloadBytes+1),profile);
  assert.equal(compact.version,5);
  assert.equal(dense.version,8);
  assert.equal(actualH6.version,6,'auto encode must reach H6');
  const original=autoState('auto','gyro');
  const compactState=reconcileHRotationSpeed(original,compact.version);
  const denseState=reconcileHRotationSpeed(original,dense.version);
  assert.notStrictEqual(compactState,original);
  assert.equal(original.hRotationSpeedIntent,'auto');
  assert.equal(compactState.hRotationSpeed,60);
  for(const axis of AXES)assert.equal(reconcileHRotationSpeed(autoState('auto',axis),actualH6.version).hRotationSpeed,speedFor(6,axis),`actual H6 ${axis}`);
  assert.equal(denseState.hRotationSpeed,35);
  assert.equal(reconcileHRotationSpeed(autoState(7,'gyro'),dense.version).hRotationSpeed,45);
});

test('수동 속도는 버전ㆍ축 변경과 기본값 복원 뒤 재해상도에도 보존돼요',()=>{
  const manual={...autoState('auto','x'),hRotationSpeedIntent:'manual',hRotationSpeed:37};
  for(const version of [...Array(9).keys()])for(const axis of AXES){
    const changed=selectHRotationMode(manual,axis,version);
    assert.equal(changed.hRotationSpeedIntent,'manual');
    assert.equal(changed.hRotationSpeed,37,`manual H${version} ${axis}`);
    assert.equal(reconcileHRotationSpeed(changed,version).hRotationSpeed,37);
  }
  for(const version of [6,7,8])for(const axis of AXES){
    const restored=selectHRotationSpeedDefault({...manual,hRotationMode:axis},version);
    assert.equal(restored.hRotationSpeedIntent,'auto');
    assert.equal(restored.hRotationSpeed,speedFor(version,axis),`reset H${version} ${axis}`);
    assert.equal(restored.hRotationDirectionX,-1);
    assert.equal(restored.hRotationDirectionY,1);
    assert.equal(restored.hAutoRotate,true);
  }
});

test('H6/H7/H8 영상은 새 자동 기본속도로 한 주기에 정확히 닫혀요',()=>{
  for(const version of [6,7,8])for(const axis of AXES){
    const speed=hRotationSpeedDefault(version,axis),duration=cubeVideoDurationMs({axis,speed});
    assert.equal(duration,360000/speed,`H${version} ${axis} duration`);
    samePose(hScreenSpin(0,{axis,speed,directionX:-1,directionY:1}),hScreenSpin(duration,{axis,speed,directionX:-1,directionY:1}));
  }
});
