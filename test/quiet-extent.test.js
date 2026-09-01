import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeY } from '../src/encodeY.js';
import { encode } from '../src/encode.js';
import { buildSceneY } from '../src/sceneY.js';
import { buildScene } from '../src/scene.js';
import { addQuietZone } from '../src/quietzone.js';
import {
  QUIET_MARGIN_DEFAULT, QUIET_MARGIN_MAX, QUIET_MARGIN_MIN,
  RECOMMENDED_UNIFORM_MULTIPLE, clampQuietMargin, quietCoverage,
} from '../src/quiet-extent.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

/*
 * 안전영역 두께 게이지의 «균일 면 = 코드 폭의 N배» 지표.
 *
 * 🔴 이 지표는 **화면이 운영자에게 숫자를 약속하는 자리**다. 여기가 틀리면 운영자가
 *    그 숫자를 믿고 표본을 다 찍은 **뒤에** 드러난다 — 그래서 「그럴듯한 값이 나온다」가
 *    아니라 **물리적으로 불가능한 값이 안 나온다**를 재야 한다.
 */

const preset = getPreset(DEFAULT_PRESET);
const palette = {
  levels: preset.levels,
  background: preset.background,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};
const WHITE = Object.freeze({ r: 255, g: 255, b: 255 });
const SELF_QUIET = [BULLSEYE_LIGHT, BULLSEYE_DARK];

function withQuiet(scene, margin) {
  return addQuietZone(scene, { color: WHITE, margin, selfQuietColors: SELF_QUIET });
}

function sceneY(layoutId, version) {
  const encoded = encodeY('https://tl.estre.so', {
    cellSurface: true, cellSurfaceLayout: layoutId, tones: 3, eccLevel: 'M', version,
  });
  // 슬롯 레이아웃은 qrText 가 **필수**다 (없으면 sceneY 가 던진다).
  return buildSceneY(encoded, { palette, qrText: 'HTTPS://TLSCAN.ESTRE.SO' });
}

/** Type O — **코너 QR 블록이 있는** 구성. 이 케이스가 0.67배 버그를 냈다. */
function sceneOWithCornerQr() {
  const encoded = encode('https://tl.estre.so', { version: 2 });
  return buildScene(encoded, {
    palette, qrText: 'HTTPS://TLSCAN.ESTRE.SO', qrCorner: 'TL',
  });
}

test('① 눈금 접기 — 범위 밖·비수치는 눈금 안으로 들어온다', () => {
  assert.equal(clampQuietMargin(0), QUIET_MARGIN_MIN);
  assert.equal(clampQuietMargin(-5), QUIET_MARGIN_MIN);
  assert.equal(clampQuietMargin(999), QUIET_MARGIN_MAX);
  assert.equal(clampQuietMargin('7'), 7);
  assert.equal(clampQuietMargin(2.4), 2);
  assert.equal(clampQuietMargin('abc'), QUIET_MARGIN_DEFAULT);
  assert.equal(clampQuietMargin(undefined), QUIET_MARGIN_DEFAULT);
  // 🔴 하한이 1 인 것은 취향이 아니라 **margin 0 이 터지기 때문**이다 (아래 ⑤).
  assert.equal(QUIET_MARGIN_MIN, 1);
});

test('② 🔴 안전영역은 코드를 **두 축 모두** 넘어선다 (분모가 남의 것이면 안 넘는다)', () => {
  /*
   * 실측 결함: 코너 QR 이 있는 Type O 에서 «코드 폭» 이 부풀어 **0.67배** 가 찍혔다.
   * QR 블록은 안전영역에서 제외되는데(selfQuietColors) 분모엔 들어갔던 탓이다.
   *
   * ⚠ **처음엔 이 자리에 «배수 ≥ 1» 을 적었는데 그게 틀린 불변식이었다.** 배수는
   *    «min(링 가로, 링 세로) / 코드 가로» 라, 코드가 가로로 긴 Type O 에서는
   *    얇은 링일 때 정상적으로도 1 미만이 나온다 (실측 margin 1: 링 31.4×28.0 ·
   *    코드 29.4×26.0 → 28.0/29.4 = 0.951). 그건 「분석 정사각을 아직 못 덮는다」는
   *    **참인 보고**다. 진짜 불변식은 **축별**이다.
   */
  const cases = [
    ['Y v0', sceneY('v0', 0)],
    ['Y v0t', sceneY('v0t', 2)],
    ['Y v0trq', sceneY('v0trq', 2)],
    ['O + 코너 QR', sceneOWithCornerQr()],
  ];
  for (const [name, base] of cases) {
    for (const margin of [1, 2, 5, 10]) {   // 20 은 캔버스 클립이라 축별 여유가 사라진다
      const cov = quietCoverage(withQuiet(base, margin), SELF_QUIET);
      assert.ok(cov !== null, `${name} @${margin}: 측정 실패`);
      assert.ok(
        cov.quietWidth > cov.codeWidth,
        `${name} @${margin}: 링 가로 ${cov.quietWidth.toFixed(1)} ≤ 코드 가로 ${cov.codeWidth.toFixed(1)} — 분모가 남의 것을 물었다`,
      );
      // 세로도 같은 성질이어야 한다. 링은 대상을 **감싸는** 것이지 자르는 게 아니다.
      assert.ok(
        cov.quietHeight > cov.codeWidth - 2 * margin,
        `${name} @${margin}: 링 세로 ${cov.quietHeight.toFixed(1)} 이 대상 대비 너무 작다`,
      );
    }
  }
});

test('③ 단조 — 두께를 올리면 배수가 안 줄어든다 (포화 전까지는 오른다)', () => {
  for (const [name, base] of [['Y v0', sceneY('v0', 0)], ['O + 코너 QR', sceneOWithCornerQr()]]) {
    let prev = 0;
    let rose = 0;
    for (const margin of [1, 2, 4, 8, 12, 16, 20]) {
      const cov = quietCoverage(withQuiet(base, margin), SELF_QUIET);
      assert.ok(cov.multiple >= prev - 1e-9, `${name}: ${margin}셀에서 배수가 줄었다`);
      if (cov.multiple > prev + 1e-9) rose += 1;
      prev = cov.multiple;
    }
    // 한 값으로 몰리면 자가 두께를 안 재는 것이다.
    assert.ok(rose >= 4, `${name}: 배수가 ${rose}번만 올랐다 — 자가 두께를 안 읽는다`);
  }
});

test('④ 포화 — 캔버스에 닿으면 clipped 가 서고 그 뒤로는 안 넓어진다', () => {
  const base = sceneY('v0t', 2);
  const small = quietCoverage(withQuiet(base, 2), SELF_QUIET);
  assert.equal(small.clipped, false, '2셀에서 벌써 캔버스에 닿으면 캔버스가 너무 좁다');
  const max = quietCoverage(withQuiet(base, QUIET_MARGIN_MAX), SELF_QUIET);
  assert.equal(max.clipped, true, `${QUIET_MARGIN_MAX}셀이면 캔버스에 닿아야 한다`);
  // 상한을 넘겨도 그림이 안 변한다 — 그래서 게이지 상한이 거기다.
  const over = quietCoverage(withQuiet(base, QUIET_MARGIN_MAX + 6), SELF_QUIET);
  assert.ok(Math.abs(over.multiple - max.multiple) < 1e-9, '상한 뒤에도 배수가 변한다');
});

test('⑤ 🔴 margin 0 은 «없음» 이 아니라 명시적 거절이다 (전엔 메모리를 터뜨렸다)', () => {
  // clusterShapes 의 격자 셀이 Math.max(gap, EPS) 라 gap=0 이면 버킷 Map 이 폭발했다
  // (RangeError: Map maximum size exceeded). 계약은 «0 이상» 을 허용한다고 적혀 있었다.
  const base = sceneY('v0', 0);
  assert.throws(
    () => addQuietZone(base, { color: WHITE, margin: 0, selfQuietColors: SELF_QUIET }),
    /margin 은 0 보다 큰/,
    'margin 0 이 조용히 통과하면 게이지 0 눈금에서 생성기가 죽는다',
  );
  // 「여백 없음」의 정본 표현 — 이쪽은 던지지 않고 입력 scene 을 그대로 돌려준다.
  const none = addQuietZone(base, { color: null, margin: 2 });
  assert.equal(none, base);
  const cov = quietCoverage(none, SELF_QUIET);
  assert.equal(cov.multiple, 1, '안전영역이 없으면 균일 면은 코드 자신이라 배수 1 이다');
  assert.equal(cov.clipped, false);
});

test('⑥ 권장 판정이 배수와 일관된다', () => {
  const base = sceneY('v0', 0);
  for (const margin of [1, 4, 10, 20]) {
    const cov = quietCoverage(withQuiet(base, margin), SELF_QUIET);
    assert.equal(
      cov.meetsRecommendation,
      cov.multiple >= RECOMMENDED_UNIFORM_MULTIPLE,
      `${margin}셀: 판정과 배수가 어긋난다`,
    );
  }
  // 현재 기본값(2셀)은 권장에 **못 미친다** — 화면이 그렇게 말해야 한다.
  const atDefault = quietCoverage(withQuiet(base, QUIET_MARGIN_DEFAULT), SELF_QUIET);
  assert.equal(atDefault.meetsRecommendation, false,
    '기본값이 권장을 충족한다면 이 지표가 아무것도 안 알려 준다 — 값이 바뀌었는지 확인하라');
});
