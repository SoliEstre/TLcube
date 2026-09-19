import assert from 'node:assert/strict';
import test from 'node:test';
import { xEdges, xFinderSpec, xFinderPattern, xFinderCanonical, xFinderEffective, X_FINDER_IDS, X_FINDER_PATTERNS } from '../src/x-finder.js';
import { xProfileLayout, xProfile, xProfileDto, X_FINDERS } from '../src/x-profile.js';
import { xCapacity, encodeX, decodeX } from '../src/x-codec.js';
import { layoutX } from '../src/x-layout.js';

const site = (N, x, y, z) => (x * N + y) * N + z;

test('xEdges — 모서리 12 개 · 각 N 사이트 · 코너는 세 모서리에 공유 · 합집합 12N−16', () => {
  for (const N of [8, 10]) {
    const edges = xEdges(N);
    assert.equal(edges.length, 12);
    const union = new Set(), cornerHits = new Map();
    for (const e of edges) {
      assert.equal(e.sites.length, N);
      e.sites.forEach(s => union.add(s));
      for (const s of [e.sites[0], e.sites[N - 1]]) cornerHits.set(s, (cornerHits.get(s) ?? 0) + 1);
    }
    assert.equal(union.size, 12 * N - 16);
    assert.equal(cornerHits.size, 8);
    for (const n of cornerHits.values()) assert.equal(n, 3);
    // 코너 좌표 확인
    const corners = new Set([0, N - 1].flatMap(x => [0, N - 1].flatMap(y => [0, N - 1].map(z => site(N, x, y, z)))));
    assert.deepEqual([...cornerHits.keys()].sort((a, b) => a - b), [...corners].sort((a, b) => a - b));
  }
  assert.throws(() => xEdges(1), /N/);
});

test('xFinderSpec — 패턴별 구조 사이트 수·역할 분리·레벨 규칙·정본 · 거절', () => {
  // N8: edge-all 80(모서리 전부) · m1s2 56 · m1s3 56 / N10: edge-all 104
  assert.equal(xFinderSpec(8, 'edge-all-v0').structureSites.length, 80);
  assert.equal(xFinderSpec(8, 'edge-m1s2-v0').structureSites.length, 56);
  assert.equal(xFinderSpec(8, 'edge-m1s3-v0').structureSites.length, 56);
  assert.equal(xFinderSpec(10, 'edge-all-v0').structureSites.length, 104);
  for (const N of [8, 10]) for (const id of X_FINDER_IDS) {
    const spec = xFinderSpec(N, id);
    assert.equal(spec.corners.length, 8);
    const roles = [spec.corners, spec.motif, spec.word];
    for (let a = 0; a < 3; a += 1) for (let b = a + 1; b < 3; b += 1) assert.equal(roles[a].filter(s => roles[b].includes(s)).length, 0, '역할 중복 0');
    assert.equal(spec.structureSites.length, spec.corners.length + spec.motif.length + spec.word.length);
    for (const c of spec.corners) assert.equal(spec.levels.get(c), 1, '코너 상시 on');
    const { m } = xFinderPattern(id);
    assert.equal(spec.motif.length, m === 0 ? 0 : 24 * m, '모티프 = 코너 8 × 방향 3 × m');
    for (const e of spec.edges) {
      // 코너 옆(d=1) 모티프는 0 — «외로운 밝은 점»
      if (m >= 1) { assert.equal(e.positions[1].role, 'motif'); assert.equal(e.positions[1].bit, 0); assert.equal(e.positions[N - 2].bit, 0); }
      for (const p of e.positions) if (p.role !== 'data') assert.equal(spec.levels.get(p.siteId), p.bit);
    }
    assert.equal(spec.wordRule, 'timing-alt-v0');
    assert.equal(typeof xFinderCanonical(spec), 'string');
  }
  assert.throws(() => xFinderSpec(8, 'edge-none'), /finderId/);
  assert.throws(() => xFinderSpec(8, null), /finderId/);
  assert.throws(() => xFinderSpec(8, 'toString'), /finderId/);
  assert.throws(() => xFinderSpec(4, 'edge-all-v0'), /2m\+2/);
  assert.deepEqual(X_FINDERS, X_FINDER_IDS);
  assert.ok(Object.isFrozen(X_FINDER_PATTERNS));
});

test('xProfileLayout finderId — whole-group 탈락 · 회계 · 용량(X0 108/114, X1 230) · 기본값 불변 · 지문', () => {
  const plain = xProfileLayout('X0');
  assert.equal(plain.finderId, null); assert.deepEqual(plain.reservations, []); assert.equal(plain.reservedTriples.length, 0); assert.equal(plain.finderLevels.size, 0);
  assert.equal(xProfileLayout('X0', { finderId: null }).structureCanonical, plain.structureCanonical, 'finderId null = 예약 없음(기본과 동일)');
  const expectDigits = { X0: { 'edge-all-v0': 108, 'edge-m1s2-v0': 114, 'edge-m1s3-v0': 114 }, X1: { 'edge-all-v0': 230 } };
  for (const [pid, table] of Object.entries(expectDigits)) for (const [fid, digits] of Object.entries(table)) {
    const L = xProfileLayout(pid, { finderId: fid });
    assert.equal(L.digits, digits, `${pid} ${fid} digits`);
    assert.equal(L.triples.length, digits);
    const raw = L.raw, N = raw.N, centres = new Set(raw.cells.map(c => c.centre)), reserved = new Set(L.reservedSites);
    // 예약 사이트에는 중심이 없고, 구조 사이트 = 예약 ∪ 중심 위 구조
    for (const id of reserved) assert.equal(centres.has(id), false);
    assert.equal(reserved.size + L.reservations.structureOnCentres.length, L.finderSpec.structureSites.length);
    // 남은 트리플엔 예약 사이트 0, 탈락 트리플엔 예약 사이트 ≥ 1
    for (const t of L.triples) assert.equal(t.some(id => reserved.has(id)), false);
    for (const t of L.reservedTriples) assert.equal(t.some(id => reserved.has(id)), true);
    assert.equal(L.reservedTriples.length, raw.digits - digits);
    // 회계: 중심 + 남은 데이터 + 탈락 데이터 + 잔여 = N³ · 예약 ⊆ 탈락 데이터 사이트 ∪ 잔여
    const dropped = new Set(L.reservedTriples.flat()), residual = new Set(raw.residual);
    assert.equal(centres.size + L.triples.length * 3 + dropped.size + residual.size, N ** 3);
    for (const id of reserved) assert.equal(dropped.has(id) || residual.has(id), true);
    // 파인더 레벨은 예약 사이트 전부에 있고 중심엔 없음
    assert.equal(L.finderLevels.size, reserved.size);
    for (const id of reserved) assert.ok(L.finderLevels.has(id));
    // 지문: 구조 지문이 기본과 다르고, 프로파일 지문에 finderId 포함, DTO 는 불변
    assert.notEqual(L.structureCanonical, plain.structureCanonical);
    assert.ok(L.profileCanonical.includes(`"finderId":"${fid}"`));
    assert.deepEqual(xProfileDto(pid), xProfileDto(xProfile(pid)));
    assert.equal(L.reservations.finderId, fid);
  }
  assert.notEqual(xProfileLayout('X0', { finderId: 'edge-m1s2-v0' }).structureCanonical, xProfileLayout('X0', { finderId: 'edge-m1s3-v0' }).structureCanonical, '같은 digit 수라도 사이트 집합이 다르면 지문이 달라요');
  assert.throws(() => xProfileLayout('X0', { finderId: 'edge-none' }), /finderId/);
  assert.throws(() => xProfileLayout('X0', { finderId: false }), /finderId/);
  // x8-gpt-v1(X0g) 도 규칙은 같이 적용(중심 위 구조 사이트는 예약 없이 상시 on)
  const g = xProfileLayout('X0g', { finderId: 'edge-m1s3-v0' });
  assert.ok(g.digits < layoutX({ layoutId: 'x8-gpt-v1', N: 8 }).digits);
});

test('codec finderId — 용량 재유도 · 인코드 레벨(코너 1·모티프/워드 비트·중심 on) · 왕복 · 기본 코덱과 비호환', () => {
  for (const [pid, fid, digits] of [['X0', 'edge-m1s3-v0', 114], ['X0', 'edge-all-v0', 108], ['X1', 'edge-all-v0', 230]]) {
    const cap = xCapacity(pid, { ecc: 'M', finderId: fid });
    assert.equal(cap.digits, digits);
    assert.equal(cap.symbols, Math.floor(digits / 3));
    assert.ok(cap.payloadBytes < xCapacity(pid, { ecc: 'M' }).payloadBytes, '예약만큼 용량이 줄어요');
    const text = 'x'.repeat(cap.payloadBytes);
    const enc = encodeX(text, pid, { ecc: 'M', finderId: fid });
    assert.equal(enc.finderId, fid);
    const L = cap.layout, spec = L.finderSpec;
    for (const c of spec.corners) assert.equal(enc.levels[c], 1, '코너 on');
    for (const [id, lv] of L.finderLevels) assert.equal(enc.levels[id], lv);
    for (const cell of L.raw.cells) assert.equal(enc.levels[cell.centre], 1, '중심 상시 on');
    const dec = decodeX({ levels: enc.levels }, pid, { ecc: 'M', finderId: fid });
    assert.equal(dec.ok, true); assert.equal(dec.text, text);
    // 같은 레벨을 기본(예약 없음) 코덱으로 읽으면 성공하면 안 돼요(파인더 사이트를 데이터로 읽음)
    const wrong = decodeX({ levels: enc.levels }, pid, { ecc: 'M' });
    assert.equal(wrong.ok && wrong.text === text, false);
    // CRC 와 같이
    const capC = xCapacity(pid, { ecc: 'M', finderId: fid, crc: 'x-crc32c-v0' });
    const t2 = 'y'.repeat(capC.payloadBytes);
    const d2 = decodeX({ levels: encodeX(t2, pid, { ecc: 'M', finderId: fid, crc: 'x-crc32c-v0' }).levels }, pid, { ecc: 'M', finderId: fid, crc: 'x-crc32c-v0' });
    assert.equal(d2.ok, true); assert.equal(d2.verified, true); assert.equal(d2.text, t2);
  }
  // 기본값 불변: finderId 없음 = 기존 용량/레벨
  const a = encodeX('hello', 'X0', { ecc: 'M' }), b = encodeX('hello', 'X0', { ecc: 'M', finderId: null });
  assert.deepEqual(Array.from(a.levels), Array.from(b.levels));
  assert.equal(xCapacity('X0', { ecc: 'M' }).digits, 140);
  assert.throws(() => xCapacity('X0', { ecc: 'M', finderId: 'nope' }), /finderId/);
});

test('symmetric 후보·실효 spec(codex 0308) — edge-m1s3sym-v0 N8 114 / N10 234 · 중심 위 구조 사이트는 실효 1 · 지문은 실효값 · 인코드 레벨 = 실효', () => {
  assert.equal(xFinderSpec(8, 'edge-m1s3sym-v0').structureSites.length, 56);
  assert.equal(xFinderSpec(10, 'edge-m1s3sym-v0').structureSites.length, 80);
  assert.equal(xProfileLayout('X0', { finderId: 'edge-m1s3sym-v0' }).digits, 114);
  assert.equal(xProfileLayout('X1', { finderId: 'edge-m1s3sym-v0' }).digits, 234, '종합 «희소 234» = 양끝 stride union');
  assert.equal(xProfileLayout('X1', { finderId: 'edge-m1s3-v0' }).digits, 244, '한 방향 stride 는 244 — 다른 후보');
  for (const [pid, fid] of [['X1', 'edge-m1s3-v0'], ['X1', 'edge-all-v0'], ['X0', 'edge-all-v0'], ['X0g', 'edge-m1s3-v0']]) {
    const L = xProfileLayout(pid, { finderId: fid });
    const centres = new Set(L.raw.cells.map(c => c.centre));
    const eff = L.finderSpecEffective, nom = L.finderSpec;
    assert.equal(eff.effective, true); assert.equal(nom.effective, undefined);
    assert.deepEqual(eff.structureSites, nom.structureSites, '사이트 집합·역할 불변');
    assert.equal(eff.overrides.length, nom.structureSites.filter(id => centres.has(id) && nom.levels.get(id) !== 1).length);
    for (const ov of eff.overrides) { assert.ok(centres.has(ov.siteId)); assert.equal(ov.effective, 1); assert.equal(ov.nominal, 0); assert.equal(eff.levels.get(ov.siteId), 1); }
    for (const id of nom.structureSites) if (!centres.has(id)) assert.equal(eff.levels.get(id), nom.levels.get(id));
    for (const e of eff.edges) for (const p of e.positions) if (p.role !== 'data') assert.equal(p.effectiveBit, eff.levels.get(p.siteId));
    assert.deepEqual(L.reservations.overrides, eff.overrides);
    assert.ok(L.reservations.finder.includes('"effective":true'));
    // 인코더 실제 레벨 = 실효 spec(구조 사이트 전부, 중심 포함)
    const enc = encodeX('z', pid, { ecc: 'M', finderId: fid });
    for (const id of eff.structureSites) assert.equal(enc.levels[id], eff.levels.get(id), 'site ' + id);
  }
  // X1 m1s3: 문서의 예(site 109 모티프·site 499 워드 가 중심) — nominal 0, 실효 1
  const X1 = xProfileLayout('X1', { finderId: 'edge-m1s3-v0' });
  assert.ok(X1.finderSpecEffective.overrides.length > 0);
  const nomTable = Object.fromEntries(X1.finderSpec.structureSites.map(id => [id, X1.finderSpec.levels.get(id)]));
  for (const ov of X1.finderSpecEffective.overrides) assert.equal(nomTable[ov.siteId], 0);
  assert.throws(() => xFinderEffective(xFinderSpec(8, 'edge-all-v0'), null), TypeError);
});
