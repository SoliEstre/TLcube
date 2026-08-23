/**
 * photo-corpus-fingerprint.test.js — 자(尺) 감시 (F-105 재발 방지).
 *
 * 2026-08-20 01:24 photo-probe 일괄 굽기가 실사진 luma 코퍼스 전체를 **무경고**
 * 재생성했고, 그 뒤 8/23 규명 전까지 스위트 빨강 1건이 이름 없이 상시 운반됐다
 * (원장 F-105). 이 테스트는 코퍼스의 (이름, 바이트) 지문을 커밋본과 대조해,
 * 자가 바뀌는 순간 **이름이 있는 경보**로 바꾼다.
 *
 * 지문이 어긋났다 = 코퍼스가 바뀌었다. 의도된 변경이면:
 *   ① `.agent/_coordination/EXPECTED_RED.md` 에 이벤트 1줄 기록 (무엇을 왜 언제)
 *   ② `node test/photo-corpus-fingerprint.regen.mjs` 로 지문 갱신
 * 순서다 — 기록 없이 지문만 갱신하는 것이 정확히 F-105 를 낳은 행동이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { listLumaDumps } from '../tools/read-luma.mjs';

test('실사진 코퍼스 지문이 커밋본과 일치한다 (자 감시)', (t) => {
  const dumps = listLumaDumps();
  if (dumps.length === 0) {
    t.skip('luma 코퍼스 없음 (워크트리 등) — 지문 감시는 본 체크아웃에서만');
    return;
  }
  const committed = JSON.parse(readFileSync(
    fileURLToPath(new URL('./photo-corpus-fingerprint.json', import.meta.url)), 'utf8'));
  const rows = dumps
    .map(({ name, path }) => ({ name, bytes: statSync(path).size }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const digest = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  assert.equal(rows.length, committed.count,
    `코퍼스 장수가 지문과 다르다 (${rows.length} vs ${committed.count}) — 자가 바뀌었다. `
    + 'EXPECTED_RED.md 에 이벤트를 기록하고 regen 스크립트로 지문을 갱신하라');
  assert.equal(digest, committed.digest,
    '코퍼스 내용(이름·바이트)이 지문과 다르다 — 자가 바뀌었다. '
    + 'EXPECTED_RED.md 에 이벤트를 기록하고 regen 스크립트로 지문을 갱신하라 (F-105 규율)');
});
