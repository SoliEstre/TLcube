/**
 * claude-skew-real-crops.mjs — 큐브 주변 **타이트 크롭** 다중 스케일 깔때기 스윕.
 *
 * 크롭 창은 `claude-skew-real-locate.py` 가 **디코더와 독립인 규칙**(어둡고 유채색인
 * 최대 연결성분)으로 잡은 큐브 bbox 에서 나온다 — 디코더 결과로 크롭을 정하면
 * «크롭이 검출을 돕는가» 질문이 순환한다.
 *
 * 사용: node tools/probes/claude-skew-real-crops.mjs --out <json> [--zoom 1.5] [--targets 960,1440]
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PHOTOS, frameFor, decodeOnce } from './claude-skew-real-sweep.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** locate.py 가 낸 큐브 bbox (원본 픽셀). 재현: 아래 CLI 그대로. */
export const CUBE_BOXES = {
  p00: { cx: 1320, cy: 1975, side: 1026 },
  p01: { cx: 1462, cy: 1967, side: 1869 },
  p02: { cx: 2307, cy: 1271, side: 1274 },
  p03: { cx: 2484, cy: 1839, side: 1705 },
  p04: { cx: 1456, cy: 2423, side: 1272 },
  p05: { cx: 1740, cy: 1962, side: 1416 },
};

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (basename(process.argv[1]) === 'claude-skew-real-crops.mjs') {
  const zooms = arg('--zooms', '1.5').split(',').map(Number);
  const targets = arg('--targets', '960,1440').split(',').map(Number);
  const opts = arg('--opts', 'lab').split(',');
  const outPath = arg('--out', join(ROOT, 'test', 'output', 'lanes', 'claude-skew-real-crops.json'));
  const rows = [];
  for (const photo of PHOTOS) {
    const box = CUBE_BOXES[photo.id];
    if (!box) continue;
    for (const zoom of zooms) {
      const side = box.side * zoom;
      const x = box.cx - side / 2;
      const y = box.cy - side / 2;
      for (const target of targets) {
        const mode = `box${target}@${x.toFixed(1)},${y.toFixed(1)},${side.toFixed(1)}`;
        const framePath = frameFor(photo, mode);
        for (const opt of opts) {
          const row = {
            photo: photo.id, zoom, target, mode, opt,
            cellPxEstimate: null,
            ...decodeOnce(framePath, { stable: opt === 'stable' }),
          };
          rows.push(row);
          console.log(
            `${photo.id} zoom${zoom} @${target} ${opt} → ${row.ok ? 'OK ' + JSON.stringify(row.text) : row.reason}`
            + ` | hyp=${row.geometryHypothesisCount} fmtProp=${row.format?.formatProposalCount}`
            + ` | pose=${JSON.stringify(row.csBlockLocator?.poseCount ?? null)}`
            + ` | v0=${JSON.stringify((row.layouts || []).find((l) => l.layoutId === 'v0') ?? null)}`
            + ` | ${row.ms}ms`,
          );
          writeFileSync(outPath, JSON.stringify(rows, null, 1));
        }
      }
    }
  }
  console.log(`\n${rows.length} rows → ${outPath}`);
  void execFileSync;
}
