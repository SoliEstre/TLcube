import test from 'node:test';
import assert from 'node:assert/strict';
import { createCubeYAcquisition, observeCubeYCandidates } from '../src/r2/cube-y-acquisition.js';
import { createCubeYCandidateRuntime } from '../src/r2/cube-y-runtime.js';
import { encodeY } from '../src/encodeY.js';
import { buildOrbitMesh } from '../src/y3d-viewer.js';
import { layoutForCube } from '../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../src/luminance.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';

// 이 파일은 합성 렌더·빈 필드 stub만 다룬다. 실영상·paired 벤치는 root가 따로 실행한다.
// known pose/n/format/truth를 지원 증거로 주입하지 않는다.

function render(text, tones = 3) {
  const encoded = encodeY(text, { cellSurfaceLayout: 'v0tr', version: 2, tones, eccLevel: 'H', maskIndex: 0 });
  const layout = layoutForCube(encoded.n, { size: 1, margin: 4 });
  const preset = getPreset(DEFAULT_PRESET);
  const mesh = buildOrbitMesh({ n: encoded.n, tones: encoded.tones, levels: preset.levels, layout,
    digitAt: (i, j) => encoded.cellDigits.get(`${i},${j}`)?.digit ?? null,
    levelAt: (i, j, face) => encoded.cellDigits.get(`${i},${j}`)?.tones?.[face] ?? null,
    yaw: 0, pitch: -20 * Math.PI / 180, roll: 0, faces: 3, perspective: 0.15 });
  const raster = rasterize({ width: layout.width, height: layout.height, background: preset.background,
    shapes: mesh.quads.map((quad) => ({ kind: 'polygon', points: quad.points2d, color: quad.color })) },
  { pixelsPerUnit: 17, supersample: 2 });
  return toRelativeLuminance({ width: raster.width, height: raster.height, pixels: raster.pixels }, {});
}

function emptyField(width = 32, height = 32) {
  return { width, height, data: new Float32Array(width * height) };
}

function signature(result) {
  return {
    observed: result.observed, geometryCount: result.geometryCount, descriptorCount: result.descriptorCount,
    unitCounts: result.unitCounts,
    candidates: result.candidates.map((candidate) => ({
      key: { ...candidate.key, sourceIdentity: candidate.key.sourceIdentity.replace(/^y-faces:e[^:]+:/, 'y-faces:e0:') },
      n: candidate.n, layoutId: candidate.layoutId, format: candidate.format,
      F: candidate.F, margin: candidate.margin, visibleCount: candidate.visibleCount,
      rawOrdinal: candidate.rawOrdinal, geometryOrdinal: candidate.geometryOrdinal,
      layoutOrdinal: candidate.layoutOrdinal, formatOrdinal: candidate.formatOrdinal,
      geometryMethod: candidate.geometryMethod,
      faceHs: candidate.faceHs.map((H) => Array.from(H)),
      faceLuma: Array.from(candidate.faceLuma), visibleCells: Array.from(candidate.visibleCells),
    })),
  };
}

function discoveryCmp(a, b) {
  return a.rawOrdinal - b.rawOrdinal || a.geometryOrdinal - b.geometryOrdinal
    || a.layoutOrdinal - b.layoutOrdinal || a.formatOrdinal - b.formatOrdinal;
}

function exactHs(left, right) {
  return left.length === 3 && right.length === 3
    && left.every((H, face) => H.length === 9 && right[face].every((value, i) => value === H[i]));
}

test('합성 stub: 빈 필드는 완료되고 max0/takeReady(null job)을 지킨다', () => {
  const field = emptyField();
  const acquisition = createCubeYAcquisition();
  assert.equal(acquisition.takeReady(), null);
  acquisition.start(field, { frameId: 'empty', timestamp: 1, epoch: 'stub-0' });
  const zero = acquisition.resume({ maxWorkUnits: 0, maxAdditionalMs: 0 });
  assert.equal(zero.units, 0);
  assert.equal(zero.complete, false);
  assert.equal(acquisition.takeReady({ maxCandidates: 0 }).candidates.length, 0);
  let view, steps = 0;
  do { view = acquisition.resume({ maxWorkUnits: 1 }); steps++; } while (!view.complete && steps < 100000);
  assert.equal(view.complete, true, '빈 필드 job이 완료되지 않았다');
  const peeked = acquisition.takeReady({ maxCandidates: 0 });
  assert.equal(peeked.candidates.length, 0);
  assert.equal(peeked.complete, true);
  const ready = acquisition.takeReady({ maxCandidates: 8 });
  const done = acquisition.takeCompleted({ maxCandidates: 8 });
  assert.equal(done.observed, peeked.observed);
  assert.equal(done.candidates.length, ready.candidates.length);
  assert.equal(acquisition.takeReady(), null);
  assert.equal(acquisition.active, false);
});

test('합성 렌더: 무제한 동기 후보 집합은 1-unit 재개 takeCompleted와 EXACT 같다', () => {
  const field = render('https://tl.estre.so/a');
  const sync = observeCubeYCandidates(field, { maxCandidates: 8 });
  const acquisition = createCubeYAcquisition();
  acquisition.start(field);
  let view, steps = 0;
  do { view = acquisition.resume({ maxWorkUnits: 1 }); steps++; } while (!view.complete && steps < 100000);
  assert.equal(view.complete, true, '1-unit 재개가 완료되지 않았다');
  const chunked = acquisition.takeCompleted({ maxCandidates: 8 });
  assert.deepEqual(signature(chunked), signature(sync));
  for (let i = 1; i < chunked.candidates.length; i++) {
    const prev = chunked.candidates[i - 1], cur = chunked.candidates[i];
    const order = cur.F - prev.F || discoveryCmp(prev, cur);
    assert.ok(order <= 0, 'takeCompleted가 F/ordinal 최종 정렬이 아니다');
  }
});

test('합성 렌더: 첫 ready는 전체 job 완료보다 먼저 나오고 발견 순서를 지킨다', () => {
  const field = render('https://tl.estre.so/a');
  const acquisition = createCubeYAcquisition();
  acquisition.start(field, { frameId: 'origin', timestamp: 7, epoch: 3 });
  const drained = [];
  let firstComplete = null;
  let view, steps = 0;
  do {
    view = acquisition.resume({ maxWorkUnits: 1 });
    const batch = acquisition.takeReady({ maxCandidates: 8 });
    if (batch.candidates.length && firstComplete === null) firstComplete = view.complete;
    drained.push(...batch.candidates);
    steps++;
  } while (!view.complete && steps < 100000);
  assert.equal(view.complete, true, '1-unit 재개가 완료되지 않았다');
  assert.ok(drained.length > 0, 'ready 후보가 없다');
  assert.equal(firstComplete, false, '첫 ready가 job 완료와 같거나 뒤에 나왔다');
  for (let i = 1; i < drained.length; i++) {
    assert.ok(discoveryCmp(drained[i - 1], drained[i]) <= 0, 'ready가 발견 순서가 아니다');
  }
  const completed = acquisition.takeCompleted({ maxCandidates: 8 });
  const sync = observeCubeYCandidates(field, { maxCandidates: 8 });
  assert.deepEqual(signature(completed), signature(sync));
  assert.equal(completed.origin.epoch, 3);
  assert.ok(drained.every((row) => row.key.layoutId === row.layoutId));
  assert.ok(drained.every((row) => typeof row.key.orientation === 'string'));
  assert.ok(drained.every((row) => row.key.sourceIdentity.startsWith('y-faces:e3:')));
});

test('합성 렌더: takeReady max0/재호출/중복소비/소유권/reset/신규 start', () => {
  const field = render('https://tl.estre.so/a');
  const acquisition = createCubeYAcquisition();
  const firstPixel = field.data[0];
  acquisition.start(field, { frameId: 'own', timestamp: 11, epoch: 11 });
  acquisition.resume({ maxWorkUnits: Infinity });
  assert.equal(acquisition.takeReady({ maxCandidates: 0 }).candidates.length, 0);
  const first = acquisition.takeReady({ maxCandidates: 1 });
  assert.equal(first.candidates.length, 1);
  const rest = acquisition.takeReady({ maxCandidates: Number.MAX_SAFE_INTEGER });
  const keys = [...first.candidates, ...rest.candidates].map((row) => JSON.stringify(row.key));
  assert.equal(new Set(keys).size, keys.length, '같은 descriptor가 두 번 소비됐다');
  assert.equal(acquisition.takeReady({ maxCandidates: 8 }).candidates.length, 0);

  const owned = first.candidates[0];
  const savedH = owned.faceHs[0][0];
  const savedLuma = owned.faceLuma[0];
  owned.faceHs[0][0] = savedH + 1;
  owned.faceLuma[0] = savedLuma ^ 1;
  first.origin.field.data[0] = firstPixel === 0 ? 1 : 0;
  const completed = acquisition.takeCompleted({ maxCandidates: 8 });
  const original = completed.candidates.find((row) => row.rawOrdinal === owned.rawOrdinal
    && row.geometryOrdinal === owned.geometryOrdinal && row.layoutOrdinal === owned.layoutOrdinal
    && row.formatOrdinal === owned.formatOrdinal);
  assert.ok(original);
  assert.equal(original.faceHs[0][0], savedH, 'takeReady H 변경이 descriptors를 오염했다');
  assert.equal(original.faceLuma[0], savedLuma, 'takeReady faceLuma 변경이 descriptors를 오염했다');
  assert.equal(completed.origin.field.data[0], firstPixel, 'takeReady field 변경이 job snapshot을 오염했다');
  assert.equal(original.faceHs[0] === owned.faceHs[0], false);
  assert.equal(original.faceLuma === owned.faceLuma, false);

  acquisition.start(field, { epoch: 12 });
  acquisition.reset();
  assert.equal(acquisition.active, false);
  assert.equal(acquisition.takeReady(), null);

  acquisition.start(field, { frameId: 'next', timestamp: 12, epoch: 99 });
  acquisition.resume({ maxWorkUnits: Infinity });
  const next = acquisition.takeCompleted({ maxCandidates: 8 });
  assert.equal(next.origin.epoch, 99);
  assert.ok(next.candidates.every((row) => row.key.sourceIdentity.startsWith('y-faces:e99:')));
});

test('합성 렌더: cap0은 미완 job을 닫고 누적을 만들지 않는다', () => {
  const field = render('https://tl.estre.so/a');
  const runtime = createCubeYCandidateRuntime({ maxAcquisitionWorkUnits: 1 });
  runtime.pushFrame(field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  assert.equal(runtime.stats.acquisitionPhase === 'idle', false, '1-unit job이 즉시 닫혔다');
  runtime.setCapacity(0);
  assert.equal(runtime.stats.candidateCount, 0);
  const pushes = runtime.stats.sessionPushes;
  const binds = runtime.stats.binds;
  runtime.pushFrame(field, 100, { frameId: 1, runDetect: true, maxCandidates: 0, budgetMs: Infinity });
  assert.equal(runtime.stats.candidateCount, 0);
  assert.equal(runtime.stats.sessionPushes, pushes);
  assert.equal(runtime.stats.binds, binds);
  runtime.pushFrame(field, 200, { frameId: 2, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  assert.ok(runtime.stats.detectCalls >= 1);
});

test('합성 렌더: stale epoch 후보는 다른 generation/epoch와 sourceIdentity가 겹치지 않는다', () => {
  const field = render('https://tl.estre.so/a');
  const acquisition = createCubeYAcquisition();
  const collect = (epoch) => {
    acquisition.start(field, { frameId: epoch, timestamp: epoch, epoch });
    acquisition.resume({ maxWorkUnits: Infinity });
    return acquisition.takeCompleted({ maxCandidates: 8 });
  };
  const first = collect('g0');
  const second = collect('g1');
  const firstIds = new Set(first.candidates.map((row) => row.key.sourceIdentity));
  const secondIds = new Set(second.candidates.map((row) => row.key.sourceIdentity));
  assert.equal([...firstIds].some((id) => secondIds.has(id)), false);
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const live = runtime.stats.candidateCount;
  runtime.reset();
  assert.equal(runtime.stats.candidateCount, 0);
  runtime.pushFrame(field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  assert.ok(runtime.stats.candidateCount > 0);
  assert.ok(live >= 0);
});

test('합성 렌더: 교체·가림 프레임은 old epoch에 누적하지 않고 실제 RS만 DONE으로 센다', () => {
  const A = render('https://tl.estre.so/a');
  const B = render('https://tl.estre.so/b');
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(A, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  assert.ok(runtime.stats.candidateCount > 0);
  const pushes = runtime.stats.sessionPushes;
  runtime.pushFrame(B, 100, { frameId: 1, runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  assert.equal(runtime.stats.sessionPushes, pushes, '교체 프레임이 old epoch 증거에 들어갔다');
  assert.equal(runtime.stats.candidateCount, 0);

  runtime.reset();
  runtime.pushFrame(A, 0, { frameId: 'cover-0', runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  const afterBind = runtime.stats.sessionPushes;
  const covered = { width: A.width, height: A.height, data: new A.data.constructor(A.data.length) };
  runtime.pushFrame(covered, 100, { frameId: 'cover-1', runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  assert.equal(runtime.stats.sessionPushes, afterBind, '가림 프레임이 old epoch 증거에 들어갔다');
  assert.equal(runtime.stats.candidateCount, 0);

  runtime.reset();
  let hit = null;
  for (let frame = 0; frame < 16 && !hit; frame++) {
    hit = runtime.pushFrame(A, frame * 100, { frameId: frame, runDetect: frame === 0, maxCandidates: 8, budgetMs: Infinity });
  }
  assert.ok(hit, '합성 렌더 왕복이 실제 RS DONE에 닿지 못했다 — 실영상 완료가 아니다');
  assert.equal(hit.text, 'https://tl.estre.so/a');
  assert.equal(hit.actualRS.used, true);
  assert.ok(hit.actualRS.decodeAttempts > 0);
});

test('합성 렌더: 같은 previous/current/H27만 프레임 안에서 track·confidence를 공유하고 출력은 오염되지 않는다', () => {
  const field = render('https://tl.estre.so/a');
  const found = observeCubeYCandidates(field, { maxCandidates: 8 });
  const twins = [];
  for (let i = 0; i < found.candidates.length; i++) {
    for (let j = i + 1; j < found.candidates.length; j++) {
      if (found.candidates[i].layoutId !== found.candidates[j].layoutId
        && exactHs(found.candidates[i].faceHs, found.candidates[j].faceHs)) {
        twins.push([found.candidates[i], found.candidates[j]]);
      }
    }
  }
  const runtime = createCubeYCandidateRuntime();
  runtime.pushFrame(field, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  assert.ok(runtime.stats.binds > 0, '합성 렌더 첫 프레임 bind가 없다');
  assert.equal(runtime.stats.sharedTrackHits, 0, 'origin==current bind가 track 캐시를 썼다');
  const firstHits = runtime.stats.sharedConfidenceHits;
  runtime.pushFrame(field, 100, { frameId: 1, runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  if (twins.length > 0 && runtime.stats.candidateCount >= 2) {
    assert.ok(runtime.stats.sharedTrackHits > 0, '같은 H27 레이아웃이 track을 공유하지 않았다');
    assert.ok(runtime.stats.sharedConfidenceHits > firstHits, '같은 H27 레이아웃이 face-confidence를 공유하지 않았다');
  }
  const hud = runtime.hudCandidates.filter((row) => row.alive && row.indicator !== 4);
  if (hud.length >= 2) {
    const saved = hud[1].faceHs.map((H) => Float64Array.from(H));
    const savedMap = hud[1].cellMap[0];
    hud[0].faceHs[0][0] += 1;
    hud[0].cellMap[0] ^= 3;
    const again = runtime.hudCandidates.filter((row) => row.id === hud[1].id)[0];
    assert.ok(exactHs(again.faceHs, saved), '한 후보 HUD H 변경이 다른 후보를 오염했다');
    assert.equal(again.cellMap[0], savedMap, '한 후보 cellMap 변경이 다른 후보를 오염했다');
  }

  runtime.reset();
  assert.equal(runtime.stats.sharedTrackHits, 0);
  assert.equal(runtime.stats.sharedConfidenceHits, 0);
  runtime.pushFrame(field, 0, { frameId: 'g2', runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  runtime.pushFrame(field, 100, { frameId: 'g2b', runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  if (twins.length > 0 && runtime.stats.candidateCount >= 2) {
    assert.ok(runtime.stats.sharedTrackHits > 0, 'reset 뒤 같은 generation 프레임에서 H27 공유가 사라졌다');
  }

  const other = render('https://tl.estre.so/b');
  runtime.pushFrame(other, 200, { frameId: 'other', runDetect: false, maxCandidates: 8, budgetMs: Infinity });
  assert.equal(runtime.stats.candidateCount, 0, '다른 영상 current identity가 old node를 남겼다');
});

test('합성 렌더: 긴 origin→current는 현재 field의 F/마진/포맷/raw-rank/NCC를 통과한 뒤에만 bind한다', () => {
  const A = render('https://tl.estre.so/a');
  const B = render('https://tl.estre.so/b');
  const runtime = createCubeYCandidateRuntime({ maxAcquisitionWorkUnits: 1 });
  runtime.pushFrame(A, 0, { frameId: 0, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
  let frame = 1;
  while (frame < 1000 && runtime.stats.observations === 0) {
    runtime.pushFrame(B, frame * 100, { frameId: frame, runDetect: true, maxCandidates: 8, budgetMs: Infinity });
    frame++;
  }
  assert.ok(runtime.stats.observations > 0, 'origin cursor가 완료되기 전에 안전 상한에 닿았다');
  assert.equal(runtime.stats.acquisitionPhase, 'idle');
  assert.ok(runtime.stats.acquisitionRebaseRejects > 0,
    `origin/current 재검증 분기가 실행되지 않았다: ${JSON.stringify(runtime.stats)}`);
  assert.equal(runtime.stats.binds, 0);
  assert.equal(runtime.stats.sessionPushes, 0, 'current identity 실패 전 origin 후보가 누적됐다');
});
