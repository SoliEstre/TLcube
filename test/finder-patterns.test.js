import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encode } from '../src/encode.js';
import {
  DEFAULT_FINDER_PATTERN_ID,
  FINDER_BASELINE_SCORES,
  LEGACY_FINDER_PATTERN_ID,
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
import {
  generateFinderCandidates, measureFinderPatternScores,
} from '../tools/finder-score.mjs';

const MODULE_PATH = fileURLToPath(new URL('../src/finder-patterns.js', import.meta.url));
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

const FINDER_SCORE_AXES = Object.freeze([
  'rotation', 'lowResolution', 'localization', 'dataDistinction',
  'structuralSimplicity', 'defectConcentration',
]);
const EXPECTED_FINDER_MEASUREMENTS = Object.freeze({
  "pinwheel-3-0101-cw-missing-solid": Object.freeze({
    centerOffsetCells: 0.4003203845127178,
    scores: Object.freeze({"rotation":41.88539082916955,"lowResolution":96.76318469627645,"localization":13.956257981685615,"dataDistinction":100,"structuralSimplicity":90.91372900969897,"defectConcentration":42.51092259923948}),
  }),
  "gap-ring-01-2-1-solid": Object.freeze({
    centerOffsetCells: 0.26268091278848715,
    scores: Object.freeze({"rotation":52.98129428260175,"lowResolution":95.31975482327525,"localization":13.693929273351637,"dataDistinction":100,"structuralSimplicity":86.6828394595597,"defectConcentration":30.22998940390363}),
  }),
  "flower-7-0020-coprime-offset": Object.freeze({
    centerOffsetCells: 0.5265081997022854,
    scores: Object.freeze({"rotation":45.883146774112355,"lowResolution":95.24771635431023,"localization":16.094778612701756,"dataDistinction":100,"structuralSimplicity":91.18880899993957,"defectConcentration":51.01310711908737}),
  }),
  "swirl-2-200": Object.freeze({
    centerOffsetCells: 0.015193428136569088,
    scores: Object.freeze({"rotation":79.47194142390262,"lowResolution":91.34433401090291,"localization":22.81112784741712,"dataDistinction":100,"structuralSimplicity":55.579256952027684,"defectConcentration":11.624045166840785}),
  }),
  "pinwheel-c2-2-1100-cw": Object.freeze({
    centerOffsetCells: 5.0923777502508197e-17,
    scores: Object.freeze({"rotation":79.47194142390262,"lowResolution":97.07728924112143,"localization":11.17193090966036,"dataDistinction":100,"structuralSimplicity":92.28092947267801,"defectConcentration":30.229989403903623}),
  }),
  "gap-ring-01-2-1-open": Object.freeze({
    centerOffsetCells: 0.28238198124762376,
    scores: Object.freeze({"rotation":52.98129428260175,"lowResolution":95.43798666192357,"localization":13.80747895581605,"dataDistinction":100,"structuralSimplicity":84.51542547285166,"defectConcentration":30.22998940390363}),
  }),
  "flower-7-1020-coprime-offset": Object.freeze({
    centerOffsetCells: 0.06943296507508846,
    scores: Object.freeze({"rotation":59.23488777590924,"lowResolution":94.16580922822094,"localization":17.492914686282145,"dataDistinction":100,"structuralSimplicity":82.53857253110874,"defectConcentration":31.478487966284845}),
  }),
  "swirl-c2-5-5-11-both": Object.freeze({
    centerOffsetCells: 5.611412357367492e-17,
    scores: Object.freeze({"rotation":79.47194142390262,"lowResolution":91.17102980798893,"localization":23.55161544174186,"dataDistinction":100,"structuralSimplicity":56.325320629094655,"defectConcentration":12.065908777314663}),
  }),
  "bullseye": Object.freeze({
    centerOffsetCells: 0.049771574930140124,
    scores: Object.freeze({"rotation":0,"lowResolution":55.504960185798204,"localization":32.22404593197675,"dataDistinction":100,"structuralSimplicity":59.79246730623948,"defectConcentration":0}),
  }),
  "center-qr": Object.freeze({
    centerOffsetCells: 0.1022033350678163,
    scores: Object.freeze({"rotation":64.88856845230502,"lowResolution":44.354818376683234,"localization":23.89512046344338,"dataDistinction":100,"structuralSimplicity":65.77636818983622,"defectConcentration":42.7374753470321}),
  })
});

test('고정 목록은 요청된 8개 ID와 regionCells(2) 좌표 순서를 그대로 쓴다', () => {
  assert.deepEqual(FINDER_PATTERN_IDS, SELECTED_FINDER_IDS);
  assert.deepEqual(FINDER_PATTERN_IDS, [
    'pinwheel-3-0101-cw-missing-solid',
    'gap-ring-01-2-1-solid',
    'flower-7-0020-coprime-offset',
    'swirl-2-200',
    'pinwheel-c2-2-1100-cw',
    'gap-ring-01-2-1-open',
    'flower-7-1020-coprime-offset',
    'swirl-c2-5-5-11-both',
  ]);
  assert.equal(FINDER_PATTERNS.length, 8);
  assert.deepEqual(FINDER_CELL_ORDER, regionCells(2));
  assert.deepEqual(FACES.map((face) => FINDER_FACE_BITS[face]), [1, 2, 4]);
});

test('고정 8개 마스크·6축 점수·중심 오프셋이 채점 하네스와 정확히 일치한다', () => {
  const generated = generateFinderCandidates();
  const measured = measureFinderPatternScores(generated);
  const measuredById = new Map(
    [...measured.candidates, ...measured.baselines].map((entry) => [entry.id, entry]),
  );
  for (const pattern of FINDER_PATTERNS) {
    const candidate = generated.find((entry) => entry.id === pattern.id);
    assert.ok(candidate, pattern.id + ': 하네스 후보에서 사라졌다');
    assert.deepEqual(
      pattern.cellMasks,
      bitsToCellMasks(candidate.bits),
      pattern.id + ': 고정 마스크와 하네스 생성 마스크가 어긋났다',
    );
    const expected = EXPECTED_FINDER_MEASUREMENTS[pattern.id];
    const harness = measuredById.get(pattern.id);
    assert.deepEqual(pattern.scores, expected.scores, pattern.id + ': 6축 고정값 변경');
    assert.equal(pattern.centerOffsetCells, expected.centerOffsetCells,
      pattern.id + ': 중심 오프셋 고정값 변경');
    assert.deepEqual(harness.scores, expected.scores, pattern.id + ': 6축 하네스 회귀');
    assert.equal(harness.centerOffsetCells, expected.centerOffsetCells,
      pattern.id + ': 중심 오프셋 하네스 회귀');
    assert.deepEqual(Object.keys(pattern.scores), FINDER_SCORE_AXES, pattern.id);
    assert.equal('total' in pattern.scores, false, pattern.id + ': total 저장 금지');
  }

  assert.deepEqual(Object.keys(FINDER_BASELINE_SCORES), ['bullseye', 'center-qr']);
  for (const [id, baseline] of Object.entries(FINDER_BASELINE_SCORES)) {
    const expected = EXPECTED_FINDER_MEASUREMENTS[id];
    const harness = measuredById.get(id);
    assert.deepEqual(baseline.scores, expected.scores, id + ': 기준선 6축 고정값 변경');
    assert.equal(baseline.centerOffsetCells, expected.centerOffsetCells,
      id + ': 기준선 중심 오프셋 고정값 변경');
    assert.deepEqual(harness.scores, expected.scores, id + ': 기준선 6축 하네스 회귀');
    assert.equal(harness.centerOffsetCells, expected.centerOffsetCells,
      id + ': 기준선 중심 오프셋 하네스 회귀');
    assert.equal(baseline.centerBalanceGatePassed, true, id + ': 기준선 게이트');
    assert.deepEqual(Object.keys(baseline.scores), FINDER_SCORE_AXES, id);
    assert.equal('total' in baseline.scores, false, id + ': total 저장 금지');
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
    finderPatternId: LEGACY_FINDER_PATTERN_ID,
  });
  assert.equal(DEFAULT_FINDER_PATTERN_ID, LEGACY_FINDER_PATTERN_ID,
    '소스 기본값은 실패 안전하게 현행 불스아이여야 한다');
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
