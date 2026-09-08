import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { C_ACQUISITION_CHECKPOINT_LIMITS, createCAdapters, readCNotch } from '../src/r2/adapter-c.js';
import { alignCandidate, callDetect, syntheticC } from './r2-c-fixtures.js';

const CONTROL = '__r2N7RefineTestControl';

function sourceUrl(fromFile, relative) {
  return pathToFileURL(resolve(dirname(fileURLToPath(fromFile)), relative)).href;
}

/** 실제 포맷/노치/추적기는 유지하고, 장시간 영상 탐색만 유한한 진단 cursor로 대체해요. */
async function loadControlledAdapter() {
  const file = new URL('../src/r2/adapter-c.js', import.meta.url);
  let source = readFileSync(file, 'utf8');
  const replace = (needle, value) => {
    assert.ok(source.includes(needle), `제어용 import를 찾지 못했어요: ${needle.slice(0, 42)}`);
    source = source.replace(needle, value);
  };
  replace(`import {
  centralN7CenterPriorSeeds,
  centralN7Finders,
  centralN7FindersFromShapes,
} from '../decoder/central-n7-observe.js';`, `
const centralN7CenterPriorSeeds = () => [];
const centralN7Finders = () => globalThis.${CONTROL}.finders.map(H => ({ H: H.slice(), orientation: 0, centralN7: { family: 'hex' } }));
const centralN7FindersFromShapes = centralN7Finders;`);
  replace(`import { createVerifiedCursorPrototypeV3 } from '../decoder/cs-verified-cursor-v3-prototype.js';`, `
const createVerifiedCursorPrototypeV3 = () => {
  const status = { copyMs: 0, snapshotBytes: 0, phase: 'ready', steps: 0 };
  return { status, resume() { if (globalThis.${CONTROL}.pending) return { state: 'ready', ms: 0, unit: 'controlled-pending' }; status.phase = 'done'; return { state: 'done', ms: 0, unit: 'controlled-done' }; }, takeForFrame() { return { verified: [], coreCandidates: 1, clusterCount: 1 }; }, discard() { status.phase = 'discarded'; } };
};`);
  replace(`import { findCAnchorHypotheses } from '../decoder/anchor-detect.js';`, `const findCAnchorHypotheses = () => ({ hypotheses: [] });`);
  replace(`import { observeCqQrGeometry } from '../decoder/cq-observe.js';`, `
function* observeCqQrGeometry() { for (const H of globalThis.${CONTROL}.extra) { globalThis.${CONTROL}.extraCalls.cq++; yield { H: H.slice(), k: globalThis.${CONTROL}.k, sourceKind: 'c-cq' }; } }`);
  replace(`import { observeCDaehanGeometry } from '../decoder/c-daehan-observe.js';`, `
function* observeCDaehanGeometry() { for (const H of globalThis.${CONTROL}.extra) { globalThis.${CONTROL}.extraCalls.daehan++; yield { H: H.slice(), k: globalThis.${CONTROL}.k, sourceKind: 'c-daehan' }; } }`);
  replace(`import { createCqStructuralRefineCursor } from '../decoder/cq-structural-refine.js';`, `
const createCqStructuralRefineCursor = (_field, H) => {
  const status = { copyMs: 0, snapshotBytes: 0, snapshotRetainedBytes: 0, evaluations: 0, phase: 'ready' };
  return { status, resume() { status.evaluations++; status.phase = 'done'; return { state: 'done', ms: 0, unit: 'controlled-refine' }; }, takeForFrame() { globalThis.${CONTROL}.refinedTakes = (globalThis.${CONTROL}.refinedTakes ?? 0) + 1; return { H: H.slice() }; }, discard() { status.phase = 'discarded'; } };
};`);
  replace(`const decoded = task.finder?.centralN7 ? decodeSingle(task.finder.centralN7.outerFormat) : { ok: false };`,
    `const decoded = { ok: false };`);
  replace(`const H = task.H.slice(), notch = readCNotch(job.snapshot, H, task.k);`,
    `const H = task.H.slice(), rawNotch = readCNotch(job.snapshot, H, task.k), notch = (globalThis.${CONTROL}.forceAllNotch
      || (globalThis.${CONTROL}.forcePreRefinedNotch && !task.refined)) ? { ...rawNotch, ok: false } : rawNotch;`);
  let imports = 0;
  source = source.replace(/from\s+(['"])(\.[^'"]+)\1/g, (_whole, _quote, relative) => {
    imports++;
    return `from '${sourceUrl(file, relative)}'`;
  });
  assert.ok(imports > 0, '상대 import 고정 실패');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function changedField(field, serial) {
  const changed = { width: field.width, height: field.height, data: field.data.slice(), alpha: field.alpha?.slice() ?? null };
  // 한 픽셀만 아주 작게 바꿔 실제 snapshot 사본을 요구하면서 NCC 여유는 보존해요.
  changed.data[(serial * 7919) % changed.data.length] = Math.max(0, changed.data[(serial * 7919) % changed.data.length] - 0.002);
  return changed;
}

test('N7 체인 checkpoint는 8장 제한을 지키고 frame·time 만료를 각각 경계 밖에서만 실행하며 reset은 보유 바이트를 해제한다', { timeout: 30_000 }, async () => {
  const controlled = await loadControlledAdapter();
  const { field } = syntheticC(0, 'n7-checkpoint-bounds');
  globalThis[CONTROL] = { pending: true, forceAllNotch: false, forcePreRefinedNotch: false, finders: [], extra: [], extraCalls: { cq: 0, daehan: 0 }, k: 14 };
  const adapter = controlled.createCAdapters({ tracking: { minNcc: .96 }, refineN7: true, budget: { detectMs: Infinity } });
  const output = {};
  for (let frame = 0; frame <= 64; frame++) callDetect(adapter, changedField(field, frame), frame, output, frame * 100);
  assert.equal(adapter.stats.acquisitionExpirations, 0, '64 frame / 6400 ms 경계 안에서는 만료하지 않아야 해요');
  assert.equal(adapter.stats.acquisitionCheckpointCount, C_ACQUISITION_CHECKPOINT_LIMITS.maxSnapshots);
  assert.ok(adapter.stats.acquisitionCheckpointRetainedBytes <= C_ACQUISITION_CHECKPOINT_LIMITS.maxBytes);
  assert.equal(adapter.stats.totalRetainedBytes, adapter.stats.snapshotRetainedBytes + adapter.stats.cqRefineRetainedBytes
    + adapter.stats.trackingRetainedBytes + adapter.stats.acquisitionTrackingRetainedBytes, 'total은 각 보유 항목의 합이어야 해요');
  callDetect(adapter, changedField(field, 65), 65, output, 6500);
  assert.equal(adapter.stats.acquisitionExpirations, 1);
  assert.ok(adapter.stats.acquisitionCheckpointCount <= 1, '만료 뒤에는 새 획득만 남아야 해요');
  const timeOnly = controlled.createCAdapters({ tracking: { minNcc: .96 }, refineN7: true, budget: { detectMs: Infinity } });
  callDetect(timeOnly, changedField(field, 0), 0, {}, 0);
  callDetect(timeOnly, changedField(field, 1), 1, {}, 10_000);
  assert.equal(timeOnly.stats.acquisitionExpirations, 0, '10,000 ms 경계에서는 만료하지 않아야 해요');
  callDetect(timeOnly, changedField(field, 2), 2, {}, 10_001);
  assert.equal(timeOnly.stats.acquisitionExpirations, 1, 'fresh adapter에서는 시간 조건만으로 만료해야 해요');
  adapter.reset();
  timeOnly.reset();
  assert.equal(adapter.stats.acquisitionCheckpointRetainedBytes, 0);
  assert.equal(adapter.stats.totalRetainedBytes, 0);
  assert.equal(timeOnly.stats.totalRetainedBytes, 0);
  delete globalThis[CONTROL];
});

test('정지 입력의 pending N7 cursor는 64 frame·10 s 뒤에도 원본 origin에서 재개하고 checkpoint를 추가하지 않는다', { timeout: 30_000 }, async () => {
  const controlled = await loadControlledAdapter();
  const { field } = syntheticC(0, 'n7-static-resume');
  globalThis[CONTROL] = { pending: true, forceAllNotch: false, forcePreRefinedNotch: false, finders: [], extra: [], extraCalls: { cq: 0, daehan: 0 }, k: 14 };
  const adapter = controlled.createCAdapters({ tracking: { minNcc: .96 }, refineN7: true, budget: { detectMs: Infinity } });
  const output = {};
  for (let frame = 0; frame <= 101; frame++) callDetect(adapter, field, frame, output, frame * 100);
  assert.equal(adapter.stats.acquisitionExpirations, 0, '동일한 pixels의 정지 입력은 image-age만으로 만료하면 안 돼요');
  assert.equal(adapter.stats.acquisitionCheckpointCount, 0);
  assert.equal(adapter.stats.acquisitionCheckpointRetainedBytes, 0);
  assert.equal(adapter.stats.resumeCursor.phase, 'cursor');
  assert.equal(adapter.stats.resumeCursor.originFrameId, 0);
  assert.equal(adapter.stats.resumeCursor.originTimestamp, 0);
  adapter.reset();
  assert.equal(adapter.stats.totalRetainedBytes, 0);
  delete globalThis[CONTROL];
});

test('실제 refined N7 관측을 bind한 후보 fork는 완료 replay·새 origin 뒤에도 살아 있고 reset에서만 해제된다', { timeout: 30_000 }, async () => {
  const controlled = await loadControlledAdapter();
  const fixture = syntheticC(0, 'n7-fork-retention');
  globalThis[CONTROL] = { pending: false, forceAllNotch: false, forcePreRefinedNotch: true, finders: [fixture.H], extra: [], extraCalls: { cq: 0, daehan: 0 }, refinedTakes: 0, k: fixture.k };
  const adapter = controlled.createCAdapters({ tracking: { minNcc: .96 }, refineN7: true, budget: { detectMs: Infinity }, maxHypotheses: 16 });
  const output = {};
  let found = null;
  let frame = 0;
  for (; frame < 80 && !adapter.stats.scanComplete; frame++) {
    callDetect(adapter, fixture.field, frame, output);
    if (output.found && !found) found = { ...output, H: output.H.slice() };
  }
  assert.ok(found && adapter.stats.scanComplete, `N7 보정 관측/완료 없음: ${JSON.stringify(adapter.stats.resumeCursor)}`);
  assert.ok(globalThis[CONTROL].refinedTakes > 0, 'pre-refined 노치 실패 뒤 structural refine가 실제 완료되어야 해요');
  assert.equal(readCNotch(fixture.field, found.H, fixture.k).ok, true, 'refined H는 제품 최종 노치 문턱을 실제 통과해야 해요');
  const candidate = adapter.bindCandidate(found.observation, found.format);
  assert.ok(candidate, '실제 N7 보정 관측 bind 실패');
  const retained = adapter.stats.trackingRetainedBytes;
  assert.ok(retained > 0, '후보는 획득 job과 별도 tracker 사본을 소유해야 해요');
  callDetect(adapter, fixture.field, frame++, output); // 완료 job의 replay
  callDetect(adapter, fixture.field, frame++, output); // replay 다음 새 origin
  assert.ok(adapter.stats.resumeCursor.originFrameId > found.observation.originFrameId, '새 획득 origin이 시작되어야 해요');
  assert.equal(adapter.bindCandidate(found.observation, found.format), null, '회전 뒤 옛 관측 token은 다시 bind되면 안 돼요');
  assert.equal(candidate.invalidated, null);
  assert.ok(adapter.stats.trackingRetainedBytes >= retained);
  assert.equal(alignCandidate(candidate, fixture.field, frame).output.gatePassed, 1);
  adapter.reset();
  assert.equal(adapter.stats.trackingRetainedBytes, 0);
  assert.equal(candidate.invalidated, 'reset');
  delete globalThis[CONTROL];
});

test('N7 보정은 최대 세 번 뒤 CQ/대한 extra 한 단위를 양보하고, 빈 hint는 현재 포맷 판독을 막지 않는다', { timeout: 30_000 }, async () => {
  const controlled = await loadControlledAdapter();
  const fixture = syntheticC(0, 'n7-refine-fairness');
  globalThis[CONTROL] = { pending: false, forceAllNotch: true, forcePreRefinedNotch: false, finders: [fixture.H, fixture.H, fixture.H, fixture.H], extra: [fixture.H], extraCalls: { cq: 0, daehan: 0 }, k: fixture.k };
  const units = [];
  const adapter = controlled.createCAdapters({ geometrySources: ['n7', 'cq', 'daehan'], tracking: { minNcc: .96 }, refineN7: true,
    budget: { detectMs: Infinity }, maxHypotheses: 32, timing: row => units.push(row.unit) });
  const output = {};
  let found = 0;
  for (let frame = 0; frame < 40 && !adapter.stats.scanComplete; frame++) { callDetect(adapter, fixture.field, frame, output); found += output.found; }
  assert.equal(adapter.stats.scanComplete, true, '유한한 refine/extra queue는 반드시 완료해야 해요');
  assert.ok(adapter.stats.cqRefineQueued >= 4, `N7 보정 queue 부족: ${JSON.stringify({ queued: adapter.stats.cqRefineQueued, phase: adapter.stats.resumeCursor?.phase, hypotheses: adapter.stats.hypothesesTried, notch: adapter.stats.notchRejects, reads: adapter.stats.formatReads, rejects: adapter.stats.formatRejects })}`);
  assert.equal(adapter.stats.cqRefineCompleted, adapter.stats.cqRefineQueued, 'queue의 모든 보정은 완료되어야 해요');
  const firstExtra = units.findIndex(unit => unit === 'geometry-cq' || unit === 'geometry-daehan');
  assert.ok(firstExtra >= 0, `CQ/대한 extra가 service되지 않았어요: ${units.join(',')}`);
  const priorRefines = units.slice(0, firstExtra).filter(unit => unit === 'cq-refine').length;
  assert.ok(priorRefines <= 3, `extra 이전 보정 서비스가 quantum을 넘었어요: ${priorRefines}`);
  assert.ok(globalThis[CONTROL].extraCalls.cq >= 1 && globalThis[CONTROL].extraCalls.daehan >= 1, 'CQ와 대한 source 모두 실제 한 단위 이상 service해야 해요');
  assert.equal(found, 0, '강제 노치 실패 진단은 관측을 publish하면 안 돼요');
  assert.ok(adapter.stats.formatReads > 0, '빈 N7 outer hint에서도 유효한 C0 format은 실제로 읽혀야 해요');
  delete globalThis[CONTROL];
});
