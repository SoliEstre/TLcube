/**
 * scanner-typec-guide.test.js — Type C 5점 가이드의 기하·UI·복호 봉투 국소 자.
 *
 * src 엔진을 바꾸지 않고 정본 상수를 소비한다. 특히 3시 V-노치가 C 방향(코너)이
 * 아니라 EDGE 방향 index 1이라는 함정을 값으로 잠근다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { VERSIONS_C } from '../src/capacityC.js';
import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import {
  CELL_PX_FLOOR,
  dotsOutOfBounds,
  EDGE_UNIT_OFFSETS,
  FRAME_MAX_SIDE,
  GUIDE_OUTER_FRACTION,
  guideDotPositions,
  guideOccupancyEstimates,
  silhouetteRadiusCells,
} from '../src/scanner-zoom.js';
import {
  TYPE_C_NOTCH_VERTEX_INDEX,
  typeCGuideDotPositions,
  typeCGuideRingPositions,
} from '../sites/tlscan/scan-guide-ui.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';
import { collectScannerModuleSources } from '../tools/build-scanner.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCANNER_HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
const SCANNER_JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

function near(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≠ ${expected}`);
}

test('Type C 5점 — EDGE 방향 동일 외경에서 3시 V-노치 index 1만 제외한다', () => {
  assert.equal(TYPE_C_NOTCH_VERTEX_INDEX, 1);
  assert.deepEqual(EDGE_UNIT_OFFSETS[TYPE_C_NOTCH_VERTEX_INDEX], { x: 1, y: 0 });

  const side = 1000;
  const center = side / 2;
  const radius = GUIDE_OUTER_FRACTION * (side / 2);
  const points = typeCGuideDotPositions({
    screenSide: side,
    centerX: center,
    centerY: center,
    edgeUnitOffsets: EDGE_UNIT_OFFSETS,
    outerFraction: GUIDE_OUTER_FRACTION,
  });

  assert.equal(points.length, 5);
  const keptIndices = [0, 2, 3, 4, 5];
  for (let i = 0; i < points.length; i += 1) {
    const unit = EDGE_UNIT_OFFSETS[keptIndices[i]];
    near(points[i].x, center + unit.x * radius);
    near(points[i].y, center + unit.y * radius);
    near(Math.hypot(points[i].x - center, points[i].y - center), radius);
  }

  // 3시 빈 자리 자체가 없어야 하고, 남은 두 대각쌍 때문에 전체 지름 2R은 보존된다.
  assert.ok(!points.some((point) => point.x === center + radius && point.y === center));
  let maxDistance = 0;
  for (const a of points) {
    for (const b of points) maxDistance = Math.max(maxDistance, Math.hypot(a.x - b.x, a.y - b.y));
  }
  near(maxDistance, 2 * radius, 1e-9);

  // K 기본 가이드 바깥 링도 같은 GUIDE_OUTER_FRACTION 반지름이다.
  const kDots = guideDotPositions(side, center, center);
  assert.equal(kDots.outer.length + kDots.middle.length + kDots.inner.length, 18);
  for (const point of kDots.outer) {
    near(Math.hypot(point.x - center, point.y - center), radius);
  }
  assert.deepEqual(dotsOutOfBounds({ typeC: points }, side), []);

  // CORNER 방향을 잘못 주입하면 index 1이 (1,0)이 아니므로 즉시 거절한다.
  assert.throws(() => typeCGuideDotPositions({
    screenSide: side,
    edgeUnitOffsets: CORNER_UNIT_OFFSETS,
    outerFraction: GUIDE_OUTER_FRACTION,
  }), /EDGE_UNIT_OFFSETS\[1\]/);
});

test('Type C 봉투 — 4단 사다리의 960px cell_px와 최소 배율을 고정한다', () => {
  assert.equal(FRAME_MAX_SIDE, 960);
  assert.equal(CELL_PX_FLOOR, 9);
  assert.deepEqual(
    Object.fromEntries(VERSIONS_C.map((spec) => [spec.name, spec.k])),
    { C0: 14, C1: 16, C2: 18, C3: 20 },
  );

  // C 실루엣의 E-꼭짓점 반경을 바깥 링 R=fS/2에 맞춘 셀 크기다.
  const cellPx = (k, frameSide = FRAME_MAX_SIDE) => (
    (GUIDE_OUTER_FRACTION * frameSide / 2) / silhouetteRadiusCells(k)
  );
  const px = Object.fromEntries(VERSIONS_C.map((spec) => [spec.name, cellPx(spec.k)]));
  assert.equal(px.C0.toFixed(2), '10.20');
  assert.equal(px.C1.toFixed(2), '8.98');
  assert.equal(px.C2.toFixed(2), '8.02');
  assert.equal(px.C3.toFixed(2), '7.24');
  // C0 만 바닥 위, C1 은 바닥 경계(0.2% 아래) — 가이드 정합 시 C1 부터 확대 여지.
  assert.ok(px.C0 >= CELL_PX_FLOOR);
  assert.ok(px.C1 < CELL_PX_FLOOR && px.C2 < CELL_PX_FLOOR && px.C3 < CELL_PX_FLOOR);

  const c3MinScale = CELL_PX_FLOOR / px.C3;
  assert.equal(c3MinScale.toFixed(6), '1.242907');
  assert.ok(c3MinScale > 1.24 && c3MinScale < 1.25,
    `C3 최소 배율이 약 1.25×가 아니다: ${c3MinScale}`);

  // 동일 외경 C의 bbox 점유율은 K/육각 축과 같고 실측 성공 지대 안이다.
  const occupancy = guideOccupancyEstimates().hexagon;
  near(occupancy, (Math.sqrt(3) / 2) * GUIDE_OUTER_FRACTION ** 2);
  assert.ok(occupancy >= 0.15 && occupancy <= 0.3, `C 점유율 ${occupancy}`);
});

test('가이드 링 분해 — 채운 5점 + 3시 속 빈 노치 1점이 같은 반지름 위에 있다', () => {
  const ring = typeCGuideRingPositions({
    screenSide: 1000,
    edgeUnitOffsets: EDGE_UNIT_OFFSETS,
    outerFraction: GUIDE_OUTER_FRACTION,
  });
  assert.ok(ring);
  assert.equal(ring.dots.length, 5);
  // 노치 표식은 3시(E_1) — +x 축 위.
  near(ring.notch.y, 500);
  assert.ok(ring.notch.x > 500);
  const radius = GUIDE_OUTER_FRACTION * 500;
  for (const point of [...ring.dots, ring.notch]) {
    near(Math.hypot(point.x - 500, point.y - 500), radius, 1e-9);
  }
  // 5점 래퍼는 링의 채운 점과 동일하다 (구 계약 유지).
  assert.deepEqual(typeCGuideDotPositions({
    screenSide: 1000,
    edgeUnitOffsets: EDGE_UNIT_OFFSETS,
    outerFraction: GUIDE_OUTER_FRACTION,
  }), ring.dots);
});

test('스캐너 배선 — K 18점 + C 링을 항상 함께 그리고 토글은 없다', () => {
  // 토글 폐지 (운영자 «같이 배치», 2026-08-30) — 마크업·배선 양쪽에서 부재를 잠근다.
  assert.equal(SCANNER_HTML.includes('scan-guide-type'), false,
    'K/C 토글 마크업이 되살아났다');
  assert.equal(SCANNER_JS.includes('wireScanGuideType'), false,
    '토글 배선이 되살아났다');
  assert.match(
    SCANNER_HTML,
    /--tl-ui-stack-h: calc\(36px \+ 132px \+ 34px \+ 62px \+ 52px \+ 24px \+ 76px\);/,
    '가이드 개편이 기존 UI_STACK_BUDGET을 바꿨다',
  );

  assert.match(SCANNER_JS, /EDGE_UNIT_OFFSETS/);
  assert.match(SCANNER_JS, /outerFraction: GUIDE_OUTER_FRACTION/);
  // 두 링이 조건 분기 없이 연달아 그려진다 — 어느 한쪽이 조건 뒤로 숨으면 빨강.
  assert.match(SCANNER_JS,
    /ring\(dots\.outer, 'dot-outer', outerR\);[\s\S]{0,220}ring\(dots\.middle, 'dot-middle', outerR \* 0\.85\);[\s\S]{0,220}ring\(dots\.inner, 'dot-inner', outerR \* 0\.72\);[\s\S]{0,220}ring\(typeCRing\.dots, 'dot-type-c', outerR\);/);
  assert.match(SCANNER_JS, /ring\(\[typeCRing\.notch\], 'dot-notch', outerR\)/);
  assert.match(SCANNER_HTML, /\.scan-dot-layer \.dot-notch \{[^}]*fill: none;/s,
    '노치 표식이 속 빈 점이 아니다');
  // 빌드 스탬프는 형식만 잠근다 — 철자 핀은 배포 범프마다 이 자를 깨뜨렸다.
  assert.match(SCANNER_JS, /SCANNER_BUILD = '20\d{2}-\d{2}-\d{2}\.\d{2}'/);

  const moduleIds = collectScannerModuleSources().map((moduleSource) => moduleSource.id);
  assert.ok(moduleIds.includes('/tlscan/scan-guide-ui.js'), '단일 파일 빌드 그래프에 헬퍼가 없다');
  assert.ok(moduleIds.indexOf('/tlscan/scan-guide-ui.js') < moduleIds.indexOf('/scanner.js'),
    '헬퍼가 scanner.js보다 먼저 등록되지 않는다');
});

test('8언어 — 병합 안내가 전 언어에 있고 토글 키는 전 언어에서 사라졌다', () => {
  const languages = Object.keys(SCANNER_STRINGS);
  assert.deepEqual(languages, ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']);
  for (const lang of languages) {
    const dots = SCANNER_STRINGS[lang]['guide.dots'];
    assert.equal(typeof dots, 'string', lang + '.guide.dots 없음');
    // 병합 문구는 C 확대 지시(«C2·C3 …»)를 반드시 나른다 — C1 경계·C3 1.25× 유도의
    // 사용자 표면이다 (물리 봉투 자가 수치의 정본).
    assert.ok(/C2[·・]C3/.test(dots), lang + '.guide.dots 에 C 확대 지시가 없다: ' + dots);
    for (const gone of ['guide.typeLabel', 'guide.typeK', 'guide.typeC', 'guide.cMessage', 'guide.cDots']) {
      assert.equal(SCANNER_STRINGS[lang][gone], undefined, lang + '.' + gone + ' 이 남아 있다');
    }
  }
  // 문구 갱신은 고정 키 한 벌로 — 언어 변경 콜백이 같은 함수를 태운다.
  assert.match(SCANNER_JS, /setAttribute\('data-i18n', 'guide\.message'\)/);
  assert.match(SCANNER_JS, /setAttribute\('data-i18n', 'guide\.dots'\)/);
  assert.match(SCANNER_JS, /onChange\(\) \{[\s\S]*refreshScanGuideCopy\(\);/);
});

