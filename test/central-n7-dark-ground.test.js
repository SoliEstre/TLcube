/**
 * central-n7 coded locator가 일반 finder/cube/QR의 우연한 양성에 기대지 않는다는
 * 끝단 회귀 자. TEMPH는 어두운 ember/mono + ss1 + 큰 셀에서 세 일반 경로가 모두
 * 0이 되던 표본이다. 판정은 내부 후보가 아니라 decodeFrontend의 원문 왕복이다.
 *
 * ⚠ 세 번째 테스트(흰 배경 24칸)는 «무회귀 잠금» 이 아니라 «수리 잠금» 이 섞여 있다 —
 *   slate·baseline·white·ppu 12/16 두 칸은 수리 전(main 0f3ae86)에 같은 조기 반환
 *   경로로 빨갛던 칸이다(편입 검증 verify-hygiene 실측). 나머지 22칸이 무회귀 잠금.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  getPreset,
} from '../src/luminance.js';

const TEXT = 'TEMPH';
const ENCODED = encode(TEXT, { version: 1, eccLevel: 'M', centralN7: true });
const PPUS = Object.freeze([10, 12, 16, 24]);
const WHITE = Object.freeze({ r: 255, g: 255, b: 255 });
const BLACK = Object.freeze({ r: 0, g: 0, b: 0 });

function decodeCase(presetName, ppu, mode, background) {
  const preset = getPreset(presetName);
  const options = {
    palette: {
      background,
      levels: preset.levels,
      bullseyeDark: BULLSEYE_DARK,
      bullseyeLight: BULLSEYE_LIGHT,
    },
    margin: 20,
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    centralN7Family: 'hex',
  };
  if (mode === 'emphasis') options.centralN7Emphasis = 'all';
  const scene = buildScene(ENCODED, options);
  return decodeFrontend(rasterize(scene, { pixelsPerUnit: ppu, supersample: 1 }));
}

function assertRoundTrip(presetName, ppu, mode, backgroundName, background) {
  const label = `${presetName}/ppu${ppu}/${mode}/${backgroundName}`;
  const result = decodeCase(presetName, ppu, mode, background);
  assert.equal(result.ok, true, `${label}: ${result.reason}`);
  assert.equal(result.text, TEXT, `${label}: 페이로드 불일치`);
}

test('ember/mono 는 ppu 16·24 baseline 과 ppu 24 emphasis(생성기 기본 강조 all — 라이브 영향 칸)의 어두운 지면에서 끝단 복호한다', {
  timeout: 180_000,
}, () => {
  for (const presetName of ['ember', 'mono']) {
    const preset = getPreset(presetName);
    for (const ppu of [16, 24]) {
      assertRoundTrip(presetName, ppu, 'baseline', 'preset', preset.background);
      assertRoundTrip(presetName, ppu, 'baseline', 'black', BLACK);
    }
    // 수리 전 no-finder 였던 «생성기 기본값» 칸 — 강조 all 은 ppu 16 을 우연히 살렸지만
    // ppu 24 는 살리지 못했다(temph-before · 재현기 72칸). 이 4칸이 라이브 영향 칸이다.
    assertRoundTrip(presetName, 24, 'emphasis', 'preset', preset.background);
    assertRoundTrip(presetName, 24, 'emphasis', 'black', BLACK);
  }
});

test('slate의 baseline/emphasis 전 ppu·어두운 배경 행은 무회귀다', {
  timeout: 150_000,
}, () => {
  const preset = getPreset('slate');
  for (const ppu of PPUS) {
    for (const mode of ['baseline', 'emphasis']) {
      assertRoundTrip('slate', ppu, mode, 'preset', preset.background);
      assertRoundTrip('slate', ppu, mode, 'black', BLACK);
    }
  }
});

test('흰 배경 전 프리셋·ppu·모드 끝단 복호 (slate baseline ppu 12·16 은 수리 전 실패 칸 — 수리 잠금, 나머지 22칸은 무회귀 잠금)', { timeout: 180_000 }, () => {
  for (const presetName of ['slate', 'ember', 'mono']) {
    for (const ppu of PPUS) {
      for (const mode of ['baseline', 'emphasis']) {
        assertRoundTrip(presetName, ppu, mode, 'white', WHITE);
      }
    }
  }
});
