/**
 * scene.js — 인코딩 결과 → 결정적 도형(scene) 전개 (SPEC §3, §4.1, §5.1)
 *
 * 인코더 산출물(셀별 digit)을 캔버스 미리보기 / PNG·SVG export 가 공유 소비할
 * 단일 도형 목록으로 펼친다. 여기서 확정한 순서(painter order)가 계약이다 —
 * 이후 어떤 백엔드도 이 순서를 재해석하지 않고 그대로 따라 그린다.
 *
 * 이 모듈은 순수 기하 + 계약 조립만 다룬다. encoded/palette 는 인터페이스 계약으로만
 * 다루고 인코더에 의존하지 않는다.
 *
 * ⚠ 예외 하나 — `FINDER_CUBE_TONES`(luminance.js). 파인더 색은 **프리셋을 따르지 않는
 *   포맷 상수**라 palette 로 흘려보내지 않는다. 그래야 어떤 프리셋에서도 같은 검출
 *   특성이 나온다(불스아이의 BULLSEYE_DARK/LIGHT 와 같은 규약).
 *   (이 자리에 있던 «luminance.js 는 아직 없다» 주석은 오래전에 사실이 아니게 됐다.)
 */

import {
  FACES, facePolygon, layoutForRegion, regionCells, axialToPixel, codeBounds,
  hexCorners, hexDistance, CORNER_UNIT_OFFSETS,
} from './hexgrid.js';
import { HYBRID_INNER_CUBE_BANDS, bandRadii, hybridCubeRadius } from './bullseye.js';
import {
  DEFAULT_FINDER_PATTERN_ID, LEGACY_FINDER_PATTERN_ID,
  FINDER_CELL_ORDER, FINDER_FACE_BITS, getFinderPattern,
} from './finder-patterns.js';
import { digitToRanks } from './lehmer.js';
import { BULLSEYE_MID, FINDER_CUBE_SEAM, FINDER_CUBE_TONES } from './luminance.js';
import { getOakFinderPattern } from './finder-oak-patterns.js';
import { getDaehanFinderPattern } from './finder-daehan.js';
import { moduleQuad } from './ygrid.js';
import { CENTRAL_V0_SOURCE_N, centralV0FinderCells } from './cellSurfaceFinal.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from './finder-selection.js';

// `cellLevels` 삼중 [T, L, R] 의 면 → 인덱스. 검출기(cell-finder-detect.js 의
// FACE_LEVEL_INDEX)와 **같은 표**여야 하며, `FACES` 배열의 나열 순서에 기대지
// 않는다 — 지금은 우연히 같지만 그 우연에 기대면 조용히 뒤집힌다.
const FINDER_LEVEL_FACE_INDEX = Object.freeze({ T: 0, L: 1, R: 2 });
import { qrMatrix } from './qr.js';

/** 콰이어트 존 기본 배수 — margin 미지정 시 `cellSize · DEFAULT_MARGIN_FACTOR`. */
const DEFAULT_MARGIN_FACTOR = 2;

// ── QR fallback 상수 (ADR 0004, SPEC §14 코너 QR 규약 준용) ─────────────────

/** qr.js 는 QR v1 고정(21×21) — SIZE 를 export 하지 않으므로 여기 재정의한다.
 *  값이 어긋나면 콰이어트 겹침·모듈 크기 계산이 조용히 깨지므로 테스트에서 실제
 *  `qrMatrix().size` 와의 일치를 단언한다. */
const QR_MODULE_GRID = 21;

/** 코너·중앙 QR 공통: 콰이어트 존 4모듈. */
const QR_QUIET_MODULES = 4;

/** 콰이어트 포함 QR 블록 한 변의 QR-모듈 수 (= 4 + 21 + 4). */
const QR_BLOCK_MODULES = QR_MODULE_GRID + 2 * QR_QUIET_MODULES;

/**
 * 코너 QR 이 실제로 렌더될 때만 쓰는 확대 margin 배수 (sceneY.js 와 동일 유도).
 * 겹침 없음의 필요충분조건: margin·0.25 + 29·(cellSize/2) ≤ margin ⟺ margin ≥ 19.33·s.
 */
const DEFAULT_MARGIN_FACTOR_QR = 20;

// 기준선·실험 후보를 모두 명시적 렌더 표현으로 정규화한다.
const CENTER_QR_FINDER_PATTERN_ID = 'center-qr';

/**
 * 기본 파인더는 일반 O/A 경로에만 적용한다. 중앙 QR은 자신의 렌더 표현을 명시해
 * 실험판 기본 cell-mask가 중앙 슬롯으로 역류하는 모순을 막는다.
 */
export function resolveSceneFinderPatternId(
  finderPatternId, centerQr, defaultFinderPatternId = DEFAULT_FINDER_PATTERN_ID,
) {
  if (finderPatternId !== undefined) return finderPatternId;
  return centerQr ? CENTER_QR_FINDER_PATTERN_ID : defaultFinderPatternId;
}

function resolveFinderRenderPattern(id) {
  if (id === LEGACY_FINDER_PATTERN_ID) return { id, renderKind: 'bullseye' };
  if (id === CENTER_QR_FINDER_PATTERN_ID) return { id, renderKind: 'center-qr' };
  if (id === CENTRAL_V0_FINDER_PATTERN_ID) return { id, renderKind: 'central-v0' };
  // OAK 후보(2026-08-18)는 생성 도구 산출물이 아니라 별도 표라 PATTERN_BY_ID 에
  // 없다. 여기서 먼저 풀고, 아니면 기존 조회가 «알 수 없는 id» 로 정확히 죽는다.
  const oak = getOakFinderPattern(id);
  if (oak) return oak;
  // daehan(2026-08-18)도 별도 표다. k 마다 발자국이 다르므로 id 가 셋이다.
  const daehan = getDaehanFinderPattern(id);
  if (daehan) return daehan;
  return getFinderPattern(id);
}

function isExperimentalFinderRenderKind(renderKind) {
  return renderKind === 'cell-mask'
    || renderKind === 'three-tone-cube'
    || renderKind === 'cube-bullseye';
}

/**
 * 중앙 19셀 슬롯의 Type Y 6축 지지 반지름(px). FINDER_CELL_ORDER의 육각 꼭짓점을
 * 여섯 큐브 축에 투영한 뒤 최솟값으로 유도한다. 이 반지름에 v0의 n 모듈을 맞추면
 * 톱니형 슬롯 외곽을 넘지 않는다.
 */
function centralSlotRadius(layout, center) {
  const points = FINDER_CELL_ORDER.flatMap((cell) =>
    hexCorners(cell.q, cell.r, layout));
  const supports = CORNER_UNIT_OFFSETS.map((axis) => Math.max(...points.map((point) =>
    (point.x - center.x) * axis.x + (point.y - center.y) * axis.y)));
  return Math.min(...supports);
}

/**
 * V*Q 중앙 QR 의 보호 콰이어트 모듈 수 (2026-08-09 사용자 지시 — "바깥 흰색 구간이
 * 큐브에 가려 조금 손실되더라도 중앙 QR 을 키워라").
 *
 * 확대 규약: **심볼 21×21 + 안전 콰이어트 1모듈 = 23모듈 사각**만 셀 무침범을
 * 보장하고, 바깥쪽 콰이어트 3모듈은 셀 폴리곤 **밑에 깔려** 잘린다 (painter:
 * 중앙 블록을 셀보다 먼저 그린다). 모듈 피치는 19셀 슬롯 안의 최대 중심 정사각을
 * 이분탐색으로 실계산해 유도한다 — 구판(안전 원판 내접, √26·s/29 ≈ 0.176s)보다
 * 커진다. 판독 안전성: 심볼 사방 1모듈 콰이어트는 유지되고, jsQR 재실측으로 확인.
 */
const QR_PROTECTED_QUIET = 1;

/** 보호 사각(심볼 + 안전 콰이어트) 한 변의 QR-모듈 수 = 1 + 21 + 1. */
const QR_PROTECTED_MODULES = QR_MODULE_GRID + 2 * QR_PROTECTED_QUIET;

/**
 * 코너 QR 위치 4택 (ADR 0004 §1-7 U11 개정). "좌상 고정" → "방위 고정 + 4택 위치".
 * **방위는 고정** — QR 매트릭스 자체를 회전하지 않는다. 위치만 bbox 코너로
 * 대칭 이동한다(기존 TL 배치 로직 그대로, 나머지 세 코너는 그 거울상).
 */
export const QR_CORNERS = Object.freeze(['TL', 'TR', 'BL', 'BR']);

function assertQrCorner(qrCorner) {
  if (!QR_CORNERS.includes(qrCorner)) {
    throw new RangeError(`qrCorner 는 ${QR_CORNERS.join(' | ')} 중 하나여야 한다: ${qrCorner}`);
  }
  return qrCorner;
}

/**
 * 코너 QR 블록(콰이어트 포함)의 좌상단 원점을 bbox 코너별로 계산한다.
 * TL 은 기존 로직(margin·0.25, margin·0.25) 그대로 — 나머지는 layout.width/height
 * 기준 대칭 이동(방위 고정, 위치만 이동).
 */
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

/** 짝홀 point-in-polygon (raster.js 와 동일 규약). */
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 축평행 사각형과 폴리곤의 겹침 — 꼭짓점 상호 포함 + 변 교차 검사. */
function rectPolyOverlap(rect, poly) {
  for (const p of poly) {
    if (p.x > rect.minX && p.x < rect.maxX && p.y > rect.minY && p.y < rect.maxY) return true;
  }
  const corners = [
    { x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY },
  ];
  for (const c of corners) {
    if (pointInPoly(c.x, c.y, poly)) return true;
  }
  // 변 교차: 사각형 4변 × 폴리곤 변
  const rectEdges = corners.map((c, i) => [c, corners[(i + 1) % 4]]);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    for (const [a, b] of rectEdges) {
      if (segmentsIntersect(a, b, poly[j], poly[i])) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false; // 평행(공선 접촉은 보호 여유가 흡수)
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/**
 * 셀 한 면의 색. `entry.tones` 가 있으면 면별 절대 톤(0/1/2), 없으면 digit 순위 —
 * **어느 쪽이든 `palette.levels` 를 쓴다.** 데이터 셀은 tones 를 안 들므로 무변경.
 * 톤이 실렸는데 0/1/2 가 아니면 조용한 digit 폴백 없이 던진다.
 *
 * ⚠ **파인더 축(bullseyeLight/MID/Dark)을 쓰면 안 된다 — 실루엣이 깨진다.**
 * 2026-08-20 에 「마커가 데이터와 눈으로 안 갈린다」를 고치려고 마커를 파인더 축으로
 * 보냈다가 **원거리 인식률이 떨어졌다**(운영자 실기기 보고). 이유는 수치가 말한다:
 *
 *     안전영역·흰 지면        Y ≈ 1.0
 *     bullseyeLight  #ffffff  Y = 1.0000   ← 지면과 **구별 불가**. 실루엣에 구멍이 뚫린다
 *     levels[2]      #dce4f0  Y = 0.7699   ← 밝지만 착색돼 있어 윤곽이 남는다
 *
 * 즉 「데이터와 다르게」를 좇다가 「배경과도 다르게」를 잃었다. 검출의 1단계는 **실루엣**
 * 이고, 그 앞에서는 데이터와의 구별이 아무 의미가 없다.
 *
 * ⇒ 규약: **색은 데이터와 같은 팔레트, 구별은 «조합»으로.** 마커 셀은 비-순열 조합
 * (같은 톤이 두 면 이상)을 쓸 수 있고 데이터 셀은 못 쓴다 — 눈으로도 평평해 보여 갈리고,
 * 검출기는 절대 톤 채점(orientation-scorer)으로 그 성질을 읽는다. 팔레트가 단조
 * (0.0612 < 0.2436 < 0.7699)라 톤 순서가 보존되므로 그 채점은 그대로 선다.
 */
function faceColor(entry, face, palette) {
  const tones = entry && entry.tones;
  if (tones) {
    const level = tones[face];
    if (level !== 0 && level !== 1 && level !== 2) {
      throw new RangeError('scene: tones.' + face + ' 가 0/1/2 가 아니다: ' + level);
    }
    return palette.levels[level];
  }
  return palette.levels[digitToRanks(entry.digit)[face]];
}

/** 콰이어트 패치(밝음) + QR 다크 모듈들을 axis-aligned 사각형 폴리곤으로 shapes 에 밀어넣는다. */
function pushQrBlock(shapes, qr, blockOrigin, qrModuleSize, palette) {
  const blockSide = QR_BLOCK_MODULES * qrModuleSize;
  shapes.push({
    kind: 'polygon',
    points: [
      { x: blockOrigin.x, y: blockOrigin.y },
      { x: blockOrigin.x + blockSide, y: blockOrigin.y },
      { x: blockOrigin.x + blockSide, y: blockOrigin.y + blockSide },
      { x: blockOrigin.x, y: blockOrigin.y + blockSide },
    ],
    color: palette.bullseyeLight,
  });

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

/**
 * 인코딩 결과로부터 scene 을 조립한다.
 *
 * @param {{k: number, cellDigits: Map<string, {digit: number, role: string}>}} encoded
 * @param {{
 *   palette: {background: {r,g,b}, levels: [{r,g,b},{r,g,b},{r,g,b}], bullseyeDark: {r,g,b}, bullseyeLight: {r,g,b}},
 *   cellSize?: number, margin?: number,
 *   qrText?: string, centerQr?: boolean, cornerToo?: boolean,
 *   finderPatternId?: string,
 *   qrCorner?: 'TL'|'TR'|'BL'|'BR',
 * }} options
 * @returns {{k: number, layout: object, width: number, height: number, background: {r,g,b}, shapes: Array}}
 */
export function buildScene(encoded, options) {
  if (encoded === null || typeof encoded !== 'object') {
    throw new TypeError('encoded 는 객체여야 한다');
  }
  const { k, cellDigits } = encoded;
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`encoded.k 는 0 이상의 정수여야 한다: ${k}`);
  }
  if (!(cellDigits instanceof Map)) {
    throw new TypeError('encoded.cellDigits 는 Map 이어야 한다');
  }

  const opts = options || {};
  const palette = opts.palette;
  if (palette === null || typeof palette !== 'object') {
    throw new TypeError('palette 는 객체여야 한다');
  }

  // centerQr 의 단일 소스는 encoded.centerQr 다 (Type Y 의 encoded.tones 패턴과 동형 —
  // 검증 라운드 major: 포맷 인덱스(V*Q 4~6)와 렌더된 파인더가 어긋난 자기모순 아티팩트를
  // opts 단독 결정이 조용히 허용했다). opts.centerQr 는 명시 시 일치 검증용으로만 받는다.
  const encodedCenterQr = Boolean(encoded.centerQr);
  if (opts.centerQr !== undefined) {
    if (typeof opts.centerQr !== 'boolean') {
      throw new TypeError(`centerQr 는 boolean 이어야 한다: ${typeof opts.centerQr}`);
    }
    if (opts.centerQr !== encodedCenterQr) {
      throw new RangeError(
        `centerQr 불일치: encoded.centerQr=${encodedCenterQr} vs options.centerQr=${opts.centerQr} — `
        + '포맷 정보(V*Q 인덱스)와 파인더 렌더가 어긋난 코드는 복호 불능이다 (ADR 0004 §1-3)',
      );
    }
  }
  const centerQr = encodedCenterQr;
  const finderPatternId = resolveSceneFinderPatternId(opts.finderPatternId, centerQr);
  if (typeof finderPatternId !== 'string') {
    throw new TypeError(`finderPatternId 는 문자열이어야 한다: ${typeof finderPatternId}`);
  }
  // DEFAULT 는 빌드별 초기값이다. 기준선과 실험 후보를 모두 렌더 표현으로 정규화해
  // 두 데이터 모양을 같은 마스크 분기로 잘못 보내지 않는다.
  const finderPattern = resolveFinderRenderPattern(finderPatternId);
  const centralV0 = Boolean(encoded.centralV0);
  const rendersCentralV0 = finderPattern.renderKind === 'central-v0';
  const centralSlotOccupants = [
    centerQr ? 'centerQr' : null,
    isExperimentalFinderRenderKind(finderPattern.renderKind)
      ? `실험 파인더(${finderPatternId})` : null,
    centralV0 ? 'centralV0' : null,
  ].filter(Boolean);
  if (centralSlotOccupants.length > 1) {
    throw new RangeError(
      `중앙 슬롯 점유자는 하나만 렌더할 수 있다: ${centralSlotOccupants.join(' + ')}`,
    );
  }
  if (centralV0 !== rendersCentralV0) {
    throw new RangeError(
      `centralV0 불일치: encoded.centralV0=${centralV0} vs finderPatternId=${finderPatternId}`,
    );
  }
  if (!centerQr && finderPattern.renderKind === 'center-qr') {
    throw new RangeError(
      'center-qr 기준선은 encoded.centerQr=true 일 때만 렌더할 수 있다',
    );
  }
  const cornerToo = opts.cornerToo === undefined ? false : opts.cornerToo;
  if (typeof cornerToo !== 'boolean') {
    throw new TypeError(`cornerToo 는 boolean 이어야 한다: ${typeof cornerToo}`);
  }
  // V*Q 는 QR 없이는 무의미 (ADR 0004 §1-4).
  if (centerQr && opts.qrText === undefined) {
    throw new RangeError('centerQr=true 인데 qrText 가 없다 — V*Q(중앙 QR)는 qrText 없이 렌더할 수 없다');
  }

  const cellSize = opts.cellSize === undefined ? 1 : opts.cellSize;

  const qrCorner = opts.qrCorner === undefined ? 'TL' : assertQrCorner(opts.qrCorner);

  // 코너 QR 을 실제로 그릴지 — qrText 가 있고, (centerQr 이 아니거나, centerQr 이어도
  // cornerToo 로 병행 요청된 경우) (ADR 0004 §1-3·§1-4: centerQr 기본값은 코너 생략).
  const needsCornerQr = opts.qrText !== undefined && (!centerQr || cornerToo);

  const defaultMargin = needsCornerQr
    ? DEFAULT_MARGIN_FACTOR_QR * cellSize
    : DEFAULT_MARGIN_FACTOR * cellSize;
  const margin = opts.margin === undefined ? defaultMargin : opts.margin;

  const layout = layoutForRegion(k, { size: cellSize, margin });

  const shapes = [];
  const center0 = axialToPixel(0, 0, layout);

  // (0) V*Q 중앙 QR 블록 — **셀보다 먼저** 그린다 (확대 규약: 바깥 콰이어트 3모듈은
  // 셀이 위에 덮어 잘린다. QR_PROTECTED_QUIET 주석 참조). 모듈 피치는 19셀 슬롯 안
  // 최대 중심 정사각을 이분탐색(고정 48회 — 결정적)으로 실계산해 유도한다.
  if (centerQr) {
    const qr = qrMatrix(opts.qrText);
    if (qr.size !== QR_MODULE_GRID) {
      throw new Error(`qrMatrix().size(${qr.size}) 가 예상(${QR_MODULE_GRID}) 과 다르다`);
    }
    // 슬롯 경계 = ring 3 셀 (hexDistance 3) — 더 바깥 링은 항상 더 멀다.
    const ring3Polys = regionCells(3)
      .filter((c) => hexDistance(c.q, c.r) === 3)
      .map((c) => hexCorners(c.q, c.r, layout));
    const protectedRectAt = (side) => ({
      minX: center0.x - side / 2,
      minY: center0.y - side / 2,
      maxX: center0.x + side / 2,
      maxY: center0.y + side / 2,
    });
    let lo = 0;
    let hi = 10 * cellSize;
    for (let it = 0; it < 48; it += 1) {
      const mid = (lo + hi) / 2;
      const hit = ring3Polys.some((poly) => rectPolyOverlap(protectedRectAt(mid), poly));
      if (hit) hi = mid;
      else lo = mid;
    }
    const protectedSide = lo * 0.995; // 수치 접촉 회피 여유
    const qrModuleSize = protectedSide / QR_PROTECTED_MODULES;
    // 안전 재단언 (이분탐색과 중복이지만 계약 명시용).
    const guard = protectedRectAt(QR_PROTECTED_MODULES * qrModuleSize);
    for (const poly of ring3Polys) {
      if (rectPolyOverlap(guard, poly)) {
        throw new Error('V*Q 보호 영역(심볼+콰이어트 1모듈)이 ring-3 셀과 겹친다 — 유도 버그');
      }
    }
    const blockSide = QR_BLOCK_MODULES * qrModuleSize;
    const blockOrigin = { x: center0.x - blockSide / 2, y: center0.y - blockSide / 2 };
    pushQrBlock(shapes, qr, blockOrigin, qrModuleSize, palette);
  }

  // (1) 셀 3면 폴리곤 — cellDigits 삽입 순서 그대로 순회한다(Type A 회귀 —
  // ADR 0005 D1: 삼각 패치 셀은 hexDistance(q,r) > k 라 regionCells(k) 필터로는
  // 절대 걸리지 않는다. cellDigits 는 인코더(encode.js/encodeA.js)가 이미 결정적
  // 순서로 구성해 두므로, 여기서는 그 삽입 순서를 그대로 painter 순서로 쓴다 —
  // 불스아이 셀만 애초에 Map 에 없어 자동 제외된다(육각·삼각 공통).
  // Type O 회귀 계약: 셀 폴리곤끼리는 서로 겹치지 않으므로(인접 셀은 변만 공유)
  // 순회 순서가 바뀌어도 최종 shapes 는 regionCells(k) 필터 방식과 **집합으로
  // 동일**하다 — test/scene.test.js 의 신구 순회 비교 회귀 테스트가 encode.js
  // 실산출물로 이를 단언한다.
  // 셀 캔버스 포함 가드 — layoutForRegion(k) 캔버스는 육각(Type O) 실루엣 기준이라
  // Type A 삼각 패치 셀은 기본 margin(×2)에서 캔버스 밖으로 밀려난다. 래스터는
  // 캔버스 밖 픽셀을 조용히 버리므로 데이터가 **침묵 소실**된다 — '조용히 맞추지
  // 않는다' 규약대로 이탈을 감지하면 throw 한다 (검증 lane 2026-08-09 지적).
  // 근본 수정(삼각 실루엣 자체 layout 유도)은 후속 과제 — 그때까지 호출자는
  // margin 을 늘려서 수용한다 (코너 QR 경로의 ×20 은 A1/A2 실측 수용 확인).
  let cellMinX = Infinity;
  let cellMinY = Infinity;
  let cellMaxX = -Infinity;
  let cellMaxY = -Infinity;
  for (const [key, entry] of cellDigits) {
    const commaIdx = key.indexOf(',');
    const q = Number(key.slice(0, commaIdx));
    const r = Number(key.slice(commaIdx + 1));
    for (const face of FACES) {
      const points = facePolygon(q, r, face, layout);
      for (const p of points) {
        if (p.x < cellMinX) cellMinX = p.x;
        if (p.y < cellMinY) cellMinY = p.y;
        if (p.x > cellMaxX) cellMaxX = p.x;
        if (p.y > cellMaxY) cellMaxY = p.y;
      }
      shapes.push({
        kind: 'polygon',
        points,
        color: faceColor(entry, face, palette),
      });
    }
  }
  if (cellDigits.size > 0) {
    const eps = 1e-9;
    if (cellMinX < -eps || cellMinY < -eps
      || cellMaxX > layout.width + eps || cellMaxY > layout.height + eps) {
      throw new RangeError(
        `셀 폴리곤이 캔버스(${layout.width}×${layout.height})를 벗어난다 — `
        + `x[${cellMinX}, ${cellMaxX}] y[${cellMinY}, ${cellMaxY}]. `
        + 'Type A 삼각 패치는 육각 기준 기본 margin 으로 수용되지 않는다 — margin 을 늘려야 한다',
      );
    }
  }

  const center = center0;

  if (finderPattern.renderKind === 'three-tone-cube') {
  // 인코더 cellDigits 에 이 슬롯이 없으므로 용량·오버헤드·포맷 정보는 전혀 바뀌지 않는다.
    // (2a) 19셀 슬롯에서 Type Y 경로가 데이터 링과 분리해 검출하는 최대 실측 큐브.
    // 같은 실루엣/Y 심을 만들고, T/L/R 밝기 순위(밝음/중간/어두움)에서 방향을 읽는다.
    const radius = finderPattern.radiusCells * cellSize;
    const cubeLayout = { size: radius, originX: center.x, originY: center.y };
    const slotLayout = {
      size: finderPattern.slotRadiusCells * cellSize,
      originX: center.x,
      originY: center.y,
    };
    // 데이터 ring-3과 연결되지 않도록 19셀 슬롯 전체를 배경으로 먼저 덮는다.
    // 0.25c 경계는 기존 Type Y 연결요소 실루엣 검출을 그대로 재사용하기 위한 최소 띠다.
    //
    // ⚠ 투명 배경에서는 이 칠을 **넣지 않는다.** shape.color 는 언제나 구체 {r,g,b} 이고
    //   투명(null)이 허용되는 곳은 scene.background 하나뿐이다 — raster.js·svg.js 는
    //   shape.color.r 을 무조건 읽으므로 null 이 새면 렌더 전체가 죽는다. bgMode 기본값이
    //   transparent 라 큐브를 고르는 즉시 재현됐다 (2026-08-12 라이브 결함).
    //   빼도 되는 근거: 이 칠 밑에는 애초에 아무 shape 도 없다 — 19셀 슬롯은 cellDigits 에서
    //   빠져 있고 ring-3 은 슬롯 밖이다. O V1~V3 · A A1~A2 실측 전부 «칠 유무 픽셀 차이 0»
    //   이라 불투명에서도 방어적 no-op 이고, 투명에서는 안 칠하는 것이 곧 배경이다.
    if (palette.background !== null) {
      for (const face of FACES) {
        shapes.push({
          kind: 'polygon',
          points: facePolygon(0, 0, face, slotLayout),
          color: palette.background,
        });
      }
    }
    for (const face of FACES) {
      shapes.push({
        kind: 'polygon',
        points: facePolygon(0, 0, face, cubeLayout),
        // 데이터 레벨이 아니라 고정 파인더 색을 쓴다 — 이유는 FINDER_CUBE_TONES 주석.
        // 순위(=방향 정보)는 그대로다. 바뀐 건 그 순위를 어떤 실제 색으로 그리느냐뿐.
        color: FINDER_CUBE_TONES[finderPattern.toneRanks[face]],
      });
    }
    const seamHalfWidth = 0.075 * cellSize;
    for (const cornerIndex of [1, 3, 5]) {
      const unit = CORNER_UNIT_OFFSETS[cornerIndex];
      const perpendicular = { x: -unit.y, y: unit.x };
      const far = { x: center.x + unit.x * radius, y: center.y + unit.y * radius };
      shapes.push({
        kind: 'polygon',
        points: [
          { x: center.x + perpendicular.x * seamHalfWidth, y: center.y + perpendicular.y * seamHalfWidth },
          { x: far.x + perpendicular.x * seamHalfWidth, y: far.y + perpendicular.y * seamHalfWidth },
          { x: far.x - perpendicular.x * seamHalfWidth, y: far.y - perpendicular.y * seamHalfWidth },
          { x: center.x - perpendicular.x * seamHalfWidth, y: center.y - perpendicular.y * seamHalfWidth },
        ],
        // 프리셋의 어두운색이 아니라 **심 전용 상수**다 — 순검정은 전경 마스크에서
        // 배경으로 먹혀 ppu 24~30 에서 큐브를 세 조각으로 갈랐다. 이유는 FINDER_CUBE_SEAM 주석.
        color: FINDER_CUBE_SEAM,
      });
    }
    shapes.push({
      kind: 'disc',
      cx: center.x,
      cy: center.y,
      r: 0.18 * cellSize,
      color: palette.bullseyeDark,
    });
  } else if (finderPattern.renderKind === 'cube-bullseye') {
    /*
     * 하이브리드 — 바깥은 불스아이 링(위치·스케일), 안쪽은 3톤 큐브(방향).
     *
     * 밴드 격자는 canonical `bandRadii` 그대로다. 안쪽 HYBRID_INNER_CUBE_BANDS 개만
     * 큐브로 갈아 끼우므로 남는 링은 원래 반지름·원래 명암을 유지한다 — 검출기가 쓰는
     * 정규 기하(`profileAt`·밴드 인덱스)를 한 줄도 안 바꾸고 재사용하려는 것이 목적이다.
     *
     * ⚠ 순수 큐브에 있던 **Y 심 3줄과 중심점은 여기 없다.** 그 둘은 실루엣 검출기가
     *   Y-접합을 찾으라고 넣은 장치인데, 하이브리드는 위치를 링에서 얻고 방향만 면 톤
     *   중앙값으로 읽으므로 쓸 데가 없다. 반지름이 3.5c → 1.2c 로 줄어 같은 비율이면
     *   9px/cell 에서 0.2px 대의 선이 되고, 그 sub-pixel 검정 선이 세 면의 중앙값을
     *   중심 근처에서 오염시키기만 한다. 서로 다른 밝기의 마름모 3개가 한 점에서 만나는
     *   것 자체가 아이소메트릭 큐브다 — 심은 윤곽이지 구조가 아니다.
     */
    const radii = bandRadii(cellSize);
    for (let i = radii.length - 1; i >= HYBRID_INNER_CUBE_BANDS; i -= 1) {
      shapes.push({
        kind: 'disc',
        cx: center.x,
        cy: center.y,
        r: radii[i],
        color: i % 2 === 0 ? palette.bullseyeDark : palette.bullseyeLight,
      });
    }
    const cubeLayout = {
      size: hybridCubeRadius(cellSize),
      originX: center.x,
      originY: center.y,
    };
    for (const face of FACES) {
      shapes.push({
        kind: 'polygon',
        points: facePolygon(0, 0, face, cubeLayout),
        // 프리셋이 아니라 고정 포맷 상수 — 이유는 FINDER_CUBE_TONES 주석.
        color: FINDER_CUBE_TONES[finderPattern.toneRanks[face]],
      });
    }
  } else if (finderPattern.renderKind === 'central-v0') {
    // Type Y v0 정본의 13×13 좌표를 중앙 19셀 슬롯에 닮음 이동한다. 슬롯 반지름은
    // FINDER_CELL_ORDER의 실제 육각 외곽에서, 모듈 피치는 그 반지름/n에서 유도한다.
    // 정본에 없는 셀은 그리지 않는다 — 이 점유자는 payload가 없는 순수 파인더다.
    const v0Layout = {
      size: centralSlotRadius(layout, center) / CENTRAL_V0_SOURCE_N,
      originX: center.x,
      originY: center.y,
    };
    for (const cell of centralV0FinderCells()) {
      for (const face of FACES) {
        shapes.push({
          kind: 'polygon',
          points: moduleQuad(face, cell.i, cell.j, v0Layout),
          // 파인더 축(순백)을 쓰지 않는다. v0 정본의 면 톤을 현재 데이터 팔레트에 보존한다.
          color: palette.levels[cell[face]],
        });
      }
    }
  } else if (finderPattern.renderKind === 'cell-mask') {
    // 3레벨 후보(OAK, 2026-08-18)는 `cellLevels` 를, 기존 이진 실험 파인더는
    // `cellMasks` 를 든다. 둘 다 있으면 **레벨이 이긴다** — 검출기의
    // normalizePatterns 와 같은 우선순위여야 그린 것과 읽는 것이 안 갈린다.
    const levels = Array.isArray(finderPattern.cellLevels) ? finderPattern.cellLevels : null;
    // 발자국 — 기본은 예약 19셀(regionCells(2) 순서). daehan(2026-08-18)처럼
    // `finderCells` 를 든 패턴은 그 목록을 그대로 쓴다. **검출기의 footprintOf 와
    // 같은 규칙**이어야 한다 (cell-finder-detect.js) — 갈리면 그린 것과 읽는 것이 갈린다.
    const footprint = Array.isArray(finderPattern.finderCells)
      ? finderPattern.finderCells : FINDER_CELL_ORDER;
    for (let ci = 0; ci < footprint.length; ci += 1) {
      const cell = footprint[ci];
      // 반경 k 밖은 그리지 않는다 (운영자 확정: 절대 좌표를 모든 해상도에서 그대로
      // 쓰고 밖은 잘린다). daehan 은 k 별 패턴이 이미 잘려 있으므로 이 가드는 보통
      // 안 걸리지만, 걸리면 **캔버스 밖 침묵 소실**이 되므로 여기서 막는다.
      if (hexDistance(cell.q, cell.r) > k) continue;
      const mask = levels ? 0 : finderPattern.cellMasks[ci];
      for (const face of FACES) {
        // 중간톤은 팔레트가 아니라 **고정 상수**다 — 이유는 FINDER_CUBE_TONES 주석
        // (파인더는 검출 기구라 프리셋을 안 따른다). dark/light 는 팔레트 경유가
        // 이미 관례라 그대로 두고, 세 번째 값만 상수로 든다.
        let color;
        if (levels) {
          const level = levels[ci][FINDER_LEVEL_FACE_INDEX[face]];
          color = level === 2 ? palette.bullseyeLight
            : level === 1 ? BULLSEYE_MID : palette.bullseyeDark;
        } else {
          color = mask & FINDER_FACE_BITS[face] ? palette.bullseyeLight : palette.bullseyeDark;
        }
        shapes.push({
          kind: 'polygon',
          points: facePolygon(cell.q, cell.r, face, layout),
          color,
        });
      }
    }
  } else if (finderPattern.renderKind === 'bullseye' && !centerQr) {
    // (2) 불스아이 6 disc — 바깥 밴드(반지름 큰 것)부터. i(0=중심)가 짝수면 dark, 홀수면 light.
    const radii = bandRadii(cellSize); // 오름차순(안→밖), 마지막이 R_max.
    for (let i = radii.length - 1; i >= 0; i -= 1) {
      shapes.push({
        kind: 'disc',
        cx: center.x,
        cy: center.y,
        r: radii[i],
        color: i % 2 === 0 ? palette.bullseyeDark : palette.bullseyeLight,
      });
    }
  } else if (finderPattern.renderKind !== 'center-qr' && finderPattern.renderKind !== 'bullseye') {
    throw new RangeError('지원하지 않는 파인더 렌더 표현: ' + finderPattern.renderKind);
  }
  // (centerQr 의 중앙 블록은 (0) 에서 이미 — 셀 밑에 깔리는 painter 순서가 확대 규약이다.)

  // (3) 코너 QR 블록 — sceneY.js 와 동일 painter 패턴(콰이어트 4모듈 밝은 패치 +
  // 다크 모듈, QR 모듈 = cellSize/2). 위치는 qrCorner 4택(ADR 0004 §1-7) — 방위는
  // 고정하고 bbox 코너로 대칭 이동만 한다. codeBounds(k, layout) 실루엣과 무교차를
  // 코너별로 단언한다(기존 TL 전용 검사의 일반화).
  if (needsCornerQr) {
    const qr = qrMatrix(opts.qrText);
    if (qr.size !== QR_MODULE_GRID) {
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
    const silhouetteRect = codeBounds(k, layout);
    if (rectsOverlap(blockRect, silhouetteRect)) {
      throw new Error(
        `코너 QR 블록(콰이어트 포함, qrCorner=${qrCorner})이 코드 실루엣(codeBounds)과 겹친다 — `
          + `margin 을 늘려야 한다: 블록=${JSON.stringify(blockRect)}, 실루엣=${JSON.stringify(silhouetteRect)}`,
      );
    }
    pushQrBlock(shapes, qr, blockOrigin, qrModuleSize, palette);
  }

  return {
    k,
    layout,
    width: layout.width,
    height: layout.height,
    background: palette.background,
    finderPatternId: centerQr ? 'centerQr' : finderPatternId,
    shapes,
  };
}
