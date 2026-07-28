/**
 * hexgrid.test.js — 육각 격자 + rhombille 분할 기하의 성질 검증
 *
 * 여기 있는 테스트는 대부분 **성질(property)** 을 검증한다. 다만 pointy-top 의
 * 꼭짓점 각도 규약만은 성질로 잡히지 않고(어떤 회전이든 "정육각형"은 맞으므로)
 * 틀려도 조용히 어긋나므로, 하드코딩된 기댓값으로 한 번 못 박는다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SQRT3,
  FACES,
  FACE_SPINE_CORNER,
  AXIAL_DIRECTIONS,
  CORNER_UNIT_OFFSETS,
  DEFAULT_LAYOUT,
  SAMPLE_FRACTION_MODES,
  normalizeLayout,
  hexDistance,
  isInRegion,
  cellCount,
  regionCells,
  neighbors,
  axialToPixel,
  pixelToAxialFractional,
  axialRound,
  pixelToAxial,
  hexArea,
  hexCornerOffset,
  hexCorners,
  faceArea,
  faceInradius,
  facePolygonOffsets,
  facePolygon,
  faceCentroidOffset,
  faceCentroid,
  faceIncircle,
  faceSampleDisc,
  cellSampleDiscs,
  codeBounds,
  layoutForRegion,
} from '../src/hexgrid.js';

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 전용 기하 헬퍼 (소스에 넣지 않는다 — 검증 도구지 런타임 코드가 아니다)
// ─────────────────────────────────────────────────────────────────────────────

const EPS = 1e-9;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 신발끈 공식. y-down 화면에서 양수면 화면상 시계방향. */
function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function polygonArea(poly) {
  return Math.abs(signedArea(poly));
}

function sideLengths(poly) {
  return poly.map((p, i) => dist(p, poly[(i + 1) % poly.length]));
}

/** 각 정점의 내각(도). */
function interiorAngles(poly) {
  return poly.map((p, i) => {
    const prev = poly[(i + poly.length - 1) % poly.length];
    const next = poly[(i + 1) % poly.length];
    const u = { x: prev.x - p.x, y: prev.y - p.y };
    const v = { x: next.x - p.x, y: next.y - p.y };
    const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
    return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  });
}

/** 점 → 선분 거리. */
function pointSegmentDistance(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** 점 → 폴리곤 각 변까지의 거리 목록. */
function edgeDistances(p, poly) {
  return poly.map((a, i) => pointSegmentDistance(p, a, poly[(i + 1) % poly.length]));
}

/** 볼록 폴리곤 내부/경계 판정 (감김 방향 무관). */
function pointInConvexPolygon(p, poly, eps = EPS) {
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross > eps) pos++;
    else if (cross < -eps) neg++;
  }
  return pos === 0 || neg === 0;
}

/** 축 하나에 폴리곤을 사영한 [min, max]. */
function projectOnto(poly, ax, ay) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/**
 * 분리축 정리(SAT)로 두 볼록 폴리곤의 **내부**가 서로소인지 판정.
 * 변을 공유하는 인접 마름모는 겹침 폭이 정확히 0 이므로 서로소로 판정된다.
 */
function convexInteriorsDisjoint(A, B, eps = EPS) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len === 0) continue;
      const ax = -ey / len;
      const ay = ex / len;
      const [aMin, aMax] = projectOnto(A, ax, ay);
      const [bMin, bMax] = projectOnto(B, ax, ay);
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap <= eps) return true;
    }
  }
  return false;
}

/** 결정적 의사난수 (LCG) — 몬테카를로 검증을 재현 가능하게. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('육각 영역 (SPEC §3.1)', () => {
  test('셀 수 = 3k² + 3k + 1 (k = 0..6)', () => {
    const expected = [1, 7, 19, 37, 61, 91, 127];
    for (let k = 0; k <= 6; k++) {
      assert.equal(cellCount(k), 3 * k * k + 3 * k + 1);
      assert.equal(cellCount(k), expected[k], `k=${k}`);
      assert.equal(regionCells(k).length, expected[k], `regionCells k=${k}`);
    }
  });

  test('V1(k=6) 은 SPEC §5.5 용량표의 127셀과 일치', () => {
    assert.equal(cellCount(6), 127);
  });

  test('영역 내 셀은 모두 유일하고 육각 거리 ≤ k', () => {
    for (let k = 0; k <= 6; k++) {
      const cells = regionCells(k);
      const seen = new Set();
      for (const { q, r } of cells) {
        const key = `${q},${r}`;
        assert.ok(!seen.has(key), `중복 셀 ${key} (k=${k})`);
        seen.add(key);
        assert.ok(hexDistance(q, r) <= k, `${key} 가 k=${k} 영역 밖`);
        assert.ok(isInRegion(q, r, k));
      }
    }
  });

  test('링 d 의 셀 수는 d=0 이면 1, 아니면 6d', () => {
    const k = 6;
    const counts = new Array(k + 1).fill(0);
    for (const { q, r } of regionCells(k)) counts[hexDistance(q, r)]++;
    assert.equal(counts[0], 1);
    for (let d = 1; d <= k; d++) assert.equal(counts[d], 6 * d, `링 ${d}`);
    assert.equal(
      counts.reduce((a, b) => a + b, 0),
      cellCount(k),
    );
  });

  test('regionCells 순서는 결정적', () => {
    assert.deepEqual(regionCells(3), regionCells(3));
    assert.deepEqual(regionCells(1), [
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: -1 },
      { q: 0, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: -1 },
      { q: 1, r: 0 },
    ]);
  });

  test('이웃 6개는 서로 다르고 모두 거리 1', () => {
    const ns = neighbors(2, -1);
    assert.equal(ns.length, 6);
    assert.equal(new Set(ns.map((n) => `${n.q},${n.r}`)).size, 6);
    for (const n of ns) assert.equal(hexDistance(n.q - 2, n.r + 1), 1);
    assert.equal(AXIAL_DIRECTIONS.length, 6);
  });

  test('음수 k 또는 비정수 k 는 거부', () => {
    assert.throws(() => cellCount(-1), RangeError);
    assert.throws(() => regionCells(1.5), RangeError);
  });
});

describe('pointy-top 꼭짓점 규약 (하드코딩 못 박기)', () => {
  const H = SQRT3 / 2; // 0.8660254037844386

  test('size=1, 중심 원점의 꼭짓점 6개는 정확히 이 값이다', () => {
    const got = hexCorners(0, 0, { size: 1 });
    const want = [
      { x: 0, y: -1 },
      { x: 0.8660254037844386, y: -0.5 },
      { x: 0.8660254037844386, y: 0.5 },
      { x: 0, y: 1 },
      { x: -0.8660254037844386, y: 0.5 },
      { x: -0.8660254037844386, y: -0.5 },
    ];
    assert.equal(got.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.ok(Math.abs(got[i].x - want[i].x) < 1e-15, `corner${i}.x = ${got[i].x}`);
      assert.ok(Math.abs(got[i].y - want[i].y) < 1e-15, `corner${i}.y = ${got[i].y}`);
    }
    assert.equal(H, 0.8660254037844386);
  });

  test('꼭짓점 0 은 화면 정위(y-down 에서 y = -size), 꼭짓점 3 은 정하', () => {
    const c = hexCorners(0, 0, { size: 12 });
    assert.equal(c[0].x, 0);
    assert.equal(c[0].y, -12);
    assert.equal(c[3].x, 0);
    assert.equal(c[3].y, 12);
  });

  test('폭 = √3·size, 높이 = 2·size (pointy-top 이므로 세로가 더 길다)', () => {
    const size = 7;
    const c = hexCorners(0, 0, { size });
    const xs = c.map((p) => p.x);
    const ys = c.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    assert.ok(Math.abs(w - SQRT3 * size) < 1e-12);
    assert.ok(Math.abs(h - 2 * size) < 1e-12);
    assert.ok(h > w);
  });

  test('origin/size 이동·확대가 정확히 반영된다', () => {
    const c = hexCorners(0, 0, { size: 10, originX: 100, originY: 200 });
    assert.ok(Math.abs(c[1].x - (100 + 8.660254037844386)) < 1e-12);
    assert.ok(Math.abs(c[1].y - 195) < 1e-12);
    assert.ok(Math.abs(c[0].y - 190) < 1e-12);
  });

  test('axialToPixel 하드코딩 기댓값 (pointy-top 규약 고정)', () => {
    const L = { size: 1 };
    const cases = [
      [0, 0, 0, 0],
      [1, 0, 1.7320508075688772, 0],
      [0, 1, 0.8660254037844386, 1.5],
      [1, -1, 0.8660254037844386, -1.5],
      [-1, 0, -1.7320508075688772, 0],
      [0, -1, -0.8660254037844386, -1.5],
    ];
    for (const [q, r, x, y] of cases) {
      const p = axialToPixel(q, r, L);
      assert.ok(Math.abs(p.x - x) < 1e-12, `(${q},${r}).x = ${p.x}, want ${x}`);
      assert.ok(Math.abs(p.y - y) < 1e-12, `(${q},${r}).y = ${p.y}, want ${y}`);
    }
  });

  test('r 증가는 화면 아래로(y 증가), q 증가는 오른쪽으로', () => {
    const L = { size: 1 };
    assert.ok(axialToPixel(0, 1, L).y > axialToPixel(0, 0, L).y);
    assert.ok(axialToPixel(1, 0, L).x > axialToPixel(0, 0, L).x);
    assert.equal(axialToPixel(1, 0, L).y, 0);
  });

  test('꼭짓점 6개는 중심에서 모두 등거리(= size)', () => {
    for (const size of [1, 3.5, 40]) {
      for (const { q, r } of regionCells(3)) {
        const c = axialToPixel(q, r, { size });
        for (const v of hexCorners(q, r, { size })) {
          assert.ok(Math.abs(dist(c, v) - size) < 1e-12, `(${q},${r}) size=${size}`);
        }
      }
    }
  });

  test('변 6개 길이도 모두 size 와 같다 (정육각형)', () => {
    const size = 5;
    for (const len of sideLengths(hexCorners(2, -1, { size }))) {
      assert.ok(Math.abs(len - size) < 1e-12);
    }
  });

  test('hexCornerOffset 은 인덱스를 mod 6 로 감는다', () => {
    assert.deepEqual(hexCornerOffset(6, 2), hexCornerOffset(0, 2));
    assert.deepEqual(hexCornerOffset(-1, 2), hexCornerOffset(5, 2));
    assert.equal(CORNER_UNIT_OFFSETS.length, 6);
  });
});

describe('격자 간격', () => {
  test('인접 육각형의 중심 간 거리는 모두 √3·size 로 동일', () => {
    const k = 5;
    const size = 9;
    const inRegion = new Set(regionCells(k).map((c) => `${c.q},${c.r}`));
    let pairs = 0;
    for (const { q, r } of regionCells(k)) {
      const c = axialToPixel(q, r, { size });
      for (const n of neighbors(q, r)) {
        if (!inRegion.has(`${n.q},${n.r}`)) continue;
        const nc = axialToPixel(n.q, n.r, { size });
        assert.ok(
          Math.abs(dist(c, nc) - SQRT3 * size) < 1e-12,
          `(${q},${r})-(${n.q},${n.r}) = ${dist(c, nc)}`,
        );
        pairs++;
      }
    }
    assert.ok(pairs > 0);
  });

  test('비인접 셀의 중심 거리는 항상 인접 거리보다 크다 (격자가 겹치지 않는다)', () => {
    const size = 4;
    const cells = regionCells(3);
    const spacing = SQRT3 * size;
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i];
        const b = cells[j];
        const d = dist(axialToPixel(a.q, a.r, { size }), axialToPixel(b.q, b.r, { size }));
        const hd = hexDistance(a.q - b.q, a.r - b.r);
        if (hd === 1) assert.ok(Math.abs(d - spacing) < 1e-12);
        else assert.ok(d > spacing + 1e-9, `${JSON.stringify(a)}-${JSON.stringify(b)}`);
      }
    }
  });
});

describe('좌표 왕복 (디코더용 역변환)', () => {
  const layouts = [
    { size: 1, originX: 0, originY: 0 },
    { size: 23.5, originX: 0, originY: 0 },
    { size: 8, originX: -137.25, originY: 411.75 },
  ];

  test('axial → 픽셀 → axial 이 k=0..6 전 셀에서 항등', () => {
    for (const layout of layouts) {
      for (let k = 0; k <= 6; k++) {
        for (const { q, r } of regionCells(k)) {
          const p = axialToPixel(q, r, layout);
          assert.deepStrictEqual(
            pixelToAxial(p.x, p.y, layout),
            { q, r },
            `k=${k} (${q},${r}) size=${layout.size}`,
          );
        }
      }
    }
  });

  test('실수 역변환은 반올림 전에도 원래 좌표를 복원', () => {
    const layout = layouts[2];
    for (const { q, r } of regionCells(4)) {
      const p = axialToPixel(q, r, layout);
      const f = pixelToAxialFractional(p.x, p.y, layout);
      assert.ok(Math.abs(f.q - q) < 1e-9, `q ${f.q} vs ${q}`);
      assert.ok(Math.abs(f.r - r) < 1e-9, `r ${f.r} vs ${r}`);
    }
  });

  test('셀 내부의 임의 점은 그 셀로 스냅된다 (면 중심·내접원 위 점 포함)', () => {
    const layout = { size: 16, originX: 30, originY: -12 };
    for (const { q, r } of regionCells(4)) {
      for (const face of FACES) {
        const inc = faceIncircle(q, r, face, layout);
        assert.deepStrictEqual(pixelToAxial(inc.x, inc.y, layout), { q, r });
        for (let a = 0; a < 8; a++) {
          const th = (a * Math.PI) / 4;
          const px = inc.x + inc.radius * 0.99 * Math.cos(th);
          const py = inc.y + inc.radius * 0.99 * Math.sin(th);
          assert.deepStrictEqual(
            pixelToAxial(px, py, layout),
            { q, r },
            `(${q},${r}) ${face} angle=${a}`,
          );
        }
      }
    }
  });

  test('무작위 점의 스냅 결과는 항상 가장 가까운 중심의 셀 (몬테카를로)', () => {
    const layout = { size: 11, originX: 5, originY: 7 };
    const k = 3;
    const cells = regionCells(k);
    const rng = makeRng(0xc0ffee);
    const b = codeBounds(k, layout);
    for (let i = 0; i < 4000; i++) {
      const x = b.minX + rng() * b.width;
      const y = b.minY + rng() * b.height;
      const snapped = pixelToAxial(x, y, layout);
      // 영역 밖으로 스냅될 수 있으므로, 영역 내 셀만 비교 대상으로 삼는다.
      if (hexDistance(snapped.q, snapped.r) > k) continue;
      let best = null;
      let bestD = Infinity;
      for (const c of cells) {
        const d = dist({ x, y }, axialToPixel(c.q, c.r, layout));
        if (d < bestD - 1e-9) {
          bestD = d;
          best = c;
        }
      }
      const snappedD = dist({ x, y }, axialToPixel(snapped.q, snapped.r, layout));
      assert.ok(
        snappedD <= bestD + 1e-6,
        `(${x},${y}) → (${snapped.q},${snapped.r}) d=${snappedD}, 최근접 d=${bestD}`,
      );
      assert.ok(best !== null);
    }
  });

  test('axialRound 는 q+r+s=0 을 유지하고 -0 을 내지 않는다', () => {
    const rng = makeRng(42);
    for (let i = 0; i < 2000; i++) {
      const qf = (rng() - 0.5) * 20;
      const rf = (rng() - 0.5) * 20;
      const { q, r } = axialRound(qf, rf);
      assert.ok(Number.isInteger(q) && Number.isInteger(r));
      assert.ok(Number.isInteger(-q - r));
      assert.ok(!Object.is(q, -0), 'q 가 -0');
      assert.ok(!Object.is(r, -0), 'r 가 -0');
      // 반올림 오차는 각 축에서 1 미만
      assert.ok(Math.abs(q - qf) < 1);
      assert.ok(Math.abs(r - rf) < 1);
    }
    assert.deepStrictEqual(axialRound(-0.2, -0.2), { q: 0, r: 0 });
  });
});

describe('rhombille 분할 (SPEC §3.2)', () => {
  const size = 13;
  const layout = { size, originX: 4, originY: -9 };

  test('면은 정확히 T, L, R 셋', () => {
    assert.deepEqual([...FACES], ['T', 'L', 'R']);
    assert.deepEqual(FACE_SPINE_CORNER, { T: 0, L: 4, R: 2 });
    assert.throws(() => facePolygon(0, 0, 'X', layout), RangeError);
  });

  test('각 마름모는 4정점, 4변 길이가 모두 size 와 같다', () => {
    for (const { q, r } of regionCells(2)) {
      for (const face of FACES) {
        const poly = facePolygon(q, r, face, layout);
        assert.equal(poly.length, 4);
        const lens = sideLengths(poly);
        for (const len of lens) {
          assert.ok(
            Math.abs(len - size) < 1e-12,
            `(${q},${r}) ${face} 변 길이 ${len} ≠ ${size}`,
          );
        }
        // 4변 상호 동일 (계약을 두 번 다른 방식으로 확인)
        assert.ok(Math.max(...lens) - Math.min(...lens) < 1e-12);
      }
    }
  });

  test('내각은 120°/60°/120°/60° — 60°/120° 마름모다', () => {
    for (const face of FACES) {
      const angles = interiorAngles(facePolygon(1, -1, face, layout));
      const want = [120, 60, 120, 60];
      for (let i = 0; i < 4; i++) {
        assert.ok(
          Math.abs(angles[i] - want[i]) < 1e-9,
          `${face} 정점${i} 내각 ${angles[i]}° ≠ ${want[i]}°`,
        );
      }
      assert.ok(Math.abs(angles.reduce((a, b) => a + b, 0) - 360) < 1e-9);
    }
  });

  test('마름모 넓이 = (√3/2)·size², 세 면 합 = 육각형 넓이', () => {
    const hexA = hexArea(size);
    for (const { q, r } of regionCells(2)) {
      let sum = 0;
      for (const face of FACES) {
        const a = polygonArea(facePolygon(q, r, face, layout));
        assert.ok(Math.abs(a - faceArea(size)) < 1e-9, `${face} 넓이 ${a}`);
        sum += a;
      }
      assert.ok(
        Math.abs(sum - hexA) < 1e-9,
        `(${q},${r}) 면적 합 ${sum} ≠ 육각형 ${hexA}`,
      );
      // 육각형 폴리곤 자체의 넓이와도 대조 (공식이 아니라 실제 폴리곤)
      assert.ok(Math.abs(polygonArea(hexCorners(q, r, layout)) - hexA) < 1e-9);
    }
  });

  test('세 마름모는 서로 내부가 겹치지 않는다 (SAT)', () => {
    for (const { q, r } of regionCells(2)) {
      const polys = FACES.map((f) => facePolygon(q, r, f, layout));
      for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) {
          assert.ok(
            convexInteriorsDisjoint(polys[i], polys[j]),
            `(${q},${r}) ${FACES[i]} ∩ ${FACES[j]} 내부가 겹친다`,
          );
        }
      }
    }
  });

  test('세 마름모의 모든 정점은 육각형 안에 있다', () => {
    const hex = hexCorners(0, 1, layout);
    for (const face of FACES) {
      for (const p of facePolygon(0, 1, face, layout)) {
        assert.ok(pointInConvexPolygon(p, hex, 1e-9), `${face} 정점 ${JSON.stringify(p)}`);
      }
    }
  });

  test('육각형 내부 임의 점은 정확히 한 마름모에만 속한다 (빈틈·겹침 없음)', () => {
    const q = -1;
    const r = 2;
    const hex = hexCorners(q, r, layout);
    const polys = FACES.map((f) => facePolygon(q, r, f, layout));
    const c = axialToPixel(q, r, layout);
    const rng = makeRng(0x5eed);
    let tested = 0;
    for (let i = 0; i < 6000; i++) {
      const x = c.x + (rng() * 2 - 1) * size;
      const y = c.y + (rng() * 2 - 1) * size;
      const p = { x, y };
      // 경계 근처(어느 마름모 변에서 tol 이내)는 판정이 모호하므로 건너뛴다.
      const tol = 1e-6 * size;
      const nearEdge = polys.some((poly) => Math.min(...edgeDistances(p, poly)) < tol);
      if (nearEdge) continue;
      const inside = polys.filter((poly) => pointInConvexPolygon(p, poly, 0));
      if (pointInConvexPolygon(p, hex, 0)) {
        assert.equal(inside.length, 1, `육각형 안 점 ${x},${y} 이 ${inside.length}개 면에 속함`);
        tested++;
      } else {
        assert.equal(inside.length, 0, `육각형 밖 점 ${x},${y} 이 마름모 안에 있음`);
      }
    }
    assert.ok(tested > 1000, `유효 표본 ${tested}개 — 너무 적다`);
  });

  test('면 오프셋은 모든 셀에서 동일 — 셀별 회전 없음 (SPEC §3.2)', () => {
    const ref = FACES.map((f) => facePolygonOffsets(f, size));
    for (const { q, r } of regionCells(4)) {
      const c = axialToPixel(q, r, layout);
      FACES.forEach((face, fi) => {
        const poly = facePolygon(q, r, face, layout);
        poly.forEach((p, pi) => {
          assert.ok(Math.abs(p.x - c.x - ref[fi][pi].x) < 1e-12, `(${q},${r}) ${face}`);
          assert.ok(Math.abs(p.y - c.y - ref[fi][pi].y) < 1e-12, `(${q},${r}) ${face}`);
        });
      });
    }
  });

  test('세 마름모의 감김 방향이 서로 같다 (렌더러 fill 규칙 일관성)', () => {
    const areas = FACES.map((f) => signedArea(facePolygon(0, 0, f, layout)));
    assert.ok(areas.every((a) => a > 0) || areas.every((a) => a < 0), JSON.stringify(areas));
  });
});

describe('면 라벨 T/L/R 의 화면 방향 (y-down)', () => {
  const layout = { size: 20, originX: 300, originY: 250 };
  const q = 1;
  const r = -2;
  const c = axialToPixel(q, r, layout);
  const cen = Object.fromEntries(FACES.map((f) => [f, faceCentroid(q, r, f, layout)]));

  test('T 는 위, L 은 좌하, R 은 우하', () => {
    // T: 정확히 수직 위
    assert.ok(Math.abs(cen.T.x - c.x) < 1e-12, `T.x 가 중심과 어긋남: ${cen.T.x - c.x}`);
    assert.ok(cen.T.y < c.y - 1e-9, 'T 가 위에 있지 않다');
    // L: 왼쪽 + 아래
    assert.ok(cen.L.x < c.x - 1e-9, 'L 이 왼쪽에 있지 않다');
    assert.ok(cen.L.y > c.y + 1e-9, 'L 이 아래에 있지 않다');
    // R: 오른쪽 + 아래
    assert.ok(cen.R.x > c.x + 1e-9, 'R 이 오른쪽에 있지 않다');
    assert.ok(cen.R.y > c.y + 1e-9, 'R 이 아래에 있지 않다');
  });

  test('T 가 최상단, L 이 최좌측, R 이 최우측', () => {
    assert.ok(cen.T.y < cen.L.y && cen.T.y < cen.R.y);
    assert.ok(cen.L.x < cen.T.x && cen.L.x < cen.R.x);
    assert.ok(cen.R.x > cen.T.x && cen.R.x > cen.L.x);
  });

  test('L 과 R 은 수직축 기준 좌우 대칭, 높이는 같다', () => {
    assert.ok(Math.abs(cen.L.y - cen.R.y) < 1e-12);
    assert.ok(Math.abs(cen.L.x - c.x + (cen.R.x - c.x)) < 1e-12);
  });

  test('세 면 중심은 중심에서 size/2 등거리 · 서로 120° 간격', () => {
    const size = layout.size;
    const angles = [];
    for (const f of FACES) {
      const d = dist(c, cen[f]);
      assert.ok(Math.abs(d - size / 2) < 1e-12, `${f} 거리 ${d}`);
      angles.push(Math.atan2(cen[f].y - c.y, cen[f].x - c.x));
    }
    const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const sorted = angles.map(norm).sort((a, b) => a - b);
    assert.ok(Math.abs(sorted[1] - sorted[0] - (2 * Math.PI) / 3) < 1e-12);
    assert.ok(Math.abs(sorted[2] - sorted[1] - (2 * Math.PI) / 3) < 1e-12);
  });

  test('T 의 spine 은 상단 꼭짓점, 긴 대각선은 수평 — 아이소메트릭 큐브 윗면', () => {
    const poly = facePolygon(q, r, 'T', layout);
    const spine = poly[2]; // [중심, prev, spine, next]
    assert.ok(Math.abs(spine.x - c.x) < 1e-12);
    assert.ok(Math.abs(spine.y - (c.y - layout.size)) < 1e-12);
    // 긴 대각선 = poly[1] ↔ poly[3]
    assert.ok(Math.abs(poly[1].y - poly[3].y) < 1e-12, '윗면 긴 대각선이 수평이 아니다');
    assert.ok(Math.abs(dist(poly[1], poly[3]) - SQRT3 * layout.size) < 1e-12);
  });

  test('면 중심 오프셋은 layout origin 과 무관 (순수 오프셋)', () => {
    for (const f of FACES) {
      const o = faceCentroidOffset(f, layout.size);
      assert.ok(Math.abs(cen[f].x - c.x - o.x) < 1e-12);
      assert.ok(Math.abs(cen[f].y - c.y - o.y) < 1e-12);
    }
  });
});

describe('내접원과 샘플링 영역 (SPEC §7.2)', () => {
  const size = 17;
  const layout = { size, originX: -60, originY: 40 };

  test('내접원 반지름 = (√3/4)·size, 네 변까지 거리가 모두 그 값', () => {
    for (const { q, r } of regionCells(2)) {
      for (const face of FACES) {
        const inc = faceIncircle(q, r, face, layout);
        assert.ok(Math.abs(inc.radius - (SQRT3 / 4) * size) < 1e-12);
        assert.ok(Math.abs(inc.radius - faceInradius(size)) < 1e-12);
        const ds = edgeDistances({ x: inc.x, y: inc.y }, facePolygon(q, r, face, layout));
        for (const d of ds) {
          assert.ok(
            Math.abs(d - inc.radius) < 1e-9,
            `(${q},${r}) ${face} 변까지 ${d} ≠ 내접원 ${inc.radius}`,
          );
        }
      }
    }
  });

  test('내접원은 마름모 안에 완전히 들어간다 (경계 위 점까지 포함)', () => {
    const poly = facePolygon(0, 0, 'L', layout);
    const inc = faceIncircle(0, 0, 'L', layout);
    for (let i = 0; i < 360; i++) {
      const th = (i * Math.PI) / 180;
      const p = {
        x: inc.x + inc.radius * Math.cos(th),
        y: inc.y + inc.radius * Math.sin(th),
      };
      assert.ok(pointInConvexPolygon(p, poly, 1e-9), `각도 ${i}° 에서 내접원이 삐져나감`);
    }
  });

  test('내접원 넓이는 마름모 넓이보다 작다 (자명하지만 계수 오타 방지)', () => {
    assert.ok(Math.PI * faceInradius(size) ** 2 < faceArea(size));
  });

  test('기본 샘플 원판은 반지름 비율 50% (기본값 계약)', () => {
    const d = faceSampleDisc(0, 0, 'T', layout);
    assert.ok(Math.abs(d.radius - 0.5 * faceInradius(size)) < 1e-12);
    assert.equal(d.clamped, false);
    const c = faceCentroid(0, 0, 'T', layout);
    assert.ok(Math.abs(d.x - c.x) < 1e-12 && Math.abs(d.y - c.y) < 1e-12);
  });

  test('세 해석 모드가 각각 정의대로 계산된다', () => {
    const inr = faceInradius(size);
    const byRadius = faceSampleDisc(0, 0, 'T', layout, { fraction: 0.5, fractionOf: 'radius' });
    const byIncArea = faceSampleDisc(0, 0, 'T', layout, {
      fraction: 0.5,
      fractionOf: 'incircleArea',
    });
    const byFaceArea = faceSampleDisc(0, 0, 'T', layout, {
      fraction: 0.5,
      fractionOf: 'faceArea',
    });
    assert.ok(Math.abs(byRadius.radius - 0.5 * inr) < 1e-12);
    // 넓이 비율 50% ⇒ 반지름 비율 1/√2
    assert.ok(Math.abs(Math.PI * byIncArea.radius ** 2 - 0.5 * Math.PI * inr ** 2) < 1e-9);
    assert.ok(Math.abs(Math.PI * byFaceArea.radius ** 2 - 0.5 * faceArea(size)) < 1e-9);
    // 셋은 서로 다른 값 — 이 모호성이 실제로 결과를 가른다는 증거.
    // 반지름비 0.5 (0.2165·size) < 내접원넓이비 (0.3062·size) < 면넓이비 (0.3713·size)
    assert.ok(byRadius.radius < byIncArea.radius);
    assert.ok(byIncArea.radius < byFaceArea.radius);
    // 최댓값조차 내접원 안 — 셋 다 마름모를 벗어나지 않는다
    assert.ok(byFaceArea.radius < inr);
  });

  test('어떤 fraction/모드에서도 샘플 원판은 내접원을 넘지 않는다', () => {
    const inr = faceInradius(size);
    for (const mode of SAMPLE_FRACTION_MODES) {
      for (const fraction of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const d = faceSampleDisc(0, 0, 'R', layout, { fraction, fractionOf: mode });
        assert.ok(d.radius > 0);
        assert.ok(d.radius <= inr + 1e-12, `${mode} f=${fraction} r=${d.radius} > ${inr}`);
      }
    }
    // faceArea 모드의 fraction=1 은 내접원을 넘으므로 클램프되어야 한다
    const full = faceSampleDisc(0, 0, 'R', layout, { fraction: 1, fractionOf: 'faceArea' });
    assert.equal(full.clamped, true);
    assert.ok(Math.abs(full.radius - inr) < 1e-12);
  });

  test('샘플 원판 전체가 마름모 내부에 있다 (전 셀 · 전 면)', () => {
    for (const { q, r } of regionCells(3)) {
      const discs = cellSampleDiscs(q, r, layout);
      for (const face of FACES) {
        const poly = facePolygon(q, r, face, layout);
        const d = discs[face];
        const ds = edgeDistances({ x: d.x, y: d.y }, poly);
        for (const e of ds) {
          assert.ok(e >= d.radius - 1e-9, `(${q},${r}) ${face}: 변까지 ${e} < 반지름 ${d.radius}`);
        }
      }
    }
  });

  test('같은 셀의 세 샘플 원판은 서로 겹치지 않는다', () => {
    const discs = cellSampleDiscs(2, -1, layout, { fraction: 1, fractionOf: 'incircleArea' });
    const arr = FACES.map((f) => discs[f]);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        assert.ok(
          dist(arr[i], arr[j]) >= arr[i].radius + arr[j].radius - 1e-9,
          `${FACES[i]}·${FACES[j]} 샘플 원판이 겹친다`,
        );
      }
    }
  });

  test('잘못된 fraction / 모드는 거부', () => {
    assert.throws(() => faceSampleDisc(0, 0, 'T', layout, { fraction: 0 }), RangeError);
    assert.throws(() => faceSampleDisc(0, 0, 'T', layout, { fraction: 1.5 }), RangeError);
    assert.throws(() => faceSampleDisc(0, 0, 'T', layout, { fractionOf: 'nope' }), RangeError);
  });
});

describe('바운딩 박스', () => {
  test('닫힌 형태 결과가 전 셀 꼭짓점 전수 조사와 일치 (k=0..6)', () => {
    const layout = { size: 6.5, originX: 21, originY: -13 };
    for (let k = 0; k <= 6; k++) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const { q, r } of regionCells(k)) {
        for (const v of hexCorners(q, r, layout)) {
          if (v.x < minX) minX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.x > maxX) maxX = v.x;
          if (v.y > maxY) maxY = v.y;
        }
      }
      const b = codeBounds(k, layout);
      assert.ok(Math.abs(b.minX - minX) < 1e-9, `k=${k} minX ${b.minX} vs ${minX}`);
      assert.ok(Math.abs(b.minY - minY) < 1e-9, `k=${k} minY ${b.minY} vs ${minY}`);
      assert.ok(Math.abs(b.maxX - maxX) < 1e-9, `k=${k} maxX ${b.maxX} vs ${maxX}`);
      assert.ok(Math.abs(b.maxY - maxY) < 1e-9, `k=${k} maxY ${b.maxY} vs ${maxY}`);
      assert.ok(Math.abs(b.width - (maxX - minX)) < 1e-9);
      assert.ok(Math.abs(b.height - (maxY - minY)) < 1e-9);
    }
  });

  test('k=0 은 육각형 하나: 폭 √3·size, 높이 2·size', () => {
    const b = codeBounds(0, { size: 10 });
    assert.ok(Math.abs(b.width - SQRT3 * 10) < 1e-12);
    assert.ok(Math.abs(b.height - 20) < 1e-12);
  });

  test('셀 하나는 세로로 길지만, 육각 영역은 k≥1 부터 가로로 넓다', () => {
    // 육각형 자체는 pointy-top 이라 세로가 길다 (2 vs √3).
    const one = codeBounds(0, { size: 1 });
    assert.ok(one.height > one.width);
    // 그런데 육각 *영역* 은 반대다: 폭 √3(2k+1) vs 높이 (3k+2).
    // 렌더러가 캔버스를 세로로 잡으면 코드가 잘린다 — 여기서 못 박아 둔다.
    for (let k = 1; k <= 12; k++) {
      const b = codeBounds(k, { size: 1 });
      assert.ok(Math.abs(b.width - SQRT3 * (2 * k + 1)) < 1e-12, `k=${k} width`);
      assert.ok(Math.abs(b.height - (3 * k + 2)) < 1e-12, `k=${k} height`);
      assert.ok(b.width > b.height, `k=${k}: ${b.width} vs ${b.height}`);
    }
    // 종횡비는 k→∞ 에서 2/√3 ≈ 1.1547 로 수렴
    const far = codeBounds(100000, { size: 1 });
    assert.ok(Math.abs(far.width / far.height - 2 / SQRT3) < 1e-4);
  });

  test('layoutForRegion: 코드가 여백 안쪽에 정확히 들어간다', () => {
    for (const k of [0, 1, 6, 8]) {
      for (const margin of [0, 12.5]) {
        const L = layoutForRegion(k, { size: 9, margin });
        const b = codeBounds(k, L);
        assert.ok(Math.abs(b.minX - margin) < 1e-9, `k=${k} minX=${b.minX}`);
        assert.ok(Math.abs(b.minY - margin) < 1e-9, `k=${k} minY=${b.minY}`);
        assert.ok(Math.abs(b.maxX - (L.width - margin)) < 1e-9);
        assert.ok(Math.abs(b.maxY - (L.height - margin)) < 1e-9);
        // 모든 셀의 모든 꼭짓점이 캔버스 안
        for (const { q, r } of regionCells(k)) {
          for (const v of hexCorners(q, r, L)) {
            assert.ok(v.x >= -1e-9 && v.x <= L.width + 1e-9, `x=${v.x}`);
            assert.ok(v.y >= -1e-9 && v.y <= L.height + 1e-9, `y=${v.y}`);
          }
        }
      }
    }
  });

  test('layoutForRegion 결과는 그대로 layout 으로 쓸 수 있다', () => {
    const L = layoutForRegion(2, { size: 5, margin: 3 });
    const n = normalizeLayout(L);
    assert.equal(n.size, 5);
    assert.equal(n.originX, L.originX);
    assert.equal(n.originY, L.originY);
    assert.ok(Number.isFinite(axialToPixel(0, 0, L).x));
  });

  test('바운딩 박스는 size 에 선형, origin 이동에 평행이동', () => {
    const a = codeBounds(4, { size: 1 });
    const b = codeBounds(4, { size: 3 });
    assert.ok(Math.abs(b.width - 3 * a.width) < 1e-9);
    assert.ok(Math.abs(b.height - 3 * a.height) < 1e-9);
    const c = codeBounds(4, { size: 1, originX: 100, originY: -50 });
    assert.ok(Math.abs(c.minX - (a.minX + 100)) < 1e-9);
    assert.ok(Math.abs(c.minY - (a.minY - 50)) < 1e-9);
    assert.ok(Math.abs(c.width - a.width) < 1e-9);
  });
});

describe('레이아웃 검증', () => {
  test('기본 레이아웃은 size=1, 원점 (0,0)', () => {
    assert.deepEqual({ ...DEFAULT_LAYOUT }, { size: 1, originX: 0, originY: 0 });
    assert.deepEqual(normalizeLayout(undefined), DEFAULT_LAYOUT);
    assert.deepEqual(normalizeLayout(null), DEFAULT_LAYOUT);
    assert.deepEqual(normalizeLayout({}), { size: 1, originX: 0, originY: 0 });
  });

  test('비정상 size / origin 은 거부', () => {
    assert.throws(() => normalizeLayout({ size: 0 }), RangeError);
    assert.throws(() => normalizeLayout({ size: -3 }), RangeError);
    assert.throws(() => normalizeLayout({ size: NaN }), RangeError);
    assert.throws(() => normalizeLayout({ size: 1, originX: Infinity }), RangeError);
    assert.throws(() => layoutForRegion(2, { margin: -1 }), RangeError);
    assert.throws(() => layoutForRegion(2, { size: 0 }), RangeError);
  });

  test('상수는 변경 불가 (전역 방향 기준이 런타임에 흔들리면 안 된다)', () => {
    assert.ok(Object.isFrozen(FACES));
    assert.ok(Object.isFrozen(FACE_SPINE_CORNER));
    assert.ok(Object.isFrozen(CORNER_UNIT_OFFSETS));
    assert.ok(Object.isFrozen(CORNER_UNIT_OFFSETS[0]));
    assert.ok(Object.isFrozen(AXIAL_DIRECTIONS));
  });
});
