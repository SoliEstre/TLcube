// verifyY-unit.test.js — Type Y 자체검증 + §7.2-Y 정규화 추정기 단위 테스트 (SPEC §14, T7)
// 실행: node --test test/verifyY-unit.test.js (cwd: TLcube/)
//
// 렌더러(sceneY.js)는 아직 없다 — 합성 래스터를 직접 픽셀 단위로 그려 검증한다.
// discMedianLuminance 와 정확히 같은 원판 판정(dx²+dy²<=r²)으로 픽셀을 칠하므로
// 원판 median 은 칠한 값과 정확히 같아야 한다(부동소수 반올림만 남는다).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  measureModuleMedian,
  estimateGainFromPairs,
  estimateFaceGains,
  fitResiduals,
  verifyRasterY,
  EPSILON_FIT,
} from '../src/verifyY.js';
import { YFACES, moduleSampleDisc, layoutForCube } from '../src/ygrid.js';
import { referenceCellsAll } from '../src/placementY.js';
import { digitToRanks, RADIX } from '../src/lehmer.js';
import { relativeLuminance, getPreset, DEFAULT_PRESET } from '../src/luminance.js';

const N = 11; // placementY.assertSize 최소값 (n=9·10 은 포맷↔레퍼런스 실충돌로 하한 상향 — 검증 라운드).
const SIZE = 20;
const PIXELS_PER_UNIT = 2;

function makeScene() {
  return { layout: layoutForCube(N, { size: SIZE, margin: 2 * SIZE }) };
}

/** relativeLuminance 의 역(그레이스케일 한정) — BT.709 계수 합이 1이라
 * relativeLuminance(v,v,v) === srgbChannelToLinear(v) 이 성립한다. */
function relLuminanceToGray(y) {
  const clamped = Math.min(1, Math.max(0, y));
  const c = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  const v8 = Math.round(Math.min(1, Math.max(0, c)) * 255);
  return { r: v8, g: v8, b: v8 };
}

function createRaster(scene, background) {
  const width = Math.ceil(scene.layout.width * PIXELS_PER_UNIT);
  const height = Math.ceil(scene.layout.height * PIXELS_PER_UNIT);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    pixels[p * 4] = background.r;
    pixels[p * 4 + 1] = background.g;
    pixels[p * 4 + 2] = background.b;
    pixels[p * 4 + 3] = 255;
  }
  return { width, height, pixels, pixelsPerUnit: PIXELS_PER_UNIT };
}

function paintDisc(raster, cxPx, cyPx, radiusPx, rgb) {
  const { width, height, pixels } = raster;
  const x0 = Math.max(0, Math.floor(cxPx - radiusPx));
  const x1 = Math.min(width - 1, Math.ceil(cxPx + radiusPx));
  const y0 = Math.max(0, Math.floor(cyPx - radiusPx));
  const y1 = Math.min(height - 1, Math.ceil(cyPx + radiusPx));
  const r2 = radiusPx * radiusPx;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cxPx;
      const dy = y + 0.5 - cyPx;
      if (dx * dx + dy * dy <= r2) {
        const i = (y * width + x) * 4;
        pixels[i] = rgb.r;
        pixels[i + 1] = rgb.g;
        pixels[i + 2] = rgb.b;
        pixels[i + 3] = 255;
      }
    }
  }
}

function paintModule(raster, scene, face, i, j, rgb) {
  const disc = moduleSampleDisc(face, i, j, scene.layout);
  paintDisc(
    raster,
    disc.x * raster.pixelsPerUnit,
    disc.y * raster.pixelsPerUnit,
    disc.radius * raster.pixelsPerUnit,
    rgb,
  );
}

/** 셀 맵으로 래스터를 그린다. faceGain[face] 로 면별 시스템 게인(곱셈)을 주입할 수 있다. */
function renderEncoded(scene, encoded, options = {}) {
  const faceGain = options.faceGain || { T: 1, L: 1, R: 1 };
  const background = options.background || { r: 5, g: 5, b: 5 };
  const raster = createRaster(scene, background);
  const levels = getPreset(DEFAULT_PRESET).levels.map((rgb) => relativeLuminance(rgb));
  for (const [key, { digit }] of encoded.cellDigits) {
    const [i, j] = key.split(',').map(Number);
    const ranks = digitToRanks(digit);
    for (const face of YFACES) {
      const yKnown = levels[ranks[face]];
      const yObs = yKnown * faceGain[face];
      paintModule(raster, scene, face, i, j, relLuminanceToGray(yObs));
    }
  }
  return raster;
}

function buildEncoded(dataCells) {
  const cellDigits = new Map();
  for (const c of referenceCellsAll(N)) {
    cellDigits.set(`${c.i},${c.j}`, { digit: c.digit, role: 'reference' });
  }
  for (const { i, j, digit } of dataCells) {
    cellDigits.set(`${i},${j}`, { digit, role: 'data' });
  }
  return { n: N, cellDigits };
}

// ── measureModuleMedian: 기하 + 원판 median 왕복 ──────────────────────────────

test('measureModuleMedian: 칠한 값 그대로 median 을 되읽는다', () => {
  const scene = makeScene();
  const raster = createRaster(scene, { r: 5, g: 5, b: 5 });
  const rgb = { r: 200, g: 90, b: 40 };
  paintModule(raster, scene, 'T', 2, 2, rgb);
  const y = measureModuleMedian(raster, scene, 'T', 2, 2);
  assert.ok(Math.abs(y - relativeLuminance(rgb)) < 1e-9);
});

// ── estimateGainFromPairs: 순수 함수, 래스터 없이 정확도 검증 ─────────────────

test('estimateGainFromPairs: 잡음 없는 합성 관측이면 ĝ 가 참값과 1e-6 이내로 일치한다', () => {
  const trueGain = 1.37;
  const levels = getPreset(DEFAULT_PRESET).levels.map((rgb) => relativeLuminance(rgb));
  const pairs = levels.map((yKnown) => ({ yKnown, yObs: yKnown * trueGain }));
  const { gain, included, excluded } = estimateGainFromPairs(pairs);
  assert.equal(included.length, 3);
  assert.equal(excluded.length, 0);
  assert.ok(Math.abs(gain - trueGain) < 1e-6, `gain=${gain} trueGain=${trueGain}`);
});

test('estimateGainFromPairs: 가중(w∝Y²)이 어두운 레벨의 잡음을 비가중 대비 실제로 감쇠한다', () => {
  const trueGain = 1.0;
  const levels = getPreset(DEFAULT_PRESET).levels.map((rgb) => relativeLuminance(rgb));
  // 어두운 레벨(rank 0)에만 큰 곱셈 잡음을 주입 — 시드 고정(결정적 상수, RNG 아님).
  const noisyDarkFactor = 3.2; // 어두운 레벨 관측이 참값의 3.2배로 크게 흔들림
  const pairs = [
    { yKnown: levels[0], yObs: levels[0] * trueGain * noisyDarkFactor },
    { yKnown: levels[1], yObs: levels[1] * trueGain },
    { yKnown: levels[2], yObs: levels[2] * trueGain },
  ];
  const weighted = estimateGainFromPairs(pairs, { weighted: true });
  const unweighted = estimateGainFromPairs(pairs, { weighted: false });
  const errWeighted = Math.abs(weighted.gain - trueGain);
  const errUnweighted = Math.abs(unweighted.gain - trueGain);
  assert.ok(
    errWeighted < errUnweighted,
    `가중 오차(${errWeighted})가 비가중 오차(${errUnweighted})보다 작아야 한다`,
  );
});

test('estimateGainFromPairs: 클램프 경로 — 관측 ≤ 0 은 제외 + excluded 보고', () => {
  const levels = getPreset(DEFAULT_PRESET).levels.map((rgb) => relativeLuminance(rgb));
  const pairs = [
    { yKnown: levels[0], yObs: 0 }, // 클램프 대상
    { yKnown: levels[1], yObs: -0.01 }, // 클램프 대상(음수 — 렌더 오차 시뮬레이션)
    { yKnown: levels[2], yObs: levels[2] * 1.1 },
  ];
  const { gain, included, excluded } = estimateGainFromPairs(pairs);
  assert.equal(included.length, 1);
  assert.equal(excluded.length, 2);
  assert.ok(Math.abs(gain - 1.1) < 1e-6);
});

test('estimateGainFromPairs: 전 관측이 클램프되면 den=0 → gain=NaN, 안 던진다', () => {
  const { gain, included, excluded } = estimateGainFromPairs([
    { yKnown: 0.1, yObs: 0 },
    { yKnown: 0.2, yObs: -1 },
  ]);
  assert.ok(Number.isNaN(gain));
  assert.equal(included.length, 0);
  assert.equal(excluded.length, 2);
});

// ── estimateFaceGains / fitResiduals: 합성 래스터 위에서 ─────────────────────

test('estimateFaceGains: 왜곡 없는 렌더(게인 1)면 ĝ_f ≈ 1 (양자화 오차 이내)', () => {
  const scene = makeScene();
  const encoded = buildEncoded([]);
  const raster = renderEncoded(scene, encoded, { faceGain: { T: 1, L: 1, R: 1 } });
  const { gains, excluded } = estimateFaceGains(raster, scene, encoded);
  for (const face of YFACES) {
    assert.equal(excluded[face].length, 0, `${face}: 클램프 없어야 한다`);
    assert.ok(Math.abs(gains[face] - 1) < 0.02, `${face}: gain=${gains[face]}`);
  }
});

test('estimateFaceGains: 면별로 다른 시스템 게인을 주입하면 그 값을 되찾는다', () => {
  const scene = makeScene();
  const encoded = buildEncoded([]);
  const faceGain = { T: 1.2, L: 0.8, R: 1.1 }; // 상위 레벨(Y≈0.77) 이 8bit 상한에서 클리핑되지 않도록 상한 유지
  const raster = renderEncoded(scene, encoded, { faceGain });
  const { gains } = estimateFaceGains(raster, scene, encoded);
  for (const face of YFACES) {
    assert.ok(
      Math.abs(gains[face] - faceGain[face]) < 0.03,
      `${face}: gain=${gains[face]} truth=${faceGain[face]}`,
    );
  }
});

test('fitResiduals: 정확한 ĝ 로 정규화하면 잔차 게이트를 통과한다', () => {
  const scene = makeScene();
  const encoded = buildEncoded([]);
  const faceGain = { T: 1.2, L: 1.0, R: 0.9 };
  const raster = renderEncoded(scene, encoded, { faceGain });
  const { gains } = estimateFaceGains(raster, scene, encoded);
  const gate = fitResiduals(raster, scene, encoded, gains);
  assert.ok(gate.ok, `maxResidual=${gate.maxResidual} epsilon=${gate.epsilon}`);
  assert.ok(gate.maxResidual <= EPSILON_FIT);
});

test('fitResiduals: 틀린 게인(보정 안 함)을 넣으면 잔차 게이트 위반을 검출한다', () => {
  const scene = makeScene();
  const encoded = buildEncoded([]);
  const faceGain = { T: 1.6, L: 1, R: 1 }; // T 면에 큰 왜곡 주입
  const raster = renderEncoded(scene, encoded, { faceGain });
  const wrongGains = { T: 1, L: 1, R: 1 }; // 보정을 아예 안 한 것처럼 위장
  const gate = fitResiduals(raster, scene, encoded, wrongGains);
  assert.equal(gate.ok, false);
  assert.ok(gate.maxResidual > EPSILON_FIT);
});

// ── verifyRasterY: recoverDigit 왕복 + 전 셀 순회 ────────────────────────────

test('verifyRasterY: 왜곡 없는 렌더 — digit 0..5 전부 왕복, 전 셀 일치', () => {
  const scene = makeScene();
  // digit 0..5(RADIX=6) 전부를 서로 겹치지 않는 데이터 셀에 배치 — recoverDigit 왕복 커버.
  const coords = [
    { i: 0, j: 0 }, { i: 1, j: 0 }, { i: 0, j: 1 },
    { i: 4, j: 0 }, { i: 0, j: 4 }, { i: 4, j: 4 },
  ];
  assert.equal(coords.length, RADIX);
  const dataCells = coords.map((c, digit) => ({ ...c, digit }));
  const encoded = buildEncoded(dataCells);
  const raster = renderEncoded(scene, encoded);

  const result = verifyRasterY(raster, scene, encoded);

  assert.equal(result.total, encoded.cellDigits.size);
  assert.equal(result.matched, result.total);
  assert.deepEqual(result.mismatches, []);
  assert.ok(result.minDeltaY >= 0.12, `minDeltaY=${result.minDeltaY}`);
  assert.ok(result.residualGate.ok);
  assert.equal(result.ok, true);
});

test('verifyRasterY: 면별 시스템 게인 왜곡을 §7.2-Y 정규화로 흡수해도 여전히 일치한다', () => {
  const scene = makeScene();
  const dataCells = [
    { i: 0, j: 0, digit: 1 },
    { i: 4, j: 4, digit: 5 },
  ];
  const encoded = buildEncoded(dataCells);
  const faceGain = { T: 1.3, L: 1.0, R: 0.85 }; // 렌더 전역에 균일 왜곡
  const raster = renderEncoded(scene, encoded, { faceGain });

  const result = verifyRasterY(raster, scene, encoded);

  assert.equal(result.matched, result.total);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.ok, true);
});

test('verifyRasterY: 한 데이터 셀만 순위를 뒤바꿔 그리면 그 셀만 mismatch 로 잡힌다', () => {
  const scene = makeScene();
  const dataCells = [
    { i: 0, j: 0, digit: 2 },
    { i: 4, j: 4, digit: 5 },
  ];
  const encoded = buildEncoded(dataCells);
  const raster = renderEncoded(scene, encoded);

  // (0,0) 셀을 다른 digit(2가 아닌 다른 순열)으로 다시 덮어 그려 렌더-계약 불일치를 시뮬레이션.
  const corruptedRanks = digitToRanks(4); // digit 2 와 다른 순열
  const levels = getPreset(DEFAULT_PRESET).levels.map((rgb) => relativeLuminance(rgb));
  for (const face of YFACES) {
    paintModule(raster, scene, face, 0, 0, relLuminanceToGray(levels[corruptedRanks[face]]));
  }

  const result = verifyRasterY(raster, scene, encoded);

  assert.equal(result.matched, result.total - 1);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.mismatches[0].i, 0);
  assert.equal(result.mismatches[0].j, 0);
  assert.equal(result.mismatches[0].expected, 2);
  assert.equal(result.ok, false);
});
