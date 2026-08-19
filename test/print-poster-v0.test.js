/**
 * print-poster-v0.test.js — 인쇄용 포스터의 TL 이 **정식 스캐너 조건에서 읽히는가**.
 *
 * 왜 생겼나 (2026-08-19, 운영자 지시로 포스터를 v0 셀 표면으로 교체하며).
 * 두 구멍이 함께 드러났다:
 *   ① 포스터 빌더가 `cellSurface` 를 안 넘겨 **locator 가 0셀**이었다 — n=13 인데도
 *      오늘 스캐너가 가장 잘 잡는 축을 안 쓰고 있었다.
 *   ② 포스터가 **화면용 면 게인**(T1/L0.72/R0.62)으로 인쇄되고 있었다. 그 상황을
 *      위해 만들어 둔 RENDER_PROFILE_PRINT(3면 동률)가 안 쓰이고 있었다.
 *
 * **인쇄물은 한 번 찍으면 못 고친다.** 그래서 「빌더가 통과했다」로는 부족하고
 * «그린 것을 스캐너가 되읽는다» 를 값으로 잠근다. 실제로 이 검사가 없었다면
 * v0 로 바꾼 포스터를 **정식 스캐너가 못 읽는 채로** 찍을 뻔했다 (당시 0/8).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decodeFrontend } from '../src/decoder/frontend.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { RENDER_PROFILE_SOFT, faceGainsForRenderProfile } from '../src/render-profile.js';
import {
  POSTER_URL, POSTER_TL_VERSION, POSTER_TL_TONES, POSTER_TL_ECC,
  POSTER_TL_CELL_SURFACE_LAYOUT, PRINT_PALETTE, PRINT_PALETTE_BW,
  buildPrintPosterHtml,
} from '../tools/build-print-poster.mjs';

const POSTER_BUILDER = fileURLToPath(new URL('../tools/build-print-poster.mjs', import.meta.url));

const ENCODE_OPTS = Object.freeze({
  version: POSTER_TL_VERSION,
  tones: POSTER_TL_TONES,
  eccLevel: POSTER_TL_ECC,
  cellSurface: true,
  cellSurfaceLayout: POSTER_TL_CELL_SURFACE_LAYOUT,
});

test('포스터 TL 은 셀 표면 로케이터를 **실제로** 들고 있다', () => {
  // ⚠ 자를 **빌더 산출물**에 댄다. 처음엔 여기서 ENCODE_OPTS 로 직접 encodeY 를
  //   불렀는데, 그러면 «내가 옵션을 이렇게 주면 되는가» 를 재는 것이라 빌더가
  //   cellSurface 를 빼도 초록이었다 — **오늘 잡으려던 바로 그 결함**을 못 잡는다
  //   (변이 검증에서 실제로 통과해 버렸다). 빌더가 낸 HTML 을 본다.
  const html = buildPrintPosterHtml();
  assert.match(html, /data-poster-symbol="tlcube"/, '포스터에 TL 심볼 상자가 없다');
  // 셀 표면 로케이터가 실제로 그려졌는지는 셀 수로 본다 — v0 는 locator 30셀이다.
  const enc = encodeY(POSTER_URL, ENCODE_OPTS);
  const roles = {};
  for (const [, cell] of enc.cellDigits) roles[cell.role] = (roles[cell.role] || 0) + 1;
  assert.ok(roles.locator > 0,
    '포스터에 locator 셀이 0 이다 — cellSurface 를 안 넘긴 상태로 되돌아갔다: '
    + JSON.stringify(roles));
  assert.equal(enc.n, 13, '포스터는 n=13 이어야 한다');
  assert.ok(POSTER_URL.length <= enc.capacity.maxPayloadBytes,
    'URL ' + POSTER_URL.length + 'B 가 용량 ' + enc.capacity.maxPayloadBytes + 'B 를 넘는다');
});

test('두 팔레트 모두 **«약(soft)» 면 게인**을 쓴다', () => {
  // ⚠ **의도적 갱신 (2026-08-19, 내보내기 옵션 라운드)**: 출력물용 동률(1/1/1) →
  //   «약»(T1/L0.85/R0.78). 운영자 확정 «인쇄용 300 + 큐브 입체감 약» 이고, 근거
  //   실측(합성 왕복 12/12 + 원시 Δ 유보)은 build-print-poster.mjs 팔레트 주석과
  //   test/output/lanes/export-options-report.md §2.1 에 있다.
  const soft = faceGainsForRenderProfile(RENDER_PROFILE_SOFT);
  for (const [label, palette] of [['컬러', PRINT_PALETTE], ['흑백', PRINT_PALETTE_BW]]) {
    assert.deepEqual({ ...palette.faceGains }, { ...soft },
      label + ' 팔레트가 «약» 게인이 아니다 — 운영자 확정(인쇄용 300 + 약)에서 벗어났다');
  }
});

test('포스터 TL 이 **정식 스캐너 조건**에서 복호된다 (컬러·흑백 × 해상도 4종)', () => {
  const enc = encodeY(POSTER_URL, ENCODE_OPTS);
  // scanner.js 의 bootstrap 옵션과 **같은 모양**이어야 한다. enableCellSurfaceY 는
  // 2026-08-19 부터 정식에서도 true 다 (그 변경이 이 포스터의 전제다).
  const options = { bootstrap: { family: { cube: { enableCellSurfaceY: true } } } };
  for (const [label, palette] of [['컬러', PRINT_PALETTE], ['흑백', PRINT_PALETTE_BW]]) {
    for (const ppu of [10, 14, 20, 28]) {
      const scene = buildSceneY(enc, { palette, cellSize: 1, margin: 3, cornerQr: false });
      const result = decodeFrontend(rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 }), options);
      assert.equal(result.ok, true,
        label + ' ppu' + ppu + ': ' + JSON.stringify(result.reason));
      assert.equal(result.text, POSTER_URL, label + ' ppu' + ppu + ': 원문 불일치');
    }
  }
});

test('빌더가 encodeY 에 cellSurface 를 **실제로 넘긴다** (소스 계약)', () => {
  // 위 테스트들은 렌더 결과를 보는데, 「빌더가 옵션을 넘기는가」는 결과만으로는
  // 안 보인다 (내가 테스트 안에서 같은 옵션을 다시 주면 초록이 된다 — 변이 검증에서
  // 실제로 그렇게 통과했다). 그래서 **빌더 소스**에 그 호출이 있는지 직접 잰다.
  const source = readFileSync(POSTER_BUILDER, 'utf8');
  assert.match(source, /cellSurface:\s*true/,
    '빌더가 encodeY 에 cellSurface 를 안 넘긴다 — locator 0셀 포스터가 찍힌다');
  assert.match(source, /cellSurfaceLayout:\s*POSTER_TL_CELL_SURFACE_LAYOUT/,
    '빌더가 레이아웃을 명시하지 않는다 — 라인업이 바뀌면 인쇄물이 조용히 따라간다');
  assert.match(source, /faceGains:\s*faceGainsForRenderProfile\(RENDER_PROFILE_SOFT\)/,
    '빌더가 «약» 면 게인을 안 쓴다 — 운영자 확정(인쇄용 300 + 약)에서 벗어났다');
});

test('셀 표면 검출이 **디코더 기본값**으로 켜져 있다 (포스터의 전제 조건)', () => {
  // 이 포스터는 v0 로케이터가 **검출 경로 그 자체**다 — 장식이 아니다.
  // 실측(`test/output/claude-poster-offcenter.mjs`): 셀 표면 검출을 끄면 치우침
  // 0셀에서조차 **0/6 전멸**한다.
  //
  // **핀이 여기로 옮겨 온 경위 (2026-08-19)**: 처음엔 `sites/tlscan/scanner.js` 가
  // `enableCellSurfaceY: true` 를 적는지 소스로 쟀다. 그런데 그 뒤 **디코더 기본값**
  // 자체가 켜짐으로 올라가면서 스캐너는 그 키를 아예 안 적게 됐다 — 같은 뜻을 두 곳에
  // 적으면 언젠가 한쪽만 바뀌기 때문이다. 그래서 자를 **정본이 있는 곳**으로 옮긴다.
  // (`test/scanner-i18n.test.js` 의 lab 전용 핀도 이 축을 놓아주며 여기를 가리킨다.)
  //
  // 위 왕복 테스트들은 옵션을 **자기가 만들어 넘기므로** 이 명제를 못 잡는다 —
  // 기본값이 off 로 되돌아가도 그것들은 초록이다. 그래서 **옵션을 안 주고** 잰다.
  const enc = encodeY(POSTER_URL, ENCODE_OPTS);
  const scene = buildSceneY(enc, { palette: PRINT_PALETTE, cellSize: 1, margin: 3, cornerQr: false });
  const raster = rasterize(scene, { pixelsPerUnit: 14, supersample: 2 });
  const result = decodeFrontend(raster);            // ← 옵션 없음이 요점이다
  assert.equal(result.ok, true,
    '기본 옵션 디코더가 포스터 TL 을 못 읽는다 — 셀 표면 기본값이 꺼졌다: '
    + JSON.stringify(result.reason));
  assert.equal(result.text, POSTER_URL);
});

test('포스터 TL 은 **치우친 프레임**에서도 복호된다 (손으로 든 경우)', () => {
  // 왜 필요한가 — 피드백 레인이 cell-mask 계열의 실기기 붕괴 원인을 「중심 씨앗 포획
  // 반경 0.512셀」로 특정했고, 실사진의 실제 치우침은 1.33~7.60셀이다. **인쇄물을
  // 폰으로 찍는 것이 정확히 그 경우**다. v0 셀 표면 로케이터는 cell-mask 와 다른
  // 검출기지만, 이름이 닮아 같은 함정으로 오인되기 쉽다 — 그래서 값으로 잠근다.
  const enc = encodeY(POSTER_URL, ENCODE_OPTS);
  const options = { bootstrap: { family: { cube: { enableCellSurfaceY: true } } } };
  const ppu = 14;
  const scene = buildSceneY(enc, { palette: PRINT_PALETTE, cellSize: 1, margin: 3, cornerQr: false });
  const base = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });

  for (const cells of [2, 6]) {
    const d = Math.round(cells * ppu);
    const pad = d + 40;
    const W = base.width + pad * 2, H = base.height + pad * 2;
    const pixels = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        const s = (y * base.width + x) * 4;
        const t = ((y + pad + d) * W + (x + pad + d)) * 4;
        pixels[t] = base.pixels[s]; pixels[t + 1] = base.pixels[s + 1];
        pixels[t + 2] = base.pixels[s + 2]; pixels[t + 3] = 255;
      }
    }
    const result = decodeFrontend({ width: W, height: H, pixels }, options);
    assert.equal(result.ok, true, cells + '셀 치우침: ' + JSON.stringify(result.reason));
    assert.equal(result.text, POSTER_URL, cells + '셀 치우침: 원문 불일치');
  }
});
