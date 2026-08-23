/**
 * finder-footprint.test.js — W2 선행: 신규 중앙 19셀 후보 2종 편입 회귀 (2026-08-23).
 *
 * 잠그는 명제:
 *  ① **footprint 표가 정본과 같다.** 바깥 repo 의 셀 편집기 export
 *     (`finder-footprint-2026-08-23.json`)가 있으면 `deriveFootprintCellLevels` 로
 *     전수 재유도해 임베드 표와 대조한다 — 어긋나면 실패다. 없으면(공개 체크아웃)
 *     그 사실을 밝히고 자기 일관성만 잰다. 조용한 skip 은 거짓 초록이다.
 *  ② **taegeuk 단독 표는 유도다.** `finder-daehan.js` 의 taegeukCells/taegeukLevels
 *     (daehan k10 정본 유도)를 슬롯 순으로 재배열한 것과 같아야 한다 — 값 복사가
 *     아니라는 것을 여기서 잰다 (사본 목록은 썩는다).
 *  ③ **명부 수치는 실측이고 썩지 않는다.** margin·mirrorAgreement 를 명부 대조와
 *     같은 자(orientation-scorer)로 매 회귀마다 재계산해 표와 대조한다.
 *  ④⑤ **렌더 왕복이 선다.** encode → buildScene(finderPatternId) → rasterize →
 *     verifyRaster (finder-render-selection.test.js 관용구). 검출 왕복(그린 것을
 *     검출기가 자기 후보로 되찾는가)은 finder-oak-patterns.test.js ③ 이
 *     OAK_FINDER_PATTERNS 전수 루프로 자동으로 함께 잰다.
 *  ⑥ **라벨 배선.** FINDER_LABEL_KEYS 등재 + 생성기 8언어 사전. 스캐너 기대축
 *     버튼·8언어는 lab-expected-finder-ui.test.js 가 유도로 잰다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FOOTPRINT_CELL_LEVELS, FOOTPRINT_NAME, deriveFootprintCellLevels,
} from '../src/finder-footprint.js';
import { FINDER_CELL_ORDER } from '../src/finder-patterns.js';
import { getOakFinderPattern } from '../src/finder-oak-patterns.js';
import { oakCandidate } from '../src/finder-oak-lineup.js';
import { taegeukCells, taegeukLevels } from '../src/finder-daehan.js';
import {
  FACE_CYCLE_CW, FACE_CYCLE_CW2, hexHypothesis, hexLayoutFrom,
  hexRotationHypotheses, idealAgreement, scoreLayoutOrientation,
} from '../src/decoder/orientation-scorer.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { SUPPORTED_LANGUAGES } from '../src/i18n.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { verifyRaster } from '../src/verify.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 정본 팩 경로는 두 배치 관례를 탐침한다 (finder-oak-lineup.test.js 규약 승계 —
// 기계 고정 절대경로는 다른 체크아웃에서 조용히 skip 되어 거짓 초록이 된다):
//   ① 중첩 체크아웃  <바깥repo>/TLcube/test → ../../.agent/...
//   ② 형제 워크트리  E:/WorkBase/wt-* → ../../TrilLuminanceCube/.agent/...
const DATA_LAYOUTS = ['../../.agent/decoder/data/', '../../TrilLuminanceCube/.agent/decoder/data/'];
function canonicalPathOrNull(fileName) {
  for (const rel of DATA_LAYOUTS) {
    const p = fileURLToPath(new URL(rel + fileName, import.meta.url));
    if (existsSync(p)) return p;
  }
  return null;
}

test('① footprint 표가 정본 편집기 export 재유도와 같다 (없으면 자기 일관성만)', (t) => {
  const path = canonicalPathOrNull('finder-footprint-2026-08-23.json');
  if (!path) {
    // 조용히 통과시키지 않는다 — 정본 없는 체크아웃에서 잴 수 있는 것만 잰다.
    t.diagnostic('finder-footprint-2026-08-23.json 없음 — 자기 일관성만 잰다');
    assert.equal(FOOTPRINT_CELL_LEVELS.length, FINDER_CELL_ORDER.length);
    assert.deepEqual([...new Set(FOOTPRINT_CELL_LEVELS.flat())].sort(), [0, 2]);
    return;
  }
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const derived = deriveFootprintCellLevels(doc);
  assert.deepEqual(FOOTPRINT_CELL_LEVELS.map((triple) => [...triple]), derived,
    '임베드 표가 정본 재유도와 다르다 — 표를 손대지 말고 유도를 다시 돌려라');
  // 정본 메타의 독립 대조 — 이름·검출 셀 수·톤 이진.
  assert.equal(doc.finderPattern && doc.finderPattern.name, FOOTPRINT_NAME);
  assert.equal(doc.counts.detector, 19);
  assert.equal(doc.counts.total, oakCandidate(FOOTPRINT_NAME).counts.total);
});

test('② taegeuk 단독 표는 finder-daehan 유도의 슬롯 재배열과 같다', () => {
  const pattern = getOakFinderPattern('oak-taegeuk-solo');
  assert.ok(pattern, 'oak-taegeuk-solo 가 OAK 표에 없다');
  assert.equal(pattern.name, 'taegeuk', '표시명은 taegeuk 이어야 한다 (운영자 확정)');
  const cells = taegeukCells();
  const levels = taegeukLevels();
  const byKey = new Map(cells.map((cell, i) => [cell.q + ',' + cell.r, levels[i]]));
  const derived = FINDER_CELL_ORDER.map((cell) => {
    const triple = byKey.get(cell.q + ',' + cell.r);
    assert.ok(triple, '슬롯 좌표 ' + cell.q + ',' + cell.r + ' 가 taegeukCells 에 없다');
    return [...triple];
  });
  assert.deepEqual(pattern.cellLevels.map((triple) => [...triple]), derived,
    'oak-taegeuk-solo 표가 daehan 정본 유도와 다르다 — 누가 값을 손으로 적었나');
  // 톤은 daehan 정본 그대로 0/2 이진이어야 한다 — 중간톤이 나오면 유도가 샌 것.
  assert.deepEqual([...new Set(derived.flat())].sort(), [0, 2]);
});

// ── ③ 명부 수치 재측정 — 자는 finder-oak-lineup.test.js 정본 재계산과 동일 ──

function layoutOf(cells, levels) {
  return hexLayoutFrom(cells.map((cell, i) => ({
    q: cell.q, r: cell.r,
    tones: { T: levels[i][0], L: levels[i][1], R: levels[i][2] },
  })));
}

const MIR = (q, r) => ({ q: -q - r, r });
const SWAP = { T: 'T', L: 'R', R: 'L' };
const rot120 = (q, r) => ({ q: -q - r, r: q });
const rot240 = (q, r) => ({ q: r, r: -q - r });
const composeCoord = (outer, inner) => (q, r) => { const p = inner(q, r); return outer(p.q, p.r); };
const composeFace = (outer, inner) => {
  const map = {};
  for (const face of ['T', 'L', 'R']) map[face] = outer[inner[face]];
  return map;
};
function mirrorPhysical(layout) {
  return Math.max(...[
    hexHypothesis('m0', MIR, SWAP),
    hexHypothesis('m120', composeCoord(rot120, MIR), composeFace(FACE_CYCLE_CW, SWAP)),
    hexHypothesis('m240', composeCoord(rot240, MIR), composeFace(FACE_CYCLE_CW2, SWAP)),
  ].map((hypothesis) => idealAgreement(layout, hypothesis).agreement));
}

test('③ 명부 margin·mirrorAgreement 가 실측 재계산과 같다 — 공표 수치는 썩지 않는다', () => {
  const cases = [
    ['Footprint', FINDER_CELL_ORDER, FOOTPRINT_CELL_LEVELS],
    ['taegeuk-solo', taegeukCells(), taegeukLevels()],
  ];
  for (const [name, cells, levels] of cases) {
    const row = oakCandidate(name);
    assert.ok(row, name + ' 이 명부에 없다');
    assert.equal(row.status, 'active', name);
    const layout = layoutOf([...cells], [...levels]);
    const scored = scoreLayoutOrientation(layout, hexRotationHypotheses());
    assert.equal(scored.orientationMargin.toFixed(4), row.margin.toFixed(4),
      name + ' margin 재계산 ' + scored.orientationMargin.toFixed(4) + ' vs 표 ' + row.margin);
    assert.equal(mirrorPhysical(layout).toFixed(4), row.mirrorAgreement.toFixed(4),
      name + ' mirrorAgreement 재계산이 표와 다르다');
  }
  // 명부 note 의 주장 검증: taegeuk 단독은 거울 물리 관례가 톤 게이트(0.78) 미달 —
  // daehan(0.6774) 에 이은 두 번째 후보다. footprint 는 완전 공변(1.0)이라 기존
  // 7후보 계열이다.
  assert.ok(mirrorPhysical(layoutOf(taegeukCells(), taegeukLevels())) < 0.78,
    'taegeuk 단독 거울이 게이트를 넘었다 — 명부 note 와 어긋난다');
});

// ── ④⑤ 렌더 왕복 (finder-render-selection.test.js 관용구·동일 경로) ─────────

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function renderRoundtrip(type, finderPatternId) {
  const encoded = type === 'A'
    ? encodeA('w2 finder', { version: 1, eccLevel: 'M' })
    : encode('w2 finder', { version: 1, eccLevel: 'M' });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    finderPatternId,
    margin: type === 'A' ? 20 : undefined,
  });
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
  return verifyRaster(raster, scene, encoded);
}

test('④ 렌더 왕복 — footprint 를 고른 장면이 O/A 에서 자기 계약을 지킨다', () => {
  for (const type of ['O', 'A']) {
    const check = renderRoundtrip(type, 'oak-footprint');
    assert.equal(check.ok, true,
      type + '/oak-footprint: ' + JSON.stringify(check.mismatches));
  }
});

test('⑤ 렌더 왕복 — taegeuk 단독을 고른 장면이 O/A 에서 자기 계약을 지킨다', () => {
  for (const type of ['O', 'A']) {
    const check = renderRoundtrip(type, 'oak-taegeuk-solo');
    assert.equal(check.ok, true,
      type + '/oak-taegeuk-solo: ' + JSON.stringify(check.mismatches));
  }
});

// ── ⑥ 라벨 배선 ─────────────────────────────────────────────────────────────

test('⑥ FINDER_LABEL_KEYS 등재 + 생성기 8언어 사전에 g583/g584 가 있다', () => {
  const INDEX = readFileSync(ROOT + 'index.html', 'utf8');
  assert.match(INDEX, /'oak-footprint': 'g583'/,
    'FINDER_LABEL_KEYS 에 oak-footprint 가 없다 — 카드 라벨이 undefined 키로 죽는다');
  assert.match(INDEX, /'oak-taegeuk-solo': 'g584'/,
    'FINDER_LABEL_KEYS 에 oak-taegeuk-solo 가 없다');
  assert.equal(SUPPORTED_LANGUAGES.length, 8);
  // 두 라벨은 고유명·로마자 고정 표기라 8개 언어 사전에 같은 문자열로 들어간다
  // (g565~g567 · g569 의 taegeuk 표기와 같은 규약). 언어 블록당 정확히 1개씩.
  const footprintEntries = INDEX.match(/"g583": "Footprint"/g) || [];
  const taegeukEntries = INDEX.match(/"g584": "taegeuk"/g) || [];
  assert.equal(footprintEntries.length, SUPPORTED_LANGUAGES.length,
    'g583(Footprint) 사전 항목이 8개 언어 전부에 없다: ' + footprintEntries.length);
  assert.equal(taegeukEntries.length, SUPPORTED_LANGUAGES.length,
    'g584(taegeuk) 사전 항목이 8개 언어 전부에 없다: ' + taegeukEntries.length);
});
