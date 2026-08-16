/**
 * claude-skew-real-lock.mjs — «파인더를 잡았는데 왜 실패하나» 의 결정적 검사:
 * 채택된 큐브 기하 가설의 **중심이 실제 큐브 위인가, 아니면 옆의 QR 위인가**.
 *
 * 참값 중심은 디코더와 독립인 `claude-skew-real-locate.py` 의 bbox 에서 온다.
 * QR 중심은 사진마다 손으로 읽은 값이 아니라, **큐브 성분을 제외한 «어둡고 무채색인
 * 큰 정사각 성분»** 으로 별도 산출한다 (locate 스크립트의 --qr 모드).
 *
 * 사용: node tools/probes/claude-skew-real-lock.mjs --modes whole,live960
 */

import { basename } from 'node:path';
import { writeFileSync } from 'node:fs';

import { readRgba } from './claude-skew-real-frontend.mjs';
import { PHOTOS, frameFor } from './claude-skew-real-sweep.mjs';
import { toRelativeLuminance } from '../../src/decoder/luma.js';
import { detectCubeHypotheses } from '../../src/decoder/cube-detect.js';

/** locate.py 실측 (원본 픽셀). cube = 유채색·어두운 최대 성분의 육각 bbox 중심. */
const TRUTH = {
  p00: { cube: [1320, 1975], radius: 570, size: [3000, 4000] },
  p01: { cube: [1462, 1967], radius: 1060, size: [3000, 4000] },
  p02: { cube: [2307, 1271], radius: 618, size: [4000, 3000] },
  p03: { cube: [2484, 1839], radius: 890, size: [4000, 3000] },
  p04: { cube: [1456, 2423], radius: 636, size: [3000, 4000] },
  p05: { cube: [1740, 1962], radius: 794, size: [3000, 4000] },
};

function frameMap(photoId, mode, frameW, frameH) {
  const [w0, h0] = TRUTH[photoId].size;
  if (mode.startsWith('whole')) {
    const s = frameW / w0;
    return (p) => [p[0] * s, p[1] * s];
  }
  if (mode.startsWith('live')) {
    const side = Math.min(w0, h0);
    const x = (w0 - side) / 2;
    const y = (h0 - side) / 2;
    const s = frameW / side;
    return (p) => [(p[0] - x) * s, (p[1] - y) * s];
  }
  throw new Error('mode 미지원: ' + mode);
}

function centerOf(vertices) {
  const n = vertices.length;
  return [vertices.reduce((a, p) => a + p.x, 0) / n, vertices.reduce((a, p) => a + p.y, 0) / n];
}

if (basename(process.argv[1]) === 'claude-skew-real-lock.mjs') {
  const modesArg = process.argv.indexOf('--modes');
  const modes = (modesArg >= 0 ? process.argv[modesArg + 1] : 'whole').split(',');
  const rows = [];
  for (const photo of PHOTOS) {
    for (const mode of modes) {
      const framePath = frameFor(photo, mode);
      const raster = readRgba(framePath);
      const luma = toRelativeLuminance(raster, {});
      const t0 = Date.now();
      const result = detectCubeHypotheses(luma, undefined, {
        enableLocatorY: true, enableCellSurfaceY: true,
      });
      const map = frameMap(photo.id, mode, raster.width, raster.height);
      const truth = map(TRUTH[photo.id].cube);
      const radius = TRUTH[photo.id].radius * (raster.width / TRUTH[photo.id].size[0]);
      const hyps = (result.hypotheses || []).slice(0, 8).map((h) => {
        const c = centerOf(h.vertices);
        const dx = c[0] - truth[0];
        const dy = c[1] - truth[1];
        const sx = Math.hypot(h.H[0], h.H[3]);
        const sy = Math.hypot(h.H[1], h.H[4]);
        return {
          id: h.hypothesisId,
          center: [Number(c[0].toFixed(1)), Number(c[1].toFixed(1))],
          distToCubePx: Number(Math.hypot(dx, dy).toFixed(1)),
          distRelRadius: Number((Math.hypot(dx, dy) / radius).toFixed(2)),
          cellPx: Number(((sx + sy) / 2).toFixed(2)),
          n: h.n, tones: h.tones,
        };
      });
      const row = {
        photo: photo.id, mode, frame: [raster.width, raster.height],
        cubeTruthInFrame: [Number(truth[0].toFixed(1)), Number(truth[1].toFixed(1))],
        cubeRadiusInFrame: Number(radius.toFixed(1)),
        cubeOk: result.ok === true,
        cubeReason: result.reason ?? null,
        hypothesisCount: (result.hypotheses || []).length,
        hypotheses: hyps,
        onCube: hyps.length > 0 ? hyps.some((h) => h.distRelRadius <= 0.35) : null,
        ms: Date.now() - t0,
      };
      rows.push(row);
      console.log(`${photo.id} ${mode} ${raster.width}x${raster.height} cubeOk=${row.cubeOk} hyp=${row.hypothesisCount}`
        + ` truth=(${row.cubeTruthInFrame}) r=${row.cubeRadiusInFrame}`
        + ` → ${hyps.length ? hyps.map((h) => `${h.center} d=${h.distToCubePx}(${h.distRelRadius}R) cell=${h.cellPx}`).slice(0, 2).join(' ; ') : '(none)'}`
        + ` | onCube=${row.onCube} | ${row.ms}ms`);
    }
  }
  const outIndex = process.argv.indexOf('--out');
  if (outIndex >= 0) writeFileSync(process.argv[outIndex + 1], JSON.stringify(rows, null, 1));
}
