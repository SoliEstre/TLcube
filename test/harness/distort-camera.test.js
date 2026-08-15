/**
 * distort-camera.test.js — 신규 왜곡 연산(cameraTilt · barrel)의 «자» 검증.
 *
 * 원리: 격자 체커보드에 알려진 (θ, k1) 을 적용하고, 왜곡된 **실제 픽셀**에서
 * 체커 코너 위치를 탐지해 해석 모델의 예측 위치와 대조한다.
 *
 * 순환 논증 차단 — 해석 모델(forward, src→dest)은 이 테스트 안에 **독립 구현**한다.
 * distort.mjs 는 역방향(dest→src)만 구현하므로, 두 구현이 서로의 역함수로 맞아야
 * 코너가 예측 위치에 나타난다. 한쪽의 대수 실수(부호·중심·정규화)는 즉시 어긋난다.
 *
 * 자의 자 검증(음성 대조): 일부러 틀린 파라미터(θ+3°, k1=0)로 예측하면 오차가
 * 문턱을 넘는 것도 단언한다 — 자가 모델 편차를 실제로 볼 수 있음을 증명한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  barrelDistortImage,
  cameraTiltImage,
  distortImage,
} from './distort.mjs';

const DARK = 40;
const LIGHT = 215;
const FILL = Object.freeze({ r: 128, g: 128, b: 128, a: 255 });

// ---- 체커보드 픽스처 -----------------------------------------------------------

/**
 * cells×cells 체커보드 + margin. 내부 격자 코너(경계 제외)가 자의 눈금이다.
 * 반환: { image, corners: [{x,y}] } — 코너는 픽셀 좌표 (셀 경계 = 정수 px).
 */
function makeCheckerboard({ cells = 12, cellPx = 16, margin = 24 } = {}) {
  const side = cells * cellPx + margin * 2;
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const cx = Math.floor((x - margin) / cellPx);
      const cy = Math.floor((y - margin) / cellPx);
      const inside = x >= margin && y >= margin
        && x < margin + cells * cellPx && y < margin + cells * cellPx;
      const value = inside ? (((cx + cy) % 2 === 0) ? LIGHT : DARK) : FILL.r;
      const offset = (y * side + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  const corners = [];
  for (let i = 1; i < cells; i += 1) {
    for (let j = 1; j < cells; j += 1) {
      // 픽셀 중심 좌표계에서 셀 경계는 px − 0.5 (인덱스 margin+i·cellPx 픽셀의 왼끝).
      corners.push({ x: margin + i * cellPx - 0.5, y: margin + j * cellPx - 0.5 });
    }
  }
  return { image: { width: side, height: side, pixels }, corners };
}

// ---- 독립 forward 모델 (테스트 소유 — distort.mjs 미참조) ------------------------

const AXIS_PHI = { horizontal: 0, vertical: 90, diagonal: 45 };

/** cameraTilt forward: 원본 평면 점 → 왜곡 이미지 좌표. */
function tiltForward(point, { width, height }, degrees, axis, distanceRatio = 4) {
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const extent = Math.max(Math.min(centerX, centerY), 0.5);
  const d = distanceRatio * extent;
  const phi = (AXIS_PHI[axis] * Math.PI) / 180;
  const ax = Math.cos(phi);
  const ay = Math.sin(phi);
  const nx = -Math.sin(phi);
  const ny = Math.cos(phi);
  const theta = (degrees * Math.PI) / 180;
  const px = point.x - centerX;
  const py = point.y - centerY;
  const t = px * ax + py * ay;
  const w = px * nx + py * ny;
  const denominator = 1 + (w * Math.sin(theta)) / d;
  const qt = t / denominator;
  const qw = (w * Math.cos(theta)) / denominator;
  return { x: centerX + qt * ax + qw * nx, y: centerY + qt * ay + qw * ny };
}

/**
 * barrel forward: 원본 점 → 왜곡 이미지 좌표. dest→src 가 r' = r(1+k1r²+k2r⁴) 이므로
 * forward 는 그 반전 — Newton 반복(결정적, 고정 12회)으로 r_dest 를 푼다.
 */
function barrelForward(point, { width, height }, k1, k2 = 0) {
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radiusNorm = Math.hypot(Math.max(centerX, 0.5), Math.max(centerY, 0.5));
  const sx = (point.x - centerX) / radiusNorm;
  const sy = (point.y - centerY) / radiusNorm;
  const rSource = Math.hypot(sx, sy);
  if (rSource === 0) return { x: centerX, y: centerY };
  let r = rSource; // 초기값: 항등
  for (let i = 0; i < 12; i += 1) {
    const r2 = r * r;
    const f = r * (1 + k1 * r2 + k2 * r2 * r2) - rSource;
    const df = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2;
    r -= f / df;
  }
  const ratio = r / rSource;
  return { x: centerX + sx * ratio * radiusNorm, y: centerY + sy * ratio * radiusNorm };
}

// ---- 코너 탐지기 (실제 픽셀만 사용) ----------------------------------------------

function bilinearGray(image, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sample = (sx, sy) => {
    if (sx < 0 || sx >= image.width || sy < 0 || sy >= image.height) return FILL.r;
    return image.pixels[(sy * image.width + sx) * 4];
  };
  return sample(x0, y0) * (1 - tx) * (1 - ty)
    + sample(x0 + 1, y0) * tx * (1 - ty)
    + sample(x0, y0 + 1) * (1 - tx) * ty
    + sample(x0 + 1, y0 + 1) * tx * ty;
}

/**
 * 체커 코너 안장점 탐지 (cornerSubPix 식 폐형해).
 *
 * 원리: 코너(두 에지 직선의 교점) c 에서는 창 안 모든 점 p 의 그래디언트 g(p) 가
 * (p − c) 에 직교한다. Σ (g·(p−c))² 최소화는 2×2 선형계
 *   [Σ g gᵀ] c = Σ (g gᵀ) p
 * 로 닫힌다. 사분면 응답 탐색과 달리 plateau 가 없고 진짜 서브픽셀이다.
 * 창을 반복 재중심(3회)하므로 예측이 수 px 어긋나도 실제 코너로 수렴한다 —
 * 음성 대조(오예측)에서는 그 수렴 결과가 모델 편차를 그대로 보고한다.
 */
function detectCorner(image, predicted, radius = 4) {
  let cx = predicted.x;
  let cy = predicted.y;
  let strength = 0;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    let gxx = 0;
    let gxy = 0;
    let gyy = 0;
    let bx = 0;
    let by = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius + 0.5) continue;
        const px = cx + dx;
        const py = cy + dy;
        const gx = (bilinearGray(image, px + 1, py) - bilinearGray(image, px - 1, py)) / 2;
        const gy = (bilinearGray(image, px, py + 1) - bilinearGray(image, px, py - 1)) / 2;
        gxx += gx * gx;
        gxy += gx * gy;
        gyy += gy * gy;
        bx += gx * gx * px + gx * gy * py;
        by += gx * gy * px + gy * gy * py;
      }
    }
    const det = gxx * gyy - gxy * gxy;
    // 두 에지 방향이 모두 실해야 코너다 — 퇴화(에지 하나뿐/평탄)는 weak 처리.
    strength = det;
    if (det < 1e3) return { x: cx, y: cy, strength: 0 };
    const nx = (gyy * bx - gxy * by) / det;
    const ny = (gxx * by - gxy * bx) / det;
    // 발산 가드 — 창 재중심은 예측 주변 ±6px 안에서만 허용한다.
    if (Math.hypot(nx - predicted.x, ny - predicted.y) > 6) return { x: cx, y: cy, strength: 0 };
    cx = nx;
    cy = ny;
  }
  return { x: cx, y: cy, strength };
}

/**
 * 왜곡 이미지에서 코너들을 탐지해 예측과의 오차 통계를 낸다.
 * 응답이 너무 약한 코너(왜곡으로 프레임 밖/경계로 나간 것)는 셈에서 뺀다.
 */
function measureCorners(image, sourceCorners, forwardMap) {
  const errors = [];
  let weak = 0;
  for (const corner of sourceCorners) {
    const predicted = forwardMap(corner);
    if (predicted.x < 8 || predicted.y < 8
      || predicted.x > image.width - 9 || predicted.y > image.height - 9) continue;
    const detected = detectCorner(image, predicted);
    if (detected.strength <= 0) {
      weak += 1;
      continue;
    }
    errors.push(Math.hypot(detected.x - predicted.x, detected.y - predicted.y));
  }
  const mean = errors.reduce((total, value) => total + value, 0) / Math.max(errors.length, 1);
  const max = errors.reduce((total, value) => Math.max(total, value), 0);
  return { count: errors.length, weak, mean, max };
}

// ---- 자 검증: cameraTilt --------------------------------------------------------

test('자 검증 — cameraTilt: 체커 코너가 독립 forward 모델 예측 위치에 나타난다', () => {
  const { image, corners } = makeCheckerboard();
  for (const axis of ['horizontal', 'vertical', 'diagonal']) {
    for (const degrees of [10, 25, 40]) {
      const warped = cameraTiltImage(image, degrees, { axis, fill: FILL });
      const stats = measureCorners(warped, corners,
        (point) => tiltForward(point, image, degrees, axis));
      assert.ok(stats.count >= 60,
        axis + ' ' + degrees + '°: 측정 코너 부족 ' + stats.count + ' (weak ' + stats.weak + ')');
      assert.ok(stats.max <= 1.0,
        axis + ' ' + degrees + '°: max 오차 ' + stats.max.toFixed(3) + 'px > 1.0px');
      assert.ok(stats.mean <= 0.5,
        axis + ' ' + degrees + '°: mean 오차 ' + stats.mean.toFixed(3) + 'px > 0.5px');
    }
  }
});

test('자의 자 검증 — 틀린 θ(+3°) 예측은 문턱을 넘는 오차를 낸다', () => {
  const { image, corners } = makeCheckerboard();
  const warped = cameraTiltImage(image, 25, { axis: 'horizontal', fill: FILL });
  const stats = measureCorners(warped, corners,
    (point) => tiltForward(point, image, 28, 'horizontal'));
  assert.ok(stats.max > 1.5,
    '3° 오예측인데 max 오차 ' + stats.max.toFixed(3) + 'px — 자가 편차를 못 본다');
});

// ---- 자 검증: barrel ------------------------------------------------------------

test('자 검증 — barrel: 체커 코너가 Newton 반전 forward 예측 위치에 나타난다', () => {
  const { image, corners } = makeCheckerboard();
  for (const k1 of [0.05, 0.15, 0.3]) {
    const warped = barrelDistortImage(image, { k1, fill: FILL });
    const stats = measureCorners(warped, corners,
      (point) => barrelForward(point, image, k1));
    assert.ok(stats.count >= 60,
      'k1 ' + k1 + ': 측정 코너 부족 ' + stats.count + ' (weak ' + stats.weak + ')');
    assert.ok(stats.max <= 1.0, 'k1 ' + k1 + ': max 오차 ' + stats.max.toFixed(3) + 'px');
    assert.ok(stats.mean <= 0.5, 'k1 ' + k1 + ': mean 오차 ' + stats.mean.toFixed(3) + 'px');
  }
});

test('자 검증 — barrel 방향: k1>0 에서 코너가 중심 쪽으로 당겨진다 (배럴)', () => {
  const { image, corners } = makeCheckerboard();
  const centerX = (image.width - 1) / 2;
  const centerY = (image.height - 1) / 2;
  const outer = corners.reduce((best, corner) => {
    const radius = Math.hypot(corner.x - centerX, corner.y - centerY);
    return radius > best.radius ? { corner, radius } : best;
  }, { corner: null, radius: -1 });
  const predicted = barrelForward(outer.corner, image, 0.15);
  const predictedRadius = Math.hypot(predicted.x - centerX, predicted.y - centerY);
  assert.ok(predictedRadius < outer.radius,
    '배럴인데 최외곽 코너 반경이 ' + outer.radius.toFixed(1) + ' → '
    + predictedRadius.toFixed(1) + ' 로 줄지 않았다');
  // 이미지에서도 실제로 그 자리(안쪽)에 코너가 있다.
  const warped = barrelDistortImage(image, { k1: 0.15, fill: FILL });
  const detected = detectCorner(warped, predicted);
  assert.ok(Math.hypot(detected.x - predicted.x, detected.y - predicted.y) <= 1.0);
});

test('자의 자 검증 — 항등(k1=0) 예측으로 k1=0.15 이미지를 재면 오차가 보인다', () => {
  const { image, corners } = makeCheckerboard();
  const warped = barrelDistortImage(image, { k1: 0.15, fill: FILL });
  const stats = measureCorners(warped, corners, (point) => ({ x: point.x, y: point.y }));
  assert.ok(stats.max > 1.5,
    'k1=0.15 를 항등으로 재는데 max 오차 ' + stats.max.toFixed(3) + 'px — 자가 둔하다');
});

// ---- 합성(tilt→barrel) · 파이프라인 배선 · 결정성 · fill 규약 ---------------------

test('자 검증 — tilt 25°(diagonal) → barrel k1 0.1 합성도 forward 합성이 맞는다', () => {
  const { image, corners } = makeCheckerboard();
  const warped = barrelDistortImage(
    cameraTiltImage(image, 25, { axis: 'diagonal', fill: FILL }),
    { k1: 0.1, fill: FILL },
  );
  const stats = measureCorners(warped, corners,
    (point) => barrelForward(tiltForward(point, image, 25, 'diagonal'), image, 0.1));
  assert.ok(stats.count >= 60, '합성: 측정 코너 부족 ' + stats.count);
  assert.ok(stats.max <= 1.0, '합성: max 오차 ' + stats.max.toFixed(3) + 'px');
});

test('distortImage(tilt·barrel) 배선은 개별 연산 순차 적용과 바이트 동일하다', () => {
  const { image } = makeCheckerboard({ cells: 6, cellPx: 10, margin: 12 });
  const piped = distortImage(image, {
    tilt: { degrees: 20, axis: 'vertical' },
    barrel: { k1: 0.1 },
    fill: FILL,
  });
  const manual = barrelDistortImage(
    cameraTiltImage(image, 20, { axis: 'vertical', fill: FILL }),
    { k1: 0.1, fill: FILL },
  );
  assert.deepEqual(piped.pixels, manual.pixels);
});

test('결정성 — 같은 입력에서 두 번 실행하면 픽셀이 동일하다', () => {
  const { image } = makeCheckerboard({ cells: 6, cellPx: 10, margin: 12 });
  const first = barrelDistortImage(cameraTiltImage(image, 30, { axis: 'diagonal', fill: FILL }), { k1: 0.15, fill: FILL });
  const second = barrelDistortImage(cameraTiltImage(image, 30, { axis: 'diagonal', fill: FILL }), { k1: 0.15, fill: FILL });
  assert.deepEqual(first.pixels, second.pixels);
});

test('fill 규약(교훈 004) — a 없는 fill 은 신규 연산에서도 throw', () => {
  const { image } = makeCheckerboard({ cells: 4, cellPx: 8, margin: 8 });
  assert.throws(() => cameraTiltImage(image, 20, { fill: { r: 255, g: 255, b: 255 } }), TypeError);
  assert.throws(() => barrelDistortImage(image, { k1: 0.1, fill: { r: 255, g: 255, b: 255 } }), TypeError);
});

test('입력 검증 — 축·범위 밖 파라미터는 RangeError', () => {
  const { image } = makeCheckerboard({ cells: 4, cellPx: 8, margin: 8 });
  assert.throws(() => cameraTiltImage(image, 70, {}), RangeError);
  assert.throws(() => cameraTiltImage(image, 20, { axis: 'both' }), RangeError);
  assert.throws(() => barrelDistortImage(image, { k1: -0.1 }), RangeError);
  assert.throws(() => barrelDistortImage(image, { k1: 0.7 }), RangeError);
});
