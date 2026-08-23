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
import { FINDER_CARD_GROUPS, CENTRAL_V0_FINDER_CARD } from '../src/finder-card-ui.js';
import { isDaehanFinderPatternId } from '../src/finder-daehan.js';
import { isCentralV0FinderPatternId } from '../src/finder-selection.js';

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
    'cornerMarker+turnA': /if \(generatorState\.cornerMarker\) generatorState\.turnA = false;/,
    // (구) 'centerQr+cornerMarker' — C2a(2026-08-23)에서 배타 자체가 해제됐다
    // (markerG CMQ 와이어 + 배치 검증·왕복 = test/markerG-centerqr.test.js).
    // 인코더가 더는 안 던지므로 전수 탐색이 이 쌍을 찾지 않는다 — 가드 불필요.
    // daehan 은 파인더 선택에서 오므로 **파인더가 이긴다** — 중앙 QR 카드를 잠근다.
    'centerQr+daehanFinder': /if \(finderTakesCentre && generatorState\.qrPosition === 'inner'\)/,
    // 중앙 v0도 같은 finderTakesCentre 규칙으로 안쪽 QR 카드를 잠근다.
    'centerQr+centralV0': /isCentralV0FinderPatternId\(generatorState\.finderPatternId\)/,
    // 아래 둘은 daehan 분기가 else-if 로 먼저 이겨서 애초에 함께 실리지 않는다.
    'cornerMarker+daehanFinder': /\} else if \(cfg\.cornerMarker === true\) \{/,
    'daehanFinder+turnA': /\} else if \(cfg\.turnA === true && !centralV0Selected\) \{/,
    // 중앙 v0 × turnA — 배치 검증 미실시 조합 (2026-08-22 A 개방). 비컨 카드가
    // 선택돼 있으면 encodeOptsFor 가 turnA 를 싣지 않는다.
    'centralV0+turnA': /\} else if \(cfg\.turnA === true && !centralV0Selected\) \{/,
    // 둘 다 단일 finderPatternId 카드에서 유도되므로 한 상태에 동시에 설 수 없다.
    'centralV0+daehanFinder': () => {
      const ids = [CENTRAL_V0_FINDER_CARD,
        ...Object.values(FINDER_CARD_GROUPS).flat()].map((entry) => entry.id);
      return ids.every((id) => !(isCentralV0FinderPatternId(id)
        && isDaehanFinderPatternId(id)));
    },
  };
  const unguarded = [];
  for (const pair of pairs) {
    // 3개 이상 동시 조합은 2개짜리 배타에서 파생된다 — 2개짜리만 본다.
    if (pair.split('+').length !== 2) continue;
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

test('코너 예약 힌트는 기본 문구다 — 중앙 QR 잠금 문구(g580)는 C2a 로 은퇴', () => {
  // **의도적 갱신 (C2a, 2026-08-23)**: centerQr 잠금이 해제돼 g580 분기가 사라졌다.
  // 힌트는 항상 g579. g580 사전 항목 8언어는 남겨 둔다 (키 재사용 방지 — g567 전례).
  assert.match(INDEX, /els\.cornerMarkerHint\.textContent = t\('g579'\)/,
    '기본 힌트 줄이 없다');
  assert.equal(INDEX.includes("centerQrOn ? t('g580')"), false,
    '은퇴한 잠금 분기가 되살아났다 — C2a 해제와 모순');
});
