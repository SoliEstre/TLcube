/**
 * claude-v0try-detect.mjs — v0TRY **합성 프레임 검출 실측** (브리프 §4-①ⓕ 의 실물 답).
 *
 * ⓕ 의 이상 표본기(`claude-v0try-crossmatrix.mjs`)는 **자기 계열이 진다** 고 말한다
 * (v0try 프레임 → v0tr 이 뽑힌다, agreement 1.0 동률). 그런데 그 표본기에서는
 * **v0ty 프레임도 v0t 를**, **v0trq 프레임도 v0tr 을** 뽑는다 — 즉 이미 배포된 두
 * 파생에서 똑같이 나는 «부모가 동률 타이브레이크를 이긴다» 구조다 (v0TR 라운드
 * 산출 `claude-v0tr-crossmatrix.out.txt` 에 그대로 찍혀 있다).
 *
 * 그래서 여기서 재는 것은 **실물 래스터가 무엇을 돌려주는가** 다:
 *   ① 레이아웃별 `poseCount` (자기 포즈가 서는가 · 교차로 몇이 서는가)
 *   ② **왕복 복호** — 프레임 → 블록 로케이터 → CS 게이트 → RS → 페이로드,
 *      그리고 **어느 레이아웃 id 로 판정되는가** (§6 판단의 실물 근거)
 *   ③ 편입 전/후 대조 — v0try 패밀리 off ↔ on 의 poseCount·시간
 *   ④ 슬롯 QR 확증 A/B — 확증을 끄면 무엇이 달라지는가
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
import { decodeFrontend } from '../../../src/decoder/frontend.js';
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

function rasterFor(layout, tones = 2, pixelsPerUnit = 15) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones, eccLevel: 'M',
  });
  const sceneOpts = { palette: PALETTE, margin: 4, locatorProfile: 'cell-surface-' + layout };
  if (hasCenterQrSlot(layout)) sceneOpts.qrText = TL_READER_URL;
  const scene = buildSceneY(encoded, sceneOpts);
  return rasterize(scene, { pixelsPerUnit, supersample: 2, fill: FILL });
}

// `cellSurfaceFinal-decode.test.js` 의 `decodeLab` 과 **같은 부트스트랩** 이다
// (lab 경로 — 안정판은 셀 표면을 수용하지 않는다).
function decodeLab(image, extra = undefined) {
  return decodeFrontend(image, {
    bootstrap: {
      family: {
        cube: {
          enableLocatorY: true,
          enableCellSurfaceY: true,
          ...(extra === undefined ? {} : extra),
        },
      },
    },
  });
}

const raster = new Map(LAYOUTS.map((id) => [id, rasterFor(id)]));
const luma = new Map(LAYOUTS.map((id) => [id, toRelativeLuminance(raster.get(id))]));

console.log('활성 n=21 라인업: [%s]', LAYOUTS.join(', '));

console.log('\n=== ① 레이아웃별 poseCount (기본 cfg) ===');
for (const id of LAYOUTS) {
  const out = detectCellSurfaceBlockShapes(luma.get(id), { });
  const pc = out.diagnostics.poseCount;
  const nonzero = Object.entries(pc).filter(([, v]) => v > 0)
    .map(([k, v]) => k + '=' + v).join(' · ');
  console.log('  [%s] %s  (shape %d · slotQr 거절 %d)', id.padEnd(6), nonzero || '(전부 0)',
    out.diagnostics.shapeCount, out.diagnostics.slotQr.rejected);
}

console.log('\n=== ①-b 편입 **전** poseCount (v0tryFamily: false) — 대조군 ===');
for (const id of LAYOUTS) {
  const out = detectCellSurfaceBlockShapes(luma.get(id), {
    calibration: { csBlockLocator: { v0tryFamily: false } },
  });
  const pc = out.diagnostics.poseCount;
  const nonzero = Object.entries(pc).filter(([, v]) => v > 0)
    .map(([k, v]) => k + '=' + v).join(' · ');
  console.log('  [%s] %s  (shape %d · slotQr 거절 %d)', id.padEnd(6), nonzero || '(전부 0)',
    out.diagnostics.shapeCount, out.diagnostics.slotQr.rejected);
}

console.log('\n=== ② 왕복 복호 — **레이아웃 id 까지** (§6 판단의 실물 근거) ===');
console.log('  | 프레임 | 톤 | 복호 | 페이로드 일치 | **판정 레이아웃** | n |');
let mismatches = 0;
for (const id of LAYOUTS) {
  for (const tones of [2, 3]) {
    const image = rasterFor(id, tones);
    let result;
    try {
      result = decodeLab(image);
    } catch (error) {
      console.log('  | %s | %d | ★예외 | — | — | — |  %s', id, tones, error.message);
      mismatches += 1;
      continue;
    }
    const ok = result && result.ok === true;
    const text = ok ? result.text : null;
    const got = (result && result.hypothesis && result.hypothesis.cellSurfaceLayout) || null;
    const matches = got === id;
    if (!ok || text !== PAYLOAD || !matches) mismatches += 1;
    console.log('  | %s | %d | %s | %s | **%s**%s | %s |',
      id.padEnd(6), tones, ok ? 'ok' : '★실패',
      text === PAYLOAD ? 'ok' : '★' + String(text),
      got, matches ? '' : ' ★다르다', result && result.n);
  }
}
console.log('  → 불일치 %d 건 (0 기대 — 하나라도 있으면 §6 탈출구 검토)', mismatches);

console.log('\n=== ③ 편입 전/후 대조 (v0tryFamily off ↔ on) ===');
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
const OFF = { calibration: { csBlockLocator: { v0tryFamily: false } } };
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

console.log('\n=== ④ 슬롯 QR 확증 A/B (v0tryRequireSlotQr) ===');
for (const flag of [true, false]) {
  const row = LAYOUTS.map((id) => {
    const out = detectCellSurfaceBlockShapes(luma.get(id), {
      calibration: { csBlockLocator: { v0tryRequireSlotQr: flag } },
    });
    return id + ':' + out.diagnostics.poseCount.v0try;
  });
  console.log('  확증 %s → v0try 포즈  %s (거절 계수는 slotQr.rejected)',
    flag ? '켬 (기본)' : '끔      ', row.join('  '));
}
