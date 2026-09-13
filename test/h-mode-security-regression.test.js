/** public codec 통합 뒤 root 원격 큐에서만 실행하는 H mode 수용 경계 회귀예요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeH, decodeH, hCapacity } from '../src/h-codec.js';
import { hModeFaces, hModeGroups } from '../src/h-profile.js';
import { hLayout } from '../src/h-layout.js';
const profile=e=>({version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,finder:e.finder,routeId:e.routeId});

test('2/4/5 group과 wire face-set 이 명세와 같고 cross-mode/unknown/route를 거부해요',()=>{
  for(const mode of [2,4,5]){
    const e=encodeH('security',{version:5,mode,tones:3,ecc:'M',mask:7,finder:'frame'}),p=profile(e);
    assert.deepEqual(Object.keys(e.faces).sort(),hModeFaces(mode).slice().sort());
    assert.equal(decodeH(e.faces,p).ok,true);
    assert.equal(decodeH(e.faces,{...p,mode:mode===2?4:2}).ok,false);
    const unknown={...e.faces,ZZ:e.faces[hModeFaces(mode)[0]]};assert.equal(decodeH(unknown,p).ok,false);
    assert.equal(decodeH(e.faces,{...p,routeId:(p.routeId+1)&255}).ok,false);
  }
});
test('pair tail, missing face, mixed group header 및 CRC 변경은 DONE이 아니에요',()=>{
  const e=encodeH('tail',{version:5,mode:2,tones:2,ecc:'M',mask:7,finder:'frame'}),p=profile(e),cap=hCapacity(5,2,{tones:2,ecc:'M',mask:7,finder:'frame'}),faces=structuredClone(e.faces);
  const ids=hModeFaces(2),scan=hLayout(5).scan;
  if(cap.groups[0].residualCells){const cell=scan.at(-1),at=cell.i*e.n+cell.j;faces[ids[0]][at]^=1;assert.equal(decodeH(faces,p).ok,false);}
  const missing={...e.faces};delete missing[ids[0]];assert.equal(decodeH(missing,p).ok,false);
  const first=encodeH('first',{version:5,mode:4,tones:2,ecc:'M',mask:7,finder:'frame'}),other=encodeH('other',{version:5,mode:4,tones:2,ecc:'M',mask:7,finder:'frame'}),mixed=structuredClone(other.faces);
  mixed.XM=first.faces.XM.slice();mixed.YM=first.faces.YM.slice();assert.equal(decodeH(mixed,profile(other)).ok,false);
});
test('ECC 범위의 한 cell 오류는 거부가 아니라 원문 복원 또는 명시 실패이고, 조용한 오문은 없어요',()=>{
  const e=encodeH('ecc repair',{version:7,mode:2,tones:3,ecc:'H',mask:0,finder:'frame'}),p=profile(e),cell=hLayout(7).scan[0],at=cell.i*e.n+cell.j,damaged=structuredClone(e.faces);
  damaged.XM[at]=(damaged.XM[at]+1)%3;const result=decodeH(damaged,p);
  assert.equal(result.ok,true);assert.deepEqual(result.bytes,new TextEncoder().encode('ecc repair'));assert.ok(result.corrected>0);
});
test('auto는 H0..H8에서 실제 수용가능 packet만 고르고 corners 저버전은 거부해요',()=>{
  for(const mode of [2,4,5]){
    const auto=encodeH('a',{mode,tones:3,ecc:'H',mask:0,finder:'auto'});assert.ok(auto.version>=0&&auto.version<=8);
    for(let v=0;v<5;v++)assert.throws(()=>encodeH('a',{version:v,mode,mask:0,finder:'corners'}),RangeError);
  }
});
