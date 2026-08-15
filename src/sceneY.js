/**
 * sceneY.js — Type Y (단일 큐브) 인코딩 결과 → 결정적 도형(scene) 전개 (SPEC §14, TY6)
 *
 * scene.js(Type O)와 painter 계약을 그대로 승계한다 — shape kind 는 polygon | disc 만,
 * shapes 배열 순서가 렌더러 소비 계약이다(raster.js·svg.js 는 뒤에 그려진 도형이
 * 이긴다). 이 모듈은 encodeY.js 의 `{n, cellDigits}` 산출물을 소비하지만 encodeY.js 를
 * import 하지 않는다 — 인터페이스 계약으로만 다룬다(병렬 lane 산출물 결합 지점을
 * 최소화).
 *
 * 이 모듈도 순수 기하 + 색 변환만 다룬다 — node 전용 API·Math.random·Date·
 * Math.hypot·삼각함수 금지(결정성 계약, AGENTS.md 공통 규약).
 */

import {
  moduleQuad, layoutForCube, cubeBounds, YFACES, faceBasis,
} from './ygrid.js';
import { CORNER_UNIT_OFFSETS } from './hexgrid.js';
import { digitToRanks } from './lehmer.js';
import { srgbChannelToLinear, relativeLuminance } from './luminance.js';
import { qrMatrix } from './qr.js';
import { digitToPattern, assertToneSeparation } from './tonemap.js';
import { WINDOW_SIZE_Y, WINDOW_SUPPORTED_N } from './capacityY.js';
import {
  DEFAULT_LOCATOR_PROFILE_Y,
  LOCATOR_PROFILE_CELL_SURFACE_V1,
  LOCATOR_PROFILE_CELL_SURFACE_V1R2,
  LOCATOR_PROFILE_CELL_SURFACE_V2,
  LOCATOR_PROFILE_CELL_SURFACE_V0,
  LOCATOR_PROFILE_CELL_SURFACE_V2R2,
  assertLocatorProfileY,
  isCellSurfaceLocatorProfileY,
  locatorMarginCells,
  locatorShapesY,
} from './locatorY.js';
import { locatorTone } from './cellSurfaceY.js';
import { locatorToneCellSurfaceLayout } from './cellSurfaceLayouts.js';
import { isCellSurfaceFinalId, locatorToneCellSurfaceFinal } from './cellSurfaceFinal.js';

// ── 면 게인 (SPEC §14 §4.4-Y: 렌더러는 γ ≤ 2 를 지켜야 한다) ────────────────

/** 기본 면 게인. T=1(기준면), L·R 은 어둡게(입체감) — γ = max/min ≈ 1.923 ≤ 2. */
export const DEFAULT_FACE_GAINS = Object.freeze({ T: 1, L: 0.72, R: 0.52 });

function gainRatio(gains) {
  const vals = [gains.T, gains.L, gains.R];
  return Math.max(...vals) / Math.min(...vals);
}

// 모듈 로드 시 단언 — 기본값 자체가 SPEC §14 렌더러 의무(γ≤2)를 어기면 여기서
// 즉시 터진다(런타임 호출 전에 잡는다).
{
  const ratio = gainRatio(DEFAULT_FACE_GAINS);
  if (!(ratio <= 2)) {
    throw new Error(`DEFAULT_FACE_GAINS 게인비 γ=${ratio} 가 SPEC §14 렌더러 의무(γ≤2)를 위반한다`);
  }
}

/** 호출 시점에 실제 쓰일 faceGains 를 검증한다(팔레트로 넘어온 커스텀 값 포함). */
function assertFaceGains(gains) {
  for (const face of YFACES) {
    const v = gains[face];
    if (!Number.isFinite(v) || v <= 0) {
      throw new RangeError(`faceGains.${face} 는 유한한 양수여야 한다: ${v}`);
    }
  }
  const ratio = gainRatio(gains);
  if (!(ratio <= 2)) {
    throw new RangeError(`면 게인비 γ=${ratio} 가 SPEC §14 렌더러 의무(γ≤2)를 초과한다`);
  }
}

/**
 * 선형 채널(0..1) → sRGB 8bit 채널(0..255, 반올림). IEC 61966-2-1 역변환.
 * luminance.js 는 순방향(sRGB→선형)만 노출하므로, 역방향은 여기 내부 헬퍼로
 * 둔다(과제 지침: luminance.js 는 고치지 않는다).
 */
function linearChannelToSrgb8(linear) {
  const clampedLinear = linear < 0 ? 0 : linear > 1 ? 1 : linear;
  const c = clampedLinear <= 0.0031308
    ? clampedLinear * 12.92
    : 1.055 * Math.pow(clampedLinear, 1 / 2.4) - 0.055;
  const v = Math.round(c * 255);
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * 레벨 색 {r,g,b} 에 면 게인을 적용한 색. 채널별 sRGB→선형→×gain→sRGB.
 * 게인은 면 단위 스칼라라 동일 면 안에서는 모든 레벨에 똑같이 곱해진다 —
 * 선형 곱은 단조 함수이므로 면 내부 순위(0<1<2)는 자동으로 보존된다.
 */
function applyFaceGain(rgb, gain) {
  return {
    r: linearChannelToSrgb8(srgbChannelToLinear(rgb.r) * gain),
    g: linearChannelToSrgb8(srgbChannelToLinear(rgb.g) * gain),
    b: linearChannelToSrgb8(srgbChannelToLinear(rgb.b) * gain),
  };
}

// ── 콰이어트 존 + margin 기본값 (SPEC §14 QR fallback 계약) ────────────────

/** qr.js 는 QR v1 고정(21×21) — SIZE 를 export 하지 않으므로 여기 재정의한다.
 *  값이 어긋나면 콰이어트 겹침 계산이 조용히 깨지므로 테스트에서 실제
 *  `qrMatrix().size` 와의 일치를 단언한다. */
const QR_MODULE_GRID = 21;

/** SPEC §14: 코너 QR 콰이어트 존 4모듈. */
const QR_QUIET_MODULES = 4;

/** 콰이어트 포함 QR 블록 한 변의 QR-모듈 수 (= 4 + 21 + 4). */
const QR_BLOCK_MODULES = QR_MODULE_GRID + 2 * QR_QUIET_MODULES;

/**
 * margin 기본값 유도.
 *
 * QR 블록(콰이어트 포함, 1 QR-모듈 = cellSize/2 피치)의 좌상단은
 * (margin·0.25, margin·0.25) 에 고정된다(계약). cubeBounds(n, layout) 의
 * 좌상단은 항상 정확히 (margin, margin) 이다 — layoutForCube 가 bbox 를
 * margin 으로 균등 패딩하기 때문(원점 0 기준 bbox.minX = -halfW 이므로
 * originX - halfW = (margin - (-halfW)) - halfW = margin, n 에 무관).
 *
 * 따라서 겹침 없음(cubeBounds 사각형과 QR 블록 사각형의 사각-사각 비교)의
 * 필요충분조건은:
 *   margin·0.25 + QR_BLOCK_MODULES·(cellSize/2) <= margin
 *   ⟺ margin >= QR_BLOCK_MODULES·cellSize/2 / 0.75 = (2·QR_BLOCK_MODULES/3)·cellSize
 *   = (2·29/3)·cellSize ≈ 19.33·cellSize
 *
 * SPEC 원문이 적어 둔 "margin 기본 2·cellSize" 는 Type O 관례를 그대로 옮긴
 * 것일 뿐 Type Y 콰이어트 겹침 계약과 충돌한다 — SPEC §14 QR 블록 조항이
 * "n=21·25 기본 margin 에서 무겹침이도록 margin 기본값 조정 가능(조정했으면
 * 명시)"이라고 명시적으로 허용하므로, 여기서 20·cellSize 로 상향한다
 * (최소 필요치 ≈19.33·cellSize 에 여유를 둔 값 — n 에 무관하게 항상 충분하다).
 */
const DEFAULT_MARGIN_FACTOR = 20;

/**
 * 코너 QR 위치 4택 (ADR 0004 §1-7 U11 개정, scene.js 와 동일 계약). 방위는 고정,
 * 위치만 bbox 코너로 대칭 이동한다.
 */
export const QR_CORNERS = Object.freeze(['TL', 'TR', 'BL', 'BR']);

function assertQrCorner(qrCorner) {
  if (!QR_CORNERS.includes(qrCorner)) {
    throw new RangeError(`qrCorner 는 ${QR_CORNERS.join(' | ')} 중 하나여야 한다: ${qrCorner}`);
  }
  return qrCorner;
}

/** scene.js 의 cornerBlockOrigin 과 동일 계약 — TL 이 기존 로직, 나머지는 대칭 이동. */
function cornerBlockOrigin(qrCorner, margin, blockSide, width, height) {
  const nearX = margin * 0.25;
  const nearY = margin * 0.25;
  const farX = width - margin * 0.25 - blockSide;
  const farY = height - margin * 0.25 - blockSide;
  switch (qrCorner) {
    case 'TL': return { x: nearX, y: nearY };
    case 'TR': return { x: farX, y: nearY };
    case 'BL': return { x: nearX, y: farY };
    case 'BR': return { x: farX, y: farY };
    default: throw new RangeError(`qrCorner 는 ${QR_CORNERS.join(' | ')} 중 하나여야 한다: ${qrCorner}`);
  }
}

function rectsOverlap(a, b) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

// ── 면 내 QR 윈도 β (ADR 0003 D1 + [C7 Q7]) ─────────────────────────────
//
// **실기기(ML Kit·Vision) 실측 미통과 — 규범 아님, 미학 옵션 렌더.** encoded.window
// ===true(Y2/tones=2 전용, capacityY.js 가 강제)일 때만 그린다. 윈도 좌표는 이미
// encoded.cellDigits 에서 빠져 있으므로(①의 `entry===undefined` 스킵) 여기서
// 다시 배제 처리를 하지 않는다 — QR 오버레이만 추가로 그린다.
//
// 기하: 윈도는 T 면의 바깥 꼭짓점 코너, 데이터 셀 좌표 (i,j) ∈ [n-13,n-1]²
// (파라메트릭으로는 a,b ∈ [n-13,n] — 13 데이터 피치). QR 모듈 = 데이터 피치의
// ½(D1). 안쪽 콰이어트 4 QR모듈 + 21 QR모듈 데이터 = 25 QR모듈(12.5 피치) —
// 나머지 0.5 피치 슬랙은 콰이어트 패치가 윈도 bbox 전체를 덮어 무해화한다.
// 바깥 2변 콰이어트는 D1 규약대로 실루엣 밖 배경이 제공(추가로 그리지 않는다).
//
// 방향(사용자 확정 6, ADR 0003 D1): 정렬 패턴(파인더 없는 코너 — qr.js
// FINDER_CENTERS 가 (3,3)/(SIZE-4,3)/(3,SIZE-4) 뿐이라 행렬 코너 (SIZE-1,SIZE-1)
// 이 파인더 없음)이 Y-심 쪽((n-13,n-13) 쪽) 을 향한다. QR 행렬 좌표(qx,qy, 0..20)
// 를 뒤집어 안쪽(윈도 원점)에 가깝게 매핑한다: u = QUIET + (20-qx), v = QUIET + (20-qy).

/** 면 (a,b) 파라메트릭 좌표 → 절대 픽셀. ygrid.moduleQuad 내부 facePoint 와 동일
 *  공식이지만 ygrid.js 가 그 헬퍼를 export 하지 않으므로 여기서 재구성한다
 *  (faceBasis 는 export 되어 있다 — 재계산이 아니라 재사용). */
function facePointFor(face, a, b, layout) {
  const { ei, ej } = faceBasis(face);
  return {
    x: layout.originX + (a * ei.x + b * ej.x) * layout.size + 0,
    y: layout.originY + (a * ei.y + b * ej.y) * layout.size + 0,
  };
}

function renderWindowQr(shapes, n, layout, qrText, palette, faceGains) {
  const qr = qrMatrix(qrText);
  if (qr.size !== QR_MODULE_GRID) {
    // 방어적 가드 — 코너 QR 블록과 동일 전제(qr.js v1 고정).
    throw new Error(`qrMatrix().size(${qr.size}) 가 예상(${QR_MODULE_GRID}) 과 다르다`);
  }
  const lo = n - WINDOW_SIZE_Y; // 윈도 안쪽 모서리(Y-심 쪽) 데이터 셀 좌표.
  const half = 0.5; // QR 모듈 = 데이터 모듈 피치의 절반(D1).

  // 렌더 규약 (2026-08-09 사용자 육안 재판정 — "큐브 윗면에 하나만"):
  //   · QR 은 **상단면(T) 단독** — 3면 레플리카 안은 기각 (한 코드에 QR 4개는 과잉).
  //   · L/R 배제영역은 **필러 톤(levels[0] × 면 게인)** 으로 채운다 — 윈도 좌표는
  //     세 면 공통 배제(교차면 순위 계약)라 데이터를 실을 수 없고, 비워 두면
  //     배경 노출 구멍으로 실루엣이 깨진다(직전 육안 지적). 필러는 데이터 아님이
  //     명백하도록 면 전체 단일 톤 — 디코더는 어차피 이 좌표를 읽지 않는다.
  //   · T 면 잉크도 면 게인을 받는다 (D2 정합 — 기본 게인 T=1 에서 무게인과 동일).

  // ① T 면: 콰이어트 패치 + QR 다크 모듈 (뒤집기 매핑 — 위 주석).
  {
    const quiet = applyFaceGain(palette.bullseyeLight, faceGains.T);
    const dark = applyFaceGain(palette.bullseyeDark, faceGains.T);
    shapes.push({
      kind: 'polygon',
      points: [
        facePointFor('T', lo, lo, layout),
        facePointFor('T', n, lo, layout),
        facePointFor('T', n, n, layout),
        facePointFor('T', lo, n, layout),
      ],
      color: quiet,
    });
    for (let qy = 0; qy < qr.size; qy += 1) {
      for (let qx = 0; qx < qr.size; qx += 1) {
        if (qr.modules[qy * qr.size + qx] !== 1) continue;
        const u = (QR_MODULE_GRID - 1 - qx) + QR_QUIET_MODULES;
        const v = (QR_MODULE_GRID - 1 - qy) + QR_QUIET_MODULES;
        const a0 = lo + u * half;
        const b0 = lo + v * half;
        shapes.push({
          kind: 'polygon',
          points: [
            facePointFor('T', a0, b0, layout),
            facePointFor('T', a0 + half, b0, layout),
            facePointFor('T', a0 + half, b0 + half, layout),
            facePointFor('T', a0, b0 + half, layout),
          ],
          color: dark,
        });
      }
    }
  }

  // ② L/R 면: 배제영역 필러 (면당 폴리곤 1개).
  for (const face of ['L', 'R']) {
    shapes.push({
      kind: 'polygon',
      points: [
        facePointFor(face, lo, lo, layout),
        facePointFor(face, n, lo, layout),
        facePointFor(face, n, n, layout),
        facePointFor(face, lo, n, layout),
      ],
      color: applyFaceGain(palette.levels[0], faceGains[face]),
    });
  }
}

// ── 검증 ────────────────────────────────────────────────────────────────

function assertEncoded(encoded) {
  if (encoded === null || typeof encoded !== 'object') {
    throw new TypeError('encoded 는 객체여야 한다');
  }
  const {
    n, cellDigits, tones, window, cellSurface,
  } = encoded;
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`encoded.n 은 1 이상의 정수여야 한다: ${n}`);
  }
  if (!(cellDigits instanceof Map)) {
    throw new TypeError('encoded.cellDigits 는 Map 이어야 한다');
  }
  // tones 생략 시 2톤 메인(ADR 0003 v3.1 §4b 기본값)으로 취급한다 — encodeY.js 의
  // 기본값과 정합.
  const resolvedTones = tones === undefined ? 2 : tones;
  if (resolvedTones !== 2 && resolvedTones !== 3) {
    throw new RangeError(`encoded.tones 는 2 또는 3 이어야 한다: ${resolvedTones}`);
  }
  // window 생략 시 false(윈도 없음 — encodeY.js 기본값과 정합).
  const resolvedWindow = window === undefined ? false : window;
  if (resolvedWindow !== true && resolvedWindow !== false) {
    throw new RangeError(`encoded.window 는 boolean 이어야 한다: ${resolvedWindow}`);
  }
  if (resolvedWindow && n !== WINDOW_SUPPORTED_N) {
    throw new RangeError(`encoded.window 는 n=${WINDOW_SUPPORTED_N}(Y2) 에서만 지원한다: n=${n}`);
  }
  const resolvedCellSurface = cellSurface === true;
  // 최종 라인업(v0/v2r2)이 n=13·25 를 연다 — 구 v1 CS·초안은 여전히 n=21 뿐이지만
  // 인코더가 n 을 이미 강제하므로 여기서는 라인업 전체 집합만 가드한다.
  if (resolvedCellSurface
    && (resolvedWindow || ![13, 21, 25].includes(n) || (resolvedTones !== 2 && resolvedTones !== 3))) {
    throw new RangeError('encoded.cellSurface 는 n=13|21|25, 2톤 또는 3톤 전용이다');
  }
  return {
    n, cellDigits, tones: resolvedTones, window: resolvedWindow, cellSurface: resolvedCellSurface,
  };
}

function assertPalette(palette) {
  if (palette === null || typeof palette !== 'object') {
    throw new TypeError('palette 는 객체여야 한다');
  }
  return palette;
}

// ── 조립 ────────────────────────────────────────────────────────────────

/**
 * Type Y 인코딩 결과로부터 scene 을 조립한다.
 *
 * @param {{n: number, cellDigits: Map<string, {digit: number, role: string}>}} encoded
 * @param {{
 *   palette: {background:{r,g,b}, levels:[{r,g,b},{r,g,b},{r,g,b}], bullseyeDark:{r,g,b}, bullseyeLight:{r,g,b}, faceGains?:{T,L,R}},
 *   qrText?: string, cellSize?: number, margin?: number, qrCorner?: 'TL'|'TR'|'BL'|'BR',
 *   locatorProfile?: 'off'|'hex-frame-v1'|'cell-surface-v1',
 * }} [options]
 * @returns {{n:number, layout:object, width:number, height:number, background:{r,g,b}, shapes:Array}}
 */
export function buildSceneY(encoded, options) {
  const {
    n, cellDigits, tones, window, cellSurface,
  } = assertEncoded(encoded);

  const opts = options || {};
  const palette = assertPalette(opts.palette);
  const faceGains = opts.palette.faceGains === undefined ? DEFAULT_FACE_GAINS : opts.palette.faceGains;
  assertFaceGains(faceGains);

  // U17(2톤 분리 계약): tones===2 일 때만 levels[0]/[2] 를 실제로 렌더에 쓰므로,
  // 그 둘의 분리비가 RHO_MIN 을 만족하는지 여기서 검증한다(팔레트 게이트).
  if (tones === 2) {
    const yLo = relativeLuminance(palette.levels[0]);
    const yHi = relativeLuminance(palette.levels[2]);
    assertToneSeparation(yLo, yHi);
  }

  const cellSize = opts.cellSize === undefined ? 1 : opts.cellSize;
  const defaultCellSurfaceProfile = isCellSurfaceLocatorProfileY(encoded.locatorProfile)
    ? encoded.locatorProfile
    : encoded.cellSurfaceLayout === 'v0'
      ? LOCATOR_PROFILE_CELL_SURFACE_V0
      : encoded.cellSurfaceLayout === 'v2r2'
        ? LOCATOR_PROFILE_CELL_SURFACE_V2R2
        : encoded.cellSurfaceLayout === 'v2'
          ? LOCATOR_PROFILE_CELL_SURFACE_V2
          : (encoded.cellSurfaceLayout === 'v1r2' || encoded.cellSurfaceLayout === 'v1r2d')
            ? LOCATOR_PROFILE_CELL_SURFACE_V1R2
            : LOCATOR_PROFILE_CELL_SURFACE_V1;
  const requestedLocator = opts.locatorProfile === undefined
    ? (cellSurface ? defaultCellSurfaceProfile : DEFAULT_LOCATOR_PROFILE_Y)
    : assertLocatorProfileY(opts.locatorProfile);
  const locatorProfile = cellSurface
    ? (isCellSurfaceLocatorProfileY(requestedLocator)
      ? requestedLocator
      : defaultCellSurfaceProfile)
    : isCellSurfaceLocatorProfileY(requestedLocator)
      ? DEFAULT_LOCATOR_PROFILE_Y
      : requestedLocator;
  const requestedMargin = opts.margin === undefined
    ? DEFAULT_MARGIN_FACTOR * cellSize
    : opts.margin;
  const locatorPad = locatorMarginCells(locatorProfile) * cellSize;
  const margin = requestedMargin < locatorPad ? locatorPad : requestedMargin;
  const qrCorner = opts.qrCorner === undefined ? 'TL' : assertQrCorner(opts.qrCorner);

  const layout = layoutForCube(n, { size: cellSize, margin });

  // 게인 적용된 레벨 색(면당 3개) — 셀마다 다시 계산하지 않도록 미리 캐시한다.
  const gainedLevels = {};
  for (const face of YFACES) {
    gainedLevels[face] = palette.levels.map((rgb) => applyFaceGain(rgb, faceGains[face]));
  }

  const shapes = [];

  // ① 전 모듈 폴리곤 — 셀 (i,j) 를 j→i 오름차순(바깥 j, 안쪽 i, 둘 다 오름차순),
  // 셀마다 YFACES 순서 [T,L,R]. cellDigits 에 없는 (i,j) 는 건너뛴다.
  //
  // 색 인덱스 산출은 tones 로 갈린다(D9, v3.1 §4b): tones===2(2톤 메인) 는
  // digitToPattern 의 밝음/어두움 비트를 levels[2]/levels[0] 에 매핑(U17 — 팔레트
  // 3원소 중 [0]/[2] 만 쓴다), tones===3(Y-T) 는 기존 digitToRanks 순위 경로.
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const key = `${i},${j}`;
      const entry = cellDigits.get(key);
      if (entry === undefined) continue;
      if (cellSurface && entry.role === 'locator') {
        for (const face of YFACES) {
          let levelIndex;
          if (entry.tones && Number.isInteger(entry.tones[face])) {
            levelIndex = entry.tones[face];
          } else if (isCellSurfaceFinalId(encoded.cellSurfaceLayout)) {
            levelIndex = locatorToneCellSurfaceFinal(n, face, i, j, encoded.cellSurfaceLayout);
          } else if (encoded.cellSurfaceLayout) {
            levelIndex = locatorToneCellSurfaceLayout(encoded.cellSurfaceLayout, face, i, j);
          } else {
            levelIndex = locatorTone(face, i, j, encoded.locatorArm);
          }
          shapes.push({
            kind: 'polygon',
            points: moduleQuad(face, i, j, layout),
            color: gainedLevels[face][levelIndex],
          });
        }
        continue;
      }
      const ranks = tones === 3 ? digitToRanks(entry.digit) : null;
      const pattern = tones === 2 ? digitToPattern(entry.digit) : null;
      for (const face of YFACES) {
        const levelIndex = tones === 2 ? (pattern[face] ? 2 : 0) : ranks[face];
        shapes.push({
          kind: 'polygon',
          points: moduleQuad(face, i, j, layout),
          color: gainedLevels[face][levelIndex],
        });
      }
    }
  }

  // ② Y-심 3선 — 중심(Y-심 = layout 원점) → C1·C3·C5 방향, 반폭 0.075·cellSize
  // 얇은 사각 폴리곤. 반폭이 샘플 원판 여유(0.2165·cellSize = faceInradius·0.5,
  // hexgrid.SAMPLE_FRACTION_DEFAULT 기본값 기준) 안쪽이라 심선이 샘플링 원판을
  // 침범하지 않는다. 길이는 큐브 반경 R = n·cellSize(중심→꼭짓점, cubeBounds 유도와
  // 동일 닫힌 형태) 만큼 — Y-심에서 육각 실루엣 꼭짓점까지 정확히 닿는다.
  const seamHalfWidth = 0.075 * cellSize;
  const R = n * cellSize;
  const center = { x: layout.originX, y: layout.originY };
  for (const cornerIdx of [1, 3, 5]) {
    const u = CORNER_UNIT_OFFSETS[cornerIdx]; // 이미 단위벡터라 정규화(sqrt) 불필요.
    const perp = { x: -u.y, y: u.x }; // 단위벡터의 수직 벡터도 단위벡터.
    const far = { x: center.x + u.x * R, y: center.y + u.y * R };
    shapes.push({
      kind: 'polygon',
      points: [
        { x: center.x + perp.x * seamHalfWidth, y: center.y + perp.y * seamHalfWidth },
        { x: far.x + perp.x * seamHalfWidth, y: far.y + perp.y * seamHalfWidth },
        { x: far.x - perp.x * seamHalfWidth, y: far.y - perp.y * seamHalfWidth },
        { x: center.x - perp.x * seamHalfWidth, y: center.y - perp.y * seamHalfWidth },
      ],
      color: palette.bullseyeDark,
    });
  }

  // ③ 중심 도트 — 반지름 0.18·cellSize, bullseyeDark.
  shapes.push({
    kind: 'disc',
    cx: center.x,
    cy: center.y,
    r: 0.18 * cellSize,
    color: palette.bullseyeDark,
  });

  // ③½ 실험 로케이터 — 실루엣 밖 테두리·허브. 페이로드 샘플 원판 밖.
  // 기본값 off 이면 도형이 0개라 기존 painter 수 계약이 그대로다.
  const locatorShapes = locatorShapesY(n, layout, palette, locatorProfile);
  for (const shape of locatorShapes) shapes.push(shape);

  // ④ 코너 QR 블록 — qrText 가 없으면 생략(이 경우도 유효한 장면, SPEC §14 QR fallback 은
  // 미학 옵션이 아니라 규범이지만 scene 조립 단계에서는 호출자가 아직 URL 을 안 정했을
  // 수 있어 강제하지 않는다). opts.cornerQr === false 는 명시 억제 — 윈도 β(안쪽)가
  // QR 채널을 대신할 때 코너 병행을 끄는 용도 (2026-08-09 사용자 육안 재판정:
  // "큐브 윗면에 하나만").
  if (opts.cornerQr !== undefined && typeof opts.cornerQr !== 'boolean') {
    throw new TypeError(`opts.cornerQr 는 boolean 이어야 한다: ${opts.cornerQr}`);
  }
  // 기본값: 윈도 β 가 켜져 있으면 코너는 자동 억제("윗면에 하나만") — 병행이 필요한
  // 특수 용도만 cornerQr: true 로 명시 opt-in 한다.
  const cornerQr = opts.cornerQr === undefined ? !window : opts.cornerQr;
  if (opts.qrText !== undefined && cornerQr) {
    const qr = qrMatrix(opts.qrText);
    if (qr.size !== QR_MODULE_GRID) {
      // 방어적 가드 — qr.js 가 v1 고정을 벗어나면 위 margin 유도 전제가 깨진다.
      throw new Error(`qrMatrix().size(${qr.size}) 가 예상(${QR_MODULE_GRID}) 과 다르다`);
    }
    const qrModuleSize = cellSize / 2;
    const blockSide = QR_BLOCK_MODULES * qrModuleSize;
    const blockOrigin = cornerBlockOrigin(qrCorner, margin, blockSide, layout.width, layout.height);
    const blockRect = {
      minX: blockOrigin.x,
      minY: blockOrigin.y,
      maxX: blockOrigin.x + blockSide,
      maxY: blockOrigin.y + blockSide,
    };
    const silhouetteRect = cubeBounds(n, layout);
    if (rectsOverlap(blockRect, silhouetteRect)) {
      throw new Error(
        `QR 블록(콰이어트 포함, qrCorner=${qrCorner})이 큐브 실루엣(cubeBounds)과 겹친다 — `
          + `margin 을 늘려야 한다: 블록=${JSON.stringify(blockRect)}, 실루엣=${JSON.stringify(silhouetteRect)}`,
      );
    }

    // 콰이어트 패치 — 블록 전체를 덮는 밝은 사각형(어두운 스킨에서도 QR 리더가
    // 콰이어트 존을 확보하도록 렌더러가 보장, SPEC §14).
    shapes.push({
      kind: 'polygon',
      points: [
        { x: blockRect.minX, y: blockRect.minY },
        { x: blockRect.maxX, y: blockRect.minY },
        { x: blockRect.maxX, y: blockRect.maxY },
        { x: blockRect.minX, y: blockRect.maxY },
      ],
      color: palette.bullseyeLight,
    });

    // QR 모듈 다크 사각형 — 콰이어트 4모듈 안쪽, row-major(y→x 오름차순).
    const qrOrigin = {
      x: blockOrigin.x + QR_QUIET_MODULES * qrModuleSize,
      y: blockOrigin.y + QR_QUIET_MODULES * qrModuleSize,
    };
    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (qr.modules[y * qr.size + x] !== 1) continue;
        const mx = qrOrigin.x + x * qrModuleSize;
        const my = qrOrigin.y + y * qrModuleSize;
        shapes.push({
          kind: 'polygon',
          points: [
            { x: mx, y: my },
            { x: mx + qrModuleSize, y: my },
            { x: mx + qrModuleSize, y: my + qrModuleSize },
            { x: mx, y: my + qrModuleSize },
          ],
          color: palette.bullseyeDark,
        });
      }
    }
  }

  // ⑤ 면 내 QR 윈도(β, ADR 0003 D1 + [C7 Q7]) — encoded.window===true 이고 qrText
  // 가 있을 때만(코너 QR 과 동일하게 qrText 미지정이면 조용히 생략). 코너 QR 과
  // 배타적이지 않다 — 둘 다 표시될 수 있다(내용은 항상 같은 opts.qrText).
  if (window && opts.qrText !== undefined) {
    renderWindowQr(shapes, n, layout, opts.qrText, palette, faceGains);
  }

  return {
    n,
    layout,
    width: layout.width,
    height: layout.height,
    background: palette.background,
    locatorProfile,
    shapes,
  };
}
