/**
 * scan-guide-prior.js — 3링 조준 가이드에서 **기대 포즈(prior)** 를 유도한다.
 *
 * 전제: 사용자가 손떨림 범위 안에서 1.5초 이상 같은 뷰를 유지했다면(`scan-steady.js`),
 * 「코드를 가이드에 어느 정도 맞췄다」 고 볼 수 있다. 그러면 코드의 상(image) 안 위치·
 * 크기·방향은 **가이드 기하가 이미 말해 주고 있다** — 탐색으로 다시 찾을 필요가 없다.
 *
 * ## 유도 (scanner-zoom.js 의 가이드 상수에서만 나온다 — 삼각함수 재계산 없음)
 *
 * 분석 정사각 한 변 `S` 에서
 *   R_out = GUIDE_OUTER_FRACTION · S/2      (바깥 링 반지름, C 방향)
 *   R_mid = R_out / √3                      (중간 링 반지름, E 방향)
 *
 * 각 레이아웃이 가이드에 「맞았을 때」 의 셀 크기 s (canonical unit 1 → px):
 *   · Type O (hex, k)  — 실루엣 육각이 **중간 링**:
 *       s = R_mid / silhouetteRadiusCells(k) = R_out/(3k+2)
 *   · Type K/A (tri, k) — 첨두가 **바깥 링**:
 *       s = R_out / kaApexRadiusCells(k)     = R_out/(3k+2)
 *   · Type Y (cube, n) — 육각 꼭짓점이 **바깥 링** (canonical 꼭짓점 반경 = n):
 *       s = R_out / n
 * 앞의 둘이 **같은 식**인 것이 우연이 아니다 — `silhouetteRadiusCells(k) =
 * kaApexRadiusCells(k)/√3` 라는 유리수 항등(scanner-zoom.js 주석 · 운영자 불변식)이다.
 *
 * ## 포즈 = 순수 닮음변환
 * 가이드에 맞춘 코드는 정면(frontal)이라고 본다. 그래서 H 는 회전·배율·평행이동뿐이다:
 *
 *     H = [ s·cosθ  −s·sinθ  cx ;  s·sinθ  s·cosθ  cy ;  0 0 1 ]   (canonical → image)
 *
 * 기울임(perspective)은 사전 후보에 넣지 않는다. 기울어 있으면 사전이 실패하고 기존
 * 연속 스캔 경로가 그대로 잡는다 — 사전은 **추가 경로**지 대체가 아니다.
 *
 * ## 회전이 6개인 이유
 * 가이드의 바깥 6점은 60° 간격이라, 사용자가 코드를 어떻게 돌려 대든 「맞았다」 로 보인다.
 * 그리고 H = s·R(θ) 는 스칼라 회전과 교환되므로(`R(60)·s·R(θ) = s·R(θ+60)`), 상에서의
 * 60° 회전은 canonical 프레임을 60° 돌린 것과 **완전히 같다** — 마름모 spine 구조가
 * 함께 돌아가므로 6개 전부 정당한 후보다. (120° 만 넣으면 실제 사용자의 절반을 놓친다.)
 *
 * ## 이 모듈이 하지 않는 것
 * 게이트를 건드리지 않는다. 여기서 나오는 것은 **후보 목록**뿐이고, 수용은 전적으로
 * 디코더의 기존 게이트가 결정한다. 사전 포즈는 «검증 면제» 가 아니라 «탐색 생략» 이다.
 *
 * ## 이 경로의 실제 수용 게이트 (정정 2026-08-16 — 이전 주석이 틀렸다)
 *
 * 이전 주석은 「포맷 CRC · 본문 RS · 레퍼런스 agreement 0.78 · **margin 0.035**」 라고
 * 썼는데, **margin 0.035 는 이 경로에서 한 번도 평가되지 않는다.** 그것은 전부 *탐색*
 * 단계의 게이트이고(`cell-finder-detect.js:minOrientationMargin` ·
 * `cube-detect.js:minimumFinderOrientationMargin` · `cellSurfaceY-detect.js`), 사전 경로는
 * 탐색을 통째로 건너뛴다. 존재하지 않는 게이트를 적어 두면 나중 독자가 그것을 믿는다.
 *
 * 실제로 통과해야 하는 것:
 *
 *   · **hex(O) · tri(K/A)**: ① 포맷 CRC → ② 본문 RS → ③ payload 검증. 끝이다.
 *     `validateGridHypotheses()` 안에 레퍼런스 **하드 게이트가 없다** — tri 의
 *     `referenceReportFor` 는 `{ok:true, unsupported:true}` 를 돌려주고, 레퍼런스 결과는
 *     거절 조건이 아니라 **점수 항**으로만 쓰인다(루프에 `if (!referenceResult.ok) continue`
 *     가 없다). 즉 마지막 벽은 RS + payload 단독이다.
 *   · **cube(Y)**: 위 셋 **앞에** `calibrateCubeReferences()` 하드체크
 *     (referenceAgreement ≥ 0.78 && toneSpan)를 통과해야 톤·보정을 얻는다. 실측으로
 *     이 게이트가 살아 있다: O-k6 프레임에 720 포즈를 던지면 cube 포즈 180개가 여기서
 *     전멸해 가설이 540개만 남는다.
 *
 * 이 비대칭이 왜 중요한가: 탐색을 건너뛰므로 트리거 한 번에 **540\~744개** 기하가 곧장
 * CRC+RS 를 두드린다(탐색 경로는 수 개). 틀린 기하가 포맷 CRC 를 통과하는 일도 실제로
 * 있다 — 838,239 기하 스윕 실측 **1.65e-3** (프레임 종류별 1.09e-3 \~ 3.71e-3, 최악은
 * QR 프레임). 즉 트리거당 0.75개가 마지막 벽을 두드린다.
 *
 * 그래서 「게이트가 있다」 로 끝내지 않고 **마지막 벽이 실제로 얼마나 두꺼운가**를 쟀다:
 * 난수 digit 136만 시행에서 RS+payload 를 통과한 것은 **0** (95% 상계 3.0e-6/기하) —
 * 트리거당 오독 상계 2.3e-6. 정본은 문서 §8, 재현은
 * `tools/probes/probe-false-accept.mjs`. **주의: V1+ECC L 조합은 소거 때문에 RS 통과율이
 * 6.3e-2 라 사실상 payload 검증 단독이 벽이다** — 그 사실이 §8 의 핵심 발견이다.
 */

import { SQRT3 } from './hexgrid.js';
import {
  GUIDE_OUTER_FRACTION,
  kaApexRadiusCells,
  silhouetteRadiusCells,
} from './scanner-zoom.js';
import { HOMOGRAPHY_CANONICAL_SPACE } from './decoder/contracts.js';

/**
 * 가이드가 겨냥하는 레이아웃 표. `ring` 은 그 형상이 어느 링에 앉는가이고,
 * `radiusCells` 는 그 링 반지름을 셀 크기로 나누는 값이다.
 */
export const PRIOR_LAYOUTS = Object.freeze([
  Object.freeze({ id: 'O-k6', family: 'hex', k: 6, ring: 'middle' }),
  Object.freeze({ id: 'O-k8', family: 'hex', k: 8, ring: 'middle' }),
  Object.freeze({ id: 'O-k10', family: 'hex', k: 10, ring: 'middle' }),
  Object.freeze({ id: 'A-k6', family: 'tri', k: 6, ring: 'outer' }),
  Object.freeze({ id: 'A-k8', family: 'tri', k: 8, ring: 'outer' }),
  Object.freeze({ id: 'A-k10', family: 'tri', k: 10, ring: 'outer' }),
  Object.freeze({ id: 'Y-n21', family: 'cube', n: 21, ring: 'outer' }),
  Object.freeze({ id: 'Y-n25', family: 'cube', n: 25, ring: 'outer' }),
]);

/** 가이드 바깥 6점이 60° 간격이라 사용자의 파지 회전도 60° 격자다. */
export const PRIOR_ROTATIONS = Object.freeze([0, 60, 120, 180, 240, 300]);

/**
 * 1단계(coarse) 배율 사다리.
 *
 * 1단계의 관문은 **포맷 읽기(ring 3)** 다. ring 3 셀 중심은 중심에서 3√3·s ≈ 5.20·s 라,
 * 배율 오차 ε 는 그 자리에서 5.20·ε·s 만큼 어긋난다. 면 표본 원판 반지름이 대략
 * 0.22·s 이므로 ε ≲ 4% 까지는 포맷이 읽힌다. 3.5% 간격 세 칸이면 ±10.5% 를 덮는다.
 * (실측 포획 봉투는 `test/output/claude-steady-scan.md` 표가 정본이다.)
 */
export const PRIOR_COARSE_SCALES = Object.freeze([1, 0.93, 1.07]);

/**
 * 1단계 중심 오프셋 사다리 — **셀 크기 단위**, 십자(cross)만.
 *
 * 왜 1단계에도 오프셋이 필요한가 (실측): 중심 오차는 배율과 달리 **증폭이 없는 대신
 * 완충도 없다** — ring 3 표본이 오차만큼 그대로 밀린다. probe-guide-prior 실측에서
 * 오프셋 0 만 던지면 포획 봉투가 0.3\~0.4 셀(960 프레임에서 3\~4 px)에서 끊겼고,
 * 그 밖에서는 **포맷조차 통과하지 못해 2단계 씨앗이 생기지 않았다**(= 지터가 무력).
 * 0.30 셀 십자를 1단계에 넣으면 봉투가 대략 두 배가 되고 씨앗이 생긴다.
 */
export const PRIOR_COARSE_OFFSET_CELLS = Object.freeze([0, -0.3, 0.3]);

/**
 * 2단계(refine) 배율 사다리 — 1단계가 통과시킨 포즈 주변. 1.2% 간격 ±3.6%.
 *
 * 왜 이 밀도인가 (실측, 3안 비교):
 *   · 2단계의 관문은 **본문 RS** 라 1단계(포맷)보다 훨씬 빡빡하다. 가장 바깥 데이터 셀은
 *     중심에서 대략 (3k+2)·s 이므로 배율 오차가 (3k+2)·ε·s 로 증폭된다.
 *   · 1단계 사다리 간격이 7% 라 씨앗까지의 잔차가 최대 3.5% 다 → 사다리는 그 폭을 덮어야 한다.
 *   · ±1.2%(5칸)는 A-k10 @1.035 · O-k10 @1.12 등을 놓쳤고, 0.7% 간격 ±3.5%(11칸)는
 *     1.2% 간격 ±3.6%(7칸) 대비 **추가로 회수한 케이스가 하나도 없었다**. 7칸이 무릎이다.
 */
export const PRIOR_REFINE_SCALES = Object.freeze([
  1, 0.988, 1.012, 0.976, 1.024, 0.964, 1.036,
]);

/**
 * 2단계 중심 오프셋 — **비운다(배율만 정제)**.
 *
 * 근거(실측): 1단계에 이미 ±0.30 셀 십자가 들어 있어서, 2단계에 오프셋을 더 얹어도
 * (±0.15/±0.30 십자, 후보 8 → 88) **회수한 케이스가 0 이었고 비용만 3\~6× 였다**.
 * 오프셋 축은 1단계에서 해결하고 2단계는 배율만 본다 — 이것이 예산 안에서 봉투를
 * 가장 넓히는 배분이다.
 */
export const PRIOR_REFINE_OFFSET_CELLS = Object.freeze([0]);

/** 한 번의 사전 스캔이 만들 수 있는 후보 상한 (프레임 예산 가드). */
export const PRIOR_MAX_COARSE_POSES = 720;
export const PRIOR_MAX_REFINE_POSES = 24;

/** 2단계에 씨앗으로 쓸 1단계 통과 포즈 수 상한. 씨앗당 6 후보 → 최대 24. */
export const PRIOR_MAX_REFINE_SEEDS = 4;

/** 실패 H 는 바로 다음 프레임 한 번만 쓴다. 오래 멈춘 탭·GC 뒤의 픽셀 포즈는 버린다. */
export const FRAME_POSE_MAX_AGE_MS = 2000;
export const FRAME_POSE_MAX_ATTEMPTS = 1;

/** 정사각 분석 프레임 한 변에서 가이드 링 반지름(px). */
export function guideRingRadii(frameSide) {
  const side = Number(frameSide);
  if (!(side > 0)) return null;
  const outer = (GUIDE_OUTER_FRACTION * side) / 2;
  return { outer, middle: outer / SQRT3 };
}

/**
 * 레이아웃이 가이드에 맞았을 때의 셀 크기 s(px). canonical unit 1 당 픽셀 수다.
 * (hex 는 중간 링 / silhouetteRadiusCells, tri 는 바깥 링 / kaApexRadiusCells,
 *  cube 는 바깥 링 / n — 앞의 둘은 대수적으로 같은 식이다.)
 */
export function layoutCellPx(layout, frameSide) {
  const radii = guideRingRadii(frameSide);
  if (!radii || !layout) return null;
  if (layout.family === 'hex') return radii.middle / silhouetteRadiusCells(layout.k);
  if (layout.family === 'tri') return radii.outer / kaApexRadiusCells(layout.k);
  if (layout.family === 'cube') return radii.outer / layout.n;
  return null;
}

function formatSigned(value, digits) {
  const text = Number(value).toFixed(digits);
  return (Number(value) >= 0 ? '+' : '') + text;
}

/**
 * canonical(단위 셀) → image 픽셀 닮음변환.
 * @returns {Float64Array} row-major 3×3
 */
export function similarityHomography(cellPx, rotationDegrees, centerX, centerY) {
  const s = Number(cellPx);
  const radians = (Number(rotationDegrees) * Math.PI) / 180;
  if (!(s > 0) || !Number.isFinite(radians)
    || !Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    return null;
  }
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return new Float64Array([
    s * cos, -s * sin, centerX,
    s * sin, s * cos, centerY,
    0, 0, 1,
  ]);
}

function makePose(layout, frameSide, rotationDegrees, scale, offsetCells, center) {
  const base = layoutCellPx(layout, frameSide);
  if (!(base > 0)) return null;
  const cellPx = base * scale;
  const dxCells = offsetCells.dx;
  const dyCells = offsetCells.dy;
  const centerX = center.x + dxCells * base;
  const centerY = center.y + dyCells * base;
  const H = similarityHomography(cellPx, rotationDegrees, centerX, centerY);
  if (!H) return null;
  return {
    id: layout.id
      + '-r' + String(rotationDegrees).padStart(3, '0')
      + '-s' + scale.toFixed(3)
      + '-o' + formatSigned(dxCells, 2) + formatSigned(dyCells, 2),
    layoutId: layout.id,
    family: layout.family,
    k: layout.k,
    n: layout.n,
    ring: layout.ring,
    rotationDegrees,
    scale,
    offsetCells: { dx: dxCells, dy: dyCells },
    baseCellPx: base,
    cellPx,
    centerX,
    centerY,
    H,
  };
}

function finiteHomography(value) {
  if (!value || value.length !== 9) return null;
  const H = new Float64Array(9);
  for (let index = 0; index < H.length; index += 1) {
    const entry = Number(value[index]);
    if (!Number.isFinite(entry)) return null;
    H[index] = entry;
  }
  const determinant = H[0] * (H[4] * H[8] - H[5] * H[7])
    - H[1] * (H[3] * H[8] - H[5] * H[6])
    + H[2] * (H[3] * H[7] - H[4] * H[6]);
  return Number.isFinite(determinant) && Math.abs(determinant) > Number.EPSILON ? H : null;
}

/** canonical 원점에서 H 의 국소 x축 방향을 절대 회전각으로 복원한다. */
function rotationDegreesFromHomography(H) {
  // x'=(h00*x+h01*y+h02)/(h20*x+h21*y+h22) 의 원점 x 미분이다.
  // 공통 분모 h22^2 는 양수라 방향에는 영향을 주지 않는다.
  const localDxX = H[0] * H[8] - H[2] * H[6];
  const localDxY = H[3] * H[8] - H[5] * H[6];
  if (!Number.isFinite(localDxX) || !Number.isFinite(localDxY)
    || Math.hypot(localDxX, localDxY) <= Number.EPSILON) return null;
  const degrees = Math.atan2(localDxY, localDxX) * 180 / Math.PI;
  const normalized = ((degrees % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function projectOrigin(H) {
  if (!H || Math.abs(H[8]) <= Number.EPSILON) return null;
  const x = H[2] / H[8];
  const y = H[5] / H[8];
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function projectedCellPx(H) {
  const origin = projectOrigin(H);
  if (!origin) return null;
  const project = (x, y) => {
    const denominator = H[6] * x + H[7] * y + H[8];
    if (Math.abs(denominator) <= Number.EPSILON) return null;
    const px = (H[0] * x + H[1] * y + H[2]) / denominator;
    const py = (H[3] * x + H[4] * y + H[5]) / denominator;
    return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
  };
  const xStep = project(1, 0);
  const yStep = project(0, 1);
  if (!xStep || !yStep) return null;
  const cellPx = (
    Math.hypot(xStep.x - origin.x, xStep.y - origin.y)
    + Math.hypot(yStep.x - origin.x, yStep.y - origin.y)
  ) / 2;
  return cellPx > 0 ? cellPx : null;
}

function scaleImageSpace(H, scaleX, scaleY) {
  return new Float64Array([
    H[0] * scaleX, H[1] * scaleX, H[2] * scaleX,
    H[3] * scaleY, H[4] * scaleY, H[5] * scaleY,
    H[6], H[7], H[8],
  ]);
}

function layoutForPose(family, dimension) {
  return PRIOR_LAYOUTS.find((entry) => entry.family === family
    && (family === 'cube' ? entry.n : entry.k) === dimension) || null;
}

/**
 * 성공 가설 → 다음 프레임에 다시 넣을 사전 포즈.
 *
 * `compactHypothesis()` 가 내는 JSON 숫자 배열을 Float64Array 로 복원한다. 캐노니컬
 * 좌표는 셀 단위라 해상도와 무관하지만 H 의 출력은 **현재 라스터 픽셀**이다. 그래서
 * source/target 크기가 함께 주어지면 영상 쪽 두 행을 재배율한다(960↔1440 승격 경로).
 * 필수 값이 하나라도 없거나 좌표계가 다르면 프레임 루프를 깨지 않고 null 을 돌려준다.
 */
export function poseFromHypothesis(hypothesis, options = {}) {
  if (!hypothesis || typeof hypothesis !== 'object') return null;
  if (hypothesis.canonicalSpace !== HOMOGRAPHY_CANONICAL_SPACE) return null;
  const family = hypothesis.family;
  if (family !== 'hex' && family !== 'tri' && family !== 'cube') return null;
  const dimension = Number(family === 'cube' ? hypothesis.n : hypothesis.k);
  let H = finiteHomography(hypothesis.H);
  if (!H) return null;
  // 일반 탐색의 일부 가설은 회전 라벨을 싣지 않지만 H 는 같은 회전을 이미 품는다.
  // 값이 아예 없을 때만 복원한다. 유한하지 않은 명시값을 H 로 덮어 결함을 숨기지 않는다.
  const rotationDegrees = hypothesis.rotationDegrees === undefined
    ? rotationDegreesFromHomography(H)
    : Number(hypothesis.rotationDegrees);
  if (!Number.isInteger(dimension) || dimension <= 0 || !Number.isFinite(rotationDegrees)) {
    return null;
  }

  const dimensionOptionsPresent = [
    options.sourceWidth, options.sourceHeight, options.targetWidth, options.targetHeight,
  ].some((value) => value !== undefined);
  let frameWidth = Number(hypothesis.frameWidth);
  let frameHeight = Number(hypothesis.frameHeight);
  if (dimensionOptionsPresent) {
    const sourceWidth = Number(options.sourceWidth);
    const sourceHeight = Number(options.sourceHeight);
    const targetWidth = Number(options.targetWidth);
    const targetHeight = Number(options.targetHeight);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)
      || !(targetWidth > 0) || !(targetHeight > 0)) return null;
    H = scaleImageSpace(H, targetWidth / sourceWidth, targetHeight / sourceHeight);
    frameWidth = targetWidth;
    frameHeight = targetHeight;
  }

  const center = projectOrigin(H);
  const cellPx = projectedCellPx(H);
  if (!center || !(cellPx > 0)) return null;
  const layout = layoutForPose(family, dimension);
  const layoutId = typeof options.layoutId === 'string' && options.layoutId
    ? options.layoutId
    : layout
      ? layout.id
      : family === 'hex'
        ? 'O-k' + dimension
        : family === 'tri' ? 'A-k' + dimension : 'Y-n' + dimension;
  const sourceId = typeof options.id === 'string' && options.id
    ? options.id
    : typeof hypothesis.id === 'string' && hypothesis.id
      ? hypothesis.id
      : 'carry-' + layoutId + '-r' + rotationDegrees;

  return {
    id: sourceId,
    layoutId,
    family,
    k: family === 'cube' ? undefined : dimension,
    n: family === 'cube' ? dimension : undefined,
    ring: layout ? layout.ring : undefined,
    rotationDegrees,
    scale: 1,
    offsetCells: { dx: 0, dy: 0 },
    baseCellPx: cellPx,
    cellPx,
    centerX: center.x,
    centerY: center.y,
    H,
    canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
    ...(frameWidth > 0 && frameHeight > 0 ? { frameWidth, frameHeight } : {}),
  };
}

/**
 * 디코더 실패 결과에서 라이브 이월 상태를 만든다.
 * `carryEvidence.eligible` 은 포맷 CRC 통과 뒤 본문에서 실패한 경우에만 true 다.
 */
export function framePoseCarryFromResult(result, options = {}) {
  if (!result || result.ok === true || result.carryMiss === true) return null;
  if (!result.carryEvidence || result.carryEvidence.eligible !== true) return null;
  const savedAtMs = Number(options.nowMs);
  if (!Number.isFinite(savedAtMs)) return null;
  const pose = poseFromHypothesis(result.carryHypothesis, {
    id: 'frame-carry',
    sourceWidth: options.sourceWidth,
    sourceHeight: options.sourceHeight,
    targetWidth: options.sourceWidth,
    targetHeight: options.sourceHeight,
  });
  if (!pose) return null;
  return {
    pose,
    savedAtMs,
    remainingAttempts: FRAME_POSE_MAX_ATTEMPTS,
    evidence: result.carryEvidence,
  };
}

/**
 * 이월 상태를 현재 프레임 크기로 옮겨 한 번 소비한다. 반환 뒤 상태는 항상 비므로
 * 빗나간 포즈가 24개 후보로 매 프레임 부풀지 않는다.
 */
export function consumeFramePoseCarry(carry, options = {}) {
  if (!carry || !carry.pose || carry.remainingAttempts !== FRAME_POSE_MAX_ATTEMPTS) {
    return { pose: null, next: null, reason: 'empty' };
  }
  const atMs = Number(options.nowMs);
  const ageMs = atMs - Number(carry.savedAtMs);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > FRAME_POSE_MAX_AGE_MS) {
    return { pose: null, next: null, reason: 'expired' };
  }
  const pose = poseFromHypothesis(carry.pose, {
    id: 'frame-carry',
    sourceWidth: carry.pose.frameWidth,
    sourceHeight: carry.pose.frameHeight,
    targetWidth: options.targetWidth,
    targetHeight: options.targetHeight,
  });
  return {
    pose,
    next: null,
    reason: pose ? 'ready' : 'invalid',
  };
}

function jitterHomography(pose, scale, offset) {
  const H = finiteHomography(pose && pose.H);
  const centerX = Number(pose && pose.centerX);
  const centerY = Number(pose && pose.centerY);
  const baseCellPx = Number(pose && pose.baseCellPx);
  if (!H || !Number.isFinite(centerX) || !Number.isFinite(centerY) || !(baseCellPx > 0)) {
    return null;
  }
  const targetX = centerX + offset.dx * baseCellPx;
  const targetY = centerY + offset.dy * baseCellPx;
  // 영상 좌표에서 중심 기준 배율·평행이동을 왼쪽 합성한다. 오른쪽 합성은 원근 H의
  // 캐노니컬 좌표를 바꿔 다음 프레임의 카메라 운동과 다른 변환이 된다.
  const tx = targetX - scale * centerX;
  const ty = targetY - scale * centerY;
  return new Float64Array([
    scale * H[0] + tx * H[6], scale * H[1] + tx * H[7], scale * H[2] + tx * H[8],
    scale * H[3] + ty * H[6], scale * H[4] + ty * H[7], scale * H[5] + ty * H[8],
    H[6], H[7], H[8],
  ]);
}

function normalizeCenter(frameSide, options) {
  const side = Number(frameSide);
  const x = Number(options.centerX);
  const y = Number(options.centerY);
  return {
    x: Number.isFinite(x) ? x : side / 2,
    y: Number.isFinite(y) ? y : side / 2,
  };
}

function selectLayouts(requested) {
  if (!Array.isArray(requested) || requested.length === 0) return PRIOR_LAYOUTS;
  const wanted = new Set(requested);
  const chosen = PRIOR_LAYOUTS.filter((layout) => wanted.has(layout.id)
    || wanted.has(layout.family));
  return chosen.length > 0 ? chosen : PRIOR_LAYOUTS;
}

/** 십자(cross) 오프셋 격자 — (0,0) 한 번 + 각 축 비-0 값. 대각은 두 축 성분으로 근사. */
export function crossOffsets(values) {
  const grid = [{ dx: 0, dy: 0 }];
  for (const value of values) {
    if (value === 0) continue;
    grid.push({ dx: value, dy: 0 });
    grid.push({ dx: 0, dy: value });
  }
  return grid;
}

/**
 * 1단계(coarse) 사전 포즈 목록.
 *
 * 기본 = 8 레이아웃 × 6 회전 × 3 배율 × 5 오프셋(십자) = **720**.
 * 정렬은 **결정적**이다 — 「가이드에 정확히 맞았다」 에 가까운 것부터: 오프셋 0 → 배율 1
 * → 레이아웃·회전 선언 순서. 상한(`maxPoses`)에 잘릴 때 가장 그럴듯한 것이 남는다.
 *
 * @param {{
 *   frameSide: number,
 *   centerX?: number, centerY?: number,
 *   layouts?: string[],           // 'O-k6' 같은 id 또는 'hex'/'tri'/'cube'
 *   rotations?: number[],
 *   scales?: number[],
 *   offsetCells?: number[],
 *   maxPoses?: number,
 * }} options
 */
export function guidePriorPoses(options = {}) {
  const frameSide = Number(options.frameSide);
  if (!(frameSide > 0)) return [];
  const center = normalizeCenter(frameSide, options);
  const layouts = selectLayouts(options.layouts);
  const rotations = Array.isArray(options.rotations) && options.rotations.length > 0
    ? options.rotations
    : PRIOR_ROTATIONS;
  const scales = Array.isArray(options.scales) && options.scales.length > 0
    ? options.scales
    : PRIOR_COARSE_SCALES;
  const offsets = crossOffsets(
    Array.isArray(options.offsetCells) && options.offsetCells.length > 0
      ? options.offsetCells
      : PRIOR_COARSE_OFFSET_CELLS,
  );
  const limit = Number.isInteger(options.maxPoses) && options.maxPoses > 0
    ? options.maxPoses
    : PRIOR_MAX_COARSE_POSES;

  const poses = [];
  for (const offset of offsets) {
    for (const scale of scales) {
      for (const layout of layouts) {
        for (const rotationDegrees of rotations) {
          const pose = makePose(layout, frameSide, rotationDegrees, scale, offset, center);
          if (pose) poses.push(pose);
          if (poses.length >= limit) return poses;
        }
      }
    }
  }
  return poses;
}

/**
 * 2단계(refine) — 1단계가 통과시킨 포즈 주변의 손떨림 지터 후보.
 *
 * 기본값은 **배율 사다리 × 오프셋 {0}** 이라 씨앗당 6개다(`PRIOR_REFINE_SCALES` 7칸에서
 * 「배율 그대로 · 오프셋 0」 하나를 뺀 것 — 1단계가 이미 평가한 조합이다).
 * `offsetCells` 를 주면 십자(cross) 격자로 확장된다 — 실측상 회수가 0 이라 기본은 비워
 * 뒀지만, 실기기 데이터로 다시 판단할 수 있게 인자는 남긴다.
 *
 * @param {object} pose guidePriorPoses() 가 낸 포즈
 * @param {{frameSide:number, scales?:number[], offsetCells?:number[], maxPoses?:number}} options
 */
export function jitterPoses(pose, options = {}) {
  const frameSide = Number(options.frameSide);
  if (!pose || !(frameSide > 0)) return [];
  if (!finiteHomography(pose.H)) return [];
  const scales = Array.isArray(options.scales) && options.scales.length > 0
    ? options.scales
    : PRIOR_REFINE_SCALES;
  const offsets = Array.isArray(options.offsetCells) && options.offsetCells.length > 0
    ? options.offsetCells
    : PRIOR_REFINE_OFFSET_CELLS;
  const limit = Number.isInteger(options.maxPoses) && options.maxPoses > 0
    ? options.maxPoses
    : PRIOR_MAX_REFINE_POSES;

  const offsetGrid = crossOffsets(offsets);

  const poses = [];
  for (const scale of scales) {
    for (const offset of offsetGrid) {
      // 이미 1단계에서 평가한 (배율 그대로 · 오프셋 0) 조합은 다시 넣지 않는다.
      if (scale === 1 && offset.dx === 0 && offset.dy === 0) continue;
      const H = jitterHomography(pose, scale, offset);
      const refinedCenter = H && projectOrigin(H);
      const cellPx = H && projectedCellPx(H);
      if (!H || !refinedCenter || !(cellPx > 0)) continue;
      const refined = {
        ...pose,
        id: pose.id + '~j' + scale.toFixed(3)
          + formatSigned(offset.dx, 2) + formatSigned(offset.dy, 2),
        scale: Number(pose.scale) * scale,
        offsetCells: { dx: offset.dx, dy: offset.dy },
        cellPx,
        centerX: refinedCenter.x,
        centerY: refinedCenter.y,
        H,
        refinedFrom: pose.id,
      };
      poses.push(refined);
      if (poses.length >= limit) return poses;
    }
  }
  return poses;
}

/**
 * 1단계 결과에서 2단계 후보를 만든다.
 *
 * `admittedPoseIds` 는 디코더가 「포맷 CRC 까지는 갔다」 고 표시한 포즈들이다
 * (`decodeFrontend(...).detail.prior.admittedPoses`). 그 주변에만 지터를 펼친다 —
 * 전수 곱을 다시 돌리면 예산이 터지고, 통과조차 못 한 포즈 주변은 볼 이유가 없다.
 *
 * 씨앗 순서는 `poses` 의 순서(= 그럴듯한 순)를 따른다 — admitted 배열의 순서가 아니라.
 * 그래야 상한에 잘릴 때 결정적으로 같은 씨앗이 남는다.
 */
export function refineSeedsFrom(poses, admittedPoseIds, options = {}) {
  if (!Array.isArray(poses) || !Array.isArray(admittedPoseIds)) return [];
  const admitted = new Set(admittedPoseIds);
  const maxSeeds = Number.isInteger(options.maxSeeds) && options.maxSeeds > 0
    ? options.maxSeeds
    : PRIOR_MAX_REFINE_SEEDS;
  const maxPoses = Number.isInteger(options.maxPoses) && options.maxPoses > 0
    ? options.maxPoses
    : PRIOR_MAX_REFINE_POSES;

  const seeds = [];
  for (const pose of poses) {
    if (!admitted.has(pose.id)) continue;
    seeds.push(pose);
    if (seeds.length >= maxSeeds) break;
  }

  const refined = [];
  for (const seed of seeds) {
    for (const pose of jitterPoses(seed, options)) {
      refined.push(pose);
      if (refined.length >= maxPoses) return refined;
    }
  }
  return refined;
}

/**
 * 프레임 예산 보고용 요약. 「몇 개를 던지는가」 를 UI·문서·테스트가 같은 수로 말하게 한다.
 */
export function priorPoseBudget(options = {}) {
  const coarse = guidePriorPoses(options);
  const perAdmitted = jitterPoses(coarse[0] || null, {
    frameSide: options.frameSide,
    scales: options.refineScales,
    offsetCells: options.refineOffsetCells,
  }).length;
  const seeds = Number.isInteger(options.maxSeeds) && options.maxSeeds > 0
    ? options.maxSeeds
    : PRIOR_MAX_REFINE_SEEDS;
  return {
    coarseCount: coarse.length,
    refinePerAdmitted: perAdmitted,
    refineMax: Math.min(PRIOR_MAX_REFINE_POSES, perAdmitted * seeds),
    layoutCount: selectLayouts(options.layouts).length,
    rotationCount: (Array.isArray(options.rotations) && options.rotations.length)
      || PRIOR_ROTATIONS.length,
  };
}
