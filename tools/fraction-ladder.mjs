/**
 * fraction-ladder.mjs — **코드가 프레임에서 차지하는 비율 ↔ R2 성패**의 사다리.
 *
 * 🔴 왜 있나 (2026-09-05): 운영자 실기 「R2 는 큐브가 가이드의 50% 이상이어야 인식」.
 * 합성으로 두 번 실패한 뒤(PM/029B §25.4.1·§25.4.2) 실사진으로 돌아왔고,
 * tele/wide 세트가 **비율 20\~22% 에서 R2 전멸**을 보였다. 코드가 프레임을 꽉 채우는
 * 영상 시퀀스(y0·y1·y2)에서는 143\~248 ms 로 성공한다. 문턱은 그 사이에 있다.
 *
 * 이 자는 **가진 덤프를 전부 훑어** 비율과 성패를 짝지어 사다리를 만든다.
 *
 * 🔴 **비율은 라벨이 아니라 측정값**이다 — 로케이터 포즈의 반경에서 유도한다.
 * 그래서 「이 세트가 원거리였다」는 기억이 아니라 그 프레임의 실제 기하가 축이 된다.
 *
 * ⚠ 이 사다리는 **비율 축 하나**가 아니다. 세트마다 조명·초점·톤커브가 다르다.
 * 비율이 낮은 세트가 «비율 때문에» 실패했다고 단정하면 안 된다 — 사다리는 **어디를
 * 더 봐야 하는지**를 가리키는 것이지 인과를 증명하지 않는다.
 *
 * 쓰기: node tools/fraction-ladder.mjs [--1440] [--r1]
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectCellSurfaceBlockShapes } from '../src/decoder/cellsurface-block-detect.js';
import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { readLumaDump, lumaToRaster } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LUMA = join(ROOT, 'test', 'output', 'photos', 'luma');
const SIDE = process.argv.includes('--1440') ? '1440' : '960';
const WITH_R1 = process.argv.includes('--r1');
/** 세트당 상한 — 사다리를 만드는 데 전수는 필요 없고, 없으면 한 세트가 몇 분을 먹는다. */
const MAX_FRAMES = 16;

/*
 * ⚠ `luma/` 최상위에도 파일이 직접 있고 하위 폴더도 있다 (혼합 깊이).
 * 첫 판은 파일을 만나면 `break` 해서 **최상위에서 순회가 끊겼다** — 세트 0개.
 * 이제 끊지 않고, 「이 디렉터리에 덤프가 있으면 그 자체가 한 세트」로만 표시한다.
 */
function setsUnder(dir, prefix = '') {
  const out = [];
  let hasDump = false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...setsUnder(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith(`.${SIDE}.luma`)) {
      hasDump = true;
    }
  }
  if (hasDump) out.push(prefix.replace(/\/$/, '') || '(최상위)');
  return out;
}
function runSet(name) {
  const dir = name === '(최상위)' ? LUMA : join(LUMA, name);
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(`.${SIDE}.luma`)).sort();
  } catch { return null; }
  if (!files.length) return null;
  files = files.slice(0, MAX_FRAMES);

  const runtime = createR2ScanRuntime({ enabled: true });
  let pose = 0;
  let r2 = 0;
  let r1 = 0;
  let maxD = 0;
  let doneFrame = -1;
  const radii = [];
  files.forEach((file, index) => {
    let luma;
    try { luma = readLumaDump(join(dir, file)); } catch { return; }
    try {
      const det = detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true });
      const shape = (det.shapes || []).find((x) => x.blockLocator && x.blockLocator.locatorH);
      if (shape) {
        pose += 1;
        if (shape.radius > 0) radii.push((shape.radius * 2) / Math.min(luma.width, luma.height));
      }
    } catch { /* 0 */ }
    if (WITH_R1) {
      try {
        const res = decodeFrontend(lumaToRaster(luma), { enableCellSurfaceY: true });
        if (res && res.ok === true) r1 += 1;
      } catch { /* 0 */ }
    }
    try {
      if (runtime.pushFrame(luma, index * 100)) { r2 += 1; if (doneFrame < 0) doneFrame = index; }
      if (runtime.stats.progressD > maxD) maxD = runtime.stats.progressD;
    } catch { /* 0 */ }
  });
  radii.sort((a, b) => a - b);
  return {
    name,
    frames: files.length,
    pose,
    r1,
    r2,
    maxD,
    doneFrame,
    fraction: radii.length ? radii[Math.floor(radii.length / 2)] : null,
    lockedN: runtime.stats.lockedN,
  };
}

const sets = [...new Set(setsUnder(LUMA))].filter(Boolean).sort();
const rows = [];
for (const name of sets) {
  const r = runSet(name);
  if (r) rows.push(r);
  console.error(`  [${name}] 완료`);
}
rows.sort((a, b) => (b.fraction ?? 0) - (a.fraction ?? 0));

console.log(`\n── 비율 사다리 (${SIDE}px, 세트당 최대 ${MAX_FRAMES}장) ──`);
console.log('코드비율  세트                                 장 | 포즈   R2복호  f    최대D  락n' + (WITH_R1 ? '  R1' : ''));
for (const r of rows) {
  console.log(
    `${(r.fraction === null ? '  —' : `${(r.fraction * 100).toFixed(0)}%`).padStart(7)}  `
    + `${r.name.padEnd(36)}${String(r.frames).padStart(3)} |`
    + ` ${String(r.pose).padStart(2)}/${r.frames}`
    + `  ${String(r.r2).padStart(2)}/${r.frames}`
    + `  ${String(r.doneFrame < 0 ? '—' : r.doneFrame).padStart(3)}`
    + `  ${r.maxD.toFixed(2).padStart(5)}`
    + `  n${r.lockedN}`
    + (WITH_R1 ? `  ${String(r.r1).padStart(2)}/${r.frames}` : ''),
  );
}
