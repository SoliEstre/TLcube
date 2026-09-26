// square-cell-style.test.js — 사각 셀 스타일 9종 (H = QR 공유) 기하 계약 (DESIGN_001 §3.3 · §4.1 · §7.5)
//
// 재는 것은 «값» 이 아니라 «성질» 이다:
//   ① 모든 스타일 × 모든 mask(256)의 윤곽이 셀 중심을 품고, 중심 여유가 표의 c 와 호 근사
//      오차 안에서 같다(표가 기하를 과장하지도 축소하지도 않는다).
//   ② 이웃 규칙 단위 사례(qr-code-styling dot 규칙과 같은 뜻 — 설계 §3.3 표 문장 그대로).
//   ③ styleSafety · verifyStyleSafety 가 심은 결함(C_MIN 미달 · 표–기하 불일치)을 거부한다.
//   ④ rasterCellCoverage 가 cellContours 와 같은 면적을 낸다(같은 다각형을 칠한다).
//   ⑤ styledGridShapes: tags 필수(QR 은 selfQuiet · noSeam), 실제 qrMatrix 를 폈을 때 모든
//      어두운 모듈 중심은 그 모듈 색으로, 모든 밝은 모듈 중심은 **아무 조각도 덮지 않는다**
//      (liquid 오목 필렛 포함) — 디코더가 모듈 중심을 보는 한 스타일이 비트를 바꾸지 않는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SQUARE_CELL_STYLES,
  NEIGHBOR_BITS,
  STYLE_CENTER_CLEARANCE,
  C_MIN,
  INSET_SCALE,
  ARC_SEGMENT_CHOICES,
  cellContours,
  liquidConcaveContours,
  cellSvgPath,
  rasterCellCoverage,
  rasterContoursCoverage,
  neighborMask,
  styleSafety,
  verifyStyleSafety,
  arcChordTolerance,
  styledGridShapes,
} from '../src/square-cell-style.js';
import { qrMatrix, TL_READER_URL, tlReaderUrlWithHint } from '../src/qr.js';
import { qrModuleRole, qrModuleColor } from '../src/qr-function-map.js';

const { N, E, S, W, NE, SE, SW, NW } = NEIGHBOR_BITS;
const ALL_MASKS = Array.from({ length: 256 }, (_, i) => i);

// ── 독립 기하 도구 (모듈 내부를 쓰지 않는다) ────────────────────────────────

function inside(px, py, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > py) !== (b.y > py) && px < a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y)) c = !c;
  }
  return c;
}

function area(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(s) / 2;
}

function perimeter(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    s += Math.sqrt((pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2);
  }
  return s;
}

function segDist(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, l2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.sqrt((a.x + t * dx - px) ** 2 + (a.y + t * dy - py) ** 2);
}

function clearance(pts) {
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) d = Math.min(d, segDist(0.5, 0.5, pts[j], pts[i]));
  return d;
}

function hasVertex(pts, x, y) {
  return pts.some((p) => Math.abs(p.x - x) < 1e-12 && Math.abs(p.y - y) < 1e-12);
}

function allAtDistance(pts, cx, cy, r) {
  return pts.every((p) => Math.abs(Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2) - r) < 1e-12);
}

const only = (style, mask) => {
  const cs = cellContours(style, mask);
  assert.equal(cs.length, 1, `${style} mask ${mask}: 윤곽 1개`);
  return cs[0];
};

// ── ① 중심 포함 · 중심 여유 ────────────────────────────────────────────────

test('모든 스타일 × 256 mask: 윤곽이 [0,1]² 안에 있고 셀 중심을 품으며, 최소 중심 여유가 표의 c 와 같다', () => {
  const tol = arcChordTolerance();
  assert.deepEqual(Object.keys(STYLE_CENTER_CLEARANCE).sort(), [...SQUARE_CELL_STYLES].sort());
  for (const style of SQUARE_CELL_STYLES) {
    let min = Infinity;
    for (const mask of ALL_MASKS) {
      const pts = only(style, mask);
      assert.ok(pts.every((p) => p.x >= -1e-12 && p.x <= 1 + 1e-12 && p.y >= -1e-12 && p.y <= 1 + 1e-12),
        `${style} mask ${mask}: 셀 밖 꼭짓점`);
      assert.ok(inside(0.5, 0.5, pts), `${style} mask ${mask}: 중심 미포함`);
      const d = clearance(pts);
      assert.ok(d >= STYLE_CENTER_CLEARANCE[style] - tol, `${style} mask ${mask}: 여유 ${d} < c`);
      min = Math.min(min, d);
    }
    assert.ok(Math.abs(min - STYLE_CENTER_CLEARANCE[style]) <= tol,
      `${style}: 잰 최소 여유 ${min} ≠ 표 c ${STYLE_CENTER_CLEARANCE[style]}`);
    assert.ok(STYLE_CENTER_CLEARANCE[style] >= C_MIN);
  }
  // 설계 §3.3 표 숫자(3자리)와 같은지 — 닫힌 형태 값이 표를 대표한다.
  const approx = { square: 0.5, rounded: 0.5, dots: 0.5, classy: 0.5, liquid: 0.5,
    'extra-rounded': 0.293, diamond: 0.354, 'classy-rounded': 0.293, inset: 0.4 };
  for (const [style, c] of Object.entries(approx)) {
    assert.ok(Math.abs(STYLE_CENTER_CLEARANCE[style] - c) < 5e-4, `${style} c`);
  }
});

test('대각 비트는 자기 도형에 영향이 없다 · 이웃 무관 스타일은 mask 무관 · 결정적', () => {
  for (const style of SQUARE_CELL_STYLES) {
    for (const mask of ALL_MASKS) {
      assert.deepEqual(cellContours(style, mask), cellContours(style, mask & 15), `${style} mask ${mask}`);
      assert.deepEqual(cellContours(style, mask), cellContours(style, mask), '결정성');
    }
  }
  for (const style of ['square', 'dots', 'diamond', 'inset']) {
    for (let mask = 1; mask < 16; mask += 1) assert.deepEqual(cellContours(style, mask), cellContours(style, 0), style);
  }
});

// ── ② 이웃 규칙 단위 사례 ──────────────────────────────────────────────────

test('rounded: 이웃 0 → 원 · 1 → 반대쪽 반원 · 직각 2 → 이웃 없는 코너 1개 · 마주보는 2 / 3+ → 사각', () => {
  assert.ok(allAtDistance(only('rounded', 0), 0.5, 0.5, 0.5), '원 r=½');
  const n = only('rounded', N);
  assert.ok(hasVertex(n, 0, 0) && hasVertex(n, 1, 0), 'N 쪽 반은 사각');
  assert.ok(!hasVertex(n, 0, 1) && !hasVertex(n, 1, 1), 'S 쪽은 반원');
  assert.ok(allAtDistance(n.filter((p) => p.y > 0.5 + 1e-12), 0.5, 0.5, 0.5), 'S 반원 r=½');
  const ne = only('rounded', N | E);
  assert.ok(hasVertex(ne, 0, 0) && hasVertex(ne, 1, 0) && hasVertex(ne, 1, 1) && !hasVertex(ne, 0, 1), 'SW 만 둥글다');
  for (const mask of [N | S, E | W, N | E | S, N | E | S | W]) assert.equal(only('rounded', mask).length, 4, `mask ${mask} 사각`);
});

test('liquid 의 자기 도형은 rounded 와 같고, 차이는 오목 필렛뿐이다', () => {
  for (const mask of ALL_MASKS) assert.deepEqual(cellContours('liquid', mask), cellContours('rounded', mask));
  assert.equal(liquidConcaveContours(N | W).length, 0, '대각 NW 없으면 필렛 없음');
  const tl = liquidConcaveContours(N | W | NW);
  assert.equal(tl.length, 1);
  assert.equal(tl[0].corner, 'TL');
  const all = liquidConcaveContours(255);
  assert.deepEqual(all.map((p) => p.corner).sort(), ['BL', 'BR', 'TL', 'TR']);
  // 필렛 4개 + 원(rounded mask 0)은 셀을 빈틈 · 겹침 없이 채운다(면적 합 = 1, 중심은 원 쪽).
  const sum = all.reduce((s, p) => s + area(p.contour), 0) + area(only('rounded', 0));
  assert.ok(Math.abs(sum - 1) < 1e-12, `면적 합 ${sum}`);
  for (const p of all) assert.ok(!inside(0.5, 0.5, p.contour), '필렛은 셀 중심을 덮지 않는다');
  // 코너 대응: 필렛은 자기 코너 사분면에만 있다.
  const quad = { TL: [0, 0], TR: [1, 0], BR: [1, 1], BL: [0, 1] };
  for (const p of all) {
    const [qx, qy] = quad[p.corner];
    assert.ok(p.contour.every((v) => Math.abs(v.x - qx) <= 0.5 + 1e-12 && Math.abs(v.y - qy) <= 0.5 + 1e-12), p.corner);
  }
  assert.ok(liquidConcaveContours(S | E | SE)[0].corner === 'BR' && liquidConcaveContours(N | E | NE)[0].corner === 'TR'
    && liquidConcaveContours(S | W | SW)[0].corner === 'BL');
});

test('extra-rounded: 직각 2 이웃 코너만 r=1(두 이웃이 만나는 코너 중심), 0 · 1 이웃은 rounded 와 같다', () => {
  for (const mask of [0, N, E, S, W, N | S, E | W, N | E | S]) {
    assert.deepEqual(cellContours('extra-rounded', mask), cellContours('rounded', mask), `mask ${mask}`);
  }
  const ne = only('extra-rounded', N | E);
  // SW 코너가 반지름 1 호(중심 = NE 코너 (1,0)) — 사분원.
  assert.ok(allAtDistance(ne.filter((p) => !(p.x === 1 && p.y === 0)), 1, 0, 1), 'NE 중심 반지름 1');
  // 현(弦) 근사라 중심 여유는 1−√½ 보다 호 근사 오차만큼 작을 수 있다(크지는 않다).
  const dNe = clearance(ne);
  assert.ok(dNe <= 1 - Math.SQRT1_2 + 1e-12 && dNe >= 1 - Math.SQRT1_2 - arcChordTolerance(), `중심 여유 ${dNe} ≈ 1−√½`);
});

test('classy: 좌·상 이웃 없으면 좌상, 우·하 이웃 없으면 우하를 깎는다 · classy-rounded 는 r=1', () => {
  const iso = only('classy', 0);
  assert.ok(hasVertex(iso, 1, 0) && hasVertex(iso, 0, 1) && !hasVertex(iso, 0, 0) && !hasVertex(iso, 1, 1));
  const w = only('classy', W);
  assert.ok(hasVertex(w, 0, 0) && !hasVertex(w, 1, 1), 'W 이웃 → 좌상 유지, 우하 깎음');
  const s = only('classy', S);
  assert.ok(!hasVertex(s, 0, 0) && hasVertex(s, 1, 1), 'S 이웃 → 좌상 깎음, 우하 유지');
  assert.equal(only('classy', N | E).length, 4, '좌·상, 우·하 모두 한쪽씩 이웃 → 사각');
  const lens = only('classy-rounded', 0);
  assert.ok(hasVertex(lens, 1, 0) && hasVertex(lens, 0, 1));
  const dLens = clearance(lens);
  assert.ok(dLens <= 1 - Math.SQRT1_2 + 1e-12 && dLens >= 1 - Math.SQRT1_2 - arcChordTolerance(), `${dLens}`);
});

test('diamond · inset · dots 정의', () => {
  const d = only('diamond', 0);
  for (const p of d) assert.ok(Math.abs(Math.abs(p.x - 0.5) + Math.abs(p.y - 0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(area(d) - 0.5) < 1e-12);
  const ins = only('inset', 0);
  assert.ok(Math.abs(area(ins) - INSET_SCALE * INSET_SCALE) < 1e-12);
  assert.ok(allAtDistance(only('dots', 15), 0.5, 0.5, 0.5));
});

test('neighborMask 는 방향 비트를 N1 E2 S4 W8 NE16 SE32 SW64 NW128 로 모은다', () => {
  const at = (r, c) => (dr, dc) => (nr, nc) => nr === r + dr && nc === c + dc;
  const cases = [[-1, 0, N], [0, 1, E], [1, 0, S], [0, -1, W], [-1, 1, NE], [1, 1, SE], [1, -1, SW], [-1, -1, NW]];
  for (const [dr, dc, bit] of cases) assert.equal(neighborMask(5, 5, at(5, 5)(dr, dc)), bit);
  assert.equal(neighborMask(0, 0, () => true), 255);
});

test('호 분할 수: 끝점 동일 · 분할이 늘면 원 면적에 단조 수렴 · 허용 밖은 거부', () => {
  let prev = 0;
  for (const segments of ARC_SEGMENT_CHOICES) {
    const pts = cellContours('dots', 0, { segments })[0];
    assert.equal(pts.length, 4 * segments);
    const a = area(pts);
    assert.ok(a > prev && a < Math.PI / 4, `segments ${segments}`);
    prev = a;
  }
  assert.throws(() => cellContours('dots', 0, { segments: 5 }), RangeError);
  // 1 분할은 r=1 호를 모서리→모서리 현으로 만들어 셀 중심을 잃는다 — 받지 않는다.
  assert.ok(!ARC_SEGMENT_CHOICES.includes(1));
  assert.throws(() => cellContours('extra-rounded', 9, { segments: 1 }), RangeError);
  assert.throws(() => styledGridShapes({
    rows: 1, cols: 1, style: 'classy-rounded', host: 'qr', role: () => 'data', color: () => ({ r: 0, g: 0, b: 0 }),
    map: (x, y) => ({ x, y }), tags: { selfQuiet: true, noSeam: true }, segments: 1,
  }), RangeError);
  assert.throws(() => cellContours('nope', 0), RangeError);
});

test('API 가 받는 분할 수 전부 × 모든 스타일 × 256 mask: 윤곽이 중심을 품고 잰 중심 여유 ≥ C_MIN (독립 기하로 잼)', () => {
  for (const segments of ARC_SEGMENT_CHOICES) {
    for (const style of SQUARE_CELL_STYLES) {
      for (const mask of ALL_MASKS) {
        const cs = cellContours(style, mask, { segments });
        const holding = cs.filter((pts) => inside(0.5, 0.5, pts));
        assert.ok(holding.length > 0, `${style} mask ${mask} seg ${segments}: 중심 미포함`);
        const d = Math.max(...holding.map(clearance));
        assert.ok(d >= C_MIN, `${style} mask ${mask} seg ${segments}: 여유 ${d} < C_MIN`);
      }
    }
    // 자기검증도 같은 분할 수에서 통과한다(로드 시 전부 돈다).
    verifyStyleSafety({ segments });
  }
  // 심은 결함 — 표의 c 는 하한을 넘지만 현으로 깎인 잰 값(segments 3 의 extra-rounded ≈ 0.2588)이
  // 하한 밑이면 ④ 로 거부한다. «표의 c ≥ cMin» 만 보던 때는 통과하던 경우다.
  assert.throws(() => verifyStyleSafety({
    table: { 'extra-rounded': STYLE_CENTER_CLEARANCE['extra-rounded'] }, segments: 3, cMin: 0.27,
  }), /잰 중심 여유/);
  assert.throws(() => cellContours('dots', 256), RangeError);
});

// ── ③ 심은 결함 ───────────────────────────────────────────────────────────

test('styleSafety: 표의 c 를 돌려주고, C_MIN 미달 스타일(심은 결함)을 거부한다', () => {
  for (const style of SQUARE_CELL_STYLES) assert.equal(styleSafety(style).c, STYLE_CENTER_CLEARANCE[style]);
  assert.throws(() => styleSafety('thin', { table: { thin: C_MIN - 0.01 } }), /C_MIN/);
  assert.throws(() => styleSafety('ghost'), RangeError);
});

test('verifyStyleSafety: 기본 표 통과 · C_MIN 미달 표 거부 · 표–기하 불일치(과장 · 축소) 거부 · 중심 미포함 거부', () => {
  const ok = verifyStyleSafety();
  assert.deepEqual(Object.keys(ok).sort(), [...SQUARE_CELL_STYLES].sort());
  // (a) 선언 c 가 하한 미만.
  assert.throws(() => verifyStyleSafety({ table: { diamond: 0.2 } }), /C_MIN/);
  // (b) 선언은 0.5 인데 실제 기하는 다이아몬드(0.354) — 표가 기하를 과장.
  assert.throws(() => verifyStyleSafety({
    table: { rounded: 0.5 }, contours: (s, m, o) => cellContours('diamond', m, o),
  }), /다르다/);
  // (c) 선언은 0.3 인데 실제 기하는 사각(0.5) — 표가 비관적이어도 틀린 표다.
  assert.throws(() => verifyStyleSafety({ table: { square: 0.3 } }), /다르다/);
  // (d) 중심을 비운 기하(고리 조각).
  assert.throws(() => verifyStyleSafety({
    table: { square: 0.5 }, contours: () => [[{ x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 0.4 }, { x: 0, y: 0.4 }]],
  }), /중심/);
});

// ── ④ 래스터 커버리지 ─────────────────────────────────────────────────────

test('rasterCellCoverage 의 면적이 cellContours 면적과 같다(부표본 격자 오차 안) · 중심 픽셀은 가득 · 값은 [0,1]', () => {
  const size = 16;
  const samples = 4;
  for (const style of SQUARE_CELL_STYLES) {
    for (let mask = 0; mask < 16; mask += 1) {
      const pts = only(style, mask);
      const cov = rasterCellCoverage(style, mask, size, { samples });
      assert.equal(cov.length, size * size);
      let sum = 0;
      for (const v of cov) {
        assert.ok(v >= 0 && v <= 1);
        sum += v;
      }
      const got = sum / (size * size);
      // 부표본 격자 한 칸 폭 h = 1/(size·samples): 경계가 지나는 칸만 틀릴 수 있어 오차 ≤ 둘레·h.
      const bound = perimeter(pts) / (size * samples);
      assert.ok(Math.abs(got - area(pts)) <= bound, `${style} mask ${mask}: ${got} vs ${area(pts)} (±${bound})`);
      const mid = size / 2;
      for (const [x, y] of [[mid - 1, mid - 1], [mid, mid - 1], [mid - 1, mid], [mid, mid]]) {
        assert.equal(cov[y * size + x], 1, `${style} mask ${mask}: 중심 픽셀`);
      }
    }
  }
  // 합집합: 원 + 필렛 4 = 셀 전체.
  const union = rasterContoursCoverage([only('rounded', 0), ...liquidConcaveContours(255).map((p) => p.contour)], 8);
  assert.ok(union.every((v) => v === 1));
  assert.throws(() => rasterCellCoverage('square', 0, 0), RangeError);
});

// ── cellSvgPath ──────────────────────────────────────────────────────────

test('cellSvgPath: 직선 점과 호 끝점이 cellContours 꼭짓점이고, 호 반지름이 코너 모형과 같다', () => {
  for (const style of SQUARE_CELL_STYLES) {
    for (let mask = 0; mask < 16; mask += 1) {
      const size = 10;
      const path = cellSvgPath(style, mask, { x: 2, y: 3, size });
      assert.match(path, /^M [^Z]+ Z$/);
      const pts = only(style, mask);
      const tokens = path.replace(/[MZ]/g, ' ').trim().split(/\s+/);
      let i = 0;
      const points = [];
      while (i < tokens.length) {
        if (tokens[i] === 'L') { i += 1; continue; }
        if (tokens[i] === 'A') {
          const rx = Number(tokens[i + 1]);
          assert.ok(rx === 5 || rx === 10, `${style} 호 반지름 ${rx}`);
          points.push([Number(tokens[i + 6]), Number(tokens[i + 7])]);
          i += 8;
          continue;
        }
        points.push([Number(tokens[i]), Number(tokens[i + 1])]);
        i += 2;
      }
      for (const [x, y] of points) {
        const lx = (x - 2) / size;
        const ly = (y - 3) / size;
        assert.ok(pts.some((p) => Math.abs(p.x - lx) < 1e-6 && Math.abs(p.y - ly) < 1e-6), `${style} mask ${mask}: (${lx},${ly})`);
      }
    }
  }
});

// ── ⑤ styledGridShapes ────────────────────────────────────────────────────

const ident = (x, y) => ({ x, y });
const BLACK = { r: 0, g: 0, b: 0 };
const EYE = { r: 10, g: 20, b: 60 };

test('styledGridShapes: tags · host 는 필수 — QR 호스트는 selfQuiet · noSeam 이 빠지면 던진다', () => {
  const base = { rows: 2, cols: 2, style: 'dots', role: () => 'data', color: () => BLACK, map: ident };
  assert.throws(() => styledGridShapes({ ...base, host: 'qr' }), /tags/);
  assert.throws(() => styledGridShapes({ ...base, host: 'qr', tags: { noSeam: true } }), /selfQuiet/);
  assert.throws(() => styledGridShapes({ ...base, host: 'qr', tags: { selfQuiet: true } }), /noSeam/);
  assert.throws(() => styledGridShapes({ ...base, host: 'qr', tags: { selfQuiet: 1, noSeam: true } }), /selfQuiet/);
  assert.throws(() => styledGridShapes({ ...base, tags: { selfQuiet: true, noSeam: true } }), /host/);
  assert.throws(() => styledGridShapes({ ...base, host: 'h', tags: {} }), /noSeam/);
  assert.throws(() => styledGridShapes({ ...base, host: 'h', tags: { noSeam: true, color: BLACK } }), /도형 필드/);
  // QR 표지를 단 호출자가 host 를 'h' 로 잘못 선언해 selfQuiet 요구를 피하는 경로는 막힌다.
  assert.throws(() => styledGridShapes({ ...base, host: 'h', tags: { noSeam: true, qr: true } }), /host/);
  const out =styledGridShapes({ ...base, host: 'qr', tags: { selfQuiet: true, noSeam: true, qr: true } });
  assert.ok(out.length > 0);
  for (const s of out) assert.ok(s.selfQuiet === true && s.noSeam === true && s.qr === true && s.kind === 'polygon');
  assert.ok(styledGridShapes({ ...base, host: 'h', tags: { noSeam: true } }).every((s) => s.noSeam === true && !('selfQuiet' in s)));
});

test('styledGridShapes: 모르는 역할은 던지고(fail-closed), fixed 는 사각, ground 는 맨 앞 한 장', () => {
  const tags = { noSeam: true };
  assert.throws(() => styledGridShapes({ rows: 1, cols: 1, style: 'dots', host: 'h', role: () => 'locator',
    color: () => BLACK, map: ident, tags }), /역할/);
  const G = { r: 120, g: 120, b: 120 };
  const out = styledGridShapes({ rows: 2, cols: 3, style: 'dots', host: 'h', tags, ground: G,
    role: (r, c) => (c === 0 ? 'fixed' : r === 0 ? 'data' : null), color: () => BLACK,
    map: (x, y) => ({ x: 10 + 2 * x, y: 20 + 2 * y }) });
  assert.deepEqual(out[0].points, [{ x: 10, y: 20 }, { x: 16, y: 20 }, { x: 16, y: 24 }, { x: 10, y: 24 }]);
  assert.deepEqual(out[0].color, G);
  const fixed = out.filter((s) => s.points.length === 4 && s !== out[0]);
  assert.equal(fixed.length, 2, '열 0 의 fixed 2칸은 사각');
  assert.equal(out.length, 1 + 2 + 2, 'ground + fixed 2 + data 2 (null 칸은 없음)');
});

const PAYLOADS = ['', 'A', TL_READER_URL, tlReaderUrlWithHint('Y'), tlReaderUrlWithHint('K'), 'HELLO WORLD 12345'];

test('실제 qrMatrix 를 9 스타일로 펴도: 어두운 모듈 중심은 그 모듈 색(눈은 eye), 밝은 모듈 중심은 어떤 조각도 덮지 않는다', () => {
  const tags = { selfQuiet: true, noSeam: true };
  const deco = { dark: BLACK, eye: EYE };
  for (const text of PAYLOADS) {
    const qr = qrMatrix(text);
    for (const style of SQUARE_CELL_STYLES) {
      const shapes = styledGridShapes({
        rows: qr.size, cols: qr.size, style, host: 'qr', tags, map: ident,
        role: (r, c) => qrModuleRole(qr, r, c), color: (r, c) => qrModuleColor(deco, r, c),
      });
      for (let r = 0; r < qr.size; r += 1) {
        for (let c = 0; c < qr.size; c += 1) {
          const hits = shapes.filter((s) => inside(c + 0.5, r + 0.5, s.points));
          if (qr.modules[r * qr.size + c] === 1) {
            assert.ok(hits.length >= 1, `${text}/${style}: 어두운 (${r},${c}) 중심 비었음`);
            const want = qrModuleColor(deco, r, c);
            assert.ok(hits.every((s) => s.color === want), `${text}/${style}: (${r},${c}) 색`);
          } else {
            assert.equal(hits.length, 0, `${text}/${style}: 밝은 (${r},${c}) 중심이 덮였다`);
          }
        }
      }
    }
  }
});

test('liquid 오목 필렛: 빈 칸 코너만 채우고, concave:false 면 rounded 와 같은 조각 수', () => {
  // 2×2 에서 좌상 빈칸, 나머지 셋이 한 덩어리 → 빈칸의 BR 코너 필렛 1개.
  const role = (r, c) => (r === 0 && c === 0 ? null : 'data');
  const args = { rows: 2, cols: 2, host: 'h', tags: { noSeam: true }, role, color: () => BLACK, map: ident };
  const liquid = styledGridShapes({ ...args, style: 'liquid' });
  const rounded = styledGridShapes({ ...args, style: 'rounded' });
  assert.equal(liquid.length, rounded.length + 1);
  const fillet = liquid[liquid.length - 1];
  assert.ok(fillet.points.every((p) => p.x >= 0.5 - 1e-12 && p.x <= 1 + 1e-12 && p.y >= 0.5 - 1e-12 && p.y <= 1 + 1e-12));
  assert.equal(styledGridShapes({ ...args, style: 'liquid', params: { concave: false } }).length, rounded.length);
  // 꽉 찬 한 덩어리(3×3 전부 data · 같은 색)에는 오목 코너가 없다 — 필렛 0개.
  const full = { ...args, rows: 3, cols: 3, role: () => 'data' };
  assert.equal(styledGridShapes({ ...full, style: 'liquid' }).length, styledGridShapes({ ...full, style: 'rounded' }).length);
  // H: 다른 레벨 셀 X 의 둥근 코너 틈을 덩어리 색 필렛이 채운다 — X 자신은 그 코너가 둥글다.
  const A = { r: 104, g: 104, b: 104 };
  const B = { r: 226, g: 226, b: 226 };
  const h = styledGridShapes({ rows: 2, cols: 2, host: 'h', tags: { noSeam: true }, style: 'liquid', map: ident,
    role: () => 'data', color: (r, c) => (r === 0 && c === 0 ? B : A) });
  const pieces = h.filter((s) => s.color === A && s.points.every((p) => p.x <= 1 + 1e-12 && p.y <= 1 + 1e-12));
  assert.equal(pieces.length, 1, 'X(0,0) 의 BR 코너 필렛 1개');
});
