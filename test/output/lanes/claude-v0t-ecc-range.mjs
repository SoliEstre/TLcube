/**
 * claude-v0t-ecc-range.mjs — 증상 ③ 의 성격 판별: 포즈 문제인가 **오류 예산** 문제인가.
 *
 * 단서: 같은 ppu=7 에서 v0TY 는 복호되고 v0T 는 `BODY_RS_FAILED` 로 죽는다.
 * 두 프레임의 셀 **크기**는 같다 — 다른 것은 **data 셀 수**다 (v0T 307 · v0TY 252).
 * 셀당 오류율이 같다면 셀이 많은 쪽이 먼저 RS 예산을 넘긴다. 그렇다면 ③ 은
 * 기하(포즈) 문제가 아니라 **부호화 예산** 문제이고, 손잡이는 이미 있다 — ECC 레벨.
 *
 * 반증 조건: ECC 를 H 로 올려도 같은 ppu 에서 죽으면 예산 가설이 틀린 것이다.
 * 그 경우 다음 용의자는 포즈 정확도이고, 참 포즈 A/B 를 지어야 한다.
 *
 * ⚠ 게이트·문턱은 한 값도 안 건드린다. ECC 레벨은 인코더 선택지이지 게이트가 아니다.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { TL_READER_URL } from '../../../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { embed960 } from './claude-v0w2-leak.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';
const LAB = {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
};

function frameOf(layout, ecc, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: ecc,
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (layout === 'v0ty') opts.qrText = TL_READER_URL;
  return embed960(rasterize(buildSceneY(encoded, opts), {
    pixelsPerUnit: ppu, supersample: 2,
  }));
}

console.log('layout ecc  ppu=9   ppu=8   ppu=7   ppu=6   ppu=5     (OK / 실패사유)');
const rows = [];
for (const layout of ['v0t', 'v0ty']) {
  for (const ecc of ['L', 'M', 'H']) {
    const cells = [];
    for (const ppu of [9, 8, 7, 6, 5]) {
      let mark;
      try {
        const frame = frameOf(layout, ecc, ppu);
        const decoded = decodeFrontend(frame, LAB);
        if (decoded.ok && decoded.text === PAYLOAD
          && decoded.hypothesis.cellSurfaceLayout === layout) {
          mark = 'OK';
        } else if (decoded.ok) {
          mark = '오독:' + decoded.hypothesis.cellSurfaceLayout;
        } else {
          const det = detectCellSurfaceBlockShapes(toRelativeLuminance(frame), {});
          const code = (decoded.detail && decoded.detail.cause
            && decoded.detail.cause.pipelineCode) || decoded.reason.replace('frontend:', '');
          mark = `${code}(p${det.diagnostics.poseCount[layout]})`;
        }
      } catch (error) {
        mark = '★' + (error instanceof Error ? error.message : String(error)).slice(0, 20);
      }
      cells.push(mark.padEnd(7).slice(0, 24));
    }
    const line = `${layout.padEnd(6)} ${ecc}    ${cells.join(' ')}`;
    console.log(line);
    rows.push({ layout, ecc, cells });
  }
}

console.log('\n판독: 같은 layout 에서 ECC 를 올려 더 낮은 ppu 가 초록이 되면'
  + ' ③ 은 **오류 예산** 문제다 (손잡이 = ECC). 안 바뀌면 포즈 정확도를 의심한다.');
