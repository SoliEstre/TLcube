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
  releaseProgressHold,
  resetProgress,
  setCellMapState,
  updateProgress,
} from './progress.js';
import {
  RANK_LIKELIHOOD_STATUS,
  createRankLikelihood,
} from './rank-likelihood.js';

/**
 * 연속 RS 실패의 되물림 상한 — 「증거 개정 몇 개를 모아 한 번 시도하나」의 최대치
 * (2026-09-06 검토 R3c, 결함 5).
 *
 * ⚠ 8 은 «비용 상한» 이지 성질이 아니다. n=21 실물 RS 1회가 ≈0.9 s 이고 실기 FPS 가 7\~15 라,
 * 풀 수 없는 상태에서 8개정마다 1회면 복호가 프레임 예산의 한 자리 %로 내려간다. 값을 재려면
 * 「풀리는 순간이 몇 개정 늦어지나」를 재야 하는데, 실측 성공 시퀀스는 전부 **첫 시도**에 풀려
 * (y0/y1/y2 decodeAttempts 1\~2) 이 되물림 경로를 아예 안 탄다 — 즉 **성공 축에서는 미측정이 아니라
 * 무영향**이고, 재야 할 축은 「오염 뒤 회복까지의 개정 수」다(코퍼스에 그 시퀀스가 없다).
 */
export const DECODE_RETRY_GAP_MAX = 8;

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
 *
 * `distrusted` (3d) is a THIRD axis, not a flavour of gatePassed=0: the lock is
 * alive and the code is still in frame, but the grid it locked onto is not
 * trusted. The session must not advance the identity SPRT/COAST on such a
 * frame -- COAST/DROPPED answers "did we lose the code?", which is a different
 * question. Writers MUST set it to 0 whenever there is no lock to judge.
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
  output.distrusted = 0;
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
  output.correctedCount = 0;
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
  /*
   * 3b — **RS 가 고친 코드워드 위치**. `decodeInto` 가 수용한 프레임에만 채운다.
   * caller-owned 인 이유는 payload 와 같다: 프레임 경로에서 배열을 새로 만들지 않는다.
   * 값의 단위는 **RS 심볼 위치**(0..symbolCount-1)다 — 셀로 옮기는 것은 `r2/corrections.js`.
   */
  const correctedPositions = new Uint16Array(symbolCount);

  const detectionOutput = {
    found: 0,
    family: 0,
    /*
     * R5 — 이 세션이 **어느 레이아웃의 후보인가**. 어댑터는 `alignInto` 에서 이 값을
     * 보고 그 후보의 스캔순서로 표본한다. 검출 출력에 얹는 이유는 arity 를 안 바꾸려는
     * 것이고(핫 경로 주입 계약), 값은 세션 수명 동안 상수라 여기서 한 번 쓴다.
     * 어댑터의 `detectInto` 는 이 키를 덮어쓰지 않는다 (자: r2-scan-runtime ⓥ).
     */
    sessionLayoutId: typeof layout.layoutId === 'string' ? layout.layoutId : '',
  };
  const alignmentOutput = {
    gatePassed: 0,
    weightQ15: 0,
    mismatchCount: 0,
    matchCount: 0,
    visibleCount: 0,
    /** 3d — 락은 살아 있는데 그 격자를 못 믿는다. 신원 축(COAST/DROPPED)을 굴리지 않는다. */
    distrusted: 0,
  };
  const decodeOutput = {
    accepted: 0,
    payloadLength: 0,
    tResidual: 0,
    /** 3b — 수용된 복호가 고친 심볼 수. 수용 아닌 시도는 0 (거짓 잔상 금지). */
    correctedCount: 0,
    correctedPositions,
  };

  const result = {
    status: configValid ? R2_SESSION_STATUS.OK : R2_SESSION_STATUS.INVALID_CONFIG,
    state: identity.state,
    progress: progress.view,
    indicator: R2_INDICATOR.SEARCHING,
    payload: undefined,
    payloadLength: 0,
    /*
     * 3b — **수명은 `payload` 와 같다** (3b 검토 F12 정정): DONE 프레임에서 서고, DONE 뒤 흡수
     * 프레임에서도 유효하며(`if (complete) return syncResult()` 가 프레임별 초기화를 건너뛴다 —
     * payload 도 같은 이유로 남는다), `reset()` · `rejectPayload()` 뒤에 0 이다. 그 밖의 프레임은 0.
     * 「DONE 프레임에만」이라고 적었던 옛 문구는 흡수 구간에서 거짓이었다.
     *
     * `correctedPositions` 는 **세션 수명 동안 같은 참조**라 (payload 와 같은 규약) 호출자가
     * `correctedCount` 개만 읽는다. 나머지 프레임의 버퍼 내용은 옛 값이 남아 있을 수 있다 —
     * 그래서 개수가 곧 유효 범위다.
     */
    correctedCount: 0,
    correctedPositions,
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
    correctedPositions,
    detectionOutput,
    alignmentOutput,
    decodeOutput,
  });

  let complete = 0;
  let evidenceRevision = 0;
  let lastDecodeRevision = -1;
  /*
   * 🔴 **연속 RS 실패의 되물림** (2026-09-06 검토 R3c, 결함 5). 옛 조건은 「증거 개정이 바뀌었으면
   * 시도」 하나뿐이라, 풀 수 없는 상태(다른 코드로 갈아탄 뒤)에서는 **매 개정마다** RS 를 돌렸다 —
   * 실측 17\~30 프레임 연속 실패, n=21 실물 1회 ≈0.9 s. 그 수십 프레임 동안 스캐너가 초 단위로 막힌다.
   * 되물림은 «몇 개정을 건너뛰나» 로 센다(프레임이 아니라 **증거**가 자다 — 증거가 안 늘면
   * 어차피 시도하지 않는다). 선형이라 첫 실패 뒤 거동은 옛 것과 같다(y1 실측 decAtt 2 / decFail 1 불변).
   */
  let decodeFailStreak = 0;

  /**
   * R7 — 누적 카운터. 런타임이 프레임마다 후보 전체를 합산해 `stats.counters` 로 낸다.
   * 프레임 단위 값은 `frameMs` 하나뿐이다 (복호에 든 ms).
   */
  const counters = {
    hardDrops: 0,
    coastFrames: 0,
    decodeAttempts: 0,
    decodeFailures: 0,
  };
  const frameMs = { decode: 0 };

  function syncResult() {
    result.state = identity.state;
    return result;
  }

  /*
   * ── 🔴 드랍은 **신원만** 되돌린다 (2026-09-06, 운영자 실기 3차 ③) ──────────────
   * 운영자 원문: 「가이드 크기(큰 코드)에서 수집은 되나 리셋 반복 — **읽은 데이터를
   * 버리지 말고 재정정**」.
   *
   * 옛 계약(C4·C6)은 「드랍이 누적·진행·셀맵을 리셋한다」였다. 그 계약은 신원 드랍이
   * 「다른 코드로 갈아탔다」를 뜻할 때만 옳다. 그런데 실제로 R2 를 드랍시키던 경로는
   * `advanceCoast` 의 **COAST 만료**였고, 그것은 「손이 흔들려 12프레임 놓쳤다」다 —
   * 같은 코드다. 거기서 수백 프레임 치 증거를 버리면 사용자에겐 「모으다 말고 리셋」이
   * 무한 반복된다.
   *
   * 그래서 여기서는 표시만 DROPPED 로 내리고 **누적기·진행·셀맵·심볼을 유지**한다.
   *
   * ⚠ **증거가 실제로 사라지는 자리 전수** (2026-09-06 검토 R3c — 옛 주석은 「두 곳뿐」이라고
   *   적었고 그것이 거짓이었다. 목록을 손으로 드는 대신 «어디가 세션을 버리는가» 로 적는다):
   *     ① 명시적 `reset()` — 수동 리셋 · 엔진 토글 · DONE 거부 · 카메라 정지.
   *     ② 새 bind — 런타임이 세션을 다시 만든다. 두 방아쇠가 있다:
   *        · `n` 변화 (틀린 격자 위 누적은 못 되산다). 잡음 한 프레임에 죽지 않도록
   *          런타임이 **연속 M 프레임 확인** 뒤에만 묶는다.
   *        · **포맷(ecc·mask·wire) 변화** — 같은 n 이라도 다른 포맷은 다른 코드다.
   *     ③ **인내 폐기** — 락이 없는 채로 `CANDIDATE_PATIENCE_FRAMES` 를 넘기면 런타임이 후보를 접는다.
   *   여기(드랍)는 그 목록에 **없다** — 신원만 되돌린다.
   *
   * 🟡 오염 위험을 무엇이 막나 (근거를 적어 둔다):
   *   · λ 감쇠 0.9 — 새 관측 10프레임이면 옛 증거의 기여가 e^-1 아래로 내려간다.
   *     즉 「틀린 코드를 잠깐 봤다」는 재획득 뒤 스스로 씻긴다.
   *   · F 게이트 — 정합이 무너진 프레임은 weight 0 이라 애초에 누적에 안 들어간다.
   *   · 진짜로 «다른 코드»면 격자(n)가 바뀌고, 그때는 런타임이 bind 를 갈아 세션을
   *     통째로 새로 만든다 (버리는 자리가 여기가 아니라 거기다).
   */
  /**
   * 🔴 **«payload 수명» 을 가진 결과 필드를 한 자리에서 비운다** (3b 검토 F2·F12).
   * `correctedCount` 는 payload 와 같은 수명이다 — 같은 수용이 낳고, 같은 무름·리셋이 지운다.
   * 비우는 자리를 손 목록으로 나란히 두면 반드시 한 곳이 빠진다(실제로 `reset()` 이 빠져 있었다).
   * 그래서 **비우기를 함수 하나로** 만들고 모든 자리가 그것을 부른다.
   */
  function clearPayloadResult() {
    result.payload = undefined;
    result.payloadLength = 0;
    result.correctedCount = 0;
  }

  function hardDropReset() {
    /*
     * 🔴 카운터는 «드랍 **횟수**» 다 (2026-09-06 검토 R3c, 결함 4). 옛 코드는 무조건 +1 이었는데,
     * `observeIdentity` 는 `DROPPED` 에서 조기 반환하는 **흡수 상태**라 이 함수가 미검출 프레임마다
     * 다시 불린다 — 즉 세던 것은 「드랍된 뒤 코드가 안 보인 **프레임 수**」였다
     * (실측: 빈 프레임 25장 → 14, 45장 → 33. 드랍은 1회다). HUD 의 「왜 리셋됐나」가 그 수를 읽는다.
     * 전이만 세는 자는 「지금 이미 DROPPED 표시인가」다 — 재획득하면 다른 indicator 로 바뀐다.
     */
    if (result.indicator !== R2_INDICATOR.DROPPED) counters.hardDrops += 1;
    /*
     * 🔴 단조 유지를 푼다 (결함 5). 「신원을 잃었다」는 「지금까지의 D 를 계속 주장할 근거가
     * 없다」와 같은 말이다 — 증거는 유지하지만(위 문단) 막대는 지금 증거를 말해야 한다.
     */
    releaseProgressHold(progress);
    decodeFailStreak = 0;
    clearPayloadResult();
    result.indicator = R2_INDICATOR.DROPPED;
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
    decodeFailStreak = 0;
    result.status = configValid ? R2_SESSION_STATUS.OK : R2_SESSION_STATUS.INVALID_CONFIG;
    result.state = identity.state;
    result.indicator = R2_INDICATOR.SEARCHING;
    // 3b — 정정 수도 여기서 내려간다 (payload 와 같은 수명). 안 내리면 SEARCHING 인데 옛 DONE 의
    // 정정 수가 남아 「지금 이 화면이 k 개를 고쳤다」로 읽힌다 (3b 검토 F2·F11b).
    clearPayloadResult();
    counters.hardDrops = 0;
    counters.coastFrames = 0;
    counters.decodeAttempts = 0;
    counters.decodeFailures = 0;
    frameMs.decode = 0;
    return result;
  }

  function pushFrame(luma, width, height, timestamp, pose) {
    frameMs.decode = 0;
    if (!configValid) {
      result.status = R2_SESSION_STATUS.INVALID_CONFIG;
      result.indicator = R2_INDICATOR.FAILED;
      return syncResult();
    }
    if (complete) return syncResult();

    result.status = R2_SESSION_STATUS.OK;
    // 3b — 정정 수도 프레임마다 0 으로 내린다 (payload 와 같은 수명·같은 함수). ⚠ 위 `complete`
    // 조기 반환이 이 줄을 건너뛰므로 **흡수 프레임에서는 DONE 의 값이 그대로 남는다** — payload 와
    // 똑같은 성질이고, 그것이 계약이다 (3b 검토 F12: 옛 「나머지 프레임은 0」 문구가 거짓이었다).
    clearPayloadResult();

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
     *
     * ⚠ **「검증 후」를 지키는 것이 무엇인지 2026-09-06 에 바뀌었다** (검토 R3c). 옛 주석은
     * 「`hardDropReset` 이 누적기를 비웠으므로 증거가 0 부터 다시 쌓인다」를 근거로 들었는데,
     * 같은 날 위 문단에서 드랍이 **증거를 유지**하도록 바뀌어 그 문장이 거짓이 됐다
     * (실측 swap-multi#full: DROPPED → 재검출 뒤 D 0.75 를 그대로 이어 간다).
     * 지금 「검증」을 담당하는 것은 셋이다 — **재검출 성공**(이 게이트) · **F 게이트**(정합이
     * 무너진 프레임은 weight 0 이라 누적에 안 들어간다) · **λ 감쇠 0.9**(새 관측 10프레임이면
     * 옛 증거 기여가 e^-1 아래). 드랍이 되돌리는 것은 **신원과 D 의 단조 유지**뿐이다.
     * ⚠ 계약 문서(PM/029B §4 A4 행)도 같은 커밋에서 이 문장으로 갱신한다.
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
      if (identity.state === IDENTITY_STATE.COAST) counters.coastFrames += 1;
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
    alignmentOutput.distrusted = 0;
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

    /*
     * 🔴 **불신 프레임은 «보류» 다 — 신원 축을 굴리지 않는다** (2026-09-06 검토 3d, 결함 2·4).
     *
     * 옛 배선은 마진 미달을 `gatePassed = 0` 하나로만 말해 아래 `observeIdentity` 가
     * `advanceCoast` 를 굴렸다. 락은 안정적인데(rev 고정 · F 게이트 통과) `nCoast`(12) 프레임마다
     * DROPPED → `hardDropReset()` → 다음 프레임 재획득 → 다시 COAST 로 **하드 드랍이 제조된다**.
     * 실측 코퍼스(3d-corpus-wt.json ↔ fix3c): hardDrops y2-p9rot 1 → 7 · c3-tl 0 → 9 · swap-multi 0 → 17.
     * 패널의 「왜 리셋됐나」가 세는 것이 신원 상실이 아니라 마진 미달이 되고, 그 프레임의
     * HUD 위상이 DROPPED 라 불신 오버레이까지 한 프레임 꺼진다(세 그림이 서로 다른 말을 한다).
     *
     * ⚠ **드랍 경로를 지운 것이 아니다.** 코드를 진짜로 놓치면 어댑터가 F 연속 미달로 락을 걷고,
     * 그러면 `detectionOutput.found = 0` 이라 위의 미검출 경로가 COAST → DROPPED 를 정상적으로
     * 굴린다. 여기서 막는 것은 «락도 있고 코드도 보이는데 격자를 못 믿는» 프레임 하나다.
     * SPRT 도 그대로 둔다 — 불신 프레임은 옛 궤적을 확인해 주지도, 반증하지도 않는다.
     */
    if (alignmentOutput.distrusted) {
      holdProgress(progress);
      result.indicator = R2_INDICATOR.HOLD;
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
      counters.coastFrames += 1;
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

    // 되물림: 연속 실패 k 번이면 개정 k 개를 모아서 한 번 시도한다 (상한 DECODE_RETRY_GAP_MAX).
    const decodeGap = Math.max(1, Math.min(DECODE_RETRY_GAP_MAX, decodeFailStreak));
    if (progress.view.internalD >= 1
      && evidenceRevision !== lastDecodeRevision
      && evidenceRevision - lastDecodeRevision >= decodeGap) {
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
      decodeOutput.correctedCount = 0;
      result.indicator = R2_INDICATOR.FINALIZING;
      lastDecodeRevision = evidenceRevision;
      counters.decodeAttempts += 1;
      const decodeAt = performance.now();
      const decodeStatus = decodeInto(
        symbolValues,
        symbolConfidenceQ8,
        erasures,
        symbolCount,
        layout,
        decodeOutput,
        payloadBuffer,
      );
      frameMs.decode = performance.now() - decodeAt;
      if (decodeStatus !== R2_SESSION_STATUS.OK) {
        counters.decodeFailures += 1;
        decodeFailStreak += 1;
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
        decodeFailStreak = 0;
        result.payload = payloadBuffer;
        result.payloadLength = length;
        // 3b — 정정 위치는 **여기서만** 밖으로 나간다 (수용된 복호 = DONE 프레임). 버퍼는
        // decodeOutput 과 같은 객체라 복사가 없다 — 계약은 「개수가 유효 범위」다.
        const correctedRaw = Number(decodeOutput.correctedCount);
        result.correctedCount = Number.isFinite(correctedRaw)
          ? Math.max(0, Math.min(correctedPositions.length, Math.trunc(correctedRaw)))
          : 0;
        result.indicator = R2_INDICATOR.DONE;
      } else {
        // RS 실패는 **아무것도 안 버린다** — 다음 시도는 위 되물림 간격 뒤다.
        counters.decodeFailures += 1;
        decodeFailStreak += 1;
      }
    }

    return syncResult();
  }

  /**
   * 🔴 **DONE 을 무르되 증거는 지킨다** (2026-09-06 검토 R3c, 결함 8).
   *
   * RS 는 섰는데 그 바이트가 프레이밍(`unframe`)을 통과하지 못하는 후보가 있다. 옛 코드는
   * 런타임이 `continue` 로 「세션을 살려 뒀다」고 적었지만 `complete = 1` 이라 이후 `pushFrame`
   * 은 **즉시 반환**했다 — 같은 payload 를 되돌릴 뿐 누적하지 않는다. n=13 은 후보가 하나뿐이라
   * 그 순간 R2 가 `reset()` 까지 죽는다.
   *
   * 여기서 `complete` 만 되돌린다. 누적기·셀맵·증거 개정은 그대로이므로 **같은 증거로 다시 풀지는
   * 않는다**(`lastDecodeRevision === evidenceRevision`) — 증거가 더 쌓인 다음 개정에 다시 시도한다.
   * 그 시도가 또 프레이밍에서 막히면 되물림이 커져 비용이 스스로 준다.
   * @returns {number} 실제로 되돌렸으면 1.
   */
  function rejectPayload() {
    if (!complete) return 0;
    complete = 0;
    decodeFailStreak += 1;
    // 3b — 무른 복호가 「고쳤다」고 지목한 자리를 남기면 다음 프레임의 HUD·칩이 없는 결함을
    // 가리킨다. payload 와 같은 수명이라 같은 함수가 비운다 (3b 검토 F12).
    clearPayloadResult();
    result.indicator = R2_INDICATOR.COLLECTING;
    return 1;
  }

  return Object.freeze({
    pushFrame,
    reset,
    rejectPayload,
    result,
    buffers,
    params,
    layout,
    counters,
    frameMs,
  });
}
