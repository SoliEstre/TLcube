// 역왜곡 복원이 **자세(yaw/pitch) 축**도 넓히는가 — 그 상한을 잰다.
//
// 왜 필요한가:
//   · 역왜곡 연구는 **원근** 축을 0.1 → 0.5 로 넓혔다 (스칼라 반경비 관계식).
//   · 그런데 그 보고서가 스스로 적었다 — 「yaw/pitch ±5°부터 스칼라 t 편향이 커져
//     잔차 게이트/포즈 적합이 필요하다」. 즉 **자세 축도 넓어지는지는 별개 질문**이다.
//   · 운영자 실측: 라이브 스캔 임계가 **7°**. 내 합성 사다리는 yaw −2°\~+1° ·
//     pitch −1°\~+2° 였다 — 3\~7배 과소평가다 (합성은 단발 프레임·고정 프레이밍,
//     라이브는 다중 프레임 + 자동 크롭 + daehan 2차 패스).
//
// 그래서 여기서 재는 것은 **절대값이 아니라 비(比)** 다: 같은 합성 조건에서
//   raw 자세 한계 → oracle 복원 자세 한계
// 그 비를 라이브 7° 에 곱하면 라이브 향상폭의 추정이 된다.
//
// 🔴 **oracle 이다.** 자세를 «안다» 고 가정하고 정확한 면별 호모그래피로 되돌린다.
//    따라서 이 표는 «포즈 추정기를 만들면 어디까지 갈 수 있나» 의 **상한**이지
//    지금 되는 값이 아니다. 스칼라 t 경로는 ±5° 부터 편향되므로 이 상한에 못 미친다.
import { encodeY } from '../../src/encodeY.js';
import {
  buildOrbitMesh, cubePoint, orbitPoint, cubeCenter, projectPoint, perspectiveInvDist,
} from '../../src/y3d-viewer.js';
import { layoutForCube } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';

const PAYLOAD = 'https://tl.estre.so';
const PPU = 17;
const MARGIN = 4;
const DEG = Math.PI / 180;
const FACES = ['T', 'L', 'R'];

const preset = getPreset(DEFAULT_PRESET);
const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M' });
const n = encoded.n;
const layout = layoutForCube(n, { size: 1, margin: MARGIN });
const center3d = cubeCenter(n);
const radius3d = (n / 2) * Math.sqrt(3);
const digitAt = (i, j) => encoded.cellDigits.get(`${i},${j}`)?.digit ?? null;
const levelAt = (i, j, face) => {
  const cell = encoded.cellDigits.get(`${i},${j}`);
  if (!cell || !cell.tones) return null;
  return Number.isInteger(cell.tones[face]) ? cell.tones[face] : null;
};

function render(perspective, yaw, pitch) {
  const mesh = buildOrbitMesh({
    n, tones: encoded.tones, levels: preset.levels, layout, digitAt, levelAt,
    perspective, yaw, pitch, roll: 0, faces: 3,
  });
  return rasterize({
    width: layout.width, height: layout.height, background: preset.background,
    shapes: mesh.quads.map((q) => ({ kind: 'polygon', points: q.points2d, color: q.color })),
  }, { pixelsPerUnit: PPU, supersample: 2 });
}

/** 면의 네 꼭짓점을 그 자세·원근으로 투영한 픽셀 좌표. `rectifyThreeFaces` 의 일반화. */
function faceCorners(face, perspective, yaw, pitch) {
  const invDist = perspectiveInvDist(perspective, radius3d);
  return [
    cubePoint(face, 0, 0), cubePoint(face, n, 0),
    cubePoint(face, n, n), cubePoint(face, 0, n),
  ].map((p) => {
    const rotated = orbitPoint(p, yaw, pitch, center3d, 0);
    const q = projectPoint(rotated, layout, center3d, invDist, undefined);
    return { x: q.x * PPU, y: q.y * PPU };
  });
}

function solveLinear(matrix, values) {
  const size = values.length;
  const rows = matrix.map((row, i) => [...row, values[i]]);
  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < size; r += 1) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (Math.abs(rows[pivot][col]) < 1e-12) return null;
    const tmp = rows[col]; rows[col] = rows[pivot]; rows[pivot] = tmp;
    for (let r = 0; r < size; r += 1) {
      if (r === col) continue;
      const f = rows[r][col] / rows[col][col];
      for (let c = col; c <= size; c += 1) rows[r][c] -= f * rows[col][c];
    }
  }
  return rows.map((row, i) => row[size] / rows[i][i]);
}

function homographyFromFour(source, target) {
  const matrix = [];
  const values = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = source[i];
    const { x: u, y: v } = target[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v);
  }
  const h = solveLinear(matrix, values);
  return h === null ? null : [...h, 1];
}

const applyH = (h, p) => {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d };
};

function inQuad(p, quad) {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-7) continue;
    const next = Math.sign(cross);
    if (sign !== 0 && next !== sign) return false;
    sign = next;
  }
  return true;
}

function sample(raster, p, channel) {
  const x = p.x - 0.5;
  const y = p.y - 0.5;
  if (x < 0 || y < 0 || x > raster.width - 1 || y > raster.height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(raster.width - 1, x0 + 1);
  const y1 = Math.min(raster.height - 1, y0 + 1);
  const wx = x - x0;
  const wy = y - y0;
  const at = (xx, yy) => raster.pixels[(yy * raster.width + xx) * 4 + channel];
  return (at(x0, y0) * (1 - wx) + at(x1, y0) * wx) * (1 - wy)
    + (at(x0, y1) * (1 - wx) + at(x1, y1) * wx) * wy;
}

/** 세 면을 각각 정준(원근 0 · 자세 0) 자리로 되돌린다. 자세를 **안다고 가정**한다. */
function rectify(source, perspective, yaw, pitch) {
  // 중립이면 리샘플링조차 끼우지 않는다 — 픽셀 동일 게이트.
  if (perspective === 0 && yaw === 0 && pitch === 0) {
    return { width: source.width, height: source.height, pixels: new Uint8ClampedArray(source.pixels) };
  }
  const px = new Uint8ClampedArray(source.width * source.height * 4);
  for (let i = 0; i < source.width * source.height; i += 1) {
    px[i * 4] = preset.background.r;
    px[i * 4 + 1] = preset.background.g;
    px[i * 4 + 2] = preset.background.b;
    px[i * 4 + 3] = 255;
  }
  for (const face of FACES) {
    const dest = faceCorners(face, 0, 0, 0);
    const src = faceCorners(face, perspective, yaw, pitch);
    const H = homographyFromFour(dest, src);
    if (H === null) continue;
    const minX = Math.max(0, Math.floor(Math.min(...dest.map((p) => p.x))));
    const maxX = Math.min(source.width - 1, Math.ceil(Math.max(...dest.map((p) => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...dest.map((p) => p.y))));
    const maxY = Math.min(source.height - 1, Math.ceil(Math.max(...dest.map((p) => p.y))));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dp = { x: x + 0.5, y: y + 0.5 };
        if (!inQuad(dp, dest)) continue;
        const sp = applyH(H, dp);
        const o = (y * source.width + x) * 4;
        for (let c = 0; c < 4; c += 1) {
          const v = sample(source, sp, c);
          if (v !== null) px[o + c] = v;
        }
      }
    }
  }
  return { width: source.width, height: source.height, pixels: px };
}

function judge(raster) {
  try {
    const d = decodeFrontend({ width: raster.width, height: raster.height, pixels: raster.pixels }, {});
    return d && d.ok && String(d.text) === PAYLOAD ? '✓' : '✗';
  } catch { return '✗'; }
}

// 🔴 기준선 게이트 — 중립이 raw·restored 둘 다 읽혀야 표가 의미를 갖는다.
const base = render(0, 0, 0);
const baseRaw = judge(base);
const baseRes = judge(rectify(base, 0, 0, 0));
console.log(`기준선 (중립): raw ${baseRaw} · restored ${baseRes}`);
if (baseRaw !== '✓' || baseRes !== '✓') {
  console.log('❌ 기준선이 안 선다 — 표를 만들지 않는다.');
  process.exit(1);
}

console.log('\n🔴 이 표는 **oracle** 이다 — 자세를 안다고 가정한 복원의 **상한**이다.');
console.log('   스칼라 t 경로는 ±5°부터 편향되므로 실제로는 이 상한에 못 미친다.\n');

for (const persp of [0, 0.1]) {
  console.log(`── 원근 ${persp} ──`);
  for (const axis of ['yaw', 'pitch']) {
    const rawOk = [];
    const resOk = [];
    for (let d = -14; d <= 14; d += 1) {
      const view = { yaw: 0, pitch: 0, [axis]: d * DEG };
      const r = render(persp, view.yaw, view.pitch);
      if (judge(r) === '✓') rawOk.push(d);
      if (judge(rectify(r, persp, view.yaw, view.pitch)) === '✓') resOk.push(d);
    }
    const span = (a) => (a.length ? `${Math.min(...a)}° \~ ${Math.max(...a)}°` : '없음');
    const width = (a) => (a.length ? Math.max(...a) - Math.min(...a) + 1 : 0);
    const contiguous = (a) => a.length === width(a);
    console.log(`  ${axis.padEnd(6)} raw       ${span(rawOk).padEnd(14)} (${width(rawOk)}칸)${contiguous(rawOk) ? '' : ' ⚠ 불연속'}`);
    console.log(`  ${' '.repeat(6)} restored  ${span(resOk).padEnd(14)} (${width(resOk)}칸)${contiguous(resOk) ? '' : ' ⚠ 불연속'}`
      + `   ⇒ ${width(rawOk) > 0 ? (width(resOk) / width(rawOk)).toFixed(1) : '—'}배`);
  }
  console.log('');
}
