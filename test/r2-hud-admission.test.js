import test from 'node:test';
import assert from 'node:assert/strict';

import { createCandidateHudModel, R2_CANDIDATE_SUCCESS_MS } from '../src/r2-candidate-hud-model.js';

import { createAcceptStopGate } from '../src/scanner-accept-delay.js';

function row(id, D = 0) {
  return { id, type: 'Y', n: 13, layoutId: 'v0', D, alive: true, tracking: true, retained: false,
    indicator: 2, cellMap: new Uint8Array(), revision: 1 };
}

function clock() {
  let now = 0;
  let next = 1;
  const jobs = new Map();
  return {
    now: () => now,
    setTimer(fn, ms) { const id = next++; jobs.set(id, { due: now + ms, fn }); return id; },
    clearTimer(id) { jobs.delete(id); },
    advance(to) {
      now = to;
      for (;;) {
        const due = [...jobs.entries()].filter(([, job]) => job.due <= now);
        if (due.length === 0) break;
        for (const [id, job] of due) { jobs.delete(id); job.fn(); }
      }
    },
    live: () => jobs.size,
  };
}

test('12 fade 좌석은 winner를 축출하지 않고, 실제 admission 뒤에만 초록 150ms와 한 번의 결과를 시작해요', () => {
  const hud = createCandidateHudModel();
  const time = clock();
  const gate = createAcceptStopGate({ setTimer: time.setTimer, clearTimer: time.clearTimer });
  const old = Array.from({ length: 12 }, (_, index) => row(`old-${index}`, index / 20));
  const winner = { ...row('winner', 1), type: 'C', geometryMode: 'c-hex', revision: 7,
    cellMap: new Uint8Array([2, 1, 0]) };
  let accepted = false;
  let expires = 0;
  let shown = 0;
  const renderThenAccept = () => {
    hud.update([winner], time.now());
    accepted ||= hud.accept(winner.id, time.now());
    return accepted;
  };
  const stop = () => {
    expires++;
    const rest = gate.take();
    if (rest) rest();
  };

  hud.update(old, 0);
  hud.update([], 0); // 12개는 180ms 동안 drop slot을 유지한다.
  assert.equal(gate.arm(R2_CANDIDATE_SUCCESS_MS, () => { shown++; }, stop, renderThenAccept), true);
  assert.equal(gate.isPending(), true);
  assert.equal(accepted, false);
  assert.equal(hud.slots.some((slot) => slot?.status === 'success'), false);
  assert.equal(time.live(), 0, 'admission 전에는 150ms 타이머가 시작되면 안 돼요');

  time.advance(179);
  hud.update([winner], time.now());
  assert.equal(gate.poll(), false);
  assert.equal(hud.slots.some((slot) => slot?.status === 'success'), false);
  assert.equal(time.live(), 0);

  time.advance(180);
  hud.update([winner], time.now());
  assert.equal(gate.poll(), true);
  assert.equal(accepted, true);
  const success = hud.slots.find((slot) => slot?.id === winner.id);
  assert.equal(success?.status, 'success');
  assert.strictEqual(success?.candidate, winner, 'DONE은 자신의 HUD snapshot을 초록으로 바꿔야 해요');
  assert.equal(time.live(), 1);

  time.advance(329);
  assert.equal(expires, 0);
  assert.equal(shown, 0);
  time.advance(330);
  assert.equal(expires, 1);
  assert.equal(shown, 1);
  assert.equal(gate.isPending(), false);
  assert.equal(gate.take(), null, '만료가 회수한 결과를 또 꺼내면 안 돼요');
  time.advance(1000);
  assert.equal(expires, 1);
  assert.equal(shown, 1);
});

test('ready 대기 중 리셋·전환 회수는 타이머 없이 나머지 절반을 한 번만 내줘요', () => {
  const hud = createCandidateHudModel();
  const time = clock();
  const gate = createAcceptStopGate({ setTimer: time.setTimer, clearTimer: time.clearTimer });
  const old = Array.from({ length: 12 }, (_, index) => row(`old-${index}`));
  const winner = row('winner', 1);
  let shown = 0;
  hud.update(old, 0); hud.update([], 0);
  const ready = () => { hud.update([winner], time.now()); return hud.accept(winner.id, time.now()); };
  assert.equal(gate.arm(R2_CANDIDATE_SUCCESS_MS, () => { shown++; }, () => assert.fail('대기 중 만료'), ready), true);
  assert.equal(gate.isPending(), true);
  assert.equal(time.live(), 0);
  const rest = gate.take(); // manual reset / engine switch / lifecycle stopCamera
  assert.equal(typeof rest, 'function');
  rest();
  assert.equal(shown, 1);
  assert.equal(gate.take(), null);
  assert.equal(gate.poll(), false);
  time.advance(1000);
  assert.equal(shown, 1);
  assert.equal(hud.slots.some((slot) => slot?.status === 'success'), false);
});
