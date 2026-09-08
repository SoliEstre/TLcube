import test from 'node:test';
import assert from 'node:assert/strict';
import { R2_INDICATOR } from '../src/r2/session.js';
import {
  R2_CANDIDATE_COLORS,
  R2_CANDIDATE_DROP_MS,
  R2_CANDIDATE_SLOTS,
  R2_CANDIDATE_SUCCESS_MS,
  createCandidateHudModel,
} from '../src/r2-candidate-hud-model.js';

function candidate(id, D = 0, overrides = {}) {
  return Object.freeze({
    id,
    type: 'Y',
    n: 25,
    layoutId: 'v0tr',
    D,
    indicator: 2,
    tracking: true,
    retained: false,
    cellMap: new Uint8Array([0, 1, 2]),
    cellCount: 3,
    H: new Float64Array(9),
    frameWidth: 1280,
    frameHeight: 720,
    formatWire: 2,
    revision: 1,
    ...overrides,
  });
}

test('exports the fixed twelve-color ring and timing contract', () => {
  assert.equal(R2_CANDIDATE_COLORS.length, 12);
  assert.ok(R2_CANDIDATE_COLORS.every((color) => typeof color === 'string'));
  assert.deepEqual(R2_CANDIDATE_SLOTS, [[0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1],
    [3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2]]);
  assert.equal(R2_CANDIDATE_SUCCESS_MS, 150);
  assert.equal(R2_CANDIDATE_DROP_MS, 180);
});

test('survivors keep slots and holes are filled without reflow', () => {
  const model = createCandidateHudModel();
  model.update([candidate('a', 0.2), candidate('b', 0.3), candidate('c', 0.1)], 0);
  assert.equal(model.slots[0].slot, 0);
  assert.deepEqual(model.slots[0].position, [0, 3]);
  model.update([candidate('a', 0.2), candidate('c', 0.1)], 10);
  assert.equal(model.slots[1].status, 'dropped');
  model.update([candidate('a', 0.2), candidate('c', 0.1)], 190);
  assert.equal(model.slots[1], null);
  model.update([candidate('a', 0.2), candidate('c', 0.1), candidate('d', 0.4)], 191);
  assert.equal(model.slots[0].id, 'a');
  assert.equal(model.slots[1].id, 'd');
  assert.equal(model.slots[2].id, 'c');
});

test('missing and alive false candidates show red then free only on explicit time', () => {
  const model = createCandidateHudModel();
  model.update([candidate('a')], 100);
  model.update([], 110);
  assert.deepEqual({ status: model.slots[0].status, color: model.slots[0].color,
    opacity: model.slots[0].opacity, dropUntil: model.slots[0].dropUntil },
  { status: 'dropped', color: '#ef4444', opacity: 1, dropUntil: 290 });
  assert.equal(model.slots[0].status, 'dropped');
  model.update([], 200);
  assert.equal(model.slots[0].opacity, 0.5);
  model.update([candidate('a', 0, { alive: false })], 289);
  assert.equal(model.slots[0].status, 'dropped');
  model.update([], 290);
  assert.equal(model.slots[0], null);
});

test('hard-drop indicator cannot occupy or lead a live slot even if alive is omitted', () => {
  const model = createCandidateHudModel();
  model.update([candidate('a', 1), candidate('b', .4)], 0);
  const dead = candidate('a', 1, { indicator: R2_INDICATOR.DROPPED });
  model.update([dead, candidate('b', .4)], 10);
  assert.equal(model.slots[0].status, 'dropped');
  assert.equal(model.leaderId, 'b');
  assert.equal(model.accept('a', 11), false);
  model.update([dead, candidate('b', .4)], 10 + R2_CANDIDATE_DROP_MS);
  assert.equal(model.slots[0], null);
  assert.equal(model.slots[1].id, 'b');
});

test('same id revives its dropping slot and receives no inherited timer', () => {
  const model = createCandidateHudModel();
  const first = candidate('same', 0.1);
  const revived = candidate('same', 0.7, { revision: 2 });
  model.update([first], 0);
  model.update([], 10);
  model.update([revived], 100);
  assert.equal(model.slots[0].id, 'same');
  assert.equal(model.slots[0].status, 'active');
  assert.equal(model.slots[0].dropUntil, 0);
  assert.strictEqual(model.slots[0].candidate, revived);
  model.update([revived], 1000);
  assert.equal(model.slots[0].status, 'active');
});

test('an id returning after expiry is a new allocation, not an old timer', () => {
  const model = createCandidateHudModel();
  model.update([candidate('a'), candidate('same')], 0);
  model.update([candidate('same')], 1);
  model.update([], 2);
  model.update([], 181);
  assert.equal(model.slots[0], null);
  assert.equal(model.slots[1].status, 'dropped');
  const regenerated = candidate('same', 0.8, { revision: 9 });
  model.update([regenerated], 182);
  assert.equal(model.slots[0].id, 'same');
  assert.equal(model.slots[0].dropUntil, 0);
  assert.strictEqual(model.slots[0].candidate, regenerated);
});

test('leader crosses on higher finite D and ties preserve leader then earliest slot', () => {
  const model = createCandidateHudModel();
  model.update([candidate('a', 0.4), candidate('b', 0.3)], 0);
  assert.equal(model.leaderId, 'a');
  model.update([candidate('a', 0.4), candidate('b', 0.5)], 1);
  assert.equal(model.leaderId, 'b');
  model.update([candidate('a', 0.5), candidate('b', 0.5)], 2);
  assert.equal(model.leaderId, 'b');
  model.update([candidate('a', 0.5)], 3);
  assert.equal(model.leaderId, 'a');
});

test('retained and coast rows remain rankable at reduced opacity', () => {
  const model = createCandidateHudModel();
  model.update([candidate('retained', 0.9, { retained: true }),
    candidate('coast', 0.8, { tracking: false }), candidate('live', 0.7)], 0);
  assert.equal(model.leaderId, 'retained');
  assert.equal(model.slots[0].status, 'retained');
  assert.equal(model.slots[0].opacity, 0.38);
  assert.equal(model.slots[1].status, 'retained');
  assert.equal(model.slots[1].opacity, 0.38);
});

test('restored tracking returns full opacity without moving the slot', () => {
  const model = createCandidateHudModel();
  model.update([candidate('a', 0.2, { tracking: false })], 0);
  model.update([candidate('a', 0.3, { tracking: true, revision: 2 })], 1);
  assert.equal(model.slots[0].id, 'a');
  assert.equal(model.slots[0].opacity, 1);
});

test('accept requires a live existing id and success is explicit and sticky', () => {
  const model = createCandidateHudModel();
  model.update([candidate('coast', 0.5, { tracking: false, indicator: 4 })], 10);
  assert.equal(model.slots[0].status, 'retained', 'DONE must not become green implicitly');
  assert.equal(model.accept('wrong', 20), false);
  assert.equal(model.accept('coast', 20), true);
  assert.deepEqual({ status: model.slots[0].status, color: model.slots[0].color,
    dropUntil: model.slots[0].dropUntil }, { status: 'success', color: '#22c55e', dropUntil: 170 });
  model.update([], 1000);
  assert.equal(model.slots[0].status, 'success');
  assert.equal(model.slots[0].id, 'coast');
});

test('a dropped id cannot be accepted', () => {
  const model = createCandidateHudModel();
  model.update([candidate('a')], 0);
  model.update([], 1);
  assert.equal(model.accept('a', 2), false);
  assert.equal(model.slots[0].status, 'dropped');
});

test('reset clears slots, leader, success, and drop state', () => {
  const model = createCandidateHudModel();
  model.update([candidate('a', 0.9), candidate('b', 0.2)], 0);
  model.accept('a', 1);
  model.update([candidate('a', 0.9)], 2);
  model.reset();
  assert.deepEqual(model.slots, new Array(12).fill(null));
  assert.equal(model.leaderId, null);
  model.update([candidate('fresh', 0.1)], 10000);
  assert.equal(model.slots[0].id, 'fresh');
});

test('overflow never evicts and a still-present overflow row enters a later hole', () => {
  const model = createCandidateHudModel();
  const full = Array.from({ length: 12 }, (_, index) => candidate(`c${index}`, index / 20));
  model.update([...full, candidate('overflow', 1)], 0);
  assert.equal(model.slots.filter(Boolean).length, 12);
  assert.equal(model.slots.some((slot) => slot.id === 'overflow'), false);
  model.update([...full.slice(1), candidate('overflow', 1)], 1);
  assert.equal(model.slots[0].status, 'dropped');
  model.update([...full.slice(1), candidate('overflow', 1)], 181);
  assert.equal(model.slots[0].id, 'overflow');
  assert.equal(model.leaderId, 'overflow');
});

test('invalid D never leads and input rows and typed cell maps stay untouched', () => {
  const model = createCandidateHudModel();
  const invalid = candidate('invalid', Number.NaN);
  const infinite = candidate('infinite', Infinity);
  const valid = candidate('valid', 0.1);
  const before = Array.from(valid.cellMap);
  const output = model.update([invalid, infinite, valid], 0);
  assert.equal(model.leaderId, 'valid');
  assert.strictEqual(output[2].candidate, valid);
  assert.deepEqual(Array.from(valid.cellMap), before);
  model.update([invalid, infinite], 1);
  assert.equal(model.leaderId, null);
});
