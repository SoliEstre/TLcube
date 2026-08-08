/**
 * raster.js — scene(도형 목록) → RGBA 픽셀 버퍼 순수 래스터라이저 (SPEC §7.2)
 *
 * 브라우저 canvas 에 기대지 않는다 — scene.js 가 만든 도형 목록을 서브샘플
 * 격자 위에 직접 채우고 박스 다운샘플로 안티에일리어싱한다. canvas 미리보기와
 * PNG/SVG export(T10) 모두 이 결과를 공유 소비하므로, 여기서 만든 픽셀이
 * 유일한 진실이다.
 *
 * 결정성이 완료 기준이다: Math.hypot·삼각함수·Math.random·Date 를 쓰지 않는다.
 * 곱셈·덧셈·비교·Math.round/floor/ceil 만 쓴다.
 */

/** 기본 배율(픽셀/scene-단위)·서브샘플 격자 한 변 크기. */
const DEFAULT_PIXELS_PER_UNIT = 24;
const DEFAULT_SUPERSAMPLE = 2;

/**
 * 도형의 bbox(scene 좌표) — 스캔 범위를 좁혀 전 서브픽셀 × 전 도형 순회를 피한다.
 * @returns {{minX, minY, maxX, maxY}}
 */
function shapeBounds(shape) {
  if (shape.kind === 'polygon') {
    let minX = shape.points[0].x;
    let maxX = shape.points[0].x;
    let minY = shape.points[0].y;
    let maxY = shape.points[0].y;
    for (const p of shape.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }
  if (shape.kind === 'disc') {
    return {
      minX: shape.cx - shape.r,
      maxX: shape.cx + shape.r,
      minY: shape.cy - shape.r,
      maxY: shape.cy + shape.r,
    };
  }
  throw new RangeError(`알 수 없는 shape.kind: ${shape.kind}`);
}

/**
 * 짝홀(even-odd) ray casting — 점 (x,y) 가 폴리곤(points, 길이 ≥ 3) 내부인가.
 * 표준 다각형 채움 판정 — 삼각함수·hypot 을 쓰지 않는다.
 */
function pointInPolygon(x, y, points) {
  let inside = false;
  const n = points.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 점 (x,y) 가 disc(cx,cy,r) 내부인가 — 제곱거리 비교만 사용(hypot 금지). */
function pointInDisc(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function pointInShape(x, y, shape) {
  if (shape.kind === 'polygon') return pointInPolygon(x, y, shape.points);
  return pointInDisc(x, y, shape.cx, shape.cy, shape.r);
}

/**
 * scene 을 RGBA 픽셀 버퍼로 굽는다.
 *
 * 알고리즘: 출력 해상도의 `supersample`배(ss) 되는 서브픽셀 격자를 배경색으로
 * 채운 뒤, shapes 를 painter 순서대로 순회하며 각 도형이 덮는 서브픽셀을
 * 도형 색으로 **덮어쓴다**(뒤에 그려진 도형이 이긴다 — scene.shapes 순서가
 * 그 계약). 마지막에 ss×ss 블록을 채널별 산술평균해 출력 픽셀로 다운샘플한다.
 *
 * @param {{width: number, height: number, background: {r,g,b}, shapes: Array}} scene
 * @param {{pixelsPerUnit?: number, supersample?: number}} [options]
 * @returns {{width: number, height: number, pixelsPerUnit: number, supersample: number, pixels: Uint8ClampedArray}}
 */
export function rasterize(scene, options) {
  if (scene === null || typeof scene !== 'object') {
    throw new TypeError('scene 은 객체여야 한다');
  }
  const opts = options || {};
  const pixelsPerUnit =
    opts.pixelsPerUnit === undefined ? DEFAULT_PIXELS_PER_UNIT : opts.pixelsPerUnit;
  const supersample =
    opts.supersample === undefined ? DEFAULT_SUPERSAMPLE : opts.supersample;

  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) {
    throw new RangeError(`pixelsPerUnit 은 유한한 양수여야 한다: ${pixelsPerUnit}`);
  }
  if (!Number.isInteger(supersample) || supersample < 1) {
    throw new RangeError(`supersample 은 1 이상의 정수여야 한다: ${supersample}`);
  }

  const width = Math.round(scene.width * pixelsPerUnit);
  const height = Math.round(scene.height * pixelsPerUnit);
  const ss = supersample;
  const ssPixelsPerUnit = pixelsPerUnit * ss;
  const ssWidth = width * ss;
  const ssHeight = height * ss;
  const bg = scene.background;

  // 서브픽셀 격자(RGB, 항상 불투명이므로 alpha 는 다운샘플 후 한 번만 채운다).
  const sub = new Uint8ClampedArray(ssWidth * ssHeight * 3);
  for (let i = 0; i < ssWidth * ssHeight; i += 1) {
    const o = i * 3;
    sub[o] = bg.r;
    sub[o + 1] = bg.g;
    sub[o + 2] = bg.b;
  }

  for (const shape of scene.shapes) {
    const b = shapeBounds(shape);
    const sxMin = Math.max(0, Math.floor(b.minX * ssPixelsPerUnit));
    const sxMax = Math.min(ssWidth - 1, Math.ceil(b.maxX * ssPixelsPerUnit));
    const syMin = Math.max(0, Math.floor(b.minY * ssPixelsPerUnit));
    const syMax = Math.min(ssHeight - 1, Math.ceil(b.maxY * ssPixelsPerUnit));

    for (let sy = syMin; sy <= syMax; sy += 1) {
      const sceneY = (sy + 0.5) / ssPixelsPerUnit;
      for (let sx = sxMin; sx <= sxMax; sx += 1) {
        const sceneX = (sx + 0.5) / ssPixelsPerUnit;
        if (!pointInShape(sceneX, sceneY, shape)) continue;
        const o = (sy * ssWidth + sx) * 3;
        sub[o] = shape.color.r;
        sub[o + 1] = shape.color.g;
        sub[o + 2] = shape.color.b;
      }
    }
  }

  // 다운샘플: ss×ss 서브픽셀 블록을 채널별 산술평균 → 출력 픽셀.
  const ssArea = ss * ss;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      for (let dy = 0; dy < ss; dy += 1) {
        const sy = py * ss + dy;
        for (let dx = 0; dx < ss; dx += 1) {
          const sx = px * ss + dx;
          const o = (sy * ssWidth + sx) * 3;
          sumR += sub[o];
          sumG += sub[o + 1];
          sumB += sub[o + 2];
        }
      }
      const o = (py * width + px) * 4;
      pixels[o] = Math.round(sumR / ssArea);
      pixels[o + 1] = Math.round(sumG / ssArea);
      pixels[o + 2] = Math.round(sumB / ssArea);
      pixels[o + 3] = 255;
    }
  }

  return { width, height, pixelsPerUnit, supersample, pixels };
}
