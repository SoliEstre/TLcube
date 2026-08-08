/**
 * bullseye.test.js — 중앙 불스아이 파인더 형상·링 수 검증 (T5, SPEC §5.1)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RING_PAIRS,
  BAND_COUNT,
  OCCUPIED_RADIUS,
  maxSafeRadius,
  bandRadii,
  profileAt,
  occupiedCells,
  radialSignature,
  _internals,
} from '../src/bullseye.js';

import {
  regionCells,
  hexDistance,
  faceSampleDisc,
  FACES,
} from '../src/hexgrid.js';

const CELL_SIZES = [1, 2.5, 17];

describe('상수', () => {
  test('RING_PAIRS = 3, BAND_COUNT = 6', () => {
    assert.equal(RING_PAIRS, 3);
    assert.equal(BAND_COUNT, 6);
  });
});

describe('occupiedCells — 점유 19셀', () => {
  test('정확히 19개', () => {
    assert.equal(occupiedCells().length, 19);
  });

  test('hexDistance ≤ 2 와 정확히 일치 (전수 대조)', () => {
    const occ = occupiedCells();
    const expected = regionCells(OCCUPIED_RADIUS);
    assert.deepEqual(occ, expected);
    for (const { q, r } of occ) {
      assert.ok(hexDistance(q, r) <= 2, `(${q},${r}) hexDistance ≤ 2 위반`);
    }
    // region(2) 밖 셀은 하나도 포함되지 않았는지 교차검증
    const ring3 = regionCells(3).filter((c) => hexDistance(c.q, c.r) === 3);
    for (const { q, r } of ring3) {
      assert.ok(
        !occ.some((c) => c.q === q && c.r === r),
        `ring-3 셀 (${q},${r}) 이 점유 목록에 잘못 포함됨`,
      );
    }
  });
});

describe('R_max — 두 제약의 min', () => {
  for (const size of CELL_SIZES) {
    test(`cellSize=${size}: 풋프린트 여유·ring3 여유 중 작은 쪽`, () => {
      const footprint = _internals.footprintBoundaryClearance(size);
      const ring3 = _internals.ring3DiscClearance(size);
      const rMax = maxSafeRadius(size);
      // float 엄격 비교 금지 — 검증 라운드가 병렬 작성 중 1 ULP 갈림을 관측했다.
      // 계산 경로가 달라지면 언제든 재발할 수 있는 취약점이라 허용오차 비교로 고정한다.
      assert.ok(Math.abs(rMax - Math.min(footprint, ring3)) < 1e-12 * rMax);
      assert.ok(rMax > 0);
    });
  }

  test('size 에 선형 비례한다 (기하 스케일 불변)', () => {
    const r1 = maxSafeRadius(1);
    const r10 = maxSafeRadius(10);
    assert.ok(Math.abs(r10 - r1 * 10) < 1e-9);
  });
});

describe('밴드가 R_max 안에 전부 들어간다', () => {
  for (const size of CELL_SIZES) {
    test(`cellSize=${size}: 최외곽 밴드 경계 = R_max ≤ 풋프린트 경계 최소거리`, () => {
      const radii = bandRadii(size);
      assert.equal(radii.length, BAND_COUNT);
      const outer = radii[radii.length - 1];
      const rMax = maxSafeRadius(size);
      assert.equal(outer, rMax);

      const footprintClearance = _internals.footprintBoundaryClearance(size);
      // 풋프린트 경계에 닿기 전이어야 한다(초과가 아니라 이하) — 침범 없음.
      assert.ok(
        outer <= footprintClearance + 1e-9,
        `outer(${outer}) 가 풋프린트 여유(${footprintClearance}) 를 초과함`,
      );
    });
  }
});

describe('ring-3 샘플 원판 비침범 (전수)', () => {
  for (const size of CELL_SIZES) {
    test(`cellSize=${size}: ring-3 전 셀 × 전 면 원판이 R_max 밖`, () => {
      const rMax = maxSafeRadius(size);
      const layout = { size, originX: 0, originY: 0 };
      const ring3 = regionCells(3).filter((c) => hexDistance(c.q, c.r) === 3);
      assert.ok(ring3.length > 0);

      let checked = 0;
      for (const { q, r } of ring3) {
        for (const face of FACES) {
          const disc = faceSampleDisc(q, r, face, layout);
          const centerDist = Math.hypot(disc.x, disc.y);
          const clearance = centerDist - disc.radius;
          assert.ok(
            clearance >= rMax - 1e-9,
            `ring3 셀(${q},${r}) 면 ${face} 원판이 불스아이를 침범: ` +
              `clearance=${clearance} < R_max=${rMax}`,
          );
          checked++;
        }
      }
      assert.equal(checked, ring3.length * 3);
    });
  }
});

describe('profileAt — 밴드 경계에서 정확히 교대, 결정성', () => {
  test('중심은 암(0), 최외곽은 명(1)', () => {
    const radii = bandRadii(1);
    assert.equal(profileAt(0, 1), 0);
    assert.equal(profileAt(radii[radii.length - 1], 1), 1);
  });

  test('6밴드가 0,1,0,1,0,1 순으로 교대한다 (밴드 중점에서 샘플)', () => {
    const radii = bandRadii(1);
    const lower = [0, ...radii.slice(0, -1)];
    const expected = [0, 1, 0, 1, 0, 1];
    for (let i = 0; i < BAND_COUNT; i++) {
      const mid = (lower[i] + radii[i]) / 2;
      assert.equal(profileAt(mid, 1), expected[i], `밴드 ${i} 중점 불일치`);
    }
  });

  test('밴드 경계(하한)에서 정확히 다음 밴드 값으로 전환 (반개구간)', () => {
    const radii = bandRadii(1);
    // 경계값 radii[i] 는 다음 밴드(i+1)의 시작 — profileAt(radii[i]) 는
    // 밴드 i+1 의 값과 같아야 한다. 단, 마지막 경계(R_max)는 자기 자신(밴드5)에 포함.
    for (let i = 0; i < BAND_COUNT - 1; i++) {
      const boundary = radii[i];
      const valAtBoundary = profileAt(boundary, 1);
      const nextBandValue = (i + 1) % 2 === 0 ? 0 : 1;
      assert.equal(valAtBoundary, nextBandValue);
    }
    // 마지막 경계는 밴드 5(명=1) 자신에 포함
    const last = radii[radii.length - 1];
    assert.equal(profileAt(last, 1), 1);
  });

  test('결정성: 동일 입력 → 동일 출력 (반복 호출)', () => {
    const radii = bandRadii(1);
    const probe = radii[2] * 0.37;
    const a = profileAt(probe, 1);
    const b = profileAt(probe, 1);
    const c = profileAt(probe, 1);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  test('R_max 초과는 RangeError', () => {
    const rMax = maxSafeRadius(1);
    assert.throws(() => profileAt(rMax + 0.001, 1), RangeError);
  });

  test('음수·비유한값은 RangeError', () => {
    assert.throws(() => profileAt(-1, 1), RangeError);
    assert.throws(() => profileAt(NaN, 1), RangeError);
    assert.throws(() => profileAt(Infinity, 1), RangeError);
  });
});

describe('radialSignature', () => {
  test('길이 = samples, 값은 전부 0|1', () => {
    const sig = radialSignature(1, 24);
    assert.equal(sig.length, 24);
    for (const v of sig) assert.ok(v === 0 || v === 1);
  });

  test('중심(0) → 암, 끝(R_max) → 명', () => {
    const sig = radialSignature(1, 10);
    assert.equal(sig[0], 0);
    assert.equal(sig[sig.length - 1], 1);
  });

  test('samples < 2 는 RangeError', () => {
    assert.throws(() => radialSignature(1, 1), RangeError);
    assert.throws(() => radialSignature(1, 0), RangeError);
  });

  test('기본 samples=64 로도 동작', () => {
    const sig = radialSignature(1);
    assert.equal(sig.length, 64);
  });
});

describe('numbers_check — 균등 폭 vs 중심 확대 대안 (선정 근거 수치)', () => {
  test('균등 분할이 최소 밴드 폭을 최대화한다 (재배열 부등식의 구체 사례)', () => {
    const R = maxSafeRadius(1);
    const uniformWidth = R / BAND_COUNT;

    // 대안: 중심 밴드를 1.5배로 키우고 나머지 5밴드가 잔여를 균분.
    const centerAlt = 1.5 * uniformWidth;
    const restAlt = (R - centerAlt) / (BAND_COUNT - 1);
    const minBandAlt = Math.min(centerAlt, restAlt);

    assert.ok(
      uniformWidth > minBandAlt,
      `균등폭(${uniformWidth}) 이 중심확대안의 최소밴드(${minBandAlt}) 보다 커야 함`,
    );
  });
});

describe('독립 수치 앵커 (검증 라운드: 자기참조 지적 반영)', () => {
  // 이 스위트 전까지 R_max 검증은 전부 구현 내부 값끼리의 대조(자기참조)였다 —
  // 유한한 오류값이면 무엇이든 통과했다. 여기서 외부 닫힌 형태로 못박는다.
  test('풋프린트 경계 여유 = √13 · cellSize (닫힌 형태)', () => {
    // 19셀(hexDistance≤2) 풋프린트 경계까지 원점 최단거리. 독립 유도:
    // 경계에서 가장 가까운 변은 ring-2 셀 변이고, 그 최단점 거리의 제곱이 13·size² 이다.
    // (통합 검증 스크립트가 3.605551275463989 = √13 을 4.4e-16 오차로 재현했다.)
    for (const size of [1, 7, 10]) {
      assert.ok(Math.abs(_internals.footprintBoundaryClearance(size) - Math.sqrt(13) * size) < 1e-12 * size,
        `size=${size}: ${_internals.footprintBoundaryClearance(size)} ≠ √13·${size}`);
    }
  });

  test('R_max(1) 은 √13 이다 — ring-3 원판 여유(≈3.8762)가 아니라 풋프린트가 binding', () => {
    assert.ok(Math.abs(maxSafeRadius(1) - Math.sqrt(13)) < 1e-12);
    assert.ok(_internals.ring3DiscClearance(1) > Math.sqrt(13));
  });
});
