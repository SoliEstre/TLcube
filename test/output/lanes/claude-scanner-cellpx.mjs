/**
 * claude-scanner-cellpx.mjs — 「스캐너가 실제로 보는 셀 픽셀」을 실사진에서 역산한다.
 *
 * 왜: 하네스(내 크롭)는 23:13 «실패» 사진도 수리 후 전부 복호하는데, 운영자는 같은
 * 수리본이 올라간 시험판에서 그 거리에 실패했다. **차이는 디코더 밖**이다.
 * 스캐너는 매 프레임 **중앙 정사각형을 잘라 960 으로 축소**한다
 * (`sites/tlscan/scanner.js`: FRAME_MAX_SIDE=960 · 5프레임마다 FRAME_ESCALATED_SIDE=1440).
 * 그러면 큐브가 화면에서 차지하는 비율이 곧 셀 픽셀을 정한다.
 *
 * 재는 법 (추정 없이):
 *   ① 내 크롭 덤프에서 복호 성공한 포즈의 `localCellPx(H)` = 크롭 이미지의 셀 px
 *   ② 크롭 스케일을 되돌려 **원본 사진**의 셀 px 로 환산
 *   ③ 스캐너 등가 = 원본 셀 px × (960 / min(W, H))   ← 중앙 정사각 → 960 축소
 *      (1440 승격본도 함께 낸다)
 * 그리고 합성 사다리의 벽(ppu 6\~7)과 나란히 놓는다.
 *
 * 크롭 규약은 crop-dump.html 과 **같은 상수**를 쓴다 — 어긋나면 환산이 틀린다.
 */

import { readFileSync } from 'node:fs';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { CS_BLOCK_LOCATOR_INTERNALS } from '../../../src/decoder/cellsurface-block-detect.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../../../tools/read-luma.mjs';

const { localCellPx } = CS_BLOCK_LOCATOR_INTERNALS;

// crop-dump.html 과 같은 값 (어긋나면 환산 무효).
const BW = 0.55;
const PHOTO_W = 3000;
const PHOTO_H = 4000;
const SCANNER_SIDE = 960;
const SCANNER_ESCALATED = 1440;

const LAB = {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
};

const dumps = listLumaDumps()
  .filter((d) => d.name.startsWith('v0t-crop-20260817/'))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log('사진                                  덤프  크롭셀px  원본셀px  스캐너960  스캐너1440  복호');
const rows = [];
for (const dump of dumps) {
  const luma = readLumaDump(dump.path);
  const raster = lumaToRaster(luma);
  const decoded = decodeFrontend(raster, LAB);
  const det = detectCellSurfaceBlockShapes(luma, { enableCellSurfaceY: true });
  // 포즈는 셰이프에 실려 있지 않다(H 는 내부) — 대신 검출된 중앙 히트의 u 를 쓴다.
  // v0-center 의 u 는 정의상 1셀이다 (t1 = 2셀 → u = t1/2). 축소 계수를 되돌린다.
  const factor = det.diagnostics.downsampleFactor;
  const centre = det.diagnostics.verified.find((h) => h.kind === 'v0-center');
  if (!centre) { console.log(`${dump.name}  중앙 히트 없음`); continue; }
  // diagnostics.verified 의 x,y,u 는 이미 factor 가 곱해져 원본(=덤프) 픽셀이다.
  const cropCellPx = centre.u;
  const dumpSide = Math.max(luma.width, luma.height);
  // 덤프 → 크롭 원본 픽셀
  const cropSourceW = BW * PHOTO_W;              // 크롭 상자의 원본 폭
  const dumpToSource = cropSourceW / luma.width; // 덤프 1px = 원본 몇 px
  const sourceCellPx = cropCellPx * dumpToSource;
  // 스캐너 등가: 중앙 정사각(min(W,H)=3000) → 960
  const scanner960 = sourceCellPx * (SCANNER_SIDE / Math.min(PHOTO_W, PHOTO_H));
  const scanner1440 = sourceCellPx * (SCANNER_ESCALATED / Math.min(PHOTO_W, PHOTO_H));
  const short = dump.name.replace('v0t-crop-20260817/KakaoTalk_20260817_', '');
  rows.push({ short, scanner960, scanner1440, ok: decoded.ok });
  console.log(`${short.padEnd(38)}${String(dumpSide).padEnd(6)}`
    + `${cropCellPx.toFixed(1).padEnd(10)}${sourceCellPx.toFixed(1).padEnd(10)}`
    + `${scanner960.toFixed(1).padEnd(11)}${scanner1440.toFixed(1).padEnd(12)}`
    + (decoded.ok ? 'OK ' + decoded.hypothesis.cellSurfaceLayout : '실패'));
}

console.log('\n=== 세트별 스캐너 등가 셀 픽셀 (960 프레임) ===');
for (const [tag, match] of [['실패 세트 23:13', '231239674'], ['경계 세트 23:27', '232739735']]) {
  const mine = rows.filter((r) => r.short.includes(match));
  if (!mine.length) continue;
  const vals = mine.map((r) => r.scanner960);
  console.log(`  ${tag}: ${Math.min(...vals).toFixed(1)} \~ ${Math.max(...vals).toFixed(1)} px/셀`
    + `  (1440 승격 시 ${(Math.min(...vals) * 1.5).toFixed(1)} \~ ${(Math.max(...vals) * 1.5).toFixed(1)})`);
}
console.log('\n합성 사다리의 벽: ppu 7 에서 본문 RS, ppu 6 이하에서 포맷 불가');
console.log('(ppu = pixelsPerUnit ≈ 셀 픽셀. 위 값과 직접 비교 가능하다.)');
