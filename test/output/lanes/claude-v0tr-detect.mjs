/**
 * claude-v0tr-detect.mjs — v0TR 계열 **합성 프레임 검출 실측** (브리프 §4-①d 의 실물 답).
 *
 * ① 코너 후보가 실제로 몇 개 뜨는가 (v0TR 은 면당 동심 사각이 **둘**이라 6개가 기대값).
 * ② 그 목록으로 v0TRQ 의 120° 삼중점이 서는가 — `v0trqCornerBudget` 4 대 6 A/B.
 * ③ 네 레이아웃 프레임 전부의 `poseCount` (자기 포즈가 서는가 · 교차로 몇이 서는가).
 * ④ **편입 전/후 대조** — v0tr·v0trq 패밀리를 끈 런과 켠 런의 poseCount·시간.
 *    §4-①(a) 에서 |Δ| = 5.35 > 3.2 였으므로 «기존 프레임 비용 증가 0» 이 기대값이고,
 *    그것이 참인지 여기서 숫자로 확인한다.
 *
 * ⚠ 게이트는 한 값도 안 건드린다. 실사진은 이 체크아웃에 없다 (합성 프레임 전용).
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { finalLayoutIdsForN, hasCenterQrSlot } from '../../../src/cellSurfaceFinal.js';
import { TL_READER_URL } from '../../../src/qr.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });
const PAYLOAD = 'https://tl.estre.so';
const LAYOUTS = [...finalLayoutIdsForN(21)];

function frameFor(layout, tones = 2, pixelsPerUnit = 15) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones, eccLevel: 'M',
  });
  const sceneOpts = { palette: PALETTE, margin: 4, locatorProfile: 'cell-surface-' + layout };
  if (hasCenterQrSlot(layout)) sceneOpts.qrText = TL_READER_URL;
  const scene = buildSceneY(encoded, sceneOpts);
  const raster = rasterize(scene, { pixelsPerUnit, supersample: 2, fill: FILL });
  return toRelativeLuminance(raster);
}

const luma = new Map(LAYOUTS.map((id) => [id, frameFor(id)]));

console.log('=== ① 코너 후보 수 (verifyV0xqCornerCluster · centerQr.corners) ===');
for (const id of LAYOUTS) {
  const out = detectCellSurfaceBlockShapes(luma.get(id), { });
  const d = out.diagnostics;
  console.log('  [%s] 느슨한 코너 %d · v0xq 삼중점 %d · **v0trq 삼중점 %d** (예산 %d)',
    id.padEnd(6), d.centerQr.corners, d.centerQr.tripleCount, d.centerQr.v0trqTripleCount,
    d.centerQr.v0trqCorners);
}

console.log('\n=== ② v0trqCornerBudget A/B — 삼중점이 슬라이스에 살아남는가 ===');
for (const budget of [3, 4, 5, 6, 8]) {
  const row = LAYOUTS.map((id) => {
    const out = detectCellSurfaceBlockShapes(luma.get(id), {
      calibration: { csBlockLocator: { v0trqCornerBudget: budget } },
    });
    return id + ':' + out.diagnostics.centerQr.v0trqTripleCount
      + '/' + out.diagnostics.poseCount.v0trq;
  });
  console.log('  예산 %d → 삼중점/포즈  %s', budget, row.join('  '));
}

console.log('\n=== ③ 레이아웃별 poseCount (기본 cfg) ===');
for (const id of LAYOUTS) {
  const out = detectCellSurfaceBlockShapes(luma.get(id), { });
  const pc = out.diagnostics.poseCount;
  const nonzero = Object.entries(pc).filter(([, v]) => v > 0)
    .map(([k, v]) => k + '=' + v).join(' · ');
  console.log('  [%s] %s  (shape %d)', id.padEnd(6), nonzero || '(전부 0)',
    out.diagnostics.shapeCount);
}

console.log('\n=== ④ 편입 전/후 대조 (v0tr·v0trq 패밀리 off ↔ on) ===');
function bench(id, cfg, rounds = 5) {
  const frame = luma.get(id);
  detectCellSurfaceBlockShapes(frame, cfg);
  const t0 = process.hrtime.bigint();
  let shapes = 0;
  for (let k = 0; k < rounds; k += 1) {
    shapes = detectCellSurfaceBlockShapes(frame, cfg).diagnostics.shapeCount;
  }
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6 / rounds, shapes };
}
const OFF = { calibration: { csBlockLocator: { v0trFamily: false, v0trqFamily: false } } };
const ON = { };
console.log('  | 프레임 | 편입 전 ms | 편입 후 ms | 증가 | 편입 전 shape | 편입 후 shape |');
console.log('  |---|---|---|---|---|---|');
for (const id of LAYOUTS) {
  const off = bench(id, OFF);
  const on = bench(id, ON);
  console.log('  | %s | %s | %s | %s%% | %d | %d |',
    id, off.ms.toFixed(1), on.ms.toFixed(1),
    (((on.ms - off.ms) / off.ms) * 100).toFixed(1), off.shapes, on.shapes);
}
