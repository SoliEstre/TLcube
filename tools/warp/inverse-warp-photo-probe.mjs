// 실물 스크린샷의 면별 역왜곡 가능성 확인용 oracle 랜드마크 프로브.
//
// scan-photo.mjs와 같은 정사각 크롭/960px 축소를 먼저 적용한다. 그 뒤 사람이 찍은
// 중앙 Y 접점 + 실루엣 여섯 꼭짓점으로 세 면을 정규 아이소메트릭 마름모에 되돌린다.
// 프로덕션 검출기가 아니라 «실물 픽셀도 면별 역샘플링을 견디는가»만 가르는 도구다.

import { readFileSync, writeFileSync } from 'node:fs';
// 🔴 이 경로가 `../../../tools/asset-render.mjs` 였다 — 이식할 때 한 단 더 올라가
//    **바깥 private repo 루트**를 가리켰고 `ERR_MODULE_NOT_FOUND` 로 죽었다.
//    형제 이식본(inverse-warp-study.mjs)은 멀쩡했다 — 둘 중 하나만 돌았다는 뜻이고,
//    「옮겼다」가 「건졌다」를 뜻하지 않는 그 자리다. 배포 사전검증이 잡았다.
import { pngToRaster } from '../asset-render.mjs';
import { rasterToPng } from '../../src/png.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { FRAME_MAX_SIDE } from '../../src/scanner-zoom.js';

const OUT = 'test/output/inverse-warp-study';

/*
 * 사진 원본은 **운영자 로컬 캡처**라 이 public repo 에 없다. 경로를 박아 두면
 * ① 남의 머신 경로가 공개 이력에 남고 ② 다른 사람에겐 무조건 죽는 스크립트가 된다.
 * 그래서 디렉터리를 밖에서 받는다:
 *   TL_PHOTO_DIR=<디렉터리> node tools/warp/inverse-warp-photo-probe.mjs
 *   node tools/warp/inverse-warp-photo-probe.mjs --photos=<디렉터리>
 * 파일 이름은 캡처 시각이라 그대로 둔다 (좌표 사본이 그 두 장에 묶여 있다).
 */
const PHOTO_DIR = process.env.TL_PHOTO_DIR
  ?? process.argv.find((a) => a.startsWith('--photos='))?.slice('--photos='.length);
if (!PHOTO_DIR) {
  throw new Error(
    '사진 디렉터리가 필요하다. TL_PHOTO_DIR=<dir> 또는 --photos=<dir>.\n'
    + '  필요한 파일: 2026-09-01_00.03.15.png · 2026-09-01_00.06.21.png\n'
    + '  (운영자 로컬 캡처 — repo 에 없다. 아래 observed 좌표가 그 두 장에 묶여 있다.)',
  );
}
const photoPath = (name) => `${PHOTO_DIR.replace(/[\\/]+$/, '')}/${name}`;
const PAYLOAD = 'https://tl.estre.so';
const OCCUPANCIES = Object.freeze([0.70, 0.54]);
const PHOTOS = Object.freeze([
  {
    id: 'close',
    file: photoPath('2026-09-01_00.03.15.png'),
    centre: { x: 1924, y: 1081 },
    codePx: 501,
    // 원본 3840×2160 좌표. 800px 진단 크롭에서 수동 판독한 실루엣이다.
    observed: {
      C: { x: 1920, y: 1081 }, TOP: { x: 1924, y: 810 },
      UL: { x: 1674, y: 943 }, UR: { x: 2175, y: 943 },
      LL: { x: 1685, y: 1226 }, LR: { x: 2165, y: 1226 },
      BOTTOM: { x: 1925, y: 1372 },
    },
  },
  {
    id: 'far',
    file: photoPath('2026-09-01_00.06.21.png'),
    centre: { x: 1919, y: 1065 },
    codePx: 340,
    observed: {
      C: { x: 1919, y: 1065 }, TOP: { x: 1918, y: 894 },
      UL: { x: 1749, y: 984 }, UR: { x: 2087, y: 984 },
      LL: { x: 1754, y: 1175 }, LR: { x: 2082, y: 1175 },
      BOTTOM: { x: 1920, y: 1274 },
    },
  },
]);

function resample(src, sx, sy, side, target) {
  const pixels = new Uint8ClampedArray(target * target * 4);
  const scale = side / target;
  for (let y = 0; y < target; y += 1) {
    const fy = sy + (y + 0.5) * scale - 0.5;
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(fy)));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < target; x += 1) {
      const fx = sx + (x + 0.5) * scale - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(fx)));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      const out = (y * target + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const at = (xx, yy) => src.pixels[(yy * src.width + xx) * 4 + channel];
        const top = at(x0, y0) * (1 - wx) + at(x1, y0) * wx;
        const bottom = at(x0, y1) * (1 - wx) + at(x1, y1) * wx;
        pixels[out + channel] = top * (1 - wy) + bottom * wy;
      }
    }
  }
  return { width: target, height: target, pixels };
}

function scanFrame(src, cfg, occupancy) {
  const side = Math.round(cfg.codePx / occupancy);
  const sx = Math.max(0, Math.min(src.width - side, cfg.centre.x - side / 2));
  const sy = Math.max(0, Math.min(src.height - side, cfg.centre.y - side / 2));
  const target = Math.min(FRAME_MAX_SIDE, side);
  const raster = resample(src, sx, sy, side, target);
  const point = ({ x, y }) => ({
    x: (x - sx) * target / side,
    y: (y - sy) * target / side,
  });
  return {
    raster,
    observed: Object.fromEntries(Object.entries(cfg.observed).map(([key, value]) => [key, point(value)])),
    crop: { sx, sy, side, target },
  };
}

function solveLinear(matrix, values) {
  const count = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let col = 0; col < count; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < count; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (Math.abs(rows[pivot][col]) < 1e-12) throw new Error('특이 호모그래피');
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const divisor = rows[col][col];
    for (let j = col; j <= count; j += 1) rows[col][j] /= divisor;
    for (let row = 0; row < count; row += 1) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let j = col; j <= count; j += 1) rows[row][j] -= factor * rows[col][j];
    }
  }
  return rows.map((row) => row[count]);
}

function homography(source, target) {
  const matrix = [];
  const values = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = source[i];
    const { x: u, y: v } = target[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  return [...solveLinear(matrix, values), 1];
}

function applyH(H, point) {
  const d = H[6] * point.x + H[7] * point.y + H[8];
  return {
    x: (H[0] * point.x + H[1] * point.y + H[2]) / d,
    y: (H[3] * point.x + H[4] * point.y + H[5]) / d,
  };
}

function inside(point, polygon) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 1e-7) continue;
    const next = Math.sign(cross);
    if (sign && next !== sign) return false;
    sign = next;
  }
  return true;
}

function sample(raster, point, channel) {
  const x = point.x - 0.5;
  const y = point.y - 0.5;
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

function canonicalLandmarks(size, occupancy) {
  const C = { x: size / 2, y: size / 2 };
  const radius = occupancy * size / Math.sqrt(3);
  const x = Math.sqrt(3) * radius / 2;
  return {
    C,
    TOP: { x: C.x, y: C.y - radius },
    UR: { x: C.x + x, y: C.y - radius / 2 },
    LR: { x: C.x + x, y: C.y + radius / 2 },
    BOTTOM: { x: C.x, y: C.y + radius },
    LL: { x: C.x - x, y: C.y + radius / 2 },
    UL: { x: C.x - x, y: C.y - radius / 2 },
  };
}

function rectify(raster, observed, occupancy) {
  const canonical = canonicalLandmarks(raster.width, occupancy);
  const pixels = new Uint8ClampedArray(raster.pixels);
  const faces = [
    ['C', 'UR', 'TOP', 'UL'],
    ['C', 'UL', 'LL', 'BOTTOM'],
    ['C', 'BOTTOM', 'LR', 'UR'],
  ];
  for (const keys of faces) {
    const destination = keys.map((key) => canonical[key]);
    const source = keys.map((key) => observed[key]);
    const H = homography(destination, source);
    const minX = Math.max(0, Math.floor(Math.min(...destination.map((p) => p.x))));
    const maxX = Math.min(raster.width - 1, Math.ceil(Math.max(...destination.map((p) => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...destination.map((p) => p.y))));
    const maxY = Math.min(raster.height - 1, Math.ceil(Math.max(...destination.map((p) => p.y))));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const target = { x: x + 0.5, y: y + 0.5 };
        if (!inside(target, destination)) continue;
        const sourcePoint = applyH(H, target);
        const out = (y * raster.width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const value = sample(raster, sourcePoint, channel);
          if (value !== null) pixels[out + channel] = value;
        }
      }
    }
  }
  return { width: raster.width, height: raster.height, pixels };
}

function judge(raster) {
  try {
    const decoded = decodeFrontend(raster, {});
    if (decoded?.ok) return String(decoded.text) === PAYLOAD ? 'ok' : `wrong:${decoded.text}`;
    return String(decoded?.reason || decoded?.code || 'fail');
  } catch (error) {
    return `throw:${error.message.slice(0, 60)}`;
  }
}

const rows = [];
for (const photo of PHOTOS) {
  const source = pngToRaster(readFileSync(photo.file));
  for (const occupancy of OCCUPANCIES) {
    const scan = scanFrame(source, photo, occupancy);
    const restored = rectify(scan.raster, scan.observed, occupancy);
    const raw = judge(scan.raster);
    const rectified = judge(restored);
    const tag = `${photo.id}-occ${String(occupancy).replace('.', '_')}`;
    writeFileSync(`${OUT}/${tag}-scan.png`, Buffer.from(rasterToPng(scan.raster)));
    writeFileSync(`${OUT}/${tag}-oracle-restored.png`, Buffer.from(rasterToPng(restored)));
    rows.push({ photo: photo.id, occupancy, crop: scan.crop, raw, oracleRectified: rectified });
    console.log(`${photo.id} ${Math.round(occupancy * 100)}%: ${raw} -> ${rectified}`);
  }
}
writeFileSync(`${OUT}/photo-probe.json`, `${JSON.stringify({
  note: '수동 실루엣 랜드마크 oracle. 프로덕션 검출기 아님.',
  photos: PHOTOS,
  rows,
}, null, 2)}\n`);
