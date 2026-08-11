import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encode } from '../src/encode.js';
import {
  DEFAULT_FINDER_PATTERN_ID,
  FINDER_CELL_ORDER,
  FINDER_FACE_BITS,
  FINDER_PATTERN_IDS,
  FINDER_PATTERNS,
} from '../src/finder-patterns.js';
import { FACES, facePolygon, regionCells } from '../src/hexgrid.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { verifyRaster } from '../src/verify.js';
import {
  SELECTED_FINDER_IDS, bitsToCellMasks, renderFinderPatternsModule,
} from '../tools/extract-finder-patterns.mjs';
import { generateFinderCandidates } from '../tools/finder-score.mjs';

const MODULE_PATH = fileURLToPath(new URL('../src/finder-patterns.js', import.meta.url));
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

test('고정 목록은 요청된 8개 ID와 regionCells(2) 좌표 순서를 그대로 쓴다', () => {
  assert.deepEqual(FINDER_PATTERN_IDS, SELECTED_FINDER_IDS);
  assert.equal(FINDER_PATTERNS.length, 8);
  assert.deepEqual(FINDER_CELL_ORDER, regionCells(2));
  assert.deepEqual(FACES.map((face) => FINDER_FACE_BITS[face]), [1, 2, 4]);
});

test('고정 8개 면 마스크가 채점 하네스의 게이트 전 동일 ID와 정확히 일치한다', () => {
  const generated = generateFinderCandidates();
  for (const pattern of FINDER_PATTERNS) {
    const candidate = generated.find((entry) => entry.id === pattern.id);
    assert.ok(candidate, `${pattern.id}: 하네스 후보에서 사라졌다`);
    assert.deepEqual(
      pattern.cellMasks,
      bitsToCellMasks(candidate.bits),
      `${pattern.id}: 고정 마스크와 하네스 생성 마스크가 어긋났다`,
    );
  }
});

test('중심 균형 게이트 탈락 2개도 대체 없이 그대로 수록한다', () => {
  const rejected = FINDER_PATTERNS
    .filter((pattern) => !pattern.centerBalanceGatePassed)
    .map((pattern) => pattern.id);
  assert.deepEqual(rejected, [
    'pinwheel-3-0101-cw-missing-solid',
    'flower-7-0020-coprime-offset',
  ]);
});

test('finder-patterns.js 가 재생성 도구 출력과 바이트 동일하다', () => {
  assert.equal(readFileSync(MODULE_PATH, 'utf8'), renderFinderPatternsModule());
});

test('8개 렌더는 19셀×3면을 최대 대비로 칠하고 불스아이 disc를 그리지 않는다', () => {
  const encoded = encode('finder render', { version: 1, eccLevel: 'M' });
  const cellShapeCount = encoded.cellDigits.size * FACES.length;
  for (const pattern of FINDER_PATTERNS) {
    const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: pattern.id });
    const finderShapes = scene.shapes.slice(cellShapeCount);
    assert.equal(scene.finderPatternId, pattern.id);
    assert.equal(finderShapes.length, 19 * 3, pattern.id);
    assert.equal(scene.shapes.some((shape) => shape.kind === 'disc'), false, pattern.id);
    let index = 0;
    for (let ci = 0; ci < FINDER_CELL_ORDER.length; ci += 1) {
      const cell = FINDER_CELL_ORDER[ci];
      const mask = pattern.cellMasks[ci];
      for (const face of FACES) {
        const shape = finderShapes[index];
        assert.equal(shape.kind, 'polygon', `${pattern.id}:${ci}:${face}`);
        assert.deepEqual(shape.points, facePolygon(cell.q, cell.r, face, scene.layout));
        assert.deepEqual(
          shape.color,
          mask & FINDER_FACE_BITS[face] ? PALETTE.bullseyeLight : PALETTE.bullseyeDark,
        );
        index += 1;
      }
    }
  }
});

test('finderPatternId 생략과 bullseye 명시는 기존 장면을 정확히 보존한다', () => {
  const encoded = encode('bullseye unchanged', { version: 1, eccLevel: 'M' });
  const implicit = buildScene(encoded, { palette: PALETTE });
  const explicit = buildScene(encoded, {
    palette: PALETTE,
    finderPatternId: DEFAULT_FINDER_PATTERN_ID,
  });
  assert.deepEqual(explicit, implicit);
  assert.equal(implicit.finderPatternId, DEFAULT_FINDER_PATTERN_ID);
  assert.equal(implicit.shapes.filter((shape) => shape.kind === 'disc').length, 6);
});

test('실험 파인더 8개 모두 데이터 셀 자체검증을 통과하고 centerQr와 중복 지정은 거부한다', () => {
  const encoded = encode('finder self-check', { version: 1, eccLevel: 'M' });
  for (const pattern of FINDER_PATTERNS) {
    const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: pattern.id });
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
    const check = verifyRaster(raster, scene, encoded);
    assert.equal(check.ok, true, `${pattern.id}: ${JSON.stringify(check.mismatches)}`);
  }

  const centerQr = encode('center qr remains', {
    version: 1, eccLevel: 'M', centerQr: true,
  });
  assert.throws(
    () => buildScene(centerQr, {
      palette: PALETTE,
      qrText: 'https://tlscan.estre.so/',
      finderPatternId: FINDER_PATTERN_IDS[0],
    }),
    /중앙 슬롯은 둘 중 하나만/,
  );
});
