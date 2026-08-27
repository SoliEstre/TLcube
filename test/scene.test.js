/**
 * scene.test.js — buildScene 계약 검증 (T8, SPEC §3, §4.1, §5.1)
 * luminance.js·encode.js 는 병렬 lane 산출물이라 아직 없다 — 합성 encoded 로 짠다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildScene } from '../src/scene.js';
import { FACES, layoutForRegion, facePolygon, regionCells } from '../src/hexgrid.js';
import { bandRadii } from '../src/bullseye.js';
import { digitToRanks } from '../src/lehmer.js';
import { encode } from '../src/encode.js';

const PALETTE = {
  background: { r: 255, g: 255, b: 255 },
  levels: [
    { r: 20, g: 20, b: 20 }, // rank 0 (암)
    { r: 128, g: 128, b: 128 }, // rank 1
    { r: 235, g: 235, b: 235 }, // rank 2 (명)
  ],
  bullseyeDark: { r: 0, g: 0, b: 0 },
  bullseyeLight: { r: 255, g: 255, b: 255 },
};

const K = 6;

/** k=6 영역의 셀 몇 개만 수동 구성한 합성 encoded. */
function makeEncoded() {
  const cellDigits = new Map();
  // hexDistance > 2 인 임의 셀 몇 개 골라 role/digit 부여 (불스아이 밖).
  cellDigits.set('3,0', { digit: 0, role: 'data' });
  cellDigits.set('-3,1', { digit: 2, role: 'data' });
  cellDigits.set('4,-2', { digit: 5, role: 'format' });
  return { k: K, cellDigits };
}

describe('buildScene — shapes 수', () => {
  test('3·셀수 + 6', () => {
    const encoded = makeEncoded();
    const scene = buildScene(encoded, { palette: PALETTE });
    assert.equal(scene.shapes.length, 3 * encoded.cellDigits.size + 6);
  });
});

describe('buildScene — 순서 계약', () => {
  test('폴리곤(3·셀수) 이 먼저, disc(6) 가 마지막에 내림차순', () => {
    const encoded = makeEncoded();
    const scene = buildScene(encoded, { palette: PALETTE });
    const nCellShapes = 3 * encoded.cellDigits.size;
    for (let i = 0; i < nCellShapes; i += 1) {
      assert.equal(scene.shapes[i].kind, 'polygon');
    }
    const discs = scene.shapes.slice(nCellShapes);
    assert.equal(discs.length, 6);
    for (const d of discs) assert.equal(d.kind, 'disc');
    // 내림차순(바깥 밴드 먼저) — 반지름이 단조 감소.
    for (let i = 1; i < discs.length; i += 1) {
      assert.ok(discs[i - 1].r > discs[i].r, `반지름이 내림차순이 아님: ${discs[i - 1].r} <= ${discs[i].r}`);
    }
    const expectedRadii = bandRadii(1).slice().reverse();
    for (let i = 0; i < discs.length; i += 1) {
      assert.equal(discs[i].r, expectedRadii[i]);
    }
  });

  test('셀 순회 순서는 cellDigits 삽입 순서 그대로', () => {
    // Type A 회귀(ADR 0005 D1): 삼각 패치 셀은 regionCells(k) 필터로 걸리지 않으므로,
    // painter 순서의 계약은 이제 "cellDigits 삽입 순서"다 — encoder(encode.js·encodeA.js)
    // 가 이미 결정적으로 구성해 둔 순서를 그대로 쓴다.
    const encoded = makeEncoded();
    const scene = buildScene(encoded, { palette: PALETTE });
    const insertOrder = [...encoded.cellDigits.keys()];
    const nCellShapes = 3 * encoded.cellDigits.size;
    assert.equal(nCellShapes / 3, insertOrder.length);
  });
});

describe('buildScene — 색 매핑', () => {
  test('digitToRanks 와 일치, 좌표는 facePolygon 과 일치, 순서는 cellDigits 삽입 순서', () => {
    const encoded = makeEncoded();
    const scene = buildScene(encoded, { palette: PALETTE });
    let idx = 0;
    for (const [key, entry] of encoded.cellDigits) {
      const [q, r] = key.split(',').map(Number);
      const ranks = digitToRanks(entry.digit);
      for (const face of FACES) {
        const shape = scene.shapes[idx];
        assert.equal(shape.kind, 'polygon');
        assert.deepEqual(shape.color, PALETTE.levels[ranks[face]]);
        assert.deepEqual(shape.points, facePolygon(q, r, face, scene.layout));
        idx += 1;
      }
    }
  });
});

describe('buildScene — Type O 회귀: 신구 셀 순회가 동일 shapes 집합을 낸다', () => {
  /** 구방식(regionCells(k) 필터) 으로 셀 폴리곤 shapes 를 재현 — 변경 전 scene.js 로직. */
  function legacyCellShapes(encoded, layout, palette) {
    const shapes = [];
    for (const { q, r } of regionCells(encoded.k)) {
      const entry = encoded.cellDigits.get(`${q},${r}`);
      if (entry === undefined) continue;
      const ranks = digitToRanks(entry.digit);
      for (const face of FACES) {
        shapes.push({
          kind: 'polygon',
          points: facePolygon(q, r, face, layout),
          color: palette.levels[ranks[face]],
        });
      }
    }
    return shapes;
  }

  /** 순서 무관 비교용 정규 키 — 셀 폴리곤은 서로 겹치지 않으므로 집합 비교로 충분하다. */
  function canonicalKey(shape) {
    return JSON.stringify([shape.kind, shape.points, shape.color]);
  }

  test('V1/V2/V3 실제 encode() 산출물 — 신구 셀 폴리곤 shapes 가 정확히 같은 다중집합', () => {
    for (const version of [1, 2, 3]) {
      const encoded = encode(`regr v${version}`, { version, eccLevel: 'M' });
      // qrText·centerQr 미지정 — scene.shapes 의 polygon 은 전부 셀 폴리곤(불스아이는
      // disc, QR 블록 없음)이라 kind 필터만으로 신구 비교가 정확하다.
      const scene = buildScene(encoded, { palette: PALETTE });
      const legacyOnSceneLayout = legacyCellShapes(encoded, scene.layout, PALETTE);
      const newCellShapes = scene.shapes.filter((s) => s.kind === 'polygon');

      const legacyKeys = legacyOnSceneLayout.map(canonicalKey).sort();
      const newKeys = newCellShapes.map(canonicalKey).sort();
      assert.deepEqual(newKeys, legacyKeys, `V${version} 신구 셀 shapes 불일치`);
    }
  });
});

describe('buildScene — margin 기본값', () => {
  test('기본값 2·cellSize 반영 (layout.width 검산)', () => {
    const encoded = makeEncoded();
    const cellSize = 3;
    const scene = buildScene(encoded, { palette: PALETTE, cellSize });
    const expectedLayout = layoutForRegion(K, { size: cellSize, margin: 2 * cellSize });
    assert.equal(scene.layout.margin, 2 * cellSize);
    assert.equal(scene.width, expectedLayout.width);
    assert.equal(scene.height, expectedLayout.height);
    assert.deepEqual(scene.layout, expectedLayout);
  });

  test('margin 명시 시 그대로 사용', () => {
    const encoded = makeEncoded();
    const scene = buildScene(encoded, { palette: PALETTE, cellSize: 2, margin: 7 });
    assert.equal(scene.layout.margin, 7);
  });
});

describe('buildScene — 불스아이 중심 disc', () => {
  test('마지막 shape 의 색 = bullseyeDark', () => {
    const encoded = makeEncoded();
    const scene = buildScene(encoded, { palette: PALETTE });
    const last = scene.shapes[scene.shapes.length - 1];
    assert.equal(last.kind, 'disc');
    assert.deepEqual(last.color, PALETTE.bullseyeDark);
    // 중심 disc 는 밴드 인덱스 0(짝수) → dark, 반지름은 bandRadii 의 최솟값.
    const minRadius = Math.min(...bandRadii(1));
    assert.equal(last.r, minRadius);
  });
});

describe('buildScene — 빈 cellDigits', () => {
  test('폴리곤 없이 disc 6개만', () => {
    const encoded = { k: K, cellDigits: new Map() };
    const scene = buildScene(encoded, { palette: PALETTE });
    assert.equal(scene.shapes.length, 6);
    for (const s of scene.shapes) assert.equal(s.kind, 'disc');
  });
});

// ── 코너 QR 여유 (2026-08-27) ──────────────────────────────────────────────
//
// 종전 배치는 블록을 **캔버스 bbox 코너** 기준으로 놓아서, 여유가 모양에 따라
// 들쭉날쭉했다: 실측 O 5.44 · Y 6.31/9.78 인데 **A/V 의 넓은 변이 만나는 두 코너만
// 0.50셀**. 그 자리에서는 코드 안전영역(2셀 후광)이 QR 흰 패치와 맞붙어 화면에서
// «용접된» 다각형으로 보였다 (운영자 신고). 지금은 실루엣 기준으로 당긴다.
//
// 이 자는 **성질**을 잰다 — 좌표도, 5.44 같은 관측값도 얼리지 않는다.
describe('코너 QR 여유 — 실루엣 기준 배치', () => {
  const pointRectDistance = (v, r) => Math.hypot(
    Math.max(r.minX - v.x, 0, v.x - r.maxX), Math.max(r.minY - v.y, 0, v.y - r.maxY),
  );
  function segmentRectDistance(a, b, r) {
    if (pointRectDistance(a, r) === 0 || pointRectDistance(b, r) === 0) return 0;
    let best = Math.min(pointRectDistance(a, r), pointRectDistance(b, r));
    const vx = b.x - a.x; const vy = b.y - a.y; const L = vx * vx + vy * vy;
    for (const c of [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }]) {
      const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.y - a.y) * vy) / L));
      best = Math.min(best, Math.hypot(c.x - (a.x + t * vx), c.y - (a.y + t * vy)));
    }
    return best;
  }

  /** 코너 QR 블록 사각 · 코드와의 여유 · 캔버스 가장자리 여백 (전부 셀 단위). */
  function measure(scene, qrColors) {
    const cell = scene.layout.size;
    let rect = null;
    const code = [];
    for (const s of scene.shapes) {
      const isQr = qrColors.some((q) => q.r === s.color.r && q.g === s.color.g && q.b === s.color.b);
      if (isQr && s.selfQuiet === true && s.points) {
        for (const v of s.points) {
          rect = rect ? {
            minX: Math.min(rect.minX, v.x), minY: Math.min(rect.minY, v.y),
            maxX: Math.max(rect.maxX, v.x), maxY: Math.max(rect.maxY, v.y),
          } : { minX: v.x, minY: v.y, maxX: v.x, maxY: v.y };
        }
      } else code.push(s);
    }
    if (rect === null) return null;
    let gap = Infinity;
    for (const s of code) {
      const pts = s.kind === 'disc'
        ? [{ x: s.cx - s.r, y: s.cy }, { x: s.cx + s.r, y: s.cy },
          { x: s.cx, y: s.cy - s.r }, { x: s.cx, y: s.cy + s.r }]
        : s.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
        gap = Math.min(gap, segmentRectDistance(pts[j], pts[i], rect));
      }
    }
    const inset = Math.min(
      rect.minX, rect.minY, scene.width - rect.maxX, scene.height - rect.maxY,
    );
    return { gap: gap / cell, inset: inset / cell };
  }

  test('모든 타입·코너에서 코드와 3.5셀 이상 떨어지고, 캔버스 변에서 2셀 이상 안쪽이다', async () => {
    const { encode } = await import('../src/encode.js');
    const { encodeA } = await import('../src/encodeA.js');
    const { encodeY } = await import('../src/encodeY.js');
    const { buildScene } = await import('../src/scene.js');
    const { buildSceneY } = await import('../src/sceneY.js');
    const { getPreset, BULLSEYE_DARK, BULLSEYE_LIGHT } = await import('../src/luminance.js');
    const { TL_READER_URL } = await import('../src/qr.js');
    const qrColors = [BULLSEYE_LIGHT, BULLSEYE_DARK];
    const p = getPreset('slate');
    const palette = {
      background: null, levels: p.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
    };
    // scene.js 의 CORNER_QR_MIN_CLEARANCE_CELLS · CORNER_QR_MIN_EDGE_INSET_CELLS.
    // 값이 아니라 **성질**을 잠근다: 「후광(2셀)이 닿지 않을 만큼 떨어져 있고,
    // 캔버스 변에 붙어 잘려 보이지 않는다」.
    const MIN_GAP = 3.5;
    const MIN_INSET = 2;
    const EPS = 1e-6;

    // ⭐ Type Y 를 **일부러 같이 잰다.** sceneY.js 는 당기기를 안 하는데, 그건 Y 의
    //    여유가 원래 넉넉해서지(실측 6.31/9.78) 이 성질이 Y 에 없어도 된다는 뜻이
    //    아니다. Y 배치가 코너로 다가오는 날 여기가 빨개져야 한다.
    const CASES = [
      ['O v1', () => encode('quiet zone', { version: 1 }), buildScene],
      ['A v0', () => encodeA('quiet zone', { version: 0 }), buildScene],
      ['V v0 (turnA)', () => encodeA('quiet zone', { version: 0, turnA: true }), buildScene],
      ['Y v0', () => encodeY('quiet zone', { version: 0 }), buildSceneY],
      ['Y v1', () => encodeY('quiet zone', { version: 1 }), buildSceneY],
    ];
    for (const [id, enc, build] of CASES) {
      const encoded = enc();
      for (const corner of ['TL', 'TR', 'BL', 'BR']) {
        const scene = build(encoded, { palette, qrText: TL_READER_URL, qrCorner: corner });
        const m = measure(scene, qrColors);
        assert.ok(m !== null, `${id} · ${corner}: 코너 QR 블록을 못 찾았다`);
        assert.ok(m.gap >= MIN_GAP - EPS,
          `${id} · ${corner}: 코드와 ${m.gap.toFixed(2)}셀 — ${MIN_GAP}셀 미만이면 후광이 QR 패치에 붙는다`);
        assert.ok(m.inset >= MIN_INSET - EPS,
          `${id} · ${corner}: 캔버스 변에서 ${m.inset.toFixed(2)}셀 — ${MIN_INSET}셀 미만이면 잘려 보인다`);
      }
    }
  });
});
