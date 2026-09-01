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

// ── Type Y decode-safe 분기 (F-78) ─────────────────────────────────────────
// Type Y 는 auto 안전영역(흰/검)이 전경 실루엣 검출을 깨 복호를 죽인다. 그래서
// type='Y' + auto 는 색을 안 넣는다(none). 명시 선택과 O/A 는 종전 그대로.
test('Type Y — auto 는 안전영역을 안 넣고, 명시 선택은 그대로 존중한다', () => {
  const sep = separations('slate');
  const choose = (extra) => resolveQuietZoneChoice({
    bgMode: 'transparent', ...sep, surfaceLuminance: null, separationFloor: 0.05, ...extra,
  });
  // 투명 배경 + auto: O 는 흰색이 붙지만 Y 는 실루엣 보호로 없음.
  assert.equal(choose({ quietMode: 'auto', type: 'O' }).color, 'white');
  const y = choose({ quietMode: 'auto', type: 'Y' });
  assert.equal(y.color, 'none');
  assert.equal(y.reason, 'auto-y-silhouette');
  // 불투명 배경은 Y 라도 종전 사유로 없음 (분기 순서: 불투명 체크가 먼저).
  assert.equal(resolveQuietZoneChoice({
    quietMode: 'auto', bgMode: 'white', ...sep, surfaceLuminance: null, type: 'Y',
  }).reason, 'auto-opaque-background');
  assert.equal(choose({ quietMode: 'none', type: 'Y' }).color, 'none');
  assert.equal(choose({ quietMode: 'none', type: 'Y' }).reason, 'user-none');

  /*
   * ⚠ **의도적 갱신 (운영자 결정 2026-09-01)** — 여기엔 「명시 선택은 Type Y 에서도
   *    존중된다」로 white/black/contrast 가 색을 낸다고 적혀 있었다. 그 축이 **내려갔다**:
   *    Type Y 의 안전영역 카드는 «자동 · 없음 · 표면 색» 셋이고, 흑/백 판은 §Type Y 의
   *    실루엣 문제를 그대로 재현하기 때문이다. 낡은 상태가 들어오면 표면 색으로 사상한다.
   */
  const legacy = ['white', 'black', 'contrast'];
  for (const m of legacy) {
    // 사진이 없으면 표면 색을 모른다 ⇒ 없음 (조용히 흑/백으로 강등하지 않는다).
    assert.equal(choose({ quietMode: m, type: 'Y' }).color, 'none', m);
    assert.equal(choose({ quietMode: m, type: 'Y' }).reason, 'y-legacy-surface-unknown', m);
    // 사진이 있으면 표면 색.
    const withPhoto = choose({ quietMode: m, type: 'Y', surfaceSeparation: 0.4 });
    assert.equal(withPhoto.color, 'surface', m);
    assert.equal(withPhoto.reason, 'y-legacy-to-surface', m);
  }
  // O/A 는 종전 그대로다 — 이 결정은 Type Y 한정이다.
  assert.equal(choose({ quietMode: 'white', type: 'O' }).color, 'white');
  assert.equal(choose({ quietMode: 'contrast', type: 'O' }).color, 'white');
});

test('Type Y 표면 색 — auto 는 «없음» 이 기본이고 지면이 해로울 때만 켠다', () => {
  // 운영자 결정 2026-09-01. §13 법칙(판 색이 테두리 띠에 있으면 무해)의 직접 귀결.
  const sep = separations('slate');
  const choose = (extra) => resolveQuietZoneChoice({
    bgMode: 'transparent', ...sep, surfaceLuminance: 0.5, separationFloor: 0.05,
    quietMode: 'auto', type: 'Y', ...extra,
  });
  // 사진 없음 → 잴 수가 없다 ⇒ 없음.
  assert.equal(choose({ surfaceSeparation: null }).reason, 'auto-y-silhouette');
  // 지면이 셀과 충분히 갈린다(0.4 > 0.05) ⇒ 굳이 판을 안 깐다.
  assert.equal(choose({ surfaceSeparation: 0.4 }).color, 'none');
  assert.equal(choose({ surfaceSeparation: 0.4 }).reason, 'auto-y-silhouette');
  // 안 갈린다(0.01 < 0.05) = 해롭다 ⇒ 표면 색으로 국소 균일화.
  const harmful = choose({ surfaceSeparation: 0.01 });
  assert.equal(harmful.color, 'surface');
  assert.equal(harmful.reason, 'auto-y-surface-harmful');
  // 🔴 경계는 **호출자가 준 바닥**이다 — 모듈이 자기 상수로 판정하면 화면과 갈린다.
  assert.equal(choose({ surfaceSeparation: 0.2, separationFloor: 0.3 }).color, 'surface');
  assert.equal(choose({ surfaceSeparation: 0.2, separationFloor: 0.1 }).color, 'none');
  // 대조군 — 같은 입력이라도 O 는 표면 색 갈래를 안 탄다.
  assert.equal(choose({ surfaceSeparation: 0.01, type: 'O' }).color !== 'surface', true);
});

test('표면 색은 Type Y 전용 — 다른 타입에 남으면 기본값으로 풀린다', () => {
  // 카드가 없는 모드가 상태에 남으면 사용자가 되돌릴 방법이 없다. 실측으로 났다:
  // Y 에서 «표면 색» 을 고르고 Type O 로 바꾸면 O 카드 다섯 중 아무것도 안 켜졌다.
  const sep = separations('slate');
  const choose = (type) => resolveQuietZoneChoice({
    quietMode: 'surface', bgMode: 'transparent', ...sep,
    surfaceLuminance: 0.95, surfaceSeparation: 0.4, type,
  });
  // O 는 'auto' 로 풀린다 ⇒ 투명 배경 + 밝은 표면이면 검정을 고른다 (종전 규칙).
  const o = choose('O');
  assert.notEqual(o.color, 'surface');
  assert.equal(o.reason, 'surface-separation');
  // Y 는 그대로 표면 색.
  assert.equal(choose('Y').color, 'surface');
});

test('표면 색 명시 선택 — 사진이 있어야 켜지고, 없으면 정직하게 «없음»', () => {
  const sep = separations('slate');
  const choose = (extra) => resolveQuietZoneChoice({
    bgMode: 'transparent', ...sep, surfaceLuminance: 0.5, quietMode: 'surface', ...extra,
  });
  assert.equal(choose({ type: 'Y', surfaceSeparation: 0.02 }).color, 'surface');
  assert.equal(choose({ type: 'Y', surfaceSeparation: 0.02 }).reason, 'user-surface');
  // 지면이 «해롭지 않아도» 명시 선택은 존중된다 — auto 와 다른 축이다.
  assert.equal(choose({ type: 'Y', surfaceSeparation: 0.9 }).color, 'surface');
  const noPhoto = choose({ type: 'Y', surfaceSeparation: null });
  assert.equal(noPhoto.color, 'none');
  assert.equal(noPhoto.reason, 'surface-unknown');
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
  // ⚠ **의도적 갱신 (2026-09-01)** — 여기엔 import 문을 **글자 그대로** 재는 정규식이
  //    있었다(`import { resolveQuietZoneChoice } from …`). 표면 색 갈래가 붙으면서
  //    같은 모듈에서 상수를 하나 더 가져오자 그 자가 빨개졌다 — 재던 성질(「규칙을
  //    모듈에서 가져온다」)은 그대로인데 **쓴 방식**을 고정하고 있었다. 성질만 잰다.
  assert.match(INDEX, /from '\.\/src\/quiet-auto\.js';/);
  assert.match(INDEX, /\bresolveQuietZoneChoice\(/);
  assert.match(INDEX, /surfaceLuminance: lastBackdropLuminance/);
  // 표면 색은 **측정값**이라 색 해석이 한 곳에 모여 있어야 한다.
  assert.match(INDEX, /function quietColorOf\(choice\)/);
  assert.match(INDEX, /surfaceSeparation: lastBackdropSeparation/);
  assert.equal(INDEX.includes('function highContrastQuietColor'), false,
    '옛 인라인 규칙이 남아 있으면 어느 쪽이 진짜인지 화면이 대답 못 한다');
});

test('되먹임 재렌더에 상한이 있다 (표면 휘도 ↔ 안전영역 색 진동 차단)', () => {
  assert.match(INDEX, /const QUIET_AUTO_RERENDER_LIMIT = 2;/);
  assert.match(INDEX, /function maybeRerenderForQuietAuto\(\)/);
  assert.match(INDEX, /if \(quietAutoRerenders >= QUIET_AUTO_RERENDER_LIMIT\) return;/);
  assert.match(INDEX, /quietColorAtRender = choice\.color;/);
});

test('g903·g904 가 «사진이 안전영역 색을 정한다» 는 사실을 여덟 언어로 말한다', () => {
  // 두 문구는 gen-ui 픽스에서 «반영되지 않아요» 로 좁혀졌던 자리다. 이제 반영되므로
  // 옛 부정 문구가 남아 있으면 그게 거짓말이 된다.
  assert.equal(INDEX.includes('아래 «안전영역» 의 옵션·색에도 반영되지 않아요'), false);
  assert.equal(INDEX.includes('nor the Safe area option or colour below'), false);
  assert.equal(INDEX.includes('「安全領域」のオプション・色にも反映されません'), false);
  // **의도적 갱신 (2026-08-26)** — g935 는 은퇴했다 (운영자 «두 줄 넘어가는 설명은
  // ?버튼으로»). 3줄 인라인 각주였고, 같은 사실이 이미 g904(규칙 ①②)와 g991(동적
  // 후행구)에 있었다. 앞머리 `*` 는 가리키는 대상이 없는 각주였다.
  // 재는 것은 그대로 — «사진이 안전영역 색을 정한다» 가 화면에서 말해지는가 — 이고,
  // 자리만 g935 → g903(이 섹션 «?») 마지막 줄 앞으로 옮겼다.
  assert.equal(INDEX.includes('"g935"'), false,
    'g935 가 되살아났다 — 같은 사실의 세 번째 문장이 생기면 규칙 변경 때 한쪽만 고쳐진다');
  assert.match(INDEX, /잰 표면 밝기는 «안전영역» 의 «자동»·«고대비» 가 흰색과 검정 중/);
  assert.match(INDEX, /That surface reading also decides whether Safe area’s Auto and High contrast/);
  assert.match(INDEX, /測った面の明るさは、「安全領域」の「自動」「高コントラスト」が白と黒のどちらを/);
  // g904 «언제나 이 한 단계로 정해져요» 도 더는 사실이 아니다.
  assert.equal(INDEX.includes('언제나 이 한 단계로 정해져요'), false);
  assert.equal(INDEX.includes('that single step always settles it'), false);
  assert.equal(INDEX.includes('いつもこの一段階で決まります'), false);
  // ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): 사전이 ko/en/ja 3언어에서
  //   ko/en/ja/fr/it/de/es/pt 8언어로 넓어졌다. 재는 것은 그대로 —
  //   «이 키가 모든 언어에 있는가» — 이고 기대값만 언어 수를 따라간다.
  for (const key of ['g904', 'g903', 'g991']) {
    assert.equal(INDEX.match(new RegExp(`"${key}":`, 'g'))?.length, 8, `${key} 8언어`);
  }
});
