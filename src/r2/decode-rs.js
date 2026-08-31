/**
 * decode-rs.js — R2 세션의 `decodeInto` 를 실물 RS(GF(211)) 로 채운다.
 *
 * 세션은 `detectInto` · `alignInto` · `decodeInto` 세 함수를 주입받는다
 * (`session.js`). 앞의 둘은 정합 계층 설계가 아직 갈리는 중이지만(6DoF 포즈 일반화 vs
 * 역왜곡 복원), **`decodeInto` 는 그 갈림과 무관하다** — 이미 심볼로 정리된 것을 받아
 * 바이트로 되돌리는 일이라서다. 그래서 여기부터 채운다.
 *
 * 입력은 `materializeSymbolsInto`(accumulate.js)가 이미 GF(211) 심볼 · Q8 신뢰도 ·
 * 소거 플래그로 만들어 둔 상태다. 이 모듈이 하는 일은 셋뿐이다:
 *   ① `decodeGmdLadder` 로 RS 복호 (soft erasure 사다리)
 *   ② 메시지 심볼 → 바이트 (base-211 청크)
 *   ③ **오정정 거부** — 아래 참조
 *
 * ## 오정정 거부
 *
 * R1 에서 실측된 사고: 격자를 잘못 잡으면 RS 가 대량 «정정» 해서 **빈 페이로드를
 * 성공으로** 반환한다. 두 축이 **동시에** 서야 의심한다 — 빈 페이로드 ∧ 정정 > 0.
 * 정정 수 단독 임계는 안 된다 (정상 최대 26 vs 오독 최소 28, 여유 2뿐이었다).
 *
 * ## ⚠ 계약 이탈 — 정직하게 적는다
 *
 * `session.js` 의 주입 계약은 「할당 없음 · 예외 없음」이다. 예외는 지킨다(전부 잡거나
 * 사전 검사). **할당은 못 지킨다** — `decodeChunkInto` 가 base-211 변환에 BigInt 를 쓰고
 * BigInt 는 값마다 할당한다. 손으로 다시 구현하면 사본이 원본과 어긋나므로(이 프로젝트에서
 * 반복된 실패 유형) 그쪽을 택하지 않았다.
 *
 * 완화: 이 경로는 **프레임마다 돌지 않는다.** 세션은 `internalD >= 1` 이고 증거가
 * 갱신됐을 때만 부른다 — 누적이 임계에 닿은 뒤 새 프레임이 들어올 때뿐이다.
 * 그래도 계약 이탈이므로, C++ 이식 때 base-211 을 정수 경로로 다시 쓰는 것이 정답이다.
 *
 * ## 아직 없는 것
 *
 * 페이로드 **길이**는 심볼 개수에서 유도한다 (`byteLengthForSymbolCount`). 상위 포맷
 * 헤더(길이 필드 · CRC)가 붙으면 그쪽이 이겨야 한다 — 포맷 계층의 자리다.
 * `layout.payloadBytes` 를 주면 그 값으로 자른다.
 *
 * @module r2/decode-rs
 */
import { byteLengthForSymbolCount, decodeChunkInto } from '../base211.js';
import { createR2Params } from './params.js';
import {
  RS_SOFT_STATUS,
  createRsSoftOut,
  decodeGmdLadder,
} from './rs-soft.js';
import { R2_SESSION_STATUS } from './session.js';

/** base-211 청크 최대 바이트. `base211.js` 의 CHUNK_BYTES 와 같아야 한다. */
const CHUNK_BYTES = 27;

function isIndexable(value) {
  return value !== null
    && value !== undefined
    && typeof value.length === 'number'
    && value.length >= 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * `layout` 에서 패리티 심볼 수를 뽑는다. 명시값이 이기고, 없으면 K 에서 유도한다.
 * 둘 다 없으면 0 을 돌려 호출자가 «복호 불가» 로 처리하게 한다 (지어내지 않는다).
 */
export function nsymFor(layout, symbolCount) {
  if (layout === null || layout === undefined) return 0;
  if (positiveInteger(layout.nsym)) return layout.nsym;
  const k = Number(layout.requiredSymbolCount ?? layout.K);
  if (!Number.isInteger(k) || k <= 0 || k >= symbolCount) return 0;
  return symbolCount - k;
}

/**
 * 주입용 `decodeInto` 를 만든다. **작업 메모리는 여기서 한 번만 잡는다** — 반환된
 * 함수는 프레임 경로에서 불리므로 그 안에서 새 버퍼를 만들지 않는다.
 *
 * @param {{codewordCapacity?:number, params?:object}} [options]
 * @returns {Function} session 계약의 decodeInto
 */
export function createRsDecodeInto(options = undefined) {
  const config = options ?? {};
  const params = createR2Params(config.params);
  const out = createRsSoftOut(config.codewordCapacity, params);

  return function decodeInto(
    symbolValues,
    symbolConfidenceQ8,
    erasures,
    symbolCount,
    layout,
    output,
    payloadBuffer,
  ) {
    if (output === null || output === undefined) return R2_SESSION_STATUS.INVALID_CONFIG;
    output.accepted = 0;
    output.payloadLength = 0;
    output.tResidual = 0;

    if (
      !isIndexable(symbolValues)
      || !isIndexable(symbolConfidenceQ8)
      || !isIndexable(erasures)
      || !isIndexable(payloadBuffer)
      || !positiveInteger(symbolCount)
      || symbolValues.length < symbolCount
      || symbolConfidenceQ8.length < symbolCount
    ) {
      return R2_SESSION_STATUS.INVALID_CONFIG;
    }
    // decodeGmdLadder 는 `received.length` 를 코드워드 길이로 읽는다. 세션이 넘기는
    // 배열은 정확히 symbolCount 길이라 부분배열을 만들 필요가 없다 — 만들면 그것도 할당이다.
    if (symbolValues.length !== symbolCount || symbolConfidenceQ8.length !== symbolCount) {
      return R2_SESSION_STATUS.INVALID_CONFIG;
    }

    const nsym = nsymFor(layout, symbolCount);
    if (nsym <= 0 || nsym >= symbolCount) return R2_SESSION_STATUS.INVALID_CONFIG;
    if (symbolCount > out.capacity) return R2_SESSION_STATUS.INVALID_CONFIG;

    const status = decodeGmdLadder(symbolValues, symbolConfidenceQ8, nsym, out);
    // 복호 실패는 **세션 오류가 아니다** — 아직 증거가 모자란 정상 상태다.
    // 여기서 DECODER_ERROR 를 돌려주면 세션이 FAILED 로 죽어 누적을 포기한다.
    if (status !== RS_SOFT_STATUS.OK || out.accepted !== 1) return R2_SESSION_STATUS.OK;

    const messageLength = out.messageLength;
    if (!positiveInteger(messageLength) || messageLength > symbolCount) {
      return R2_SESSION_STATUS.OK;
    }

    let byteLength = 0;
    try {
      byteLength = byteLengthForSymbolCount(messageLength);
    } catch {
      // 청크 분해가 없는 심볼 개수 — 이 레이아웃으로는 바이트를 못 만든다.
      return R2_SESSION_STATUS.OK;
    }
    const capped = Number.isInteger(layout?.payloadBytes) && layout.payloadBytes > 0
      ? Math.min(byteLength, layout.payloadBytes)
      : byteLength;
    if (capped <= 0 || capped > payloadBuffer.length) return R2_SESSION_STATUS.OK;

    let byteOffset = 0;
    let symbolOffset = 0;
    try {
      while (byteOffset < capped) {
        const take = Math.min(CHUNK_BYTES, capped - byteOffset);
        symbolOffset += decodeChunkInto(out.codeword, symbolOffset, take, payloadBuffer, byteOffset);
        byteOffset += take;
      }
    } catch {
      return R2_SESSION_STATUS.OK;
    }

    // ── 오정정 거부 ──
    // 빈 페이로드 ∧ 정정 > 0 이 **동시에** 설 때만 의심한다. 정정 수 단독은 안 된다.
    let allZero = 1;
    for (let i = 0; i < capped; i += 1) {
      if (payloadBuffer[i] !== 0) { allZero = 0; break; }
    }
    if (allZero === 1 && out.correctedCount > 0) return R2_SESSION_STATUS.OK;

    output.accepted = 1;
    output.payloadLength = capped;
    output.tResidual = out.tResidual;
    return R2_SESSION_STATUS.OK;
  };
}
