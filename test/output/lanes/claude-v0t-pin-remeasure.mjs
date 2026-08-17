/**
 * claude-v0t-pin-remeasure.mjs — 링 수리 뒤 v0T·v0TY 약점 핀 재측정.
 *
 * 종전 핀 (`test/cellSurface-block-locator.test.js`): v0T 10/12 — `gamma0.7 rot0` ·
 * `gamma0.6 rot0` 두 칸이 `no-format-candidate` 로 죽는다. 귀속된 기전은
 * «W 블록의 중앙 유사 서명이 `centres` 상위 3 슬라이스에서 진짜 중앙을 밀어낸다».
 *
 * ⚠ **그 귀속은 틀렸다** (`claude-v0t-centre-rank.out.txt`): 진짜 중앙의 점수 순위는
 * 전 칸 1\~2위로 상위 3 슬라이스에 늘 든다. 진짜 기전은 **코너 쪽**이었다
 * (120° 링 두 개가 코너 슬라이스를 나눠 가짐 — `claude-v0t-misclassify.md`).
 *
 * 여기서는 수리 뒤 12칸 전부를 다시 재고, 각 칸의 `poseCount.v0t` 를 함께 남긴다
 * (핀 본문이 그 값을 단언하므로 갱신에 그대로 필요하다).
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

function render(layout, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (layout === 'v0ty') opts.qrText = TL_READER_URL;
  return embed960(rasterize(buildSceneY(encoded, opts), {
    pixelsPerUnit: ppu, supersample: 2,
  }));
}

const decodeLab = (frame) => decodeFrontend(frame, {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
});

const TONES = [
  ['clean', {}],
  ['sCurve0.6', { sCurve: 0.6 }],
  ['gamma0.7', { gamma: 0.7 }],
  ['gamma0.6', { gamma: 0.6 }],
];
const ROTATIONS = [0, 120, 240];

for (const layout of ['v0t', 'v0ty']) {
  const base = render(layout, 15);
  let ok = 0;
  console.log(`\n=== ${layout} ===`);
  for (const [label, tone] of TONES) {
    for (const rotation of ROTATIONS) {
      const frame = distortImage(base, { ...tone, rotation, fill: FILL });
      const decoded = decodeLab(frame);
      const detected = detectCellSurfaceBlockShapes(toRelativeLuminance(frame));
      const good = decoded.ok === true && decoded.text === PAYLOAD
        && decoded.hypothesis.cellSurfaceLayout === layout;
      if (good) ok += 1;
      console.log(`  ${label} rot${String(rotation).padStart(3)}`
        + `  ${good ? 'OK ' : '실패'}`
        + `  layout=${decoded.ok ? decoded.hypothesis.cellSurfaceLayout : '-'}`
        + `  reason=${decoded.ok ? '-' : decoded.reason}`
        + `  poseV0t=${detected.diagnostics.poseCount.v0t}`
        + ` v0ty=${detected.diagnostics.poseCount.v0ty}`
        + ` conf=${detected.diagnostics.bullseyeConfirmed.centres}`
        + `/${detected.diagnostics.bullseyeConfirmed.triples}`);
    }
  }
  console.log(`  → ${ok}/12`);
}
