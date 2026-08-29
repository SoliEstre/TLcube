/**
 * scanner-daehan-fallback-roundtrip.test.js — 「정식 기본 동작으로 daehan 이 읽힌다」.
 *
 * 성질 하나를 잰다: **옵트인 플래그를 손으로 켜지 않고**, 정식 스캐너가 실제로 넘기는
 * bootstrap 옵션 + 폴백 정책만으로 daehan 렌더가 원문까지 복호되는가. 그리고 그 대가로
 * 레거시 경로가 흔들리지 않는가 (1차에서 성공 · 2차 패스 0회).
 *
 * ⚠ 대조군이 진단을 가른다 — daehan 렌더(A0D)와 레거시 렌더(A0)는 **같은 타입·버전·
 *   ECC·해상도**이고 차이는 daehan 파인더 하나뿐이다. 「daehan 이 읽힌다」 와 「아무거나
 *   읽힌다」 를 이 쌍이 가른다.
 *
 * ⚠ scanner.js 는 DOM 모듈이라 Node 에서 임포트할 수 없다 (scanner-state-reset.test.js
 *   와 같은 제약). 그래서 이 파일은 두 층으로 잰다:
 *     ① 행동층 — 정책 모듈 + 진짜 디코더로 2패스 루프를 돌려 성질을 잰다.
 *     ② 배선층 — scanner.js 소스 슬라이스로 그 루프가 실제로 거기 있는지 본다.
 *   ②가 없으면 ①은 「테스트 안에서만 도는 폴백」 을 초록으로 통과시킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { encodeA } from '../src/encodeA.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import {
  DAEHAN_FALLBACK_INITIAL_STATE,
  daehanFallbackDecision,
} from '../src/scanner-daehan-fallback.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

/**
 * 정식(비-/lab/) 스캐너가 넘기는 bootstrap 옵션. scanner.js `runPass` 와 같은 모양이고,
 * **cellFinderDaehan 은 인자로만 들어온다** — 여기에 true 를 박아 두면 이 테스트는
 * 「옵트인이 동작한다」 를 재게 되어 재려던 성질과 다른 것을 재게 된다.
 */
function scannerOptions(daehan) {
  return {
    bootstrap: {
      cellFinderDaehan: daehan,
      family: { cube: { enableLocatorY: false } },
    },
  };
}

/**
 * scanner.js `decodeFrame` 의 폴백 루프를 그대로 옮긴 구동기.
 * 반환에 `passes` 를 실어 «2차 패스가 실제로 돌았는가» 를 셀 수 있게 한다.
 */
function runFrame(raster, state, frameSettings = {}) {
  const passes = [];
  const runPass = (daehan) => {
    passes.push(daehan === true ? 'daehan' : 'default');
    return decodeFrontend(raster, scannerOptions(daehan));
  };

  let result = runPass(frameSettings.daehanForced === true);
  const decision = daehanFallbackDecision(state, {
    source: frameSettings.source === 'still' ? 'still' : 'live',
    firstPassOk: result && result.ok === true,
    daehanForced: frameSettings.daehanForced === true,
    usedPriorPoses: frameSettings.usedPriorPoses === true,
  });
  if (decision.escalate) {
    const escalated = runPass(true);
    if (escalated && escalated.ok === true) result = escalated;
  }
  return { result, passes, state: decision.state, escalated: decision.escalate };
}

function renderA(text, daehan) {
  const enc = encodeA(text, { version: 0, eccLevel: 'M', ...(daehan ? { daehanFinder: true } : {}) });
  const scene = buildScene(enc, {
    palette: PALETTE,
    margin: 20,
    ...(daehan ? { finderPatternId: daehanPatternId(enc.k) } : {}),
  });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
}

const DAEHAN_TEXT = 'TLcube-A-D';
const LEGACY_TEXT = 'TLcube-A';
const DAEHAN_RASTER = renderA(DAEHAN_TEXT, true);
const LEGACY_RASTER = renderA(LEGACY_TEXT, false);

// ── ① 행동층 ────────────────────────────────────────────────────────────────

test('daehan 렌더가 «기본 옵션 + 폴백» 만으로 원문까지 복호된다 (라이브 첫 프레임)', () => {
  const run = runFrame(DAEHAN_RASTER, DAEHAN_FALLBACK_INITIAL_STATE, { source: 'live' });
  assert.deepEqual(run.passes, ['default', 'daehan'],
    '패스 순서가 «1차 기본 → 2차 daehan» 이 아니다');
  assert.equal(run.result.ok, true,
    'daehan 렌더가 폴백을 거치고도 안 읽혔다: ' + (run.result.reason || ''));
  assert.equal(run.result.text, DAEHAN_TEXT);
  assert.equal(run.result.family, 'tri');
});

test('같은 렌더가 폴백 없이는 실패한다 — 폴백이 원인임을 이 대조가 잠근다', () => {
  const off = decodeFrontend(DAEHAN_RASTER, scannerOptions(false));
  assert.equal(off.ok, false,
    '1차 패스만으로 이미 읽힌다 — 위 테스트가 폴백이 아니라 딴것을 재고 있다');
  assert.equal(off.reason, 'frontend:no-format-candidate');
});

test('레거시 렌더는 1차에서 성공하고 2차 패스가 아예 안 돈다', () => {
  const run = runFrame(LEGACY_RASTER, DAEHAN_FALLBACK_INITIAL_STATE, { source: 'live' });
  assert.equal(run.result.ok, true, '레거시 대조군이 1차에서 실패했다: ' + (run.result.reason || ''));
  assert.equal(run.result.text, LEGACY_TEXT);
  assert.deepEqual(run.passes, ['default'],
    '성공한 레거시 프레임에 2차 패스가 붙었다 — 이 설계의 «비용은 실패 프레임에만» 이 깨진다');
  assert.equal(run.escalated, false);
  assert.equal(run.state.consecutiveFailures, 0, '성공 프레임이 카운터를 리셋하지 않았다');
});

test('정지(업로드) 입력도 같은 성질 — 실패 시 항상 2차 패스로 daehan 을 읽는다', () => {
  const run = runFrame(DAEHAN_RASTER, DAEHAN_FALLBACK_INITIAL_STATE, { source: 'still' });
  assert.deepEqual(run.passes, ['default', 'daehan']);
  assert.equal(run.result.text, DAEHAN_TEXT);
});

test('토글이 1차부터 daehan 을 강제하면 패스는 한 번뿐이다 (같은 원문)', () => {
  const run = runFrame(DAEHAN_RASTER, DAEHAN_FALLBACK_INITIAL_STATE,
    { source: 'live', daehanForced: true });
  assert.deepEqual(run.passes, ['daehan'], '강제 daehan 프레임이 같은 라인업을 두 번 돌았다');
  assert.equal(run.result.text, DAEHAN_TEXT);
});

// ── ② 배선층 — 위 루프가 scanner.js 안에 실재하는가 ──────────────────────────
//
// 이 단언들은 «소스 철자» 를 재므로 리팩터링에 약하다. 그래도 두는 이유: 폴백은
// 「디코더 기본 경로를 우회하는 것이 존재 이유」 라 왕복 자만으로는 배선 누락이
// 초록으로 통과한다 (①은 테스트가 직접 만든 루프를 돈다). 깨지면 고칠 곳은
// 이 정규식이 아니라 «①의 루프와 scanner.js 가 아직 같은가» 다.
//
// 허수가 아님을 확인했다 — 베이스 dd8a3fe(폴백 이전) 소스에서 아래 단언 11개 중
// **10개가 빨강**이었다. 나머지 하나(`reportLabFrame` 3회)는 성격이 다른 **회귀
// 가드**라 베이스에서도 초록인 게 맞다: 「폴백이 행을 더 만들지 않았다」 를 잠그는
// 것이라, 누군가 4번째 보고를 넣는 순간 빨개진다.

const SRC = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');

function decodeFrameBody() {
  const start = SRC.indexOf('async function decodeFrame(');
  assert.ok(start >= 0, 'scanner.js 에 decodeFrame 이 없다');
  // 경계는 **decodeFrame 바로 다음의 최상위 선언**이어야 한다. 더 뒤로 잡으면
  // flushPriorReport 의 reportLabFrame 까지 슬라이스에 들어와 아래 개수 단언이
  // 엉뚱한 것을 센다 (처음에 실제로 그랬다 — 4 !== 2).
  const end = SRC.indexOf('\nlet cachedPriorPoses', start);
  assert.ok(end > start, 'decodeFrame 뒤의 경계 선언(cachedPriorPoses)을 못 찾았다');
  return SRC.slice(start, end);
}

test('배선: decodeFrame 이 정책 모듈로 판정하고 2차 패스를 true 로 돌린다', () => {
  assert.match(SRC, /from '\/src\/scanner-daehan-fallback\.js'/,
    'scanner.js 가 폴백 정책 모듈을 임포트하지 않는다 — 분기가 어딘가에 손으로 복제됐다');
  const body = decodeFrameBody();
  assert.match(body, /daehanFallbackDecision\(/,
    'decodeFrame 이 정책 모듈을 안 부른다 — 판정이 두 곳에 적혔거나 폴백이 없다');
  assert.match(body, /runPass\(true\)/,
    '2차 패스가 daehan 라인업(true)으로 안 돈다 — 우회 자체가 성립하지 않는다');
  assert.match(body, /firstPassOk:\s*result && result\.ok === true/,
    '판정 입력 firstPassOk 가 1차 패스 결과에서 안 온다');
  assert.match(body, /usedPriorPoses:\s*Array\.isArray\(settings\.priorPoses\)/,
    '사전 포즈 패스 배타가 배선에서 빠졌다 — 라인업을 안 보는 패스에 비용만 낸다');
});

test('배선: 2차 패스는 성공했을 때만 결과를 갈아끼운다 (이월 증거 보존)', () => {
  const body = decodeFrameBody();
  assert.match(body, /if \(escalatedResult && escalatedResult\.ok === true\) result = escalatedResult/,
    '2차 실패 결과가 1차 실패 객체를 덮으면 carryHypothesis·admittedPoses 가 사라진다');
});

test('배선: 보고는 한 행이고 escalated 키가 lab body 로 간다', () => {
  const body = decodeFrameBody();
  const reports = body.match(/reportLabFrame\(/g) || [];
  assert.equal(reports.length, 3,
    'decodeFrame 의 reportLabFrame 호출이 3곳(무효 프레임 · 정상 경로 · throw 경로)이 ' +
    '아니다 — 폴백이 행을 하나 더 만들면 frameSeq 와 프레임 시간 통계가 겹쳐 센다');
  // ⚠ 이 단언이 지키는 것은 «scanner.js 가 키를 넘긴다» 까지다. 그 키가 좌석까지
  //    가는지는 **이 자가 못 지키는 축**이다 — normalizeFrameBody(명시 리터럴) ·
  //    eventRow(명시 매핑) · schema.sql(명시 컬럼)이 각자 모르는 키를 떨구고, 셋 다
  //    이 레인의 쓰기 범위 밖이다. 덮는 방법: 세 층을 열고 relay 왕복으로 재는 자를
  //    거기 두는 것 (통합자·좌석 몫). 여기서 초록이어도 «좌석에 도달한다» 는 아니다.
  assert.match(body, /reportLabFrame\(imageData, result, ms, stage, \{ escalated \}\)/,
    'escalated 키가 lab frame body 호출로 안 간다 — 세 층이 열려도 스캐너가 안 보낸다');
  assert.match(SRC, /\.\.\.\(extra && typeof extra === 'object' \? extra : \{\}\)/,
    'reportLabFrame 이 추가 키를 body 에 안 얹는다');
});

test('배선: 업로드 경로만 still 이고, 카운터는 시도 경계에서 리셋된다', () => {
  assert.match(SRC, /decodeFrame\(imageData, \{ source: 'still' \}\)/,
    '업로드 경로가 still 로 안 들어간다 — 사진 한 장이 라이브 스로틀에 걸린다');
  const attempt = SRC.slice(SRC.indexOf('function beginScanAttempt'));
  assert.match(attempt.slice(0, attempt.indexOf('\nfunction ', 10)),
    /daehanFallbackState = DAEHAN_FALLBACK_INITIAL_STATE/,
    '시도 경계에서 연속 실패 카운터가 안 지워진다 — 새 시도 첫 실패가 남의 횟수를 상속한다');
});
