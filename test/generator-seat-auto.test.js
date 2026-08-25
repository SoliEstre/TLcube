/**
 * generator-seat-auto.test.js — 내곽·외곽 «자동» 기준표를 값으로 잠근다.
 *
 * 표를 손으로 적은 문서가 아니라 **소비 가능한 정본**으로 두는 이유: 이 프로젝트는
 * 「자리는 열렸는데 끝단이 없어서 안 먹는」 상태를 여러 번 만들었다. 자동이 그런 칸을
 * **기본값으로** 고르면 그 실패가 전 사용자에게 기본 동작이 된다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  autoSeatsFor, AUTO_SEAT_TYPES,
  SEAT_NONE, SEAT_O_CM, SEAT_A_CM, SEAT_V_CM, SEAT_K_CM, SEAT_SAGOAE,
} from '../src/generator-seat-auto.js';
import { INNER_SEAT_OPTIONS, OUTER_SEAT_OPTIONS, zoneCards } from '../src/finder-zone-ui.js';

test('① 운영자 기준표 5행 — 심볼 이름이 아니라 **자리 id** 로', () => {
  // 명세는 H·H2O·CO2·H2CO3 로 적혀 있는데 상태가 드는 값은 자리 id 다.
  // 「o-cm 선택이 곧 자리 + H 심볼」(2026-08-24 운영자 확정) — H 는 카드가 아니다.
  assert.deepEqual(autoSeatsFor({ type: 'O', allowBlocked: true }),
    { inner: SEAT_O_CM, outer: SEAT_NONE, outerSectionVisible: false, blocked: null, appliedFallback: false });
  assert.deepEqual(autoSeatsFor({ type: 'A', allowBlocked: true }),
    { inner: SEAT_NONE, outer: SEAT_A_CM, outerSectionVisible: true, blocked: null, appliedFallback: false });
  assert.deepEqual(autoSeatsFor({ type: 'V', allowBlocked: true }),
    { inner: SEAT_NONE, outer: SEAT_V_CM, outerSectionVisible: true, blocked: null, appliedFallback: false });
  assert.equal(autoSeatsFor({ type: 'K', allowBlocked: true }).outer, SEAT_K_CM);
  // 「공통으로」 — taegeuk 은 타입과 무관하게 이긴다.
  for (const type of AUTO_SEAT_TYPES) {
    const r = autoSeatsFor({ type, centralFinderIsTaegeuk: true, allowBlocked: true });
    assert.equal(r.inner, SEAT_SAGOAE, type + ' + taegeuk 인데 내곽이 sagoae 가 아니다');
    assert.equal(r.outer, SEAT_NONE, type + ' + taegeuk 인데 외곽이 없음이 아니다');
  }
});

test('② O 만 외곽 섹션을 숨긴다', () => {
  assert.equal(autoSeatsFor({ type: 'O', allowBlocked: true }).outerSectionVisible, false);
  for (const type of ['A', 'V', 'K']) {
    assert.equal(autoSeatsFor({ type, allowBlocked: true }).outerSectionVisible, true, type);
  }
});

test('③ 구 막힘 락은 양성 선택으로 뒤집힌다 — 자동이 실체가 된 자리를 고른다', () => {
  // **의도적 갱신 (2026-08-25)** — K 외곽(H2CO3) 이 이 락에서 나갔다. 사유였던
  // 「bootstrap 이 star formatIndex 8 을 안 연다」를 레인 KCM 이 닫았고, 그 근거는
  // test/typeK-roundtrip.test.js 의 **K0CM/K1CM/K2CM 전수 양성 왕복**이다.
  // 락을 지우는 게 아니라 **양성 단언으로 뒤집는다** (배타 개설 정형 ④).
  const k = autoSeatsFor({ type: 'K' });
  assert.equal(k.outer, SEAT_K_CM, 'K 자동이 k-cm 을 안 고른다 — 개설이 소비자까지 안 왔다');
  assert.equal(k.blocked, null);
  assert.equal(k.appliedFallback, false);
  // sagoae — 구 락은 「생성측 합성 렌더가 없다」였다. 기존 daehan 예약 회계와
  // formatIndex 를 공유하고 중앙 cell-mask + 고리 합성이 섰으므로 양성 단언으로 전환.
  const t = autoSeatsFor({ type: 'A', centralFinderIsTaegeuk: true });
  assert.equal(t.inner, SEAT_SAGOAE, 'taegeuk 자동이 sagoae 를 고르지 않았다');
  assert.equal(t.blocked, null);
  assert.equal(t.appliedFallback, false);
  // 막히지 않은 칸은 폴백을 안 쓴다.
  for (const type of ['O', 'A', 'V', 'K']) {
    assert.equal(autoSeatsFor({ type }).appliedFallback, false, type + ' 이 헛되이 폴백했다');
  }
});

test('④ 자리 id 가 실제 카드와 **같은 문자열**이어야 한다 (사본이 갈리면 자동이 헛돈다)', () => {
  const zones = zoneCards();
  const ids = new Set([...zones.inner, ...zones.outer].map((c) => c.id));
  for (const type of AUTO_SEAT_TYPES) {
    for (const flag of [false, true]) {
      const r = autoSeatsFor({ type, centralFinderIsTaegeuk: flag, allowBlocked: true });
      for (const seat of [r.inner, r.outer]) {
        assert.ok(ids.has(seat),
          '자동이 고른 자리 "' + seat + '" 가 카드 목록에 없다 — 두 곳의 id 가 갈렸다');
      }
    }
  }
});

test('⑤ 카드·상태 허용값이 실제 와이어 선택과 함께 열린다', () => {
  // sagoae 구 `ready:false` 락을 지우지 않고 **양성 단언**으로 뒤집는다.
  const sagoae = zoneCards().inner.find((c) => c.id === SEAT_SAGOAE);
  assert.ok(sagoae, 'sagoae 카드가 사라졌다');
  assert.equal(sagoae.ready, true, 'sagoae 합성 렌더가 있는데 카드가 아직 잠겨 있다');
  assert.ok(INNER_SEAT_OPTIONS.includes(SEAT_SAGOAE),
    'sagoae 가 내곽 허용값에 없다 — 자동이 고르는 값을 상태가 안 받는다');
  // k-cm — **2026-08-25 개설**. 구 락은 「카드는 ready 지만 상태 허용값엔 없다」
  // (stateValue:false) 였다. 이제 허용값에 **들어야** 한다 — 안 들면 UI 가 카드를
  // 보여 주고도 클릭이 상태에 안 실려 «켰는데 안 먹는» 상태가 된다 (이 repo 의 상습).
  const kcm = zoneCards().outer.find((c) => c.id === SEAT_K_CM);
  assert.ok(kcm, 'k-cm 카드가 사라졌다');
  assert.equal(kcm.ready, true, 'k-cm 은 와이어가 실재하므로 ready 여야 한다');
  assert.notEqual(kcm.stateValue, false, 'k-cm 이 다시 자리-예약으로 강등됐다');
  assert.ok(OUTER_SEAT_OPTIONS.includes(SEAT_K_CM),
    'k-cm 이 외곽 허용값에 없다 — 자동이 고르는 값을 상태가 안 받는다');
});
