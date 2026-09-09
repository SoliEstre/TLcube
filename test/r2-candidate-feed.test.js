import test from 'node:test';
import assert from 'node:assert/strict';

import { buildR2Hit, createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { R2_INDICATOR, R2_SESSION_STATUS } from '../src/r2/session.js';
import { finalLayoutIdsForN } from '../src/cellSurfaceFinal.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

const LUMA = { width: 8, height: 8, data: new Float32Array(64) };

function adapterFor(n = 25, layoutId = finalLayoutIdsForN(n)[0]) {
  const stats = {
    n,
    locked: 1,
    gridLockF: 500,
    layoutId,
    lockRevision: 1,
    counters: { lockClears: 0, relocates: 0 },
    phaseMs: { detect: 0, align: 0 },
    format: {
      source: 'locator', eccName: 'H', maskIndex: 0, candidateCount: 1,
      formatWireVersion: 2, reason: '',
    },
  };
  const adapter = {
    stats,
    H: Float64Array.from([1, 0, 3, 0, 1, 5, 0, 0, 1]),
    throwDetection: false,
    detectInto(luma, width, height, timestamp, pose, output) {
      if (adapter.throwDetection) throw new Error('검출 예외');
      output.found = stats.locked ? 1 : 0;
      output.n = stats.locked ? stats.n : 0;
      output.layoutId = stats.layoutId;
      return R2_SESSION_STATUS.OK;
    },
    alignInto(luma, width, height, timestamp, pose, detection, output) {
      // 신원은 현재 코드로 검증하되 누적 weight는 0으로 두어 DONE/RS 경로와 분리한다.
      output.gatePassed = 1;
      output.weightQ15 = 0;
      output.mismatchCount = 0;
      output.matchCount = 1;
      output.visibleCount = 0;
      output.distrusted = 0;
      return R2_SESSION_STATUS.OK;
    },
    reset() { stats.locked = 0; },
    invalidateLock() {
      if (!stats.locked) return 0;
      stats.locked = 0;
      stats.lockRevision += 1;
      return 1;
    },
    projectCellFaceCentres() { return 0; },
  };
  return adapter;
}

function idNumber(id) {
  return Number(String(id).slice(String(id).lastIndexOf('-') + 1));
}

test('HUD feed는 후보별 소유 snapshot과 재사용 배열을 내고, 프레임 갱신에도 ID와 버퍼가 안정적이다', () => {
  const adapter = adapterFor(25);
  const runtime = createR2ScanRuntime({ enabled: true, adapters: adapter });
  const feed = runtime.hudCandidates;
  assert.equal(feed, runtime.hudCandidates, '빈 feed 배열도 재사용해야 한다');
  assert.equal(feed.length, 0);

  runtime.pushFrame(LUMA, 0);
  const rows = runtime.hudCandidates;
  assert.equal(rows, feed, 'bind 뒤 새 feed 배열을 할당했다');
  assert.equal(rows.length, finalLayoutIdsForN(25).length);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'D', 'H', 'alive', 'cellCount', 'cellMap', 'formatWire', 'frameHeight', 'frameWidth',
    'id', 'indicator', 'layoutId', 'n', 'retained', 'revision', 'tracking', 'type',
  ].sort(), 'HUD 후보 행의 additive contract shape가 다르다');
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, '후보 ID가 layout/index 충돌을 냈다');
  assert.ok(rows.every((row) => row.type === 'Y' && row.n === 25));
  assert.ok(rows.every((row) => row.formatWire === 2 && Number.isFinite(row.D)
    && Number.isInteger(row.indicator) && Number.isInteger(row.revision)));
  assert.ok(rows.every((row) => row.frameWidth === LUMA.width && row.frameHeight === LUMA.height));
  assert.ok(rows.every((row) => row.alive && row.tracking && !row.retained));
  assert.ok(rows.every((row) => row.cellMap instanceof Uint8Array && row.cellMap.length === row.cellCount));
  assert.equal(new Set(rows.map((row) => row.cellMap)).size, rows.length, '후보끼리 cellMap 사본을 공유한다');
  assert.ok(rows.every((row) => row.H instanceof Float64Array && row.H.length === 9));
  assert.equal(new Set(rows.map((row) => row.H)).size, rows.length, '후보끼리 H 사본을 공유한다');
  assert.ok(rows.every((row) => row.H !== adapter.H), '어댑터 H를 그대로 노출했다');

  const ids = rows.map((row) => row.id);
  const maps = rows.map((row) => row.cellMap);
  const homographies = rows.map((row) => row.H);
  const revisions = rows.map((row) => row.revision);
  adapter.H[2] = 9;
  runtime.pushFrame(LUMA, 100);
  assert.deepEqual(runtime.hudCandidates.map((row) => row.id), ids, '같은 세션에서 ID가 바뀌었다');
  for (let i = 0; i < rows.length; i += 1) {
    assert.equal(rows[i].cellMap, maps[i], '프레임마다 cellMap을 재할당했다');
    assert.equal(rows[i].H, homographies[i], '프레임마다 H를 재할당했다');
    assert.equal(rows[i].H[2], 9, 'fresh H를 소유 사본에 갱신하지 않았다');
    assert.ok(rows[i].revision > revisions[i], '프레임 갱신에서 revision이 안 올랐다');
  }
});

test('shelf는 ID와 마지막 snapshot을 보존하고, 복원은 같은 후보 세대를 되살린다', () => {
  const adapter = adapterFor(25);
  const runtime = createR2ScanRuntime({ enabled: true, adapters: adapter });
  runtime.pushFrame(LUMA, 0);
  const original = runtime.hudCandidates.map((row) => ({
    id: row.id, map: row.cellMap, H: row.H, layoutId: row.layoutId,
  }));

  adapter.stats.n = 13;
  adapter.stats.layoutId = 'v0';
  runtime.pushFrame(LUMA, 100);
  const switched = runtime.hudCandidates;
  const shelved = switched.filter((row) => row.n === 25);
  assert.equal(switched.filter((row) => row.n === 13).length, 1, '새 활성 후보가 feed에 없다');
  assert.equal(shelved.length, original.length, 'shelf 후보가 feed에서 사라졌다');
  for (const row of shelved) {
    const before = original.find((old) => old.id === row.id);
    assert.ok(before, 'shelf에서 후보 ID가 바뀌었다');
    assert.equal(row.cellMap, before.map);
    assert.equal(row.H, before.H);
    assert.equal(row.tracking, false);
    assert.equal(row.retained, true);
  }

  adapter.stats.n = 25;
  adapter.stats.layoutId = original[0].layoutId;
  runtime.pushFrame(LUMA, 200);
  const restored = runtime.hudCandidates;
  assert.deepEqual(restored.map((row) => row.id), original.map((row) => row.id));
  for (let i = 0; i < restored.length; i += 1) {
    assert.equal(restored[i].cellMap, original[i].map);
    assert.equal(restored[i].H, original[i].H);
    assert.equal(restored[i].tracking, true);
  }
});

test('reset/disable은 feed를 즉시 비우고 다음 bind에는 재사용하지 않은 단조 ID를 준다', () => {
  const adapter = adapterFor(13, 'v0');
  const runtime = createR2ScanRuntime({ enabled: true, adapters: adapter });
  runtime.pushFrame(LUMA, 0);
  const first = runtime.hudCandidates[0].id;

  runtime.reset();
  assert.equal(runtime.hudCandidates.length, 0);
  adapter.stats.locked = 1;
  runtime.pushFrame(LUMA, 100);
  const second = runtime.hudCandidates[0].id;
  assert.ok(idNumber(second) > idNumber(first), 'reset 뒤 후보 ID를 재사용했다');

  runtime.setEnabled(false);
  assert.equal(runtime.hudCandidates.length, 0);
  runtime.setEnabled(true);
  adapter.stats.locked = 1;
  runtime.pushFrame(LUMA, 200);
  const third = runtime.hudCandidates[0].id;
  assert.ok(idNumber(third) > idNumber(second), 'disable/re-enable 뒤 후보 ID를 재사용했다');
});

test('락 무효화와 검출 예외는 누적을 버리지 않고 즉시 retained/non-tracking으로 보인다', () => {
  const adapter = adapterFor(13, 'v0');
  const runtime = createR2ScanRuntime({ enabled: true, adapters: adapter });
  runtime.pushFrame(LUMA, 0);
  const row = runtime.hudCandidates[0];
  const id = row.id;
  const map = row.cellMap;
  const H = row.H;
  assert.equal(row.tracking, true);

  assert.equal(runtime.invalidateLock(), 1);
  assert.equal(runtime.hudCandidates[0].tracking, false);
  assert.equal(runtime.hudCandidates[0].retained, true);
  assert.equal(runtime.hudCandidates[0].id, id);
  assert.equal(runtime.hudCandidates[0].cellMap, map);
  assert.equal(runtime.hudCandidates[0].H, H, 'tracking loss에서 마지막 유효 H를 버렸다');

  adapter.stats.locked = 1;
  runtime.pushFrame(LUMA, 100);
  assert.equal(runtime.hudCandidates[0].tracking, true);
  adapter.throwDetection = true;
  assert.equal(runtime.pushFrame(LUMA, 200), null);
  assert.equal(runtime.hudCandidates[0].tracking, false, '검출 예외 뒤 stale active로 남았다');
  assert.equal(runtime.hudCandidates[0].retained, true);
});

test('HARD DROP은 기존 ID의 DROPPED 행을 보인 뒤 재획득 세대에 새 ID와 새 snapshot을 준다', () => {
  const adapter = adapterFor(13, 'v0');
  const runtime = createR2ScanRuntime({ enabled: true, adapters: adapter });
  runtime.pushFrame(LUMA, 0);
  const old = runtime.hudCandidates[0];
  const oldId = old.id;
  const oldMap = old.cellMap;
  const oldH = old.H;

  adapter.stats.locked = 0;
  let dropped = null;
  for (let frame = 1; frame <= 20; frame += 1) {
    runtime.pushFrame(LUMA, frame * 100);
    const row = runtime.hudCandidates[0];
    if (row && row.indicator === R2_INDICATOR.DROPPED) { dropped = row; break; }
  }
  assert.ok(dropped, 'nCoast 안에 HARD DROP을 만들지 못했다');
  assert.equal(dropped.id, oldId, 'DROPPED를 새 세대로 바꿔 옛 카드를 붉힐 수 없다');
  assert.equal(dropped.tracking, false);
  assert.equal(dropped.retained, true);
  const droppedRevision = dropped.revision;

  adapter.stats.locked = 1;
  runtime.pushFrame(LUMA, 3000);
  const reacquired = runtime.hudCandidates[0];
  assert.ok(idNumber(reacquired.id) > idNumber(oldId), '재획득 identity 세대가 ID를 바꾸지 않았다');
  assert.notEqual(reacquired.cellMap, oldMap, '새 세대가 옛 cellMap 표시 사본을 재사용했다');
  assert.notEqual(reacquired.H, oldH, '새 세대가 옛 H 표시 사본을 재사용했다');
  assert.equal(reacquired.tracking, true);
  assert.equal(dropped.id, oldId, '새 세대 생성이 model이 잡은 옛 row의 ID를 바꿨다');
  assert.equal(dropped.indicator, R2_INDICATOR.DROPPED, '새 세대 생성이 옛 드랍 카드를 덮어썼다');
  assert.equal(dropped.revision, droppedRevision, '새 세대 갱신이 옛 row를 다시 썼다');
});

test('DONE hit의 candidateId는 수용된 정확한 HUD 후보를 가리키고 feed 전체가 남는다', () => {
  const sequence = listLumaSequences().find((entry) => entry.name.split('/').pop() === 'y0');
  assert.ok(sequence && sequence.frames.length >= 3, '사진 junction의 y0 시퀀스가 필요하다');
  const runtime = createR2ScanRuntime({ enabled: true });
  let hit = null;
  for (let i = 0; i < Math.min(12, sequence.frames.length) && hit === null; i += 1) {
    hit = runtime.pushFrame(readLumaDump(sequence.frames[i].path), i * 100);
  }
  assert.ok(hit, 'y0 수용 DONE을 만들지 못했다');
  assert.equal(typeof hit.candidateId, 'string');
  assert.equal(JSON.parse(JSON.stringify(hit)).candidateId, hit.candidateId,
    'DONE ID가 JSON 기록에서 사라진다');
  assert.equal(({ ...hit }).candidateId, hit.candidateId,
    'DONE ID가 객체 spread 전달에서 사라진다');
  const exact = runtime.hudCandidates.find((row) => row.id === hit.candidateId);
  assert.ok(exact, 'DONE candidateId가 현재 feed의 후보를 가리키지 않는다');
  assert.equal(exact.layoutId, hit.layoutId);
  assert.equal(exact.indicator, R2_INDICATOR.DONE);
  assert.equal(runtime.hudCandidates.length, runtime.stats.candidateCount,
    'DONE 조기 반환이 후보 feed 일부를 누락했다');

  const legacyShape = buildR2Hit(
    { doneFrame: 1, format: { formatWire: 2 } },
    { text: 'x', layoutId: 'v0', n: 13, correctedCount: 0, correctedCells: new Uint16Array(0) },
  );
  assert.equal('candidateId' in legacyShape, false, 'candidateId 미제공 호출의 기존 exact shape를 바꿨다');
});
