/**
 * verifyY.js — Type Y 렌더 자체 검증 + §7.2-Y 정규화 추정기 (SPEC §14, T7)
 *
 * verify.js(Type O)와 대칭이지만 결정적으로 다른 지점이 하나 있다 — Type Y 는
 * 셀 하나(T/L/R)만 비교해서 끝나지 않는다. 세 면은 큐브 실루엣 위에서 서로 다른
 * 위치·각도에 렌더되므로(§14: "면당 공간장은 M0-Y 렌더가 면내 균일이므로 상수
 * 게인만"), 면마다 시스템 상수 게인 ĝ_f 가 실릴 수 있다. 그래서 그냥 median 순서를
 * 비교하는 게 아니라: 레퍼런스 4조(기지 digit)에서 면별 게인을 추정 → 관측 median 을
 * 게인으로 나눠 정규화 → 그 정규화값으로 순위·digit 을 복원한다. 이 모듈이 그
 * "§7.2-Y 단일 정규화 계약"의 레퍼런스 구현이다.
 *
 * M1 디코더가 아니다 — 기하를 이미 알고(렌더한 쪽이므로) 왜곡도 없다. 순수하게
 * "인코더·렌더러 조합이 자기 계약을 지켰는가" 만 본다.
 *
 * 결정성: RNG 없음(전 데이터·필러·포맷·레퍼런스 셀 전수 조사), Math.hypot 금지
 * (discMedianLuminance 재사용 — 이미 제곱 비교로 되어 있다).
 */

import { discMedianLuminance } from './verify.js';
import { YFACES, moduleSampleDisc } from './ygrid.js';
import { referenceGroups } from './placementY.js';
import { digitToRanks, ranksToDigit } from './lehmer.js';
import { relativeLuminance, DELTA_MIN_CONTRACT, getPreset, DEFAULT_PRESET } from './luminance.js';

/** SPEC §14 §7.2-Y 계약: 풀링 잔차(선형 도메인) 게이트 상한. */
export const EPSILON_FIT = 0.01;

/**
 * 검증에 쓸 "기지 레벨" RGB 3개(rank 0..2 오름차순). 명시 우선순위:
 * options.levels > options.preset > scene.palette.levels > DEFAULT_PRESET.
 * sceneY.js 가 아직 없어(M0-Y 렌더러 병렬 lane) palette 를 실을 자리가 정해지지
 * 않았다 — 그때까지는 이 폴백 사슬이 §7.2-Y 정규화 추정기의 유일한 진입점이다.
 * @param {object} scene
 * @param {{levels?: {r,g,b}[], preset?: string}} [options]
 * @returns {[{r,g,b},{r,g,b},{r,g,b}]}
 */
function resolveLevels(scene, options) {
  const opts = options || {};
  if (Array.isArray(opts.levels)) return opts.levels;
  if (typeof opts.preset === 'string') return getPreset(opts.preset).levels;
  if (scene && scene.palette && Array.isArray(scene.palette.levels)) {
    return scene.palette.levels;
  }
  return getPreset(DEFAULT_PRESET).levels;
}

/**
 * 래스터에서 모듈 (face, i, j) 원판(§7.2 규약 승계, ygrid.moduleSampleDisc) 안
 * 전 픽셀의 상대휘도 median.
 * @param {{width:number,height:number,pixels:Uint8ClampedArray,pixelsPerUnit:number}} raster
 * @param {{layout: object}} scene
 * @param {'T'|'L'|'R'} face
 * @param {number} i @param {number} j
 * @returns {number} 상대휘도 Y (0..1)
 */
export function measureModuleMedian(raster, scene, face, i, j) {
  const disc = moduleSampleDisc(face, i, j, scene.layout);
  return discMedianLuminance(
    raster,
    disc.x * raster.pixelsPerUnit,
    disc.y * raster.pixelsPerUnit,
    disc.radius * raster.pixelsPerUnit,
  );
}

/**
 * 가중 로그 최소자승 게인 추정 (SPEC §14: w ∝ Y²). 순수 함수 — 래스터에 닿지 않아
 * 단위 테스트가 게인 추정 정확도를 부동소수 그대로(1e-6) 검증할 수 있다.
 * ĝ = exp( Σ w·(ln Y_obs − ln y_lv) / Σ w ), w = y_lv².
 * 관측 ≤ 0(또는 기지 레벨 ≤ 0) 은 제외 + excluded 목록 보고 — 클램프 정책.
 * @param {{i:number,j:number,yKnown:number,yObs:number}[]} pairs
 * @param {{weighted?: boolean}} [options] weighted:false 면 균등 가중(비교용).
 * @returns {{gain:number, included:object[], excluded:object[]}}
 */
export function estimateGainFromPairs(pairs, options = {}) {
  const weighted = options.weighted === undefined ? true : options.weighted;
  let num = 0;
  let den = 0;
  const included = [];
  const excluded = [];
  for (const p of pairs) {
    if (!(p.yObs > 0) || !(p.yKnown > 0)) {
      excluded.push(p);
      continue;
    }
    const w = weighted ? p.yKnown * p.yKnown : 1;
    num += w * (Math.log(p.yObs) - Math.log(p.yKnown));
    den += w;
    included.push(p);
  }
  if (den === 0) {
    return { gain: NaN, included, excluded };
  }
  return { gain: Math.exp(num / den), included, excluded };
}

/**
 * 레퍼런스 4조 × 3셀(=12셀) 을 면별로 순회해 (기지 레벨 y_lv, 관측 median Y_obs)
 * 12쌍을 모으고, 면마다 estimateGainFromPairs 로 ĝ_f 를 추정한다.
 * @param {object} raster
 * @param {object} scene
 * @param {{n:number, cellDigits: Map<string,{digit:number, role:string}>}} encoded
 * @param {{levels?: {r,g,b}[], preset?: string}} [options]
 * @returns {{gains: {T:number,L:number,R:number}, excluded: {T:object[],L:object[],R:object[]}, observations: {T:object[],L:object[],R:object[]}, levels: [number,number,number]}}
 */
export function estimateFaceGains(raster, scene, encoded, options = {}) {
  const { n, cellDigits } = encoded;
  if (!Number.isInteger(n)) {
    throw new RangeError(`encoded.n 은 정수여야 한다: ${n}`);
  }
  const yLevels = resolveLevels(scene, options).map((rgb) => relativeLuminance(rgb));

  const gains = {};
  const excluded = {};
  const observations = {};

  for (const face of YFACES) {
    const pairs = [];
    for (const group of referenceGroups(n)) {
      for (const cell of group.cells) {
        const entry = cellDigits.get(`${cell.i},${cell.j}`);
        // 방어적 가드 — 레퍼런스 좌표는 placementY.js 가 이미 로드 시점에
        // 자기검증했으므로 정상 경로에서는 항상 role==='reference' 여야 한다.
        if (!entry || entry.role !== 'reference') continue;
        const ranks = digitToRanks(entry.digit);
        const yKnown = yLevels[ranks[face]];
        const yObs = measureModuleMedian(raster, scene, face, cell.i, cell.j);
        pairs.push({ i: cell.i, j: cell.j, yKnown, yObs });
      }
    }
    const { gain, excluded: exc } = estimateGainFromPairs(pairs);
    gains[face] = gain;
    excluded[face] = exc;
    observations[face] = pairs;
  }

  return { gains, excluded, observations, levels: yLevels };
}

/**
 * 레퍼런스 12셀 × 3면(=36쌍, 클램프 제외분 빼고) 풀링 잔차 — 선형 도메인
 * |Y_obs − ĝ·y_lv|. max 잔차 ≤ ε_fit(기본 0.01) 게이트 판정 포함.
 * @param {object} raster
 * @param {object} scene
 * @param {{n:number, cellDigits: Map<string,{digit:number, role:string}>}} encoded
 * @param {{T:number,L:number,R:number}} gains estimateFaceGains 의 gains
 * @param {{levels?: {r,g,b}[], preset?: string, epsilon?: number, observations?: object}} [options]
 * @returns {{residuals: object[], maxResidual: number, epsilon: number, ok: boolean}}
 */
export function fitResiduals(raster, scene, encoded, gains, options = {}) {
  const { n, cellDigits } = encoded;
  const epsilon = options.epsilon === undefined ? EPSILON_FIT : options.epsilon;
  const yLevels = resolveLevels(scene, options).map((rgb) => relativeLuminance(rgb));

  const residuals = [];
  for (const face of YFACES) {
    const g = gains[face];
    // 관측을 재사용할 수 있으면(estimateFaceGains 산출물) 재측정을 피한다.
    const pairs = (options.observations && options.observations[face])
      || (() => {
        const out = [];
        for (const group of referenceGroups(n)) {
          for (const cell of group.cells) {
            const entry = cellDigits.get(`${cell.i},${cell.j}`);
            if (!entry || entry.role !== 'reference') continue;
            const ranks = digitToRanks(entry.digit);
            out.push({
              i: cell.i,
              j: cell.j,
              yKnown: yLevels[ranks[face]],
              yObs: measureModuleMedian(raster, scene, face, cell.i, cell.j),
            });
          }
        }
        return out;
      })();

    for (const p of pairs) {
      if (!(p.yObs > 0) || !(p.yKnown > 0)) continue; // 클램프 정책과 동일하게 제외
      if (!Number.isFinite(g)) continue; // 게인 추정 자체가 실패한 면은 잔차 판정 불능 — 별도 게이트에서 드러난다
      const residual = Math.abs(p.yObs - g * p.yKnown);
      residuals.push({ face, i: p.i, j: p.j, residual });
    }
  }

  const maxResidual = residuals.length === 0
    ? 0
    : residuals.reduce((acc, r) => (r.residual > acc ? r.residual : acc), 0);

  return {
    residuals,
    maxResidual,
    epsilon,
    ok: maxResidual <= epsilon,
  };
}

/** 면별 정규화 median → 순위 → digit. 동률은 T,L,R 정준 순서로 안정 결정 (verify.js 와 동일 규약). */
function recoverDigitY(normalized) {
  const order = [0, 1, 2];
  const values = YFACES.map((f) => normalized[f]);
  order.sort((a, b) => values[a] - values[b] || a - b);
  const ranks = {};
  order.forEach((faceIdx, rankPos) => {
    ranks[YFACES[faceIdx]] = rankPos;
  });
  return ranksToDigit(ranks);
}

/**
 * 래스터 전체 자체 검증 — encoded.cellDigits 의 전 셀(데이터·필러·포맷·레퍼런스
 * 전 역할)에 대해 게인 정규화 후 digit 복원 일치와 인접 순위 간 최소 분리폭을 잰다.
 *
 * @param {object} raster rasterize() 산출물 (pixelsPerUnit 포함)
 * @param {object} scene buildScene()류 산출물 (layout 을 쓴다)
 * @param {{n:number, cellDigits: Map<string, {digit:number, role:string}>}} encoded
 * @param {{levels?: {r,g,b}[], preset?: string, epsilon?: number}} [options]
 * @returns {{total:number, matched:number, mismatches:Array, minDeltaY:number, gains:object, residualGate:object, ok:boolean}}
 */
export function verifyRasterY(raster, scene, encoded, options = {}) {
  const { gains, excluded, observations } = estimateFaceGains(raster, scene, encoded, options);
  const residualGate = fitResiduals(raster, scene, encoded, gains, { ...options, observations });

  let total = 0;
  let matched = 0;
  let minDeltaY = Infinity;
  const mismatches = [];

  for (const [cellKey, { digit, role }] of encoded.cellDigits) {
    const [i, j] = cellKey.split(',').map(Number);
    const normalized = {};
    for (const face of YFACES) {
      const yObs = measureModuleMedian(raster, scene, face, i, j);
      const g = gains[face];
      normalized[face] = Number.isFinite(g) && g > 0 ? yObs / g : yObs;
    }
    const recovered = recoverDigitY(normalized);

    const sorted = YFACES.map((f) => normalized[f]).sort((a, b) => a - b);
    const delta = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
    if (delta < minDeltaY) minDeltaY = delta;

    total += 1;
    if (recovered === digit) {
      matched += 1;
    } else {
      mismatches.push({ i, j, role, expected: digit, recovered, normalized });
    }
  }

  return {
    total,
    matched,
    mismatches,
    minDeltaY,
    gains,
    gainsExcluded: excluded,
    residualGate,
    ok: mismatches.length === 0 && minDeltaY >= DELTA_MIN_CONTRACT && residualGate.ok,
  };
}
