/**
 * r2-framing-guard.test.js — R2 수용 경로의 프레이밍 검증.
 *
 * 🔴 왜 있나 (2026-09-03 실측): R2 누적 복호의 수용 판정에 정합 검사가
 * «빈 페이로드 ∧ 정정>0» **하나뿐**이었다. 그래서 **내용 있는 쓰레기가
 * 확신에 찬 DONE 으로 통과**했다 — 시퀀스 y0(단발 0/108)을 세션에 구동하니
 * ecc×tones×mask 18조합 중 2조합이 프레임 6에서 DONE 을 내고 페이로드가
 * `\x17\x13öÓ§µ…` 였다. 사용자에게는 «스캔 성공» 으로 보인다.
 *
 * R1(`decodeFrontend`)에는 이 방어가 이미 있었다 — PM/030 §10 이 잰 대로
 * 프레이밍 3층(base211·header·utf8)이 쓰레기를 전량 막는다. R2 만 없었다.
 * 고침은 와이어 변경이 아니라 R1 의 `unframe` 을 그대로 부르는 것이다.
 *
 * 선례: test/seq-truth.test.js · test/decoder-frontend.test.js — 덤프 없으면 skip.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unframe } from '../src/header.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';
import { dataCellsInScanOrderCellSurfaceFinal, capacityForCellSurfaceFinal } from '../src/cellSurfaceFinal.js';
import { maskValue } from '../src/mask.js';
import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import { R2_INDICATOR, createR2Session } from '../src/r2/session.js';

// ── 성질 (덤프 없이도 돈다) ──
// R2 가 부르는 바로 그 함수가 두 가지를 거부하는지 잠근다. 이 둘이 y0 오수용을 죽였다.
test('unframe 이 «길이 초과» 와 «비-UTF-8» 을 거부한다 — R2 가 부르는 그 함수다', () => {
  // 길이 필드가 가용 바이트를 넘는다.
  assert.throws(() => unframe(Uint8Array.from([9, 1, 2])), RangeError, '길이 초과');
  // 유효한 UTF-8 이 아니다 (0xF6 0xD3 … 는 y0 오수용 페이로드의 실제 바이트다).
  assert.throws(() => unframe(Uint8Array.from([3, 0xf6, 0xd3, 0xa7])), RangeError, '비-UTF-8');
  // 정상 프레임은 통과한다 — 이 자가 «전부 거부» 로 공허하게 통과하지 않게.
  const ok = unframe(Uint8Array.from([2, 0x68, 0x69, 0, 0]));
  assert.equal(ok.text, 'hi');
});

// ── 회귀 (실물 시퀀스) ──
test('R2 세션이 y0 에서 오수용을 내지 않는다', { timeout: 1_800_000 }, (t) => {
  const seq = listLumaSequences().find((s) => s.name.split('/').pop() === 'y0');
  if (!seq || !seq.frames.length) {
    t.skip('휘도 덤프 없음 (test/output 은 gitignore) — 통합자 기기에서만 돈다');
    return;
  }
  const N = 13;
  const LAYOUT = 'v0';
  const scan = dataCellsInScanOrderCellSurfaceFinal(N, LAYOUT);
  const frames = seq.frames.slice(0, 40);
  let falseAccepts = 0;

  for (const ecc of ['L', 'M', 'H']) {
    const cap = capacityForCellSurfaceFinal(N, ecc, 2, LAYOUT);
    for (const maskIndex of [0, 1, 2]) {
      const maskDigits = new Uint8Array(scan.length);
      for (let k = 0; k < scan.length; k += 1) maskDigits[k] = maskValue(scan[k].i, scan[k].j, maskIndex);
      const adapters = createA3Adapters({ n: N, relocateEveryFrame: false });
      const session = createR2Session({
        layout: {
          cellCount: scan.length,
          requiredSymbolCount: cap.dataSymbols,
          nsym: cap.nsym,
          maskDigits,
          maxPayloadBytes: cap.maxPayloadBytes,
          payloadBytes: cap.maxPayloadBytes,
        },
        detectInto: adapters.detectInto,
        alignInto: adapters.alignInto,
        decodeInto: createRsDecodeInto({ codewordCapacity: Math.floor(scan.length / 3) }),
      });
      let done = false;
      let i = 0;
      for (const f of frames) {
        const d = readLumaDump(f.path);
        const r = session.pushFrame(d.data, d.width, d.height, i * 100, null);
        if (r.indicator === R2_INDICATOR.DONE) { done = true; break; }
        i += 1;
      }
      if (!done) continue;
      // DONE 이 났다면 본문이 정상 프레이밍이어야 한다. y0 의 정답은 미확인이지만
      // «유효한 UTF-8 · 길이 타당» 은 정답을 몰라도 요구할 수 있다.
      const res = session.result;
      const bytes = Uint8Array.from(res.payload.slice(0, res.payloadLength));
      try { unframe(bytes); } catch { falseAccepts += 1; }
    }
  }
  assert.equal(falseAccepts, 0, `y0 오수용 ${falseAccepts}건 — 프레이밍 검증이 뚫렸다`);
});
