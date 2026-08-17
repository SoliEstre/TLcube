/**
 * claude-v0tr-detect-debug.mjs — «v0tr 포즈가 왜 0 인가» 를 단계별로 쪼갠다.
 *
 * 앵커드 경로의 조건은 넷이다:
 *   ⓐ 검증된 K3 중앙(`v0-center`)이 있는가
 *   ⓑ 그 중앙에서 반경 ~11.36셀(=√129) 자리에 **엄격 코너**(`v2r2-corner`)가 있는가
 *      — `corners` 는 `slice(0, 4)` 다.
 *   ⓒ 사각 링 동반자 ≥ 1 인가 (`v0trRequireSquareRing`)
 *   ⓓ refinePose 가 서는가
 * 어디서 끊기는지 실측한다. 게이트는 한 값도 안 건드린다 — 스위치 A/B 만 쓴다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS, detectCellSurfaceBlockShapes,
} from '../../../src/decoder/cellsurface-block-detect.js';
import { hasCenterQrSlot } from '../../../src/cellSurfaceFinal.js';
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

function frameFor(layout, pixelsPerUnit = 15) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const sceneOpts = { palette: PALETTE, margin: 4, locatorProfile: 'cell-surface-' + layout };
  if (hasCenterQrSlot(layout)) sceneOpts.qrText = TL_READER_URL;
  const scene = buildSceneY(encoded, sceneOpts);
  return toRelativeLuminance(rasterize(scene, { pixelsPerUnit, supersample: 2, fill: FILL }));
}

const { patchesFor } = CS_BLOCK_LOCATOR_INTERNALS;
/** 현행 v0TR 코너 앵커 반경 — 모듈이 실제로 쓰는 값 (patchesFor 에서 그대로). */
const R_CORNER = Math.hypot(
  patchesFor(21, 'v0tr').corners[0].anchor.x, patchesFor(21, 'v0tr').corners[0].anchor.y,
);
/** 두 후보 반경 (닫힌 형태) — 안쪽 (5,13) · 바깥 (3,18). 기각된 안을 계속 재기 위해 남긴다. */
const R_INNER = Math.sqrt(25 + 169 - 65);
const R_OUTER = Math.sqrt(9 + 324 - 54);
const SNAP = 3.2;
console.log('코너 앵커 반경(현행) %s · 후보: 안쪽 √129 = %s · 바깥 √279 = %s · ANCHOR_SNAP %s',
  R_CORNER.toFixed(4), R_INNER.toFixed(4), R_OUTER.toFixed(4), SNAP);
console.log('※ 이 스크립트의 본론은 «안쪽을 코너로 삼으면 왜 포즈가 0 이 되는가» 다 —');
console.log('  아래 «엄격 코너 후보» 의 추정 반경이 전부 바깥(≈18.5) 쪽이고 안쪽(≈11.4) 이');
console.log('  하나도 없는 것이 그 답이다 (엄격 검증기가 안쪽 코어를 안 세운다).');

for (const id of ['v0tr', 'v0trq', 'v0t']) {
  const luma = frameFor(id);
  const out = detectCellSurfaceBlockShapes(luma, { });
  const v = out.diagnostics.verified;
  const centres = v.filter((h) => h.kind === 'v0-center').slice(0, 3);
  const corners = v.filter((h) => h.kind === 'v2r2-corner').slice(0, 4);
  console.log('\n=== [%s] ===', id);
  console.log('  verified %d (v0-center %d · v2r2-corner %d · legacy %d)',
    v.length, v.filter((h) => h.kind === 'v0-center').length,
    v.filter((h) => h.kind === 'v2r2-corner').length,
    v.filter((h) => h.kind !== 'v0-center' && h.kind !== 'v2r2-corner').length);
  console.log('  ⓐ 중앙 후보 %d (slice 3) · ⓑ 엄격 코너 후보 %d (slice 4)',
    centres.length, corners.length);
  if (centres.length === 0) { console.log('  → ⓐ 에서 끊긴다 (중앙 불스아이 미검출)'); continue; }
  for (const centre of centres) {
    console.log('  중앙 (%s, %s) u=%s score=%s',
      centre.x.toFixed(1), centre.y.toFixed(1), centre.u.toFixed(2), centre.score.toFixed(3));
    for (const corner of corners) {
      const d = Math.hypot(corner.x - centre.x, corner.y - centre.y);
      const r = d / centre.u;
      console.log('    코너 (%s, %s) → 추정 반경 %s셀 · Δ안쪽 %s (%s) · Δ바깥 %s (%s)',
        corner.x.toFixed(1), corner.y.toFixed(1), r.toFixed(3),
        (r - R_INNER).toFixed(3), Math.abs(r - R_INNER) <= SNAP ? 'v0tr 시드 O' : 'X',
        (r - R_OUTER).toFixed(3), Math.abs(r - R_OUTER) <= SNAP ? 'v0t 시드 O' : 'X');
    }
  }
  // ⓒ·ⓓ — 사각 링 게이트를 끄면 서는가 (게이트 완화가 아니라 A/B 진단이다).
  const noRing = detectCellSurfaceBlockShapes(luma, {
    calibration: { csBlockLocator: { v0trRequireSquareRing: false } },
  });
  console.log('  ⓒ 사각 링 게이트 off → v0tr 포즈 %d (기본 %d)',
    noRing.diagnostics.poseCount.v0tr, out.diagnostics.poseCount.v0tr);
  console.log('  전체 poseCount: %s', JSON.stringify(out.diagnostics.poseCount));
  console.log('  느슨한 코너 %d · bullseyeConfirmed %s',
    out.diagnostics.centerQr.corners, JSON.stringify(out.diagnostics.bullseyeConfirmed));
}
