// cell-shape-detector-exclusion-y.test.js — Type Y 셀 꾸미기의 «검출 요소 제외» 성질
// (DESIGN_001 §3.0 · §3.2 · §4.2 sceneY.js · §7.5 y 행, 레인 L3 2026-09-26)
//
// 재는 것은 «값» 이 아니라 «성질» 이다. 기대값은 HEAD 출력을 박제하지 않고 **꾸미기 끔 장면을
// 같은 실행에서 다시 만들어** 대조한다. 셀 면 · 심 · 코너 QR 은 그리는 쪽(sceneY)과 독립으로
// 찾는다 — 셀 면은 `ygrid.moduleQuad`, 심은 «원점에서 실루엣 꼭짓점까지 뻗은 긴 도형», 코너 QR 은
// 끔 장면의 기존 `selfQuiet` 표지(2026-08-23 부터 있던 제품 표지 — 이번 변경의 대상이 아니다).
//
//   ① T1(locator · reference · 모르는 role)의 면 polygon 이 원본과 **정확히 같다**.
//   ② 꾸미지 않은 도형 전부(T0 — 슬롯 · 심 · 중심 도트 · hex-frame · 코너 QR · 윈도 β — 와 T1 ·
//      승격 셀)가 순서까지 불변이다. 장면 메타(새 키 없음)도 불변.
//   ③ 꾸민 셀은 T0(심 · 코너 QR 제외)에서 1셀 이상 떨어져 있다 — 셀 (i,j) 단위. 그 승격이 **실제로
//      일했다**(1셀 안 T2/T3 셀이 있는 fixture 에서 그 셀이 안 꾸며졌다 — 공허한 초록 금지).
//   ④ **검출 요소 발자국 + 1셀 팽창 마스크 안의 래스터 픽셀이 꾸미기 켬/끔에서 같다**(심은 'keep'
//      에서 인접 1줄 폭) — 마스크 밖은 실제로 바뀐다(대조).
//   ⑤ dot 은 data 밖에 없다(§3.2 — Y filler · format 도 dot 금지).
//   ⑥ 모르는 role → T1.
//   ⑦ seamAdjacent 'keep'(기본)에서 심 인접 셀 불변 · 'decorate' 에서는 실제로 꾸며진다 · 모르는
//      값은 던진다.
//   ⑧ tones 없는 구 레이아웃 fixture(off · hex-frame-v1 · tones 를 벗긴 v0/v0tr)에서도 ①–③ 이
//      성립한다 — 등급은 tones 가 아니라 role 로 가른다(§3.0 정정 2).
//   ⑨ 코너 QR `palette.qrDeco`: 조각이 안전영역에 삼켜지지 않는다(태그를 벗기면 삼켜진다 — 심은
//      결함) · 기능 모듈은 정확한 모듈 사각 · 눈은 deco.eye · 윈도 β · 슬롯 QR 과 나머지 도형은 불변.
//   ⑩ bevel 띠 클램프: 생산자가 아는 배경을 avoid 에 더한다(투명 배경은 더하지 않는다).
// 격자: 레이아웃 v0(n=13) · v0TR(21·25) · off(21) · hex-frame-v1(13) · 슬롯 v0WQ(21) · 윈도 β(25)
// (v0 는 n=13 전용 — 인코더가 version 0 만 받는다)
// × 모양 전부(파라미터 양 끝 포함). 허용표는 거치지 않고 spec 을 직접 넣는다(스텁은 전부 잠금).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY } from '../src/sceneY.js';
import { moduleQuad, YFACES } from '../src/ygrid.js';
import { rasterize } from '../src/raster.js';
import { quietZonePolygons } from '../src/quietzone.js';
import { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT, relativeLuminance } from '../src/luminance.js';
import { TL_READER_URL, qrMatrix } from '../src/qr.js';
import { CELL_TIERS, cellShapeTier, faceGainColor } from '../src/cell-shape.js';
import { resolveQrDeco, QR_COLOR_MODES, QR_EYE_MODES } from '../src/qr-colors.js';
import { SQUARE_CELL_STYLES } from '../src/square-cell-style.js';
import { qrFunctionMapV1 } from '../src/qr-function-map.js';

const SLATE = getPreset('slate');
const paletteWith = (background) => ({
  background, levels: SLATE.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
});
const PAYLOAD = 'https://tl.estre.so';

/** tones 를 벗긴 사본 — 구 초안 레이아웃처럼 sceneY 가 톤을 유도하는 경로를 타게 한다. */
function stripTones(encoded) {
  const cellDigits = new Map();
  for (const [key, entry] of encoded.cellDigits) {
    const { tones: _drop, ...rest } = entry;
    cellDigits.set(key, rest);
  }
  return { ...encoded, cellDigits };
}

// ── fixture ────────────────────────────────────────────────────────────────
// nearT0: 심 · 코너 QR 이 아닌 T0 1셀 안에 T2/T3 셀이 있다(승격이 일하는지 잴 수 있다).

const FIXTURES = [
  {
    id: 'v0 n=13 (+코너 QR)',
    encoded: () => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', version: 0, tones: 3, eccLevel: 'M' }),
    opts: { qrText: TL_READER_URL },
  },
  {
    id: 'v0TR n=25 (+코너 QR BR)',
    encoded: () => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0tr', version: 2, tones: 3, eccLevel: 'M' }),
    opts: { qrText: TL_READER_URL, qrCorner: 'BR' },
  },
  {
    id: 'v0TR n=21',
    encoded: () => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0tr', version: 1, tones: 3, eccLevel: 'M' }),
    opts: { qrText: TL_READER_URL },
  },
  {
    id: 'off n=21 (구 레이아웃 — tones 없음)',
    encoded: () => encodeY(PAYLOAD, { version: 1, tones: 3, eccLevel: 'M' }),
    opts: { qrText: TL_READER_URL },
    nearT0: true,
  },
  {
    id: 'hex-frame-v1 n=13 (tones 없음)',
    encoded: () => encodeY(PAYLOAD, { version: 0, tones: 3, eccLevel: 'M' }),
    opts: { qrText: TL_READER_URL, locatorProfile: 'hex-frame-v1' },
    nearT0: true,
  },
  {
    id: 'v0 n=13 tones 벗김 (구 레이아웃 fixture)',
    encoded: () => stripTones(encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', version: 0, tones: 3, eccLevel: 'M' })),
    opts: {},
  },
  {
    id: 'v0TR n=21 tones 벗김 (구 레이아웃 fixture)',
    encoded: () => stripTones(encodeY(PAYLOAD, { cellSurfaceLayout: 'v0tr', version: 1, tones: 3, eccLevel: 'M' })),
    opts: {},
  },
  {
    id: '슬롯 v0WQ n=21 (슬롯 QR = T0)',
    encoded: () => encodeY(PAYLOAD, { cellSurfaceLayout: 'v0wq', version: 1, tones: 3, eccLevel: 'M' }),
    opts: { qrText: TL_READER_URL },
    nearT0: true,
  },
  {
    id: '윈도 β n=25 2톤 (윈도 QR = T0)',
    encoded: () => encodeY(PAYLOAD, { window: true, tones: 2, eccLevel: 'M' }),
    opts: { qrText: TL_READER_URL },
    nearT0: true,
  },
];

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

const specLabel = (s) => `${s.kind}${s.param === null ? '' : ` ${s.param}`}${s.seamAdjacent ? ` seam=${s.seamAdjacent}` : ''}`;

// ── 기하 헬퍼 (검증 대상과 독립 — sqrt 만) ─────────────────────────────────

const ptsKey = (pts) => pts.map((p) => `${p.x},${p.y}`).join(';');

/** 인코딩 셀의 면 polygon — 그리는 쪽과 독립으로 ygrid 에서 다시 만든다(slot 은 그리지 않는다). */
function cellFaces(scene, encoded) {
  const out = [];
  for (const [key, entry] of encoded.cellDigits) {
    if (entry.role === 'slot') continue;
    const [i, j] = key.split(',').map(Number);
    for (const face of YFACES) out.push({ key, i, j, entry, face, points: moduleQuad(face, i, j, scene.layout) });
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

function faceSetDist(face, set) {
  let best = Infinity;
  for (const s of set) {
    best = Math.min(best, faceShapeDist(face, s));
    if (best === 0) return 0;
  }
  return best;
}

/** 심 = 셀 면이 아닌 polygon 중 원점 가까이(0.1셀)에서 시작해 실루엣 꼭짓점(n셀)까지 닿는 것. */
function isSeamShape(s, scene, n) {
  if (s.kind !== 'polygon' || s.selfQuiet) return false;
  const o = { x: scene.layout.originX, y: scene.layout.originY };
  const size = scene.layout.size;
  const ds = s.points.map((p) => Math.sqrt((p.x - o.x) ** 2 + (p.y - o.y) ** 2) / size);
  return Math.min(...ds) < 0.1 && Math.max(...ds) > n - 0.01;
}

// ── 조립 ───────────────────────────────────────────────────────────────────

const CACHE = new Map();
function built(fx, background = null) {
  const id = `${fx.id}|${JSON.stringify(background)}`;
  if (!CACHE.has(id)) {
    const encoded = fx.encoded();
    const palette = paletteWith(background);
    const off = buildSceneY(encoded, { ...fx.opts, palette });
    const faces = cellFaces(off, encoded);
    const faceKeys = new Map(faces.map((f) => [ptsKey(f.points), f]));
    const nonCell = off.shapes.filter((s) => !(s.kind === 'polygon' && faceKeys.has(ptsKey(s.points))));
    const seams = nonCell.filter((s) => isSeamShape(s, off, encoded.n));
    const corner = nonCell.filter((s) => s.selfQuiet === true);
    const t0 = nonCell.filter((s) => !seams.includes(s) && !corner.includes(s));
    assert.equal(seams.length, 3, `${fx.id}: 심 3선을 못 찾았다(${seams.length})`);
    // 셀 단위 거리(세 면의 최소).
    const cellT0Dist = new Map();
    const cellSeamDist = new Map();
    for (const f of faces) {
      cellT0Dist.set(f.key, Math.min(cellT0Dist.get(f.key) ?? Infinity, faceSetDist(f.points, t0)));
      cellSeamDist.set(f.key, Math.min(cellSeamDist.get(f.key) ?? Infinity, faceSetDist(f.points, seams)));
    }
    CACHE.set(id, {
      encoded, palette, off, faces, faceKeys, seams, corner, t0, cellT0Dist, cellSeamDist,
    });
  }
  return CACHE.get(id);
}

function onScene(fx, spec, background = null) {
  const b = built(fx, background);
  return buildSceneY(b.encoded, { ...fx.opts, palette: b.palette, cellShape: spec });
}

/** 심 인접 1줄: 심 도형에서 반 셀 미만(첫 줄은 겹쳐 0, 둘째 줄은 √3/2 − 반폭 ≈ 0.79). */
const SEAM_ROW = 0.5;

// ── ①②③⑤⑦⑧ 구조 ────────────────────────────────────────────────────────────

describe('①②③⑤⑦⑧ 구조 — T1 불변 · 루프 밖 불변 · 발자국 1셀 · dot 은 data 만 · 심 인접', () => {
  for (const fx of FIXTURES) {
    test(fx.id, () => {
      const b = built(fx);
      const predT1 = b.faces.filter((f) => cellShapeTier('Y', f.entry) === CELL_TIERS.T1);
      const nearDecorable = b.faces.filter((f) => cellShapeTier('Y', f.entry) !== CELL_TIERS.T1
        && b.cellT0Dist.get(f.key) < 1);
      const seamRow = b.faces.filter((f) => cellShapeTier('Y', f.entry) !== CELL_TIERS.T1
        && b.cellSeamDist.get(f.key) < SEAM_ROW);
      // 공허한 초록 금지.
      assert.ok(predT1.length > 0, '전제: T1 셀(reference · locator)이 없다');
      assert.ok(seamRow.length > 0, '전제: 심 인접 T2/T3 셀이 없다 — ⑦ 을 못 잰다');
      if (fx.nearT0) assert.ok(nearDecorable.length > 0, '전제: T0 1셀 안 T2/T3 셀이 없다 — 발자국 승격을 못 잰다');

      for (const base of SPECS) {
        for (const seamAdjacent of [undefined, 'decorate']) {
          const spec = seamAdjacent ? { ...base, seamAdjacent } : base;
          const on = onScene(fx, spec);
          const label = `${fx.id} · ${specLabel(spec)}`;

          const decorated = new Set();
          for (const s of on.shapes) {
            if (!Array.isArray(s.basePoints)) continue;
            const k = ptsKey(s.basePoints);
            const f = b.faceKeys.get(k);
            assert.ok(f, `${label}: basePoints 가 어느 셀 면도 아니다`);
            decorated.add(k);
            const tier = cellShapeTier('Y', f.entry);
            assert.ok(tier === CELL_TIERS.T2 || tier === CELL_TIERS.T3,
              `${label}: T1 셀(${f.entry.role})이 꾸며졌다`);
            if (tier === CELL_TIERS.T2) assert.notEqual(spec.kind, 'dot', `${label}: T2(${f.entry.role})에 dot`);
            // ⑤ dot 은 data 만.
            if (s.kind === 'disc' || spec.kind === 'dot') {
              assert.equal(f.entry.role, 'data', `${label}: dot 이 data 밖(${f.entry.role})에 있다`);
            }
            // ③ 셀 단위 발자국.
            assert.ok(b.cellT0Dist.get(f.key) >= 1 - 1e-9,
              `${label}: T0 에서 ${b.cellT0Dist.get(f.key).toFixed(3)}셀인 셀(${f.key})이 꾸며졌다`);
            // ⑦ 'keep'(기본)이면 심 인접 셀은 안 꾸며진다 — 셀 단위.
            if (seamAdjacent === undefined) {
              assert.ok(b.cellSeamDist.get(f.key) >= SEAM_ROW,
                `${label}: 심 인접 셀(${f.key})이 'keep' 에서 꾸며졌다`);
            }
          }
          assert.ok(decorated.size > 0, `${label}: 꾸민 면이 하나도 없다 — spec 이 안 닿았다`);

          // ③ 승격이 일했다.
          for (const f of nearDecorable) {
            assert.ok(!decorated.has(ptsKey(f.points)), `${label}: 발자국 이웃(${f.key})이 꾸며졌다`);
          }
          // ⑦ 'decorate' 변형은 실제로 심 인접 줄을 꾸민다(T0 1셀 밖 · dot 은 data 인 셀 중에서).
          if (seamAdjacent === 'decorate') {
            const eligible = seamRow.filter((f) => b.cellT0Dist.get(f.key) >= 1
              && (spec.kind !== 'dot' || f.entry.role === 'data')
              && !(spec.kind === 'dot' && cellShapeTier('Y', f.entry) !== CELL_TIERS.T3));
            if (eligible.length > 0) {
              assert.ok(eligible.some((f) => decorated.has(ptsKey(f.points))),
                `${label}: 'decorate' 인데 심 인접 셀이 하나도 안 꾸며졌다`);
            }
          }

          // ① T1 면: 원본과 정확히 같은 객체 값.
          const plain = on.shapes.filter((s) => !Array.isArray(s.basePoints));
          const plainByKey = new Map(plain.filter((s) => s.kind === 'polygon').map((s) => [ptsKey(s.points), s]));
          const offByKey = new Map(b.off.shapes.filter((s) => s.kind === 'polygon').map((s) => [ptsKey(s.points), s]));
          for (const f of predT1) {
            const k = ptsKey(f.points);
            if (!offByKey.has(k)) continue; // 윈도 좌표 등 원래 안 그리는 면
            assert.ok(!decorated.has(k), `${label}: T1 면이 꾸며졌다`);
            assert.deepEqual(plainByKey.get(k), offByKey.get(k), `${label}: T1 면(${f.key} ${f.face})이 원본과 다르다`);
          }

          // ② 꾸미지 않은 도형 전부가 순서까지 같다.
          const offRest = b.off.shapes.filter((s) => !(s.kind === 'polygon' && decorated.has(ptsKey(s.points))));
          assert.deepEqual(plain, offRest, `${label}: 꾸미지 않은 도형 구간이 바뀌었다`);

          const { shapes: _a, ...metaOn } = on;
          const { shapes: _b, ...metaOff } = b.off;
          assert.deepEqual(metaOn, metaOff, `${label}: 장면 메타가 바뀌었다`);
        }
      }
    });
  }
});

// ── ④ 픽셀 ─────────────────────────────────────────────────────────────────

const PPU = 6;
const AA = (0.75 + 1) / PPU; // 픽셀 대각 반(AA 가 닿는 거리) + 1px

/** 발자국 + reach 팽창 마스크. 도형 목록마다 reach 가 다르다. */
function footprintMask(groups, width, height) {
  const mask = new Uint8Array(width * height);
  for (const { shapes, reach } of groups) {
    for (const s of shapes) {
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
  }
  return mask;
}

function diffCount(offR, onR, mask) {
  let inDiff = 0; let outDiff = 0; let firstIn = null;
  for (let i = 0; i < mask.length; i += 1) {
    const o = i * 4;
    const same = offR.pixels[o] === onR.pixels[o] && offR.pixels[o + 1] === onR.pixels[o + 1]
      && offR.pixels[o + 2] === onR.pixels[o + 2] && offR.pixels[o + 3] === onR.pixels[o + 3];
    if (same) continue;
    if (mask[i]) { inDiff += 1; if (firstIn === null) firstIn = i; } else outDiff += 1;
  }
  return { inDiff, outDiff, firstIn };
}

describe('④ 픽셀 — 검출 요소 발자국 + 1셀 팽창 마스크 안은 켬/끔 동일', () => {
  // 노출이 가장 큰 모양을 투명(Y 기본) · slate 배경 둘 다에서. 심 줄 폭 = 둘째 줄까지 거리 − AA.
  const PIXEL_SPECS = [
    { kind: 'dot', param: 1.0 }, { kind: 'gap', param: 0.08 },
    { kind: 'round', param: 1.0 }, { kind: 'round-bevel', param: null },
  ];
  const seamReach = Math.sqrt(3) / 2 - 0.075 - AA;
  for (const fx of FIXTURES.filter((f) => !f.id.includes('tones 벗김'))) {
    for (const background of [null, SLATE.background]) {
      test(`${fx.id} · 배경 ${background === null ? '투명' : 'slate'}`, () => {
        const b = built(fx, background);
        const offR = rasterize(b.off, { pixelsPerUnit: PPU, supersample: 2 });
        const t0Mask = footprintMask([
          { shapes: b.t0, reach: 1 - AA },
          { shapes: b.corner, reach: 1 - AA },
        ], offR.width, offR.height);
        const keepMask = footprintMask([
          { shapes: b.t0, reach: 1 - AA },
          { shapes: b.corner, reach: 1 - AA },
          { shapes: b.seams, reach: seamReach },
        ], offR.width, offR.height);
        const seamOnly = footprintMask([{ shapes: b.seams, reach: seamReach }], offR.width, offR.height);
        let masked = 0;
        for (const m of keepMask) masked += m;
        assert.ok(masked > 0, '전제: 마스크가 비었다');
        for (const spec of PIXEL_SPECS) {
          const keepR = rasterize(onScene(fx, spec, background), { pixelsPerUnit: PPU, supersample: 2 });
          assert.equal(keepR.width, offR.width);
          assert.equal(keepR.height, offR.height);
          const k = diffCount(offR, keepR, keepMask);
          assert.equal(k.inDiff, 0,
            `${specLabel(spec)} keep: 마스크 안 ${k.inDiff}/${masked} 픽셀이 바뀌었다 (첫 픽셀 x=${k.firstIn % offR.width}, y=${Math.floor(k.firstIn / offR.width)})`);
          assert.ok(k.outDiff > 0, `${specLabel(spec)} keep: 마스크 밖도 안 바뀌었다 — 꾸미기가 안 먹었다(대조 실패)`);

          // 'decorate' 변형: 심 인접 줄은 바뀌어도 되지만, 심 아닌 T0 · 코너 QR 발자국은 그대로다.
          const decR = rasterize(onScene(fx, { ...spec, seamAdjacent: 'decorate' }, background), { pixelsPerUnit: PPU, supersample: 2 });
          const d = diffCount(offR, decR, t0Mask);
          assert.equal(d.inDiff, 0, `${specLabel(spec)} decorate: T0 발자국 안 ${d.inDiff} 픽셀이 바뀌었다`);
          const ds = diffCount(offR, decR, seamOnly);
          assert.ok(ds.inDiff > 0, `${specLabel(spec)} decorate: 심 인접 줄 픽셀이 하나도 안 바뀌었다(변형이 안 먹었다)`);
        }
      });
    }
  }
});

// ── ⑥ 모르는 role ───────────────────────────────────────────────────────────

describe('⑥ 모르는 role → T1', () => {
  test('데이터 셀의 role 을 모르는 값으로 바꾸면 그 셀은 어떤 모양에서도 원본 그대로다', () => {
    const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: 'v0tr', version: 1, tones: 3, eccLevel: 'M' });
    const cellDigits = new Map(encoded.cellDigits);
    const planted = [];
    for (const [key, entry] of cellDigits) {
      const [i, j] = key.split(',').map(Number);
      if (entry.role !== 'data' || i < 4 || j < 4) continue; // 심 · 중심에서 떨어진 셀
      const role = ['mystery', 'bullseye', 'finder'][planted.length];
      cellDigits.set(key, { ...entry, role });
      planted.push(key);
      if (planted.length === 3) break;
    }
    const enc = { ...encoded, cellDigits };
    const opts = { palette: paletteWith(null) };
    const off = buildSceneY(enc, opts);
    for (const spec of SPECS) {
      const on = buildSceneY(enc, { ...opts, cellShape: { ...spec, seamAdjacent: 'decorate' } });
      const decorated = new Set(on.shapes.filter((s) => s.basePoints).map((s) => ptsKey(s.basePoints)));
      assert.ok(decorated.size > 0, `${specLabel(spec)}: 대조 — 다른 데이터 셀은 꾸며져야 한다`);
      for (const key of planted) {
        const [i, j] = key.split(',').map(Number);
        for (const face of YFACES) {
          const k = ptsKey(moduleQuad(face, i, j, off.layout));
          assert.ok(!decorated.has(k), `${specLabel(spec)}: 모르는 role 셀(${cellDigits.get(key).role})이 꾸며졌다`);
          assert.ok(on.shapes.some((s) => !s.basePoints && s.kind === 'polygon' && ptsKey(s.points) === k),
            `${specLabel(spec)}: 모르는 role 셀 면이 사라졌다`);
        }
      }
    }
  });
});

// ── 기본값 · 계약 ───────────────────────────────────────────────────────────

describe('기본값 · 계약', () => {
  test('cellShape 없음 · null · square 는 모두 꺼진 장면과 같다(새 키 없음)', () => {
    for (const fx of [FIXTURES[0], FIXTURES[7], FIXTURES[8]]) {
      const b = built(fx);
      for (const cellShape of [undefined, null, { kind: 'square', param: null }, { kind: 'square', seamAdjacent: 'decorate' }]) {
        const s = buildSceneY(b.encoded, { ...fx.opts, palette: b.palette, cellShape });
        assert.deepEqual(s, b.off, `${fx.id} cellShape=${JSON.stringify(cellShape)}`);
      }
    }
  });

  test('모르는 모양 · 모양 아닌 값 · 모르는 심 변형은 조용히 사각으로 떨어지지 않고 던진다', () => {
    const b = built(FIXTURES[0]);
    const run = (cellShape) => () => buildSceneY(b.encoded, { ...FIXTURES[0].opts, palette: b.palette, cellShape });
    assert.throws(run({ kind: 'hex' }), RangeError);
    assert.throws(run('gap'), TypeError);
    assert.throws(run({ kind: 'gap', param: 0.08, seamAdjacent: 'promote' }), RangeError);
    assert.throws(run({ kind: 'gap', param: 0.08, avoid: { r: 0, g: 0, b: 0 } }), TypeError);
  });
});

// ── ⑩ bevel 띠 클램프 ──────────────────────────────────────────────────────

describe('⑩ bevel 띠 클램프 — 생산자가 아는 배경을 avoid 에 더한다', () => {
  test('불투명 배경: 모든 띠가 배경과 ≥ 0.05 떨어지거나 원색이다 · 클램프가 실제로 걸린 띠가 있다', () => {
    const fx = FIXTURES[3];
    const white = { r: 255, g: 255, b: 255 };
    const b = built(fx, white);
    const on = buildSceneY(b.encoded, { ...fx.opts, palette: b.palette, cellShape: { kind: 'bevel', param: 1.4, seamAdjacent: 'decorate' } });
    const yBg = relativeLuminance(white);
    let bands = 0; let clamped = 0;
    for (let i = 0; i < on.shapes.length; i += 1) {
      const s = on.shapes[i];
      if (!s.basePoints || ptsKey(s.points) !== ptsKey(s.basePoints)) continue; // 바깥 띠(원 마름모)만
      const core = on.shapes[i + 1];
      bands += 1;
      const same = s.color.r === core.color.r && s.color.g === core.color.g && s.color.b === core.color.b;
      assert.ok(same || Math.abs(relativeLuminance(s.color) - yBg) >= 0.05 - 1e-12,
        `띠 휘도 ${relativeLuminance(s.color)} 가 배경 ${yBg} 와 0.05 안이다`);
      const raw = faceGainColor(core.color, 1.4);
      if (raw.r !== s.color.r || raw.g !== s.color.g || raw.b !== s.color.b) clamped += 1;
    }
    assert.ok(bands > 0, '전제: bevel 띠가 없다');
    assert.ok(clamped > 0, '대조: 흰 배경 × gain 1.4 인데 클램프가 한 번도 안 걸렸다 — 배경이 avoid 에 안 들어갔다');
  });

  test('투명 배경(Y 기본): 배경을 더하지 않는다 — 띠 = 원색 × gain 그대로', () => {
    const fx = FIXTURES[3];
    const b = built(fx, null);
    const on = buildSceneY(b.encoded, { ...fx.opts, palette: b.palette, cellShape: { kind: 'bevel', param: 1.4 } });
    let bands = 0;
    for (let i = 0; i < on.shapes.length; i += 1) {
      const s = on.shapes[i];
      if (!s.basePoints || ptsKey(s.points) !== ptsKey(s.basePoints)) continue;
      const core = on.shapes[i + 1];
      assert.deepEqual(s.color, faceGainColor(core.color, 1.4));
      bands += 1;
    }
    assert.ok(bands > 0);
  });
});

// ── ⑨ 코너 QR palette.qrDeco ───────────────────────────────────────────────

const ALLOW_ALL_QR_Y = Object.freeze({
  ROWS: Object.freeze(SQUARE_CELL_STYLES.flatMap((qrCellStyle) => QR_COLOR_MODES.flatMap((qrColorMode) => (
    QR_EYE_MODES.map((eyeMode) => Object.freeze({ table: 'qr', host: 'y', qrCellStyle, qrColorMode, eyeMode }))
  )))),
});

function decoOf(state) {
  const r = resolveQrDeco(state, SLATE, 'y', ALLOW_ALL_QR_Y);
  assert.ok(r.deco, `전제: deco 가 안 열렸다 ${JSON.stringify(state)} → ${r.lockReason}`);
  return r.deco;
}

const QR_DECO_STATES = [
  { qrColorMode: 'custom', qrHue: 210, qrSat: 200, qrCellStyle: 'dots', qrEyeMode: 'darker' },
  { qrColorMode: 'custom', qrHue: 0, qrSat: 0, qrCellStyle: 'rounded' },
  { qrColorMode: 'match', qrCellStyle: 'classy-rounded', qrEyeMode: 'darker' },
  { qrColorMode: 'default', qrCellStyle: 'diamond' },
];

const sameRgb = (a, c) => a.r === c.r && a.g === c.g && a.b === c.b;
const centroid = (s) => (s.kind === 'disc' ? { x: s.cx, y: s.cy }
  : s.points.reduce((a, q) => ({ x: a.x + q.x / s.points.length, y: a.y + q.y / s.points.length }), { x: 0, y: 0 }));

/** 코너 QR 블록 사각(끔 장면의 selfQuiet 콰이어트 패치 — 가장 큰 selfQuiet 사각). */
function cornerBlockRect(off) {
  let best = null; let area = 0;
  for (const s of off.shapes) {
    if (!s.selfQuiet || s.kind !== 'polygon') continue;
    const xs = s.points.map((p) => p.x); const ys = s.points.map((p) => p.y);
    const r = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const a = (r.maxX - r.minX) * (r.maxY - r.minY);
    if (a > area) { area = a; best = r; }
  }
  return best;
}
const inRect = (p, r) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

describe('⑨ 코너 QR palette.qrDeco — 코너만 · 안전영역 제외 · 기능 모듈 고정', () => {
  const QR_COLORS = [BULLSEYE_LIGHT, BULLSEYE_DARK];
  for (const fx of [FIXTURES[0], FIXTURES[1], FIXTURES[3]]) {
    test(`${fx.id}: 코너 블록 밖은 불변 · 조각 태그 · 안전영역이 안 삼킨다 · 태그 벗기면 삼킨다`, () => {
      const b = built(fx);
      const rect = cornerBlockRect(b.off);
      assert.ok(rect, '전제: 코너 QR 블록이 없다');
      const offOutside = b.off.shapes.filter((s) => !inRect(centroid(s), rect));
      for (const state of QR_DECO_STATES) {
        const deco = decoOf(state);
        const on = buildSceneY(b.encoded, { ...fx.opts, palette: { ...b.palette, qrDeco: deco } });
        const label = `${fx.id} ${JSON.stringify(state)}`;
        // 블록 밖(셀 · 심 · 도트 · 로케이터)은 순서까지 같다.
        assert.deepEqual(on.shapes.filter((s) => !inRect(centroid(s), rect)), offOutside, `${label}: 블록 밖이 바뀌었다`);
        const pieces = on.shapes.filter((s) => inRect(centroid(s), rect));
        assert.ok(pieces.length > 1);
        for (const s of pieces) {
          assert.equal(s.selfQuiet, true, `${label}: selfQuiet 없는 조각`);
          if (s !== pieces[0]) assert.equal(s.noSeam, true, `${label}: noSeam 없는 스타일 조각`);
          assert.ok([deco.dark, deco.eye, deco.light].some((c) => sameRgb(c, s.color)), `${label}: deco 밖 색`);
        }
        assert.ok(sameRgb(pieces[0].color, deco.light), `${label}: 콰이어트 패치가 deco.light 가 아니다`);

        // 안전영역: 조각 중심을 하나도 안 덮는다. 태그를 벗긴 사본(심은 결함)은 덮여야 한다.
        const covered = (scene, list) => {
          let n = 0;
          for (const poly of quietZonePolygons(scene, 2, QR_COLORS)) for (const s of list) if (inPoly(centroid(s), poly)) n += 1;
          return n;
        };
        assert.equal(covered(on, pieces), 0, `${label}: 안전영역이 코너 QR 을 삼켰다`);
        if (!sameRgb(deco.dark, BULLSEYE_DARK) || !sameRgb(deco.eye, BULLSEYE_DARK)) {
          const stripped = { ...on, shapes: on.shapes.map((s) => (s.selfQuiet ? (({ selfQuiet: _q, ...rest }) => rest)(s) : s)) };
          const strippedPieces = stripped.shapes.filter((s) => inRect(centroid(s), rect));
          assert.ok(covered(stripped, strippedPieces) > 0, `${label}: 태그를 벗겨도 안 삼켜진다 — 자에 판별력이 없다`);
        }
      }
    });
  }

  test('기능 모듈은 정확한 모듈 사각 · 파인더 7×7 은 deco.eye · 데이터 모듈엔 스타일이 먹는다', () => {
    const fx = FIXTURES[0];
    const b = built(fx);
    const deco = decoOf(QR_DECO_STATES[0]); // dots · 눈 darker
    const on = buildSceneY(b.encoded, { ...fx.opts, palette: { ...b.palette, qrDeco: deco } });
    const rect = cornerBlockRect(b.off);
    const qr = qrMatrix(TL_READER_URL);
    const map = qrFunctionMapV1();
    const m = (b.off.layout.size) / 2; // 모듈 = 셀/2
    const ox = rect.minX + 4 * m; const oy = rect.minY + 4 * m;
    const pieces = on.shapes.filter((s) => inRect(centroid(s), rect)).slice(1);
    const byKey = new Map(pieces.map((s) => [ptsKey(s.points), s]));
    let fixed = 0; let data = 0;
    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (qr.modules[y * qr.size + x] !== 1) continue;
        const sq = [
          { x: ox + x * m, y: oy + y * m }, { x: ox + (x + 1) * m, y: oy + y * m },
          { x: ox + (x + 1) * m, y: oy + (y + 1) * m }, { x: ox + x * m, y: oy + (y + 1) * m },
        ];
        const s = byKey.get(ptsKey(sq));
        if (map.isFunctionModule(x, y)) {
          assert.ok(s, `기능 모듈 (${x},${y}) 가 정확한 사각이 아니다`);
          assert.ok(sameRgb(s.color, map.isEyeModule(x, y) ? deco.eye : deco.dark), `기능 모듈 (${x},${y}) 색`);
          fixed += 1;
        } else {
          assert.equal(s, undefined, `데이터 모듈 (${x},${y}) 에 스타일이 안 먹었다(사각 그대로)`);
          data += 1;
        }
      }
    }
    assert.ok(fixed > 0 && data > 0);
  });

  test('윈도 β · 슬롯 QR 은 qrDeco 를 읽지 않는다 — 코너 QR 이 없는 장면은 바이트 동일', () => {
    const deco = decoOf(QR_DECO_STATES[0]);
    for (const fx of [FIXTURES[7], FIXTURES[8]]) {
      const b = built(fx);
      assert.equal(b.corner.length, 0, `전제: ${fx.id} 는 코너 QR 이 자동 억제된다`);
      const on = buildSceneY(b.encoded, { ...fx.opts, palette: { ...b.palette, qrDeco: deco } });
      assert.deepEqual(on.shapes, b.off.shapes, `${fx.id}: 안쪽 QR 이 qrDeco 에 반응했다`);
    }
  });

  test('윈도 β + 코너 병행(cornerQr:true): 코너만 바뀌고 윈도 QR 도형은 불변', () => {
    const fx = FIXTURES[8];
    const encoded = fx.encoded();
    const opts = { qrText: TL_READER_URL, cornerQr: true };
    const off = buildSceneY(encoded, { ...opts, palette: paletteWith(null) });
    const deco = decoOf(QR_DECO_STATES[1]);
    const on = buildSceneY(encoded, { ...opts, palette: { ...paletteWith(null), qrDeco: deco } });
    const rect = cornerBlockRect(off);
    assert.ok(rect);
    assert.deepEqual(on.shapes.filter((s) => !inRect(centroid(s), rect)), off.shapes.filter((s) => !inRect(centroid(s), rect)));
    assert.notDeepEqual(on.shapes, off.shapes);
  });

  test('반쯤 빈 qrDeco 는 조용히 기본으로 메우지 않고 던진다', () => {
    const b = built(FIXTURES[0]);
    assert.throws(() => buildSceneY(b.encoded, {
      ...FIXTURES[0].opts, palette: { ...b.palette, qrDeco: { dark: BULLSEYE_DARK, cellStyle: 'dots' } },
    }), TypeError);
  });
});
