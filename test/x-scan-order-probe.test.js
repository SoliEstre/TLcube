import assert from 'node:assert/strict';
import test from 'node:test';
import { scanOrders, blockOf, occlusionMask, trial, runProbe } from '../tools/x-scan-order-probe.mjs';
import { xProfileLayout } from '../src/x-profile.js';
import { xNsymFor } from '../src/x-codec.js';
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
  assert.ok(meanStep(orders['morton-v0']) < meanStep(orders['cell-order-v0']), 'morton 이웃 거리 < cell-order');
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
