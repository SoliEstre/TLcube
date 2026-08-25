/**
 * generator-exclusion-matrix.test.js — **인코더가 던지는 조합을 UI 가 만들 수 있는가**.
 *
 * 2026-08-20 운영자 보고: 「코너 마커 선택 시 중앙 QR 선택하면 렌더링이 안 됨」.
 * 원인 — `cornerMarker × centerQr` 은 인코더가 **명시적으로 던지는** 조합인데
 * (src/encode.js: 「코너 마커는 링 k·k−1, 중앙 QR 은 링3 을 먹는다 — 배치 검증 미실시」)
 * 코너 마커 카드를 붙일 때 `turnA` 상호배제만 처리하고 **`centerQr` 을 놓쳤다.**
 *
 * ⚠ 이게 **세 번째** 상호배제였다. 하나씩 손으로 세다 놓친 것이므로, 이 파일은
 * 목록을 손으로 적지 않고 **인코더에게 물어본다** — 조합을 전수로 돌려 던지는 것을
 * 찾아내고, 그 각각이 UI 에서 막혀 있는지 본다. 네 번째가 생겨도 여기서 걸린다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID, createGeneratorState,
} from '../src/generator-state.js';
import { FINDER_CARD_GROUPS, CENTRAL_V0_FINDER_CARD } from '../src/finder-card-ui.js';
import { isDaehanFinderPatternId } from '../src/finder-daehan.js';
import {
  CENTER_QR_FINDER_PATTERN_ID, isCentralV0FinderPatternId, selectGeneratorType,
} from '../src/finder-selection.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** 생성기가 실제로 조합할 수 있는 인코더 플래그. UI 카드가 있는 것만 넣는다. */
const FLAGS = ['cornerMarker', 'centerQr', 'turnA', 'daehanFinder', 'centralV0'];

function combos(flags) {
  const out = [];
  for (let mask = 0; mask < (1 << flags.length); mask += 1) {
    const opts = {};
    flags.forEach((f, i) => { if (mask & (1 << i)) opts[f] = true; });
    out.push(opts);
  }
  return out;
}

/** 인코더가 이 조합을 거부하는가 — 거부하면 그 사유 문자열을 준다. */
function rejection(fn, base, opts) {
  try { fn('x', { ...base, ...opts }); return null; } catch (error) { return error.message; }
}

test('인코더가 던지는 조합을 전수로 찾는다 — 목록을 손으로 적지 않는다', () => {
  const found = [];
  for (const opts of combos(FLAGS)) {
    if (Object.keys(opts).length < 2) continue;              // 단독 플래그는 대상이 아니다
    const oMsg = rejection(encode, { version: 1, eccLevel: 'M' }, { ...opts, turnA: undefined });
    const aMsg = rejection(encodeA, { version: 0, eccLevel: 'M' }, opts);
    if (oMsg || aMsg) found.push({ opts: Object.keys(opts).sort().join('+'), o: oMsg, a: aMsg });
  }
  assert.ok(found.length > 0, '상호배제가 하나도 없다 — 인코더 계약이 사라졌는지 보라');

  // 찾은 배타 쌍마다 UI 가 그것을 막는 근거가 소스에 있어야 한다.
  const pairs = new Set(found.map((f) => f.opts));
  const GUARDED = {
    // 조합 → UI 가 막는 코드의 서명 (있어야 하는 줄)
    // (구) 'cornerMarker+turnA' — Wave 3 ③(2026-08-24)에서 배타 자체가 개설됐다
    // (V-CM — turnA.js V 표 말미 + 왕복 = test/turnA-roundtrip.test.js). 인코더가
    // 더는 안 던지므로 전수 탐색이 이 쌍을 찾지 않는다 — C2a 의 CMQ 전례와 동일.
    // (구) 'centerQr+cornerMarker' — C2a(2026-08-23)에서 배타 자체가 해제됐다
    // (markerG CMQ 와이어 + 배치 검증·왕복 = test/markerG-centerqr.test.js).
    // 인코더가 더는 안 던지므로 전수 탐색이 이 쌍을 찾지 않는다 — 가드 불필요.
    // daehan 은 파인더 선택에서 오므로 **파인더가 이긴다** — 중앙 QR 카드를 잠근다.
    'centerQr+daehanFinder': /if \(finderTakesCentre && generatorState\.qrPosition === 'inner'\)/,
    // 중앙 v0도 같은 finderTakesCentre 규칙으로 안쪽 QR 카드를 잠근다.
    'centerQr+centralV0': /isCentralV0FinderPatternId\(generatorState\.finderPatternId\)/,
    // 아래 둘은 daehan 분기가 else-if 로 먼저 이겨서 애초에 함께 실리지 않는다.
    // (Wave 3 ④ — cornerMarker 분기 서명에 V-CMQ 가드가 붙었다.)
    // **의도적 갱신 (2026-08-24 검수 4차)** — 두 서명에 붙어 있던 조건이 걷혔다:
    //   · cornerMarker 분기의 `&& !(turnA && centerQr)` → V-CMQ 개설로 소멸
    //   · turnA 분기의 `&& !centralV0Selected` → centralV0×turnA 개설로 소멸
    // 가드의 **역할**(daehan 분기가 else-if 로 먼저 이긴다)은 그대로다 — 서명만 좁힌다.
    'cornerMarker+daehanFinder': /\} else if \(cfg\.cornerMarker === true\) \{/,
    'daehanFinder+turnA': /\} else if \(cfg\.turnA === true\) \{/,
    // (구) 'centralV0+turnA' — 2026-08-24 검수 3차에 **개설**됐다 (턴A 기하 확정으로
    // «배치 검증 미실시» 근거 소멸 · 왕복 = turnA-roundtrip ▽+비컨). 인코더가 더는
    // 안 던지므로 전수 탐색이 이 쌍을 찾지 않는다 — 가드 불필요.
    // (구) 'centerQr+cornerMarker+turnA' (V-CMQ) — 2026-08-24 검수 4차에 **개설**됐다.
    // 새 (값,k) 를 만든 게 아니라 V*CM 인덱스를 **공유**한다 (centerQr 는 셀 회계를
    // 안 바꾸므로 두 해석이 같은 데이터를 낸다 — turnA.js §turnASpec). 인코더가 더는
    // 안 던지므로 전수 탐색이 이 조합을 찾지 않는다.
    // ⚠ 그래서 «환원 불가능한 3중 배타» 사례는 현재 **0건**이다 — 아래 flags.length>2
    //   분기는 그 사실이 바뀌면 다시 일한다 (구조는 남긴다).
    // 둘 다 단일 finderPatternId 카드에서 유도되므로 한 상태에 동시에 설 수 없다.
    'centralV0+daehanFinder': () => {
      const ids = [CENTRAL_V0_FINDER_CARD,
        ...Object.values(FINDER_CARD_GROUPS).flat()].map((entry) => entry.id);
      return ids.every((id) => !(isCentralV0FinderPatternId(id)
        && isDaehanFinderPatternId(id)));
    },
  };
  const unguarded = [];
  const thrownPairs = new Set([...pairs].filter((p) => p.split('+').length === 2));
  for (const pair of pairs) {
    const flags = pair.split('+');
    // 3개 이상 동시 조합: 어떤 2-부분집합이 이미 던지면 **파생**이라 건너뛴다.
    // 어느 부분집합도 안 던지면 **환원 불가능한 다중 배타**다 (V-CMQ, Wave 3 ③)
    // — 자기 가드가 있어야 한다. «파생이라 전부 건너뛴다» 는 종전 가정은 V-CMQ
    // 에서 처음 깨졌다 (세 2-조합이 전부 합법).
    if (flags.length > 2) {
      const derived = flags.some((_, i) => flags.some((__, j) => i < j
        && thrownPairs.has([flags[i], flags[j]].sort().join('+'))));
      if (derived) continue;
    }
    const guard = GUARDED[pair];
    if (!guard) { unguarded.push(pair + ' (가드 미등록)'); continue; }
    const present = typeof guard === 'function' ? guard() : guard.test(INDEX);
    if (!present) unguarded.push(pair + ' (가드가 소스에서 사라짐)');
  }
  assert.deepEqual(unguarded, [],
    'UI 가 안 막는 배타 조합이 있다 — 고르면 렌더가 죽는다: ' + JSON.stringify(unguarded)
    + ' / 인코더가 거부한 전체: ' + JSON.stringify([...pairs]));
});

test('UI 가 막는 조합을 뺀 나머지는 실제로 인코드된다', () => {
  // 남는 조합이 던지면 사용자는 «되는 줄 알고 골랐다가» 빈 화면을 본다.
  for (const [label, fn, base] of [['O', encode, { version: 1, eccLevel: 'M' }],
    ['A', encodeA, { version: 0, eccLevel: 'M' }]]) {
    for (const single of ['cornerMarker', 'centerQr', 'daehanFinder', 'centralV0']) {
      if (label === 'O' && single === 'daehanFinder') continue;   // O daehan 은 파인더 선택으로 온다
      const msg = rejection(fn, base, { [single]: true });
      assert.equal(msg, null, label + ' ' + single + ' 단독인데 던진다: ' + msg);
    }
  }
});

test('코너 예약 힌트는 기본 문구다 — 중앙 QR 상수 잠금(g580 분기)은 C2a 로 은퇴', () => {
  // **의도적 갱신 (C2a, 2026-08-23)**: centerQr 잠금이 해제돼 g580 분기가 사라졌다.
  // **의도적 갱신 (W2 C4)**: 힌트 자리가 cornerMarkerHint → innerSeatHint(g579)로
  // 승계됐다 (seat 구역). g580 은 상수 분기가 아니라 **와이어 존재 술어**
  // (cmqWireExists)가 false 일 때의 잠금 사유로만 산다 — 사전 8언어 유지.
  // **의도적 갱신 (2026-08-26)**: g579 가 인라인 문단에서 «?»(help-dot)로 갔다.
  // 팝오버가 열릴 때 t() 를 부르므로 sync 에서 다시 칠할 대상이 없다 — 재는 것은
  // 「기본 힌트가 g579 다」로 같고, 그 배선이 sync 줄에서 data-help 로 옮겨갔다.
  assert.match(INDEX, /class="help-dot" data-help="g579"/,
    '기본 힌트(g579) 도착지가 없다');
  assert.equal(INDEX.includes('els.innerSeatHint'), false,
    '구 인라인 힌트 배선이 남아 있다 — $() 가 null 을 주므로 조용히 죽은 줄이 된다');
  assert.equal(INDEX.includes("centerQrOn ? t('g580')"), false,
    '은퇴한 상수 잠금 분기가 되살아났다 — C2a 해제와 모순');
});

// ── Type K ─────────────────────────────────────────────────────────────────
// K 의 남은 배타는 O/A 와 **모양이 다르다**: 쌍이 아니라 **단독 플래그**다
// (daehanFinder·turnA). 위의 쌍 전수 탐색은 `length < 2` 를 건너뛰므로 K 를
// 구조적으로 못 본다 — 그래서 자를 따로 세운다. centerQr·centralV0는 2026-08-25
// KEX 실측 후 개설되어 아래 양성 단언으로 구 락을 뒤집었다.
test('Type K 배타 — 인코더에게 묻고, UI 상태가 그 조합을 만들 수 있는지 본다', () => {
  const CANDIDATES = ['cornerMarker', 'centerQr', 'centralV0', 'daehanFinder', 'turnA'];
  const thrown = CANDIDATES
    .filter((f) => rejection(encodeK, { version: 0, eccLevel: 'M' }, { [f]: true }) !== null)
    .sort();
  assert.deepEqual(thrown, ['daehanFinder', 'turnA'],
    'K 의 배타 목록이 바뀌었다 — 인코더가 정본이니 UI 가드를 다시 맞춰라');

  // K-CM·중앙 QR·중앙 v0는 합법이어야 한다. 두 중앙 점유자는 기존 19셀 슬롯을
  // 교체할 뿐이고, 평 K/K-CM 와이어 7/8을 공유한다 (typeK-roundtrip 양성 왕복).
  assert.equal(rejection(encodeK, { version: 0, eccLevel: 'M' }, { cornerMarker: true }), null,
    'K-CM 이 인코더에서 막혔다 — 자리 자체가 사라졌나');
  assert.equal(rejection(encodeK, { version: 0, eccLevel: 'M' }, { centerQr: true }), null,
    'K 중앙 QR이 인코더에서 막혔다 — KEX 개설 회귀');
  assert.equal(rejection(encodeK, { version: 0, eccLevel: 'M' }, { centralV0: true }), null,
    'K 중앙 v0가 인코더에서 막혔다 — KEX 개설 회귀');
  assert.equal(rejection(encodeK, { version: 0, eccLevel: 'M', cornerMarker: true },
    { centerQr: true }), null, 'K-CM 중앙 QR이 막혔다 — 와이어 8 공유 회귀');
  assert.equal(rejection(encodeK, { version: 0, eccLevel: 'M', cornerMarker: true },
    { centralV0: true }), null, 'K-CM 중앙 v0가 막혔다 — 와이어 8 공유 회귀');

  // ── 상태층 — K 를 고르면 «던지는 기본값» 이 만들어지면 안 된다.
  // ⚠ 이 자리가 실제 첫 관문이다: profileFamily 가 K 를 'OA' 로 보내면 기본 프로파일이
  //    qrPosition:'inner' + center-qr 이고, buildConfig 가 그것을 centerQr:true 로
  //    번역해 encodeK 가 **첫 클릭에서** 던진다. 스키마 검증보다 앞선다.
  const k = selectGeneratorType(
    createGeneratorState({ type: 'Y' }), 'K', GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  );
  assert.equal(k.type, 'K', 'K 로 전환이 안 된다');
  assert.notEqual(k.finderPatternId, CENTER_QR_FINDER_PATTERN_ID,
    'K 의 기본 파인더가 중앙 QR 이다 — 첫 클릭이 곧 encodeK 던짐이다');
  assert.notEqual(k.qrPosition, 'inner',
    'K 의 기본 QR 위치가 inner 다 — buildConfig 가 centerQr 로 번역해 던진다');

  // 타입 목록의 **손 사본이 없어야 한다** — finder-selection 이 GENERATOR_TYPES 를
  // 유도해 써야 한다. 사본이 남아 있으면 한쪽만 늘어나 K 클릭이 RangeError 로 죽는다.
  const SRC = readFileSync(new URL('../src/finder-selection.js', import.meta.url), 'utf8');
  assert.doesNotMatch(SRC, /\[\s*'O'\s*,\s*'A'\s*,\s*'Y'\s*\]/,
    'finder-selection.js 에 타입 목록 손 사본이 남아 있다 — GENERATOR_TYPES 에서 유도하라');
});
