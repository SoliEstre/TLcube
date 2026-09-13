import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGeneratorState} from '../src/generator-state.js';
import {clampHRotationSpeed,hPointerDragDelta,hOrbitFromRotation,isHGenerator,normalizeHViewControls,selectHRepresentation,selectHFaceCount,H_RESOLUTION_VERSIONS,hPreviewOptions} from '../src/generator-h.js';
import {defineOrbitViewAccessors} from '../src/generator-orbit-view.js';
import {encodeH,decodeH} from '../src/h-codec.js';
import {buildHScene,buildHFaceSheet,H_ROTATION_PERIOD_MS} from '../src/h-render.js';
import {getPreset} from '../src/luminance.js';
import {rasterize} from '../src/raster.js';

test('기본Y2.5D와 H3D 전환은 기존Y프로파일을 보존한다',()=>{
  const base=createGeneratorState({type:'Y',versionY:2,locatorProfileY:'cell-surface-v0tr',tone:2});
  assert.equal(base.yRepresentation,'2.5d');assert.equal(base.hFaces,3);assert.equal(isHGenerator(base),false);
  const h=selectHRepresentation(base,'3d');assert.equal(isHGenerator(h),true);assert.equal(h.orbitView,'3d');
  const back=selectHRepresentation(selectHFaceCount(h,6),'2.5d');
  assert.equal(back.orbitView,'2.5d');assert.equal(back.hAutoRotate,false);assert.equal(back.hFaces,3);
  for(const key of ['versionY','locatorProfileY','tone'])assert.equal(back[key],base[key]);
  assert.equal(base.yRepresentation,'2.5d','전이함수는 입력상태를 변경하지 않는다');
  assert.equal(isHGenerator({...h,type:'A'}),false);
});
test('6면선택은 실제 on접근자를 켜고 기존 자동회전을 유지해 전6면을 보인다',()=>{
  const state=selectHFaceCount(createGeneratorState({type:'Y',hAutoRotate:true}),6),viewer={};
  defineOrbitViewAccessors(viewer,state);assert.equal(viewer.on,true);assert.equal(state.hAutoRotate,true);
  state.hRotationMode='gyro';
  const encoded=encodeH('x',{version:0,mode:6,mask:0});const seen=new Set();
  for(let elapsedMs=0;elapsedMs<H_ROTATION_PERIOD_MS;elapsedMs+=500){
    const scene=buildHScene(encoded,hPreviewOptions(state,{elapsedMs}));
    assert.ok(scene.hModel.visible.length<=3);for(const face of scene.hModel.visible)seen.add(face);
  }
  assert.deepEqual([...seen].sort(),['XM','XP','YM','YP','ZM','ZP']);
  const three=selectHFaceCount(state,3);assert.equal(three.hAutoRotate,true);
  assert.notDeepEqual(hPreviewOptions(three,{elapsedMs:17000}),hPreviewOptions(three));
});

test('기본 화면 X축과 Y축은 한 바퀴 안에 전6면을 실제 렌더하고 동결 자세를 보존한다',()=>{
  const encoded=encodeH('x',{version:0,mode:6,mask:0});
  for(const axis of ['x','y']){
    const state=selectHFaceCount(createGeneratorState({type:'Y',hAutoRotate:true}),6);state.hRotationMode=axis;
    const seen=new Set();
    for(let elapsedMs=0;elapsedMs<24000;elapsedMs+=250){
      for(const f of buildHScene(encoded,hPreviewOptions(state,{elapsedMs})).hModel.visible)seen.add(f);
    }
    assert.equal(seen.size,6,axis);
    const spin=hPreviewOptions(state,{elapsedMs:8200}),accessors={};defineOrbitViewAccessors(accessors,state);
    Object.assign(accessors,hOrbitFromRotation(spin));state.hAutoRotate=false;
    const frozen=hPreviewOptions(state),a=buildHScene(encoded,spin),b=buildHScene(encoded,frozen);
    assert.equal(a.shapes.length,b.shapes.length);
    for(let i=0;i<a.shapes.length;i++)for(let j=0;j<4;j++){
      assert.ok(Math.abs(a.shapes[i].points[j].x-b.shapes[i].points[j].x)<1e-9);
      assert.ok(Math.abs(a.shapes[i].points[j].y-b.shapes[i].points[j].y)<1e-9);
    }
  }
});
test('회전 자세의 도/라디안 소비 및 꺼진뷰 자동회전 중단',()=>{
  const state={...selectHFaceCount(createGeneratorState({type:'Y',hAutoRotate:true}),6),orbitYaw:30,orbitPitch:-20,orbitRoll:10,orbitPersp:25};
  const options=hPreviewOptions(state),orbit=hOrbitFromRotation(options);
  assert.ok(Math.abs(orbit.yaw-Math.PI/6)<1e-12);assert.ok(Math.abs(orbit.pitch+20*Math.PI/180)<1e-12);
  assert.ok(Math.abs(orbit.roll-10*Math.PI/180)<1e-12);assert.equal(options.perspective,.25);
  const off={...state,orbitView:'2.5d'};
  assert.deepEqual(hPreviewOptions(off,{elapsedMs:9999}),hPreviewOptions(off));
});
test('H 회전 상태는 축 기본값과 초당 도 속도 범위를 보존한다',()=>{
  assert.deepEqual(normalizeHViewControls({hRotationMode:'bad',hRotationSpeed:Infinity}),{hRotationMode:'y',hRotationSpeed:75,hRotationSpeedIntent:'auto',hRotationTiltDeg:17.5,hFaces:3,hRenderFaces:3,hArrangement:'isometric',hRotationDirectionX:1,hRotationDirectionY:1});
  assert.equal(clampHRotationSpeed(-3),1);assert.equal(clampHRotationSpeed(90.4),90);
  const state=selectHFaceCount(createGeneratorState({type:'Y'}),6);
  assert.equal(state.hRotationMode,'y');assert.equal(state.hRotationSpeed,75);
  const explicit={...state,hRotationSpeed:75},missing={...state};delete missing.hRotationSpeed;
  assert.deepEqual(hPreviewOptions(missing,{elapsedMs:1200}),hPreviewOptions(explicit,{elapsedMs:1200}));
});

test('한국어 속도 화살표는 1도 고정값이 아닌 1도씩 증감을 안내한다',()=>{
  const source=readFileSync(new URL('../src/generator-h.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  for(const direction of ['낮추기','높이기']){
    const label=`회전 속도를 초당 1도씩 ${direction}`;
    assert.ok(source.includes(label));assert.ok(html.includes(label));
  }
  assert.ok(!source.includes('회전 속도를 초당 1도로'));
});
test('Y 포인터 드래그는 기존 부호를 보존한다',()=>{
  assert.deepEqual(hPointerDragDelta({dx:10,dy:-5,rollDelta:.4}),{yaw:-.1,pitch:.05,roll:-.4});
});
test('H 해상도/톤/면/ECC/마스크가 실제본문과 모든면시트에 도달한다',()=>{
  const palette={levels:getPreset('mono').levels,background:{r:255,g:255,b:255}};
  for(const version of Object.values(H_RESOLUTION_VERSIONS))for(const mode of[3,6])for(const tones of[2,3]){
    const e=encodeH('x',{version,mode,tones,ecc:'H',mask:7});
    assert.equal(e.mode,mode);assert.equal(e.tones,tones);assert.equal(e.mask,7);assert.equal(e.ecc,'H');
    if(version!=='auto')assert.equal(e.version,version);
    const sheet=buildHFaceSheet(e,{palette});assert.equal(new Set(sheet.shapes.map(s=>s.face)).size,mode);
    const decoded=decodeH(e.faces,{version:e.version,mode,tones,ecc:'H',mask:7,routeId:e.routeId});assert.equal(decoded.text,'x');
    const raster=rasterize(sheet,{pixelsPerUnit:2,supersample:1});assert.equal(raster.pixels.length,raster.width*raster.height*4);
  }
});
test('UI 실소비 배선은 H분기와 잘못된 Y옵션을 분리한다',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/hPreviewOptions\(generatorState,/);
  assert.match(source,/if\(cfg\.type==='H'\)/);
  assert.match(source,/selectHFaceCount\(generatorState,Number\(button.dataset.hFaces\)\)/);
  assert.match(source,/!hGeneratorActive\(\) && ev.key >= '0'/);
  assert.match(source,/\['qrLinkSection','qrUrl','qrUrlLabel'\]\)\$\(id\)\.hidden=false/);
  assert.match(source,/\['faceGainRow','quietSection','rotationGuidance'\]/);
  assert.match(source,/current.type==='H'[\s\S]*?buildHScene\(current.encoded/);
  assert.ok(!source.includes('id="hExportLayout"'));
});
