/**
 * adapter-locator.js — R2 정합(A3) 어댑터. **양쪽을 아는 유일한 파일.**
 *
 * 클린룸 조건 (운영자 2026-09-03): `src/r2/**` 기존 파일은 `src/decoder/**` 를
 * import 하지 않는다. 세션은 이 파일이 만든 detectInto/alignInto 를 **주입**으로만
 * 받는다. 이 파일 외의 r2 모듈은 이 어댑터를 import 하지 않는다.
 *
 * 잠긴 설계 (PM/029B §13):
 *   L1 로케이터 shape → 호모그래피 H 한 장으로 셀을 찍는다
 *   L2 estimateCubePose 금지
 *   L3 detectRectifyAnchors 금지
 *   L4 가시성 = 투영 모듈 quad 의 2D 부호넓이 부호
 *   L5 면 라벨(T/L/R)은 검출기가 실어 보낸다
 *   L6 채택 판정은 격자잠김비 F = 셀간분산/셀내분산
 */

import { CORNER_UNIT_OFFSETS } from '../hexgrid.js';
import {
  CELL_SURFACE_FINAL_ACTIVE_IDS,
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_NS,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from '../cellSurfaceFinal.js';
import {
  UNVERIFIED_CS_BLOCK_LOCATOR,
  detectCellSurfaceBlockShapes,
} from '../decoder/cellsurface-block-detect.js';
import { estimateHomography4, estimateHomographyN } from '../decoder/homography.js';
import { readFormatFromLocator } from '../decoder/locator-format.js';
import { Q15_ONE, createR2Params } from './params.js';
import { R2_SESSION_STATUS } from './session.js';

/** session.detectionOutput.family 에 싣는 Type Y 값. hex 팩 1..5 다음. */
export const A3_FAMILY_Y = 6;

/** faceLuma 슬롯 순서. 누적기 T=0, L=1, R=2 와 동일. */
export const FACE_LABELS = Object.freeze(['T', 'L', 'R']);

/** F 가 이 값 이상이면 align 게이트 통과. 붕괴 참조 2.6 의 위. */
export const GRID_LOCK_GATE_F = 10;

/** 봉우리로 세는 F 하한. 정지사진 양성 참조 2684 vs 중앙 8.7. */
export const GRID_LOCK_PEAK_F = 100;

/**
 * 로케이터에 선언하는 **중앙 창**. R2 는 라이브 스캐너이고 화면이 「코드를 프레임 안에
 * 맞춰 주세요」를 이미 요구하므로, 「찾는 블록이 중앙에 있다」는 계약을 선언할 수 있다.
 * 로케이터는 이 창 밖의 v0-center 후보를 **상위 컷을 다투기 전에** 뺀다
 * (`cellsurface-block-detect.js` 의 `inCentreWindow`). 미선언이면 그 필터가 항등이다.
 *
 * 🔴 **왜 필요한가** (2026-09-03 실측): 화면 촬영 프레임의 **모서리 QR 코드가 v0 불스아이
 * 점수를 1.000 으로 포화**시켜 `centres.slice(0,3)` 예산을 점거한다. 진짜 Type Y 중앙은
 * 0.81\~0.94 라 컷에서 잘리고, 그러면 **어댑터에는 큐브 후보가 도착조차 하지 않아**
 * `pickShape` 의 F 재정렬로도 못 고친다. 실측 (전수 438프레임, 조준 aim ≤ 0.25):
 *   y0 0/108 → 108/108 (aimError 2.332 → 0.040 · F 14.8 → 597.3)
 *   y2 45/110 → 97/110 · y1 84/111 → 110/111
 *
 * ⚠ **이 값은 성질이 아니라 «그 QR 이 어디 있었나» 로 정해졌다.** 사다리는
 * 1.0 / 0.95 / 0.90 에서 y0 이 **전부 0** 이고 0.75 에서만 산다 — y0 의 QR 이 (90, 81)
 * 이라 960 프레임에서 `960·cw/2 < 390`, 즉 **cw < 0.81** 이 경계이기 때문이다.
 * QR 이 더 안쪽에 있는 촬영에서는 이 창이 안 듣는다. 근본 처방은 **후보 순위가 위치가
 * 아니라 «그것이 코드인가» 를 재는 것**이고 그건 검출 축의 별도 과업이다 (PM/029B §15).
 *
 * ⚠ **못 덮는 축**: 로케이터 테스트는 `embed960` 으로 코드를 정중앙에 놓아
 * **「코드가 프레임 가장자리에 있을 때」를 구조적으로 시험하지 않는다.** 이 값에서는
 * 코드 중심이 프레임 중앙 75% 밖이면 R2 가 못 잡는다 (960 기준 x·y ∈ [120, 840]).
 *
 * ⚠ **이 값은 로케이터 기본값에서 «유도»한다 — 손으로 적은 사본이 아니다** (2026-09-04).
 * 잠깐 `0.75` 를 여기 직접 적어 뒀는데, 그 순간 같은 숫자가 두 곳에 살아 **어느 쪽도
 * 다른 쪽에서 유도하지 않는** 상태가 됐다. 나란히 유지하는 값은 반드시 어긋난다.
 * 계약을 바꿀 거면 `UNVERIFIED_CS_BLOCK_LOCATOR` 한 곳만 바꿔라.
 */
export const CENTRE_WINDOW_FRACTION = UNVERIFIED_CS_BLOCK_LOCATOR.centreWindowFraction;

/**
 * relocateEveryFrame=false 에서 F 가 게이트 미만인 프레임이 이 횟수 연속이면
 * 어댑터가 스스로 락을 푼다. 1 은 한 프레임 블러에 락을 버리고, 세션
 * hardDrop 보다 긴 N 은 조준 실수(QR 미끼)에 들러붙는다. 3 ≈ 100ms@30fps.
 * 세션 API 는 그대로다 — reset() 호출처는 없고 hardDrop 이 어댑터에 닿지 않는다.
 */
export const LOCK_MISS_LIMIT = 3;

/*
 * ── 🔴 락 신선도 (2026-09-06, 운영자 실기 3차 ①·④ · 레인 R 변경 R1) ──────────
 * 옛 거동: `relocateEveryFrame=false` 에서 `detectInto` 는 락이 있으면 **옛 H 를 그대로
 * 반환**했고, 락을 푸는 유일한 길이 `alignInto` 의 F 게이트였다. 그런데
 *   · F 는 정렬 감도가 약하다 (참 락 수백~수천 vs 게이트 10) — 조금 어긋나도 안 걸린다
 *   · `lockMisses` 가 **후보 C 개에 공유**돼 한 프레임에 C 번 증가하거나 0 으로 리셋됐다
 *     (세션마다 `alignInto` 를 부른다 — `session.js` 의 정합 호출)
 *   · 줌 변경은 R2 에 아무 신호도 주지 않아 옛 크롭 좌표의 H 로 락이 유지됐다
 * ⇒ 화면의 실루엣·격자가 줌/드랍/재락 뒤 안 움직인다.
 *
 * 여기서 고치는 축은 셋이다.
 *   (a) 락 설치 때의 **프레임 크기**를 기억하고 다른 크기가 오면 즉시 락을 푼다.
 *       줌 승격(960 ↔ 720/1440)이 곧 좌표계 교체이므로 이것이 가장 싼 신호다.
 *   (b) `lockMisses` 를 **프레임 단위**로 센다 — 아래 「프레임의 신원은 timestamp」 참조.
 *   (c) 락을 유지한 채 **주기적/조건부 재검출**을 돌려 새 shape 이 뚜렷이 다르면 다시 건다.
 */

/**
 * 락 유지 중 **무조건** 로케이터를 다시 돌리는 주기(프레임).
 *
 * ⚠ **값의 근거는 비용이다** (실측 2026-09-06, 이 워크트리 · 960px 코퍼스 y0/y1/y2,
 * 각 12프레임 강제 재검출): 재검출 1회의 중앙값이 **436\~1001 ms** (최대 1988 ms) 인 반면
 * 락 유지 fast path 는 **0.0007\~0.0024 ms/호출** 이다. 즉 재검출은 「초기 락 한 장」과
 * 같은 값이고, 운영자 실기의 7\~15 FPS(≈67\~140 ms/프레임)에서 **한 번이 5\~15 프레임을
 * 먹는다.** 그래서 주기를 듀티비로 정한다 — 중앙값 700 ms 를 12 fps 에 놓고
 *     duty = 700 ms / (N · 83 ms) ≤ 0.1  ⇒  N ≥ 84
 * 96 프레임(≈8 초 @12 fps, duty ≈ 7%)을 쓴다. 이것은 **안전망**이고, 실제로 자주 듣는
 * 것은 아래 F 조건과 (a) 프레임 크기 · (d) `invalidateLock()` 이다.
 *
 * ── ⚠ 이 수의 **측정 조건과 못 잰 축** (2026-09-06 검토 R3c) ────────────────
 * 위 436\~1001 ms 는 **부하 걸린 데스크톱의 단발값**이다. 같은 기계·무부하에서 4반복 최소를
 * 잰 `review3c-phase-bench` 로는 락 프레임이 n13 113 ms · n21 241 ms · n25 366 ms 로
 * **3\~4배 빠르다.** 즉 「중앙값 700 ms」는 상한 쪽 값이고, 96/24 는 그 상한 위에서 안전한
 * 쪽으로 고른 수다.
 * ⚠ **폰 실측 없음.** 운영자 실기의 7\~15 fps 는 프레임 간격만 관측된 것이고 재검출 1회의
 *   ms 는 폰에서 잰 적이 없다.
 * ⚠ **코퍼스에서 이 주기가 발동한 사례 0건**(DONE 전). 전 구간(seq·full·zoom·photos·sweep)에서
 *   96프레임 주기가 실제로 돈 것은 DONE 이후(y0#full relocates 4, 채택 0)뿐이다 —
 *   **이 값은 코퍼스로 검증된 적이 없다.**
 * ⇒ 재산정 경로: 시험판 패널의 `counters.relocates` 와 `phaseMs.detect`(아래 누적 수정 뒤)를
 *   실기 3차 재측정에서 같이 읽는다. 그 전까지 이 수는 «추정» 이다.
 */
export const RELOCATE_EVERY_FRAMES = 96;

/**
 * 재검출을 **연달아** 돌리지 않기 위한 최소 간격(프레임). F 가 반토막 난 채로
 * 머물면 아래 F 조건이 매 프레임 참이라, 이 간격이 없으면 재검출이 프레임을 통째로 먹는다.
 * 24 프레임(≈2 초 @12 fps)이면 최악의 경우에도 재검출 듀티비가 700/2000 ≈ 35% 로 묶인다.
 * ⚠ 이 최악은 「F 가 실제로 무너진」 상태에서만 오는데, 그때는 옛 락이 어차피 쓸모없다.
 * ⚠ 측정 조건·폰 미측정·코퍼스 미발동은 위 `RELOCATE_EVERY_FRAMES` 주석과 같다.
 *
 * 🔴 **이 간격은 락 직후에 걸지 않는다** (2026-09-06 검토 R3c, 결함 9). `installLock` 이
 * `framesSinceRelocate = 0` 으로 두면 락을 건 뒤 24프레임 동안 재검출이 금지돼, **락 걸고
 * 곧바로 F 가 무너지는** 실측 창(y2@066: 락 f2 · 붕괴 f6)에서 회복 경로가 통째로 잠긴다.
 * 그래서 `installLock` 은 이 값으로 **초기화**한다 — 「직전 재검출이 이미 간격만큼 전이다」.
 * 간격의 존재 이유는 「재검출을 연달아 돌리지 않는다」이지 「락 직후엔 못 돈다」가 아니다.
 */
export const RELOCATE_MIN_GAP_FRAMES = 24;

/**
 * 락 시점 F 대비 이 비율 **아래**로 떨어지면 재검출 후보가 된다. 절반은
 * 「F 는 정렬 감도가 약하다」는 실측(±0.5셀에서 F 가 20배 이상 붕괴)에서 온다 —
 * 2배 열화는 게이트(10)에 안 걸리면서도 격자가 밀렸다는 뜻이다.
 */
export const RELOCATE_F_FRACTION = 0.5;

/**
 * 새 shape 을 **채택**하는 기준: 실루엣 중심(canonical 원점)의 이동이 이 셀 수를 넘거나
 * n 이 바뀌면 `installLock`. 그보다 작으면 옛 락을 지킨다 — 잡음으로 매 재검출마다
 * 락 세대를 올리면 HUD 가 깜빡이고 세션이 흔들린다.
 */
export const RELOCATE_CENTRE_CELLS = 0.5;

/**
 * 🔴 재검출 **채택**의 세 번째 문 (2026-09-06 검토 R3c, 결함 6): 새 shape 의 F 가 지금 F 의
 * 이 배 이상이고 게이트(`GRID_LOCK_GATE_F`) 위면 채택한다.
 *
 * 왜 필요한가 (실측): 옛 채택 조건은 「n 이 바뀌었다 ∨ 중심이 0.5셀 넘게 움직였다」뿐이라
 * **스케일·회전·원근 드리프트를 채택할 수 없었다.** 실물 3회 프로브에서 채택 **0/3** 이고
 * (y1 111프레임 프로브 2회 318/297 ms · y2 60프레임 프로브 1회), 그 비용만 내고 두 번 다
 * 3프레임 뒤 미스 경로가 락을 걷었다. 즉 「재검출이 락을 안 흔든다」는 안정성의 증거가
 * 아니라 **한 번도 채택하지 않았다**는 뜻이었다.
 *
 * ⚠ **값 2 는 코퍼스로 고른 수가 아니다** — 「2배 열화는 격자가 밀렸다는 뜻」이라는
 * `RELOCATE_F_FRACTION = 0.5` 의 대칭이다(재검출 후보가 되는 문턱을 되돌리려면 그만큼
 * 좋아져야 한다). 실기 재측정에서 `counters.relocateAdopts` 를 같이 읽어 재산정한다.
 */
export const RELOCATE_ADOPT_F_RATIO = 2;

const MAX_N = 25;
const MAX_CELLS = MAX_N * MAX_N;

/**
 * 락 마진이 다투는 **라인업의 n 전부** — `cellSurfaceFinal` 에서 유도한다.
 *
 * 🔴 손 목록(`[13, 21, 25]`)을 적지 않는 이유: 그 셋은 오늘의 «살아 있는 레이아웃이 있는 n»
 * 이지 성질이 아니다. 드랍(`CELL_SURFACE_FINAL_DROPPED_IDS`)이 한 번 더 일어나거나 새 n 이
 * 편입되면(실제로 2026-08-25 에 n=25 가 슬롯 계열로 되살아났다) 손 목록만 옛 답을 계속 준다.
 * 그래서 **활성 id 의 허용 n 을 모아** `finalLayoutIdsForN` 이 비어 있지 않은 것만 남긴다 —
 * 「이 n 으로 락을 걸면 세션이 붙을 후보가 있나」가 곧 마진이 다툴 자격이다.
 *
 * `MAX_N` 상한은 어댑터 버퍼(`MAX_CELLS`)의 제약이라 여기서 같이 건다.
 */
export const LINEUP_NS = Object.freeze((() => {
  const seen = new Set();
  for (const id of CELL_SURFACE_FINAL_ACTIVE_IDS) {
    const ns = CELL_SURFACE_FINAL_NS[id];
    if (!ns) continue;
    for (const n of ns) seen.add(n);
  }
  return [...seen]
    .filter((n) => Number.isInteger(n) && n > 0 && n <= MAX_N && finalLayoutIdsForN(n).length > 0)
    .sort((a, b) => a - b);
})());
const SQRT3_HALF = Math.sqrt(3) / 2;
const F_WITHIN_FLOOR = 1e-32;
const AREA_EPS = 1;
const TAP_FRAC = 0.18;
const HOMOG_W_MIN = 1e-12;

// T, L, R 순 — ygrid FACE_BASIS 와 동일 (C1/C5, C5/C3, C3/C1).
const EI_X = new Float64Array([SQRT3_HALF, -SQRT3_HALF, 0]);
const EI_Y = new Float64Array([-0.5, -0.5, 1]);
const EJ_X = new Float64Array([-SQRT3_HALF, 0, SQRT3_HALF]);
const EJ_Y = new Float64Array([-0.5, 1, -0.5]);

const DLT_TUPLES = Object.freeze([
  Object.freeze([0, 2, 4]),
  Object.freeze([0, 2, 3, 5]),
  Object.freeze([0, 1, 3, 4]),
  Object.freeze([1, 2, 4, 5]),
]);

function copy9(src, dst) {
  for (let i = 0; i < 9; i += 1) dst[i] = src[i];
}

function canonicalCorner(index, n) {
  const c = CORNER_UNIT_OFFSETS[index];
  return { x: c.x * n, y: c.y * n };
}

/**
 * shape 계약(center + vertices[6])에서 H 를 복원한다. 생산 경로는 원점+6꼭짓점
 * 최소제곱. 4점 DLT(원점+세 spine T=C0, R=C2, L=C4) 는 N점이 퇴화할 때의 폴백.
 * @param {object} shape
 * @returns {Float64Array | null}
 */
export function homographyFromShape(shape) {
  if (!shape || !shape.center || !shape.vertices || shape.vertices.length !== 6) {
    return null;
  }
  const n = Number(shape.estimatedN);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  const verts = shape.vertices;
  for (let i = 0; i < 6; i += 1) {
    const v = verts[i];
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  }
  if (!Number.isFinite(shape.center.x) || !Number.isFinite(shape.center.y)) return null;

  // 생산 경로: pose.H 를 7점(원점+꼭짓점 6)으로 왕복 복원할 뿐이다.
  // shape.vertices 는 검출기가 pose.H 를 캐노니컬 코너에 투영해 만든 점이라
  // 흡수할 꼭짓점 잡음이 구조적으로 없다. H 품질 판정 채널은 F 단독이다.
  // 4점 DLT 는 가설1 의 존재 증명·N점 퇴화 폴백이다.
  const canonicalN = [{ x: 0, y: 0 }];
  const imageN = [{ x: shape.center.x, y: shape.center.y }];
  for (let k = 0; k < 6; k += 1) {
    canonicalN.push(canonicalCorner(k, n));
    imageN.push({ x: verts[k].x, y: verts[k].y });
  }
  const Hn = estimateHomographyN(canonicalN, imageN);
  if (Hn) return Hn;

  const spine = DLT_TUPLES[0];
  const Hspine = estimateHomography4(
    [
      { x: 0, y: 0 },
      canonicalCorner(spine[0], n),
      canonicalCorner(spine[1], n),
      canonicalCorner(spine[2], n),
    ],
    [shape.center, verts[spine[0]], verts[spine[1]], verts[spine[2]]],
  );
  if (Hspine) return Hspine;

  for (let t = 1; t < DLT_TUPLES.length; t += 1) {
    const idx = DLT_TUPLES[t];
    const canonical = [];
    const image = [];
    for (let k = 0; k < idx.length; k += 1) {
      canonical.push(canonicalCorner(idx[k], n));
      image.push(verts[idx[k]]);
    }
    const H = estimateHomography4(canonical, image);
    if (H) return H;
  }
  return null;
}

function hexSpan(shape) {
  const verts = shape.vertices;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 6; i += 1) {
    const v = verts[i];
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

function geometryOk(shape, width, height) {
  if (!shape || !shape.center || !shape.vertices || shape.vertices.length !== 6) {
    return false;
  }
  if (!Number.isFinite(shape.center.x) || !Number.isFinite(shape.center.y)) {
    return false;
  }
  for (let i = 0; i < 6; i += 1) {
    const v = shape.vertices[i];
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return false;
  }
  const span = hexSpan(shape);
  const limit = Math.min(width, height);
  if (!(span > 0) || !Number.isFinite(span) || span > limit) return false;
  return true;
}

/**
 * 후보 선택. preferN 일치는 동점 처리일 뿐 필터가 아니다 — 미끼가 그 라벨을
 * 자기신고한다. 1순위는 fOf(보통 격자잠김 F). score 하한은 y0 QR 미끼
 * (pickedScore 중앙 0.84) 를 못 가른다.
 */
function pickShape(shapes, preferN, width, height, fOf) {
  let best = null;
  let bestF = -Infinity;
  let bestPrefer = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < shapes.length; i += 1) {
    const shape = shapes[i];
    if (!geometryOk(shape, width, height)) continue;
    const f = fOf ? fOf(shape) : (shape.score || 0);
    const prefer = preferN > 0 && Number(shape.estimatedN) === preferN ? 1 : 0;
    const score = shape.score || 0;
    if (
      best === null
      || f > bestF
      || (f === bestF && prefer > bestPrefer)
      || (f === bestF && prefer === bestPrefer && score > bestScore)
    ) {
      best = shape;
      bestF = f;
      bestPrefer = prefer;
      bestScore = score;
    }
  }
  return best;
}

function layoutIdOf(shape) {
  const block = shape && shape.blockLocator;
  if (!block) return '';
  if (typeof block.layoutId === 'string' && block.layoutId) return block.layoutId;
  if (typeof block.family === 'string' && block.family) return block.family;
  return '';
}

function projectInto(H, x, y, out, offset) {
  const w = H[6] * x + H[7] * y + H[8];
  const scale = Math.max(1, Math.abs(H[8]));
  if (!Number.isFinite(w) || Math.abs(w) < HOMOG_W_MIN * scale) return 0;
  const inv = 1 / w;
  const px = (H[0] * x + H[1] * y + H[2]) * inv;
  const py = (H[3] * x + H[4] * y + H[5]) * inv;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return 0;
  out[offset] = px;
  out[offset + 1] = py;
  return 1;
}

function doubleArea(p) {
  return p[0] * p[3] - p[2] * p[1]
    + p[2] * p[5] - p[4] * p[3]
    + p[4] * p[7] - p[6] * p[5]
    + p[6] * p[1] - p[0] * p[7];
}

function canonicalXY(face, a, b, xy) {
  xy[0] = a * EI_X[face] + b * EJ_X[face];
  xy[1] = a * EI_Y[face] + b * EJ_Y[face];
}

function lumaScaleOf(luma) {
  if (luma instanceof Uint8Array) return 1 / 255;
  if (luma instanceof Uint16Array) return 1 / 65535;
  return 1;
}

function sample01(data, width, height, x, y, scale) {
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return NaN;
  const x0 = x | 0;
  const y0 = y | 0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const row0 = y0 * width;
  const row1 = y1 * width;
  const v00 = data[row0 + x0] * scale;
  const v10 = data[row0 + x1] * scale;
  const v01 = data[row1 + x0] * scale;
  const v11 = data[row1 + x1] * scale;
  const v0 = v00 + (v10 - v00) * fx;
  const v1 = v01 + (v11 - v01) * fx;
  return v0 + (v1 - v0) * fy;
}

function clearAlignOutput(output) {
  output.gatePassed = 0;
  output.weightQ15 = 0;
  output.mismatchCount = 0;
  output.matchCount = 0;
  output.visibleCount = 0;
  // 3d — 락이 없는 프레임은 «못 믿는다» 가 아니라 «잴 대상이 없다» 다. 0 이 기본값이어야
  // 락이 걷힌 프레임에서 옛 불신이 남아 세션의 미검출 경로를 막지 않는다.
  output.distrusted = 0;
}

/**
 * 세션에 주입할 detectInto / alignInto 쌍을 만든다.
 * 락 프레임에서만 로케이터를 돌리고, alignInto 핫 루프는 무할당이다.
 *
 * @param {object} [options]
 * @param {number} [options.n] 알려진 n. 로케이터 n 과 맞을 때 우선.
 * @param {boolean} [options.relocateEveryFrame] 측정용. true 면 매 프레임 로케이터.
 * @param {object} [options.locatorOptions] detectCellSurfaceBlockShapes 로 전달.
 *   `calibration.csBlockLocator` 를 주면 아래 중앙 창 기본값보다 우선한다.
 * @param {number|null} [options.centreWindow] 중앙 창 비율. 생략하면
 *   `CENTRE_WINDOW_FRACTION`, **`null` 이면 선언하지 않는다**(로케이터 항등).
 * @param {number} [options.gateF]
 * @param {number} [options.peakF]
 */
export function createA3Adapters(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const preferN = Number(opts.n) > 0 ? Number(opts.n) : 0;
  const relocateEveryFrame = opts.relocateEveryFrame === true;
  // 중앙 창을 **기본으로 선언**한다. 호출자가 `locatorOptions.calibration.csBlockLocator`
  // 로 직접 주면 그쪽이 이긴다 (`centreWindow: null` 로 끌 수도 있다).
  // ⚠ 중첩이 깊은 데엔 이유가 있다 — 로케이터의 `calibration(options)` 이
  // `options.calibration.csBlockLocator` 를 읽는다. 한 층 얕게 넣으면 **조용히 무시된다**
  // (통합자가 이 함정을 한 번 밟아 A/B 두 팔이 비트 동일로 나왔다).
  const suppliedLocator = opts.locatorOptions && typeof opts.locatorOptions === 'object'
    ? opts.locatorOptions
    : {};
  const suppliedCalibration = suppliedLocator.calibration && typeof suppliedLocator.calibration === 'object'
    ? suppliedLocator.calibration
    : {};
  const suppliedCsBlock = suppliedCalibration.csBlockLocator
    && typeof suppliedCalibration.csBlockLocator === 'object'
    ? suppliedCalibration.csBlockLocator
    : {};
  const centreWindow = opts.centreWindow === null ? null
    : (Number(opts.centreWindow) > 0 && Number(opts.centreWindow) <= 1
      ? Number(opts.centreWindow)
      : CENTRE_WINDOW_FRACTION);
  const locatorOptions = {
    ...suppliedLocator,
    calibration: {
      ...suppliedCalibration,
      csBlockLocator: {
        ...(centreWindow === null ? {} : { centreWindowFraction: centreWindow }),
        ...suppliedCsBlock,
      },
    },
  };
  const gateF = Number(opts.gateF) > 0 ? Number(opts.gateF) : GRID_LOCK_GATE_F;
  const peakF = Number(opts.peakF) > 0 ? Number(opts.peakF) : GRID_LOCK_PEAK_F;
  const params = createR2Params(opts.params);
  // R4 — 하한은 **params 에서 유도**한다. 여기 숫자를 적으면 같은 값이 두 곳에 살고
  // 어느 쪽도 다른 쪽에서 유도하지 않는다 (중앙 창에서 한 번 밟은 함정).
  const weightFloorQ15 = Math.max(
    0,
    Math.min(Q15_ONE, Math.trunc(Number(params.alignWeightFloorQ15) || 0)),
  );
  /*
   * 3d — 마진 하한도 **params 에서 유도**한다 (weightFloorQ15 와 같은 규율: 값이 두 곳에 살면
   * 어느 쪽도 다른 쪽에서 안 온다). 0 이면 마진 게이트가 항등이다 — 자에서 「마진 없음」 팔을
   * 만들어 R4 하한과 마진 게이트를 단독으로 가를 수 있어야 한다.
   */
  const lockMarginMin = Number.isFinite(Number(params.lockMarginMin))
    && Number(params.lockMarginMin) >= 0
    ? Number(params.lockMarginMin) : 0;
  const relocateEveryFrames = Number(opts.relocateEveryFrames) > 0
    ? Math.trunc(Number(opts.relocateEveryFrames)) : RELOCATE_EVERY_FRAMES;
  // 0 을 허용한다 — 자에서 「간격 없음」을 만들어야 재검출 채택 규칙을 단독으로 잴 수 있다.
  const relocateMinGapFrames = Number.isFinite(Number(opts.relocateMinGapFrames))
    && Number(opts.relocateMinGapFrames) >= 0
    ? Math.trunc(Number(opts.relocateMinGapFrames)) : RELOCATE_MIN_GAP_FRAMES;
  const relocateFFraction = Number(opts.relocateFFraction) > 0
    ? Number(opts.relocateFFraction) : RELOCATE_F_FRACTION;
  // 1 을 허용한다 — 「지금보다 나쁘지만 않으면 채택」을 자에서 만들 수 있어야 채택 규칙을 단독으로 잰다.
  const relocateAdoptFRatio = Number(opts.relocateAdoptFRatio) >= 1
    ? Number(opts.relocateAdoptFRatio) : RELOCATE_ADOPT_F_RATIO;
  // R6 — 포맷 읽기는 기본 on. `format: false` 로 끄면 옛 거동('H'/mask 0)이다.
  const formatEnabled = opts.format !== false;

  const H = new Float64Array(9);
  const savedH = new Float64Array(9);
  const quad = new Float64Array(8);
  const xy = new Float64Array(2);
  const fieldView = { width: 0, height: 0, data: null, alpha: null };

  const stats = {
    gridLockF: 0,
    lastAlignMs: 0,
    lastDetectMs: 0,
    n: 0,
    locked: 0,
    layoutId: '',
    shapeCount: 0,
    homographyOk: 0,
    /** 0/1 — 마지막 alignInto 가 제품 스캔순서를 탔나 (raster 폴백이면 0). */
    scanMapped: 0,
    /** R5 — 그때 실제로 매핑된 셀 수. 후보마다 자기 cellCount 여야 한다. */
    scanMappedCells: 0,
    // 락 설치·해제마다 1 증가 — HUD 가 «사영을 다시 할 프레임» 을 이 값의 변화로 안다 (2a).
    lockRevision: 0,
    /** 락 설치 시점의 프레임 크기. 다른 크기가 오면 락을 푼다 (R1a). */
    lockWidth: 0,
    lockHeight: 0,
    /** 락 설치 직후에 잰 F. 재검출 조건의 기준선 (R1c). */
    lockF0: 0,
    /**
     * 3d — **락 마진** `F_1위 / F_2위`. 라인업의 n 전부(`LINEUP_NS`)를 같은 실루엣에 붙여 F 를
     * 재고 1위와 2위의 비를 낸다. 락당 한 번(F 3회 ≈1.5 ms) 재고 그 락이 살아 있는 동안 유지된다.
     * **미측정은 `NaN`** 이다 — 「안 쟀다」와 「믿는다」를 안 섞는다. 후보가 하나뿐이거나 2위가
     * 0 이면 `+Infinity`(다툴 상대가 없다).
     */
    lockMargin: NaN,
    /** 3d — 마진 1위의 n. 락의 n 과 다르면 「집힌 라벨과 F 가 가리키는 라벨이 다르다」는 뜻이다. */
    lockMarginN: 0,
    /**
     * 3d — 마진 게이트 미달. «락은 있는데 그 격자를 못 믿는다» — 누적을 세우지 않고(weight 0)
     * HUD 가 불신 표시를 한다. 락 자체는 유지된다.
     * 회복 경로는 **이 플래그 자신**이 열어 준다 — `detectInto` 가 이것을 재검출 방아쇠로 쓰고
     * (`fStale`·`due` 로는 안 걸린다: 실측 y2-p9rot 62프레임 relocates 0), `relocateProbe` 의 채택문 ③′ 가
     * «마진이 하한을 넘는 후보» 를 받아 준다. 세션 쪽으로는 `alignInto` 가 `output.distrusted` 로 내려
     * COAST/DROPPED 를 굴리지 않게 한다 («코드를 놓쳤다» 와 «격자를 못 믿는다» 는 다른 축이다).
     */
    lockDistrusted: false,
    /** R7 — 누적 카운터. 프레임마다 리셋하지 않는다. */
    counters: {
      lockClears: 0,
      relocates: 0,
      relocateAdopts: 0,
      formatReads: 0,
      sizeClears: 0,
    },
    /** R7 — 프레임 단위 ms. detect 는 프레임의 첫 호출, align 은 후보 전체 합. */
    phaseMs: { detect: 0, align: 0 },
    /** R6 — 이번 락에 쓰인 포맷. source 'locator' 면 코드가 스스로 말한 값이다. */
    format: {
      source: 'default',
      eccName: '',
      maskIndex: 0,
      candidateCount: 0,
      formatWireVersion: 0,
      reason: '',
    },
  };

  let locked = 0;
  let gridN = 0;
  let lockScan = null;
  let lockMisses = 0;
  let floatScratch = null;
  let framesSinceLock = 0;
  let framesSinceRelocate = relocateMinGapFrames;

  /*
   * ── 락 마진 (3d) ──────────────────────────────────────────────────────────
   * 마진을 잴 때 쓰는 H 는 **사본**이다. 어댑터의 `H` 버퍼를 잠깐이라도 흔들면
   * `src/decoder/grid-sample.js` 의 두 캐시(LumaField 정체성 · H 객체 정체성)가 깨진다 —
   * 3c fix 7 이 `readFormatAt` 에서 같은 함정을 밟았다. 사본은 락당 한 번이라 비용이 없다.
   */
  const marginH = new Float64Array(9);
  /** 마지막 측정의 결과 — `noteLockMargin` 이 stats 로 올린다. */
  let marginRatio = NaN;
  let marginBestN = 0;
  /** 이 락에서 마진을 이미 쟀나. installLock/clearLock 이 0 으로 되돌린다. */
  let marginMeasured = 0;

  /*
   * ── 프레임의 신원은 `timestamp` 다 (R1b) ──────────────────────────────────
   * `alignInto` 는 **후보 세션마다** 불린다 (`session.js` 가 세션당 한 번). 옛 코드는
   * `lockMisses` 를 그 호출마다 세서 후보 5개면 한 프레임에 5 증가하거나 0 리셋됐다 —
   * `LOCK_MISS_LIMIT=3` 이 「3프레임」이 아니라 「반 프레임」이었다.
   *
   * 🟢 프레임 판정이 첫 호출로 확정된다는 근거: `computeGridLockF` 는 H·n·luma 만 쓰고
   * **레이아웃과 무관**하다. 그래서 한 프레임 안에서 모든 후보의 F 가 같은 값이고,
   * 「어느 후보가 게이트를 넘었나」는 「그 프레임이 넘었나」와 동치다. 아래 F 캐시가
   * 그 성질을 그대로 쓴다 (프레임당 1회 계산 — 후보 수만큼 아끼는 것이 덤이다).
   *
   * ⚠ 그래서 **자에서 timestamp 를 안 올리면 이 판정이 안 돈다** — 같은 stamp 로 N 번
   * 부르면 그것은 한 프레임이다. 라이브 rAF 는 항상 단조 증가한다.
   */
  let frameStamp = NaN;
  let frameJudged = 0;
  let fStamp = NaN;
  let fValue = 0;
  let fData = null;

  /** (n, layoutId, formatWire) → 스캔순서 좌표. 후보마다 자기 순서로 표본된다 (R5). */
  const scanMaps = new Map();

  function formatWireOf() {
    const wire = stats.format.formatWireVersion;
    return wire === 1 || wire === 2 ? wire : CELL_SURFACE_FINAL_FORMAT_WIRE;
  }

  function scanMapFor(n, layoutId, formatWire) {
    if (!(n > 0) || n > MAX_N) return null;
    const key = n + '|' + (layoutId || '') + '|' + formatWire;
    const cached = scanMaps.get(key);
    if (cached !== undefined) return cached;
    let entry = null;
    try {
      const scan = dataCellsInScanOrderCellSurfaceFinal(
        n, layoutId || undefined, formatWire,
      );
      const count = Math.min(scan.length, MAX_CELLS);
      const si = new Int16Array(count);
      const sj = new Int16Array(count);
      for (let k = 0; k < count; k += 1) {
        si[k] = scan[k].i;
        sj[k] = scan[k].j;
      }
      entry = { i: si, j: sj, count };
    } catch {
      entry = null;
    }
    // 키 공간이 (n 3종 × 레이아웃 ≤5 × wire 2) 라 상한이 30 이다 — 무한 성장이 아니다.
    scanMaps.set(key, entry);
    return entry;
  }

  function rebuildScanMaps(n, layoutId) {
    gridN = n;
    lockScan = scanMapFor(n, layoutId, formatWireOf());
  }

  function bindLuma(luma, width, height) {
    if (luma && luma.data instanceof Float32Array && luma.width === width) {
      return luma;
    }
    if (luma instanceof Float32Array) {
      fieldView.width = width;
      fieldView.height = height;
      fieldView.data = luma;
      fieldView.alpha = null;
      return fieldView;
    }
    const count = width * height;
    if (floatScratch === null || floatScratch.length !== count) {
      floatScratch = new Float32Array(count);
    }
    const scale = lumaScaleOf(luma);
    for (let i = 0; i < count; i += 1) floatScratch[i] = luma[i] * scale;
    fieldView.width = width;
    fieldView.height = height;
    fieldView.data = floatScratch;
    fieldView.alpha = null;
    return fieldView;
  }

  function installLock(nextH, n, layoutId, width, height) {
    copy9(nextH, H);
    stats.n = n;
    stats.layoutId = layoutId || '';
    stats.homographyOk = 1;
    locked = 1;
    stats.locked = 1;
    stats.lockRevision += 1;
    stats.lockWidth = Number(width) > 0 ? Math.trunc(Number(width)) : 0;
    stats.lockHeight = Number(height) > 0 ? Math.trunc(Number(height)) : 0;
    lockMisses = 0;
    framesSinceLock = 0;
    // 🔴 0 이 아니라 «간격만큼 전» 이다 (결함 9a) — 상수 주석의 유도 참조. 0 으로 두면 락 직후
    // 24프레임 동안 재검출이 잠겨, 락 걸고 곧바로 F 가 무너지는 창에서 회복 경로가 통째로 막힌다.
    framesSinceRelocate = relocateMinGapFrames;
    /*
     * 3d — 마진은 **락의 성질**이라 락이 바뀌면 미측정으로 돌아간다. `NaN` 으로 두는 것이 요점이다:
     * 「아직 안 쟀다」를 큰 수로 채우면 그 프레임은 «믿는다» 로 읽혀 게이트가 조용히 열린다.
     * 실제 측정은 이 함수 **바깥**(detect·relocate 의 설치 직전, 또는 첫 alignInto)이 하고
     * `noteLockMargin` 으로 싣는다 — 여기서 재면 프레임·휘도를 인자로 끌고 들어와야 한다.
     */
    stats.lockMargin = NaN;
    stats.lockMarginN = 0;
    stats.lockDistrusted = false;
    marginMeasured = 0;
    rebuildScanMaps(n, layoutId);
  }

  function clearLock() {
    if (locked) stats.counters.lockClears += 1;
    locked = 0;
    gridN = 0;
    lockScan = null;
    lockMisses = 0;
    stats.locked = 0;
    stats.lockRevision += 1;
    stats.n = 0;
    stats.layoutId = '';
    stats.homographyOk = 0;
    stats.scanMapped = 0;
    stats.scanMappedCells = 0;
    stats.lockWidth = 0;
    stats.lockHeight = 0;
    stats.lockF0 = 0;
    // 3d — 락이 없으면 마진도 없다. 「믿을 수 없다」가 아니라 「잴 대상이 없다」다.
    stats.lockMargin = NaN;
    stats.lockMarginN = 0;
    stats.lockDistrusted = false;
    marginMeasured = 0;
    framesSinceLock = 0;
    H.fill(0);
  }

  /**
   * R1(d) — **락만** 푼다. 세션·증거·후보는 건드리지 않는다. 줌 커밋처럼
   * 「좌표계가 바뀌었다」를 바깥이 아는 순간에 부른다 (레인 H 계약).
   */
  function invalidateLock() {
    if (!locked) return 0;
    clearLock();
    return 1;
  }

  /**
   * R6 — 락 시점에 **한 번** 포맷 워드를 읽는다. 실패는 조용히 기본값('H'/mask 0)이다.
   *
   * 🔴 왜 필요한가: 옛 R2 는 ecc 'H' · mask 0 을 못박았고 (`r2-scan-runtime.js` 의
   * 기본값 + `buildLayout` 의 nsym 고정) 인코더 `auto` 는 용량이 되면 H, 길면 M/L 을
   * 쓴다 ⇒ **ecc M/L 로 찍힌 코드는 R2 가 구조적으로 DONE 을 낼 수 없었다.**
   * 격자(n·layoutId)는 포맷 워드에 **없다** — `locator-format.js` 가 입력을 그대로
   * 되돌려 줄 뿐이다. 그래서 여기서 얻는 것은 ecc·mask·wire 셋뿐이고, 레이아웃 심판은
   * 여전히 본문 RS 다.
   */
  function readFormatAt(field, n, layoutId) {
    const format = stats.format;
    format.source = 'default';
    format.eccName = '';
    format.maskIndex = 0;
    format.candidateCount = 0;
    format.formatWireVersion = 0;
    format.reason = '';
    if (!formatEnabled || !layoutId) {
      format.reason = formatEnabled ? 'no-layout' : 'disabled';
      return;
    }
    stats.counters.formatReads += 1;
    let read = null;
    try {
      /*
       * 🔴 **버퍼를 그대로 넘기지 않는다** (2026-09-06 검토 R3c, 결함 7).
       * `src/decoder/grid-sample.js` 는 두 겹으로 캐시한다 —
       *   · `successfulDiscSamplesByLuma`: **LumaField 객체 정체성**이 WeakMap 키. 「한 객체 = 한 프레임」이 가정.
       *   · `homographyCacheKeys`: **H 객체 정체성**으로 계수 키 문자열을 캐시 — 즉 **처음 본 계수**로 굳는다.
       * 그런데 이 다리는 `fieldView` 한 객체와 `H` 한 버퍼를 **재사용**한다(핫 경로 할당 금지).
       * 두 가정이 동시에 깨져, 같은 자리에 다른 코드가 와 H 계수가 같으면 **옛 프레임의 표본으로**
       * 포맷을 읽는다 (실측: A(mask0)×10 → 빈 20 → B(mask2) 재락이 `H/0`. 대조군 = 빈 20 뒤 B 단독은 `H/2`).
       * 락마다 한 번뿐인 경로라 사본 비용(객체 1 + 9 float)은 무시할 수 있다.
       */
      const freshField = {
        width: field.width, height: field.height, data: field.data, alpha: field.alpha || null,
      };
      const freshH = new Float64Array(9);
      copy9(H, freshH);
      read = readFormatFromLocator(freshField, { H: freshH, n, layoutId });
    } catch (error) {
      format.reason = 'throw';
      return;
    }
    if (!read || read.ok !== true || !Array.isArray(read.candidates) || read.candidates.length === 0) {
      format.reason = read && read.reason ? String(read.reason) : 'no-candidate';
      return;
    }
    // 고르는 규칙은 consensus 최대 하나다 — 심판이 아니라 **기본값보다 나은 추측**이다.
    let best = read.candidates[0];
    for (let k = 1; k < read.candidates.length; k += 1) {
      const c = read.candidates[k];
      if ((c.consensus || 0) > (best.consensus || 0)) best = c;
    }
    if (typeof best.eccName !== 'string' || best.eccName === '') {
      format.reason = 'ecc-nameless';
      return;
    }
    format.source = 'locator';
    format.eccName = best.eccName;
    format.maskIndex = Number.isInteger(best.maskIndex) ? best.maskIndex : 0;
    format.candidateCount = read.candidates.length;
    format.formatWireVersion = Number(best.formatWireVersion) || 0;
  }

  /**
   * 주어진 H·n 으로 격자잠김비 F 만 잰다. 후보 선택(detect) 과 align 게이트가
   * 같은 식이다. 할당 없음.
   *
   * @param {Float64Array} [hm] 쓸 호모그래피. 생략하면 락의 `H`.
   *   3d — 마진은 **사본** H 를 넘겨서 잰다. 옛 판은 인자가 없어 「다른 H 로 재려면 `H` 버퍼를
   *   덮었다 되돌리는」 길뿐이었고, 그 길은 grid-sample 의 H-정체성 캐시를 오염시킨다(3c fix 7).
   */
  function computeGridLockF(data, width, height, n, hm) {
    const hMatrix = hm || H;
    const scale = lumaScaleOf(data);
    let frontSign = 0;
    if (projectQuadWith(hMatrix, 0, 0, 0)) {
      const area = doubleArea(quad);
      if (Math.abs(area) > AREA_EPS) frontSign = area > 0 ? 1 : -1;
    }
    let groupCount = 0;
    let sumMean = 0;
    let sumMean2 = 0;
    let sumVar = 0;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        for (let face = 0; face < 3; face += 1) {
          if (!projectQuadWith(hMatrix, face, i, j)) continue;
          const area = doubleArea(quad);
          if (Math.abs(area) <= AREA_EPS) continue;
          const sign = area > 0 ? 1 : -1;
          if (frontSign !== 0 && sign !== frontSign) continue;

          canonicalXY(face, i + 0.5, j + 0.5, xy);
          const cx = xy[0];
          const cy = xy[1];
          let tapN = 0;
          let tapSum = 0;
          let tapSum2 = 0;
          for (let t = 0; t < 4; t += 1) {
            let ax = cx;
            let ay = cy;
            if (t === 1) {
              ax += TAP_FRAC * EI_X[face];
              ay += TAP_FRAC * EI_Y[face];
            } else if (t === 2) {
              ax += TAP_FRAC * EJ_X[face];
              ay += TAP_FRAC * EJ_Y[face];
            } else if (t === 3) {
              ax -= TAP_FRAC * 0.5 * (EI_X[face] + EJ_X[face]);
              ay -= TAP_FRAC * 0.5 * (EI_Y[face] + EJ_Y[face]);
            }
            if (!projectInto(hMatrix, ax, ay, quad, 0)) continue;
            const sample = sample01(data, width, height, quad[0], quad[1], scale);
            if (!Number.isFinite(sample)) continue;
            tapN += 1;
            tapSum += sample;
            tapSum2 += sample * sample;
          }
          if (tapN < 2) continue;
          const mean = tapSum / tapN;
          const varr = tapSum2 / tapN - mean * mean;
          groupCount += 1;
          sumMean += mean;
          sumMean2 += mean * mean;
          sumVar += varr < 0 ? 0 : varr;
        }
      }
    }
    if (groupCount < 2) return 0;
    const invK = 1 / groupCount;
    const meanOfMeans = sumMean * invK;
    const varBetween = sumMean2 * invK - meanOfMeans * meanOfMeans;
    const varWithin = sumVar * invK;
    return (varBetween < 0 ? 0 : varBetween) / Math.max(varWithin, F_WITHIN_FLOOR);
  }

  /**
   * 🔴 **락 마진** (3d) — 「이 락은 자세까지 맞나」를 **한 프레임 안에** 재는 자.
   *
   * 같은 실루엣에 라인업의 다른 n′ 을 붙인다: `H′ = H·diag(n/n′, n/n′, 1)` (열 0·1 을 n/n′ 로).
   * 캐노니컬 좌표가 n 에 비례하므로 이 스케일은 **같은 육각 실루엣에 격자만 다시 그은 것**이고,
   * 실측에서 `projectOutlineInto(H′, n′)` 가 `projectOutlineInto(H, n)` 와 545 표본 전부
   * 최대 편차 0.000000000 px 였다(`nrelottery.md` §0 — 근사가 아니라 항등).
   *
   * 그렇게 얻은 F 셋의 `1위/2위` 가 마진이다. 왜 절대 F 가 아니라 이 비인가 (실측 545 락):
   *   · 자세가 틀린 락도 F 10\~42 로 게이트(10)를 넘는다 — 절대 F 는 못 가른다(표 E).
   *   · 그런데 그런 프레임에서 F 는 n′ 에 대해 **기계적으로 단조 증가**한다(176/176). 탭 간격이
   *     캐노니컬 단위라 n′ 이 커질수록 화소 간격이 좁아져 within 분산이 준다(표 C).
   *     ⇒ 1위와 2위가 붙어 있다: 오인군 마진 **최대 1.60**.
   *   · 자세까지 맞은 락은 참 n 의 F 가 두 자릿수 배로 압도한다 — 정상군 마진 중앙 **71**.
   *
   * ⚠ 이 자가 **고치는** 것은 없다. n 을 다시 뽑는 처방(argmax 재추첨)은 같은 문서에서
   * 기각됐다 — 오인군에서 argmax 는 「무조건 25」인 상수함수라 판별력이 0 이고, 켜면
   * 「안 차는 막대」가 「100 % 찬 뒤 복호 실패」로 바뀐다(§9.2). 여기서는 **재지만 안 고친다.**
   *
   * 비용: F 3회 ≈ 1.5 ms (detect 의 0.5\~1.4 %, 표 I). 락당 한 번뿐이다.
   *
   * @param {Float64Array} [hSource] 잴 H. 생략하면 락의 `H`.
   * @returns {number} 마진. 다툴 상대가 없으면 `+Infinity`.
   */
  function computeLockMargin(data, width, height, n, hSource) {
    const base = hSource || H;
    let best = -Infinity;
    let second = -Infinity;
    let bestN = 0;
    if (!(n > 0) || !data || !(width > 0) || !(height > 0) || LINEUP_NS.length === 0) {
      marginRatio = Infinity;
      marginBestN = 0;
      return marginRatio;
    }
    for (let k = 0; k < LINEUP_NS.length; k += 1) {
      const candN = LINEUP_NS[k];
      const s = n / candN;
      // 열 0(인덱스 0·3·6) 과 열 1(1·4·7) 만 스케일 — 열 2 는 원점의 상이라 그대로다.
      copy9(base, marginH);
      marginH[0] *= s; marginH[1] *= s;
      marginH[3] *= s; marginH[4] *= s;
      marginH[6] *= s; marginH[7] *= s;
      const f = computeGridLockF(data, width, height, candN, marginH);
      if (f > best) {
        second = best;
        best = f;
        bestN = candN;
      } else if (f > second) {
        second = f;
      }
    }
    marginBestN = bestN;
    // 2위가 0 이면 비가 발산한다 — 「다툴 상대가 없다」를 큰 수가 아니라 Infinity 로 적는다.
    marginRatio = (LINEUP_NS.length < 2 || !(second > 0)) ? Infinity : best / second;
    return marginRatio;
  }

  /** 마지막 `computeLockMargin` 결과를 stats 로 올린다. `installLock` 이 되돌린 뒤에 부른다. */
  function noteLockMargin() {
    stats.lockMargin = marginRatio;
    stats.lockMarginN = marginBestN;
    marginMeasured = 1;
  }

  /**
   * 새 프레임이면 1. 이전 프레임의 미스 판정은 `alignInto` 가 그 프레임 안에서 이미
   * 끝냈으므로(첫 후보가 곧 프레임의 판정) 여기서는 세대 카운터만 돌린다.
   */
  function beginFrame(timestamp) {
    // NaN !== NaN 이라 timestamp 가 없으면 매 호출이 새 프레임이다 (옛 거동 보존).
    if (timestamp === frameStamp) return 0;
    frameStamp = timestamp;
    frameJudged = 0;
    fStamp = NaN;
    stats.phaseMs.align = 0;
    /*
     * 🔴 detect 도 **프레임 합**이다 (2026-09-06 검토 R3c, 결함 10). 옛 코드는
     * `if (newFrame) stats.phaseMs.detect = …` 로 프레임의 **첫** `detectInto` 만 기록했다.
     * 그런데 락이 프레임 중간에 풀리면 **다음 후보 세션의 `detectInto`** 가 그 프레임 안에서
     * 로케이터를 통째로 돌린다(session.js 의 검출 호출) — 그때 `newFrame=0` 이라 화면의
     * det 는 **0** 이었다. 실측 y2@066 f8: pushFrame 357 ms ↔ phase [0, 2.3, 0].
     * 단계별 ms 는 정확히 그 「왜 멈췄나」를 가르려고 만든 수인데 그 프레임에서 거짓말을 했다.
     */
    stats.phaseMs.detect = 0;
    if (locked) {
      framesSinceLock += 1;
      framesSinceRelocate += 1;
    }
    return 1;
  }

  /**
   * 프레임 캐시된 F. `computeGridLockF` 는 H·n·luma 만 쓰고 **레이아웃과 무관**하므로
   * 한 프레임의 후보 C 개가 같은 값을 본다 — C 번 재는 것은 순손해다 (R5).
   *
   * ⚠ 캐시 키에 **휘도 버퍼 참조까지** 넣는다. timestamp 만 쓰면 「같은 stamp 로 다른
   * 프레임을 미는」 호출자(도구·자)가 조용히 묵은 F 를 받는다 — 그러면 게이트도 미스
   * 집계도 전부 옛 프레임 이야기를 한다. 라이브 경로는 버퍼를 재사용하지만 stamp 가
   * 단조라 그쪽에서 적중률은 그대로다.
   */
  function frameGridLockF(data, width, height, n) {
    if (frameStamp === fStamp && data === fData) return fValue;
    fValue = computeGridLockF(data, width, height, n);
    fStamp = frameStamp;
    fData = data;
    return fValue;
  }

  /**
   * 두 H 의 canonical 원점(= 실루엣 중심) 이동이 반 셀을 넘나. canonical 단위 벡터
   * (1,0) 의 상이 한 셀 피치라 자를 H 에서 **유도**한다 — px 상수를 적지 않는다.
   */
  function centreMovedBeyondCells(prevH, nextH, cells) {
    if (!projectInto(prevH, 0, 0, quad, 0)) return true;
    if (!projectInto(nextH, 0, 0, quad, 2)) return true;
    if (!projectInto(nextH, 1, 0, quad, 4)) return true;
    const pitch = Math.hypot(quad[4] - quad[2], quad[5] - quad[3]);
    if (!(pitch > 0) || !Number.isFinite(pitch)) return true;
    const shift = Math.hypot(quad[2] - quad[0], quad[3] - quad[1]);
    return shift > cells * pitch;
  }

  /**
   * R1(c) — 락을 **유지한 채** 로케이터를 다시 돌린다. 새 shape 이 뚜렷이 다르면
   * (n 변화 또는 중심 이동 > `RELOCATE_CENTRE_CELLS` 셀) 다시 걸고, 아니면 옛 락을 지킨다.
   *
   * ⚠ `pickShape` 의 `fOf` 는 후보 H 를 **`H` 버퍼에 덮어쓴다**. 채택하지 않을 때
   * 그대로 두면 락이 조용히 남의 H 로 바뀐다 — 그래서 먼저 `savedH` 에 뜨고 복원한다.
   * @returns {number} 채택했으면 1.
   */
  function relocateProbe(luma, width, height) {
    stats.counters.relocates += 1;
    framesSinceLock = 0;
    const prevN = stats.n;
    const prevLayout = stats.layoutId;
    const prevF0 = stats.lockF0;
    copy9(H, savedH);
    let adopted = 0;
    try {
      const field = bindLuma(luma, width, height);
      const detected = detectCellSurfaceBlockShapes(field, locatorOptions);
      const shapes = detected && detected.shapes ? detected.shapes : [];
      stats.shapeCount = shapes.length;
      const lumaData = field.data;
      const shape = pickShape(shapes, preferN > 0 ? preferN : prevN, width, height, (candidate) => {
        const recoveredH = homographyFromShape(candidate);
        if (!recoveredH) return -1;
        copy9(recoveredH, H);
        const candN = Number(candidate.estimatedN);
        if (!(candN > 0) || candN > MAX_N) return -1;
        return computeGridLockF(lumaData, width, height, candN);
      });
      const recovered = shape ? homographyFromShape(shape) : null;
      if (recovered) {
        const n = Number(shape.estimatedN) > 0 ? Number(shape.estimatedN) : prevN;
        /*
         * 🔴 채택의 세 문 (2026-09-06 검토 R3c, 결함 6·3). 옛 규칙은 «n 변화 ∨ 중심 0.5셀 이동»
         * 둘뿐이라 **스케일·회전·원근 드리프트를 못 채택했고**(실물 채택 0/3), 반대로 F 가
         * 게이트 미만인 shape 도 그 둘만 맞으면 걸었다(3프레임 주기 락/해제 진동, y2-p9rot 22회).
         *   ① 게이트 — 새 shape 의 F 가 `gateF` 미만이면 **아무것도 안 한다**. 어차피 정합이
         *      바로 미스로 걷을 락을 거는 것은 세대만 올리고 HUD 를 흔든다.
         *   ② 뚜렷이 다르다 — n 변화 또는 중심 이동(옛 두 문).
         *   ③ 뚜렷이 낫다 — 지금 F 의 `relocateAdoptFRatio` 배 이상. 드리프트가 여기 걸린다.
         *   ③′ 회복 (3d 검토, 결함 1) — 지금 락이 **불신**이면 «마진이 `lockMarginMin` 을 넘는
         *      후보» 도 채택문이다. ①②③ 만 있으면 «같은 n · 같은 중심의 자세 수정» 이 어느 문도
         *      안 열어 회복이 구조적으로 불가능하다 — 실측 swap-multi 는 재검출 채택 3회(rev2·3·4)가
         *      전부 마진 1.58·1.34·1.45 로 여전히 미달이라 209프레임 중 206이 불신이고 회복 0 이었다.
         *      ⚠ 믿는 락에서는 안 열린다 — 마진은 «잠긴 격자가 맞는가» 를 재지 «둘 중 어느 쪽이
         *      더 나은가» 를 재지 않는다(둘 다 하한 위면 비교가 안 된다).
         * ⚠ 지금 F 는 `stats.gridLockF`(직전 프레임 값)가 아니라 **이 프레임에서 옛 H 로 다시 잰다** —
         *   비교 대상 둘이 같은 프레임이어야 「나아졌다」가 프레임 잡음이 아니다.
         */
        copy9(recovered, H);
        const newF = computeGridLockF(field.data, width, height, n);
        copy9(savedH, H);
        const curF = computeGridLockF(field.data, width, height, prevN > 0 ? prevN : n);
        const distinct = n !== prevN
          || centreMovedBeyondCells(savedH, recovered, RELOCATE_CENTRE_CELLS);
        const better = curF >= 0 && newF >= curF * relocateAdoptFRatio;
        /*
         * ③′ 의 비용은 F 3회(≈1.5 ms)라 **불신일 때만** 재고, 재면 아래 채택 분기가 그 값을
         * 그대로 쓴다(두 번 재지 않는다). 미측정은 `NaN` 이고 `NaN >= x` 는 거짓이라 믿는 락에서는
         * ③′ 가 자동으로 닫힌다 — 안전 쪽 실패다.
         */
        let candMargin = NaN;
        if (newF >= gateF && stats.lockDistrusted) {
          candMargin = computeLockMargin(field.data, width, height, n, recovered);
        }
        const recovers = candMargin >= lockMarginMin;
        if (newF >= gateF && (distinct || better || recovers)) {
          copy9(recovered, H);
          // 3d — 채택 판정 시점의 H·프레임으로 마진을 잰다 (요구 1). ①②③ 로 들어온 후보는
          // 마진 미달이어도 락이 걸린다(요구 2). 그때 회복을 여는 것은 «인내» 가 아니라
          // **불신 그 자체가 다음 프레임의 재검출 방아쇠가 된다**는 사실이다(위 ③′ · `detectInto` 의 `distrust`).
          if (Number.isNaN(candMargin)) computeLockMargin(field.data, width, height, n, recovered);
          readFormatAt(field, n, layoutIdOf(shape));
          installLock(recovered, n, layoutIdOf(shape), width, height);
          stats.lockF0 = newF;
          noteLockMargin();
          stats.counters.relocateAdopts += 1;
          adopted = 1;
        }
      }
    } catch {
      adopted = 0;
    }
    if (!adopted) {
      // 옛 락을 되돌린다 — `fOf` 가 덮어쓴 H 와 프레임 F 캐시까지.
      copy9(savedH, H);
      stats.lockF0 = prevF0;
      stats.n = prevN;
      stats.layoutId = prevLayout;
    }
    /*
     * 🔴 간격은 **여기서** 0 이 된다 (결함 6·9a). 이유가 「재검출을 연달아 돌리지 않는다」(비용)
     * 이므로 채택 여부와 무관하게 프로브 뒤에 걸리고, `installLock` 의 초기화(= 간격만큼 전)를
     * 덮어야 하므로 설치 **뒤**여야 한다. 반대로 «검출로 새로 건 락» 에는 안 걸린다.
     */
    framesSinceRelocate = 0;
    // 프레임 F 캐시는 H 가 어느 쪽으로 정해졌든 무효다 — 위에서 후보 F 를 재느라 H 를 흔들었다.
    fStamp = NaN;
    return adopted;
  }

  function detectInto(luma, width, height, timestamp, pose, output) {
    const t0 = performance.now();
    const newFrame = beginFrame(timestamp);
    output.found = 0;
    output.family = 0;
    output.n = 0;
    output.faceLabels = FACE_LABELS;
    stats.shapeCount = 0;
    stats.lastDetectMs = 0;

    // R1(a) — 락 설치 때와 프레임 크기가 다르면 그 H 는 다른 좌표계의 것이다.
    // 줌 승격(960 ↔ 720/1440)이 정확히 이 모양이고, 옛 코드는 아무 신호도 못 받았다.
    if (locked && stats.lockWidth > 0
      && (width !== stats.lockWidth || height !== stats.lockHeight)) {
      stats.counters.sizeClears += 1;
      clearLock();
    }
    stats.homographyOk = locked ? 1 : 0;

    if (locked && !relocateEveryFrame && newFrame) {
      const fNow = stats.gridLockF;
      const fStale = stats.lockF0 > 0 && fNow > 0 && fNow < stats.lockF0 * relocateFFraction;
      const due = framesSinceLock >= relocateEveryFrames;
      /*
       * 🔴 **불신도 방아쇠다** (2026-09-06 검토 3d, 결함 1). 3c 의 방아쇠는 `fStale`·`due` 둘뿐이라
       * «F 는 안정적인데 자세가 틀린» 락 — 마진 미달의 전형 — 이 어디에도 안 걸렸다.
       *   · `fStale` 은 F 가 반토막 나야 한다. 실측 y2-p9rot rev5 는 락 f47\~f108 62프레임 내내
       *     F 10\~14 로 `lockF0` 10.03 언저리에 붙어 있어 **한 번도 stale 이 아니다**.
       *   · `due` 는 96프레임 — 운영자 실기 7\~15 fps 로 6\~14 초다.
       *   · 런타임 인내(`framesWithoutLock`)는 `stats.locked` 가 1 이면 매 프레임 0 이라
       *     (r2-scan-runtime.js) 락이 살아 있는 한 영원히 안 는다.
       * ⇒ 실측 결과: y2-p9rot 109프레임에 `relocates` 0 · `relocateAdopts` 0. 「재검출·인내가
       *   살아 있어야 회복 경로가 있다」는 3c 주석은 **코퍼스 어디서도 관측되지 않았다.**
       * 간격(`relocateMinGapFrames` = 24)은 그대로 둔다 — 듀티비 상한은 여전히 그 하나가 정한다.
       */
      const distrust = stats.lockDistrusted;
      if ((fStale || due || distrust) && framesSinceRelocate >= relocateMinGapFrames) {
        relocateProbe(luma, width, height);
      }
    }

    if (locked && !relocateEveryFrame) {
      output.found = 1;
      output.family = A3_FAMILY_Y;
      output.n = stats.n;
      output.H = H;
      output.layoutId = stats.layoutId;
      stats.lastDetectMs = performance.now() - t0;
      stats.phaseMs.detect += stats.lastDetectMs;
      return R2_SESSION_STATUS.OK;
    }

    try {
      const field = bindLuma(luma, width, height);
      const detected = detectCellSurfaceBlockShapes(field, locatorOptions);
      const shapes = detected && detected.shapes ? detected.shapes : [];
      stats.shapeCount = shapes.length;
      const lumaData = field.data;
      const shape = pickShape(shapes, preferN, width, height, (candidate) => {
        const recoveredH = homographyFromShape(candidate);
        if (!recoveredH) return -1;
        copy9(recoveredH, H);
        const candN = Number(candidate.estimatedN);
        if (!(candN > 0) || candN > MAX_N) return -1;
        return computeGridLockF(lumaData, width, height, candN);
      });
      if (!shape) {
        if (relocateEveryFrame) clearLock();
        stats.lastDetectMs = performance.now() - t0;
        stats.phaseMs.detect += stats.lastDetectMs;
        return R2_SESSION_STATUS.OK;
      }
      const recovered = homographyFromShape(shape);
      if (!recovered) {
        if (relocateEveryFrame) clearLock();
        stats.lastDetectMs = performance.now() - t0;
        stats.phaseMs.detect += stats.lastDetectMs;
        return R2_SESSION_STATUS.OK;
      }
      const n = Number(shape.estimatedN) > 0 ? Number(shape.estimatedN) : preferN;
      copy9(recovered, H);
      /*
       * 🔴 **게이트 미달 F 로는 락을 걸지 않는다** (2026-09-06 검토 R3c, 결함 3).
       * 옛 코드는 설치한 **뒤에** `lockF0` 를 재고 `gateF` 와 비교하지 않았다. 그러면 정합의
       * 미스 경로(`LOCK_MISS_LIMIT=3`)가 3프레임 뒤 그 락을 걷고, 다음 프레임에 같은 shape 이
       * 다시 걸린다 — **3프레임 주기의 락/해제 진동**이다(실측 y2-p9rot 70프레임: F0 4\~8 인 락
       * 22회 설치·22회 해제, lockRevision 1→45, 로케이터 ≈150 ms×22). 화면에서는 HUD 실루엣이
       * 3프레임마다 세대를 바꾸는 것으로 보인다(운영자 실기 3차 ①).
       * 게이트 미달이면 **SEARCHING 을 유지**한다 — 다음 프레임에 로케이터가 다시 돈다.
       */
      const lockF0 = computeGridLockF(field.data, width, height, n);
      if (!(lockF0 >= gateF)) {
        if (locked) clearLock();
        stats.homographyOk = 0;
        fStamp = NaN;
        stats.lastDetectMs = performance.now() - t0;
        stats.phaseMs.detect += stats.lastDetectMs;
        return R2_SESSION_STATUS.OK;
      }
      // 3d — 마진은 **설치 직전**에, 이 프레임·이 H 로 잰다 (요구 1). `installLock` 이 stats 를
      // 미측정으로 되돌리므로 값을 싣는 것은 설치 **뒤**다 (`noteLockMargin`).
      computeLockMargin(field.data, width, height, n);
      // 포맷을 **먼저** 읽는다 — `installLock` 의 스캔맵이 wire 를 소비하기 때문이다.
      readFormatAt(field, n, layoutIdOf(shape));
      installLock(recovered, n, layoutIdOf(shape), width, height);
      stats.lockF0 = lockF0;
      noteLockMargin();
      fStamp = NaN;
      output.found = 1;
      output.family = A3_FAMILY_Y;
      output.n = stats.n;
      output.H = H;
      output.layoutId = stats.layoutId;
      output.faceLabels = FACE_LABELS;
    } catch {
      output.found = 0;
      output.family = 0;
    }
    stats.lastDetectMs = performance.now() - t0;
    stats.phaseMs.detect += stats.lastDetectMs;
    return R2_SESSION_STATUS.OK;
  }

  function cellCoord(cell, cellCount, ij, map) {
    if (map !== null && map !== undefined && map.count > 0 && map.count === cellCount) {
      ij[0] = map.i[cell];
      ij[1] = map.j[cell];
      return 1;
    }
    if (gridN > 0 && cell < gridN * gridN) {
      ij[0] = cell % gridN;
      ij[1] = (cell / gridN) | 0;
      return 1;
    }
    return 0;
  }

  /**
   * R5 — 이 호출이 표본해야 할 스캔순서. 세션이 자기 `layout.layoutId` 를
   * `detection.sessionLayoutId` 로 실어 보내면 그 후보의 순서로, 아니면 락의 순서로.
   *
   * 🔴 왜 필요한가 (실측 근거): 후보 5개는 **cellCount 가 서로 다르다**
   * (n=21: v0t 307 / v0tr 309 / v0try 254 / v0trq 270 / v0ty 252). 어댑터가 락의
   * 레이아웃 하나로만 스캔맵을 세우면 `scanCount === cellCount` 가 그 한 후보에서만
   * 참이고, 나머지는 전부 raster 폴백(i = cell % n)으로 표본된다 — 즉 「후보 5개」가
   * 사실은 **참 스캔순서 1개 + 엉뚱한 순서 4개**였다. 「먼저 복호되는 쪽을 쓴다」는
   * 이 설계의 전제가 그 4개에서는 성립하지 않았다.
   */
  function scanMapForCall(detection) {
    const id = detection
      && typeof detection.sessionLayoutId === 'string'
      && detection.sessionLayoutId !== ''
      ? detection.sessionLayoutId
      : stats.layoutId;
    if (id === stats.layoutId) return lockScan;
    return scanMapFor(gridN, id, formatWireOf());
  }

  /** 셀 마름모 네 꼭짓점을 **주어진** H 로 `quad` 에 사영. 무할당. */
  function projectQuadWith(hm, face, i, j) {
    for (let c = 0; c < 4; c += 1) {
      const a = i + (c === 1 || c === 2 ? 1 : 0);
      const b = j + (c === 2 || c === 3 ? 1 : 0);
      canonicalXY(face, a, b, xy);
      if (!projectInto(hm, xy[0], xy[1], quad, c * 2)) return 0;
    }
    return 1;
  }

  function projectQuad(face, i, j) {
    return projectQuadWith(H, face, i, j);
  }

  function alignInto(
    luma,
    width,
    height,
    timestamp,
    pose,
    detection,
    output,
    faceLuma,
    visibleCells,
  ) {
    const t0 = performance.now();
    beginFrame(timestamp);
    const cellCount = visibleCells && faceLuma
      ? Math.min(visibleCells.length, (faceLuma.length / 3) | 0)
      : 0;
    if (faceLuma) faceLuma.fill(0);
    if (visibleCells) visibleCells.fill(0);
    clearAlignOutput(output);
    stats.gridLockF = 0;
    stats.scanMapped = 0;
    stats.scanMappedCells = 0;

    if (!locked || gridN <= 0 || !luma || !(width > 0) || !(height > 0)) {
      stats.lastAlignMs = performance.now() - t0;
      stats.phaseMs.align += stats.lastAlignMs;
      return R2_SESSION_STATUS.OK;
    }

    const data = luma.data instanceof Float32Array ? luma.data : luma;
    const scale = lumaScaleOf(data);
    const n = gridN;
    const ij = xy;
    const map = scanMapForCall(detection);
    const mapped = map !== null && map !== undefined && map.count > 0 && map.count === cellCount;
    stats.scanMapped = mapped ? 1 : 0;
    stats.scanMappedCells = mapped ? map.count : 0;

    // L4 가시성: 투영 quad 부호넓이. 평면 H 아래에서는 세 면 감김이 같아서
    // 실물 436프레임 부호불일치 탈락은 0 이다. visibleCells 를 실제로 정하는
    // 것은 «표본이 화면 안인가»(sample01 이 유한한가) 하나다.
    let frontSign = 0;
    if (projectQuad(0, 0, 0)) {
      const area = doubleArea(quad);
      if (Math.abs(area) > AREA_EPS) frontSign = area > 0 ? 1 : -1;
    }

    stats.gridLockF = frameGridLockF(data, width, height, n);
    /*
     * 3d — 이 락의 마진을 아직 안 쟀으면 여기서 잰다 (락당 한 번).
     * 검출·재검출로 걸린 락은 설치 직전에 이미 쟀다. 안 쟀을 수 있는 입구는 `installHomography`
     * (자·도구가 프레임 없이 H 를 꽂는 자리) 하나다 — 그 락도 **첫 정합 프레임**에서 재야
     * 게이트가 실재한다. 「프레임이 없어 못 쟀다」를 「믿는다」로 바꾸지 않는다.
     */
    if (!marginMeasured) {
      computeLockMargin(data, width, height, n);
      noteLockMargin();
    }
    let visibleCount = 0;

    for (let cell = 0; cell < cellCount; cell += 1) {
      if (!cellCoord(cell, cellCount, ij, map)) continue;
      const i = ij[0];
      const j = ij[1];
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      let facesOk = 0;
      for (let face = 0; face < 3; face += 1) {
        if (!projectQuad(face, i, j)) continue;
        const area = doubleArea(quad);
        if (Math.abs(area) <= AREA_EPS) continue;
        const sign = area > 0 ? 1 : -1;
        if (frontSign !== 0 && sign !== frontSign) continue;
        canonicalXY(face, i + 0.5, j + 0.5, xy);
        if (!projectInto(H, xy[0], xy[1], quad, 0)) continue;
        const sample = sample01(data, width, height, quad[0], quad[1], scale);
        if (!Number.isFinite(sample)) continue;
        const byte = sample * 255;
        faceLuma[cell * 3 + face] = byte < 0 ? 0 : byte > 255 ? 255 : byte + 0.5 | 0;
        facesOk += 1;
      }
      if (facesOk === 3) {
        visibleCells[cell] = 1;
        visibleCount += 1;
      } else {
        faceLuma[cell * 3] = 0;
        faceLuma[cell * 3 + 1] = 0;
        faceLuma[cell * 3 + 2] = 0;
      }
    }

    output.visibleCount = visibleCount;
    const f = stats.gridLockF;
    const fPassed = f >= gateF;
    /*
     * 🔴 **게이트는 두 축이다** (3d · 요구 2): `gatePassed = (F ≥ gateF) ∧ (마진 ≥ lockMarginMin)`.
     *   · F 는 「격자가 잠겼나」 — 자세가 틀린 락도 10\~42 로 넘는다(nrelottery 표 E).
     *   · 마진은 「잠긴 그 격자가 맞는 격자인가」 — 오인 0/176 통과 · 정상 365/369 통과(표 G).
     *
     * ⚠ **R4 가중 하한(alignWeightFloorQ15)이 홀로 들어가면 안 되는 이유가 이것이다**
     * (PM/029B §27.13.2): 하한은 게이트를 **통과한** 프레임의 weight 를 0.1 → 0.5 로 올린다.
     * 자세가 틀린 락 위에서 그 일이 벌어지면 누적기가 틀린 격자에 **자신 있게** 증거를 채워
     * D 가 1.0 에 닿고 복호는 실패한다 — 「막대 100 % 뒤 실패」라는 가짜 진행(실측 12 중 6).
     * 하한은 아래 `if (gatePassed)` 블록 **안**에만 있으므로, 마진 게이트가 그 앞에 선다.
     * 그 배치가 성질이다 — `test/r2-a3-wire.test.js` 의 ⓒ 가 값으로 잰다: 같은 프레임·같은 H 에서
     * `lockMarginMin: 0` 대조군만 하한을 켠다(그쪽 weightQ15 = 하한, 이쪽 0).
     *
     * 미측정(NaN)은 `NaN >= x` 가 거짓이라 **불신** 쪽으로 떨어진다. 안전 쪽 실패다.
     */
    const distrusted = !(stats.lockMargin >= lockMarginMin);
    stats.lockDistrusted = distrusted;
    /*
     * 🔴 **불신은 세션에 «미검출» 이 아니라 «보류» 로 내려간다** (3d 검토 결함 2·4).
     * `gatePassed = 0` 하나로만 말하면 `identity.js` 의 `advanceCoast` 가 굴러 `nCoast`(12)
     * 프레임마다 DROPPED → `hardDropReset` → 다음 프레임 재획득 → 다시 COAST 로 **하드 드랍을
     * 제조한다**. 실측: 락은 rev5 로 고정인데 indicator 가 f58·70·82·94·106 에 DROPPED 로 깜빡이고
     * hardDrops 가 2 → 7 (c3-tl 0 → 9 · swap-multi 0 → 17). 그 프레임의 HUD 는 위상이 DROPPED 라
     * `hudDistrusted` 가 거짓이 돼 불신 오버레이가 한 프레임 꺼지고, 좌 패널은 원값으로 여전히
     * «격자 재확인» 을 말한다 — 세 그림이 서로 다른 말을 한다.
     * COAST/DROPPED 는 «코드를 놓쳤다» 의 축이고 불신은 «격자를 못 믿는다» 의 축이다
     * (같은 문 ≠ 같은 정책). 코드를 진짜로 놓치면 F 연속 미달이 락을 걷고, 그때는 `found = 0` 이라
     * 세션의 미검출 경로가 정상적으로 COAST 를 굴린다 — 이 필드는 그 경로를 안 건드린다.
     */
    output.distrusted = distrusted ? 1 : 0;
    if (fPassed && !distrusted) {
      output.gatePassed = 1;
      /*
       * R3 — **COAST 해제 신호.** 옛 코드는 match/mismatch 를 0 으로 못박아 세션의
       * SPRT 가 영구 불활성이었다. 그 결과 `identity.js` 의 `advanceCoast` 가
       * 게이트를 통과한 프레임에도 불려 (게이트 통과는 `observeIdentity(…, true, true, 0, 0)`
       * → delta 0 → COAST 에서 `advanceCoast`) **COAST 가 절대 안 풀렸고**, nCoast=12
       * 프레임 뒤 hardDropReset 이 증거를 버렸다. 운영자 실기 3차 ③ 「수집은 되나
       * 리셋 반복」의 기전이다.
       *
       * ⚠ **드랍 가드는 여전히 불활성이다** — mismatchCount 가 0 이므로 ACTIVE 에서
       * delta ≤ 0 이고 `Math.max(0, …)` 가 sprtQ8 을 0 에 묶는다. 즉 이 값은 «해제»만
       * 하고 «드랍»은 못 한다. 셀 단위 재관측 불일치를 실제로 세는 것은 A4 의 몫이고
       * 이 레인은 거기 손대지 않는다.
       */
      output.mismatchCount = 0;
      output.matchCount = visibleCount > 0 ? visibleCount : 1;
      if (!frameJudged) {
        frameJudged = 1;
        lockMisses = 0;
      }
      let weight = Q15_ONE;
      if (f < peakF) {
        weight = Math.round(Q15_ONE * (f / peakF));
        // R4 — 게이트를 통과한 프레임의 하한. 유도는 params.alignWeightFloorQ15 주석에.
        if (weight < weightFloorQ15) weight = weightFloorQ15;
        if (weight < 1) weight = 1;
        if (weight > Q15_ONE) weight = Q15_ONE;
      }
      output.weightQ15 = weight;
    } else if (fPassed) {
      /*
       * 🔴 **마진 미달 — 누적은 없고 락은 유지한다** (3d · 요구 2).
       *
       * 왜 미스로 안 세나: 미스 셋이면 `LOCK_MISS_LIMIT` 이 락을 걷는다. 그러면 다음 프레임에
       * 같은 shape 이 다시 걸려 **3프레임 주기 락/해제 진동**이 돌아온다 — 3c 결함 3 이 없앤
       * 바로 그 그림이다(실측 y2-p9rot 70프레임에 22회 설치·22회 해제). 게다가 락이 없으면
       * 재검출(`relocateProbe`)도 인내(`framesWithoutLock`)도 안 돈다 — 자세를 고칠 **유일한**
       * 경로가 그 둘이다. 락 생존 판정은 **F 단독**이고, 마진은 «신뢰» 축이지 «생존» 축이 아니다.
       */
      output.mismatchCount = 0;
      output.matchCount = 0;
      if (!frameJudged) {
        frameJudged = 1;
        lockMisses = 0;
      }
    } else {
      output.mismatchCount = 0;
      output.matchCount = 0;
      /*
       * R1(b) — 미스는 **프레임당 한 번**이다. `computeGridLockF` 가 레이아웃 무관이라
       * 한 프레임의 모든 후보가 같은 F 를 보므로 첫 후보의 판정이 곧 프레임의 판정이다.
       */
      if (!frameJudged) {
        frameJudged = 1;
        lockMisses += 1;
        if (lockMisses >= LOCK_MISS_LIMIT) clearLock();
      }
    }
    stats.lastAlignMs = performance.now() - t0;
    stats.phaseMs.align += stats.lastAlignMs;
    return R2_SESSION_STATUS.OK;
  }

  /**
   * 셀의 **세 면 마름모 중심** 사영 — 셀당 3점 (face 0·1·2 순), `out` 길이 ≥ cellCount×6.
   *
   * ⚠ 옛 `projectCellCentres`(세 면 중심의 **평균**)는 2026-09-05 에 퇴역했다: Type Y 셀의 세 마름모는
   * Y-심을 중심으로 120° 로 흩어져 있어 canonical 좌표의 합이 **항등적으로 0** 이다(EI·EJ 합 0). 즉 아핀
   * H 면 모든 셀의 «중심» 이 정확히 한 점으로 붕괴하고, 실제 H 에선 원근 잔차(y2 실측 0.09×1.31 px)만
   * 남는다 — 시험판 .02 의 우하단 셀맵은 그 잔차를 112 px 로 늘린 그림이었다(PM/029B §24.8 정정).
   * 세 점을 따로 내면 육각 실루엣이 정직하게 나온다. 폴리곤(마름모 꼭짓점)은 HUD 3a 에서.
   *
   * 무엇보다 **정합이 실제로 표본한 자리**와 같은 H·같은 격자를 쓴다 — 화면의 점이 「정합이 보는 곳」이다.
   *
   * @param {Float32Array} out  길이 ≥ cellCount×6. 못 사영한 점은 NaN.
   * @returns {number} 한 면 이상 사영된 셀 수. 락이 없으면 0.
   */
  function projectCellFaceCentres(out, cellCount, layoutId) {
    if (!locked || gridN <= 0 || !out) return 0;
    const n = gridN;
    const map = layoutId && layoutId !== stats.layoutId
      ? scanMapFor(gridN, layoutId, formatWireOf())
      : lockScan;
    const limit = Math.min(cellCount, (out.length / 6) | 0);
    let mapped = 0;
    for (let cell = 0; cell < limit; cell += 1) {
      const base = cell * 6;
      for (let k = 0; k < 6; k += 1) out[base + k] = NaN;
      if (!cellCoord(cell, cellCount, xy, map)) continue;
      const i = xy[0];
      const j = xy[1];
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      let faces = 0;
      for (let face = 0; face < 3; face += 1) {
        canonicalXY(face, i + 0.5, j + 0.5, xy);
        if (!projectInto(H, xy[0], xy[1], quad, 0)) continue;
        out[base + face * 2] = quad[0];
        out[base + face * 2 + 1] = quad[1];
        faces += 1;
      }
      if (faces > 0) mapped += 1;
    }
    return mapped;
  }

  function reset() {
    clearLock();
    stats.gridLockF = 0;
    stats.lastAlignMs = 0;
    stats.lastDetectMs = 0;
    stats.shapeCount = 0;
    stats.phaseMs.detect = 0;
    stats.phaseMs.align = 0;
    stats.format.source = 'default';
    stats.format.eccName = '';
    stats.format.maskIndex = 0;
    stats.format.candidateCount = 0;
    stats.format.formatWireVersion = 0;
    stats.format.reason = '';
    frameStamp = NaN;
    frameJudged = 0;
    fStamp = NaN;
    framesSinceRelocate = relocateMinGapFrames;
  }

  /**
   * 자·도구용 직접 락 설치. **프레임 크기를 모르므로 `lockWidth` 를 0 으로 둔다** —
   * 그러면 R1(a) 크기 가드가 이 락에 대해 항등이다 (합성 프레임 자가 폭을 바꿔 가며
   * 부를 수 있어야 한다). 라이브 경로는 `detectInto` 가 항상 폭을 실어 준다.
   */
  function installHomography(nextH, n, layoutId) {
    const size = Number(n);
    if (!(nextH && nextH.length >= 9) || !(size > 0)) return;
    installLock(nextH, size, layoutId || '', 0, 0);
    fStamp = NaN;
    frameJudged = 0;
  }

  return {
    detectInto,
    alignInto,
    reset,
    invalidateLock,
    installHomography,
    projectCellFaceCentres,
    H,
    stats,
    faceLabels: FACE_LABELS,
  };
}
