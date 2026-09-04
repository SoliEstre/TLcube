import {
  ACCUMULATE_STATUS,
  accumulateCell,
  cellMarginQ8,
  createAccumulator,
  materializeSymbolsInto,
  resetAccumulator,
} from './accumulate.js';
import {
  IDENTITY_STATE,
  createIdentity,
  observeIdentity,
  resetIdentity,
} from './identity.js';
import { Q15_ONE, createR2Params } from './params.js';
import {
  CELL_MAP_STATE,
  createProgress,
  holdProgress,
  resetProgress,
  setCellMapState,
  updateProgress,
} from './progress.js';
import {
  RANK_LIKELIHOOD_STATUS,
  createRankLikelihood,
} from './rank-likelihood.js';

export const R2_SESSION_STATUS = Object.freeze({
  OK: 0,
  INVALID_CONFIG: 1,
  INVALID_FRAME: 2,
  DETECTOR_ERROR: 3,
  ALIGNMENT_ERROR: 4,
  ACCUMULATOR_ERROR: 5,
  DECODER_ERROR: 6,
});

export const R2_INDICATOR = Object.freeze({
  SEARCHING: 0,
  LOCKED: 1,
  COLLECTING: 2,
  FINALIZING: 3,
  DONE: 4,
  HOLD: 5,
  DROPPED: 6,
  FAILED: 7,
});

/**
 * Hot-path injection contract shared by detectInto/alignInto/decodeInto:
 * - allocate nothing, throw nothing, and use no DOM, RNG, or recursive session call;
 * - write only caller-owned output/buffers and return an R2_SESSION_STATUS value.
 * Detection writes its answer into the caller-owned output object.
 */
export function stubDetectInto(luma, width, height, timestamp, pose, output) {
  output.found = 0;
  output.family = 0;
  return R2_SESSION_STATUS.OK;
}

/**
 * Hot-path injection contract: write alignment metadata, face luma, and
 * visibility into caller-owned buffers under the no-allocation/no-throw rules
 * above. mismatchCount/matchCount MUST come only from gated comparisons of
 * already-confirmed cells or symbols, and MUST both be zero when gatePassed=0.
 * Sampling is intentionally part of this wave's align boundary; a later
 * detector wave may split it without changing the session.
 */
export function stubAlignInto(
  luma,
  width,
  height,
  timestamp,
  pose,
  detection,
  output,
  faceLuma,
  visibleCells,
) {
  output.gatePassed = 0;
  output.weightQ15 = 0;
  output.mismatchCount = 0;
  output.matchCount = 0;
  output.visibleCount = 0;
  return R2_SESSION_STATUS.OK;
}

/**
 * Hot-path injection contract: consume preallocated C2 arrays and write decode
 * metadata plus payload bytes into caller-owned storage under the shared
 * no-allocation/no-throw/status-return rules.
 */
export function stubDecodeInto(
  symbolValues,
  symbolConfidenceQ8,
  erasures,
  symbolCount,
  layout,
  output,
  payloadBuffer,
) {
  output.accepted = 0;
  output.payloadLength = 0;
  output.tResidual = 0;
  return R2_SESSION_STATUS.OK;
}

function finitePositiveInteger(value) {
  return Number.isFinite(value) && Math.trunc(value) === value && value > 0;
}

export function createR2Session(options = undefined) {
  const config = options ?? {};
  const layout = config.layout ?? {};
  const params = createR2Params(config.params);
  const cellCount = finitePositiveInteger(layout.cellCount) ? layout.cellCount : 0;
  const symbolCount = Math.floor(cellCount / 3);
  const requiredSymbolCountRaw = Number(
    layout.requiredSymbolCount ?? layout.K ?? symbolCount,
  );
  const safetySymbolCountRaw = Number(
    layout.safetySymbolCount ?? layout.m ?? params.progressSafetySymbols,
  );
  // D=1 is the decode-attempt threshold, so it has to be reachable. C_eff caps at
  // exactly symbolCount (per-cell contribution caps at 1, three cells per symbol),
  // so any larger denominator makes `internalD >= 1` permanently false and the
  // decoder is never called. The K-less fallback (all symbols) plus a safety
  // margin is exactly that case, so the denominator is capped here.
  const denominatorCap = symbolCount > 0
    ? symbolCount
    : requiredSymbolCountRaw + safetySymbolCountRaw;
  const requiredSymbolCount = Math.min(requiredSymbolCountRaw, denominatorCap);
  const safetySymbolCount = Math.min(
    safetySymbolCountRaw,
    Math.max(0, denominatorCap - requiredSymbolCount),
  );
  const maxPayloadBytes = finitePositiveInteger(layout.maxPayloadBytes)
    ? layout.maxPayloadBytes
    : 256;
  const maskDigits = layout.maskDigits;

  const configValid = (
    cellCount > 0
    && symbolCount > 0
    && Number.isFinite(requiredSymbolCount)
    && requiredSymbolCount > 0
    && Number.isFinite(safetySymbolCount)
    && safetySymbolCount >= 0
    && (maskDigits === undefined || maskDigits.length >= cellCount)
    && (layout.symbolCells === undefined || layout.symbolCells.length >= symbolCount * 3)
  );

  const detectInto = typeof config.detectInto === 'function'
    ? config.detectInto
    : stubDetectInto;
  const alignInto = typeof config.alignInto === 'function'
    ? config.alignInto
    : stubAlignInto;
  const decodeInto = typeof config.decodeInto === 'function'
    ? config.decodeInto
    : stubDecodeInto;

  const rank = createRankLikelihood(params);
  const accumulator = createAccumulator(cellCount, params);
  const identity = createIdentity(params);
  const progress = createProgress(cellCount);

  const faceLuma = new Uint16Array(cellCount * 3);
  const visibleCells = new Uint8Array(cellCount);
  const rankScratchQ8 = new Int16Array(6);
  const cellMarginsQ8 = new Int16Array(cellCount);
  const symbolValues = new Uint8Array(symbolCount);
  const symbolConfidenceQ8 = new Int16Array(symbolCount);
  const erasures = new Uint8Array(symbolCount);
  const payloadBuffer = new Uint8Array(maxPayloadBytes);

  const detectionOutput = {
    found: 0,
    family: 0,
  };
  const alignmentOutput = {
    gatePassed: 0,
    weightQ15: 0,
    mismatchCount: 0,
    matchCount: 0,
    visibleCount: 0,
  };
  const decodeOutput = {
    accepted: 0,
    payloadLength: 0,
    tResidual: 0,
  };

  const result = {
    status: configValid ? R2_SESSION_STATUS.OK : R2_SESSION_STATUS.INVALID_CONFIG,
    state: identity.state,
    progress: progress.view,
    indicator: R2_INDICATOR.SEARCHING,
    payload: undefined,
    payloadLength: 0,
  };

  const buffers = Object.freeze({
    faceLuma,
    visibleCells,
    rankScratchQ8,
    cellMarginsQ8,
    accumulator: accumulator.scores,
    observations: accumulator.observations,
    symbolValues,
    symbolConfidenceQ8,
    erasures,
    payload: payloadBuffer,
    detectionOutput,
    alignmentOutput,
    decodeOutput,
  });

  let complete = 0;
  let evidenceRevision = 0;
  let lastDecodeRevision = -1;

  function syncResult() {
    result.state = identity.state;
    return result;
  }

  function hardDropReset() {
    resetAccumulator(accumulator);
    resetProgress(progress);
    cellMarginsQ8.fill(0);
    symbolValues.fill(0);
    symbolConfidenceQ8.fill(0);
    erasures.fill(0);
    result.payload = undefined;
    result.payloadLength = 0;
    result.indicator = R2_INDICATOR.DROPPED;
    evidenceRevision = 0;
    lastDecodeRevision = -1;
  }

  function reset() {
    resetAccumulator(accumulator);
    resetIdentity(identity, IDENTITY_STATE.ACTIVE);
    resetProgress(progress);
    faceLuma.fill(0);
    visibleCells.fill(0);
    rankScratchQ8.fill(0);
    cellMarginsQ8.fill(0);
    symbolValues.fill(0);
    symbolConfidenceQ8.fill(0);
    erasures.fill(0);
    payloadBuffer.fill(0);
    complete = 0;
    evidenceRevision = 0;
    lastDecodeRevision = -1;
    result.status = configValid ? R2_SESSION_STATUS.OK : R2_SESSION_STATUS.INVALID_CONFIG;
    result.state = identity.state;
    result.indicator = R2_INDICATOR.SEARCHING;
    result.payload = undefined;
    result.payloadLength = 0;
    return result;
  }

  function pushFrame(luma, width, height, timestamp, pose) {
    if (!configValid) {
      result.status = R2_SESSION_STATUS.INVALID_CONFIG;
      result.indicator = R2_INDICATOR.FAILED;
      return syncResult();
    }
    if (complete) return syncResult();

    result.status = R2_SESSION_STATUS.OK;
    result.payload = undefined;
    result.payloadLength = 0;

    if (
      luma === null
      || luma === undefined
      || !finitePositiveInteger(width)
      || !finitePositiveInteger(height)
      || luma.length < width * height
      || !Number.isFinite(timestamp)
    ) {
      result.status = R2_SESSION_STATUS.INVALID_FRAME;
      result.indicator = R2_INDICATOR.FAILED;
      return syncResult();
    }

    detectionOutput.found = 0;
    detectionOutput.family = 0;
    const detectionStatus = detectInto(
      luma,
      width,
      height,
      timestamp,
      pose,
      detectionOutput,
    );
    if (detectionStatus !== R2_SESSION_STATUS.OK) {
      result.status = R2_SESSION_STATUS.DETECTOR_ERROR;
      result.indicator = R2_INDICATOR.FAILED;
      return syncResult();
    }

    /*
     * ── 🔴 드랍에서의 재획득 (2026-09-04) ────────────────────────────────
     * `observeIdentity` 는 `state === DROPPED` 면 조기 반환한다 — 즉 **흡수 상태**다.
     * 그런데 `resetIdentity` 는 `reset()` 한 곳에서만 불리고, `hardDropReset` 은
     * 누적기·진행률만 되돌린다. 결과: 실측(코드를 nCoast 프레임 가린 뒤 되돌림)에서
     * 코드가 다시 보여도 **8프레임 내내 `DROPPED · D=0 · 복호 시도 0`** 이었다.
     * ⇒ 라이브 카메라에서 손이 흔들려 코드를 ≈0.4초 놓치면 누적 세션이 **영구히**
     *   끝났다. 이 층의 존재 이유가 사라지는 결함이다.
     *
     * 계약 근거: PM/029B §4 의 A4 행이 「ACTIVE/COAST/DROPPED · **재개는 검증 후**」다.
     * 재개는 설계에 있다. 「검증 후」는 여기서 지켜진다 — `hardDropReset` 이 누적기를
     * 비웠으므로 증거가 0 부터 다시 쌓이고, D 가 1 에 닿기 전엔 복호를 시도하지 않는다.
     *
     * ⚠ **자리가 중요하다.** 이걸 `hardDropReset` 안에 넣으면 코드가 **안 보이는
     * 동안에도** 매 nCoast 프레임마다 ACTIVE 로 돌아가 DROPPED 표시가 깜빡인다
     * (실측으로 확인했다). 재획득은 「검출이 **다시 됐을 때**」 일어나야 한다.
     * 그래서 게이트를 «검출 성공» 쪽에 둔다 — 코드가 없으면 DROPPED 가 그대로 선다.
     */
    if (detectionOutput.found && identity.state === IDENTITY_STATE.DROPPED) {
      resetIdentity(identity, IDENTITY_STATE.ACTIVE);
    }

    if (!detectionOutput.found) {
      observeIdentity(identity, false, false, 0, 0);
      if (identity.state === IDENTITY_STATE.DROPPED) hardDropReset();
      else {
        holdProgress(progress);
        result.indicator = R2_INDICATOR.SEARCHING;
      }
      return syncResult();
    }

    visibleCells.fill(0);
    alignmentOutput.gatePassed = 0;
    alignmentOutput.weightQ15 = 0;
    alignmentOutput.mismatchCount = 0;
    alignmentOutput.matchCount = 0;
    alignmentOutput.visibleCount = 0;
    const alignmentStatus = alignInto(
      luma,
      width,
      height,
      timestamp,
      pose,
      detectionOutput,
      alignmentOutput,
      faceLuma,
      visibleCells,
    );
    if (alignmentStatus !== R2_SESSION_STATUS.OK) {
      result.status = R2_SESSION_STATUS.ALIGNMENT_ERROR;
      result.indicator = R2_INDICATOR.FAILED;
      return syncResult();
    }

    observeIdentity(
      identity,
      true,
      Boolean(alignmentOutput.gatePassed),
      alignmentOutput.mismatchCount,
      alignmentOutput.matchCount,
    );
    if (identity.state === IDENTITY_STATE.DROPPED) {
      hardDropReset();
      return syncResult();
    }
    if (identity.state === IDENTITY_STATE.COAST) {
      holdProgress(progress);
      result.indicator = R2_INDICATOR.HOLD;
      return syncResult();
    }

    const frameWeight = Math.max(
      0,
      Math.min(Q15_ONE, Math.trunc(alignmentOutput.weightQ15)),
    );
    let contributed = 0;
    if (frameWeight > 0) {
      for (let cell = 0; cell < cellCount; cell += 1) {
        if (visibleCells[cell] === 0) continue;
        const rankStatus = rank.evaluate(faceLuma, cell * 3, rankScratchQ8, 0);
        if (rankStatus !== RANK_LIKELIHOOD_STATUS.OK) {
          result.status = R2_SESSION_STATUS.ACCUMULATOR_ERROR;
          result.indicator = R2_INDICATOR.FAILED;
          return syncResult();
        }
        const maskShift = maskDigits === undefined ? 0 : maskDigits[cell];
        const accumulateStatus = accumulateCell(
          accumulator,
          cell,
          rankScratchQ8,
          0,
          frameWeight,
          maskShift,
        );
        if (accumulateStatus !== ACCUMULATE_STATUS.OK) {
          result.status = R2_SESSION_STATUS.ACCUMULATOR_ERROR;
          result.indicator = R2_INDICATOR.FAILED;
          return syncResult();
        }
        contributed += 1;
      }
    }
    if (contributed > 0) evidenceRevision += 1;

    const tauCell = Math.max(1, Math.trunc(params.tauCellQ8));
    let effectiveCells = 0;
    for (let cell = 0; cell < cellCount; cell += 1) {
      if (accumulator.observations[cell] === 0) {
        cellMarginsQ8[cell] = 0;
        setCellMapState(progress, cell, CELL_MAP_STATE.UNOBSERVED);
        continue;
      }
      const margin = cellMarginQ8(accumulator, cell);
      cellMarginsQ8[cell] = Math.min(32767, margin);
      effectiveCells += Math.min(1, margin / tauCell);
      setCellMapState(
        progress,
        cell,
        margin >= tauCell ? CELL_MAP_STATE.CONFIRMED : CELL_MAP_STATE.CANDIDATE,
      );
    }

    // Three cells are one GF(211) symbol; all D inputs are symbol-equivalents.
    updateProgress(
      progress,
      effectiveCells / 3,
      requiredSymbolCount,
      safetySymbolCount,
    );
    if (contributed === 0) holdProgress(progress);

    result.indicator = progress.view.D > 0
      ? R2_INDICATOR.COLLECTING
      : R2_INDICATOR.LOCKED;

    if (progress.view.internalD >= 1 && evidenceRevision !== lastDecodeRevision) {
      const materializeStatus = materializeSymbolsInto(
        accumulator,
        layout,
        symbolValues,
        symbolConfidenceQ8,
        erasures,
      );
      if (materializeStatus !== ACCUMULATE_STATUS.OK) {
        result.status = R2_SESSION_STATUS.ACCUMULATOR_ERROR;
        result.indicator = R2_INDICATOR.FAILED;
        return syncResult();
      }

      for (let symbol = 0; symbol < symbolCount; symbol += 1) {
        if (erasures[symbol] === 0) continue;
        const base = symbol * 3;
        for (let offset = 0; offset < 3; offset += 1) {
          const cell = layout.symbolCells === undefined
            ? base + offset
            : layout.symbolCells[base + offset];
          setCellMapState(progress, cell, CELL_MAP_STATE.ERASURE);
        }
      }

      decodeOutput.accepted = 0;
      decodeOutput.payloadLength = 0;
      decodeOutput.tResidual = 0;
      result.indicator = R2_INDICATOR.FINALIZING;
      lastDecodeRevision = evidenceRevision;
      const decodeStatus = decodeInto(
        symbolValues,
        symbolConfidenceQ8,
        erasures,
        symbolCount,
        layout,
        decodeOutput,
        payloadBuffer,
      );
      if (decodeStatus !== R2_SESSION_STATUS.OK) {
        result.status = R2_SESSION_STATUS.DECODER_ERROR;
        result.indicator = R2_INDICATOR.FAILED;
        return syncResult();
      }
      if (decodeOutput.accepted) {
        const length = Math.max(
          0,
          Math.min(payloadBuffer.length, Math.trunc(decodeOutput.payloadLength)),
        );
        complete = 1;
        result.payload = payloadBuffer;
        result.payloadLength = length;
        result.indicator = R2_INDICATOR.DONE;
      }
    }

    return syncResult();
  }

  return Object.freeze({
    pushFrame,
    reset,
    result,
    buffers,
    params,
    layout,
  });
}
