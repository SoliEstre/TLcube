/**
 * 바인딩된 GF(211) 다중 블록을 기존 GMD 정책으로 복호한다.
 * 블록별 작업 메모리는 생성 때 할당한다. 프레이밍은 메시지를 합친 뒤 한 번이다.
 * 원시 소거 벡터는 기존 세션처럼 셀맵 전용이며 GMD에 전달하지 않는다.
 */
import { MAX_CODEWORD_LEN } from '../rs211.js';
import { DIGITS_PER_SYMBOL, RS_SYMBOL_BASE, symbolCountForByteLength } from '../base211.js';
import { createRsSoftOut, decodeGmdLadder, RS_SOFT_STATUS } from './rs-soft.js';
import { decodeRsPayloadInto } from './decode-rs.js';
import { R2_SESSION_STATUS } from './session.js';

function positive(value) { return Number.isInteger(value) && value > 0; }
function indexable(value) {
  return value !== null && value !== undefined && Number.isInteger(value.length) && value.length >= 0;
}

function resetResult(output) {
  if (output === null || typeof output !== 'object') return;
  output.accepted = 0;
  output.payloadLength = 0;
  output.correctedCount = 0;
  output.tResidual = 0;
}

/** 생성 경로에서 모든 회계/양방향 맵을 검사하고 작업용 사본을 만든다. */
function compile(bound, params) {
  if (bound === null || typeof bound !== 'object'
    || !positive(bound.symbolCount) || bound.symbolCount > 65535
    || bound.cellCount !== bound.symbolCount * DIGITS_PER_SYMBOL
    || !positive(bound.requiredSymbolCount) || !positive(bound.dataBytes)
    || bound.requiredSymbolCount >= bound.symbolCount
    || bound.dataBytes > bound.requiredSymbolCount
    || bound.framed !== true || bound.messageOrder !== 'block-concat'
    || !Array.isArray(bound.blocks) || bound.blocks.length === 0
    || bound.blocks.length > bound.symbolCount
    || !indexable(bound.symbolToBlock) || bound.symbolToBlock.length !== bound.symbolCount * 2
    || !Array.isArray(bound.blockToSymbol) || bound.blockToSymbol.length !== bound.blocks.length
    || !indexable(bound.workOffsets) || bound.workOffsets.length !== bound.blocks.length
    || bound.payloadBytes !== bound.dataBytes || bound.maxPayloadBytes !== bound.dataBytes) return null;
  if (symbolCountForByteLength(bound.dataBytes) !== bound.requiredSymbolCount) return null;
  let totalSymbols = 0;
  let totalData = 0;
  for (let b = 0; b < bound.blocks.length; b += 1) {
    const block = bound.blocks[b];
    if (block === null || typeof block !== 'object' || block.block !== b
      || !positive(block.symbolCount) || block.symbolCount > MAX_CODEWORD_LEN
      || !positive(block.nsym) || !positive(block.dataSymbols)
      || block.dataSymbols + block.nsym !== block.symbolCount
      || !indexable(bound.blockToSymbol[b]) || bound.blockToSymbol[b].length !== block.symbolCount
      || bound.workOffsets[b] !== totalSymbols) return null;
    totalSymbols += block.symbolCount;
    totalData += block.dataSymbols;
  }
  if (totalSymbols !== bound.symbolCount || totalData !== bound.requiredSymbolCount) return null;
  const seen = new Uint8Array(totalSymbols);
  const workers = [];
  for (let b = 0; b < bound.blocks.length; b += 1) {
    const block = bound.blocks[b];
    const toWire = new Int32Array(block.symbolCount);
    for (let p = 0; p < block.symbolCount; p += 1) {
      const g = bound.blockToSymbol[b][p];
      if (!Number.isInteger(g) || g < 0 || g >= totalSymbols || seen[g] !== 0
        || bound.symbolToBlock[2 * g] !== b || bound.symbolToBlock[2 * g + 1] !== p) return null;
      seen[g] = 1;
      toWire[p] = g;
    }
    workers.push({
      count: block.symbolCount, nsym: block.nsym, dataSymbols: block.dataSymbols, toWire,
      values: new Uint8Array(block.symbolCount), confidence: new Int16Array(block.symbolCount),
      out: createRsSoftOut(block.symbolCount, params),
    });
  }
  return { workers, symbolCount: totalSymbols, messageLength: totalData, dataBytes: bound.dataBytes };
}

/** caller-owned 진단 저장소. 성공 여부와 무관하게 이번 시도의 블록 상태만 담는다. */
export function createRsBlockStats(bound) {
  if (!Array.isArray(bound?.blocks) || bound.blocks.length === 0) return null;
  return {
    blocksAttempted: 0, blocksOk: 0,
    status: new Int16Array(bound.blocks.length),
    correctedCount: new Uint16Array(bound.blocks.length),
    tResidual: new Uint16Array(bound.blocks.length),
    correctedPositions: bound.blocks.map((block) => new Uint16Array(block.symbolCount)),
  };
}

function validStats(stats, workers) {
  if (stats === null || stats === undefined) return true;
  if (typeof stats !== 'object' || !indexable(stats.status) || !indexable(stats.correctedCount)
    || !indexable(stats.tResidual) || !Array.isArray(stats.correctedPositions)) return false;
  if (stats.status.length < workers.length || stats.correctedCount.length < workers.length
    || stats.tResidual.length < workers.length || stats.correctedPositions.length < workers.length) return false;
  for (let b = 0; b < workers.length; b += 1) {
    if (!indexable(stats.correctedPositions[b]) || stats.correctedPositions[b].length < workers[b].count) return false;
  }
  return true;
}

function clearStats(stats, count) {
  if (stats === null || stats === undefined) return;
  stats.blocksAttempted = 0;
  stats.blocksOk = 0;
  for (let b = 0; b < count; b += 1) {
    stats.status[b] = RS_SOFT_STATUS.NOT_READY;
    stats.correctedCount[b] = 0;
    stats.tResidual[b] = 0;
  }
}

/**
 * 기존 session.decodeInto 서명 그대로다. layout에는 생성 때 쓴 bound를 전달한다.
 * options.stats는 선택적인 caller-owned 진단 버퍼다. 잘못된 설정은 실패 함수를 만든다.
 */
export function createRsBlockDecodeInto(bound, options = undefined) {
  const stats = options?.stats;
  let compiled = null;
  try { compiled = compile(bound, options?.params); } catch { /* 설정 거부 */ }
  if (compiled === null || !validStats(stats, compiled.workers)) {
    return function invalidDecode(_values, _confidence, _erasures, _count, _layout, output) {
      resetResult(output);
      return R2_SESSION_STATUS.INVALID_CONFIG;
    };
  }
  const { workers, symbolCount, messageLength, dataBytes } = compiled;
  // 메시지 접두+블록별 패리티 꼬리. 와이어 위치는 corrections 버퍼에 별도로 보존한다.
  const aggregate = {
    codeword: new Uint8Array(symbolCount), messageLength, tResidual: 0,
    correctedPositions: new Uint16Array(symbolCount), correctedCount: 0,
  };
  const payloadLayout = Object.freeze({ payloadBytes: dataBytes, framed: true });

  return function decodeInto(values, confidence, erasuresCellMapOnly, count, layout, output, payloadBuffer) {
    resetResult(output);
    clearStats(stats, workers.length);
    if (output === null || typeof output !== 'object' || layout !== bound || count !== symbolCount
      || !indexable(values) || values.length !== symbolCount
      || !indexable(confidence) || confidence.length !== symbolCount
      || !indexable(erasuresCellMapOnly) || erasuresCellMapOnly.length < symbolCount
      || !indexable(payloadBuffer) || payloadBuffer.length < dataBytes) return R2_SESSION_STATUS.INVALID_CONFIG;
    // typed-array로 복사하기 전에 검사한다. 256→0이나 음수→65535 같은 조용한 변환 금지.
    for (let g = 0; g < symbolCount; g += 1) {
      if (!Number.isInteger(values[g]) || values[g] < 0 || values[g] >= RS_SYMBOL_BASE
        || !Number.isInteger(confidence[g]) || confidence[g] < 0 || confidence[g] > 32767) {
        return R2_SESSION_STATUS.INVALID_CONFIG;
      }
    }
    aggregate.correctedCount = 0;
    aggregate.tResidual = MAX_CODEWORD_LEN;
    let dataOffset = 0;
    let parityOffset = messageLength;
    let allAccepted = true;
    for (let b = 0; b < workers.length; b += 1) {
      const worker = workers[b];
      for (let p = 0; p < worker.count; p += 1) {
        const g = worker.toWire[p];
        worker.values[p] = values[g];
        worker.confidence[p] = confidence[g];
      }
      const status = decodeGmdLadder(worker.values, worker.confidence, worker.nsym, worker.out);
      const accepted = status === RS_SOFT_STATUS.OK && worker.out.accepted === 1;
      if (stats !== null && stats !== undefined) {
        stats.blocksAttempted += 1;
        stats.status[b] = status;
        if (accepted) {
          stats.blocksOk += 1;
          stats.correctedCount[b] = worker.out.correctedCount;
          stats.tResidual[b] = worker.out.tResidual;
          for (let c = 0; c < worker.out.correctedCount; c += 1) {
            stats.correctedPositions[b][c] = worker.out.correctedPositions[c];
          }
        }
      }
      if (!accepted) { allAccepted = false; continue; }
      for (let p = 0; p < worker.dataSymbols; p += 1) aggregate.codeword[dataOffset + p] = worker.out.codeword[p];
      for (let p = worker.dataSymbols; p < worker.count; p += 1) {
        aggregate.codeword[parityOffset + p - worker.dataSymbols] = worker.out.codeword[p];
      }
      dataOffset += worker.dataSymbols;
      parityOffset += worker.nsym;
      aggregate.tResidual = Math.min(aggregate.tResidual, worker.out.tResidual);
      for (let c = 0; c < worker.out.correctedCount; c += 1) {
        aggregate.correctedPositions[aggregate.correctedCount] = worker.toWire[worker.out.correctedPositions[c]];
        aggregate.correctedCount += 1;
      }
    }
    if (!allAccepted) return R2_SESSION_STATUS.OK;
    return decodeRsPayloadInto(aggregate, symbolCount, payloadLayout, output, payloadBuffer);
  };
}
