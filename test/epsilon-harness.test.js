/**
 * epsilon-harness.test.js — `tools/epsilon-harness.mjs` 부품 최소 검증.
 *
 * 이 하네스 자체가 "측정 도구"이므로, 여기서는 측정값 자체(ε 수치)를 하드코딩해
 * 검증하지 않는다(그건 구현 복사 동어반복). 대신 **하네스가 지켜야 할 성질**만 본다:
 * 결정성, 왜곡 없음(항등) → ε=0, 단조 톤 변환의 순서 보존, bilinear 샘플러의 기초 정합성.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  mulberry32,
  deriveSeed,
  LEVELS,
  classifyBand,
  bilinearSample,
  renderRaster,
  distortGamma,
  distortSCurve,
  measureEpsilon,
  runTrial,
  recoverDigitFromMedians,
  computeScaleMargin,
  warpRotateScale,
  transformPoint,
} from '../tools/epsilon-harness.mjs';
import { regionCells, layoutForRegion, faceCentroid } from '../src/hexgrid.js';
import { digitToRanks } from '../src/lehmer.js';

describe('mulberry32 / deriveSeed — 결정적 RNG', () => {
  test('같은 시드는 같은 수열을 낸다', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    assert.deepEqual(seqA, seqB);
  });

  test('다른 시드는 (사실상 항상) 다른 수열을 낸다', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    assert.notEqual(a(), b());
  });

  test('deriveSeed 는 입력이 같으면 같은 값을, 다르면 다른 값을 낸다', () => {
    assert.equal(deriveSeed('gamma:1.0', 3), deriveSeed('gamma:1.0', 3));
    assert.notEqual(deriveSeed('gamma:1.0', 3), deriveSeed('gamma:1.0', 4));
    assert.notEqual(deriveSeed('gamma:1.0', 3), deriveSeed('scurve:1.0', 3));
  });
});

describe('classifyBand — ADR/PM-005 밴드 경계', () => {
  test('경계값 판정', () => {
    assert.equal(classifyBand(0), 'T1');
    assert.equal(classifyBand(0.1), 'T1');
    assert.equal(classifyBand(0.15), 'T2'); // 경계는 다음 밴드에 포함 (< 비교)
    assert.equal(classifyBand(2.6), 'T3');
    assert.equal(classifyBand(4.16), 'T4');
    assert.equal(classifyBand(10), 'T4');
  });
});

describe('bilinearSample — 기초 정합성', () => {
  test('균일 래스터에서는 어디를 샘플링해도 그 값이 나온다', () => {
    const width = 5;
    const height = 5;
    const data = new Float64Array(width * height).fill(0.42);
    const raster = { data, width, height };
    assert.equal(bilinearSample(raster, 2.3, 3.7), 0.42);
    assert.equal(bilinearSample(raster, 0, 0), 0.42); // 경계 clamp 포함
    assert.equal(bilinearSample(raster, 100, 100), 0.42);
  });

  test('선형 그라디언트를 정확히 보간한다', () => {
    // data[x] = x (열 방향 그라디언트), 픽셀 중심은 x+0.5
    const width = 10;
    const height = 2;
    const data = new Float64Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) data[y * width + x] = x;
    }
    const raster = { data, width, height };
    // 픽셀 2와 3의 중점(2.5+0.5=3.0 픽셀좌표)은 정확히 2.5
    assert.ok(Math.abs(bilinearSample(raster, 3.0, 1.0) - 2.5) < 1e-9);
  });
});

describe('renderRaster — 임시 렌더러', () => {
  test('digit 하나짜리 셀의 면 중심 값이 lehmer 순위 레벨과 정확히 일치한다', () => {
    const resolution = 20;
    const layout = layoutForRegion(0, { size: 1, margin: 1 }); // 셀 1개(중심)
    const cells = regionCells(0);
    const digit = 3;
    const raster = renderRaster(cells, [digit], layout, { resolution });
    const ranks = digitToRanks(digit);
    for (const face of ['T', 'L', 'R']) {
      const c = faceCentroid(0, 0, face, layout);
      const value = bilinearSample(raster, c.x * resolution, c.y * resolution);
      assert.ok(
        Math.abs(value - LEVELS[ranks[face]]) < 1e-6,
        `면 ${face}: 기대 ${LEVELS[ranks[face]]}, 실측 ${value}`,
      );
    }
  });
});

describe('distortGamma / distortSCurve — 단조성', () => {
  test('임의의 세 값에 대해 순서를 보존한다 (gamma 0.6~1.8)', () => {
    const values = [0.24, 0.50, 0.76];
    const raster = { data: Float64Array.from(values), width: 3, height: 1 };
    for (const g of [0.6, 1.0, 1.4, 1.8]) {
      const out = distortGamma(raster, g).data;
      assert.ok(out[0] < out[1] && out[1] < out[2], `gamma=${g} 에서 순서 붕괴`);
    }
  });

  test('임의의 세 값에 대해 순서를 보존한다 (S-curve strength 1~12)', () => {
    const values = [0.24, 0.50, 0.76];
    const raster = { data: Float64Array.from(values), width: 3, height: 1 };
    for (const s of [1, 4, 8, 12]) {
      const out = distortSCurve(raster, s).data;
      assert.ok(out[0] < out[1] && out[1] < out[2], `strength=${s} 에서 순서 붕괴`);
    }
  });
});

describe('recoverDigitFromMedians — lehmer 순위 왕복', () => {
  test('median 이 원래 순위 순서와 같으면 digit 을 정확히 복원한다', () => {
    for (let digit = 0; digit < 6; digit += 1) {
      const ranks = digitToRanks(digit);
      const medians = { T: LEVELS[ranks.T], L: LEVELS[ranks.L], R: LEVELS[ranks.R] };
      assert.equal(recoverDigitFromMedians(medians), digit);
    }
  });
});

describe('runTrial / measureEpsilon — 왜곡 없음(항등) 기준선', () => {
  test('왜곡을 가하지 않으면 ε = 0 이어야 한다 (여러 시드)', () => {
    const res = measureEpsilon({
      k: 2,
      trials: 15,
      resolution: 10,
      samplesPerDisc: 16,
      seedBase: 'test-identity',
      distort: (raster) => raster,
    });
    assert.equal(res.epsilonPercent, 0);
    assert.ok(res.total > 0);
  });

  test('같은 시드로 두 번 돌리면 완전히 같은 결과가 나온다 (결정성)', () => {
    const params = {
      k: 1,
      seed: 777,
      resolution: 10,
      samplesPerDisc: 10,
      distort: (raster) => distortGamma(raster, 1.2),
    };
    const a = runTrial(params);
    const b = runTrial(params);
    assert.deepEqual(a, b);
  });
});

describe('computeScaleMargin — 스케일 확대 시 프레이밍 여백', () => {
  test('maxScale 이 클수록 더 큰 여백을 요구한다', () => {
    const m1 = computeScaleMargin(3, 1.5);
    const m2 = computeScaleMargin(3, 2.0);
    assert.ok(m2 > m1);
  });

  test('scale=1 근방은 최소 여백(1)으로 충분하다', () => {
    assert.equal(computeScaleMargin(2, 1.0), 1);
  });
});

describe('기하 경로 — warpRotateScale ↔ transformPoint 정합 (검증 라운드: 뮤테이션 생존 지적 반영)', () => {
  // 이 스위트가 잡는 뮤테이션: transformPoint 회전 부호 반전, warp 역변환의 1/scale 제거.
  // 둘 다 이전 스위트(14개)를 전부 통과하며 생존했었다.

  test('transformPoint: 90° 회전이 좌표축을 정확히 돌린다 (부호 규약 고정)', () => {
    // 원본 프레임 중심 기준 (+dx, 0) 방향의 점은 +90°(y-down 화면계 시계) 회전 후 (0, +dx) 로 가야 한다.
    const raster = { width: 200, height: 200, resolution: 10 };
    const cx = 100, cy = 100;
    const p = transformPoint(raster, 15, 10, Math.PI / 2, 1);
    // 원본 레이아웃 (15,10) → 픽셀 (150,100) → 중심상대 (50,0) → 회전 (0,50) → (100,150)
    assert.ok(Math.abs(p.x - cx) < 1e-9, `x=${p.x}`);
    assert.ok(Math.abs(p.y - (cy + 50)) < 1e-9, `y=${p.y}`);
  });

  test('transformPoint: scale 이 중심 상대 거리를 정확히 곱한다', () => {
    const raster = { width: 200, height: 200, resolution: 10 };
    const p = transformPoint(raster, 15, 10, 0, 2);
    assert.ok(Math.abs(p.x - 200) < 1e-9, `x=${p.x}`);   // (50,0)·2 → (100,0) → x=200
    assert.ok(Math.abs(p.y - 100) < 1e-9, `y=${p.y}`);
  });

  test('왕복 정합: 회전+스케일 후 transformPoint 가 가리키는 곳의 값 = 원본 값', () => {
    // 합성 래스터: 중심에서 오른쪽으로 치우친 밝은 사각 패치 하나.
    const width = 120, height = 120, resolution = 10;
    const data = new Float64Array(width * height).fill(0.2);
    for (let y = 52; y < 68; y += 1) for (let x = 80; x < 96; x += 1) data[y * width + x] = 0.9;
    const raster = { width, height, resolution, data };

    for (const [angle, scale] of [[Math.PI / 2, 1], [Math.PI / 6, 1], [0, 0.6], [Math.PI / 3, 0.8]]) {
      const warped = warpRotateScale(raster, angle, scale);
      // 패치 중심의 레이아웃 좌표 = 픽셀 (88, 60) / resolution
      const p = transformPoint(raster, 88 / resolution, 60 / resolution, angle, scale);
      const v = bilinearSample(warped, p.x, p.y);
      assert.ok(Math.abs(v - 0.9) < 0.05,
        `angle=${angle.toFixed(3)} scale=${scale}: 패치 중심 값 ${v} ≠ 0.9 — 순/역변환 규약이 어긋났다`);
      // 대조: 배경 지점도 배경으로 남는가 (전체가 밝게 뭉개지는 퇴화 검출)
      const bg = transformPoint(raster, 30 / resolution, 60 / resolution, angle, scale);
      const bv = bilinearSample(warped, bg.x, bg.y);
      assert.ok(Math.abs(bv - 0.2) < 0.05, `배경 값 ${bv} ≠ 0.2`);
    }
  });
});
