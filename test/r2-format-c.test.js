import test from 'node:test';
import assert from 'node:assert/strict';
import { readFormatC } from '../src/r2/adapter-c.js';
import { r2FormatAllowsCandidate } from '../src/r2/candidate-key.js';
import { syntheticC, observeAll, alignCandidate } from './r2-c-fixtures.js';

test('C FormatRead는 CRC 표본 뒤 flat 실행 layoutId·wire·ecc·mask를 낸다', () => {
  for (const version of [0, 1, 2, 3]) {
    const fixture = syntheticC(version), format = readFormatC(fixture.field, fixture.H, fixture.k);
    assert.deepEqual(format, { kind: 'read', ecc: 'M', maskIndex: 0, wire: 1, layoutId: `C${version}` });
    assert.deepEqual(Object.keys(format).sort(), ['kind', 'ecc', 'maskIndex', 'wire', 'layoutId'].sort());
  }
});

test('C unknown과 읽힌 모순을 구별하고 default를 주입하지 않는다', () => {
  const fixture = syntheticC();
  assert.deepEqual(readFormatC({ ...fixture.field, data: new Float32Array(fixture.field.data.length).fill(1) }, fixture.H, fixture.k), { kind: 'unknown' });
  assert.deepEqual(readFormatC(fixture.field, null, fixture.k), { kind: 'unknown' });
  assert.equal(readFormatC(fixture.field, fixture.H, fixture.k, { k: 16 }).kind, 'contradiction');
  assert.equal(readFormatC(fixture.field, fixture.H, fixture.k, { layoutHint: ['C1'] }).kind, 'contradiction');
  assert.equal(readFormatC(fixture.field, fixture.H, fixture.k, { generation: 1, expectedGeneration: 2 }).kind, 'contradiction');
  assert.equal(readFormatC(fixture.field, fixture.H, fixture.k, { format: { kind: 'read', layoutId: 'C0', ecc: 'H', maskIndex: 0, wire: 1 } }).kind, 'contradiction');
});

test('C 포맷 read 자체는 다른 타입 오수용 게이트가 아니다', () => {
  const fixture = syntheticC(1, 'Q6 O FORMAT', { notchC: false });
  // O와 C는 포맷 셀을 공유해요. 이 정상 read를 unknown으로 숨기지 않아요.
  const read = readFormatC(fixture.field, fixture.H, 14);
  assert.equal(read.kind, 'read');
});

test('C 유한 M 재읽기·관측 모순 즉시 재읽기·unknown 첫 bind 금지', () => {
  const fixture = syntheticC(), run = observeAll(fixture.field, { formatEveryFrames: 2 });
  const row = run.rows.find(r => r.format.kind === 'read' && r.n === fixture.k);
  assert.ok(row);
  assert.equal(run.adapter.bindCandidate(row.observation, { kind: 'unknown' }), null);
  const candidate = run.adapter.bindCandidate(row.observation, row.format), t = run.calls;
  alignCandidate(candidate, fixture.field, t); assert.equal(run.adapter.stats.formatRereads, 1);
  alignCandidate(candidate, fixture.field, t); assert.equal(run.adapter.stats.formatRereads, 1);
  alignCandidate(candidate, fixture.field, t + 1); assert.equal(run.adapter.stats.formatRereads, 1);
  alignCandidate(candidate, fixture.field, t + 2); assert.equal(run.adapter.stats.formatRereads, 2);
  alignCandidate(candidate, fixture.field, t + 3, t + 3, { observationContradiction: true });
  assert.equal(run.adapter.stats.formatRereads, 3);
  assert.equal(r2FormatAllowsCandidate(candidate.key, { kind: 'unknown' }), true, '기성 key의 unknown 연속성은 별도 뜻이에요');
});

test('C 본문 A→B 같은 포맷은 포맷층에서 구별 불가·픽셀 연속성에서는 폐기', () => {
  const a = syntheticC(0, 'CONTENT A'), b = syntheticC(0, 'CONTENT B');
  const fa = readFormatC(a.field, a.H, a.k), fb = readFormatC(b.field, b.H, b.k, { format: fa });
  assert.deepEqual(fa, fb); assert.equal(fb.kind, 'read', '포맷 동일로 본문 동일을 주장할 수 없어요');
  const run = observeAll(a.field), row = run.rows.find(r => r.format.kind === 'read' && r.n === a.k);
  const candidate = run.adapter.bindCandidate(row.observation, row.format);
  alignCandidate(candidate, a.field, run.calls);
  const after = alignCandidate(candidate, b.field, run.calls + 1);
  assert.equal(after.output.gatePassed, 0); assert.equal(candidate.invalidated, 'current-pixels-changed');
});
