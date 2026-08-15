/**
 * cellsurface-block-detect.js — CS 파인더 블록 전용 로케이터 (마스크·실루엣 무의존).
 *
 * 강한 톤 시프트(감마·S-커브)는 전경 마스크를 침식해 실루엣 hull 을 0.5셀 이상
 * 어긋나게 하고, CS agreement 는 오정렬에 계단형이라 국소 탐색 gradient 가 없다
 * (2026-08-15 실사 207프레임 + claude-acceptance.md). 이 모듈은 실루엣을 전혀 쓰지
 * 않고 **면별 톤이 알려진 CS 파인더 블록**을 축소본에서 직접 찾아 기하를 만든다.
 *
 * 톤은 절대값이 아니라 **국소 순위/대비**로만 다룬다:
 *   · 이진화 = 스캔라인·레이 **1-D** sliding min-max 계층 규칙 (§1 주석) — 단조 톤
 *     커브·면 게인에 불변. 2-D 창은 Y-심 근방에서 세 면 섹터를 섞어 쓰지 않는다.
 *   · 패치 정합 = Pearson 상관 — 국소 아핀 톤 변화에 불변.
 *
 * 검출 서명 (정본 cellSurfaceFinal.js 에서 유도, 3면 합집합 기준):
 *   · v2r2 중앙(블록 A (0..3)² × 3면): Y-심 동심 육각 링 — 중심 통과 직선 런렝스
 *     [B1 D1 B1 D2 B1 D1 B1] → 회문 코어 (B,2D,B) + 방향별 교차거리 비 1:2:3:4.
 *   · v2r2 면 T 블록 B((n−7..n−1)², QR 모티프 동심 사각): 같은 회문 코어,
 *     교차거리 비 1:2(:3) 뒤 배경으로 열린다. 중앙과 함께 «대각 2앵커»를 이룬다.
 *   · v0 중앙(NW 블록 (0..2)² × 3면): 어두운 육각 r<2 + 밝은 링 2..3 →
 *     런렝스 [B1 D4 B1], 교차거리 비 2:3.
 *   동심 닮은꼴 다각형의 중심 통과 교차거리 비는 방향 무관(아핀 불변)이다.
 *
 * 기하 조립:
 *   · v2r2: 중앙 + T코너 similarity (회전 즉시 확정) → 패치 Pearson 정합 4앵커
 *     estimateHomography4 2라운드 → 6 서브앵커 최소제곱 DLT 재적합.
 *   · v0: 중앙 불스아이(위치·스케일) → 30셀 전체 템플릿 회전×스케일 스윕(3°×4 → 0.75°)
 *     → 4앵커 정합 2라운드 → 12 서브앵커(NW·SE + NE·SW 엣지) 최소제곱 재적합.
 *
 * 결정성: RNG 없음, 모든 순회·정렬 고정 순서, 동점은 (score desc, y, x) 으로 깬다.
 * 노출: cube-detect 의 lab 경로(enableCellSurfaceY)에서만 호출된다. 산출 shape 는
 * cellSurfaceOnly=true 라 셀 표면 평가만 받는다 — 수용은 기존 CS 게이트가 결정한다.
 *
 * 모든 임계값은 합성 실험용 [미검증]이며 options.calibration.csBlockLocator 로 덮을 수 있다.
 */

import { CORNER_UNIT_OFFSETS } from '../hexgrid.js';
import { moduleCenter } from '../ygrid.js';
import { locatorCellsCellSurfaceFinal } from '../cellSurfaceFinal.js';
import { estimateHomography4, projectPoint } from './homography.js';
import { downsampleLumaForSeed, otsuThreshold } from './finder-seed.js';

export const UNVERIFIED_CS_BLOCK_LOCATOR = Object.freeze({
  searchMaxSide: 480,
  minimumCoreUnitPx: 1.2,
  minimumClusterSupport: 2,
  maximumVerifiedPerKind: 80,
  maximumPosesPerFamily: 2,
  minimumRayPass: 6,
  minimumPatchCorrelation: 0.25,
  registrationRangeCells: 1.25,
  registrationStepCells: 0.25,
  registrationRange2Cells: 0.5,
  registrationStep2Cells: 0.125,
  v0RotationStepDeg: 3,
  v0RotationRefineDeg: 0.75,
});

const CANONICAL_LAYOUT = Object.freeze({ size: 1, originX: 0, originY: 0 });
const YFACE_LIST = Object.freeze(['T', 'L', 'R']);
/** 면별 먼 코너 대각 단위 방향 = ei_f + ej_f (ygrid FACE_BASIS 에서 유도). */
const FACE_DIAG = Object.freeze({
  T: Object.freeze({ x: 0, y: -1 }),
  L: Object.freeze({ x: -Math.sqrt(3) / 2, y: 0.5 }),
  R: Object.freeze({ x: Math.sqrt(3) / 2, y: 0.5 }),
});
const EPSILON = 1e-9;

function calibration(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  const overlay = supplied.csBlockLocator && typeof supplied.csBlockLocator === 'object'
    ? supplied.csBlockLocator
    : {};
  return { ...UNVERIFIED_CS_BLOCK_LOCATOR, ...overlay };
}

// ─────────────────────────────────────────────────────────────────────────
// 1. 1-D 라인 방향 min-max 혼성 이진화.
//
// 순수 국소평균 이진화는 «더 어두운 어두움» 옆에서 뒤집힌다 — 배경(Y≈0.005)과
// 심선·중앙 도트(bullseyeDark)는 level0 셀(Y≈0.06)보다 어두워, 어두운 영역 내부의
// level0 셀이 국소 평균 위로 떠 밝음으로 오분류된다. 전역 Otsu 단독도 안 된다 —
// 면 게인(R 0.52) × 강한 감마에서 저게인 면의 밝은 셀이 전역 문턱 아래로 눌린다.
// 2-D 창도 안 된다 — Y-심 근방에선 어떤 창이든 세 면 섹터를 동시에 덮어, 게인 1 면의
// 밝음이 게인 0.52 면의 밝음을 어두움으로 밀어낸다. 링 구조는 방사형이라 스캔라인·
// 레이 하나는 국소적으로 한 면만 지난다 — 그래서 이진화를 **라인 1-D** 로 한다:
// 라인 방향 sliding min/max 대비가 실하면 중간값 비교, 평탄하면 전역 Otsu.
// ─────────────────────────────────────────────────────────────────────────

/** 단조 deque O(n) sliding min/max — 반지름 radius 샘플. */
function slidingExtrema(values, count, radius, outMin, outMax) {
  const dequeMin = new Int32Array(count);
  const dequeMax = new Int32Array(count);
  let minHead = 0;
  let minTail = 0;
  let maxHead = 0;
  let maxTail = 0;
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const limit = Math.min(count - 1, index + radius);
    while (cursor <= limit) {
      const value = values[cursor];
      while (minTail > minHead && values[dequeMin[minTail - 1]] >= value) minTail -= 1;
      dequeMin[minTail] = cursor;
      minTail += 1;
      while (maxTail > maxHead && values[dequeMax[maxTail - 1]] <= value) maxTail -= 1;
      dequeMax[maxTail] = cursor;
      maxTail += 1;
      cursor += 1;
    }
    const from = index - radius;
    while (dequeMin[minHead] < from) minHead += 1;
    while (dequeMax[maxHead] < from) maxHead += 1;
    outMin[index] = values[dequeMin[minHead]];
    outMax[index] = values[dequeMax[maxHead]];
  }
}

const FLAT_CONTRAST = 0.03;
/** 창 최대가 전역 컷의 이 비율 미만이면 창 전체가 어두운 계급이다 — level0(≈0.22·cut)
 * 대 저게인 밝음(≥0.48·cut) 사이. 어두움 내부의 미세 대비(level0 vs 심선·도트·배경)가
 * 가짜 밝음을 만드는 것을 막는다. */
const ALL_DARK_RATIO = 0.4;

/** 라인 값 배열을 계층 규칙으로 어두움(1)/밝음(0) 이진화한다:
 *  ① 창 전체가 어두운 계급 → 어두움 ② 창 전체가 밝은 계급 → 밝음
 *  ③ 창이 두 계급을 걸치고 대비가 실하면 국소 중간값 비교 ④ 평탄하면 전역 Otsu. */
function binarizeSeries(values, count, radius, otsuCut, scratch) {
  const outMin = scratch.min;
  const outMax = scratch.max;
  slidingExtrema(values, count, radius, outMin, outMax);
  const cut = Number.isFinite(otsuCut) ? otsuCut : 0.5;
  const allDark = cut * ALL_DARK_RATIO;
  const binary = scratch.binary;
  for (let index = 0; index < count; index += 1) {
    const low = outMin[index];
    const high = outMax[index];
    const value = values[index];
    if (high < allDark) binary[index] = 1;
    else if (low > cut) binary[index] = 0;
    else if (high - low >= FLAT_CONTRAST) binary[index] = value < (low + high) / 2 ? 1 : 0;
    else binary[index] = value <= cut ? 1 : 0;
  }
  return binary;
}

function makeSeriesScratch(capacity) {
  return {
    values: new Float32Array(capacity),
    min: new Float32Array(capacity),
    max: new Float32Array(capacity),
    binary: new Uint8Array(capacity),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. 회문 코어 런렝스 스캔 — 4방향(행·열·대각·반대각).
// ─────────────────────────────────────────────────────────────────────────

function scanLineForCores(
  luma, startX, startY, stepX, stepY, length, stepLen, otsuCut, scratch, cfg, out,
) {
  if (length < 8) return;
  const { width, data, alpha } = luma;
  const values = scratch.values;
  for (let position = 0; position < length; position += 1) {
    const index = (startY + stepY * position) * width + (startX + stepX * position);
    values[position] = alpha && alpha[index] === 0 ? 0 : data[index];
  }
  // 이진화 창 반지름 ≈ 셀 1.3개(21px/2·stepLen) — 라인은 국소적으로 한 면만 지난다.
  const radius = Math.max(4, Math.round(10.5 / stepLen));
  const binary = binarizeSeries(values, length, radius, otsuCut, scratch);
  // 런 수집
  let runStart = 0;
  let runDark = binary[0] === 1;
  const runs = [];
  for (let position = 1; position <= length; position += 1) {
    const dark = position < length ? binary[position] === 1 : !runDark;
    if (dark === runDark) continue;
    runs.push({ start: runStart, length: position - runStart, dark: runDark });
    runDark = dark;
    runStart = position;
  }
  for (let index = 1; index + 1 < runs.length; index += 1) {
    const middle = runs[index];
    if (!middle.dark) continue;
    const before = runs[index - 1];
    const after = runs[index + 1];
    const a = before.length;
    const d = middle.length;
    const b = after.length;
    const midPosition = middle.start + d / 2;
    const px = startX + stepX * midPosition;
    const py = startY + stepY * midPosition;
    // K5: (B1, D2, B1) — v2r2 중앙·코너 앵커의 회문 코어.
    {
      const unit = (a + d + b) / 4;
      if (unit * stepLen >= cfg.minimumCoreUnitPx
        && d >= 1.35 * unit && d <= 2.7 * unit
        && a >= 0.5 * unit && a <= 1.8 * unit
        && b >= 0.5 * unit && b <= 1.8 * unit) {
        out.push({ kind: 'k5', x: px, y: py, u: unit * stepLen });
      }
    }
    // K3: (B1, D4, B1) — v0 중앙 불스아이.
    {
      const unit = (a + d + b) / 6;
      if (unit * stepLen >= Math.max(1, cfg.minimumCoreUnitPx * 0.8)
        && Math.abs(d - 4 * unit) <= 1.2 * unit
        && a >= 0.45 * unit && a <= 1.9 * unit
        && b >= 0.45 * unit && b <= 1.9 * unit) {
        out.push({ kind: 'k3', x: px, y: py, u: unit * stepLen });
      }
    }
  }
}

function scanConcentricCores(luma, otsuCut, cfg, out = []) {
  const { width, height } = luma;
  const scratch = makeSeriesScratch(Math.max(width, height));
  const stepLenDiag = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    scanLineForCores(luma, 0, y, 1, 0, width, 1, otsuCut, scratch, cfg, out);
  }
  for (let x = 0; x < width; x += 1) {
    scanLineForCores(luma, x, 0, 0, 1, height, 1, otsuCut, scratch, cfg, out);
  }
  for (let y = 0; y < height; y += 1) {
    scanLineForCores(
      luma, 0, y, 1, 1, Math.min(width, height - y), stepLenDiag, otsuCut, scratch, cfg, out,
    );
  }
  for (let x = 1; x < width; x += 1) {
    scanLineForCores(
      luma, x, 0, 1, 1, Math.min(width - x, height), stepLenDiag, otsuCut, scratch, cfg, out,
    );
  }
  for (let y = 0; y < height; y += 1) {
    scanLineForCores(
      luma, 0, y, 1, -1, Math.min(width, y + 1), stepLenDiag, otsuCut, scratch, cfg, out,
    );
  }
  for (let x = 1; x < width; x += 1) {
    scanLineForCores(
      luma, x, height - 1, 1, -1, Math.min(width - x, height), stepLenDiag, otsuCut, scratch,
      cfg, out,
    );
  }
  return out;
}

function clusterCores(candidates, cfg) {
  const byKind = new Map();
  for (const candidate of candidates) {
    if (!byKind.has(candidate.kind)) byKind.set(candidate.kind, []);
    byKind.get(candidate.kind).push(candidate);
  }
  const clusters = [];
  for (const kind of ['k5', 'k3']) {
    const list = byKind.get(kind) || [];
    list.sort((left, right) => left.y - right.y || left.x - right.x || left.u - right.u);
    const kindClusters = [];
    for (const candidate of list) {
      let home = null;
      for (const cluster of kindClusters) {
        const meanX = cluster.sumX / cluster.count;
        const meanY = cluster.sumY / cluster.count;
        const meanU = cluster.sumU / cluster.count;
        // reach 는 좁게 — 데이터 필드의 이웃 우연 코어가 평균을 끌고 가지 않게 한다.
        const reach = 1.2 * Math.max(meanU, candidate.u, 2);
        const dx = candidate.x - meanX;
        const dy = candidate.y - meanY;
        // u 가 크게 다른 코어는 같은 앵커가 아니다 — 체인 스미어 방지.
        const uCompatible = candidate.u >= 0.5 * meanU && candidate.u <= 2.0 * meanU;
        if (uCompatible && dx * dx + dy * dy <= reach * reach) {
          home = cluster;
          break;
        }
      }
      if (!home) {
        home = { kind, count: 0, sumX: 0, sumY: 0, sumU: 0 };
        kindClusters.push(home);
      }
      home.count += 1;
      home.sumX += candidate.x;
      home.sumY += candidate.y;
      home.sumU += candidate.u;
    }
    for (const cluster of kindClusters) {
      if (cluster.count < cfg.minimumClusterSupport) continue;
      clusters.push({
        kind,
        count: cluster.count,
        x: cluster.sumX / cluster.count,
        y: cluster.sumY / cluster.count,
        u: cluster.sumU / cluster.count,
      });
    }
  }
  clusters.sort((left, right) =>
    right.count - left.count || left.y - right.y || left.x - right.x);
  return clusters;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. 방향별 교차거리 비 검증 — 링 인덱스 비는 방향 무관(동심 닮은꼴).
// ─────────────────────────────────────────────────────────────────────────

const RAY_DIRECTIONS = Object.freeze([
  Object.freeze({ x: 1, y: 0 }), Object.freeze({ x: Math.SQRT1_2, y: Math.SQRT1_2 }),
  Object.freeze({ x: 0, y: 1 }), Object.freeze({ x: -Math.SQRT1_2, y: Math.SQRT1_2 }),
  Object.freeze({ x: -1, y: 0 }), Object.freeze({ x: -Math.SQRT1_2, y: -Math.SQRT1_2 }),
  Object.freeze({ x: 0, y: -1 }), Object.freeze({ x: Math.SQRT1_2, y: -Math.SQRT1_2 }),
]);

const RAY_STEP = 0.5;
const rayScratch = makeSeriesScratch(512);

/**
 * 레이 방향 루마를 1-D 이진화한 뒤 전이 반경을 수집한다. 레이는 방사형이라
 * 국소적으로 한 면 섹터만 지난다 — 면 게인이 섞이지 않는다.
 */
function rayTransitions(luma, otsuCut, cx, cy, dir, maxR) {
  const { width, height, data, alpha } = luma;
  const values = rayScratch.values;
  let count = 0;
  const capacity = Math.min(values.length, Math.floor(maxR / RAY_STEP) + 1);
  for (let step = 0; step < capacity; step += 1) {
    const r = step * RAY_STEP;
    const x = Math.round(cx + dir.x * r);
    const y = Math.round(cy + dir.y * r);
    if (x < 0 || y < 0 || x >= width || y >= height) break;
    const index = y * width + x;
    values[count] = alpha && alpha[index] === 0 ? 0 : data[index];
    count += 1;
  }
  if (count < 8) return { transitions: [], centerDark: false };
  const radius = Math.max(4, Math.round(10.5 / RAY_STEP));
  const binary = binarizeSeries(values, count, radius, otsuCut, rayScratch);
  const transitions = [];
  let previous = binary[0];
  let pendingValue = null;
  let pendingStep = 0;
  for (let step = 1; step < count; step += 1) {
    const value = binary[step];
    if (value === previous) {
      pendingValue = null;
      continue;
    }
    if (pendingValue === value) {
      // 2연속 확인(히스테리시스) — 픽셀 노이즈 한 점은 전이로 안 친다.
      transitions.push(pendingStep * RAY_STEP);
      previous = value;
      pendingValue = null;
      if (transitions.length >= 5) break;
    } else {
      pendingValue = value;
      pendingStep = step;
    }
  }
  return { transitions, centerDark: binary[0] === 1 };
}

/** t1 쌍(±방향)으로 중심을 재추정한다 — 2회 고정 반복. */
function recentreByRays(luma, otsuCut, cluster, maxR) {
  let cx = cluster.x;
  let cy = cluster.y;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    let shiftX = 0;
    let shiftY = 0;
    let pairs = 0;
    for (let axis = 0; axis < 4; axis += 1) {
      const forward = rayTransitions(luma, otsuCut, cx, cy, RAY_DIRECTIONS[axis], maxR);
      const backward = rayTransitions(luma, otsuCut, cx, cy, RAY_DIRECTIONS[axis + 4], maxR);
      if (forward.transitions.length === 0 || backward.transitions.length === 0) continue;
      const delta = (forward.transitions[0] - backward.transitions[0]) / 2;
      shiftX += delta * RAY_DIRECTIONS[axis].x;
      shiftY += delta * RAY_DIRECTIONS[axis].y;
      pairs += 1;
    }
    if (pairs === 0) break;
    cx += shiftX / pairs;
    cy += shiftY / pairs;
  }
  return { x: cx, y: cy };
}

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * v2r2 앵커 검증 — 심선(어두운 3선)이 레이 하나를 죽일 수 있고, 링 2 의 밝은
 * 반점·바깥 데이터 병합이 t3/t4 를 흔들므로, t1 중앙값 일관성 + 비율 계급으로 센다.
 */
function verifyV2r2Cluster(luma, otsuCut, cluster, cfg) {
  const maxR = cluster.u * 7;
  const center = recentreByRays(luma, otsuCut, cluster, maxR);
  if (Math.hypot(center.x - cluster.x, center.y - cluster.y) > 2.5 * cluster.u) return null;
  const rays = RAY_DIRECTIONS.map((dir) =>
    rayTransitions(luma, otsuCut, center.x, center.y, dir, maxR));
  if (rays.filter((ray) => ray.centerDark).length < 6) return null;
  const t1List = [];
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length === 0) continue;
    const t1 = ray.transitions[0];
    if (t1 >= 0.4 * cluster.u && t1 <= 2.2 * cluster.u) t1List.push(t1);
  }
  if (t1List.length < 5) return null;
  const t1Median = median(t1List);
  let full = 0;
  let ring3 = 0;
  let open = 0;
  let ring2Ok = 0;
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length < 2) continue;
    const t1 = ray.transitions[0];
    if (!(t1 >= 0.72 * t1Median && t1 <= 1.38 * t1Median)) continue;
    const r2 = ray.transitions[1] / t1;
    // 하한 1.6 — v0 불스아이의 링 비(1.5)를 배제한다.
    if (!(r2 >= 1.6 && r2 <= 2.55)) continue;
    ring2Ok += 1;
    const t3 = ray.transitions.length >= 3 ? ray.transitions[2] : null;
    const t4 = ray.transitions.length >= 4 ? ray.transitions[3] : null;
    const hasRing3 = t3 !== null && t3 / t1 >= 2.4 && t3 / t1 <= 3.8;
    if (hasRing3 && t4 !== null && t4 / t1 >= 3.3 && t4 / t1 <= 5.0) full += 1;
    else if (hasRing3) ring3 += 1;
    else if (t3 === null || t3 / t1 > 4.6) open += 1;
  }
  const closed = full + ring3;
  if (ring2Ok < 5) return null;
  if (closed >= 5 && open <= 1) {
    return {
      kind: 'v2r2-center', x: center.x, y: center.y, u: t1Median,
      score: (2 * full + ring3) / 16, count: cluster.count,
    };
  }
  if (open >= 3 && closed <= 4) {
    return {
      kind: 'v2r2-corner', x: center.x, y: center.y, u: t1Median,
      score: (open + ring2Ok) / 16, count: cluster.count,
    };
  }
  return null;
}

/**
 * v0 불스아이 검증 — 밝은 링(2..3)의 바깥 경계는 인접 데이터 셀과 병합될 수 있어
 * 신뢰할 수 없다. 항상 성립하는 것은 어두운 코어 경계(t1 ≈ 2u)뿐이므로,
 * t1 의 방향 간 중앙값 일관성으로 검증한다 (심선 방향 레이는 t1 이 크게 이탈 → 자연 탈락).
 */
function verifyV0Cluster(luma, otsuCut, cluster, cfg) {
  const maxR = cluster.u * 5;
  const center = recentreByRays(luma, otsuCut, cluster, maxR);
  if (Math.hypot(center.x - cluster.x, center.y - cluster.y) > 2.5 * cluster.u) return null;
  const rays = RAY_DIRECTIONS.map((dir) =>
    rayTransitions(luma, otsuCut, center.x, center.y, dir, maxR));
  if (rays.filter((ray) => ray.centerDark).length < 6) return null;
  const t1List = [];
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length === 0) continue;
    const t1 = ray.transitions[0];
    if (t1 >= 1.2 * cluster.u && t1 <= 3.0 * cluster.u) t1List.push(t1);
  }
  if (t1List.length < 5) return null;
  const t1Median = median(t1List);
  let pass = 0;
  let ring2Bonus = 0;
  let v2r2Stack = 0;
  for (const ray of rays) {
    if (!ray.centerDark || ray.transitions.length === 0) continue;
    const t1 = ray.transitions[0];
    if (!(t1 >= 0.75 * t1Median && t1 <= 1.3 * t1Median)) continue;
    pass += 1;
    if (ray.transitions.length >= 2) {
      const ratio = ray.transitions[1] / t1;
      if (ratio >= 1.25 && ratio <= 1.78) ring2Bonus += 1;
      // v2r2 중앙 링 스택(1:2:3)이 v0 불스아이(2:3)로 위장하는 것을 걸러낸다.
      if (ratio >= 1.85 && ratio <= 2.35 && ray.transitions.length >= 3
        && ray.transitions[2] / t1 >= 2.6 && ray.transitions[2] / t1 <= 3.5) {
        v2r2Stack += 1;
      }
    }
  }
  if (pass < cfg.minimumRayPass || v2r2Stack >= 3) return null;
  return {
    kind: 'v0-center', x: center.x, y: center.y,
    u: t1Median / 2,
    score: (pass + ring2Bonus) / 16, count: cluster.count,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. 패치 정본 — canonical 모듈 중심 + 기대 이진 톤 (레이아웃별 지연 캐시).
// ─────────────────────────────────────────────────────────────────────────

const patchCache = new Map();

function buildPatch(cells, face, filter) {
  const points = [];
  let sumX = 0;
  let sumY = 0;
  for (const cell of cells) {
    if (!filter(cell)) continue;
    const point = moduleCenter(face, cell.i, cell.j, CANONICAL_LAYOUT);
    const expected = cell[face] === 2 ? 1 : 0;
    points.push({ x: point.x, y: point.y, expected });
    sumX += point.x;
    sumY += point.y;
  }
  if (points.length === 0) return null;
  return {
    anchor: { x: sumX / points.length, y: sumY / points.length },
    points,
  };
}

function mergePatches(patches) {
  const points = [];
  let sumX = 0;
  let sumY = 0;
  for (const patch of patches) {
    for (const point of patch.points) {
      points.push(point);
      sumX += point.x;
      sumY += point.y;
    }
  }
  return { anchor: { x: sumX / points.length, y: sumY / points.length }, points };
}

function patchesForN(n) {
  if (patchCache.has(n)) return patchCache.get(n);
  const cells = locatorCellsCellSurfaceFinal(n);
  const nearLimit = n === 13 ? 2 : 3;
  const farLimit = n === 13 ? 10 : n - 7;
  const centreParts = YFACE_LIST.map((face) =>
    buildPatch(cells, face, (cell) => cell.i <= nearLimit && cell.j <= nearLimit));
  const corners = YFACE_LIST.map((face) =>
    buildPatch(cells, face, (cell) => cell.i >= farLimit && cell.j >= farLimit));
  // v0 는 NE(i 작음·j 큼)·SW(i 큼·j 작음) 엣지 블록도 정본이다 — 서브앵커 스프레드를
  // 넓혀 재적합 정확도를 올린다 (v2r2 는 해당 블록이 없다).
  const edges = n === 13
    ? YFACE_LIST.flatMap((face) => [
      buildPatch(cells, face, (cell) => cell.i <= 1 && cell.j >= 10),
      buildPatch(cells, face, (cell) => cell.i >= 10 && cell.j <= 1),
    ]).filter((patch) => patch !== null)
    : [];
  const built = {
    centre: mergePatches(centreParts),
    corners,
    // 최소제곱 재적합용 서브앵커 — 면별 중앙 3 + 면별 먼 코너 3 (+ v0 엣지 6).
    subPatches: [...centreParts, ...corners, ...edges],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
  patchCache.set(n, built);
  return built;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Pearson 패치 정합과 호모그래피 재적합.
// ─────────────────────────────────────────────────────────────────────────

function bilinear(luma, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= luma.width || y0 + 1 >= luma.height) return null;
  const fx = x - x0;
  const fy = y - y0;
  const base = y0 * luma.width + x0;
  const top = luma.data[base] * (1 - fx) + luma.data[base + 1] * fx;
  const bottom = luma.data[base + luma.width] * (1 - fx) + luma.data[base + luma.width + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function pearson(values, expected, count) {
  if (count < 6) return null;
  let sumV = 0;
  let sumE = 0;
  for (let index = 0; index < count; index += 1) {
    sumV += values[index];
    sumE += expected[index];
  }
  const meanV = sumV / count;
  const meanE = sumE / count;
  let covVE = 0;
  let varV = 0;
  let varE = 0;
  for (let index = 0; index < count; index += 1) {
    const dv = values[index] - meanV;
    const de = expected[index] - meanE;
    covVE += dv * de;
    varV += dv * dv;
    varE += de * de;
  }
  if (varV <= EPSILON || varE <= EPSILON) return null;
  return covVE / Math.sqrt(varV * varE);
}

function localCellPx(H) {
  const origin = projectPoint(H, { x: 0, y: 0 });
  const east = projectPoint(H, { x: 1, y: 0 });
  const south = projectPoint(H, { x: 0, y: 1 });
  if (!origin || !east || !south) return null;
  return (Math.hypot(east.x - origin.x, east.y - origin.y)
    + Math.hypot(south.x - origin.x, south.y - origin.y)) / 2;
}

const scratchValues = new Float64Array(256);
const scratchExpected = new Float64Array(256);

/**
 * 패치를 현재 H 로 투영한 뒤 이미지 평면 오프셋 그리드에서 Pearson 최대를 찾는다.
 * 반환 offset 은 이미지 px — 포물선 보간으로 서브픽셀까지 간다.
 */
function registerPatch(luma, H, patch, rangePx, stepPx) {
  const projected = [];
  for (const point of patch.points) {
    const image = projectPoint(H, point);
    if (!image) return null;
    projected.push({ x: image.x, y: image.y, expected: point.expected });
  }
  // 모듈당 5-탭(중심 + 십자 0.18셀) 평균 — 픽셀 격자 앨리어싱을 눌러 정합 봉우리를 안정화.
  const cellPx = localCellPx(H);
  const tap = Number.isFinite(cellPx) ? 0.18 * cellPx : 0;
  const steps = Math.max(1, Math.round(rangePx / stepPx));
  const size = 2 * steps + 1;
  const grid = new Float64Array(size * size).fill(-2);
  let best = -2;
  let bestIx = -1;
  let bestIy = -1;
  for (let iy = 0; iy < size; iy += 1) {
    const oy = (iy - steps) * stepPx;
    for (let ix = 0; ix < size; ix += 1) {
      const ox = (ix - steps) * stepPx;
      let count = 0;
      for (const point of projected) {
        const px = point.x + ox;
        const py = point.y + oy;
        const centre = bilinear(luma, px, py);
        if (centre === null) continue;
        let value = centre;
        let taps = 1;
        if (tap > 0) {
          const east = bilinear(luma, px + tap, py);
          const west = bilinear(luma, px - tap, py);
          const south = bilinear(luma, px, py + tap);
          const north = bilinear(luma, px, py - tap);
          if (east !== null) { value += east; taps += 1; }
          if (west !== null) { value += west; taps += 1; }
          if (south !== null) { value += south; taps += 1; }
          if (north !== null) { value += north; taps += 1; }
        }
        scratchValues[count] = value / taps;
        scratchExpected[count] = point.expected;
        count += 1;
      }
      if (count < Math.max(6, Math.floor(projected.length * 0.8))) continue;
      const corr = pearson(scratchValues, scratchExpected, count);
      if (corr === null) continue;
      grid[iy * size + ix] = corr;
      if (corr > best) {
        best = corr;
        bestIx = ix;
        bestIy = iy;
      }
    }
  }
  if (bestIx < 0) return null;
  let offsetX = (bestIx - steps) * stepPx;
  let offsetY = (bestIy - steps) * stepPx;
  // 포물선 서브픽셀 — 내부 극값에서만.
  if (bestIx > 0 && bestIx + 1 < size) {
    const left = grid[bestIy * size + bestIx - 1];
    const right = grid[bestIy * size + bestIx + 1];
    if (left > -2 && right > -2) {
      const denom = left - 2 * best + right;
      if (denom < -EPSILON) offsetX += 0.5 * ((left - right) / denom) * stepPx;
    }
  }
  if (bestIy > 0 && bestIy + 1 < size) {
    const up = grid[(bestIy - 1) * size + bestIx];
    const down = grid[(bestIy + 1) * size + bestIx];
    if (up > -2 && down > -2) {
      const denom = up - 2 * best + down;
      if (denom < -EPSILON) offsetY += 0.5 * ((up - down) / denom) * stepPx;
    }
  }
  return { offsetX, offsetY, correlation: best };
}

/** 4앵커(중앙 + 3코너) 정합 → estimateHomography4 재적합. 실패 시 이전 H 유지. */
function refineHomographyWithPatches(luma, H, patches, rangeCells, stepCells) {
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return null;
  const anchorPatches = [patches.centre, ...patches.corners];
  const canonicalPoints = [];
  const imagePoints = [];
  let correlationSum = 0;
  let worst = Infinity;
  for (const patch of anchorPatches) {
    const registered = registerPatch(
      luma, H, patch, rangeCells * cellPx, Math.max(0.5, stepCells * cellPx),
    );
    if (!registered) return null;
    const projectedAnchor = projectPoint(H, patch.anchor);
    if (!projectedAnchor) return null;
    canonicalPoints.push({ x: patch.anchor.x, y: patch.anchor.y });
    imagePoints.push({
      x: projectedAnchor.x + registered.offsetX,
      y: projectedAnchor.y + registered.offsetY,
    });
    correlationSum += registered.correlation;
    worst = Math.min(worst, registered.correlation);
  }
  const refined = estimateHomography4(canonicalPoints, imagePoints);
  return {
    H: refined || H,
    meanCorrelation: correlationSum / anchorPatches.length,
    worstCorrelation: worst,
  };
}

/**
 * 4점 이상 최소제곱 DLT (h8=1 고정, Hartley 정규화 + 정규방정식 가우스 소거).
 * estimateHomography4 는 정확히 4점 전용이라 6 서브앵커 재적합에는 이걸 쓴다.
 */
function homographyLeastSquares(canonicalPoints, imagePoints) {
  const count = canonicalPoints.length;
  if (count < 4 || imagePoints.length !== count) return null;
  let meanCx = 0;
  let meanCy = 0;
  let meanIx = 0;
  let meanIy = 0;
  for (let k = 0; k < count; k += 1) {
    meanCx += canonicalPoints[k].x;
    meanCy += canonicalPoints[k].y;
    meanIx += imagePoints[k].x;
    meanIy += imagePoints[k].y;
  }
  meanCx /= count;
  meanCy /= count;
  meanIx /= count;
  meanIy /= count;
  let scaleC = 0;
  let scaleI = 0;
  for (let k = 0; k < count; k += 1) {
    scaleC += Math.hypot(canonicalPoints[k].x - meanCx, canonicalPoints[k].y - meanCy);
    scaleI += Math.hypot(imagePoints[k].x - meanIx, imagePoints[k].y - meanIy);
  }
  scaleC = scaleC > EPSILON ? (Math.SQRT2 * count) / scaleC : 1;
  scaleI = scaleI > EPSILON ? (Math.SQRT2 * count) / scaleI : 1;
  const ata = new Float64Array(64);
  const atb = new Float64Array(8);
  const row = new Float64Array(8);
  for (let k = 0; k < count; k += 1) {
    const x = (canonicalPoints[k].x - meanCx) * scaleC;
    const y = (canonicalPoints[k].y - meanCy) * scaleC;
    const u = (imagePoints[k].x - meanIx) * scaleI;
    const v = (imagePoints[k].y - meanIy) * scaleI;
    for (let half = 0; half < 2; half += 1) {
      const rhs = half === 0 ? u : v;
      row[0] = half === 0 ? x : 0;
      row[1] = half === 0 ? y : 0;
      row[2] = half === 0 ? 1 : 0;
      row[3] = half === 0 ? 0 : x;
      row[4] = half === 0 ? 0 : y;
      row[5] = half === 0 ? 0 : 1;
      row[6] = -rhs * x;
      row[7] = -rhs * y;
      for (let a = 0; a < 8; a += 1) {
        atb[a] += row[a] * rhs;
        for (let b = 0; b < 8; b += 1) ata[a * 8 + b] += row[a] * row[b];
      }
    }
  }
  const perm = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < 8; r += 1) {
      if (Math.abs(ata[perm[r] * 8 + col]) > Math.abs(ata[perm[pivot] * 8 + col])) pivot = r;
    }
    const swap = perm[col];
    perm[col] = perm[pivot];
    perm[pivot] = swap;
    const diag = ata[perm[col] * 8 + col];
    if (!(Math.abs(diag) > 1e-12)) return null;
    for (let r = col + 1; r < 8; r += 1) {
      const factor = ata[perm[r] * 8 + col] / diag;
      if (factor === 0) continue;
      for (let c = col; c < 8; c += 1) ata[perm[r] * 8 + c] -= factor * ata[perm[col] * 8 + c];
      atb[perm[r]] -= factor * atb[perm[col]];
    }
  }
  const h = new Float64Array(8);
  for (let col = 7; col >= 0; col -= 1) {
    let acc = atb[perm[col]];
    for (let c = col + 1; c < 8; c += 1) acc -= ata[perm[col] * 8 + c] * h[c];
    h[col] = acc / ata[perm[col] * 8 + col];
  }
  // 정규화 해제: H = Timg 역 · Hn · Tcan.
  const a00 = h[0] * scaleC;
  const a01 = h[1] * scaleC;
  const a02 = h[2] - h[0] * scaleC * meanCx - h[1] * scaleC * meanCy;
  const a10 = h[3] * scaleC;
  const a11 = h[4] * scaleC;
  const a12 = h[5] - h[3] * scaleC * meanCx - h[4] * scaleC * meanCy;
  const a20 = h[6] * scaleC;
  const a21 = h[7] * scaleC;
  const a22 = 1 - h[6] * scaleC * meanCx - h[7] * scaleC * meanCy;
  const out = new Float64Array(9);
  out[0] = a00 / scaleI + meanIx * a20;
  out[1] = a01 / scaleI + meanIx * a21;
  out[2] = a02 / scaleI + meanIx * a22;
  out[3] = a10 / scaleI + meanIy * a20;
  out[4] = a11 / scaleI + meanIy * a21;
  out[5] = a12 / scaleI + meanIy * a22;
  out[6] = a20;
  out[7] = a21;
  out[8] = a22;
  return out;
}

function similarityHomography(center, scale, angleCos, angleSin) {
  const H = new Float64Array(9);
  H[0] = scale * angleCos;
  H[1] = -scale * angleSin;
  H[2] = center.x;
  H[3] = scale * angleSin;
  H[4] = scale * angleCos;
  H[5] = center.y;
  H[6] = 0;
  H[7] = 0;
  H[8] = 1;
  return H;
}

function liftPoint(point, factor) {
  return {
    x: point.x * factor + (factor - 1) / 2,
    y: point.y * factor + (factor - 1) / 2,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. 조립 — v2r2 (중앙+코너 similarity), v0 (불스아이+회전 스윕).
// ─────────────────────────────────────────────────────────────────────────

/** 라운드 3 — 6 서브앵커(면별 중앙 3 + 코너 3) 정합 → 최소제곱 재적합. */
function refineWithSubPatches(luma, H, patches, cfg) {
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return null;
  const canonicalPoints = [];
  const imagePoints = [];
  let correlationSum = 0;
  let worst = Infinity;
  for (const patch of patches.subPatches) {
    const registered = registerPatch(
      luma, H, patch, 0.5 * cellPx, Math.max(0.5, 0.125 * cellPx),
    );
    if (!registered) return null;
    const projectedAnchor = projectPoint(H, patch.anchor);
    if (!projectedAnchor) return null;
    canonicalPoints.push({ x: patch.anchor.x, y: patch.anchor.y });
    imagePoints.push({
      x: projectedAnchor.x + registered.offsetX,
      y: projectedAnchor.y + registered.offsetY,
    });
    correlationSum += registered.correlation;
    worst = Math.min(worst, registered.correlation);
  }
  const refined = homographyLeastSquares(canonicalPoints, imagePoints);
  if (!refined) return null;
  return {
    H: refined,
    meanCorrelation: correlationSum / patches.subPatches.length,
    worstCorrelation: worst,
  };
}

function refinePose(luma, H0, patches, cfg) {
  const round1 = refineHomographyWithPatches(
    luma, H0, patches, cfg.registrationRangeCells, cfg.registrationStepCells,
  );
  if (!round1 || round1.worstCorrelation < cfg.minimumPatchCorrelation) return null;
  const round2 = refineHomographyWithPatches(
    luma, round1.H, patches, cfg.registrationRange2Cells, cfg.registrationStep2Cells,
  );
  const base = round2 && round2.meanCorrelation >= round1.meanCorrelation ? round2 : round1;
  const round3 = refineWithSubPatches(luma, base.H, patches, cfg);
  if (!round3) return base;
  return round3.meanCorrelation >= base.meanCorrelation - 0.05 ? round3 : base;
}

function assembleV2r2Poses(verified, fullLuma, factor, cfg) {
  const centres = verified.filter((hit) => hit.kind === 'v2r2-center').slice(0, 3);
  const corners = verified.filter((hit) => hit.kind === 'v2r2-corner').slice(0, 4);
  const poses = [];
  for (const centre of centres) {
    for (const corner of corners) {
      const dx = corner.x - centre.x;
      const dy = corner.y - centre.y;
      const distance = Math.hypot(dx, dy);
      if (!(distance > 6 * centre.u)) continue;
      const estimatedN = distance / Math.max(centre.u, EPSILON) + 3.5;
      let n = null;
      // 마스크 침식이 u 를 부풀릴 수 있어 스냅 허용폭은 후보 간격(4)의 중간까지 연다.
      for (const candidate of [21, 25]) {
        if (Math.abs(estimatedN - candidate) <= 3.2
          && (n === null || Math.abs(estimatedN - candidate) < Math.abs(estimatedN - n))) {
          n = candidate;
        }
      }
      if (n === null) continue;
      const centreFull = liftPoint(centre, factor);
      const cornerFull = liftPoint(corner, factor);
      const scale = Math.hypot(cornerFull.x - centreFull.x, cornerFull.y - centreFull.y)
        / (n - 3.5);
      // canonical 대각 (0,−1)·(n−3.5) → 코너. R·(0,−1) = w 에서 cos=−wy, sin=wx.
      const wx = (cornerFull.x - centreFull.x) / (scale * (n - 3.5));
      const wy = (cornerFull.y - centreFull.y) / (scale * (n - 3.5));
      const H0 = similarityHomography(centreFull, scale, -wy, wx);
      const refined = refinePose(fullLuma, H0, patchesForN(n), cfg);
      if (!refined) continue;
      poses.push({
        family: 'v2r2',
        n,
        H: refined.H,
        score: refined.meanCorrelation,
        estimatedN,
      });
    }
  }
  return poses;
}

function rotationSweepScore(reducedLuma, template, centre, unit, angleCos, angleSin) {
  let count = 0;
  for (const point of template.points) {
    const x = centre.x + unit * (angleCos * point.x - angleSin * point.y);
    const y = centre.y + unit * (angleSin * point.x + angleCos * point.y);
    const value = bilinear(reducedLuma, x, y);
    if (value === null) continue;
    scratchValues[count] = value;
    scratchExpected[count] = point.expected;
    count += 1;
  }
  if (count < Math.floor(template.points.length * 0.8)) return null;
  return pearson(scratchValues, scratchExpected, count);
}

/** 마스크 침식이 불스아이 u 를 부풀리는 방향이라 스케일 스윕은 아래쪽을 더 연다. */
const V0_SCALE_SWEEP = Object.freeze([0.72, 0.85, 1, 1.12]);

function assembleV0Poses(verified, reducedLuma, fullLuma, factor, cfg) {
  const centres = verified.filter((hit) => hit.kind === 'v0-center').slice(0, 3);
  const poses = [];
  const template = patchesForN(13).all;
  for (const centre of centres) {
    const sweep = [];
    for (const scale of V0_SCALE_SWEEP) {
      const unit = centre.u * scale;
      for (let degrees = 0; degrees < 360; degrees += cfg.v0RotationStepDeg) {
        const radians = (degrees * Math.PI) / 180;
        const corr = rotationSweepScore(
          reducedLuma, template, centre, unit, Math.cos(radians), Math.sin(radians),
        );
        if (corr !== null) sweep.push({ degrees, unit, corr });
      }
    }
    if (sweep.length === 0) continue;
    sweep.sort((left, right) =>
      right.corr - left.corr || left.degrees - right.degrees || left.unit - right.unit);
    const seeds = [];
    for (const entry of sweep) {
      if (seeds.some((seed) => {
        const delta = Math.abs(seed.degrees - entry.degrees);
        return Math.min(delta, 360 - delta) < 25;
      })) continue;
      seeds.push(entry);
      if (seeds.length >= 2) break;
    }
    for (const seed of seeds) {
      let bestDegrees = seed.degrees;
      let bestCorr = seed.corr;
      for (let offset = -cfg.v0RotationStepDeg; offset <= cfg.v0RotationStepDeg;
        offset += cfg.v0RotationRefineDeg) {
        const degrees = seed.degrees + offset;
        const radians = (degrees * Math.PI) / 180;
        const corr = rotationSweepScore(
          reducedLuma, template, centre, seed.unit, Math.cos(radians), Math.sin(radians),
        );
        if (corr !== null && corr > bestCorr) {
          bestCorr = corr;
          bestDegrees = degrees;
        }
      }
      const radians = (bestDegrees * Math.PI) / 180;
      const centreFull = liftPoint(centre, factor);
      const H0 = similarityHomography(
        centreFull, seed.unit * factor, Math.cos(radians), Math.sin(radians),
      );
      const refined = refinePose(fullLuma, H0, patchesForN(13), cfg);
      if (!refined) continue;
      poses.push({
        family: 'v0',
        n: 13,
        H: refined.H,
        score: refined.meanCorrelation,
        sweepCorrelation: bestCorr,
      });
    }
  }
  return poses;
}

// ─────────────────────────────────────────────────────────────────────────
// 7. shape 합성 — cube-detect 의 shape 계약(cellSurfaceOnly)으로 출력.
// ─────────────────────────────────────────────────────────────────────────

function shapeFromPose(pose, index) {
  const vertices = [];
  for (const corner of CORNER_UNIT_OFFSETS) {
    const point = projectPoint(pose.H, { x: corner.x * pose.n, y: corner.y * pose.n });
    if (!point) return null;
    vertices.push(point);
  }
  const centre = projectPoint(pose.H, { x: 0, y: 0 });
  if (!centre) return null;
  let radiusSum = 0;
  for (const vertex of vertices) {
    radiusSum += Math.hypot(vertex.x - centre.x, vertex.y - centre.y);
  }
  return {
    componentIndex: 2000 + index,
    componentSource: 'cell-surface-block-locator',
    center: centre,
    vertices,
    // 정점 배열이 canonical 코너 순서(C0..C5)라 심은 홀수 인덱스 = parity 1.
    seamParity: 1,
    seamVertices: [1, 3, 5].map((k) => vertices[k]),
    radius: radiusSum / 6,
    maskFill: 0,
    concurrencyResidual: 1,
    seam: { contrast: 0, support: 0 },
    hardChecks: {
      hexSilhouette: false,
      diagonalConcurrency: false,
      yJunction: false,
      all: false,
    },
    score: pose.score,
    cellSurfaceOnly: true,
    estimatedN: pose.n,
    blockLocator: {
      family: pose.family,
      patchCorrelation: pose.score,
    },
  };
}

/**
 * CS 파인더 블록 로케이터 진입점. luma 만 받는다 — 마스크·실루엣 무의존.
 * @returns {{shapes: object[], diagnostics: object}}
 */
export function detectCellSurfaceBlockShapes(luma, options = {}) {
  const cfg = calibration(options);
  const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
  const { width, height } = reduced.luma;
  const globalCut = otsuThreshold(reduced.luma);
  const cores = scanConcentricCores(reduced.luma, globalCut, cfg);
  const clusters = clusterCores(cores, cfg);

  const verified = [];
  const occupied = [];
  let inspectedK5 = 0;
  let inspectedK3 = 0;
  for (const cluster of clusters) {
    if (cluster.kind === 'k5') {
      if (inspectedK5 >= cfg.maximumVerifiedPerKind) continue;
      inspectedK5 += 1;
    } else {
      if (inspectedK3 >= cfg.maximumVerifiedPerKind) continue;
      inspectedK3 += 1;
    }
    // 같은 자리·같은 코어 종류의 클러스터 조각들 — 이미 검증된 자리면 건너뛴다.
    // (다른 종류는 막지 않는다 — k3 오검증이 같은 자리 k5 의 v2r2 검증을 가리면 안 된다.)
    if (occupied.some((hit) => hit.coreKind === cluster.kind
      && Math.hypot(hit.x - cluster.x, hit.y - cluster.y)
        <= 2.2 * Math.max(hit.u, cluster.u))) continue;
    // 코어 종류 우선 검증 후, 실패하면 교차 검증한다 — 링 침식으로 코어 비율이
    // 이웃 서명으로 넘어가는 경우(v2r2 중앙 ↔ v0 불스아이)를 회수한다.
    const native = cluster.kind === 'k5'
      ? verifyV2r2Cluster(reduced.luma, globalCut, cluster, cfg)
      : verifyV0Cluster(reduced.luma, globalCut, cluster, cfg);
    const hit = native || (cluster.kind === 'k5'
      ? verifyV0Cluster(reduced.luma, globalCut, cluster, cfg)
      : verifyV2r2Cluster(reduced.luma, globalCut, cluster, cfg));
    if (hit) {
      verified.push(hit);
      occupied.push({ ...hit, coreKind: cluster.kind });
    }
  }
  verified.sort((left, right) =>
    right.score - left.score || right.count - left.count
    || left.y - right.y || left.x - right.x);

  const posesV2r2 = assembleV2r2Poses(verified, luma, reduced.factor, cfg);
  const posesV0 = assembleV0Poses(verified, reduced.luma, luma, reduced.factor, cfg);

  const shapes = [];
  for (const familyPoses of [posesV2r2, posesV0]) {
    familyPoses.sort((left, right) =>
      right.score - left.score || left.n - right.n);
    for (const pose of familyPoses.slice(0, cfg.maximumPosesPerFamily)) {
      const shape = shapeFromPose(pose, shapes.length);
      if (shape) shapes.push(shape);
    }
  }

  return {
    shapes,
    diagnostics: {
      source: 'cell-surface-block-locator',
      downsampleFactor: reduced.factor,
      coreCandidates: cores.length,
      clusterCount: clusters.length,
      verified: verified.map((hit) => ({
        kind: hit.kind,
        x: hit.x * reduced.factor,
        y: hit.y * reduced.factor,
        u: hit.u * reduced.factor,
        score: hit.score,
        count: hit.count,
      })),
      poseCount: { v2r2: posesV2r2.length, v0: posesV0.length },
      shapeCount: shapes.length,
    },
  };
}

/** 단위 테스트·진단 전용 내부 노출 — 런타임 경로는 detectCellSurfaceBlockShapes 만 쓴다. */
export const CS_BLOCK_LOCATOR_INTERNALS = Object.freeze({
  binarizeSeries,
  makeSeriesScratch,
  registerPatch,
  refineHomographyWithPatches,
  refineWithSubPatches,
  homographyLeastSquares,
  scanConcentricCores,
  clusterCores,
  verifyV2r2Cluster,
  verifyV0Cluster,
  rayTransitions,
  recentreByRays,
  patchesForN,
});
