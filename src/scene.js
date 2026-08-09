/**
 * scene.js — 인코딩 결과 → 결정적 도형(scene) 전개 (SPEC §3, §4.1, §5.1)
 *
 * 인코더 산출물(셀별 digit)을 캔버스 미리보기 / PNG·SVG export 가 공유 소비할
 * 단일 도형 목록으로 펼친다. 여기서 확정한 순서(painter order)가 계약이다 —
 * 이후 어떤 백엔드도 이 순서를 재해석하지 않고 그대로 따라 그린다.
 *
 * 이 모듈은 순수 기하 + 계약 조립만 다룬다. luminance.js·encode.js 는 아직
 * 없으므로(병렬 lane 작성 중) import 하지 않는다 — encoded/palette 는 인터페이스
 * 계약으로만 다룬다.
 */

import {
  FACES, facePolygon, layoutForRegion, regionCells, axialToPixel, codeBounds,
} from './hexgrid.js';
import { bandRadii, maxSafeRadius } from './bullseye.js';
import { digitToRanks } from './lehmer.js';
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
 *
 * 코너 QR 블록(콰이어트 포함, 1 QR-모듈 = cellSize/2 피치)의 좌상단은
 * (margin·0.25, margin·0.25) 에 고정된다(계약, sceneY.js 와 동일 painter 패턴).
 * `layoutForRegion(k, {size, margin})` 의 좌상단도 항상 정확히 (margin, margin)
 * 이다 — codeBounds(k, layout).minX = originX − halfW = margin (k·size 에 무관,
 * originX = margin − b.minX = margin + halfW 이므로).
 *
 * 따라서 겹침 없음의 필요충분조건은:
 *   margin·0.25 + QR_BLOCK_MODULES·(cellSize/2) <= margin
 *   ⟺ margin >= (2·QR_BLOCK_MODULES/3)·cellSize ≈ 19.33·cellSize
 * sceneY.js 와 동일 상수(20)로 여유를 둔다.
 */
const DEFAULT_MARGIN_FACTOR_QR = 20;

function rectsOverlap(a, b) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
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
  const cornerToo = opts.cornerToo === undefined ? false : opts.cornerToo;
  if (typeof cornerToo !== 'boolean') {
    throw new TypeError(`cornerToo 는 boolean 이어야 한다: ${typeof cornerToo}`);
  }
  // V*Q 는 QR 없이는 무의미 (ADR 0004 §1-4).
  if (centerQr && opts.qrText === undefined) {
    throw new RangeError('centerQr=true 인데 qrText 가 없다 — V*Q(중앙 QR)는 qrText 없이 렌더할 수 없다');
  }

  const cellSize = opts.cellSize === undefined ? 1 : opts.cellSize;

  // 코너 QR 을 실제로 그릴지 — qrText 가 있고, (centerQr 이 아니거나, centerQr 이어도
  // cornerToo 로 병행 요청된 경우) (ADR 0004 §1-3·§1-4: centerQr 기본값은 코너 생략).
  const needsCornerQr = opts.qrText !== undefined && (!centerQr || cornerToo);

  const defaultMargin = needsCornerQr
    ? DEFAULT_MARGIN_FACTOR_QR * cellSize
    : DEFAULT_MARGIN_FACTOR * cellSize;
  const margin = opts.margin === undefined ? defaultMargin : opts.margin;

  const layout = layoutForRegion(k, { size: cellSize, margin });

  const shapes = [];

  // (1) 셀 3면 폴리곤 — regionCells(k) 순회 순서로, cellDigits 에 있는 셀만.
  for (const { q, r } of regionCells(k)) {
    const key = `${q},${r}`;
    const entry = cellDigits.get(key);
    if (entry === undefined) continue; // 불스아이 셀은 Map 에 없다.
    const ranks = digitToRanks(entry.digit);
    for (const face of FACES) {
      shapes.push({
        kind: 'polygon',
        points: facePolygon(q, r, face, layout),
        color: palette.levels[ranks[face]],
      });
    }
  }

  const center = axialToPixel(0, 0, layout);

  if (!centerQr) {
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
  } else {
    // (2') 중앙 QR 변형(V*Q, ADR 0004 §1-3~§1-5) — 불스아이 disc 6개 대신
    // 중심 정렬 축평행 QR 블록. QR 모듈 크기는 불스아이 안전 원판(R = maxSafeRadius)
    // 에 내접하는 정사각형 변을 29(콰이어트 포함 QR 모듈수)로 나눈 값
    // (= √26·cellSize/29, ADR 0004 §2 닫힌 형태 — 여기서는 실제 R 에서 유도해
    // bullseye.js 쪽 공식이 바뀌어도 자동으로 정합한다).
    const qr = qrMatrix(opts.qrText);
    if (qr.size !== QR_MODULE_GRID) {
      throw new Error(`qrMatrix().size(${qr.size}) 가 예상(${QR_MODULE_GRID}) 과 다르다`);
    }
    const R = maxSafeRadius(cellSize);
    const qrModuleSize = (R * Math.sqrt(2)) / QR_BLOCK_MODULES;
    const blockSide = QR_BLOCK_MODULES * qrModuleSize;
    const blockOrigin = { x: center.x - blockSide / 2, y: center.y - blockSide / 2 };
    pushQrBlock(shapes, qr, blockOrigin, qrModuleSize, palette);
  }

  // (3) 코너 QR 블록 — sceneY.js 와 동일 painter 패턴(콰이어트 4모듈 밝은 패치 +
  // 다크 모듈, QR 모듈 = cellSize/2, 캔버스 좌상단). codeBounds(k, layout) 실루엣과
  // 무교차를 단언한다.
  if (needsCornerQr) {
    const qr = qrMatrix(opts.qrText);
    if (qr.size !== QR_MODULE_GRID) {
      throw new Error(`qrMatrix().size(${qr.size}) 가 예상(${QR_MODULE_GRID}) 과 다르다`);
    }
    const qrModuleSize = cellSize / 2;
    const blockOrigin = { x: margin * 0.25, y: margin * 0.25 };
    const blockSide = QR_BLOCK_MODULES * qrModuleSize;
    const blockRect = {
      minX: blockOrigin.x,
      minY: blockOrigin.y,
      maxX: blockOrigin.x + blockSide,
      maxY: blockOrigin.y + blockSide,
    };
    const silhouetteRect = codeBounds(k, layout);
    if (rectsOverlap(blockRect, silhouetteRect)) {
      throw new Error(
        '코너 QR 블록(콰이어트 포함)이 코드 실루엣(codeBounds)과 겹친다 — margin 을 늘려야 한다: '
          + `블록=${JSON.stringify(blockRect)}, 실루엣=${JSON.stringify(silhouetteRect)}`,
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
    shapes,
  };
}
