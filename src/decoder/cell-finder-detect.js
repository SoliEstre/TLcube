/**
 * cell-finder-detect.js — 중앙 19셀 파인더의 공용 격자 정합 검출기.
 *
 * 후보마다 검출 코드를 만들지 않는다. 입력은 finder-patterns.js의 cellMasks이고,
 * 모든 후보를 같은 기하 가설에서 한 번 표본화한 뒤 정규화 상관으로 함께 비교한다.
 * 반환 H와 120/240도 방향 여유는 파인더 자체에서 나오며 앵커를 쓰지 않는다.
 */
import {
  FINDER_CELL_ORDER, FINDER_FACE_BITS, FINDER_CELL_MASK_PATTERNS,
} from '../finder-patterns.js';
import { FACES, faceCentroid, facePolygon } from '../hexgrid.js';
import { robustPercentiles } from './luma.js';
import { FRONTEND_FAILURE, assertLumaField, fail, ok } from './contracts.js';

export const UNVERIFIED_CELL_FINDER_CALIBRATION = Object.freeze({
  minCellSize: 2.25,
  maxCellSizeFraction: 1 / 9,
  scaleRatio: 1.28,
  coarseAngleStepDegrees: 15,
  varianceWindowRadiusCells: 4.1,
  varianceStepCells: 0.65,
  varianceCentersPerScale: 0,
  maxCoarseCandidates: 8,
  maxRefinedCandidates: 1,
  maxOutputCandidates: 2,
  minCorrelation: 0.56,
  minContrastRatio: 0.24,
  minOrientationMargin: 0.035,
});

const REFINED_FACE_FRACTIONS = Object.freeze([0.10, 0.90]);
const TURN_RADIANS = 2 * Math.PI / 3;
const EPSILON = 1e-12;
/**
 * 발자국(셀 목록) → 면 표본. 2026-08-18 daehan 편입으로 **발자국이 하나가 아니게**
 * 됐다 (기존 19셀 + daehan 31셀).
 *
 * ⚠ 이 모듈의 원래 설계는 «휘도를 한 번 떠서 모든 템플릿이 공유» 다. 발자국이
 * 섞이면 그 공유가 깨진다 — 서로 다른 셀에서 뜬 관측을 같은 벡터로 비교하게 된다.
 * 그래서 **발자국별로 표본을 따로 뜨고 그 안에서만 비교**한다 (아래 groupByFootprint).
 * 비용은 발자국 수에 비례해 늘어난다 — 표본 뜨기가 이 단계의 지배항이므로
 * «후보 하나 더» 보다 «발자국 하나 더» 가 훨씬 비싸다. 실측으로 관리한다.
 */
function buildFaceSamples(cells) {
  return Object.freeze(cells.flatMap((cell, cellIndex) =>
  FACES.map((face) => {
    const layout = { size: 1, originX: 0, originY: 0 };
    const point = faceCentroid(cell.q, cell.r, face, layout);
    const polygon = facePolygon(cell.q, cell.r, face, layout);
    const origin = polygon[0];
    const uVector = { x: polygon[1].x - origin.x, y: polygon[1].y - origin.y };
    const vVector = { x: polygon[3].x - origin.x, y: polygon[3].y - origin.y };
    const detailPoints = REFINED_FACE_FRACTIONS.flatMap((u) =>
      REFINED_FACE_FRACTIONS.map((v) => Object.freeze({
        x: origin.x + u * uVector.x + v * vVector.x,
        y: origin.y + u * uVector.y + v * vVector.y,
      })));
    return Object.freeze({
      cellIndex, face, bit: FINDER_FACE_BITS[face], x: point.x, y: point.y,
      detailPoints: Object.freeze(detailPoints),
    });
  })));
}

/** 기본 19셀 발자국의 표본 — 이 상수의 값·순서는 예전과 **한 값도 다르지 않다**. */
const FACE_SAMPLES = buildFaceSamples(FINDER_CELL_ORDER);

// 발자국 배열 → 표본. 같은 배열 객체면 재계산하지 않는다 (패턴이 자기 발자국
// 배열을 얼려서 들고 있으므로 참조 동일성이 성립한다).
const FACE_SAMPLE_CACHE = new WeakMap();
function faceSamplesFor(cells) {
  if (!cells || cells === FINDER_CELL_ORDER) return FACE_SAMPLES;
  const cached = FACE_SAMPLE_CACHE.get(cells);
  if (cached) return cached;
  const built = buildFaceSamples(cells);
  FACE_SAMPLE_CACHE.set(cells, built);
  return built;
}

/** 패턴의 발자국 — 없으면 기본 19셀. */
function footprintOf(pattern) {
  return Array.isArray(pattern.finderCells) ? pattern.finderCells : FINDER_CELL_ORDER;
}

/* ── 발자국 → 조대 탐색 파라미터 ────────────────────────────────────────
 * 조대 탐색의 상수(각도 보폭 15° · 조대 8개 · 정교화 1개 · 분산 창 4.1셀 ·
 * 분산 보폭 0.65셀)는 전부 **19셀 발자국 하나를 전제로** 손으로 맞춘 값이다.
 * daehan(79셀) 처럼 발자국이 커지면 같은 상수가 그 발자국에는 너무 성글다.
 *
 * ▸ **왜 «반경» 이 아니라 «도달거리» 인가.**
 *   직관은 「각도 오차 δ 가 hex 거리 R 인 셀을 R·√3·cellPx·δ 만큼 민다」 지만,
 *   계수 √3 은 «hex 거리 R 인 셀 중 가장 먼 것» 을 가정한 값이다. 실제 발자국은
 *   그 원을 다 안 채운다 — daehan 의 거리 10 셀들은 육각 «모서리» 방향에 몰려
 *   있어 계수가 1.539 다 (√3 대비 12% 과대). R 의 함수로 쓰면 반경 2 에서 현재
 *   상수의 재현이 어긋난다. 그래서 발자국의 **표본점에서 직접 재는**
 *   reach (표본점의 최대 원점거리, 셀 단위) 를 쓴다. 기존 19셀에서 4.2673.
 *
 * ▸ **허용 이동량 κ 의 유도.**
 *   조대 격자의 최대 각도 오차는 반스텝이므로 「가장 먼 표본점의 이동 ≤ κ 셀」은
 *       (step/2)·(π/180)·reach ≤ κ    ⇔    step ≤ 360·κ / (π·reach)
 *   κ 를 «현재 기본값이 기존 19셀에서 사는 만큼» 으로 고정하면
 *       κ = (15/2)·(π/180)·4.2673 = 0.5586 셀
 *   즉 현재의 15° 가 담고 있는 조건은 «가장 먼 표본점이 반 셀 남짓 안에서
 *   움직인다» 이다. 이 κ 를 반경과 무관하게 유지하라는 요구가 곧 step ∝ 1/ρ 다.
 *
 * ▸ **ρ = 1 에서 한 값도 안 바뀐다.** 나눗셈·곱셈의 피연산자가 정확히 1.0 이므로
 *   부동소수 오차도 없다 (키별 Object.is 동일).
 */
function footprintReach(faceSamples) {
  let out = 0;
  for (const sample of faceSamples) {
    for (const point of sample.detailPoints) {
      const d = Math.hypot(point.x, point.y);
      if (d > out) out = d;
    }
  }
  return out;
}
/** 기존 19셀 발자국의 도달거리 = 4.267317658670374. 모든 ρ 의 분모다. */
const BASE_REACH = footprintReach(FACE_SAMPLES);
/** 발자국의 상대 도달거리. 기존 19셀 = 1 · derived-r6 = 2.4579 · daehan-79 = 3.8134. */
function footprintRho(faceSamples) { return footprintReach(faceSamples) / BASE_REACH; }

/**
 * 기본 지수. angle·count·window 는 위 유도값(정확히 1)이고, step 만 실측이 골랐다.
 *
 * step (분산 씨앗 격자의 보폭) 은 «씨앗이 정교화의 중심 보정 예산 안에 들어오게»
 * 하는 조건에 답한다. 그 예산은 (0.34+0.12+0.04+0.012)·cellSize ≈ 0.51 셀로
 * **발자국 반경과 무관**하므로 유도는 지수 0 을 가리킨다. 그런데 실측은 다르다 —
 * daehan 8자세에서 s=0 은 «이동» 을 닫고 «복합» 을 열며, s=1 은 그 반대다.
 * 둘 다 닫는 지점이 s=0.25 였다. **유도는 «1보다 작다» 까지만 좁혔고 0.25 는
 * 실측이 고른 값이다** — 이 줄을 「유도했다」 고 쓰면 거짓이다.
 *
 * window 와 step 을 한 지수로 묶으면 안 된다. 창은 «분산의 봉우리가 발자국
 * 중심에 서게» 하는 조건(→ ρ 비례)이고 보폭은 위 조건(→ ρ 무관 근처)이다.
 * 묶으면 큰 발자국에서 씨앗 격자가 성글어져 이동 자세를 영영 못 잡는다.
 *
 * `varianceCentersPerScale` 은 이 법칙 밖이다 — 기본값이 0(기능 꺼짐)이라
 * 곱셈 법칙으로는 절대 켜지지 않는다. 큰 발자국에서 켤지는 **스위치 결정**이지
 * 유도가 아니므로 여기서 정하지 않고 calibration 에 맡긴다.
 */
const FOOTPRINT_SEARCH_LAW = Object.freeze({
  angleExponent: 1, countExponent: 1, windowExponent: 1, stepExponent: 0.25,
});

/**
 * 발자국별 조대 탐색 파라미터. **cfg 와 키 집합이 같은 객체**를 돌려준다
 * (진단용 여분 키를 붙이지 않는다 — ρ=1 동일성 검사를 키별로 돌릴 수 있게).
 * law 가 null 이면 cfg 를 그대로 복사한다.
 */
function searchParamsFor(cfg, faceSamples, law) {
  if (!law) return { ...cfg };
  const rho = footprintRho(faceSamples);
  if (rho === 1) return { ...cfg };
  return {
    ...cfg,
    coarseAngleStepDegrees: cfg.coarseAngleStepDegrees / Math.pow(rho, law.angleExponent),
    maxCoarseCandidates: Math.max(1, Math.round(cfg.maxCoarseCandidates * Math.pow(rho, law.countExponent))),
    maxRefinedCandidates: Math.max(1, Math.round(cfg.maxRefinedCandidates * Math.pow(rho, law.countExponent))),
    varianceWindowRadiusCells: cfg.varianceWindowRadiusCells * Math.pow(rho, law.windowExponent),
    varianceStepCells: cfg.varianceStepCells * Math.pow(rho, law.stepExponent),
  };
}

function clamp01(value) { return value <= 0 ? 0 : value >= 1 ? 1 : value; }
function cfgFor(options) {
  return {
    ...UNVERIFIED_CELL_FINDER_CALIBRATION,
    ...(options && typeof options.calibration === 'object' ? options.calibration : {}),
  };
}
function assertMasks(cellMasks, label = 'cellMasks') {
  if (!Array.isArray(cellMasks) || cellMasks.length !== FINDER_CELL_ORDER.length) {
    throw new RangeError(label + '는 19개 마스크 배열이어야 한다');
  }
  for (const mask of cellMasks) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
      throw new RangeError(label + ' 면 마스크 범위 오류: ' + mask);
    }
  }
  return cellMasks;
}
/**
 * 면당 3레벨 파인더 (2026-08-18, OAK 편입) — 기존 `cellMasks` 는 면당 1비트라
 * 중간톤을 못 담는다. O/A/K 후보 정본(편집기 export)은 Nitrogen r2 5면 · Aspirin
 * 2면을 중간톤으로 쓰므로, 그 후보들은 비트 표현으로는 **표현 자체가 불가능**하다.
 *
 * 그래서 `cellLevels` 를 **선택적 대체 표현**으로 더한다: 19개 `[T, L, R]` 삼중
 * (각 0|1|2). 목표값은 level/2 = 0 · 0.5 · 1 이다.
 *
 * **이진 경로는 한 값도 안 바뀐다** — 아래 `centeredExpected` 의 lightCount 정의를
 * «값의 합» 에서 «중심화 후 양수인 면의 수» 로 바꿨는데, 이진에서 두 값은 항상
 * 같다 (평균이 0과 1 사이에 엄격히 들어가므로 값 1인 면이 정확히 양수). 그리고
 * 그 식은 `scoreTemplate` 이 실제로 밝음/어두움을 가르는 식(`expected[i] > 0`)과
 * **같은 식**이라, 3레벨에서도 분모와 분할이 어긋나지 않는다. 동치는 회귀가 잡는다
 * (test/finder-3tone-levels.test.js — 기존 11패턴 전수 비트 동일).
 */
const LEVEL_TARGETS = Object.freeze([0, 0.5, 1]);
const FACE_LEVEL_INDEX = Object.freeze({ T: 0, L: 1, R: 2 });

function assertLevels(cellLevels, label = 'cellLevels', expected = FINDER_CELL_ORDER.length) {
  if (!Array.isArray(cellLevels) || cellLevels.length !== expected) {
    throw new RangeError(label + '는 ' + expected + '개 [T,L,R] 삼중 배열이어야 한다'
      + ' (받은 것 ' + (Array.isArray(cellLevels) ? cellLevels.length : typeof cellLevels) + ')');
  }
  for (const triple of cellLevels) {
    if (!Array.isArray(triple) || triple.length !== 3) {
      throw new RangeError(label + ' 항목은 [T,L,R] 삼중이어야 한다: ' + JSON.stringify(triple));
    }
    for (const level of triple) {
      if (level !== 0 && level !== 1 && level !== 2) {
        throw new RangeError(label + ' 톤 레벨은 0|1|2 여야 한다: ' + level);
      }
    }
  }
  return cellLevels;
}

function normalizePatterns(input, options) {
  const source = input === undefined ? FINDER_CELL_MASK_PATTERNS : input;
  if (Array.isArray(source) && source.length === 19 && source.every(Number.isInteger)) {
    return [{ id: options.patternId || 'cell-mask', cellMasks: assertMasks(source) }];
  }
  if (!Array.isArray(source) || source.length === 0) {
    throw new TypeError('patterns는 cellMasks 또는 패턴 객체 배열이어야 한다');
  }
  const cellPatterns = source.filter((pattern) => pattern
    && (Array.isArray(pattern.cellMasks) || Array.isArray(pattern.cellLevels)));
  if (cellPatterns.length === 0) {
    throw new TypeError('patterns에 cellMasks/cellLevels 후보가 없다');
  }
  return cellPatterns.map((pattern, index) => {
    const label = 'patterns[' + index + ']';
    // 둘 다 있으면 **레벨이 이긴다** — 레벨이 더 표현력이 크므로 마스크는 그 후보의
    // 이진 근사일 수밖에 없고, 근사를 정본으로 쓰면 조용히 틀린다.
    if (Array.isArray(pattern.cellLevels)) {
      // 발자국이 있으면 레벨 배열 길이는 **그 발자국의 길이**여야 한다 (daehan 31).
      const cells = Array.isArray(pattern.finderCells) ? pattern.finderCells : FINDER_CELL_ORDER;
      return {
        ...pattern,
        id: typeof pattern.id === 'string' ? pattern.id : 'cell-level-' + index,
        cellLevels: assertLevels(pattern.cellLevels, label + '.cellLevels', cells.length),
      };
    }
    return {
      ...pattern,
      id: typeof pattern.id === 'string' ? pattern.id : 'cell-mask-' + index,
      cellMasks: assertMasks(pattern.cellMasks, label + '.cellMasks'),
    };
  });
}
function centeredExpected(values) {
  const expected = Float64Array.from(values);
  let mean = 0;
  for (const value of expected) mean += value;
  mean /= expected.length;
  let norm2 = 0;
  // lightCount 는 **scoreTemplate 의 분할 식과 같은 식**으로 센다 (`expected[i] > 0`).
  // 이진에서는 «값의 합» 과 항상 일치하므로 (평균이 0과 1 사이에 엄격히 들어가
  // 값 1인 면이 정확히 양수) 기존 거동이 보존되고, 3레벨에서는 중간톤 면이 평균
  // 어느 쪽에 떨어지든 분모와 분할이 같은 규칙을 쓴다.
  let lightCount = 0;
  for (let i = 0; i < expected.length; i += 1) {
    expected[i] -= mean;
    norm2 += expected[i] * expected[i];
    if (expected[i] > 0) lightCount += 1;
  }
  if (!(norm2 > 0) || lightCount === 0 || lightCount === expected.length) return null;
  return {
    expected, expectedNorm: Math.sqrt(norm2),
    lightCount, darkCount: expected.length - lightCount,
  };
}
function templateOf(pattern) {
  const coarseValues = [];
  const detailedValues = [];
  const levels = pattern.cellLevels;
  const cells = footprintOf(pattern);
  const faceSamples = faceSamplesFor(cells);
  for (const sample of faceSamples) {
    const value = levels
      ? LEVEL_TARGETS[levels[sample.cellIndex][FACE_LEVEL_INDEX[sample.face]]]
      : (pattern.cellMasks[sample.cellIndex] & sample.bit ? 1 : 0);
    coarseValues.push(value);
    for (let i = 0; i < sample.detailPoints.length; i += 1) detailedValues.push(value);
  }
  const coarse = centeredExpected(coarseValues);
  const detailed = centeredExpected(detailedValues);
  if (!coarse || !detailed) {
    throw new RangeError(pattern.id + ': 밝음/어두움 양쪽 면이 필요하다');
  }
  return {
    id: pattern.id, pattern, cells, faceSamples,
    ...coarse,
    detailedExpected: detailed.expected,
    detailedExpectedNorm: detailed.expectedNorm,
    detailedLightCount: detailed.lightCount,
    detailedDarkCount: detailed.darkCount,
  };
}
function bilinear(luma, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || y < 0 || x > luma.width - 1 || y > luma.height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(luma.width - 1, x0 + 1);
  const y1 = Math.min(luma.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = luma.data[y0 * luma.width + x0];
  const b = luma.data[y0 * luma.width + x1];
  const c = luma.data[y1 * luma.width + x0];
  const d = luma.data[y1 * luma.width + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
function project(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  if (!Number.isFinite(w) || Math.abs(w) <= EPSILON) return null;
  const px = (H[0] * x + H[1] * y + H[2]) / w;
  const py = (H[3] * x + H[4] * y + H[5]) / w;
  return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
}
function observationsAt(luma, H, detailed, faceSamples = FACE_SAMPLES) {
  const sampleCount = detailed
    ? faceSamples.reduce((sum, sample) => sum + sample.detailPoints.length, 0)
    : faceSamples.length;
  const values = new Float64Array(sampleCount);
  let mean = 0;
  let index = 0;
  for (const canonical of faceSamples) {
    const samplePoints = detailed ? canonical.detailPoints : [canonical];
    for (const samplePoint of samplePoints) {
      const point = project(H, samplePoint.x, samplePoint.y);
      if (!point) return null;
      const value = bilinear(luma, point.x, point.y);
      if (value === null) return null;
      values[index++] = value;
      mean += value;
    }
  }
  mean /= values.length;
  let norm2 = 0;
  for (const value of values) norm2 += (value - mean) ** 2;
  return norm2 > EPSILON ? { values, mean, norm: Math.sqrt(norm2), detailed } : null;
}
function scoreTemplate(sampled, template, span) {
  const expected = sampled.detailed ? template.detailedExpected : template.expected;
  const expectedNorm = sampled.detailed ? template.detailedExpectedNorm : template.expectedNorm;
  // **길이 불일치를 조용히 삼키지 않는다** (2026-08-18 사고 재발 방지).
  // 아래 루프는 `sampled.values.length` 까지만 돈다. 관측과 기대의 길이가 다르면
  // «기대의 앞부분만» 비교되고, 그건 **다른 발자국을 비교하는 것**인데도
  // 그럴듯한 상관값이 나온다 — 검출 실패가 아니라 «조용히 틀린 답» 이라
  // 원인 추적에 하루가 걸렸다. 회귀보다 이 단언이 싸다.
  if (expected.length !== sampled.values.length) {
    throw new RangeError('발자국 불일치: 관측 ' + sampled.values.length
      + ' vs 기대 ' + expected.length + ' (' + template.id + ')'
      + ' — observationsAt 에 template.faceSamples 를 넘겼는지 보라');
  }
  const lightCount = sampled.detailed ? template.detailedLightCount : template.lightCount;
  const darkCount = sampled.detailed ? template.detailedDarkCount : template.darkCount;
  let dot = 0;
  let lightSum = 0;
  let darkSum = 0;
  for (let i = 0; i < sampled.values.length; i += 1) {
    const observed = sampled.values[i];
    dot += (observed - sampled.mean) * expected[i];
    if (expected[i] > 0) lightSum += observed;
    else darkSum += observed;
  }
  const correlation = dot / (sampled.norm * expectedNorm);
  const lightMean = lightSum / lightCount;
  const darkMean = darkSum / darkCount;
  const contrast = lightMean - darkMean;
  const contrastRatio = contrast / Math.max(span, EPSILON);
  const fit = Math.max(0, correlation) * clamp01(contrastRatio / 0.45);
  return { correlation, contrast, contrastRatio, lightMean, darkMean, fit };
}
/**
 * 템플릿을 **발자국별로** 묶는다. 발자국이 하나뿐인 흔한 경우(=기존 전부)에는
 * 그룹도 하나라 예전과 같은 «한 번 뜨고 전부 비교» 가 된다.
 */
function groupByFootprint(templates) {
  const groups = new Map();
  for (const template of templates) {
    const key = template.faceSamples;
    const bucket = groups.get(key);
    if (bucket) bucket.push(template);
    else groups.set(key, [template]);
  }
  return groups;
}
function scoreAll(luma, H, templates, span, detailed) {
  const out = [];
  for (const [faceSamples, group] of groupByFootprint(templates)) {
    const sampled = observationsAt(luma, H, detailed, faceSamples);
    if (!sampled) continue;   // 그 발자국이 화면 밖 — 다른 발자국은 살 수 있다
    for (const template of group) out.push({ template, ...scoreTemplate(sampled, template, span) });
  }
  return out.sort((a, b) => b.fit - a.fit || b.correlation - a.correlation
    || a.template.id.localeCompare(b.template.id));
}
function scoreBest(luma, H, templates, span, detailed) {
  let best = null;
  for (const [faceSamples, group] of groupByFootprint(templates)) {
    const sampled = observationsAt(luma, H, detailed, faceSamples);
    if (!sampled) continue;
    for (const template of group) {
      const scored = { template, ...scoreTemplate(sampled, template, span) };
      if (!best || scored.fit > best.fit
        || (scored.fit === best.fit && (scored.correlation > best.correlation
          || (scored.correlation === best.correlation
            && scored.template.id.localeCompare(best.template.id) < 0)))) best = scored;
    }
  }
  return best;
}
function HFrom(params) {
  const scale = Math.exp(params.logScale);
  const c = Math.cos(params.rotation);
  const s = Math.sin(params.rotation);
  const sx = Math.exp(params.anisotropy);
  const sy = Math.exp(-params.anisotropy);
  const a00 = scale * (c * sx - s * params.shear);
  const a01 = scale * (c * params.shear - s * sy);
  const a10 = scale * (s * sx + c * params.shear);
  const a11 = scale * (s * params.shear + c * sy);
  const p = params.projectiveX;
  const q = params.projectiveY;
  return new Float64Array([
    a00 + params.centerX * p, a01 + params.centerX * q, params.centerX,
    a10 + params.centerY * p, a11 + params.centerY * q, params.centerY,
    p, q, 1,
  ]);
}
function multiply3(left, right) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      for (let k = 0; k < 3; k += 1) out[row * 3 + col] += left[row * 3 + k] * right[k * 3 + col];
    }
  }
  return out;
}
function rotationH(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return new Float64Array([c, -s, 0, s, c, 0, 0, 0, 1]);
}
function integralsOf(luma) {
  const stride = luma.width + 1;
  const sum = new Float64Array(stride * (luma.height + 1));
  const square = new Float64Array(sum.length);
  for (let y = 0; y < luma.height; y += 1) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < luma.width; x += 1) {
      const value = luma.data[y * luma.width + x];
      rs += value;
      rq += value * value;
      const target = (y + 1) * stride + x + 1;
      sum[target] = sum[y * stride + x + 1] + rs;
      square[target] = square[y * stride + x + 1] + rq;
    }
  }
  return { stride, sum, square };
}
function rect(integral, stride, left, top, right, bottom) {
  return integral[bottom * stride + right] - integral[top * stride + right]
    - integral[bottom * stride + left] + integral[top * stride + left];
}
function varianceCenters(luma, integrals, cellSize, cfg) {
  const radius = Math.max(3, Math.round(cfg.varianceWindowRadiusCells * cellSize));
  if (radius * 2 + 1 > luma.width || radius * 2 + 1 > luma.height) return [];
  const step = Math.max(2, Math.round(cfg.varianceStepCells * cellSize));
  const raw = [];
  const rawLimit = cfg.varianceCentersPerScale * 10;
  for (let y = radius; y < luma.height - radius; y += step) {
    for (let x = radius; x < luma.width - radius; x += step) {
      const left = x - radius;
      const top = y - radius;
      const right = x + radius + 1;
      const bottom = y + radius + 1;
      const count = (right - left) * (bottom - top);
      const sum = rect(integrals.sum, integrals.stride, left, top, right, bottom);
      const square = rect(integrals.square, integrals.stride, left, top, right, bottom);
      const variance = Math.max(0, square / count - (sum / count) ** 2);
      let index = raw.length;
      while (index > 0 && raw[index - 1].variance < variance) index -= 1;
      raw.splice(index, 0, { x, y, variance });
      if (raw.length > rawLimit) raw.pop();
    }
  }
  const kept = [];
  const nms2 = (cellSize * 1.6) ** 2;
  for (const entry of raw) {
    if (kept.some((other) => (other.x - entry.x) ** 2 + (other.y - entry.y) ** 2 < nms2)) continue;
    kept.push(entry);
    if (kept.length >= cfg.varianceCentersPerScale) break;
  }
  return kept;
}
function centerSeeds(luma, variance, supplied) {
  const out = [];
  const add = (point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.y < 0 || point.x >= luma.width || point.y >= luma.height) return;
    if (!out.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 1)) out.push(point);
  };
  // 라이브 입력은 중앙 정사각 크롭이다. outline 중심은 회전된 육각 외곽의
  // 이산화로 1px가량 치우칠 수 있으므로 영상 중심을 동점 우선으로 둔다.
  add({ x: (luma.width - 1) / 2, y: (luma.height - 1) / 2 });
  if (Array.isArray(supplied)) supplied.forEach(add); else add(supplied);
  variance.forEach(add);
  return out;
}
function scaleSeeds(luma, options, cfg) {
  const min = Number.isFinite(options.minCellSize) ? options.minCellSize : cfg.minCellSize;
  const max = Number.isFinite(options.maxCellSize)
    ? options.maxCellSize : Math.min(luma.width, luma.height) * cfg.maxCellSizeFraction;
  const out = [];
  const add = (value) => {
    if (!Number.isFinite(value) || value < min || value > max
      || out.some((other) => Math.abs(Math.log(other / value)) < 0.025)) return;
    out.push(value);
  };
  const supplied = Array.isArray(options.cellSizeSeeds) ? options.cellSizeSeeds
    : options.cellSizeSeeds === undefined ? [] : [options.cellSizeSeeds];
  for (const seed of supplied) { add(seed * 0.82); add(seed); add(seed * 1.22); }
  if (out.length === 0) {
    for (let value = min; value <= max * 1.001; value *= cfg.scaleRatio) add(value);
  }
  return out.sort((a, b) => a - b);
}
/**
 * 조대 척도 사다리의 **최대 반 간격** (로그). 정교화가 반드시 넘을 수 있어야 하는 거리다.
 *
 * ▸ **왜 필요한가.** 조대 탐색은 척도를 이산 사다리에서만 본다 — 씨앗이 없으면
 *   `minCellSize` 부터 `scaleRatio` 등비(기본 1.28), 씨앗이 있으면 `×0.82 / ×1 / ×1.22`.
 *   참 셀 크기가 두 격자점 사이에 떨어지면 조대 최적점은 최대 ln(1.28)/2 = 0.1234 만큼
 *   척도가 틀린 자세다. 그 자세에서 출발한 `refine()` 이 참 척도까지 못 오르면 검출은
 *   실패한다 — 그리고 **실제로 못 올랐다**.
 *
 * ▸ **왜 라운드1 보폭 0.11 로는 부족했나.** 보폭 자체는 0.11 로 0.1015 를 덮는다.
 *   문제는 좌표 하강의 **순서**다. 라운드1 은 `centerX`·`centerY` 를 먼저 0.34·scale
 *   (24px 셀이면 8px) 움직이는데, 척도가 10% 틀린 자세에서는 그 이동이 목적함수를
 *   올려 주는 것처럼 보인다. 중심이 먼저 엉뚱한 분지로 끌려가면 뒤따르는 척도 한 걸음이
 *   회복하지 못한다. 실측한 정교화의 척도 포획 반경은 대략 [-0.08, +0.05] 로,
 *   사다리 반 간격 ±0.1234 보다 **좁다**.
 *
 * ▸ **그래서 척도만 먼저 괄호로 훑는다.** 중심·회전은 조대 값 그대로 두고 logScale 만
 *   ±bracket, ±bracket/2 네 점을 시험해 가장 좋은 데서 본 정교화를 시작한다.
 *   조대 격자가 보장하는 것과 정교화가 감당하는 것을 **같은 값으로 묶는** 것이다.
 *
 * 사다리가 한 점뿐이면 0 을 준다 (넘을 간격이 없으므로 사전 패스는 통째로 꺼진다).
 */
function scaleBracketOf(scales) {
  if (!Array.isArray(scales) || scales.length < 2) return 0;
  let worst = 0;
  for (let i = 1; i < scales.length; i += 1) {
    const gap = Math.log(scales[i] / scales[i - 1]);
    if (gap > worst) worst = gap;
  }
  return worst / 2;
}
function insertTop(list, entry, limit) {
  let index = list.length;
  while (index > 0 && (entry.fit > list[index - 1].fit
    || (entry.fit === list[index - 1].fit && entry.correlation > list[index - 1].correlation))) index -= 1;
  list.splice(index, 0, entry);
  if (list.length > limit) list.pop();
}
function geometryModelPenalty(params) {
  // The 19-cell slot is only a few lattice units wide. A tiny raw-NCC gain can
  // otherwise invent terms that explode when extrapolated to the outer data
  // cells. Keep perspective/affine deformation when pixels justify it, but
  // prefer the simpler model.
  return (params.projectivePenalty ?? 2.0)
    * (Math.abs(params.projectiveX) + Math.abs(params.projectiveY))
    + 0.20 * (Math.abs(params.anisotropy) + Math.abs(params.shear));
}
function scoreParams(luma, params, template, span) {
  const H = HFrom(params);
  // ⚠ **넷째 인자를 빠뜨리면 조용히 틀린다** (2026-08-18 실제 사고).
  //   발자국 파라미터화가 scoreAll·scoreBest 까지 배선됐는데 이 정교화 경로만
  //   빠져 있었다. 그러면 언제나 기본 19셀 표본을 뜨고, scoreTemplate 은
  //   `sampled.values.length` 까지만 돌므로 **길이 불일치가 조용히 잘려**
  //   «발자국 배열의 앞 19셀» 만 비교된다. 증상은 «검출 실패» 가 아니라
  //   «배열 순서에 따라 답이 달라짐» 이라 알아채기가 아주 어렵다 —
  //   daehan 79셀에서 중앙19를 앞에 두면 1.0000, 정본 순서면 0.6058 이었다.
  //   회귀: test/finder-footprint-refine.test.js (순서 무관성을 값으로 잠근다).
  const sampled = observationsAt(luma, H, true, template.faceSamples);
  if (!sampled) return null;
  const scored = scoreTemplate(sampled, template, span);
  return { H, ...scored, objective: scored.fit - geometryModelPenalty(params) };
}
function refine(luma, coarse, span, geometryMode = 'affine') {
  let params = {
    ...coarse.params,
    projectivePenalty: geometryMode === 'projective' ? 1.5 : 2.0,
  };
  let best = scoreParams(luma, params, coarse.template, span);
  if (!best) return null;
  // ── 척도 괄호 사전 패스 ── 조대 사다리의 반 간격을 정교화가 반드시 넘게 한다.
  // `scaleBracketOf` 의 주석에 유도가 있다. 중심·회전은 건드리지 않는다 — 척도가
  // 맞기 전에 중심을 옮기면 엉뚱한 분지로 들어가는 것이 바로 이 사전 패스가 막는 사고다.
  // 비용은 정교화당 scoreParams 4회 (본 정교화는 라운드 4 × 좌표 8 × 방향 2 = 최대 64회).
  const bracket = coarse.scaleBracket;
  if (bracket > 0) {
    for (const delta of [-bracket, -bracket / 2, bracket / 2, bracket]) {
      const trial = { ...params, logScale: params.logScale + delta };
      const scored = scoreParams(luma, trial, coarse.template, span);
      if (scored && scored.objective > best.objective + EPSILON) { params = trial; best = scored; }
    }
  }
  const scale = Math.exp(params.logScale);
  const rounds = [
    [0.34 * scale, 0.11, 4, 0.07, 0.014],
    [0.12 * scale, 0.04, 1.4, 0.025, 0.005],
    [0.04 * scale, 0.014, 0.45, 0.009, 0.0017],
    [0.012 * scale, 0.004, 0.14, 0.003, 0.0005],
  ];
  for (const [centerStep, scaleStep, angleStep, affineStep, projectiveStep] of rounds) {
    const steps = {
      centerX: centerStep, centerY: centerStep, logScale: scaleStep,
      rotation: angleStep * Math.PI / 180,
      anisotropy: affineStep, shear: affineStep,
      projectiveX: geometryMode === 'projective' ? projectiveStep : 0,
      projectiveY: geometryMode === 'projective' ? projectiveStep : 0,
    };
    for (const name of Object.keys(steps)) {
      if (!(steps[name] > 0)) continue;
      let chosenParams = params;
      let chosen = best;
      for (const direction of [-1, 1]) {
        const trial = { ...params, [name]: params[name] + direction * steps[name] };
        if (Math.abs(trial.anisotropy) > 0.32 || Math.abs(trial.shear) > 0.32
          || Math.abs(trial.projectiveX) > 0.08 || Math.abs(trial.projectiveY) > 0.08) continue;
        const scored = scoreParams(luma, trial, coarse.template, span);
        if (scored && (scored.objective > chosen.objective + EPSILON
          || (Math.abs(scored.objective - chosen.objective) <= EPSILON
            && scored.correlation > chosen.correlation))) {
          chosenParams = trial;
          chosen = scored;
        }
      }
      params = chosenParams;
      best = chosen;
    }
  }
  return { ...best, params, template: coarse.template, geometryMode };
}
function degrees(radians) { return ((radians * 180 / Math.PI) % 360 + 360) % 360; }
function turnOf(radians) { return Math.floor((degrees(radians) + 60) / 120) % 3; }
function finishCandidate(luma, refined, templates, span, cfg, exemptPairs) {
  // 포함쌍은 **전환 경쟁에서도 면제**한다 (C2b 2차, 2026-08-24). NMS 면제만으로는
  // 부족했다 — 여기의 «최고 템플릿으로 전환» 이 상류에서 daehan 정교화 후보를
  // 전부 taegeuk-solo 로 개명해 버려(부분집합은 같은 자리에서 언제나 경쟁력이 있고,
  // ss1 실측에선 fit 1.0000 동률에서도 전환됐다) NMS 면제가 손도 못 썼다.
  // 부분집합/상위집합 중 무엇이 프레임의 실체인지는 광학이 원리적으로 못 가른다 —
  // 두 해석을 다 후보로 남겨 RS/CRC 가설 열거가 가르게 한다 (nms 면제와 같은 원리).
  const contenders = exemptPairs && exemptPairs.size > 0
    ? templates.filter((t) => t.id === refined.template.id
      || !exemptPairs.has(refined.template.id + '|' + t.id))
    : templates;
  let best = scoreBest(luma, refined.H, contenders, span, true);
  let final = refined;
  if (!best) return null;
  if (best.template.id !== refined.template.id) {
    const rerun = refine(
      luma, { ...refined, template: best.template }, span, refined.geometryMode,
    );
    if (rerun) {
      final = rerun;
      best = scoreBest(luma, final.H, contenders, span, true);
    }
  }
  const wrong = [1, 2].map((turn) => scoreAll(
    luma, multiply3(final.H, rotationH(turn * TURN_RADIANS)), [best.template], span, true,
  )[0]?.correlation ?? -1);
  const orientationMargin = best.correlation - Math.max(...wrong);
  const hardChecks = {
    correlation: best.correlation >= cfg.minCorrelation,
    contrast: best.contrastRatio >= cfg.minContrastRatio,
    orientation: orientationMargin >= cfg.minOrientationMargin,
  };
  hardChecks.all = hardChecks.correlation && hardChecks.contrast && hardChecks.orientation;
  const cellSize = Math.exp(final.params.logScale);
  const score = clamp01(0.72 * clamp01(best.correlation)
    + 0.18 * clamp01(best.contrastRatio) + 0.10 * clamp01(orientationMargin / 0.25)
    - geometryModelPenalty(final.params));
  return {
    finderKind: 'cell-mask', kind: 'cell-mask', patternId: best.template.id,
    // 레벨 후보는 cellMasks 가 없다 — 이진 근사를 지어내지 않고 undefined 로 둔다.
    cellMasks: best.template.pattern.cellMasks,
    cellLevels: best.template.pattern.cellLevels,
    center: { x: final.params.centerX, y: final.params.centerY },
    cellSize, score, correlation: best.correlation, contrast: best.contrast,
    contrastRatio: best.contrastRatio,
    orientation: turnOf(final.params.rotation), orientationSource: 'finder-pattern',
    orientationMargin, rotationDegrees: degrees(final.params.rotation),
    hardChecks, hardChecksPassed: hardChecks.all,
    H: final.H, transform: final.H, B: final.H,
    // F-95: 재투영 오차가 아니라 적합도 벌점을 px 척도로 옮긴 값이다. 이름을 분리해
    // bootstrap rH와 telemetry residualPx가 재투영 오차로 오인하지 않게 한다.
    finderFitPenaltyPx: (1 - score) * cellSize,
    geometryMode: final.geometryMode,
    bands: { matcher: 'cell-mask-ncc', hardChecks, turnCorrelations: wrong },
  };
}
/**
 * 패턴 하나의 (셀좌표, 면) → 기대값 지도 — 포함쌍 유도용. templateOf 와 같은 값
 * 규약(cellLevels → LEVEL_TARGETS · cellMasks → 0/1)이라 표현이 달라도 비교된다.
 */
function faceValueMap(pattern) {
  const cells = footprintOf(pattern);
  const map = new Map();
  for (const sample of faceSamplesFor(cells)) {
    const cell = cells[sample.cellIndex];
    const value = pattern.cellLevels
      ? LEVEL_TARGETS[pattern.cellLevels[sample.cellIndex][FACE_LEVEL_INDEX[sample.face]]]
      : (pattern.cellMasks[sample.cellIndex] & sample.bit ? 1 : 0);
    map.set(cell.q + ',' + cell.r + ',' + sample.face, value);
  }
  return map;
}

/**
 * 포함쌍 유도 (C2b, 2026-08-23) — 작은 패턴의 발자국·톤이 큰 패턴의 **진부분집합**이면
 * (daehan ⊃ taegeuk-solo 가 실측 사례 — 중앙 19 가 톤까지 동일), 같은 자리의 두 검출은
 * «중복» 이 아니라 **같은 프레임의 경합 해석**이다: 어느 쪽이 프레임의 실체인지는
 * 광학이 원리적으로 못 가르고 RS/CRC 가설 열거가 가른다 (finder-daehan.js §포함 사슬).
 * 손 목록이 아니라 값 대조 유도다 — 새 패턴이 포함 관계를 만들면 자동으로 잡힌다.
 */
export function containmentPairs(patterns) { // export 는 테스트 소비 (값 잠금) — 런타임 소비자는 detectCellFinders 뿐
  const maps = patterns.map((pattern) => ({ id: pattern.id, map: faceValueMap(pattern) }));
  const pairs = new Set();
  for (const small of maps) {
    for (const big of maps) {
      if (small.id === big.id || small.map.size >= big.map.size) continue;
      let subset = true;
      for (const [key, value] of small.map) {
        if (big.map.get(key) !== value) { subset = false; break; }
      }
      if (subset) {
        pairs.add(small.id + '|' + big.id);
        pairs.add(big.id + '|' + small.id);
      }
    }
  }
  return pairs;
}

function nms(candidates, limit, exemptPairs) {
  const sorted = candidates.slice().sort((a, b) => b.score - a.score
    || b.orientationMargin - a.orientationMargin || a.patternId.localeCompare(b.patternId));
  const kept = [];
  for (const candidate of sorted) {
    if (kept.some((other) => {
      // 포함쌍은 공간이 겹쳐도 억제하지 않는다 — 두 해석을 모두 가설로 올려
      // RS/CRC 가 가르게 한다 (C2b — solo 가 daehan 을 밀어내던 오수용의 처방).
      if (exemptPairs && exemptPairs.has(candidate.patternId + '|' + other.patternId)) {
        return false;
      }
      const sameCenter = Math.hypot(candidate.center.x - other.center.x,
        candidate.center.y - other.center.y) < 1.2 * Math.min(candidate.cellSize, other.cellSize);
      const sameProjective = Math.hypot(
        candidate.H[6] - other.H[6], candidate.H[7] - other.H[7],
      ) < 0.0008;
      return sameCenter && sameProjective;
    })) continue;
    kept.push(candidate);
    if (kept.length >= limit) break;
  }
  return kept;
}

export function scoreCellMaskAtHomography(luma, cellMasks, H, options = {}) {
  assertLumaField(luma);
  const template = templateOf(normalizePatterns(cellMasks, options)[0]);
  const percentiles = robustPercentiles(luma, [0.01, 0.99]);
  const span = percentiles ? percentiles[1] - percentiles[0] : 0;
  if (!(span > EPSILON)) return fail(FRONTEND_FAILURE.NO_FINDER, { cause: 'luma-span-degenerate' });
  const scored = scoreBest(luma, H, [template], span, options.detailed !== false);
  return scored ? ok({ patternId: template.id, ...scored })
    : fail(FRONTEND_FAILURE.NO_FINDER, { cause: 'pattern-outside-image' });
}

export function detectCellFinders(luma, patternInput = FINDER_CELL_MASK_PATTERNS, options = {}) {
  try { assertLumaField(luma); } catch (error) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'cell-finder-input', message: error.message });
  }
  const normalized = normalizePatterns(patternInput, options);
  const templates = normalized.map(templateOf);
  // 포함쌍 (C2b) — NMS 억제 면제 목록. 라인업에 포함 관계가 없으면 빈 집합(비용 0급).
  const exemptPairs = containmentPairs(normalized);
  const cfg = cfgFor(options);
  // options.footprintSearchLaw: null 이면 법칙을 끈다 (전부 cfg 상수 그대로).
  // 객체면 기본 지수를 덮어쓴다 — 파레토 위를 움직이는 손잡이다.
  const law = options.footprintSearchLaw === null ? null
    : { ...FOOTPRINT_SEARCH_LAW, ...(options.footprintSearchLaw || {}) };
  const percentiles = robustPercentiles(luma, [0.01, 0.99]);
  const span = percentiles ? percentiles[1] - percentiles[0] : 0;
  if (!(span > EPSILON)) return fail(FRONTEND_FAILURE.NO_FINDER, { stage: 'cell-finder-search', cause: 'luma-span-degenerate' });
  // 조대 탐색을 **발자국 그룹별로** 돈다. 그래야 큰 발자국이 자기 격자를 제대로
  // 훑어도 작은 발자국의 파라미터·연산량이 한 값도 안 늘어난다 (그리고 큰 발자국이
  // 공유 조대 목록에서 작은 발자국의 자리를 뺏는 일도 사라진다).
  // 발자국이 하나뿐인 라인업(= 지금까지의 전부)에서는 그룹도 하나라 아래 흐름이
  // 예전과 한 줄도 다르지 않다.
  let integrals = null;
  let evaluatedGeometry = 0;
  let evaluatedCoarse = 0;
  let scaleCount = 0;
  const groups = [];
  for (const [faceSamples, group] of groupByFootprint(templates)) {
    const gcfg = searchParamsFor(cfg, faceSamples, law);
    if (gcfg.varianceCentersPerScale > 0 && !integrals) integrals = integralsOf(luma);
    const scales = scaleSeeds(luma, options, gcfg);
    // 이 발자국이 쓰는 사다리의 반 간격. 조대 후보에 실어 정교화까지 들고 간다.
    const scaleBracket = scaleBracketOf(scales);
    if (scales.length > scaleCount) scaleCount = scales.length;
    const coarse = [];
    for (const cellSize of scales) {
      const variance = (gcfg.varianceCentersPerScale > 0 && integrals)
        ? varianceCenters(luma, integrals, cellSize, gcfg) : [];
      const centers = centerSeeds(luma, variance, options.centerSeeds);
      for (const center of centers) {
        for (let angle = 0; angle < 360; angle += gcfg.coarseAngleStepDegrees) {
          const params = {
            centerX: center.x, centerY: center.y, logScale: Math.log(cellSize),
            rotation: angle * Math.PI / 180, anisotropy: 0, shear: 0,
            projectiveX: 0, projectiveY: 0,
          };
          const H = HFrom(params);
          const scored = scoreBest(luma, H, group, span, false);
          evaluatedGeometry += 1;
          if (scored && scored.fit > 0) {
            insertTop(coarse, { ...scored, params, H, scaleBracket }, gcfg.maxCoarseCandidates);
          }
        }
      }
    }
    evaluatedCoarse += coarse.length;
    groups.push({ coarse, gcfg });
  }
  const refined = groups.flatMap(({ coarse, gcfg }) => coarse.slice(0, gcfg.maxRefinedCandidates)
    .flatMap((candidate) => [
      refine(luma, candidate, span, 'affine'),
      refine(luma, candidate, span, 'projective'),
    ]).filter(Boolean));
  // 완성·게이트·NMS 는 발자국을 다시 섞어 **전 후보를 한자리에서** 겨룬다 —
  // 그룹 분리는 탐색 단계에만 걸린다.
  const candidates = nms(refined.map((entry) => finishCandidate(luma, entry, templates, span, cfg, exemptPairs))
    .filter((entry) => entry && entry.hardChecksPassed), cfg.maxOutputCandidates, exemptPairs);
  if (candidates.length === 0) {
    const best = refined[0];
    return fail(FRONTEND_FAILURE.NO_FINDER, {
      stage: 'cell-finder-search', evaluatedGeometry, evaluatedCoarse,
      evaluatedRefined: refined.length, bestScore: best?.fit,
      bestPatternId: best?.template?.id, bestCorrelation: best?.correlation,
      bestContrastRatio: best?.contrastRatio,
    });
  }
  return ok({ candidates, diagnostics: {
    matcher: 'cell-mask-ncc', patternCount: templates.length, scaleCount,
    evaluatedGeometry, evaluatedCoarse, evaluatedRefined: refined.length,
    footprintGroups: groups.map(({ gcfg }) => ({
      coarseAngleStepDegrees: gcfg.coarseAngleStepDegrees,
      maxCoarseCandidates: gcfg.maxCoarseCandidates,
      maxRefinedCandidates: gcfg.maxRefinedCandidates,
      varianceWindowRadiusCells: gcfg.varianceWindowRadiusCells,
      varianceStepCells: gcfg.varianceStepCells,
    })),
  } });
}

/* 반경 법칙의 실측·회귀 검사가 쓰는 진입점. 런타임 경로는 위 detectCellFinders 다. */
export const FOOTPRINT_SEARCH_INTERNALS = Object.freeze({
  footprintReach, footprintRho, searchParamsFor,
  FACE_SAMPLES, BASE_REACH, FOOTPRINT_SEARCH_LAW,
});
