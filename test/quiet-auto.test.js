/**
 * quiet-auto.test.js — 안전영역 흰/검 자동 선택 (과업 #18).
 *
 * 이 파일의 존재 이유: 종전 규칙은 «배치 사진 휘도» 분기를 갖고 있었지만 **한 번도
 * 실행되지 않았다** (2026-08-16 적대 검증 ⑤ — UI 로 만들 수 있는 팔레트가 전부 문턱
 * 밖이었다). 규칙이 화면 뒤에 숨어 있으면 그런 죽음이 조용히 일어난다. 그래서 규칙을
 * 순수 함수로 떼고, **휘도를 0 에서 1 까지 훑어** 분기가 실제로 갈리는지 여기서 잰다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  QUIET_CELL_SEPARATION_FLOOR, QUIET_TIE_THRESHOLD,
  decideQuietColor, resolveQuietZoneChoice,
} from '../src/quiet-auto.js';
import { PRESETS, getPreset, relativeLuminance } from '../src/luminance.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

/** 실제 팔레트에서 뽑은 분리값 — 합성 스윕이 «가짜 수» 위에서 돌지 않게. */
function separations(presetName) {
  const levels = getPreset(presetName).levels.map(relativeLuminance);
  return {
    sepWhite: Math.min(...levels.map((y) => Math.abs(1 - y))),
    sepBlack: Math.min(...levels.map((y) => Math.abs(0 - y))),
  };
}

const decide = (sep, surfaceLuminance) => decideQuietColor({ ...sep, surfaceLuminance });

// ── 사진 없음 = 종전 규칙 그대로 ────────────────────────────────────────────

test('사진이 없으면 셀 분리만으로 정한다 (종전 규칙과 같은 답)', () => {
  for (const name of Object.keys(PRESETS)) {
    const sep = separations(name);
    const legacy = Math.abs(sep.sepWhite - sep.sepBlack) > QUIET_TIE_THRESHOLD
      ? (sep.sepWhite > sep.sepBlack ? 'white' : 'black')
      : (sep.sepWhite >= sep.sepBlack ? 'white' : 'black');
    assert.equal(decide(sep, null).color, legacy, `${name}: 사진 없을 때 답이 바뀌었다`);
  }
});

test('사진 없음의 두 갈림(문턱 밖 / 동점)이 둘 다 도달 가능하다', () => {
  assert.equal(decide({ sepWhite: 0.3, sepBlack: 0.1 }, null).reason, 'cell-separation');
  assert.equal(decide({ sepWhite: 0.2, sepBlack: 0.19 }, null).reason, 'cell-separation-tie');
  // 문턱은 **유지**다 — 0.02 를 살짝 넘으면 갈리고 살짝 못 넘으면 동점이다.
  assert.equal(QUIET_TIE_THRESHOLD, 0.02);
  assert.equal(decide({ sepWhite: 0.2, sepBlack: 0.2 - 0.021 }, null).reason, 'cell-separation');
  assert.equal(decide({ sepWhite: 0.2, sepBlack: 0.2 - 0.019 }, null).reason, 'cell-separation-tie');
});

// ── 합성 휘도 스윕 — 분기가 살아 있는가 ────────────────────────────────────

test('휘도 스윕 — 실제 팔레트 전부에서 표면 밝기가 결정을 뒤집는다', () => {
  for (const name of Object.keys(PRESETS)) {
    const sep = separations(name);
    const seen = new Map();
    for (let i = 0; i <= 100; i += 1) {
      const y = i / 100;
      const r = decide(sep, y);
      if (!seen.has(r.color)) seen.set(r.color, y);
    }
    assert.deepEqual([...seen.keys()].sort(), ['black', 'white'],
      `${name}: 휘도를 0→1 로 훑어도 한 색만 나온다 — 사진이 1급 입력이 아니다`);
    // 어두운 표면 → 흰색, 밝은 표면 → 검정. 방향이 뒤집혀 있으면 규칙이 거꾸로다.
    assert.equal(decide(sep, 0.05).color, 'white', `${name}: 어두운 표면에서 흰색이 아니다`);
    assert.equal(decide(sep, 0.95).color, 'black', `${name}: 밝은 표면에서 검정이 아니다`);
  }
});

test('휘도 스윕은 **단조**다 — 한 번만 뒤집힌다', () => {
  for (const name of Object.keys(PRESETS)) {
    const sep = separations(name);
    let flips = 0;
    let prev = decide(sep, 0).color;
    for (let i = 1; i <= 1000; i += 1) {
      const now = decide(sep, i / 1000).color;
      if (now !== prev) flips += 1;
      prev = now;
    }
    assert.equal(flips, 1, `${name}: 뒤집힘이 ${flips}회 — 규칙이 요동친다`);
  }
});

test('회색 표면(분리 동점)에서는 셀 분리가 마지막 갈림이다', () => {
  const sep = separations('slate');
  const r = decide(sep, 0.5);
  assert.equal(r.reason, 'surface-tie-cell');
  assert.equal(r.color, sep.sepWhite >= sep.sepBlack ? 'white' : 'black');
});

test('셀 분리 바닥을 못 넘는 색은 사진과 무관하게 탈락한다', () => {
  // 검정이 셀에 붙어 있는 팔레트 — 아무리 밝은 표면이어도 검정을 고르면 안 된다.
  const sep = { sepWhite: 0.4, sepBlack: 0.01 };
  const r = decide(sep, 0.98);
  assert.equal(r.color, 'white');
  assert.equal(r.reason, 'cell-floor');
  // 반대쪽도 같다.
  const r2 = decideQuietColor({ sepWhite: 0.01, sepBlack: 0.4, surfaceLuminance: 0.02 });
  assert.equal(r2.color, 'black');
  assert.equal(r2.reason, 'cell-floor');
  // 둘 다 못 넘으면 셀 분리가 큰 쪽 (안전영역이 어차피 계약 미달이라 알려만 준다).
  const r3 = decideQuietColor({ sepWhite: 0.03, sepBlack: 0.01, surfaceLuminance: 0.99 });
  assert.equal(r3.reason, 'cell-floor-both-fail');
  assert.equal(r3.color, 'white');
});

test('바닥은 호출자가 넘긴 값이고, 기본값은 배경 분리 계약과 같은 수다', () => {
  assert.equal(QUIET_CELL_SEPARATION_FLOOR, 0.05);
  // index.html 의 BG_SEPARATION_MIN 과 같은 수여야 한다 — 두 곳에 다른 수가 적히면
  // 화면이 «권장 ≥ 0.05» 라 말하면서 규칙은 다른 선을 쓰게 된다.
  const m = /const BG_SEPARATION_MIN = ([\d.]+);/.exec(INDEX);
  assert.ok(m, 'index.html 에서 BG_SEPARATION_MIN 을 못 찾았다');
  assert.equal(Number(m[1]), QUIET_CELL_SEPARATION_FLOOR);
  // 그리고 실제로 **넘겨준다** (상수를 복제하는 대신).
  assert.match(INDEX, /separationFloor: BG_SEPARATION_MIN/);
  // 바닥을 바꾸면 답이 바뀐다 — 인자가 죽어 있지 않다는 확인.
  assert.equal(decideQuietColor({
    sepWhite: 0.4, sepBlack: 0.06, surfaceLuminance: 0.98, separationFloor: 0.05,
  }).color, 'black');
  assert.equal(decideQuietColor({
    sepWhite: 0.4, sepBlack: 0.06, surfaceLuminance: 0.98, separationFloor: 0.1,
  }).color, 'white');
});

// ── 사진 유/무 × 투명/불투명 매트릭스 ──────────────────────────────────────

test('매트릭스 — quietMode × 배경 × 사진 유무', () => {
  const sep = separations('slate');
  const rows = [];
  for (const quietMode of ['auto', 'contrast', 'none', 'white', 'black']) {
    for (const bgMode of ['transparent', 'white', 'black']) {
      for (const surface of [null, 0.05, 0.95]) {
        const r = resolveQuietZoneChoice({
          quietMode, bgMode, ...sep, surfaceLuminance: surface, separationFloor: 0.05,
        });
        rows.push(`${quietMode}/${bgMode}/${surface === null ? '무' : surface}=${r.color}`);
      }
    }
  }
  assert.deepEqual(rows, [
    // auto: 투명일 때만 색이 붙고, 그 색은 사진이 정한다.
    'auto/transparent/무=white', 'auto/transparent/0.05=white', 'auto/transparent/0.95=black',
    'auto/white/무=none', 'auto/white/0.05=none', 'auto/white/0.95=none',
    'auto/black/무=none', 'auto/black/0.05=none', 'auto/black/0.95=none',
    // contrast: 배경과 무관하게 항상 고른다 (사용자가 명시적으로 요구한 것이다).
    'contrast/transparent/무=white', 'contrast/transparent/0.05=white', 'contrast/transparent/0.95=black',
    'contrast/white/무=white', 'contrast/white/0.05=white', 'contrast/white/0.95=black',
    'contrast/black/무=white', 'contrast/black/0.05=white', 'contrast/black/0.95=black',
    // none / white / black: 사용자 고정 — 사진도 배경도 못 바꾼다.
    'none/transparent/무=none', 'none/transparent/0.05=none', 'none/transparent/0.95=none',
    'none/white/무=none', 'none/white/0.05=none', 'none/white/0.95=none',
    'none/black/무=none', 'none/black/0.05=none', 'none/black/0.95=none',
    'white/transparent/무=white', 'white/transparent/0.05=white', 'white/transparent/0.95=white',
    'white/white/무=white', 'white/white/0.05=white', 'white/white/0.95=white',
    'white/black/무=white', 'white/black/0.05=white', 'white/black/0.95=white',
    'black/transparent/무=black', 'black/transparent/0.05=black', 'black/transparent/0.95=black',
    'black/white/무=black', 'black/white/0.05=black', 'black/white/0.95=black',
    'black/black/무=black', 'black/black/0.05=black', 'black/black/0.95=black',
  ]);
});

test('사용자 고정 색은 «사용자가 골랐다» 는 사유를 들고 온다', () => {
  const sep = separations('slate');
  const fixed = resolveQuietZoneChoice({
    quietMode: 'white', bgMode: 'transparent', ...sep, surfaceLuminance: 0.95,
  });
  assert.equal(fixed.reason, 'user-fixed');
  assert.equal(resolveQuietZoneChoice({
    quietMode: 'auto', bgMode: 'white', ...sep, surfaceLuminance: null,
  }).reason, 'auto-opaque-background');
});

test('알 수 없는 모드·값은 던진다 (조용히 흰색으로 떨어지지 않는다)', () => {
  const sep = separations('slate');
  assert.throws(() => resolveQuietZoneChoice({ quietMode: 'rainbow', bgMode: 'transparent', ...sep, surfaceLuminance: null }), RangeError);
  assert.throws(() => decideQuietColor({ sepWhite: NaN, sepBlack: 0.1, surfaceLuminance: null }), TypeError);
  assert.throws(() => decideQuietColor({ sepWhite: 0.1, sepBlack: 0.1, surfaceLuminance: NaN }), TypeError);
});

// ── 생성기 배선 · 문구 ─────────────────────────────────────────────────────

test('생성기가 규칙 모듈을 쓰고, 죽은 분기를 인라인으로 남겨 두지 않았다', () => {
  assert.match(INDEX, /import \{ resolveQuietZoneChoice \} from '\.\/src\/quiet-auto\.js';/);
  assert.match(INDEX, /surfaceLuminance: lastBackdropLuminance/);
  assert.equal(INDEX.includes('function highContrastQuietColor'), false,
    '옛 인라인 규칙이 남아 있으면 어느 쪽이 진짜인지 화면이 대답 못 한다');
});

test('되먹임 재렌더에 상한이 있다 (표면 휘도 ↔ 안전영역 색 진동 차단)', () => {
  assert.match(INDEX, /const QUIET_AUTO_RERENDER_LIMIT = 2;/);
  assert.match(INDEX, /function maybeRerenderForQuietAuto\(\)/);
  assert.match(INDEX, /if \(quietAutoRerenders >= QUIET_AUTO_RERENDER_LIMIT\) return;/);
  assert.match(INDEX, /quietColorAtRender = choice\.color;/);
});

test('g935·g904 가 «사진이 안전영역 색을 정한다» 는 사실을 3언어로 말한다', () => {
  // 두 문구는 gen-ui 픽스에서 «반영되지 않아요» 로 좁혀졌던 자리다. 이제 반영되므로
  // 옛 부정 문구가 남아 있으면 그게 거짓말이 된다.
  assert.equal(INDEX.includes('아래 «안전영역» 의 옵션·색에도 반영되지 않아요'), false);
  assert.equal(INDEX.includes('nor the Safe area option or colour below'), false);
  assert.equal(INDEX.includes('「安全領域」のオプション・色にも反映されません'), false);
  assert.match(INDEX, /"g935": "\* 넣은 표면 이미지는 코드 둘레의 표면 밝기를 재서/);
  assert.match(INDEX, /"g935": "\* The surface photo measures the brightness around the code/);
  assert.match(INDEX, /"g935": "\* 入れた表面画像はコード周囲の面の明るさを測り/);
  // g904 «언제나 이 한 단계로 정해져요» 도 더는 사실이 아니다.
  assert.equal(INDEX.includes('언제나 이 한 단계로 정해져요'), false);
  assert.equal(INDEX.includes('that single step always settles it'), false);
  assert.equal(INDEX.includes('いつもこの一段階で決まります'), false);
  for (const key of ['g904', 'g935', 'g991']) {
    assert.equal(INDEX.match(new RegExp(`"${key}":`, 'g'))?.length, 3, `${key} 3언어`);
  }
});
