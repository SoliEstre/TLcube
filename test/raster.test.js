/**
 * raster.test.js — 순수 래스터라이저 검증 (T8, SPEC §7.2)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { rasterize } from '../src/raster.js';

const RED = { r: 200, g: 20, b: 20 };
const BG = { r: 0, g: 0, b: 0 };

/**
 * 넓이 추정용: 픽셀 색이 배경보다 도형 색에 더 가까우면 "덮인 픽셀"로 센다.
 * 경계(안티에일리어싱된) 픽셀은 실제 덮임 비율이 50% 안팎일 때 절반씩 어느
 * 쪽으로든 갈리므로, 순수 색상 일치보다 훨씬 정확한 넓이 추정치를 준다.
 */
function estimateCoveredArea(result, color, bg) {
  let count = 0;
  for (let i = 0; i < result.width * result.height; i += 1) {
    const o = i * 4;
    const dr = result.pixels[o] - color.r;
    const dg = result.pixels[o + 1] - color.g;
    const db = result.pixels[o + 2] - color.b;
    const distToColor = dr * dr + dg * dg + db * db;
    const bdr = result.pixels[o] - bg.r;
    const bdg = result.pixels[o + 1] - bg.g;
    const bdb = result.pixels[o + 2] - bg.b;
    const distToBg = bdr * bdr + bdg * bdg + bdb * bdb;
    if (distToColor < distToBg) count += 1;
  }
  return count;
}

describe('disc 넓이', () => {
  test('채워진 픽셀 수가 π r² 대비 오차 < 2%', () => {
    const r = 20;
    const scene = {
      width: 60,
      height: 60,
      background: BG,
      shapes: [{ kind: 'disc', cx: 30, cy: 30, r, color: RED }],
    };
    const result = rasterize(scene, { pixelsPerUnit: 1, supersample: 4 });
    const filled = estimateCoveredArea(result, RED, BG);
    const expected = Math.PI * r * r;
    const relError = Math.abs(filled - expected) / expected;
    assert.ok(relError < 0.02, `상대오차 ${relError} >= 2%`);
  });
});

describe('마름모(facePolygon) 넓이', () => {
  test('넓이 오차 < 2%', () => {
    // 스케일 30 인 마름모: [center, spine-1, spine, spine+1] 형태의
    // 60/120도 마름모, size=30 기준 정확 넓이 = (√3/2)·size².
    const size = 30;
    const cx = 40;
    const cy = 40;
    const SQRT3 = Math.sqrt(3);
    const H = SQRT3 / 2;
    // T 면 오프셋(hexgrid.facePolygonOffsets('T', size) 와 동일한 형태):
    // spine=0(상단), idx=[5,0,1].
    const points = [
      { x: cx, y: cy },
      { x: cx - H * size, y: cy - 0.5 * size },
      { x: cx, y: cy - size },
      { x: cx + H * size, y: cy - 0.5 * size },
    ];
    const scene = {
      width: 80,
      height: 80,
      background: BG,
      shapes: [{ kind: 'polygon', points, color: RED }],
    };
    const result = rasterize(scene, { pixelsPerUnit: 1, supersample: 4 });
    const filled = estimateCoveredArea(result, RED, BG);
    const expected = (SQRT3 / 2) * size * size;
    const relError = Math.abs(filled - expected) / expected;
    assert.ok(relError < 0.02, `상대오차 ${relError} >= 2%`);
  });
});

describe('결정성', () => {
  test('같은 입력 2회 rasterize → 픽셀 버퍼 완전 일치', () => {
    const scene = {
      width: 40,
      height: 40,
      background: BG,
      shapes: [
        { kind: 'disc', cx: 20, cy: 20, r: 12, color: RED },
        { kind: 'polygon', points: [
          { x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 },
        ], color: { r: 10, g: 200, b: 10 } },
      ],
    };
    const a = rasterize(scene, { pixelsPerUnit: 3, supersample: 3 });
    const b = rasterize(scene, { pixelsPerUnit: 3, supersample: 3 });
    assert.deepEqual(Array.from(a.pixels), Array.from(b.pixels));
  });
});

describe('supersample 1 vs 2 — 내부 픽셀 일치', () => {
  test('경계에서 먼 내부 픽셀은 supersample 과 무관하게 동일', () => {
    const scene = {
      width: 40,
      height: 40,
      background: BG,
      shapes: [{ kind: 'disc', cx: 20, cy: 20, r: 15, color: RED }],
    };
    const r1 = rasterize(scene, { pixelsPerUnit: 2, supersample: 1 });
    const r2 = rasterize(scene, { pixelsPerUnit: 2, supersample: 2 });
    assert.equal(r1.width, r2.width);
    assert.equal(r1.height, r2.height);
    // 중심 근처(경계에서 충분히 먼) 픽셀을 확인.
    const cxPx = Math.round(20 * 2);
    const cyPx = Math.round(20 * 2);
    const o1 = (cyPx * r1.width + cxPx) * 4;
    const o2 = (cyPx * r2.width + cxPx) * 4;
    assert.equal(r1.pixels[o1], r2.pixels[o2]);
    assert.equal(r1.pixels[o1 + 1], r2.pixels[o2 + 1]);
    assert.equal(r1.pixels[o1 + 2], r2.pixels[o2 + 2]);
    // 배경 구석(도형에서 충분히 먼) 픽셀도 확인.
    const bo1 = 0;
    const bo2 = 0;
    assert.equal(r1.pixels[bo1], r2.pixels[bo2]);
    assert.equal(r1.pixels[bo1 + 1], r2.pixels[bo2 + 1]);
    assert.equal(r1.pixels[bo1 + 2], r2.pixels[bo2 + 2]);
  });
});

describe('alpha', () => {
  test('전 픽셀 alpha = 255', () => {
    const scene = {
      width: 10,
      height: 10,
      background: BG,
      shapes: [{ kind: 'disc', cx: 5, cy: 5, r: 3, color: RED }],
    };
    const result = rasterize(scene, { pixelsPerUnit: 5, supersample: 2 });
    for (let i = 0; i < result.width * result.height; i += 1) {
      assert.equal(result.pixels[i * 4 + 3], 255);
    }
  });
});

// ── 투명 배경 (background === null) — 생성기 배경 3택의 기본값 ──────────────

describe('투명 배경 — background === null', () => {
  const transparentScene = () => ({
    width: 10,
    height: 10,
    background: null,
    shapes: [{ kind: 'polygon', color: RED, points: [
      { x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 },
    ] }],
  });

  test('도형 밖은 alpha 0 · 도형 안은 alpha 255', () => {
    const r = rasterize(transparentScene(), { pixelsPerUnit: 5, supersample: 2 });
    const at = (px, py) => {
      const o = (py * r.width + px) * 4;
      return [r.pixels[o], r.pixels[o + 1], r.pixels[o + 2], r.pixels[o + 3]];
    };
    assert.deepEqual(at(0, 0), [0, 0, 0, 0], '모서리는 완전 투명이어야 한다');
    assert.deepEqual(at(20, 20), [RED.r, RED.g, RED.b, 255], '도형 내부는 불투명 도형색이어야 한다');
  });

  test('가장자리는 커버리지 비율 alpha 를 갖고, **색은 배경과 안 섞인다** (프리멀티플라이드 헤일로 방지)', () => {
    // 폴리곤 경계를 픽셀 중앙이 아니라 서브픽셀 격자에 걸치게 두어 부분 커버리지를 만든다.
    const scene = transparentScene();
    scene.shapes[0].points = [
      { x: 2.1, y: 2.1 }, { x: 5.9, y: 2.1 }, { x: 5.9, y: 5.9 }, { x: 2.1, y: 5.9 },
    ];
    const r = rasterize(scene, { pixelsPerUnit: 5, supersample: 2 });
    let partial = 0;
    for (let i = 0; i < r.width * r.height; i += 1) {
      const a = r.pixels[i * 4 + 3];
      if (a === 0 || a === 255) continue;
      partial += 1;
      // 부분 커버 픽셀도 RGB 는 도형색 그대로여야 한다 — 검은 배경이 섞이면 어두워진다.
      assert.equal(r.pixels[i * 4], RED.r, '부분 커버 픽셀 R 이 도형색과 다르다 (배경이 섞였다)');
      assert.equal(r.pixels[i * 4 + 1], RED.g);
      assert.equal(r.pixels[i * 4 + 2], RED.b);
    }
    assert.ok(partial > 0, '부분 커버리지 픽셀이 하나도 없다 — 테스트 전제가 깨졌다');
  });

  test('불투명 경로의 출력은 투명 지원 이후에도 한 바이트도 안 바뀐다 (동일 scene 회귀)', () => {
    const opaque = { ...transparentScene(), background: BG };
    const r = rasterize(opaque, { pixelsPerUnit: 5, supersample: 2 });
    for (let i = 0; i < r.width * r.height; i += 1) assert.equal(r.pixels[i * 4 + 3], 255);
    const o = 0; // 모서리는 배경색 그대로
    assert.deepEqual(
      [r.pixels[o], r.pixels[o + 1], r.pixels[o + 2]], [BG.r, BG.g, BG.b],
    );
  });

  test('background 가 undefined 면 조용히 넘어가지 않고 던진다 (NaN 서브픽셀 방지)', () => {
    const bogus = { ...transparentScene() };
    delete bogus.background;
    assert.throws(() => rasterize(bogus, { pixelsPerUnit: 5 }), TypeError);
  });
});
