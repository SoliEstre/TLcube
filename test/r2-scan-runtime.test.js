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
import { normalizeDecodePayload, scanScopeCopyKey } from '../src/scanner-scan-assist.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';
import { finalLayoutIdsForN } from '../src/cellSurfaceFinal.js';
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
  assert.ok(html.includes('id="lab-r2-toggle"'), 'R2 토글 마크업이 없다');
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

test('ⓖ 우하단 셀맵 뷰 — 선두 후보의 셀맵과 사영 좌표를 내보내고, 좌표는 프레임 안이다', (t) => {
  const frames = firstFrames('y2', 4);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  const view = runtime.view;
  assert.ok(view.cellCount > 0, '락 뒤인데 뷰 cellCount 가 0 이다 — 어댑터 사영이 안 됐다');
  assert.ok(view.cellMap instanceof Uint8Array && view.cellMap.length >= view.cellCount,
    '셀맵이 세션 버퍼 참조가 아니다');
  // 좌표는 **어댑터가 정합에 쓰는 같은 H·격자**에서 나와야 한다 — 프레임 안에 있어야 한다.
  const { width, height } = frames[0];
  let finite = 0;
  let inside = 0;
  for (let c = 0; c < view.cellCount; c += 1) {
    const x = view.cellCentres[c * 2];
    const y = view.cellCentres[c * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    finite += 1;
    if (x >= 0 && x <= width && y >= 0 && y <= height) inside += 1;
  }
  assert.ok(finite >= view.cellCount * 0.9,
    `사영된 셀이 ${finite}/${view.cellCount} 뿐이다 — cellCoord→canonicalXY→projectInto 사슬이 끊겼다`);
  assert.ok(inside >= finite * 0.9,
    `프레임 밖 좌표가 ${finite - inside}/${finite} 다 — H 가 엉뚱하거나 격자가 틀렸다`);
  // 셀맵은 실제로 칠해져 있어야 한다 — 전부 UNOBSERVED(0) 면 세션이 셀을 안 칠했다.
  let painted = 0;
  for (let c = 0; c < view.cellCount; c += 1) if (view.cellMap[c] !== 0) painted += 1;
  assert.ok(painted > 0, '셀맵이 전부 미관측이다 — 세션이 셀을 안 칠했다 (session.js 매 프레임 CONFIRMED/CANDIDATE)');
  // 끄면 뷰도 비운다 — 옛 그림이 화면에 눌러앉으면 안 된다.
  runtime.setEnabled(false);
  assert.equal(runtime.view.cellCount, 0, '껐는데 셀맵 뷰가 남았다');
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
  const block = js.slice(start, start + 2600);
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

test('ⓛ 범위 안내가 R2 토글을 따르고, 문구의 주장이 능력 원장과 맞는다 (운영자 요구 ②)', () => {
  assert.equal(scanScopeCopyKey(false), 'guide.tlcubeOnly', 'off 는 정식 문구 그대로여야 한다');
  assert.equal(scanScopeCopyKey(undefined), 'guide.tlcubeOnly', '모름은 정식 문구다');
  assert.notEqual(scanScopeCopyKey(true), scanScopeCopyKey(false), 'on 인데 문구가 안 바뀐다');
  const onKey = scanScopeCopyKey(true);
  for (const lang of Object.keys(SCANNER_STRINGS)) {
    assert.equal(typeof SCANNER_STRINGS[lang][onKey], 'string', lang + ' 에 on 문구가 없다');
  }
  const ko = SCANNER_STRINGS.ko[onKey];
  // 정직 자: 원장이 바뀌면 문구도 바뀌어야 한다. QR 을 못 읽는 동안 문구는 «아직» 못 읽는다고 말한다.
  if (R2_CAPABILITIES.readsQr === false) {
    assert.match(ko, /QR/, 'QR 을 못 읽는데 문구가 QR 을 안 말한다');
    assert.match(ko, /아직/, 'QR 을 못 읽는데 «아직» 이 없다 — 능력 약속(PM/029B §2 ①)과 어긋난다');
  } else {
    assert.doesNotMatch(ko, /읽히지 않아요/, 'QR 을 읽는데 문구가 못 읽는다고 말한다');
  }
  assert.ok(R2_CAPABILITIES.accumulatesFamilies.includes('Y'));
  assert.match(ko, /타입 Y/, '누적 대상이 Type Y 뿐인데 문구가 그걸 안 말한다 — 과대주장');

  const html = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
  assert.ok(html.includes('id="scan-guide-scope"'), '범위 안내 요소에 id 가 없다');
  assert.ok(js.includes('!scanGuideScope'), '범위 안내 요소가 하드 가드 밖이다 — 없는 변형 페이지에서 조용히 죽는다');
  const toggleAt = js.indexOf("r2Toggle.addEventListener('click'");
  assert.ok(toggleAt > 0, '토글 핸들러가 없다');
  const handler = js.slice(toggleAt, js.indexOf('});', toggleAt));
  assert.ok(handler.includes('refreshScanGuideCopy()'), '토글이 범위 안내를 안 바꾼다');
  const fn = js.slice(js.indexOf('function refreshScanGuideCopy()'), js.indexOf('const i18n = createI18n'));
  assert.ok(fn.includes('scanScopeCopyKey(r2Runtime.enabled)'), 'refreshScanGuideCopy 가 토글 상태를 안 읽는다');
});
