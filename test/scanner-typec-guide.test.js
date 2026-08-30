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
  DEFAULT_SCAN_GUIDE_TYPE,
  SCAN_GUIDE_TYPE,
  TYPE_C_NOTCH_VERTEX_INDEX,
  scanGuideCopyKeys,
  typeCGuideDotPositions,
  wireScanGuideType,
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

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeButton {
  constructor(type, active = false) {
    this.dataset = { guideType: type };
    this.classList = new FakeClassList(active ? ['active'] : []);
    this.attributes = new Map();
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }

  click() {
    this.listeners.get('click')?.();
  }
}

test('가이드 선택 상태 — K가 기본이고 C 전환은 버튼·문구 키를 함께 바꾼다', () => {
  assert.equal(DEFAULT_SCAN_GUIDE_TYPE, SCAN_GUIDE_TYPE.K);
  assert.deepEqual(scanGuideCopyKeys('K'), {
    message: 'guide.message',
    detail: 'guide.dots',
  });
  assert.deepEqual(scanGuideCopyKeys('C'), {
    message: 'guide.cMessage',
    detail: 'guide.cDots',
  });

  const k = new FakeButton('K', true);
  const c = new FakeButton('C');
  const root = { querySelectorAll: () => [k, c] };
  const changes = [];
  const controller = wireScanGuideType(root, { onChange: (type) => changes.push(type) });

  assert.equal(controller.type, 'K');
  assert.equal(k.classList.contains('active'), true);
  assert.equal(k.getAttribute('aria-pressed'), 'true');
  assert.equal(c.getAttribute('aria-pressed'), 'false');

  c.click();
  assert.equal(controller.type, 'C');
  assert.equal(k.getAttribute('aria-pressed'), 'false');
  assert.equal(c.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(changes, ['C']);
  c.click();
  assert.deepEqual(changes, ['C'], '같은 선택을 다시 눌러 중복 변경을 알리면 안 된다');

  controller.setType('알 수 없음');
  assert.equal(controller.type, 'K');
  assert.deepEqual(changes, ['C', 'K']);
  controller.destroy();
  c.click();
  assert.equal(controller.type, 'K');
});

test('스캐너 배선 — stage overlay 선택기, K 기본 18점, C 5점, UI 예산 불변', () => {
  const stageAt = SCANNER_HTML.indexOf('<div class="square-stage" id="camera-stage">');
  const selectorAt = SCANNER_HTML.indexOf('id="scan-guide-type"');
  const stageSectionEnd = SCANNER_HTML.indexOf('</section>', stageAt);
  assert.ok(stageAt >= 0 && selectorAt > stageAt && selectorAt < stageSectionEnd,
    'K/C 선택기가 카메라 스테이지 안에 있지 않다');

  assert.match(SCANNER_HTML, /\.scan-guide-type \{[^}]*position: absolute;/s);
  assert.match(SCANNER_HTML, /\.scan-guide-type \{[^}]*visibility: hidden;/s);
  assert.match(SCANNER_HTML, /\.square-stage\.is-active \.scan-guide-type \{[^}]*visibility: visible;/s);
  assert.match(SCANNER_HTML, /data-guide-type="K" aria-pressed="true"/);
  assert.match(SCANNER_HTML, /data-guide-type="C" aria-pressed="false"/);
  assert.match(
    SCANNER_HTML,
    /--tl-ui-stack-h: calc\(36px \+ 132px \+ 34px \+ 62px \+ 52px \+ 24px \+ 76px\);/,
    'overlay 추가가 기존 UI_STACK_BUDGET을 바꿨다',
  );

  assert.match(SCANNER_JS, /EDGE_UNIT_OFFSETS/);
  assert.match(SCANNER_JS, /outerFraction: GUIDE_OUTER_FRACTION/);
  assert.match(SCANNER_JS, /ring\(dots\.typeC, 'dot-type-c', outerR\)/);
  assert.match(SCANNER_JS, /ring\(dots\.outer, 'dot-outer', outerR\)/);
  assert.match(SCANNER_JS, /ring\(dots\.middle, 'dot-middle', outerR \* 0\.85\)/);
  assert.match(SCANNER_JS, /ring\(dots\.inner, 'dot-inner', outerR \* 0\.72\)/);
  assert.match(SCANNER_JS, /wireScanGuideType\(scanGuideTypeRoot/);
  assert.match(SCANNER_JS, /refreshScanGuideCopy\(\);\s*\n\s*renderGuideDots\(\);/);
  assert.match(SCANNER_JS, /SCANNER_BUILD = '2026-08-30\.03'/);

  const moduleIds = collectScannerModuleSources().map((moduleSource) => moduleSource.id);
  assert.ok(moduleIds.includes('/tlscan/scan-guide-ui.js'), '단일 파일 빌드 그래프에 새 헬퍼가 없다');
  assert.ok(moduleIds.indexOf('/tlscan/scan-guide-ui.js') < moduleIds.indexOf('/scanner.js'),
    '새 헬퍼가 scanner.js보다 먼저 등록되지 않는다');
});

test('8언어 — 선택기와 Type C 동적 안내 키가 전 언어에 있고 언어 변경 콜백이 동기화한다', () => {
  const languages = Object.keys(SCANNER_STRINGS);
  assert.deepEqual(languages, ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']);
  const keys = [
    'guide.typeLabel',
    'guide.typeK',
    'guide.typeC',
    'guide.cMessage',
    'guide.cDots',
  ];
  for (const lang of languages) {
    for (const key of keys) {
      assert.equal(typeof SCANNER_STRINGS[lang][key], 'string', `${lang}.${key} 없음`);
      assert.ok(SCANNER_STRINGS[lang][key].trim(), `${lang}.${key} 비어 있음`);
    }
  }
  assert.match(SCANNER_JS, /onChange\(\) \{[\s\S]*refreshScanGuideCopy\(\);/);
  assert.match(SCANNER_JS, /setAttribute\('data-i18n', keys\.message\)/);
  assert.match(SCANNER_JS, /setAttribute\('data-i18n', keys\.detail\)/);
});
