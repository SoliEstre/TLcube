import test from 'node:test';
import assert from 'node:assert/strict';
import {applyHRotationFill,resolveHLighting,hLightingGround} from '../src/h-lighting.js';
import {encodeH} from '../src/h-codec.js';
import {buildHScene,hAutoRotation} from '../src/h-render.js';
test('H lighting omitted is identity sentinel; existing profile names retain safe reset ordering',()=>{
  assert.equal(resolveHLighting(undefined),null);
  for(const profile of ['screen','soft','original']){const a=resolveHLighting({profile,shading:'off'});assert.ok(a.faceGains.ZM>=a.faceGains.XM&&a.faceGains.XM>=a.faceGains.YM);assert.ok(Math.min(...Object.values(a.faceGains))>=.52);}
  assert.deepEqual(Object.values(resolveHLighting({profile:'print',shading:'off'}).faceGains),[1,1,1,1,1,1]);
});
test('lighting follows pose and only on emits transparent viewport ground records',()=>{
  const a=resolveHLighting({profile:'screen',shading:'on'},{rotateY:0}),b=resolveHLighting({profile:'screen',shading:'on'},{rotateY:Math.PI});
  assert.notEqual(a.faceGains.ZM,b.faceGains.ZM);assert.equal(resolveHLighting({profile:'screen',shading:'off'}).ground.length,0);
  const bands=hLightingGround({width:20,height:20},a);assert.equal(bands.length,2);for(const band of bands)assert.ok(band.points.every(p=>p.x>=0&&p.x<=20&&p.y>=0&&p.y<=20));
});
test('print keeps flat face gains but still emits its selected external ground effects',()=>{
  const light=resolveHLighting({profile:'print',shading:'on'},{rotateX:.4,rotateY:.2});
  assert.deepEqual(Object.values(light.faceGains),[1,1,1,1,1,1]);
  assert.equal(light.ground.length,2);
});
test('rotationFill is opt-in, pose-continuous, and bounded to dark-face midtones',()=>{
  const pose={rotateX:.37,rotateY:.81,rotateZ:.19};
  const legacy=resolveHLighting({profile:'screen',shading:'off'},pose);
  const off=resolveHLighting({profile:'screen',shading:'off',rotationFill:false},pose);
  assert.deepEqual(off,legacy,'false는 기존 조명 결과·객체 모양을 바꾸지 않는다');
  const on=resolveHLighting({profile:'screen',shading:'off',rotationFill:true},pose);
  assert.ok(on.faceFills,'명시 opt-in만 per-face reflection fill을 만든다');
  for(const value of Object.values(on.faceFills))assert.ok(value>=0&&value<=.56,'fill은 단조 lift의 안전 상한 안이다');
  assert.ok(on.faceFills.ZM>0,'밝은 조명면에도 회전 간접광의 작은 중간톤 lift가 있다');
  const later=resolveHLighting({profile:'screen',shading:'off',rotationFill:true},{...pose,rotateY:pose.rotateY+.01});
  assert.ok(Math.abs(on.faceFills.XM-later.faceFills.XM)<.03,'작은 pose 변화가 반사광 점프를 만들지 않는다');
  assert.throws(()=>resolveHLighting({rotationFill:'true'}),/rotationFill/);
});
test('rotation fill preserves black/white endpoints and the data-tone order without clipping',()=>{
  assert.deepEqual(applyHRotationFill({r:0,g:0,b:0},.56),{r:0,g:0,b:0});
  assert.deepEqual(applyHRotationFill({r:255,g:255,b:255},.56),{r:255,g:255,b:255});
  const tones=[64,144,224].map(v=>applyHRotationFill({r:v,g:v,b:v},.56).r);
  assert.ok(tones[0]>64&&tones[0]<tones[1]&&tones[1]<tones[2]&&tones[2]<255,'중간톤만 들어 올리되 순서·headroom을 보존한다');
  assert.deepEqual(applyHRotationFill({r:64,g:144,b:224},0),{r:64,g:144,b:224});
  const gain=.62,strength=.56,color={r:61,g:113,b:220};
  const expected=Object.fromEntries(Object.entries(color).map(([key,value])=>{const c=value/255;return[key,Math.round((c+strength*c*(1-c))*gain*255)];}));
  assert.deepEqual(applyHRotationFill(color,strength,gain),expected,'GPU와 같이 마지막 한 번만 양자화한다');
});
test('six-face rotation samples every face, returns to its first fill, and does not brighten blank surfaces',()=>{
  const encoded=encodeH('rotation-fill',{version:7,mode:6,tones:3,ecc:'M',mask:7,finder:'corners'});
  const seen=new Set(),peaks=Object.fromEntries(['XM','XP','YM','YP','ZM','ZP'].map(face=>[face,0]));
  for(const elapsedMs of [0,4000,8000,12000,16000,20000,24000,28000,32000,36000,40000,44000]){
    const pose=hAutoRotation(elapsedMs,{axis:'y',speed:15});
    const light=resolveHLighting({profile:'screen',shading:'off',rotationFill:true},pose);
    for(const [face,fill] of Object.entries(light.faceFills)){assert.ok(fill>=0&&fill<=.56);if(fill>0)seen.add(face);peaks[face]=Math.max(peaks[face],fill);}
  }
  assert.deepEqual([...seen].sort(),['XM','XP','YM','YP','ZM','ZP'],'모든 물리 면이 회전 lobe를 한 번은 지난다');
  assert.ok(Object.values(peaks).every(fill=>fill>.18),'각 면은 회전 중 식별 가능한 간접광 peak를 한 번은 가진다');
  const start=resolveHLighting({profile:'screen',shading:'off',rotationFill:true},hAutoRotation(0,{axis:'y',speed:15}));
  const period=resolveHLighting({profile:'screen',shading:'off',rotationFill:true},hAutoRotation(24000,{axis:'y',speed:15}));
  assert.deepEqual(period.faceFills,start.faceFills,'한 회전 주기 끝은 반사광 시작값으로 닫힌다');

  const three=encodeH('blank',{version:3,mode:3,tones:3,ecc:'M',mask:7,finder:'auto'});
  const pose={rotateX:.8,rotateY:1.1,rotateZ:.2};
  const plain=buildHScene(three,{...pose,lighting:{profile:'screen',shading:'off'}});
  const filled=buildHScene(three,{...pose,lighting:{profile:'screen',shading:'off',rotationFill:true}});
  const blank=scene=>scene.shapes.filter(shape=>shape.kind==='polygon'&&!shape.face).map(shape=>shape.color);
  assert.ok(blank(plain).length>0,'표시 면 중 비데이터 면 fixture가 필요하다');
  assert.deepEqual(blank(filled),blank(plain),'빈면 base·이미지 경로에는 rotation fill을 적용하지 않는다');
  const code=scene=>scene.shapes.filter(shape=>shape.face).map(shape=>shape.color);
  assert.notDeepEqual(code(filled),code(plain),'데이터 면 중간톤에는 rotation fill이 실제 적용된다');
});
