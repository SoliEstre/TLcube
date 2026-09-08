import test from 'node:test';
import assert from 'node:assert/strict';
import { createCAdapters, FAMILY_C, sampleCLayoutInto, readCNotch } from '../src/r2/adapter-c.js';
import { sampleHexCell } from '../src/decoder/grid-sample.js';
import { cellSampleDiscs } from '../src/hexgrid.js';
import { projectPoint } from '../src/decoder/homography.js';
import { R2_TYPE_C_PROFILE } from '../src/r2/profiles/c.js';
import { syntheticC, copyField, callDetect, observeAll, decodeCandidate } from './r2-c-fixtures.js';

test('C 관측 필수 API·family 충돌 없음·미관측 default 금지', () => {
  const adapter = createCAdapters();
  for (const key of ['detectInto', 'alignInto', 'bindCandidate', 'reset', 'invalidateLock']) assert.equal(typeof adapter[key], 'function');
  assert.ok(FAMILY_C > 6);
  const field = { width: 16, height: 16, data: new Float32Array(256).fill(1), alpha: null }, out = { found: 1, H: new Float64Array(9), layoutId: 'C0' };
  callDetect(adapter, field, 0, out);
  assert.equal(out.found, 0); assert.equal(out.family, 0); assert.equal(out.n, 0);
  assert.equal(out.H, null); assert.equal(out.layoutId, ''); assert.equal(out.format.kind, 'unknown');
  assert.equal(adapter.bindCandidate({ k: 14, H: new Float64Array(9) }, { kind: 'read', layoutId: 'C0', ecc: 'M', wire: 1, maskIndex: 0 }), null);
});

test('C found=0은 누적 진단 보존·한 프레임 한 cursor 단위·실평가 상한', () => {
  const events = [], adapter = createCAdapters({ maxHypotheses: 1, timing: row => events.push(row) });
  const field = syntheticC().field;
  callDetect(adapter, field, 0);
  assert.equal(adapter.stats.resumeCursor.steps, 1);
  const tries = adapter.stats.cTries, hits = adapter.stats.budgetHits;
  callDetect(adapter, field, 0);
  assert.equal(adapter.stats.cTries, tries); assert.equal(adapter.stats.budgetHits, hits);
  callDetect(adapter, field, 1);
  assert.equal(adapter.stats.resumeCursor.steps, 2);
  assert.equal(adapter.stats.cTries, tries + 1); assert.ok(adapter.stats.budgetHits >= hits);
  for (let i = 2; !adapter.stats.scanComplete && i < 500000; i++) {
    callDetect(adapter, field, i);
    assert.ok(adapter.stats.lastHypothesesTried + adapter.stats.lastAnchorSearches <= 1);
  }
  assert.ok(adapter.stats.hypothesesTried > 2, '전 프레임 첫 두 가설만 반복하면 안 돼요');
  assert.ok(events.some(row => row.unit === 'anchors'));
  assert.ok(events.some(row => row.unit === 'evaluate'));
});

test('C 소프트 예산·스냅샷 이중 사본 비용 계상', () => {
  const original = Object.getOwnPropertyDescriptor(performance, 'now'); let tick = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => (tick += 7) });
  try {
    const field = { width: 16, height: 16, data: new Float32Array(256).fill(1), alpha: new Uint8Array(256).fill(255) };
    const adapter = createCAdapters({ budget: { detectMs: 1 } });
    callDetect(adapter, field, 0);
    assert.equal(adapter.stats.snapshotCopyMs, 14);
    assert.equal(adapter.stats.snapshotCopies, 2);
    assert.equal(adapter.stats.snapshotBytes, 2 * (field.data.byteLength + field.alpha.byteLength));
    assert.equal(adapter.stats.snapshotRetainedBytes, adapter.stats.snapshotBytes);
    assert.equal(adapter.stats.budgetHits, 1); assert.ok(adapter.stats.budgetOverrunMs >= 13);
    assert.equal(adapter.stats.maxUnitMs, 7, '두 사본의 합을 원자 최대 시간으로 기록하면 안 돼요');
    assert.equal(adapter.stats.resumeCursor.steps, 0, '스냅샷 뒤 남은 예산이 0이면 resume을 시작하면 안 돼요');
  } finally { if (original) Object.defineProperty(performance, 'now', original); else delete performance.now; }
});

for (const version of [0, 1, 2, 3]) test(`C${version}/M 무힌트 관측→bind→표본→RS 원문 E2E`, () => {
  const fixture = syntheticC(version), result = observeAll(fixture.field);
  const decoded = result.rows.map(row => {
    const candidate = result.adapter.bindCandidate(row.observation, row.format);
    return candidate ? decodeCandidate(candidate, fixture.field, result.calls) : null;
  }).filter(Boolean);
  assert.ok(decoded.some(row => row.done && row.text === fixture.text));
  assert.deepEqual(decoded.filter(row => row.done && row.text !== fixture.text), []);
  assert.equal(R2_TYPE_C_PROFILE.capabilities.detector, false);
});

test('C 표본 4축: canonical 원판·median·바이트 AoS·클립/alpha를 R1과 대조', () => {
  const fixture = syntheticC(), bound = R2_TYPE_C_PROFILE.bind({ layoutId: 'C0', dimension: 14,
    ecc: 'M', wire: 1, tones: 3, maskIndex: 0, orientation: 0, sourceIdentity: 'sampling-oracle' });
  const cases = [
    { field: copyField(fixture.field), H: fixture.H.slice(), name: 'front' },
    { field: copyField(fixture.field), H: new Float64Array([...fixture.H.slice(0, 6), 0.0002, -0.0003, 1]), name: 'projective' },
    { field: copyField(fixture.field), H: fixture.H.slice(), name: 'clip-alpha' },
  ];
  cases[2].H[2] -= fixture.field.width / 2;
  cases[2].field.alpha = new Uint8Array(fixture.field.data.length).fill(255);
  for (let y = 0; y < fixture.field.height; y++) for (let x = 0; x < fixture.field.width / 3; x++) cases[2].field.alpha[y * fixture.field.width + x] = 0;
  let totalVisible = 0, totalInvisible = 0, coordinateDistinguished = 0;
  for (const { field, H, name } of cases) {
    // 면 내부의 소수 이상점: 중앙 한 점/평균은 median과 달라야 해요.
    for (let i = 7; i < field.data.length; i += 211) field.data[i] = (field.data[i] + 0.17) % 1;
    const bytes = new Uint8Array(bound.cellCount * 3).fill(99), visible = new Uint8Array(bound.cellCount).fill(1);
    const count = sampleCLayoutInto(field, H, bound, bytes, visible);
    let expectedCount = 0;
    for (let i = 0; i < bound.cellCount; i++) {
      const q = bound.cellCoord[2 * i], r = bound.cellCoord[2 * i + 1];
      const oracle = sampleHexCell(field, { H }, q, r, {});
      assert.equal(visible[i], oracle.ok ? 1 : 0, `${name}/${i} clip`);
      for (const [face, j] of ['T', 'L', 'R'].map((f, j) => [f, j])) assert.equal(bytes[3 * i + j],
        oracle.ok ? Math.max(0, Math.min(255, Math.round(oracle[face].median * 255))) : 0, `${name}/${i}/${face}`);
      if (oracle.ok) { expectedCount++; totalVisible++; } else totalInvisible++;
      const disc = cellSampleDiscs(q, r).T, correct = projectPoint(H, disc), axial = projectPoint(H, { x: q, y: r });
      if (correct && axial && Math.hypot(correct.x - axial.x, correct.y - axial.y) > fixture.H[0] * 0.33) coordinateDistinguished++;
    }
    assert.equal(count, expectedCount);
  }
  assert.ok(totalVisible > 0 && totalInvisible > 0 && coordinateDistinguished > 0);
});

test('C 노치 배경 술어는 전체 셀 표본과 75%를 요구한다', () => {
  const fixture = syntheticC();
  const notch = readCNotch(fixture.field, fixture.H, fixture.k);
  assert.equal(notch.ok, true); assert.equal(notch.sampled, 20); assert.equal(notch.backgroundRate, 1);
  const clipped = fixture.H.slice(); clipped[2] += fixture.field.width;
  assert.equal(readCNotch(fixture.field, clipped, fixture.k).ok, false);
});
