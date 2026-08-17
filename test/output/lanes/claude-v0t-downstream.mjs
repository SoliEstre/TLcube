/**
 * claude-v0t-downstream.mjs — 링 수리 뒤 남은 두 증상의 하류 회계.
 *
 * 운영자 실기기 (2026-08-17, 시험판 3c2bfa0):
 *   ③ «좀 멀리 있을 때 파인더 다 잡고 **v0T 로 분류해놓고도** 인식 못하는 경우 발생»
 *   ④ «v0TY 는 멀리있을 때는 **v0T 로 분류돼서** 안잡히다가 QR 가시권 들어오면 즉시»
 *   (v0 로 튀는 것은 많이 줄었다 — 링 수리의 표적은 맞았다.)
 *
 * 둘 다 «포즈는 서는데 하류에서 죽는다» 이므로, 여기서는 **CS 평가 층**을 찍는다:
 * 후보 레이아웃별 agreement · orientationMargin · rejectReason 을 나란히 놓는다.
 * 게이트: agreement 0.78 · orientationMargin 0.035 (한 값도 안 건드린다 — 읽기만).
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

function frameOf(layout, ppu) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (layout === 'v0ty') opts.qrText = TL_READER_URL;
  return embed960(rasterize(buildSceneY(encoded, opts), {
    pixelsPerUnit: ppu, supersample: 2,
  }));
}

const LAB = {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
};

/** 진단 트리 어디에 박혀 있든 `layouts` 맵을 찾아 올린다 (구조 추정 금지 — 훑는다). */
function findLayoutMaps(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (node.layouts && typeof node.layouts === 'object' && !Array.isArray(node.layouts)) {
    out.push(node.layouts);
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') findLayoutMaps(value, out, depth + 1);
  }
  return out;
}

for (const layout of ['v0t', 'v0ty']) {
  console.log(`\n══ ${layout} ══`);
  for (const ppu of [9, 8, 7, 6, 5]) {
    const frame = frameOf(layout, ppu);
    const detected = detectCellSurfaceBlockShapes(toRelativeLuminance(frame), {});
    const decoded = decodeFrontend(frame, LAB);
    const pc = detected.diagnostics.poseCount;
    const head = `ppu=${ppu}  pose v0t=${pc.v0t} v0ty=${pc.v0ty} v0=${pc.v0}`;
    if (decoded.ok) {
      console.log(`${head}  → OK ${decoded.hypothesis.cellSurfaceLayout}/n${decoded.hypothesis.n}`
        + (decoded.text === PAYLOAD ? '' : '  ★텍스트 불일치'));
      continue;
    }
    console.log(`${head}  → 실패 ${decoded.reason}`);
    const maps = findLayoutMaps(decoded.detail || {});
    if (!maps.length) {
      console.log('     (CS 평가 진단이 실패 detail 에 안 실림 — 상류에서 끊긴 것)');
      const d = decoded.detail || {};
      console.log('     stage=' + (d.stage || '?') + ' cause=' + JSON.stringify(d.cause || null).slice(0, 160));
      continue;
    }
    const seen = new Set();
    for (const map of maps) {
      const key = JSON.stringify(Object.keys(map).sort());
      if (seen.has(key + JSON.stringify(map))) continue;
      seen.add(key + JSON.stringify(map));
      for (const [id, v] of Object.entries(map)) {
        console.log(`     ${id.padEnd(5)} accepted=${v.accepted}`
          + ` agreement=${v.agreement === undefined ? '-' : Number(v.agreement).toFixed(4)}`
          + ` margin=${v.orientationMargin === undefined ? '-' : Number(v.orientationMargin).toFixed(4)}`
          + ` reject=${v.rejectReason || '-'}`
          + ` obs/erased=${v.observedLocatorCells}/${v.erasedLocatorCells}`);
      }
    }
  }
}
