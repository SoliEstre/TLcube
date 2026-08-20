/**
 * scene-marker-tones.test.js — 코너 마커 면별 톤 렌더 회귀.
 *
 * 고정하는 것:
 *   ① 데이터 셀 렌더 무변경 — 같은 입력의 래스터가 바이트 동일 (HEAD 실측 sha256).
 *   ② 마커가 tones 를 들면 파인더 축(bullseyeDark / BULLSEYE_MID / bullseyeLight)으로
 *      그리고, 없으면 기존 digit → palette.levels 경로를 탄다.
 *   ③ 마커 톤 3종과 데이터 톤 3종의 상대휘도 최소 간격 (`relativeLuminance8`).
 *   ④ 잘못된 톤은 조용한 digit 폴백 없이 RangeError.
 *
 * 변이 검증: `faceColor` 의 톤 분기를 끄면 ②가 빨개진다 (lane-out/verify.txt).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { encode } from '../src/encode.js';
import { FACES, facePolygon } from '../src/hexgrid.js';
import { digitToRanks } from '../src/lehmer.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, BULLSEYE_MID,
  getPreset, relativeLuminance8,
} from '../src/luminance.js';

const PRESET = getPreset('slate');
const PALETTE = {
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};

const MARKER_TONES = Object.freeze([BULLSEYE_DARK, BULLSEYE_MID, BULLSEYE_LIGHT]);

function sha256Pixels(raster) {
  return createHash('sha256').update(raster.pixels).digest('hex');
}

function Y8(rgb) {
  return relativeLuminance8(rgb.r, rgb.g, rgb.b);
}

test('데이터 셀 렌더 무변경 — encode(V1) 래스터 sha256 이 HEAD 실측과 같다', () => {
  const encoded = encode('pin', { version: 1, eccLevel: 'M' });
  assert.equal(encoded.cornerMarker, false);
  for (const entry of encoded.cellDigits.values()) {
    assert.equal('tones' in entry, false);
    assert.notEqual(entry.role, 'marker');
  }
  const scene = buildScene(encoded, { palette: PALETTE, cellSize: 8 });
  const raster = rasterize(scene, { pixelsPerUnit: 1, supersample: 2 });
  assert.equal(raster.width, 212);
  assert.equal(raster.height, 192);
  assert.equal(raster.pixels.length, 162816);
  assert.equal(
    sha256Pixels(raster),
    '35f4cb375c5478373f8bdc073752f857c4c7c8088779ee83d8ac9cb290ec93a4',
  );
});

test('데이터 셀 폴리곤 색은 tones 있는 마커가 옆에서도 palette.levels 그대로다', () => {
  const cellDigits = new Map();
  cellDigits.set('3,0', { digit: 0, role: 'data' });
  cellDigits.set('-3,1', { digit: 5, role: 'data' });
  cellDigits.set('4,-2', {
    digit: 2, role: 'marker', tones: { T: 2, L: 0, R: 2 },
  });
  const encoded = { k: 6, cellDigits };
  const scene = buildScene(encoded, { palette: PALETTE, cellSize: 8 });
  const byKey = new Map();
  let idx = 0;
  for (const [key, entry] of cellDigits) {
    const [q, r] = key.split(',').map(Number);
    for (const face of FACES) {
      byKey.set(key + ':' + face, scene.shapes[idx]);
      assert.deepEqual(scene.shapes[idx].points, facePolygon(q, r, face, scene.layout));
      idx += 1;
    }
    void entry;
  }
  for (const face of FACES) {
    const ranks0 = digitToRanks(0);
    const ranks5 = digitToRanks(5);
    assert.deepEqual(byKey.get('3,0:' + face).color, PALETTE.levels[ranks0[face]]);
    assert.deepEqual(byKey.get('-3,1:' + face).color, PALETTE.levels[ranks5[face]]);
    const level = ({ T: 2, L: 0, R: 2 })[face];
    const want = level === 2 ? PALETTE.bullseyeLight
      : level === 1 ? BULLSEYE_MID : PALETTE.bullseyeDark;
    assert.deepEqual(byKey.get('4,-2:' + face).color, want);
  }
});

test('마커 tones 없으면 기존 digit 순위 경로 (데이터와 같은 색 집합)', () => {
  const cellDigits = new Map();
  cellDigits.set('3,0', { digit: 4, role: 'marker' });
  const scene = buildScene({ k: 6, cellDigits }, { palette: PALETTE });
  const ranks = digitToRanks(4);
  for (let i = 0; i < FACES.length; i += 1) {
    assert.deepEqual(scene.shapes[i].color, PALETTE.levels[ranks[FACES[i]]]);
  }
});

test('마커 톤 3종 vs 데이터 톤 3종 — 상대휘도 최소 간격', () => {
  const markerY = MARKER_TONES.map(Y8);
  const dataY = PRESET.levels.map(Y8);
  let min = Infinity;
  let pair = null;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const d = Math.abs(markerY[i] - dataY[j]);
      if (d < min) {
        min = d;
        pair = { marker: i, data: j, markerY: markerY[i], dataY: dataY[j] };
      }
    }
  }
  // 두 색 집합이 같으면 min=0 — 그게 §2 의 원인이다. 파인더 축을 쓰면 0 이 아니다.
  assert.ok(min > 0, '마커 톤과 데이터 톤 집합이 겹친다: ' + JSON.stringify(pair));
  assert.equal(markerY[0], 0);
  assert.equal(markerY[2], 1);
  // slate levels[0] Y ≈ 0.06116 이 마커 dark(0) 에 가장 가깝다.
  assert.ok(min > 0.06, '최소 간격 ' + min + ' 이 너무 작다: ' + JSON.stringify(pair));
  assert.ok(min < 0.07, '최소 간격 ' + min + ' 이 slate 실측과 다르다: ' + JSON.stringify(pair));
});

test('tones 가 0/1/2 가 아니면 조용한 digit 폴백 없이 던진다', () => {
  const cellDigits = new Map();
  cellDigits.set('3,0', { digit: 0, role: 'marker', tones: { T: 3, L: 1, R: 0 } });
  assert.throws(
    () => buildScene({ k: 6, cellDigits }, { palette: PALETTE }),
    RangeError,
  );
});
