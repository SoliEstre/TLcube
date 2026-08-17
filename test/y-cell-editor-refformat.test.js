/**
 * y-cell-editor-refformat.test.js — Y 검출기 카드 순서 + 셀 편집기 ref./format 의
 * 선택 파인더 종속 유도 (운영자 지시 2026-08-16).
 *
 * 핵심 계약 (c0e7321): 편집기가 **표시하는** reference/format 배치 == 인코더·디코더가
 * **실제 쓰는** 배치. 파인더 painted 셀은 cellSurfaceFinal 정본에서 런타임 유도하고
 * (손 좌표표 금지), 배치는 autoplaceY.placeReservedCells 한 함수에서만 나온다.
 * 표시용 별도 계산이 미래에 갈라지는 것을 이 파일이 막는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { placeReservedCells, FORMAT_BLOCK_LENGTH_V2 } from '../src/autoplaceY.js';
import { buildRoleSets } from '../src/placementY.js';
import {
  CELL_SURFACE_FINAL_IDS,
  CELL_SURFACE_FINAL_NS,
  cellSurfaceFinal,
  occupiedCellsCellSurfaceFinal,
  paintedCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import {
  applyMaskToggle,
  classifyCoord,
  countEditorCoords,
  createCellEditorState,
  dataBoundaryEdges,
  isDataCoord,
  serializeCellEditor,
} from '../src/type-y-cell-editor.js';
import {
  coordKey as coreCoordKey,
  createUniversalEditorState,
  previewAutoplaceY,
} from '../src/cell-editor-core.js';
import { buildGeneratorLabHtml } from '../tools/build-gen-variants.mjs';
import { buildSingleHtml, OFFICIAL_GENERATOR_EDITION } from '../tools/build-single.mjs';
import { buildCellEditorHtml } from '../tools/build-cell-editor.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

const key = (c) => c.i + ',' + c.j;

/** 최종 라인업의 (레이아웃, n) 전 조합 — 레지스트리에서 유도 (하드코딩 금지). */
function finalPairs() {
  const out = [];
  for (const id of CELL_SURFACE_FINAL_IDS) {
    for (const n of CELL_SURFACE_FINAL_NS[id]) out.push([id, n]);
  }
  return out;
}

function langBlock(lang) {
  const start = INDEX.indexOf('const GENERATOR_STRINGS = {');
  const at = INDEX.search(new RegExp(`["']?${lang}["']?\\s*:\\s*\\{`, 'm'));
  assert.ok(start >= 0 && at > start, `${lang} 사전을 못 찾았다`);
  const open = INDEX.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < INDEX.length; i += 1) {
    if (INDEX[i] === '{') depth += 1;
    else if (INDEX[i] === '}') {
      depth -= 1;
      if (depth === 0) return INDEX.slice(open, i + 1);
    }
  }
  throw new Error(`${lang} 사전이 닫히지 않는다`);
}

function locatorCardOrder(html) {
  const start = html.indexOf('id="yLocatorCards"');
  assert.ok(start >= 0, 'yLocatorCards 를 못 찾았다');
  const end = html.indexOf('yLocatorHint', start);
  assert.ok(end > start, 'yLocatorHint 를 못 찾았다');
  return [...html.slice(start, end).matchAll(/data-locator="([a-z0-9-]+)"/g)]
    .map((m) => m[1]);
}

// 신설 단언 — 기존에 카드 순서를 못 박는 테스트가 없었다 (운영자 지시 2026-08-16:
// 끔 → v0 → v1r2 → v2r2, 해상도 오름차순).
// 의도적 갱신 (2026-08-16): v0X 편입 — 운영자 지시로 v0 계열(v0 · v0X)을 인접
// 배치해 끔 → v0 → v0X → v1r2 → v2r2 가 됐다.
// 의도적 갱신 (2026-08-16, 생성기 UI 대개편 A-4): «검출기 선택» 통합 개명과 함께
// **자동**(정식 반영 대비 항목)이 맨 앞에 붙었다. 자동은 와이어 값이 아니라 UI
// 정책이고, 현재는 resolveAutoLocatorProfileY() 가 결정적으로 «끔» 을 돌려준다 —
// 그래서 순서상 «끔» 바로 앞이 제자리다.
// 의도적 갱신 (2026-08-17): v0XQ(중앙 QR 변형) 편입 — 운영자 지시로 v0 계열
// (v0 · v0X · v0XQ)을 인접 배치해 자동 → 끔 → v0 → v0X → v0XQ → v1r2 → v2r2 가 됐다.
// **의도적 갱신 «드랍 정본화» (운영자 확정 2026-08-16)** — v1r2 · v2r2 카드를 내려
// 자동 → 끔 → v0 → v0X → v0XQ 만 남았다. 남은 것은 **v0 계열뿐**이다.
// 와이어·정본·판독은 그대로다 (cellSurfaceFinal.js §CELL_SURFACE_FINAL_DROPPED_IDS).
// **의도적 갱신 «v0W 편입» (2026-08-16)** — v0W 카드가 v0XQ 뒤에 붙었다.
// 순서는 `CELL_SURFACE_FINAL_IDS` 의 선언 순서와 같다 (기본은 여전히 v0X).
// **의도적 갱신 «v0W 파생 2종 편입» (2026-08-16)** — v0WQ 카드가 v0W 뒤에 붙었다.
// (당시 서술: v0WY 카드는 여기 없다 — QR 위치 카드 쪽('plane')이 그 자리다.
//  2026-08-17 재설계로 뒤집혔다 — 아래 «v0WY 편입» 문단 참조.)
// **의도적 갱신 «v0XQ 드랍» (운영자 실기기 확정 2026-08-17)** — 조건부 드랍 규칙
// «v0WQ > v0XQ» 가 성립해(순위 v0WQ ≫ v0XQ > v0X ≈ v0W) v0XQ 카드를 내렸다.
// v1r2·v2r2 와 같은 «카드만 내림» 이다 — 사전 키(g604/g947)는 3언어 모두 남아 있고
// 와이어·정본·판독은 그대로다 (cellSurfaceFinal.js §CELL_SURFACE_FINAL_DROPPED_IDS).
// 남는 중앙 QR 카드는 v0WQ 하나다.
// **의도적 갱신 «v0W2 편입» (운영자 신설 설계 2026-08-17)** — v0W2 카드가 v0WQ 뒤에
// 붙었다 (`CELL_SURFACE_FINAL_IDS` 선언 순서 그대로). 기본은 여전히 v0X 다.
// **의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 판정 3라운드)** —
// v0X 카드를 내려 일곱 → 여섯이 됐고, 이제 Y1 카드는 **전부 v0W 계열**이다.
// 사전 키(g602/g603/g944)는 여덟 언어 모두 보존된다 (locatorY-lab.test.js 가 고정).
// **의도적 갱신 «v0WY 편입» (운영자 재설계 2026-08-17)** — v0WY 카드가 v0W2 뒤에
// 붙어 여섯 → 일곱이 됐다 (`CELL_SURFACE_FINAL_IDS` 선언 순서 그대로). 위 문단의
// 「v0WY 카드는 여기 없다」 는 허공 마름모 설계의 서술이고, QR 이 실루엣 안쪽 먼
// 코너로 들어오면서 진짜 레이아웃이 돼 뒤집혔다. QR 위치 카드 «면» 은 그대로 있고
// 이제 그 카드가 이 검출기 카드로 **전환**시킨다 (index.html §qrPositionCards).
//
// **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)** —
// v0W 계열 카드 넷이 내려가고 v0T · v0TY 카드가 섰다 (일곱 → 다섯). QR 위치
// 카드 «면» 은 이제 v0TY 로 전환한다 (같은 문법 — 대상만 바뀌었다).
const LOCATOR_CARD_ORDER = Object.freeze([
  'auto', 'off', 'cell-surface-v0',
  'cell-surface-v0t', 'cell-surface-v0ty',
]);
test('Y 검출기 옵션 카드 순서는 자동 → 끔 → v0 → v0T → v0TY 다 (v0 계열만)', () => {
  assert.deepEqual(locatorCardOrder(INDEX), [...LOCATOR_CARD_ORDER]);
});

test('셀 편집기 ref./format 는 선택 파인더 painted 셀의 autoplace 유도로 배선된다', () => {
  // 유도 컨텍스트: 인코더와 같은 encodeOptionsForY 배선 + 정본 painted 셀 런타임 유도.
  assert.match(INDEX, /function yCellEditorContext\(\)/);
  assert.match(INDEX, /encodeOptionsForY\(\{\s*tone: generatorState\.tone,/);
  assert.match(INDEX, /locatorProfileY: generatorState\.locatorProfileY,/);
  assert.match(INDEX, /cellSurfaceFinal\(n, encOpts\.cellSurfaceLayout\)/);
  // 의도적 갱신 (2026-08-17): 점유 = 파인더 ∪ 중앙 QR 슬롯. v0XQ 전에는 둘이
  // 같았지만 슬롯이 생기며 갈렸다 — painted 만 넣으면 슬롯이 데이터로 세어진다.
  assert.match(INDEX, /surface\.occupiedCells/);
  assert.doesNotMatch(INDEX, /surface\.paintedCells/);
  // 끔(무검출기) = 빈 점유 유도.
  assert.match(INDEX, /placeReservedCells\(n, \[\]\)/);
  // 손 좌표표·레거시 고정 배치 직접 참조 금지 — 표시용 별도 계산 경로가 없어야 한다.
  assert.doesNotMatch(INDEX, /buildRoleSets\(/);
  assert.doesNotMatch(INDEX, /from '\.\/src\/placementY\.js'/);
  // 옵션·n 변경 시 즉시 재계산 — 카드 클릭은 syncTypeUi 경유, 버전 select 는 직접 호출.
  assert.match(INDEX, /syncResTierUi\(\);\s*\n\s*syncTypeYCellEditorUi\(\);/);
  // 배치 불가 시 명시적 안내 (조용한 빈 표시 금지).
  assert.match(INDEX, /if \(ctx\.error\) \{/);
  assert.match(INDEX, /tf\('g549', \{ message: ctx\.error\.message \}\)/);
});

test('배치 불가 안내 g549 는 여덟 언어에 있다', () => {
  // ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): ko/en/ja → 8언어.
  //   {message} 치환 토큰 보존까지 함께 재므로 새 언어가 토큰을 빠뜨리면 여기서 깨진다.
  for (const lang of ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']) {
    assert.match(langBlock(lang), /"g549"\s*:/, `${lang} 에 g549 가 없다`);
    assert.match(langBlock(lang), /"g549"\s*:\s*"[^"]*\{message\}/, `${lang} g549 에 {message} 가 없다`);
  }
});

// 의도적 갱신 (2026-08-16, 포맷 v2): 신세대 셀 표면은 포맷 6 digit(18셀)이므로 유도
// 호출도 같은 세대를 넘긴다. 계약(«정본 = autoplace 유도») 은 그대로다.
// 의도적 갱신 (2026-08-17, v0xq): 점유 입력이 painted → painted ∪ 중앙 QR 슬롯 으로
// 넓어졌다. 슬롯 없는 네 레이아웃은 두 집합이 셀 하나까지 같아 단언이 불변이다.
test('정합: cellSurfaceFinal 의 ref/format == 점유(파인더∪슬롯) autoplace 유도 (deepEqual)', () => {
  for (const [id, n] of finalPairs()) {
    const surface = cellSurfaceFinal(n, id);
    const occupied = occupiedCellsCellSurfaceFinal(n, id);
    const painted = paintedCellsCellSurfaceFinal(n, id);
    assert.equal(
      occupied.length, painted.length + surface.slotCount, `${id}@${n} 점유 = painted + slot`,
    );
    const placed = placeReservedCells(n, occupied, {
      formatBlockLength: FORMAT_BLOCK_LENGTH_V2,
    });
    assert.equal(surface.formatCells.length, 18, `${id}@${n} format 18`);
    assert.deepEqual(
      surface.formatCells.map(key), placed.formatCells.map(key), `${id}@${n} format`,
    );
    assert.deepEqual(
      surface.referenceCells.map(key), placed.referenceCells.map(key), `${id}@${n} reference`,
    );
  }
});

test('끔(빈 점유) 유도는 레거시 placementY roleSets 와 동일하다', () => {
  for (const n of [13, 21, 25]) {
    const placed = placeReservedCells(n, []);
    const legacy = buildRoleSets(n);
    assert.deepEqual(new Set(placed.formatCells.map(key)), legacy.format, `n=${n} format`);
    assert.deepEqual(new Set(placed.referenceCells.map(key)), legacy.reference, `n=${n} reference`);
  }
});

test('occupied roleSets — 파인더 점유는 detector 이고 데이터·경계·마스크 토글에서 빠진다', () => {
  for (const [id, n] of finalPairs()) {
    const surface = cellSurfaceFinal(n, id);
    const sets = {
      reference: new Set(surface.referenceCells.map(key)),
      format: new Set(surface.formatCells.map(key)),
      occupied: new Set(surface.occupiedCells.map(key)),
    };
    const state = createCellEditorState(n);

    const occ = surface.occupiedCells[0];
    assert.equal(classifyCoord(state, occ.i, occ.j, sets), 'detector', `${id}@${n}`);
    assert.equal(isDataCoord(state, occ.i, occ.j, sets), false);
    const toggled = applyMaskToggle(state, occ.i, occ.j, sets);
    assert.equal(toggled.changed, false);
    assert.equal(toggled.reason, 'occupied');

    // 재배치된 ref/format 는 fixed — 레거시 좌표가 아니라 유도 좌표가 fixed 여야 한다.
    const fmt = surface.formatCells[0];
    assert.equal(classifyCoord(state, fmt.i, fmt.j, sets), 'fixed');

    // 회계: data 가 인코더 선언값(declaredDataCells)과 일치 — 표시와 실제가 같은 수.
    const counts = countEditorCoords(state, sets);
    assert.equal(counts.occupied, surface.occupiedCells.length, `${id}@${n} occupied`);
    assert.equal(counts.userNonData, 0);
    assert.equal(counts.data, surface.declaredDataCells, `${id}@${n} data`);
    const doc = serializeCellEditor(state, sets);
    assert.equal(doc.counts.data, surface.declaredDataCells);
    assert.equal(doc.counts.occupied, surface.occupiedCells.length);

    // 데이터 경계: 점유 셀은 데이터 합집합 밖 — 경계 변이 점유 셀 위에 있지 않다.
    const edges = dataBoundaryEdges(state, sets);
    assert.ok(edges.length > 0);
    assert.ok(edges.every((e) => !sets.occupied.has(e.i + ',' + e.j)), `${id}@${n} boundary`);
    const noOccupied = dataBoundaryEdges(state, {
      reference: sets.reference, format: sets.format, occupied: new Set(),
    });
    assert.notDeepEqual(edges, noOccupied, `${id}@${n} 점유가 경계를 바꿔야 한다`);
  }
});

test('독립 /celleditor/ previewAutoplaceY 도 정본 painted 입력에서 cellSurfaceFinal 과 일치한다', () => {
  for (const [id, n] of finalPairs()) {
    const state = createUniversalEditorState({ type: 'Y', size: n });
    for (const cell of occupiedCellsCellSurfaceFinal(n, id)) {
      state.userNonData.add(coreCoordKey('Y', cell));
    }
    const preview = previewAutoplaceY(state);
    assert.equal(preview.ok, true, `${id}@${n} 유도 실패: ${preview.message || ''}`);
    const surface = cellSurfaceFinal(n, id);
    assert.deepEqual(preview.placement.formatCells.map(key), surface.formatCells.map(key));
    assert.deepEqual(
      preview.placement.referenceCells.map(key), surface.referenceCells.map(key),
    );
  }
});

test('생성기·셀 편집기 번들에 카드 순서와 유도 배선이 임베드된다', () => {
  const lab = buildGeneratorLabHtml();
  const official = buildSingleHtml({ generatorEdition: OFFICIAL_GENERATOR_EDITION });
  for (const html of [lab, official]) {
    assert.deepEqual(locatorCardOrder(html), [...LOCATOR_CARD_ORDER]);
    assert.match(html, /yCellEditorContext/);
    assert.match(html, /g549/);
  }
  const cellEditor = buildCellEditorHtml();
  assert.match(cellEditor, /previewAutoplaceY/);
});
