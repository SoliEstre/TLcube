import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGeneratorState,GENERATOR_STATE_SCHEMA} from '../src/generator-state.js';
import {clampHRotationTilt,selectHRotationTilt,hPreviewOptions,selectHArrangement} from '../src/generator-h.js';
import {hScreenSpin,hRotationPeriodMs,H_ROTATION_TILT_MAX_DEG,H_ROTATION_TILT_DEFAULT_DEG} from '../src/h-rotation.js';
import {cubeVideoDurationMs} from '../src/cube-video-export.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const close=(a,b)=>{for(const key of ['rotateX','rotateY','rotateZ'])assert.ok(Math.abs(a[key]-b[key])<1e-9,`${key} ${a[key]} / ${b[key]}`);};
const state=overrides=>createGeneratorState({type:'Y',yRepresentation:'3d',orbitView:'3d',hAutoRotate:true,...overrides});

test('기울임 기본값은 중간17.5°, 0..35°와0.5°눈금을 정규화해요',()=>{
  assert.equal(H_ROTATION_TILT_MAX_DEG,35);assert.equal(H_ROTATION_TILT_DEFAULT_DEG,17.5);
  assert.equal(GENERATOR_STATE_SCHEMA.hRotationTiltDeg.defaultValue,17.5);
  assert.equal(state().hRotationTiltDeg,17.5);
  for(const input of [undefined,null,'',NaN,Infinity,'invalid'])assert.equal(clampHRotationTilt(input),17.5);
  for(const [input,expected] of [[-1,0],[0,0],['12.5',12.5],[17.6,17.5],[36,35]]){
    assert.equal(clampHRotationTilt(input),expected);assert.equal(state({hRotationTiltDeg:input}).hRotationTiltDeg,expected);
  }
  const original=state({hRotationSpeed:39}),next=selectHRotationTilt(original,0);
  assert.equal(original.hRotationTiltDeg,17.5);assert.equal(next.hRotationTiltDeg,0);
  assert.equal(next.hRotationSpeed,39);assert.equal(next.hRotationSpeedIntent,'manual');
});

test('XY는0에서기울임없음·35에서기존최대·중간에서다른경로이며 gyro는영향받지않아요',()=>{
  for(const axis of ['x','y'])for(const sign of [-1,1]){
    const opts={axis,speed:60,directionX:sign,directionY:sign};
    close(hScreenSpin(379,{...opts,tiltDeg:0}),hScreenSpin(379,{...opts,wobble:false}));
    close(hScreenSpin(379,{...opts,tiltDeg:35}),hScreenSpin(379,opts));
    assert.notDeepEqual(hScreenSpin(379,{...opts,tiltDeg:17.5}),hScreenSpin(379,{...opts,tiltDeg:0}));
    assert.notDeepEqual(hScreenSpin(379,{...opts,tiltDeg:17.5}),hScreenSpin(379,{...opts,tiltDeg:35}));
    for(const tiltDeg of [0,17.5,35]){
      const s=state({hRotationMode:axis,hRotationSpeed:60,hRotationDirectionX:sign,hRotationDirectionY:sign,hRotationTiltDeg:tiltDeg});
      close(hPreviewOptions(s,{elapsedMs:379}),hScreenSpin(379,{...opts,tiltDeg}));
    }
  }
  for(const tiltDeg of [0,17.5,35])for(const directionX of [-1,1])for(const directionY of [-1,1]){
    const options={axis:'gyro',speed:45,directionX,directionY};
    close(hScreenSpin(379,{...options,tiltDeg}),hScreenSpin(379,options));
  }
});

test('모든기울임의영상주기·시작offset을보존하고 정렬4면의cap숨김을바꾸지않아요',()=>{
  for(const axis of ['x','y','gyro'])for(const tiltDeg of [0,.5,17.5,35]){
    const s=state({hRotationMode:axis,hRotationTiltDeg:tiltDeg}),p=cubeVideoDurationMs({axis,speed:s.hRotationSpeed});
    assert.equal(p,hRotationPeriodMs({axis,speed:s.hRotationSpeed}));
    for(const offset of [0,389,2499])close(hPreviewOptions(s,{elapsedMs:offset}),hPreviewOptions(s,{elapsedMs:offset+p}));
  }
  for(const arrangement of ['horizontal','vertical']){
    const base=selectHArrangement(state({hFaces:4}),arrangement);
    close(hPreviewOptions({...base,hRotationTiltDeg:0},{elapsedMs:379}),hPreviewOptions({...base,hRotationTiltDeg:35},{elapsedMs:379}));
  }
});

test('기울임값검증·UI범위·영상snapshot및간격계약을고정해요',()=>{
  for(const tiltDeg of [-1,35.5,NaN,Infinity,'17.5'])assert.throws(()=>hScreenSpin(0,{tiltDeg}),RangeError);
  assert.match(html,/id="hRotationTilt"[^>]*min="0"[^>]*max="35"[^>]*step="0.5"[^>]*value="17.5"/);
  assert.match(html,/id="hRotationTiltReset"[^>]*data-h-aria-label="tiltReset"[^>]*aria-pressed="true"/);
  assert.match(html,/id="hRotationTiltReset"[\s\S]*id="hRotationTiltDown"/);
  assert.match(html,/#hRotationSpeedReset, #hRotationTiltReset\s*\{\s*justify-self:start;\s*\}/);
  assert.match(html,/#hPreviewRotationControls #hRotationTiltRow\s*\{\s*grid-template-columns:auto 36px 28px minmax\(40px,1fr\) 28px auto;/);
  assert.match(html,/\$\('hRotationTiltReset'\)\.addEventListener\('click',\(\)=>setHRotationTilt\(H_ROTATION_TILT_DEFAULT_DEG\)\)/);
  assert.match(html,/\$\('hRotationTiltReset'\)\.disabled=!tiltReady/);
  assert.match(html,/\$\('hRotationTiltReset'\)\.classList\.toggle\('on',tilt===H_ROTATION_TILT_DEFAULT_DEG\)/);
  assert.match(html,/\$\('hRotationTiltReset'\)\.setAttribute\('aria-pressed',String\(tilt===H_ROTATION_TILT_DEFAULT_DEG\)\)/);
  assert.match(html,/data-state-keys="[^"]*hRotationTiltDeg/);
  assert.match(html,/\$\('hRotationTiltRow'\)\.hidden=axis==='gyro'/);
  assert.match(html,/const state=\{\.\.\.generatorState\}/);
  assert.match(html,/hPreviewOptions\(state,\{elapsedMs:elapsed\+timestampMs,palette\}\)/);
  assert.match(html,/grid-template-columns:36px 28px minmax\(50px,1fr\) 28px auto;gap:5px/);
});
