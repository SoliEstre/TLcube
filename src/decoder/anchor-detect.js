
/**
 * anchor-detect.js — Type O/A 앵커 3점과 120도 방향 가설
 *
 * 앵커는 포맷을 읽기 전에 격자 크기와 방향을 좁히는 기하 증거다. 이 모듈은
 * 불스아이 중심과 셀 피치로 유한한 (k, orientation) 전체를 평가하고, 첫
 * 일치에서 멈추지 않는다. 후단 bootstrap 이 포맷·본문 검증으로 선택한다.
 *
 * 좌표 규약:
 *   - 입력 bullseye.center 는 image pixel이다.
 *   - q/r은 셀 식별용 axial 좌표이며 H에 직접 넣지 않는다.
 *   - 모든 투영점은 unit-cell canonical Euclidean으로 변환한다.
 *   - 출력 H는 canonical Euclidean -> image pixel이다.
 *
 * @module decoder/anchor-detect
 */

import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
  assertHomography,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import {
  FACES,
  axialToPixel,
} from '../hexgrid.js';
import { ranksToDigit } from '../lehmer.js';
import { anchorCells } from '../placement.js';
import { vertexAnchors } from '../placementA.js';
import { vertexAnchorsK } from '../placementK.js';
import { sampleHexCell } from './grid-sample.js';

/*
 * 아래 값 중 separation/tie/sample count 는 설계에서 아직 M1 calibration 전
 * [미검증] 상태다. 이름을 붙여 옵션으로 덮어쓸 수 있게 두고, 측정 전에는
 * 포맷 규범처럼 숨기지 않는다.
 */
// [미검증] M1 calibration 에서 확정: 앵커 면 순위의 최소 상대휘도 간격.
const DEFAULT_ANCHOR_MIN_SEPARATION = 0.04;
// [미검증] M1 calibration 에서 확정: 근접동률로 취급할 간격.
const DEFAULT_ANCHOR_TIE_EPSILON = 0.02;
// [미검증] M1 calibration 에서 확정: 앵커 면 원판의 최소 유효 표본 수.
const DEFAULT_ANCHOR_MIN_SAMPLE_COUNT = 3;
// [미검증] M1 calibration 에서 확정: 내접원 반지름 대비 표본 원판 반경.
const DEFAULT_ANCHOR_SAMPLE_RADIUS_FRACTION = 0.5;
// [미검증] M1 calibration 에서 확정: projective 원판의 최소 짧은축 지름.
const DEFAULT_ANCHOR_MIN_PROJECTED_MINOR_DIAMETER_PX = 1;
const LUMA_RANGE_EPSILON = 1e-9;
const ORIENTATIONS = Object.freeze([0, 1, 2]);
const FACE_NAMES = Object.freeze(['T', 'L', 'R']);
const IDENTITY_SIGMA = Object.freeze([0, 1, 2, 3, 4, 5]);
const SIGMA_CW = Object.freeze([4, 5, 1, 0, 3, 2]);
const SIGMA_CCW = Object.freeze([3, 2, 5, 4, 0, 1]);

function finitePoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeDirection(direction) {
  if (direction === undefined || direction === null
    || direction === 0 || direction === 'identity' || direction === 'id') return 0;
  if (direction === 1 || direction === 'cw' || direction === 'clockwise') return 1;
  if (direction === 2 || direction === 'ccw' || direction === 'counterclockwise') return 2;
  throw new RangeError('direction 은 0 | 1 | 2 | identity | cw | ccw 여야 한다: ' + direction);
}

/*
 * 성공(=null) 만 캐시한다. family.js 의 같은 이름 함수와 마찬가지로 전 픽셀을 훑어
 * 범위를 검사하는데, 한 복호에서 finder 마다·재시도마다 다시 불린다. 입력은 luma
 * 하나뿐이라 결과는 luma 에만 달려 있다. 실패는 위반 표본을 만나는 즉시 빠져나오고
 * 반환한 fail 객체는 상위에서 확장될 수 있어 공유하지 않는다.
 */
const validatedLumaCache = new WeakSet();

function validateLuma(luma) {
  if (luma !== null && typeof luma === 'object') {
    if (validatedLumaCache.has(luma)) return null;
    const computed = computeValidateLuma(luma);
    if (computed === null) validatedLumaCache.add(luma);
    return computed;
  }
  return computeValidateLuma(luma);
}

function computeValidateLuma(luma) {
  if (luma === null || luma === undefined) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { message: 'luma 가 없다' });
  }
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { message: error.message });
  }

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < luma.data.length; i += 1) {
    const value = luma.data[i];
    if (!Number.isFinite(value) || value < -LUMA_RANGE_EPSILON || value > 1 + LUMA_RANGE_EPSILON) {
      return fail(FRONTEND_FAILURE.LUMA_DEGENERATE, {
        message: '상대휘도 범위를 벗어난 표본이 있다',
        index: i,
        value,
      });
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || max - min <= LUMA_RANGE_EPSILON) {
    return fail(FRONTEND_FAILURE.LUMA_DEGENERATE, {
      message: '휘도 범위가 없어 앵커 순위를 만들 수 없다',
      min,
      max,
    });
  }
  return null;
}

function normalizeKs(ks, options) {
  const source = ks === undefined ? options.ks : ks;
  const values = Array.isArray(source) ? source : [source];
  const unique = new Set();
  for (const value of values) {
    if (Number.isInteger(value) && value >= 4) unique.add(value);
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function normalizeBullseye(bullseye, options) {
  const source = bullseye && bullseye.ok === true
    ? (bullseye.finder || bullseye.bullseye || bullseye)
    : (bullseye || {});
  const center = source.center || options.center;
  const cellSize = source.cellSize === undefined
    ? source.cellSizePxAtCenter
    : source.cellSize;
  if (!finitePoint(center) || !Number.isFinite(cellSize) || cellSize <= 0) return null;
  return {
    center: { x: center.x, y: center.y },
    cellSize,
    centerQr: Boolean(source.centerQr || options.centerQr),
    baseHomography: source.H || source.homography || source.transform || source.B || options.H,
  };
}

function applyHomography(H, point) {
  const denominator = H[6] * point.x + H[7] * point.y + H[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= LUMA_RANGE_EPSILON) return null;
  const x = (H[0] * point.x + H[1] * point.y + H[2]) / denominator;
  const y = (H[3] * point.x + H[4] * point.y + H[5]) / denominator;
  return finitePoint({ x, y }) ? { x, y } : null;
}

function multiplyHomographies(left, right) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        out[row * 3 + column] += left[row * 3 + inner] * right[inner * 3 + column];
      }
    }
  }
  return out;
}

function rotationHomography(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float64Array([
    cosine, -sine, 0,
    sine, cosine, 0,
    0, 0, 1,
  ]);
}

function makeAffineHomography(center, cellSize) {
  return new Float64Array([
    cellSize, 0, center.x,
    0, cellSize, center.y,
    0, 0, 1,
  ]);
}

/**
 * @param {number} [scale] cellSize 배율 탐색(아래 ANCHOR_SCALE_SEARCH_CELLS)의 배율.
 *
 * ⚠ 발견 (2026-08-24, 턴A 레인 실측): 종전 구현은 배율을 `bullseye.cellSize` 에만
 * 곱했는데, 파인더가 transform(B)을 들고 오면 supplied H 가 그 값을 **무시**해서
 * 2026-08-13 의 스케일 탐색 수리가 실전 경로(불스아이 검출 산출물은 항상 transform
 * 보유)에서 무효였다 — 6개 배율이 전부 같은 H 를 재평가했다.
 *
 * ⚠ 스코프 (죽음 플립 0 게이트 실측): 이 무효를 **전 축에서** 실효로 바꾸자
 * 기존 O 클러터 sweep 1건이 죽었다 — scale≠1 에서 새로 서는 앵커 가설이
 * strictCount>0 을 만들어 실루엣 폴백(hex, strictCount===0 조건)을 억제하는
 * 기존 트레이드를 건드린다. 그래서 실효 배율(scaleSupplied)은 **턴A 변형(신설
 * 축)에만** 연다: 기존 축은 supplied H 분기에서 배율 무시 — 종전과 비트 동일하다.
 * 레거시 축의 일반 수리는 통합자 판단 몫이다 (레인 보고서 §발견).
 */
function homographyForOrientation(bullseye, orientation, options, scale = 1, scaleSupplied = false) {
  const supplied = options.H || bullseye.baseHomography;
  const sign = options.orientationSign === -1 ? -1 : 1;
  if (supplied === undefined) {
    // 폴백(affine) 분기는 종전 «cellSize 에 곱하기» 수치 그대로 보존한다.
    return multiplyHomographies(
      makeAffineHomography(bullseye.center, bullseye.cellSize * scale),
      rotationHomography(sign * orientation * (2 * Math.PI / 3)),
    );
  }
  const withOrientation = multiplyHomographies(
    assertHomography(supplied),
    rotationHomography(sign * orientation * (2 * Math.PI / 3)),
  );
  if (scale === 1 || scaleSupplied !== true) return withOrientation;
  return multiplyHomographies(withOrientation, new Float64Array([
    scale, 0, 0,
    0, scale, 0,
    0, 0, 1,
  ]));
}

function projectCell(H, q, r) {
  return applyHomography(H, axialToPixel(q, r));
}

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rankStat(faces, tieEpsilon) {
  if (faces.some((face) => !Number.isFinite(face.median))) {
    return { digit: null, separation: NaN, tie: true, order: [] };
  }
  const order = [0, 1, 2].sort((a, b) => {
    const difference = faces[a].median - faces[b].median;
    return difference === 0 ? a - b : difference;
  });
  const sorted = order.map((index) => faces[index].median);
  const separation = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
  const tie = separation < tieEpsilon;
  if (tie) return { digit: null, separation, tie, order };
  const ranks = {};
  for (let i = 0; i < order.length; i += 1) ranks[FACE_NAMES[order[i]]] = i;
  return {
    digit: ranksToDigit(ranks),
    separation,
    tie,
    order,
  };
}

function geometryResidual(points, center, cellSize) {
  const radii = points
    .filter((point) => finitePoint(point))
    .map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  if (radii.length === 0) return Infinity;
  const target = median(radii);
  let sum = 0;
  for (const radius of radii) sum += (radius - target) ** 2;
  return Math.sqrt(sum / radii.length);
}

function evaluate(luma, bullseye, canonicalAnchors, family, k, orientation, options, turn = false, scale = 1, scaleSupplied = false) {
  const sampleFraction = Number.isFinite(options.sampleRadiusFraction)
    && options.sampleRadiusFraction > 0
    && options.sampleRadiusFraction <= 1
    ? options.sampleRadiusFraction
    : DEFAULT_ANCHOR_SAMPLE_RADIUS_FRACTION;
  const minSeparation = Number.isFinite(options.minSeparation)
    ? Math.max(0, options.minSeparation)
    : DEFAULT_ANCHOR_MIN_SEPARATION;
  const tieEpsilon = Number.isFinite(options.tieEpsilon)
    ? Math.max(0, options.tieEpsilon)
    : DEFAULT_ANCHOR_TIE_EPSILON;
  const minSampleCount = Number.isInteger(options.minSampleCount)
    ? Math.max(1, options.minSampleCount)
    : DEFAULT_ANCHOR_MIN_SAMPLE_COUNT;
  const minProjectedMinorDiameter = Number.isFinite(options.minProjectedMinorDiameter)
    ? Math.max(0, options.minProjectedMinorDiameter)
    : DEFAULT_ANCHOR_MIN_PROJECTED_MINOR_DIAMETER_PX;
  // 실효 배율(supplied H 에도 곱한다)은 **신설 축에만** 연다 — 턴A(turn) 전례에
  // star(K) 를 추가 (헤더 ⚠ 스코프 주석: 기존 축은 죽음 플립 0 게이트 실측으로 동결).
  const H = homographyForOrientation(
    bullseye, orientation, options, scale, turn === true || scaleSupplied === true,
  );
  const pointList = [];
  const measurements = [];
  let allSamples = true;
  let allRanks = true;
  let allExpected = true;
  let minCount = Infinity;

  for (let i = 0; i < canonicalAnchors.length; i += 1) {
    const anchor = canonicalAnchors[i];
    const point = projectCell(H, anchor.q, anchor.r);
    pointList.push(point || { x: NaN, y: NaN });
    const sampled = point
      ? sampleHexCell(
        luma,
        { H, canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE },
        anchor.q,
        anchor.r,
        {
          discOptions: { fraction: sampleFraction, fractionOf: 'radius' },
          minSampleCount,
          minProjectedMinorDiameter,
          tieEpsilon,
        },
      )
      : fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, {
        stage: 'anchor-project',
        cause: 'anchor-crosses-projective-horizon',
      });
    const faces = sampled.ok
      ? { T: sampled.T, L: sampled.L, R: sampled.R }
      : {
        T: { median: NaN, mad: NaN, count: 0 },
        L: { median: NaN, mad: NaN, count: 0 },
        R: { median: NaN, mad: NaN, count: 0 },
      };
    const orderedFaces = FACE_NAMES.map((face) => faces[face]);
    const rank = rankStat(orderedFaces, tieEpsilon);
    const expected = anchor.digit;
    const sampleCheck = sampled.ok
      && orderedFaces.every((face) => face.count >= minSampleCount);
    const rankCheck = sampled.ok
      && !rank.tie
      && Number.isFinite(rank.separation)
      && rank.separation >= minSeparation;
    const expectedCheck = sampled.ok && rank.digit === expected;
    allSamples = allSamples && sampleCheck;
    allRanks = allRanks && rankCheck;
    allExpected = allExpected && expectedCheck;
    for (const face of orderedFaces) minCount = Math.min(minCount, face.count);
    measurements.push({
      canonical: { q: anchor.q, r: anchor.r },
      expectedDigit: expected,
      observedDigit: rank.digit,
      separation: rank.separation,
      tie: rank.tie,
      faces,
      sampleCheck,
      rankCheck,
      expectedCheck,
      samplingFailure: sampled.ok ? null : {
        reason: sampled.reason,
        detail: sampled.detail,
      },
    });
  }

  const separations = measurements
    .map((measurement) => measurement.separation)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const meanSeparation = separations.length === 0
    ? 0
    : separations.reduce((sum, value) => sum + value, 0) / separations.length;
  const score = clamp01(meanSeparation / Math.max(minSeparation, LUMA_RANGE_EPSILON));
  const residual = geometryResidual(pointList, bullseye.center, bullseye.cellSize);

  return {
    family,
    k,
    orientation,
    // 턴A (내부 타입 V) — 실루엣 방향. 앵커 «자리» 가 곧 판정 신호다: 정삼각과
    // 역삼각의 꼭짓점 자리는 100% 배타(placementA 패치 배타의 특수례)라, 한쪽
    // 가설의 앵커 자리는 다른 쪽 프레임에서 배경(순위 동률)이라 hardChecks 가 죽는다.
    turn: turn === true,
    centerQr: bullseye.centerQr,
    anchors: pointList,
    canonicalAnchors: canonicalAnchors.map((anchor) => ({ q: anchor.q, r: anchor.r })),
    H,
    canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
    geometryResidual: residual,
    anchorMargin: separations.length === 0 ? 0 : Math.min(...separations),
    score,
    hardChecks: {
      sampleCount: allSamples,
      rankSeparation: allRanks,
      expectedPattern: allExpected,
      all: allSamples && allRanks && allExpected,
    },
    measurements,
    hypothesisId: family + '-' + k + '-' + orientation + (turn === true ? '-turn' : ''),
    _minCount: Number.isFinite(minCount) ? minCount : 0,
  };
}

/**
 * 앵커 3점을 찍기 전에 훑을 **cellSize 배율** 목록.
 *
 * 왜 필요한가: 앵커는 파인더 H 로 «점 투영» 만 하고 탐색 창이 없다. 그런데 앵커는 중심에서
 * `3k` 떨어져 있어서 파인더의 상대 스케일 오차 ε 가 `ε·3k` 셀만큼 증폭된다 — 허용치가
 * **1/k 로 줄어든다.** 실측(2026-08-13, 참 H 에 ε 를 주입해 3/3 이 깨지는 지점):
 *
 *     A0(k=6) 3.0% · A1(k=8) 2.0% · A2(k=10) 1.5%   ← ε*·k ≈ 16 으로 거의 상수
 *
 * 그래서 상위 버전일수록 처참했다. Type O 는 앵커가 `k√3` 로 √3 배 가깝고, 게다가
 * 빗나가도 `weakAnchorHypotheses`·`silhouetteHypotheses` 로 H 를 다시 잡는다 — 둘 다
 * `family !== 'hex'` 로 A 를 막아 두어서 A 는 3/3 이 빗나가면 바로 no-anchors 였다.
 *
 * 배율 폭을 **`1/k` 에 비례**시켜 잡는다. 그러면 훑는 범위가 «앵커에서의 변위» 단위로
 * 일정해지고(±ANCHOR_SCALE_SEARCH_CELLS 셀), 허용치의 1/k 스케일링이 사라진다.
 */
const ANCHOR_SCALE_SEARCH_CELLS = 1.5;
const ANCHOR_SCALE_SEARCH_STEP_CELLS = 0.25;

function cellSizeSearchScales(k, options) {
  if (options.cellSizeSearch === false) return [1];
  const span = Number.isFinite(options.cellSizeSearchCells)
    ? Math.max(0, options.cellSizeSearchCells)
    : ANCHOR_SCALE_SEARCH_CELLS;
  if (!(span > 0) || !(k > 0)) return [1];
  // 앵커 반지름은 3k 셀이므로, 변위 d 셀 = 배율 오차 d/(3k).
  const step = ANCHOR_SCALE_SEARCH_STEP_CELLS / (3 * k);
  const steps = Math.round(span / ANCHOR_SCALE_SEARCH_STEP_CELLS);
  const scales = [1];
  for (let i = 1; i <= steps; i += 1) {
    scales.push(1 + i * step, 1 - i * step);
  }
  return scales;
}

/** 어느 후보가 «더 멀리 갔나» — 진단에 남길 대표 실패를 고른다. */
function anchorProgress(evaluated) {
  const checks = evaluated.hardChecks;
  return (checks.sampleCount ? 4 : 0) + (checks.rankSeparation ? 2 : 0)
    + (checks.expectedPattern ? 1 : 0);
}

function findHypotheses(luma, bullseye, ks, options, family, anchorFactory) {
  const inputFailure = validateLuma(luma);
  if (inputFailure) return inputFailure;
  const normalizedBullseye = normalizeBullseye(bullseye, options);
  if (!normalizedBullseye) {
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      family,
      message: '불스아이 중심 또는 cellSize 가 없다',
    });
  }
  const normalizedKs = normalizeKs(ks, options);
  if (normalizedKs.length === 0) {
    return fail(FRONTEND_FAILURE.NO_ANCHORS, {
      family,
      message: '검사할 양의 k 목록이 없다',
    });
  }

  const hypotheses = [];
  const rejected = [];
  let evaluatedCount = 0;
  for (const k of normalizedKs) {
    // anchorFactory 는 «방향 변형 목록» 을 낸다 — [{turn, anchors}].
    // hex 는 항상 1개(turn=false), tri 는 정삼각 + 역삼각(턴A) 2개다.
    let variants;
    try {
      variants = anchorFactory(k);
    } catch (error) {
      rejected.push({ k, reason: error.message });
      continue;
    }
    for (const variant of variants) {
      for (const orientation of ORIENTATIONS) {
        evaluatedCount += 1;
        let evaluated = null;
        for (const scale of cellSizeSearchScales(k, options)) {
          const probed = evaluate(
            luma,
            normalizedBullseye,
            variant.anchors,
            family,
            k,
            orientation,
            options,
            variant.turn === true,
            scale,
            variant.scaleSupplied === true,
          );
          // 통과하면 즉시 채택. 아니면 «가장 멀리 간» 것을 진단용으로 남긴다.
          if (probed.hardChecks.all) {
            evaluated = probed;
            if (scale !== 1) evaluated.cellSizeScale = scale;
            break;
          }
          if (evaluated === null
            || anchorProgress(probed) > anchorProgress(evaluated)) evaluated = probed;
        }
        if (evaluated.hardChecks.all) hypotheses.push(evaluated);
        else rejected.push({
          hypothesisId: evaluated.hypothesisId,
          k,
          orientation,
          turn: variant.turn === true,
          hardChecks: evaluated.hardChecks,
          anchorMargin: evaluated.anchorMargin,
        });
      }
    }
  }

  hypotheses.sort((a, b) => a.k - b.k
    || (a.turn === true ? 1 : 0) - (b.turn === true ? 1 : 0)
    || a.orientation - b.orientation);
  const detail = {
    family,
    testedKs: normalizedKs,
    testedOrientations: ORIENTATIONS.slice(),
    evaluatedCount,
    rejected,
  };
  if (hypotheses.length === 0) {
    return fail(FRONTEND_FAILURE.NO_ANCHORS, {
      ...detail,
      hypotheses: [],
    });
  }
  return ok({
    hypotheses,
    diagnostics: detail,
  });
}

/**
 * Type O의 교대 코너 앵커를 전수 평가한다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {import('./contracts.js').BullseyeCandidate} bullseye
 * @param {number[]|number} ks 지원 k 목록
 * @param {object} [options]
 * @returns {{ok:true, hypotheses: object[], diagnostics: object}|{ok:false, reason:string, detail?:object}}
 */
export function findOAnchorHypotheses(luma, bullseye, ks, options = {}) {
  return findHypotheses(luma, bullseye, ks, options, 'hex',
    (k) => [{ turn: false, anchors: anchorCells(k) }]);
}

/**
 * Type A의 주 꼭짓점 앵커를 전수 평가한다. Type O의 육각 코어 앵커는
 * placementA.js 규약상 보조 앵커이므로 여기서는 주 앵커 3점만 쓴다.
 *
 * 턴A (내부 타입 V, 2026-08-24 기하 개통) — 역삼각 변형을 함께 평가한다:
 * 렌더 규약(«배치만 180° 회전, 셀은 정립» — scene.js)에 따라 앵커 «셀» 은
 * (−q,−r) 자리에 정립으로 그려지므로, 검출도 같은 사상으로 좌표만 반전해 찍는다
 * (digit 기대값·면 offset 은 정삼각과 동일). 두 변형의 앵커 자리는 100% 배타라
 * (턴A 자리는 정삼각 프레임에서 코드 밖 배경) 오수용 축이 아니라 추가 축이다 —
 * 기존 정삼각 평가는 한 비트도 안 바뀐다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {import('./contracts.js').BullseyeCandidate} bullseye
 * @param {number[]|number} ks 지원 k 목록
 * @param {object} [options]
 */
export function findAAnchorHypotheses(luma, bullseye, ks, options = {}) {
  return findHypotheses(luma, bullseye, ks, options, 'tri', (k) => {
    const upright = vertexAnchors(k);
    return [
      { turn: false, anchors: upright },
      {
        turn: true,
        anchors: upright.map((anchor) => ({ q: -anchor.q, r: -anchor.r, digit: anchor.digit })),
      },
    ];
  });
}

/**
 * Type K(육각별, family 'star')의 별 꼭짓점 앵커 6점을 전수 평가한다.
 *
 * 앵커 = A 계열 꼭짓점 3(digit 5/0/0 — placementA 그대로) + 반전 계열 꼭짓점 3
 * (digit 1/1/1, 통합자 확정 2026-08-24). 여섯 점 전부 유클리드 3k·셀(= 별의 끝)
 * 이라 geometryResidual 회계가 O/A 와 같은 꼴로 성립한다.
 *
 * 60° 오가설이 여기서 죽는다 (계약 K-2 채택 근거): 60° 회전은 A 계열 자리를 반전
 * 계열 자리로 보내는데, 기대값 {5,0} 자리에서 1 이 (또는 그 역이) 읽히므로
 * expectedPattern 하드체크가 깨진다 — test/typeK-roundtrip.test.js 가 실측 고정.
 *
 * 방향 변형은 1개뿐이다 — K = A ∪ 반전A 는 180° 자기 대칭이라 «턴 K» 가 없다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {import('./contracts.js').BullseyeCandidate} bullseye
 * @param {number[]|number} ks 지원 k 목록
 * @param {object} [options]
 */
export function findKAnchorHypotheses(luma, bullseye, ks, options = {}) {
  // scaleSupplied — star 는 신설 축이라 실효 배율 탐색을 연다 (턴A 전례, evaluate
  // 주석). 앵커가 3k(최대 30셀) 거리라 다운샘플 파인더의 2% 대 스케일 오차만으로
  // 0.6셀 이상 밀려 6/6 이 전멸한다 — K1 합성 왕복 실측 (2026-08-25).
  return findHypotheses(luma, bullseye, ks, options, 'star',
    (k) => [{ turn: false, scaleSupplied: true, anchors: vertexAnchorsK(k) }]);
}

/**
 * 화면 고정 T/L/R 이름으로 관측한 digit을 canonical digit으로 바꾸는
 * 물리 회전 전단사. 0=항등, 1=cw, 2=ccw 는 SPEC §5.2의 σ 표를 그대로
 * 반환하며, 매 호출마다 새 배열을 내어 호출자 변형이 전역 상수를 오염시키지 않게 한다.
 *
 * @param {0|1|2|'identity'|'cw'|'ccw'} direction
 * @returns {number[]} digit -> rotated digit
 */
export function physicalRotationSigma(direction) {
  const normalized = normalizeDirection(direction);
  const table = normalized === 0
    ? IDENTITY_SIGMA
    : normalized === 1
      ? SIGMA_CW
      : SIGMA_CCW;
  return table.slice();
}
