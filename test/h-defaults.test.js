import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeneratorState} from '../src/generator-state.js';
import {H_GYRO_ROTATION_SPEED_DEFAULT,selectHRepresentation,selectHFaceCount,selectHRotationMode,selectHRotationSpeed,hPreviewOptions} from '../src/generator-h.js';
import {orbitPerspToDeg} from '../src/generator-orbit-view.js';
import {cubeVideoDurationMs} from '../src/cube-video-export.js';

test('H 생성기 기본은 mask7이고 명시 auto/0..6 선택은 보존해요',()=>{
  assert.equal(createGeneratorState({type:'Y',yRepresentation:'3d'}).hMask,7);
  for(const hMask of ['auto',0,1,2,3,4,5,6])assert.equal(createGeneratorState({type:'Y',yRepresentation:'3d',hMask}).hMask,hMask);
});

test('새 H는 원근 4도·Y축·초당 75도이고 기존 Y 기본은 평행투영이에요',()=>{
  const y=createGeneratorState({type:'Y'}),h=createGeneratorState({type:'Y',yRepresentation:'3d'});
  assert.equal(y.orbitPersp,0);assert.equal(orbitPerspToDeg(h.orbitPersp),4);
  assert.equal(h.hRotationMode,'y');assert.equal(h.hRotationSpeed,75);
  const selected=selectHFaceCount(y,6);
  assert.equal(selected.hAutoRotate,true);
  assert.equal(orbitPerspToDeg(selected.orbitPersp),4);
  assert.equal(cubeVideoDurationMs({speed:selected.hRotationSpeed,axis:selected.hRotationMode}),4800);
  const spinning={...selected,hAutoRotate:true};
  const a=hPreviewOptions(spinning,{elapsedMs:0}),b=hPreviewOptions(spinning,{elapsedMs:4800});
  assert.notDeepEqual(hPreviewOptions(spinning,{elapsedMs:1200}),a);
  for(const key of ['rotateX','rotateY','rotateZ'])assert.ok(Math.abs(a[key]-b[key])<1e-10);
});
test('H의 명시한 평면·원근·속도와 3/6면 전환은 새 기본값으로 덮지 않아요',()=>{
  for(const orbitPersp of [0,15,80]){
    const h=createGeneratorState({type:'Y',yRepresentation:'3d',orbitPersp,hRotationSpeed:17});
    assert.equal(h.orbitPersp,orbitPersp);assert.equal(h.hRotationSpeed,17);
    for(const state of [selectHRepresentation(h,'3d'),selectHFaceCount(h,6),selectHFaceCount(h,3)]){
      assert.equal(state.orbitPersp,orbitPersp);assert.equal(state.hRotationSpeed,17);
    }
  }
});
test('자이로 auto 속도는 60°/s이고 직접·복원 속도는 축 전환에도 보존해요',()=>{
  const fresh=createGeneratorState({type:'Y',yRepresentation:'3d'});
  assert.equal(fresh.hRotationSpeed,75);assert.equal(fresh.hRotationSpeedIntent,'auto');
  const gyro=selectHRotationMode(fresh,'gyro');
  assert.equal(gyro.hRotationSpeed,H_GYRO_ROTATION_SPEED_DEFAULT);assert.equal(gyro.hRotationSpeedIntent,'auto');
  assert.equal(createGeneratorState({type:'Y',yRepresentation:'3d',hRotationMode:'gyro'}).hRotationSpeed,60);
  assert.equal(selectHRotationMode(gyro,'x').hRotationSpeed,75);
  const manual=selectHRotationSpeed(gyro,37);
  assert.equal(manual.hRotationSpeed,37);assert.equal(manual.hRotationSpeedIntent,'manual');
  assert.equal(selectHRotationMode(manual,'y').hRotationSpeed,37);
  const restored=createGeneratorState({type:'Y',yRepresentation:'3d',hRotationSpeed:41});
  assert.equal(restored.hRotationSpeedIntent,'manual');assert.equal(selectHRotationMode(restored,'gyro').hRotationSpeed,41);
});

test('자이로 60도 기본값의 영상은 6초 공동 주기로 시작 자세에 돌아와요',()=>{
  const gyro=selectHRotationMode(selectHRepresentation(createGeneratorState(),'3d'),'gyro');
  const duration=cubeVideoDurationMs({axis:gyro.hRotationMode,speed:gyro.hRotationSpeed});
  assert.equal(duration,6000);
  const start=hPreviewOptions(gyro,{elapsedMs:0}),end=hPreviewOptions(gyro,{elapsedMs:duration});
  assert.notDeepEqual(hPreviewOptions(gyro,{elapsedMs:duration/4}),start);
  for(const key of ['rotateX','rotateY','rotateZ'])assert.ok(Math.abs(start[key]-end[key])<1e-10);
});
