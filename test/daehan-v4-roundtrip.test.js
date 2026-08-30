/**
 * daehan-v4-roundtrip.test.js — V4D(daehan × V4, k=12) 개방의 끝단 왕복 자 (2026-08-30).
 *
 * 잠그는 성질 셋:
 *   ① **정식 폴백 경로** — 옵트인 플래그를 손으로 켜지 않고, 정식 스캐너가 넘기는
 *      bootstrap 옵션 + 폴백 정책만으로 V4D 렌더가 원문까지 복호된다. 대조군(같은
 *      버전·ECC 의 평 V4)은 1차에서 성공하고 2차 패스가 안 돈다 —
 *      scanner-daehan-fallback-roundtrip(A 계열)과 같은 정형의 k=12 행이다.
 *   ② **사괘 단독 × V4** — C2c 분해(중앙 cell-mask ∥ sagoae 고리 검증) 경로가 k=12
 *      에서도 선다. 특히 `sagoaeVerified` 스탬프가 **프레임 k=12** 로 찍혀야 회계가
 *      열린다 (검증 고리는 k10 완전판과 동일 60셀이지만, 스탬프를 10 으로 찍으면
 *      엄밀 일치 게이트가 영영 안 열리는 침묵 실패 — sagoae-verify 클램프 참조).
 *   ③ 성공 자체가 회계의 증명이다 — V4D 프레임을 평 V4 회계로 읽으면 예약 60셀이
 *      데이터인 척 섞여 RS 가 거절한다 (misread 실측 27/27 —
 *      test/output/lanes/claude-v4d-misread.mjs). 그러므로 원문 복호 = daehan 회계 사용.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCellFinders } from '../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { FINDER_CELL_MASK_PATTERNS } from '../src/finder-patterns.js';
import {
  OAK_FINDER_PATTERNS, OAK_RENDER_ONLY_FINDER_PATTERNS,
} from '../src/finder-oak-patterns.js';
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

/** 정식(비-/lab/) 스캐너가 넘기는 bootstrap 옵션 — scanner.js `runPass` 와 같은 모양. */
function scannerOptions(daehan) {
  return {
    bootstrap: {
      cellFinderDaehan: daehan,
      family: { cube: { enableLocatorY: false } },
    },
  };
}

/** scanner.js `decodeFrame` 폴백 루프의 구동기 (scanner-daehan-fallback-roundtrip 정형). */
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

function renderO(text, options, finderPatternId) {
  const enc = encode(text, options);
  const scene = buildScene(enc, {
    palette: PALETTE,
    ...(finderPatternId ? { finderPatternId } : {}),
  });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
}

const V4D_TEXT = 'TLcube-V4D';
const V4_TEXT = 'TLcube-V4';

// ── ① 정식 폴백 경로 ────────────────────────────────────────────────────────

test('V4D 렌더가 «기본 옵션 + 폴백» 만으로 원문까지 복호된다 (라이브 첫 프레임)', () => {
  const enc = encode(V4D_TEXT, { version: 4, eccLevel: 'M', daehanFinder: true });
  assert.equal(enc.k, 12);
  const raster = renderO(V4D_TEXT, { version: 4, eccLevel: 'M', daehanFinder: true },
    daehanPatternId(enc.k));
  const run = runFrame(raster, DAEHAN_FALLBACK_INITIAL_STATE, { source: 'live' });
  assert.deepEqual(run.passes, ['default', 'daehan'],
    '패스 순서가 «1차 기본 → 2차 daehan» 이 아니다');
  assert.equal(run.result.ok, true,
    'V4D 렌더가 폴백을 거치고도 안 읽혔다: ' + (run.result.reason || ''));
  assert.equal(run.result.text, V4D_TEXT);
  assert.equal(run.result.hypothesis.family, 'hex');
  assert.equal(run.result.hypothesis.k, 12, 'RS 가 k=12 를 안 골랐다');
  assert.match(run.result.hypothesis.id, /oak-daehan-k/,
    '이긴 가설이 daehan 파인더 증거가 아니다: ' + run.result.hypothesis.id);
  assert.equal(run.result.diagnostics.format.formatIndex, 3,
    'V 인덱스 공유(V4=3)가 아니라 다른 값이 소비됐다');
});

test('같은 V4D 렌더가 폴백 없이는 실패한다 — 폴백이 원인임을 이 대조가 잠근다', () => {
  const enc = encode(V4D_TEXT, { version: 4, eccLevel: 'M', daehanFinder: true });
  const raster = renderO(V4D_TEXT, { version: 4, eccLevel: 'M', daehanFinder: true },
    daehanPatternId(enc.k));
  const off = decodeFrontend(raster, scannerOptions(false));
  assert.equal(off.ok, false,
    '1차 패스만으로 이미 읽힌다 — 위 테스트가 폴백이 아니라 딴것을 재고 있다');
});

test('평 V4 대조군은 1차에서 성공하고 2차 패스가 아예 안 돈다', () => {
  const raster = renderO(V4_TEXT, { version: 4, eccLevel: 'M' });
  const run = runFrame(raster, DAEHAN_FALLBACK_INITIAL_STATE, { source: 'live' });
  assert.equal(run.result.ok, true, '평 V4 대조군이 1차에서 실패했다: ' + (run.result.reason || ''));
  assert.equal(run.result.text, V4_TEXT);
  assert.deepEqual(run.passes, ['default'],
    '성공한 평 V4 프레임에 2차 패스가 붙었다 — «비용은 실패 프레임에만» 이 깨진다');
});

// ── ② 사괘 단독 × V4 (C2c 분해) ────────────────────────────────────────────

// 원자 daehan 패턴을 뺀 중앙 검출 명부 — 성공 경로가 반드시 C2c `*-sagoae` 가설이다.
const LINEUP_NO_ATOMIC = Object.freeze([
  ...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, ...OAK_RENDER_ONLY_FINDER_PATTERNS,
]);
const CENTRAL_INDEPENDENT = 'oak-aspirin';

test('사괘 단독 × V4 — C2c 분해 경로가 k=12 에서 원문까지 돈다 (스탬프 = 프레임 k)', () => {
  const text = 'SAGOAE-V4';
  const encoded = encode(text, { version: 4, eccLevel: 'M', sagoae: true });
  assert.equal(encoded.daehanFinder, true, '사괘가 daehan 예약 회계 신호를 안 열었다');
  const raster = renderO(text, { version: 4, eccLevel: 'M', sagoae: true }, CENTRAL_INDEPENDENT);
  const luma = toRelativeLuminance(raster, {});
  const detected = detectCellFinders(luma, LINEUP_NO_ATOMIC, {
    centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }],
  });
  assert.equal(detected.ok, true, '합성 장면에서 중앙 cell-mask 를 못 찾았다');
  const central = detected.candidates.find((c) => c.patternId === CENTRAL_INDEPENDENT);
  assert.ok(central, '원자 제외 명부에서 중앙 파인더 증거가 없다');
  const result = decodeFrontend(raster, {
    familyEvidence: { finders: [central] },
    bootstrap: { cellFinderDaehan: true },
  });
  assert.equal(result.ok, true, result.reason || '');
  assert.equal(result.text, text);
  assert.equal(result.hypothesis.k, 12);
  assert.match(result.hypothesis.id, /-sagoae$/,
    '원자 daehan 경로가 분해 합성 C2c 검증을 대신했다: ' + result.hypothesis.id);
  assert.equal(result.diagnostics.format.formatIndex, 3);
});
