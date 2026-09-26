// cell-shape-geometry.test.js — 마름모 셀 모양 모듈의 기하 · 등급 · 해석 계약 (DESIGN_001 §3.0–§3.2 · §3.4 · §7.5)
//
// 재는 것은 «값» 이 아니라 «성질» 이다:
//   ① 15° 닫힌 형태 표가 참 cos/sin 과 같다(삼각함수 없이 만든 표가 맞는가).
//   ② `faceGainColor` 가 정본 `sceneY.applyFaceGain` 과 비트 동일이다(사본이 어긋나면 빨개진다).
//   ③ 기하: f ≤ 1 이면 표본 원판(r_in·0.5)이 도형 안 · 내접원도 안(호를 15° 현으로 편
//      처짐 한계까지) · 호의 점이 호 중심에서 ρ · 접점이 변 위에 있고 접선이 이어진다 ·
//      면적이 f 에 단조 · gap 틈 = (√3/2)·s · bevel 코어 내접 = 0.7·r_in(≈0.303) ·
//      결정성(단위 마름모 좌표를 닫힌 형태 √3 식에 박는다) · 꾸민 도형의 basePoints = 원
//      꼭짓점 · gap/dot 만 noSeam · bevel 띠 클램프는 사다리의 «첫 합격 칸».
//   ④ 등급: 술어표 · 모르는 role/타입 → T1 · T0 발자국 1셀 미만 → T1 · dot 셀 한정
//      (O/A/K data·filler, Y data 만 — §3.2; 셀 정체 없으면 dot 안 그림).
//   ⑤ 해석: 스텁 허용표(행 0)에서 square 가 아닌 모든 선택이 null + lockReason 이고,
//      동결한 state 를 건드리지 않는다. fixture 표로 «행이 있어야만 열린다» 를 확인한다.
//
// 표본 기하는 한 모양만 쓰지 않는다 — O 면 3종(단위 · 픽셀 레이아웃) · Y 모듈 · 꼭짓점
// 순서 뒤집기까지 격자로 돈다(교훈 «한 점은 계약이 아니다»).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SHAPES,
  CELL_SHAPE_PARAMS,
  CELL_TIERS,
  CELL_INRADIUS_COEFF,
  SAMPLE_DISC_FRACTION,
  FILLET_60_CAP_COEFF,
  BEVEL_CORE_SCALE,
  ARC_STEP_COS,
  ARC_STEP_SIN,
  ROUND_BEVEL_FIXED,
  EXPOSED_CELL_SHAPES,
  CELL_SHAPE_ALLOW_KEYS,
  CELL_SHAPE_LOCK_REASONS,
  BEVEL_BAND_SEPARATION_MIN,
  cellShapeTier,
  cellShapeAllowedKinds,
  promoteNearT0,
  shapeCellFace,
  roundedRhombusPoints,
  resolveCellShapeSpec,
  faceGainColor,
} from '../src/cell-shape.js';
import * as STUB_ALLOW from '../src/cell-shape-allow.js';
import { applyFaceGain } from '../src/sceneY.js';
import { facePolygon, FACES } from '../src/hexgrid.js';
import { moduleQuad, YFACES } from '../src/ygrid.js';
import { RENDER_PROFILE_IDS, faceGainsForRenderProfile } from '../src/render-profile.js';
import { relativeLuminance } from '../src/luminance.js';

const SQRT3 = Math.sqrt(3);
const COLOR = Object.freeze({ r: 96, g: 122, b: 171 });
/** dot 은 셀 정체가 있어야 그린다(§3.2 Y «data 만» 한정) — 기하 표본에는 O data 셀을 쓴다. */
const DOT_CELL = Object.freeze({ type: 'O', entry: Object.freeze({ role: 'data' }) });

// ── 표본 마름모 격자 ───────────────────────────────────────────────────────────

function sampleRhombi() {
  const out = [];
  for (const face of FACES) {
    out.push({ name: `O ${face} 단위`, points: facePolygon(0, 0, face, { size: 1 }) });
    out.push({ name: `O ${face} 픽셀`, points: facePolygon(3, -2, face, { size: 17.25, originX: 412.5, originY: 377.75 }) });
  }
  for (const face of YFACES) {
    out.push({ name: `Y ${face} 모듈`, points: moduleQuad(face, 4, 7, { size: 9.5, originX: 300, originY: 280 }) });
  }
  const t = facePolygon(0, 0, 'T', { size: 1 });
  out.push({ name: 'O T 역순', points: [...t].reverse() });
  out.push({ name: 'O T 회전 시작', points: [t[2], t[3], t[0], t[1]] });
  return out;
}

function sideOf(points) {
  return Math.sqrt((points[1].x - points[0].x) ** 2 + (points[1].y - points[0].y) ** 2);
}

function centroidOf(points) {
  let x = 0; let y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

function signedArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** 볼록 다각형 안쪽 깊이(음수 = 밖). 모든 변의 안쪽 법선 방향 부호 거리의 최소. */
function convexDepth(poly, p) {
  const sign = signedArea(poly) > 0 ? 1 : -1;
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len === 0) continue;
    const d = (sign * (ex * (p.y - a.y) - ey * (p.x - a.x))) / len;
    if (d < best) best = d;
  }
  return best;
}

function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-15) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

/** 원 위 표본점(테스트 쪽 기준 — 여기선 삼각함수를 참값 자로 쓴다). */
function circlePoints(c, r, count = 720) {
  return Array.from({ length: count }, (_, k) => {
    const a = (2 * Math.PI * k) / count;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

function minDepth(poly, pts) {
  return Math.min(...pts.map((p) => convexDepth(poly, p)));
}

/** 꼭짓점별 모서리 정보(테스트 쪽에서 독립 유도). */
function cornersOf(points) {
  return points.map((v, i) => {
    const prev = points[(i + 3) % 4];
    const next = points[(i + 1) % 4];
    const lp = Math.sqrt((prev.x - v.x) ** 2 + (prev.y - v.y) ** 2);
    const ln = Math.sqrt((next.x - v.x) ** 2 + (next.y - v.y) ** 2);
    const up = { x: (prev.x - v.x) / lp, y: (prev.y - v.y) / lp };
    const un = { x: (next.x - v.x) / ln, y: (next.y - v.y) / ln };
    const acute = up.x * un.x + up.y * un.y > 0;
    return { v, up, un, acute };
  });
}

// ── ① 15° 표 ───────────────────────────────────────────────────────────────────

describe('15° 닫힌 형태 표', () => {
  test('k·15° (k=0…8) 의 cos·sin 이 참값과 1e-15 안에서 같고 단위원 위에 있다', () => {
    assert.equal(ARC_STEP_COS.length, 9);
    assert.equal(ARC_STEP_SIN.length, 9);
    for (let k = 0; k <= 8; k += 1) {
      const a = (k * Math.PI) / 12;
      assert.ok(Math.abs(ARC_STEP_COS[k] - Math.cos(a)) < 1e-15, `cos ${k * 15}°`);
      assert.ok(Math.abs(ARC_STEP_SIN[k] - Math.sin(a)) < 1e-15, `sin ${k * 15}°`);
      assert.ok(Math.abs(ARC_STEP_COS[k] ** 2 + ARC_STEP_SIN[k] ** 2 - 1) < 1e-15);
    }
  });
});

// ── ② 면 게인 비트 동일 ────────────────────────────────────────────────────────

describe('faceGainColor ≡ sceneY.applyFaceGain', () => {
  test('채널 0…255 전수 × 게인 격자(렌더 프로파일 게인 포함)에서 비트 동일', () => {
    const gains = new Set([0, 0.25, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.5, 2, 3]);
    for (const id of RENDER_PROFILE_IDS) {
      const g = faceGainsForRenderProfile(id);
      for (const v of Object.values(g)) gains.add(v);
    }
    let checked = 0;
    for (const gain of gains) {
      for (let v = 0; v < 256; v += 1) {
        const rgb = { r: v, g: 255 - v, b: (v * 7) % 256 };
        assert.deepEqual(faceGainColor(rgb, gain), applyFaceGain(rgb, gain), `rgb ${JSON.stringify(rgb)} × ${gain}`);
        checked += 1;
      }
    }
    assert.ok(checked >= 256 * 14);
  });
});

// ── ③ 기하 ─────────────────────────────────────────────────────────────────────

describe('round — 필렛 기하', () => {
  for (const { name, points } of sampleRhombi()) {
    const L = sideOf(points);
    const rIn = CELL_INRADIUS_COEFF * L;
    const c = centroidOf(points);
    for (const f of CELL_SHAPE_PARAMS.round.domain) {
      test(`${name} f=${f}: 표본 원판 · 내접원 · 호 · 접점`, () => {
        const [shape] = shapeCellFace(points, COLOR, { kind: 'round', param: f }, CELL_TIERS.T3);
        assert.equal(shape.kind, 'polygon');
        const poly = shape.points;
        assert.equal(poly.length, 2 * 9 + 2 * 5, '60° 모서리 8칸(9점) × 2 + 120° 모서리 4칸(5점) × 2');
        assert.ok(isConvex(poly), '둥근 마름모는 볼록이다');

        // 표본 원판(r_in·0.5)은 넉넉히 안.
        const discDepth = minDepth(poly, circlePoints(c, SAMPLE_DISC_FRACTION * rIn));
        assert.ok(discDepth > 0.2 * L, `표본 원판 깊이 ${discDepth / L}셀`);

        // 내접원: 참 호로는 f ≤ 1 에서 보존. 15° 현으로 펴면 120° 호가 내접원에 붙는 쪽
        // (f → 1, 도메인에선 f=1 — 실측 깊이 −0.0037셀 = 처짐 그대로)에서 현의 처짐
        // ρ(1−cos7.5°) 만큼 들어온다 — 그 한계 안인지 잰다. 도메인의 0.35 · 0.7 은 완전 보존.
        const rho = f * rIn;
        const sag = rho * (1 - Math.cos(Math.PI / 24));
        const inDepth = minDepth(poly, circlePoints(c, rIn));
        assert.ok(inDepth >= -sag - 1e-12 * L, `내접원 깊이 ${inDepth / L}셀 < 처짐 한계 −${sag / L}`);
        if (f < 1) assert.ok(inDepth >= -1e-12 * L, `f=${f} 는 현으로 펴도 내접원이 안에 있어야 한다: ${inDepth / L}`);

        // 모서리별: 접점 거리 t · 호 중심 거리 ρ · 접선 연속.
        const rho60 = Math.min(rho, FILLET_60_CAP_COEFF * L);
        let idx = 0;
        for (const { v, up, un, acute } of cornersOf(points)) {
          const r = acute ? rho60 : rho;
          const steps = acute ? 8 : 4;
          const t = acute ? SQRT3 * r : r / SQRT3;
          // 호 중심 = 꼭짓점에서 이등분선으로 r / sin(θ/2) (60° → 2r · 120° → 2r/√3).
          const bx = up.x + un.x;
          const by = up.y + un.y;
          const bl = Math.sqrt(bx * bx + by * by);
          const d = acute ? 2 * r : (2 * r) / SQRT3;
          const center = { x: v.x + (bx / bl) * d, y: v.y + (by / bl) * d };
          const run = poly.slice(idx, idx + steps + 1);
          idx += steps + 1;
          for (const p of run) {
            const dist = Math.sqrt((p.x - center.x) ** 2 + (p.y - center.y) ** 2);
            assert.ok(Math.abs(dist - r) <= 1e-12 * Math.max(1, L, Math.abs(v.x), Math.abs(v.y)), `호의 점 |P−C|=${dist} ≠ ρ=${r}`);
          }
          const p0 = run[0];
          const p1 = run[run.length - 1];
          const tol = 1e-12 * Math.max(1, Math.abs(v.x), Math.abs(v.y));
          // 접점은 변 위, 꼭짓점에서 t 거리.
          assert.ok(Math.abs(Math.sqrt((p0.x - v.x) ** 2 + (p0.y - v.y) ** 2) - t) <= tol);
          assert.ok(Math.abs(Math.sqrt((p1.x - v.x) ** 2 + (p1.y - v.y) ** 2) - t) <= tol);
          assert.ok(Math.abs((p0.x - v.x) * up.y - (p0.y - v.y) * up.x) <= tol, '첫 접점이 이전 변 위');
          assert.ok(Math.abs((p1.x - v.x) * un.y - (p1.y - v.y) * un.x) <= tol, '끝 접점이 다음 변 위');
          // 접선 연속: 반지름 벡터가 변 방향과 직교.
          assert.ok(Math.abs((p0.x - center.x) * up.x + (p0.y - center.y) * up.y) <= tol, '이전 변과 접선 연속');
          assert.ok(Math.abs((p1.x - center.x) * un.x + (p1.y - center.y) * un.y) <= tol, '다음 변과 접선 연속');
          // 15° 균등: 현 길이가 모두 2ρ·sin7.5°.
          const chord = 2 * r * Math.sin(Math.PI / 24);
          for (let s = 1; s < run.length; s += 1) {
            const cl = Math.sqrt((run[s].x - run[s - 1].x) ** 2 + (run[s].y - run[s - 1].y) ** 2);
            assert.ok(Math.abs(cl - chord) <= 1e-11 * Math.max(1, L), `현 ${cl} ≠ ${chord}`);
          }
        }
        assert.equal(idx, poly.length);
      });
    }
  }

  test('0.7 과 1.0 은 120° 모서리만 다르다(60° 는 캡 0.5/√3 에 걸린다)', () => {
    const pts = facePolygon(0, 0, 'L', { size: 1 });
    const a = roundedRhombusPoints(pts, 0.7);
    const b = roundedRhombusPoints(pts, 1.0);
    const corners = cornersOf(pts);
    let idx = 0;
    for (const { acute } of corners) {
      const n = acute ? 9 : 5;
      const same = a.slice(idx, idx + n).every((p, k) => {
        const q = b[idx + k];
        return Math.abs(p.x - q.x) < 1e-15 && Math.abs(p.y - q.y) < 1e-15;
      });
      assert.equal(same, acute, acute ? '60° 모서리는 같다' : '120° 모서리는 다르다');
      idx += n;
    }
  });

  test('결정성 — 단위 마름모 round f=0.7 의 접점 · 호 중점이 닫힌 형태 기대값과 1e-15 안', () => {
    // 같은 프로세스 두 번 호출 비교(자기참조)가 아니라, 손으로 유도한 √3 식에 좌표를 박는다.
    // 마름모 A(0,0) 60° · B(1,0) 120° · C(3/2, √3/2) 60° · D(1/2, √3/2) 120°(변 1, 반시계).
    //   A: ρ = 0.7·√3/4 > 캡 √3/6 → ρ60 = √3/6, t = √3·ρ60 = 1/2, 호 중심 (1/2, √3/6),
    //      호(120° 폭) 중점 = 중심 − 이등분선 단위(√3/2, 1/2)·ρ60 = (1/4, √3/12).
    //   B: ρ = 0.7·√3/4 = 0.175·√3, t = ρ/√3 = 0.175, 호 중심 (0.825, 0.175·√3),
    //      호(60° 폭) 중점 = 중심 − (−1/2, √3/2)·ρ = (0.825 + 0.0875·√3, 0.175·√3 − 0.2625).
    //   C · D 는 무게중심 (3/4, √3/4) 에 대한 점대칭: (x, y) → (3/2 − x, √3/2 − y).
    const s3 = Math.sqrt(3);
    const unit = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1.5, y: s3 / 2 }, { x: 0.5, y: s3 / 2 }];
    const cornerA = [{ x: 1 / 4, y: s3 / 4 }, { x: 1 / 4, y: s3 / 12 }, { x: 1 / 2, y: 0 }];
    const cornerB = [{ x: 0.825, y: 0 }, { x: 0.825 + 0.0875 * s3, y: 0.175 * s3 - 0.2625 }, { x: 1.0875, y: 0.0875 * s3 }];
    const reflect = (p) => ({ x: 1.5 - p.x, y: s3 / 2 - p.y });
    // (출력 인덱스, 기대점): 모서리마다 첫 접점 · 호 중점 · 끝 접점. 60° 는 9점, 120° 는 5점.
    const expected = [
      [0, cornerA[0]], [4, cornerA[1]], [8, cornerA[2]],
      [9, cornerB[0]], [11, cornerB[1]], [13, cornerB[2]],
      [14, reflect(cornerA[0])], [18, reflect(cornerA[1])], [22, reflect(cornerA[2])],
      [23, reflect(cornerB[0])], [25, reflect(cornerB[1])], [27, reflect(cornerB[2])],
    ];
    const [shape] = shapeCellFace(unit, COLOR, { kind: 'round', param: 0.7 }, CELL_TIERS.T3);
    assert.equal(shape.points.length, 28);
    for (const [i, e] of expected) {
      const p = shape.points[i];
      assert.ok(Math.abs(p.x - e.x) <= 1e-15 && Math.abs(p.y - e.y) <= 1e-15,
        `점 ${i}: (${p.x}, ${p.y}) ≠ 기대 (${e.x}, ${e.y})`);
    }
  });

  test('면적이 f 에 대해 순감소하고, 닫힌 형태 필렛 면적(현 보정 포함)과 맞는다', () => {
    const pts = facePolygon(0, 0, 'T', { size: 1 });
    const rhombusArea = SQRT3 / 2;
    let prev = rhombusArea;
    for (let k = 1; k <= 20; k += 1) {
      const f = k / 20;
      const poly = roundedRhombusPoints(pts, f);
      const area = Math.abs(signedArea(poly));
      assert.ok(area < prev, `f=${f}: 면적 ${area} 가 직전 ${prev} 보다 작아야 한다`);
      prev = area;
      // 필렛 하나가 깎는 면적 = ρ²·cot(θ/2) − (호 부채꼴을 n 개 삼각형으로 편 면적).
      const rIn = CELL_INRADIUS_COEFF;
      const rho = f * rIn;
      const rho60 = Math.min(rho, FILLET_60_CAP_COEFF);
      const cut = (r, cot, n) => r * r * cot - n * 0.5 * r * r * Math.sin(Math.PI / 12);
      const expected = rhombusArea - 2 * cut(rho60, SQRT3, 8) - 2 * cut(rho, 1 / SQRT3, 4);
      assert.ok(Math.abs(area - expected) < 1e-12, `f=${f}: ${area} vs ${expected}`);
    }
  });
});

describe('gap · bevel · round-bevel · dot', () => {
  test('gap: 이웃 면 사이 틈 = (√3/2)·s·변 (같은 셀 두 면 · 이웃 셀 두 면)', () => {
    const layout = { size: 13, originX: 200, originY: 150 };
    const pairs = [
      [facePolygon(0, 0, 'T', layout), facePolygon(0, 0, 'R', layout)],
      [facePolygon(0, 0, 'L', layout), facePolygon(0, 0, 'R', layout)],
      [facePolygon(0, 0, 'R', layout), facePolygon(1, 0, 'L', layout)],
    ];
    for (const s of CELL_SHAPE_PARAMS.gap.domain) {
      for (const [a, b] of pairs) {
        const same = (p, q) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
        const ea = [];
        a.forEach((p, i) => { if (b.some((q) => same(p, q))) ea.push(i); });
        assert.equal(ea.length, 2, '두 면은 변 하나를 공유한다');
        const eb = ea.map((i) => b.findIndex((q) => same(a[i], q)));
        const [sa] = shapeCellFace(a, COLOR, { kind: 'gap', param: s }, CELL_TIERS.T3);
        const [sb] = shapeCellFace(b, COLOR, { kind: 'gap', param: s }, CELL_TIERS.T3);
        const p = sa.points[ea[0]];
        const q = sa.points[ea[1]];
        const len = Math.sqrt((q.x - p.x) ** 2 + (q.y - p.y) ** 2);
        for (const j of eb) {
          const r = sb.points[j];
          const dist = Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / len;
          assert.ok(Math.abs(dist - (SQRT3 / 2) * s * layout.size) < 1e-9, `틈 ${dist / layout.size} ≠ 0.866·${s}`);
        }
        assert.equal(sa.noSeam, true);
      }
    }
  });

  for (const { name, points } of sampleRhombi()) {
    const L = sideOf(points);
    const rIn = CELL_INRADIUS_COEFF * L;
    const c = centroidOf(points);
    const disc = circlePoints(c, SAMPLE_DISC_FRACTION * rIn);

    test(`${name}: bevel — 바깥은 선형광 게인 색, 코어 내접 0.7·r_in(≈0.303셀)은 원색이고 표본 원판을 품는다`, () => {
      for (const gain of CELL_SHAPE_PARAMS.bevel.domain) {
        const out = shapeCellFace(points, COLOR, { kind: 'bevel', param: gain }, CELL_TIERS.T2);
        assert.equal(out.length, 2);
        const [band, core] = out;
        assert.deepEqual(band.points, points.map((p) => ({ x: p.x, y: p.y })), '바깥 = 원 마름모');
        assert.deepEqual(band.color, applyFaceGain(COLOR, gain));
        assert.equal(core.color, COLOR, '코어는 원색(같은 객체)');
        const coreIn = Math.min(...core.points.map((_, i) => {
          const a = core.points[i];
          const b = core.points[(i + 1) % 4];
          const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
          return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len;
        }));
        assert.ok(Math.abs(coreIn - BEVEL_CORE_SCALE * rIn) < 1e-12 * Math.max(1, L, c.x, c.y));
        assert.ok(Math.abs(coreIn / L - 0.3031088913245535) < 1e-12);
        assert.ok(minDepth(core.points, disc) > 0, '표본 원판이 코어 안 — median 은 원색');
        assert.equal(band.noSeam, undefined, 'bevel 은 seam 을 유지한다');
      }
    });

    test(`${name}: round-bevel — 둥근(0.7) 바깥 × 0.6, 그 0.7배 코어가 표본 원판을 품는다`, () => {
      const out = shapeCellFace(points, COLOR, { kind: 'round-bevel', param: null }, CELL_TIERS.T3);
      assert.equal(out.length, 2);
      const [band, core] = out;
      assert.deepEqual(band.points, roundedRhombusPoints(points, ROUND_BEVEL_FIXED.round));
      assert.deepEqual(band.color, applyFaceGain(COLOR, ROUND_BEVEL_FIXED.bevel));
      assert.equal(core.color, COLOR);
      assert.ok(minDepth(core.points, disc) > 0);
    });

    test(`${name}: gap · dot — 표본 원판 보존, noSeam`, () => {
      for (const s of CELL_SHAPE_PARAMS.gap.domain) {
        const [g] = shapeCellFace(points, COLOR, { kind: 'gap', param: s }, CELL_TIERS.T2);
        assert.ok(minDepth(g.points, disc) > 0);
        assert.equal(g.noSeam, true);
      }
      for (const f of CELL_SHAPE_PARAMS.dot.domain) {
        const [d] = shapeCellFace(points, COLOR, { kind: 'dot', param: f }, CELL_TIERS.T3, DOT_CELL);
        assert.equal(d.kind, 'disc');
        assert.ok(Math.abs(d.cx - c.x) < 1e-12 * Math.max(1, c.x) && Math.abs(d.cy - c.y) < 1e-12 * Math.max(1, c.y));
        assert.ok(Math.abs(d.r - f * rIn) < 1e-12 * Math.max(1, L));
        assert.ok(d.r >= SAMPLE_DISC_FRACTION * rIn, 'dot 원이 표본 원판보다 크거나 같다');
        assert.equal(d.noSeam, true);
      }
    });

    test(`${name}: 꾸민 도형의 basePoints = 원 꼭짓점 · 결정성`, () => {
      const specs = [
        ...CELL_SHAPE_PARAMS.round.domain.map((p) => ({ kind: 'round', param: p })),
        ...CELL_SHAPE_PARAMS.bevel.domain.map((p) => ({ kind: 'bevel', param: p })),
        { kind: 'round-bevel', param: null },
        ...CELL_SHAPE_PARAMS.gap.domain.map((p) => ({ kind: 'gap', param: p })),
        ...CELL_SHAPE_PARAMS.dot.domain.map((p) => ({ kind: 'dot', param: p })),
      ];
      const plain = points.map((p) => ({ x: p.x, y: p.y }));
      for (const spec of specs) {
        const a = shapeCellFace(points, COLOR, spec, CELL_TIERS.T3, DOT_CELL);
        const b = shapeCellFace(points.map((p) => ({ ...p })), { ...COLOR }, { ...spec }, CELL_TIERS.T3, DOT_CELL);
        assert.deepEqual(a, b, `${spec.kind}: 같은 입력 → 같은 비트`);
        for (const s of a) {
          assert.deepEqual(s.basePoints, plain, `${spec.kind}: basePoints`);
          assert.notEqual(s.basePoints, points, 'basePoints 는 사본이다(입력 별칭 아님)');
          assert.equal(s.noSeam === true, spec.kind === 'gap' || spec.kind === 'dot', `${spec.kind}: noSeam`);
        }
      }
      assert.deepEqual(points, plain, '입력 꼭짓점을 고치지 않는다');
    });
  }
});

describe('등급 적용 — 원 도형 그대로 두는 경우', () => {
  const points = facePolygon(0, 0, 'R', { size: 1 });
  const identity = [{ kind: 'polygon', points, color: COLOR }];

  test('spec null · square · T0 · T1 · 모르는 등급 → 셀 루프가 넣던 도형 그대로(basePoints 없음)', () => {
    assert.deepEqual(shapeCellFace(points, COLOR, null, CELL_TIERS.T3), identity);
    assert.deepEqual(shapeCellFace(points, COLOR, { kind: 'square', param: null }, CELL_TIERS.T3), identity);
    for (const kind of CELL_SHAPES) {
      const def = CELL_SHAPE_PARAMS[kind];
      const spec = { kind, param: def ? def.default : null };
      for (const tier of [CELL_TIERS.T0, CELL_TIERS.T1, 'T9', undefined]) {
        const out = shapeCellFace(points, COLOR, spec, tier);
        assert.deepEqual(out, identity, `${kind} @ ${tier}`);
        assert.equal(out[0].points, points);
        assert.equal(out[0].color, COLOR);
      }
    }
  });

  test('dot 은 T3 에만 — T2 에서는 원 도형', () => {
    assert.deepEqual(shapeCellFace(points, COLOR, { kind: 'dot', param: 0.8 }, CELL_TIERS.T2, DOT_CELL), identity);
    assert.equal(shapeCellFace(points, COLOR, { kind: 'dot', param: 0.8 }, CELL_TIERS.T3, DOT_CELL)[0].kind, 'disc');
  });

  test('dot 셀 한정: O/A/K 는 data · filler, Y 는 data 만(§3.2) — 다른 모양은 Y filler 에도 열린다', () => {
    const y = moduleQuad(YFACES[0], 4, 7, { size: 9.5, originX: 300, originY: 280 });
    const yIdentity = [{ kind: 'polygon', points: y, color: COLOR }];
    const dot = { kind: 'dot', param: 0.8 };
    const draw = (type, role, pts = points) => {
      const entry = { role };
      return shapeCellFace(pts, COLOR, dot, cellShapeTier(type, entry), { type, entry });
    };
    // Y: filler 는 T3 이지만 dot 은 원 도형, data 는 disc.
    assert.equal(cellShapeTier('Y', { role: 'filler' }), CELL_TIERS.T3);
    assert.deepEqual(draw('Y', 'filler', y), yIdentity, 'Y filler + dot → 원 도형');
    assert.equal(draw('Y', 'data', y)[0].kind, 'disc', 'Y data + dot → disc');
    // O/A/K(+C/G/V): data · filler 모두 disc.
    for (const type of ['O', 'C', 'G', 'A', 'V', 'K']) {
      assert.equal(draw(type, 'data')[0].kind, 'disc', `${type} data`);
      assert.equal(draw(type, 'filler')[0].kind, 'disc', `${type} filler`);
    }
    // Y filler 도 dot 외 모양은 받는다 — 셀 한정은 dot 만 뺀다.
    const yFiller = { type: 'Y', entry: { role: 'filler' } };
    for (const spec of [{ kind: 'round', param: 0.7 }, { kind: 'bevel', param: 0.6 }, { kind: 'round-bevel', param: null }, { kind: 'gap', param: 0.08 }]) {
      const out = shapeCellFace(y, COLOR, spec, CELL_TIERS.T3, yFiller);
      assert.ok(Array.isArray(out[0].basePoints), `Y filler + ${spec.kind} 는 꾸민다`);
    }
    // 셀 정체가 없으면 dot 은 그리지 않는다(fail-closed) — 등급만으론 Y filler 를 못 가른다.
    assert.deepEqual(shapeCellFace(points, COLOR, dot, CELL_TIERS.T3), identity);
    assert.deepEqual(shapeCellFace(points, COLOR, dot, CELL_TIERS.T3, { type: 'H', entry: { role: 'data' } }), identity);
    // 발자국 승격으로 T1 이 된 data 셀은 dot 도 원 도형.
    assert.deepEqual(shapeCellFace(points, COLOR, dot, CELL_TIERS.T1, DOT_CELL), identity);
  });

  test('도메인 밖 파라미터 · 모르는 모양 · 마름모가 아닌 입력은 던진다(조용히 사각으로 가지 않는다)', () => {
    assert.throws(() => shapeCellFace(points, COLOR, { kind: 'gap', param: 0.125 }, CELL_TIERS.T3), RangeError);
    assert.throws(() => shapeCellFace(points, COLOR, { kind: 'star', param: 1 }, CELL_TIERS.T3), RangeError);
    const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    assert.throws(() => shapeCellFace(square, COLOR, { kind: 'round', param: 0.7 }, CELL_TIERS.T3), RangeError);
  });

  test('bevel 띠 클램프: avoid 색과 휘도 차가 0.05 미만이면 게인을 1 쪽으로 당긴다', () => {
    // 띠(× 0.6)가 어떤 회색과 거의 같은 휘도가 되게 avoid 를 고른다.
    const band = applyFaceGain(COLOR, 0.6);
    const bandY = relativeLuminance(band);
    const avoid = [band];
    const [clamped] = shapeCellFace(points, COLOR, { kind: 'bevel', param: 0.6, avoid }, CELL_TIERS.T3);
    const sepOf = (c) => Math.abs(relativeLuminance(c) - bandY);
    // 강한 형태: 폴백(원색)이 아니라 사다리 중간에서 멈춰야 한다 — 이 COLOR 는 원색이
    // band 에서 0.05 넘게 떨어져 있어 합격 칸이 존재한다(전제 자체를 먼저 잰다).
    assert.ok(sepOf(COLOR) >= BEVEL_BAND_SEPARATION_MIN, '전제: 원색은 band 와 떨어져 있다');
    assert.notDeepEqual(clamped.color, { r: COLOR.r, g: COLOR.g, b: COLOR.b }, '클램프가 폴백으로 새지 않는다');
    assert.ok(sepOf(clamped.color) >= BEVEL_BAND_SEPARATION_MIN, `분리 ${sepOf(clamped.color)} ≥ 0.05`);
    // «첫 합격 칸» = 1 쪽으로 가장 적게 당긴 칸: 사다리(gain → 1, 16등분)를 정본 applyFaceGain
    // 으로 다시 세워, 고른 칸 앞의 모든 칸은 0.05 미만이었음을 확인한다.
    const ladder = Array.from({ length: 16 }, (_, k) => applyFaceGain(COLOR, 0.6 + (0.4 * k) / 16));
    const chosen = ladder.findIndex((c) => c.r === clamped.color.r && c.g === clamped.color.g && c.b === clamped.color.b);
    assert.ok(chosen > 0, `고른 색이 사다리의 한 칸(0 이 아닌)이다: ${chosen}`);
    for (let k = 0; k < chosen; k += 1) {
      assert.ok(sepOf(ladder[k]) < BEVEL_BAND_SEPARATION_MIN, `칸 ${k} 는 불합격이어야 한다(첫 합격 칸 ${chosen})`);
    }
    // 폴백: 모든 칸이 불합격인 avoid(사다리 16칸 전부)면 원색 = 띠 없음.
    const [fallback] = shapeCellFace(points, COLOR, { kind: 'bevel', param: 0.6, avoid: ladder }, CELL_TIERS.T3);
    assert.deepEqual(fallback.color, { r: COLOR.r, g: COLOR.g, b: COLOR.b });
    // avoid 가 멀면 클램프하지 않는다.
    const [free] = shapeCellFace(points, COLOR, { kind: 'bevel', param: 0.6, avoid: [{ r: 255, g: 255, b: 255 }] }, CELL_TIERS.T3);
    assert.deepEqual(free.color, band);
  });
});

// ── ④ 등급 ─────────────────────────────────────────────────────────────────────

describe('cellShapeTier — §3.0 술어표', () => {
  test('O/A/K(+C/G/V)', () => {
    for (const type of ['O', 'C', 'G', 'A', 'V', 'K']) {
      assert.equal(cellShapeTier(type, { role: 'anchor' }), 'T1', `${type} anchor(tones 없음)도 T1`);
      assert.equal(cellShapeTier(type, { role: 'marker' }), 'T1');
      assert.equal(cellShapeTier(type, { role: 'reference' }), 'T2');
      assert.equal(cellShapeTier(type, { role: 'format' }), 'T2');
      assert.equal(cellShapeTier(type, { role: 'data' }), 'T3');
      assert.equal(cellShapeTier(type, { role: 'filler' }), 'T3');
      assert.equal(cellShapeTier(type, { role: 'data', tones: { T: 0, L: 1, R: 2 } }), 'T1', 'tones 가 있으면 T1');
      assert.equal(cellShapeTier(type, { role: 'format', tones: [0, 1, 2] }), 'T1');
    }
  });

  test('Y 는 role 로만 가른다(tones 무시)', () => {
    assert.equal(cellShapeTier('Y', { role: 'locator' }), 'T1');
    assert.equal(cellShapeTier('Y', { role: 'reference' }), 'T1');
    assert.equal(cellShapeTier('Y', { role: 'format' }), 'T2');
    assert.equal(cellShapeTier('Y', { role: 'data' }), 'T3');
    assert.equal(cellShapeTier('Y', { role: 'filler' }), 'T3');
    assert.equal(cellShapeTier('Y', { role: 'data', tones: { T: 0 } }), 'T3');
  });

  test('cellShapeAllowedKinds — 등급 허용에서 셀 단위 dot 한정(Y 는 data 만)만 뺀다', () => {
    const nonDot = ['round', 'bevel', 'round-bevel', 'gap'];
    assert.deepEqual(cellShapeAllowedKinds('Y', { role: 'data' }), [...nonDot, 'dot']);
    assert.deepEqual(cellShapeAllowedKinds('Y', { role: 'filler' }), nonDot, 'Y filler 는 T3 이지만 dot 없음');
    assert.deepEqual(cellShapeAllowedKinds('Y', { role: 'format' }), nonDot);
    for (const type of ['O', 'A', 'K']) {
      assert.deepEqual(cellShapeAllowedKinds(type, { role: 'data' }), [...nonDot, 'dot']);
      assert.deepEqual(cellShapeAllowedKinds(type, { role: 'filler' }), [...nonDot, 'dot']);
      assert.deepEqual(cellShapeAllowedKinds(type, { role: 'reference' }), nonDot);
      assert.deepEqual(cellShapeAllowedKinds(type, { role: 'anchor' }), []);
    }
    // 등급을 넘기면(발자국 승격 뒤) 그 등급을 따른다.
    assert.deepEqual(cellShapeAllowedKinds('Y', { role: 'data' }, CELL_TIERS.T1), []);
    assert.deepEqual(cellShapeAllowedKinds('O', { role: 'data' }, CELL_TIERS.T2), nonDot);
    assert.deepEqual(cellShapeAllowedKinds('Y', { role: 'locator' }), []);
    assert.deepEqual(cellShapeAllowedKinds('H', { role: 'data' }), []);
  });

  test('모르는 role · 모르는 타입 · entry 없음 → T1 (fail-closed)', () => {
    for (const type of ['O', 'A', 'K', 'Y']) {
      for (const role of ['bullseye', 'finder', 'slot', 'boundary', 'future-role', undefined]) {
        assert.equal(cellShapeTier(type, { role }), 'T1', `${type} ${role}`);
      }
      assert.equal(cellShapeTier(type, null), 'T1');
      assert.equal(cellShapeTier(type, undefined), 'T1');
    }
    for (const type of ['H', 'X', undefined, '']) {
      assert.equal(cellShapeTier(type, { role: 'data' }), 'T1', `타입 ${type}`);
    }
  });
});

describe('promoteNearT0 — T0 발자국 이웃 1셀 미만 → T1', () => {
  const L = 10;
  const face = facePolygon(0, 0, 'T', { size: L, originX: 100, originY: 100 });
  const xs = face.map((p) => p.x);
  const maxX = Math.max(...xs);
  const square = (x0, y0, w) => ({
    kind: 'polygon',
    points: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + w }, { x: x0, y: y0 + w }],
    color: { r: 0, g: 0, b: 0 },
  });
  // T 면의 오른쪽 끝 꼭짓점(y=95)에서 +x 로 떨어진 T0 사각.
  const rightTip = face.find((p) => p.x === maxX);

  test('거리 0.99셀 → 승격, 1.01셀 → 유지, 겹침 → 승격, T1 은 그대로', () => {
    const near = square(rightTip.x + 0.99 * L, rightTip.y - 1, 4);
    const far = square(rightTip.x + 1.01 * L, rightTip.y - 1, 4);
    const over = square(100 - 1, 95 - 1, 2); // 면 안쪽에 겹친다
    const faces = [{ points: face, tier: 'T3' }, { points: face, tier: 'T2' }, { points: face, tier: 'T1' }];
    assert.deepEqual(promoteNearT0(faces, [near]), ['T1', 'T1', 'T1']);
    assert.deepEqual(promoteNearT0(faces, [far]), ['T3', 'T2', 'T1']);
    assert.deepEqual(promoteNearT0(faces, [over]), ['T1', 'T1', 'T1']);
    assert.deepEqual(promoteNearT0(faces, []), ['T3', 'T2', 'T1']);
  });

  test('원판 T0: 가장자리 거리로 잰다', () => {
    const faces = [{ points: face, tier: 'T3' }];
    const discAt = (gapCells) => ({ kind: 'disc', cx: rightTip.x + gapCells * L + 3, cy: rightTip.y, r: 3, color: { r: 0, g: 0, b: 0 } });
    assert.deepEqual(promoteNearT0(faces, [discAt(0.99)]), ['T1']);
    assert.deepEqual(promoteNearT0(faces, [discAt(1.01)]), ['T3']);
    // 면 전체를 덮는 큰 원판(중심은 면 밖) → 겹침.
    assert.deepEqual(promoteNearT0(faces, [{ kind: 'disc', cx: 100 + 40, cy: 95, r: 60, color: {} }]), ['T1']);
  });

  test('꼭짓점이 서로 안에 없어도 변이 교차하면 겹침으로 본다', () => {
    // 면 중심을 45° 로 가로지르는 가늘고 긴 막대 — 막대 꼭짓점은 모두 면 밖, 면 꼭짓점
    // (중심에서 0°·90°·180°·270° 방향)도 막대 밖. 문턱을 0.01셀로 좁혀서, 교차 검사 없이
    // 꼭짓점–변 거리만 재면(≈0.35셀) 승격되지 않도록 판별력을 준다.
    const c = centroidOf(face);
    const h = 0.1 / Math.SQRT2;
    const bar = {
      kind: 'polygon',
      points: [
        { x: c.x - 50 + h, y: c.y - 50 - h }, { x: c.x + 50 + h, y: c.y + 50 - h },
        { x: c.x + 50 - h, y: c.y + 50 + h }, { x: c.x - 50 - h, y: c.y - 50 + h },
      ],
    };
    assert.deepEqual(promoteNearT0([{ points: face, tier: 'T3' }], [bar], { cells: 0.01 }), ['T1']);
    // 대조: 같은 막대를 면 밖으로 옮기면 0.01셀 문턱에선 유지된다.
    const moved = { kind: 'polygon', points: bar.points.map((p) => ({ x: p.x + 40, y: p.y - 40 })) };
    assert.deepEqual(promoteNearT0([{ points: face, tier: 'T3' }], [moved], { cells: 0.01 }), ['T3']);
  });

  test('입력을 고치지 않고, 잴 수 없는 T0 도형은 던진다', () => {
    const faces = Object.freeze([Object.freeze({ points: face, tier: 'T3' })]);
    assert.doesNotThrow(() => promoteNearT0(faces, [square(0, 0, 1)]));
    assert.throws(() => promoteNearT0(faces, [{ kind: 'text', x: 1 }]), RangeError);
  });

  test('실제 격자: 원판 T0 주변 링만 승격된다', () => {
    const layout = { size: 8, originX: 200, originY: 200 };
    const faces = [];
    for (let q = -4; q <= 4; q += 1) {
      for (let r = -4; r <= 4; r += 1) {
        if (Math.abs(q + r) > 4) continue;
        for (const f of FACES) faces.push({ points: facePolygon(q, r, f, layout), tier: 'T3', q, r });
      }
    }
    const disc = { kind: 'disc', cx: 200, cy: 200, r: 1.5 * 8 };
    const tiers = promoteNearT0(faces, [disc]);
    faces.forEach((fc, i) => {
      // 독립 기준: 면 꼭짓점·변 중 원판 가장자리에서 1셀 미만인 게 있는가(촘촘한 변 표본).
      let d = Infinity;
      const pts = fc.points;
      for (let k = 0; k < 4; k += 1) {
        const a = pts[k];
        const b = pts[(k + 1) % 4];
        for (let s = 0; s <= 200; s += 1) {
          const x = a.x + ((b.x - a.x) * s) / 200;
          const y = a.y + ((b.y - a.y) * s) / 200;
          d = Math.min(d, Math.sqrt((x - 200) ** 2 + (y - 200) ** 2) - disc.r);
        }
      }
      const inside = convexDepth(pts, { x: 200, y: 200 }) >= 0;
      const expectT1 = inside || d < 8 - 1e-6;
      const clearlyFar = !inside && d > 8 + 0.1;
      if (expectT1) assert.equal(tiers[i], 'T1', `(${fc.q},${fc.r}) 가까움 d=${d}`);
      else if (clearlyFar) assert.equal(tiers[i], 'T3', `(${fc.q},${fc.r}) 멂 d=${d}`);
    });
    assert.ok(tiers.includes('T1') && tiers.includes('T3'));
  });
});

// ── ⑤ 해석 ─────────────────────────────────────────────────────────────────────

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

const CTX_OAK = Object.freeze({
  type: 'O', version: 'V1', finderPatternId: 'pinwheel-c2-2-1100-cw', tones: 3, gapGrade: 'white',
  bgMode: 'white', paletteGrade: 'slate', qrPosition: 'none',
});
const CTX_Y = Object.freeze({
  type: 'Y', cellSurfaceLayout: 'v0', locatorProfile: 'cell-surface-v0', nBand: '13', tones: 3,
  gapGrade: 'white', bgMode: 'white', paletteGrade: 'slate', seamAdjacent: 'off',
});

/** 모든 비 square 선택 = 모양 × 도메인 파라미터(round-bevel 은 고정). */
function allNonSquareChoices() {
  const out = [];
  for (const kind of CELL_SHAPES) {
    if (kind === 'square') continue;
    const def = CELL_SHAPE_PARAMS[kind];
    if (!def) { out.push({ cellShape: kind }); continue; }
    for (const p of def.domain) out.push({ cellShape: kind, [def.key]: p });
  }
  return out;
}

describe('resolveCellShapeSpec', () => {
  test('스텁 허용표는 «전부 잠금»: 빈 표 · 영수증 없음', () => {
    assert.ok(Array.isArray(STUB_ALLOW.ROWS));
    assert.equal(STUB_ALLOW.ROWS.length, 0);
    assert.ok(Object.isFrozen(STUB_ALLOW.ROWS));
    assert.equal(STUB_ALLOW.RECEIPT_SHA256, null);
    assert.equal(STUB_ALLOW.MEASURED_AT, null);
  });

  test('스텁 표에서 모든 비 square 선택 × O·Y × 틈 등급 3 → null + lockReason, 동결 state 불변', () => {
    const reasons = new Set(Object.values(CELL_SHAPE_LOCK_REASONS));
    let n = 0;
    for (const base of [CTX_OAK, CTX_Y]) {
      for (const gapGrade of ['white', 'black', 'unknown']) {
        const ctx = { ...base, gapGrade };
        for (const choice of allNonSquareChoices()) {
          const state = deepFreeze({ ...choice, cellRound: choice.cellRound ?? 0.7, other: { keep: [1, 2] } });
          const before = JSON.stringify(state);
          const res = resolveCellShapeSpec(state, ctx); // 기본 = 스텁
          assert.equal(res.spec, null, `${choice.cellShape} 는 스텁에서 잠겨야 한다`);
          assert.ok(reasons.has(res.lockReason), `사유 ${res.lockReason}`);
          const exposed = EXPOSED_CELL_SHAPES.includes(choice.cellShape);
          assert.equal(res.lockReason, exposed && gapGrade !== 'white' ? 'exposed-gap' : 'unmeasured');
          assert.equal(JSON.stringify(state), before);
          n += 1;
        }
      }
    }
    assert.equal(n, 2 * 3 * (3 + 2 + 1 + 2 + 2));
  });

  test('square · 키 없음 → spec null, 잠금 사유 없음', () => {
    assert.deepEqual(resolveCellShapeSpec(deepFreeze({ cellShape: 'square' }), CTX_OAK), { spec: null });
    assert.deepEqual(resolveCellShapeSpec(deepFreeze({}), CTX_OAK), { spec: null });
    assert.deepEqual(resolveCellShapeSpec(undefined, CTX_OAK), { spec: null });
  });

  test('fixture 표: 문맥 · 모양 · 파라미터가 전부 같은 행만 연다', () => {
    const row = { table: 'oak', ...CTX_OAK, cellShape: 'round', param: 0.7 };
    const allow = deepFreeze({ ROWS: [row, { table: 'y', ...CTX_Y, cellShape: 'round-bevel', param: null }] });
    // 강도 키가 없으면 기본값(0.7)으로 읽는다 — «키 없음 ≡ 명시적 기본값».
    assert.deepEqual(resolveCellShapeSpec(deepFreeze({ cellShape: 'round' }), CTX_OAK, allow), { spec: { kind: 'round', param: 0.7 } });
    assert.deepEqual(resolveCellShapeSpec(deepFreeze({ cellShape: 'round', cellRound: 0.7 }), CTX_OAK, allow), { spec: { kind: 'round', param: 0.7 } });
    assert.equal(resolveCellShapeSpec({ cellShape: 'round', cellRound: 1.0 }, CTX_OAK, allow).spec, null);
    // 문맥 키 하나만 달라도 잠긴다(와일드카드 없음).
    for (const k of CELL_SHAPE_ALLOW_KEYS.oak) {
      const ctx = { ...CTX_OAK, [k]: `${CTX_OAK[k]}-다름` };
      const res = resolveCellShapeSpec({ cellShape: 'round' }, ctx, allow);
      assert.equal(res.spec, null, `키 ${k}`);
      assert.ok(res.lockReason);
    }
    // 행에 키가 빠지면 그 행은 아무것도 허가하지 않는다.
    const partial = { ...row };
    delete partial.qrPosition;
    assert.equal(resolveCellShapeSpec({ cellShape: 'round' }, CTX_OAK, { ROWS: [partial] }).spec, null);
    // Y 표.
    assert.deepEqual(resolveCellShapeSpec({ cellShape: 'round-bevel' }, CTX_Y, allow), { spec: { kind: 'round-bevel', param: null } });
    assert.equal(resolveCellShapeSpec({ cellShape: 'round-bevel' }, { ...CTX_Y, nBand: '25' }, allow).spec, null);
    // O 행이 Y 를, Y 행이 O 를 허가하지 않는다.
    assert.equal(resolveCellShapeSpec({ cellShape: 'round-bevel' }, { ...CTX_OAK }, allow).spec, null);
  });

  test('잠금 사유: 모르는 모양 · 도메인 밖 · 마름모 아닌 타입 · 문맥 누락', () => {
    const R = CELL_SHAPE_LOCK_REASONS;
    assert.equal(resolveCellShapeSpec({ cellShape: 'star' }, CTX_OAK).lockReason, R.UNKNOWN_SHAPE);
    assert.equal(resolveCellShapeSpec({ cellShape: 'gap', cellGap: 0.15 }, CTX_OAK).lockReason, R.PARAM_OUT_OF_DOMAIN);
    assert.equal(resolveCellShapeSpec({ cellShape: 'round' }, { ...CTX_OAK, type: 'H' }).lockReason, R.TYPE_NOT_RHOMBUS);
    const { qrPosition, ...missing } = CTX_OAK;
    assert.equal(qrPosition, 'none');
    assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, missing).lockReason, R.CTX_INCOMPLETE);
    assert.equal(resolveCellShapeSpec({ cellShape: 'bevel' }, undefined).lockReason, R.TYPE_NOT_RHOMBUS);
  });

  test('resolver 가 여는 spec 은 shapeCellFace 가 그대로 받는다(도메인 일치)', () => {
    const points = facePolygon(0, 0, 'T', { size: 1 });
    for (const choice of allNonSquareChoices()) {
      const kind = choice.cellShape;
      const def = CELL_SHAPE_PARAMS[kind];
      const param = def ? choice[def.key] : null;
      const allow = { ROWS: [{ table: 'oak', ...CTX_OAK, cellShape: kind, param }] };
      const { spec } = resolveCellShapeSpec(choice, CTX_OAK, allow);
      assert.deepEqual(spec, { kind, param });
      const out = shapeCellFace(points, COLOR, spec, CELL_TIERS.T3, DOT_CELL);
      assert.ok(out.length >= 1 && out.every((s) => Array.isArray(s.basePoints)), kind);
    }
  });
});
