import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {hDisplayMap} from '../src/h-face-arrangement.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {physicalHCube,faceHandedness} from '../src/cube-physical.js';
import {buildPrintParts,hollowPlan,standCornerFaces,printBlankHex} from '../src/print-mesh.js';
import {surfaceComponents} from './helpers/print-mesh-probe.mjs';

// «6면 (반복)» 은 미리보기만이 아니라 전개도·3D 인쇄 산출물도 바꿔요(설계 §4.2). 3F 에서 그 결과를 잠가요.
const encoded=encodeH(Uint8Array.of(7),{version:1,mode:3,tones:3,ecc:'M',mask:7,finder:'frame'});
const physOf=options=>physicalHCube(buildHCubeModel(encoded,options));

test('3F + 6면(반복) 아이소메트릭: 물리 데이터 면 6 · 빈 면 0 · 논리 면 3, 여섯 면 모두 거울 아님',()=>{
  const phys=physOf({renderFaces:6});
  assert.deepEqual([...phys.dataFaces],['ZM','XM','YM','ZP','XP','YP']);
  assert.deepEqual([...phys.blankFaces],[]);
  assert.deepEqual([...phys.logicalDataFaces],['ZM','XM','YM']);
  assert.deepEqual([...faceHandedness(phys).values()],[1,1,1,1,1,1]);
  assert.equal(printBlankHex(phys),null);
  // 사본은 원본과 같은 색 격자(같은 (i,j))예요.
  for(const [m,p] of [['ZM','ZP'],['XM','XP'],['YM','YP']])assert.deepEqual([...phys.faces[p].hex],[...phys.faces[m].hex],`${p}←${m}`);
});

test('3F + 6면(반복) 아이소메트릭: 숨구멍 둘 빈 면이 없어 속 비우기는 TLP_NO_VENT_FACE 로 솔리드 — 6F 와 같은 대체',()=>{
  const phys=physOf({renderFaces:6}),{parts,report}=buildPrintParts(phys);
  assert.equal(report.bedFace,'ZP');
  assert.equal(report.hollow.requested,true);assert.equal(report.hollow.enabled,false);assert.equal(report.hollow.reason,'TLP_NO_VENT_FACE');
  assert.equal(hollowPlan(phys).reason,'TLP_NO_VENT_FACE');
  assert.equal(parts.at(-1).mesh.indices.length/3,12,'솔리드 코어 상자');
  assert.equal(surfaceComponents(parts.at(-1).mesh),1);
  assert.deepEqual([...standCornerFaces(phys).coveredDataFaces],['ZP','XP','YP'],'받침대 포켓은 사본 세 면의 꼭짓점만 가려요');
});

test('3F + 6면(반복) 수평/수직: YP 만 사본이 돼 빈 면은 cap 둘(ZM·ZP), 속 비우기는 그대로 켜져요',()=>{
  for(const arrangement of ['horizontal','vertical']){
    const phys=physOf({arrangement,renderFaces:6}),{report}=buildPrintParts(phys);
    assert.deepEqual([...phys.dataFaces],['XM','YM','XP','YP'],arrangement);
    assert.deepEqual([...phys.blankFaces],[...hDisplayMap(encoded,{arrangement,renderFaces:6}).blankFaces],arrangement);
    assert.equal(report.hollow.enabled,true,arrangement);assert.ok(['ZP','ZM'].includes(report.bedFace),arrangement);
  }
});

test('3F + 3면 렌더 산출물은 그대로예요(데이터 면 3 · 빈 면 3 · 속 비우기 켬)',()=>{
  const phys=physOf({renderFaces:3}),{report}=buildPrintParts(phys);
  assert.deepEqual([...phys.dataFaces],['ZM','XM','YM']);assert.deepEqual([...phys.blankFaces],['ZP','XP','YP']);
  assert.equal(report.hollow.enabled,true);
});
