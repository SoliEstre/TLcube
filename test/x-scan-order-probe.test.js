import assert from 'node:assert/strict';
import test from 'node:test';
import { scanOrders, blockOf, occlusionMask, trial, runProbe, runRealProbe, assertProbeOptions, drawEvent, applyEvent, REAL_ORDERS, REAL_STAGES, classifyStage } from '../tools/x-scan-order-probe.mjs';
import { xProfileLayout } from '../src/x-profile.js';
import { xNsymFor, xCapacity, encodeX, decodeX } from '../src/x-codec.js';
import { makeRng, cameraFromFov } from '../tools/x-synth-render.mjs';

const key = t => t.join(',');

test('scanOrders — 세 순서는 같은 트리플 집합의 순열이고, morton 은 공간 국소(이웃 트리플 중심 거리 작음)', () => {
  const pl = xProfileLayout('X0');
  const orders = scanOrders(pl, 2);
  const base = new Set(pl.triples.map(key));
  for (const [id, seq] of Object.entries(orders)) {
    assert.equal(seq.length, pl.triples.length, id);
    assert.deepEqual(new Set(seq.map(key)), base, `${id} 는 순열`);
  }
  assert.deepEqual(orders['cell-order-v0'], pl.triples);
  const N = pl.raw.N;
  const centroid = t => t.reduce((a, s) => { const x = Math.floor(s / (N * N)), y = Math.floor(s / N) % N, z = s % N; return [a[0] + x / 3, a[1] + y / 3, a[2] + z / 3]; }, [0, 0, 0]);
  const meanStep = seq => { let d = 0; for (let i = 1; i < seq.length; i += 1) { const a = centroid(seq[i - 1]), b = centroid(seq[i]); d += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); } return d / (seq.length - 1); };
  assert.ok(meanStep(orders['morton-round2-legacy']) < meanStep(orders['cell-order-v0']), 'legacy morton 이웃 거리 < cell-order');
  assert.ok(meanStep(orders['stride-v0']) > meanStep(orders['cell-order-v0']), 'stride 는 흩뿌림');
});

test('blockOf — contiguous 는 연속 구간, interleaved 는 mod, B=1 은 항상 0', () => {
  const S = 46;
  for (let i = 0; i < S; i += 1) assert.equal(blockOf(i, S, 1, 'contiguous'), 0);
  const cont = Array.from({ length: S }, (_, i) => blockOf(i, S, 3, 'contiguous'));
  assert.ok(cont.every((b, i) => i === 0 || b >= cont[i - 1]));
  assert.deepEqual([...new Set(cont)], [0, 1, 2]);
  const inter = Array.from({ length: S }, (_, i) => blockOf(i, S, 3, 'interleaved'));
  assert.ok(inter.every((b, i) => b === i % 3));
});

test('occlusionMask — dropout p=0/1, blob r=0 은 ≤1, view 는 정면에서 겹침이 생겨요', () => {
  const pl = xProfileLayout('X0');
  const N = pl.raw.N, sites = N ** 3;
  const lit = new Uint8Array(sites).fill(1);
  const ctx = { N, sites, camera: cameraFromFov({ width: 640, height: 480, fov: 40 }), dl: 3, lit };
  const sum = m => m.reduce((a, b) => a + b, 0);
  assert.equal(sum(occlusionMask('dropout', 0, ctx, makeRng(1))), 0);
  assert.equal(sum(occlusionMask('dropout', 1, ctx, makeRng(1))), sites);
  assert.ok(sum(occlusionMask('blob', 0, ctx, makeRng(2))) <= 1);
  assert.ok(sum(occlusionMask('blob', 2, ctx, makeRng(3))) > 10);
  let viewUnobserved = 0;
  for (let i = 0; i < 5; i += 1) viewUnobserved += sum(occlusionMask('view', 5.2, ctx, makeRng(10 + i)));
  assert.ok(viewUnobserved > 0);
  assert.throws(() => occlusionMask('magic', 1, ctx, makeRng(1)), RangeError);
});

test('trial — U 가 비면 실패 없음(q=0), 전부 미관측이면 모든 블록 실패', () => {
  const pl = xProfileLayout('X0');
  const symbols = Math.floor(pl.digits / 3);
  const orders = scanOrders(pl, 2);
  const nsymFor = S => xNsymFor(S, 'M');
  const sites = pl.raw.N ** 3;
  const none = trial({ orders, symbols, blocks: [1, 2], assignments: ['contiguous', 'interleaved'], nsymFor, U: new Uint8Array(sites), q: 0, rng: makeRng(1), sites });
  assert.ok(Object.values(none).every(r => !r.fail && r.e.every(x => x === 0) && r.s.every(x => x === 0)));
  const all = trial({ orders, symbols, blocks: [1, 2], assignments: ['contiguous'], nsymFor, U: new Uint8Array(sites).fill(1), q: 0, rng: makeRng(1), sites });
  assert.ok(Object.values(all).every(r => r.fail && r.e.reduce((a, b) => a + b, 0) === symbols));
});

test('assertProbeOptions — 실행 전 거절: trials ∞/0/과대 · q 범위 · seed 범위 · blocks 비정수 · 총 작업 cap · unknownMode 어휘', () => {
  const base = { profile: 'X0', trials: 10, seed: 1, blocks: '1', q: '0,0.01', dropoutP: '0.01', blobR: '1.5', width: 640, height: 480, fov: 40, dl: 3, minSep: 2.5 };
  assert.doesNotThrow(() => assertProbeOptions(base));
  assert.throws(() => assertProbeOptions({ ...base, trials: Infinity }), /trials/);
  assert.throws(() => assertProbeOptions({ ...base, trials: 0 }), /trials/);
  assert.throws(() => assertProbeOptions({ ...base, trials: 2.5 }), /trials/);
  assert.throws(() => assertProbeOptions({ ...base, trials: 20001 }), /trials/);
  assert.throws(() => assertProbeOptions({ ...base, q: '0,2' }), /q/);
  assert.throws(() => assertProbeOptions({ ...base, q: 'abc' }), /q/);
  assert.throws(() => assertProbeOptions({ ...base, seed: 5000 }), /seed/);
  assert.throws(() => assertProbeOptions({ ...base, blocks: '1,2.5' }), /blocks/);
  assert.throws(() => assertProbeOptions({ ...base, dropoutP: '0.01,NaN' }), /dropoutP/);
  assert.throws(() => assertProbeOptions({ ...base, minSep: -1 }), /minSep/);
  assert.throws(() => assertProbeOptions({ ...base, unknownMode: 'magic' }), /unknownMode/);
  assert.throws(() => assertProbeOptions({ ...base, trials: 20000, q: '0,0.01,0.02,0.03', dropoutP: '0.01,0.02,0.03,0.04,0.05,0.06,0.07,0.08', blocks: '1,2,3,4' }), /총 작업량/);
  assert.throws(() => runRealProbe({ profile: 'X0', trials: Infinity }), /trials/);
  assert.throws(() => runRealProbe({ profile: 'X0', trials: 2, erasureReserve: 2 }), /erasureReserve/); // --real 은 reserve 를 decodeX 에 안 넘겨요 — 거짓 표기 금지
  assert.throws(() => runRealProbe({ profile: 'X0', trials: 2, crc: 'crc32' }), /crc/);
  assert.throws(() => runRealProbe({ profile: 'X0', trials: 2, rngSplit: 'maybe' }), /rngSplit/);
  assert.doesNotThrow(() => runRealProbe({ profile: 'X0', trials: 2, erasureReserve: 0, dropoutP: '0.01', blobR: '1.5', q: '0' }));
  // 기본(대리지표) 진입점도 같은 검사를 지나요 — trials 0/∞, 거대 목록, q 목록(legacy 는 scalar) 전부 실행 전 거절
  assert.throws(() => runProbe({ profile: 'X0', trials: Infinity }), /trials/);
  assert.throws(() => runProbe({ profile: 'X0', trials: 0 }), /trials/);
  assert.throws(() => runProbe({ profile: 'X0', trials: 2, q: '0,0.01' }), /scalar/);
  assert.throws(() => runProbe({ profile: 'X0', trials: 2, dropoutP: Array.from({ length: 17 }, () => 0.01).join(',') }), /목록 길이/);
});

test('runRealProbe — 유효 본문 실복호: q=0·작은 dropout 은 실패 0, 결정적, pairs 합 = trials, wrongText 0, 공유 사건은 순서 무관', () => {
  const opts = { profile: 'X0', trials: 12, seed: 5, dropoutP: '0.01', blobR: '1.5', minSep: 2.5, q: '0,0.01', unknownMode: 'oracle' };
  const a = runRealProbe(opts), b = runRealProbe(opts);
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.rows.length, 3 * 2 * REAL_ORDERS.length); // 모델 3 × q 2 × 순서 2
  for (const r of a.rows) { assert.ok(r.pFail >= 0 && r.pFail <= 1); assert.equal(r.wrongText, 0, '조용한 오답 금지'); assert.equal(r.trials, 12); }
  for (const r of a.rows.filter(r => r.model === 'dropout' && r.q === 0)) assert.equal(r.pFail, 0, 'q=0·p=.01 은 소거 예산 안');
  for (const p of a.pairs) assert.equal(p.aFail_bOk + p.aOk_bFail + p.bothFail + p.bothOk, 12);
  assert.equal(a.outcomes.length, a.pairs.length);
  // conservative 는 oracle 보다 실패가 같거나 많아요(미관측 소등 자리도 소거)
  const c = runRealProbe({ ...opts, unknownMode: 'conservative' });
  for (let i = 0; i < a.rows.length; i += 1) assert.ok(c.rows[i].pFail >= a.rows[i].pFail, `${a.rows[i].model} ${a.rows[i].q} ${a.rows[i].orderId}`);
  // 공유 사건: 같은 event 를 같은 lit 에 적용하면 같은 U, dropout U 는 lit 과 무관
  const ctx = { N: 8, sites: 512, camera: { model: 'pinhole-rectified', width: 640, height: 480, fx: 800, fy: 800, cx: 320, cy: 240 }, dl: 3 };
  const ev = drawEvent(ctx, (() => { let i = 0; return () => ((i += 1) * 0.6180339887) % 1; })());
  const lit1 = new Uint8Array(512).fill(1), lit0 = new Uint8Array(512);
  assert.deepEqual(applyEvent('dropout', 0.1, ev, ctx, lit1), applyEvent('dropout', 0.1, ev, ctx, lit0));
  assert.deepEqual(applyEvent('blob', 2, ev, ctx, lit1), applyEvent('blob', 2, ev, ctx, lit0));
  assert.ok(applyEvent('view', 2.5, ev, ctx, lit1).reduce((x, y) => x + y, 0) >= applyEvent('view', 2.5, ev, ctx, lit0).reduce((x, y) => x + y, 0));
});

test('runRealProbe --crc / --rngSplit — CRC 모드는 verified 까지 성공 조건, payload 26 B; rngSplit 은 payload 길이가 달라도 같은 물리 사건', () => {
  const base = { profile: 'X0', trials: 8, seed: 5, dropoutP: '0.02', blobR: '2.5', minSep: 2.5, q: '0.01', unknownMode: 'oracle' };
  const off = runRealProbe(base), on = runRealProbe({ ...base, crc: true });
  assert.equal(off.crc, null); assert.equal(on.crc, 'x-crc32c-v0'); assert.equal(on.payloadBytes, 26); assert.equal(off.payloadBytes, 30);
  assert.equal(on.successCriterion.includes('verified'), true);
  for (const r of on.rows) { assert.equal(r.crc, 'x-crc32c-v0'); assert.ok(Number.isInteger(r.crcRejects)); assert.equal(r.wrongText, 0, 'CRC 모드에서 조용한 오답은 0 이어야 해요'); }
  for (const r of off.rows) assert.equal(r.crcRejects, null);
  // rngSplit: on(26 B)/off(30 B) 가 «같은 물리 사건» 을 공유하는지 사건 digest 배열로 실제 비교(codex 0125) — 기본(단일 스트림)은 길이가 바뀌면 사건이 달라져요
  const offS = runRealProbe({ ...base, rngSplit: true }), onS = runRealProbe({ ...base, rngSplit: true, crc: true });
  assert.equal(offS.rngSplit, true); assert.equal(onS.rngSplit, true);
  for (let i = 0; i < offS.outcomes.length; i += 1) assert.deepEqual(onS.outcomes[i].eventDigests, offS.outcomes[i].eventDigests, `사건 digest ${i}`);
  assert.notDeepEqual(on.outcomes[0].eventDigests, off.outcomes[0].eventDigests, '단일 스트림은 길이가 다르면 사건이 달라요');
  // 단계 enum·회계: 각 행 stages 합 = trials, ok 수 = trials − fails, on 모드 inconsistent 0, crcStageTrials 길이 = crcRejects
  for (const r of [...on.rows, ...off.rows]) {
    assert.equal(Object.values(r.stages).reduce((x, y) => x + y, 0), r.trials);
    assert.equal(r.stages.ok, Math.round(r.trials * (1 - r.pFail)));
  }
  for (const r of on.rows) { assert.equal(r.inconsistent, 0); assert.equal(r.crcStageTrials.length, r.crcRejects); }
  assert.deepEqual(on.stageEnum, REAL_STAGES);
  assert.equal(on.outcomes[0].perTrialStage.length, 8);
  // --payloadBytes: 양 arm 동일 본문 길이(순수 비교), 범위 검사; --orders 단일이면 pairs 없음
  const same = runRealProbe({ ...base, payloadBytes: 26 });
  assert.equal(same.payloadMode, 'fixed-override'); assert.equal(same.payloadBytes, 26); assert.equal(on.payloadMode, 'max-capacity-of-mode');
  assert.throws(() => runRealProbe({ ...base, crc: true, payloadBytes: 27 }), /payloadBytes/);
  const single = runRealProbe({ ...base, orders: 'cell-order-v0' });
  assert.deepEqual(single.orders, ['cell-order-v0']); assert.equal(single.pairs.length, 0); assert.ok(single.rows.every(r => r.orderId === 'cell-order-v0'));
  assert.throws(() => runRealProbe({ ...base, orders: 'zigzag' }), /orders/);
  // 문서화된 기본값: rngSplit 없음 = 기존 결과와 바이트 동일(결정성 보존)
  assert.deepEqual(runRealProbe(base).rows, off.rows);
});

test('classifyStage — decodeX 결과를 단계 enum 으로', () => {
  assert.equal(classifyStage({ ok: true, text: 'a', verified: true }, 'a', true), 'ok');
  assert.equal(classifyStage({ ok: true, text: 'a', verified: false }, 'a', false), 'ok');
  assert.equal(classifyStage({ ok: true, text: 'a', verified: false }, 'a', true), 'other');
  assert.equal(classifyStage({ ok: true, text: 'b' }, 'a', false), 'wrongText');
  for (const s of ['erasure-budget', 'rs', 'bytes', 'unframe', 'length', 'padding', 'crc', 'utf8']) assert.equal(classifyStage({ ok: false, stage: s, reason: 'x' }, 'a', true), s);
  // reason 만 있고 stage 가 없거나 미지면 엄격히 'other'(rs fallback 없음)
  assert.equal(classifyStage({ ok: false, reason: '소거 14 > nsym 13' }, 'a', false), 'other');
  assert.equal(classifyStage({ ok: false, stage: 'mystery', reason: 'x' }, 'a', false), 'other');
  assert.equal(classifyStage({ ok: false, stage: 'ok', reason: 'x' }, 'a', false), 'other');
  // 실제 decodeX 실패 반환은 전부 명시 stage 를 실어요
  const cap = xCapacity('X0');
  const enc = encodeX('stage', 'X0');
  const tooMany = Array.from(enc.levels);
  for (let i = 0; i <= cap.nsym; i += 1) tooMany[cap.layout.triples[i * 3][0]] = null;
  assert.equal(decodeX({ levels: tooMany }, 'X0').stage, 'erasure-budget');
  const digits = Array.from(enc.digits);
  for (let s = 0; s < cap.symbols; s += 1) digits[s * 3] = (digits[s * 3] + 3) % 6; // 전 심볼 오류 → RS 실패(또는 오정정 → bytes/unframe 단계) — 어쨌든 명시 stage
  const wrecked = decodeX({ digits }, 'X0');
  assert.ok(wrecked.ok || REAL_STAGES.includes(wrecked.stage), JSON.stringify(wrecked));
});

test('runProbe — 작은 실행이 행 수·필드·결정성을 지켜요', () => {
  const a = runProbe({ profile: 'X0', trials: 6, blocks: '1,2', dropoutP: '0.05', blobR: '2', seed: 7 });
  const b = runProbe({ profile: 'X0', trials: 6, blocks: '1,2', dropoutP: '0.05', blobR: '2', seed: 7 });
  assert.deepEqual(a.rows, b.rows, 'seed 결정성');
  // 모델 3 × 순서 3 × 배정 2 × 블록 2 = 36 행
  assert.equal(a.rows.length, 36);
  for (const r of a.rows) {
    assert.ok(r.pFail >= 0 && r.pFail <= 1 && r.meanE >= 0 && r.trials === 6);
    if (r.blocks === 1) assert.equal(r.meanMaxBlockE, r.meanE);
  }
  // 같은 모델·파라미터에서 총 e 의 순서 간 차이는 «심볼 묶음» 효과 — B 와 배정은 총 e 를 바꾸지 않아요
  const byOrder = {};
  for (const r of a.rows.filter(r => r.model === 'blob')) { (byOrder[r.orderId] ||= new Set()).add(r.meanE); }
  for (const [id, set] of Object.entries(byOrder)) assert.equal(set.size, 1, `${id} 총 e 는 블록/배정 무관`);
});
