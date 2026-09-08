import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { encode } from '../src/encode.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { createCCandidateRuntime } from '../src/r2/c-candidate-runtime.js';
import { createCAdapters } from '../src/r2/adapter-c.js';
import { buildScene } from '../src/scene.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import { decodeCandidate, observeAll } from './r2-c-fixtures.js';

const preset = getPreset(DEFAULT_PRESET);
const palette = { background: preset.background, levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };
const ALL_SOURCES = Object.freeze(['n7', 'cq', 'daehan']);

function fixture(kind) {
  const text = `extra-${kind}-M`;
  const options = kind === 'CQ0' ? { centerQr: true }
    : kind === 'C0D' ? { daehanFinder: true } : { centralN7: true };
  const sceneOptions = kind === 'CQ0' ? { centerQr: true, qrText: 'HTTPS://TL.ESTRE.SO/' }
    : kind === 'C0D' ? { finderPatternId: daehanPatternId(10) }
      : { finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID, centralN7Family: 'hex' };
  const encoded = encode(text, { version: 0, eccLevel: 'M', notchC: true, ...options });
  const scene = buildScene(encoded, { palette, margin: 20, cellSize: 12, ...sceneOptions });
  return { text, layoutId: kind, field: toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 1, supersample: 1 })) };
}

function sourceUrl(fromFile, relative) {
  return pathToFileURL(resolve(dirname(fileURLToPath(fromFile)), relative)).href;
}

async function loadOldEmptyHintAdapter() {
  const file = new URL('../src/r2/adapter-c.js', import.meta.url);
  let source = readFileSync(file, 'utf8');
  const current = '{ k: task.k, layoutHint: layoutHint.length ? layoutHint : undefined }';
  assert.ok(source.includes(current), '수리한 conditional을 찾지 못했다');
  source = source.replace(current, '{ k: task.k, layoutHint }');
  let imports = 0;
  source = source.replace(/from\s+(['"])(\.[^'"]+)\1/g, (_whole, _quote, specifier) => {
    imports++;
    return `from '${sourceUrl(file, specifier)}'`;
  });
  assert.ok(imports > 0, 'in-memory loader가 상대 import를 고정하지 못했다');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function firstDone(makeAdapter, input) {
  const adapters = makeAdapter({ geometrySources: ALL_SOURCES, maxHypotheses: 256,
    budget: { detectMs: Infinity } });
  const runtime = createCCandidateRuntime({ maxIdleFrames: 160, adapters });
  let hit = null;
  for (let frame = 0; frame < 100_000 && !hit; frame++) {
    hit = runtime.pushFrame(input.field, frame, { frameId: frame, runDetect: true, maxCandidates: 32 });
  }
  return { hit, runtime, adapters };
}

function queuedObservedCandidates(count, { doneIndex = null } = {}) {
  const input = fixture('C0');
  let startFrame = 0;
  const source = Array.from({ length: count }, (_unused, index) => {
    const acquired = observeAll(input.field);
    startFrame = Math.max(startFrame, acquired.calls);
    let candidate = null;
    for (const row of acquired.rows) {
      if (row.format.kind !== 'read' || row.format.layoutId !== 'C0') continue;
      const bound = acquired.adapter.bindCandidate(row.observation, row.format);
      if (!bound) continue;
      if (index !== doneIndex || decodeCandidate(bound, input.field, acquired.calls).done) {
        candidate = bound; break;
      }
      bound.dispose();
    }
    assert.ok(candidate, '실제 관측 후보 bind 실패');
    return { candidate, tracker: acquired.adapter };
  });
  assert.equal(source.length, count);
  const disposed = [], aligns = Array(count).fill(0), forcedInvalidated = Array(count).fill(false);
  const candidates = source.map(({ candidate }, index) => ({
    key: candidate.key,
    bound: candidate.bound,
    get invalidated() { return forcedInvalidated[index] || candidate.invalidated; },
    alignInto(...args) {
      aligns[index]++;
      const status = candidate.alignInto(...args);
      if (doneIndex !== null && index !== doneIndex) args[6].weightQ15 = 0;
      return status;
    },
    dispose() { disposed.push(index + 1); candidate.dispose(); },
  }));
  let cursor = 0, pending = null, token = 0, binds = 0;
  const adapters = {
    stats: { budgetHits: 0, scanComplete: false },
    reset() {},
    detectInto(detectField, width, height, timestamp, pose, output) {
      // 첫 실제 후보의 관측 추적도 같은 프레임으로 전진시킨다.
      source[0].tracker.detectInto(detectField, width, height, timestamp, pose, {});
      if (cursor >= candidates.length) { output.found = 0; output.observation = null; return; }
      pending = { id: ++token };
      output.found = 1;
      output.observation = pending;
      output.format = { kind: 'read' };
    },
    bindCandidate(observation) {
      assert.equal(observation, pending);
      binds++;
      return candidates[cursor++];
    },
  };
  return { input, adapters, disposed, aligns, startFrame,
    invalidate(candidate) { forcedInvalidated[candidates.indexOf(candidate)] = true; },
    get binds() { return binds; } };
}

test('setCapacity는 실제 bind된 C 후보를 최신순 폐기하고 frame·누적·할당 없이 fresh bind를 허용한다', {
  timeout: 120_000,
}, () => {
  const queued = queuedObservedCandidates(4);
  const runtime = createCCandidateRuntime({ maxIdleFrames: 160, adapters: queued.adapters });
  for (let frame = 0; frame < 3; frame++) {
    const at = queued.startFrame + frame;
    runtime.pushFrame(queued.input.field, at, { frameId: at, runDetect: true, maxCandidates: 3 });
  }
  assert.equal(runtime.stats.candidateCount, 3);
  assert.equal(queued.binds, 3);
  const before = { frames: runtime.stats.frames, aligns: [...queued.aligns],
    progressD: runtime.stats.progressD, indicator: runtime.stats.indicator,
    leadingLayoutId: runtime.stats.leadingLayoutId, candidates: structuredClone(runtime.stats.candidates) };

  assert.throws(() => runtime.setCapacity(-1), TypeError);
  assert.throws(() => runtime.setCapacity(1.5), TypeError);
  runtime.setCapacity(3);
  assert.deepEqual({ progressD: runtime.stats.progressD, indicator: runtime.stats.indicator,
    leadingLayoutId: runtime.stats.leadingLayoutId, candidates: runtime.stats.candidates }, {
    progressD: before.progressD, indicator: before.indicator,
    leadingLayoutId: before.leadingLayoutId, candidates: before.candidates,
  }, '동일 capacity/no eviction은 진행 의미를 바꾸지 않아야 한다');
  assert.equal(runtime.stats.frames, before.frames);
  assert.deepEqual(queued.aligns, before.aligns);
  assert.equal(queued.binds, 3);

  runtime.setCapacity(2);
  assert.deepEqual(queued.disposed, [3], '최신 후보부터 폐기');
  assert.equal(runtime.stats.candidateCount, 2);
  assert.equal(runtime.stats.candidates.length, 2);
  assert.equal(runtime.leading?.node.runtime.disposed ?? false, false);
  assert.equal(runtime.stats.frames, before.frames);
  assert.deepEqual(queued.aligns, before.aligns);
  assert.equal(queued.binds, 3);

  const sameFrame = queued.startFrame + 2;
  runtime.pushFrame(queued.input.field, sameFrame, { frameId: sameFrame, runDetect: false, maxCandidates: 0 });
  assert.deepEqual(queued.disposed, [3, 2, 1]);
  assert.equal(runtime.stats.candidateCount, 0);
  assert.deepEqual(runtime.stats.candidates, []);
  assert.equal(runtime.leading, null);
  assert.equal(runtime.stats.progressD, 0);
  assert.equal(runtime.stats.leadingLayoutId, '');
  assert.deepEqual(queued.aligns, before.aligns, 'same-frame cap trim 뒤 폐기 세션을 align하지 않아야 한다');
  assert.equal(runtime.stats.frames, before.frames, 'setCapacity/same-frame trim은 frame을 늘리지 않아야 한다');

  const freshFrame = queued.startFrame + 3;
  runtime.pushFrame(queued.input.field, freshFrame, { frameId: freshFrame, runDetect: true, maxCandidates: 1 });
  assert.equal(runtime.stats.candidateCount, 1);
  assert.equal(queued.binds, 4, 'trim 뒤 새 관측은 fresh bind한다');
  assert.deepEqual(queued.aligns.slice(0, 3), before.aligns.slice(0, 3), '폐기 세션 재사용 금지');
  assert.equal(queued.aligns[3], 1);
});

test('앞쪽 DONE 뒤 생존 후보만 HUD 표에 남고 leading null에서도 부분·0 capacity가 정합화된다', {
  timeout: 120_000,
}, () => {
  const queued = queuedObservedCandidates(4, { doneIndex: 3 });
  const runtime = createCCandidateRuntime({ maxIdleFrames: 500, adapters: queued.adapters });
  for (let frame = 0; frame < 4; frame++) {
    const at = queued.startFrame + frame;
    runtime.pushFrame(queued.input.field, at, { frameId: at, runDetect: true, maxCandidates: 4 });
  }
  let frame = queued.startFrame + 4;
  while (runtime.stats.done === 0 && frame < queued.startFrame + 200) {
    runtime.pushFrame(queued.input.field, frame, { frameId: frame, runDetect: true, maxCandidates: 4 });
    frame++;
  }
  assert.ok(runtime.stats.done > 0, `실제 C0 후보가 DONE에 닿아야 한다 ${JSON.stringify({ stats: runtime.stats, disposed: queued.disposed, aligns: queued.aligns })}`);
  assert.ok(runtime.stats.candidateCount >= 2, 'DONE 뒤 뒤쪽 실제 후보가 둘 이상 살아야 한다');
  assert.equal(runtime.leading, null, 'DONE leading은 소비되어 null이어야 한다');

  const beforeFrames = runtime.stats.frames;
  const beforeAligns = [...queued.aligns];
  const partial = runtime.stats.candidateCount - 1;
  runtime.setCapacity(partial);
  assert.equal(runtime.stats.candidateCount, partial);
  assert.equal(runtime.stats.candidates.length, partial);
  assert.ok(runtime.stats.candidates.every(row => row.key !== undefined));
  assert.ok(runtime.leading, '남은 후보의 직전 결과로 leading을 다시 세워야 한다');
  assert.equal(runtime.leading.node.runtime.disposed, false);
  assert.equal(runtime.stats.progressD, runtime.leading.D);
  assert.equal(runtime.stats.leadingLayoutId, runtime.leading.node.candidate.key.layoutId);
  assert.equal(runtime.stats.frames, beforeFrames);
  assert.deepEqual(queued.aligns, beforeAligns);

  const beforeSameFrameAligns = [...queued.aligns];
  queued.invalidate(runtime.leading.node.candidate);
  const lastFrame = frame - 1;
  runtime.pushFrame(queued.input.field, lastFrame, { frameId: lastFrame, runDetect: false, maxCandidates: partial });
  assert.equal(runtime.stats.candidateCount, partial - 1);
  assert.equal(runtime.stats.candidates.length, partial - 1);
  assert.equal(runtime.leading?.node.runtime.disposed ?? false, false);
  assert.equal(runtime.stats.frames, beforeFrames);
  assert.ok(queued.aligns.some((value, index) => value > beforeSameFrameAligns[index]),
    'same-frame 검증은 수행하되 session 누적 frame은 늘리지 않는다');

  const afterSameFrameAligns = [...queued.aligns];
  runtime.setCapacity(0);
  assert.equal(runtime.stats.candidateCount, 0);
  assert.deepEqual(runtime.stats.candidates, []);
  assert.equal(runtime.leading, null);
  assert.equal(runtime.stats.progressD, 0);
  assert.equal(runtime.stats.indicator, 0);
  assert.equal(runtime.stats.leadingLayoutId, '');
  assert.equal(runtime.stats.frames, beforeFrames);
  assert.deepEqual(queued.aligns, afterSameFrameAligns);
});

test('C0/CQ0/C0D M은 모든 geometry source가 켜져도 실제 detect→bind→RS first-DONE에 닿는다', {
  timeout: 300_000,
}, () => {
  for (const kind of ['C0', 'CQ0', 'C0D']) {
    const input = fixture(kind);
    const run = firstDone(createCAdapters, input);
    assert.ok(run.hit, `${kind}: first-DONE 없음 ${JSON.stringify(run.runtime.stats)}`);
    assert.equal(run.hit.text, input.text, kind);
    assert.equal(run.hit.layoutId, input.layoutId, kind);
    assert.ok(run.runtime.stats.binds > 0, `${kind}: bind 없음`);
    assert.ok(run.runtime.stats.detectCalls > 0 && run.runtime.stats.decodeAttempts > 0, `${kind}: detect/RS 호출 없음`);
  }
});

test('old empty-array hint 변이는 CQ0/C0D의 실제 runtime bind를 막는다', {
  timeout: 300_000,
}, async () => {
  const { createCAdapters: oldAdapter } = await loadOldEmptyHintAdapter();
  for (const kind of ['CQ0', 'C0D']) {
    const input = fixture(kind);
    const run = firstDone(oldAdapter, input);
    assert.equal(run.hit, null, `${kind}: old empty hint가 잘못 DONE을 수용했다`);
    assert.equal(run.runtime.stats.binds, 0, `${kind}: old empty hint가 bind까지 갔다`);
    assert.ok(run.adapters.stats.formatRejects > 0, `${kind}: expected format reject 없음`);
  }
});
