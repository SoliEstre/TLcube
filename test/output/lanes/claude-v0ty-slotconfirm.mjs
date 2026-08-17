/**
 * claude-v0ty-slotconfirm.mjs — 증상 ④ 재현: 「v0TY 가 멀리서 v0T 로 분류된다」.
 *
 * 운영자 실기기 (2026-08-17): «v0TY는 멀리있을 때는 v0T로 분류돼서 안잡히다가
 * QR 가시권 안으로 들어가면 즉시 인식».
 *
 * 가설: 슬롯 QR 확증(`slotQrConfirmsPose`, 문턱 3종 contrast .6 · correlation .25 ·
 * spanRatio .35)이 해상도를 요구한다. 확증이 실패하면 v0ty 포즈는 기각되는데,
 * **v0T 는 중앙·NE 를 공유하므로 v0t 포즈는 그대로 선다** → 프레임이 v0T 로
 * 분류되고, SE 자리가 실제로는 QR 인 프레임을 v0T 로케이터로 읽으니 복호가 죽는다.
 *
 * 순수 축소(ppu)만으로는 합성에서 재현이 안 됐다 — 실물엔 원근·노이즈가 있다.
 * 여기서는 그 축들을 넣어 확증이 먼저 죽는 구간을 만든다.
 *
 * 재는 것: slotQr.rejected(경로별) · poseCount.v0ty vs v0t · 최종 분류.
 * ⚠ 문턱 3종은 **읽기만** 한다. 한 값도 안 건드린다.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { TL_READER_URL } from '../../../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { distortImage } from '../../harness/distort.mjs';
import { embed960 } from './claude-v0w2-leak.mjs';

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

function frameOf(ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0ty', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return embed960(rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }));
}

const LAB = {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
};

const AXES = [
  ['깨끗', {}],
  ['노이즈8', { noise: { sigma: 8, seed: 'v0ty-1' } }],
  ['노이즈14', { noise: { sigma: 14, seed: 'v0ty-2' } }],
  ['원근20', { perspective: 20 }],
  ['원근30', { perspective: 30 }],
  ['원근20+노이즈8', { perspective: 20, noise: { sigma: 8, seed: 'v0ty-3' } }],
];

console.log('ppu 축\t\t\tv0ty포즈 v0t포즈  slotQr거절(전체/앵커드/구제)  분류        판정');
for (const ppu of [12, 10, 9, 8, 7]) {
  const base = frameOf(ppu);
  for (const [label, distort] of AXES) {
    let row;
    try {
      const frame = Object.keys(distort).length
        ? distortImage(base, { ...distort, fill: FILL })
        : base;
      const det = detectCellSurfaceBlockShapes(toRelativeLuminance(frame), {});
      const d = det.diagnostics;
      const decoded = decodeFrontend(frame, LAB);
      const got = decoded.ok ? decoded.hypothesis.cellSurfaceLayout : '-';
      const verdict = decoded.ok
        ? (decoded.text === PAYLOAD && got === 'v0ty' ? 'OK' : '★오분류/오독')
        : '실패 ' + decoded.reason.replace('frontend:', '');
      row = `${String(ppu).padEnd(3)}${label.padEnd(18)}`
        + `${String(d.poseCount.v0ty).padEnd(8)}${String(d.poseCount.v0t).padEnd(9)}`
        + `${d.slotQr.rejected}/${d.slotQr.rejectedAnchored}/${d.slotQr.rejectedBullseye}`
        + `${' '.repeat(24)}`.slice(0, 24 - String(d.slotQr.rejected).length)
        + `${got.padEnd(6)}  ${verdict}`;
    } catch (error) {
      row = `${String(ppu).padEnd(3)}${label.padEnd(18)}★ERROR `
        + (error instanceof Error ? error.message : String(error));
    }
    console.log(row);
  }
  console.log('');
}
