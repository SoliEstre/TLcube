/** 후보 테스트: h-mode-codebook.js와 corner 확장 통합 뒤 root 원격 큐에서만 실행해요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeH, decodeH, hCapacity } from '../src/h-codec.js';
import { hModeFaces, hModeGroups, H_SCHEMA, H_SCHEMA_CORNER, H_SCHEMA_FACES, H_SCHEMA_FACES_CORNER } from '../src/h-profile.js';
import { hLayout } from '../src/h-layout.js';

const profile = encoded => ({version:encoded.version,n:encoded.n,mode:encoded.mode,tones:encoded.tones,ecc:encoded.ecc,mask:encoded.mask,finder:encoded.finder,routeId:encoded.routeId});

test('mode group 계약과 legacy schema는 고정되고 신규 CRC domain은 분리돼요', () => {
  assert.deepEqual(hModeGroups(2), [['XM','YM']]);
  assert.deepEqual(hModeGroups(3), [['ZM','XM','YM']]);
  assert.deepEqual(hModeGroups(4), [['XM','YM'],['XP','YP']]);
  assert.deepEqual(hModeGroups(5), [['ZM','XM','YM'],['XP','YP']]);
  assert.deepEqual(hModeGroups(6), [['ZM','XM','YM'],['ZP','XP','YP']]);
  assert.deepEqual(hModeFaces(5), ['ZM','XM','YM','XP','YP']);
  assert.ok(H_SCHEMA.startsWith('TL:YH:v2;') && H_SCHEMA_CORNER.startsWith('TL:YH:v2c;'));
  assert.ok(H_SCHEMA_FACES.startsWith('TL:YH:v2f;') && H_SCHEMA_FACES_CORNER.startsWith('TL:YH:v2fc;'));
});

test('신규 2/4/5면은 모든 tone/ECC에서 group packet 왕복과 전체 padding CRC를 검사해요', () => {
  for(const mode of [2,4,5]) for(const tones of [2,3]) for(const ecc of ['L','M','H']) for(const mask of [0,7]) {
    const cap=hCapacity(5,mode,{tones,ecc,mask,finder:'corners'});
    assert.equal(cap.groups.length,hModeGroups(mode).length);
    assert.equal(cap.maxPayloadBytes,cap.groups.reduce((n,g)=>n+g.chunkBytes,0));
    const input=Uint8Array.from({length:cap.maxPayloadBytes},(_,i)=>(i*71+mode*13+tones+mask)&255);
    const encoded=encodeH(input,{version:5,mode,tones,ecc,mask,finder:'corners'}),decoded=decodeH(encoded.faces,profile(encoded));
    assert.equal(decoded.ok,true,`${mode}/${tones}/${ecc}/${mask}`);assert.deepEqual(decoded.bytes,input);
    assert.throws(()=>encodeH(new Uint8Array(cap.maxPayloadBytes+1),{version:5,mode,tones,ecc,mask,finder:'corners'}),RangeError);
  }
});

test('2톤 pair radix4의 마지막 0..3 data cell은 unmasked zero가 아니면 거부돼요', () => {
  const encoded=encodeH('pair-padding',{version:5,mode:2,tones:2,ecc:'M',mask:7,finder:'corners'}),face=encoded.faces.XM;
  const cap=hCapacity(5,2,{tones:2,ecc:'M',mask:7,finder:'corners'});
  if(cap.groups[0].residualCells){const cell=hLayout(5,'corners').scan.at(-1),at=cell.i*encoded.n+cell.j;face[at]=1-face[at];assert.equal(decodeH(encoded.faces,profile(encoded)).ok,false);}
});

test('신규 frame은 H0..H8에서 가능한 packet만 수용하고 corners만 H5+를 강제해요', () => {
  for(const mode of [2,4,5]) for(let version=0;version<=8;version++) {
    try { const encoded=encodeH('v',{version,mode,tones:3,ecc:'M',mask:0,finder:'frame'});assert.equal(encoded.version,version); }
    catch(error) { assert.ok(error instanceof RangeError);assert.match(String(error?.message),/packet|용량|지원하지 않는 profile/); }
  }
  assert.throws(()=>encodeH('corner-low',{version:4,mode:2,mask:0,finder:'corners'}),RangeError);
  const encoded=encodeH('auto',{mode:4,tones:3,ecc:'H',mask:0,finder:'auto'});assert.ok(encoded.version>=0);
  const faces={...encoded.faces};delete faces.XP;assert.equal(decodeH(faces,profile(encoded)).ok,false);
});
