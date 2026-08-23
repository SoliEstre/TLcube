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

/**
 * **어느 중앙 파인더로 잡혔는가** — 관측된 파인더의 이름 (2026-08-19).
 *
 * 왜 필요한가: 운영자 순위 보고(«QR > 불스아이속큐브 > 불스아이 > 3톤큐브 > 그 외»)를
 * 계측으로 확인하려면 프레임마다 «무엇으로 잡혔나» 가 나와야 하는데, 지금까지 이 값이
 * 결과 밖으로 안 나갔다. `lab-telemetry.js` 의 `observedFromResult` 는 그래서
 * `hyp.source === 'bullseye'` 같은 **한 번도 생기지 않는 문자열**을 보고 있었고
 * (실제 source 는 `anchor-detector`·`cell-finder`·`central-cube-finder`… 다),
 * 그 결과 `observed_finder` 컬럼은 center-qr 말고는 영원히 빈칸이었다.
 * 즉 「셀 표면 파인더가 안 잡힌다」는 신고를 **잴 계기 자체가 없었다.**
 *
 * 규칙 — 지어내지 않고 검출기가 실제로 남긴 것만 읽는다:
 *   · `finder.patternId` — cell-mask 11종 · OAK 3종 · daehan · `central-cube-3tone` ·
 *     `central-v0`(비컨). 이 필드를 쓰는 검출기는 `cell-finder-detect.js` · 3톤 큐브 ·
 *     중앙 비컨 어댑터뿐이다.
 *   · `innerBandsReplaced` — 불스아이 후보만 갖는다. >0 이면 안쪽 두 밴드가 큐브인
 *     하이브리드(= 운영자가 말한 «불스아이속큐브»), 0 이면 순수 링.
 *   · **비-파인더 검출 경로** (F-30·F-64, 2026-08-23) — 큐브 실루엣·로케이터·셀 표면은
 *     중앙 파인더 없이 잡히는 경로라 위 두 필드가 없고, 그래서 이 경로의 **성공**
 *     프레임이 전부 observed_finder 공란이었다 — 「안 쟀다(옛 빌드)」와 구별이 안 됐다.
 *     검출기가 실제로 남긴 경로 id(`hypothesis.source` — cube-detect.js·
 *     cellSurfaceY-detect.js·locatorY-detect.js 가 스스로 적는 문자열)를 그대로 보고한다.
 *     경로 id 도 지어내지 않는다: 아는 접두(source 표의 실제 값)만 열고, 그 밖은 종전대로.
 *   · 그 밖에는 null. **모르는 것을 'bullseye' 로 채우지 않는다** — 빈칸은 「안 쟀다」고
 *     읽히지만 틀린 이름은 순위표를 조용히 오염시킨다.
 */
const NON_FINDER_SOURCE_PREFIXES = Object.freeze([
  'cube-silhouette',      // cube-detect.js 실루엣 경로 (…-y-junction[-three-tone-rank])
  'cube-finder-seed',     // cube-detect.js finder-seed y-spoke 경로
  'locator-',             // locator-cell-surface-* · locator-hex-frame-* (locatorSourceId)
  'cell-surface',         // cellsurface-block-detect.js 계열
]);

function finderPatternIdOf(hypothesis) {
  const finder = hypothesis.finder;
  if (finder && typeof finder.patternId === 'string' && finder.patternId) {
    return finder.patternId;
  }
  const replaced = finder && finder.innerBandsReplaced;
  if (Number.isFinite(replaced)) return replaced > 0 ? 'cube-bullseye' : 'bullseye';
  const source = typeof hypothesis.source === 'string' ? hypothesis.source : '';
  if (NON_FINDER_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix))) {
    return source;
  }
  return null;
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
    finderPatternId: finderPatternIdOf(hypothesis),
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
    ...(hypothesis.beacon ? { beacon: hypothesis.beacon } : {}),
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
