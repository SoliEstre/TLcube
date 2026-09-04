/**
 * locator-format-contract.test.js — **P2 진입점의 계약.**
 *
 * `readFormatFromLocator` 는 로케이터 포즈(H·n·layoutId)에서 포맷 워드를 읽는다.
 * R2 가 라이브에서 `ecc × mask` 를 스윕할 수 없어서 필요하다 (PM/029B §21·§23).
 *
 * 잠그는 것 넷:
 *   ① `layoutId` 를 안 주면 **거부**한다 — 스윕하면 답이 프레임마다 흔들린다.
 *   ② `H` 형이 틀리면 거부한다 (`Float64Array(9)` 만 받는다).
 *   ③ 격자가 맞는 시퀀스에서 실제로 읽는다 (y0 전 프레임).
 *   ④ 🔴 **반환에 디코더 내부 객체를 싣지 않는다** — 스칼라만.
 *
 * ⚠ 이 파일이 **못** 재는 축: 「읽은 포맷이 참값인가」. 포맷 워드에 `n`·`layoutId` 가
 * 없어서 이 함수는 그것을 확인할 능력이 **없다** (실측: y2 에서 라인업 5개 중 무엇을
 * 못박아도 crcOk 가 같다). 격자 정합은 검출 쪽 과업이다 — PM/029B §23.5.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFormatFromLocator } from '../src/decoder/locator-format.js';
import { detectCellSurfaceBlockShapes } from '../src/decoder/cellsurface-block-detect.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

function firstPosedFrame(name) {
  const seq = listLumaSequences().find((s) => s.name.split('/').pop() === name);
  if (!seq || !seq.frames.length) return null;
  for (const frame of seq.frames.slice(0, 6)) {
    const dump = readLumaDump(frame.path);
    const detected = detectCellSurfaceBlockShapes(dump, { enableCellSurfaceY: true });
    const shape = detected.shapes.find((s) => s.blockLocator && s.blockLocator.locatorH);
    if (shape) return { dump, shape, seq };
  }
  return null;
}

function poseOf(shape) {
  return {
    H: shape.blockLocator.locatorH,
    n: shape.estimatedN,
    layoutId: shape.blockLocator.layoutId || shape.blockLocator.family || '',
  };
}

test('① layoutId 를 안 주면 거부한다 — 스윕은 답을 흔들리게 만든다', (t) => {
  const found = firstPosedFrame('y0');
  if (!found) { t.skip('휘도 덤프 없음 — 통합자 기기에서만 돈다'); return; }
  const pose = poseOf(found.shape);
  const read = readFormatFromLocator(found.dump, { ...pose, layoutId: '' });
  assert.equal(read.ok, false, 'layoutId 없이도 읽어 버린다 — 못박기 가드가 사라졌다');
  assert.equal(read.detail.cause, 'locator-layout-not-pinned');
});

test('② H 는 Float64Array(9) 만 받는다', (t) => {
  const found = firstPosedFrame('y0');
  if (!found) { t.skip('휘도 덤프 없음'); return; }
  const pose = poseOf(found.shape);
  for (const [label, H] of [
    ['평 Array', Array.from(pose.H)],
    ['Float32Array', Float32Array.from(pose.H)],
    ['길이 8', pose.H.slice(0, 8)],
  ]) {
    const read = readFormatFromLocator(found.dump, { ...pose, H });
    assert.equal(read.ok, false, `${label} 를 받아들였다 — sampleCubeCell 이 아래에서 죽는다`);
    assert.equal(read.detail.cause, 'locator-pose-invalid');
  }
});

test('③ 격자가 맞는 시퀀스에서 실제로 포맷을 읽는다 (y0)', (t) => {
  const seq = listLumaSequences().find((s) => s.name.split('/').pop() === 'y0');
  if (!seq || !seq.frames.length) { t.skip('휘도 덤프 없음'); return; }
  let posed = 0;
  let read = 0;
  const shapes = new Set();
  for (const frame of seq.frames.slice(0, 12)) {
    const dump = readLumaDump(frame.path);
    const detected = detectCellSurfaceBlockShapes(dump, { enableCellSurfaceY: true });
    const shape = detected.shapes.find((s) => s.blockLocator && s.blockLocator.locatorH);
    if (!shape) continue;
    posed += 1;
    const result = readFormatFromLocator(dump, poseOf(shape));
    if (!result.ok) continue;
    read += 1;
    for (const c of result.candidates) {
      shapes.add(`t${c.tones}/e${c.eccName}/m${c.maskIndex}/w${c.formatWireVersion}`);
    }
  }
  assert.ok(posed >= 10, `포즈가 ${posed}프레임뿐이다 — 로케이터가 죽었거나 덤프가 바뀌었다`);
  assert.equal(read, posed,
    `포즈 ${posed}프레임 중 ${read}프레임만 읽었다. y0 은 로케이터의 layoutId 가 참값과 `
    + '같은 유일한 시퀀스라 전 프레임이 읽혀야 한다 (2026-09-04 실측 108/108)');
  assert.deepEqual([...shapes], ['t3/eH/m0/w2'],
    `후보가 단일값이 아니다: ${[...shapes].join(' ')} — 실측은 tones 3 · ECC H · mask 0 · wire 2 다`);
});

test('④ 반환에 디코더 내부 객체를 싣지 않는다 — 후보는 스칼라만', (t) => {
  const found = firstPosedFrame('y0');
  if (!found) { t.skip('휘도 덤프 없음'); return; }
  const read = readFormatFromLocator(found.dump, poseOf(found.shape));
  assert.equal(read.ok, true, 'y0 첫 포즈 프레임에서 못 읽었다 — 위 ③ 을 먼저 보라');
  assert.ok(read.candidates.length > 0, '후보가 비었다');
  // 🔴 hypothesis / referenceCalibration / referenceSamples(Map) 가 새면 import
  // 그래프는 깨끗한 채로 결합이 실재한다 — 클린룸 자가 초록인데 R1 리팩터가 R2 를 깬다.
  const FORBIDDEN = ['hypothesis', 'referenceCalibration', 'referenceSamples', 'reads', 'samples'];
  for (const candidate of read.candidates) {
    for (const key of FORBIDDEN) {
      assert.equal(candidate[key], undefined,
        `후보가 \`${key}\` 를 싣고 있다 — 디코더 내부 객체가 R2 쪽으로 샌다. `
        + '재표본이 필요하면 객체가 아니라 **함수**를 돌려줘라');
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (key === 'consensus') continue; // 진단용 요약 객체 (스칼라 필드만 갖는다)
      assert.ok(value === undefined || typeof value !== 'object',
        `후보의 \`${key}\` 가 객체다 (${typeof value}) — 스칼라만 실어라`);
    }
  }
});
