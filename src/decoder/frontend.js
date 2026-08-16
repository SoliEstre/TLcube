/**
 * frontend.js — 래스터 입력에서 bootstrap 후보 선택까지의 얇은 조립층.
 *
 * 수치 알고리즘은 luma/finder/family/anchor/homography/grid/reference/bootstrap
 * 모듈이 소유한다. 이 파일은 단계 호출, 실패 코드 변환, 공개 결과 모양만 맡는다.
 */

import {
  enumerateGridHypotheses,
  enumeratePriorGridHypotheses,
  selectGridHypothesis,
} from './bootstrap.js';
import {
  FRONTEND_FAILURE,
  fail,
  ok,
} from './contracts.js';
import { toRelativeLuminance } from './luma.js';

function pointsOf(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out = [];
  for (const point of value) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

function cellPxFromH(H) {
  if (!H || H.length < 6) return null;
  const sx = Math.hypot(Number(H[0]), Number(H[3]));
  const sy = Math.hypot(Number(H[1]), Number(H[4]));
  if (!(sx > 0) || !(sy > 0)) return null;
  return (sx + sy) / 2;
}

function compactHypothesis(candidate) {
  const hypothesis = candidate.hypothesis;
  return {
    id: hypothesis.hypothesisId,
    family: hypothesis.family,
    k: hypothesis.k,
    n: hypothesis.n,
    orientation: hypothesis.orientation,
    rotationDegrees: hypothesis.rotationDegrees,
    centerQr: hypothesis.centerQr,
    source: hypothesis.source,
    locatorProfile: hypothesis.locatorProfile || null,
    locatorArm: hypothesis.locatorArm || null,
    cellSurfaceLayout: hypothesis.cellSurfaceLayout || null,
    locatorRoute: hypothesis.locatorRoute || null,
    locatorPhase: hypothesis.locatorPhase || null,
    cellSurface: hypothesis.cellSurface === true,
    tones: hypothesis.tones,
    formatIndex: hypothesis.formatIndex,
    facePhase: hypothesis.facePhase,
    cellSurfaceScore: hypothesis.cellSurfaceScore,
    orientationMargin: hypothesis.orientationMargin,
    orientationGate: hypothesis.orientationGate || null,
    cellSurfaceAmbiguous: hypothesis.cellSurfaceAmbiguous === true,
    canonicalSpace: hypothesis.canonicalSpace,
    geometryResidual: hypothesis.geometryResidual,
    sizeGeometry: hypothesis.sizeGeometry,
    cellSizePx: cellPxFromH(hypothesis.H),
    anchors: pointsOf(hypothesis.anchors),
    vertices: pointsOf(hypothesis.vertices),
  };
}

function failureDetail(stage, result, diagnostics) {
  const cause = result && result.detail;
  const lifted = diagnostics
    || (result && result.diagnostics)
    || (cause && cause.diagnostics)
    || undefined;
  return {
    stage,
    pipelineStage: cause && cause.stage ? cause.stage : stage,
    pipelineCode: cause && cause.pipelineCode,
    cause,
    diagnostics: lifted,
    // 가이드-사전 경로는 «어느 포즈가 포맷까지 갔나» 를 2단계 지터의 씨앗으로 쓴다.
    // detail.cause 안에 묻어 두면 호출자가 내부 구조를 알아야 하므로 위로 올린다.
    prior: cause && cause.prior,
    cubeFailure: cause && cause.cubeFailure,
    geometryDiagnostics: cause && cause.geometryDiagnostics,
    geometryStage: cause && cause.geometryStage,
    detectPath: cause && cause.detectPath,
  };
}

/**
 * RGBA raster를 텍스트 payload로 복호한다.
 *
 * 성공:
 *   {ok:true,text,version,eccLevel,corrected,crsDistance,hypothesis,diagnostics}
 *
 * 실패는 contracts.js의 FRONTEND_FAILURE만 공개 reason으로 쓰고, 기하 crop과
 * 실제 표본 부족을 구분한다. 내부 BODY_RS_FAILED/PAYLOAD_VALIDATION_FAILED/
 * NO_VALID_HYPOTHESIS는 detail.pipelineCode, 실제 실패 단계는 detail.pipelineStage에
 * 보존한다.
 */
export function decodeFrontend(raster, options = {}) {
  if (options === null || typeof options !== 'object') {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'frontend',
      cause: 'options-not-object',
    });
  }

  const luma = toRelativeLuminance(raster, options.luma || {});
  if (luma && luma.ok === false) {
    return fail(luma.reason, failureDetail('luma', luma));
  }

  const bootstrapOptions = options.bootstrap && typeof options.bootstrap === 'object'
    ? { ...options.bootstrap }
    : {};
  if (typeof options.onStage === 'function' && typeof bootstrapOptions.onStage !== 'function') {
    bootstrapOptions.onStage = options.onStage;
  }
  /*
   * 가이드-사전 경로 (운영자 요청 2026-08-16). `priorPoses` 가 있으면 **탐색 단계를
   * 돌지 않고** 그 포즈만 후보로 넣는다. 수용 게이트는 하나도 건너뛰지 않는다 —
   * bootstrap 의 `enumeratePriorGridHypotheses` 가 같은 `validateGridHypotheses` 로
   * 들어간다. 기존 연속 스캔 경로는 이 옵션이 없을 때 **바이트 단위로 종전과 같다.**
   */
  const priorPoses = Array.isArray(options.priorPoses) ? options.priorPoses : null;
  let enumerated;
  try {
    enumerated = priorPoses
      ? enumeratePriorGridHypotheses(luma, priorPoses, bootstrapOptions)
      : enumerateGridHypotheses(
        luma,
        options.familyEvidence,
        bootstrapOptions,
      );
  } catch (error) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: priorPoses ? 'prior' : 'bootstrap',
      pipelineCode: 'NO_VALID_HYPOTHESIS',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!enumerated.ok) {
    return fail(
      enumerated.reason || FRONTEND_FAILURE.NO_GRID_HYPOTHESIS,
      failureDetail(priorPoses ? 'prior' : 'bootstrap', enumerated),
    );
  }

  let selected;
  try {
    selected = selectGridHypothesis(enumerated.candidates, {
      ...bootstrapOptions,
      formatProposalCount: enumerated.diagnostics.validation.formatProposalCount,
      formatCandidateCount: enumerated.diagnostics.validation.formatCandidateCount,
    });
  } catch (error) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'selection',
      pipelineCode: 'NO_VALID_HYPOTHESIS',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!selected.ok) {
    return fail(
      selected.reason || FRONTEND_FAILURE.NO_GRID_HYPOTHESIS,
      failureDetail('selection', selected, enumerated.diagnostics),
    );
  }

  const winner = selected.candidate;
  return ok({
    text: winner.text,
    family: winner.family,
    version: winner.version,
    versionName: winner.versionName,
    tones: winner.tones,
    eccLevel: winner.eccLevel,
    corrected: winner.corrected,
    crsDistance: winner.crsDistance,
    hypothesis: compactHypothesis(winner),
    diagnostics: {
      bootstrap: enumerated.diagnostics,
      selection: selected.diagnostics,
      format: {
        formatIndex: winner.formatIndex,
        source: winner.formatCandidate.source,
        sources: winner.formatCandidate.sources,
        consensus: winner.formatCandidate.consensus,
      },
      reference: {
        ok: winner.referenceResult.ok,
        agreement: winner.referenceAgreement,
      },
      erasureFallback: winner.erasureFallback,
      cubeSamplingFallback: winner.cubeSamplingFallback,
    },
  });
}
