// palette-sat.test.js — 커스텀 팔레트 채도 조정 `customSat` 계약 (DESIGN_001 §5.1 · §7.5)
//
// 재는 것은 «값» 이 아니라 «성질» 이다:
//   ① p × hue 전수에서 슬레이트 계약 3종(Δmin · ρ · 배경 분리)과 목표 Y 오차가 성립한다.
//   ② p=100 이 종전 계산과 360/360 hue 에서 비트 동일하다(반환 모양 포함).
//   ③ 채도 조정이 실제로 색에 닿는다(p=0 은 무채색, p 를 올리면 채도가 오른다).
//   ④ 캐시는 {hue, sat} 로 가르고, «같은 키에 다른 label 이면 처음 것» 특성을 지킨다.
// 계약의 정의는 `src/luminance.js` 의 프리셋 단언(presetDeltaMin · presetRho ·
// presetBackgroundSeparation)과 **같은 식**을 쓴다 — 부호 있는 차이라 순서 역전도 같이 잡힌다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_SATS,
  CUSTOM_SAT_MIN,
  CUSTOM_SAT_MAX,
  satAt,
  colorAtLuminance,
  makeCustomPalette,
} from '../src/palette-hue.js';
import {
  getPreset,
  relativeLuminance,
  PRESET_DELTA_MIN,
  RHO_MIN_CONTRACT,
  PRESET_BG_SEPARATION_MIN,
} from '../src/luminance.js';
import { QUIET_TIE_THRESHOLD } from '../src/quiet-auto.js';

const HUES = Array.from({ length: 360 }, (_, i) => i);
const SAT_STEPS = Array.from({ length: (CUSTOM_SAT_MAX - CUSTOM_SAT_MIN) / 5 + 1 },
  (_, i) => CUSTOM_SAT_MIN + i * 5);
/** 목표 Y 오차 상한 — 8비트 반올림이 만드는 오차(설계 탐침 최대 7.5e-3)에 여유. */
const Y_ERROR_MAX = 1e-2;

const SLATE = getPreset('slate');
const TARGET_BG_Y = relativeLuminance(SLATE.background);
const TARGET_LEVEL_Y = SLATE.levels.map(relativeLuminance);

/** HSL 채도의 분자 — max−min (0–255). 무채색이면 0. */
const chroma = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

/** 종전(customSat 도입 전) 계산 — 채도 조정 없이 CUSTOM_SATS 를 그대로 쓴다. 대조 오라클. */
function legacyCustomPalette(hue, label) {
  return {
    name: 'custom',
    label,
    background: colorAtLuminance(hue, CUSTOM_SATS.background, TARGET_BG_Y),
    levels: TARGET_LEVEL_Y.map((y, index) => colorAtLuminance(hue, CUSTOM_SATS.levels[index], y)),
  };
}

test('satAt — 양 끝(0 · 1)과 기준점(100 = base)에 닿고, 구간마다 단조다', () => {
  for (const base of [CUSTOM_SATS.background, ...CUSTOM_SATS.levels]) {
    assert.equal(satAt(base, 0), 0);
    assert.equal(satAt(base, 100), base);
    assert.equal(satAt(base, 200), 1);
    let prev = -Infinity;
    for (const p of SAT_STEPS) {
      const s = satAt(base, p);
      assert.ok(s >= prev && s >= 0 && s <= 1, `base ${base} p ${p}: s=${s}`);
      prev = s;
    }
  }
});

test('p × hue 전수(0–200 step 5 × 0–359) — Δmin · ρ · 배경 분리 · 목표 Y 오차 · |sepW−sepB|', (t) => {
  let count = 0;
  const worst = {
    deltaMin: Infinity, rho: Infinity, bgSep: Infinity, yErr: 0,
    tieGapMin: Infinity, tieGapMax: -Infinity,
  };
  for (const p of SAT_STEPS) {
    for (const hue of HUES) {
      const pal = makeCustomPalette(hue, 'custom', p);
      const colors = [pal.background, ...pal.levels];
      for (const c of colors) {
        for (const ch of [c.r, c.g, c.b]) {
          assert.ok(Number.isInteger(ch) && ch >= 0 && ch <= 255, `p ${p} hue ${hue}: 채널 ${ch}`);
        }
      }
      const bgY = relativeLuminance(pal.background);
      const [y0, y1, y2] = pal.levels.map(relativeLuminance);
      const deltaMin = Math.min(y1 - y0, y2 - y1);
      const rho = y2 / y0;
      const bgSep = Math.min(y0 - bgY, y1 - bgY, y2 - bgY);
      const yErr = Math.max(
        Math.abs(bgY - TARGET_BG_Y),
        ...[y0, y1, y2].map((y, i) => Math.abs(y - TARGET_LEVEL_Y[i])),
      );
      // 안전영역 자동 규칙(quiet-auto.js)의 «타이브레이크 문턱 0.02 는 UI 팔레트에서 안
      // 걸린다» 는 전제가 새 채도 도메인에서도 참인지 — 흰/검과 셀 레벨의 최소 분리 차.
      const sepW = Math.min(1 - y0, 1 - y1, 1 - y2);
      const sepB = Math.min(y0, y1, y2);
      const tieGap = Math.abs(sepW - sepB);
      if (!(deltaMin >= PRESET_DELTA_MIN) || !(rho >= RHO_MIN_CONTRACT)
        || !(bgSep >= PRESET_BG_SEPARATION_MIN) || !(yErr <= Y_ERROR_MAX)
        || !(tieGap > QUIET_TIE_THRESHOLD)) {
        assert.fail(`p ${p} hue ${hue}: Δmin ${deltaMin} · ρ ${rho} · 배경 분리 ${bgSep} `
          + `· Y 오차 ${yErr} · |sepW−sepB| ${tieGap}`);
      }
      worst.deltaMin = Math.min(worst.deltaMin, deltaMin);
      worst.rho = Math.min(worst.rho, rho);
      worst.bgSep = Math.min(worst.bgSep, bgSep);
      worst.yErr = Math.max(worst.yErr, yErr);
      worst.tieGapMin = Math.min(worst.tieGapMin, tieGap);
      worst.tieGapMax = Math.max(worst.tieGapMax, tieGap);
      count += 1;
    }
  }
  // 표본이 비어 «아무것도 안 재고 초록» 이 되지 않게 개수를 단언한다.
  assert.equal(count, 41 * 360);
  // 최악값은 보고용으로 남긴다(`node --test` 출력의 diagnostic) — 핀으로 잠그지 않는다.
  t.diagnostic(`palette-sat 전수 최악값 ${JSON.stringify(worst)}`);
});

test('p=100 — 360/360 hue 가 종전 계산과 비트 동일(키 순서 · 필드 집합 포함)', () => {
  let same = 0;
  for (const hue of HUES) {
    const expected = JSON.stringify(legacyCustomPalette(hue, '사용자 지정'));
    // 기본 인자(sat 생략)와 명시 100 둘 다 — 호출부가 어느 쪽을 쓰든 같아야 한다.
    makeCustomPalette((hue + 1) % 360, 'x'); // 캐시 비우기(단일 항목 캐시)
    assert.equal(JSON.stringify(makeCustomPalette(hue, '사용자 지정')), expected, `hue ${hue} (생략)`);
    makeCustomPalette((hue + 1) % 360, 'x');
    assert.equal(JSON.stringify(makeCustomPalette(hue, '사용자 지정', 100)), expected, `hue ${hue} (100)`);
    same += 1;
  }
  assert.equal(same, 360);
});

test('반환 객체는 어떤 p 에서도 필드를 더하지 않는다(asset-render 팔레트 sha 비교 대상)', () => {
  for (const p of [0, 55, 100, 150, 200]) {
    const pal = makeCustomPalette(210, 'custom', p);
    assert.deepEqual(Object.keys(pal), ['name', 'label', 'background', 'levels'], `p ${p}`);
    assert.equal(pal.levels.length, 3);
    for (const c of [pal.background, ...pal.levels]) assert.deepEqual(Object.keys(c), ['r', 'g', 'b']);
  }
});

test('채도 조정이 색에 닿는다 — p=0 은 무채색, p 를 100 → 200 으로 올리면 채도가 오른다', () => {
  let raisedLevels = 0;
  for (const hue of HUES) {
    const grey = makeCustomPalette(hue, 'custom', 0);
    for (const c of [grey.background, ...grey.levels]) {
      assert.equal(chroma(c), 0, `hue ${hue} p 0: 무채색이 아니다 ${JSON.stringify(c)}`);
    }
    const mid = makeCustomPalette(hue, 'custom', 100);
    const high = makeCustomPalette(hue, 'custom', 200);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(chroma(high.levels[i]) >= chroma(mid.levels[i]),
        `hue ${hue} L${i}: p 200 채도 ${chroma(high.levels[i])} < p 100 ${chroma(mid.levels[i])}`);
      if (chroma(high.levels[i]) > chroma(mid.levels[i])) raisedLevels += 1;
    }
    assert.ok(chroma(high.background) >= chroma(mid.background), `hue ${hue} 배경`);
  }
  // «≥» 만으로는 배선이 빠져 전부 같은 경우도 통과한다 — 실제로 오른 레벨이 대다수여야 한다.
  assert.ok(raisedLevels >= 3 * 360 * 0.9, `채도가 오른 레벨 ${raisedLevels} / ${3 * 360}`);
});

test('캐시 — {hue, sat} 로 가르고, 같은 키에 다른 label 이면 처음 만든 팔레트를 돌려준다', () => {
  makeCustomPalette(17, 'reset'); // 앞 테스트의 캐시 상태와 무관하게 시작
  const first = makeCustomPalette(210, '첫째', 150);
  // 같은 {hue, sat} + 다른 label → 같은 객체(처음 label 유지) — index.html 의 종전 의미
  const again = makeCustomPalette(210, '둘째', 150);
  assert.equal(again, first);
  assert.equal(again.label, '첫째');
  // 같은 hue 에 sat 만 바꾸면 새 팔레트 — hue 만 비교하면 슬라이더가 «안 먹는다»
  const other = makeCustomPalette(210, '셋째', 50);
  assert.notEqual(other, first);
  assert.equal(other.label, '셋째');
  assert.notDeepEqual(other.levels, first.levels);
  // 기본 인자(sat 생략)는 명시 100 과 같은 캐시 키다
  const dflt = makeCustomPalette(210, '넷째');
  assert.equal(makeCustomPalette(210, '다섯째', 100), dflt);
  assert.equal(dflt.label, '넷째');
  // 단일 항목 캐시: 다른 키를 거쳐 돌아오면 다시 계산하되 값은 같다
  const back = makeCustomPalette(210, '여섯째', 150);
  assert.notEqual(back, first);
  assert.deepEqual(back.levels, first.levels);
  assert.deepEqual(back.background, first.background);
});

test('sat 도메인 밖은 조용히 자르지 않고 던진다', () => {
  for (const bad of [-1, 201, Number.NaN, Infinity, null, '100']) {
    assert.throws(() => makeCustomPalette(210, 'custom', bad), RangeError, `sat=${bad}`);
  }
  // 경계는 허용
  assert.doesNotThrow(() => makeCustomPalette(210, 'custom', CUSTOM_SAT_MIN));
  assert.doesNotThrow(() => makeCustomPalette(210, 'custom', CUSTOM_SAT_MAX));
});
