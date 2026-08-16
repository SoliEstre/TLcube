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
 * 검출 서명 (정본 cellSurfaceFinal.js 에서 유도, 3면 합집합 기준 · 2026-08-16 중앙 통일):
 *   · **공유 K3 중앙** — v0(NW 3×3)·v1r2(NW 5×5)·v2r2(중앙 A = v1r2 NW 공유):
 *     어두운 육각 + 밝은 링 → 중심 통과 런렝스 [B1 D4 B1], 교차거리 비 2:3.
 *     세 패밀리의 중앙 서명이 같으므로 **중앙만으로는 패밀리를 판별하지 않는다.**
 *   · v2r2 면 T 블록 B((n−7..n−1)², QR 모티프 동심 사각): 회문 코어 (B,2D,B) = K5,
 *     교차거리 비 1:2(:3) 뒤 배경으로 열린다 → 'v2r2-corner'. 중앙에서 (n−3.5)셀.
 *   · v1r2 면 T SE 5×5: 같은 K5 코어 → 'v2r2-corner'. 중앙에서 18셀.
 *   · v0X SE 6×6 (QR 동심 사각): **3면 톤이 같아** 세 면이 각각 같은 K5 코어를 낸다 →
 *     'v2r2-corner' 가 **120° 간격 3개**, 전부 중앙에서 18셀. v1r2 는 하나뿐이라
 *     이 «사각 링 동반자» 가 같은 반경을 쓰는 두 패밀리의 판별자다 (§6 상세).
 *   · 구 v2r2 중앙(동심 육각 링 스택, 닫힌 K5 1:2:3:4)은 **소각된 디자인**이다 —
 *     'legacy-v2r2-center' 로 분류만 남기고 어떤 포즈도 세우지 않는다(차단).
 *   동심 닮은꼴 다각형의 중심 통과 교차거리 비는 방향 무관(아핀 불변)이다.
 *
 * 기하 조립 — **2차 앵커 조기 분기** (중앙 히트에서 세 패밀리 순차 시도 금지):
 *   · K3 중앙 × K5 원거리 코어 쌍의 거리 스냅(v2r2@21 17.5 · v1r2 18 · v2r2@25 21.5,
 *     ±3.2셀)이 맞으면 **앵커드 패밀리** similarity → 패치 Pearson 정합 4앵커
 *     estimateHomography4 2라운드 → 6~12 서브앵커 최소제곱 DLT 재적합.
 *     v2r2@21·v1r2 는 거리로 안 갈라진다 — 둘 다 세우고 CS 게이트가 고른다.
 *   · v0X 는 반경이 v1r2 와 같으므로(18.0) 거리 스냅에 더해 **사각 링 동반자 ≥ 1** 을
 *     시딩 게이트로 요구한다. 세 후보 코너를 각각 «면 T 먼 코너» 로 가정해 시드하고
 *     (120° 위상 3가설) 패치 Pearson 이 참 위상을 고른다.
 *   · 앵커드 포즈가 성립한 중앙은 v0 스윕 대상에서 빠진다. 앵커드 포즈가 없는
 *     중앙만 v0 경로: 30셀 전체 템플릿 회전×스케일 스윕(3°×4 → 0.75°) → 4앵커
 *     정합 2라운드 → 12 서브앵커(NW·SE + NE·SW 엣지) 최소제곱 재적합.
 *     분기 조건이 «앵커 존재» 가 아니라 «앵커드 포즈 성립» 인 이유: 데이터 필드의
 *     우연한 K5 코어가 v0 검출을 죽이면 안 되기 때문.
 *
 * 부분 앵커 포즈 (§6b, 2026-08-16) — **잘림 구제의 실병목이 여기였다.**
 *   엄격 경로는 4 앵커 패치를 전부 정합해야 하고 registerPatch 는 투영점 80% 이상이
 *   프레임 안일 때만 상관을 낸다. 코너가 5% 잘리면 한 면 코너 패치가 67% 로 떨어져
 *   **참 기하가 아예 만들어지지 않는다**. 그래서 엄격 경로가 실패했고 **앵커가 실제로
 *   프레임 밖으로 나갔을 때만** 부분 완성을 연다: 관측 앵커 ≥ 2 → similarity 최소제곱
 *   (전단·뒤집힘 불가, 3점부터 과결정이라 잔차가 실재) → 빠진 앵커는 레이아웃 좌표로
 *   외삽(프레임 밖 허용) → **상대 잔차 게이트**(외삽 앵커 이동 ≤ ratio × max(관측 잔차,
 *   그 라운드 탐색 반경), 전부 셀 단위 — 절대 픽셀 금지). 정합 상관 문턱과 하류 CS
 *   게이트(0.78/0.035)는 **한 값도 완화하지 않는다**.
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
  // v1r2 패밀리 (n=21 A/B 후보). false 로 끄면 벤치에서 순수 v0/v2r2 기준선을 잰다.
  v1r2Family: true,
  // v0X 패밀리 (n=21 3파전 후보). false 로 끄면 v0X 편입 전 기준선을 잰다.
  v0xFamily: true,
  // v0X 시딩 게이트 — 사각 링 동반자(120° 회전 위치의 다른 K5 코어)를 요구한다.
  // false 면 반경 스냅만으로 시드한다(게이트 실패 모드 비교용).
  v0xRequireSquareRing: true,
  // 사각 링 동반자 판정 허용폭 — 반경 비 ±18% · 120° 에서 ±18°.
  squareRingRadiusTolerance: 0.18,
  squareRingAngleToleranceDeg: 18,
  // ── 부분 앵커 포즈 (§7) — 프레임 밖으로 나간 앵커를 레이아웃 지식으로 외삽한다.
  // false 로 끄면 잘림 도입 전(엄격 4앵커) 기준선을 그대로 잰다.
  partialAnchorPose: true,
  // 부분 정합을 시도할 최소 in-frame 비율. 이 아래면 «관측 없음»(외삽 대상)이다.
  partialMinimumCoverage: 0.3,
  // 완성 포즈를 세우는 데 필요한 **관측된** 앵커 최소 수 (중앙 + 코너, 서로 다른 자리).
  partialMinimumAnchors: 2,
  // 라운드 3 최소제곱에 필요한 관측 서브앵커 최소 수 / 호모그래피(8dof)로 올릴 문턱.
  partialMinimumSubAnchors: 4,
  partialHomographySubAnchors: 8,
  // 외삽 앵커 이동 허용 배수 — 관측 잔차(또는 그 라운드의 탐색 반경) 대비 **상대값**.
  partialResidualRatio: 1.5,
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
    // 구 v2r2 중앙(닫힌 동심 육각 링 스택) — **소각된 디자인** (2026-08-16 중앙 개정).
    // 분류는 법의학 진단용으로만 남긴다. 어떤 조립도 이 kind 를 소비하지 않으므로
    // 구 디자인 인쇄물은 포즈 0 → 복호 불가로 차단된다.
    return {
      kind: 'legacy-v2r2-center', x: center.x, y: center.y, u: t1Median,
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
      // 구(소각) v2r2 중앙 링 스택(1:2:3)이 K3 불스아이(2:3)로 위장하는 것을 걸러낸다 —
      // 2026-08-16 중앙 통일 후에도 구 디자인 인쇄물 차단 가드로 유지한다.
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
    // mid(1) 면은 이진 기대값이 없다 — 밝음/어두움 어느 쪽으로 눌러도 Pearson 을
    // 편향시키므로 패치에서 뺀다. **현재 정본 넷에는 mid 면이 하나도 없어 이 분기는
    // 한 번도 타지 않는다** (v0X 정규화 2026-08-16 이전에는 4면이 해당했다).
    // cellSurfaceFinal.buildLocatorCells 가 로드 시점에 mid 를 막으므로 사실상
    // 도달 불가지만, 정본이 다시 mid 를 얻는 날 패치가 조용히 편향되지 않도록 남긴다.
    if (cell[face] === 1) continue;
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

/**
 * 레이아웃별 블록 경계 — [중앙 블록 상한, 먼 코너 하한, 엣지 블록(있으면)].
 * v0 · v1r2 는 네 코너 블록이라 NE(i 작음·j 큼)·SW(i 큼·j 작음) 엣지도 정본이고,
 * 그 6 패치가 최소제곱 재적합의 스프레드를 넓힌다. v2r2 는 두 블록뿐이다.
 */
function blockLimitsFor(n, layoutId) {
  if (layoutId === 'v0x') {
    // NW (0..3)² 16 · SE (15..20)² 36 · NE (0..1)×(18..20) 6 · SW (18..20)×(0..1) 6.
    // (14,20) 단독 셀은 패치가 아니다 — 1점 패치는 Pearson 최소 6점(registerPatch)을
    // 못 채워 subPatch 경로가 null 이 되고, refineWithSubPatches 가 round-3 최소제곱
    // 재적합 없이 base 포즈로 폴백한다 (포즈가 죽는 게 아니라 정밀도만 잃는다 —
    // 적대 검증 실측: 1점 subPatch 주입 전후 poseCount·shapeCount 동일). 그래서 배제.
    return {
      nearLimit: 3,
      farLimit: 15,
      edges: Object.freeze([
        Object.freeze({ iMax: 1, jMin: 18 }),
        Object.freeze({ iMin: 18, jMax: 1 }),
      ]),
    };
  }
  if (layoutId === 'v1r2') {
    return {
      nearLimit: 4,
      farLimit: 16,
      edges: Object.freeze([
        Object.freeze({ iMax: 3, jMin: 16 }),
        Object.freeze({ iMin: 16, jMax: 3 }),
      ]),
    };
  }
  if (n === 13) {
    return {
      nearLimit: 2,
      farLimit: 10,
      edges: Object.freeze([
        Object.freeze({ iMax: 1, jMin: 10 }),
        Object.freeze({ iMin: 10, jMax: 1 }),
      ]),
    };
  }
  // v2r2 — 중앙 블록 A 가 v1r2 NW 5×5 공유로 개정(2026-08-16)돼 상한이 4 다.
  return { nearLimit: 4, farLimit: n - 7, edges: Object.freeze([]) };
}

function inEdgeBlock(cell, box) {
  if (box.iMax !== undefined && cell.i > box.iMax) return false;
  if (box.iMin !== undefined && cell.i < box.iMin) return false;
  if (box.jMax !== undefined && cell.j > box.jMax) return false;
  if (box.jMin !== undefined && cell.j < box.jMin) return false;
  return true;
}

function patchesFor(n, layoutId = undefined) {
  const key = (layoutId || 'default') + '@' + n;
  if (patchCache.has(key)) return patchCache.get(key);
  const cells = locatorCellsCellSurfaceFinal(n, layoutId);
  const { nearLimit, farLimit, edges: edgeBoxes } = blockLimitsFor(n, layoutId);
  const centreParts = YFACE_LIST.map((face) =>
    buildPatch(cells, face, (cell) => cell.i <= nearLimit && cell.j <= nearLimit));
  const corners = YFACE_LIST.map((face) =>
    buildPatch(cells, face, (cell) => cell.i >= farLimit && cell.j >= farLimit));
  const edges = YFACE_LIST.flatMap((face) =>
    edgeBoxes.map((box) => buildPatch(cells, face, (cell) => inEdgeBlock(cell, box))))
    .filter((patch) => patch !== null);
  const built = {
    centre: mergePatches(centreParts),
    corners,
    // 최소제곱 재적합용 서브앵커 — 면별 중앙 3 + 면별 먼 코너 3 (+ v0·v1r2 엣지 6).
    subPatches: [...centreParts, ...corners, ...edges],
    all: mergePatches(YFACE_LIST.map((face) => buildPatch(cells, face, () => true))),
  };
  patchCache.set(key, built);
  return built;
}

/** 기존 호출 형태 유지 — n 의 **기본** 레이아웃 패치. */
function patchesForN(n) {
  return patchesFor(n, undefined);
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
 *
 * `options` 없이 부르면 **기존 계약 그대로**다 (커버리지 0.8 · 오프셋마다 표본 재계산).
 * 부분 앵커 경로만 options 를 준다:
 *   · `minCoverage` — in-frame 비율 하한을 낮춘다 (잘린 블록의 남은 조각으로 정합).
 *   · `lockSubset`  — **표본 집합을 오프셋 전 구간에서 고정**한다. 이게 없으면 프레임
 *     경계 근처에서 «안쪽으로 미는 오프셋일수록 점이 많다» 는 편향이 생겨 Pearson 이
 *     오프셋끼리 비교 불가능해진다 (점이 적을수록 상관이 우연히 커진다). 고정 집합은
 *     투영점이 탐색 반경 + 탭 만큼 여유를 두고 프레임 안에 있는 점들만 쓴다.
 */
function registerPatch(luma, H, patch, rangePx, stepPx, options = null) {
  const minCoverage = options && Number.isFinite(options.minCoverage)
    ? options.minCoverage : 0.8;
  const lockSubset = options ? options.lockSubset === true : false;
  const projected = [];
  for (const point of patch.points) {
    const image = projectPoint(H, point);
    if (!image) return null;
    projected.push({ x: image.x, y: image.y, expected: point.expected });
  }
  // 모듈당 5-탭(중심 + 십자 0.18셀) 평균 — 픽셀 격자 앨리어싱을 눌러 정합 봉우리를 안정화.
  const cellPx = localCellPx(H);
  const tap = Number.isFinite(cellPx) ? 0.18 * cellPx : 0;
  let usable = projected;
  if (lockSubset) {
    const pad = rangePx + tap + 1;
    usable = projected.filter((point) =>
      point.x - pad >= 0 && point.y - pad >= 0
      && point.x + pad < luma.width - 1 && point.y + pad < luma.height - 1);
    if (usable.length < Math.max(6, Math.floor(projected.length * minCoverage))) return null;
  }
  const requiredCount = lockSubset
    ? usable.length
    : Math.max(6, Math.floor(projected.length * minCoverage));
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
      for (const point of usable) {
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
      if (count < requiredCount) continue;
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
  return {
    offsetX,
    offsetY,
    correlation: best,
    coverage: projected.length > 0 ? usable.length / projected.length : 0,
    usedPoints: usable.length,
  };
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

/**
 * 2점 이상 최소제곱 **similarity** (회전 + 등방 스케일 + 평행이동, 4 dof).
 *
 * 부분 앵커 완성의 기본 모델이다. 이유 — 관측 앵커가 2~3개면 호모그래피(8 dof)는
 * 미결정이고 아핀(6 dof)도 3점에서 **정확 적합**이라 잔차가 항등 0 이 된다. 잔차가
 * 0 이면 «완성이 얼마나 억지인가» 를 잴 수가 없다. similarity 는 3점에서 6식 4미지수라
 * **과결정**이고, 그래서 §7 의 상대 잔차 게이트가 실제로 값을 갖는다. 또 전단·뒤집힘이
 * 구조적으로 불가능해 외삽이 «레이아웃을 회전·확대해 놓는 것» 이상을 못 한다.
 */
function similarityLeastSquares(canonicalPoints, imagePoints) {
  const count = canonicalPoints.length;
  if (count < 2 || imagePoints.length !== count) return null;
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
  let numeratorA = 0;
  let numeratorB = 0;
  let denominator = 0;
  for (let k = 0; k < count; k += 1) {
    const cx = canonicalPoints[k].x - meanCx;
    const cy = canonicalPoints[k].y - meanCy;
    const ix = imagePoints[k].x - meanIx;
    const iy = imagePoints[k].y - meanIy;
    numeratorA += cx * ix + cy * iy;
    numeratorB += cx * iy - cy * ix;
    denominator += cx * cx + cy * cy;
  }
  if (!(denominator > EPSILON)) return null;
  const a = numeratorA / denominator;
  const b = numeratorB / denominator;
  if (!(Math.hypot(a, b) > EPSILON)) return null;
  const out = new Float64Array(9);
  out[0] = a;
  out[1] = -b;
  out[2] = meanIx - (a * meanCx - b * meanCy);
  out[3] = b;
  out[4] = a;
  out[5] = meanIy - (b * meanCx + a * meanCy);
  out[6] = 0;
  out[7] = 0;
  out[8] = 1;
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
// 6. 조립 — 2차 앵커 조기 분기 (2026-08-16 중앙 통일):
//    K3 중앙 × K5 원거리 코어 쌍 → 앵커드 패밀리(v2r2@21/25 · v1r2),
//    앵커드 포즈가 없는 중앙만 v0 360° 회전 스윕.
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

function refinePoseStrict(luma, H0, patches, cfg) {
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

// ─────────────────────────────────────────────────────────────────────────
// 6b. 부분 앵커 포즈 — 프레임 밖으로 나간 앵커를 레이아웃 지식으로 외삽한다.
//
// **왜 필요한가 (측정)**: 잘린 프레임에서 죽는 곳은 실루엣도 RS 도 아니고 여기다.
// registerPatch 는 투영점의 80% 이상이 프레임 안에 있어야 상관을 내고,
// refineHomographyWithPatches 는 4 앵커를 **전부** 정합해야 한다
// (`if (!registered) return null`). 코너 하나가 5% 잘리면 그 면 코너 패치의 in-frame
// 비율이 67% 로 떨어지고 → 패치 null → 포즈 null → 그 프레임의 참 기하가 아예
// 만들어지지 않는다. 실측(v0X@21 corner-se, 시드 similarity 기준 커버리지):
//   qz 100/100/100/100 · 5% 100/100/67/100 · 10% 100/100/33/100 · 15%·20% 100/100/0/100.
// 잘림 축이 0/9 로 전멸하던 이유가 이 한 줄이다.
//
// **설계**
//   ① 엄격 경로가 성공하면 그대로 쓴다 — 그 경우 동작은 한 비트도 바뀌지 않는다.
//      («클린 프레임이면 안 바뀐다» 가 아니다. 클린 프레임에서도 데이터 필드의 헛
//      시드는 엄격 경로를 실패시키고 앵커를 프레임 밖으로 던져 부분 가지를 연다 —
//      실측 v0X 클린 attempted 7 · completed 2. 지켜지는 성질은 «가지가 안 열린다»
//      가 아니라 «최종 판정이 같다» 이고, 그건 테스트가 on/off 로 단언한다.)
//   ② 엄격 경로가 실패했고, **앵커 투영이 실제로 프레임 밖으로 나간 증거**가 있을 때만
//      부분 경로를 연다. 저대비·오정합으로 죽은 패치는 여기 오지 않는다 (부분 경로는
//      «잘림» 의 구제이지 정합 품질 완화가 아니다).
//   ③ 관측 앵커 ≥ 2 (서로 다른 자리) → similarity 최소제곱. 빠진 앵커는 모델이
//      **레이아웃 좌표로 예측**한다 — 프레임 밖 외삽 코너를 허용한다.
//   ④ 상대 잔차 게이트(§ residualGate): 외삽 앵커가 완성 전 포즈에서 움직인 거리를
//      **관측 잔차 대비 상대값**으로 잰다. 절대 픽셀은 쓰지 않는다.
//   ⑤ 수용은 여전히 CS 게이트(0.78/0.035)가 결정한다 — 완화 0.
// ─────────────────────────────────────────────────────────────────────────

/** 앵커 패치 투영이 프레임 밖으로 나갔는가 — 부분 경로의 발동 조건(잘림 증거). */
function anchorsLeaveFrame(luma, H, patches) {
  for (const patch of [patches.centre, ...patches.corners]) {
    for (const point of patch.points) {
      const image = projectPoint(H, point);
      if (!image) return true;
      if (image.x < 1 || image.y < 1
        || image.x >= luma.width - 1 || image.y >= luma.height - 1) return true;
    }
  }
  return false;
}

/**
 * 상대 잔차 게이트 — 외삽 앵커의 이동량을 **관측 잔차 대비**로 잰다.
 *
 * `observedResidual` = 완성 H 아래 관측 앵커의 RMS 재투영 잔차(셀 단위).
 * `extrapolationDrift` = 외삽 앵커가 완성 전 H 대비 움직인 최대 거리(셀 단위).
 * 바닥값은 **그 라운드의 탐색 반경**이다 — 정합이 원래 허용하는 이동 규모라
 * 임의 상수가 아니고, 셀 단위라 cell_px 에 의존하지 않는다 (절대 픽셀 금지 조항).
 *
 * 관측 앵커가 2개면 similarity 가 정확 적합이라 관측 잔차가 0 이고, 그때는 바닥값
 * 하나가 게이트를 쥔다. 3개 이상이면 과결정이라 잔차가 실제 값을 갖는다.
 */
function residualGate(observedResidual, extrapolationDrift, rangeCells, cfg) {
  const scale = Math.max(observedResidual, rangeCells);
  return extrapolationDrift <= cfg.partialResidualRatio * scale;
}

/**
 * 앵커 패치들을 «관측 / 외삽» 으로 나눈다.
 * 관측 = 엄격 정합 성공, 또는 `partialMinimumCoverage` 이상이 프레임 안에 남아
 * 고정 표본 집합으로 정합에 성공한 것.
 */
function classifyPatchRegistrations(luma, H, patchList, rangePx, stepPx, cfg) {
  const observed = [];
  const extrapolated = [];
  let correlationSum = 0;
  let worst = Infinity;
  let partialCount = 0;
  for (const patch of patchList) {
    let registered = registerPatch(luma, H, patch, rangePx, stepPx);
    let partial = false;
    if (!registered) {
      registered = registerPatch(luma, H, patch, rangePx, stepPx, {
        minCoverage: cfg.partialMinimumCoverage,
        lockSubset: true,
      });
      partial = registered !== null;
    }
    const projectedAnchor = projectPoint(H, patch.anchor);
    if (!projectedAnchor) return null;
    if (!registered) {
      extrapolated.push({ patch, seedImage: projectedAnchor });
      continue;
    }
    if (partial) partialCount += 1;
    observed.push({
      patch,
      seedImage: projectedAnchor,
      image: {
        x: projectedAnchor.x + registered.offsetX,
        y: projectedAnchor.y + registered.offsetY,
      },
      correlation: registered.correlation,
    });
    correlationSum += registered.correlation;
    worst = Math.min(worst, registered.correlation);
  }
  return { observed, extrapolated, correlationSum, worst, partialCount };
}

/** 관측 앵커의 RMS 재투영 잔차(셀 단위) — 완성 모델이 관측을 얼마나 못 맞췄나. */
function observedResidualCells(H, observed, cellPx) {
  if (observed.length === 0 || !(cellPx > 0)) return Infinity;
  let sum = 0;
  for (const entry of observed) {
    const predicted = projectPoint(H, entry.patch.anchor);
    if (!predicted) return Infinity;
    sum += (predicted.x - entry.image.x) ** 2 + (predicted.y - entry.image.y) ** 2;
  }
  return Math.sqrt(sum / observed.length) / cellPx;
}

/** 외삽 앵커가 완성 전 포즈 대비 움직인 최대 거리(셀 단위). */
function extrapolationDriftCells(H, extrapolated, cellPx) {
  if (!(cellPx > 0)) return Infinity;
  let worst = 0;
  for (const entry of extrapolated) {
    const predicted = projectPoint(H, entry.patch.anchor);
    if (!predicted) return Infinity;
    worst = Math.max(worst, Math.hypot(
      predicted.x - entry.seedImage.x, predicted.y - entry.seedImage.y,
    ) / cellPx);
  }
  return worst;
}

/** 관측 앵커가 서로 다른 자리를 차지하는가 — 한 점에 뭉친 2개는 포즈를 못 세운다. */
function anchorsAreDistinct(observed) {
  for (let a = 0; a < observed.length; a += 1) {
    for (let b = a + 1; b < observed.length; b += 1) {
      const left = observed[a].patch.anchor;
      const right = observed[b].patch.anchor;
      if (Math.hypot(left.x - right.x, left.y - right.y) > 1) return true;
    }
  }
  return false;
}

/** 부분 앵커 라운드 — 4앵커(중앙 + 면별 먼 코너 3) 중 관측된 것만으로 완성한다. */
function refineAnchorsPartial(luma, H, patches, rangeCells, stepCells, cfg) {
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return null;
  const classified = classifyPatchRegistrations(
    luma, H, [patches.centre, ...patches.corners],
    rangeCells * cellPx, Math.max(0.5, stepCells * cellPx), cfg,
  );
  if (!classified) return null;
  const { observed, extrapolated } = classified;
  if (observed.length < cfg.partialMinimumAnchors) return null;
  if (!anchorsAreDistinct(observed)) return null;
  const canonicalPoints = observed.map((entry) => entry.patch.anchor);
  const imagePoints = observed.map((entry) => entry.image);
  const completed = extrapolated.length === 0
    ? (observed.length === 4
      ? estimateHomography4(canonicalPoints, imagePoints)
      : similarityLeastSquares(canonicalPoints, imagePoints))
    : similarityLeastSquares(canonicalPoints, imagePoints);
  if (!completed) return null;
  const residual = observedResidualCells(completed, observed, cellPx);
  const drift = extrapolationDriftCells(completed, extrapolated, cellPx);
  if (!residualGate(residual, drift, rangeCells, cfg)) return null;
  return {
    H: completed,
    meanCorrelation: classified.correlationSum / observed.length,
    worstCorrelation: classified.worst,
    anchorCount: observed.length,
    extrapolatedCount: extrapolated.length,
    partialCount: classified.partialCount,
    observedResidual: residual,
    extrapolationDrift: drift,
  };
}

/** 부분 앵커 라운드 3 — 서브앵커 중 관측된 것만으로 최소제곱 재적합. */
function refineSubPatchesPartial(luma, H, patches, cfg) {
  const cellPx = localCellPx(H);
  if (!Number.isFinite(cellPx) || cellPx <= 0.5) return null;
  const rangeCells = 0.5;
  const classified = classifyPatchRegistrations(
    luma, H, patches.subPatches, rangeCells * cellPx, Math.max(0.5, 0.125 * cellPx), cfg,
  );
  if (!classified) return null;
  const { observed, extrapolated } = classified;
  if (observed.length < cfg.partialMinimumSubAnchors) return null;
  const canonicalPoints = observed.map((entry) => entry.patch.anchor);
  const imagePoints = observed.map((entry) => entry.image);
  // 관측 서브앵커가 충분히 많을 때만 8 dof 를 푼다. 적을 때 호모그래피를 풀면
  // 원근 항이 관측 잡음을 그대로 먹어 외삽 코너가 크게 튄다 (전단·뒤집힘 가능).
  const completed = observed.length >= cfg.partialHomographySubAnchors
    ? (homographyLeastSquares(canonicalPoints, imagePoints)
      || similarityLeastSquares(canonicalPoints, imagePoints))
    : similarityLeastSquares(canonicalPoints, imagePoints);
  if (!completed) return null;
  const residual = observedResidualCells(completed, observed, cellPx);
  const drift = extrapolationDriftCells(completed, extrapolated, cellPx);
  if (!residualGate(residual, drift, rangeCells, cfg)) return null;
  return {
    H: completed,
    meanCorrelation: classified.correlationSum / observed.length,
    worstCorrelation: classified.worst,
    anchorCount: observed.length,
    extrapolatedCount: extrapolated.length,
    observedResidual: residual,
    extrapolationDrift: drift,
  };
}

function refinePosePartial(luma, H0, patches, cfg) {
  const round1 = refineAnchorsPartial(
    luma, H0, patches, cfg.registrationRangeCells, cfg.registrationStepCells, cfg,
  );
  // 정합 품질 게이트는 엄격 경로와 **같은 값**을 쓴다 — 부분 경로는 잘림 구제이지
  // 상관 문턱 완화가 아니다.
  if (!round1 || round1.worstCorrelation < cfg.minimumPatchCorrelation) return null;
  const round2 = refineAnchorsPartial(
    luma, round1.H, patches, cfg.registrationRange2Cells, cfg.registrationStep2Cells, cfg,
  );
  const base = round2 && round2.meanCorrelation >= round1.meanCorrelation ? round2 : round1;
  const round3 = refineSubPatchesPartial(luma, base.H, patches, cfg);
  const chosen = round3 && round3.meanCorrelation >= base.meanCorrelation - 0.05
    ? round3 : base;
  return {
    ...chosen,
    partial: {
      anchorCount: base.anchorCount,
      extrapolatedCount: base.extrapolatedCount,
      subAnchorCount: round3 ? round3.anchorCount : null,
      observedResidual: chosen.observedResidual,
      extrapolationDrift: chosen.extrapolationDrift,
    },
  };
}

/**
 * 포즈 정제 — 엄격 4앵커 경로가 먼저다. 실패했고 **앵커가 프레임 밖으로 나갔을 때만**
 * 부분 앵커 완성으로 내려간다.
 *
 * ⚠ «클린 프레임에서는 두 번째 가지가 아예 열리지 않는다» 고 적혀 있었으나 **거짓**이다
 * (2026-08-16 정정). 데이터 필드의 헛 시드(예: n=25 반경으로 스냅된 쌍)는 스케일이 틀려
 * 클린 이미지에서도 앵커를 프레임 밖으로 던진다 — 실측 v0X 클린 `attempted 7 ·
 * completed 2`, v2r2 `2 · 2`, v0@13 `1 · 1`, v1r2 `0 · 0`. 그렇게 선 포즈들은 하류
 * CS 게이트를 못 넘거나 패밀리 dedupe 에서 밀려 **최종 판정을 바꾸지 않는다**. 이 경로가
 * 지키는 성질은 «시도 0» 이 아니라 «판정 불변» 이고, 그쪽이 테스트로 고정돼 있다.
 */
function refinePose(luma, H0, patches, cfg, telemetry = null) {
  const strict = refinePoseStrict(luma, H0, patches, cfg);
  if (strict) return strict;
  if (cfg.partialAnchorPose === false) return null;
  if (!anchorsLeaveFrame(luma, H0, patches)) return null;
  if (telemetry) telemetry.attempted += 1;
  const partial = refinePosePartial(luma, H0, patches, cfg);
  if (telemetry && partial) {
    telemetry.completed += 1;
    telemetry.byAnchorCount[partial.partial.anchorCount] =
      (telemetry.byAnchorCount[partial.partial.anchorCount] || 0) + 1;
  }
  return partial;
}

/**
 * 앵커드 패밀리 후보표 — 중앙(K3)에서 K5 원거리 코어까지의 canonical 거리(셀).
 *   · v2r2: 블록 B 7×7 코어 중심 = 셀 (n−4,n−4) 중심 → (n−3.5) — 21→17.5 · 25→21.5.
 *   · v1r2: 면 T SE 5×5 코어 중심 = (17.5,17.5) → 18.0
 *     (셀 (c,c) 중심의 원점 거리 = (c+0.5)·u — 같은 규칙).
 * 스냅 허용폭 ±3.2셀 (마스크 침식이 u 를 부풀린다 — 종전 근거 유지).
 * v2r2@21(17.5)과 v1r2(18.0)는 거리로 갈라지지 않는다 — 둘 다 후보 포즈를 세우고
 * 수용은 CS 평가 게이트가 판정한다 (n=21 병행 평가 계약, formatIndex 불변).
 */
const ANCHOR_SNAP_CELLS = 3.2;
const V1R2_CORE_RADIUS_CELLS = 18;
const V1R2_N = 21;
const V2R2_RADII = Object.freeze([
  Object.freeze({ n: 21, radius: 17.5 }),
  Object.freeze({ n: 25, radius: 21.5 }),
]);

/**
 * v0X — SE (15..20)² 동심 사각의 암 2×2 코어 중심은 셀 경계 (18,18) 이라 중앙에서
 * **18.0셀**, v1r2 SE 5×5 코어와 같은 반경이다. 거리로는 안 갈라진다.
 *
 * **사각 링 서명 (측정, 2026-08-16 · 정본 정규화 2026-08-16 재측정)** — v0X SE 블록은
 * 3면 톤이 같아(정규화 전 35/36 → 지금 **36/36**, (19,19).R 복원) 세 면이
 * 각각 같은 K5 회문 코어를 낸다. 그래서 클린 프레임에서 'v2r2-corner' 히트가
 * **120° 간격 3개**로 뜬다 (재측정 2026-08-16: 각 150.1° · 30.2° · −90.0°,
 * r/u 18.55~18.65 — 정규화 전후 동일한 세 자리다).
 *
 * 판별자는 «코너 개수» 가 **아니라 동반자 쌍 수**다. 코너 수는 프레임마다 흔들린다
 * (재측정 2026-08-16, 6채널 clean/sCurve0.6/gamma0.7/gamma0.6/rot120/rot240:
 * v0X 3~4 · v1r2 0~2 · v2r2@21 1~4 · v0 0~2 — 회전·톤 프레임에서 데이터 필드의 우연
 * K5 가 코너로 올라온다). 반면 **동반자 쌍은 v0X 6~8, v1r2·v2r2·v0 는 전 채널 0** 이다.
 * 중앙 서명(K3)은 네 레이아웃이 공유하므로 판별에 쓸 수 없다.
 *
 * 이 동반자 조건을 **v0X 시딩 게이트로 쓴다** (cfg.v0xRequireSquareRing). 게이트를
 * 켜기 전에 실패 모드를 먼저 쟀다 — «저게인 면(R 0.52)의 코어가 먼저 죽어 동반자가
 * 0 이 되면 v0X 가 통째로 죽는다» 가 유일한 위험인데, 합성 측정에서는 일어나지 않았다:
 *   · 49-매트릭스(톤 7 × 회전 7) v0X 프레임 49/49 에서 동반자 쌍 ≥ 2 (최빈 4~8).
 *   · cell_px 7·8·9·10·12·15 × 채널 5 × 회전 3 × 2·3톤 = 180 프레임에서도 **v0X 포즈가
 *     0 인 프레임이 한 번도 없었다** (정규화 후 최소 3 · cell_px 별 최소 3~6; 정규화
 *     전에도 최소 3 — 이 축은 정규화에 안 움직인다). cell_px 7 은 이미 복호가
 *     흔들리는 자리인데도 신호는 남았다 — 동심 사각의 코어는 링보다 굵어 마지막까지 버틴다.
 *   · ⚠ 다만 **복호 자체는 cell_px 7 에서 정규화로 21/30 → 17/30 로 내렸다**
 *     (실패 단계는 frontend:no-grid-hypothesis — 로케이터가 아니라 그 앞이다).
 *     cell_px 8 이상은 30/30 불변. 자세한 귀속은 test/output/claude-v0x-normalize.md §5.
 * 반대편(게이트가 잡아 주는 것)도 쟀다 — 같은 하네스에서 v1r2 프레임의 헛 v0x 포즈
 * 98개 중 94개, v2r2@21 162개 중 113개, Type O/A 프레임의 헛 포즈 **28개 전부**가
 * 동반자 0 프레임에서 나왔다. 게이트가 없으면 n=21 프레임마다 refinePose 가 한 번씩
 * 더 돌아 복호 중앙값이 10~19% 오른다 (실측, §벤치).
 *
 * 게이트를 통과한 뒤에는 세 후보 코너 각각을 «면 T 의 먼 코너» 로 가정해 시드하고
 * (→ 120° 위상 3가설), 패치 Pearson 이 참 위상을 고른다.
 */
const V0X_CORE_RADIUS_CELLS = 18;
const V0X_N = 21;

/**
 * 코너 하나에 대해, 같은 중앙 기준으로 ±120° 회전 위치에 다른 코너가 있는지 센다.
 * 0..2. 결정성: corners 배열의 고정 순서로만 순회한다.
 */
function squareRingCompanions(centre, corner, corners, cfg) {
  const baseX = corner.x - centre.x;
  const baseY = corner.y - centre.y;
  const baseR = Math.hypot(baseX, baseY);
  if (!(baseR > EPSILON)) return 0;
  const baseAngle = Math.atan2(baseY, baseX);
  const angleTolerance = (cfg.squareRingAngleToleranceDeg * Math.PI) / 180;
  let found = 0;
  for (const turn of [1, -1]) {
    const wantAngle = baseAngle + (turn * 2 * Math.PI) / 3;
    for (const other of corners) {
      if (other === corner) continue;
      const dx = other.x - centre.x;
      const dy = other.y - centre.y;
      const r = Math.hypot(dx, dy);
      if (!(r > EPSILON)) continue;
      if (Math.abs(r - baseR) > cfg.squareRingRadiusTolerance * baseR) continue;
      let delta = Math.atan2(dy, dx) - wantAngle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      if (Math.abs(delta) > angleTolerance) continue;
      found += 1;
      break;
    }
  }
  return found;
}

/** 중앙+원거리 쌍의 similarity 시드 — canonical 대각 (0,−1)·radius → 코너.
 *  R·(0,−1) = w 에서 cos = −wy, sin = wx. */
function anchoredSimilaritySeed(centre, corner, factor, radiusCells) {
  const centreFull = liftPoint(centre, factor);
  const cornerFull = liftPoint(corner, factor);
  const scale = Math.hypot(cornerFull.x - centreFull.x, cornerFull.y - centreFull.y)
    / radiusCells;
  const wx = (cornerFull.x - centreFull.x) / (scale * radiusCells);
  const wy = (cornerFull.y - centreFull.y) / (scale * radiusCells);
  return similarityHomography(centreFull, scale, -wy, wx);
}

/**
 * 앵커드 조립 — 세 패밀리의 중앙이 같은 K3 서명을 공유하므로(2026-08-16 중앙 통일)
 * 패밀리·n 판별은 **2차 앵커(K5 원거리 코어)의 존재/부재**가 맡는다. 중앙 히트
 * 하나에서 세 패밀리를 순차 시도하지 않는다:
 *   · 거리 스냅이 맞는 중앙×코너 쌍 → 앵커드 패밀리 포즈. 허용폭 안 후보는
 *     **전부** 시드한다 (v2r2@21 · v2r2@25 · v1r2 각각 판정 — n=21 에선 보통 둘).
 *   · 시드는 2앵커 similarity (면 T 원거리 코어가 120° 위상을 즉시 확정 — 스윕 없음),
 *     4앵커 직접 DLT 는 refinePose 라운드 1·2, 6~12 서브앵커 최소제곱은 라운드 3.
 * 반환의 anchoredCentres 는 **앵커드 포즈가 실제로 선** 중앙 인덱스다 — v0 스윕
 * 조기 분기의 조건. 결정성: centres/corners 는 verified 정렬 순서로만 순회한다.
 */
function assembleAnchoredPoses(centres, corners, fullLuma, factor, cfg, telemetry = null) {
  const posesV2r2 = [];
  const posesV1r2 = [];
  const posesV0x = [];
  const anchoredCentres = new Set();
  let companionPairs = 0;
  for (let centreIndex = 0; centreIndex < centres.length; centreIndex += 1) {
    const centre = centres[centreIndex];
    for (const corner of corners) {
      const distance = Math.hypot(corner.x - centre.x, corner.y - centre.y);
      if (!(distance > 6 * centre.u)) continue;
      // v0-center 의 u 는 셀 크기다 (t1 = 2셀 → u = t1/2).
      const estimatedRadius = distance / Math.max(centre.u, EPSILON);
      // v2r2 — 허용폭 안 후보 **전부** 정합한다 (가장 가까운 n 단독 스냅 금지).
      // 톤 커브가 밝은 링을 침식하면 u 가 부풀어 21↔25 겹침 구간(18.3~20.7셀)에서
      // 오스냅되는데, 그때 진짜 n 포즈가 아예 시드되지 않아 프레임이 죽는다
      // (S-커브 0.6 rot135 실측). 대신 **쌍마다 정합 점수 최고 n 하나만 채택**한다 —
      // 잘못된 n 의 포즈는 CS 게이트가 어차피 기각하므로 순수한 하류 비용(shape 마다
      // n² 표본 CS 평가)일 뿐이고, 같은 쌍에서는 참 n 이 패치 Pearson 을 이긴다.
      // 동률은 앞선 후보(작은 n)가 이긴다 — 결정성.
      let bestV2r2 = null;
      for (const candidate of V2R2_RADII) {
        if (Math.abs(estimatedRadius - candidate.radius) > ANCHOR_SNAP_CELLS) continue;
        const H0 = anchoredSimilaritySeed(centre, corner, factor, candidate.radius);
        const refined = refinePose(fullLuma, H0, patchesForN(candidate.n), cfg, telemetry);
        if (refined && (bestV2r2 === null || refined.meanCorrelation > bestV2r2.score)) {
          bestV2r2 = {
            n: candidate.n,
            H: refined.H,
            score: refined.meanCorrelation,
            partial: refined.partial || null,
          };
        }
      }
      if (bestV2r2 !== null) {
        anchoredCentres.add(centreIndex);
        posesV2r2.push({
          family: 'v2r2',
          n: bestV2r2.n,
          H: bestV2r2.H,
          score: bestV2r2.score,
          partial: bestV2r2.partial,
          estimatedRadius,
        });
      }
      // v1r2 (n=21 A/B 후보) — cfg.v1r2Family === false 로 끄면 순수 기준선.
      if (cfg.v1r2Family !== false
        && Math.abs(estimatedRadius - V1R2_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const H0 = anchoredSimilaritySeed(centre, corner, factor, V1R2_CORE_RADIUS_CELLS);
        const refined = refinePose(fullLuma, H0, patchesFor(V1R2_N, 'v1r2'), cfg, telemetry);
        if (refined) {
          anchoredCentres.add(centreIndex);
          posesV1r2.push({
            family: 'v1r2',
            layoutId: 'v1r2',
            n: V1R2_N,
            H: refined.H,
            score: refined.meanCorrelation,
            partial: refined.partial || null,
            estimatedRadius,
          });
        }
      }
      // v0X (n=21 3파전 후보) — v1r2 와 같은 반경 18.0 이라 거리로는 안 갈라진다.
      // 가르는 것은 **사각 링 동반자**(3면 동일 SE 블록의 120° 쌍둥이 코어)다.
      if (cfg.v0xFamily !== false
        && Math.abs(estimatedRadius - V0X_CORE_RADIUS_CELLS) <= ANCHOR_SNAP_CELLS) {
        const companions = squareRingCompanions(centre, corner, corners, cfg);
        if (companions > 0) companionPairs += 1;
        if (companions === 0 && cfg.v0xRequireSquareRing !== false) continue;
        const H0 = anchoredSimilaritySeed(centre, corner, factor, V0X_CORE_RADIUS_CELLS);
        const refined = refinePose(fullLuma, H0, patchesFor(V0X_N, 'v0x'), cfg, telemetry);
        if (refined) {
          anchoredCentres.add(centreIndex);
          posesV0x.push({
            family: 'v0x',
            layoutId: 'v0x',
            n: V0X_N,
            H: refined.H,
            score: refined.meanCorrelation,
            partial: refined.partial || null,
            estimatedRadius,
            squareRingCompanions: companions,
          });
        }
      }
    }
  }
  return { posesV2r2, posesV1r2, posesV0x, anchoredCentres, companionPairs };
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

/**
 * v0 조립 — 조기 분기의 **폴백 가지**: anchoredCentres 에 든 중앙(앵커드 포즈가 선
 * 중앙)은 360°×4스케일 스윕을 건너뛴다. 세 패밀리 중앙 서명이 같아진 뒤(2026-08-16)
 * v1r2·v2r2 프레임에서 이 스윕이 헛돌던 문제(claude-v1r2-revival.md §5-③)의 해소.
 */
function assembleV0Poses(
  centres, anchoredCentres, reducedLuma, fullLuma, factor, cfg, telemetry = null,
) {
  const poses = [];
  const template = patchesForN(13).all;
  for (let centreIndex = 0; centreIndex < centres.length; centreIndex += 1) {
    if (anchoredCentres.has(centreIndex)) continue;
    const centre = centres[centreIndex];
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
      const refined = refinePose(fullLuma, H0, patchesForN(13), cfg, telemetry);
      if (!refined) continue;
      poses.push({
        family: 'v0',
        n: 13,
        H: refined.H,
        score: refined.meanCorrelation,
        partial: refined.partial || null,
        sweepCorrelation: bestCorr,
      });
    }
  }
  return poses;
}

// ─────────────────────────────────────────────────────────────────────────
// 7. shape 합성 — cube-detect 의 shape 계약(cellSurfaceOnly)으로 출력.
// ─────────────────────────────────────────────────────────────────────────

/**
 * 같은 패밀리 안의 **기하 중복 포즈** 를 걷어낸다 — k3·k5 클러스터가 같은 물리 앵커를
 * 겹으로 검증하면 사실상 같은 H 가 두 번 조립되고, 하류에서 shape 마다 CS 평가
 * (n² 표본 × 후보 레이아웃)가 돌아 복호 시간이 곱절이 된다 (2026-08-16 실측).
 * 판정: 같은 n 이고, 투영 원점과 투영 대각점(0,−10)이 각각 2셀 이내면 중복.
 * 입력은 score 내림차순이라 자리당 최고점 포즈가 남는다. 회전이 다른 포즈는 대각점이
 * 갈라져 살아남는다. 결정성: 고정 순서 순회.
 */
function dedupePosesByGeometry(poses) {
  const kept = [];
  const projected = [];
  for (const pose of poses) {
    const origin = projectPoint(pose.H, { x: 0, y: 0 });
    const probe = projectPoint(pose.H, { x: 0, y: -10 });
    const cellPx = localCellPx(pose.H);
    if (!origin || !probe || !Number.isFinite(cellPx)) continue;
    const isDuplicate = projected.some((seen, index) =>
      kept[index].n === pose.n
      && Math.hypot(seen.origin.x - origin.x, seen.origin.y - origin.y)
        <= 2 * Math.max(seen.cellPx, cellPx)
      && Math.hypot(seen.probe.x - probe.x, seen.probe.y - probe.y)
        <= 2 * Math.max(seen.cellPx, cellPx));
    if (isDuplicate) continue;
    kept.push(pose);
    projected.push({ origin, probe, cellPx });
  }
  return kept;
}

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
      // n=21 은 후보가 둘이라 로케이터 패밀리가 어느 쪽을 세웠는지 남긴다.
      // 수용은 여전히 CS 평가 게이트가 판정한다 (여기서 레이아웃을 못박지 않는다).
      layoutId: pose.layoutId || null,
      // 부분 앵커로 완성된 포즈면 그 사실과 근거 수치를 남긴다 (수용에는 관여하지
      // 않는다 — CS 게이트가 그대로 판정한다).
      partial: pose.partial || null,
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

  // 조기 분기 (2026-08-16 중앙 통일): 공유 K3 중앙 × K5 원거리 코어 쌍으로 앵커드
  // 패밀리를 먼저 세우고, 앵커드 포즈가 선 중앙은 v0 360° 스윕에서 뺀다.
  // 주의 — 같은 자리 중복 히트(k3·k5 클러스터가 같은 앵커를 각각 검증)를 위치
  // dedupe 로 걷어내는 안은 **측정으로 기각**했다: 중복이 차지하던 상위 슬롯에
  // 데이터 필드의 우연 K3 가 들어와, 실패 정합 + v0 스윕 비용이 중복 성공 정합보다
  // 비쌌다 (v1r2 클린 벤치 724→1620 ms). 상위 3/4 슬라이스가 사실상의 비용 캡이다.
  const centres = verified.filter((hit) => hit.kind === 'v0-center').slice(0, 3);
  const corners = verified.filter((hit) => hit.kind === 'v2r2-corner').slice(0, 4);
  const partialTelemetry = { attempted: 0, completed: 0, byAnchorCount: {} };
  const {
    posesV2r2, posesV1r2, posesV0x, anchoredCentres, companionPairs,
  } = assembleAnchoredPoses(centres, corners, luma, reduced.factor, cfg, partialTelemetry);
  const posesV0 = assembleV0Poses(
    centres, anchoredCentres, reduced.luma, luma, reduced.factor, cfg, partialTelemetry,
  );

  const shapes = [];
  for (const familyPoses of [posesV2r2, posesV1r2, posesV0x, posesV0]) {
    familyPoses.sort((left, right) =>
      // v0X 는 사각 링 동반자가 많은 포즈를 먼저 본다 (3면 동일 서명이 실재한다는 증거).
      (right.squareRingCompanions || 0) - (left.squareRingCompanions || 0)
      || right.score - left.score || left.n - right.n);
    for (const pose of dedupePosesByGeometry(familyPoses).slice(0, cfg.maximumPosesPerFamily)) {
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
      poseCount: {
        v2r2: posesV2r2.length,
        v1r2: posesV1r2.length,
        v0x: posesV0x.length,
        v0: posesV0.length,
      },
      // 사각 링 서명 관측 — 120° 동반자를 가진 (중앙, 코너) 쌍의 수.
      // v0X 프레임은 3면 동일 SE 블록이라 크고, v1r2·v2r2 프레임은 0 이 기대값이다.
      squareRing: { companionPairs },
      // 조기 분기 관측 — 몇 개의 K3 중앙이 앵커드로 분기했고 몇 개가 v0 스윕으로
      // 내려갔는지 (swept = centres − anchored).
      earlyBranch: {
        centres: centres.length,
        anchored: anchoredCentres.size,
        swept: centres.length - anchoredCentres.size,
      },
      // 부분 앵커 완성 관측 — attempted 는 «엄격 경로 실패 + 앵커가 프레임 밖» 인
      // 시드 수, completed 는 그중 상대 잔차 게이트까지 통과한 수.
      partialAnchor: {
        attempted: partialTelemetry.attempted,
        completed: partialTelemetry.completed,
        byAnchorCount: partialTelemetry.byAnchorCount,
      },
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
  patchesFor,
  assembleAnchoredPoses,
  squareRingCompanions,
  similarityLeastSquares,
  refineAnchorsPartial,
  refineSubPatchesPartial,
  anchorsLeaveFrame,
  residualGate,
});
