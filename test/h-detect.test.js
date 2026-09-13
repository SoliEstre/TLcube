import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeH, decodeH } from '../src/h-codec.js';
import { detectH } from '../src/h-detect.js';
import { createHCollector } from '../src/h-collector.js';
import { H_FACE_IDS } from '../src/h-profile.js';
import { hLayout } from '../src/h-layout.js';
import { buildHScene, buildHFaceSheet, hAutoRotation } from '../src/h-render.js';
import { rasterize } from '../src/raster.js';
import { relativeLuminance8 } from '../src/luminance.js';

function fieldFromRaster(raster) {
  const { width, height, pixels } = raster;
  const data = new Float32Array(width * height);
  for (let i = 0, o = 0; i < data.length; i += 1, o += 4) {
    data[i] = relativeLuminance8(pixels[o], pixels[o + 1], pixels[o + 2]);
  }
  return { width, height, data };
}

function rasterField(scene, ppu) {
  return fieldFromRaster(rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }));
}

function decodeDetected(detected, encoded) {
  const faces = {};
  for (const row of detected.faces) faces[row.face] = row.levels;
  return decodeH(faces, {
    version: encoded.version,
    mode: encoded.mode,
    tones: encoded.tones,
    ecc: encoded.ecc,
    mask: encoded.mask,
    routeId: encoded.routeId,
  });
}

function assertSheet(text, options, ppu) {
  const encoded = encodeH(text, options);
  const field = rasterField(buildHFaceSheet(encoded), ppu);
  const detected = detectH(field);
  const ids = new Set(detected.faces.map((row) => row.face));
  const expected = new Set(H_FACE_IDS.slice(0, encoded.mode));
  assert.deepEqual(ids, expected);
  for (const row of detected.faces) {
    assert.equal(row.ok, true);
    assert.equal(row.mirror, false);
    assert.equal(row.hamming, 0);
    assert.equal(row.version, encoded.version);
    assert.equal(row.mode, encoded.mode);
    assert.equal(row.n, encoded.n);
  }
  const decoded = decodeDetected(detected, encoded);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.text, text);
  return detected;
}

test('H0 1바이트 면시트 3F가 복호돼요', () => {
  assertSheet('H', { version: 0, mode: 3, tones: 3, ecc: 'M', mask: 0 }, 12);
});

test('대형 고밀도 H의 압축 명암을 정규화하고 full CRC로만 완료한다',()=>{
  for(const version of [5,7]){
    const encoded=encodeH('contrast',{version,mode:3,ecc:'M',mask:0});
    const scene=buildHScene(encoded,{perspective:.15});
    const field=rasterField(scene,1000/scene.width);
    const compressed={...field,data:Float32Array.from(field.data,v=>.085+.665*v)};
    assert.equal(detectH(compressed,{normalizeContrast:false}).faces.length,0);
    const detected=detectH(compressed);
    assert.equal(detected.stats.photometric.normalized,true);
    const collector=createHCollector();
    const result=collector.addFrame({observations:detected.faces,trackId:'contrast',frameId:version,timestamp:1});
    assert.equal(result.state,'DONE');assert.equal(result.result.text,'contrast');
  }
});

test('명암 정규화는 균일장과 저대비 잡음을 본문으로 승격하지 않는다',()=>{
  const width=200,height=200;
  for(const data of [new Float32Array(width*height).fill(.3),Float32Array.from({length:width*height},(_,i)=>.3+(i%13)*.001)]){
    const detected=detectH({width,height,data});assert.equal(detected.faces.length,0);
  }
});

test('H0 6F 2톤 L mask3 면시트가 복호돼요', () => {
  assertSheet('H', { version: 0, mode: 6, tones: 2, ecc: 'L', mask: 3 }, 12);
});

test('H2 3F 3톤 H mask7 면시트가 복호돼요', () => {
  assertSheet('Hi', { version: 2, mode: 3, tones: 3, ecc: 'H', mask: 7 }, 12);
});

test('H4 6F 3톤 M mask0 면시트가 복호돼요', () => {
  assertSheet('Hi', { version: 4, mode: 6, tones: 3, ecc: 'M', mask: 0 }, 11);
});

test('H7 3F 2톤 M mask3 면시트가 복호돼요', () => {
  const detected=assertSheet('H', { version: 7, mode: 3, tones: 2, ecc: 'M', mask: 3 }, 10);
  assert.deepEqual(new Set(detected.faces.map(row=>row.version)),new Set([7]));
});

test('정적 큐브와 반대 3면을 회전해서 검출해요', () => {
  const encoded = encodeH('H', { version: 0, mode: 6, tones: 3, ecc: 'M', mask: 0 });
  const staticField = rasterField(buildHScene(encoded, { rotateX: 0, rotateY: 0, perspective: 0.18 }), 13);
  const staticHit = detectH(staticField);
  assert.deepEqual(new Set(staticHit.faces.map(row=>row.face)),new Set(['ZM','XM','YM']));
  const opposite = rasterField(buildHScene(encoded, { ...hAutoRotation(12000), perspective: 0.18 }), 13);
  const oppHit = detectH(opposite);
  assert.deepEqual(new Set(oppHit.faces.map(row=>row.face)),new Set(['ZP','XP','YP']));
  const ids = new Set([...staticHit.faces, ...oppHit.faces].map((row) => row.face));
  assert.deepEqual(ids,new Set(H_FACE_IDS));
  const decoded=decodeDetected({faces:[...staticHit.faces,...oppHit.faces]},encoded);
  assert.equal(decoded.ok,true);assert.equal(decoded.text,'H');
});

test('H6 회전 프레임 합집합이 6면 식별자를 모아요', () => {
  const encoded = encodeH('H', { version: 2, mode: 6, tones: 3, ecc: 'M', mask: 0 });
  const seen = new Set();
  const collector=createHCollector();
  for (let t = 0; t < 48000; t += 3000) {
    const rot = hAutoRotation(t);
    const field = rasterField(buildHScene(encoded, { ...rot, perspective: 0.18 }), 12);
    const hit = detectH(field);
    for (const row of hit.faces) seen.add(row.face);
    collector.addFrame({observations:hit.faces,timestamp:t,frameId:t});
  }
  assert.deepEqual(seen, new Set(H_FACE_IDS));
  const snapshot=collector.snapshot();
  assert.equal(snapshot.state,'DONE');assert.equal(snapshot.result.text,'H');
});

test('거울 영상과 전백·전흑·잡음은 거절해요', () => {
  const encoded = encodeH('H', { version: 0, mode: 3, mask: 0 });
  const field = rasterField(buildHFaceSheet(encoded), 12);
  const mirror = { width: field.width, height: field.height, data: new Float32Array(field.data.length) };
  for (let y = 0; y < field.height; y += 1) {
    for (let x = 0; x < field.width; x += 1) {
      mirror.data[y * field.width + x] = field.data[y * field.width + (field.width - 1 - x)];
    }
  }
  const mirrored = detectH(mirror);
  assert.equal(mirrored.faces.length, 0);
  assert.ok(mirrored.rejected.some((row) => row.reason === 'reflection' || row.reason === 'tag-match' || row.reason === 'validate-face' || row.reason === 'format-byte'));

  const white = { width: 64, height: 64, data: new Float32Array(64 * 64).fill(1) };
  const black = { width: 64, height: 64, data: new Float32Array(64 * 64).fill(0) };
  const noise = { width: 64, height: 64, data: Float32Array.from({ length: 64 * 64 }, (_, i) => ((i * 17) % 97) / 97) };
  assert.equal(detectH(white).ok, false);
  assert.equal(detectH(black).faces.length, 0);
  assert.equal(detectH(noise).ok, false);
  assert.equal(detectH(null).ok, false);
});

test('포맷 예약 손상은 거절해요', () => {
  const encoded = encodeH('H', { version: 0, mode: 3, mask: 0 });
  const formatCell = hLayout(0).formatCells[0];
  for (const face of H_FACE_IDS.slice(0,3)) {
    const at=formatCell.i*encoded.n+formatCell.j;
    encoded.faces[face][at]=encoded.faces[face][at]===3?4:3;
  }
  const field = rasterField(buildHFaceSheet(encoded), 12);
  const hit = detectH(field);
  assert.equal(hit.faces.length,0);
});

test('성분 상한에서 stats.capped를 표시해요', () => {
  const encoded = encodeH('H', { version: 0, mode: 6, mask: 0 });
  const field = rasterField(buildHFaceSheet(encoded), 12);
  const hit = detectH(field, { maxComponents: 1 });
  assert.equal(hit.stats.capped, true);
  assert.ok(hit.stats.components <= 1);
  assert.ok(hit.faces.length <= 1);
});
