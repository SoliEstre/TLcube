/**
 * rotation-kat.test.js — 타입 O 회전 사상 KAT (렌더 → 120°/240° 래스터 회전 → 복호 전 구간)
 *
 * 고정하는 실측 (oak 검토 §4-2 — `test/output/claude-oak-review.md` §1.1·§5):
 *
 *   물리 120° CW 회전에서 코드의 합성 사상은
 *     좌표: (q,r) → rotate120(q,r) = (−q−r, q)
 *     면 순환 σ: **T→R, R→L, L→T** (정방향)
 *   240° CW 는 그 제곱: rotate240(q,r) = (r, −q−r), σ²: T→L, L→R, R→T.
 *
 * 지금까지 σ 짝은 기하 코드(faceCentroid + point-in-polygon 표본)로만 검증돼
 * 있었고, O/A/K 파인더 후보의 방향 margin 수치 전체가 이 짝 위에 서 있다.
 * 이 KAT 는 렌더된 래스터를 `test/harness/distort.mjs` 로 실제로 돌린 뒤
 *   (a) `decodeFrontend` 전 구간 복호가 성공하고 회전 가설(orientation)이 맞는지,
 *   (b) 원본 셀 (q,r) 면 f 의 톤 순위가 회전본 (q',r') 면 σ(f) 에서 그대로
 *       재측정되는지 (digit 0..5 각 1셀 = 순위 순열 6종 전부 × 세 면)
 * 를 고정한다. σ 가 반전되면 (b) 가 즉시 깨진다.
 *
 * 결정성: 고정 페이로드·고정 렌더 파라미터·RNG 없음. 회전 중심은 이미지 중심이고
 * `layoutForRegion` 이 셀 (0,0) 을 캔버스 정중앙에 두므로 격자가 자기 자신 위로
 * 돌아간다 (반올림 오차 ≤ 0.5px ≪ 면 표본 디스크 반경).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { measureCellFaceMedians } from '../src/verify.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { rotateImage } from './harness/distort.mjs';
import { rotate120, rotate240 } from '../src/placement.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
// 회전 가장자리 fill — 불투명 배경. distort.mjs 는 a 누락 fill 을 거부한다.
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

const TEXT = 'rotation-kat';
const FACES = ['T', 'L', 'R'];

/**
 * KAT 표본 — digit 0..5 각 1셀 (모든 톤 순위 순열, 세 면 전부 커버).
 * `TEXT`/V1/M 인코딩에서의 기지답(known answer). 인코딩이 바뀌면 digit 대조가
 * 먼저 깨져서 (σ 측정이 아니라) 표본 자체가 어긋났음을 알린다.
 */
const SAMPLE_CELLS = Object.freeze([
  { q: 3, r: 1, digit: 0 },
  { q: 0, r: 4, digit: 1 },
  { q: -1, r: 4, digit: 2 },
  { q: 0, r: -4, digit: 3 },
  { q: -3, r: 2, digit: 4 },
  { q: -3, r: 4, digit: 5 },
]);

/** 실측으로 고정된 면 순환 (물리 CW 회전, 렌더→회전→재측정 전 구간). */
const SIGMA_120 = Object.freeze({ T: 'R', R: 'L', L: 'T' });
const SIGMA_240 = Object.freeze({ T: 'L', L: 'R', R: 'T' });

/** 셀 내 세 면 median 이 순위를 논할 만큼 떨어져 있음을 요구하는 하한 (0..1 휘도). */
const MIN_FACE_SEPARATION = 0.05;

function buildFixture() {
  const encoded = encode(TEXT, { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE });
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
  return { encoded, scene, raster };
}

/** 면별 median → 순위 (0 = 최저). 동률은 T,L,R 정준 순서 — verify.recoverDigit 와 동일 규약. */
function ranksOf(medians) {
  const order = [0, 1, 2];
  const values = FACES.map((face) => medians[face]);
  order.sort((a, b) => values[a] - values[b] || a - b);
  const ranks = {};
  order.forEach((faceIdx, rankPos) => {
    ranks[FACES[faceIdx]] = rankPos;
  });
  return ranks;
}

function assertSeparated(medians, label) {
  const sorted = FACES.map((face) => medians[face]).sort((a, b) => a - b);
  const delta = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
  assert.ok(
    delta >= MIN_FACE_SEPARATION,
    `${label}: 면 median 분리폭 ${delta.toFixed(4)} < ${MIN_FACE_SEPARATION} — 순위 측정이 무의미하다`,
  );
}

/**
 * 원본 (q,r) 와 회전본 (q',r') 를 같은 scene 기하로 재서, 원본 면 f 의 순위가
 * 회전본 어느 면 f' 에서 나타나는지(σ) 를 판독한다.
 */
function measureSigma(raster, rotatedRaster, scene, cell, mapQr) {
  const orig = measureCellFaceMedians(raster, scene, cell.q, cell.r);
  const destination = mapQr(cell.q, cell.r);
  const rotated = measureCellFaceMedians(rotatedRaster, scene, destination.q, destination.r);
  assertSeparated(orig, `원본 (${cell.q},${cell.r})`);
  assertSeparated(rotated, `회전본 (${destination.q},${destination.r})`);
  const origRanks = ranksOf(orig);
  const rotatedRanks = ranksOf(rotated);
  const sigma = {};
  for (const face of FACES) {
    sigma[face] = FACES.find((candidate) => rotatedRanks[candidate] === origRanks[face]);
  }
  return { sigma, destination };
}

test('회전 KAT: 무회전 자 검증 — 렌더 → decodeFrontend 원문 복원', { timeout: 120_000 }, () => {
  const { encoded, raster } = buildFixture();
  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, JSON.stringify(result.reason || result.detail));
  assert.equal(result.text, TEXT);
  assert.equal(result.version, 1);
  assert.equal(result.hypothesis.orientation, 0, '무회전인데 회전 가설이 잡혔다');

  // KAT 표본이 실제 인코딩과 일치하는지 먼저 대조 — σ 측정의 전제.
  for (const cell of SAMPLE_CELLS) {
    const truth = encoded.cellDigits.get(`${cell.q},${cell.r}`);
    assert.ok(truth && truth.role === 'data', `표본 (${cell.q},${cell.r}) 가 data 셀이 아니다`);
    assert.equal(
      truth.digit,
      cell.digit,
      `표본 (${cell.q},${cell.r}) digit 이 기지답과 다르다 — 인코딩이 변했다`,
    );
  }
});

test('회전 KAT: 120° CW — 전 구간 복호 + σ = T→R, R→L, L→T', { timeout: 120_000 }, () => {
  const { scene, raster } = buildFixture();
  const rotated = rotateImage(raster, 120, { fill: FILL });

  const result = decodeFrontend(rotated);
  assert.equal(result.ok, true, JSON.stringify(result.reason || result.detail));
  assert.equal(result.text, TEXT);
  assert.equal(result.hypothesis.orientation, 1, '120° 회전본의 회전 가설은 1 이어야 한다');

  for (const cell of SAMPLE_CELLS) {
    const { sigma, destination } = measureSigma(raster, rotated, scene, cell, rotate120);
    assert.deepEqual(
      sigma,
      SIGMA_120,
      `(${cell.q},${cell.r})→(${destination.q},${destination.r}) 면 순환이 σ(T→R,R→L,L→T) 가 아니다: `
        + JSON.stringify(sigma),
    );
  }
});

test('회전 KAT: 240° CW — 전 구간 복호 + σ² = T→L, L→R, R→T', { timeout: 120_000 }, () => {
  const { scene, raster } = buildFixture();
  const rotated = rotateImage(raster, 240, { fill: FILL });

  const result = decodeFrontend(rotated);
  assert.equal(result.ok, true, JSON.stringify(result.reason || result.detail));
  assert.equal(result.text, TEXT);
  assert.equal(result.hypothesis.orientation, 2, '240° 회전본의 회전 가설은 2 여야 한다');

  for (const cell of SAMPLE_CELLS) {
    const { sigma, destination } = measureSigma(raster, rotated, scene, cell, rotate240);
    assert.deepEqual(
      sigma,
      SIGMA_240,
      `(${cell.q},${cell.r})→(${destination.q},${destination.r}) 면 순환이 σ²(T→L,L→R,R→T) 가 아니다: `
        + JSON.stringify(sigma),
    );
  }
});
