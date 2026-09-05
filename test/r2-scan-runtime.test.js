/**
 * r2-scan-runtime.test.js — **S5 배선의 착지 조건.**
 *
 * PM/029B §22·§23.6 이 S5 커밋의 게이트로 못박은 셋 + 배선 안전 성질 하나.
 *
 *   ⓐ `(n, layoutId)` 가 바뀌면 **세션을 다시 만든다** — 틀린 격자 위 누적은 되사올
 *      수 없고, 재생성이 0.013\~0.017 ms 라 relayout API 가 필요 없다 (§22.1).
 *   ⓑ 포맷 미해결을 `found = 0` 으로 표현하지 **않는다** — 그러면 `clearLock` 이
 *      `alignInto` 안에만 있어 잘못된 락이 영구 동결된다 (§21.3 F1, 닫힌 고리).
 *   ⓒ 후보 수를 `finalLayoutIdsForN` 에서 **유도**한다 — 상수로 박으면 n=13(후보 1개)이
 *      쓸데없이 비싸진다 (§23.6.1).
 *   ⓓ **플래그가 꺼져 있으면 아무 일도 하지 않는다** — 정식 경로의 제어 흐름 불변.
 *
 * ⚠ 이 파일이 못 재는 축: 라이브 프레임률·손떨림·grab 비용. 브라우저 밖이다.
 * 실물 거동은 `tools/r2-runtime-probe.mjs` 가 코퍼스로 잰다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createR2ScanRuntime, r2HitToDecodeResult, R2_CAPABILITIES } from '../src/r2-scan-runtime.js';
import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { R2_INDICATOR, R2_SESSION_STATUS } from '../src/r2/session.js';
import { normalizeDecodePayload, scanScopeCopyKey } from '../src/scanner-scan-assist.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';
import { finalLayoutIdsForN, versionForFinalN } from '../src/cellSurfaceFinal.js';
import { CONFIRM_STATE, confirmationRows, progressNote } from '../src/r2-confirmation-model.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function firstFrames(name, count) {
  const seq = listLumaSequences().find((s) => s.name.split('/').pop() === name);
  if (!seq || !seq.frames.length) return null;
  return seq.frames.slice(0, count).map((f) => readLumaDump(f.path));
}

test('ⓓ 플래그가 꺼져 있으면 아무 일도 하지 않는다', () => {
  const runtime = createR2ScanRuntime({ enabled: false });
  assert.equal(runtime.enabled, false);
  // 프레임을 밀어도 세션을 만들지 않는다 — 정식 경로에서 이것이 곧 «불변» 이다.
  const fake = { width: 4, height: 4, data: new Float32Array(16) };
  for (let i = 0; i < 5; i += 1) {
    assert.equal(runtime.pushFrame(fake, i * 33), null);
  }
  assert.equal(runtime.stats.frames, 0, '꺼져 있는데 프레임을 셌다');
  assert.equal(runtime.stats.binds, 0, '꺼져 있는데 세션을 만들었다');
});

test('ⓒ 후보 수는 finalLayoutIdsForN 에서 유도된다 — n=13 은 1개, n=21·25 는 5개', (t) => {
  // 먼저 자 자신을 검증한다: 유도가 무너지면 아래 단언이 공허해진다.
  assert.equal(finalLayoutIdsForN(13).length, 1,
    'n=13 의 후보가 1개가 아니다 — 라인업이 바뀌었거나 유도가 죽었다');
  assert.ok(finalLayoutIdsForN(21).length >= 3, 'n=21 후보가 3개 미만이다');

  const frames = firstFrames('y0', 3);
  if (!frames) { t.skip('휘도 덤프 없음 — 통합자 기기에서만 돈다'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  assert.equal(runtime.stats.lockedN, 13, `y0 에서 락 n 이 ${runtime.stats.lockedN} 이다`);
  assert.equal(runtime.stats.candidateCount, 1,
    `n=13 인데 후보를 ${runtime.stats.candidateCount}개 만들었다 — 후보 수가 상수로 박혔다. `
    + 'n=13 은 라인업에 v0 하나뿐이라 병렬이 순손해다');
});

test('ⓒ-b n=21·25 에서는 후보를 여럿 만든다 (레이아웃이 본문 RS 로만 갈리므로)', (t) => {
  const frames = firstFrames('y2', 3);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  assert.equal(runtime.stats.lockedN, 25, `y2 에서 락 n 이 ${runtime.stats.lockedN} 이다`);
  assert.equal(runtime.stats.candidateCount, finalLayoutIdsForN(25).length,
    '후보 수가 라인업과 다르다 — 유도가 아니라 손 목록을 쓰고 있다');
});

test('ⓐ 실물 시퀀스에서 참 격자가 이기고, 글자가 정답이다', (t) => {
  const frames = firstFrames('y2', 12);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  let hit = null;
  for (let i = 0; i < frames.length && hit === null; i += 1) {
    hit = runtime.pushFrame(frames[i], i * 100);
  }
  assert.ok(hit !== null,
    '12프레임 안에 아무 후보도 못 풀었다 — 실측은 f4 다 (tools/r2-runtime-probe.mjs)');
  assert.equal(hit.layoutId, 'v0tr',
    `이긴 격자가 ${hit.layoutId} 다. 참값은 v0tr 이고, 틀린 격자가 이기면 `
    + '「먼저 복호되는 쪽 채택」 이라는 이 설계의 전제가 무너진다');
  assert.equal(hit.text, 'https://tl.estre.so', '글자가 정답이 아니다');
});

test('ⓑ 배선이 R2 결과를 R1 과 **같은 문**으로 보내고, 플래그 off 에서 grab 도 안 한다', () => {
  // scanner.js 는 브라우저 모듈이라 소스로 잰다 (집안 선례: centre-window-contract).
  const source = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  const start = source.indexOf('if (r2Runtime.enabled) {');
  assert.ok(start > 0, 'scanner.js 에 R2 블록이 없다 — 배선이 지워졌다');
  const block = source.slice(start, start + 1600);

  // grab 이 **블록 안**에 있어야 플래그 off 에서 비용이 0 이다.
  assert.ok(/grabVideoFrame\(/.test(block),
    'R2 블록이 자기 grab 을 안 한다 — R1 의 grab 을 공유하면 플래그 off 에서도 '
    + '정식 경로의 타이밍이 달라진다');
  // 결과는 R1 과 같은 문으로 나가야 한다 — 새 표시 경로를 만들면 두 경로가 어긋난다.
  assert.ok(/handleDecodeResult\(/.test(block),
    'R2 결과가 handleDecodeResult 를 안 거친다 — 표시 경로가 갈라진다');

  // 🔴 ⓑ 의 핵심: R2 블록이 `isDecoding` 게이트 **밖**이어야 한다.
  const r2At = start;
  const r1At = source.indexOf('if (!isDecoding && timestamp - lastDecodeAt >= intervalMs) {');
  assert.ok(r1At > 0, 'R1 게이트를 못 찾았다');
  assert.ok(r2At < r1At,
    'R2 블록이 `!isDecoding` 게이트 «안» 이거나 뒤에 있다. 그러면 R2 가 카메라 '
    + '프레임당이 아니라 **단발 복호 1사이클당** 한 장을 받고, 누적기가 단발보다 '
    + '프레임을 더 볼 방법이 구조적으로 사라진다 (PM/029 §6.5.1 의 S2 탈락 사유)');
});

test('ⓔ 런타임 중 껐다 켤 수 있고, 끌 때 누적을 버린다', (t) => {
  const frames = firstFrames('y2', 4);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  assert.ok(runtime.stats.candidateCount > 0, '켠 상태에서 후보가 안 생겼다');

  runtime.setEnabled(false);
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.stats.candidateCount, 0,
    '껐는데 후보가 남았다 — 껐다 켰을 때 옛 누적으로 풀리면 A/B 가 오염된다');
  assert.equal(runtime.stats.progressD, 0, '껐는데 진행률이 남았다 — 막대가 거짓말한다');

  // 꺼진 동안에는 프레임을 세지 않는다.
  const before = runtime.stats.frames;
  runtime.pushFrame(frames[0], 9999);
  assert.equal(runtime.stats.frames, before, '꺼져 있는데 프레임을 셌다');
});

test('ⓕ 시험판 UI — 토글과 진행 인디케이터가 배선돼 있다', () => {
  const html = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  // 운영자 요구 (2026-09-04): R1/R2 토글 + 좌하단 «채워져 가는» 인디케이터.
  assert.ok(html.includes('id="engine-switch-control"'), '엔진 스위치 마크업이 없다');
  assert.ok(html.includes('id="r2-progress"'), '진행 인디케이터 마크업이 없다');
  assert.ok(js.includes('r2Runtime.setEnabled('), '토글이 런타임을 못 끈다');
  assert.ok(js.includes('renderR2Progress()'), '진행 인디케이터를 아무도 안 그린다');
  // 🔴 인디케이터는 **매 프레임** 갱신돼야 한다 — 토글에서만 그리면 스캔 중에 안 움직인다.
  const blockAt = js.indexOf('if (r2Runtime.enabled) {');
  assert.ok(blockAt > 0);
  const block = js.slice(blockAt, blockAt + 1800);
  assert.ok(block.includes('renderR2Progress()'),
    '프레임 루프의 R2 블록이 인디케이터를 안 그린다 — 스캔 중에 막대가 멈춰 있다');
});

test('ⓖ 우하단 셀맵 뷰 — 선두 후보의 셀맵과 세 면 사영 좌표를 내보내고, 좌표는 프레임 안이며 **붕괴하지 않는다**', (t) => {
  const frames = firstFrames('y2', 4);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  const view = runtime.view;
  assert.ok(view.cellCount > 0, '락 뒤에도 셀 수가 0 — 뷰가 안 채워진다');
  assert.ok(view.cellMap && view.cellMap.length >= view.cellCount, '셀맵이 없다');
  assert.ok(view.cellFaceCentres && view.cellFaceCentres.length >= view.cellCount * 6, '세 면 좌표 버퍼가 작다');
  assert.equal(view.frameWidth, frames[0].width);
  let finite = 0;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let p = 0; p < view.cellCount * 3; p += 1) {
    const x = view.cellFaceCentres[p * 2];
    const y = view.cellFaceCentres[p * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    finite += 1;
    assert.ok(x >= -1 && x <= view.frameWidth + 1 && y >= -1 && y <= view.frameHeight + 1, '사영 좌표가 프레임 밖');
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  assert.ok(finite >= view.cellCount * 3 * 0.9, '세 면 좌표의 90% 이상이 유한해야 한다 (' + finite + ')');
  // 붕괴 자 — 옛 «세 면 평균» 은 y2 실물에서 퍼짐이 0.09×1.31 px 였다. 코드가 프레임의 ~절반이면 수백 px 여야 한다.
  assert.ok(maxX - minX > view.frameWidth * 0.2 && maxY - minY > view.frameHeight * 0.2,
    '사영 좌표가 한 점으로 붕괴했다 (' + (maxX - minX).toFixed(1) + '×' + (maxY - minY).toFixed(1) + ' px)');
  let painted = 0;
  for (let c = 0; c < view.cellCount; c += 1) if (view.cellMap[c] !== 0) painted += 1;
  assert.ok(painted > 0, '누적 뒤에도 전 셀 UNOBSERVED — 셀맵이 칠해지지 않는다');
  runtime.setEnabled(false);
  assert.equal(runtime.view.cellCount, 0, '껐는데 뷰가 남았다');
  assert.equal(runtime.view.H, null, '껐는데 H 참조가 남았다');
});

test('ⓗ 시험판 UI — 셀맵 캔버스가 배선돼 있고 프레임 루프에서 매 프레임 그린다', () => {
  const html = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  assert.ok(html.includes('id="r2-cellmap"'), '셀맵 캔버스 마크업이 없다');
  assert.ok(js.includes('function renderR2CellMap()'), '셀맵 렌더러가 없다');
  // 색 표는 CELL_MAP_STATE 를 **키로** 써야 한다 — 숫자 손 사본은 상태값이 바뀌면 조용히 틀린다.
  assert.ok(/\[CELL_MAP_STATE\.CONFIRMED\]/.test(js), '셀 색 표가 CELL_MAP_STATE 를 키로 안 쓴다 (숫자 손 사본)');
  const blockAt = js.indexOf('if (r2Runtime.enabled) {');
  assert.ok(blockAt > 0);
  const block = js.slice(blockAt, blockAt + 1800);
  assert.ok(block.includes('renderR2CellMap()'),
    '프레임 루프의 R2 블록이 셀맵을 안 그린다 — 스캔 중에 그림이 멈춰 있다');
});

/*
 * ⓘ~ⓛ (2026-09-05, PM/029B §24.9) — 시험판 .04~.05.02 에서 R2 성공이 화면에 도달한 적이
 * 없었다. 배선은 `{ text }` 를 넘겼고 문은 `payload` 만 봤다. ⓑ 는 `handleDecodeResult(`
 * 철자만 재서 초록이었다. 그래서 ⓘ 는 **실제 문에 실제 적중을 값으로** 넣는다.
 */

test('ⓘ R2 적중이 R1 과 같은 문(normalizeDecodePayload)을 **통과**한다 — 철자가 아니라 값으로', (t) => {
  assert.equal(r2HitToDecodeResult(null), null);
  assert.equal(normalizeDecodePayload(r2HitToDecodeResult({ text: '' })), null, '빈 글자는 문에서 막혀야 한다');
  const shaped = r2HitToDecodeResult({ text: 'abc', layoutId: 'v0', n: 13, frame: 5 });
  assert.equal(normalizeDecodePayload(shaped), 'abc');
  assert.equal(shaped.source, 'r2');
  // 옛 결함 모양은 문에서 죽는다 — 자가 무엇을 막는지 값으로 남긴다.
  assert.equal(normalizeDecodePayload({ ok: true, text: 'abc', source: 'r2' }), null);

  const frames = firstFrames('y2', 8);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  let hit = null;
  for (let i = 0; i < frames.length && hit === null; i += 1) hit = runtime.pushFrame(frames[i], i * 100);
  assert.ok(hit && typeof hit.text === 'string', 'y2 에서 적중이 없다 — ⓐ 가 먼저 빨개져야 한다');
  assert.equal(normalizeDecodePayload(r2HitToDecodeResult(hit)), hit.text,
    'R2 적중이 결과 문을 못 지난다 — 성공이 실패 분기로 떨어진다');
});

test('ⓚ DONE 뒤 세션은 흡수 상태다 — reset 없이는 같은 답을 되돌리고, reset 뒤엔 되돌리지 않는다', (t) => {
  const frames = firstFrames('y2', 8);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  let hit = null;
  let i = 0;
  for (; i < frames.length && hit === null; i += 1) hit = runtime.pushFrame(frames[i], i * 100);
  assert.ok(hit, 'y2 에서 적중이 없다');
  // 흡수: 다음 프레임에도 같은 글자가 «새 적중» 으로 돌아온다. 스캐너가 비우지 않으면 거부된
  // 결과(비컨만 등)가 매 프레임 반복되고, 다음 카메라 세션의 첫 프레임에 옛 글자가 뜬다.
  const again = runtime.pushFrame(frames[i - 1], i * 100 + 100);
  assert.ok(again && again.text === hit.text,
    '흡수 전제가 깨졌다 — 스캐너의 reset 배선(ⓙ) 근거를 다시 봐야 한다');
  runtime.reset();
  assert.equal(runtime.stats.candidateCount, 0, 'reset 이 후보를 안 버렸다');
  assert.equal(runtime.stats.text, null, 'reset 이 옛 글자를 남겼다');
  const after = runtime.pushFrame(frames[0], 99999);
  assert.equal(after, null, 'reset 뒤 첫 프레임에서 옛 답이 되살아났다');
});

test('ⓙ 배선 — 거부된 R2 결과가 루프를 죽이지 않고 R2 를 비우며, 카메라 정지·시작에서 비운다 (⚠ 철자 자 — 브라우저 밖)', () => {
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  const start = js.indexOf('if (r2Runtime.enabled) {');
  // 블록은 `} catch` 까지 — 고정 길이 슬라이스는 주석이 늘면 꼬리를 잃는다.
  const block = js.slice(start, js.indexOf('} catch', start) + '} catch'.length);
  const callAt = block.indexOf('handleDecodeResult(');
  assert.ok(callAt > 0, 'R2 블록에 문 호출이 없다');
  assert.ok(block.slice(callAt, callAt + 80).includes('r2HitToDecodeResult(hit)'),
    'R2 적중이 모양 변환 없이 문으로 간다 — ⓘ 의 삼킴이 되살아난다');
  const tail = block.slice(callAt, block.indexOf('} catch', callAt));
  assert.ok(tail.includes('if (session !== scanSession) return;'), '수용 여부를 안 보고 return 한다');
  assert.ok(tail.includes('r2Runtime.reset()'), '거부된 뒤 R2 를 안 비운다 — 흡수 상태라 같은 답이 반복된다 (ⓚ)');
  const bare = tail.indexOf('return;');
  assert.ok(bare < 0 || tail.slice(0, bare).includes('session !== scanSession'),
    '무조건 return — rAF 재예약을 건너뛰어 루프가 죽는다');
  const stop = js.slice(js.indexOf('function stopCamera()'), js.indexOf('function cameraFailure('));
  assert.ok(stop.includes('r2Runtime.reset()'), 'stopCamera 가 R2 를 안 비운다 — 다음 카메라의 첫 프레임에 옛 글자가 뜬다');
  const loop = js.slice(js.indexOf('function startFrameLoop('), js.indexOf('const nextFrame ='));
  assert.ok(loop.includes('r2Runtime.reset()'), 'startFrameLoop 이 R2 를 안 비운다');
});

test('ⓛ 범위 안내가 R2 토글을 따르고 배선이 살아 있다 (운영자 요구 ② · 3상태는 qr-bridge.test ⓔ)', () => {
  assert.equal(scanScopeCopyKey(false), 'guide.tlcubeOnly', 'off 는 정식 문구 그대로여야 한다');
  assert.equal(scanScopeCopyKey(undefined), 'guide.tlcubeOnly', '모름은 정식 문구다');
  assert.notEqual(scanScopeCopyKey(true), scanScopeCopyKey(false), 'on 인데 문구가 안 바뀐다');
  for (const key of [scanScopeCopyKey(true, false), scanScopeCopyKey(true, true)]) {
    for (const lang of Object.keys(SCANNER_STRINGS)) {
      assert.equal(typeof SCANNER_STRINGS[lang][key], 'string', lang + ' 에 ' + key + ' 가 없다');
    }
    assert.match(SCANNER_STRINGS.ko[key], /타입 Y/, '누적 대상이 Type Y 뿐인데 문구가 그걸 안 말한다 — 과대주장');
  }
  assert.ok(R2_CAPABILITIES.accumulatesFamilies.includes('Y'));
  assert.equal(typeof R2_CAPABILITIES.readsQrVia, 'string', 'QR 을 어떻게 읽는지 원장에 없다');

  const html = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  assert.ok(html.includes('id="scan-guide-scope"'), '범위 안내 요소에 id 가 없다');
  assert.ok(js.includes('!scanGuideScope'), '범위 안내 요소가 하드 가드 밖이다 — 없는 변형 페이지에서 조용히 죽는다');
  const toggleAt = js.indexOf("engineSwitchControl.addEventListener('click'");
  assert.ok(toggleAt > 0, '엔진 스위치 핸들러가 없다');
  const handler = js.slice(toggleAt, js.indexOf('});', toggleAt));
  assert.ok(handler.includes('refreshScanGuideCopy()'), '토글이 범위 안내를 안 바꾼다');
  const fn = js.slice(js.indexOf('function refreshScanGuideCopy()'), js.indexOf('const i18n = createI18n'));
  assert.ok(fn.includes('scanScopeCopyKey(r2Runtime.enabled'), 'refreshScanGuideCopy 가 토글 상태를 안 읽는다');
});

/*
 * 2a (PM/029B §27.4) — 좌 패널·HUD 가 읽을 «확정/변동» 표면. 전부 기존 값 전달, 핫 경로 할당 0.
 */

test('ⓜ stats 표면 — 필수 키 ⊆ 키 집합, 꺼진 런타임은 프레임을 밀어도 초기값 그대로', () => {
  const fresh = createR2ScanRuntime({ enabled: false });
  const keys = new Set(Object.keys(fresh.stats));
  for (const k of ['frames', 'binds', 'candidateCount', 'lockedN', 'doneLayoutId', 'doneFrame', 'text', 'progressD', 'indicator',
    'locked', 'lockF', 'layoutIdLocked', 'leadingLayoutId', 'candidates']) {
    assert.ok(keys.has(k), 'stats 에 ' + k + ' 가 없다');
  }
  const before = JSON.stringify(fresh.stats);
  const fake = { width: 4, height: 4, data: new Float32Array(16) };
  for (let i = 0; i < 3; i += 1) fresh.pushFrame(fake, i * 100);
  assert.equal(JSON.stringify(fresh.stats), before, '꺼진 런타임의 stats 가 변했다 — 정식 경로 불변 위반');
  for (const k of ['H', 'n', 'lockRevision', 'cellFaceCentres', 'cellMap', 'cellCount']) assert.ok(k in fresh.view, 'view 에 ' + k + ' 가 없다');
});

test('ⓝ 락은 됐는데 증거가 0 인 첫 프레임 — indicator 는 세션 값 그대로(SEARCHING 아님), 어댑터 락 상태가 stats 로 전달된다', (t) => {
  // 코퍼스는 락 프레임에 이미 D>0 이라 이 상태를 못 만든다 — 가짜 어댑터: 검출은 되고(n=13) 정합 게이트는 안 열린다.
  const fakeStats = { n: 13, locked: 1, gridLockF: 0.5, layoutId: 'v0', lockRevision: 1 };
  const fake = {
    stats: fakeStats,
    H: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    detectInto(luma, width, height, timestamp, pose, output) { output.found = 1; output.n = 13; return R2_SESSION_STATUS.OK; },
    alignInto() { return R2_SESSION_STATUS.OK; },
    reset() {},
    projectCellFaceCentres() { return 0; },
  };
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  const luma = { width: 8, height: 8, data: new Float32Array(64) };
  runtime.pushFrame(luma, 0);
  const s = runtime.stats;
  assert.equal(s.candidateCount, 1, 'n=13 은 후보 1개(v0)여야 한다');
  assert.equal(s.progressD, 0, '증거 0 인데 D 가 0 이 아니다 — 시나리오가 아니다');
  assert.equal(s.locked, 1, '어댑터 락이 stats 로 전달되지 않는다');
  assert.equal(s.lockF, 0.5);
  assert.equal(s.layoutIdLocked, 'v0');
  assert.equal(s.leadingLayoutId, 'v0');
  assert.notEqual(s.indicator, R2_INDICATOR.SEARCHING, '락됐는데 indicator 가 SEARCHING — 패널이 «탐색 중» 으로 거짓말한다 (bestIndicator 결함)');
  assert.equal(s.indicator, s.candidates[0].indicator, '선두 후보의 indicator 를 그대로 전달해야 한다');

  // 실물 대조군: y0 락 프레임에서도 같은 전달이 성립한다.
  const frames = firstFrames('y0', 6);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const real = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) { real.pushFrame(frames[i], i * 100); if (real.stats.candidateCount > 0) break; }
  assert.equal(real.stats.locked, 1);
  assert.equal(typeof real.stats.layoutIdLocked, 'string');
  assert.notEqual(real.stats.indicator, R2_INDICATOR.SEARCHING);
});

test('ⓞ view 기하 원천 — 락 뒤 H(9)·n·lockRevision, reset 뒤 비움', (t) => {
  const frames = firstFrames('y2', 3);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  const v = runtime.view;
  assert.ok(v.H instanceof Float64Array && v.H.length >= 9, 'H 가 Float64Array(9) 가 아니다');
  assert.equal(v.n, runtime.stats.lockedN, 'view.n 이 락 n 과 다르다');
  assert.ok(v.lockRevision >= 1, '락이 걸렸는데 lockRevision 이 0');
  const rev = v.lockRevision;
  runtime.pushFrame(frames[frames.length - 1], 9000);
  assert.equal(runtime.view.lockRevision, rev, '락 유지 프레임에서 lockRevision 이 움직였다 — HUD 가 매 프레임 재사영한다');
  runtime.reset();
  assert.equal(runtime.view.H, null);
  assert.equal(runtime.view.n, 0);
  assert.equal(runtime.view.cellCount, 0);
});

test('ⓟ 후보 배열 — 길이·모양·선두 일치, 최대 D = progressD', (t) => {
  const frames = firstFrames('y2', 4);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  const s = runtime.stats;
  assert.ok(s.candidateCount > 1, 'y2 는 후보가 여럿이어야 한다');
  assert.equal(s.candidates.length, s.candidateCount);
  let maxD = -1;
  for (const c of s.candidates) {
    assert.equal(typeof c.layoutId, 'string');
    assert.ok(Number.isFinite(c.D) && c.D >= 0);
    assert.ok(Number.isInteger(c.indicator));
    assert.equal(typeof c.alive, 'boolean');
    if (c.alive && c.D > maxD) maxD = c.D;
  }
  assert.equal(maxD, s.progressD, '후보 최대 D 와 progressD 가 다르다 — 후보 항목이 갱신되지 않는다');
  assert.ok(s.candidates.some((c) => c.layoutId === s.leadingLayoutId), '선두 id 가 후보 밖');
  runtime.setEnabled(false);
  assert.equal(runtime.stats.candidates.length, 0, '껐는데 후보 배열이 남았다');
});

test('ⓠ 세 면 중심은 붕괴하지 않고, 그 평균은 항등적으로 Y-심이다 — 옛 projectCellCentres 를 버린 이유', () => {
  const a = createA3Adapters({});
  const identity = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  a.installHomography(identity, 25, 'v0tr');
  assert.equal(a.stats.lockRevision, 1, 'installHomography 가 lockRevision 을 안 올린다');
  const cellCount = 493;
  const out = new Float32Array(cellCount * 6);
  const mapped = a.projectCellFaceCentres(out, cellCount);
  assert.equal(mapped, cellCount);
  let spread = 0; let meanMax = 0;
  for (let c = 0; c < cellCount; c += 1) {
    const b = c * 6;
    const mx = (out[b] + out[b + 2] + out[b + 4]) / 3;
    const my = (out[b + 1] + out[b + 3] + out[b + 5]) / 3;
    meanMax = Math.max(meanMax, Math.abs(mx), Math.abs(my));
    spread = Math.max(spread, Math.abs(out[b] - out[b + 2]), Math.abs(out[b + 1] - out[b + 3]));
  }
  assert.ok(meanMax < 1e-4, '세 면 평균이 Y-심(원점)이 아니다 — 붕괴 기록이 틀렸다면 이 자를 다시 보라 (' + meanMax + ')');
  assert.ok(spread > 1, '세 면 중심이 서로 떨어져 있지 않다 — 3점 사영이 한 점을 반복한다');
  a.reset();
  assert.equal(a.stats.lockRevision, 2, 'clearLock 이 lockRevision 을 안 올린다');
  assert.equal(a.projectCellFaceCentres(out, cellCount), 0, '락이 없는데 사영했다');
});

/*
 * 2b (PM/029B §27.4 · 운영자 결정 ⑧) — DONE 래치. 행 규칙은 src/r2-confirmation-model.js 가 갖고
 * (test/r2-confirmation-model.test.js), 여기서는 **배선**만 찍는다.
 * 적대 검토 F8 (2026-09-05) 뒤 래치가 그려지는 표면은 스테이지 좌 패널이 아니라 **결과 카드**다 — 좌 패널은 결과 시트(z10)·카메라
 * 게이트(z2, 스테이지 isolate) 아래라 카메라가 닫힌 뒤엔 아무도 못 본다. 그래서 (a) 좌 패널은 카메라가 닫히면 숨고 래치를 안 그린다,
 * (b) 결과 문이 R2 출처 결과에 래치를 실어 showResult 가 확정 요약을 그린다, (c) 래치엔 «정정» 판별용 leadingId 가 실린다.
 */

test('ⓡ DONE 래치 — R2 블록의 r2Latched 스냅샷(leadingId 포함)이 handleDecodeResult 호출 **앞**이고, startFrameLoop·스위치·거부 뒤에 null, 표면은 결과 카드 (⚠ 철자 자 — 브라우저 밖)', () => {
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  const html = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
  const start = js.indexOf('if (r2Runtime.enabled) {');
  assert.ok(start > 0);
  const block = js.slice(start, js.indexOf('} catch', start) + '} catch'.length);
  const latchAt = block.indexOf('r2Latched = { layoutId: hit.layoutId, n: hit.n, leadingId: r2LeadingId }');
  const callAt = block.indexOf('handleDecodeResult(');
  assert.ok(latchAt > 0, 'R2 블록에 DONE 스냅샷(layoutId · n · leadingId)이 없다 — 결과 카드의 확정 요약이 읽을 값이 없다');
  assert.ok(callAt > 0);
  assert.ok(latchAt < callAt,
    '스냅샷이 문 **뒤**다 — 문이 받아들이면 stopCamera 가 r2Runtime.reset() 을 먼저 불러 stats 가 비므로 요약이 빈 값을 읽는다');
  const renderAt = block.indexOf('renderR2Progress()');
  assert.ok(renderAt > 0 && renderAt < latchAt, '스냅샷이 같은 프레임의 renderR2Progress 보다 앞이다 — leadingId 가 한 프레임 묵은 선두다');
  const tail = block.slice(callAt, block.indexOf('} catch', callAt));
  assert.ok(tail.includes('r2Latched = null'), '거부된 적중(비컨만·빈 페이로드) 뒤 래치를 안 되돌린다 — 확정이 아닌 것이 확정으로 남는다');
  // F1 — 거부 뒤 상태줄 위상·유예 (규칙은 모델 r2StatusOnReject, 값은 r2-confirmation-model.test (xii)).
  assert.ok(tail.includes('r2StatusOnReject(nowMs())'), '거부 뒤 상태줄 위상을 안 내린다 — 다음 프레임의 release 전이가 beaconOnly 처방을 aim 으로 덮는다');
  assert.ok(js.includes('r2StatusStep({ collecting: r2StatusCollecting, holdUntil: r2StatusHoldUntil }, r2Runtime.stats, nowMs())'),
    'syncR2Status 가 모델의 전이 규칙을 안 쓴다 — 유예가 배선되지 않는다');
  const loop = js.slice(js.indexOf('function startFrameLoop('), js.indexOf('const nextFrame ='));
  assert.ok(loop.includes('r2Latched = null'), 'startFrameLoop 이 래치를 안 비운다 — 옛 확정 값이 새 카메라의 결과처럼 읽힌다');
  assert.ok(loop.includes('r2StatusHoldUntil = -Infinity'), 'startFrameLoop 이 거부 유예를 안 비운다');
  // F3 — 비운 것을 즉시 그린다 (안 그리면 첫 성공 pushFrame 까지 옛 칩·막대가 새 카메라 위에 남는다).
  assert.ok(loop.includes('renderR2Progress()') && loop.includes('renderR2CellMap()'), 'startFrameLoop 이 비운 패널·셀맵을 즉시 안 그린다');
  const toggleAt = js.indexOf("engineSwitchControl.addEventListener('click'");
  const handler = js.slice(toggleAt, js.indexOf('\n  });', toggleAt));
  assert.ok(handler.includes('r2Latched = null'), '엔진 스위치가 래치를 안 비운다 — 다른 엔진의 결과처럼 읽힌다');
  assert.ok(handler.includes('r2StatusHoldUntil = -Infinity'), '엔진 스위치가 거부 유예를 안 비운다');
  // 렌더는 행 규칙을 다시 쓰지 않고 모델을 쓴다.
  assert.ok(js.includes("from '/src/r2-confirmation-model.js'"), 'scanner.js 가 확정 행 모델을 안 문다');
  assert.ok(js.includes('leadingWithHysteresis('), '선두 히스테리시스를 안 쓴다 — 근소한 역전마다 레이아웃 칩이 깜빡인다');
  // F8 — (a) 좌 패널은 라이브만: 래치를 모델에 넘기지 않고, 카메라가 닫히면 숨긴다.
  const progressFn = js.slice(js.indexOf('function renderR2Progress()'), js.indexOf('function renderResultR2Summary('));
  assert.ok(progressFn.length > 0, 'renderR2Progress / renderResultR2Summary 를 못 찾았다');
  assert.ok(progressFn.includes('confirmationRows({ stats, view, latched: null, leadingId: r2LeadingId })'), '좌 패널이 래치를 그린다 — 그 칩은 시트·게이트 아래라 아무도 못 본다');
  assert.ok(!progressFn.includes('latched: r2Latched'), '좌 패널이 래치를 모델에 넘긴다');
  assert.ok(/if \(!cameraStream\) \{[^}]*r2ProgressRoot\.hidden = true;/.test(progressFn), '카메라가 닫혔는데 좌 패널을 숨기지 않는다');
  // F5 — 막대 메모는 칩과 같은 락 판정(progressNote).
  assert.ok(progressFn.includes('progressNote({ stats, view })'), '메모가 stats.lockedN 을 직접 쓴다 — 코스팅 중 «칩 없음 · n0·5» 모순');
  // (b) 결과 문이 R2 출처에만 래치를 싣고, showResult 가 요약을 그리며, hideResult 가 지운다.
  assert.ok(js.includes("r2Summary: result.source === 'r2' ? r2Latched : null"), '결과 문이 R2 출처 결과에 래치를 안 싣는다 (또는 사진 결과에도 싣는다)');
  const show = js.slice(js.indexOf('function showResult('), js.indexOf('function hideResult('));
  assert.ok(show.includes('renderResultR2Summary(settings.r2Summary || null)'), 'showResult 가 확정 요약을 안 그린다');
  const hide = js.slice(js.indexOf('function hideResult('), js.indexOf('function closeResult('));
  assert.ok(hide.includes('renderResultR2Summary(null)'), 'hideResult 가 확정 요약을 안 지운다 — 다음 결과에 옛 요약이 남는다');
  const summaryFn = js.slice(js.indexOf('function renderResultR2Summary('), js.indexOf('/*', js.indexOf('function renderResultR2Summary(')));
  assert.ok(summaryFn.includes('confirmationRows({ latched })'), '결과 카드 요약이 모델(래치 → 전 행 확정)을 안 쓴다');
  assert.ok(summaryFn.includes('latched.leadingId !== latched.layoutId') && summaryFn.includes('flagR2ChipCorrected('),
    'DONE 의 변종이 적중 프레임 선두와 다를 때 «정정» 강조가 없다 (운영자 ⑧)');
  assert.ok(html.includes('id="result-r2-rows"'), '결과 카드에 확정 요약 컨테이너가 없다');
});

test('ⓢ 락 상실 코스팅 — 가짜 어댑터로 lockedN 0 · 후보 생존 상태를 만들면 칩·메모·막대가 한 이야기를 한다 (F5)', () => {
  // 코퍼스는 이 상태(어댑터는 락을 걷었는데 후보는 patience 안이라 살아 있음)를 재현 못 한다 — 가짜 어댑터: 두 프레임 검출(n=25) 뒤 미검출.
  const ids = finalLayoutIdsForN(25);
  const fakeStats = { n: 25, locked: 1, gridLockF: 0.5, layoutId: ids[0], lockRevision: 1 };
  let found = 1;
  const fake = {
    stats: fakeStats,
    H: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    detectInto(luma, width, height, timestamp, pose, output) { output.found = found; output.n = found ? 25 : 0; return R2_SESSION_STATUS.OK; },
    alignInto() { return R2_SESSION_STATUS.OK; },
    reset() {},
    projectCellFaceCentres() { return 0; },
  };
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  const luma = { width: 8, height: 8, data: new Float32Array(64) };
  runtime.pushFrame(luma, 0);
  runtime.pushFrame(luma, 100);
  assert.equal(runtime.stats.lockedN, 25, '전제: 락');
  assert.equal(runtime.stats.candidateCount, ids.length, '전제: n=25 라인업 수만큼 후보');
  assert.equal(runtime.view.n, 25, '전제: 뷰가 묶인 n 을 든다');

  // 락 상실 — 어댑터는 found=0 (LOCK_MISS_LIMIT 뒤 clearLock 과 같은 관측), 런타임은 후보를 살려 둔다.
  found = 0; fakeStats.locked = 0;
  for (let i = 2; i < 6; i += 1) runtime.pushFrame(luma, i * 100);
  const { stats, view } = runtime;
  assert.equal(stats.lockedN, 0, '시나리오가 아니다 — lockedN 이 0 이 아니다');
  assert.equal(stats.candidateCount, ids.length, '시나리오가 아니다 — 후보가 죽었다 (patience 안이어야 한다)');
  assert.equal(view.n, 25, '뷰의 묶인 n 이 사라졌다 — 코스팅 중 메모·칩의 원천이 없다');

  const rows = {};
  for (const r of confirmationRows({ stats, view, latched: null, leadingId: '' })) rows[r.key] = r;
  const note = progressNote({ stats, view });
  const barShown = (stats.candidateCount > 0 ? stats.progressD : 0) > 0 || stats.candidateCount > 0;
  assert.equal(rows.type.state, CONFIRM_STATE.CONFIRMED, '코스팅 중 타입 칩이 사라졌다 — 재락마다 «확정» 이 깜빡인다');
  assert.equal(rows.version.text, R2_CAPABILITIES.accumulatesFamilies[0] + versionForFinalN(25) + ' (n25)');
  assert.equal(note, 'n25·' + ids.length, '메모가 «n0·5» 처럼 락 없음을 말한다');
  assert.equal(rows.type.state !== CONFIRM_STATE.NONE, note !== '', '칩과 메모가 갈린다');
  assert.equal(barShown, true, '막대 조건(candidateCount > 0)이 칩·메모와 갈린다');
  assert.equal(rows.layout.state, CONFIRM_STATE.TENTATIVE, '레이아웃은 DONE 전이라 변동');

  // patience 를 넘기면 후보 폐기 → 세 표면 모두 빈다.
  for (let i = 6; i < 60; i += 1) runtime.pushFrame(luma, i * 100);
  assert.equal(runtime.stats.candidateCount, 0, 'patience 뒤에도 후보가 남았다');
  assert.equal(runtime.view.n, 0);
  for (const r of confirmationRows({ stats: runtime.stats, view: runtime.view, latched: null, leadingId: '' })) assert.equal(r.state, CONFIRM_STATE.NONE, r.key);
  assert.equal(progressNote({ stats: runtime.stats, view: runtime.view }), '');
});
