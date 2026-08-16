/**
 * claude-skew-real-pose.mjs — 프레임에서 **큐브 기하 가설의 포즈**를 직접 뽑는다.
 * (decodeFrontend 가 실패하면 가설이 결과에 남지 않는다 — 검출기를 직접 부른다.)
 *
 * 그리고 그 포즈로 **포맷 셀 표본**을 다시 재서 «왜 소거됐는지» 를 자리별로 본다.
 *
 * 사용: node tools/probes/claude-skew-real-pose.mjs <frame.rgba>
 */

import { readRgba } from './claude-skew-real-frontend.mjs';
import { toRelativeLuminance } from '../../src/decoder/luma.js';
import { detectCubeHypotheses, sampleCubeCell } from '../../src/decoder/cube-detect.js';

const raster = readRgba(process.argv[2]);
const luma = toRelativeLuminance(raster, {});
const result = detectCubeHypotheses(luma, undefined, {
  enableLocatorY: true,
  enableCellSurfaceY: true,
});

console.log('ok:', result.ok, 'reason:', result.reason ?? null);
const list = result.hypotheses || [];
console.log('hypotheses:', list.length);
for (const h of list.slice(0, 6)) {
  const sx = Math.hypot(h.H[0], h.H[3]);
  const sy = Math.hypot(h.H[1], h.H[4]);
  console.log(' -', h.hypothesisId, '| n', h.n, 'tones', h.tones,
    '| cellPx', ((sx + sy) / 2).toFixed(2),
    '| residual', Number(h.geometryResidual).toExponential(2));
  console.log('   vertices', (h.vertices || []).map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));
}

// 포맷 셀 표본 재측정 — 어느 셀이 왜 죽는가
const target = list[0];
if (target) {
  const cells = [];
  const seen = new Set();
  for (let i = -target.n; i <= target.n; i += 1) {
    for (let j = -target.n; j <= target.n; j += 1) {
      void i; void j;
    }
  }
  void cells; void seen;
  // 실제 포맷 셀 좌표는 autoplaceY 가 소유한다 — 여기서는 «중심 근방 셀» 표본 상태만
  // 훑어 sampleCubeCell 실패율의 공간 분포를 본다.
  let okCount = 0;
  let failCount = 0;
  const failByRing = new Map();
  for (let i = 0; i < target.n; i += 1) {
    for (let j = 0; j < target.n; j += 1) {
      const sample = sampleCubeCell(luma, target, i, j, {});
      const ring = Math.max(i, j);
      if (sample && sample.ok !== false) okCount += 1;
      else {
        failCount += 1;
        failByRing.set(ring, (failByRing.get(ring) || 0) + 1);
      }
    }
  }
  console.log('cell sample ok/fail:', okCount, '/', failCount,
    '| fail by ring:', JSON.stringify([...failByRing.entries()].sort((a, b) => a[0] - b[0])));
  const sample = sampleCubeCell(luma, target, 0, 0, {});
  console.log('sample(0,0):', JSON.stringify(sample && {
    ok: sample.ok,
    T: sample.T && { median: sample.T.median, count: sample.T.count },
    L: sample.L && { median: sample.L.median, count: sample.L.count },
    R: sample.R && { median: sample.R.median, count: sample.R.count },
  }));
}
