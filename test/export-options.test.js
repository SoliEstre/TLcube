/**
 * export-options.test.js — 내보내기 옵션 4종 (2026-08-19 운영자 지시) 의 계약.
 *
 * 잠그는 것:
 *   1. **상태 기본값 → 해석 → 파이프라인 → 복호** 의 전 사슬. 첫 입력이 손으로 적은
 *      옵션이 아니라 `createGeneratorState()` **프로덕션 기본값**이다 — 테스트가 손으로
 *      적은 옵션에서 출발하면 배선을 안 잠근다 (.agent/_lessons/009, 2026-08-19 실사고).
 *   2. 자동 규칙 — ④ 입체감 자동(인쇄용→약 · 조합표), ③ ppi(갈래 기본 144/300), ① 크기
 *      (자동 3종 = 실측 하한 × 배율 {1, 1.5, 2.5} · 고정/커스텀 contain).
 *   3. 실측 표 — MIN_ROUNDTRIP_PPU · DITHER_AUTO_COMBO · EXPORT_TRIM_MARGINS 의 값.
 *      근거: test/output/lanes/export-options-report.md §2 (값을 바꾸려면 먼저 재라).
 *   4. 픽셀 층 — dither(결정성·채널 격자·불변 입력), png pHYs(옵션 부재 = 바이트 동일),
 *      svg 캔버스 속성, contain 패딩.
 *   5. UI 배선 — index.html 이 프로덕션 함수(exportPlanFor → renderExportPng/Svg)를
 *      실제로 타는지, trim 이 margin 0 이 아니라 최소 안전 margin 을 쓰는지.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createGeneratorState } from '../src/generator-state.js';
import {
  AUTO_SIZE_MULTIPLIERS,
  DEFAULT_EXPORT_MARGIN,
  DEFAULT_EXPORT_SIZE,
  DITHER_AUTO_COMBO,
  EXPORT_SIZE_AUTO_FIT,
  EXPORT_SIZE_AUTO_HIGH,
  EXPORT_SIZE_AUTO_MIN,
  EXPORT_MIN_COMFORT_PRINT_MM,
  EXPORT_PPI_DETAIL_CHOICES,
  EXPORT_SIZE_CHOICES,
  EXPORT_TRIM_MARGINS,
  MIN_ROUNDTRIP_PPU,
  PRINT_PPI_TIERS,
  exportPhysicalWidthMm,
  minRoundtripPpuKey,
  minRoundtripPpu,
  ppuForPpi,
  resolveExportPpi,
  resolveExportSize,
  resolveRenderProfile,
  trimExportMargin,
} from '../src/export-options.js';
import {
  RENDER_PROFILE_AUTO, RENDER_PROFILE_FACE_GAINS, RENDER_PROFILE_PRINT,
  RENDER_PROFILE_SCREEN, RENDER_PROFILE_SOFT,
} from '../src/render-profile.js';
import { DITHER_BIT_DEPTHS, quantizeDitherRaster } from '../src/dither.js';
import {
  buildTrimmedScene, padRasterToCanvas, renderExportPng, renderExportSvg,
} from '../src/export-render.js';
import { rasterize } from '../src/raster.js';
import { rasterToPng } from '../src/png.js';
import { sceneToSvg } from '../src/svg.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeY } from '../src/encodeY.js';
import { buildScene } from '../src/scene.js';
import { buildSceneY } from '../src/sceneY.js';
import { sceneOptionsForOA } from '../src/generator-render-config.js';
import { addQuietZone } from '../src/quietzone.js';
import { TL_READER_URL } from '../src/qr.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX_SOURCE = readFileSync(ROOT + 'index.html', 'utf8');
const PRESET = getPreset(DEFAULT_PRESET);

/** 상태의 «자동» 선택을 export-options 가 받는 모양으로 — index.html exportDitherBits 와 동형. */
function ditherBitsOf(state) {
  return state.exportDither === 'auto' ? null : state.exportDither;
}

function paletteFor(profile) {
  return {
    background: PRESET.background,
    levels: PRESET.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    faceGains: RENDER_PROFILE_FACE_GAINS[profile],
  };
}

// ── 1. 상태 기본값 → 해석 → 파이프라인 → 복호 (프로덕션 첫 입력) ────────────────

test('상태 기본값에서 출발한 내보내기 계획이 왕복 복호된다 (PNG 파이프라인)', { timeout: 300_000 }, () => {
  const state = createGeneratorState();
  assert.equal(state.exportSize, DEFAULT_EXPORT_SIZE);
  assert.equal(state.exportMargin, DEFAULT_EXPORT_MARGIN);

  // ④ 자동은 기본 문맥(화면용 · 디더링 없음)에서 «중» 으로 풀린다 — 픽셀 불변 계약.
  const profile = resolveRenderProfile(state.renderProfile, {
    printPurpose: state.exportPpi === 'print',
    ditherBits: ditherBitsOf(state),
  });
  assert.equal(profile, RENDER_PROFILE_SCREEN);

  const text = 'export-options-roundtrip';
  const encoded = encodeY(text, {
    version: 1, tones: 3, eccLevel: 'M', cellSurface: true, cellSurfaceLayout: 'v0t',
  });
  const scene = buildSceneY(encoded, {
    palette: paletteFor(profile), cellSize: 1, margin: 3, cornerQr: false,
  });
  const minPpu = minRoundtripPpu({
    type: 'Y', version: encoded.version, n: encoded.n,
    cellSurfaceLayout: encoded.cellSurfaceLayout || null,
    ditherBits: ditherBitsOf(state),
  });
  assert.equal(minPpu, 7, 'Y:v0t n=21 실측 하한이 표와 다르다 — 바꿨다면 §2.3 을 다시 쟀는가');
  const size = resolveExportSize({
    mode: state.exportSize,
    customWidth: state.exportWidth, customHeight: state.exportHeight,
    sceneWidth: scene.width, sceneHeight: scene.height, minPpu,
  });
  // 자동(최적용량) = 하한 × 1.5, 정사각.
  assert.equal(size.ppu, minPpu * AUTO_SIZE_MULTIPLIERS[EXPORT_SIZE_AUTO_FIT]);
  assert.equal(size.width, size.height);
  assert.equal(size.width, Math.ceil(Math.max(scene.width, scene.height) * size.ppu));

  // 픽셀 파이프라인 그대로 (rasterize → contain 패딩) → 복호. PNG 직렬화 전 단계의
  // 픽셀이 복호 입력과 동일하다는 것이 raster/png 분리 설계의 계약이다.
  const padded = padRasterToCanvas(
    rasterize(scene, { pixelsPerUnit: size.ppu, supersample: 2 }),
    size.width, size.height, scene.background,
  );
  const result = decodeFrontend(padded);
  assert.equal(result.ok, true, JSON.stringify(result.reason || result));
  assert.equal(result.text, text);

  // 같은 계획의 PNG 바이트 — 시그니처 + pHYs(화면용 기본 144) 존재.
  const ppi = resolveExportPpi({
    purpose: state.exportPpi, detail: state.exportPpiDetail, ditherBits: ditherBitsOf(state),
  });
  assert.equal(ppi, 144, '화면용 기본값은 2x(레티나) 144 다');
  const png = renderExportPng(scene, { ...size, ditherBits: ditherBitsOf(state), ppi });
  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(pngChunkTypes(png).includes('pHYs'), 'ppi 를 줬는데 pHYs 청크가 없다');
});

test('16비트 디더링을 끼워도 같은 사슬이 왕복 복호된다 (§2.2 실측의 회귀 대표)', { timeout: 300_000 }, () => {
  const state = createGeneratorState();
  state.exportDither = 16;
  const text = 'dither-16bit';
  const encoded = encodeY(text, {
    version: 1, tones: 3, eccLevel: 'M', cellSurface: true, cellSurfaceLayout: 'v0t',
  });
  const profile = resolveRenderProfile(state.renderProfile, {
    printPurpose: false, ditherBits: ditherBitsOf(state),
  });
  assert.equal(profile, RENDER_PROFILE_SCREEN, '16비트 조합표는 프로파일을 안 바꾼다 (§2.2)');
  const scene = buildSceneY(encoded, {
    palette: paletteFor(profile), cellSize: 1, margin: 3, cornerQr: false,
  });
  const ppu = ppuForPpi(96); // §2.2 실측 격자의 안전 하한 ppi
  const raster = quantizeDitherRaster(
    rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }), 16,
  );
  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, JSON.stringify(result.reason || result));
  assert.equal(result.text, text);
});

// ── 2. 자동 규칙 ──────────────────────────────────────────────────────────────

test('④ 자동 규칙 — 인쇄용→약 · 조합표(2비트→평면, 4비트→약) · 명시 선택 존중', () => {
  // 인쇄용이면 약 (§1.1/§1.2).
  assert.equal(resolveRenderProfile(RENDER_PROFILE_AUTO, { printPurpose: true }),
    RENDER_PROFILE_SOFT);
  // 그 외는 중.
  assert.equal(resolveRenderProfile(RENDER_PROFILE_AUTO, {}), RENDER_PROFILE_SCREEN);
  // 조합표가 정의한 비트깊이는 조합표가 이긴다 (§1.3 — 측정으로 확정한 값).
  assert.equal(resolveRenderProfile(RENDER_PROFILE_AUTO, { ditherBits: 2 }),
    RENDER_PROFILE_PRINT, '2비트: screen/soft 는 3톤 전멸 실측 — print 강제 (§2.2)');
  assert.equal(resolveRenderProfile(RENDER_PROFILE_AUTO, { printPurpose: true, ditherBits: 2 }),
    RENDER_PROFILE_PRINT);
  assert.equal(resolveRenderProfile(RENDER_PROFILE_AUTO, { ditherBits: 4 }),
    RENDER_PROFILE_SOFT);
  // 자동이 아니면 말없이 덮어쓰지 않는다 (§1.2 — 사용자 선택 존중).
  assert.equal(resolveRenderProfile(RENDER_PROFILE_SCREEN, { printPurpose: true, ditherBits: 2 }),
    RENDER_PROFILE_SCREEN);
  assert.throws(() => resolveRenderProfile('poster', {}), RangeError);
});

test('③ ppi 해석 — 세부 숫자 우선 · 자동은 갈래 기본값 144/300', () => {
  assert.equal(resolveExportPpi({ purpose: 'screen' }), 144);
  assert.equal(resolveExportPpi({ purpose: 'print' }), 300);
  assert.equal(resolveExportPpi({ purpose: 'screen', detail: 72 }), 72);
  assert.equal(resolveExportPpi({ purpose: 'print', detail: 600 }), 600);
  // 조합표의 ppi 축이 전부 null(§2.2 — 96 부터 전 비트깊이 안전, 기본 144 는 이미 위)
  // 이므로 디더링이 있어도 갈래 기본값 그대로다.
  assert.equal(resolveExportPpi({ purpose: 'screen', ditherBits: 2 }), 144);
  assert.throws(() => resolveExportPpi({ purpose: 'poster' }), RangeError);
  assert.throws(() => resolveExportPpi({ purpose: 'screen', detail: 100 }), RangeError);
});

test('③ 인쇄용 4배 1200 ppi (운영자 추가 2026-08-19 후속) — 라인업·해석·UI·기본값 불변', () => {
  // 인쇄용 라인업은 일반-1.5배-2배-4배 순서 그대로다. 1200 을 빼면 이 단언이 빨개진다.
  assert.deepEqual([...PRINT_PPI_TIERS], [300, 450, 600, 1200],
    '인쇄용 세부 라인업이 운영자 지정(일반/1.5배/2배/4배)과 다르다');
  assert.ok(EXPORT_PPI_DETAIL_CHOICES.includes(1200), '세부 선택지에 1200 이 없다');
  assert.equal(resolveExportPpi({ purpose: 'print', detail: 1200 }), 1200);
  // 기본값은 여전히 «일반 300» 이다 — 4배 추가가 기본을 끌어올리면 안 된다.
  assert.equal(resolveExportPpi({ purpose: 'print' }), 300);
  // pHYs 환산: 1200 ppi = 47244 ppm (round(1200 × 1000 / 25.4) — 표준 환산).
  const raster = { width: 2, height: 1, pixels: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
  const png = rasterToPng(raster, { ppi: 1200 });
  const at = png.indexOf(0x70); // IHDR(25B) 직후 첫 'p' = pHYs
  const ppm = (png[at + 4] << 24 | png[at + 5] << 16 | png[at + 6] << 8 | png[at + 7]) >>> 0;
  assert.equal(ppm, 47244, '1200ppi 의 ppm 환산이 틀렸다');
  // UI 에 옵션이 실재하고 8언어 키(g749)를 단다 — 사전 충전은 i18n-coverage 가 잰다.
  assert.match(INDEX_SOURCE, /<option value="1200" data-i18n="g749">/,
    '고급 세부 select 에 1200 옵션이 없다');
});

test('① 크기 해석 — 자동 3종 배율 · 고정 정사각 contain · 커스텀 검증', () => {
  const base = { sceneWidth: 30, sceneHeight: 26, minPpu: 8 };
  const min = resolveExportSize({ mode: EXPORT_SIZE_AUTO_MIN, ...base });
  const fit = resolveExportSize({ mode: EXPORT_SIZE_AUTO_FIT, ...base });
  const high = resolveExportSize({ mode: EXPORT_SIZE_AUTO_HIGH, ...base });
  assert.equal(min.ppu, 8);
  assert.equal(fit.ppu, 12);
  assert.equal(high.ppu, 20);
  for (const s of [min, fit, high]) assert.equal(s.width, s.height, '자동도 정사각이다');
  assert.equal(min.width, Math.ceil(30 * 8));

  const fixed = resolveExportSize({ mode: 512, ...base });
  assert.deepEqual(fixed, { width: 512, height: 512, ppu: 512 / 30 });

  const custom = resolveExportSize({
    mode: 'custom', customWidth: 640, customHeight: 480, ...base,
  });
  assert.equal(custom.width, 640);
  assert.equal(custom.height, 480);
  assert.equal(custom.ppu, Math.min(640 / 30, 480 / 26), '커스텀은 contain — 작은 변이 이긴다');

  assert.throws(() => resolveExportSize({ mode: 'custom', customWidth: 8, customHeight: 480, ...base }), RangeError);
  assert.throws(() => resolveExportSize({ mode: 'huge', ...base }), RangeError);
  assert.throws(() => resolveExportSize({ mode: EXPORT_SIZE_AUTO_MIN, sceneWidth: 30, sceneHeight: 26, minPpu: 0 }), RangeError);
  // 선택지 목록 자체 — 운영자 지정 9종 (§1.4).
  assert.deepEqual([...EXPORT_SIZE_CHOICES],
    ['auto-min', 'auto-fit', 'auto-high', 192, 512, 1024, 2048, 4096, 'custom']);
});

// ── 3. 실측 표 ────────────────────────────────────────────────────────────────

test('실측 하한표 — 조합별 값과 «양자화가 하한을 안 내린다» 성질 (§2.3·§2.2)', () => {
  assert.deepEqual({ ...MIN_ROUNDTRIP_PPU }, {
    'O:1': 8.5, 'O:2': 8.5, 'O:3': 8,
    'A:0': 9, 'A:1': 9, 'A:2': 8.5,
    'Y:v0:13': 7.5,
    'Y:v0t:21': 7, 'Y:v0t:25': 7,
    'Y:v0ty:21': 7, 'Y:v0ty:25': 7,
  }, '하한표가 실측과 다르다 — 바꿨다면 §2.3 을 다시 쟀는가');
  assert.equal(minRoundtripPpu({ type: 'O', version: 2 }), 8.5);
  assert.equal(minRoundtripPpuKey({
    type: 'Y', version: 0, n: 13, cellSurfaceLayout: 'v0',
  }), 'Y:v0:13');
  assert.equal(minRoundtripPpuKey({
    type: 'Y', version: 1, n: 21, cellSurfaceLayout: 'v0t',
  }), 'Y:v0t:21');
  assert.equal(minRoundtripPpuKey({
    type: 'Y', version: 2, n: 25, cellSurfaceLayout: 'v0t',
  }), 'Y:v0t:25');
  assert.equal(minRoundtripPpu({
    type: 'Y', version: 0, n: 13, cellSurfaceLayout: 'v0',
  }), 7.5);
  assert.equal(minRoundtripPpu({
    type: 'Y', version: 1, n: 21, cellSurfaceLayout: 'v0t',
  }), 7);
  assert.equal(minRoundtripPpu({
    type: 'Y', version: 2, n: 25, cellSurfaceLayout: 'v0t',
  }), 7);
  assert.equal(minRoundtripPpu({
    type: 'Y', version: 1, n: 21, cellSurfaceLayout: 'v0ty',
  }), 7);
  assert.equal(minRoundtripPpu({
    type: 'Y', version: 2, n: 25, cellSurfaceLayout: 'v0ty',
  }), 7);
  // 표에 없는 조합은 보수적 폴백 — 실측 최댓값(9) 이상이어야 한다.
  assert.ok(minRoundtripPpu({ type: 'Y', version: 1 }) >= 9);
  for (const bits of DITHER_BIT_DEPTHS) {
    assert.ok(minRoundtripPpu({
      type: 'Y', version: 1, n: 21, cellSurfaceLayout: 'v0t', ditherBits: bits,
    }) >= 7);
  }
});

test('실측 조합표 — 프로파일 + 크기 하한(minPpi) + pHYs 비오염 (§2.2·§10)', () => {
  // ⚠ **의도적 갱신 (수리 §10 — 감사 F2)**: minPpi 필드 신설. 저밀도(자동 크기의
  //   ppu 7.5\~11.25)에서 2·4비트가 죽는데 조합표가 하한을 안 실어 «자동인데 복호
  //   불가 PNG» 가 나왔다. 2비트는 ppu 비단조 실패(12 는 서고 14·16·20 에서 죽는
  //   디더 aliasing)라 자동 3종 착지점(24/36/60·16/24/40)을 전수 재검증한 값이다.
  assert.deepEqual(DITHER_AUTO_COMBO[2], { ppi: null, profile: RENDER_PROFILE_PRINT, minPpi: 72 });
  assert.deepEqual(DITHER_AUTO_COMBO[4], { ppi: null, profile: RENDER_PROFILE_SOFT, minPpi: 48 });
  assert.deepEqual(DITHER_AUTO_COMBO[8], { ppi: null, profile: null, minPpi: null });
  assert.deepEqual(DITHER_AUTO_COMBO[16], { ppi: null, profile: null, minPpi: null });
  // 하한이 minRoundtripPpu 에 실제로 실린다 (ppuForPpi 환산 — 배관 확인).
  assert.equal(minRoundtripPpu({ type: 'Y', version: 1, n: 21, cellSurfaceLayout: 'v0t', ditherBits: 2 }),
    ppuForPpi(72));
  assert.equal(minRoundtripPpu({ type: 'Y', version: 1, n: 21, cellSurfaceLayout: 'v0t', ditherBits: 4 }),
    ppuForPpi(48));
  // 그리고 pHYs 메타데이터는 **오염되지 않는다** — minPpi 는 렌더 밀도 하한이지 밀도
  // 선언이 아니다 (필드 분리의 이유 — 감사의 «값만 편집» 판단에 대한 정정).
  assert.equal(resolveExportPpi({ purpose: 'screen', ditherBits: 2 }), 144);
});

test('§10 감사 격자 회귀 — 2비트 + 자동(하한 최저)가 복호 가능한 PNG 를 낸다 (0/12 였다)', {
  timeout: 300_000,
}, () => {
  // 감사의 킬러 행을 프로덕션 체인 그대로 잠근다: 자동 입체감 해석(2비트→평면) →
  // 하한(minPpi 72 ≙ ppu 24) → 자동(하한 최저) 크기 → 래스터 → 양자화 → 복호.
  for (const [bits, tones] of [[2, 3], [2, 2], [4, 3]]) {
    const text = 'dither-floor-' + bits + '-' + tones;
    const profile = resolveRenderProfile(RENDER_PROFILE_AUTO, { ditherBits: bits });
    const encoded = encodeY(text, {
      version: 1, tones, eccLevel: 'M', cellSurface: true, cellSurfaceLayout: 'v0t',
    });
    const scene = buildSceneY(encoded, {
      palette: paletteFor(profile), cellSize: 1, margin: 3, cornerQr: false,
    });
    const size = resolveExportSize({
      mode: 'auto-min', sceneWidth: scene.width, sceneHeight: scene.height,
      minPpu: minRoundtripPpu({
        type: 'Y', version: 1, n: encoded.n, cellSurfaceLayout: 'v0t', ditherBits: bits,
      }),
    });
    const padded = padRasterToCanvas(
      quantizeDitherRaster(rasterize(scene, { pixelsPerUnit: size.ppu, supersample: 2 }), bits),
      size.width, size.height, scene.background,
    );
    const result = decodeFrontend(padded);
    const where = bits + 'bit ' + tones + '톤 auto-min';
    assert.equal(result.ok, true, where + ': ' + JSON.stringify(result.reason));
    assert.equal(result.text, text, where);
  }
});

test('여백 없음 = 타입(·A 버전)별 최소 안전 margin — 0 이 아니다 (§2.4·§9 실측)', () => {
  assert.deepEqual({ O: EXPORT_TRIM_MARGINS.O, Y: EXPORT_TRIM_MARGINS.Y }, { O: 2, Y: 1 });
  // A 는 버전 의존 — 일률 10 은 A1/A2 를 렌더 불능으로 만들었다 (감사 F 수리, §9).
  assert.deepEqual({ ...EXPORT_TRIM_MARGINS.A }, { 0: 10, 1: 13, 2: 17 });
  assert.equal(trimExportMargin('Y'), 1);
  assert.equal(trimExportMargin('A', { version: 2 }), 17);
  // 코너 QR 구성은 QR 블록(기능 요소)이 여백에 살아 20 미만으로 못 깎는다 (§9 실측 —
  // 전 타입 공통 빌드 최소 20).
  assert.equal(trimExportMargin('Y', { cornerQr: true }), 20);
  assert.equal(trimExportMargin('A', { version: 0, cornerQr: true }), 20);
  assert.throws(() => trimExportMargin('Q'), RangeError);
  assert.throws(() => trimExportMargin('A'), RangeError, 'A 는 버전 없이 못 푼다');
});

// ── 4. 픽셀 층 ────────────────────────────────────────────────────────────────

function tinyRaster() {
  // 4×2 그라데이션 — 채널 격자 검증에 충분한 최소 입력.
  const pixels = new Uint8ClampedArray([
    10, 200, 30, 255, 60, 61, 62, 255, 130, 128, 126, 255, 250, 251, 252, 255,
    0, 0, 0, 255, 255, 255, 255, 255, 17, 34, 51, 128, 68, 85, 102, 0,
  ]);
  return { width: 4, height: 2, pixels };
}

test('dither — 결정성 · 24비트 항등 · 입력 불변 · 알파 보존', () => {
  const input = tinyRaster();
  const before = [...input.pixels];
  const once = quantizeDitherRaster(input, 8);
  const twice = quantizeDitherRaster(input, 8);
  assert.deepEqual([...once.pixels], [...twice.pixels], '같은 입력이 다른 바이트를 냈다');
  assert.deepEqual([...input.pixels], before, '입력 래스터가 오염됐다');
  const identity = quantizeDitherRaster(input, 24);
  assert.notEqual(identity.pixels, input.pixels, '항등도 새 버퍼를 돌려준다 (순수 함수)');
  assert.deepEqual([...identity.pixels], before);
  for (let i = 3; i < once.pixels.length; i += 4) {
    assert.equal(once.pixels[i], input.pixels[i], '알파가 바뀌었다');
  }
  assert.throws(() => quantizeDitherRaster(input, 12), RangeError);
});

test('dither — 채널 격자 (16=RGB565 · 2=휘도 4계조 그레이스케일)', () => {
  const q16 = quantizeDitherRaster(tinyRaster(), 16);
  const grid = (bits) => new Set(
    Array.from({ length: 1 << bits }, (_, i) => Math.round((i * 255) / ((1 << bits) - 1))),
  );
  const [r5, g6, b5] = [grid(5), grid(6), grid(5)];
  for (let i = 0; i < q16.pixels.length; i += 4) {
    assert.ok(r5.has(q16.pixels[i]), 'R 이 5비트 격자 밖이다: ' + q16.pixels[i]);
    assert.ok(g6.has(q16.pixels[i + 1]), 'G 가 6비트 격자 밖이다: ' + q16.pixels[i + 1]);
    assert.ok(b5.has(q16.pixels[i + 2]), 'B 가 5비트 격자 밖이다: ' + q16.pixels[i + 2]);
  }
  const q2 = quantizeDitherRaster(tinyRaster(), 2);
  const gray4 = new Set([0, 85, 170, 255]);
  for (let i = 0; i < q2.pixels.length; i += 4) {
    assert.equal(q2.pixels[i], q2.pixels[i + 1], '2비트는 그레이스케일이어야 한다');
    assert.equal(q2.pixels[i + 1], q2.pixels[i + 2]);
    assert.ok(gray4.has(q2.pixels[i]), '휘도 4계조 밖이다: ' + q2.pixels[i]);
  }
});

/** PNG 바이트 → 청크 타입 나열 (검증용 최소 파서). */
function pngChunkTypes(bytes) {
  const types = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;
    types.push(String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]));
    at += 12 + len;
  }
  return types;
}

test('png pHYs — 옵션 부재 = 종전 바이트 동일 · 300ppi = 11811 ppm (§1.2)', () => {
  const raster = rasterize(
    buildSceneY(
      encodeY('phys', { version: 0, tones: 3, eccLevel: 'M', cellSurface: true, cellSurfaceLayout: 'v0' }),
      { palette: paletteFor(RENDER_PROFILE_SCREEN), cellSize: 1, margin: 3, cornerQr: false },
    ),
    { pixelsPerUnit: 8, supersample: 2 },
  );
  const plain = rasterToPng(raster);
  assert.deepEqual([...rasterToPng(raster, {})], [...plain], '빈 옵션이 바이트를 바꿨다');
  assert.ok(!pngChunkTypes(plain).includes('pHYs'), '옵션 없이 pHYs 가 생겼다 — 결정성 핀 위반');

  const withPpi = rasterToPng(raster, { ppi: 300 });
  const types = pngChunkTypes(withPpi);
  assert.deepEqual(types, ['IHDR', 'pHYs', 'IDAT', 'IEND'], 'pHYs 는 IHDR 뒤·IDAT 앞이어야 한다');
  const at = withPpi.indexOf(0x70); // 'p' — IHDR(25B) 직후라 첫 후보가 pHYs 다
  const data = withPpi.slice(at + 4, at + 13);
  const ppm = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0;
  assert.equal(ppm, 11811, '300ppi 의 표준 ppm 환산값이 아니다');
  assert.equal(data[8], 1, 'pHYs 단위는 미터여야 한다');
  assert.throws(() => rasterToPng(raster, { ppi: 0 }), RangeError);
});

test('svg 캔버스 속성 — widthPx/heightPx 는 함께, viewBox 는 불변 (§1.4 SVG 반영)', () => {
  const scene = buildSceneY(
    encodeY('svg-canvas', { version: 0, tones: 3, eccLevel: 'M', cellSurface: true, cellSurfaceLayout: 'v0' }),
    { palette: paletteFor(RENDER_PROFILE_SCREEN), cellSize: 1, margin: 3, cornerQr: false },
  );
  const plain = sceneToSvg(scene);
  const sized = renderExportSvg(scene, { width: 1024, height: 1024 });
  assert.match(sized, /^<svg xmlns="[^"]+" width="1024" height="1024" viewBox="0 0 /);
  // 캔버스 속성 외에는 바이트 동일 — 좌표계(viewBox)가 흔들리면 무손실 확대 계약이 깨진다.
  assert.equal(sized.replace(/width="1024" height="1024"/, plain.match(/width="\d+" height="\d+"/)[0]), plain);
  assert.throws(() => sceneToSvg(scene, { widthPx: 100 }), RangeError);
});

test('contain 패딩 — 가운데 배치 · 동일 크기는 그대로 · 초과는 던진다', () => {
  const raster = tinyRaster();
  assert.equal(padRasterToCanvas(raster, 4, 2, null), raster, '동일 크기는 입력 그대로여야 한다');
  const padded = padRasterToCanvas(raster, 8, 6, { r: 9, g: 8, b: 7 });
  assert.equal(padded.width, 8);
  assert.equal(padded.height, 6);
  // 원본 (0,0)=[10,200,30] 이 (2,2) 로 — floor((8-4)/2)=2, floor((6-2)/2)=2.
  const at = (2 * 8 + 2) * 4;
  assert.deepEqual([...padded.pixels.slice(at, at + 3)], [10, 200, 30]);
  assert.deepEqual([...padded.pixels.slice(0, 4)], [9, 8, 7, 255], '패딩 색이 배경색이 아니다');
  const transparent = padRasterToCanvas(raster, 8, 6, null);
  assert.equal(transparent.pixels[3], 0, '투명 배경 패딩은 alpha 0 이어야 한다');
  assert.throws(() => padRasterToCanvas(raster, 2, 2, null), RangeError);
});

// ── 4.5 «여백 없음» 조합 실행 (통합 감사 §9 수리 회귀) ─────────────────────────
//
// 감사 지적: 종전 이 파일은 상수·정규식만 잠갔고 코너QR / A1–A2 / 배경 합성 **조합**을
// 실행하지 않았다 — 그래서 A1/A2 trim 렌더 불능이 초록 사이로 통과했다. 여기서는
// 실제 scene 빌드 → 래스터 → 복호를 돈다.

const WHITE_BG = Object.freeze({ r: 255, g: 255, b: 255 });
function oaPalette(bg) {
  return {
    background: bg, levels: PRESET.levels,
    bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
  };
}
function compositeOn(raster, gray, pad = 64) {
  const W = raster.width + pad * 2;
  const H = raster.height + pad * 2;
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = gray;
    px[i * 4 + 3] = 255;
  }
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + pad) * W + (x + pad)) * 4;
      const a = raster.pixels[s + 3] / 255;
      px[d] = Math.round(raster.pixels[s] * a + px[d] * (1 - a));
      px[d + 1] = Math.round(raster.pixels[s + 1] * a + px[d + 1] * (1 - a));
      px[d + 2] = Math.round(raster.pixels[s + 2] * a + px[d + 2] * (1 - a));
      px[d + 3] = 255;
    }
  }
  return { width: W, height: H, pixels: px };
}
function exportRasterOf(scene, type, encoded) {
  const size = resolveExportSize({
    mode: 'auto-fit', sceneWidth: scene.width, sceneHeight: scene.height,
    minPpu: minRoundtripPpu({
      type, version: encoded.version, n: encoded.n,
      cellSurfaceLayout: encoded.cellSurfaceLayout || null,
    }),
  });
  return padRasterToCanvas(
    rasterize(scene, { pixelsPerUnit: size.ppu, supersample: 2 }),
    size.width, size.height, scene.background,
  );
}

test('A 전 버전 × 중앙/코너QR × 여백없음 — 빌드 성공 + 직접 복호 (일률 margin 10 회귀 방지)', {
  timeout: 300_000,
}, () => {
  const text = 'https://tl.estre.so';
  for (const version of [0, 1, 2]) {
    for (const fallback of [{ mode: 'center' }, { mode: 'corner', corner: 'TL' }]) {
      const encoded = encodeA(text, { version, eccLevel: 'M', centerQr: fallback.mode === 'center' });
      const sceneOpts = sceneOptionsForOA({
        fallback, finderPatternId: 'bullseye', palette: oaPalette(WHITE_BG),
        qrText: TL_READER_URL, type: 'A',
      });
      const cornerQr = sceneOpts.qrCorner !== undefined;
      const where = `A${version} ${cornerQr ? '코너' : '중앙'}QR`;
      // 여기서 던지면 사용자가 «여백 없음» 을 켠 순간 내부 에러를 본다 — 그 결함이었다.
      const trimmed = buildTrimmedScene(
        buildScene, encoded, sceneOpts,
        trimExportMargin('A', { version, cornerQr }),
      );
      // 시작값 표가 빌드 경계를 실제로 덮는다 — 에스컬레이션은 안전망이지 정상 경로가 아니다.
      assert.equal(trimmed.margin, trimExportMargin('A', { version, cornerQr }),
        where + ': 시작 margin 에서 빌드가 안 섰다 — §9 실측 표가 낡았다');
      const result = decodeFrontend(exportRasterOf(trimmed.scene, 'A', encoded));
      assert.equal(result.ok, true, where + ': ' + JSON.stringify(result.reason));
      assert.equal(result.text, text, where);
    }
  }
});

test('A2 여백없음은 어두운 배경 합성에서도 산다 — margin 17 의 근거 (16 은 죽었다)', {
  timeout: 300_000,
}, () => {
  const text = 'https://tl.estre.so';
  const encoded = encodeA(text, { version: 2, eccLevel: 'M', centerQr: true });
  const sceneOpts = sceneOptionsForOA({
    fallback: { mode: 'center' }, finderPatternId: 'bullseye', palette: oaPalette(WHITE_BG),
    qrText: TL_READER_URL, type: 'A',
  });
  const trimmed = buildTrimmedScene(buildScene, encoded, sceneOpts, trimExportMargin('A', { version: 2 }));
  const result = decodeFrontend(compositeOn(exportRasterOf(trimmed.scene, 'A', encoded), 64));
  assert.equal(result.ok, true, 'A2 trim 이 어두운 배경 합성에서 죽었다: ' + JSON.stringify(result.reason));
  assert.equal(result.text, text);
});

test('Y 기본 구성(코너 QR) + 여백없음 — QR 이 기능 요소라 margin 20 에서 성립·복호된다', {
  timeout: 300_000,
}, () => {
  const text = 'https://tl.estre.so';
  const encoded = encodeY(text, {
    version: 1, tones: 3, eccLevel: 'M', cellSurface: true, cellSurfaceLayout: 'v0t',
  });
  const sceneOpts = {
    palette: { ...paletteFor(RENDER_PROFILE_SCREEN), background: WHITE_BG },
    qrText: TL_READER_URL, qrCorner: 'TL',
  };
  const trimmed = buildTrimmedScene(
    buildSceneY, encoded, sceneOpts,
    trimExportMargin('Y', { cornerQr: true }),
  );
  assert.equal(trimmed.margin, 20, 'Y 코너QR 의 빌드 최소(§9 실측 20)가 움직였다 — 다시 재라');
  const result = decodeFrontend(exportRasterOf(trimmed.scene, 'Y', encoded));
  assert.equal(result.ok, true, JSON.stringify(result.reason));
  assert.equal(result.text, text);
});

test('O 투명 배경 + 여백없음 — 안전영역 링 재적용이 복호를 살린다 (링 없으면 죽는다)', {
  timeout: 300_000,
}, () => {
  const text = 'tl.estre.so';
  const encoded = encode(text, { version: 2, eccLevel: 'M' });
  const sceneOpts = sceneOptionsForOA({
    fallback: { mode: 'none' }, finderPatternId: 'bullseye', palette: oaPalette(null),
    qrText: TL_READER_URL, type: 'O',
  });
  const bare = buildTrimmedScene(buildScene, encoded, sceneOpts, trimExportMargin('O')).scene;
  // 링 없이는 죽는다 — 이 단언이 «재적용은 사치가 아니라 필요» 를 잠근다. 이게 초록이
  // 되기 시작하면(디코더가 좋아져서) 재적용 규칙을 다시 판단해도 된다.
  const withoutRing = decodeFrontend(exportRasterOf(bare, 'O', encoded));
  assert.equal(withoutRing.ok, false,
    '투명 O trim 이 링 없이도 읽힌다 — 링 재적용 규칙의 전제가 바뀌었다 (§9 재측정 필요)');
  const ringed = addQuietZone(bare, {
    color: WHITE_BG, margin: 2, selfQuietColors: [BULLSEYE_LIGHT, BULLSEYE_DARK],
  });
  const withRing = decodeFrontend(exportRasterOf(ringed, 'O', encoded));
  assert.equal(withRing.ok, true, '링을 얹었는데도 죽는다: ' + JSON.stringify(withRing.reason));
  assert.equal(withRing.text, text);
});

// ── 5. UI 배선 (index.html 이 프로덕션 함수를 실제로 탄다) ───────────────────────

test('index.html — 내보내기 핸들러가 exportPlanFor → renderExportPng/Svg 를 탄다', () => {
  assert.match(INDEX_SOURCE, /function exportPlanFor\(format\)/);
  const at = INDEX_SOURCE.indexOf('function exportPlanFor(format)');
  const body = INDEX_SOURCE.slice(at, at + 2200);
  assert.match(body, /minRoundtripPpu\(\{/, '계획이 실측 하한을 안 탄다');
  assert.match(body, /resolveExportSize\(\{/, '계획이 크기 해석을 안 탄다');
  assert.match(body, /resolveExportPpi\(\{/, '계획이 ppi 해석을 안 탄다');
  // trim 규칙 (§9 감사 수리): ① 시작 margin 은 버전·코너QR 문맥으로 푼다 (일률값
  // 회귀 방지 — A1/A2 렌더 불능이 그 결함이었다) ② buildTrimmedScene 에스컬레이션
  // ③ 재생성본에도 안전영역 층을 다시 얹는다 (투명 배경에서 링이 quiet zone 그 자체다).
  assert.match(body, /trimExportMargin\(current\.type, \{/, 'trim 시작값이 문맥 없이 풀린다');
  assert.match(body, /version: current\.encoded\.version/, 'A 버전 의존 trim 이 사라졌다');
  assert.match(body, /cornerQr: current\.sceneOpts\.qrCorner !== undefined/,
    '코너 QR 하한(20) 문맥이 사라졌다');
  assert.match(body, /withQuietZone\(buildTrimmedScene\(/,
    'trim 재생성본에 안전영역 층을 안 얹는다 — 투명 O trim 전멸(§9)이 재현된다');
  assert.doesNotMatch(body, /margin: 0[,}]/, 'trim 이 margin 0 으로 되돌아갔다');
  // 핸들러가 실제로 프로덕션 파이프라인을 소비한다.
  assert.match(INDEX_SOURCE, /download\(renderExportPng\(scene, plan\)/);
  assert.match(INDEX_SOURCE, /renderExportSvg\(scene, \{ width: plan\.width, height: plan\.height \}\)/);
});

test('§10 «여백 없음» 비권장 표시 — 고르기 전에 보이고, 문구가 구현과 일치한다', () => {
  // 배지는 체크박스 **옆**(고르기 전에 보이는 자리)이다 — 운영자 결정: 제거가 아니라
  // 비권장 딱지 + 정직한 문구로 세 타입 모두 유지.
  const at = INDEX_SOURCE.indexOf('id="exportTrim"');
  assert.ok(at >= 0, 'exportTrim 체크박스가 없다');
  const row = INDEX_SOURCE.slice(at, at + 600);
  assert.match(row, /<span class="badge warn" data-i18n="g750">/,
    '비권장 배지가 체크박스 행에 없다 — 고른 뒤 결과로 알게 되면 늦다');
  // 문구 사실관계 (감사 실측 + D3 수리 반영): 안전영역 판은 **유지**된다. 반대로 적던
  // 옛 EN 문구(«the quiet zone goes with it»)가 되살아나면 여기서 잡는다.
  assert.doesNotMatch(INDEX_SOURCE, /the quiet zone goes with it/,
    'EN 힌트가 «안전영역이 함께 빠진다» 로 되돌아갔다 — D3(링 재적용) 이후 거짓이다');
  assert.match(INDEX_SOURCE, /quiet-zone plate is kept/,
    'EN 힌트에 «안전영역 판 유지» 사실이 없다');
  // Y 음영 탈락 · O 무변화도 문구에 있어야 한다 (ko 기준 — 8언어 동일성은 i18n-coverage 몫).
  // **의도적 갱신 (2026-08-26)** — 문구가 인라인 힌트(g709)에서 «?»(g701)로 이관되면서
  // 주어가 명시됐다(«Y 는 입체 음영 띠가 빠지고»). 구 단언은 조사까지 잠가서
  // «띠는» → «띠가» 하나로 빨개졌다 — 이 파일이 어순 락에서 이미 배운 함정과 같다
  // (잠글 것은 문장이 아니라 **주장**이다). 그래서 조사를 뺀 주장으로 잰다.
  assert.match(INDEX_SOURCE, /입체 음영 띠[가는] 빠지고/,
    'ko 힌트에 Y 음영 탈락 사실이 없다');
  assert.match(INDEX_SOURCE, /Type O 는 기본 여백이 이미 최소라 변화가 없어요/,
    'ko 힌트에 O 무변화(절약 0.0% 실측) 사실이 없다');
});

test('§10 물리 크기 힌트 — 헬퍼 값 · 경계 · UI 배선', () => {
  // §8.2 실측 값 그대로: 기본 자동 크기(360px) + 1200ppi = 7.6mm 스탬프.
  assert.ok(Math.abs(exportPhysicalWidthMm(360, 1200) - 7.62) < 0.01);
  assert.ok(Math.abs(exportPhysicalWidthMm(2048, 1200) - 43.35) < 0.01);
  assert.ok(Math.abs(exportPhysicalWidthMm(1024, 300) - 86.7) < 0.1);
  assert.throws(() => exportPhysicalWidthMm(0, 300), RangeError);
  assert.equal(EXPORT_MIN_COMFORT_PRINT_MM, 15);
  // 판정: 기본 자동 + 1200 은 경고 대상, 2048px + 1200 은 아님 (가드의 존재 이유).
  assert.ok(exportPhysicalWidthMm(360, 1200) < EXPORT_MIN_COMFORT_PRINT_MM);
  assert.ok(exportPhysicalWidthMm(2048, 1200) >= EXPORT_MIN_COMFORT_PRINT_MM);
  // UI 배선: 전용 sync 가 있고(언어 전환 재도장 목록에 등록), 렌더마다 재계산되고,
  // 경고 문구는 사전(g751)을 탄다.
  assert.match(INDEX_SOURCE, /function syncExportPpiHint\(\)/);
  assert.match(INDEX_SOURCE, /const TEXT_SYNCERS = \[[\s\S]*?syncExportPpiHint[\s\S]*?\];/);
  const at = INDEX_SOURCE.indexOf('function syncExportPpiHint()');
  const body = INDEX_SOURCE.slice(at, at + 1600);
  assert.match(body, /exportPhysicalWidthMm\(size\.width, ppi\)/, '힌트가 물리 폭을 안 계산한다');
  assert.match(body, /EXPORT_MIN_COMFORT_PRINT_MM/, '경계 상수를 안 쓴다 — 규칙이 UI 에 박힌다');
  assert.match(body, /tf\('g751',/, '경고 문구가 사전을 안 탄다 — 언어 전환에 굳는다');
  // 렌더 직후 재계산 (scene 치수 의존) — current 대입 뒤에 호출이 있어야 한다.
  assert.match(INDEX_SOURCE, /sceneOpts: result\.sceneOpts,\s*\};\s*\/\/[^\n]*\n\s*syncExportPpiHint\(\);/);
});

test('index.html — 새 상태 키가 노출 표에 있고 sync 가 등록돼 있다', () => {
  assert.match(INDEX_SOURCE,
    /<div id="sharedControls" data-state-keys="[^"]*\bexportSize\b[^"]*\bexportWidth\b[^"]*\bexportHeight\b[^"]*\bexportMargin\b[^"]*\bexportPpi\b/);
  assert.match(INDEX_SOURCE, /<div id="panelAdvanced"[^>]*data-state-keys="[^"]*\bexportDither\b[^"]*\bexportPpiDetail\b/);
  assert.match(INDEX_SOURCE, /const TEXT_SYNCERS = \[[\s\S]*?syncExportOptionsUi[\s\S]*?\];/);
});
