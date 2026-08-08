// ygrid.test.js — Type Y 면 격자 기하 테스트 (SPEC §14)
// 실행: node --test test/ygrid.test.js (cwd: TLcube/)

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YFACES,
  faceBasis,
  moduleQuad,
  moduleCenter,
  moduleSampleDisc,
  cubeBounds,
  layoutForCube,
} from '../src/ygrid.js';
import { hexArea, normalizeLayout } from '../src/hexgrid.js';

const EPS = 1e-9;

function assertClose(actual, expected, msg) {
  assert.ok(
    Math.abs(actual - expected) < EPS,
    `${msg}: actual=${actual} expected=${expected} diff=${Math.abs(actual - expected)}`,
  );
}

function assertPointClose(p, q, msg) {
  assertClose(p.x, q.x, `${msg} .x`);
  assertClose(p.y, q.y, `${msg} .y`);
}

/** 표준 회전 행렬(임의 θ) — 테스트 전용, src/ 는 이 계산을 재사용하지 않는다. */
function rotate(p, thetaDeg, origin) {
  const th = (thetaDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + dx * c - dy * s,
    y: origin.y + dx * s + dy * c,
  };
}

function shoelaceArea(points) {
  let sum = 0;
  for (let k = 0; k < points.length; k++) {
    const a = points[k];
    const b = points[(k + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 볼록 사각형 내부 판정 (모든 변에 대해 같은 방향의 cross product 부호). */
function pointInConvexQuad(pt, quad) {
  let sign = 0;
  for (let k = 0; k < quad.length; k++) {
    const a = quad[k];
    const b = quad[(k + 1) % quad.length];
    const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    if (Math.abs(cross) < 1e-12) continue; // 경계 위 — 통과
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** 점 pt 에서 직선 a-b 까지의 거리. */
function distToLine(pt, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return Math.abs(dx * (a.y - pt.y) - dy * (a.x - pt.x)) / len;
}

const LAYOUTS = [
  { size: 1, originX: 0, originY: 0 },
  { size: 2.3, originX: 17, originY: -5 },
];
const N_VALUES = [1, 2, 4];

// ── (1) 120° 회전 공변성: T(i,j) → R(i,j) → L(i,j) → T(i,j) ────────────────

test('120도 회전 공변성 — T -> R -> L -> T, 전 (i,j) 표본', () => {
  for (const layout of LAYOUTS) {
    const norm = normalizeLayout(layout);
    const origin = { x: norm.originX, y: norm.originY };
    for (const n of N_VALUES) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const qT = moduleQuad('T', i, j, layout);
          const qR = moduleQuad('R', i, j, layout);
          const qL = moduleQuad('L', i, j, layout);

          for (let v = 0; v < 4; v++) {
            assertPointClose(
              rotate(qT[v], 120, origin),
              qR[v],
              `T->R rot n=${n} i=${i} j=${j} v=${v}`,
            );
            assertPointClose(
              rotate(qR[v], 120, origin),
              qL[v],
              `R->L rot n=${n} i=${i} j=${j} v=${v}`,
            );
            assertPointClose(
              rotate(qL[v], 120, origin),
              qT[v],
              `L->T rot n=${n} i=${i} j=${j} v=${v}`,
            );
          }
        }
      }
    }
  }
});

// ── (2) 3면 모듈이 실루엣 육각형을 정확히 3n² 개로 분할 ────────────────────

test('3면 모듈 넓이 합 = 육각형 넓이, 개수 = 3n^2', () => {
  for (const layout of LAYOUTS) {
    const norm = normalizeLayout(layout);
    for (const n of N_VALUES) {
      let totalArea = 0;
      let count = 0;
      for (const face of YFACES) {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const quad = moduleQuad(face, i, j, layout);
            totalArea += shoelaceArea(quad);
            count++;
          }
        }
      }
      assert.equal(count, 3 * n * n, `모듈 개수 n=${n}`);
      const expectedArea = hexArea(n * norm.size);
      assertClose(totalArea, expectedArea, `넓이 합 n=${n} size=${norm.size}`);
    }
  }
});

// ── (3) (0,0) 모듈이 Y-심에 접함 ────────────────────────────────────────────

test('(0,0) 모듈의 Y심측 꼭짓점 = Y-심(layout 원점)', () => {
  for (const layout of LAYOUTS) {
    const norm = normalizeLayout(layout);
    for (const face of YFACES) {
      const quad = moduleQuad(face, 0, 0, layout);
      assertPointClose(
        quad[0],
        { x: norm.originX, y: norm.originY },
        `face=${face}`,
      );
      const center = moduleCenter(face, 0, 0, layout);
      // 중심도 Y-심에서 정확히 (0.5,0.5) 스팬만큼 — quad 내부에 있어야 한다.
      assert.ok(pointInConvexQuad(center, quad), `face=${face} 중심이 모듈 내부`);
    }
  }
});

// ── (4) 샘플 원판이 모듈 내부 ───────────────────────────────────────────────

test('샘플 원판 중심이 모듈 내부이고 반지름이 모든 변까지의 거리 이하', () => {
  for (const layout of LAYOUTS) {
    for (const n of N_VALUES) {
      for (const face of YFACES) {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const quad = moduleQuad(face, i, j, layout);
            const disc = moduleSampleDisc(face, i, j, layout);
            assert.ok(
              pointInConvexQuad({ x: disc.x, y: disc.y }, quad),
              `중심 내부 face=${face} i=${i} j=${j}`,
            );
            for (let e = 0; e < 4; e++) {
              const a = quad[e];
              const b = quad[(e + 1) % 4];
              const dist = distToLine({ x: disc.x, y: disc.y }, a, b);
              assert.ok(
                dist + 1e-9 >= disc.radius,
                `반지름 <= 변 거리 face=${face} i=${i} j=${j} edge=${e} dist=${dist} r=${disc.radius}`,
              );
            }
          }
        }
      }
    }
  }
});

// ── (5) cubeBounds 전 꼭짓점 스캔 대조 ──────────────────────────────────────

test('cubeBounds — 전 모듈 꼭짓점 전수 스캔과 일치', () => {
  for (const layout of LAYOUTS) {
    for (const n of N_VALUES) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const face of YFACES) {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            for (const p of moduleQuad(face, i, j, layout)) {
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
            }
          }
        }
      }
      const b = cubeBounds(n, layout);
      assertClose(b.minX, minX, `minX n=${n}`);
      assertClose(b.minY, minY, `minY n=${n}`);
      assertClose(b.maxX, maxX, `maxX n=${n}`);
      assertClose(b.maxY, maxY, `maxY n=${n}`);
      assertClose(b.width, maxX - minX, `width n=${n}`);
      assertClose(b.height, maxY - minY, `height n=${n}`);
    }
  }
});

test('layoutForCube 로 만든 레이아웃이 margin 만큼 캔버스에 정확히 들어맞음', () => {
  for (const n of N_VALUES) {
    const layout = layoutForCube(n, { size: 3, margin: 5 });
    const b = cubeBounds(n, layout);
    assertClose(b.minX, 5, `minX n=${n}`);
    assertClose(b.minY, 5, `minY n=${n}`);
    assertClose(b.maxX, layout.width - 5, `maxX n=${n}`);
    assertClose(b.maxY, layout.height - 5, `maxY n=${n}`);
  }

  // margin 기본값 = 2*size
  const layoutDefault = layoutForCube(3, { size: 4 });
  const layoutExplicit = layoutForCube(3, { size: 4, margin: 8 });
  assert.deepEqual(layoutDefault, layoutExplicit);
});

// ── (6) 결정성 (−0 정규화 포함) ─────────────────────────────────────────────

test('결정성 — 동일 입력 -> 동일 출력, -0 없음', () => {
  const layout = { size: 1, originX: 0, originY: 0 };
  for (const face of YFACES) {
    const q1 = moduleQuad(face, 0, 0, layout);
    const q2 = moduleQuad(face, 0, 0, layout);
    assert.deepEqual(q1, q2, `face=${face} 결정성`);
    for (const p of q1) {
      assert.ok(!Object.is(p.x, -0), `face=${face} x 가 -0 이면 안 됨: ${p.x}`);
      assert.ok(!Object.is(p.y, -0), `face=${face} y 가 -0 이면 안 됨: ${p.y}`);
    }
  }

  const c1 = moduleCenter('T', 2, 3, layout);
  const c2 = moduleCenter('T', 2, 3, layout);
  assert.deepEqual(c1, c2);

  const d1 = moduleSampleDisc('R', 1, 1, layout);
  const d2 = moduleSampleDisc('R', 1, 1, layout);
  assert.deepEqual(d1, d2);

  const b1 = cubeBounds(4, layout);
  const b2 = cubeBounds(4, layout);
  assert.deepEqual(b1, b2);
});

// ── faceBasis / 에러 처리 ───────────────────────────────────────────────────

test('faceBasis — 단위 벡터, 잘못된 면 라벨은 예외', () => {
  for (const face of YFACES) {
    const { ei, ej } = faceBasis(face);
    assertClose(Math.hypot(ei.x, ei.y), 1, `${face} ei 단위 벡터`);
    assertClose(Math.hypot(ej.x, ej.y), 1, `${face} ej 단위 벡터`);
  }
  assert.throws(() => faceBasis('X'), RangeError);
  assert.throws(() => moduleQuad('X', 0, 0), RangeError);
  assert.throws(() => moduleQuad('T', -1, 0), RangeError);
  assert.throws(() => moduleQuad('T', 0.5, 0), RangeError);
  assert.throws(() => cubeBounds(0), RangeError);
  assert.throws(() => cubeBounds(-1), RangeError);
});

// ── 축 규약 와이어 고정 (검증 라운드 major 대응) ─────────────────────────────
// 120° 공변성 테스트는 축 규약과 **독립**이다 — ei/ej 를 세 면 전부 스왑한 뮤테이션도
// 공변성·넓이·원점·경계 테스트를 전부 통과함이 사본 실험으로 실증됐다 (스왑본은 회전
// 대칭을 그대로 보존하기 때문). 아래 두 테스트가 규약 자체를 좌표 리터럴로 고정한다.

test('faceBasis KAT — SPEC §14 축 규약 좌표 고정 (i = 시계방향 이웃과의 공유 변)', () => {
  const H = Math.sqrt(3) / 2;
  const KAT = {
    T: { ei: { x: H, y: -0.5 }, ej: { x: -H, y: -0.5 } }, // ei=C1(우상), ej=C5(좌상)
    R: { ei: { x: 0, y: 1 }, ej: { x: H, y: -0.5 } }, //     ei=C3(하),   ej=C1(우상)
    L: { ei: { x: -H, y: -0.5 }, ej: { x: 0, y: 1 } }, //    ei=C5(좌상), ej=C3(하)
  };
  for (const face of YFACES) {
    const b = faceBasis(face);
    assertClose(b.ei.x, KAT[face].ei.x, `${face} ei.x`);
    assertClose(b.ei.y, KAT[face].ei.y, `${face} ei.y`);
    assertClose(b.ej.x, KAT[face].ej.x, `${face} ej.x`);
    assertClose(b.ej.y, KAT[face].ej.y, `${face} ej.y`);
  }
});

test('면 경계 인접성 — T(k,0)↔R(0,k) · R(k,0)↔L(0,k) · L(k,0)↔T(0,k) 가 변(꼭짓점 2개)을 공유한다', () => {
  const n = 5;
  const pairs = [['T', 'R'], ['R', 'L'], ['L', 'T']];
  for (const [a, b] of pairs) {
    for (let k = 0; k < n; k += 1) {
      const qa = moduleQuad(a, k, 0);
      const qb = moduleQuad(b, 0, k);
      let shared = 0;
      for (const pa of qa) {
        for (const pb of qb) {
          if (Math.abs(pa.x - pb.x) < EPS && Math.abs(pa.y - pb.y) < EPS) shared += 1;
        }
      }
      assert.equal(shared, 2, `${a}(${k},0) ↔ ${b}(0,${k}) 공유 꼭짓점 ${shared} ≠ 2`);
    }
  }
});
