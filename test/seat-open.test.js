/**
 * seat-open.test.js — 자리 축 개방의 기하·회계·왕복·생성기 배선 자.
 *
 * 좌표는 markerCells/notchCellsC/sagoaeCells 정본에서만 유도한다. 이 파일의
 * 숫자는 유도 집합의 크기와 교집합 수이며 좌표 사본이 아니다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { encode } from '../src/encode.js';
import { decodeCells } from '../src/decode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCellFinders } from '../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { FACES, facePolygon } from '../src/hexgrid.js';
import { markerCells } from '../src/markerO.js';
import {
  VERSIONS_OCM_DAEHAN,
  dataCellsInScanOrderOMarkerDaehan,
} from '../src/markerOdaehan.js';
import { notchCellsC } from '../src/notchC.js';
import {
  daehanPatternId, sagoaeCells, sagoaeLevels,
} from '../src/finder-daehan.js';
import { hTonesByKeyO } from '../src/finder-H.js';
import {
  TYPE_C_CM_UNSUPPORTED_REASON, TYPE_C_RADII,
} from '../src/formatC.js';
import { FINDER_CELL_MASK_PATTERNS } from '../src/finder-patterns.js';
import { syncAfterSeatChange } from '../src/generator-state.js';
import {
  SEAT_NONE, SEAT_O_CM, SEAT_SAGOAE, safeAutoInnerSeat,
} from '../src/generator-seat-auto.js';
import {
  OAK_FINDER_PATTERNS, OAK_RENDER_ONLY_FINDER_PATTERNS,
} from '../src/finder-oak-patterns.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, BULLSEYE_MID, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const LEVEL = 'M';
const PAYLOAD = 'seat-open';
const DECOMPOSED_CENTRAL = 'oak-aspirin';
const DECOMPOSED_LINEUP = Object.freeze([
  ...FINDER_CELL_MASK_PATTERNS,
  ...OAK_FINDER_PATTERNS,
  ...OAK_RENDER_ONLY_FINDER_PATTERNS,
]);

const preset = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: preset.background,
  levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

const key = (cell) => `${cell.q},${cell.r}`;

function intersection(a, b) {
  const right = new Set(b.map(key));
  return a.filter((cell) => right.has(key(cell)));
}

function unionSize(a, b) {
  return new Set([...a, ...b].map(key)).size;
}

function encodedDataDigits(encoded, scan) {
  return Uint8Array.from(scan.map((cell) => {
    const entry = encoded.cellDigits.get(key(cell));
    assert.ok(entry, `데이터 scan 셀에 digit이 없다: ${key(cell)}`);
    return entry.digit;
  }));
}

function decodeCombinedCells(encoded, spec) {
  return decodeCells(
    encodedDataDigits(encoded, dataCellsInScanOrderOMarkerDaehan(spec.k)),
    {
      type: 'O',
      version: spec.version,
      k: spec.k,
      formatIndex: spec.formatIndex,
      eccLevel: LEVEL,
      cornerMarker: true,
      daehanFinder: true,
    },
  );
}

function rasterOf(encoded, finderPatternId) {
  const scene = buildScene(encoded, { palette: PALETTE, finderPatternId });
  const raster = rasterize(scene, { pixelsPerUnit: 24, supersample: 2 });
  return { scene, raster };
}

function decomposedCentralEvidence(raster) {
  const luma = toRelativeLuminance(raster, {});
  const detected = detectCellFinders(luma, DECOMPOSED_LINEUP, {
    centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }],
  });
  assert.equal(detected.ok, true, '분해 장면에서 중앙 cell-mask를 찾지 못했다');
  const finder = detected.candidates.find(
    (candidate) => candidate.patternId === DECOMPOSED_CENTRAL,
  );
  assert.ok(finder, '분해 장면에서 선택한 중앙 파인더 증거가 없다');
  return finder;
}

test('Type C 노치와 H tetrad는 전 C 반경에서 정확히 4셀 겹쳐 C×H를 닫는다', () => {
  for (const k of TYPE_C_RADII) {
    const h = markerCells(k);
    const notch = notchCellsC(k);
    assert.equal(h.length, 12, `k=${k}: H tetrad 셀 수`);
    assert.equal(intersection(h, notch).length, 4, `k=${k}: H × 노치 교집합`);
  }
  assert.match(TYPE_C_CM_UNSUPPORTED_REASON, /4셀/,
    '공용 거절 사유가 실측 교집합 수와 다르다');
});

test('H×sagoae는 G1만 4셀 충돌하고 합성 표 G2–G4는 서로소·단순합 회계다', () => {
  const g1H = markerCells(6);
  const g1Sagoae = sagoaeCells(6);
  assert.equal(intersection(g1H, g1Sagoae).length, 4, 'G1(k=6) 충돌 수');

  assert.deepEqual(VERSIONS_OCM_DAEHAN.map((spec) => spec.k), [8, 10, 12]);
  for (const spec of VERSIONS_OCM_DAEHAN) {
    const h = markerCells(spec.k);
    const sagoae = sagoaeCells(spec.k);
    assert.equal(h.length, 12, `${spec.name}: H tetrad 셀 수`);
    assert.equal(intersection(h, sagoae).length, 0, `${spec.name}: H × sagoae`);
    assert.equal(unionSize(h, sagoae), h.length + sagoae.length,
      `${spec.name}: 예약 셀 단순합(중복 0)`);
  }
});

test('H+sagoae 합성 장면은 H 12셀 톤과 sagoae 고리 톤을 모두 그린다', () => {
  const spec = VERSIONS_OCM_DAEHAN.at(-1);
  const encoded = encode(PAYLOAD, {
    version: spec.version,
    eccLevel: LEVEL,
    cornerMarker: true,
    markerTones: true,
    sagoae: true,
  });
  assert.equal(encoded.cornerMarker, true);
  assert.equal(encoded.markerTones, true);
  assert.equal(encoded.sagoae, true);
  assert.equal(encoded.capacity.name, spec.name);

  const expectedH = hTonesByKeyO(spec.k);
  for (const cell of markerCells(spec.k)) {
    const entry = encoded.cellDigits.get(key(cell));
    assert.ok(entry?.tones, `H 셀에 톤이 없다: ${key(cell)}`);
    assert.deepEqual(entry.tones, expectedH.get(key(cell)),
      `H 셀 톤이 정본과 다르다: ${key(cell)}`);
  }

  const scene = buildScene(encoded, {
    palette: PALETTE,
    finderPatternId: DECOMPOSED_CENTRAL,
  });
  let encodedShapeIndex = 0;
  let renderedHFaces = 0;
  for (const [cellKey, entry] of encoded.cellDigits) {
    const [q, r] = cellKey.split(',').map(Number);
    for (const face of FACES) {
      const shape = scene.shapes[encodedShapeIndex];
      if (expectedH.has(cellKey)) {
        const tone = expectedH.get(cellKey)[face];
        assert.deepEqual(shape.points, facePolygon(q, r, face, scene.layout),
          `H 장면 면 좌표가 다르다: ${cellKey}:${face}`);
        assert.deepEqual(shape.color, PALETTE.levels[tone],
          `H 장면 면 톤이 다르다: ${cellKey}:${face}`);
        assert.equal(entry.tones[face], tone,
          `H 적재 톤이 장면 기대값과 다르다: ${cellKey}:${face}`);
        renderedHFaces += 1;
      }
      encodedShapeIndex += 1;
    }
  }
  assert.equal(renderedHFaces, markerCells(spec.k).length * FACES.length,
    '장면에서 H 톤 면이 빠졌거나 더해졌다');
  assert.equal(scene.sagoae, true);
  const cells = sagoaeCells(spec.k);
  const levels = sagoaeLevels(spec.k);
  const rendered = scene.shapes.slice(-(cells.length * FACES.length));
  assert.equal(rendered.length, cells.length * FACES.length);
  let shapeIndex = 0;
  for (let ci = 0; ci < cells.length; ci += 1) {
    for (let fi = 0; fi < FACES.length; fi += 1) {
      const face = FACES[fi];
      const level = levels[ci][fi];
      const expectedColor = level === 2 ? PALETTE.bullseyeLight
        : level === 1 ? BULLSEYE_MID : PALETTE.bullseyeDark;
      assert.deepEqual(rendered[shapeIndex].points,
        facePolygon(cells[ci].q, cells[ci].r, face, scene.layout),
        `sagoae 셀 면 좌표가 다르다: ${key(cells[ci])}:${face}`);
      assert.deepEqual(rendered[shapeIndex].color, expectedColor,
        `sagoae 셀 면 톤이 다르다: ${key(cells[ci])}:${face}`);
      shapeIndex += 1;
    }
  }
});

test('G2–G4 H+sagoae는 direct와 프런트엔드에서 원문 왕복한다', { timeout: 180_000 }, () => {
  for (const spec of VERSIONS_OCM_DAEHAN) {
    const text = `H-sagoae-${spec.name}`;
    const encoded = encode(text, {
      version: spec.version,
      eccLevel: LEVEL,
      cornerMarker: true,
      markerTones: true,
      sagoae: true,
    });
    const direct = decodeCombinedCells(encoded, spec);
    assert.equal(direct.ok, true, `${spec.name} direct: ${direct.reason}`);
    assert.equal(direct.text, text);

    const { raster } = rasterOf(encoded, DECOMPOSED_CENTRAL);
    const central = decomposedCentralEvidence(raster);
    const frontend = decodeFrontend(raster, {
      familyEvidence: { finders: [central] },
      bootstrap: { cellFinderDaehan: true },
    });
    assert.equal(frontend.ok, true, `${spec.name} frontend: ${frontend.reason}`);
    assert.equal(frontend.text, text);
    assert.match(frontend.hypothesis.id, /-sagoae$/,
      `${spec.name}: sagoae 검증 경로가 아니다`);
  }
});

test('G4(H)+원자 daehan은 direct와 프런트엔드에서 원문 왕복한다', { timeout: 180_000 }, () => {
  const spec = VERSIONS_OCM_DAEHAN.at(-1);
  assert.equal(spec.name, 'V4CMD');
  const text = 'G4-H-daehan';
  const encoded = encode(text, {
    version: spec.version,
    eccLevel: LEVEL,
    cornerMarker: true,
    markerTones: true,
    daehanFinder: true,
  });
  assert.deepEqual({
    cornerMarker: encoded.cornerMarker,
    markerTones: encoded.markerTones,
    daehanFinder: encoded.daehanFinder,
    capacity: encoded.capacity.name,
  }, {
    cornerMarker: true,
    markerTones: true,
    daehanFinder: true,
    capacity: 'V4CMD',
  });

  const direct = decodeCombinedCells(encoded, spec);
  assert.equal(direct.ok, true, `G4 direct: ${direct.reason}`);
  assert.equal(direct.text, text);

  const { raster } = rasterOf(encoded, daehanPatternId(spec.k));
  const frontend = decodeFrontend(raster, {
    bootstrap: { cellFinderDaehan: true },
  });
  assert.equal(frontend.ok, true, `G4 frontend: ${frontend.reason}`);
  assert.equal(frontend.text, text);
});

test('생성기 배선은 C×H 숨김·합성 버전 게이트·독립 옵션·심부 우선 DOM을 갖는다', () => {
  const deep = INDEX.indexOf('<div id="finderDeepZone"');
  const inner = INDEX.indexOf('<div id="finderInnerZone"');
  const outer = INDEX.indexOf('<div id="finderOuterZone"');
  assert.ok(deep >= 0 && inner >= 0 && outer >= 0, '자리 구역 DOM이 빠졌다');
  assert.ok(deep < inner, '심부 자리 노드가 내곽 자리 노드보다 뒤에 있다');
  assert.ok(inner < outer, '내곽 자리 노드가 외곽 자리 노드보다 뒤에 있다');

  const syncTypeStart = INDEX.indexOf('function syncTypeUi()');
  const syncTypeEnd = INDEX.indexOf('function syncTurnAUi()', syncTypeStart);
  const syncType = INDEX.slice(syncTypeStart, syncTypeEnd);
  const syncSeatStart = INDEX.indexOf('function syncSeatUi()');
  const syncSeatEnd = INDEX.indexOf('function syncYLocatorUi()', syncSeatStart);
  const syncSeat = INDEX.slice(syncSeatStart, syncSeatEnd);
  const syncResStart = INDEX.indexOf('function syncResTierUi()');
  const syncResEnd = INDEX.indexOf('for (const card of els.resTierCards.children)', syncResStart);
  const syncRes = INDEX.slice(syncResStart, syncResEnd);
  assert.match(INDEX, /function markerDaehanSupportsGeneratorVersion\(/,
    'G1을 닫고 G2–G4만 여는 표 유도 술어가 없다');
  assert.match(syncType, /markerDaehanSupportsGeneratorVersion\(/,
    '버전 선택지가 H×daehan\/sagoae 합성 표를 보지 않는다');
  assert.match(syncSeat, /markerDaehanSupportsGeneratorVersion\(/,
    '자리 카드가 H×daehan\/sagoae 합성 표를 보지 않는다');
  assert.match(syncRes,
    /const markerDaehanTierLocked = \(res\) => markerDaehanActive\s*&& res !== 'ultra'/,
    '자동 H가 Type C 진입 때 내려가는 ultra 전이를 합성 잠금이 가로막는다');

  assert.match(syncSeat,
    /const typeCCmLocked = seat === 'o-cm' && typeCGeneratorActive\(\);/,
    'Type C×H 겹침 게이트가 없다');
  const combinedLockMessages = [...INDEX.matchAll(/"g1025":\s*"([^"]+)"/g)];
  assert.equal(combinedLockMessages.length, 8, 'G1 합성 충돌 문구가 8언어 한 벌이 아니다');
  for (const [, message] of combinedLockMessages) {
    assert.match(message, /G1/);
    assert.match(message, /4/);
    assert.match(message, /G2–G4/);
  }
  const displayStart = syncSeat.indexOf('card.style.display =');
  const displayEnd = syncSeat.indexOf(';', displayStart);
  assert.ok(displayStart >= 0 && displayEnd > displayStart,
    '자리 카드 표시 문장을 찾지 못했다');
  assert.match(syncSeat.slice(displayStart, displayEnd + 1), /typeCCmLocked/,
    'Type C에서 o-cm 카드를 숨기지 않는다');

  const oStart = INDEX.lastIndexOf(
    "const opts = { centerQr: cfg.fallback.mode === 'center' };",
  );
  const oReturn = INDEX.indexOf('return { fn: encode, opts };', oStart);
  assert.ok(oStart >= 0 && oReturn > oStart, 'Type O 옵션 매퍼를 찾지 못했다');
  const oBranch = INDEX.slice(oStart, oReturn);
  assert.match(oBranch,
    /if\s*\(cfg\.cornerMarker(?:\s*===\s*true)?\)[^{]*\{[^]*?opts\.cornerMarker\s*=\s*true/,
    'Type O 옵션 매퍼가 cornerMarker를 독립적으로 싣지 않는다');
  assert.match(oBranch,
    /if\s*\(cfg\.sagoae(?:\s*===\s*true)?\)[^{]*\{[^]*?opts\.sagoae\s*=\s*true/,
    'Type O 옵션 매퍼가 sagoae를 독립적으로 싣지 않는다');
  assert.match(oBranch, /opts\.markerTones\s*=\s*true/,
    'Type O 옵션 매퍼가 H 톤을 싣지 않는다');
  assert.doesNotMatch(oBranch, /else\s+if\s*\(cfg\.(?:cornerMarker|sagoae)/,
    'Type O 옵션 매퍼의 else-if가 동시 옵션 하나를 조용히 버린다');
});

test('자리 선택 상전이는 버전·해상도·중앙 파인더 잠금을 같은 틱에 재동기화한다', () => {
  const calls = [];
  syncAfterSeatChange({
    syncSeatUi: () => calls.push('seat'),
    syncTurnAUi: () => calls.push('turn'),
    syncTypeUi: () => calls.push('version'),
    syncResTierUi: () => calls.push('resolution'),
    renderFinderUi: () => calls.push('finder'),
  });
  assert.deepEqual(calls, ['seat', 'turn', 'version', 'resolution', 'finder']);

  const handlerStart = INDEX.indexOf('function wireSeatCards(');
  const handlerEnd = INDEX.indexOf("wireSeatCards(els.innerSeatCards", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'seat 카드 핸들러를 찾지 못했다');
  const handler = INDEX.slice(handlerStart, handlerEnd);
  assert.match(handler,
    /syncAfterSeatChange\(\{[^]*?syncTypeUi,[^]*?syncResTierUi,[^]*?renderFinderUi,/,
    'seat 카드 핸들러가 합성 조합의 의존 UI를 재동기화하지 않는다');

  const finderQrStart = INDEX.indexOf('function syncFinderQrUi()');
  const finderQrEnd = INDEX.indexOf('function wireTypeCards(', finderQrStart);
  const finderQrSync = INDEX.slice(finderQrStart, finderQrEnd);
  assert.ok(finderQrSync.indexOf('syncSeatUi();') < finderQrSync.indexOf('renderFinderUi();'),
    '첫 로드에서 자동 H 유도보다 daehan 카드 잠금을 먼저 그린다');
});

test('자동 H는 Type C·G1 합성에서만 내려가고 G2–G4 복귀 때 되살아난다', () => {
  const resolve = (overrides = {}) => safeAutoInnerSeat({
    proposedInner: SEAT_O_CM,
    ...overrides,
  });
  assert.equal(resolve({ typeCActive: true }), SEAT_NONE, 'Type C에서 자동 H가 남는다');
  assert.equal(resolve({
    markerDaehanVersionSupported: false,
    deepSeat: SEAT_SAGOAE,
  }), SEAT_NONE, 'G1 H+sagoae가 자동으로 만들어진다');
  assert.equal(resolve({
    markerDaehanVersionSupported: false,
    daehanFinder: true,
  }), SEAT_NONE, 'G1 H+daehan이 자동으로 만들어진다');
  assert.equal(resolve({
    markerDaehanVersionSupported: true,
    deepSeat: SEAT_SAGOAE,
  }), SEAT_O_CM, 'G2–G4 복귀 뒤 자동 H가 복원되지 않는다');
  assert.equal(resolve({ markerDaehanVersionSupported: false }), SEAT_O_CM,
    '상대 축이 없는데 G1 자동 H를 불필요하게 내린다');

  const syncSeatStart = INDEX.indexOf('function syncSeatUi()');
  const syncSeatEnd = INDEX.indexOf('function syncYLocatorUi()', syncSeatStart);
  assert.match(INDEX.slice(syncSeatStart, syncSeatEnd), /safeAutoInnerSeat\(\{/,
    '생성기 자동 자리 경로가 안전 폴백 정본을 쓰지 않는다');
});
