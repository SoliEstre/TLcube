/**
 * maskSelectY.js — 마스크 후보 선택 (렌더-스캔 페널티 최소).
 *
 * ── 왜 별 모듈인가 ───────────────────────────────────────────────────────────
 *
 * 채점 «자» 는 **로케이터 모듈 자신**이다 — `claude-mimic-rate.md` §0 계약 그대로,
 * 검출 산술을 복제하지 않고 `src/decoder/cellsurface-block-detect.js` 에서 import 한다.
 * 그런데 `encodeY.js` 는 생성기 단일 HTML 번들의 위상 정렬에서 `sceneY`·`raster` 보다
 * **앞**에 등록된다(tools/build-single.mjs MODULE_ORDER). 인코더가 직접 렌더러·디코더를
 * import 하면 그 순서가 깨지고, 생성기 번들에 디코더 전체가 딸려 들어간다.
 *
 * 그래서 선택기를 **인코더 위의 얇은 층**으로 분리했다: 이 모듈이 후보를 인코드·렌더·
 * 스캔해 index 를 정하고, 그 index 를 `encodeY(..., { maskIndex })` 로 되먹인다.
 * 인코더의 계약(같은 입력 → 같은 출력)은 그대로고, 선택은 결정적이다.
 *
 * ── 페널티 공식 (설계 정본 `claude-mimic-rate.md` §5.3) ─────────────────────
 *
 *   maskPenalty = W_clust·|mimic 클러스터|
 *               + W_near ·|near 코어|
 *               + W_deep ·|deep 코어|
 *               − W_true ·|진짜 클러스터|
 *
 * 거리 분류(§0): 가장 가까운 로케이터 셀 중심까지 d(셀 단위) — d ≤ 1.0 진짜 ·
 * 1.0 < d ≤ 2.5 near · d > 2.5 deep.
 *
 * **W_true 항은 뺄 수 없다** — §4.2 실측에서 near mimic 을 죽이는 변경이 진짜 앵커를
 * 같이 죽였다(light-N8: near 검증 −46.5 %, 진짜 검증 −16.4 %). 한쪽만 재면 그런
 * «개선» 을 고르게 된다.
 */

import { encodeY } from './encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from './sceneY.js';
import { rasterize } from './raster.js';
import { moduleCenter, YFACES } from './ygrid.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from './luminance.js';
import { toRelativeLuminance } from './decoder/luma.js';
import { downsampleLumaForSeed, otsuThreshold } from './decoder/finder-seed.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS,
  UNVERIFIED_CS_BLOCK_LOCATOR,
} from './decoder/cellsurface-block-detect.js';
import { MASK_COUNT } from './mask.js';
import { locatorCellsCellSurfaceFinal, isCellSurfaceFinalId } from './cellSurfaceFinal.js';

const { scanConcentricCores, clusterCores } = CS_BLOCK_LOCATOR_INTERNALS;

/** 거리 임계 (셀 단위) — 설계 정본 §0. */
export const TRUE_ANCHOR_CELLS = 1.0;
export const NEAR_MIMIC_CELLS = 2.5;

/**
 * 가중치 — **잠정(UNVERIFIED)**. 유도는 측정에서만 한다:
 *
 *  · `clust` = 1 (주 항). §3 에서 코어→클러스터 통과율이 세 계급 모두 같으므로 코어는
 *    클러스터의 상수배 대리일 뿐인데, 클러스터가 분산이 작아(±3\~5 %) 채점이 안정적이다.
 *  · `near`/`deep` = 0.01. 같은 §3 의 통과율이 8\~11 % 라 코어 수 ≈ 10 × 클러스터 수다.
 *    0.01 을 주면 코어 항의 기여가 클러스터 항의 대략 1/10 — «보조 항» 이라는 뜻이 수치로
 *    성립한다. near 를 deep 과 같게 두는 이유: 어느 쪽도 분리대로는 못 줄인다는 §7.1
 *    결론상 마스크가 손댈 수 있는 유일한 지렛대라서 차등할 근거가 측정에 없다.
 *  · `true` = 10. mimic 클러스터는 프레임당 90\~760개로 흔하고 간접 비용(예산 잠식)만
 *    내지만, 진짜 클러스터는 30\~66개뿐이고 그 자체가 예산이다(§3.1). «진짜 1개 ≈
 *    mimic 10개» 로 잡으면 진짜를 죽이는 후보가 mimic 감소로 이길 수 없다.
 *
 * 호출자가 통째로 갈아끼울 수 있다 — 재측정으로 갱신하라는 뜻이다.
 */
export const MASK_PENALTY_WEIGHTS = Object.freeze({
  clust: 1,
  near: 0.01,
  deep: 0.01,
  true: 10,
});

/** 채점 렌더 규약 — 정본 코퍼스(§1)의 주축과 같다. cell_px 12 · supersample 2 · margin 4. */
export const SCORING_RENDER = Object.freeze({
  pixelsPerUnit: 12,
  supersample: 2,
  margin: 4,
  preset: DEFAULT_PRESET,
});

function scoringPalette(presetName) {
  const preset = getPreset(presetName);
  return Object.freeze({
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    faceGains: DEFAULT_FACE_GAINS,
  });
}

/**
 * 로케이터 셀 중심을 **축소 이미지 좌표**로 투영한다. 레이아웃 정본에서만 유도한다
 * (손 좌표표 없음) — 세 면 T/L/R 전부.
 */
function anchorPointsReduced(scene, n, layoutId, pixelsPerUnit, factor) {
  const points = [];
  for (const cell of locatorCellsCellSurfaceFinal(n, layoutId)) {
    for (const face of YFACES) {
      const centre = moduleCenter(face, cell.i, cell.j, scene.layout);
      points.push({
        x: (centre.x * pixelsPerUnit) / factor,
        y: (centre.y * pixelsPerUnit) / factor,
      });
    }
  }
  return points;
}

/** 셀 피치(축소 이미지 픽셀) — 같은 면 (0,0)↔(1,0) 중심 거리. */
function cellPitchReduced(scene, pixelsPerUnit, factor) {
  const a = moduleCenter('T', 0, 0, scene.layout);
  const b = moduleCenter('T', 1, 0, scene.layout);
  const dx = (b.x - a.x) * pixelsPerUnit / factor;
  const dy = (b.y - a.y) * pixelsPerUnit / factor;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestCellDistance(point, anchors, pitch) {
  let best = Infinity;
  for (const anchor of anchors) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best) / pitch;
}

/**
 * 한 후보의 페널티를 잰다. 렌더 1회 + 코어 스캔·클러스터 1회.
 * @returns {{penalty:number, trueCores:number, nearCores:number, deepCores:number,
 *   trueClusters:number, mimicClusters:number, cores:number, clusters:number, ms:number}}
 */
export function scoreMaskCandidate(encoded, options = {}) {
  const started = Date.now();
  const render = { ...SCORING_RENDER, ...(options.render || {}) };
  const weights = { ...MASK_PENALTY_WEIGHTS, ...(options.weights || {}) };
  const scene = buildSceneY(encoded, {
    palette: scoringPalette(render.preset),
    margin: render.margin,
  });
  const raster = rasterize(scene, {
    pixelsPerUnit: render.pixelsPerUnit,
    supersample: render.supersample,
  });
  const luma = toRelativeLuminance(raster);
  const cfg = { ...UNVERIFIED_CS_BLOCK_LOCATOR, ...(options.calibration || {}) };
  const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
  const cut = otsuThreshold(reduced.luma);
  const cores = scanConcentricCores(reduced.luma, cut, cfg);
  const clusters = clusterCores(cores, cfg);

  const anchors = anchorPointsReduced(
    scene, encoded.n, encoded.cellSurfaceLayout, render.pixelsPerUnit, reduced.factor,
  );
  const pitch = cellPitchReduced(scene, render.pixelsPerUnit, reduced.factor);

  let trueCores = 0;
  let nearCores = 0;
  let deepCores = 0;
  for (const core of cores) {
    const d = nearestCellDistance(core, anchors, pitch);
    if (d <= TRUE_ANCHOR_CELLS) trueCores += 1;
    else if (d <= NEAR_MIMIC_CELLS) nearCores += 1;
    else deepCores += 1;
  }
  let trueClusters = 0;
  let mimicClusters = 0;
  for (const cluster of clusters) {
    const d = nearestCellDistance(cluster, anchors, pitch);
    if (d <= TRUE_ANCHOR_CELLS) trueClusters += 1;
    else mimicClusters += 1;
  }

  const penalty = weights.clust * mimicClusters
    + weights.near * nearCores
    + weights.deep * deepCores
    - weights.true * trueClusters;

  return {
    penalty,
    trueCores,
    nearCores,
    deepCores,
    trueClusters,
    mimicClusters,
    cores: cores.length,
    clusters: clusters.length,
    ms: Date.now() - started,
  };
}

/**
 * 후보 전수 채점 → 최소 페널티 index. 동률이면 **가장 낮은 index** (결정성).
 *
 * @param {string} text
 * @param {object} encodeOptions `encodeY` 옵션 — `cellSurfaceLayout` 필수(최종 라인업).
 * @param {{weights?:object, render?:object, calibration?:object, candidates?:number[]}} [options]
 * @returns {{maskIndex:number, scores:object[], ms:number}}
 */
export function selectMaskIndexY(text, encodeOptions = {}, options = {}) {
  const layoutId = encodeOptions.cellSurfaceLayout;
  if (!isCellSurfaceFinalId(layoutId)) {
    throw new RangeError(
      '마스크 선택은 신세대 셀 표면(포맷 v2) 전용이다: ' + layoutId,
    );
  }
  const started = Date.now();
  const candidates = options.candidates
    || Array.from({ length: MASK_COUNT }, (unused, index) => index);
  const scores = [];
  let best = null;
  for (const maskIndex of candidates) {
    const encoded = encodeY(text, { ...encodeOptions, maskIndex });
    const score = scoreMaskCandidate(encoded, options);
    scores.push({ maskIndex, ...score });
    if (best === null || score.penalty < best.penalty) {
      best = { maskIndex, penalty: score.penalty };
    }
  }
  return { maskIndex: best.maskIndex, scores, ms: Date.now() - started };
}

/**
 * 선택까지 포함한 인코딩 진입점. `encodeY` 와 같은 결과 객체를 돌려주며
 * `maskSelection` 진단이 붙는다. 같은 입력 → 같은 마스크 → 같은 출력.
 *
 * @param {string} text
 * @param {object} encodeOptions
 * @param {object} [options] 페널티 가중치·채점 렌더 override
 */
export function encodeYWithMaskSelection(text, encodeOptions = {}, options = {}) {
  const selection = selectMaskIndexY(text, encodeOptions, options);
  const encoded = encodeY(text, { ...encodeOptions, maskIndex: selection.maskIndex });
  return { ...encoded, maskSelection: selection };
}
