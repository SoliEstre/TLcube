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
 *   ⓓ **플래그가 꺼져 있으면 아무 일도 하지 않는다** — R1 위치(승격 전 정식의 유일한 갈래)의 제어 흐름 불변.
 *
 * ⚠ 이 파일이 못 재는 축: 라이브 프레임률·손떨림·grab 비용. 브라우저 밖이다.
 * 실물 거동은 `tools/r2-runtime-probe.mjs` 가 코퍼스로 잰다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildR2Hit, createR2ScanRuntime, r2HitToDecodeResult, R2_CAPABILITIES,
} from '../src/r2-scan-runtime.js';
import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { R2_INDICATOR, R2_SESSION_STATUS } from '../src/r2/session.js';
import { Q15_ONE } from '../src/r2/params.js';
import { normalizeDecodePayload, scanScopeCopyKey } from '../src/scanner-scan-assist.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';
import {
  capacityForCellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
  versionForFinalN,
} from '../src/cellSurfaceFinal.js';
import { CONFIRM_STATE, confirmationRows, progressNote } from '../src/r2-confirmation-model.js';
import { HUD_ROLE, buildRoleGrids } from '../src/r2-hud-model.js';
import { HUD_FACES, faceQuadFloats, faceQuadSlot, projectFaceQuadsInto } from '../src/r2/hud-geometry.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function firstFrames(name, count, start = 0) {
  const seq = listLumaSequences().find((s) => s.name.split('/').pop() === name);
  if (!seq || !seq.frames.length) return null;
  const frames = seq.frames.slice(start, start + count);
  if (frames.length === 0) return null;
  return frames.map((f) => readLumaDump(f.path));
}

test('ⓓ 플래그가 꺼져 있으면 아무 일도 하지 않는다', () => {
  const runtime = createR2ScanRuntime({ enabled: false });
  assert.equal(runtime.enabled, false);
  // 프레임을 밀어도 세션을 만들지 않는다 — R1 위치에서 이것이 곧 «불변» 이다.
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
  /*
   * ⚠ **의도적 갱신 (3b)** — 옛 창은 `start + 1600` 이라는 **글자 수**였고, 그 블록에 줄이 늘자
   * `handleDecodeResult(` 가 창 밖으로 밀려 이 자가 「배선이 지워졌다」고 거짓말했다 (memory:
   * 철자를 재는 자는 썩는다). 지키려는 명제는 「R2 블록 **안**에서 부른다」이므로 경계도
   * 블록의 실제 끝(`} catch`)에서 온다 — 아래 ⓡ 가 이미 쓰는 방식과 같다.
   */
  const block = source.slice(start, source.indexOf('} catch', start));
  assert.ok(block.length > 400, 'R2 블록을 못 잘랐다 — 이 자가 공허해진다');

  // grab 이 **블록 안**에 있어야 플래그 off 에서 비용이 0 이다.
  assert.ok(/grabVideoFrame\(/.test(block),
    'R2 블록이 자기 grab 을 안 한다 — R1 의 grab 을 공유하면 플래그 off 에서도 '
    + 'R1 위치의 타이밍이 달라진다');
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

/**
 * ⓖ-b (3a) — **HUD 가 그리는 자리 ≡ 정합이 표본한 자리.**
 *
 * 이것이 3a 의 유일한 하중 성질이다(운영자 결정 ⑨). HUD 는 `src/r2/hud-geometry.js` 로 canonical 격자를
 * 따로 사영하고, 어댑터는 `cellFaceCentres` 를 자기 경로로 사영한다 — **다른 두 코드가 같은 자리를 말해야**
 * 「정합이 보는 곳」과 「내가 그린 곳」이 같다. 그래서 셀 k·면 f 의 어댑터 표본점이 HUD 가 그 (f,i,j) 로 만든
 * 마름모 **안에** 있는지를 값으로 잰다. 면 순서나 (i,j) 색인이 어긋나면 여기가 즉시 빨개진다
 * (bbox 비교는 면을 뒤섞어도 통과해서 못 잡는다).
 */
test('ⓖ-b HUD 사영 ≡ 어댑터 표본 자리 — 셀 k·면 f 의 표본점이 HUD 마름모 (f,i,j) 안에 있다', (t) => {
  const frames = firstFrames('y2', 4);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  const view = runtime.view;
  if (!view.H || view.cellCount === 0) { t.skip('락이 안 걸린 시퀀스'); return; }

  const grids = buildRoleGrids(view.n, view.layoutId);
  assert.ok(grids, 'HUD 역할 격자를 못 만든다 (n=' + view.n + ', ' + view.layoutId + ')');
  // 데이터 칸 수 = 런타임이 세는 셀 수. 두 수가 다르면 어느 한쪽이 다른 레이아웃을 읽고 있다.
  assert.equal(grids.counts.data, view.cellCount, 'HUD 의 데이터 칸 수와 런타임 셀 수가 다르다');
  // scanGrid 는 0..cellCount-1 을 정확히 한 번씩 쓴다 — 빠지거나 겹치면 셀 상태가 엉뚱한 칸에 칠해진다.
  const seen = new Set();
  for (let idx = 0; idx < grids.scanGrid.length; idx += 1) {
    const k = grids.scanGrid[idx];
    if (k < 0) continue;
    assert.equal(grids.roleGrid[idx], HUD_ROLE.DATA, 'scanGrid 가 데이터 아닌 칸을 가리킨다');
    assert.ok(k < view.cellCount && !seen.has(k), 'scanGrid 순번이 중복이거나 범위 밖이다: ' + k);
    seen.add(k);
  }
  assert.equal(seen.size, view.cellCount);

  const quads = new Float64Array(faceQuadFloats(view.n));
  projectFaceQuadsInto(view.H, view.n, quads);
  /** 볼록 사각형 안인가 — 네 변의 외적 부호가 모두 같으면 안(경계 포함). */
  const inside = (px, py, q, o) => {
    let neg = 0;
    let pos = 0;
    for (let e = 0; e < 4; e += 1) {
      const ax = q[o + e * 2]; const ay = q[o + e * 2 + 1];
      const bx = q[o + ((e + 1) % 4) * 2]; const by = q[o + ((e + 1) % 4) * 2 + 1];
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
      const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (cross > 1e-9) pos += 1;
      else if (cross < -1e-9) neg += 1;
    }
    return pos === 0 || neg === 0;
  };

  let tested = 0;
  let hit = 0;
  for (let idx = 0; idx < grids.scanGrid.length; idx += 1) {
    const k = grids.scanGrid[idx];
    if (k < 0) continue;
    const i = idx % view.n;
    const j = (idx - i) / view.n;
    for (let f = 0; f < HUD_FACES.length; f += 1) {
      const px = view.cellFaceCentres[k * 6 + f * 2];
      const py = view.cellFaceCentres[k * 6 + f * 2 + 1];
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const verdict = inside(px, py, quads, faceQuadSlot(view.n, f, i, j));
      if (verdict === null) continue;
      tested += 1;
      if (verdict) hit += 1;
    }
  }
  assert.ok(tested > view.cellCount * 2, '비교한 표본이 너무 적다 (' + tested + ')');
  // 전수 일치를 요구한다 — 한 칸이라도 밖이면 그건 «거의 맞다» 가 아니라 색인이 어긋났다는 뜻이다.
  assert.equal(hit, tested,
    'HUD 마름모 밖에 있는 어댑터 표본점이 ' + (tested - hit) + '/' + tested + ' 개 — HUD 가 정합과 다른 자리를 그린다');
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
  /*
   * ⚠ 옛 자는 `if (session !== scanSession) return;` 이라는 **한 줄의 철자**를 요구했다. 3b 가 그
   * 가드를 블록으로 넓히자(수용된 프레임에서 정정 강조를 한 번 더 그린다 — 3b 검토 F13) 정답이
   * 거부됐다. 그래서 재는 것을 «배치» 에서 **순서라는 성질**로 바꾼다:
   *   ① 수용 여부를 보는 가드가 있다 · ② 첫 `return;` 은 그 가드 **뒤**다 (무조건 return 금지) ·
   *   ③ `r2Runtime.reset()` 은 그 return **뒤**다 (거부 경로만 비운다 — 수용은 stopCamera 가 한다).
   */
  const guardAt = tail.indexOf('if (session !== scanSession)');
  assert.ok(guardAt >= 0, '수용 여부를 안 보고 return 한다');
  const bare = tail.indexOf('return;');
  assert.ok(bare > guardAt, '무조건 return — rAF 재예약을 건너뛰어 루프가 죽는다');
  const resetAt = tail.indexOf('r2Runtime.reset()');
  assert.ok(resetAt > 0, '거부된 뒤 R2 를 안 비운다 — 흡수 상태라 같은 답이 반복된다 (ⓚ)');
  assert.ok(resetAt > bare,
    '수용 가드가 return 하기 전에 R2 를 비운다 — 수용된 결과의 정리를 거부 경로가 대신 한다');
  const stop = js.slice(js.indexOf('function stopCamera()'), js.indexOf('function cameraFailure('));
  assert.ok(stop.includes('r2Runtime.reset()'), 'stopCamera 가 R2 를 안 비운다 — 다음 카메라의 첫 프레임에 옛 글자가 뜬다');
  const loop = js.slice(js.indexOf('function startFrameLoop('), js.indexOf('const nextFrame ='));
  assert.ok(loop.includes('r2Runtime.reset()'), 'startFrameLoop 이 R2 를 안 비운다');
});

test('ⓛ 범위 안내가 R2 토글을 따르고 배선이 살아 있다 (운영자 요구 ② · 3상태는 qr-bridge.test ⓔ)', () => {
  assert.equal(scanScopeCopyKey(false), 'guide.tlcubeOnly', 'off 는 «TL 큐브만» 문구여야 한다');
  assert.equal(scanScopeCopyKey(undefined), 'guide.tlcubeOnly', '모름도 «TL 큐브만» 문구다');
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
  assert.equal(JSON.stringify(fresh.stats), before, '꺼진 런타임의 stats 가 변했다 — R1 위치 불변 위반');
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

/*
 * ── 빚 3 (3b) — **묶은 세대를 표면에 싣는다** ─────────────────────────────────────────────
 *
 * `buildLayout` 은 이미 세대를 받는다(`formatWire`). 빠져 있던 것은 **그 세대를 밖으로 내는 일**
 * 이다 — HUD 는 역할 격자를 만들 때 같은 세대를 써야 하는데, 표면에 없으니 늘 현행 세대로 그렸고
 * 레거시(와이어 1) 프레임에서 정정 강조·소거 색칠이 순번 7 부터 다른 칸을 지목했다.
 *
 * 코퍼스는 전부 세대 2 라 이 축을 **못 가른다**(2 를 못박아도 초록이다). 그래서 가짜 어댑터로
 * «세대 1 을 읽은 프레임» 을 만들어 값으로 잰다 — 실물 없이 만들 수 있는 상태다.
 */
test('빚3 stats.format.formatWire · view.formatWire — 읽은 세대가 표면에 실린다 (가짜 어댑터: 세대 1)', () => {
  const wireOneFormat = {
    source: 'locator', eccName: 'H', maskIndex: 0, candidateCount: 1, formatWireVersion: 1,
  };
  const fakeStats = {
    n: 13, locked: 1, gridLockF: 0.5, layoutId: 'v0', lockRevision: 1, format: wireOneFormat,
  };
  const fake = {
    stats: fakeStats,
    H: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    detectInto(luma, width, height, timestamp, pose, output) { output.found = 1; output.n = 13; return R2_SESSION_STATUS.OK; },
    alignInto() { return R2_SESSION_STATUS.OK; },
    reset() {},
    projectCellFaceCentres() { return 0; },
  };
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  runtime.pushFrame({ width: 8, height: 8, data: new Float32Array(64) }, 0);
  assert.equal(runtime.stats.candidateCount, 1, 'v0@13 은 레거시 세대가 있어 후보가 서야 한다');
  assert.equal(runtime.stats.format.formatWire, 1,
    '읽은 세대(1)가 stats 에 안 실린다 — HUD 가 현행 세대로 격자를 그린다');
  assert.equal(runtime.view.formatWire, 1,
    'view 가 묶은 세대를 안 싣는다 — 격자와 후보가 다른 세대를 말한다');
  // 후보를 버리면 세대도 「모른다」로 돌아간다 — 남기면 다음 락이 옛 세대로 그린다.
  runtime.reset();
  assert.equal(runtime.stats.format.formatWire, 2, 'reset 뒤 세대가 현행으로 안 돌아온다');
  assert.equal(runtime.view.formatWire, 2, 'reset 뒤 view 세대가 현행으로 안 돌아온다');
});

test('빚3 적중은 자기 세대를 싣는다 — 정정 셀 번호가 «어느 세대의 스캔 순서» 인지 (코퍼스)', (t) => {
  const frames = firstFrames('y0', 12);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  let hit = null;
  for (let i = 0; i < frames.length && hit === null; i += 1) hit = runtime.pushFrame(frames[i], i * 100);
  assert.ok(hit !== null, 'y0 가 12프레임 안에 안 풀렸다 — 실측은 f6 이다');
  assert.equal(hit.formatWire, runtime.stats.format.formatWire,
    '적중의 세대가 런타임이 묶은 세대와 다르다 — 정정 셀 번호의 좌표계를 잃는다');
  /*
   * 🔴 **그리고 그 적중은 순수 빌더가 만든 것이다** (3b 검토 F2 / X8). 코퍼스는 전부 세대 2 라
   * 위 단언만으로는 `formatWire: 2` 못박기를 **못 가른다**. 표면 목록을 빌더에서 **유도해**
   * 대조하면, 적중을 빌더 밖에서 손으로 다시 조립하는 순간 여기서 갈린다.
   */
  const shape = buildR2Hit(runtime.stats, {
    text: hit.text, layoutId: hit.layoutId, n: hit.n,
    correctedCount: hit.correctedCount, correctedCells: hit.correctedCells,
  });
  assert.deepEqual(Object.keys(hit).sort(), Object.keys(shape).sort(),
    '실물 적중의 표면이 순수 빌더의 출력과 다르다 — 어느 한쪽이 손으로 조립됐다');
  for (const key of Object.keys(shape)) {
    assert.equal(hit[key], shape[key], '적중의 ' + key + ' 가 빌더의 값과 다르다');
  }
  /*
   * ⚠ **여기까지 와도 못 덮는 축**: 세대 1 로 **DONE 까지** 가는 실물·합성 프레임이 없다
   * (레거시 인코더 미보유 — 빚). 그래서 「끝단에서 세대 1 이 실린다」는 여전히 미측정이고,
   * 아래 자가 «유도» 만 값으로 닫는다.
   */
});

test('빚3 buildR2Hit: 적중의 세대는 «지금 묶은 세대» 에서만 온다 — 상수를 적으면 강조가 통째로 꺼진다 (X8)', () => {
  /*
   * 🔴 3b 검토 F2. `formatWire: stats.format.formatWire` 를 `2` 로 못박아도 코퍼스 자 전부가
   * 초록이었다(코퍼스가 전부 세대 2 다). 유도를 순수 함수로 빼면 «세대 1 을 묶은 stats» 를
   * 넣어 값으로 가른다 — 못박은 판은 여기서 두 팔이 같아져 즉시 빨개진다.
   */
  const parts = {
    text: 'hello', layoutId: 'v0', n: 13, correctedCount: 3, correctedCells: Int32Array.from([1, 2, 3]),
  };
  const legacy = buildR2Hit({ doneFrame: 6, format: { formatWire: 1 } }, parts);
  const current = buildR2Hit({ doneFrame: 9, format: { formatWire: 2 } }, parts);
  assert.equal(legacy.formatWire, 1, '레거시 세대를 묶은 프레임의 적중이 그 세대를 안 싣는다');
  assert.equal(current.formatWire, 2);
  assert.notEqual(legacy.formatWire, current.formatWire,
    '두 세대의 적중이 같은 값을 싣는다 — 세대가 상수로 못박혔다');
  // 프레임 번호도 런타임 표면에서 온다 (적중이 «몇 번째 프레임의 답인가»).
  assert.equal(legacy.frame, 6);
  assert.equal(current.frame, 9);
  // 나머지 칸은 이 프레임이 만든 값 그대로 — 셀 목록은 **복사하지 않는다**(핫 경로 할당).
  assert.equal(legacy.correctedCells, parts.correctedCells);
  assert.equal(legacy.text, 'hello');
  assert.equal(legacy.layoutId, 'v0');
  assert.equal(legacy.n, 13);
});

/*
 * 🔴 **선반 왕복** (3b 검토 F3) — 보고서가 «유도로 바꿨다» 고 성과로 적은 자리인데 무자였다.
 * 옛 손 목록 넷(`source`·`eccName`·`maskIndex`·`candidateCount`)으로 되돌려도 자 전부가
 * 초록이었다(변이 X1). 그 상태에서 왕복이 일어나면 `candidates` 는 **얼린 세대**의 것인데
 * `stats.format.formatWire` 는 그 사이 `bind()` 가 심은 **새 세대**로 남는다 — 다음 프레임의
 * `view.formatWire` 가 그것을 HUD 에 실어 「후보의 스캔 순서」와 「격자의 세대」가 갈린다.
 * 빚 3 이 고치려던 결함이 복원 경로에 그대로 재현되는 것이다.
 *
 * 코퍼스로는 못 만든다(왕복도, 세대 1 도). 가짜 어댑터로 프레임 셋을 짠다:
 *   ① n=13 · locator(H|0|wire1) → bind. ② n=21 · locator(H|1|wire2) → 선반에 얼리고 재bind.
 *   ③ n=13 · **포맷 미해결**(source≠locator) → `boundFormatKeyFor` 가 선반 키를 인정 → 복원.
 */
test('빚3 restoreShelf: 선반 왕복 뒤 stats.format 의 **모든** 칸이 얼린 값으로 돌아온다 (X1)', () => {
  const fakeStats = {
    n: 13, locked: 1, gridLockF: 0.5, layoutId: 'v0', lockRevision: 1,
    format: { source: 'locator', eccName: 'H', maskIndex: 0, candidateCount: 1, formatWireVersion: 1 },
  };
  const fake = {
    stats: fakeStats,
    H: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    detectInto(luma, width, height, timestamp, pose, output) { output.found = 1; output.n = fakeStats.n; return R2_SESSION_STATUS.OK; },
    alignInto() { return R2_SESSION_STATUS.OK; },
    reset() {},
    projectCellFaceCentres() { return 0; },
  };
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  const luma = { width: 8, height: 8, data: new Float32Array(64) };

  // ① 세대 1 을 묶는다.
  runtime.pushFrame(luma, 0);
  assert.equal(runtime.stats.candidateCount, 1, 'v0@13 후보가 안 섰다 — 시나리오가 아니다');
  // 기대값은 **이 순간의 표면 전체**다 (손 목록 금지 — 새 칸이 생기면 자동으로 따라온다).
  const frozen = { ...runtime.stats.format };
  assert.equal(frozen.formatWire, 1, '자 자신의 준비가 실패했다 (세대 1 을 안 묶었다)');
  assert.ok(Object.keys(frozen).length >= 5, 'format 표면이 다섯 칸 미만이다 — 자가 공허해졌다');

  // ② n 이 바뀐 재락 — 옛 후보는 선반에 얼고, 지금 표면은 **다른 포맷**으로 덧써진다.
  fakeStats.n = 21;
  fakeStats.format = {
    source: 'locator', eccName: 'H', maskIndex: 1, candidateCount: 4, formatWireVersion: 2,
  };
  runtime.pushFrame(luma, 100);
  assert.notDeepEqual({ ...runtime.stats.format }, frozen, '재bind 가 표면을 안 바꿨다 — 왕복이 무의미해진다');
  assert.equal(runtime.stats.format.formatWire, 2);

  // ③ 같은 n 으로 돌아온다 + 포맷 미해결 → 선반 키를 인정 → 복원.
  fakeStats.n = 13;
  fakeStats.format = { source: 'none', eccName: '', maskIndex: 0, candidateCount: 0 };
  runtime.pushFrame(luma, 200);

  /*
   * 🔴 **얼린 표면 전체**가 돌아와야 한다. 손 목록으로 되돌린 판은 `formatWire` 만 새 세대(2)로
   * 남아 여기서 갈린다 — 그리고 그것이 사용자에겐 「강조가 다른 칸을 짚는다」로 보인다.
   */
  assert.deepEqual({ ...runtime.stats.format }, frozen,
    '선반 복원이 format 의 일부만 되돌렸다 — 후보의 스캔 순서와 격자의 세대가 갈린다');
  assert.equal(runtime.view.formatWire, frozen.formatWire,
    '복원 프레임의 view 세대가 얼린 세대가 아니다 — HUD 가 다른 세대로 격자를 그린다');
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
  /*
   * ⚠ **의도적 갱신 (3b)** — 옛 판은 스냅샷 객체를 **한 줄 철자 그대로** 찾았고, 3b 가 필드를
   * 하나(`correctedCount`) 더하며 줄이 갈리자 「스냅샷이 없다」로 빨개졌다. 지키려는 명제는
   * 「그 세 값이 hit·선두에서 온다」지 「한 줄에 적혀 있다」가 아니다 — 그래서 **필드별로** 잰다.
   */
  const latchAt = block.indexOf('r2Latched = {');
  const callAt = block.indexOf('handleDecodeResult(');
  assert.ok(latchAt > 0, 'R2 블록에 DONE 스냅샷이 없다 — 결과 카드의 확정 요약이 읽을 값이 없다');
  const latchObject = block.slice(latchAt, block.indexOf('};', latchAt));
  for (const field of ['layoutId: hit.layoutId', 'n: hit.n', 'leadingId: r2LeadingId']) {
    assert.ok(latchObject.includes(field),
      'DONE 스냅샷에 `' + field + '` 가 없다 — 결과 카드의 확정 요약이 그 값을 못 읽는다');
  }
  // 3b — RS 정정 수도 같은 스냅샷에 실린다 (결과 카드 DONE 칩의 «RS 정정 k»).
  assert.ok(/correctedCount:.*hit\.correctedCount/.test(latchObject),
    'DONE 스냅샷에 hit 의 정정 수가 없다 — 결과 카드가 「RS 가 몇 개를 고쳤나」를 못 말한다');
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
  /*
   * 규칙은 «R2 출처일 때만 래치, 아니면 null» 이고 자는 그 **규칙**을 잰다 — 인라인으로 쓰든 변수로
   * 붙잡든 통과해야 한다. (⑯(i) 유예가 들어오면서 이 식은 결과 시트 클로저 **밖**으로 나와 수용
   * 시점에 값으로 붙잡힌다: 유예 600 ms 중 래치를 비우는 입구가 카드를 지우기 때문이다. 그
   * «클로저가 래치를 안 읽는다» 쪽은 scanner-accept-delay ⓗ 가 잰다.)
   */
  const doorAt = js.indexOf('function handleDecodeResult(');
  const door = js.slice(doorAt, js.indexOf('function startFrameLoop(', doorAt));
  assert.ok(/result\.source === 'r2' \? r2Latched : null/.test(door),
    '결과 문이 R2 출처 결과에 래치를 안 싣는다 (또는 사진 결과에도 싣는다)');
  assert.ok(/r2Summary:\s*[A-Za-z_$][\w$.]*/.test(door),
    '결과 시트 호출이 그 요약을 안 넘긴다 — 규칙만 있고 표면에 도달하지 않는다');
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

test('ⓣ view.frameWidth/Height 는 «지금 프레임» 이다 — 락 뒤 폭이 바뀌어도 H·lockRevision 은 그대로 (HUD 는 락 폭을 스스로 기억해야 한다)', () => {
  /*
   * 왜 이 성질이 자로 남아야 하나: HUD 는 락 H 로 **한 번** 사영해 두고(lockRevision 게이트) 화면 변환에서
   * 그 좌표계를 프레임 폭으로 나눈다. 그 분모로 `view.frameWidth` 를 쓰면, 실기 경로가 실패 스트릭마다 내는
   * 해상도 승격 프레임(960 ↔ 1440, scanner.js FRAME_ESCALATED_SIDE)에서 **자만 바뀌고 그림은 그대로**라
   * HUD 가 2/3 크기로 좌상단에 붙는다. 여기서 재는 것은 그 전제 — 런타임은 락 폭을 기억해 주지 않는다.
   * (가짜 어댑터: 락은 한 번만 걸리고 이후 H·lockRevision 불변 — ⓢ 와 같은 방식.)
   */
  const fakeStats = { n: 25, locked: 1, gridLockF: 0.5, layoutId: finalLayoutIdsForN(25)[0], lockRevision: 1 };
  const H = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const fake = {
    stats: fakeStats,
    H,
    detectInto(luma, width, height, timestamp, pose, output) { output.found = 1; output.n = 25; return R2_SESSION_STATUS.OK; },
    alignInto() { return R2_SESSION_STATUS.OK; },
    reset() {},
    projectCellFaceCentres() { return 0; },
  };
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  const lumaOf = (side) => ({ width: side, height: side, data: new Float32Array(side * side) });
  // 실기 두 폭의 비(2:3)만 같으면 성질은 같다 — 자에서 96·144 로 줄여 잰다.
  runtime.pushFrame(lumaOf(96), 0);
  runtime.pushFrame(lumaOf(96), 100);
  assert.equal(runtime.view.n, 25, '전제: 락 뒤 뷰가 섰다');
  assert.equal(runtime.view.frameWidth, 96, '전제: 뷰가 첫 폭을 든다');
  const rev = runtime.view.lockRevision;

  runtime.pushFrame(lumaOf(144), 200);
  assert.equal(runtime.view.lockRevision, rev,
    '락 세대가 움직였다 — 이 시나리오(같은 락, 다른 프레임 폭)가 아니다');
  assert.equal(runtime.view.H, H, 'H 참조가 바뀌었다 — 락 뒤 사영이 다시 풀린다는 뜻이다');
  assert.equal(runtime.view.frameWidth, 144,
    'view.frameWidth 가 현재 프레임 폭을 안 따른다 — 이 자의 전제가 무너졌으니 HUD 쪽 결론도 다시 봐라');
  assert.equal(runtime.view.frameHeight, 144);
  // 결론: «H 의 좌표계 폭» 은 view 에 없다. HUD 는 재사영하는 프레임에 그 폭을 스스로 적어 둬야 한다
  // (scanner.js r2Hud.frameW · r2-hud.test ⓓ 가 그 자리를 찍는다).
});

/*
 * ════════════════════════════════════════════════════════════════════════════
 * 3c (2026-09-06, 레인 R) — **런타임 생명주기.** 운영자 실기 3차 ①·③·④ 가 지목한
 * 「락이 안 움직인다 / 모으다 말고 리셋 / 새로 잡힐 때만 읽힌다」의 기전을 값으로 잠근다.
 *
 * ⚠ **이 블록이 못 재는 축을 먼저 적는다**: 실기 프레임률(7\~15 FPS)·손떨림·줌 UI.
 * 브라우저 밖이다. 여기서 재는 것은 그 상황을 만드는 **상태 전이**다.
 * ════════════════════════════════════════════════════════════════════════════
 */

test('ⓤ R1a 락 신선도 — 프레임 크기가 바뀌면 락을 버린다 (줌 승격이 곧 좌표계 교체)', (t) => {
  const frames = firstFrames('y2', 2);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const a = createA3Adapters({});
  const det = { found: 0, family: 0 };
  a.detectInto(frames[0].data, frames[0].width, frames[0].height, 0, null, det);
  assert.equal(a.stats.locked, 1, '전제: 실물 프레임에서 락이 걸린다');
  assert.equal(a.stats.lockWidth, frames[0].width, '락이 자기 프레임 폭을 기억하지 않는다');
  assert.equal(a.stats.counters.sizeClears, 0);

  // 대조군 — **같은 크기**의 다음 프레임은 락을 유지한다 (가드가 항상 참이면 이 줄이 빨개진다).
  a.detectInto(frames[1].data, frames[1].width, frames[1].height, 100, null, det);
  assert.equal(a.stats.locked, 1, '같은 크기인데 락을 버렸다 — 가드가 크기를 안 보고 있다');
  assert.equal(a.stats.counters.sizeClears, 0);
  const revBefore = a.stats.lockRevision;

  // 표적 — 다른 크기(줌 승격 960 → 720). 옛 코드는 이 신호를 아예 못 받아 **옛 크롭 좌표의
  // H 로 락을 유지**했고, 그래서 화면의 실루엣·격자가 줌 뒤에도 안 움직였다.
  const side = Math.round(frames[0].width * 0.75);
  const smaller = new Float32Array(side * side);
  smaller.fill(0.5);
  a.detectInto(smaller, side, side, 200, null, det);
  assert.equal(a.stats.counters.sizeClears, 1, '프레임 크기가 바뀌었는데 락을 안 버렸다');
  assert.equal(a.stats.locked, 0, '빈 프레임이라 다시 락이 걸릴 수 없다 — 그런데 락이 남았다');
  assert.ok(a.stats.lockRevision > revBefore, '락을 버렸는데 세대가 안 올랐다 — HUD 가 재사영 안 한다');
  assert.equal(det.found, 0);
});

test('ⓥ R1d invalidateLock — 락만 푼다: 후보·증거·bind 는 살아 있고 세대만 오른다', (t) => {
  // ① 어댑터 층 — 성질만.
  const a = createA3Adapters({});
  a.installHomography(Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]), 25, 'v0tr');
  assert.equal(a.stats.locked, 1);
  const rev = a.stats.lockRevision;
  assert.equal(a.invalidateLock(), 1);
  assert.equal(a.stats.locked, 0);
  assert.equal(a.stats.lockRevision, rev + 1, 'invalidateLock 이 세대를 안 올린다');
  assert.equal(a.invalidateLock(), 0, '락이 없는데 또 풀었다 — 세대가 헛돈다');
  assert.equal(a.stats.lockRevision, rev + 1);

  // ② 런타임 층 — **증거를 안 버린다**. 이것이 reset() 과 갈리는 이유 전부다.
  const frames = firstFrames('y2', 3);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  assert.ok(runtime.stats.candidateCount > 0, '전제: 후보가 섰다');
  assert.ok(runtime.stats.progressD > 0, '전제: 증거가 쌓였다');
  const bindsBefore = runtime.stats.binds;
  const candidatesBefore = runtime.stats.candidateCount;
  const dBefore = runtime.stats.progressD;
  const lockKeyBefore = runtime.view.lockKey;

  assert.equal(runtime.invalidateLock(), 1);
  assert.equal(runtime.stats.locked, 0, '락이 안 풀렸다');
  assert.equal(runtime.stats.candidateCount, candidatesBefore,
    'invalidateLock 이 후보를 버렸다 — 그럼 reset() 과 같은 문이라 존재 이유가 없다');
  assert.notEqual(runtime.view.lockKey, lockKeyBefore, 'lockKey 가 안 움직였다 — HUD 가 옛 사영을 유지한다');

  // 다음 프레임에 재락 → n 이 같으므로 **bind 는 그대로**, 진행률도 후퇴하지 않는다.
  runtime.pushFrame(frames[frames.length - 1], 9000);
  assert.equal(runtime.stats.lockedN, 25, '재락이 안 됐다');
  assert.equal(runtime.stats.binds, bindsBefore,
    'n 이 같은데 다시 묶었다 — 재락마다 증거가 0 으로 돌아간다 (운영자 요구 ③ 위반)');
  assert.ok(runtime.stats.progressD >= dBefore, '재락 뒤 진행률이 후퇴했다');
});

test('ⓦ R2 인내 재정의 — 락이 살아 있으면 100프레임이 지나도 후보를 안 버린다', () => {
  /*
   * 옛 뜻은 «bind 이후 총 프레임» 이라 락이 멀쩡해도 42프레임마다 후보가 전부 폐기되고,
   * 락이 남아 있으니 같은 프레임에 즉시 재bind 됐다 — 즉 3\~4초마다 증거가 0 이 됐다.
   * 그 회귀는 아래 `binds` 단언에서 빨개진다(옛 코드라면 100프레임에 binds 가 여러 번이다).
   * 코퍼스는 이 상태(락 유지 × 장시간)를 재현 못 한다 — 가짜 어댑터로 만든다.
   */
  const ids = finalLayoutIdsForN(25);
  const fakeStats = { n: 25, locked: 1, gridLockF: 50, layoutId: ids[0], lockRevision: 1 };
  const fake = {
    stats: fakeStats,
    H: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    detectInto(luma, width, height, timestamp, pose, output) {
      output.found = fakeStats.locked;
      output.n = fakeStats.locked ? 25 : 0;
      return R2_SESSION_STATUS.OK;
    },
    alignInto() { return R2_SESSION_STATUS.OK; },
    reset() {},
    projectCellFaceCentres() { return 0; },
  };
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  const luma = { width: 8, height: 8, data: new Float32Array(64) };
  for (let i = 0; i < 100; i += 1) runtime.pushFrame(luma, i * 100);
  assert.equal(runtime.stats.candidateCount, ids.length,
    '락이 살아 있는데 100프레임 뒤 후보가 ' + runtime.stats.candidateCount + '개다 — '
    + '인내가 아직 «bind 이후 총 프레임» 을 센다');
  assert.equal(runtime.stats.binds, 1,
    '100프레임 동안 bind 가 ' + runtime.stats.binds + '회다 — 폐기·재bind 가 반복됐다는 뜻이고, '
    + '그때마다 누적 증거가 0 으로 돌아간다 (운영자 실기 3차 ③)');

  // 반대쪽 자 — 락을 잃으면 인내가 실제로 돈다 (ⓢ 와 같은 축, 여기선 새 뜻으로).
  fakeStats.locked = 0;
  for (let i = 100; i < 145; i += 1) runtime.pushFrame(luma, i * 100);
  assert.equal(runtime.stats.candidateCount, 0,
    '락 없는 프레임이 인내를 넘겼는데 후보가 남았다 — 이제 아무것도 안 센다');
});

test('ⓧ R5 후보별 스캔맵 — 후보 5개가 **각자의** cellCount 로 매핑된다 (옛 코드는 1개뿐)', (t) => {
  const frames = firstFrames('y2', 1);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const a = createA3Adapters({});
  const det = { found: 0, family: 0 };
  a.detectInto(frames[0].data, frames[0].width, frames[0].height, 0, null, det);
  assert.equal(a.stats.locked, 1, '전제: 락');
  const n = a.stats.n;
  const ids = finalLayoutIdsForN(n);
  assert.ok(ids.length >= 3, '전제: n=' + n + ' 은 후보가 여럿이다');

  const counts = ids.map((id) => dataCellsInScanOrderCellSurfaceFinal(n, id).length);
  // 공허 방지 — cellCount 가 전부 같으면 이 자는 아무것도 안 가른다.
  assert.ok(new Set(counts).size > 1,
    '후보들의 cellCount 가 전부 같다 (' + counts.join(',') + ') — 라인업이 바뀌었으면 이 자를 다시 봐라');

  const missed = [];
  for (let k = 0; k < ids.length; k += 1) {
    const cellCount = counts[k];
    const faceLuma = new Uint16Array(cellCount * 3);
    const visible = new Uint8Array(cellCount);
    const out = {
      gatePassed: 0, weightQ15: 0, mismatchCount: 0, matchCount: 0, visibleCount: 0,
    };
    a.alignInto(
      frames[0].data, frames[0].width, frames[0].height, 100, null,
      { found: 1, family: 6, sessionLayoutId: ids[k] },
      out, faceLuma, visible,
    );
    if (a.stats.scanMappedCells !== cellCount) {
      missed.push(ids[k] + ' -> ' + a.stats.scanMappedCells + ' (기대 ' + cellCount + ')');
    }
  }
  assert.deepEqual(missed, [],
    '자기 스캔순서로 표본되지 않은 후보: ' + missed.join(' | ') + '\n'
    + '    어댑터가 락의 레이아웃 하나로만 스캔맵을 세우면 그 한 후보만 참 순서이고 나머지는\n'
    + '    raster 폴백(i = cell % n)이다 — 「후보 여럿을 병렬로 돌려 먼저 풀리는 쪽」이라는\n'
    + '    이 설계의 전제가 나머지 후보에서는 성립하지 않는다.');
});

test('ⓧ-b R5 참 격자만 이긴다 — 후보가 각자 참 순서로 표본해도 «틀린 격자 DONE» 은 0 이다', (t) => {
  /*
   * R5 가 여는 위험을 그대로 잰다: 이제 5개 후보가 **전부** 자기 참 스캔순서로 표본하므로,
   * 「틀린 격자는 raster 폴백이라 어차피 못 푼다」가 더 이상 안전의 근거가 아니다.
   * 안전의 근거는 오직 **본문 RS** 여야 한다 (§23.6 의 전제).
   */
  const frames = firstFrames('y2', 12);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  const wrongDone = [];
  let hit = null;
  for (let i = 0; i < frames.length && hit === null; i += 1) {
    hit = runtime.pushFrame(frames[i], i * 100);
    for (const c of runtime.stats.candidates) {
      if (c.indicator === R2_INDICATOR.DONE && c.layoutId !== 'v0tr') wrongDone.push(c.layoutId);
    }
  }
  assert.deepEqual(wrongDone, [], '틀린 격자가 DONE 을 냈다: ' + wrongDone.join(' '));
  assert.ok(hit && hit.layoutId === 'v0tr' && hit.text === 'https://tl.estre.so',
    '참 격자가 못 이겼다 — ' + JSON.stringify(hit));
});

test('ⓩ R7 표면 — counters·format·phaseMs·bindRevision·lockKey 가 서고, 값이 프레임마다 움직인다', (t) => {
  const fresh = createR2ScanRuntime({ enabled: false });
  for (const k of ['counters', 'format', 'phaseMs', 'bindRevision']) {
    assert.ok(k in fresh.stats, 'stats 에 ' + k + ' 가 없다');
  }
  for (const k of ['hardDrops', 'coastFrames', 'lockClears', 'relocates', 'binds', 'decodeAttempts', 'decodeFailures']) {
    assert.equal(typeof fresh.stats.counters[k], 'number', 'counters 에 ' + k + ' 가 없다');
  }
  for (const k of ['source', 'eccName', 'maskIndex', 'candidateCount']) {
    assert.ok(k in fresh.stats.format, 'format 에 ' + k + ' 가 없다');
  }
  for (const k of ['detect', 'align', 'decode']) {
    assert.equal(typeof fresh.stats.phaseMs[k], 'number', 'phaseMs 에 ' + k + ' 가 없다');
  }
  for (const k of ['bindRevision', 'lockKey']) assert.ok(k in fresh.view, 'view 에 ' + k + ' 가 없다');
  assert.equal(typeof fresh.invalidateLock, 'function', '런타임에 invalidateLock 이 없다 (레인 H 계약)');

  const frames = firstFrames('y2', 3);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  for (let i = 0; i < frames.length; i += 1) runtime.pushFrame(frames[i], i * 100);
  assert.equal(runtime.stats.counters.binds, 1, 'bind 카운터가 안 돈다');
  assert.ok(runtime.stats.bindRevision >= 1, 'bindRevision 이 안 올랐다');
  assert.equal(runtime.view.bindRevision, runtime.stats.bindRevision, 'view 와 stats 의 bind 세대가 다르다');
  assert.equal(runtime.view.lockKey, (runtime.view.lockRevision * 1000) + runtime.stats.bindRevision,
    'lockKey 가 (lockRevision, bindRevision) 에서 유도되지 않는다');
  // 단계 ms 는 «잰 값» 이다 — 0 으로 못박히면 시험판 패널이 아무것도 못 가른다.
  assert.ok(runtime.stats.phaseMs.align > 0, 'align ms 가 0 이다 — 안 재고 있다');
  assert.ok(runtime.stats.phaseMs.detect >= 0 && Number.isFinite(runtime.stats.phaseMs.detect));

  // 🔴 bindRevision 은 «후보 집합이 갈렸다» 를 표현해야 한다 — 폐기도 사건이다.
  const before = runtime.stats.bindRevision;
  runtime.setEnabled(false);
  assert.ok(runtime.stats.bindRevision > before,
    '후보를 통째로 버렸는데 bind 세대가 그대로다 — HUD 비교식(lockRevision·n)이 같은 값이라 '
    + '재사영이 안 일어난다 (운영자 실기 3차 ①)');
});

test('ⓤ-b R1c 락 유지 중 재검출 — 안 움직였으면 옛 락을 지키고, 뚜렷이 움직였으면 다시 건다 (n 같으면 세션 유지)', (t) => {
  /*
   * 옛 거동: 락이 있으면 `detectInto` 가 **옛 H 를 그대로** 돌려줬다. 그래서 코드가
   * 화면에서 움직여도 F 게이트(감도 약함)에 안 걸리는 한 실루엣·격자가 그 자리에 붙어
   * 있었다 — 운영자 실기 3차 ①·④.
   *
   * ⚠ 여기서는 주기를 **1프레임**으로 낮춰 채택 규칙만 단독으로 잰다. 정식 기본값은
   *   RELOCATE_EVERY_FRAMES(=96) · RELOCATE_MIN_GAP_FRAMES(=24) 이고, 그 값의 근거는
   *   재검출 1회의 실측 비용(중앙값 436\~1001 ms)이다 — 어댑터 상수 주석 참조.
   */
  const frames = firstFrames('y2', 1);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const base = frames[0];
  const shiftBy = (src, d) => {
    const out = new Float32Array(src.data.length);
    out.fill(0.5);
    for (let y = 0; y < src.height; y += 1) {
      const ty = y + d;
      if (ty < 0 || ty >= src.height) continue;
      for (let x = 0; x < src.width; x += 1) {
        const tx = x + d;
        if (tx < 0 || tx >= src.width) continue;
        out[ty * src.width + tx] = src.data[y * src.width + x];
      }
    }
    return out;
  };
  const lockOn = () => {
    const a = createA3Adapters({ relocateEveryFrames: 1, relocateMinGapFrames: 0 });
    const det = { found: 0, family: 0 };
    a.detectInto(base.data, base.width, base.height, 0, null, det);
    assert.equal(a.stats.locked, 1, '전제: 락');
    assert.equal(a.stats.n, 25, '전제: y2 는 n=25');
    assert.ok(a.stats.lockF0 > 0, '락 시점 F 가 기록되지 않는다 — 재검출 조건의 기준선이 없다');
    return { a, det };
  };

  // ① 안 움직였다 — 재검출은 **돌지만** 채택하지 않는다. 채택하면 HUD 가 매번 깜빡인다.
  const still = lockOn();
  const revStill = still.a.stats.lockRevision;
  still.a.detectInto(base.data, base.width, base.height, 100, null, still.det);
  assert.equal(still.a.stats.counters.relocates, 1, '주기가 됐는데 재검출을 안 돌렸다');
  assert.equal(still.a.stats.counters.relocateAdopts, 0,
    '같은 프레임인데 새 락을 채택했다 — 잡음마다 락 세대가 올라 HUD 가 깜빡인다');
  assert.equal(still.a.stats.lockRevision, revStill, '채택 안 했는데 세대가 올랐다');
  assert.equal(still.a.stats.locked, 1, '채택 안 했는데 락을 잃었다');

  // ② 뚜렷이 움직였다 — 다시 건다. n 이 같으므로 런타임의 bind 는 유지된다(세션 보존).
  const moved = lockOn();
  const revMoved = moved.a.stats.lockRevision;
  moved.a.detectInto(shiftBy(base, 40), base.width, base.height, 100, null, moved.det);
  assert.equal(moved.a.stats.counters.relocateAdopts, 1,
    '코드가 40 px 움직였는데 옛 H 를 유지했다 — 실루엣·격자가 화면에서 안 따라간다');
  assert.equal(moved.a.stats.lockRevision, revMoved + 1, '다시 걸었는데 세대가 안 올랐다');
  assert.equal(moved.a.stats.n, 25, 'n 이 바뀌었다 — 이 시나리오는 세션 유지여야 한다');
  assert.equal(moved.a.stats.locked, 1);
});

test('ⓩ-b R7 카운터는 재bind 를 건넌다 — 후보를 버려도 «몇 번 있었나» 가 0 으로 안 돌아간다', () => {
  /*
   * 세션 카운터는 세션 수명이다. 런타임이 후보를 버리고 다시 묶으면 새 세션은 0 에서
   * 시작하므로, 합계만 내면 재bind 한 프레임에 「드랍 47회」가 조용히 「0회」가 된다 —
   * HUD 가 «왜 리셋됐나» 를 묻는데 화면이 거짓말을 한다. 은퇴분을 이월하는지 값으로 잰다.
   */
  const ids = finalLayoutIdsForN(25);
  const fakeStats = { n: 25, locked: 1, gridLockF: 0.5, layoutId: ids[0], lockRevision: 1 };
  const fake = {
    stats: fakeStats,
    H: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    detectInto(luma, width, height, timestamp, pose, output) {
      output.found = fakeStats.locked;
      output.n = fakeStats.locked ? 25 : 0;
      return R2_SESSION_STATUS.OK;
    },
    // 게이트를 안 여는 정합 — 세션은 COAST 로 가고 nCoast 뒤 드랍한다.
    alignInto() { return R2_SESSION_STATUS.OK; },
    reset() {},
    projectCellFaceCentres() { return 0; },
  };
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  const luma = { width: 8, height: 8, data: new Float32Array(64) };
  for (let i = 0; i < 40; i += 1) runtime.pushFrame(luma, i * 100);
  const coastBefore = runtime.stats.counters.coastFrames;
  const dropsBefore = runtime.stats.counters.hardDrops;
  assert.ok(coastBefore > 0, '전제: coast 프레임이 쌓였다');
  assert.ok(dropsBefore > 0, '전제: 드랍이 있었다');

  // 락을 잃어 후보가 폐기되고, 다시 잡혀 새로 묶인다.
  fakeStats.locked = 0;
  for (let i = 40; i < 90; i += 1) runtime.pushFrame(luma, i * 100);
  assert.equal(runtime.stats.candidateCount, 0, '전제: 후보가 폐기됐다');
  fakeStats.locked = 1;
  runtime.pushFrame(luma, 9000);
  assert.equal(runtime.stats.candidateCount, ids.length, '전제: 다시 묶였다');

  assert.ok(runtime.stats.counters.coastFrames >= coastBefore,
    'coast 카운터가 재bind 에서 후퇴했다 (' + coastBefore + ' → '
    + runtime.stats.counters.coastFrames + ') — 세션 수명 값을 그대로 합치고 있다');
  assert.ok(runtime.stats.counters.hardDrops >= dropsBefore,
    '드랍 카운터가 재bind 에서 후퇴했다 (' + dropsBefore + ' → '
    + runtime.stats.counters.hardDrops + ')');

  // 반대쪽 — 명시적 reset() 은 정말 0 으로 되돌린다.
  runtime.reset();
  assert.equal(runtime.stats.counters.coastFrames, 0, 'reset 이 카운터를 안 비웠다');
  assert.equal(runtime.stats.counters.hardDrops, 0);
});

/*
 * ── 2026-09-06 검토 R3c — 생애주기 결함 1·3·9b·8 의 자 ──────────────────────────
 * 전부 **코퍼스가 못 만드는 상태**라 가짜 어댑터로 만든다(ⓝ 와 같은 수법).
 */
function lifecycleAdapters(n = 13, layoutId = 'v0') {
  const stats = {
    n, locked: 1, gridLockF: 500, layoutId, lockRevision: 1,
    // 프레임 신원(timestamp)으로 «조금씩 넓히는» 관측을 만든다 — 위 alignInto 참조.
    frameIndex: 0, lastStamp: NaN,
    counters: { lockClears: 0, relocates: 0 },
    phaseMs: { detect: 0, align: 0 },
    format: {
      source: 'locator', eccName: 'H', maskIndex: 0, candidateCount: 1, formatWireVersion: 2, reason: '',
    },
  };
  return {
    stats,
    H: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    detectInto(luma, width, height, timestamp, pose, output) {
      output.found = stats.locked ? 1 : 0;
      output.n = stats.locked ? stats.n : 0;
      output.layoutId = stats.layoutId;
      return R2_SESSION_STATUS.OK;
    },
    /*
     * 🔴 정합이 **실제로 증거를 쌓는다 — 그것도 조금씩.** 안 쌓으면 「선반에서 되살렸다」와
     * 「똑같이 다시 묶었다」가 구분되지 않는다: 후보 수도 레이아웃 집합도 같기 때문이다
     * (돌연변이로 확인했다 — `restoreShelf()` 를 `shelveAndBind()` 로 바꿔도 그 두 단언은 초록이었다).
     * 가르는 것은 **누적된 D** 하나다. 그리고 한 프레임에 전 셀을 주면 D 가 곧바로 1 에 붙어
     * 역시 아무것도 안 갈리므로, 프레임마다 **보이는 셀을 조금씩 넓힌다**.
     */
    alignInto(luma, width, height, timestamp, pose, detection, output, faceLuma, visibleCells) {
      if (timestamp !== stats.lastStamp) {
        stats.lastStamp = timestamp;
        stats.frameIndex += 1;
      }
      const total = visibleCells.length;
      const step = Math.max(1, Math.ceil(total / 40));
      const limit = Math.min(total, stats.frameIndex * step);
      output.gatePassed = 1;
      output.weightQ15 = Q15_ONE;
      output.mismatchCount = 0;
      output.matchCount = limit;
      output.visibleCount = limit;
      for (let cell = 0; cell < limit; cell += 1) {
        visibleCells[cell] = 1;
        faceLuma[cell * 3] = 255;
        faceLuma[cell * 3 + 1] = 128;
        faceLuma[cell * 3 + 2] = 0;
      }
      return R2_SESSION_STATUS.OK;
    },
    reset() {},
    projectCellFaceCentres() { return 0; },
    invalidateLock() { return 1; },
  };
}

test('ⓞ 결함 1 — 같은 n 이라도 **포맷이 바뀐 재락**은 다시 묶는다 (mask 0 세션으로 mask 2 코드를 영원히 못 풀던 결함)', () => {
  const fake = lifecycleAdapters(13, 'v0');
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  const luma = { width: 4, height: 4, data: new Float32Array(16) };

  runtime.pushFrame(luma, 0);
  assert.equal(runtime.stats.candidateCount, finalLayoutIdsForN(13).length, '전제: 묶였다');
  assert.equal(runtime.stats.format.maskIndex, 0, '전제: mask 0 으로 묶였다');
  const bindsAfterFirst = runtime.stats.binds;

  // 같은 포맷이 계속 오면 **다시 묶지 않는다** (공허 방지 — 매 프레임 재bind 면 아래가 무의미하다).
  for (let i = 1; i < 5; i += 1) runtime.pushFrame(luma, i * 100);
  assert.equal(runtime.stats.binds, bindsAfterFirst, '포맷이 그대로인데 매 프레임 다시 묶는다');

  // 재락이 다른 mask 를 읽었다 — «다른 코드» 이므로 폐기가 옳다.
  fake.stats.format.maskIndex = 2;
  fake.stats.lockRevision += 1;
  runtime.pushFrame(luma, 500);
  assert.ok(runtime.stats.binds > bindsAfterFirst,
    '포맷이 바뀐 재락에서 다시 묶지 않았다 — mask 0 layout 으로 mask 2 코드를 영원히 못 푼다');
  assert.equal(runtime.stats.format.maskIndex, 2, 'stats 가 새 mask 를 안 말한다');

  // 반대쪽 — 포맷을 **못 읽은** 재락은 「모른다」이지 「다르다」가 아니다. 증거를 버리면 안 된다.
  const bindsAfterSwap = runtime.stats.binds;
  fake.stats.format.source = 'default';
  fake.stats.format.eccName = '';
  fake.stats.lockRevision += 1;
  for (let i = 0; i < 3; i += 1) runtime.pushFrame(luma, 600 + i * 100);
  assert.equal(runtime.stats.binds, bindsAfterSwap,
    '포맷 읽기 실패를 «다른 코드» 로 읽었다 — 읽기가 흔들릴 때마다 증거가 사라진다');
});

test('ⓟ 결함 3·9b — n 이 한 프레임 튀었다 돌아오면 **선반**에서 옛 후보가 되살아난다', () => {
  const fake = lifecycleAdapters(25, 'v0t');
  const runtime = createR2ScanRuntime({ enabled: true, adapters: fake });
  const luma = { width: 4, height: 4, data: new Float32Array(16) };

  for (let i = 0; i < 5; i += 1) runtime.pushFrame(luma, i * 100);
  const n25Count = runtime.stats.candidateCount;
  assert.equal(n25Count, finalLayoutIdsForN(25).length, '전제: n=25 로 묶였다');
  const shelvedSessions = runtime.stats.candidates.map((c) => c.layoutId).join(' ');
  const shelvedD = runtime.stats.progressD;
  assert.ok(shelvedD > 0, '전제: n=25 후보가 증거를 쌓았다 (' + shelvedD + ') — 안 쌓으면 아래가 공허하다');
  /*
   * 🔴 **가르는 자는 셀맵 버퍼의 정체성**이다. 후보 수도 레이아웃 집합도 새로 묶으면 똑같고,
   * D 크기 비교는 n 마다 분모가 달라 신뢰할 수 없다(n=13 은 요구 심볼이 적어 같은 프레임 수에서
   * 오히려 D 가 높다 — 실측으로 확인했다). 선반은 **세션 객체 그대로**를 되살리므로 그 세션의
   * 누적 버퍼가 같은 객체여야 한다. 새로 묶으면 반드시 다른 객체다.
   */
  const shelvedCellMap = runtime.view.cellMap;
  assert.ok(shelvedCellMap instanceof Uint8Array, '전제: 뷰가 선두 후보의 셀맵을 낸다');

  /*
   * 잡음 한 프레임 — 로케이터가 n=13 을 낸다. 새 n 으로 **곧바로** 묶는다(진짜 코드 교체에서
   * 가장 좋은 첫 프레임을 버리지 않기 위해 — 창 스윕에서 「지연」안이 창 하나를 잃었다).
   * 대신 옛 후보는 버리지 않고 얼린다.
   */
  fake.stats.n = 13;
  fake.stats.layoutId = 'v0';
  runtime.pushFrame(luma, 500);
  assert.equal(runtime.stats.candidateCount, finalLayoutIdsForN(13).length,
    '새 n 으로 즉시 안 묶는다 — 진짜 코드 교체에서 가장 좋은 프레임을 버린다');
  assert.notEqual(runtime.view.cellMap, shelvedCellMap, '전제: 새 n 은 다른 세션이다');

  // 돌아왔다 — 얼린 세션 **그대로** 되살아나야 한다 (새로 만든 것이 아니다).
  fake.stats.n = 25;
  fake.stats.layoutId = 'v0t';
  runtime.pushFrame(luma, 600);
  assert.equal(runtime.stats.candidateCount, n25Count, '되돌아온 n 의 후보 수가 다르다');
  assert.equal(runtime.stats.candidates.map((c) => c.layoutId).join(' '), shelvedSessions,
    '되살린 후보의 레이아웃 집합이 다르다');
  assert.equal(runtime.view.cellMap, shelvedCellMap,
    '되살린 셀맵이 **다른 버퍼**다 — 선반이 아니라 새로 묶었다. 잡음 한 프레임이 수백 프레임 치 증거를 죽인다');
  assert.ok(runtime.stats.progressD >= shelvedD,
    '되살린 뒤 D 가 ' + runtime.stats.progressD + ' 로 떨어졌다 (얼린 값 ' + shelvedD + ')');

  /*
   * 반대쪽 — 확인 창(BIND_N_CONFIRM_FRAMES)을 넘겨 안 돌아오면 선반은 **버려진다**.
   * 그때의 복귀는 새 bind 여야 한다 (얼린 증거를 무한정 들고 있으면 그게 오염이다).
   */
  const late = lifecycleAdapters(25, 'v0t');
  const other = createR2ScanRuntime({ enabled: true, adapters: late });
  for (let i = 0; i < 5; i += 1) other.pushFrame(luma, i * 100);
  const lateCellMap = other.view.cellMap;
  assert.ok(lateCellMap instanceof Uint8Array, '전제: 두 번째 런타임도 묶였다');
  late.stats.n = 13;
  late.stats.layoutId = 'v0';
  for (let i = 5; i <= 12; i += 1) other.pushFrame(luma, i * 100);
  late.stats.n = 25;
  late.stats.layoutId = 'v0t';
  other.pushFrame(luma, 1300);
  assert.notEqual(other.view.cellMap, lateCellMap,
    '확인 창을 넘겼는데도 옛 세션이 되살아났다 — 얼린 증거를 무한정 들고 있으면 그게 오염이다');
});

test('ⓠ ⚠ 철자 자 — unframe 실패 경로가 세션의 complete 를 되돌린다 (결함 8 의 배선)', () => {
  /*
   * 값 자는 세션 쪽에 있다(`r2-session.test.js` 의 rejectPayload 자). 여기서는 **배선**만 본다 —
   * 「RS 는 섰는데 프레이밍이 막는」 프레임을 가짜 어댑터로 만들려면 복호 가능한 심볼열을 통째로
   * 합성해야 하고, 그 자는 이 파일의 층이 아니다. 철자 자인 이유를 이렇게 적어 둔다.
   */
  const RUNTIME_SRC = readFileSync(ROOT + 'src/r2-scan-runtime.js', 'utf8');
  const at = RUNTIME_SRC.indexOf('text = unframe(');
  assert.ok(at > 0, 'unframe 호출을 못 찾았다 — 이 자가 죽었다');
  const tail = RUNTIME_SRC.slice(at, at + 900);
  assert.ok(tail.includes('rejectPayload()'),
    'unframe 실패 경로가 rejectPayload 를 안 부른다 — 「세션은 살려 둔다」 주석이 다시 거짓이 된다');
});

test('ⓡ 결함 10 — `phaseMs.detect` 는 **프레임 안의 로케이터 실행 시간 합**이다 (프레임 중간 재검출이 0 을 남기던 결함)', (t) => {
  /*
   * 🔴 무엇이 문제였나: 어댑터는 `if (newFrame) phaseMs.detect = …` 로 프레임의 **첫**
   * `detectInto` 만 기록했다. 그런데 락이 프레임 중간에 풀리면 (정합 미스 경로가 `clearLock`)
   * **다음 후보 세션의 detectInto** 가 그 프레임 안에서 로케이터를 통째로 돌린다 — 그때
   * `newFrame=0` 이라 화면의 det 는 **0** 이었다. 실측(수정 전 y2@066): f8 pushFrame 298.0 ms ↔
   * 단계 [0, 2.7, 0] · 미계상 295.3 ms. 단계별 ms 는 정확히 「왜 멈췄나」를 가르려고 만든 수인데
   * **그 프레임에서** 거짓말을 했다.
   *
   * 자는 **어댑터를 직접** 몬다: 같은 timestamp(= 한 프레임) 안에서 락을 풀고 다시 검출하면
   * 로케이터가 두 번 도므로, `phaseMs.detect` 는 첫 값보다 **커야** 한다. 런타임을 통해 재면
   * 이 상태가 코퍼스 창에 안 나타날 수도 있어(다른 수정들이 그 프레임을 없앴다) 공허해진다.
   */
  const frames = firstFrames('y2', 1, 66);
  if (!frames) { t.skip('휘도 덤프 없음 — 통합자 기기에서만 돈다'); return; }
  const luma = frames[0];
  const adapters = createA3Adapters({});
  const det = { found: 0, family: 0, n: 0 };

  adapters.detectInto(luma.data, luma.width, luma.height, 0, null, det);
  const firstDetect = adapters.stats.phaseMs.detect;
  assert.ok(firstDetect > 0, '전제: 첫 검출이 로케이터를 돌렸다 (' + firstDetect + ' ms)');

  // 같은 프레임(같은 timestamp) 안에서 락이 풀리고 다음 세션이 다시 검출한다.
  adapters.invalidateLock();
  adapters.detectInto(luma.data, luma.width, luma.height, 0, null, det);
  assert.ok(adapters.stats.phaseMs.detect > firstDetect,
    '한 프레임 안의 두 번째 로케이터 실행이 det 에 안 실린다 ('
    + adapters.stats.phaseMs.detect + ' ≤ ' + firstDetect + ') — 시험판 패널이 그 프레임에서 0 을 보인다');
  assert.ok(adapters.stats.phaseMs.detect >= firstDetect + adapters.stats.lastDetectMs * 0.5,
    'det 가 «합» 이 아니라 «마지막 값» 이다');

  // 그리고 다음 프레임에서는 0 부터 다시 센다 (누적이 페이지 수명 동안 자라면 그것도 거짓말이다).
  adapters.detectInto(luma.data, luma.width, luma.height, 100, null, det);
  assert.ok(adapters.stats.phaseMs.detect <= adapters.stats.lastDetectMs + 1e-6,
    'det 가 프레임 경계에서 0 으로 안 돌아간다 — 값이 프레임이 아니라 세션 누적이 된다');
});

test('ⓢ 결함 10-b — 파이프라인 수준: 비싼 프레임의 시간이 단계 합으로 설명된다', (t) => {
  /*
   * ⓡ 이 어댑터 계약이라면 이것은 **런타임까지 이어졌는가** 다 (런타임이 어댑터의 누적값을
   * 읽는가 — 자기 계측으로 덮으면 다시 첫 호출만 남는다).
   * ⚠ 이 자는 **프레임 중간 재검출을 더는 안 탄다**: 같은 커밋의 락 설치 게이트·붕괴 재검출
   *   수정이 y2@066 에서 그 프레임을 없앴다(수정 전 f2·f8 → 수정 후 f2·f6 이고 둘 다 프레임의
   *   **첫** 호출이다). 그래서 이것은 ⓡ 의 대체가 아니라 **회귀 가드**다 — 어느 쪽 경로로
   *   비싸지든 화면이 그 시간을 설명해야 한다.
   */
  const frames = firstFrames('y2', 10, 66);
  if (!frames) { t.skip('휘도 덤프 없음'); return; }
  const runtime = createR2ScanRuntime({ enabled: true });
  let expensiveFrames = 0;
  for (let i = 0; i < frames.length; i += 1) {
    const t0 = performance.now();
    const hit = runtime.pushFrame(frames[i], i * 100);
    const wall = performance.now() - t0;
    const phase = runtime.stats.phaseMs;
    const accounted = phase.detect + phase.align + phase.decode;
    if (wall > 50) {
      expensiveFrames += 1;
      const unaccounted = (wall - accounted) / wall;
      // 절대 ms 가 아니라 **비율** — 기계 속도에 안 묶인다. 수정 전 0.98 vs 수정 후 ≈0.03.
      assert.ok(unaccounted < 0.5,
        'f' + i + ' 가 ' + wall.toFixed(1) + ' ms 인데 단계 합이 ' + accounted.toFixed(1)
        + ' ms 다 (미계상 ' + (unaccounted * 100).toFixed(0) + '%) — 패널이 「왜 멈췄나」를 못 가른다');
    }
    if (hit) break;
  }
  assert.ok(expensiveFrames >= 1,
    '이 창에 50 ms 넘는 프레임이 없다 — 자가 아무것도 안 쟀다 (기계나 코퍼스가 바뀌었으면 창을 다시 골라라)');
});

/*
 * ── 3d 1440 승격(escalate) 의 자리 ────────────────────────────────────────────
 *
 * 🔴 **이 자는 시키는 대로 안 적었다 — 그 명제가 거짓이기 때문이다.**
 *
 * 레인 브리프가 요구한 명제는 「`scheduleNextEscalationAt` / `nextEscalationAt` 대입이 R1 블록
 * (`if (!r2Runtime.enabled) {`) **안에만** 있다」였다. 소스를 열어 세면 대입은 다섯 자리이고
 * **R1 블록 안에는 하나도 없다** — 전부 함수 셋에 있다:
 *   · 선언(`let nextEscalationAt = null`) · `resetFailureTiming`(비우기)
 *   · `grabVideoFrame` 2자리(승격 프레임을 실제로 잡았을 때 다음 시각 예약)
 *   · `handleDecodeResult` 1자리(카메라 실패 스트릭이 시작될 때)
 * 그리고 **R2 블록이 그 둘을 다 부른다**: 자기 `grabVideoFrame(r2FrameStartedAt)` 을 부르고,
 * 거부된 적중(비컨만·빈 페이로드)은 `handleDecodeResult` 의 실패 분기를 탄다. 즉
 * **«R2 는 escalate 프레임을 만들지 않는다» 는 거짓**이다 — 승격 사다리는 두 엔진이 **공유**한다
 * (실기 관측 「K1 은 1440 승격으로 읽힘」이 그 공유의 산물이다).
 *
 * 그래서 잠그는 명제를 바꿔 적는다: **R2 는 자기 승격 사다리를 «만들지» 않고, 공유되는 그 사다리는
 * 함수 셋 안에만 산다.** 새 대입이 어디든 생기면 이 자가 빨개진다 — 그때 물어야 할 것은
 * 「그 자리를 두 엔진 중 누가 밟나」다.
 *
 * ⚠ **철자 자**(브라우저 밖에서 실행 불가). 재는 것은 값이 아니라 소스의 배치다.
 */
test('ⓢ ⚠ 철자 자 — 1440 승격 예약은 함수 셋 안에만 있고, R2 블록은 자기 예약을 안 만든다 (사다리는 **공유**다)', () => {
  const js = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

  // ① 대입의 **전수**와 그 자리. 위치는 「가장 가까운 앞선 최상위 function」으로 정한다.
  const fns = [...js.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)\s*\(/gm)]
    .map((m) => ({ at: m.index, name: m[1] }));
  assert.ok(fns.length > 20, '최상위 함수를 ' + fns.length + '개만 찾았다 — 훑기가 깨졌다');
  const sites = [];
  for (const m of js.matchAll(/nextEscalationAt\s*=/g)) {
    const owner = fns.filter((f) => f.at < m.index).pop();
    sites.push(owner ? owner.name : '(top)');
  }
  assert.deepEqual(sites, ['(top)', 'resetFailureTiming', 'grabVideoFrame', 'grabVideoFrame', 'handleDecodeResult'],
    '1440 승격 예약의 자리가 바뀌었다. 새 자리가 생겼다면 물어라 — **그 자리를 R2 도 밟나?** '
    + '(R2 블록은 grabVideoFrame 과 handleDecodeResult 를 둘 다 부른다)');

  // ② R2 블록 본문에는 예약이 **없다** — R2 가 자기 사다리를 만들지 않는다.
  const at = js.indexOf('if (r2Runtime.enabled) {');
  assert.ok(at > 0, '프레임 루프의 R2 블록이 없다');
  let depth = 0;
  let end = at;
  for (let i = js.indexOf('{', at); i < js.length; i += 1) {
    if (js[i] === '{') depth += 1;
    else if (js[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  const block = js.slice(at, end);
  assert.ok(!/nextEscalationAt\s*=/.test(block),
    'R2 블록이 자기 승격 예약을 만든다 — 그러면 두 엔진이 서로 다른 사다리를 탄다');
  assert.ok(!/scheduleNextEscalationAt\(/.test(block),
    'R2 블록이 승격 시각을 직접 잡는다');

  /*
   * ③ 그러나 **공유는 사실이다.** 이 두 단언이 없으면 ② 가 「R2 는 승격을 안 한다」로 읽힌다 —
   * 그것이 이 파일이 고쳐 적은 바로 그 오해다.
   */
  assert.ok(/grabVideoFrame\(r2FrameStartedAt\)/.test(block),
    'R2 블록이 grabVideoFrame 을 안 부른다 — 그렇다면 ③ 의 «공유» 서술이 낡았다');
  assert.ok(/handleDecodeResult\(/.test(block),
    'R2 블록이 handleDecodeResult 를 안 부른다 — 그렇다면 ③ 의 «공유» 서술이 낡았다');
});
