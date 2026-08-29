/**
 * central-emphasis-roundtrip.test.js — 강조 확장(운영자 2026-08-29 §4)의 왕복 안전 자.
 *
 * «디코더 부담 없음» 을 전제로 두지 않고 **자로 세운다** (브리프 §2.4). 결과 두 갈래:
 *   · 중앙 Y0(비컨) — 강조 3택 × 합성 왕복이 기본과 동일 복호 (통과 → 구현 유지).
 *   · 3톤 큐브 — **거부** (2026-08-29 실측): 강조 dark 순검정(Y=0.0000)이 기본
 *     프리셋 배경(Y=0.0053)과의 차 0.0053 < 전경 마스크 허용오차 0.018 로 배경에
 *     흡수돼 실루엣 검출 전패 (ppu 10/12/16/24 `frontend:no-finder` · 흰 배경
 *     대조군은 전부 통과 — FINDER_CUBE_SEAM 주석의 문턱 기전). 그래서 큐브 분기는
 *     옵션을 소비하지 않으며, 여기서는 그 **무시(픽셀 동일)** 를 잠근다 — 절반만
 *     배선된 «켰는데 안 먹는» 상태와, 자 없이 되살리는 회귀를 둘 다 막는다.
 * 순위 0<1<2 보존(프리셋 전수)은 central-n7-emphasis.test.js 가 잰다 — 여기는
 * 끝단 복호가 자다 (직접 호출 증거는 라이브에서 만료되므로 decodeFrontend 로 잰다).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { CENTRAL_N7_EMPHASIS_MODES } from '../src/centralN7Emphasis.js';
import { THREE_TONE_CUBE_FINDER_PATTERN_ID } from '../src/finder-patterns.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function decodeWith(encoded, sceneOpts) {
  const scene = buildScene(encoded, { palette: PALETTE, ...sceneOpts });
  return decodeFrontend(rasterize(scene, { pixelsPerUnit: 12, supersample: 2 }));
}

test('3톤 큐브 — 강조 거부: 옵션은 무시되고 렌더·복호가 기본과 동일하다', { timeout: 60_000 }, () => {
  // 이 테스트는 «아직 안 된다» 가 아니라 **«안 하기로 실측 확정»** 을 잠근다 (헤더).
  // 누군가 큐브 강조를 배선하면 아래 픽셀 동일성이 빨개진다 — 그때 고칠 것은 이
  // 파일이 아니라, 순검정 앵커를 FINDER_CUBE_SEAM 식 두-제약으로 바꾸고 어두운
  // 배경 합성 왕복부터 다시 세우는 일이다.
  const text = 'emphasis-cube';
  const encoded = encode(text, { version: 2, eccLevel: 'M' });
  const base = decodeWith(encoded, { finderPatternId: THREE_TONE_CUBE_FINDER_PATTERN_ID });
  assert.equal(base.ok, true, '대조군(기본 큐브)이 깨졌다: ' + base.reason);
  assert.equal(base.text, text);
  const plain = rasterize(
    buildScene(encoded, { palette: PALETTE, finderPatternId: THREE_TONE_CUBE_FINDER_PATTERN_ID }),
    { pixelsPerUnit: 8, supersample: 1 },
  );
  for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
    const withMode = rasterize(
      buildScene(encoded, {
        palette: PALETTE,
        finderPatternId: THREE_TONE_CUBE_FINDER_PATTERN_ID,
        centralN7Emphasis: mode,
      }),
      { pixelsPerUnit: 8, supersample: 1 },
    );
    assert.deepEqual(Buffer.from(withMode.pixels), Buffer.from(plain.pixels),
      `큐브 ${mode}: 강조 옵션이 렌더를 바꿨다 — 거부된 확장이 절반 배선됐다`);
  }
});

test('중앙 Y0(비컨) — 강조 3택 전부 기본과 동일 복호 (합성 왕복)', { timeout: 60_000 }, () => {
  const text = 'emphasis-beacon';
  const encoded = encode(text, { version: 2, eccLevel: 'M', centralV0: true });
  const base = decodeWith(encoded, { finderPatternId: CENTRAL_V0_FINDER_PATTERN_ID });
  assert.equal(base.ok, true, '대조군(기본 비컨)이 깨졌다: ' + base.reason);
  assert.equal(base.text, text);
  for (const mode of CENTRAL_N7_EMPHASIS_MODES) {
    const result = decodeWith(encoded, {
      finderPatternId: CENTRAL_V0_FINDER_PATTERN_ID, centralN7Emphasis: mode,
    });
    assert.equal(result.ok, true, `비컨 ${mode} 왕복 실패: ${result.reason}`);
    assert.equal(result.text, base.text, `비컨 ${mode} 페이로드가 기본과 다르다`);
  }
});

test("옵션 부재와 'default' 는 픽셀까지 동일하다 — 임베더 기본 출력 불변", () => {
  // 라이브러리 기본(emphasis 미지정)이 이번 확장으로 조용히 달라지면 기존 발행
  // 출력의 재생성이 어긋난다. «다르지 않다» 를 바이트로 잰다.
  for (const finderPatternId of [
    THREE_TONE_CUBE_FINDER_PATTERN_ID, CENTRAL_V0_FINDER_PATTERN_ID,
  ]) {
    const encoded = encode('emphasis-eq', {
      version: 2,
      eccLevel: 'M',
      ...(finderPatternId === CENTRAL_V0_FINDER_PATTERN_ID ? { centralV0: true } : {}),
    });
    const plain = rasterize(
      buildScene(encoded, { palette: PALETTE, finderPatternId }),
      { pixelsPerUnit: 8, supersample: 1 },
    );
    const asDefault = rasterize(
      buildScene(encoded, { palette: PALETTE, finderPatternId, centralN7Emphasis: 'default' }),
      { pixelsPerUnit: 8, supersample: 1 },
    );
    assert.deepEqual(
      Buffer.from(asDefault.pixels), Buffer.from(plain.pixels),
      finderPatternId + ": 'default' 가 옵션 부재와 다른 픽셀을 냈다",
    );
  }
});
