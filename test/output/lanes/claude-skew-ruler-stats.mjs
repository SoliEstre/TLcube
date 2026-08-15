/**
 * claude-skew-ruler-stats.mjs — 자 검증 수치 출력 (보고서 표용).
 *
 * test/harness/distort-camera.test.js 와 같은 원리(독립 forward 모델 + 그래디언트
 * 안장점 탐지)로 조건별 mean/max 오차를 표로 찍는다. 단언은 테스트가 소유하고,
 * 이 스크립트는 수치 기록만 한다.
 */

import { barrelDistortImage, cameraTiltImage } from '../../harness/distort.mjs';

const DARK = 40;
const LIGHT = 215;
const FILL = { r: 128, g: 128, b: 128, a: 255 };

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
      corners.push({ x: margin + i * cellPx - 0.5, y: margin + j * cellPx - 0.5 });
    }
  }
  return { image: { width: side, height: side, pixels }, corners };
}

const AXIS_PHI = { horizontal: 0, vertical: 90, diagonal: 45 };

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

function barrelForward(point, { width, height }, k1, k2 = 0) {
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radiusNorm = Math.hypot(Math.max(centerX, 0.5), Math.max(centerY, 0.5));
  const sx = (point.x - centerX) / radiusNorm;
  const sy = (point.y - centerY) / radiusNorm;
  const rSource = Math.hypot(sx, sy);
  if (rSource === 0) return { x: centerX, y: centerY };
  let r = rSource;
  for (let i = 0; i < 12; i += 1) {
    const r2 = r * r;
    const f = r * (1 + k1 * r2 + k2 * r2 * r2) - rSource;
    const df = 1 + 3 * k1 * r2 + 5 * k2 * r2 * r2;
    r -= f / df;
  }
  const ratio = r / rSource;
  return { x: centerX + sx * ratio * radiusNorm, y: centerY + sy * ratio * radiusNorm };
}

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
    strength = det;
    if (det < 1e3) return { x: cx, y: cy, strength: 0 };
    const nx = (gyy * bx - gxy * by) / det;
    const ny = (gxx * by - gxy * bx) / det;
    if (Math.hypot(nx - predicted.x, ny - predicted.y) > 6) return { x: cx, y: cy, strength: 0 };
    cx = nx;
    cy = ny;
  }
  return { x: cx, y: cy, strength };
}

function measure(image, corners, forwardMap) {
  const errors = [];
  let weak = 0;
  for (const corner of corners) {
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

const { image, corners } = makeCheckerboard();

console.log('| 조건 | 코너 수 | mean 오차(px) | max 오차(px) |');
console.log('|---|---|---|---|');
for (const axis of ['horizontal', 'vertical', 'diagonal']) {
  for (const degrees of [10, 25, 40]) {
    const warped = cameraTiltImage(image, degrees, { axis, fill: FILL });
    const stats = measure(warped, corners, (point) => tiltForward(point, image, degrees, axis));
    console.log('| tilt ' + axis + ' ' + degrees + '° | ' + stats.count + ' | '
      + stats.mean.toFixed(3) + ' | ' + stats.max.toFixed(3) + ' |');
  }
}
for (const k1 of [0.05, 0.15, 0.3]) {
  const warped = barrelDistortImage(image, { k1, fill: FILL });
  const stats = measure(warped, corners, (point) => barrelForward(point, image, k1));
  console.log('| barrel k1 ' + k1 + ' | ' + stats.count + ' | '
    + stats.mean.toFixed(3) + ' | ' + stats.max.toFixed(3) + ' |');
}
{
  const warped = barrelDistortImage(
    cameraTiltImage(image, 25, { axis: 'diagonal', fill: FILL }),
    { k1: 0.1, fill: FILL },
  );
  const stats = measure(warped, corners,
    (point) => barrelForward(tiltForward(point, image, 25, 'diagonal'), image, 0.1));
  console.log('| tilt diag 25° → barrel 0.1 | ' + stats.count + ' | '
    + stats.mean.toFixed(3) + ' | ' + stats.max.toFixed(3) + ' |');
}
{
  const warped = cameraTiltImage(image, 25, { axis: 'horizontal', fill: FILL });
  const stats = measure(warped, corners, (point) => tiltForward(point, image, 28, 'horizontal'));
  console.log('| (음성) θ25 를 28 로 오예측 | ' + stats.count + ' | '
    + stats.mean.toFixed(3) + ' | ' + stats.max.toFixed(3) + ' |');
}
{
  const warped = barrelDistortImage(image, { k1: 0.15, fill: FILL });
  const stats = measure(warped, corners, (point) => ({ x: point.x, y: point.y }));
  console.log('| (음성) k1 0.15 를 항등으로 오예측 | ' + stats.count + ' | '
    + stats.mean.toFixed(3) + ' | ' + stats.max.toFixed(3) + ' |');
}
