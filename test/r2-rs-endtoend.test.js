import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesToSymbols } from '../src/base211.js';
import { rsEncode } from '../src/rs211.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import { DIGIT_FACE_ORDER } from '../src/r2/rank-likelihood.js';
import { R2_INDICATOR, R2_SESSION_STATUS, createR2Session } from '../src/r2/session.js';

/*
 * R2 세션 **끝단 왕복** — 셀 휘도부터 페이로드 바이트까지.
 *
 * ## 왜 이 테스트인가
 *
 * `test/r2-decode-rs.test.js` 는 `decodeInto` 를 **직접** 부른다. 그건 「RS 가 맞다」를
 * 재지 「세션을 통과한다」를 재지 않는다. 그 사이에는 층이 셋 더 있다:
 *   faceLuma → rank-likelihood(6상태) → accumulate(셀 점수) → materializeSymbols(GF(211))
 * 각 층이 **자기 테스트에서는 초록인데 이어 붙이면 어긋나는** 것이 이 프로젝트의 반복
 * 실패 유형이다 (보드 p-r2-remaining 의 「RS 를 세션에 연결」이 이 자리다).
 *
 * ## 재료를 만드는 법 (사본을 만들지 않는다)
 *
 * 심볼 → 셀 3개의 사상은 `materializeSymbolsInto` 가 **base-6** 으로 정의한다:
 *   value = digit0·36 + digit1·6 + digit2   (합법 범위 0\~210)
 * digit → 면 밝기 순서는 `DIGIT_FACE_ORDER` 가 정본이다 (밝은→중간→어두운, T=0·L=1·R=2).
 * 둘 다 **가져다 쓴다** — 여기서 표를 다시 적으면 규약이 바뀔 때 조용히 갈린다.
 *
 * ⚠ 세션 기본값은 여전히 **스텁**이다. 이 테스트는 `decodeInto` 를 명시 주입한다 —
 *    운영 동작을 바꾸지 않으면서 「연결하면 실제로 통과한다」를 증명하는 자리다.
 */

const PAYLOAD = new Uint8Array([0x54, 0x4c, 0x63, 0x75, 0x62, 0x65]); // "TLcube"
const NSYM = 8;
const Q15_ONE = 32767;
/** 밝은·중간·어두운 — 셋이 뚜렷이 갈려야 rank 가 흔들리지 않는다. */
const LUMA_BY_RANK = [230, 128, 25];

function buildCodeword() {
  const message = bytesToSymbols(PAYLOAD);
  const codeword = rsEncode(message, NSYM);
  for (const v of codeword) {
    assert.ok(v >= 0 && v <= 210, `코드워드 심볼 ${v} 가 GF(211) 밖이다`);
  }
  return { message, codeword };
}

/** 코드워드를 «셀 휘도» 로 되돌린다 — 스캐너가 봤을 그림에 해당한다. */
function paintFaceLuma(codeword, faceLuma, visibleCells, damage = undefined) {
  for (let symbol = 0; symbol < codeword.length; symbol += 1) {
    const value = codeword[symbol];
    const digits = [Math.floor(value / 36), Math.floor(value / 6) % 6, value % 6];
    for (let k = 0; k < 3; k += 1) {
      const cell = symbol * 3 + k;
      const digit = damage !== undefined && damage.has(cell)
        ? damage.get(cell) : digits[k];
      for (let rank = 0; rank < 3; rank += 1) {
        const face = DIGIT_FACE_ORDER[digit * 3 + rank];
        faceLuma[cell * 3 + face] = LUMA_BY_RANK[rank];
      }
      visibleCells[cell] = 1;
    }
  }
}

function createSession(codeword, options = undefined) {
  const opts = options ?? {};
  const symbolCount = codeword.length;
  const stats = { detect: 0, align: 0 };

  const detectInto = (luma, width, height, timestamp, pose, output) => {
    stats.detect += 1;
    output.found = 1;
    output.family = 7;
    return R2_SESSION_STATUS.OK;
  };
  const alignInto = (
    luma, width, height, timestamp, pose, detection, output, faceLuma, visibleCells,
  ) => {
    stats.align += 1;
    output.gatePassed = 1;
    output.weightQ15 = Q15_ONE;
    output.mismatchCount = 0;
    output.matchCount = 0;
    output.visibleCount = visibleCells.length;
    paintFaceLuma(codeword, faceLuma, visibleCells, opts.damage);
    return R2_SESSION_STATUS.OK;
  };

  const session = createR2Session({
    layout: {
      cellCount: symbolCount * 3,
      requiredSymbolCount: symbolCount - NSYM,
      safetySymbolCount: 0,
      nsym: NSYM,
      maxPayloadBytes: 32,
    },
    detectInto,
    alignInto,
    decodeInto: opts.stub === true ? undefined : createRsDecodeInto(),
  });
  return { session, stats, symbolCount };
}

/** 프레임을 여러 장 밀어 넣고 마지막 결과를 돌려준다. */
function run(session, frames = 4) {
  const luma = new Uint8Array([128]);
  let result = null;
  for (let i = 0; i < frames; i += 1) {
    result = session.pushFrame(luma, 1, 1, 1000 + i * 33, { id: 1 });
  }
  return result;
}

test('① 🔴 끝단 왕복 — 셀 휘도에서 페이로드 바이트까지 나온다', () => {
  const { codeword } = buildCodeword();
  const { session } = createSession(codeword);
  const result = run(session);

  assert.equal(result.status, R2_SESSION_STATUS.OK, '세션이 오류로 끝났다');
  // 🔴 완료 신호는 indicator === DONE 이다. 처음에 result.complete 를 봤는데 **그런 필드가 없다** —
  //    ① 과 ② 가 서로 모순되게 실패해서 잡혔다 (두 테스트가 안 맞으면 자를 의심하라).
  assert.equal(result.indicator, R2_INDICATOR.DONE, `복호가 안 끝났다 (indicator ${result.indicator})`);
  assert.ok(result.payloadLength >= PAYLOAD.length, `payloadLength ${result.payloadLength}`);
  const got = Array.from(result.payload.subarray(0, PAYLOAD.length));
  assert.deepEqual(got, Array.from(PAYLOAD), '페이로드가 원문과 다르다');
});

test('② 대조군 — 같은 재료라도 스텁이면 완료되지 않는다 (연결이 실제로 일을 한다)', () => {
  // 이게 없으면 ① 이 「세션이 알아서 통과한 것」인지 「RS 가 푼 것」인지 못 가른다.
  const { codeword } = buildCodeword();
  const { session } = createSession(codeword, { stub: true });
  const result = run(session);
  assert.equal(result.status, R2_SESSION_STATUS.OK);
  assert.notEqual(result.indicator, R2_INDICATOR.DONE, '스텁인데 완료됐다 — ① 의 성공이 RS 덕이 아니다');
});

test('③ 손상 복구 — 셀 digit 을 뒤집어도 RS 가 살려낸다', () => {
  const { codeword } = buildCodeword();
  // 심볼 2개를 망가뜨린다 (nsym 8 ⇒ 정정 능력 4 심볼). 셀 하나만 바꿔도 그 심볼이 틀린다.
  const damage = new Map([[0, (codeword[0] % 6 + 3) % 6], [9, (codeword[3] % 6 + 2) % 6]]);
  const { session } = createSession(codeword, { damage });
  const result = run(session);
  assert.equal(result.indicator, R2_INDICATOR.DONE, '2심볼 손상이 복구되지 않았다');
  assert.deepEqual(
    Array.from(result.payload.subarray(0, PAYLOAD.length)),
    Array.from(PAYLOAD),
  );
});

test('④ 자 검증 — 재료가 실제로 코드워드를 담고 있다 (표가 공허하지 않다)', () => {
  /*
   * ①\~③ 이 전부 초록인데 재료가 엉뚱하면 아무것도 증명 못 한다. 그래서 «칠한 휘도 →
   * digit» 왕복을 **직접** 확인한다 — 세션을 거치지 않고.
   */
  const { codeword } = buildCodeword();
  const cellCount = codeword.length * 3;
  const faceLuma = new Uint8Array(cellCount * 3);
  const visibleCells = new Uint8Array(cellCount);
  paintFaceLuma(codeword, faceLuma, visibleCells);

  assert.ok(visibleCells.every((v) => v === 1), '안 보이는 셀이 남았다');
  for (let symbol = 0; symbol < codeword.length; symbol += 1) {
    const digits = [];
    for (let k = 0; k < 3; k += 1) {
      const cell = symbol * 3 + k;
      const t = faceLuma[cell * 3];
      const l = faceLuma[cell * 3 + 1];
      const r = faceLuma[cell * 3 + 2];
      // 밝은 순으로 면 인덱스를 세워 digit 표와 대조한다.
      const order = [[t, 0], [l, 1], [r, 2]].sort((a, b) => b[0] - a[0]).map((p) => p[1]);
      let found = -1;
      for (let d = 0; d < 6; d += 1) {
        if (DIGIT_FACE_ORDER[d * 3] === order[0]
          && DIGIT_FACE_ORDER[d * 3 + 1] === order[1]
          && DIGIT_FACE_ORDER[d * 3 + 2] === order[2]) { found = d; break; }
      }
      digits.push(found);
    }
    const value = digits[0] * 36 + digits[1] * 6 + digits[2];
    assert.equal(value, codeword[symbol], `심볼 ${symbol} 의 재료가 코드워드와 다르다`);
  }
});
