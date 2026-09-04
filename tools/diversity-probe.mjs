/**
 * diversity-probe.mjs — **프레임 «다양성» 이 진짜 축인가.**
 *
 * 🔴 왜 있나 (2026-09-05): D 궤적이 일찍 평평해지는 것을 확인한 뒤 생긴 의심.
 * 누적은 **독립 잡음**을 평균해서 이긴다. 실패가 **체계적**이면(같은 셀이 매 프레임
 * 같은 이유로 애매하면) 프레임을 더 봐도 0 을 번다 — 실제로 그렇게 나왔다.
 *
 * 그러면 §25.5 의 「코드 비율 45% 문턱」이 **교란변수**일 수 있다:
 * 성공한 y0·y1·y2 는 **움직이는 영상**이고, 실패 세트는 대부분 **거의 같은 사진 연사**다.
 * 「크기」가 아니라 「다양성」이 갈랐을 수 있다.
 *
 * 재는 것: 세트마다
 *   · 인접 프레임 간 평균 절대차 (다양성 대리 지표)
 *   · 포즈 중심의 이동량 (기하가 실제로 움직였나 — 밝기 변화와 구분된다)
 *   · R2 성패 · 최대 D · 코드 비율
 * ⇒ 성패가 **다양성**을 따라가는가 **비율**을 따라가는가.
 *
 * ⚠ 상관은 인과가 아니다. 두 축이 코퍼스에서 얽혀 있으면(영상=크고 움직임 · 사진=작고
 * 정지) 이 자로는 **못 가른다** — 그때는 「가를 수 없다」를 결론으로 적어야 한다.
 *
 * 쓰기: node tools/diversity-probe.mjs
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectCellSurfaceBlockShapes } from '../src/decoder/cellsurface-block-detect.js';
import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { readLumaDump } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LUMA = join(ROOT, 'test', 'output', 'photos', 'luma');
const SIDE = '960';
const MAX_FRAMES = 14;

function setsUnder(dir, prefix = '') {
  const out = [];
  let hasDump = false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...setsUnder(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if (entry.name.endsWith(`.${SIDE}.luma`)) hasDump = true;
  }
  if (hasDump) out.push(prefix.replace(/\/$/, '') || '(최상위)');
  return out;
}

/** 인접 프레임 평균 절대차. stride 로 훑어 비용을 고정한다. */
function frameDelta(a, b) {
  if (a.width !== b.width || a.height !== b.height) return null;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 37) {
    sum += Math.abs(a.data[i] - b.data[i]);
    count += 1;
  }
  return count ? sum / count : null;
}

function runSet(name) {
  const dir = name === '(최상위)' ? LUMA : join(LUMA, name);
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith(`.${SIDE}.luma`)).sort(); } catch { return null; }
  if (files.length < 3) return null;
  files = files.slice(0, MAX_FRAMES);

  const runtime = createR2ScanRuntime({ enabled: true });
  let prev = null;
  let prevCentre = null;
  const deltas = [];
  const shifts = [];
  const radii = [];
  let maxD = 0;
  let done = -1;

  files.forEach((file, index) => {
    let luma;
    try { luma = readLumaDump(join(dir, file)); } catch { return; }
    if (prev) {
      const d = frameDelta(prev, luma);
      if (d !== null) deltas.push(d);
    }
    prev = luma;
    try {
      const det = detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true });
      const shape = (det.shapes || []).find((x) => x.blockLocator && x.blockLocator.locatorH);
      if (shape && shape.center) {
        if (shape.radius > 0) radii.push((shape.radius * 2) / Math.min(luma.width, luma.height));
        if (prevCentre) {
          shifts.push(Math.hypot(shape.center.x - prevCentre.x, shape.center.y - prevCentre.y));
        }
        prevCentre = { x: shape.center.x, y: shape.center.y };
      }
    } catch { /* 0 */ }
    try {
      if (runtime.pushFrame(luma, index * 100) && done < 0) done = index;
      if (runtime.stats.progressD > maxD) maxD = runtime.stats.progressD;
    } catch { /* 0 */ }
  });

  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return {
    name,
    frames: files.length,
    delta: median(deltas),
    shift: median(shifts),
    fraction: median(radii),
    maxD,
    done,
  };
}

const sets = [...new Set(setsUnder(LUMA))].filter(Boolean).sort();
const rows = [];
for (const name of sets) {
  const r = runSet(name);
  if (r) rows.push(r);
  console.error(`  [${name}] 완료`);
}
rows.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));

console.log('\n── 다양성 vs 성패 (인접프레임 차 내림차순) ──');
console.log('프레임차  포즈이동  코드비율  세트                              장 | DONE  최대D');
for (const r of rows) {
  console.log(
    `${(r.delta === null ? '   —' : r.delta.toFixed(4)).padStart(8)}`
    + `${(r.shift === null ? '    —' : r.shift.toFixed(1) + 'px').padStart(10)}`
    + `${(r.fraction === null ? '   —' : `${(r.fraction * 100).toFixed(0)}%`).padStart(10)}`
    + `  ${r.name.padEnd(32)}${String(r.frames).padStart(3)} |`
    + ` ${String(r.done < 0 ? '—' : `f${r.done}`).padStart(4)}`
    + `  ${r.maxD.toFixed(2).padStart(5)}`,
  );
}
