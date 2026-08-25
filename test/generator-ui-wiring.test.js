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
// 편집기 대조는 **렌더 표현 전부**를 돈다 (2026-08-23 W2) — 렌더 전용
// oak-taegeuk-solo 포함. 편집기가 그리는 축은 렌더이지 검출 편입이 아니다.
import { OAK_ALL_FINDER_PATTERNS, OAK_LEVEL_FACE_INDEX } from '../src/finder-oak-patterns.js';
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
  for (const pattern of OAK_ALL_FINDER_PATTERNS) {
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
  const before = JSON.stringify(OAK_ALL_FINDER_PATTERNS.map((p) => p.cellLevels));
  const state = createUniversalEditorState({ type: 'O', size: 6 });
  applyFinderStarter(state, OAK_ALL_FINDER_PATTERNS[0].id);
  state.finderPattern.cellLevels[0][0] = (state.finderPattern.cellLevels[0][0] + 1) % 3;
  assert.equal(JSON.stringify(OAK_ALL_FINDER_PATTERNS.map((p) => p.cellLevels)), before,
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
  // 이 배선이 없으면 79셀을 그려 놓고 legacy 용량을 표시한다.
  //
  // ⚠ 2026-08-20: 원래 이 단언은 **소스 한 줄을 문자 그대로** 잡았다
  //   (`...finderPatternId)) opts.daehanFinder = true`). 그러다 daehan × 중앙 QR
  //   배타 가드(`&& !opts.centerQr`)가 들어가자 그 줄이 갈라져 빨개졌다 — 배선은
  //   멀쩡한데 **문자열이 안 맞아서** 실패한 것이다. 그래서 «조건과 대입이 같은
  //   분기 안에 있다» 로 느슨하게 잰다. 가드가 하나 더 붙어도 배선은 계속 잠긴다.
  const daehanBranch = INDEX.slice(INDEX.indexOf('function encodeOptsFor'));
  const oBranch = daehanBranch.slice(0, daehanBranch.indexOf('function ', 10));
  assert.match(oBranch, /isDaehanFinderPatternId\(cfg\.finderPatternId\)/,
    'encodeOptsFor 가 파인더 id 로 daehan 을 판별하지 않는다');
  assert.match(oBranch, /opts\.daehanFinder = true/,
    'daehanFinder 를 인코더 옵션으로 안 넘긴다 — 79셀을 그리고 legacy 용량을 표시하게 된다');
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

// **의도적 갱신 (2026-08-24 정식 승격)** — 구 락은 «lab 게이트 뒤 + INTERNAL» 이었다.
// 그 근거(라이브 0/3 · 검출 미배선)가 Wave 3 ①②로 닫히고 운영자 실기기 인식이
// 확인돼, lab 게이트를 걷고 BOTH 로 승격했다. 락은 삭제가 아니라 **양성 단언 전환**이다.
test('§3.1 turnA 는 Type A 게이트만 받고 상태는 BOTH(정식 노출)다', () => {
  assert.equal(GENERATOR_STATE_SCHEMA.turnA.defaultValue, false, 'turnA 기본값이 켬이다');
  assert.equal(GENERATOR_STATE_SCHEMA.turnA.exposure, 'both',
    'turnA 가 정식 노출(BOTH)이 아니다 — 2026-08-24 승격의 회귀');
  assert.equal(createGeneratorState().turnA, false);
  const at = INDEX.indexOf('function syncTurnAUi()');
  assert.notEqual(at, -1, 'syncTurnAUi 가 없다');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  assert.doesNotMatch(body, /isLabPath\(\)/,
    'turnA 섹션에 lab 게이트가 되살아났다 — 정식 승격의 회귀');
  assert.match(body, /generatorState\.type !== 'A'/, 'turnA 섹션이 Type A 게이트를 안 받는다');
  // 다른 타입에서 켜진 채 남아도 인코더까지 안 간다.
  assert.match(INDEX, /turnA: type === 'A' && generatorState\.turnA === true/);
});

test('§3.1 turnA 섹션은 공용 컨트롤(양쪽 모드)의 #finderSection 앞이고 sync 는 id 로 찾는다', () => {
  // **의도적 갱신 (2026-08-24 정식 승격)** — 구 위치는 #panelAdvanced 안(타입 선택
  // 바로 아래)이라 **고급에서만** 보였다. 운영자 «일반 쪽에도» 지시로 공용 컨트롤
  // (#sharedControls — 두 모드가 함께 그리는 영역)의 검출기 선택 앞으로 옮겼다.
  const sharedAt = INDEX.indexOf('id="sharedControls"');
  const turnA = INDEX.indexOf('id="turnASection"');
  const finder = INDEX.indexOf('id="finderSection"');
  assert.ok(sharedAt !== -1 && turnA !== -1 && finder !== -1);
  assert.ok(sharedAt < turnA && turnA < finder,
    'turnASection 이 sharedControls 안 #finderSection 앞이 아니다 — 한쪽 모드에서 사라진다');
  // 상태 축도 그 영역의 메타데이터에 있어야 한다 (노출 대조의 단일 규약).
  assert.match(INDEX, /<div id="sharedControls" data-state-keys="turnA /,
    'sharedControls 의 data-state-keys 에 turnA 가 없다 — 노출 대조가 어긋난다');
  const at = INDEX.indexOf('function syncTurnAUi()');
  const body = INDEX.slice(at, INDEX.indexOf('\n}', at));
  assert.match(body, /els\.turnASection/, 'sync 가 id 조회가 아니라 형제 순서에 기대면 이동이 깨진다');
  assert.match(body, /section\.hidden = generatorState\.type !== 'A'/);
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

test('§5 turnA — 왕복이 선다 (역삼각 기하 + V 인덱스, 2026-08-24)', () => {
  // 2026-08-24 뒤집어서 갱신 (지우지 않았다 — G 배선 §5 전례). 이 테스트는
  // «못 읽는다» 를 고정하고 있었고, 배선되면 기대값을 뒤집고 g575 힌트를 같이
  // 고치라고 스스로 지시했다. 배선했다:
  //   ⓐ 기하 — scene.js turnA 분기 (배치 180° 회전 · 셀 정립 → 실루엣 ▽).
  //   ⓑ 검출 — anchor-detect turn 변형(반전 꼭짓점, 100% 배타) + qr-center turn 쌍둥이.
  //   ⓒ 와이어 — bootstrap validVersionIndices 가 turn 가설에 V 표 인덱스를 열고
  //      decodeFormat.turn 으로 decode.js:390 분기(2026-08-18 준비분)를 부른다.
  // 6종(V0..V2 × ±Q) 전수 왕복·교차 오수용 0 은 test/turnA-roundtrip.test.js 가 잰다.
  // ⚠ lab 게이트는 **유지** — 합성만으로 정식 노출을 정하지 않는다 (운영자 확정
  //   2026-08-23·24 seat 전례). 승격은 실기기 라운드 뒤 운영자 몫.
  const result = decodeFrontend(render(encodeA('TLcube', { version: 0, eccLevel: 'M', turnA: true }), { margin: 20 }));
  assert.equal(result.ok, true,
    'turnA 왕복이 다시 죽었다 — 기하(scene turnA)·검출(anchor turn)·와이어(V 개방)'
    + ' 세 층 중 어느 쪽이 끊겼는지 test/turnA-roundtrip.test.js 와 같이 보라: '
    + result.reason);
  assert.equal(result.text, 'TLcube', 'turnA 페이로드 불일치');
});

test('§5 cornerMarker — 왕복이 선다 (내부 타입 G 와이어, 2026-08-20)', () => {
  // 2026-08-20 재갱신. 이 테스트는 «왕복이 안 선다» 를 고정하고 있었고, 배선되면
  // 기대값을 뒤집고 g579 힌트를 같은 변경에서 고치라고 스스로 지시했다. 배선했다:
  //
  //   ⓐ 기하 — bootstrap.directAnchorHypotheses 가 앵커 실패 시 코너 마커로
  //      넘어간다 (decoder-corner-marker-wiring.test.js, 원근 내성 약 8배). 유지.
  //   ⓑ 와이어 — 「신호가 없다」가 원인이었고, 신호는 **비트가 아니라 값**으로
  //      생겼다: 내부 타입 G 전용 formatIndex (`src/markerG.js` 표 주도, 턴A 전례,
  //      운영자 확정 2026-08-20). 인코더(encode/encodeA)가 G 인덱스를 싣고,
  //      디코더(bootstrap→decodeCells)는 포맷 워드의 그 값으로 `format.cornerMarker`
  //      를 켠다 (decode.js:298·:365 의 기존 분기 — 호출자가 생겼다).
  //
  // daehan 식 «광학 검출 → 합집합 배선» 은 필요 없어졌다 — 판별이 와이어에 있다.
  // 6항목(O V1..3 · A0..2) 전수 왕복·무경합·변이 검증은 test/markerG.test.js 가 잰다.
  for (const [label, result] of [
    ['O-CM', decodeFrontend(render(encode('TLcube', { version: 1, eccLevel: 'M', cornerMarker: true })))],
    ['A-CM', decodeFrontend(render(encodeA('TLcube', { version: 0, eccLevel: 'M', cornerMarker: true }), { margin: 20 }))],
  ]) {
    assert.equal(result.ok, true,
      label + ' 왕복이 다시 죽었다 — 양 끝(인코더 G 인덱스 · bootstrap 의 cornerMarker'
      + ' 전달) 중 어느 쪽이 끊겼는지 test/markerG.test.js ④ 와 같이 보라.');
    assert.equal(result.text, 'TLcube', label + ' 페이로드 불일치');
  }
  // 기하 배선은 **있어야 한다** — 위 ⓐ 의 근거다. 사라지면 8배 실측도 같이 사라진다.
  assert.equal(
    readFileSync(ROOT + 'src/decoder/bootstrap.js', 'utf8').includes('corner-marker-detect'),
    true, 'bootstrap 의 코너 마커 배선이 사라졌다 — decoder-corner-marker-wiring 도 같이 볼 것');
  // 와이어 신호는 **전용 formatIndex 값**이지 포맷 워드의 새 비트가 아니다 — 예비
  // 비트(RESERVED_BITS_V2) 우회는 hex 링 3 의 «15 포맷 + 2 레퍼런스» 계약을 깨서
  // 기각됐다 (운영자 결정). formatinfo 에 cornerMarker 가 생기면 그 기각을 되살린 것이다.
  assert.equal(
    readFileSync(ROOT + 'src/formatinfo.js', 'utf8').includes('cornerMarker'),
    false, 'formatinfo 에 cornerMarker 가 생겼다 — 기각된 예비 비트 우회를 되살렸는지 보라');
  // UI 힌트가 새 사실을 말하는가. 라벨이 사실이 아니면 회귀보다 먼저 사람을 속인다.
  // (W2 C4: #cornerMarkerSection → 내곽/외곽 seat 구역 — 힌트는 innerSeatHint(g579)
  //  가 승계했다. generator-corner-marker.test.js ① 이 구역 구조를 잰다.)
  const index = readFileSync(ROOT + 'index.html', 'utf8');
  assert.match(index, /id="innerSeatHint"/, '힌트 문단이 없다');
  assert.doesNotMatch(index, /코드를 스캐너가 못 읽어요 — 표식이/,
    '코너 마커 힌트가 아직 «못 읽어요» 를 말한다 — 왕복이 서는데 «못 읽는다» 고 적으면 거짓말이다');
  // **의도적 갱신 (2026-08-25)** — 구 락은 **어순**을 잠갔다(«스캐너가 읽어요 — 표식이
  // 있다는 사실이»). 자리 개편으로 힌트가 다시 쓰이면서 같은 주장이 순서만 바뀌어
  // 빨개졌다. 잠글 것은 문장이 아니라 **주장 둘**이다: ① 포맷 자리에 적힌다 ②
  // 스캐너가 읽는다. 어순을 잠그면 문구를 손볼 때마다 거짓 빨강이 난다.
  const innerHint = index.slice(index.indexOf('id="innerSeatHint"'), index.indexOf('id="innerSeatHint"') + 400);
  assert.match(innerHint, /코드의 포맷 자리에/, '코너 마커 힌트(g579)가 포맷 자리 기록을 안 말한다');
  assert.match(innerHint, /스캐너가 그대로 읽어요|스캐너가 읽어요/,
    '코너 마커 힌트(g579)가 «읽어요» 를 말하지 않는다');
});

// ── Type K 생성기 편입 (2026-08-25) ──────────────────────────────────────────
// 운영자 보고: 「타입 K도 아직 안 된 것 같고」. 실제로 카드가 DOM 에 없었고,
// 상태 스키마·타입 목록·인코더 디스패치가 전부 K 를 몰랐다.
//
// ⚠ 이 파일이 정규식으로 index.html 을 재는 이유: 「초록 테스트는 동작하는 UI 가
//   아니다」를 이 프로젝트에서 여러 번 밟았다. 상태층만 재면 «상태는 K 인데 화면엔
//   카드가 없고 인코더는 O 를 뱉는» 상태가 초록으로 통과한다.
test('Type K 생성기 편입 — 카드·버전축·인코더 디스패치가 **셋 다** 서 있다', () => {
  const index = readFileSync(ROOT + 'index.html', 'utf8');

  // ① 카드 — 일반·고급 **두 벌**. 한 벌만 있으면 모드에 따라 사라진다.
  const cards = index.match(/data-type="K"/g) || [];
  assert.equal(cards.length, 2,
    'Type K 카드가 ' + cards.length + '벌이다 — 일반(#typeCards)·고급(#typeCardsAdvanced) 둘 다 필요하다');

  // ② 버전 축 — K 는 VERSIONS_K(0/1/2)를 쓴다. O(1/2/3)를 빌려 쓰면 한 칸 어긋난다.
  assert.match(index, /<select id="versionK">/, 'K 버전 셀렉터가 없다');
  assert.match(index, /els\.versionWrapK\.style\.display = isK \?/,
    'K 버전 표 스위칭이 없다 — 고급 모드에서 O 표가 열린 채로 남는다');
  assert.match(index, /generatorState\.versionK/,
    'buildConfig·편집기가 versionK 를 안 읽는다');
  assert.doesNotMatch(index, /const chosen = triLike \? generatorState\.versionA : generatorState\.versionO;/,
    'cellEditorHexSize 가 아직 K 에 versionO 를 먹인다 (O 1/2/3 vs K 0/1/2 — 한 칸 어긋남)');

  // ③ 인코더 디스패치 — «카드는 있는데 O 프레임이 나오는» 상태를 막는다.
  assert.match(index, /import \{ encodeK \} from '\.\/src\/encodeK\.js';/,
    'index.html 이 encodeK 를 import 하지 않는다 — K 를 골라도 encode(O)로 떨어진다');
  assert.match(index, /if \(cfg\.type === 'K'\) \{/, 'encodeOptsFor 에 K 분기가 없다');
  assert.match(index, /return \{ fn: encodeK, opts \};/, 'K 분기가 encodeK 를 안 돌려준다');

  // ④ 배타 — encodeK 가 던지는 넷이 UI 에서 만들어지면 안 된다.
  //    (조합 전수는 test/generator-exclusion-matrix.test.js 의 K 절이 잰다.)
  // **의도적 갱신 (2026-08-25 저녁, 레인 KEX)** — 구 락은 「K 는 안쪽 QR 자체가 불가」를
  // 잠갔고, 그 사유는 「encodeK 가 centerQr 를 던진다」였다. 그런데 그 던짐은 **타입
  // 계약이 아니라 «배치 검증 미실시» 배타**였고, 재 보니 열렸다: 중앙 19셀 슬롯이
  // K 코어에도 그대로 있고 전 k 에서 데이터 셀과 교집합이 0 이라 회계가 안 바뀐다.
  // 그래서 잠금을 걷고, **되돌아오지 않는지**를 양성으로 잠근다.
  assert.doesNotMatch(index, /const typeRejectsCentreQr = currentType\(\) === 'K';/,
    'K 의 안쪽 QR 잠금이 부활했다 — 중앙 슬롯은 2026-08-25 에 개설됐다 (레인 KEX)');
  assert.match(index, /if \(cfg\.fallback\.mode === 'center'\) opts\.centerQr = true;/,
    'K 분기가 centerQr 를 인코더에 안 넘긴다 — 카드만 열고 와이어는 안 여는 상태');
  assert.match(index, /else if \(isCentralV0FinderPatternId\(cfg\.finderPatternId\)\) opts\.centralV0 = true;/,
    'K 분기가 centralV0 를 인코더에 안 넘긴다');
  // **의도적 갱신 2회 (2026-08-25 하루 안에)** — 거부 → 허용 → **다시 거부**다.
  // ① finderPatternId 를 배선하고 재보니 대부분 스캔이 안 돼 허용 목록으로 좁혔고,
  // ② 같은 날 레인 POSE 가 star 독립 검출을 열어(54/54) 그 사유가 사라져 철회했다.
  // 지금 남는 차단은 **인코더가 실제로 던지는 것**뿐이다 (encodeK §옵션 배타).
  // 왕복 근거는 test/typeK-generator-finder.test.js 가 든다.
  // 남는 배타는 **daehan 하나**다 (2026-08-25 KEX 이후). 게이트 자체는 유지한다 —
  // 술어가 사라지면 daehan 카드가 K 에서 열리고 encodeK 가 첫 클릭에 던진다.
  assert.ok(index.includes('const K_BLOCKED_FINDER_IDS = typeK'),
    'K 배타 게이트가 없다 — encodeK 가 던지는 daehan 조합이 카드로 열린다');

  // ⑤ **K-CM 개설 (2026-08-25 저녁, 레인 KCM)** — 구 락은 「아직 잠겨 있어야 한다」였다.
  //    사유(bootstrap 이 star formatIndex 8 을 안 연다)가 해소됐으므로 양성으로 뒤집는다:
  //    이제 **안 실으면** 「카드는 켜지는데 와이어엔 없는」 상태가 된다.
  //    근거는 typeK-roundtrip 의 K0CM/K1CM/K2CM 전수 왕복이다.
  // 창이 120 자였는데 2026-08-25 KEX 가 centerQr·centralV0 두 줄을 그 사이에 끼워
  // 넣어 거짓 빨강이 났다. 창은 «같은 분기 안인가» 를 재는 도구이지 줄 간격 계약이
  // 아니므로, 분기 하나가 들어갈 만큼 넓힌다.
  assert.match(index, /opts\.cornerMarker = true;[\s\S]{0,400}encodeK/,
    'K 분기가 cornerMarker 를 안 싣는다 — 자리를 열어 놓고 인코더에 안 넘기면 무동작이다');
  assert.match(index, /type === 'K' && generatorState\.outerSeat === 'k-cm'/,
    'buildConfig 이 K 의 k-cm 자리를 cornerMarker 로 파생하지 않는다');
});
