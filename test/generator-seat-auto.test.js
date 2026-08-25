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
import { zoneCards } from '../src/finder-zone-ui.js';

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

test('③ ⛔ 막힌 칸은 자동이 고르지 않는다 — 안 되는 것을 기본값으로 만들지 않는다', () => {
  // K 외곽(H2CO3) — bootstrap 이 star formatIndex 8 을 안 열어 **스캔이 안 된다**.
  const k = autoSeatsFor({ type: 'K' });
  assert.equal(k.outer, SEAT_NONE, 'K 자동이 k-cm 을 골랐다 — 스캔 불가 코드가 기본값이 된다');
  assert.equal(k.blocked, 'k-cm-bootstrap-unwired');
  assert.equal(k.appliedFallback, true);
  // sagoae — 검출측은 됐지만 **생성측 합성 렌더가 없다**.
  const t = autoSeatsFor({ type: 'A', centralFinderIsTaegeuk: true });
  assert.equal(t.inner, SEAT_NONE, 'taegeuk 자동이 sagoae 를 골랐다 — 그릴 경로가 없다');
  assert.equal(t.blocked, 'sagoae-no-generator-render');
  // 막히지 않은 칸은 폴백을 안 쓴다.
  for (const type of ['O', 'A', 'V']) {
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

test('⑤ 막힘 사유는 **실제 상태**와 일치해야 한다 (라벨이 아니라 자로)', () => {
  // sagoae 는 카드가 서지만 ready:false 다 — 그것이 「생성측 렌더 없음」의 화면 표현이다.
  const sagoae = zoneCards().inner.find((c) => c.id === SEAT_SAGOAE);
  assert.ok(sagoae, 'sagoae 카드가 사라졌다');
  assert.equal(sagoae.ready, false,
    'sagoae 가 ready 가 됐다 — 생성측 렌더가 붙었다면 기준표의 blocked 를 지워라');
  // k-cm 은 카드는 ready 지만 상태 허용값에 없다 (stateValue:false).
  const kcm = zoneCards().outer.find((c) => c.id === SEAT_K_CM);
  assert.ok(kcm, 'k-cm 카드가 사라졌다');
  assert.equal(kcm.ready, true, 'k-cm 은 와이어가 실재하므로 ready 여야 한다');
});
