/**
 * epsilon-harness.mjs — ε_real 선행 측정 하네스 (P0b, `.agent/PM/005_ecc_redesign.md`)
 *
 * ADR 0001 / PM-005 P0b 의 핵심 전제: **ε_real 측정에는 RS 도 base 변환도 필요 없다.**
 * 파이프라인은 순수하게 "순위가 보존되는가" 만 본다:
 *
 *   알려진 digit 배열 → 렌더(in-memory) → 합성 왜곡 → 면별 원판 median 샘플
 *   → 순위 복원 → 원본과 비교
 *
 * ⚠ 이 렌더러는 임시다. `hexgrid.js` 의 facePolygon/faceSampleDisc 를 그대로 쓰지만,
 * 채색·안티에일리어싱·해상도 전부 "Δmin(0.26) 만 지키는 평면 채색"이면 충분한 수준으로
 * 단순화했다. T9(진짜 렌더러) 산출물로 승격하지 않는다(PM-005 P0b 명시) — 그래서
 * `src/` 가 아니라 `tools/` 에 둔다.
 *
 * 이 모듈은 Node 전용 API(`node:*`)를 쓴다 — tools/ 는 브라우저 호환 예외 대상이다
 * (`AGENTS.md`/작업 지침 절대 규칙 2).
 */

import { pathToFileURL } from 'node:url';
import {
  FACES,
  facePolygon,
  faceSampleDisc,
  layoutForRegion,
  regionCells,
  cellCount,
  codeBounds,
} from '../src/hexgrid.js';
import { digitToRanks, ranksToDigit } from '../src/lehmer.js';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 평면 3레벨 스타일. Δmin = 0.76 - 0.50 = 0.50 - 0.24 = 0.26 ≥ 0.12 (SPEC 요건 충족). */
export const LEVELS = Object.freeze([0.24, 0.50, 0.76]);

/** ADR/PM-005 밴드 경계 (digit 오류율, %). */
export const BANDS = Object.freeze({
  T1: 0.15,
  T2: 2.6,
  T3: 4.16,
});

/** 밴드 판정. */
export function classifyBand(epsilonPercent) {
  if (epsilonPercent < BANDS.T1) return 'T1';
  if (epsilonPercent < BANDS.T2) return 'T2';
  if (epsilonPercent < BANDS.T3) return 'T3';
  return 'T4';
}

// ─────────────────────────────────────────────────────────────────────────────
// 결정적 RNG (mulberry32) — 시드 고정으로 재현성 보장
// ─────────────────────────────────────────────────────────────────────────────

/** @param {number} seed @returns {() => number} [0,1) 균등분포 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller 표준정규분포 샘플. */
export function gaussianSample(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 문자열+정수 여러 개를 섞어 32bit 정수 시드를 만든다 (축·파라미터·trial 별 독립 시드). */
export function deriveSeed(...parts) {
  let h = 0x811c9dc5; // FNV-1a 오프셋
  const str = parts.join('|');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 래스터 렌더러 (임시)
// ─────────────────────────────────────────────────────────────────────────────

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampInt(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** 짝-홀 규칙 point-in-polygon. `poly` 는 이미 래스터 픽셀 좌표. */
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function fillPolygon(data, width, height, poly, value) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(width - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(height - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, poly)) data[y * width + x] = value;
    }
  }
}

/**
 * digit 배열 → Float64Array 휘도 래스터.
 * @param {{q:number,r:number}[]} cells
 * @param {number[]} digits cells 와 같은 길이, 0..5
 * @param {object} layout `layoutForRegion()` 산출물
 * @param {{resolution?: number, background?: number}} [opts]
 * @returns {{data: Float64Array, width: number, height: number, resolution: number, layout: object}}
 */
export function renderRaster(cells, digits, layout, opts = {}) {
  if (cells.length !== digits.length) {
    throw new RangeError('cells 와 digits 는 길이가 같아야 한다');
  }
  const resolution = opts.resolution === undefined ? 12 : opts.resolution;
  // 배경 기본값은 어떤 LEVELS 값과도 달라야 한다 — 0.5 는 LEVELS[1] 과 정확히
  // 일치해서, 프레이밍/clamp 누출 시 중간 레벨 면이 배경을 읽어도 오류가 구조적으로
  // 비가시였다 (검증 라운드 지적). 0.37 은 세 레벨 어느 것과도 0.13 이상 떨어져 있다.
  const background = opts.background === undefined ? 0.37 : opts.background;
  const width = Math.max(1, Math.round(layout.width * resolution));
  const height = Math.max(1, Math.round(layout.height * resolution));
  const data = new Float64Array(width * height).fill(background);

  for (let i = 0; i < cells.length; i += 1) {
    const { q, r } = cells[i];
    const ranks = digitToRanks(digits[i]);
    for (const face of FACES) {
      const level = LEVELS[ranks[face]];
      const poly = facePolygon(q, r, face, layout).map((p) => ({
        x: p.x * resolution,
        y: p.y * resolution,
      }));
      fillPolygon(data, width, height, poly, level);
    }
  }
  return { data, width, height, resolution, layout };
}

/** 래스터 픽셀 좌표(연속값, 픽셀 중심 = 정수+0.5)에서 bilinear 보간. 경계는 clamp. */
export function bilinearSample(raster, x, y) {
  const { data, width, height } = raster;
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const cx0 = clampInt(x0, 0, width - 1);
  const cx1 = clampInt(x0 + 1, 0, width - 1);
  const cy0 = clampInt(y0, 0, height - 1);
  const cy1 = clampInt(y0 + 1, 0, height - 1);
  const v00 = data[cy0 * width + cx0];
  const v10 = data[cy0 * width + cx1];
  const v01 = data[cy1 * width + cx0];
  const v11 = data[cy1 * width + cx1];
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

// ─────────────────────────────────────────────────────────────────────────────
// 왜곡 축
// ─────────────────────────────────────────────────────────────────────────────

/** v_out = v_in ^ gamma (감마 톤 커브). gamma<1 밝게, gamma>1 어둡게. 엄밀히 단조. */
export function distortGamma(raster, gamma) {
  const data = new Float64Array(raster.data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = clamp01(raster.data[i]) ** gamma;
  return { ...raster, data };
}

/**
 * S-커브 (로지스틱, 0/1 끝점 고정 정규화). strength=0 이면 항등.
 * 임의의 strength 에서 **엄밀히 단조증가**(로지스틱 자체가 단조이므로).
 */
export function distortSCurve(raster, strength) {
  if (strength === 0) return { ...raster, data: raster.data.slice() };
  const f = (x) => 1 / (1 + Math.exp(-strength * (x - 0.5)));
  const f0 = f(0);
  const f1 = f(1);
  const data = new Float64Array(raster.data.length);
  for (let i = 0; i < data.length; i += 1) {
    const v = clamp01(raster.data[i]);
    data[i] = clamp01((f(v) - f0) / (f1 - f0));
  }
  return { ...raster, data };
}

/**
 * 비네팅 — 중심에서 멀수록 배율 저하: factor = 1 - strength·(dist/maxDist)².
 * **픽셀 위치 의존**이라 전역 단조 함수가 아니다(같은 값이라도 위치에 따라 배율이 다름) —
 * 톤 계열 중 유일하게 "엄밀 단조 아님"인 축.
 */
export function distortVignette(raster, strength) {
  const { width, height } = raster;
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.hypot(cx, cy);
  const data = new Float64Array(raster.data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy) / maxDist;
      const factor = Math.max(0, 1 - strength * d * d);
      data[y * width + x] = clamp01(raster.data[y * width + x] * factor);
    }
  }
  return { ...raster, data };
}

/** 가산 가우시안 노이즈, 표준편차 sigma (0..1 스케일). */
export function distortGaussianNoise(raster, sigma, rng) {
  const data = new Float64Array(raster.data.length);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = clamp01(raster.data[i] + sigma * gaussianSample(rng));
  }
  return { ...raster, data };
}

/**
 * 회전+스케일 워프. 캡처된(왜곡된) 이미지를 **같은 해상도의 새 래스터**로 만든다 —
 * 이 재구성 자체가 유한 해상도 bilinear 리샘플 손실을 발생시킨다(회전/스케일 오차의 실체).
 * 원본 좌표 → 캡처 좌표 순변환은 `transformPoint()` 로 별도 제공 — 디코더가 "구성상 기지"인
 * 기하로 어디를 샘플링해야 하는지 역으로 계산할 때 쓴다(불스아이 탐지 불필요).
 */
export function warpRotateScale(raster, angleRad, scale) {
  const { width, height } = raster;
  const cx = width / 2;
  const cy = height / 2;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const data = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ox = x + 0.5 - cx;
      const oy = y + 0.5 - cy;
      // captured = scale · R(angle) · original  →  original = (1/scale) · R(-angle) · captured
      const ux = ox / scale;
      const uy = oy / scale;
      const sx = ux * cos + uy * sin;
      const sy = -ux * sin + uy * cos;
      data[y * width + x] = bilinearSample(raster, sx + cx, sy + cy);
    }
  }
  return { ...raster, data };
}

/**
 * 원본 레이아웃 좌표(px, py = layout 단위) → 캡처(왜곡) 프레임의 래스터 픽셀 좌표.
 * `warpRotateScale` 과 정확히 같은 순변환을 쓴다. 기하가 기지이므로 이 계산만으로
 * 불스아이/호모그래피 없이 정확한 샘플 위치를 얻는다.
 */
export function transformPoint(raster, px, py, angleRad, scale) {
  const { width, height, resolution } = raster;
  const cx = width / 2;
  const cy = height / 2;
  const x = px * resolution - cx;
  const y = py * resolution - cy;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  return { x: rx * scale + cx, y: ry * scale + cy };
}

// ─────────────────────────────────────────────────────────────────────────────
// JPEG q60 근사 — 8×8 블록 DCT + 표준 휘도 양자화. **근사임을 명시**(엔트로피 코딩·
// 크로마 서브샘플링 없음). 의존성 없이 "정확 재현"은 불가하므로 이 근사로 대체한다.
// ─────────────────────────────────────────────────────────────────────────────

/** ITU-T T.81 Annex K 표준 휘도 양자화 테이블 (품질 50 기준, zig-zag 아닌 raster 순서). */
const JPEG_LUMA_QTABLE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/** 품질 factor(1..100) 로 스케일한 양자화 테이블. IJG 표준 스케일링 공식. */
function scaledQuantTable(quality) {
  const q = clampInt(quality, 1, 100);
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return JPEG_LUMA_QTABLE.map((v) => Math.max(1, Math.floor((v * scale + 50) / 100)));
}

function dct1d8(input, output, stride, offset) {
  // 순진한 O(N²) DCT-II. N=8 고정이라 성능 문제 없음.
  const N = 8;
  for (let u = 0; u < N; u += 1) {
    let sum = 0;
    for (let x = 0; x < N; x += 1) {
      sum += input[offset + x * stride] * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
    const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
    output[offset + u * stride] = 0.5 * cu * sum;
  }
}

function idct1d8(input, output, stride, offset) {
  const N = 8;
  for (let x = 0; x < N; x += 1) {
    let sum = 0;
    for (let u = 0; u < N; u += 1) {
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      sum += cu * input[offset + u * stride] * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
    output[offset + x * stride] = 0.5 * sum;
  }
}

function dctBlock8x8(block) {
  const tmp = new Float64Array(64);
  const out = new Float64Array(64);
  for (let row = 0; row < 8; row += 1) dct1d8(block, tmp, 1, row * 8);
  for (let col = 0; col < 8; col += 1) dct1d8(tmp, out, 8, col);
  return out;
}

function idctBlock8x8(coeffs) {
  const tmp = new Float64Array(64);
  const out = new Float64Array(64);
  for (let col = 0; col < 8; col += 1) idct1d8(coeffs, tmp, 8, col);
  for (let row = 0; row < 8; row += 1) idct1d8(tmp, out, 1, row * 8);
  return out;
}

/**
 * JPEG q60 근사 왜곡. 0..1 휘도를 0..255 로 스케일 → 8×8 블록 DCT → 표준 양자화(경계는
 * 가장자리 픽셀 복제로 8 배수까지 패딩) → 역양자화 → IDCT → 0..1 로 복귀.
 * **근사다**: 실제 JPEG 의 허프만 엔트로피 코딩·크로마 서브샘플링·색공간 변환은 없다.
 */
export function distortJpegApprox(raster, quality = 60) {
  const { width, height } = raster;
  const qtable = scaledQuantTable(quality);
  const padW = Math.ceil(width / 8) * 8;
  const padH = Math.ceil(height / 8) * 8;
  const padded = new Float64Array(padW * padH);
  for (let y = 0; y < padH; y += 1) {
    const sy = clampInt(y, 0, height - 1);
    for (let x = 0; x < padW; x += 1) {
      const sx = clampInt(x, 0, width - 1);
      padded[y * padW + x] = raster.data[sy * width + sx] * 255 - 128; // level shift
    }
  }
  const block = new Float64Array(64);
  for (let by = 0; by < padH; by += 8) {
    for (let bx = 0; bx < padW; bx += 8) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          block[y * 8 + x] = padded[(by + y) * padW + (bx + x)];
        }
      }
      const coeffs = dctBlock8x8(block);
      for (let i = 0; i < 64; i += 1) {
        coeffs[i] = Math.round(coeffs[i] / qtable[i]) * qtable[i];
      }
      const rec = idctBlock8x8(coeffs);
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          padded[(by + y) * padW + (bx + x)] = rec[y * 8 + x];
        }
      }
    }
  }
  const data = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = clamp01((padded[y * padW + x] + 128) / 255);
    }
  }
  return { ...raster, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// 샘플링 + 순위 복원
// ─────────────────────────────────────────────────────────────────────────────

/** 원판 내부 균등분포 표본점 N 개 (layout 단위, 결정적 RNG). */
function discSamplePoints(cx, cy, radius, count, rng) {
  const pts = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * 2 * Math.PI;
    const r = radius * Math.sqrt(rng()); // 넓이 균등
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

function median(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 셀 하나의 면별 원판 median 휘도를 측정한다.
 * `geom`(각도/스케일)이 주어지면 캡처 프레임으로 순변환 후 `warped` 래스터에서 읽고,
 * 없으면 (톤 계열처럼 기하 왜곡이 없는 경우) `raster` 를 원본 좌표 그대로 bilinear 읽는다.
 *
 * @returns {{T:number,L:number,R:number}}
 */
export function measureCellFaceMedians(raster, q, r, layout, opts, rng, warped, geom) {
  const out = {};
  for (const face of FACES) {
    const disc = faceSampleDisc(q, r, face, layout, opts && opts.discOptions);
    const n = (opts && opts.samplesPerDisc) || 24;
    const pts = discSamplePoints(disc.x, disc.y, disc.radius, n, rng);
    const values = pts.map((p) => {
      if (geom) {
        const cp = transformPoint(raster, p.x, p.y, geom.angleRad, geom.scale);
        return bilinearSample(warped, cp.x, cp.y);
      }
      return bilinearSample(warped, p.x * raster.resolution, p.y * raster.resolution);
    });
    out[face] = median(values);
  }
  return out;
}

/** 면별 median → 복원 순위 → digit. 동률은 면 정준 순서(T,L,R)로 안정 정렬해 결정적으로 깬다. */
export function recoverDigitFromMedians(medians) {
  const order = [0, 1, 2]; // FACES 인덱스
  const faceValues = FACES.map((f) => medians[f]);
  order.sort((a, b) => faceValues[a] - faceValues[b] || a - b);
  const ranks = {};
  order.forEach((faceIdx, rankPos) => {
    ranks[FACES[faceIdx]] = rankPos; // 0=가장 어두움 .. 2=가장 밝음
  });
  return ranksToDigit(ranks);
}

// ─────────────────────────────────────────────────────────────────────────────
// 트라이얼 러너
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 회전/스케일 왜곡용 캔버스 여백. `warpRotateScale` 은 캔버스 크기를 키우지 않고 같은
 * 프레임 안에서 재표본화하므로, 여백이 부족하면 스케일 확대(zoom-in) 시 바깥쪽 셀이
 * 캔버스 경계를 벗어나 clamp 되어 **프레이밍 손실**(실제로는 카메라가 코드를 여유 있게
 * 담아서 생기지 않는 인공물)이 리샘플 오차와 섞인다. `maxScale` 스윕 상한까지 바깥쪽
 * 셀도 경계 clamp 없이 들어오도록 여백을 역산한다.
 */
export function computeScaleMargin(k, maxScale = 2) {
  const b = codeBounds(k, { size: 1, originX: 0, originY: 0 });
  const halfExtent = Math.max(b.width, b.height) / 2;
  return Math.max(1, Math.ceil((maxScale - 1) * halfExtent * 1.05));
}

/**
 * 단일 트라이얼: 무작위 digit 배열 렌더 → 왜곡 적용 → 셀별 복원 → 오류 셀 수.
 * `distort(raster, rng)` 콜백이 왜곡을 적용한다(순수 톤 축이면 raster 만, 기하 축이면
 * `{raster: warped, geom}` 형태를 반환해도 되도록 유연하게 처리).
 *
 * @returns {{errors: number, total: number}}
 */
export function runTrial({ k, seed, distort, samplesPerDisc, discOptions, resolution, margin }) {
  const layout = layoutForRegion(k, { size: 1, margin: margin === undefined ? 1 : margin });
  const cells = regionCells(k);
  const rng = mulberry32(seed);
  const digits = cells.map(() => Math.floor(rng() * 6));

  const raster = renderRaster(cells, digits, layout, { resolution });
  const distortResult = distort(raster, rng);
  const warped = distortResult && distortResult.raster ? distortResult.raster : distortResult;
  const geom = distortResult && distortResult.geom ? distortResult.geom : null;

  let errors = 0;
  const sampleRng = mulberry32(seed ^ 0x9e3779b9);
  for (let i = 0; i < cells.length; i += 1) {
    const { q, r } = cells[i];
    const medians = measureCellFaceMedians(
      raster,
      q,
      r,
      layout,
      { samplesPerDisc, discOptions },
      sampleRng,
      warped,
      geom,
    );
    const decoded = recoverDigitFromMedians(medians);
    if (decoded !== digits[i]) errors += 1;
  }
  return { errors, total: cells.length };
}

/** 파라미터 하나에 대해 trials 회 반복하고 평균 ε(%) 를 낸다. */
export function measureEpsilon({ k, trials, seedBase, distort, samplesPerDisc, discOptions, resolution, margin }) {
  let errors = 0;
  let total = 0;
  for (let t = 0; t < trials; t += 1) {
    const seed = deriveSeed(seedBase, t);
    const res = runTrial({ k, seed, distort, samplesPerDisc, discOptions, resolution, margin });
    errors += res.errors;
    total += res.total;
  }
  return { epsilonPercent: (errors / total) * 100, errors, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// 축 스윕 정의 + 보고서
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_K = 3; // regionCells(3) = 37 셀 = 111 면 / 트라이얼
const DEFAULT_TRIALS = 150;
const DEFAULT_RESOLUTION = 10;
const DEFAULT_SAMPLES = 20;

function baseHarnessOpts(overrides = {}) {
  return {
    k: DEFAULT_K,
    trials: DEFAULT_TRIALS,
    resolution: DEFAULT_RESOLUTION,
    samplesPerDisc: DEFAULT_SAMPLES,
    ...overrides,
  };
}

export function sweepGamma(gammas = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8], opts = {}) {
  const base = baseHarnessOpts(opts);
  return gammas.map((g) => ({
    param: g,
    ...measureEpsilon({
      ...base,
      seedBase: `gamma:${g}`,
      distort: (raster) => distortGamma(raster, g),
    }),
  }));
}

export function sweepSCurve(strengths = [1, 2, 4, 8, 12], opts = {}) {
  const base = baseHarnessOpts(opts);
  return strengths.map((s) => ({
    param: s,
    ...measureEpsilon({
      ...base,
      seedBase: `scurve:${s}`,
      distort: (raster) => distortSCurve(raster, s),
    }),
  }));
}

export function sweepVignette(strengths = [0.1, 0.2, 0.3, 0.4, 0.5], opts = {}) {
  const base = baseHarnessOpts(opts);
  return strengths.map((s) => ({
    param: s,
    ...measureEpsilon({
      ...base,
      seedBase: `vignette:${s}`,
      distort: (raster) => distortVignette(raster, s),
    }),
  }));
}

export function sweepNoise(sigmas = [0.01, 0.02, 0.05, 0.08, 0.12, 0.16, 0.2], opts = {}) {
  const base = baseHarnessOpts(opts);
  return sigmas.map((s) => ({
    param: s,
    ...measureEpsilon({
      ...base,
      seedBase: `noise:${s}`,
      distort: (raster, rng) => distortGaussianNoise(raster, s, rng),
    }),
  }));
}

export function sweepRotation(degrees = [0, 15, 30, 45, 60, 90, 120, 180, 270, 360], opts = {}) {
  const base = baseHarnessOpts(opts);
  // 순수 회전(scale=1)도 정사각이 아닌 바운딩박스 모서리 셀을 경계 밖으로 밀 수 있다 —
  // 대각선 여유만큼 작은 여백을 둔다 (√2 근사).
  const margin = opts.margin === undefined ? computeScaleMargin(base.k, 1.45) : opts.margin;
  return degrees.map((deg) => {
    const angleRad = (deg * Math.PI) / 180;
    return {
      param: deg,
      ...measureEpsilon({
        ...base,
        margin,
        seedBase: `rotation:${deg}`,
        distort: (raster) => ({
          raster: warpRotateScale(raster, angleRad, 1),
          geom: { angleRad, scale: 1 },
        }),
      }),
    };
  });
}

export function sweepScale(scales = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], opts = {}) {
  const base = baseHarnessOpts(opts);
  const maxScale = Math.max(...scales, 1);
  const margin = opts.margin === undefined ? computeScaleMargin(base.k, maxScale) : opts.margin;
  return scales.map((scale) => ({
    param: scale,
    ...measureEpsilon({
      ...base,
      margin,
      seedBase: `scale:${scale}`,
      distort: (raster) => ({
        raster: warpRotateScale(raster, 0, scale),
        geom: { angleRad: 0, scale },
      }),
    }),
  }));
}

export function sweepJpeg(qualities = [60], opts = {}) {
  const base = baseHarnessOpts(opts);
  return qualities.map((q) => ({
    param: q,
    ...measureEpsilon({
      ...base,
      seedBase: `jpeg:${q}`,
      distort: (raster) => distortJpegApprox(raster, q),
    }),
  }));
}

/** 전 축 실행 + 밴드 판정을 포함한 보고서 객체. */
export function runFullSweep(opts = {}) {
  const t0 = Date.now();
  const report = {
    meta: {
      k: opts.k ?? DEFAULT_K,
      cellsPerTrial: cellCount(opts.k ?? DEFAULT_K),
      trialsPerPoint: opts.trials ?? DEFAULT_TRIALS,
      resolution: opts.resolution ?? DEFAULT_RESOLUTION,
      samplesPerDisc: opts.samplesPerDisc ?? DEFAULT_SAMPLES,
      levels: LEVELS,
    },
    axes: {},
  };
  report.axes.gamma = sweepGamma(undefined, opts);
  report.axes.sCurve = sweepSCurve(undefined, opts);
  report.axes.vignette = sweepVignette(undefined, opts);
  report.axes.noise = sweepNoise(undefined, opts);
  report.axes.rotation = sweepRotation(undefined, opts);
  report.axes.scale = sweepScale(undefined, opts);
  report.axes.jpegApprox = sweepJpeg(undefined, opts);

  for (const [axis, points] of Object.entries(report.axes)) {
    for (const p of points) p.band = classifyBand(p.epsilonPercent);
  }

  // H1 직접 검증: 톤 계열(감마·S-커브)이 정확히 ε=0 인가.
  const toneAxes = ['gamma', 'sCurve'];
  report.h1ToneCheck = {};
  for (const axis of toneAxes) {
    const maxEps = Math.max(...report.axes[axis].map((p) => p.epsilonPercent));
    report.h1ToneCheck[axis] = { maxEpsilonPercent: maxEps, isZero: maxEps === 0 };
  }

  report.meta.wallTimeMs = Date.now() - t0;
  return report;
}

function fmt(n, digits = 4) {
  return Number(n).toFixed(digits);
}

/** 보고서를 사람이 읽을 표로 렌더링한다. */
export function formatReport(report) {
  const lines = [];
  lines.push('# ε_real 선행 측정 하네스 — 결과');
  lines.push('');
  lines.push(
    `k=${report.meta.k} (셀 ${report.meta.cellsPerTrial}개/트라이얼) · trials/point=${report.meta.trialsPerPoint} · resolution=${report.meta.resolution}px/unit · samples/disc=${report.meta.samplesPerDisc}`,
  );
  lines.push(`벽시계 ${report.meta.wallTimeMs} ms`);
  lines.push('');
  for (const [axis, points] of Object.entries(report.axes)) {
    lines.push(`## ${axis}`);
    lines.push('param | ε (%) | band');
    lines.push('---|---|---');
    for (const p of points) {
      lines.push(`${p.param} | ${fmt(p.epsilonPercent)} | ${p.band}`);
    }
    lines.push('');
  }
  lines.push('## H1 직접 검증 (단조 톤 커브 계열)');
  for (const [axis, r] of Object.entries(report.h1ToneCheck)) {
    lines.push(`- ${axis}: max ε = ${fmt(r.maxEpsilonPercent)}% → ${r.isZero ? 'ε=0 확인 (H1 지지)' : '⚠ ε≠0 — H1 반증 신호, 명시 보고 필요'}`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI 진입점
// ─────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const report = runFullSweep();
  console.log(formatReport(report));
}
