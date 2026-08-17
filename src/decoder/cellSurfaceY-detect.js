/**
 * cellSurfaceY-detect.js — cell-surface-v1 61좌표 known-tone 점수.
 *
 * 기하 후보는 기존 Type Y 실루엣/Y-심이 만든다. 이 모듈은 그 격자 위에
 * 61좌표 dark/bright 표본을 읽어 profile·면 위상·방향을 점수로 남긴다.
 * A(구 대칭)·B(신 비대칭) 기대를 둘 다 채점하고 더 높은 쪽을 택한다.
 * B 는 면 순환 3상의 agreement 차로 orientation margin 을 재고 선언된
 * minimumOrientationMargin 을 hard gate 로 쓴다. A 는 거의 대칭이라
 * margin ≈ 0 이므로 그 게이트를 면제하되, 면제 사실을 진단에 남긴다.
 *
 * **locator 셀 소거 (2026-08-16)** — 프레임 밖으로 잘린 locator 셀 하나가 표 전체를
 * 죽이지 않는다 (`sampleLocatorTable`). 그 자리는 `ok:false` placeholder 로 인덱스를
 * 지킨 채 남고, 이미 있던 «관측 없는 표본은 건너뛴다» 규칙이 처리한다. 이것은 소거
 * 인프라 재사용이지 **게이트 완화가 아니다**: agreement 식(matches/total)과 문턱
 * (0.78 · margin 0.035 · toneSpan · 면별 톤당 최소 표본 8)은 한 값도 안 바뀌었고,
 * 잘린 셀은 분모에서 빠질 뿐 «불일치» 로도 «관측» 으로도 세지 않는다. 전량 소거면
 * 예전처럼 실패한다. 관측이 적은 포즈를 막는 것은 **면별 톤당 정족수**이며, 그
 * 정족수가 실제로 무는지는 `cellSurface-clip-partial.test.js` 가 단언한다.
 *
 * 모든 임계값은 합성 실험용 [미검증]이며 options.calibration 으로 덮을 수 있다.
 */

import {
  CELL_SURFACE_ARM_A,
  CELL_SURFACE_ARM_B,
  CELL_SURFACE_ARMS,
  CELL_SURFACE_N,
  CELL_SURFACE_PROFILE_ID,
  CELL_SURFACE_VERSION,
  DEFAULT_CELL_SURFACE_ARM,
  cellSurfaceProfileId,
  formatIndexCellSurface,
  locatorCellsCellSurface,
} from '../cellSurfaceY.js';
import {
  DEFAULT_CELL_SURFACE_LAYOUT,
  cellSurfaceLayout,
  formatIndexCellSurfaceLayout,
} from '../cellSurfaceLayouts.js';
import {
  CELL_SURFACE_FINAL_NS,
  CELL_SURFACE_FINAL_PROFILE,
  allFinalLayoutIdsForN,
  finalLayoutIdForN,
  finalLayoutIdsForN,
  hasFinalLayoutWireForN,
  formatIndexCellSurfaceFinal,
  isCellSurfaceFinalId,
  locatorCellsCellSurfaceFinal,
  versionForFinalN,
} from '../cellSurfaceFinal.js';
import { YFACES } from '../ygrid.js';
import { FRONTEND_FAILURE, fail, ok } from './contracts.js';

export const UNVERIFIED_CELL_SURFACE_Y = Object.freeze({
  minimumAgreement: 0.78,
  minimumOrientationMargin: 0.035,
  minimumToneSpan: 0.012,
  minimumSamplesPerTone: 8,
  classifyMidFraction: 0.28,
});

const FACE_CYCLES = Object.freeze([
  Object.freeze(['T', 'L', 'R']),
  Object.freeze(['L', 'R', 'T']),
  Object.freeze(['R', 'T', 'L']),
]);

function cellKey(i, j) {
  return i + ',' + j;
}

function remappedLocators(cycle, locators) {
  return locators.map((cell) => ({
    i: cell.i,
    j: cell.j,
    T: cell[cycle[0]],
    L: cell[cycle[1]],
    R: cell[cycle[2]],
  }));
}

function calibration(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  const overlay = supplied.cellSurfaceY && typeof supplied.cellSurfaceY === 'object'
    ? supplied.cellSurfaceY
    : {};
  return {
    ...UNVERIFIED_CELL_SURFACE_Y,
    ...overlay,
  };
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function classifyTone(value, dark, bright, midFraction) {
  if (!(bright > dark)) return -1;
  const span = bright - dark;
  const midLow = dark + span * (0.5 - midFraction / 2);
  const midHigh = dark + span * (0.5 + midFraction / 2);
  if (value <= midLow) return 0;
  if (value >= midHigh) return 2;
  return 1;
}

function scoreMappedSamples(samples, cfg, locators) {
  const darkByFace = { T: [], L: [], R: [] };
  const brightByFace = { T: [], L: [], R: [] };
  const table = locators || locatorCellsCellSurface();

  for (let index = 0; index < table.length; index += 1) {
    const expected = table[index];
    const sample = samples[index];
    if (!sample || sample.ok === false) continue;
    for (const face of YFACES) {
      const tone = expected[face];
      const value = sample[face] && sample[face].median;
      if (!Number.isFinite(value)) continue;
      if (tone === 0) darkByFace[face].push(value);
      else if (tone === 2) brightByFace[face].push(value);
    }
  }

  const anchors = {};
  let minimumSpan = Infinity;
  const sampleCounts = {};
  for (const face of YFACES) {
    const dark = median(darkByFace[face]);
    const bright = median(brightByFace[face]);
    const span = bright - dark;
    anchors[face] = { dark, bright, span };
    sampleCounts[face] = {
      dark: darkByFace[face].length,
      bright: brightByFace[face].length,
    };
    if (Number.isFinite(span)) minimumSpan = Math.min(minimumSpan, span);
  }

  let matches = 0;
  let total = 0;
  const faceMatches = { T: 0, L: 0, R: 0 };
  const faceTotal = { T: 0, L: 0, R: 0 };
  const observations = [];

  for (let index = 0; index < table.length; index += 1) {
    const expected = table[index];
    const sample = samples[index];
    if (!sample || sample.ok === false) continue;
    for (const face of YFACES) {
      const value = sample[face] && sample[face].median;
      if (!Number.isFinite(value)) continue;
      const observed = classifyTone(
        value,
        anchors[face].dark,
        anchors[face].bright,
        cfg.classifyMidFraction,
      );
      const want = expected[face];
      const matched = observed === want;
      total += 1;
      faceTotal[face] += 1;
      if (matched) {
        matches += 1;
        faceMatches[face] += 1;
      }
      observations.push({
        key: cellKey(expected.i, expected.j),
        face,
        expected: want,
        observed,
        matched,
      });
    }
  }

  const agreement = total > 0 ? matches / total : 0;
  const enoughSamples = YFACES.every((face) =>
    sampleCounts[face].dark >= cfg.minimumSamplesPerTone
    && sampleCounts[face].bright >= cfg.minimumSamplesPerTone);
  const toneSeparation = Number.isFinite(minimumSpan) && minimumSpan >= cfg.minimumToneSpan;
  const accepted = enoughSamples && toneSeparation && agreement >= cfg.minimumAgreement;

  const levelAnchors = {};
  for (const face of YFACES) {
    const dark = anchors[face].dark;
    const bright = anchors[face].bright;
    const mid = Number.isFinite(dark) && Number.isFinite(bright)
      ? (dark + bright) / 2
      : NaN;
    levelAnchors[face] = [dark, mid, bright];
  }

  return {
    agreement,
    matches,
    total,
    minimumSpan,
    enoughSamples,
    toneSeparation,
    accepted,
    sampleCounts,
    faceAgreement: Object.fromEntries(
      YFACES.map((face) => [
        face,
        faceTotal[face] > 0 ? faceMatches[face] / faceTotal[face] : 0,
      ]),
    ),
    anchors,
    levelAnchors,
    observations,
  };
}

function scoreOnePattern(samples, cfg, locators, meta) {
  const phases = FACE_CYCLES.map((cycle, phase) => ({
    phase,
    cycle,
    ...scoreMappedSamples(samples, cfg, remappedLocators(cycle, locators)),
  }));
  const ranked = phases.slice().sort((left, right) =>
    right.agreement - left.agreement || left.phase - right.phase);
  const claimed = phases[0];
  const rival = ranked.find((entry) => entry.phase !== 0) || ranked[1];
  const orientationMargin = claimed.agreement - (rival ? rival.agreement : 0);
  const orientationOk = ranked[0].phase === 0
    && orientationMargin >= cfg.minimumOrientationMargin;
  const orientationGate = meta.orientationGate || 'applied';
  const orientationGateApplied = orientationGate === 'applied';
  const accepted = claimed.accepted
    && (orientationGateApplied ? orientationOk : true);
  let rejectReason = null;
  if (!accepted) {
    if (!claimed.enoughSamples) rejectReason = 'sample-count';
    else if (!claimed.toneSeparation) rejectReason = 'tone-separation';
    else if (claimed.agreement < cfg.minimumAgreement) rejectReason = 'below-agreement';
    else if (orientationGateApplied && !orientationOk) rejectReason = 'orientation-margin';
    else rejectReason = 'rejected';
  }
  const profile = meta.profile;
  const arm = meta.arm || null;
  const layoutId = meta.layoutId || null;
  return {
    arm,
    layoutId,
    profile,
    accepted,
    best: { ...claimed, accepted, arm, layoutId, profile },
    phases,
    orientationMargin,
    orientationOk,
    orientationGate,
    orientationGateApplied,
    diagnostics: {
      profile,
      arm,
      layoutId,
      accepted,
      agreement: claimed.agreement,
      orientationMargin,
      orientationGate,
      orientationGateApplied,
      phase: 0,
      cycle: claimed.cycle,
      rivalPhase: rival ? rival.phase : null,
      rivalAgreement: rival ? rival.agreement : 0,
      rejectReason,
      sampleCounts: claimed.sampleCounts,
      faceAgreement: claimed.faceAgreement,
      minimumSpan: claimed.minimumSpan,
      enoughSamples: claimed.enoughSamples,
      toneSeparation: claimed.toneSeparation,
    },
  };
}

function scoreOneArm(samples, cfg, arm) {
  return scoreOnePattern(samples, cfg, locatorCellsCellSurface(arm), {
    arm,
    profile: cellSurfaceProfileId(arm),
    orientationGate: arm === CELL_SURFACE_ARM_A ? 'waived' : 'applied',
  });
}

/**
 * 레이아웃 id + n → locator 표. 최종 라인업(v0/v2r2)은 n 에 맞는 인스턴스를,
 * 초안(v1r2/v2)은 n=21 전용 표를 준다. id 가 그 n 을 지원하지 않으면 null.
 */
function layoutLocatorsFor(layoutId, n) {
  if (isCellSurfaceFinalId(layoutId)) {
    if (!CELL_SURFACE_FINAL_NS[layoutId].includes(n)) return null;
    return locatorCellsCellSurfaceFinal(n, layoutId);
  }
  if (n !== CELL_SURFACE_N) return null;
  return cellSurfaceLayout(layoutId).locatorCells;
}

function layoutProfileFor(layoutId) {
  if (isCellSurfaceFinalId(layoutId)) return CELL_SURFACE_FINAL_PROFILE[layoutId];
  return cellSurfaceLayout(layoutId).profile;
}

function scoreOneLayout(samples, cfg, layoutId, locators) {
  return scoreOnePattern(samples, cfg, locators, {
    layoutId,
    profile: layoutProfileFor(layoutId),
    orientationGate: 'applied',
  });
}

function pickBetterArm(left, right) {
  if (left.accepted !== right.accepted) return left.accepted ? left : right;
  const leftScore = left.best && left.best.agreement;
  const rightScore = right.best && right.best.agreement;
  if (leftScore !== rightScore) {
    if (!Number.isFinite(leftScore)) return right;
    if (!Number.isFinite(rightScore)) return left;
    return leftScore >= rightScore ? left : right;
  }
  return left.arm === DEFAULT_CELL_SURFACE_ARM ? left : right;
}

/**
 * 이미 샘플된 61셀에 대해 A·B 기대 패턴과 3개 면 위상을 점수화한다.
 * 둘 다 맞으면 더 높은 agreement 쪽을 택하고 ambiguous 를 남긴다.
 */
export function scoreCellSurfaceSamples(samples, options = {}) {
  const cfg = calibration(options);
  if (!Array.isArray(samples) || samples.length !== locatorCellsCellSurface().length) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cell-surface',
      cause: 'sample-count',
      count: samples && samples.length,
    });
  }

  const requestedArm = options.locatorArm == null || options.locatorArm === ''
    ? null
    : options.locatorArm;
  if (requestedArm !== null && requestedArm !== CELL_SURFACE_ARM_A
    && requestedArm !== CELL_SURFACE_ARM_B) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cell-surface',
      cause: 'unknown-arm',
      locatorArm: requestedArm,
    });
  }
  const tryArms = requestedArm ? [requestedArm] : CELL_SURFACE_ARMS;
  const arms = {};
  for (const arm of tryArms) {
    arms[arm] = scoreOneArm(samples, cfg, arm);
  }
  const scoredA = arms[CELL_SURFACE_ARM_A] || null;
  const scoredB = arms[CELL_SURFACE_ARM_B] || null;
  const chosen = scoredA && scoredB
    ? pickBetterArm(scoredA, scoredB)
    : (scoredA || scoredB);
  const bothAccepted = Boolean(scoredA && scoredB && scoredA.accepted && scoredB.accepted);
  const ambiguous = bothAccepted;
  const accepted = chosen.accepted;
  const diagnostics = {
    ...chosen.diagnostics,
    profile: chosen.profile,
    arm: chosen.arm,
    ambiguous,
    arms: {
      A: scoredA ? {
        accepted: scoredA.accepted,
        agreement: scoredA.best.agreement,
        orientationMargin: scoredA.orientationMargin,
        orientationGate: scoredA.orientationGate,
        rejectReason: scoredA.diagnostics.rejectReason,
        profile: scoredA.profile,
      } : null,
      B: scoredB ? {
        accepted: scoredB.accepted,
        agreement: scoredB.best.agreement,
        orientationMargin: scoredB.orientationMargin,
        orientationGate: scoredB.orientationGate,
        rejectReason: scoredB.diagnostics.rejectReason,
        profile: scoredB.profile,
      } : null,
    },
  };
  if (ambiguous) diagnostics.rejectReason = null;
  else if (!accepted && chosen.diagnostics.rejectReason) {
    diagnostics.rejectReason = chosen.diagnostics.rejectReason;
  }

  return ok({
    accepted,
    best: chosen.best,
    phases: chosen.phases,
    orientationMargin: chosen.orientationMargin,
    orientationGate: chosen.orientationGate,
    orientationGateApplied: chosen.orientationGateApplied,
    arm: chosen.arm,
    profile: chosen.profile,
    ambiguous,
    arms,
    diagnostics,
  });
}

function calibrationForTones(best, scored, tones) {
  const shared = {
    agreement: best.matches,
    total: best.total,
    agreementRate: best.agreement,
    minimumSpan: best.minimumSpan,
    medianMargin: scored.orientationMargin,
    observations: best.observations,
    hardChecks: {
      toneSeparation: best.toneSeparation,
      referenceAgreement: best.accepted,
      all: scored.accepted,
    },
    source: CELL_SURFACE_PROFILE_ID,
    locatorArm: best.arm || DEFAULT_CELL_SURFACE_ARM,
  };
  if (tones === 2) {
    const thresholds = {};
    for (const face of YFACES) {
      const dark = best.anchors[face].dark;
      const bright = best.anchors[face].bright;
      thresholds[face] = dark > 0 && bright > 0
        ? Math.sqrt(dark * bright)
        : (dark + bright) / 2;
    }
    return {
      tones: 2,
      thresholds,
      anchors: best.anchors,
      ...shared,
    };
  }
  return {
    tones: 3,
    levelAnchors: best.levelAnchors,
    anchors: best.anchors,
    ...shared,
  };
}

function hypothesisPatchForTones(best, scored, samples, tones, n = CELL_SURFACE_N) {
  const layoutId = scored.layoutId || best.layoutId || null;
  const profile = scored.profile || best.profile || CELL_SURFACE_PROFILE_ID;
  const isFinal = isCellSurfaceFinalId(layoutId);
  const formatIndex = layoutId
    ? (isFinal ? formatIndexCellSurfaceFinal(tones) : formatIndexCellSurfaceLayout(layoutId, tones))
    : formatIndexCellSurface(tones);
  return {
    cellSurface: true,
    cellSurfaceLayout: layoutId,
    locatorProfile: layoutId ? profile : CELL_SURFACE_PROFILE_ID,
    locatorArm: scored.arm || best.arm || null,
    locatorRoute: 'cell-surface',
    source: layoutId ? 'locator-cell-surface-' + layoutId : 'locator-cell-surface-v1',
    version: isFinal ? versionForFinalN(n) : CELL_SURFACE_VERSION,
    tones,
    formatIndex,
    facePhase: best.phase,
    faceCycle: best.cycle,
    cellSurfaceScore: best.agreement,
    orientationMargin: scored.orientationMargin,
    orientationGate: scored.orientationGate || 'applied',
    orientationGateApplied: scored.orientationGateApplied !== false,
    cellSurfaceAmbiguous: scored.ambiguous === true,
    referenceCalibration: calibrationForTones(best, scored, tones),
    // 소거된(프레임 밖) 자리는 지도에서 뺀다 — 0 으로 위장한 «관측» 을 만들지 않는다.
    referenceSamples: new Map(samples
      .filter((sample) => sample && sample.ok !== false)
      .map((sample) => [cellKey(sample.i, sample.j), sample])),
    referenceAgreement: best.agreement,
    referenceRefinement: {
      dx: 0,
      dy: 0,
      quality: 100 * best.agreement,
    },
    cellSurfaceDiagnostics: scored.diagnostics,
  };
}

/**
 * 기하 가설 하나에 61좌표를 샘플하고 점수를 붙인다.
 * sampleCell(i,j) 는 cube-detect.sampleCubeCell 과 같은 모양을 돌려야 한다.
 * locator 는 dark/bright 만 쓰며, 2톤·3톤 데이터 가설을 둘 다 만든다.
 */
/**
 * locator 표를 표본한다. **프레임 밖으로 잘린 셀 하나가 표 전체를 죽이지 않는다** —
 * 그 자리는 `ok:false` placeholder 로 **인덱스를 지킨 채** 남고, 채점기가 이미
 * 갖고 있던 «관측 없는 표본은 건너뛴다» 규칙(scoreMappedSamples)이 그대로 처리한다.
 * 소거 인프라 재사용이지 게이트 완화가 아니다:
 *   · agreement 식은 `matches / total` 그대로이고 `total` 은 **관측된 표본만** 센다
 *     (분모를 늘려 잘린 셀을 «불일치» 로 세지도, 줄여 점수를 부풀리지도 않는다).
 *   · 수용 문턱 0.78 · orientation margin 0.035 · toneSpan · **면별 톤당 최소
 *     표본 수(minimumSamplesPerTone 8)** 는 한 값도 바뀌지 않는다. 관측이 적은
 *     포즈는 그 정족수에서 먼저 죽는다 — 이게 «몇 셀만 우연히 맞아 통과» 를 막는 방어선이다.
 *   · **전부 잘리면** 예전처럼 실패한다 (`readFormatForHypothesis` 의 15셀 전 소거
 *     계약과 같은 모양).
 */
function sampleLocatorTable(sampleCell, locators) {
  const samples = [];
  let observed = 0;
  let firstFailure = null;
  for (const cell of locators) {
    const sampled = sampleCell(cell.i, cell.j);
    if (!sampled || sampled.ok === false) {
      if (firstFailure === null) firstFailure = { cell, sampled };
      samples.push({
        ok: false,
        i: cell.i,
        j: cell.j,
        reason: (sampled && sampled.reason) || FRONTEND_FAILURE.NO_GRID_HYPOTHESIS,
      });
      continue;
    }
    samples.push(sampled);
    observed += 1;
  }
  if (observed === 0) {
    const sampled = firstFailure && firstFailure.sampled;
    return fail(sampled && sampled.reason ? sampled.reason : FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cell-surface-sampling',
      cell: firstFailure && firstFailure.cell,
      cause: sampled && sampled.detail,
      erasedLocatorCells: locators.length,
    });
  }
  return ok({ samples, observedLocatorCells: observed, erasedLocatorCells: samples.length - observed });
}

/**
 * 어떤 레이아웃들을 채점할지. 기본은 **n 별 최종 라인업 후보 전부** —
 * v2r2·v1r2 드랍 + v0W 편입(2026-08-16) · v0XQ 드랍 + v0W2 편입 ·
 * v0X 드랍(2026-08-17 3라운드) · **v0T 편입 + v0W 계열 전체 드랍(2026-08-17) 후**:
 * n=13→[v0] · n=21→[**v0t**, v0ty] · n=25→**[]**.
 * 수용은 아래 기존 게이트가 판정한다 (한 값도 안 바뀌었다):
 * agreement ≥ 0.78 · orientation margin ≥ 0.035. 두 레이아웃이 다 통과하면
 * ambiguous 로 남기고 agreement 가 높은 쪽(동률이면 그 n 의 기본)을 고른다.
 * 드랍된 둘은 `cellSurfaceLayout(s)` 명시 옵션으로만 채점된다 (법의학·대조군).
 * 이 경로 전체가 lab 전용이다 — 스캐너는 `enableCellSurfaceY: isLabPath()` 로만 켠다.
 * 초안(v1r2d/v2)과 구 v1 CS 는 명시 옵션으로만 산다 (배포 출력물 법의학 경로).
 */
function resolveLayoutIds(options, n) {
  if (options.enableLegacyCellSurfaceV1 === true && !options.cellSurfaceLayout
    && !options.cellSurfaceLayouts) {
    return null;
  }
  if (typeof options.cellSurfaceLayout === 'string' && options.cellSurfaceLayout) {
    return [options.cellSurfaceLayout];
  }
  if (Array.isArray(options.cellSurfaceLayouts) && options.cellSurfaceLayouts.length > 0) {
    return options.cellSurfaceLayouts;
  }
  // 드랍 복원 스위치 (대조군·법의학) — 드랍된 v2r2·v1r2·v0xq·v0x 와
  // **v0w 계열 넷**(2026-08-17 v0T 편입 라운드) 을 후보로 되돌린다.
  // 블록 로케이터 쪽 짝은 `calibration.csBlockLocator.{v2r2Family,v1r2Family,
  // v0xqFamily,v0xFamily,v0wFamily,v0wqFamily,v0w2Family,v0wyFamily}` 다.
  // 둘을 함께 켜면 드랍 전 검출이 그대로 돌아온다 (게이트는 한 값도 안 바뀌었다).
  if (options.includeDroppedCellSurfaceLayouts === true) return [...allFinalLayoutIdsForN(n)];
  return [...finalLayoutIdsForN(n)];
}

/**
 * 동률 처리 — 수용 여부 → agreement → **선호 id**(그 n 의 기본 최종 레이아웃,
 * 없으면 초안 기본) 순. 후보가 둘인 n=21 에서 «둘 다 같은 점수» 를 결정적으로 깬다.
 */
function pickBetterLayout(left, right, preferredId) {
  if (left.accepted !== right.accepted) return left.accepted ? left : right;
  const leftScore = left.best && left.best.agreement;
  const rightScore = right.best && right.best.agreement;
  if (leftScore !== rightScore) {
    if (!Number.isFinite(leftScore)) return right;
    if (!Number.isFinite(rightScore)) return left;
    return leftScore >= rightScore ? left : right;
  }
  const preferred = preferredId || DEFAULT_CELL_SURFACE_LAYOUT;
  if (left.layoutId === preferred) return left;
  if (right.layoutId === preferred) return right;
  return left;
}

export function evaluateCellSurfaceGeometry(hypothesis, sampleCell, options = {}) {
  const n = hypothesis && hypothesis.n;
  // **와이어** 질의 — 명시 옵션(`cellSurfaceLayout: 'v2r2'`) 법의학 경로가 n=25 에서
  // 계속 살아 있어야 한다. 라인업 필터는 아래 `resolveLayoutIds` 가 한다.
  if (!hypothesis || (n !== CELL_SURFACE_N && !hasFinalLayoutWireForN(n))) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cell-surface',
      cause: 'unsupported-n',
      n,
    });
  }

  const requestedLayoutIds = resolveLayoutIds(options, n);
  if (requestedLayoutIds) {
    // 이 n 에서 실제 locator 표가 있는 레이아웃만 남긴다 (초안·구형은 n=21 전용,
    // 최종 v0 는 n=13 · v2r2 는 n=21/25 전용).
    const layoutIds = requestedLayoutIds.filter(
      (layoutId) => layoutLocatorsFor(layoutId, n) !== null,
    );
    if (layoutIds.length === 0) {
      return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
        stage: 'cell-surface',
        cause: 'unsupported-n',
        n,
        requestedLayoutIds,
      });
    }
    const cfg = calibration(options);
    const scoredLayouts = {};
    let chosen = null;
    let chosenSamples = null;
    let firstSampleFailure = null;
    const sampledIds = [];
    const erasure = {};
    for (const layoutId of layoutIds) {
      const locators = layoutLocatorsFor(layoutId, n);
      const sampled = sampleLocatorTable(sampleCell, locators);
      if (!sampled.ok) {
        // 후보 하나의 표본 실패가 다른 후보의 기회를 죽이지 않는다 — 전부 실패할
        // 때만 첫 실패를 그대로 돌려준다 (후보가 하나뿐이면 종전과 동일).
        if (firstSampleFailure === null) firstSampleFailure = sampled;
        continue;
      }
      sampledIds.push(layoutId);
      erasure[layoutId] = {
        observed: sampled.observedLocatorCells,
        erased: sampled.erasedLocatorCells,
      };
      const scored = scoreOneLayout(sampled.samples, cfg, layoutId, locators);
      scoredLayouts[layoutId] = scored;
      if (!chosen) {
        chosen = scored;
        chosenSamples = sampled.samples;
      } else {
        const next = pickBetterLayout(chosen, scored, finalLayoutIdForN(n) || undefined);
        if (next === scored) chosenSamples = sampled.samples;
        chosen = next;
      }
    }
    if (chosen === null) return firstSampleFailure;
    const bothAccepted = sampledIds.length > 1
      && sampledIds.every((id) => scoredLayouts[id] && scoredLayouts[id].accepted);
    const accepted = chosen.accepted;
    const diagnostics = {
      ...chosen.diagnostics,
      ambiguous: bothAccepted,
      layouts: Object.fromEntries(sampledIds.map((id) => [id, {
        accepted: scoredLayouts[id].accepted,
        agreement: scoredLayouts[id].best.agreement,
        orientationMargin: scoredLayouts[id].orientationMargin,
        rejectReason: scoredLayouts[id].diagnostics.rejectReason,
        profile: scoredLayouts[id].profile,
        // 프레임 밖으로 잘려 관측이 없던 locator 셀 수 — 수용에는 관여하지 않고
        // (분모에서 빠질 뿐) «이 판정이 몇 셀 위에 서 있나» 를 읽게 남긴다.
        observedLocatorCells: erasure[id] ? erasure[id].observed : null,
        erasedLocatorCells: erasure[id] ? erasure[id].erased : null,
      }])),
      locatorErasure: erasure[chosen.layoutId] || null,
    };
    const packed = {
      accepted,
      best: chosen.best,
      phases: chosen.phases,
      orientationMargin: chosen.orientationMargin,
      orientationGate: chosen.orientationGate,
      orientationGateApplied: chosen.orientationGateApplied,
      arm: null,
      layoutId: chosen.layoutId,
      profile: chosen.profile,
      ambiguous: bothAccepted,
      diagnostics,
    };
    const best = packed.best;
    const hypothesisPatches = [2, 3].map((tones) =>
      hypothesisPatchForTones(best, packed, chosenSamples, tones, n));
    return ok({
      accepted,
      samples: chosenSamples,
      scored: packed,
      hypothesisPatches,
      hypothesisPatch: hypothesisPatches[1],
      diagnostics,
    });
  }

  // 구 v1 CS 61-locator 경로 — n=21 전용 (enableLegacyCellSurfaceV1 명시 시에만 온다).
  if (n !== CELL_SURFACE_N) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'cell-surface',
      cause: 'unsupported-n',
      n,
    });
  }
  const samples = [];
  for (const cell of locatorCellsCellSurface()) {
    const sampled = sampleCell(cell.i, cell.j);
    if (!sampled || sampled.ok === false) {
      return fail(sampled && sampled.reason ? sampled.reason : FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
        stage: 'cell-surface-sampling',
        cell,
        cause: sampled && sampled.detail,
      });
    }
    samples.push(sampled);
  }

  const scored = scoreCellSurfaceSamples(samples, options);
  if (!scored.ok) return scored;

  const best = scored.best;
  const hypothesisPatches = [2, 3].map((tones) =>
    hypothesisPatchForTones(best, scored, samples, tones));

  return ok({
    accepted: scored.accepted,
    samples,
    scored,
    hypothesisPatches,
    hypothesisPatch: hypothesisPatches[1],
    diagnostics: scored.diagnostics,
  });
}

export function cellSurfaceSourceId() {
  return 'locator-cell-surface-v1';
}
