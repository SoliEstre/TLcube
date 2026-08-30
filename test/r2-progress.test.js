import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_MAP_STATE,
  PROGRESS_STATUS,
  createProgress,
  resetProgress,
  setCellMapState,
  updateProgress,
} from '../src/r2/progress.js';

test('표시 D는 내부 C_eff 하락을 주입해도 같은 track에서 후퇴하지 않는다', () => {
  const progress = createProgress(12);
  const sequence = [0, 1, 2, 4, 3, 2, 6, 5, 9, 12];
  let previous = 0;

  for (const cEff of sequence) {
    const internal = Math.min(1, cEff / 12);
    const view = updateProgress(progress, cEff, 10, 2);
    assert.equal(view.status, PROGRESS_STATUS.OK);
    assert.ok(view.D >= previous);
    assert.equal(view.hold, internal < previous ? 1 : 0);
    previous = view.D;
  }
});

test('C_eff가 K+m에 닿는 정확한 순간 D=1이다', () => {
  const progress = createProgress(5);
  assert.ok(updateProgress(progress, 6.999, 5, 2).D < 1);
  assert.equal(updateProgress(progress, 7, 5, 2).D, 1);
  assert.equal(updateProgress(progress, 700, 5, 2).D, 1);
});

test('셀맵은 셀당 1바이트이며 상태 코드를 제자리 갱신한다', () => {
  for (let cellCount = 0; cellCount <= 128; cellCount += 7) {
    const progress = createProgress(cellCount);
    assert.ok(progress.cellMap instanceof Uint8Array);
    assert.equal(progress.cellMap.length, cellCount);
    assert.equal(progress.view.cellMap, progress.cellMap);
    if (cellCount > 0) {
      assert.equal(
        setCellMapState(progress, cellCount - 1, CELL_MAP_STATE.CONFIRMED),
        PROGRESS_STATUS.OK,
      );
      assert.equal(progress.cellMap[cellCount - 1], CELL_MAP_STATE.CONFIRMED);
    }
  }
});

test('명시적 reset만 표시값과 셀맵을 0으로 되돌린다', () => {
  const progress = createProgress(3);
  updateProgress(progress, 2, 1, 1);
  setCellMapState(progress, 0, CELL_MAP_STATE.ERASURE);
  const cellMapReference = progress.cellMap;

  const view = resetProgress(progress);
  assert.equal(view.D, 0);
  assert.equal(view.internalD, 0);
  assert.equal(view.hold, 0);
  assert.equal(view.cellMap, cellMapReference);
  assert.deepEqual(view.cellMap, new Uint8Array(3));
});
