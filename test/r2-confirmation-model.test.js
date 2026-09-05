/**
 * r2-confirmation-model.test.js — **R2 좌 패널 «확정/변동» 행 모델의 진리표 + 성질.**
 *
 * 운영자 결정 ⑦(«Type Y» → «Y2 (n25)») · ⑧(확정 = 락 시점, 레이아웃은 DONE 까지 변동,
 * 래치가 선두를 이긴다) 을 순수 함수 위에서 잰다. 색·라벨은 여기 없다 — 렌더 층의 몫.
 *
 * 규율: 숫자·이름 사본을 두지 않는다. 버전은 `versionForFinalN` 에서, 후보 수는
 * `finalLayoutIdsForN` 에서, 인디케이터 이름은 `Object.entries(R2_INDICATOR)` 에서 유도해 비교한다.
 *
 * ⚠ 이 파일이 못 재는 축: 실제 패널 DOM 에 칩이 그 색으로 그려지는지, «정정» 강조색 전이.
 * 그건 렌더 층 자와 운영자 실기의 몫이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIRM_STATE,
  confirmationRows,
  indicatorStateKey,
  layoutDisplayId,
  leadingWithHysteresis,
  progressNote,
  R2_STATUS_ACTION,
  R2_REJECT_HINT_HOLD_MS,
  r2StatusStep,
  r2StatusOnReject,
  lateResultAdmitted,
} from '../src/r2-confirmation-model.js';
import { finalLayoutIdsForN, versionForFinalN } from '../src/cellSurfaceFinal.js';
import { R2_INDICATOR } from '../src/r2/session.js';
import { R2_CAPABILITIES } from '../src/r2-scan-runtime.js';

const LINEUP_NS = Object.freeze([13, 21, 25]);
const ROW_KEYS = Object.freeze(['type', 'version', 'layout', 'progress']);
const FAMILY = R2_CAPABILITIES.accumulatesFamilies[0];

/** `r2-scan-runtime` stats 초기값 모양 (필요한 필드만) — 여기서 덧써서 상태를 만든다. */
function statsOf(overrides = {}) {
  return {
    frames: 0,
    binds: 0,
    candidateCount: 0,
    lockedN: 0,
    progressD: 0,
    indicator: R2_INDICATOR.SEARCHING,
    leadingLayoutId: '',
    candidates: [],
    ...overrides,
  };
}

/** 라인업 n 의 «락 직후» stats — 후보 수는 `finalLayoutIdsForN` 에서 유도한다. */
function lockedStats(n, overrides = {}) {
  const ids = finalLayoutIdsForN(n);
  return statsOf({
    candidateCount: ids.length,
    lockedN: n,
    progressD: 0.62,
    indicator: R2_INDICATOR.COLLECTING,
    leadingLayoutId: ids[0],
    candidates: ids.map((layoutId) => ({ layoutId, D: 0.62, indicator: R2_INDICATOR.COLLECTING, alive: true })),
    ...overrides,
  });
}

function byKey(rows) {
  const map = {};
  for (const r of rows) map[r.key] = r;
  return map;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const v of Object.values(value)) deepFreeze(v);
  return value;
}

/** R2_INDICATOR 값 → 이름 소문자 — 원본에서 유도한 기대값 (모델과 독립 계산). */
function expectedIndicatorName(value) {
  const entry = Object.entries(R2_INDICATOR).find(([, v]) => v === value);
  return entry ? entry[0].toLowerCase() : null;
}

test('행 모양 — 키 순서 type → version → layout → progress 고정, progress 만 stateKey 를 갖는다', () => {
  for (const rows of [
    confirmationRows({ stats: statsOf() }),
    confirmationRows({ stats: lockedStats(21), leadingId: 'v0t' }),
    confirmationRows({ stats: lockedStats(21), latched: { layoutId: 'v0tr', n: 21 } }),
  ]) {
    assert.deepEqual(rows.map((r) => r.key), ROW_KEYS);
    for (const r of rows) {
      assert.equal(typeof r.text, 'string');
      assert.ok(Object.values(CONFIRM_STATE).includes(r.state), r.key + ' 의 state 가 CONFIRM_STATE 값이 아니다: ' + r.state);
      assert.equal('stateKey' in r, r.key === 'progress', r.key + ' 행의 stateKey 유무가 어긋난다');
    }
  }
});

test('(i) 락 전(lockedN 0 · candidateCount 0) — 4행 전부 NONE, text 빈 문자열', () => {
  const rows = confirmationRows({ stats: statsOf(), view: { layoutId: '' }, latched: null, leadingId: '' });
  assert.equal(rows.length, ROW_KEYS.length);
  for (const r of rows) {
    assert.equal(r.state, CONFIRM_STATE.NONE, r.key);
    assert.equal(r.text, '', r.key);
  }
  assert.equal(byKey(rows).progress.stateKey, '');
});

test('(ii) 락(lockedN 25 · 후보 5 · 선두 v0t) — 타입·버전 확정, 레이아웃·진행은 변동', () => {
  const stats = lockedStats(25, { indicator: R2_INDICATOR.COLLECTING });
  assert.equal(stats.candidateCount, 5, '전제: n=25 라인업이 5개가 아니면 이 진리표의 전제가 바뀐 것이다');
  const rows = byKey(confirmationRows({ stats, view: { layoutId: 'v0t' }, latched: null, leadingId: 'v0t' }));

  assert.deepEqual(rows.type, { key: 'type', text: 'Type Y', state: CONFIRM_STATE.CONFIRMED });
  assert.deepEqual(rows.version, { key: 'version', text: 'Y2 (n25)', state: CONFIRM_STATE.CONFIRMED });
  assert.deepEqual(rows.layout, { key: 'layout', text: 'v0T', state: CONFIRM_STATE.TENTATIVE });
  assert.equal(rows.progress.state, CONFIRM_STATE.TENTATIVE);
  assert.equal(rows.progress.text, 'D 0.62');
  assert.equal(rows.progress.stateKey, expectedIndicatorName(stats.indicator));
  assert.equal(rows.progress.stateKey, indicatorStateKey(stats.indicator));
});

test('(ii-b) 진행 D 는 소수 2자리, stateKey 는 indicator 를 따라간다', () => {
  for (const [name, value] of Object.entries(R2_INDICATOR)) {
    const rows = byKey(confirmationRows({
      stats: lockedStats(21, { progressD: 0.5, indicator: value }),
      leadingId: 'v0t',
    }));
    assert.equal(rows.progress.text, 'D 0.50', name);
    assert.equal(rows.progress.stateKey, name.toLowerCase(), name);
  }
  const nan = byKey(confirmationRows({ stats: lockedStats(21, { progressD: Number.NaN }), leadingId: 'v0t' }));
  assert.equal(nan.progress.text, 'D 0.00', 'progressD 가 숫자가 아니면 0 으로 읽는다');
});

test('(iii) 래치가 선두를 이긴다 — latched v0tr · 선두 v0t 라도 layout CONFIRMED v0TR (정정의 정의)', () => {
  const stats = lockedStats(25);
  const rows = byKey(confirmationRows({
    stats, view: { layoutId: 'v0t' }, latched: { layoutId: 'v0tr', n: 25 }, leadingId: 'v0t',
  }));
  assert.deepEqual(rows.layout, { key: 'layout', text: 'v0TR', state: CONFIRM_STATE.CONFIRMED });
  assert.deepEqual(rows.type, { key: 'type', text: 'Type Y', state: CONFIRM_STATE.CONFIRMED });
  assert.deepEqual(rows.version, { key: 'version', text: 'Y2 (n25)', state: CONFIRM_STATE.CONFIRMED });
  assert.deepEqual(rows.progress, {
    key: 'progress', text: 'DONE', state: CONFIRM_STATE.CONFIRMED, stateKey: expectedIndicatorName(R2_INDICATOR.DONE),
  });
  assert.equal(rows.progress.stateKey, 'done');
});

test('(iii-b) 래치는 stats 가 락을 잃어도(후보 0 · lockedN 0) 전 행을 확정으로 유지한다', () => {
  // DONE 직후 런타임은 후보를 버릴 수 있다 — 스냅샷이 살아 있는 동안 패널이 비면 사용자가 «사라졌다» 고 본다.
  const rows = byKey(confirmationRows({ stats: statsOf(), latched: { layoutId: 'v0', n: 13 }, leadingId: '' }));
  for (const key of ROW_KEYS) assert.equal(rows[key].state, CONFIRM_STATE.CONFIRMED, key);
  assert.equal(rows.version.text, 'Y' + versionForFinalN(13) + ' (n13)');
  assert.equal(rows.layout.text, layoutDisplayId('v0'));
});

test('(iv) 라인업 밖 n(lockedN 99 · candidateCount 0) — throw 없이 전부 NONE', () => {
  assert.throws(() => versionForFinalN(99), RangeError, '전제: versionForFinalN 이 99 에서 throw 하지 않으면 이 가드는 잴 게 없다');
  let rows;
  assert.doesNotThrow(() => {
    rows = confirmationRows({ stats: statsOf({ lockedN: 99, candidateCount: 0 }), view: { layoutId: '' }, latched: null, leadingId: '' });
  });
  for (const r of rows) {
    assert.equal(r.state, CONFIRM_STATE.NONE, r.key);
    assert.equal(r.text, '', r.key);
  }
});

test('(iv-b) 래치의 n 이 라인업 밖이어도 throw 하지 않는다 — 버전 행만 NONE 으로 떨어진다', () => {
  let rows;
  assert.doesNotThrow(() => {
    rows = byKey(confirmationRows({ stats: statsOf(), latched: { layoutId: 'v0t', n: 99 }, leadingId: '' }));
  });
  assert.equal(rows.version.state, CONFIRM_STATE.NONE);
  assert.equal(rows.version.text, '');
  assert.equal(rows.type.state, CONFIRM_STATE.CONFIRMED);
  assert.equal(rows.layout.text, 'v0T');
});

test('(v) 13·21·25 → Y0/Y1/Y2 — versionForFinalN 에서 유도해 비교', () => {
  for (const n of LINEUP_NS) {
    const ids = finalLayoutIdsForN(n);
    assert.ok(ids.length > 0, '전제: n=' + n + ' 라인업이 비어 있으면 락이 후보를 못 만든다');
    const rows = byKey(confirmationRows({ stats: lockedStats(n), leadingId: ids[0] }));
    const expected = FAMILY + versionForFinalN(n) + ' (n' + n + ')';
    assert.equal(rows.version.text, expected, 'n=' + n);
    assert.equal(rows.version.state, CONFIRM_STATE.CONFIRMED, 'n=' + n);
    assert.equal(rows.type.text, 'Type ' + FAMILY);
    // 래치 경로도 같은 규약이다.
    const latchedRows = byKey(confirmationRows({ stats: statsOf(), latched: { layoutId: ids[0], n } }));
    assert.equal(latchedRows.version.text, expected, '래치 n=' + n);
  }
});

test('(v-b) family 는 기본 R2_CAPABILITIES.accumulatesFamilies[0] 이고, 넘기면 그 글자로 표기한다', () => {
  const stats = lockedStats(21);
  const dflt = byKey(confirmationRows({ stats, leadingId: 'v0t' }));
  assert.equal(dflt.type.text, 'Type ' + FAMILY);
  assert.ok(dflt.version.text.startsWith(FAMILY + versionForFinalN(21)));
  const other = byKey(confirmationRows({ stats, leadingId: 'v0t', family: 'Q' }));
  assert.equal(other.type.text, 'Type Q');
  assert.equal(other.version.text, 'Q' + versionForFinalN(21) + ' (n21)');
});

test('레이아웃 변동 행 — 선두가 없으면 view.layoutId 로, 둘 다 없으면 NONE', () => {
  const stats = lockedStats(21);
  const fromView = byKey(confirmationRows({ stats, view: { layoutId: 'v0trq' }, leadingId: '' }));
  assert.deepEqual(fromView.layout, { key: 'layout', text: 'v0TRQ', state: CONFIRM_STATE.TENTATIVE });
  const leadWins = byKey(confirmationRows({ stats, view: { layoutId: 'v0trq' }, leadingId: 'v0ty' }));
  assert.equal(leadWins.layout.text, 'v0TY', '선두가 있으면 뷰보다 선두를 쓴다');
  const neither = byKey(confirmationRows({ stats, view: { layoutId: '' }, leadingId: '' }));
  assert.equal(neither.layout.state, CONFIRM_STATE.NONE);
  assert.equal(neither.type.state, CONFIRM_STATE.CONFIRMED, '레이아웃이 비어도 타입은 락으로 확정이다');
});

test('(vi) 히스테리시스 — 근소 역전은 직전 선두 유지, delta 이상이면 교체, 죽은 prev·전멸·빈 prev', () => {
  const alive = (layoutId, D, aliveFlag = true) => ({ layoutId, D, indicator: R2_INDICATOR.COLLECTING, alive: aliveFlag });

  assert.equal(leadingWithHysteresis('a', [alive('a', 0.5), alive('b', 0.55)]), 'a', '0.05 차이는 delta(0.1) 안 — 유지');
  assert.equal(leadingWithHysteresis('a', [alive('a', 0.5), alive('b', 0.61)]), 'b', '0.11 차이는 delta 밖 — 교체');
  assert.equal(leadingWithHysteresis('a', [alive('a', 0.5, false), alive('b', 0.3)]), 'b', 'prev 가 죽었으면 최대 D');
  assert.equal(leadingWithHysteresis('a', [alive('a', 0.5, false), alive('b', 0.3, false)]), '', '전부 죽음 → 빈 문자열');
  assert.equal(leadingWithHysteresis('', [alive('a', 0.2), alive('b', 0.4)]), 'b', 'prev 없음 → 최대 D');
  assert.equal(leadingWithHysteresis('z', [alive('a', 0.2), alive('b', 0.4)]), 'b', 'prev 가 후보에 없음 → 최대 D');
  assert.equal(leadingWithHysteresis('a', [alive('a', 0.5), alive('b', 0.55)], 0.01), 'b', 'delta 를 좁히면 같은 입력에서 교체');
  assert.equal(leadingWithHysteresis('a', [alive('a', 0.0), alive('b', 0.0)]), 'a', '동률은 직전 선두 유지');
  assert.equal(leadingWithHysteresis('', [alive('a', 0.0), alive('b', 0.0)]), 'a', 'prev 없는 동률은 먼저 나온 후보 (runtime 의 strict > 규칙)');
  assert.equal(leadingWithHysteresis('a', []), '', '후보 0 → 빈 문자열');
  assert.equal(leadingWithHysteresis('a', null), '', '후보가 배열이 아니어도 예외 없음');
});

test('(vi-b) 히스테리시스는 실제 stats.candidates 모양(bind 직후 D 전부 0)에서 첫 후보를 선두로 낸다', () => {
  const stats = lockedStats(21, { progressD: 0 });
  const ids = finalLayoutIdsForN(21);
  const zero = stats.candidates.map((c) => ({ ...c, D: 0 }));
  assert.equal(leadingWithHysteresis('', zero), ids[0]);
});

test('(vii) indicatorStateKey — R2_INDICATOR 모든 값 → 이름 소문자, 키 집합 일치, 모르는 값은 searching', () => {
  const produced = new Set();
  for (const [name, value] of Object.entries(R2_INDICATOR)) {
    const key = indicatorStateKey(value);
    assert.equal(key, name.toLowerCase(), name);
    produced.add(key);
  }
  const expected = new Set(Object.keys(R2_INDICATOR).map((k) => k.toLowerCase()));
  assert.deepEqual(produced, expected);
  assert.equal(produced.size, Object.keys(R2_INDICATOR).length, '값이 겹치면 이름을 잃는다');

  const fallback = expectedIndicatorName(R2_INDICATOR.SEARCHING);
  assert.equal(fallback, 'searching');
  for (const unknown of [-1, 99, undefined, null, 'DONE', Number.NaN]) {
    assert.equal(indicatorStateKey(unknown), fallback, String(unknown));
  }
});

test('(viii) layoutDisplayId — 라인업 전 id 에서 «앞 2글자 보존 + 나머지 대문자», 소문자로 되돌리면 원래 id', () => {
  let seen = 0;
  for (const n of LINEUP_NS) {
    for (const id of finalLayoutIdsForN(n)) {
      const shown = layoutDisplayId(id);
      assert.equal(shown.slice(0, 2), id.slice(0, 2), id);
      assert.equal(shown.slice(2), id.slice(2).toUpperCase(), id);
      assert.equal(shown.toLowerCase(), id, id);
      assert.equal(shown.length, id.length, id);
      seen += 1;
    }
  }
  assert.ok(seen >= 3, '라인업 id 를 하나도 못 훑었다: ' + seen);
  // 운영자 예시 철자 (표기 규약 ⑦·⑧ 본문 그대로).
  assert.equal(layoutDisplayId('v0tr'), 'v0TR');
  assert.equal(layoutDisplayId('v0t'), 'v0T');
  assert.equal(layoutDisplayId('v0trq'), 'v0TRQ');
  assert.equal(layoutDisplayId(''), '');
  assert.equal(layoutDisplayId(undefined), '', '문자열이 아니면 빈 문자열');
  assert.equal(layoutDisplayId(null), '');
});

test('(ix) 순수성 — 같은 입력 두 번은 deepEqual, 동결한 입력으로 불러도 throw 없고 입력이 안 바뀐다', () => {
  const stats = deepFreeze(lockedStats(25));
  const view = deepFreeze({ layoutId: 'v0t' });
  const latched = deepFreeze({ layoutId: 'v0tr', n: 25 });
  const snapshot = JSON.stringify({ stats, view, latched });

  let a;
  let b;
  assert.doesNotThrow(() => {
    a = confirmationRows({ stats, view, latched: null, leadingId: 'v0t' });
    b = confirmationRows({ stats, view, latched: null, leadingId: 'v0t' });
  });
  assert.deepEqual(a, b);
  assert.notEqual(a, b, '호출마다 새 배열이다 — 렌더가 diff 하려면 같은 참조를 돌려주면 안 된다');

  let c;
  assert.doesNotThrow(() => {
    c = confirmationRows({ stats, view, latched, leadingId: 'v0t' });
  });
  assert.deepEqual(c, confirmationRows({ stats, view, latched, leadingId: 'v0t' }));

  assert.doesNotThrow(() => leadingWithHysteresis('v0t', stats.candidates));
  assert.equal(JSON.stringify({ stats, view, latched }), snapshot, '입력이 바뀌었다');

  // 인자 자체가 비어도 예외 없음 — 전부 NONE.
  for (const bad of [undefined, null, {}, { stats: null }, { stats: 'x' }, { stats: {}, latched: 'v0t' }]) {
    let rows;
    assert.doesNotThrow(() => { rows = confirmationRows(bad); }, String(bad));
    assert.deepEqual(rows.map((r) => r.state), ROW_KEYS.map(() => CONFIRM_STATE.NONE), JSON.stringify(bad));
  }
});

/*
 * 적대 검토 (2026-09-05) F1 · F2 · F5 · F6 — 모델에 옮겨 온 순수 규칙들. 스캐너 배선은 r2-scan-runtime.test ⓡ·ⓢ, engine-switch.test ⓘ.
 */

test('(x) 락 상실 코스팅(lockedN 0 · 후보 생존 · view.n 25) — 칩은 확정 유지, 메모는 «n25·5»: 세 표면이 한 이야기 (F5)', () => {
  const ids = finalLayoutIdsForN(25);
  const coasting = lockedStats(25, { lockedN: 0, progressD: 0.4 });
  const view = { layoutId: ids[0], n: 25 };
  const rows = byKey(confirmationRows({ stats: coasting, view, latched: null, leadingId: ids[0] }));
  assert.equal(rows.type.state, CONFIRM_STATE.CONFIRMED, '묶인 후보가 살아 있는데 타입 칩이 사라졌다 — 손떨림마다 «확정» 이 깜빡인다');
  assert.equal(rows.version.text, FAMILY + versionForFinalN(25) + ' (n25)', '버전은 묶인 n(view.n) 에서 — lockedN 0 이 «n0» 으로 새면 안 된다');
  assert.equal(rows.layout.state, CONFIRM_STATE.TENTATIVE);
  assert.equal(rows.progress.state, CONFIRM_STATE.TENTATIVE);
  assert.equal(progressNote({ stats: coasting, view }), 'n25·' + ids.length, '메모가 칩과 다른 n 을 말한다');

  // 같은 락 판정 — 칩 유무와 메모 유무가 어떤 상태에서도 함께 움직인다 (막대는 candidateCount > 0 만 보므로 그 안에 있다).
  const grid = [
    [statsOf(), { layoutId: '', n: 0 }],                                            // 락 전
    [lockedStats(25), { layoutId: ids[0], n: 0 }],                                  // 락 직후 — view 갱신 전엔 lockedN 으로
    [lockedStats(25), { layoutId: ids[0], n: 25 }],                                 // 락 유지
    [coasting, view],                                                               // 코스팅
    [statsOf({ lockedN: 0, candidateCount: 0 }), { layoutId: '', n: 0 }],           // 후보 폐기(patience) 뒤
    [statsOf({ lockedN: 99, candidateCount: 0 }), { layoutId: '', n: 0 }],          // 라인업 밖 n · bind 실패
  ];
  for (const [stats, v] of grid) {
    const r = byKey(confirmationRows({ stats, view: v, latched: null, leadingId: '' }));
    const chipsShown = r.type.state !== CONFIRM_STATE.NONE;
    const noteShown = progressNote({ stats, view: v }) !== '';
    assert.equal(chipsShown, noteShown, '칩과 메모가 갈린다: ' + JSON.stringify({ lockedN: stats.lockedN, candidateCount: stats.candidateCount, viewN: v.n }));
    if (chipsShown) assert.ok(stats.candidateCount > 0, '칩이 있는데 막대의 조건(candidateCount > 0)이 거짓이다');
  }
  assert.equal(progressNote({ stats: statsOf(), view: { n: 0 } }), '');
  assert.equal(progressNote(null), '', '입력이 없어도 예외 없음');
  assert.equal(progressNote({ stats: lockedStats(13) }), 'n13·' + finalLayoutIdsForN(13).length, 'view 없이도(옛 호출 모양) lockedN 으로 메모를 만든다');
});

test('(xi) 후보 전멸(전부 alive=false) + stale view.layoutId — 레이아웃 행은 NONE (F6 · 죽은 선두를 변동색으로 남기지 않는다)', () => {
  const ids = finalLayoutIdsForN(21);
  const dead = lockedStats(21, {
    indicator: R2_INDICATOR.SEARCHING,
    progressD: 0,
    leadingLayoutId: '',
    candidates: ids.map((layoutId) => ({ layoutId, D: 0.3, indicator: R2_INDICATOR.COLLECTING, alive: false })),
  });
  // 런타임은 view.layoutId 를 선두가 있을 때만 덧쓰고 dispose 때만 비운다 — 전멸 프레임엔 옛 선두가 그대로 남아 있다.
  const staleView = { layoutId: ids[1], n: 21 };
  assert.equal(leadingWithHysteresis('', dead.candidates), '', '전제: 전멸이면 선두가 없다');
  const rows = byKey(confirmationRows({ stats: dead, view: staleView, latched: null, leadingId: '' }));
  assert.equal(rows.layout.state, CONFIRM_STATE.NONE, '죽은 후보의 id 가 TENTATIVE 로 남는다');
  assert.equal(rows.layout.text, '');
  assert.equal(rows.type.state, CONFIRM_STATE.CONFIRMED, '타입·버전은 락(후보 수 · 묶인 n)으로 확정 그대로다');
  assert.equal(rows.progress.stateKey, 'searching');
  // 하나라도 살아 있으면 뷰를 믿는다 — 후보 배열이 없는 옛 호출 모양도 뷰를 믿는다.
  const oneAlive = { ...dead, candidates: dead.candidates.map((c, i) => (i === 1 ? { ...c, alive: true } : c)) };
  assert.equal(byKey(confirmationRows({ stats: oneAlive, view: staleView, leadingId: '' })).layout.text, layoutDisplayId(ids[1]));
  const noArray = { ...dead, candidates: undefined };
  assert.equal(byKey(confirmationRows({ stats: noArray, view: staleView, leadingId: '' })).layout.text, layoutDisplayId(ids[1]));
});

test('(xii) R2 상태줄 전이 — 락 진입 → COLLECTING · 락 해제 → AIM · 거부 뒤 유예 중엔 둘 다 침묵 (F1)', () => {
  const engaged = lockedStats(21, { indicator: R2_INDICATOR.COLLECTING });
  const released = statsOf();
  const off = { collecting: false, holdUntil: -Infinity };
  const on = { collecting: true, holdUntil: -Infinity };

  assert.deepEqual(r2StatusStep(off, engaged, 100), { collecting: true, holdUntil: -Infinity, action: R2_STATUS_ACTION.COLLECTING });
  assert.deepEqual(r2StatusStep(on, released, 100), { collecting: false, holdUntil: -Infinity, action: R2_STATUS_ACTION.AIM });
  assert.equal(r2StatusStep(on, engaged, 100).action, R2_STATUS_ACTION.NONE, '락 유지 중엔 매 프레임 다시 말하지 않는다');
  assert.equal(r2StatusStep(off, released, 100).action, R2_STATUS_ACTION.NONE);
  for (const name of ['LOCKED', 'FINALIZING']) {
    assert.equal(r2StatusStep(off, lockedStats(21, { indicator: R2_INDICATOR[name] }), 100).action, R2_STATUS_ACTION.COLLECTING, name);
  }
  for (const name of ['DROPPED', 'FAILED']) {
    assert.equal(r2StatusStep(on, lockedStats(21, { indicator: R2_INDICATOR[name] }), 100).action, R2_STATUS_ACTION.AIM, name + ' 은 후보가 있어도 해제다');
  }
  for (const name of ['SEARCHING', 'DONE', 'HOLD']) {
    assert.equal(r2StatusStep(off, lockedStats(21, { indicator: R2_INDICATOR[name] }), 100).action, R2_STATUS_ACTION.NONE, name + ' 은 진입이 아니다');
    assert.equal(r2StatusStep(on, lockedStats(21, { indicator: R2_INDICATOR[name] }), 100).action, R2_STATUS_ACTION.NONE, name + ' 은 해제가 아니다');
  }

  // 거부 경로 (PM/029B §27.1.1 — R2 가 K 비컨에 n=13 락 → DONE → beaconOnly 거부 → reset): 옛 규칙은 다음 프레임에 AIM 을 썼다.
  const t0 = 5000;
  assert.equal(r2StatusStep(on, released, t0 + 16).action, R2_STATUS_ACTION.AIM, '전제: 유예 없는 옛 규칙은 거부 다음 프레임에 처방을 aim 으로 덮는다');
  const afterReject = r2StatusOnReject(t0);
  assert.deepEqual(afterReject, { collecting: false, holdUntil: t0 + R2_REJECT_HINT_HOLD_MS });
  assert.ok(R2_REJECT_HINT_HOLD_MS >= 1000, '유예가 1초 미만이면 처방을 읽을 시간이 없다: ' + R2_REJECT_HINT_HOLD_MS);
  const frame1 = r2StatusStep(afterReject, released, t0 + 16);
  assert.equal(frame1.action, R2_STATUS_ACTION.NONE, '거부 직후 release 전이가 aim 을 썼다 — beaconOnly 처방이 한 프레임 만에 사라진다');
  assert.equal(frame1.collecting, false);
  const relock = r2StatusStep(frame1, engaged, t0 + 500);
  assert.equal(relock.action, R2_STATUS_ACTION.NONE, '유예 중 재락이 r2Collecting 으로 처방을 덮었다');
  assert.equal(relock.collecting, true, '유예 중에도 위상은 따라간다 — 안 그러면 유예 뒤 첫 해제가 aim 을 못 쓴다');
  assert.equal(relock.holdUntil, afterReject.holdUntil, '유예 시각은 전이가 건드리지 않는다');
  const releaseInHold = r2StatusStep(relock, released, t0 + 1000);
  assert.deepEqual([releaseInHold.action, releaseInHold.collecting], [R2_STATUS_ACTION.NONE, false]);
  // 유예가 끝나면 정상 전이.
  assert.equal(r2StatusStep(releaseInHold, engaged, t0 + R2_REJECT_HINT_HOLD_MS).action, R2_STATUS_ACTION.COLLECTING, '유예 종료 시각(경계 포함)부터 다시 말한다');
  assert.equal(r2StatusStep({ collecting: true, holdUntil: afterReject.holdUntil }, released, t0 + R2_REJECT_HINT_HOLD_MS + 1).action, R2_STATUS_ACTION.AIM);

  // 순수성 · 관용.
  const frozenState = deepFreeze({ collecting: true, holdUntil: 10 });
  const frozenStats = deepFreeze(lockedStats(25));
  assert.doesNotThrow(() => r2StatusStep(frozenState, frozenStats, 20));
  assert.deepEqual(r2StatusStep(frozenState, frozenStats, 20), r2StatusStep(frozenState, frozenStats, 20));
  for (const bad of [undefined, null, {}, 'x']) {
    assert.equal(r2StatusStep(bad, bad, Number.NaN).action, R2_STATUS_ACTION.NONE, String(bad));
    assert.equal(r2StatusStep(bad, bad, Number.NaN).collecting, false);
  }
  assert.equal(r2StatusStep({ collecting: false }, engaged, undefined).action, R2_STATUS_ACTION.COLLECTING, 'now 가 없으면 유예 없음으로 본다');
  assert.equal(r2StatusOnReject(Number.NaN).holdUntil, R2_REJECT_HINT_HOLD_MS, 'now 가 숫자가 아니면 0 기준');
});

test('(xiii) 늦은 결과 문 — R1 은 R2 꺼짐에서만, QR·R2 는 R2 켜짐에서만, 세션이 다르면 전부 거부 (F2 · QR 콜백 인라인 규칙과 같은 표)', () => {
  for (const sameSession of [true, false]) {
    for (const r2Enabled of [true, false]) {
      const ctx = { sameSession, r2Enabled };
      assert.equal(lateResultAdmitted('r1', ctx), sameSession && !r2Enabled, 'r1 ' + JSON.stringify(ctx));
      // QR 콜백의 인라인 술어 `if (session !== scanSession || !r2Runtime.enabled) return;` 의 부정과 같다 (qr-bridge.test 가 그 철자를 핀).
      assert.equal(lateResultAdmitted('qr', ctx), !(!sameSession || !r2Enabled), 'qr ' + JSON.stringify(ctx));
      assert.equal(lateResultAdmitted('r2', ctx), lateResultAdmitted('qr', ctx), 'r2 ' + JSON.stringify(ctx));
      assert.equal(lateResultAdmitted('r1', ctx) && lateResultAdmitted('qr', ctx), false, '같은 상태에서 두 엔진이 동시에 통과하면 결과가 겹친다');
    }
  }
  // 정식(/) 환원: R2 가 항상 꺼져 있으면 r1 은 «세션이 같으면 통과».
  assert.equal(lateResultAdmitted('r1', { sameSession: true, r2Enabled: false }), true);
  assert.equal(lateResultAdmitted('r1', { sameSession: false, r2Enabled: false }), false);
  for (const bad of ['', 'cube', undefined, null, 42]) assert.equal(lateResultAdmitted(bad, { sameSession: true, r2Enabled: true }), false, String(bad));
  assert.equal(lateResultAdmitted('r1', null), false);
  assert.equal(lateResultAdmitted('r1', {}), false, 'sameSession 을 안 주면 거부 — 모름은 닫힘');
});
