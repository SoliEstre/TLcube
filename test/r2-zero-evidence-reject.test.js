/**
 * r2-zero-evidence-reject.test.js — **증거 0 인 워드가 DONE 이 되지 않는다.**
 *
 * 🔴 왜 있나 (2026-09-04, 출하 결함 워크플로의 종합 렌즈가 잡음): 전부-0 코드워드가
 * `cellsurface` 라인업 **59/60 행에서 accepted=1** 이었다. 확률이 아니라 **계수 1** 로 —
 * 0 벡터는 어떤 선형부호에서도 유효한 코드워드라 신드롬이 전부 0 이고
 * `correctedCount === 0` 이라, 기존 오정정 규칙(「빈 페이로드 ∧ 정정 > 0」)의 뒤 절이
 * **구조적으로** 안 선다. 그리고 `unframe` 은 길이 접두 0 을 빈 문자열로 정상 반환한다.
 *
 * 이 워드는 적대적 입력이 아니라 **누적기가 증거 0 일 때 내놓는 값**이다
 * (`accumulate.js` 의 `materializeSymbolsInto`). 즉 세션이 「나는 아무것도 못 봤다」를
 * 말하는 그 벡터가 사용자에게 «성공» 으로 보였다.
 *
 * 당시 유일하게 거부하던 행은 `v0@13/L` 이고, 그 이유는 이 경로가 아니라
 * `rs-soft.js` 의 `MIN_RESIDUAL_CORRECTIONS` 였다 — **우연한 방패**다.
 * 그 상수를 고치면(PM/029B §18.5 ①) 60/60 이 된다. 그래서 이 자가 그보다 먼저 선다.
 *
 * ⚠ **이 파일이 못 재는 축**: 「전부-0 이 아닌 저증거 워드」. 증거가 조금이라도 있으면
 * 코드워드가 0 이 아니므로 이 검사를 지나가고, 그때의 방어선은 프레이밍 3층과
 * `internalD >= 1` 진행 게이트다. 그 축의 오수용 바닥은 별도로 재야 한다
 * (§18.5 종합의 「RS 층 바닥 ~1e-5」 항목 — 아직 자가 없다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import {
  CELL_SURFACE_FINAL_IDS,
  CELL_SURFACE_FINAL_NS,
  capacityForCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import { frame, unframe } from '../src/header.js';
import { bytesToSymbols } from '../src/base211.js';
import { rsEncode } from '../src/rs211.js';

const TEXT = 'https://tl.estre.so';

// 라인업을 **유도한다** — 손 목록은 반드시 원본과 어긋난다.
function lineup() {
  const rows = [];
  for (const id of CELL_SURFACE_FINAL_IDS) {
    for (const n of (CELL_SURFACE_FINAL_NS[id] || [])) {
      for (const level of ['L', 'M', 'H']) {
        let cap;
        try {
          cap = capacityForCellSurfaceFinal(n, level, 2, id);
        } catch {
          continue;
        }
        if (cap.dataBytes < TEXT.length + 1) continue;
        rows.push({ id, n, level, cap });
      }
    }
  }
  return rows;
}

function layoutOf(cap, count) {
  return {
    requiredSymbolCount: count - cap.nsym,
    nsym: cap.nsym,
    payloadBytes: cap.dataBytes,
    // 존재 자체가 「프레임돼 있다」의 답이다 (decode-rs.js 의 `framed` 유도).
    maskDigits: 1,
  };
}

const ROWS = lineup();

test('자 검증 — 같은 하네스로 정상 왕복이 통과한다 (거부가 하네스 고장이 아님을 먼저 보인다)', () => {
  assert.ok(ROWS.length >= 40, `라인업 유도가 ${ROWS.length}행뿐이다 — 유도가 무너지면 아래가 통째로 공허해진다`);
  const decodeInto = createRsDecodeInto({ codewordCapacity: 512 });
  const out = { accepted: 0, payloadLength: 0, tResidual: 0 };
  const buf = new Uint8Array(512);

  const red = [];
  for (const row of ROWS) {
    const { cap } = row;
    const codeword = rsEncode(bytesToSymbols(frame(TEXT, cap.dataBytes)), cap.nsym);
    const confidence = new Int32Array(codeword.length).fill(6 * 256);
    decodeInto(
      Int32Array.from(codeword), confidence, new Uint8Array(codeword.length),
      codeword.length, layoutOf(cap, codeword.length), out, buf,
    );
    let ok = out.accepted === 1;
    if (ok) {
      try {
        ok = unframe(buf.subarray(0, out.payloadLength)).text === TEXT;
      } catch {
        ok = false;
      }
    }
    if (!ok) red.push(`${row.id}@${row.n}/${row.level}(nsym ${cap.nsym})`);
  }
  // 오늘의 유일한 빨강은 v0@13/L 이고 그 원인은 rs-soft 의 잔여 하한이다 (§18.5 ①).
  // 그것이 고쳐지면 이 배열은 비어야 한다 — 그때 이 단언이 알려 준다.
  assert.ok(red.length <= 1,
    `정상 왕복이 ${red.length}행에서 실패한다: ${red.join(' ')}\n`
    + '    → 하네스가 고장났거나 라인업이 바뀌었다. 아래 거부 단언을 믿기 전에 이걸 먼저 고쳐라');
  if (red.length === 1) {
    assert.equal(red[0], 'v0@13/L(nsym 4)',
      `알려진 유일한 빨강이 아니다: ${red[0]} — §18.5 ① 외의 새 결함이다`);
  }
});

test('전부-0 코드워드는 라인업 전 행에서 거부된다 (증거 0 은 DONE 이 아니다)', () => {
  const decodeInto = createRsDecodeInto({ codewordCapacity: 512 });
  const out = { accepted: 0, payloadLength: 0, tResidual: 0 };
  const buf = new Uint8Array(512);

  const accepted = [];
  for (const row of ROWS) {
    const { cap } = row;
    const count = cap.usedSymbols;
    assert.ok(Number.isInteger(count) && count > cap.nsym,
      `${row.id}@${row.n}/${row.level} 의 usedSymbols 를 못 읽었다 (${count}) — 용량 API 가 바뀌었다`);
    decodeInto(
      new Int32Array(count),            // 심볼 전부 0
      new Int32Array(count),            // 신뢰도 전부 0 = 증거 없음
      new Uint8Array(count).fill(1),    // C2 가 「전 심볼 소거」를 선언한 상태
      count, layoutOf(cap, count), out, buf,
    );
    if (out.accepted === 1) {
      accepted.push(`${row.id}@${row.n}/${row.level}(nsym ${cap.nsym}, payloadLength ${out.payloadLength})`);
    }
  }
  assert.deepEqual(accepted, [],
    `전부-0 코드워드가 ${accepted.length}/${ROWS.length}행에서 수용됐다:\n      ${accepted.join('\n      ')}\n`
    + '    → 이건 누적기가 증거 0 일 때 내놓는 값이다. 사용자에게 빈 문자열이 «성공» 으로 보인다.\n'
    + '    decode-rs.js 의 전부-0 코드워드 거부가 지워졌거나 우회됐다.');
});
