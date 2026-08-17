/**
 * cellSurfaceFinal-decode.test.js — 최종 라인업 합성 왕복 (lab 경로) + 정식 경로 음성.
 *
 * v0(n=13) · v2r2(n=21/25) × 2톤/3톤. 정식 `/` 는 enableCellSurfaceY 없이는 이
 * 심볼들을 수용하지 않는다 (안정판 불변식 — scanner-i18n.test.js 의 isLabPath 게이트).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { hasCenterQrSlot } from '../src/cellSurfaceFinal.js';
import { TL_READER_URL } from '../src/qr.js';
import { distortImage } from './harness/distort.mjs';

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
/**
 * **드랍된** 와이어 라인업 (v2r2@21 · v2r2@25). 판독 능력 보존의 회귀다 —
 * 스위치(RESTORE_DROPPED) 없이는 검출 라인업에 없다.
 * 의도적 갱신 «드랍 정본화» (2026-08-16).
 */
const LINEUP = Object.freeze([
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v2r2', version: 1, n: 21 },
  { layout: 'v2r2', version: 2, n: 25 },
]);

/**
 * 드랍 후 **기본 라인업** — 스위치 없이 검출·복호되어야 하는 것들.
 * 의도적 갱신 «v0W 편입» (2026-08-16): v0w 가 n=21 세 번째 후보로 들어왔다.
 * 기본(`finalLayoutIdForN(21)`)은 여전히 v0x 이지만, 왕복은 셋 다 서야 한다.
 */
// 의도적 갱신 «v0W 파생 2종 편입» (2026-08-16): v0wq 가 n=21 네 번째 후보로 들어왔다.
// v0WY 는 **여기 없다** — 와이어가 v0W 라 이 표에서는 v0w 행이 곧 v0WY 의 왕복이다
// (그 사실 자체는 cellSurface-block-locator.test.js 의 «v0WY 는 렌더 선택이다» 가 잰다).
// 의도적 갱신 «v0W2 편입» (2026-08-17): v0w2 가 n=21 다섯 번째 후보로 들어왔다.
//
// **의도적 갱신 «v0X 드랍» (운영자 실기기 확정 2026-08-17, 판정 3라운드)** —
// v0x 행을 **활성 표에서 드랍 보존 표로 옮긴다** (값·버전·n 무변경).
// 이 파일에서 두 표를 가르는 기준은 «스위치 없이 도는가» 하나다 — 드랍된
// 레이아웃은 정의상 스위치가 있어야 돌고, 그것이 «차단» 의 증명이다.
// 그래서 활성 표는 v0 · v0W 계열 셋이 되고, 기본은 **v0w** 로 승계된다.
const ACTIVE_LINEUP = Object.freeze([
  { layout: 'v0', version: 0, n: 13 },
  { layout: 'v0w', version: 1, n: 21 },
  { layout: 'v0wq', version: 1, n: 21 },
  { layout: 'v0w2', version: 1, n: 21 },
]);

/** 드랍 보존 팔 — 복원 스위치 위에서만 돌고, 값은 드랍 전과 같다. */
const DROPPED_N21_LINEUP = Object.freeze([
  { layout: 'v0x', version: 1, n: 21 },
]);

function renderFinal(text, {
  layout, version, tones = 2, pixelsPerUnit = 10, supersample = 2, margin = 16,
} = {}) {
  const encoded = encodeY(text, {
    cellSurfaceLayout: layout, version, tones, eccLevel: 'M',
  });
  // 중앙 QR 변형(v0xq · v0wq)은 QR 이 레이아웃 정의의 일부라 qrText 가 필수다.
  const scene = buildSceneY(encoded, {
    palette: PALETTE,
    margin,
    ...(hasCenterQrSlot(layout) ? { qrText: TL_READER_URL } : {}),
  });
  const raster = rasterize(scene, { pixelsPerUnit, supersample });
  return { encoded, scene, raster };
}

/**
 * **드랍 복원 스위치** (운영자 확정 2026-08-16 «v2r2 · v1r2 실험판 드랍»).
 *
 * 이 파일의 LINEUP 은 **와이어 왕복**을 재는 것이라 드랍 뒤에도 그대로 유지한다 —
 * 드랍은 «차단» 이지 «삭제» 가 아니고, 그 사실의 증명이 바로 이 스위치 두 개다:
 *   · `calibration.csBlockLocator.{v2r2Family, v1r2Family}` → 블록 로케이터 패밀리
 *   · `includeDroppedCellSurfaceLayouts` → CS 평가 후보
 * 게이트(agreement 0.78 · margin 0.035 · CRC · RS)는 **한 값도 안 건드린다**.
 * 기본 라인업(v0 · v0X · v0XQ)의 왕복은 아래 «활성 라인업» 테스트가 스위치 없이 잰다.
 */
const RESTORE_DROPPED = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  calibration: { csBlockLocator: { v2r2Family: true, v1r2Family: true } },
});

function decodeLab(raster, extra = undefined) {
  return decodeFrontend(raster, {
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

test('활성 라인업 왕복 — v0(n=13)·v0W 계열(n=21) × 2톤/3톤 (스위치 없음)', {
  timeout: 300_000,
}, () => {
  for (const { layout, version, n } of ACTIVE_LINEUP) {
    for (const tones of [2, 3]) {
      const fixture = renderFinal(PAYLOAD, { layout, version, tones });
      const result = decodeLab(fixture.raster);
      assert.equal(result.ok, true, JSON.stringify({
        layout, n, tones, reason: result.reason,
      }));
      assert.equal(result.text, PAYLOAD);
      assert.equal(result.hypothesis.cellSurfaceLayout, layout);
      assert.equal(result.hypothesis.n, n);
    }
  }
});

test('드랍 n=21 왕복 (복원 스위치) — v0X × 2톤/3톤', {
  timeout: 300_000,
}, () => {
  // «차단이지 삭제가 아니다» 의 증명 — 스위치를 켤때 왕복이 둘 다 살아 있고,
  // 안 켰을 때는 복호 자체가 안 된다 (두 팔을 함께 재야 드랍이 실제로 걸렸다고 말할 수 있다).
  const restore = {
    includeDroppedCellSurfaceLayouts: true,
    calibration: { csBlockLocator: { v0xFamily: true } },
  };
  for (const { layout, version, n } of DROPPED_N21_LINEUP) {
    for (const tones of [2, 3]) {
      const fixture = renderFinal(PAYLOAD, { layout, version, tones });
      const restored = decodeLab(fixture.raster, restore);
      assert.equal(restored.ok, true, JSON.stringify({
        layout, n, tones, reason: restored.reason,
      }));
      assert.equal(restored.text, PAYLOAD);
      assert.equal(restored.hypothesis.cellSurfaceLayout, layout);
      assert.equal(restored.hypothesis.n, n);
      const blocked = decodeLab(fixture.raster);
      assert.equal(blocked.ok, false,
        layout + ' t' + tones + ' 이 스위치 없이도 복호됐다 — 드랍이 안 걸렸다');
    }
  }
});

test('와이어 왕복 (드랍 복원) — v0(n=13)·v2r2(n=21/25) × 2톤/3톤', {
  timeout: 300_000,
}, () => {
  for (const { layout, version, n } of LINEUP) {
    for (const tones of [2, 3]) {
      const fixture = renderFinal(PAYLOAD, { layout, version, tones });
      const result = decodeLab(fixture.raster, RESTORE_DROPPED);
      assert.equal(result.ok, true, JSON.stringify({
        layout, n, tones, reason: result.reason,
      }));
      assert.equal(result.text, PAYLOAD);
      assert.equal(result.family, 'cube');
      assert.equal(result.tones, tones);
      assert.equal(result.hypothesis.cellSurface, true);
      assert.equal(result.hypothesis.cellSurfaceLayout, layout);
      assert.equal(result.hypothesis.locatorProfile, 'cell-surface-' + layout);
      assert.equal(result.hypothesis.n, n);
      assert.equal(result.diagnostics.format.formatIndex, tones === 3 ? 3 : 1);
      assert.equal(
        result.versionName,
        'Y' + version + (tones === 3 ? 'T' : '') + '-CS-' + layout.toUpperCase(),
      );
    }
  }
});

test('직각 회전 왕복 — v0@13 (활성) · v2r2@21 (드랍 복원, 2톤)', {
  timeout: 300_000,
}, () => {
  for (const { layout, version } of [LINEUP[0], LINEUP[1]]) {
    const extra = layout === 'v2r2' ? RESTORE_DROPPED : undefined;
    const fixture = renderFinal(PAYLOAD, {
      layout, version, tones: 2, margin: 20,
    });
    for (const degrees of [0, 90, 180, 270]) {
      const rotated = distortImage(fixture.raster, { rotation: degrees, fill: FILL });
      const result = decodeLab(rotated, extra);
      assert.equal(
        result.ok === true && result.text === PAYLOAD,
        true,
        JSON.stringify({ layout, degrees, reason: result.reason }),
      );
      assert.equal(result.hypothesis.cellSurfaceLayout, layout);
    }
  }
});

test('정식 경로(enableCellSurfaceY 없음)는 최종 라인업을 수용하지 않는다', {
  timeout: 120_000,
}, () => {
  for (const { layout, version } of LINEUP) {
    const fixture = renderFinal(PAYLOAD, { layout, version, tones: 2 });
    const official = decodeFrontend(fixture.raster, {});
    assert.notEqual(
      official.ok === true && official.hypothesis && official.hypothesis.cellSurface === true,
      true,
      layout + ' 가 정식 경로에서 수용됐다',
    );
  }
});

test('2톤·3톤은 서로를 오수용하지 않는다 (v0 · v2r2 — 후자는 드랍 복원)', {
  timeout: 120_000,
}, () => {
  for (const { layout, version } of [LINEUP[0], LINEUP[1]]) {
    const extra = layout === 'v2r2' ? RESTORE_DROPPED : undefined;
    const two = decodeLab(renderFinal(PAYLOAD, { layout, version, tones: 2 }).raster, extra);
    const three = decodeLab(renderFinal(PAYLOAD, { layout, version, tones: 3 }).raster, extra);
    assert.equal(two.ok, true, two.reason);
    assert.equal(three.ok, true, three.reason);
    assert.equal(two.tones, 2);
    assert.equal(three.tones, 3);
    assert.equal(two.diagnostics.format.formatIndex, 1);
    assert.equal(three.diagnostics.format.formatIndex, 3);
  }
});

test('기존 일반 Y 는 최종 셀 표면으로 오수용되지 않는다', { timeout: 120_000 }, () => {
  for (const version of [0, 1, 2]) {
    const encoded = encodeY(PAYLOAD, { version, tones: 2, eccLevel: 'M' });
    const scene = buildSceneY(encoded, { palette: PALETTE, margin: 16 });
    const raster = rasterize(scene, { pixelsPerUnit: 10, supersample: 2 });
    const result = decodeLab(raster);
    assert.notEqual(
      result.ok === true && result.hypothesis && result.hypothesis.cellSurface === true,
      true,
      'Y' + version + ' 일반 심볼이 셀 표면으로 오수용됐다',
    );
    // lab 경로에서도 일반 Y 복호 자체는 그대로 살아 있어야 한다.
    assert.equal(result.ok, true, 'Y' + version + ' lab 경로 일반 복호: ' + result.reason);
    assert.equal(result.text, PAYLOAD);
  }
});
