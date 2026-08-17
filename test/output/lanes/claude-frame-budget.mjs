/**
 * claude-frame-budget.mjs — 「프레임 한 장에 몇 ms 쓰는가」를 실사진으로 잰다.
 *
 * 왜 지금: 운영자 목표가 «fps > 1». 그런데 「1\~5초 텀」의 원인이 둘일 수 있다 —
 *   ⓐ 프레임 처리가 느리다        → WASM 이식이 옳은 표적
 *   ⓑ 5프레임 중 승격 1장만 복호 가능 → 빨라져도 텀은 그대로 (표적이 해상도)
 * 오늘 역산(실패 3.7\~5.9 px/셀 · 경계 6.1\~6.3 · 벽 6\~7)이 ⓑ 를 가리키므로,
 * 밤을 걸기 전에 ⓐ 의 크기를 숫자로 확인한다.
 *
 * 잰다:
 *   · 성공 프레임 / 실패 프레임의 decodeFrontend 시간 (실패가 보통 더 비싸다 —
 *     모든 후보를 다 태우고 죽으므로)
 *   · 블록 로케이터만 따로 (검출 vs 평가 분해)
 *   · 960 vs 1440 (스캐너의 기본 프레임 vs 승격 프레임)
 */

import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../../tools/read-luma.mjs';

const LAB = {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
};

const dumps = listLumaDumps()
  .filter((d) => d.name.startsWith('v0t-crop-20260817/'))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log('덤프                                   해상도  로케이터ms  전체ms   판정');
const rows = [];
for (const dump of dumps) {
  const luma = readLumaDump(dump.path);
  const raster = lumaToRaster(luma);
  const side = Math.max(luma.width, luma.height);

  // 워밍업 1회 (JIT) 후 3회 중앙값.
  detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true });
  const locMs = [];
  for (let k = 0; k < 3; k += 1) {
    const t = performance.now();
    detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true });
    locMs.push(performance.now() - t);
  }
  decodeFrontend(raster, LAB);
  const allMs = [];
  let ok = false;
  for (let k = 0; k < 3; k += 1) {
    const t = performance.now();
    const r = decodeFrontend(raster, LAB);
    allMs.push(performance.now() - t);
    ok = r.ok === true;
  }
  const med = (a) => [...a].sort((x, y) => x - y)[1];
  const short = dump.name.replace('v0t-crop-20260817/KakaoTalk_20260817_', '');
  rows.push({ short, side, loc: med(locMs), all: med(allMs), ok });
  console.log(`${short.padEnd(38)}${String(side).padEnd(8)}`
    + `${med(locMs).toFixed(0).padEnd(12)}${med(allMs).toFixed(0).padEnd(9)}`
    + (ok ? 'OK' : '실패'));
}

console.log('\n=== 요약 ===');
for (const side of [960, 1440]) {
  for (const ok of [true, false]) {
    const mine = rows.filter((r) => r.side === side && r.ok === ok);
    if (!mine.length) continue;
    const all = mine.map((r) => r.all).sort((a, b) => a - b);
    const loc = mine.map((r) => r.loc).sort((a, b) => a - b);
    console.log(`  ${side} · ${ok ? '성공' : '실패'} (${mine.length}장):`
      + ` 전체 중앙값 ${all[Math.floor(all.length / 2)].toFixed(0)}ms`
      + ` (최대 ${all[all.length - 1].toFixed(0)})`
      + ` · 그중 로케이터 ${loc[Math.floor(loc.length / 2)].toFixed(0)}ms`);
  }
}
const all960 = rows.filter((r) => r.side === 960).map((r) => r.all);
if (all960.length) {
  const med = [...all960].sort((a, b) => a - b)[Math.floor(all960.length / 2)];
  console.log(`\n판독: 960 프레임 중앙값 ${med.toFixed(0)}ms → 이론 ${(1000 / med).toFixed(1)} fps`);
  console.log('      이 값이 1000ms 를 크게 밑돌면 「1\~5초 텀」은 속도가 아니라'
    + ' **복호 가능한 프레임이 드물어서**다 (표적 = 해상도/줌, WASM 아님).');
  console.log('      1000ms 에 가깝거나 넘으면 속도가 진짜 병목이다 (표적 = WASM).');
}
