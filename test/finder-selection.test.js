import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CENTER_QR_FINDER_PATTERN_ID,
  normalizeFinderQrState,
  selectFinderPattern,
  selectQrPosition,
} from '../src/finder-selection.js';

const OFFICIAL_DEFAULT = 'bullseye';
const TRIAL_DEFAULT = 'pinwheel-c2-2-1100-cw';

function state(overrides = {}) {
  return {
    finderPatternId: OFFICIAL_DEFAULT,
    previousFinderPatternId: OFFICIAL_DEFAULT,
    qrPosition: 'TL',
    previousOuterQrPosition: 'TL',
    ...overrides,
  };
}

test('O/A 중앙 QR 파인더 선택은 QR 위치를 안쪽으로 함께 고른다', () => {
  for (const type of ['O', 'A']) {
    const next = selectFinderPattern(
      state(), CENTER_QR_FINDER_PATTERN_ID, type, OFFICIAL_DEFAULT,
    );
    assert.equal(next.finderPatternId, CENTER_QR_FINDER_PATTERN_ID);
    assert.equal(next.qrPosition, 'inner');
    assert.equal(next.previousFinderPatternId, OFFICIAL_DEFAULT);
  }
});

test('O/A 안쪽 QR 선택은 직전 파인더를 기억하고 중앙 QR을 고른다', () => {
  for (const type of ['O', 'A']) {
    const next = selectQrPosition(state({
      finderPatternId: TRIAL_DEFAULT,
      previousFinderPatternId: TRIAL_DEFAULT,
    }), 'inner', type, TRIAL_DEFAULT);
    assert.equal(next.finderPatternId, CENTER_QR_FINDER_PATTERN_ID);
    assert.equal(next.qrPosition, 'inner');
    assert.equal(next.previousFinderPatternId, TRIAL_DEFAULT);
  }
});

test('안쪽에서 벗어나면 중앙 QR 대신 직전에 고른 파인더를 복원한다', () => {
  const centered = selectQrPosition(state({
    finderPatternId: TRIAL_DEFAULT,
    previousFinderPatternId: TRIAL_DEFAULT,
  }), 'inner', 'O', TRIAL_DEFAULT);
  const next = selectQrPosition(centered, 'BR', 'O', TRIAL_DEFAULT);
  assert.equal(next.finderPatternId, TRIAL_DEFAULT);
  assert.equal(next.qrPosition, 'BR');
  assert.equal(next.previousOuterQrPosition, 'BR');
});

test('직전 파인더 이력이 없으면 빌드별 기본값으로 복원한다', () => {
  for (const defaultFinder of [OFFICIAL_DEFAULT, TRIAL_DEFAULT]) {
    const next = normalizeFinderQrState(state({
      finderPatternId: CENTER_QR_FINDER_PATTERN_ID,
      previousFinderPatternId: null,
      qrPosition: 'TR',
    }), 'O', defaultFinder);
    assert.equal(next.finderPatternId, defaultFinder);
    assert.equal(next.qrPosition, 'TR');
  }
});

test('안쪽에서 다른 파인더를 고르면 직전 바깥 QR 위치도 함께 복원한다', () => {
  const next = selectFinderPattern(state({
    finderPatternId: CENTER_QR_FINDER_PATTERN_ID,
    previousFinderPatternId: OFFICIAL_DEFAULT,
    qrPosition: 'inner',
    previousOuterQrPosition: 'BL',
  }), TRIAL_DEFAULT, 'A', OFFICIAL_DEFAULT);
  assert.equal(next.finderPatternId, TRIAL_DEFAULT);
  assert.equal(next.qrPosition, 'BL');
});

test('Type Y의 안쪽 윈도는 파인더와 결합하지 않는다', () => {
  const initial = state({ finderPatternId: TRIAL_DEFAULT });
  const inner = selectQrPosition(initial, 'inner', 'Y', TRIAL_DEFAULT);
  assert.equal(inner.finderPatternId, TRIAL_DEFAULT);
  assert.equal(inner.qrPosition, 'inner');
  const outer = selectQrPosition(inner, 'BR', 'Y', TRIAL_DEFAULT);
  assert.equal(outer.finderPatternId, TRIAL_DEFAULT);
  assert.equal(outer.qrPosition, 'BR');
});

test('정규화는 멱등이고 중앙 QR/안쪽 모순을 한 번에 없앤다', () => {
  for (const inconsistent of [
    state({ finderPatternId: TRIAL_DEFAULT, qrPosition: 'inner' }),
    state({ finderPatternId: CENTER_QR_FINDER_PATTERN_ID, qrPosition: 'TR' }),
  ]) {
    const once = normalizeFinderQrState(inconsistent, 'O', OFFICIAL_DEFAULT);
    const twice = normalizeFinderQrState(once, 'O', OFFICIAL_DEFAULT);
    assert.deepEqual(twice, once);
    assert.equal(
      once.finderPatternId === CENTER_QR_FINDER_PATTERN_ID,
      once.qrPosition === 'inner',
    );
  }
});
