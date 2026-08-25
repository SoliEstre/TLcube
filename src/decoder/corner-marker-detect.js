/**
 * corner-marker-detect.js — Type O 코너 마커(O-CM) 검증 · 방향 확정 · 호모그래피 보강.
 *
 * 설계 전제 (markerO.js 헤더가 근거):
 *   · 마커는 **중앙 불스아이를 대체하지 않는다.** 불스아이가 준 중심·cellSize 로
 *     만든 기저 H 에서 «예측된 코너 자리» 를 국소 탐색할 뿐이라, `bullseye-detect`
 *     의 제안·검증·SPD 정제 파이프라인을 한 줄도 안 건드린다. 새 전역 제안기를
 *     만들지 않으므로 실사 24/24 기준선에 영향이 없다.
 *   · 마커 셀의 기대값은 **digit(3면 휘도 순위)** 이다. 절대 휘도가 아니라 셀 안의
 *     상대 순서만 보므로 단조 톤 커브·면 게인에 불변이다 — `anchor-detect.js` 가
 *     앵커 1셀에 쓰는 판정을 12셀로 넓힌 것이고, 표본기도 같은 `sampleHexCell` 이다.
 *   · 셀이 `tones: {T,L,R}` (절대 톤 0/1/2)를 실으면 **절대 톤 경로**로 검증한다 —
 *     비-순열 톤(예: {T:0,L:0,R:2})은 순위로 접는 순간 두 면 동률이 `tieEpsilon` 에
 *     걸려 셀 통째로 0점이 되므로 (H2O 정본 21셀 중 9셀이 그렇다), 순위 대신
 *     `orientation-scorer.scoreSampledOrientation` 의 가설별 dark/bright 앵커 →
 *     `classifyTone` 분류를 빌린다. digit 만 있는 셀은 기존 순위 경로 그대로다 —
 *     두 경로는 셀 단위로 갈리고, 순위 경로의 동작은 한 비트도 안 바뀐다.
 *   · 60°/180°/300° 오가설과 변 중점 거울 3종에서 마커 자리로 되돌아오는 셀은
 *     **0** 이다(markerO §1 실측). 즉 그 가설의 마커 예측 자리는 전부 데이터 셀이다.
 *     ⚠ 다만 «그래서 agreement 가 우연값 ≈1/3 로 떨어진다» 고 말하면 **틀린다** —
 *     코너별 국소 탐색(평행이동 × 배율)이 점수가 높은 자리를 적극적으로 찾아내기
 *     때문에 실측값은 훨씬 높다 (O-CM V2 프레임, 2026-08-16 `_oak-bench-r2.mjs` §3b:
 *     9가설 평균 agreement rot60 0.5988 · rot180 0.5895 · rot300 0.6142 · 거울 0.6235,
 *     최고는 rot60 에서 0.8056 으로 **agreement 하한 0.78 을 넘긴다**).
 *     이 클래스를 실제로 죽이는 것은 네 게이트의 **조합**이다 (rot60 은 confirm 이,
 *     rot180·거울은 agreement + alive 가, rot300 은 agreement 가 잘랐다).
 *
 * 산출:
 *   · `verifyCornerMarkers` — 주어진 (H, k) 에서 마커 12셀의 face agreement 와
 *     코너별 국소 오프셋(= 보강된 코너 이미지 점).
 *   · `findOCornerMarkerHypotheses` — (k × 방향 3) 전수 평가 후 통과 가설 목록.
 *     첫 통과에서 멈추지 않는다 (anchor-detect 규약 승계).
 *   · 통과 가설에는 **4점(중심 + 코너 3) DLT 로 재적합한 H** 가 실린다 — 기저 H 가
 *     닮음/아핀이어도 원근을 흡수한다.
 *
 * 결정성: RNG 없음. 국소 탐색은 고정 격자 순회이고 동률은 (점수 desc, |오프셋| asc,
 * dy asc, dx asc) 으로 깬다.
 *
 * 임계값은 전부 [미검증] 합성 실험값이며 `options` 로 덮을 수 있다.
 */

import {
  FRONTEND_FAILURE,
  HOMOGRAPHY_CANONICAL_SPACE,
  assertHomography,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import { axialToPixel } from '../hexgrid.js';
import { digitToRanks } from '../lehmer.js';
import { markerCells, markerTetrads } from '../markerO.js';
import { markerCellsA, markerGroupsA } from '../markerA.js';
import { co2SeatMarkerCellsTurnA, co2SeatMarkerGroupsTurnA } from '../finder-CO2.js';
import { sampleHexCell } from './grid-sample.js';
import { estimateHomography4 } from './homography.js';
import {
  hexKey,
  hexLayoutFrom,
  hexRotationHypotheses,
  scoreSampledOrientation,
} from './orientation-scorer.js';

const FACE_NAMES = Object.freeze(['T', 'L', 'R']);
const ORIENTATIONS = Object.freeze([0, 1, 2]);
const EPSILON = 1e-9;

/** [미검증] 마커 수용 하한 — 12셀 × 3면 = 36 슬롯의 face agreement 비율. */
export const DEFAULT_MARKER_AGREEMENT = 0.78;
/**
 * [미검증] 코너 하나가 «살아 있다» 고 볼 최소 agreement (묶음당 12 슬롯 기준).
 *
 * ⚠ 이것은 «부차 조건» 이 아니라 **독립된 네 번째 게이트**다 — `accepted` 는
 * `corners.every(c => c.alive)` 를 요구하므로, 전체 agreement 가 0.78 을 넘겨도
 * 코너 하나가 0.75 미만이면 기각된다. 실측(2026-08-16, `_oak-bench-r2.mjs`)에서
 * **이 게이트가 유일한 사살자인 케이스가 실재한다**: 레거시 O V3 프레임을
 * rot120 한 뒤 k=6/방향1 가설은 전체 agreement 0.8056 으로 0.78 하한을 통과하고
 * (여유 +0.0256) 반경 게이트도 통과하지만, alive 코너가 2/3 라 여기서 죽는다.
 * 즉 «레거시 O 는 agreement 하한이 자른다» 는 서술은 틀렸다.
 * 회귀 고정: `test/decoder-corner-marker.test.js` — «alive 게이트가 유일한 방벽».
 */
export const DEFAULT_CORNER_AGREEMENT = 0.75;
/** [미검증] 국소 탐색 반경·간격 (셀 단위). */
export const DEFAULT_SEARCH_CELLS = 1;
export const DEFAULT_SEARCH_STEP_CELLS = 0.25;
/**
 * [미검증] 코너 국소 배율 탐색 폭·간격 (상대 배율).
 *
 * 왜 필요한가 — 실측이 정했다. 평행이동만 탐색하면 원근 g=0.0004 까지만 잡고
 * g≥0.0008 에서 통째로 기각됐다. 그 지점에서 코너의 **국소 배율**이 20% 넘게 어긋나
 * tetrad 의 먼 셀이 1셀 가까이 밀리기 때문이다 — 평행이동으로는 원리적으로 못 고친다.
 * (`anchor-detect.js` 가 앵커 1점에서 `cellSizeSearch` 를 넣은 것과 같은 사유다.)
 */
export const DEFAULT_SCALE_SEARCH = 0.24;
export const DEFAULT_SCALE_STEP = 0.06;
/** [미검증] 세 코너 반경비 평균이 1 에서 벗어나도 되는 폭 (k 오가설 차단). */
export const DEFAULT_MEAN_RADIUS_TOLERANCE = 0.12;
/** [미검증] 재적합 H 로 «탐색 없이» 다시 잰 agreement 의 하한 (일관성 확인). */
export const DEFAULT_CONFIRM_AGREEMENT = 0.78;
/** [미검증] 면 순위의 최소 분리 (anchor-detect 와 같은 자). */
export const DEFAULT_TIE_EPSILON = 0.02;
export const DEFAULT_MIN_SAMPLE_COUNT = 3;
export const DEFAULT_SAMPLE_RADIUS_FRACTION = 0.5;

function finitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function multiply(left, right) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let acc = 0;
      for (let i = 0; i < 3; i += 1) acc += left[row * 3 + i] * right[i * 3 + col];
      out[row * 3 + col] = acc;
    }
  }
  return out;
}

function rotationHomography(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float64Array([c, -s, 0, s, c, 0, 0, 0, 1]);
}

function translationHomography(dx, dy) {
  return new Float64Array([1, 0, dx, 0, 1, dy, 0, 0, 1]);
}

function affineHomography(center, cellSize) {
  return new Float64Array([cellSize, 0, center.x, 0, cellSize, center.y, 0, 0, 1]);
}

/** 캐노니컬 공간에서의 등방 배율 (중심 고정) — H 의 오른쪽에 곱한다. */
function scaleHomography(s) {
  return new Float64Array([s, 0, 0, 0, s, 0, 0, 0, 1]);
}

function applyH(H, point) {
  const w = H[6] * point.x + H[7] * point.y + H[8];
  if (!Number.isFinite(w) || Math.abs(w) <= EPSILON) return null;
  const x = (H[0] * point.x + H[1] * point.y + H[2]) / w;
  const y = (H[3] * point.x + H[4] * point.y + H[5]) / w;
  return finitePoint({ x, y }) ? { x, y } : null;
}

function normalizeBullseye(bullseye, options) {
  const source = bullseye && bullseye.ok === true
    ? (bullseye.finder || bullseye.bullseye || bullseye)
    : (bullseye || {});
  const center = source.center || options.center;
  const cellSize = source.cellSize === undefined ? source.cellSizePxAtCenter : source.cellSize;
  if (!finitePoint(center) || !Number.isFinite(cellSize) || cellSize <= 0) return null;
  return {
    center: { x: center.x, y: center.y },
    cellSize,
    baseHomography: source.H || source.homography || source.transform || options.H,
  };
}

function baseHomographyFor(normalized, orientation, options) {
  const supplied = options.H || normalized.baseHomography;
  const base = supplied === undefined
    ? affineHomography(normalized.center, normalized.cellSize)
    : assertHomography(supplied);
  const sign = options.orientationSign === -1 ? -1 : 1;
  return multiply(base, rotationHomography(sign * orientation * (2 * Math.PI / 3)));
}

/** 면 중앙값 3개 → 순위 digit (동률·비유한이면 null). anchor-detect 의 rankStat 동형. */
function rankDigit(faces, tieEpsilon) {
  const values = FACE_NAMES.map((f) => faces[f] && faces[f].median);
  if (values.some((v) => !Number.isFinite(v))) return { digit: null, separation: NaN };
  const order = [0, 1, 2].sort((a, b) => {
    const d = values[a] - values[b];
    return d === 0 ? a - b : d;
  });
  const sorted = order.map((i) => values[i]);
  const separation = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
  if (separation < tieEpsilon) return { digit: null, separation };
  const ranks = {};
  for (let i = 0; i < order.length; i += 1) ranks[FACE_NAMES[order[i]]] = i;
  return { ranks, separation };
}

/** 기대 digit 의 rank 와 관측 rank 를 면 단위로 비교 — 일치 면 수 0..3. */
function faceAgreement(observedRanks, expectedDigit) {
  if (!observedRanks) return 0;
  const want = digitToRanks(expectedDigit);
  let n = 0;
  for (const f of FACE_NAMES) if (observedRanks[f] === want[f]) n += 1;
  return n;
}

function sampleOptionsFrom(options) {
  return {
    discOptions: {
      fraction: Number.isFinite(options.sampleRadiusFraction)
        ? options.sampleRadiusFraction : DEFAULT_SAMPLE_RADIUS_FRACTION,
      fractionOf: 'radius',
    },
    minSampleCount: Number.isInteger(options.minSampleCount)
      ? options.minSampleCount : DEFAULT_MIN_SAMPLE_COUNT,
    tieEpsilon: Number.isFinite(options.tieEpsilon) ? options.tieEpsilon : DEFAULT_TIE_EPSILON,
  };
}

// 절대 톤 갈래의 회전 가설 3상 — 순수·결정적이라 호출마다 재생성할 이유가 없다.
const HEX_ROTATION_HYPOTHESES = hexRotationHypotheses();

function medianOf(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 마커 **전체**의 톤 셀에서 면별 dark/bright 앵커를 한 번 세운다 (F-111).
 *
 * 왜 묶음별이 아닌가 — 절대 톤 분류의 앵커는 «이 프레임에서 무엇이 어둡고 무엇이
 * 밝은가» 라는 **프레임 수준 성질**이다. 그런데 검증은 코너 묶음별로 도니, 톤 셀이
 * 성긴 심볼(CO2: 묶음당 2셀 = 6슬롯)에서는 (면,톤) 조합당 표본이 1\~2개로 떨어져
 * 중앙값이 잡음이 된다. 실측: 묶음별 49/63 · 전체 6셀(18슬롯) 풀링 **18/18 → 63/63**.
 *
 * ⚠ 기저 H 에서 한 번만 표본한다 — 묶음별 국소 탐색은 **자리**를 찾는 것이고
 * 앵커는 **밝기 수준**이라, 셀 이하 평행이동으로 의미 있게 안 변한다.
 *
 * 톤 셀이 하나도 없으면(A-CM·O-CM 의 digit 기대값) `null` 을 낸다 — 주입이 안
 * 일어나고 종전 경로 그대로다.
 */
function poolToneAnchors(luma, H, tetrads, sampleOpts) {
  const dark = { T: [], L: [], R: [] };
  const bright = { T: [], L: [], R: [] };
  let toneCellCount = 0;
  for (const tetrad of tetrads) {
    for (const cell of tetrad.cells) {
      if (!cell.tones) continue;
      toneCellCount += 1;
      const res = sampleHexCell(
        luma, { H, canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE }, cell.q, cell.r, sampleOpts,
      );
      if (!res.ok) continue;
      for (const face of FACE_NAMES) {
        const value = res[face] && res[face].median;
        if (!Number.isFinite(value)) continue;
        if (cell.tones[face] === 0) dark[face].push(value);
        else if (cell.tones[face] === 2) bright[face].push(value);
      }
    }
  }
  if (toneCellCount === 0) return null;
  const anchors = {};
  for (const face of FACE_NAMES) {
    const d = medianOf(dark[face]);
    const b = medianOf(bright[face]);
    // 한쪽이라도 표본이 없으면 주입하지 않는다 — 반쪽 앵커는 종전 유도보다 나쁘다.
    if (!Number.isFinite(d) || !Number.isFinite(b)) return null;
    anchors[face] = { dark: d, bright: b };
  }
  return anchors;
}

function scoreTetradAt(luma, H, cells, sampleOpts, tieEpsilon, scorerOptions) {
  let agree = 0;
  let sampled = 0;
  const toneCells = [];
  const toneSamples = new Map();
  for (const cell of cells) {
    const result = sampleHexCell(
      luma,
      { H, canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE },
      cell.q,
      cell.r,
      sampleOpts,
    );
    if (cell.tones) {
      // 절대 톤 셀 — 순위로 접지 않는다. 면별 median 만 모아 두고 묶음 단위로 한 번에
      // 분류한다 (dark/bright 앵커가 «같은 묶음의 다른 셀» 에서 서므로 셀 단위 즉시
      // 판정이 원리적으로 불가능하다).
      toneCells.push(cell);
      toneSamples.set(
        hexKey(cell.q, cell.r),
        result.ok ? { T: result.T.median, L: result.L.median, R: result.R.median } : null,
      );
      if (result.ok) sampled += 1;
      continue;
    }
    if (!result.ok) continue;
    sampled += 1;
    const rank = rankDigit({ T: result.T, L: result.L, R: result.R }, tieEpsilon);
    agree += faceAgreement(rank.ranks, cell.digit);
  }
  if (toneCells.length > 0) {
    // 층 분리 — 코너 마커 층은 «위치·방향»(국소 탐색·alive·radius·confirm 게이트)이고,
    // orientation-scorer 에서 빌리는 것은 «절대 톤 분류» 뿐이다. 방향 가설은 이미 상위
    // (findMarkerHypotheses 의 orientation 루프)가 H 에 실어 내려보내므로 여기서는
    // **항등 상(phases[0])의 일치 수만** 읽는다 — 틀린 방향의 H 아래에서는 항등 상
    // 기대 톤이 관측과 어긋나 일치 수가 낮아지고, 그 낮은 agreement 를 마커 층의
    // 게이트가 자른다. rival/margin/enoughSamples 는 이 층의 판정이 아니다: 특히
    // 면별 톤 정족수(minimumSamplesPerTone 8)는 마커 «전체»(예: A-CM 21셀)를 방향
    // 판정기로 쓸 때의 게이트라 묶음(≤7셀) 단위에서는 구조적으로 못 서고, 그것을
    // 여기 게이트로 쓰면 절대 톤 마커가 전부 죽는다 — 게이트 «값» 은 어느 것도 바꾸지
    // 않으며 완화도 아니다 (전체 수준 판정은 scoreSampledOrientation 소비자 몫).
    const scored = scoreSampledOrientation(
      hexLayoutFrom(toneCells),
      HEX_ROTATION_HYPOTHESES,
      (key) => toneSamples.get(key) || null,
      scorerOptions,
    );
    agree += scored.phases[0].matches;
  }
  return { agree, sampled };
}

/** 국소 탐색 오프셋 격자 (셀 단위). 중심 우선, 반경 오름차순 — 결정적. */
function offsetGrid(span, step, cx, cy) {
  if (span === 0 || step <= 0) return [{ dx: cx, dy: cy }];
  const steps = Math.max(1, Math.round(span / step));
  const out = [];
  for (let iy = -steps; iy <= steps; iy += 1) {
    for (let ix = -steps; ix <= steps; ix += 1) {
      out.push({ dx: cx + ix * step, dy: cy + iy * step });
    }
  }
  out.sort((a, b) => {
    const ra = (a.dx - cx) ** 2 + (a.dy - cy) ** 2;
    const rb = (b.dx - cx) ** 2 + (b.dy - cy) ** 2;
    return ra - rb || a.dy - b.dy || a.dx - b.dx;
  });
  return out;
}

/** 배율 후보 — 1 을 먼저, 그 다음 |Δ| 오름차순 (동률은 큰 배율이 먼저). */
function scaleList(options) {
  const span = Number.isFinite(options.scaleSearch) ? Math.max(0, options.scaleSearch)
    : DEFAULT_SCALE_SEARCH;
  const step = Number.isFinite(options.scaleStep) && options.scaleStep > 0
    ? options.scaleStep : DEFAULT_SCALE_STEP;
  if (span === 0) return [1];
  const steps = Math.round(span / step);
  const out = [1];
  for (let i = 1; i <= steps; i += 1) out.push(1 + i * step, 1 - i * step);
  return out;
}

/**
 * 주어진 (H, k) 에서 코너 마커 12셀을 검증한다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {{H: ArrayLike<number>, k: number, cellSize: number}} hypothesis
 * @param {object} [options]
 * @returns {{
 *   agreement:number, slots:number, agree:number,
 *   corners:{corner:number, agree:number, slots:number, offset:{dx:number,dy:number},
 *            imagePoint:{x:number,y:number}|null, canonical:{x:number,y:number}}[],
 *   accepted:boolean
 * }}
 */
export function verifyCornerMarkers(luma, hypothesis, options = {}) {
  assertLumaField(luma);
  const H = assertHomography(hypothesis.H);
  const { k } = hypothesis;
  const cellSize = Number.isFinite(hypothesis.cellSize) && hypothesis.cellSize > 0
    ? hypothesis.cellSize : 1;
  const tieEpsilon = Number.isFinite(options.tieEpsilon)
    ? options.tieEpsilon : DEFAULT_TIE_EPSILON;
  const sampleOpts = sampleOptionsFrom(options);
  const span = Number.isFinite(options.searchCells) ? Math.max(0, options.searchCells)
    : DEFAULT_SEARCH_CELLS;
  const fineStep = Number.isFinite(options.searchStepCells) && options.searchStepCells > 0
    ? options.searchStepCells : DEFAULT_SEARCH_STEP_CELLS;
  const coarseStep = fineStep * 2;
  const scales = scaleList(options);
  const cornerMin = Number.isFinite(options.minCornerAgreement)
    ? options.minCornerAgreement : DEFAULT_CORNER_AGREEMENT;
  const minAgreement = Number.isFinite(options.minAgreement)
    ? options.minAgreement : DEFAULT_MARKER_AGREEMENT;

  // 마커 묶음 공급자 — O 는 tetrad(기준점 = 코너 앵커 A), A 는 링(기준점 = 링 중심 Z).
  // 검증·탐색·재적합 논리는 두 타입이 **완전히 같다**; 다른 것은 좌표 목록뿐이다.
  const tetrads = options.groups || markerTetrads(k);
  // ⭐ **톤 앵커는 마커 전체에서 한 번 세운다 (2026-08-25, F-111)** — 묶음별로
  // 세우면 CO2 처럼 톤 셀이 성긴 심볼에서 (면,톤) 표본이 1\~2개로 떨어져 중앙값이
  // 잡음이 된다 (실측: 묶음별 49/63 · 풀링 18/18 → 63/63).
  // 「위치·방향은 묶음별 · 절대 톤 분류는 프레임 수준」 이라는 층 분리를 한 겹 더 민 것이고,
  // 게이트 값은 아무것도 안 바꾼다. 톤 셀이 없는 마커(A-CM·O-CM 의 digit 기대값)면
  // 앵커가 null 이라 주입이 안 일어나고 **종전 경로 그대로**다.
  const pooledToneAnchors = poolToneAnchors(luma, H, tetrads, sampleOpts);
  const scorerOptions = pooledToneAnchors
    ? { ...options, toneAnchors: pooledToneAnchors } : options;
  const corners = [];
  let totalAgree = 0;
  let totalSlots = 0;

  for (const tetrad of tetrads) {
    const anchorLabel = tetrad.anchorLabel || 'A';
    const anchorCell = tetrad.cells.find((c) => c.label === anchorLabel);
    const canonical = axialToPixel(anchorCell.q, anchorCell.r);
    // 2단 탐색 — ① 전 배율 × 성긴 오프셋 ② 이긴 배율의 이웃 3개 × 촘촘한 오프셋.
    // 한 번에 (배율 × 촘촘한 오프셋) 전수를 도는 것보다 표본 수가 한 자릿수 적고,
    // 순회 순서가 고정이라 결정성은 그대로다.
    const evaluate = (scale, offset) => {
      const shifted = multiply(
        translationHomography(offset.dx * cellSize, offset.dy * cellSize),
        multiply(H, scaleHomography(scale)),
      );
      const scored = scoreTetradAt(luma, shifted, tetrad.cells, sampleOpts, tieEpsilon, scorerOptions);
      return { ...scored, offset, scale, shifted };
    };
    let best = null;
    const better = (candidate) => {
      if (best === null || candidate.agree > best.agree) best = candidate;
    };
    for (const scale of scales) {
      for (const offset of offsetGrid(span, coarseStep, 0, 0)) better(evaluate(scale, offset));
    }
    const scaleIndex = scales.indexOf(best.scale);
    const neighbourScales = [best.scale];
    if (scaleIndex >= 0) {
      for (const s of scales) {
        if (Math.abs(s - best.scale) <= (scales.length > 1 ? Math.abs(scales[1] - 1) : 0) + EPSILON
          && s !== best.scale) neighbourScales.push(s);
      }
    }
    const coarseBest = best.offset;
    for (const scale of neighbourScales) {
      for (const offset of offsetGrid(coarseStep, fineStep, coarseBest.dx, coarseBest.dy)) {
        better(evaluate(scale, offset));
      }
    }
    const slots = tetrad.cells.length * 3;
    const imagePoint = best ? applyH(best.shifted, canonical) : null;
    corners.push({
      corner: tetrad.corner,
      agree: best ? best.agree : 0,
      slots,
      sampled: best ? best.sampled : 0,
      offset: best ? best.offset : { dx: 0, dy: 0 },
      scale: best ? best.scale : 1,
      imagePoint,
      canonical,
      alive: best ? best.agree / slots >= cornerMin : false,
    });
    totalAgree += best ? best.agree : 0;
    totalSlots += slots;
  }

  const agreement = totalSlots === 0 ? 0 : totalAgree / totalSlots;

  // 반경 정합 게이트 — «코너 적합이 중심의 스케일과 모순되면 안 된다».
  //
  // 왜 필요한가 (실측이 넣게 했다): 코너별 배율 탐색을 켠 순간 **k 를 틀린 가설이
  // 통과했다** (k=8 프레임에서 k=6 가설 agreement 0.944). 배율 자유도가 6→8 의
  // 거리 차이를 흡수해 버리기 때문이다. 원근에서는 한 코너가 커지면 반대쪽이
  // 작아져 **세 코너 반경비의 평균은 1 근처에 남는** 반면, k 를 틀리면 세 코너가
  // 같은 배수로 어긋나 평균이 그 배수로 간다 — 그래서 «평균» 을 잰다.
  const center = options.center || (options.bullseyeCenter);
  let meanRadiusRatio = 1;
  if (center && finitePoint(center)) {
    const ratios = [];
    for (const corner of corners) {
      if (!corner.imagePoint) continue;
      const expected = Math.hypot(corner.canonical.x, corner.canonical.y) * cellSize;
      if (!(expected > 0)) continue;
      ratios.push(Math.hypot(corner.imagePoint.x - center.x, corner.imagePoint.y - center.y) / expected);
    }
    meanRadiusRatio = ratios.length === 0
      ? 0 : ratios.reduce((s, v) => s + v, 0) / ratios.length;
  }
  const radiusTolerance = Number.isFinite(options.meanRadiusTolerance)
    ? options.meanRadiusTolerance : DEFAULT_MEAN_RADIUS_TOLERANCE;
  const radiusOk = Math.abs(meanRadiusRatio - 1) <= radiusTolerance;

  return {
    k,
    agree: totalAgree,
    slots: totalSlots,
    agreement,
    corners,
    meanRadiusRatio,
    radiusOk,
    aliveCorners: corners.filter((c) => c.alive).length,
    accepted: agreement >= minAgreement && corners.every((c) => c.alive) && radiusOk,
  };
}

/**
 * 코너 3점 + 불스아이 중심으로 H 를 4점 DLT 재적합한다.
 * 실패하면 null 을 돌려주고 호출자는 기저 H 를 계속 쓴다 (조용한 열화 금지 —
 * 재적합 성패는 결과 객체에 실린다).
 */
export function refineHomographyFromCorners(centerImagePoint, verification) {
  const canonicalPoints = [{ x: 0, y: 0 }];
  const imagePoints = [centerImagePoint];
  for (const corner of verification.corners) {
    if (!corner.imagePoint) return null;
    canonicalPoints.push(corner.canonical);
    imagePoints.push(corner.imagePoint);
  }
  if (canonicalPoints.length !== 4) return null;
  try {
    return estimateHomography4(canonicalPoints, imagePoints);
  } catch (error) {
    return null;
  }
}

/**
 * Type O 코너 마커 가설 전수 평가 — (k, 방향) 전 조합. 첫 통과에서 멈추지 않는다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {import('./contracts.js').BullseyeCandidate} bullseye
 * @param {number[]|number} ks
 * @param {object} [options]
 */
/**
 * @param {{turn?: boolean, groups: (k:number)=>object[], cells: (k:number)=>object[]}[]} variants
 *   배치 방향 변형 목록. hex 는 1개(정립), tri 는 2개(정립 + 턴A 역삼각)다.
 */
function findMarkerHypotheses(luma, bullseye, ks, options, family, variants) {
  if (luma === null || luma === undefined) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { message: 'luma 가 없다' });
  }
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { message: error.message });
  }
  const normalized = normalizeBullseye(bullseye, options);
  if (!normalized) {
    return fail(FRONTEND_FAILURE.NO_FINDER, { message: '불스아이 중심 또는 cellSize 가 없다' });
  }
  const list = Array.isArray(ks) ? ks : [ks];
  const kList = Array.from(new Set(list.filter((v) => Number.isInteger(v) && v >= 4)))
    .sort((a, b) => a - b);
  if (kList.length === 0) {
    return fail(FRONTEND_FAILURE.NO_ANCHORS, { message: '검사할 양의 k 목록이 없다' });
  }

  const hypotheses = [];
  const rejected = [];
  for (const k of kList) {
    // 변형 = «배치 방향» 목록. tri 는 정삼각 + 역삼각(턴A) 둘이고 hex 는 하나다.
    // 앵커 검출기(anchor-detect §anchorFactory)가 이미 쓰는 관용구를 그대로 따른다.
    for (const variant of variants) {
    let groups;
    try {
      variant.cells(k);
      groups = variant.groups(k);
    } catch (error) {
      rejected.push({ k, turn: variant.turn === true, reason: error.message });
      continue;
    }
    for (const orientation of ORIENTATIONS) {
      const H = baseHomographyFor(normalized, orientation, options);
      const verification = verifyCornerMarkers(
        luma,
        { H, k, cellSize: normalized.cellSize },
        { ...options, center: normalized.center, groups },
      );
      const refined = verification.accepted
        ? refineHomographyFromCorners(normalized.center, verification)
        : null;
      // 일관성 확인 — 재적합 H 로 **탐색 없이** 다시 잰다. 코너별 국소 탐색이
      // 서로 무관한 자리로 흩어져 얻은 점수라면 하나의 H 로는 재현되지 않는다.
      const confirm = refined
        ? verifyCornerMarkers(luma, { H: refined, k, cellSize: normalized.cellSize }, {
          ...options,
          center: normalized.center,
          groups,
          searchCells: 0,
          scaleSearch: 0,
        })
        : null;
      const minConfirm = Number.isFinite(options.minConfirmAgreement)
        ? options.minConfirmAgreement : DEFAULT_CONFIRM_AGREEMENT;
      const confirmed = confirm !== null && confirm.agreement >= minConfirm;
      const record = {
        family,
        k,
        orientation,
        turn: variant.turn === true,
        H,
        refinedH: refined,
        canonicalSpace: HOMOGRAPHY_CANONICAL_SPACE,
        agreement: verification.agreement,
        agree: verification.agree,
        slots: verification.slots,
        corners: verification.corners,
        meanRadiusRatio: verification.meanRadiusRatio,
        confirmAgreement: confirm ? confirm.agreement : 0,
        hypothesisId: family + '-' + k + '-' + orientation + (variant.turn === true ? '-turn' : ''),
      };
      if (verification.accepted && confirmed) hypotheses.push(record);
      else {
        rejected.push({
          hypothesisId: record.hypothesisId,
          k,
          orientation,
          agreement: verification.agreement,
          confirmAgreement: confirm ? confirm.agreement : 0,
          meanRadiusRatio: verification.meanRadiusRatio,
          radiusOk: verification.radiusOk,
          aliveCorners: verification.aliveCorners,
        });
      }
    }
    }
  }

  // 정립을 턴보다 앞에 둔다 — 기존 A-CM 프레임의 후보 순서를 바꾸지 않으려는 선택이다.
  hypotheses.sort((a, b) => a.k - b.k
    || (a.turn === true ? 1 : 0) - (b.turn === true ? 1 : 0)
    || a.orientation - b.orientation);
  const diagnostics = {
    family,
    testedKs: kList,
    testedOrientations: ORIENTATIONS.slice(),
    // ⚠ 변형 수를 곱한다 (2026-08-25, grok 검수 적발). 이 식은 hex(변형 1) 시절
    // 그대로였고 tri 는 변형 2 라, k 하나만 넣어도 실제로는 6 가설을 평가하는데
    // 값은 3 을 냈다 — **진단이 거짓말을 하면 다음 사람이 rejected 목록과 이 수를
    // 대조하다 엉뚱한 결론에 간다.**
    evaluatedCount: kList.length * ORIENTATIONS.length * variants.length,
    rejected,
  };
  if (hypotheses.length === 0) {
    return fail(FRONTEND_FAILURE.NO_ANCHORS, { ...diagnostics, hypotheses: [] });
  }
  return ok({ hypotheses, diagnostics });
}

/**
 * Type O 코너 마커 가설 전수 평가 — (k, 방향) 전 조합. 첫 통과에서 멈추지 않는다.
 *
 * @param {import('./contracts.js').LumaField} luma
 * @param {import('./contracts.js').BullseyeCandidate} bullseye
 * @param {number[]|number} ks
 * @param {object} [options]
 */
export function findOCornerMarkerHypotheses(luma, bullseye, ks, options = {}) {
  // hex 는 턴 개념이 없다 — 변형 하나.
  return findMarkerHypotheses(
    luma, bullseye, ks, options, 'hex-marker',
    [{ turn: false, groups: markerTetrads, cells: markerCells }],
  );
}

/**
 * Type A 코너 마커 가설 전수 평가. 묶음의 기준점은 **링 중심**(라벨 Z)이다 —
 * 꼭짓점 앵커가 아니라 마커 자신의 중심이라, A 의 꼭짓점 앵커 계약을 전혀 안 건드린다.
 */
export function findACornerMarkerHypotheses(luma, bullseye, ks, options = {}) {
  // 정립(A-CM) + 역삼각(V-CM, 턴A). 좌표 사상이지 H 회전이 **아니다** — 턴A 는
  // «배치만 180° 회전 · 셀은 정립» 이라 H 를 돌리면 면 톤·digit 이 함께 돌아간다.
  return findMarkerHypotheses(
    luma, bullseye, ks, options, 'tri-marker',
    [
      { turn: false, groups: markerGroupsA, cells: markerCellsA },
      // 턴 변형의 기대값은 **CO2 자리 사상**이다 (V-CM 의 기본 심볼 =
      // finder-taxonomy.SEAT_DEFAULT_FINDER['v-cm']). 21셀 전부를 digit 으로 재면
      // CO2 가 덮은 6셀이 통째로 0점이 되어 agreement 가 0.7143 에 고정된다 —
      // 게이트 0.78 바로 아래다. 6셀은 톤으로 · 15셀은 digit 으로 재야 맞다.
      { turn: true, groups: co2SeatMarkerGroupsTurnA, cells: co2SeatMarkerCellsTurnA },
    ],
  );
}
