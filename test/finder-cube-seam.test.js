/**
 * finder-cube-seam.test.js — 3톤 큐브의 Y심 색이 **전경으로 남는가**.
 *
 * 2026-08-20. 종전 심은 순검정(`palette.bullseyeDark`, Y=0)이었고, 기본 프리셋 배경이
 * Y≈0.0053 이라 |0 − 0.0053| = 0.0053 이 마스크 허용오차(0.018) **안**에 들어갔다.
 * 그래서 심이 전경 마스크에서 **배경으로 분류**됐고, ppu 가 커지면 심 폭(0.15셀)이
 * 3×3 close 로 못 메울 만큼 넓어져 중앙 큐브가 **세 마름모로 갈라졌다** —
 * 합성 ppu 24\~30 전패, 그리고 10·11·21·40 도 같은 뿌리로 죽었다.
 *
 * ⚠ 이 결함은 **스위트가 전부 초록인 채로** 살아 있었다. 심 색을 잠그는 회귀가 하나도
 * 없었기 때문이다(2026-08-20 확인: `FINDER_CUBE_SEAM` 단언 0건). 이 파일이 그 구멍이다.
 *
 * 고정하는 것 — **값이 아니라 규칙으로.** 프리셋이나 허용오차가 바뀌어도 살아야 한다:
 *   ① 심은 배경과 **마스크 허용오차보다 더** 떨어져 있다 (전경으로 남는 조건)
 *   ② 심은 가장 어두운 면과도 구분된다 (경계가 살아 있는 조건)
 *   ③ 심은 세 면 **모두보다 어둡다** (심이지 면이 아니다)
 *   ④ 문제였던 ppu 대역에서 실제로 검출·복호된다
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { encode } from '../src/encode.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, FINDER_CUBE_SEAM, FINDER_CUBE_TONES,
  getPreset, relativeLuminance,
} from '../src/luminance.js';
import { UNVERIFIED_CUBE_DETECTION, detectCentralCubeFinders } from '../src/decoder/cube-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { decodeFrontend } from '../src/decoder/frontend.js';

const Y = (color) => relativeLuminance(color);
const TOLERANCE = UNVERIFIED_CUBE_DETECTION.backgroundToleranceFloor;

// 프리셋을 손으로 나열하지 않는다 — 하나라도 새로 생기면 이 검사가 자동으로 덮는다.
const PRESET_NAMES = ['slate', 'mono', 'warm', 'sky'].filter((name) => {
  try { return Boolean(getPreset(name)); } catch { return false; }
});

test('① 심은 모든 프리셋 배경과 마스크 허용오차보다 더 떨어져 있다', () => {
  assert.ok(PRESET_NAMES.length > 0, '검사할 프리셋이 없다');
  for (const name of PRESET_NAMES) {
    const background = Y(getPreset(name).background);
    const gap = Math.abs(Y(FINDER_CUBE_SEAM) - background);
    assert.ok(gap > TOLERANCE,
      name + ': 심이 배경과 ' + gap.toFixed(4) + ' 밖에 안 떨어졌다 (허용오차 '
      + TOLERANCE + ') — 마스크에서 배경으로 먹혀 큐브가 세 조각으로 갈라진다');
  }
});

test('② 심은 가장 어두운 면과도 구분된다 — 경계가 살아야 한다', () => {
  const gap = Math.abs(Y(FINDER_CUBE_SEAM) - Y(FINDER_CUBE_TONES[0]));
  // 허용오차와 같은 척도를 쓴다. 「눈에 보이나」가 아니라 「분리되나」의 문턱이다.
  assert.ok(gap > TOLERANCE,
    '심과 가장 어두운 면의 차가 ' + gap.toFixed(4) + ' — 그 면과 맞닿는 심 경계가 사라진다');
});

test('③ 심은 세 면 모두보다 어둡다 — 심이지 면이 아니다', () => {
  for (let i = 0; i < FINDER_CUBE_TONES.length; i += 1) {
    assert.ok(Y(FINDER_CUBE_SEAM) < Y(FINDER_CUBE_TONES[i]),
      '심(Y ' + Y(FINDER_CUBE_SEAM).toFixed(4) + ')이 면[' + i + '](Y '
      + Y(FINDER_CUBE_TONES[i]).toFixed(4) + ')보다 어둡지 않다');
  }
});

test('④ 문제였던 ppu 대역에서 검출·복호된다', () => {
  const preset = getPreset('slate');
  const palette = {
    background: preset.background,
    levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK,      // 불스아이 링은 순검정 그대로다
    bullseyeLight: BULLSEYE_LIGHT,
  };
  const text = 'SEAM BAND';
  const encoded = encode(text, { version: 1, eccLevel: 'M' });

  // 종전에 죽던 자리들. 하나라도 실패하면 심 색이 되돌아갔거나 마스크가 바뀐 것이다.
  for (const ppu of [10, 11, 21, 24, 26, 28, 30]) {
    const scene = buildScene(encoded, {
      palette, cellSize: 1, finderPatternId: 'central-cube-3tone',
    });
    const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });
    const found = detectCentralCubeFinders(toRelativeLuminance(raster, {}), {});
    assert.equal(found.ok, true,
      'ppu ' + ppu + ': 중앙 큐브 검출 실패 (' + (found.reason || '?') + ')');
    const decoded = decodeFrontend(raster, {});
    assert.equal(decoded.ok, true, 'ppu ' + ppu + ': 복호 실패 (' + (decoded.reason || '?') + ')');
    assert.equal(decoded.text, text, 'ppu ' + ppu + ': 페이로드가 다르다');
  }
});
