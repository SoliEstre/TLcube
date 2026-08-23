/**
 * format-failure-summary.test.js — F-24/F-25 «라벨 정직» 회귀.
 *
 * 무엇을 재나:
 *   ① summarizeFormatFailures 계수 규칙 (접힌 라벨을 종류별로 펴는 자).
 *   ② 실패 프레임의 detail 에 formatFailureSummary 가 실제로 실린다 (실사진 실측 —
 *      코퍼스에서 no-format-candidate 프레임을 동적으로 찾아 잰다. 특정 덤프 이름에
 *      앵커하지 않는 이유는 F-105 — 덤프는 자(尺)라 조용히 재생성될 수 있다).
 *
 * F-24 의 판정 규칙(«clipped > crc 일 때만 symbol-clipped 주장»)은 ① 의 계수가
 * 정하고, 라벨 분포의 전/후 변화는 코퍼스 census(test/output/lanes/nfc-census.mjs)
 * 재측정으로 본다 — census 는 테스트가 아니라 계측이다 (수치는 PM/022 기록).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeFormatFailures } from '../src/decoder/bootstrap.js';
import { FRONTEND_FAILURE } from '../src/decoder/contracts.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../tools/read-luma.mjs';

function crcFailure() {
  return { detail: { cause: 'format-crc-no-candidate' } };
}
function crcClippedPartialFailure() {
  // 부분 잘림의 CRC 위장 — 소거 9~14/15 + 첫 실패 clipped (zoom×2 합성 실측 형상).
  return {
    detail: {
      cause: 'format-crc-no-candidate',
      erasedFormatCells: 12,
      firstFormatCellFailure: { reason: FRONTEND_FAILURE.SYMBOL_CLIPPED },
    },
  };
}
function clippedFailure() {
  return {
    detail: {
      cause: 'all-format-cells-unsampled',
      firstFormatCellFailure: { reason: FRONTEND_FAILURE.SYMBOL_CLIPPED },
    },
  };
}
function starvedFailure() {
  return {
    detail: {
      cause: 'all-format-cells-unsampled',
      firstFormatCellFailure: { reason: FRONTEND_FAILURE.SAMPLE_STARVED },
    },
  };
}

test('계수 규칙 — CRC 지배 프레임은 dominant=crc (PM/020 의 20/33 구도)', () => {
  const failures = [
    ...Array.from({ length: 20 }, crcFailure),
    ...Array.from({ length: 11 }, clippedFailure),
    ...Array.from({ length: 2 }, starvedFailure),
  ];
  const summary = summarizeFormatFailures(failures);
  assert.deepEqual(summary.counts, {
    clipped: 11, clippedPartial: 0, starved: 2, crc: 20, illegalTone: 0, other: 0,
  });
  assert.equal(summary.dominant, 'crc');
  assert.equal(summary.total, 33);
  // F-24 판정축: 이 구도에서는 잘림 증거가 clean-CRC 를 못 이긴다 — clipped 주장 금지.
  assert.equal(summary.clipEvidenceDominates, false);
});

test('계수 규칙 — 투영 실패 지배 프레임은 dominant=clipped (진짜 잘림의 서명)', () => {
  const failures = [
    ...Array.from({ length: 25 }, clippedFailure),
    ...Array.from({ length: 5 }, crcFailure),
  ];
  const summary = summarizeFormatFailures(failures);
  assert.equal(summary.dominant, 'clipped');
  assert.equal(summary.clipEvidenceDominates, true);
});

test('계수 규칙 — 부분소거 CRC 는 중립이다 (zoom×2 78/78 구도는 통과, 프레임-안 구도는 불통)', () => {
  /*
   * 실측 2건이 판정축을 고정한다 (2026-08-23):
   *   · zoom×2 합성(진짜 잘림): 전부소거 78 + 부분소거-CRC 78 · clean-CRC 0.
   *     부분을 clean-CRC 로 오산하면 78>78 동률로 진다(v1 결함) — 부분을 분리만
   *     해도 78>0 으로 통과한다. 부분을 잘림 증거로 «합산» 할 필요가 없다.
   *   · cellmask-tele 코퍼스(이미지로 «심볼 프레임 안» 실증, PM/020): 부분소거를
   *     합산하는 v2 는 이 세션 8장을 잘림으로 되뒤집었다 — census 로 기각.
   * 그래서 부분소거는 어느 접시에도 안 올린다 — 애매 증거는 주장을 못 만든다.
   */
  const zoomLike = summarizeFormatFailures([
    ...Array.from({ length: 78 }, clippedFailure),
    ...Array.from({ length: 78 }, crcClippedPartialFailure),
  ]);
  assert.equal(zoomLike.counts.clippedPartial, 78);
  assert.equal(zoomLike.counts.crc, 0);
  assert.equal(zoomLike.clipEvidenceDominates, true, 'zoom×2 구도 — 전부소거 78 > cleanCRC 0');

  const frameInsideLike = summarizeFormatFailures([
    ...Array.from({ length: 10 }, clippedFailure),
    ...Array.from({ length: 60 }, crcClippedPartialFailure),
    ...Array.from({ length: 30 }, crcFailure),
  ]);
  assert.equal(frameInsideLike.clipEvidenceDominates, false,
    '부분소거 60이 합산되면 과주장 — 전부소거 10 vs cleanCRC 30 으로 판정해야 한다');
});

test('계수 규칙 — 빈 입력·미지 형태는 안전하게 0/other 로', () => {
  assert.deepEqual(summarizeFormatFailures([]).total, 0);
  assert.equal(summarizeFormatFailures(undefined).dominant, null);
  const odd = summarizeFormatFailures([{ detail: { cause: 'no-version-indices-for-geometry' } }]);
  assert.equal(odd.counts.other, 1);
});

test('실사진 — no-format-candidate 실패 detail 에 요약이 실린다', { timeout: 300_000 }, () => {
  /*
   * 코퍼스를 앞에서부터 훑어 no-format-candidate 프레임을 찾는다 (동적 앵커).
   * PM/020 실측 기준 71/359 이므로 상한 60장이면 사실상 반드시 나온다 — 안 나오면
   * 코퍼스가 통째로 바뀐 것이니 메시지대로 재앵커하라.
   */
  const dumps = listLumaDumps();
  let found = null;
  for (const entry of dumps.slice(0, 60)) {
    const result = decodeFrontend(lumaToRaster(readLumaDump(entry.path)));
    if (!result.ok && result.reason === 'frontend:no-format-candidate') {
      found = { name: entry.name, result };
      break;
    }
  }
  assert.ok(found,
    '앞 60장에서 no-format-candidate 가 한 장도 없다 — 코퍼스가 바뀌었으니 이 테스트를 재앵커하라');
  // frontend 봉투는 bootstrap detail 을 `cause` 로 감싼다 — 두 자리 모두 조회.
  const detail = found.result.detail || {};
  const summary = detail.formatFailureSummary
    || (detail.cause && detail.cause.formatFailureSummary);
  assert.ok(summary, found.name + ': 실패 detail 에 formatFailureSummary 가 없다');
  assert.ok(summary.total > 0, found.name + ': 요약이 비어 있다');
  assert.ok(summary.dominant !== null);
});
