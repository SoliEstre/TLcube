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
 * [v3.1 §4b 2톤 메인 전환] `verifyRasterY` 가 `encoded.tones` 로 분기한다(기본 2 —
 * encodeY.js 기본값과 정합). 게인 추정(estimateFaceGains/fitResiduals)은 tones 와
 * 무관하게 동일 코드 경로다 — 레퍼런스 조가 항상 면별 rank {0,1,2} 전부를 주므로
 * (D9: tones=2 는 [0,1,2], tones=3 은 [0,4,3], 둘 다 digitToRanks 로 rank 를 낸다).
 * 갈리는 것은 **분류기**뿐이다: tones===2 는 면별 θ_f(U14 등급 iii, 로그 중점) 임계
 * 분류(classifyTriple) + 불법 트리플 = erasures, tones===3 은 기존 3면 순위 정렬
 * (recoverDigitY, minDeltaY) 무변경.
 *
 * 결정성: RNG 없음(전 데이터·필러·포맷·레퍼런스 셀 전수 조사), Math.hypot 금지
 * (discMedianLuminance 재사용 — 이미 제곱 비교로 되어 있다). median 은 정렬 기반
 * (Math.random 미사용).
 */

import { discMedianLuminance } from './verify.js';
import { YFACES, moduleSampleDisc } from './ygrid.js';
import { referenceGroups } from './placementY.js';
import { digitToRanks, ranksToDigit } from './lehmer.js';
import { relativeLuminance, DELTA_MIN_CONTRACT, getPreset, DEFAULT_PRESET } from './luminance.js';
import { thetaFromAnchors, classifyTriple, digitToPattern } from './tonemap.js';

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
/** encoded.tones 생략 시 2톤 메인(encodeY.js 기본값과 정합). */
function resolveTones(encoded) {
  const { tones } = encoded;
  if (tones === undefined) return 2;
  if (tones !== 2 && tones !== 3) {
    throw new RangeError(`encoded.tones 는 2 또는 3 이어야 한다: ${tones}`);
  }
  return tones;
}

/** 결정적 median — 정렬 기반(Math.random 미사용). 빈 배열은 NaN. */
function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

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
 * 레퍼런스 셀 digit 의 "기지 레벨" 인덱스(0..2, levels 배열 인덱스) — tones 로 갈린다.
 * tones===2: digitToPattern 의 밝음/어두움 비트 → levels[2]/levels[0] (U17: 2톤은
 * levels[0]/[2] 만 쓴다 — mid 레벨은 등장하지 않는다). tones===3: digitToRanks 의
 * 순위 그대로 → levels[rank] (기존 3톤 경로, 3레벨 전부 등장할 수 있다).
 * @param {number} digit @param {'T'|'L'|'R'} face @param {2|3} tones
 * @returns {0|1|2}
 */
function knownLevelIndex(digit, face, tones) {
  return tones === 2 ? (digitToPattern(digit)[face] ? 2 : 0) : digitToRanks(digit)[face];
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
  const tones = resolveTones(encoded);
  const yLevels = resolveLevels(scene, options).map((rgb) => relativeLuminance(rgb));

  const gains = {};
  const excluded = {};
  const observations = {};

  for (const face of YFACES) {
    const pairs = [];
    for (const group of referenceGroups(n, tones)) {
      for (const cell of group.cells) {
        const entry = cellDigits.get(`${cell.i},${cell.j}`);
        // 방어적 가드 — 레퍼런스 좌표는 placementY.js 가 이미 로드 시점에
        // 자기검증했으므로 정상 경로에서는 항상 role==='reference' 여야 한다.
        if (!entry || entry.role !== 'reference') continue;
        const yKnown = yLevels[knownLevelIndex(entry.digit, face, tones)];
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
  const tones = resolveTones(encoded);
  const epsilon = options.epsilon === undefined ? EPSILON_FIT : options.epsilon;
  const yLevels = resolveLevels(scene, options).map((rgb) => relativeLuminance(rgb));

  const residuals = [];
  const unfittableFaces = [];
  for (const face of YFACES) {
    const g = gains[face];
    // 관측을 재사용할 수 있으면(estimateFaceGains 산출물) 재측정을 피한다.
    const pairs = (options.observations && options.observations[face])
      || (() => {
        const out = [];
        for (const group of referenceGroups(n, tones)) {
          for (const cell of group.cells) {
            const entry = cellDigits.get(`${cell.i},${cell.j}`);
            if (!entry || entry.role !== 'reference') continue;
            out.push({
              i: cell.i,
              j: cell.j,
              yKnown: yLevels[knownLevelIndex(entry.digit, face, tones)],
              yObs: measureModuleMedian(raster, scene, face, cell.i, cell.j),
            });
          }
        }
        return out;
      })();

    let fittedCount = 0;
    for (const p of pairs) {
      if (!(p.yObs > 0) || !(p.yKnown > 0)) continue; // 클램프 정책과 동일하게 제외
      if (!Number.isFinite(g) || g <= 0) continue; // 게인 무효 면 — 아래 unfittable 로 잡는다
      const residual = Math.abs(p.yObs - g * p.yKnown);
      residuals.push({ face, i: p.i, j: p.j, residual });
      fittedCount += 1;
    }
    // 게인 추정 실패(NaN/비양수) 또는 유효 쌍 0건인 면은 잔차 게이트가 공허 통과하면
    // 안 된다 — 검증 라운드 지적: "별도 게이트" 주석만 있고 실게이트가 없었다.
    if (fittedCount === 0) unfittableFaces.push(face);
  }

  const maxResidual = residuals.length === 0
    ? 0
    : residuals.reduce((acc, r) => (r.residual > acc ? r.residual : acc), 0);

  return {
    residuals,
    maxResidual,
    epsilon,
    unfittableFaces,
    ok: maxResidual <= epsilon && unfittableFaces.length === 0,
  };
}

/**
 * U14 — 면별 임계 θ_f 추정(2톤 전용). 레퍼런스 4조(tones=2 → digit [0,1,2], 조당
 * 면마다 밝음 1·어두움 2 — D9) 를 순회해, 면별로 "정규화 후 관측"을
 * digitToPattern(digit)[face] 비트(1=밝음, 0=어두움)로 나눈다 — 어두운 앵커
 * 관측들의 median 을 obsLo, 밝은 앵커 관측들의 median 을 obsHi 로 삼고
 * `thetaFromAnchors(obsLo, obsHi)` 에 넣는다("D2 필드 정규화 후 앵커 적합치"의
 * median 근사 — 이 코드베이스는 면내 균일 렌더 계약이라 공간 성분이 없으므로
 * median 이 곧 적합치다). **digitToRanks(3톤 순위)가 아니라 digitToPattern(2톤
 * 비트)로 앵커를 가른다** — knownLevelIndex 와 동일 계약.
 * @param {object} raster
 * @param {object} scene
 * @param {{n:number, cellDigits: Map<string,{digit:number, role:string}>}} encoded
 * @param {{T:number,L:number,R:number}} gains estimateFaceGains 의 gains
 * @returns {{theta: {T:number,L:number,R:number}, anchors: {T:object,L:object,R:object}}}
 */
export function estimateFaceThetas(raster, scene, encoded, gains) {
  const { n, cellDigits } = encoded;
  const tones = resolveTones(encoded);

  const theta = {};
  const anchors = {};
  for (const face of YFACES) {
    const lows = [];
    const highs = [];
    for (const group of referenceGroups(n, tones)) {
      for (const cell of group.cells) {
        const entry = cellDigits.get(`${cell.i},${cell.j}`);
        if (!entry || entry.role !== 'reference') continue;
        const bright = digitToPattern(entry.digit)[face];
        const yObs = measureModuleMedian(raster, scene, face, cell.i, cell.j);
        const g = gains[face];
        const normalized = Number.isFinite(g) && g > 0 ? yObs / g : yObs;
        if (bright) highs.push(normalized);
        else lows.push(normalized);
      }
    }
    const obsLo = median(lows);
    const obsHi = median(highs);
    theta[face] = thetaFromAnchors(obsLo, obsHi);
    anchors[face] = { obsLo, obsHi, lows, highs };
  }
  return { theta, anchors };
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
 * 전 역할)에 대해 게인 정규화 후 digit 복원 일치를 잰다. `encoded.tones` 로 분기
 * (기본 2, 2톤 메인):
 *
 *   tones===2: 면별 θ_f(U14 등급 iii, thetaFromAnchors) 임계 분류(classifyTriple).
 *     불법 트리플(전부-밝음/전부-어두움)은 mismatch 가 아니라 `erasures` 로 간다
 *     (자기표식 소거 후보, U18). minDeltaY 대응물은 `logMargin` — 전 모듈 중
 *     |log(정규화값) − log(θ_f)| 의 최솟값(로그 도메인 마진, θ_f 로부터 관측이
 *     얼마나 떨어져 있는가).
 *   tones===3: 기존 3면 순위 정렬(recoverDigitY) 경로 — minDeltaY 그대로, erasures
 *     는 항상 빈 배열, logMargin 은 NaN(해당 없음).
 *
 * @param {object} raster rasterize() 산출물 (pixelsPerUnit 포함)
 * @param {object} scene buildScene()류 산출물 (layout 을 쓴다)
 * @param {{n:number, cellDigits: Map<string, {digit:number, role:string}>, tones?: 2|3}} encoded
 * @param {{levels?: {r,g,b}[], preset?: string, epsilon?: number}} [options]
 * @returns {{total:number, matched:number, mismatches:Array, erasures:Array, minDeltaY:number, logMargin:number, theta:object|null, gains:object, residualGate:object, ok:boolean}}
 */
export function verifyRasterY(raster, scene, encoded, options = {}) {
  const tones = resolveTones(encoded);
  const { gains, excluded, observations } = estimateFaceGains(raster, scene, encoded, options);
  const residualGate = fitResiduals(raster, scene, encoded, gains, { ...options, observations });

  let total = 0;
  let matched = 0;
  let minDeltaY = Infinity; // 3톤 전용(§14 승계, tones===2 에서는 NaN 으로 보고).
  let logMargin = Infinity; // 2톤 전용(U14, tones===3 에서는 NaN 으로 보고).
  const mismatches = [];
  const erasures = [];

  const theta = tones === 2 ? estimateFaceThetas(raster, scene, encoded, gains).theta : null;

  for (const [cellKey, { digit: expected, role }] of encoded.cellDigits) {
    const [i, j] = cellKey.split(',').map(Number);
    const normalized = {};
    for (const face of YFACES) {
      const yObs = measureModuleMedian(raster, scene, face, i, j);
      const g = gains[face];
      normalized[face] = Number.isFinite(g) && g > 0 ? yObs / g : yObs;
    }

    total += 1;

    if (tones === 2) {
      for (const face of YFACES) {
        if (normalized[face] > 0 && theta[face] > 0) {
          const margin = Math.abs(Math.log(normalized[face]) - Math.log(theta[face]));
          if (margin < logMargin) logMargin = margin;
        }
      }
      const { digit: recovered, illegal } = classifyTriple(normalized, theta);
      if (illegal) {
        erasures.push({ i, j, role, expected, normalized });
      } else if (recovered === expected) {
        matched += 1;
      } else {
        mismatches.push({ i, j, role, expected, recovered, normalized });
      }
      continue;
    }

    // 3톤 경로 — 무변경.
    const recovered = recoverDigitY(normalized);
    const sorted = YFACES.map((f) => normalized[f]).sort((a, b) => a - b);
    const delta = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
    if (delta < minDeltaY) minDeltaY = delta;
    if (recovered === expected) {
      matched += 1;
    } else {
      mismatches.push({ i, j, role, expected, recovered, normalized });
    }
  }

  const ok = tones === 2
    ? mismatches.length === 0 && erasures.length === 0 && residualGate.ok
    : mismatches.length === 0 && minDeltaY >= DELTA_MIN_CONTRACT && residualGate.ok;

  return {
    total,
    matched,
    mismatches,
    erasures,
    minDeltaY: tones === 3 ? minDeltaY : NaN,
    logMargin: tones === 2 ? logMargin : NaN,
    theta,
    gains,
    gainsExcluded: excluded,
    residualGate,
    ok,
  };
}
