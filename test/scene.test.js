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

  test('셀 순회 순서는 regionCells(k) 순서 그대로(Map 에 있는 셀만)', () => {
    const encoded = makeEncoded();
    const scene = buildScene(encoded, { palette: PALETTE });
    const regionOrder = regionCells(K)
      .map(({ q, r }) => `${q},${r}`)
      .filter((key) => encoded.cellDigits.has(key));
    const nCellShapes = 3 * encoded.cellDigits.size;
    // 폴리곤 3개씩 묶어 셀 단위로 확인 — 각 묶음의 좌표가 regionOrder 순서를 따르는지는
    // facePolygon 좌표 대조로 검증(아래 색 매핑 테스트에서 좌표까지 함께 확인).
    assert.equal(nCellShapes / 3, regionOrder.length);
  });
});

describe('buildScene — 색 매핑', () => {
  test('digitToRanks 와 일치, 좌표는 facePolygon 과 일치', () => {
    const encoded = makeEncoded();
    const scene = buildScene(encoded, { palette: PALETTE });
    const regionOrder = regionCells(K).filter(({ q, r }) =>
      encoded.cellDigits.has(`${q},${r}`),
    );
    let idx = 0;
    for (const { q, r } of regionOrder) {
      const entry = encoded.cellDigits.get(`${q},${r}`);
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
