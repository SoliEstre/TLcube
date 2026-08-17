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
 * 음영 띠(`scene.shading`)의 점 (x,y) 에서의 알파.
 *
 * **SVG 선형 그라데이션 정의 그대로**다 (`spreadMethod="pad"`): 축 (x1,y1)→(x2,y2) 위로의
 * 정사영 t 를 [0,1] 로 자르고 a1 → a2 를 선형 보간한다. 프로젝트 고유 규약이 아니라
 * 공개 스펙이라, SVG 백엔드(선언형 `<linearGradient>`)와 여기(명령형)가 각각 구현해도
 * 같은 그림이 나온다 — 그 «같음» 은 test/shading.test.js 가 표본 대조로 확인한다.
 *
 * 삼각함수·hypot 을 쓰지 않는다 (이 파일의 결정성 계약).
 */
function shadingAlphaAt(x, y, band) {
  const g = band.gradient;
  const dx = g.x2 - g.x1;
  const dy = g.y2 - g.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return g.a1;
  let t = ((x - g.x1) * dx + (y - g.y1) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return g.a1 + (g.a2 - g.a1) * t;
}

/**
 * scene 을 RGBA 픽셀 버퍼로 굽는다.
 *
 * 알고리즘: 출력 해상도의 `supersample`배(ss) 되는 서브픽셀 격자를 배경색으로
 * 채운 뒤, shapes 를 painter 순서대로 순회하며 각 도형이 덮는 서브픽셀을
 * 도형 색으로 **덮어쓴다**(뒤에 그려진 도형이 이긴다 — scene.shapes 순서가
 * 그 계약). 마지막에 ss×ss 블록을 채널별 산술평균해 출력 픽셀로 다운샘플한다.
 *
 * **투명 배경** (`scene.background === null`): 배경색으로 채우는 대신 서브픽셀
 * **커버리지**를 따로 세고, 다운샘플에서 alpha = 커버리지 비율 · RGB = **덮인
 * 서브픽셀만의 평균**(언프리멀티플라이드)으로 낸다. 배경색이 있는 경로의 출력은
 * 한 바이트도 바뀌지 않는다 — 커버리지 배열 자체가 그때는 할당되지 않는다.
 *
 * ⚠ 투명 배경은 **실루엣 검출의 배경 분리 계약(§7.1, ≥ 0.05)을 생성 시점에
 * 보증할 수 없다** — 실효 배경이 코드가 놓이는 표면이 되기 때문이다. 소비자
 * (생성기 UI)가 그 사실을 사용자에게 알린다.
 *
 * **음영 레이어** (`scene.shading`, 선택): 도형 위에 얹히는 반투명 선형 그라데이션 띠
 * 목록이다 (`src/shading.js`). 있으면 알파 누산 경로를 타고, **없으면 위 설명 그대로**
 * 종전 경로가 그대로 돈다 — 출력 바이트가 안 바뀐다.
 *
 * @param {{width: number, height: number, background: {r,g,b}|null, shapes: Array,
 *          shading?: Array}} scene
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

  // 배경은 {r,g,b} 아니면 null(투명) 둘 중 하나다. undefined 를 조용히 흘려보내면
  // 서브픽셀이 NaN 으로 채워져 전면 검정이 나오므로 여기서 잡는다.
  if (bg !== null && (bg === undefined || typeof bg !== 'object')) {
    throw new TypeError(`scene.background 는 {r,g,b} 또는 null(투명) 이어야 한다: ${bg}`);
  }
  const transparent = bg === null;

  // shape.color 에는 투명이 없다 — 배경과 달리 **구체 {r,g,b} 만**이다. 아래 채움 루프는
  // shape.color.r 을 무조건 읽으므로, null 이 새면 픽셀 루프 한가운데서 «Cannot read
  // properties of null (reading 'r')» 로 죽는다. 어느 도형인지도 안 나와 추적에 하루가
  // 걸렸다(2026-08-12, 중앙 3톤 큐브가 슬롯을 palette.background 로 칠했다) — 여기서
  // 도형 번호와 함께 먼저 잡는다. 도형 수는 픽셀 수에 비해 무시할 만하다.
  for (let i = 0; i < scene.shapes.length; i += 1) {
    const color = scene.shapes[i].color;
    if (color === null || typeof color !== 'object') {
      throw new TypeError(
        `shape[${i}](${scene.shapes[i].kind}).color 는 {r,g,b} 여야 한다: ${color} — `
        + '투명은 scene.background 에만 허용된다',
      );
    }
  }

  // 서브픽셀 격자(RGB). 불투명 경로에서는 배경색으로 초기화하고 alpha 를 다운샘플
  // 후 한 번만 채운다. 투명 경로에서는 커버리지를 따로 센다(0 = 배경 그대로).
  const sub = new Uint8ClampedArray(ssWidth * ssHeight * 3);
  const cov = transparent ? new Uint8Array(ssWidth * ssHeight) : null;
  if (!transparent) {
    for (let i = 0; i < ssWidth * ssHeight; i += 1) {
      const o = i * 3;
      sub[o] = bg.r;
      sub[o + 1] = bg.g;
      sub[o + 2] = bg.b;
    }
  }

  // ── 음영 레이어 (scene.shading) — **도형보다 먼저** ──────────────────────
  //
  // 재배치 (운영자 지시 2026-08-17): 그림자는 물체 **뒤**에 있다. 종전에는 띠가
  // 도형과 교차 0 이라 위에 얹어도 같았지만, 길이 10× + QR 껍질 제외로 띠가 QR
  // 블록 영역을 지나게 됐다 — 아래에 깔면 QR·셀이 painter 순서로 자연히 가린다.
  //
  // **없으면 이 블록과 아래 alpha 참조가 통째로 건너뛰어진다** — 종전 경로의 출력이
  // 한 바이트도 안 바뀌게 하려는 것이다. 음영은 반투명이라 «덮였다/안 덮였다» 이진
  // 커버리지로는 표현이 안 되고, 알파 누산이 필요하다. 그 누산기를 항상 돌리면
  // 부동소수 합산 순서 때문에 기존 결정성 핀(SHA)이 통째로 흔들린다.
  const shading = Array.isArray(scene.shading) ? scene.shading : null;
  const alpha = shading && shading.length > 0 ? new Float32Array(ssWidth * ssHeight) : null;
  if (alpha !== null) {
    // 도형이 아직 없다 — 배경 위에서 시작한다 (불투명 = 1, 투명 = 0).
    if (cov === null) alpha.fill(1);

    for (const band of shading) {
      const pts = band.points;
      let minX = pts[0].x; let maxX = pts[0].x; let minY = pts[0].y; let maxY = pts[0].y;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const sxMin = Math.max(0, Math.floor(minX * ssPixelsPerUnit));
      const sxMax = Math.min(ssWidth - 1, Math.ceil(maxX * ssPixelsPerUnit));
      const syMin = Math.max(0, Math.floor(minY * ssPixelsPerUnit));
      const syMax = Math.min(ssHeight - 1, Math.ceil(maxY * ssPixelsPerUnit));
      const cr = band.color.r;
      const cg = band.color.g;
      const cb = band.color.b;
      for (let sy = syMin; sy <= syMax; sy += 1) {
        const sceneY = (sy + 0.5) / ssPixelsPerUnit;
        for (let sx = sxMin; sx <= sxMax; sx += 1) {
          const sceneX = (sx + 0.5) / ssPixelsPerUnit;
          if (!pointInPolygon(sceneX, sceneY, pts)) continue;
          const a = shadingAlphaAt(sceneX, sceneY, band);
          if (a <= 0) continue;
          const i = sy * ssWidth + sx;
          const o = i * 3;
          const dstA = alpha[i];
          const keep = dstA * (1 - a);
          const outA = a + keep;
          if (outA <= 0) continue;
          sub[o] = Math.round((cr * a + sub[o] * keep) / outA);
          sub[o + 1] = Math.round((cg * a + sub[o + 1] * keep) / outA);
          sub[o + 2] = Math.round((cb * a + sub[o + 2] * keep) / outA);
          alpha[i] = outA;
          if (cov !== null) cov[i] = 1;
        }
      }
    }
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
        const i = sy * ssWidth + sx;
        const o = i * 3;
        sub[o] = shape.color.r;
        sub[o + 1] = shape.color.g;
        sub[o + 2] = shape.color.b;
        if (cov !== null) cov[i] = 1;
        // 도형은 불투명이다 — 음영 위에 덮이면 그 서브픽셀은 완전 불투명이 된다.
        if (alpha !== null) alpha[i] = 1;
      }
    }
  }

  // 다운샘플: ss×ss 서브픽셀 블록을 채널별 산술평균 → 출력 픽셀.
  // 투명 경로는 **덮인 서브픽셀만** 평균한다 — 배경(RGB 0)까지 섞으면 가장자리가
  // 검게 번지는 전형적 프리멀티플라이드 헤일로가 생긴다.
  const ssArea = ss * ss;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let covered = 0;
      let sumA = 0;
      for (let dy = 0; dy < ss; dy += 1) {
        const sy = py * ss + dy;
        for (let dx = 0; dx < ss; dx += 1) {
          const sx = px * ss + dx;
          const i = sy * ssWidth + sx;
          if (cov !== null && cov[i] === 0) continue;
          const o = i * 3;
          if (alpha !== null) {
            // 알파 가중(프리멀티플라이드) 누산 — 반투명 띠가 섞이면 «덮인 것끼리 균등
            // 평균» 은 틀린다. 알파가 전부 1 인 블록에서는 아래 나눗셈이 균등평균과
            // 같은 값을 준다.
            const w = alpha[i];
            sumR += sub[o] * w;
            sumG += sub[o + 1] * w;
            sumB += sub[o + 2] * w;
            sumA += w;
          } else {
            sumR += sub[o];
            sumG += sub[o + 1];
            sumB += sub[o + 2];
          }
          covered += 1;
        }
      }
      const o = (py * width + px) * 4;
      if (covered === 0 || (alpha !== null && sumA <= 0)) {
        // 투명 경로에서만 도달한다(불투명 경로는 항상 ssArea 개가 덮인 것으로 센다).
        pixels[o] = 0;
        pixels[o + 1] = 0;
        pixels[o + 2] = 0;
        pixels[o + 3] = 0;
      } else if (alpha !== null) {
        pixels[o] = Math.round(sumR / sumA);
        pixels[o + 1] = Math.round(sumG / sumA);
        pixels[o + 2] = Math.round(sumB / sumA);
        pixels[o + 3] = cov === null ? 255 : Math.round((sumA / ssArea) * 255);
      } else {
        pixels[o] = Math.round(sumR / covered);
        pixels[o + 1] = Math.round(sumG / covered);
        pixels[o + 2] = Math.round(sumB / covered);
        pixels[o + 3] = cov === null ? 255 : Math.round((covered / ssArea) * 255);
      }
    }
  }

  return { width, height, pixelsPerUnit, supersample, pixels };
}
