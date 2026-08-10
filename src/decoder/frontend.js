/**
 * frontend.js — 래스터 입력에서 bootstrap 후보 선택까지의 얇은 조립층.
 *
 * 수치 알고리즘은 luma/finder/family/anchor/homography/grid/reference/bootstrap
 * 모듈이 소유한다. 이 파일은 단계 호출, 실패 코드 변환, 공개 결과 모양만 맡는다.
 */

import {
  enumerateGridHypotheses,
  selectGridHypothesis,
} from './bootstrap.js';
import {
  FRONTEND_FAILURE,
  fail,
  ok,
} from './contracts.js';
import { toRelativeLuminance } from './luma.js';

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
    geometryResidual: hypothesis.geometryResidual,
    sizeGeometry: hypothesis.sizeGeometry,
  };
}

function failureDetail(stage, result, diagnostics) {
  return {
    stage,
    cause: result && result.detail,
    diagnostics,
  };
}

/**
 * RGBA raster를 텍스트 payload로 복호한다.
 *
 * 성공:
 *   {ok:true,text,version,eccLevel,corrected,crsDistance,hypothesis,diagnostics}
 *
 * 실패는 contracts.js의 FRONTEND_FAILURE만 공개 reason으로 쓰고, 개정 설계의
 * BODY_RS_FAILED/PAYLOAD_VALIDATION_FAILED/NO_VALID_HYPOTHESIS 구분은 현재
 * contracts.js에 항목이 없으므로 detail.pipelineCode로 보존한다.
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
    ? options.bootstrap
    : {};
  let enumerated;
  try {
    enumerated = enumerateGridHypotheses(
      luma,
      options.familyEvidence,
      bootstrapOptions,
    );
  } catch (error) {
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'bootstrap',
      pipelineCode: 'NO_VALID_HYPOTHESIS',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!enumerated.ok) {
    return fail(
      enumerated.reason || FRONTEND_FAILURE.NO_GRID_HYPOTHESIS,
      failureDetail('bootstrap', enumerated),
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
    version: winner.version,
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
    },
  });
}
