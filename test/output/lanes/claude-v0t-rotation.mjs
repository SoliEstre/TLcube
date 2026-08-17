/**
 * claude-v0t-rotation.mjs — 브리프 ⑥: **남은 비대칭 블록 하나만으로** 회전 3방향
 * (0/120/240)이 실제로 잡히는지 실측.
 *
 * 대상:
 *   · v0T  — 비대칭 이중화 (A 9 + SE 6) 기준선.
 *   · v0TY — 슬롯이 SE 를 삼켜 **A 블록 (L 반전 9셀) 하나만** 남은 실증 대상.
 * 두 층으로 잰다:
 *   ① 이상 표본기 — evaluateCellSurfaceGeometry 에 회전 순환을 넣어 «오방향 거부 ·
 *      정방향 수용» 과 margin 값 자체를 읽는다 (게이트 0.035 는 무접촉).
 *   ② 실물 래스터 — 물리 회전(distortImage rotation)을 준 프레임을 전체 파이프라인
 *      (블록 로케이터 + CS 게이트 + RS)으로 복호하고, 결과 레이아웃이 자기 자신인지
 *      본다. 렌더 조건은 블록 로케이터 스위트와 같다 (ppu 15 · margin 4 · embed 960).
 */
import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { evaluateCellSurfaceGeometry } from '../../../src/decoder/cellSurfaceY-detect.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { TL_READER_URL } from '../../../src/qr.js';
import { hasCenterQrSlot } from '../../../src/cellSurfaceFinal.js';
import { digitToPattern } from '../../../src/tonemap.js';
import { distortImage } from '../../harness/distort.mjs';

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

function renderFrame(layout) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4,
    ...(hasCenterQrSlot(layout) ? { qrText: TL_READER_URL } : {}),
  });
  return { encoded, raster: rasterize(scene, { pixelsPerUnit: 15, supersample: 2 }) };
}
function embed960(raster) {
  const W = 960;
  const out = { width: W, height: W, pixels: new Uint8ClampedArray(W * W * 4) };
  for (let index = 0; index < W * W; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((W - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = 255;
    }
  }
  return out;
}
function idealSampleCellForEncoded(encoded, cycle = ['T', 'L', 'R']) {
  const map = encoded.cellDigits;
  return (i, j) => {
    const entry = map.get(i + ',' + j);
    if (!entry) return { i, j, ok: false };
    if (entry.role === 'slot') return { i, j, ok: false };
    const level = {};
    if (entry.role === 'locator' && entry.tones) {
      for (const face of ['T', 'L', 'R']) level[face] = entry.tones[face];
    } else {
      const pattern = digitToPattern(entry.digit);
      for (const face of ['T', 'L', 'R']) level[face] = pattern[face] ? 2 : 0;
    }
    return {
      i, j, ok: true,
      T: { median: level[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: level[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: level[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

for (const layout of ['v0t', 'v0ty']) {
  const { encoded, raster } = renderFrame(layout);
  const frame = embed960(raster);
  console.log('=== ' + layout + ' (비대칭: ' + (layout === 'v0t' ? 'A 9 + SE 6 (이중화)' : 'A 9 — SE 는 슬롯이 삼킴') + ') ===');

  // ① 이상 표본기 — 정방향 margin + 오방향 2종 거부.
  const canon = evaluateCellSurfaceGeometry(
    { n: 21 }, idealSampleCellForEncoded(encoded), { cellSurfaceLayout: layout },
  );
  console.log('  ① 이상 표본기: 정방향 수용=' + canon.accepted
    + ' · margin=' + canon.scored.orientationMargin.toFixed(4)
    + ' (게이트 0.035 의 ' + (canon.scored.orientationMargin / 0.035).toFixed(2) + 'x)');
  for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
    const wrong = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(encoded, cycle), { cellSurfaceLayout: layout },
    );
    console.log('     오방향 ' + cycle.join('') + ': 수용=' + wrong.accepted + ' (거부가 정답)');
  }

  // ② 실물 래스터 — 물리 회전 3방향 복호.
  for (const rotation of [0, 120, 240]) {
    const distorted = distortImage(frame, { rotation, fill: FILL });
    const decoded = decodeFrontend({
      width: distorted.width, height: distorted.height, pixels: distorted.pixels,
    }, {
      bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
    });
    console.log('  ② rot' + rotation + ': ok=' + decoded.ok
      + (decoded.ok
        ? ' · layout=' + decoded.hypothesis.cellSurfaceLayout
          + ' · 본문 일치=' + (decoded.text === PAYLOAD)
        : ' · reason=' + decoded.reason));
  }
  console.log('');
}
