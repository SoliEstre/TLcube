// cell-shape-detector-exclusion-oak.test.js — O/A/K 셀 꾸미기의 «검출 요소 제외» 성질
// (DESIGN_001 §3.0 · §4.2 scene.js · §7.5, 레인 L2b 2026-09-26)
//
// 재는 것은 «값» 이 아니라 «성질» 이다. 기대값은 HEAD 출력을 박제하지 않고 **꾸미기 끔 장면을
// 같은 실행에서 다시 만들어** 대조한다:
//   ① T1(검출 셀 · 모르는 role)의 면 polygon 이 원본과 **정확히 같다**(좌표 · 색 · basePoints 없음).
//   ② 셀 루프 밖 도형(T0 — 파인더 · 중앙 QR · 사괘 …)과 꾸미지 않은 셀은 순서까지 불변이다.
//   ③ 꾸민 면은 전부 T0 도형에서 1셀 이상 떨어져 있다(발자국 승격, safety M2) — 셀 단위.
//      그리고 그 승격이 **실제로 일했다**(1셀 안의 T2/T3 면이 fixture 마다 있다 — 공허한 초록 금지).
//   ④ **검출 요소 발자국 + 1셀 팽창 마스크 안의 래스터 픽셀이 꾸미기 켬/끔에서 같다** — 마스크
//      밖에서는 픽셀이 실제로 바뀐다(꾸미기가 먹었다는 대조).
//   ⑤ dot 은 T3(data · filler) 밖에 없다. ⑥ 모르는 role → T1.
//   ⑦ 전제: `buildScene` 은 등급을 대표 타입 'O' 로 묻는다 — O·C·G·A·V·K 여섯이 모든 role 에서
//      같은 답이어야 한다(깨지면 scene.js 가 타입을 받아야 한다).
//   ⑧ svg seam: gap · dot 조각(`noSeam`)은 stroke 가 없고, round · bevel 은 stroke 를 유지한다.
//
// 격자: 파인더 가족(pinwheel-c2-2-1100-cw = /lab/ 기본 · 불스아이 · 중앙 TL n7 · cell-mask 3레벨 ·
// 중앙 QR) × 타입(O · A · V · K) × 모양 전부(파라미터 양 끝 포함). 허용표는 거치지 않고 spec 을
// 직접 넣는다(허용표는 L6 영수증 몫 — 스텁은 전부 잠금). resolver 경유 한 줄은 fixture 표로 잰다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { sceneToSvg } from '../src/svg.js';
import { FACES, facePolygon } from '../src/hexgrid.js';
import { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../src/luminance.js';
import { TL_READER_URL } from '../src/qr.js';
import {
  CELL_TIERS, cellShapeAllowedKinds, cellShapeCtx, cellShapeTier, resolveCellShapeSpec,
} from '../src/cell-shape.js';
import { detectorEmphasisEquivalents } from '../src/generator-render-config.js';

const SLATE = getPreset('slate');
const paletteWith = (background) => ({
  background, levels: SLATE.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
});
const PAYLOAD = 'https://tl.estre.so';

// ── fixture ────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    id: 'O · pinwheel-c2-2-1100-cw (/lab/ 기본 · cell-mask) + 코너 마커 톤',
    encoded: () => encode(PAYLOAD, { cornerMarker: true, markerTones: true }),
    opts: { finderPatternId: 'pinwheel-c2-2-1100-cw' },
  },
  {
    id: 'O · 불스아이 + 코너 마커 톤',
    encoded: () => encode(PAYLOAD, { cornerMarker: true, markerTones: true }),
    opts: { finderPatternId: 'bullseye' },
  },
  {
    id: 'O · 중앙 TL(n7)',
    encoded: () => encode(PAYLOAD, { centralN7: true, cornerMarker: true, markerTones: true }),
    opts: { finderPatternId: 'central-n7-payload', centralN7Family: 'hex' },
  },
  {
    id: 'O · oak-footprint (cell-mask 3레벨 대표)',
    encoded: () => encode(PAYLOAD, {}),
    opts: { finderPatternId: 'oak-footprint' },
  },
  {
    id: 'O · 중앙 QR (셀보다 먼저 그리는 T0)',
    encoded: () => encode(PAYLOAD, { centerQr: true }),
    opts: { qrText: TL_READER_URL },
  },
  {
    id: 'A · 불스아이 + 코너 마커',
    encoded: () => encodeA(PAYLOAD, { cornerMarker: true }),
    opts: { finderPatternId: 'bullseye', margin: 10 },
  },
  {
    id: 'A · pinwheel',
    encoded: () => encodeA(PAYLOAD, {}),
    opts: { finderPatternId: 'pinwheel-c2-2-1100-cw', margin: 10 },
  },
  {
    id: 'V(턴A) · 중앙 TL(n7)',
    encoded: () => encodeA(PAYLOAD, { turnA: true, centralN7: true }),
    opts: { finderPatternId: 'central-n7-payload', centralN7Family: 'tri', margin: 10 },
  },
  {
    id: 'K · 불스아이 + 코너 마커',
    encoded: () => encodeK(PAYLOAD, { cornerMarker: true }),
    opts: { finderPatternId: 'bullseye', margin: 20 },
  },
  {
    id: 'K · pinwheel',
    encoded: () => encodeK(PAYLOAD, {}),
    opts: { finderPatternId: 'pinwheel-c2-2-1100-cw', margin: 20 },
  },
];

/** 모양 전부 — 파라미터는 도메인 양 끝을 포함한다. */
const SPECS = [
  { kind: 'round', param: 0.35 },
  { kind: 'round', param: 1.0 },
  { kind: 'bevel', param: 0.6 },
  { kind: 'bevel', param: 1.4 },
  { kind: 'round-bevel', param: null },
  { kind: 'gap', param: 0.04 },
  { kind: 'gap', param: 0.08 },
  { kind: 'dot', param: 0.8 },
  { kind: 'dot', param: 1.0 },
];

const specLabel = (s) => `${s.kind}${s.param === null ? '' : ` ${s.param}`}`;

// ── 기하 헬퍼 (검증 대상과 독립 — sqrt 만) ─────────────────────────────────

const ptsKey = (pts) => pts.map((p) => `${p.x},${p.y}`).join(';');

/** 인코딩 셀의 면 polygon — 그리는 쪽과 독립으로 hexgrid 에서 다시 만든다(턴A 는 (−q,−r)). */
function cellFaces(scene, encoded) {
  const out = [];
  for (const [key, entry] of encoded.cellDigits) {
    const [q, r] = key.split(',').map(Number);
    const dq = scene.turnA ? -q : q;
    const dr = scene.turnA ? -r : r;
    for (const face of FACES) {
      out.push({ key, entry, face, points: facePolygon(dq, dr, face, scene.layout) });
    }
  }
  return out;
}

function segDist(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = a.x + dx * t - p.x; const ey = a.y + dy * t - p.y;
  return Math.sqrt(ex * ex + ey * ey);
}

function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

/** 점 → 도형 거리(안이면 0). */
function pointShapeDist(p, s) {
  if (s.kind === 'disc') {
    const dx = p.x - s.cx; const dy = p.y - s.cy;
    return Math.max(0, Math.sqrt(dx * dx + dy * dy) - s.r);
  }
  if (inPoly(p, s.points)) return 0;
  let best = Infinity;
  for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i, i += 1) {
    best = Math.min(best, segDist(p, s.points[j], s.points[i]));
  }
  return best;
}

/** 볼록 면(마름모) ↔ 도형 최소 거리. 면 꼭짓점→도형 · 도형 꼭짓점→면 변 양방향 + 포함. */
function faceShapeDist(face, s) {
  let best = Infinity;
  for (const v of face) best = Math.min(best, pointShapeDist(v, s));
  if (s.kind === 'disc') {
    const c = { x: s.cx, y: s.cy };
    if (inPoly(c, face)) return 0;
    for (let i = 0, j = face.length - 1; i < face.length; j = i, i += 1) {
      best = Math.min(best, Math.max(0, segDist(c, face[j], face[i]) - s.r));
    }
    return best;
  }
  for (const v of s.points) {
    if (inPoly(v, face)) return 0;
    for (let i = 0, j = face.length - 1; i < face.length; j = i, i += 1) {
      best = Math.min(best, segDist(v, face[j], face[i]));
    }
  }
  return best;
}

function faceT0Dist(face, t0) {
  let best = Infinity;
  for (const s of t0) {
    best = Math.min(best, faceShapeDist(face, s));
    if (best === 0) return 0;
  }
  return best;
}

// ── 조립 ───────────────────────────────────────────────────────────────────

const CACHE = new Map();
function built(fx, background = SLATE.background) {
  const id = `${fx.id}|${background === null ? 'null' : 'bg'}`;
  if (!CACHE.has(id)) {
    const encoded = fx.encoded();
    const palette = paletteWith(background);
    const off = buildScene(encoded, { ...fx.opts, palette });
    const faces = cellFaces(off, encoded);
    const faceKeys = new Map(faces.map((f) => [ptsKey(f.points), f]));
    // T0 = 끔 장면에서 셀 면이 아닌 도형(이 fixture 들엔 코너 QR 이 없다 — qrText 는 중앙 QR 뿐).
    const t0 = off.shapes.filter((s) => !(s.kind === 'polygon' && faceKeys.has(ptsKey(s.points))));
    const cellT0Dist = new Map();
    for (const f of faces) {
      const d = faceT0Dist(f.points, t0);
      cellT0Dist.set(f.key, Math.min(cellT0Dist.get(f.key) ?? Infinity, d));
    }
    CACHE.set(id, { encoded, palette, off, faces, faceKeys, t0, cellT0Dist });
  }
  return CACHE.get(id);
}

function onScene(fx, spec, background = SLATE.background) {
  const b = built(fx, background);
  return buildScene(b.encoded, { ...fx.opts, palette: b.palette, cellShape: spec });
}

// ── ⑦ 전제 ──────────────────────────────────────────────────────────────────

describe('⑦ 전제 — 대표 타입 O 가 O 계열 여섯 타입의 답과 같다', () => {
  test('모든 role × tones 유무에서 cellShapeTier · cellShapeAllowedKinds 가 O·C·G·A·V·K 동일', () => {
    const roles = ['anchor', 'marker', 'reference', 'format', 'data', 'filler', 'locator', 'slot', 'bullseye', 'mystery', undefined];
    for (const role of roles) {
      for (const tones of [undefined, { T: 0, L: 1, R: 2 }]) {
        const entry = { role, digit: 0, ...(tones ? { tones } : {}) };
        const want = cellShapeTier('O', entry);
        const wantKinds = cellShapeAllowedKinds('O', entry);
        for (const type of ['C', 'G', 'A', 'V', 'K']) {
          assert.equal(cellShapeTier(type, entry), want, `${type} role=${role} tones=${Boolean(tones)}`);
          assert.deepEqual(cellShapeAllowedKinds(type, entry), wantKinds, `${type} role=${role}`);
        }
      }
    }
  });
});

// ── ①②③⑤ 구조 ──────────────────────────────────────────────────────────────

describe('①②③⑤ 구조 — T1 불변 · 루프 밖 불변 · 발자국 1셀 · dot 은 T3 만', () => {
  for (const fx of FIXTURES) {
    test(fx.id, () => {
      const b = built(fx);
      // 공허한 초록 금지: 이 fixture 에 T1 셀도, T0 1셀 안의 T2/T3 셀도 있어야 자가 일한다.
      const predT1 = b.faces.filter((f) => cellShapeTier('O', f.entry) === CELL_TIERS.T1);
      const nearDecorable = b.faces.filter((f) => cellShapeTier('O', f.entry) !== CELL_TIERS.T1
        && b.cellT0Dist.get(f.key) < 1);
      assert.ok(predT1.length > 0, '전제: T1 셀이 없다 — ① 을 못 잰다');
      assert.ok(nearDecorable.length > 0, '전제: T0 1셀 안 T2/T3 셀이 없다 — 발자국 승격을 못 잰다');

      for (const spec of SPECS) {
        const on = onScene(fx, spec);
        const label = `${fx.id} · ${specLabel(spec)}`;

        // 꾸민 도형 → 원 면
        const decorated = new Set();
        for (const s of on.shapes) {
          if (!Array.isArray(s.basePoints)) continue;
          const k = ptsKey(s.basePoints);
          const f = b.faceKeys.get(k);
          assert.ok(f, `${label}: basePoints 가 어느 셀 면도 아니다`);
          decorated.add(k);
          const tier = cellShapeTier('O', f.entry);
          assert.ok(tier === CELL_TIERS.T2 || tier === CELL_TIERS.T3,
            `${label}: T1 셀(${f.entry.role}${f.entry.tones ? ':tones' : ''})이 꾸며졌다`);
          assert.ok(cellShapeAllowedKinds('O', f.entry, tier).includes(spec.kind),
            `${label}: ${f.entry.role} 셀에 허용 안 된 ${spec.kind}`);
          if (s.kind === 'disc') {
            assert.equal(spec.kind, 'dot');
            assert.ok(f.entry.role === 'data' || f.entry.role === 'filler',
              `${label}: dot 이 T3 밖(${f.entry.role})에 있다`);
          }
          // ③ 셀 단위 발자국: 꾸민 셀은 세 면 모두 T0 에서 1셀 이상.
          assert.ok(b.cellT0Dist.get(f.key) >= 1 - 1e-9,
            `${label}: T0 에서 ${b.cellT0Dist.get(f.key).toFixed(3)}셀인 셀이 꾸며졌다(발자국 승격 누락)`);
        }
        assert.ok(decorated.size > 0, `${label}: 꾸민 면이 하나도 없다 — spec 이 안 닿았다`);

        // ③ 승격이 일했다: 1셀 안 T2/T3 면은 하나도 안 꾸며졌다.
        for (const f of nearDecorable) {
          assert.ok(!decorated.has(ptsKey(f.points)), `${label}: 발자국 이웃(${f.key})이 꾸며졌다`);
        }

        // ① T1 면: 원본과 정확히 같은 도형이 그대로 있다.
        const plain = on.shapes.filter((s) => !Array.isArray(s.basePoints));
        const plainByKey = new Map(plain.filter((s) => s.kind === 'polygon').map((s) => [ptsKey(s.points), s]));
        for (const f of predT1) {
          const k = ptsKey(f.points);
          assert.ok(!decorated.has(k), `${label}: T1 면이 꾸며졌다`);
          const s = plainByKey.get(k);
          assert.ok(s, `${label}: T1 면(${f.key} ${f.face})이 사라졌다`);
          const orig = b.off.shapes.find((o) => o.kind === 'polygon' && ptsKey(o.points) === k);
          assert.deepEqual(s, orig, `${label}: T1 면(${f.key} ${f.face})이 원본과 다르다`);
        }

        // ② 꾸미지 않은 도형 전부(T0 · T1 · 승격 셀 · 허용 밖 셀)가 순서까지 같다.
        const offRest = b.off.shapes.filter((s) => !(s.kind === 'polygon' && decorated.has(ptsKey(s.points))));
        assert.deepEqual(plain, offRest, `${label}: 꾸미지 않은 도형 구간이 바뀌었다`);

        // 장면 메타는 꾸미기와 무관하다(새 키 없음).
        const { shapes: _a, ...metaOn } = on;
        const { shapes: _b, ...metaOff } = b.off;
        assert.deepEqual(metaOn, metaOff, `${label}: 장면 메타가 바뀌었다`);
      }
    });
  }
});

// ── ④ 픽셀 ─────────────────────────────────────────────────────────────────

const PPU = 8;

/** T0 발자국 + (1셀 − 여유) 팽창 마스크. 여유 = 픽셀 대각 반(AA 가 닿는 거리) + 1px. */
function t0Mask(b, width, height) {
  const reach = 1 - (0.75 + 1) / PPU;
  const mask = new Uint8Array(width * height);
  for (const s of b.t0) {
    let minX; let minY; let maxX; let maxY;
    if (s.kind === 'disc') {
      minX = s.cx - s.r; maxX = s.cx + s.r; minY = s.cy - s.r; maxY = s.cy + s.r;
    } else {
      minX = Math.min(...s.points.map((p) => p.x)); maxX = Math.max(...s.points.map((p) => p.x));
      minY = Math.min(...s.points.map((p) => p.y)); maxY = Math.max(...s.points.map((p) => p.y));
    }
    const x0 = Math.max(0, Math.floor((minX - reach) * PPU));
    const x1 = Math.min(width - 1, Math.ceil((maxX + reach) * PPU));
    const y0 = Math.max(0, Math.floor((minY - reach) * PPU));
    const y1 = Math.min(height - 1, Math.ceil((maxY + reach) * PPU));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = y * width + x;
        if (mask[i]) continue;
        if (pointShapeDist({ x: (x + 0.5) / PPU, y: (y + 0.5) / PPU }, s) < reach) mask[i] = 1;
      }
    }
  }
  return mask;
}

describe('④ 픽셀 — 검출 요소 발자국 + 1셀 팽창 마스크 안은 켬/끔 동일', () => {
  // 노출이 가장 큰 모양(dot 최대 · gap 최대 · round 최대 · round-bevel)을 불투명 · 투명 배경 둘 다에서.
  const PIXEL_SPECS = [
    { kind: 'dot', param: 1.0 }, { kind: 'gap', param: 0.08 },
    { kind: 'round', param: 1.0 }, { kind: 'round-bevel', param: null },
  ];
  for (const fx of FIXTURES) {
    for (const background of [SLATE.background, null]) {
      test(`${fx.id} · 배경 ${background === null ? '투명' : 'slate'}`, () => {
        const b = built(fx, background);
        const offR = rasterize(b.off, { pixelsPerUnit: PPU, supersample: 2 });
        const mask = t0Mask(b, offR.width, offR.height);
        let masked = 0;
        for (const m of mask) masked += m;
        assert.ok(masked > 0, '전제: 마스크가 비었다');
        for (const spec of PIXEL_SPECS) {
          const onR = rasterize(onScene(fx, spec, background), { pixelsPerUnit: PPU, supersample: 2 });
          assert.equal(onR.width, offR.width);
          assert.equal(onR.height, offR.height);
          let inDiff = 0; let outDiff = 0; let firstIn = null;
          for (let i = 0; i < mask.length; i += 1) {
            const o = i * 4;
            const same = offR.pixels[o] === onR.pixels[o] && offR.pixels[o + 1] === onR.pixels[o + 1]
              && offR.pixels[o + 2] === onR.pixels[o + 2] && offR.pixels[o + 3] === onR.pixels[o + 3];
            if (same) continue;
            if (mask[i]) { inDiff += 1; if (firstIn === null) firstIn = i; } else outDiff += 1;
          }
          assert.equal(inDiff, 0,
            `${specLabel(spec)}: 마스크 안 ${inDiff}/${masked} 픽셀이 바뀌었다 (첫 픽셀 x=${firstIn % offR.width}, y=${Math.floor(firstIn / offR.width)})`);
          assert.ok(outDiff > 0, `${specLabel(spec)}: 마스크 밖도 안 바뀌었다 — 꾸미기가 안 먹었다(대조 실패)`);
        }
      });
    }
  }
});

// ── ⑥ 모르는 role ───────────────────────────────────────────────────────────

describe('⑥ 모르는 role → T1', () => {
  test('데이터 셀의 role 을 모르는 값으로 바꾸면 그 셀은 어떤 모양에서도 원본 그대로다', () => {
    const encoded = encode(PAYLOAD, {});
    const cellDigits = new Map(encoded.cellDigits);
    const planted = [];
    for (const [key, entry] of cellDigits) {
      if (entry.role !== 'data') continue;
      const role = planted.length === 0 ? 'mystery' : planted.length === 1 ? 'bullseye' : 'slot';
      cellDigits.set(key, { ...entry, role });
      planted.push(key);
      if (planted.length === 3) break;
    }
    const enc = { ...encoded, cellDigits };
    const opts = { palette: paletteWith(SLATE.background), finderPatternId: 'bullseye' };
    const off = buildScene(enc, opts);
    for (const spec of SPECS) {
      const on = buildScene(enc, { ...opts, cellShape: spec });
      const decorated = new Set(on.shapes.filter((s) => s.basePoints).map((s) => ptsKey(s.basePoints)));
      assert.ok(decorated.size > 0, `${specLabel(spec)}: 대조 — 다른 데이터 셀은 꾸며져야 한다`);
      for (const key of planted) {
        const [q, r] = key.split(',').map(Number);
        for (const face of FACES) {
          const k = ptsKey(facePolygon(q, r, face, off.layout));
          assert.ok(!decorated.has(k), `${specLabel(spec)}: 모르는 role 셀(${cellDigits.get(key).role})이 꾸며졌다`);
          assert.ok(on.shapes.some((s) => !s.basePoints && s.kind === 'polygon' && ptsKey(s.points) === k),
            `${specLabel(spec)}: 모르는 role 셀 면이 사라졌다`);
        }
      }
    }
  });
});

// ── 기본값 · resolver 경유 ──────────────────────────────────────────────────

describe('기본값 · resolver 경유', () => {
  test('cellShape 없음 · null · square 는 모두 꺼진 장면과 같다(새 키 없음)', () => {
    const fx = FIXTURES[0];
    const b = built(fx);
    for (const cellShape of [undefined, null, { kind: 'square', param: null }]) {
      const s = buildScene(b.encoded, { ...fx.opts, palette: b.palette, cellShape });
      assert.deepEqual(s, b.off, `cellShape=${JSON.stringify(cellShape)}`);
    }
  });

  test('모르는 모양 · 모양 아닌 값은 조용히 사각으로 떨어지지 않고 던진다', () => {
    const fx = FIXTURES[0];
    const b = built(fx);
    assert.throws(() => buildScene(b.encoded, { ...fx.opts, palette: b.palette, cellShape: { kind: 'hex' } }), RangeError);
    assert.throws(() => buildScene(b.encoded, { ...fx.opts, palette: b.palette, cellShape: 'gap' }), TypeError);
  });

  test('resolver: 스텁(전부 잠금)이면 spec null → 꺼진 장면 · fixture 허용표 행이면 꾸민 장면', () => {
    const fx = FIXTURES[0];
    const b = built(fx);
    // 문맥은 제품 함수로 이 fixture 의 실제 인코딩에서 유도한다(손 문맥은 측정 구성 키 — 코너 마커 · 사괘 · ECC — 를
    // 빠뜨리거나 거짓으로 채운다). 이 fixture 는 O + 코너 마커(안쪽 o-cm)라 실효 타입 G 다 — G 행은 생성 표에 없다.
    // 실효 검출 강조(렌더 값)는 이 fixture 가 buildScene 에 넘기는 **그 옵션**에서 제품 유도 함수로 만든다.
    const render = { quietColor: 'white', detectorEmphasis: detectorEmphasisEquivalents('O', b.encoded, { ...fx.opts, palette: b.palette }) };
    const ctx = cellShapeCtx('O', b.encoded, {
      finderPatternId: fx.opts.finderPatternId, innerSeat: 'o-cm', tone: 3, bgMode: 'white', preset: 'slate', qrPosition: 'none',
    }, render);
    assert.equal(typeof ctx.detectorEmphasis, 'string', '실효 검출 강조가 문맥에 없다');
    assert.equal(ctx.type, 'G');
    const state = Object.freeze({ cellShape: 'gap', cellGap: 0.08 });
    const locked = resolveCellShapeSpec(state, ctx);
    assert.equal(locked.spec, null);
    assert.ok(locked.lockReason);
    const sLocked = buildScene(b.encoded, { ...fx.opts, palette: b.palette, ...(locked.spec ? { cellShape: locked.spec } : {}) });
    assert.deepEqual(sLocked, b.off);

    const allow = { ROWS: [{ table: 'oak', ...ctx, cellShape: 'gap', param: 0.08 }] };
    const open = resolveCellShapeSpec(state, ctx, allow);
    assert.deepEqual(open.spec, { kind: 'gap', param: 0.08 });
    const sOpen = buildScene(b.encoded, { ...fx.opts, palette: b.palette, cellShape: open.spec });
    assert.ok(sOpen.shapes.some((s) => s.noSeam === true && Array.isArray(s.basePoints)));
  });
});

// ── ⑧ svg seam ─────────────────────────────────────────────────────────────

describe('⑧ svg seam — noSeam 조각만 stroke 가 없다', () => {
  test('gap 조각은 stroke 없음 · round · bevel 은 stroke 유지 · 끔 장면은 전부 stroke', () => {
    const fx = FIXTURES[1];
    const b = built(fx);
    const count = (svg) => ({
      stroked: (svg.match(/<polygon [^>]*stroke=/g) || []).length,
      bare: (svg.match(/<polygon points="[^"]*" fill="#[0-9a-f]{6}"\/>/g) || []).length,
    });
    const off = count(sceneToSvg(b.off));
    assert.equal(off.bare, 0, '끔 장면(qr 표지 없음)에 stroke 없는 polygon 이 있다');

    const gap = onScene(fx, { kind: 'gap', param: 0.08 });
    const gapNoSeam = gap.shapes.filter((s) => s.kind === 'polygon' && s.noSeam === true).length;
    assert.ok(gapNoSeam > 0);
    const g = count(sceneToSvg(gap));
    assert.equal(g.bare, gapNoSeam, 'noSeam polygon 수와 stroke 없는 polygon 수가 다르다');

    for (const spec of [{ kind: 'round', param: 1.0 }, { kind: 'bevel', param: 0.6 }]) {
      const s = onScene(fx, spec);
      assert.equal(s.shapes.filter((x) => x.noSeam).length, 0, `${spec.kind} 에 noSeam 이 붙었다`);
      assert.equal(count(sceneToSvg(s)).bare, 0, `${spec.kind}: seam 이 빠졌다`);
    }
  });
});
