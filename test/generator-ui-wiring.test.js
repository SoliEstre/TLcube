/**
 * generator-ui-wiring.test.js — 「코드는 섰는데 누를 자리가 없다」 를 막는 회귀.
 *
 * 2026-08-19 운영자 지적 3라운드에서 나온 구멍들을 잠근다. 배경: 인코더·디코더·
 * 테스트가 다 초록인데 생성기 UI 에 그 기능을 켤 자리가 없거나, 켜도 아래 편집기가
 * 안 따라오거나, 고급 모드에 숨어 있어서 못 찾는 상태가 반복됐다.
 *
 * ⚠ **명제를 잠근다, 모양을 잠그지 않는다.** 2026-08-18 에 `bootstrap` 객체의 모양
 *   전체를 정규식으로 잠근 핀이 형제 키 하나 추가로 깨졌다. 여기서는 «어느 서랍이
 *   모드 게이트를 받는가» · «편집기가 생성기 선택을 태우는가» 처럼 술어만 잰다.
 *
 * ⚠ **일부 테스트는 «아직 안 된다» 를 잠근다** (§5). 그것이 목적이다 — 지금 조용히
 *   실패 중인 왕복을 누군가 배선하면 그 테스트가 **빨개져서** 사실이 드러난다.
 *   빨개지면 고칠 것은 제품이 아니라 이 파일의 기대값이다.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { FINDER_CARD_GROUPS } from '../src/finder-card-ui.js';
import { CENTER_QR_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import { daehanPatternId, isDaehanFinderPatternId } from '../src/finder-daehan.js';
import { GENERATOR_STATE_SCHEMA, createGeneratorState } from '../src/generator-state.js';
import {
  applyFinderStarter, createUniversalEditorState, getCellTone,
} from '../src/cell-editor-core.js';
import { OAK_FINDER_PATTERNS, OAK_LEVEL_FACE_INDEX } from '../src/finder-oak-patterns.js';
import { FINDER_CELL_ORDER } from '../src/finder-patterns.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

// ── §6.2 — 새 셀 표면 파인더는 일반 모드에서도 보인다 ────────────────────────

/** `applyFinderExperimentVisibility` 가 **모드로 가리는 서랍 id 집합**을 뽑는다. */
function modeGatedDrawerIds() {
  const at = INDEX.indexOf('function applyFinderExperimentVisibility()');
  assert.notEqual(at, -1, 'applyFinderExperimentVisibility 가 사라졌다');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  const list = body.match(/for \(const id of \[([^\]]*)\]\)/);
  assert.ok(list, '모드 게이트 대상 목록을 못 읽었다 — 배열 리터럴이 아니게 바뀌었나');
  return new Set([...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

test('§6.2 OAK 서랍은 모드 게이트를 안 받고, 기준 미달·스캔 불가 두 서랍은 받는다', () => {
  const gated = modeGatedDrawerIds();
  // 운영자 지시 2026-08-19: «새로 추가된 셀 표면 파인더» 한정으로 일반 모드 노출.
  assert.equal(gated.has('finderOak'), false,
    'finderOak 이 다시 고급 전용이 됐다 — 일반 모드에서 OAK 를 못 고른다');
  assert.equal(gated.has('finderBelowBar'), true, '기준 미달 서랍이 일반 모드로 샜다');
  assert.equal(gated.has('finderUnscannable'), true, '스캔 불가 서랍이 일반 모드로 샜다');
  // 서랍이 실재하는지도 함께 — 목록에서 빼는 것과 서랍을 지우는 것은 다르다.
  for (const id of ['finderOak', 'finderBelowBar', 'finderUnscannable']) {
    assert.ok(INDEX.includes(`id="${id}"`), id + ' 서랍이 마크업에 없다');
  }
});

test('§6.2 daehan 서랍은 고급 전용이다 — 시험판 스캐너에서만 읽히기 때문', () => {
  // 근거는 §5 의 왕복 실측이다. 그 사실이 바뀌면 이 기대값도 같이 움직여야 한다.
  assert.equal(modeGatedDrawerIds().has('finderDaehan'), true,
    'daehan 이 일반 모드로 샜다 — 안정판 스캐너가 못 읽는 코드를 기본 노출하게 된다');
});

// ── §6.1 — 생성기 파인더 선택이 아래 셀 편집기에 반영된다 ────────────────────

test('§6.1 편집기는 생성기가 고를 수 있는 파인더 id 를 조용한 폴백 없이 태운다', () => {
  const cardIds = Object.values(FINDER_CARD_GROUPS).flat().map((card) => card.id);
  const notRepresentable = new Set([
    CENTER_QR_FINDER_PATTERN_ID, // QR 모듈 블록이라 셀 표현이 없다 (동기화가 건너뛴다)
  ]);
  const swallowed = [];
  for (const id of cardIds) {
    if (notRepresentable.has(id)) continue;
    // daehan 은 39/59/79 셀이라 중앙 19셀 편집기 표현이 아직 없다 — 그 사실 자체를
    // 여기서 드러낸다(조용한 폴백이 아니라 알려진 예외로).
    const state = createUniversalEditorState({ type: 'O', size: 6 });
    applyFinderStarter(state, id);
    if (state.finderStarter !== id) swallowed.push(id);
  }
  assert.deepEqual(swallowed, cardIds.filter(isDaehanFinderPatternId),
    '편집기가 조용히 불스아이로 되돌리는 파인더가 늘었다: ' + JSON.stringify(swallowed)
    + ' — resolveFinderStarter 의 조회 순서를 보라 (OAK·daehan 은 별도 표다)');
});

test('§6.1 편집기 톤이 OAK 정본 cellLevels 와 19셀×3면 전부 일치한다', () => {
  for (const pattern of OAK_FINDER_PATTERNS) {
    const state = createUniversalEditorState({ type: 'O', size: 6 });
    applyFinderStarter(state, pattern.id);
    const mismatches = [];
    for (let i = 0; i < FINDER_CELL_ORDER.length; i += 1) {
      const cell = FINDER_CELL_ORDER[i];
      for (const face of ['T', 'L', 'R']) {
        const got = getCellTone(state, face, { q: cell.q, r: cell.r });
        const want = pattern.cellLevels[i][OAK_LEVEL_FACE_INDEX[face]];
        if (got !== want) mismatches.push(`${pattern.id}[${i}].${face} ${got}!=${want}`);
      }
    }
    assert.deepEqual(mismatches, [],
      pattern.id + ': 편집기가 그리는 톤이 정본과 다르다 (면당 3레벨을 못 읽고 있나)');
  }
});

test('§6.1 정본 OAK 표는 편집으로 오염되지 않는다', () => {
  const before = JSON.stringify(OAK_FINDER_PATTERNS.map((p) => p.cellLevels));
  const state = createUniversalEditorState({ type: 'O', size: 6 });
  applyFinderStarter(state, OAK_FINDER_PATTERNS[0].id);
  state.finderPattern.cellLevels[0][0] = (state.finderPattern.cellLevels[0][0] + 1) % 3;
  assert.equal(JSON.stringify(OAK_FINDER_PATTERNS.map((p) => p.cellLevels)), before,
    '편집기 사본이 얕아서 정본 표를 건드렸다');
});

test('§6.1 편집기 동기화가 실제로 호출된다 (함수만 있고 호출이 없으면 무의미하다)', () => {
  assert.match(INDEX, /function syncCellEditorFinderFromGenerator\(/);
  const at = INDEX.indexOf('function syncTypeYCellEditorUi()');
  assert.notEqual(at, -1, 'syncTypeYCellEditorUi 가 사라졌다');
  const body = INDEX.slice(at, at + 4000);
  assert.match(body, /syncCellEditorFinderFromGenerator\(state, ctx\)/,
    '편집기 UI 동기화 경로에서 파인더 동기화를 안 부른다');
});

// ── §3.2 — daehan 카드는 «누르면 인코딩이 바뀐다» ───────────────────────────

test('§3.2 daehan 을 고르면 인코더 회계가 실제로 바뀐다 (용량이 준다)', () => {
  // V1D 15/11/7 · V2D 32/26/18 · V3D 57/46/32 B (ECC L/M/H) — 브리프 §5-4 의 표.
  const expected = {
    1: { L: 15, M: 11, H: 7 },
    2: { L: 32, M: 26, H: 18 },
    3: { L: 57, M: 46, H: 32 },
  };
  for (const version of [1, 2, 3]) {
    for (const eccLevel of ['L', 'M', 'H']) {
      const daehan = encode('TL', { version, eccLevel, daehanFinder: true });
      const legacy = encode('TL', { version, eccLevel });
      assert.equal(daehan.capacity.maxPayloadBytes, expected[version][eccLevel],
        `V${version}D/${eccLevel} 용량이 표와 다르다`);
      assert.ok(daehan.capacity.maxPayloadBytes < legacy.capacity.maxPayloadBytes,
        `V${version}D/${eccLevel}: daehan 이 legacy 보다 용량이 안 줄었다 — 파인더가 60셀을 더 먹는데도?`);
    }
  }
});

test('§3.2 생성기 옵션 배선이 daehan id 를 인코더 옵션으로 옮긴다', () => {
  // encodeOptsFor 의 O 분기가 파인더 id 를 보고 daehanFinder 를 세우는가.
  // 이 한 줄이 없으면 79셀을 그려 놓고 legacy 용량을 표시한다.
  assert.match(INDEX, /isDaehanFinderPatternId\(cfg\.finderPatternId\)\) opts\.daehanFinder = true/);
  // 그리는 템플릿의 k 는 버전이 정한다 — 카드는 하나여야 한다.
  assert.equal(FINDER_CARD_GROUPS.daehan.length, 1,
    'daehan 카드가 하나가 아니다 — k 는 사용자가 고르는 축이 아니다');
  assert.match(INDEX, /daehanPatternId\(encoded\.k\)/);
});

test('§3.2 V1/V2/V3 ↔ k 6/8/10 대응이 두 표에서 같다', () => {
  // 「카드 하나 + 코드가 k 를 고른다」 규약이 서는 근거. 어긋나면 조용히 맞추지 말 것.
  for (const [version, k] of [[1, 6], [2, 8], [3, 10]]) {
    const encoded = encode('TL', { version, eccLevel: 'M', daehanFinder: true });
    assert.equal(encoded.k, k, `V${version} 의 k 가 ${k} 가 아니다`);
    assert.equal(daehanPatternId(encoded.k), `oak-daehan-k${k}`);
  }
});

// ── §3.1 — turnA 토글은 «누르면 와이어가 바뀐다», 그리고 lab 뒤에 있다 ──────

test('§3.1 turnA 를 켜면 발행되는 formatIndex 가 실제로 바뀐다', () => {
  // 정본 표(turnA.js)의 6벡터. 켜도 version·k·용량은 안 바뀐다 — 바뀌는 것은 와이어다.
  const table = [[0, 1, 2], [1, 12, 4], [2, 13, 0]];
  for (const [version, plain, turned] of table) {
    const off = encodeA('TL', { version, eccLevel: 'M' });
    const on = encodeA('TL', { version, eccLevel: 'M', turnA: true });
    assert.equal(off.formatIndex, plain, `A${version} 기본 formatIndex`);
    assert.equal(on.formatIndex, turned, `A${version} turnA formatIndex`);
    assert.notEqual(on.formatIndex, off.formatIndex, '토글이 와이어를 안 바꾼다');
    assert.equal(on.k, off.k, 'turnA 가 k 를 바꾸면 UI 버전 라벨도 같이 움직여야 한다');
    assert.equal(on.capacity.maxPayloadBytes, off.capacity.maxPayloadBytes,
      'turnA 가 용량을 바꾸면 버전 카드 라벨(31/62/101 B)도 같이 움직여야 한다');
  }
});

test('§3.1 turnA 는 Type A + lab 게이트 뒤에 있고 상태는 INTERNAL 이다', () => {
  assert.equal(GENERATOR_STATE_SCHEMA.turnA.defaultValue, false, 'turnA 기본값이 켬이다');
  assert.equal(createGeneratorState().turnA, false);
  const at = INDEX.indexOf('function syncTurnAUi()');
  assert.notEqual(at, -1, 'syncTurnAUi 가 없다');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  assert.match(body, /isLabPath\(\)/, 'turnA 섹션이 lab 게이트를 안 받는다');
  assert.match(body, /generatorState\.type === 'A'/, 'turnA 섹션이 Type A 게이트를 안 받는다');
  // 다른 타입에서 켜진 채 남아도 인코더까지 안 간다.
  assert.match(INDEX, /turnA: type === 'A' && generatorState\.turnA === true/);
});

test('§3.1 turnA 섹션은 타입 선택(#codeType) 바로 아래이고 sync 는 id 로 찾는다', () => {
  // 운영자 2026-08-19: 옵션 하단이 아니라 타입 선택 아래로. 게이트는 그대로.
  const typeAt = INDEX.indexOf('id="codeType"');
  const typeClose = INDEX.indexOf('</select>', typeAt);
  const turnA = INDEX.indexOf('id="turnASection"');
  const version = INDEX.indexOf('id="versionWrapO"');
  assert.ok(typeAt !== -1 && turnA !== -1 && version !== -1);
  assert.ok(typeClose < turnA && turnA < version,
    'turnASection 이 #codeType </select> 와 #versionWrapO 사이에 없다 — 다시 하단으로 내려갔나');
  // 사이에 다른 섹션 id 가 끼면 «바로 아래»가 아니다.
  const between = INDEX.slice(typeClose, turnA);
  assert.equal((between.match(/id="/g) || []).length, 0,
    '타입 선택과 실루엣 카드 사이에 다른 id 가 끼었다');
  const at = INDEX.indexOf('function syncTurnAUi()');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  assert.match(body, /els\.turnASection/, 'sync 가 id 조회가 아니라 형제 순서에 기대면 이동이 깨진다');
  assert.match(body, /section\.hidden = !\(isLabPath\(\) && generatorState\.type === 'A'\)/);
  assert.match(INDEX, /id="turnASection" hidden/);
});

// ── §5 — 오늘의 «아직 안 된다» 를 잠근다 (배선되면 빨개진다) ────────────────

function render(encoded, options = {}) {
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: options.margin,
    ...(options.finderPatternId ? { finderPatternId: options.finderPatternId } : {}),
  });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
}

test('§5 대조군: 평범한 O/A 는 라이브 경로로 왕복한다 (자를 먼저 잰다)', () => {
  assert.equal(decodeFrontend(render(encode('TLcube', { version: 1, eccLevel: 'M' }))).text,
    'TLcube', 'Type O 대조군이 깨졌다 — 아래 실패들은 대상이 아니라 자 탓일 수 있다');
  assert.equal(
    decodeFrontend(render(encodeA('TLcube', { version: 0, eccLevel: 'M' }), { margin: 20 })).text,
    'TLcube', 'Type A 대조군이 깨졌다');
});

test('§5 daehan 은 스캐너 옵트인이 켜져야 읽힌다 — 꺼짐은 실패, 켬은 성공', () => {
  const encoded = encode('TLcube', { version: 1, eccLevel: 'M', daehanFinder: true });
  const raster = render(encoded, { finderPatternId: daehanPatternId(encoded.k) });
  // 이 두 줄이 daehan 서랍을 고급 전용으로 두는 **유일한** 근거다.
  assert.equal(decodeFrontend(raster).ok, false,
    'daehan 이 옵트인 없이도 읽힌다 — 그렇다면 서랍을 일반 모드로 올려도 된다');
  assert.equal(decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } }).text, 'TLcube',
    'daehan 이 옵트인을 켜도 안 읽힌다 — 카드를 붙일 근거가 사라졌다');
});

test('§5 Type A + daehan 도 옵트인 왕복이 선다 (검출만이 아니라 decodeFrontend)', () => {
  const encoded = encodeA('TLcube', { version: 0, eccLevel: 'M', daehanFinder: true });
  const raster = render(encoded, { finderPatternId: daehanPatternId(encoded.k), margin: 20 });
  assert.equal(decodeFrontend(raster).ok, false,
    'A daehan 이 옵트인 없이도 읽힌다');
  assert.equal(decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } }).text, 'TLcube',
    'A daehan 이 옵트인을 켜도 안 읽힌다 — 배선이 검출에서 끊겼거나 회계가 갈린다');
});

test('§5 turnA 로 만든 코드는 아직 라이브 경로가 못 읽는다 (그래서 lab 뒤에 둔다)', () => {
  const result = decodeFrontend(render(encodeA('TLcube', { version: 0, eccLevel: 'M', turnA: true }), { margin: 20 }));
  assert.equal(result.ok, false,
    'turnA 왕복이 서기 시작했다 — 축하한다. 이제 이 카드를 lab 게이트 밖으로 내보내고'
    + ' index.html 의 «못 읽어요» 힌트(g575)와 turnASection 주석을 같이 고쳐라.');
});

test('§5 cornerMarker — 기하는 배선됐고 왕복은 아직 안 선다 (그래서 lab 뒤에 둔다)', () => {
  // 2026-08-20 갱신. 이 테스트는 원래 «검출기가 배선 안 됐다» 를 고정했고, 배선되면
  // «위 기대값을 다시 재라» 고 스스로 지시했다. 배선했고, 다시 쟀다. 결과:
  //
  //   ⓐ 기하 단계는 **선다** — bootstrap.directAnchorHypotheses 가 앵커 실패 시
  //      코너 마커로 넘어간다 (decoder-corner-marker-wiring.test.js, 원근 내성 약 8배).
  //   ⓑ 그런데 **왕복은 여전히 안 선다.** 이유가 바뀌었다:
  //      본문 scan order 가 레거시라서가 아니라, **와이어에 신호가 없어서**다 —
  //      `formatinfo.js` 에 `cornerMarker` 비트가 없다. `decode.js` 는
  //      `format.cornerMarker` 를 **호출자가 알려줄 때만** CM scan order 를 쓴다
  //      (decode.js:298). 라이브 경로엔 알려줄 사람이 없다.
  //
  // 그래서 daehan 이 간 길(광학 검출 → patternId → layoutForFamily)이 남은 선택지다.
  // 코너 마커도 광학으로 검출되므로 가능하지만, 그러려면 CM 검출을 fallback 밖에서도
  // 돌려야 하고 그건 «합집합» 판단이라 실측 없이 하지 않는다.
  for (const [label, result] of [
    ['O-CM', decodeFrontend(render(encode('TLcube', { version: 1, eccLevel: 'M', cornerMarker: true })))],
    ['A-CM', decodeFrontend(render(encodeA('TLcube', { version: 0, eccLevel: 'M', cornerMarker: true }), { margin: 20 }))],
  ]) {
    assert.equal(result.ok, false,
      label + ' 왕복이 서기 시작했다 — 축하한다. 이제 (a) 이 카드를 lab 게이트 밖으로 내보내고'
      + ' (b) index.html 의 «못 읽어요» 힌트(g579)와 cornerMarkerSection 주석을 같이 고쳐라.');
  }
  // 기하 배선은 **있어야 한다** — 위 ⓐ 의 근거다. 사라지면 8배 실측도 같이 사라진다.
  assert.equal(
    readFileSync(ROOT + 'src/decoder/bootstrap.js', 'utf8').includes('corner-marker-detect'),
    true, 'bootstrap 의 코너 마커 배선이 사라졌다 — decoder-corner-marker-wiring 도 같이 볼 것');
  // 와이어 신호 부재가 진짜 이유라는 것을 **값으로** 고정한다. 여기가 참인 한 왕복은 못 선다.
  assert.equal(
    readFileSync(ROOT + 'src/formatinfo.js', 'utf8').includes('cornerMarker'),
    false, 'formatinfo 에 cornerMarker 가 생겼다 — 왕복 기대값을 다시 재라');
  // UI 힌트가 그 사실을 말하는가. 라벨이 사실이 아니면 회귀보다 먼저 사람을 속인다.
  const index = readFileSync(ROOT + 'index.html', 'utf8');
  assert.match(index, /id="cornerMarkerHint"/, '힌트 문단이 없다');
  assert.match(index, /스캐너가 못 읽어요/,
    '코너 마커 힌트가 «못 읽어요» 를 말하지 않는다 — 왕복이 안 서는데 «잘 읽힌다» 고 적으면 거짓말이다');
});
