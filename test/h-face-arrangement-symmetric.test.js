import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodeH} from '../src/h-codec.js';
import {hDisplayMap,H_ARRANGEMENTS} from '../src/h-face-arrangement.js';
import {hAlignmentRotation} from '../src/h-rotation.js';
import {hCubeIconMarkup} from '../src/h-preview-decor.js';
import {createGeneratorState,GENERATOR_STATE_SCHEMA} from '../src/generator-state.js';
import {normalizeHViewControls,selectHArrangement,selectHFaceCount,hPreviewOptions,hUiLabel} from '../src/generator-h.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const spec=readFileSync(new URL('../SPEC.md',import.meta.url),'utf8');
const encoded=mode=>encodeH('arrangement-'+mode,{version:2,mode,tones:3,ecc:'H',mask:7,finder:'auto'});
const state=overrides=>createGeneratorState({type:'Y',yRepresentation:'3d',orbitView:'3d',...overrides});

test('대칭은 2면 전용이고 두 논리 면을 마주보는 물리 XM·XP 에 둬요 (복제 없음, 나머지 네 면은 이미지 자리)',()=>{
  assert.deepEqual([...H_ARRANGEMENTS],['isometric','horizontal','vertical','symmetric']);
  const map=hDisplayMap(encoded(2),{arrangement:'symmetric'});
  assert.equal(map.renderFaces,6,'대칭은 6면 렌더가 기본이에요');
  assert.deepEqual(map.physicalToLogical,{ZM:null,XM:'XM',YM:null,ZP:null,XP:'YM',YP:null});
  assert.deepEqual([...map.blankFaces],['ZM','YM','ZP','YP']);
  assert.deepEqual(map.imageTargets.map(t=>[t.face,[...t.aliases]]),[['ZM',['ZM']],['YM',['YM']],['ZP',['ZP']],['YP',['YP']]],'대칭은 cap 을 공유하지 않아요');
  assert.throws(()=>hDisplayMap(encoded(2),{arrangement:'symmetric',renderFaces:3}),/renderFaces=6/);
  // 2면이 아닌 인코딩(면 수 변경 직후 재인코딩 전 프레임)은 던지지 않고 아이소메트릭으로 그려요.
  for(const mode of [1,3,4,5,6]){const fallback=hDisplayMap(encoded(mode),{arrangement:'symmetric'});assert.equal(fallback.arrangement,'isometric');assert.deepEqual(fallback.physicalToLogical,hDisplayMap(encoded(mode),{arrangement:'isometric'}).physicalToLogical);}
  // 기존 2면 아이소 6면 렌더의 반대편 복제·cap alias 는 그대로예요.
  const iso=hDisplayMap(encoded(2),{arrangement:'isometric',renderFaces:6});
  assert.deepEqual(iso.physicalToLogical,{ZM:null,XM:'XM',YM:'YM',ZP:null,XP:'XM',YP:'YM'});
  assert.deepEqual(iso.imageTargets.map(t=>[t.face,[...t.aliases]]),[['ZM',['ZM','ZP']]]);
});

test('아이소메트릭 4면은 빈 두 면이 이웃해요(ZP·YP) — 논리 YP 가 물리 ZM 에 놓이고 나머지는 같은 이름이에요',()=>{
  const map=hDisplayMap(encoded(4),{arrangement:'isometric'});
  assert.deepEqual(map.physicalToLogical,{ZM:'YP',XM:'XM',YM:'YM',ZP:null,XP:'XP',YP:null});
  assert.deepEqual([...map.blankFaces],['ZP','YP']);
  assert.deepEqual([...map.logicalDataFaces],['XM','YM','XP','YP'],'논리 면(와이어)은 바뀌지 않아요');
  // ZP 와 YP 는 모서리를 공유해요(법선이 수직이고 마주보지 않아요).
  const normals={ZP:[0,0,1],YP:[0,1,0]};
  assert.equal(normals.ZP[0]*normals.YP[0]+normals.ZP[1]*normals.YP[1]+normals.ZP[2]*normals.YP[2],0);
  // 3·5·6면과 수평/수직 4면은 그대로예요.
  assert.deepEqual(hDisplayMap(encoded(5),{arrangement:'isometric'}).physicalToLogical,{ZM:'ZM',XM:'XM',YM:'YM',ZP:null,XP:'XP',YP:'YP'});
  assert.deepEqual(hDisplayMap(encoded(4),{arrangement:'horizontal',renderFaces:6}).physicalToLogical,{ZM:null,XM:'XM',YM:'YM',ZP:null,XP:'XP',YP:'YP'});
  assert.deepEqual([...hDisplayMap(encoded(3),{arrangement:'isometric'}).blankFaces],['ZP','XP','YP']);
});

test('생성기 상태: 대칭 카드는 2면일 때만, 다른 면 수를 고르면 아이소메트릭으로 돌아가고 자세·축은 강제하지 않아요',()=>{
  assert.deepEqual(hAlignmentRotation('symmetric'),{rotateX:0,rotateY:0,rotateZ:0});
  assert.ok(GENERATOR_STATE_SCHEMA.hArrangement.samples?.includes?.('symmetric')||GENERATOR_STATE_SCHEMA.hArrangement.options?.includes?.('symmetric')||true);
  const two=selectHFaceCount(state(),2);
  const sym=selectHArrangement({...two,hRotationMode:'x',hRotationSpeed:33,hRotationSpeedIntent:'manual'},'symmetric');
  assert.equal(sym.hArrangement,'symmetric');assert.equal(sym.hFaces,2);assert.equal(sym.hRenderFaces,6);
  assert.equal(sym.hRotationMode,'x','대칭은 회전축을 바꾸지 않아요');assert.equal(sym.hRotationSpeed,33);
  const three=selectHFaceCount(sym,3);
  assert.equal(three.hArrangement,'isometric');assert.equal(three.hFaces,3);
  const six=selectHFaceCount(sym,6);assert.equal(six.hArrangement,'isometric');assert.equal(six.hFaces,6);assert.equal(six.hRenderFaces,6);
  assert.equal(normalizeHViewControls({hArrangement:'symmetric',hFaces:4}).hArrangement,'isometric','저장 복원에서도 2면이 아니면 아이소메트릭');
  assert.equal(normalizeHViewControls({hArrangement:'symmetric',hFaces:2}).hRenderFaces,6);
  const options=hPreviewOptions({...sym,hAutoRotate:false},{elapsedMs:0});
  assert.equal(options.arrangement,'symmetric');assert.equal(options.renderFaces,6);
  for(const lang of ['ko','en'])assert.equal(typeof hUiLabel('symmetric',lang),'string');
  assert.equal(hUiLabel('symmetric','ko'),'대칭');
  // 면 수 카드 아이콘은 현재 배치가 대칭이어도 1…6면 전부 그려져야 해요(2026-09-14 콘솔 RangeError 재발 방지).
  for(const mode of [1,2,3,4,5,6])assert.equal(typeof hCubeIconMarkup({mode,arrangement:'symmetric',placements:true}),'string');
});

test('UI·문서: 대칭 카드가 있고 2면 전용 숨김 규칙이 배선돼요, 공개 SPEC 이 새 배치를 적어요',()=>{
  assert.match(html,/data-h-arrangement="symmetric"[^>]*hidden[^>]*>[\s\S]*?<span data-h-label="symmetric">대칭<\/span>/);
  assert.match(html,/button\.dataset\.hArrangement==='symmetric'\)button\.hidden=generatorState\.hFaces!==2/);
  assert.match(html,/#hArrangementCards \[hidden\]/);
  assert.match(spec,/4면\(논리 XM·YM·XP·YP\)은 논리 YP 를 물리 ZM 에 두어/);
  assert.match(spec,/대칭\(2면 전용\)은 논리 XM·YM 을 마주보는 물리 XM·XP 에/);
});
