import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHProfile, resolveHFinder } from '../src/h-profile.js';
import { hLayout } from '../src/h-layout.js';
import { hCornerLayout } from '../src/h-corner-layout.js';
import { decodeH, encodeH, hCapacity } from '../src/h-codec.js';
import { H_RESOLUTION_VERSIONS } from '../src/generator-h.js';
function profileOf(encoded){const {version,mode,tones,ecc,mask,routeId,finder}=encoded;return {version,mode,tones,ecc,mask,routeId,finder};}

test('H8은 n45 frame/corners layout과 auto tier를 사용해요', () => {
  assert.deepEqual(normalizeHProfile({version:8,mode:3,tones:3,ecc:'H',mask:7}),
    {version:8,n:45,mode:3,tones:3,ecc:'H',mask:7,finder:'frame'});
  assert.equal(resolveHFinder(8,1,'auto'),'corners');
  assert.equal(hLayout(8).scan.length,1512);
  assert.equal(hCornerLayout(8).scan.length,1425);
  assert.equal(H_RESOLUTION_VERSIONS.ultra,8);
  assert.throws(()=>normalizeHProfile({version:9,mode:3,tones:3,ecc:'H',mask:7}),/H0\.\.H8/);
});

test('H8은 frame/corners에서 기존 packet 경로로 roundtrip해요', () => {
  for(const finder of ['frame','corners']) {
    const encoded=encodeH('H8 roundtrip', {version:8,mode:3,tones:3,ecc:'H',mask:7,finder});
    assert.equal(encoded.n,45);
    assert.equal(encoded.finder,finder);
    assert.ok(hCapacity(8,3,{tones:3,ecc:'H',mask:7,finder}).maxPayloadBytes
      > hCapacity(7,3,{tones:3,ecc:'H',mask:7,finder:finder==='corners'?'corners':'frame'}).maxPayloadBytes);
    const decoded=decodeH(encoded.faces,profileOf(encoded));
    assert.ok(decoded.ok,JSON.stringify(decoded));
    assert.equal(decoded.text,'H8 roundtrip');
  }
});

test('auto version은 H7에 안 들어가는 H8-only payload까지 H8을 탐색해요', () => {
  const cap7=hCapacity(7,3,{tones:3,ecc:'H',mask:0,finder:'frame'}).maxPayloadBytes;
  const cap8=hCapacity(8,3,{tones:3,ecc:'H',mask:0,finder:'frame'}).maxPayloadBytes;
  assert.ok(cap8>cap7);
  const bytes=new Uint8Array(cap7+1);
  const encoded=encodeH(bytes,{version:'auto',mode:3,tones:3,ecc:'H',mask:7,finder:'frame'});
  assert.equal(encoded.version,8);
});
