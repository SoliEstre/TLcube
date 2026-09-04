/**
 * tele-wide-probe.mjs — **실사진 tele/wide 쌍으로 R1·R2 의 크기 하한을 가른다.**
 *
 * 🔴 왜 있나 (2026-09-05): 운영자 실기 관측 「R2 는 큐브가 가이드의 50% 이상이어야
 * 인식」을 합성으로 재려다 **두 번 실패했다** (PM/029B §25.4.1·§25.4.2) —
 * 프레임 전체 축소는 「해상도」를 쟀고, 코드만 축소는 **내 리샘플러의 앨리어싱**을 쟀다.
 * 실제 원거리 촬영은 광학적 **저역통과**를 거치는데 최근접 리샘플은 정반대로 고주파를
 * 만든다.
 *
 * 🟢 그런데 코퍼스에 **이미 실물이 있었다** — 같은 코드를 초점거리만 바꿔 찍은
 * `*-tele` / `*-wide` 쌍. 운영자 지적: 「기존에 망원이랑 중거리 세트로 계속 사진 주지
 * 않았나? 그것만 비교해 봐도 알 것 같은데.」 맞다. **합성보다 이쪽이 낫다.**
 *
 * 재는 것: 세트마다
 *   · R1(`decodeFrontend`) 복호 성공률
 *   · R2 로케이터 포즈 성공률
 *   · R2 전체 경로(누적·복호) 성공률과 최대 진행률 D
 *   · 코드가 프레임에서 차지하는 비율 (포즈 반경으로 유도 — 라벨이 아니라 측정값)
 *
 * ⚠ tele/wide 는 **거리와 화각이 같이 바뀐다.** 분리된 축이 아니다 — 그래도 「코드가
 * 프레임에서 작아지면 무엇이 먼저 죽는가」는 답한다.
 *
 * 쓰기: node tools/tele-wide-probe.mjs [세트...]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../src/decoder/cellsurface-block-detect.js';
import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { readLumaDump, lumaToRaster } from './read-luma.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LUMA = join(ROOT, 'test', 'output', 'photos', 'luma');
const SIDE = process.argv.includes('--1440') ? '1440' : '960';

const DEFAULT_SETS = [
  'finder-20260820-tele', 'finder-20260820-wide',
  'cellmask-20260819-tele', 'cellmask-20260819-wide',
];

function runSet(name) {
  let files;
  try {
    files = readdirSync(join(LUMA, name))
      .filter((f) => f.endsWith(`.${SIDE}.luma`))
      .sort();
  } catch {
    return { name, skipped: 'no-dump' };
  }
  if (!files.length) return { name, skipped: 'empty' };

  let r1 = 0;
  let pose = 0;
  let r2 = 0;
  let maxD = 0;
  const radii = [];
  // R2 는 누적기다 — 한 세트를 **하나의 세션**에 순서대로 민다 (사진마다 새로 만들면
  // 누적을 재는 게 아니라 단발을 재는 것이다).
  const runtime = createR2ScanRuntime({ enabled: true });

  files.forEach((file, index) => {
    let luma;
    try { luma = readLumaDump(join(LUMA, name, file)); } catch { return; }
    try {
      const res = decodeFrontend(lumaToRaster(luma), { enableCellSurfaceY: true });
      if (res && res.ok === true) r1 += 1;
    } catch { /* 실패는 0 */ }
    try {
      const det = detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true });
      const shape = (det.shapes || []).find((x) => x.blockLocator && x.blockLocator.locatorH);
      if (shape) {
        pose += 1;
        // **코드 비율을 측정한다** — 라벨이 아니라 포즈 반경에서 유도한다.
        if (shape.radius > 0) radii.push((shape.radius * 2) / Math.min(luma.width, luma.height));
      }
    } catch { /* 실패는 0 */ }
    try {
      if (runtime.pushFrame(luma, index * 100)) r2 += 1;
      if (runtime.stats.progressD > maxD) maxD = runtime.stats.progressD;
    } catch { /* 실패는 0 */ }
  });

  radii.sort((a, b) => a - b);
  return {
    name,
    frames: files.length,
    r1,
    pose,
    r2,
    maxD,
    fraction: radii.length ? radii[Math.floor(radii.length / 2)] : null,
    lockedN: runtime.stats.lockedN,
    candidates: runtime.stats.candidateCount,
  };
}
const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SETS;
console.log('세트                        장 | R1복호  R2포즈  R2복호  최대D  코드비율(중앙)  락n·후보');
for (const name of targets) {
  const r = runSet(name);
  if (r.skipped) { console.log(`${name.padEnd(27)} 건너뜀 (${r.skipped})`); continue; }
  console.log(
    `${r.name.padEnd(27)}${String(r.frames).padStart(3)} |`
    + ` ${String(r.r1).padStart(3)}/${r.frames}`
    + `  ${String(r.pose).padStart(3)}/${r.frames}`
    + `  ${String(r.r2).padStart(3)}/${r.frames}`
    + `  ${r.maxD.toFixed(2).padStart(5)}`
    + `  ${(r.fraction === null ? '—' : (r.fraction * 100).toFixed(0) + '%').padStart(13)}`
    + `  n${r.lockedN}·${r.candidates}`,
  );
}
