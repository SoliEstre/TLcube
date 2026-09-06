/**
 * k3-cluster-order.test.js — K3 클러스터 정렬 키(«반경당 지지 밀도») 의 **성질** 자.
 *
 * 무엇을 지키나 (2026-09-06 처방 B, REPORT_r1-type-limits §12 · lanes/tl-locator/armB-density-u.md):
 *   ⓐ `compareClusters(cfg)` 가 **전순서**다 — 반대칭·추이·순열 무관 결정성,
 *      그리고 0 은 **같은 (x, y)** 에만 난다 (동률은 y → x 로 갈린다).
 *   ⓑ K5 는 **한 칸도 안 움직인다** — k5 만 있는 배열의 순서가 옛 비교자(count 내림차순)와 같다.
 *   ⓒ 정렬 키의 u 하한이 `cfg.minimumCoreUnitPx` **에서 유도**된다 — cfg 를 흔들면 하한이
 *      따라 움직이고, 하한 아래에서는 키가 `count/상수` 로 퇴화해 정렬이 count 와 같아진다.
 *   ⓓ 12 tl 프레임의 **참 K3 순위 ≤ `cfg.maximumVerifiedPerKind`**, 그리고 참 count 가
 *      **소-u 군중 최대 count 이상**이다 (하한이 «막아 주는» 게 아니라 동결만 하므로).
 *   ⓔ k26 27장 × {960, 1440} 끝단 복호가 밀도 팔 기록과 **장별 동일**.
 *   ⓕ 선형 참조판 ≡ 격자판 — 정렬을 바꿨으니 등가를 **덤프 없이도** 검산한다.
 *   ⓖ 하한이 **안 하는 일** — 소-u 군중을 `count/하한` 으로 동결할 뿐 0 으로 안 만든다.
 *      count 가 큰 소-u 잡음은 참을 이길 수 있다 (반례를 자로 굳혀 둔다).
 *   ⓗ 비컨 어댑터의 `csBlockLocator` 오버레이는 **정본 하나**다 — `central-beacon-adapt.js`
 *      소스(주석 벗긴 코드)에서 그 키들의 `key:` 리터럴이 `BEACON_CS_BLOCK_LOCATOR` 정의
 *      **밖**에 0건. ⚠ **철자 자**다 — 값이 아니라 «손 사본이 돌아오지 않았다» 를 잰다.
 *
 * ⚠ 이 파일은 **값이 아니라 성질**을 잰다. ⓒ 는 하한 리터럴(2.4)을 적지 않고
 * `K3_DENSITY_U_FLOOR_FACTOR × cfg.minimumCoreUnitPx` 에서 유도하며, ⓔ 의 기대표는
 * 손으로 옮긴 목록이 아니라 측정 산출 JSONL 에서 **읽어 만든다**. ⓓ 의 cfg 는 어댑터가
 * export 하는 `BEACON_CS_BLOCK_LOCATOR` 를 import 해 만들고(1920 을 여기 적지 않는다),
 * ⓗ 가 재는 키 목록도 그 상수의 `Object.keys` 에서 유도한다.
 *
 * ⚠ 이 자가 **안 덮는 축**: ① 기본 축소 패스(`searchMaxSide` 480)의 순서 — 거기서도
 * 키는 항등이 **아니고**(덤프 24장 전부에서 상위 80 이 49\~73/80 만 겹친다) 무회귀는
 * 코퍼스 A/B 로만 담보된다.
 * ✔ 닫힌 축 (2026-09-06): ② 비컨 어댑터가 실제로 주는 오버레이 값 — 종전 ⓓ 는 「축소 없음」
 * 을 프레임 크기에서 유도해 써서 어댑터가 480 으로 내려가도 안 빨개졌다. 이제
 * `central-beacon-adapt.js` 가 `BEACON_CS_BLOCK_LOCATOR` 를 export 하므로 ⓓ 가 그 값으로
 * cfg 를 만들고 `factor === 1` 을 단언한다 — 어댑터가 내려가면 ⓓ 가 빨개지고, 두 입구가
 * 다시 손 사본으로 갈리면 ⓗ 가 빨개진다.
 *
 * ⓓ·ⓔ 는 실사진 **휘도 덤프**(`test/output/photos/luma`, gitignore)가 있어야 돈다.
 * 없으면 skip 하고 이름이 그렇게 말한다 — 통합자는 skipped 수를 본다.
 * 단 ⓔ 는 **덤프가 있는데 기대표만 없으면 skip 이 아니라 fail** 이다 — 레인 워크트리에서
 * 조용히 사라지던 자리다 (`TL_K26_EXPECT_JSONL` 로 경로를 준다).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BEACON_CS_BLOCK_LOCATOR } from '../src/decoder/central-beacon-adapt.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS, UNVERIFIED_CS_BLOCK_LOCATOR,
} from '../src/decoder/cellsurface-block-detect.js';
import { downsampleLumaForSeed, otsuThreshold } from '../src/decoder/finder-seed.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { listLumaDumps, lumaToRaster, readLumaDump } from '../tools/read-luma.mjs';

const {
  clusterOrderValue, compareClusters, K3_DENSITY_U_FLOOR_FACTOR,
  scanConcentricCores, clusterCores, clusterCoresLinear,
  verifyV0Cluster,
} = CS_BLOCK_LOCATOR_INTERNALS;

const BASE_CFG = UNVERIFIED_CS_BLOCK_LOCATOR;

/** 옛 비교자 — 「K5 는 안 움직인다」·「하한 아래 퇴화」의 **대조군**이다. 고치지 마라. */
const legacyCompare = (left, right) =>
  right.count - left.count || left.y - right.y || left.x - right.x;

/** 시드 난수 (mulberry32) — 표본이 기계마다 같아야 «결정성» 을 잴 수 있다. */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 표본 클러스터 — 소스가 조립하는 모양 그대로 `{kind, count, u, x, y}` 다.
 * (x, y) 는 **전부 다르게** 만든다: 그래야 「0 은 같은 (x, y) 에만」과
 * 「순열 무관 결정성」이 서로를 검증한다.
 */
function makeClusters(count, { seed = 1234, kinds = ['k3', 'k5'], uMax = 6 } = {}) {
  const random = makeRandom(seed);
  const clusters = [];
  for (let i = 0; i < count; i += 1) {
    clusters.push({
      kind: kinds[Math.floor(random() * kinds.length)],
      // count 는 작은 정수 범위로 — 동률이 실제로 생겨야 타이브레이크를 잰다.
      count: 2 + Math.floor(random() * 20),
      u: 0.5 + random() * uMax,
      x: (i % 20) * 3 + random() * 0.5,
      y: Math.floor(i / 20) * 3 + random() * 0.5,
    });
  }
  return clusters;
}

function shuffle(items, seed) {
  const random = makeRandom(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const sign = (value) => (value > 0 ? 1 : value < 0 ? -1 : 0);
/** `-0` 을 안 만드는 부호 반전 (strict 비교에서 `-0 !== 0` 이라 자가 헛짚는다). */
const negate = (value) => (value === 0 ? 0 : -value);
const identity = (cluster) => `${cluster.kind}|${cluster.count}|${cluster.u}|${cluster.x}|${cluster.y}`;

// ───────────────────────────── ⓐ 전순서·결정성 ─────────────────────────────

test('ⓐ compareClusters 는 반대칭이고, 0 은 같은 (x, y) 에만 난다', () => {
  const cfg = BASE_CFG;
  const compare = compareClusters(cfg);
  const clusters = makeClusters(300);
  assert.equal(clusters.length, 300);

  let zeroPairs = 0;
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = 0; j < clusters.length; j += 1) {
      const a = clusters[i];
      const b = clusters[j];
      const forward = compare(a, b);
      const backward = compare(b, a);
      assert.ok(Number.isFinite(forward), `비교값이 유한하지 않다: ${identity(a)} vs ${identity(b)}`);
      assert.equal(sign(forward), negate(sign(backward)),
        `반대칭 위반: cmp(a,b)=${forward} cmp(b,a)=${backward} — ${identity(a)} / ${identity(b)}`);
      if (sign(forward) === 0) {
        zeroPairs += 1;
        assert.equal(a.x, b.x, `0 인데 x 가 다르다 — ${identity(a)} / ${identity(b)}`);
        assert.equal(a.y, b.y, `0 인데 y 가 다르다 — ${identity(a)} / ${identity(b)}`);
      }
    }
  }
  // (x, y) 가 전부 다른 표본이라 0 은 «자기 자신» 300쌍뿐이어야 한다.
  assert.equal(zeroPairs, clusters.length,
    '0 쌍이 대각선(자기 자신)보다 많다 — 서로 다른 자리가 동률로 붙었다');
});

test('ⓐ compareClusters 는 추이적이다 (표본 삼중)', () => {
  const compare = compareClusters(BASE_CFG);
  const clusters = makeClusters(300, { seed: 99 });
  const random = makeRandom(31337);
  const trials = 30_000;
  for (let n = 0; n < trials; n += 1) {
    const a = clusters[Math.floor(random() * clusters.length)];
    const b = clusters[Math.floor(random() * clusters.length)];
    const c = clusters[Math.floor(random() * clusters.length)];
    if (compare(a, b) <= 0 && compare(b, c) <= 0) {
      assert.ok(compare(a, c) <= 0,
        `추이 위반: a≤b≤c 인데 a>c — ${identity(a)} / ${identity(b)} / ${identity(c)}`);
    }
  }
});

test('ⓐ 같은 다중집합은 어떤 순열에서 출발해도 같은 순서로 정렬된다 (결정성)', () => {
  const compare = compareClusters(BASE_CFG);
  const clusters = makeClusters(300, { seed: 7 });

  const once = clusters.slice().sort(compare).map(identity);
  const twice = clusters.slice().sort(compare).map(identity);
  assert.deepEqual(twice, once, '같은 배열을 두 번 정렬했는데 결과가 다르다');

  for (const seed of [1, 2, 3, 4, 5]) {
    const permuted = shuffle(clusters, seed).sort(compare).map(identity);
    assert.deepEqual(permuted, once,
      `순열 ${seed} 에서 정렬 결과가 갈렸다 — 전순서가 아니다(동률에 잔여 자유도)`);
  }
});

// ───────────────────────────── ⓑ K5 불변 ─────────────────────────────

test('ⓑ k5 만 있는 배열의 순서는 옛 비교자(count 내림차순)와 같다', () => {
  const clusters = makeClusters(300, { seed: 4242, kinds: ['k5'] });
  assert.ok(clusters.every((cluster) => cluster.kind === 'k5'));

  const now = clusters.slice().sort(compareClusters(BASE_CFG)).map(identity);
  const legacy = clusters.slice().sort(legacyCompare).map(identity);
  assert.deepEqual(now, legacy, 'K5 끼리의 상대 순서가 움직였다 — 브리프 범위 밖이다');

  // 키 자체도 count 그대로여야 한다 (cfg 를 흔들어도 안 움직인다).
  for (const minimumCoreUnitPx of [0.3, 1.2, 5]) {
    for (const cluster of clusters.slice(0, 20)) {
      assert.equal(clusterOrderValue(cluster, { ...BASE_CFG, minimumCoreUnitPx }), cluster.count,
        'K5 정렬 값이 count 가 아니다');
    }
  }
});

// ───────────────────────────── ⓒ 키 유도 ─────────────────────────────

test('ⓒ K3 키의 u 하한은 cfg.minimumCoreUnitPx 를 따라 움직인다 (리터럴 사본 없음)', (t) => {
  const measured = [];
  for (const minimumCoreUnitPx of [0.4, 0.75, 1.2, 2, 3.5]) {
    const cfg = { ...BASE_CFG, minimumCoreUnitPx };
    const expectedFloor = K3_DENSITY_U_FLOOR_FACTOR * minimumCoreUnitPx;

    // 하한을 «찾는다»: u 를 올리면서 키가 **처음 움직이는** 자리가 하한이다.
    const probe = (u) => clusterOrderValue({ kind: 'k3', count: 12, u, x: 0, y: 0 }, cfg);
    const plateau = probe(1e-6);
    const step = expectedFloor / 4000;
    let breakpoint = null;
    for (let u = step; u < expectedFloor * 3; u += step) {
      if (probe(u) !== plateau) { breakpoint = u; break; }
    }
    assert.ok(breakpoint !== null, `키가 u 에 전혀 반응하지 않는다 (mcup=${minimumCoreUnitPx})`);
    assert.ok(Math.abs(breakpoint - expectedFloor) <= step * 2,
      `하한이 cfg 에서 유도되지 않았다: 측정 ${breakpoint} vs 유도 ${expectedFloor} (mcup=${minimumCoreUnitPx})`);
    measured.push(`mcup=${minimumCoreUnitPx} floor≈${breakpoint.toFixed(4)}`);

    // 하한 아래 = `count / 하한`. 즉 cfg 를 2배 하면 키가 정확히 절반이 된다.
    assert.equal(probe(1e-6), 12 / expectedFloor, '하한 아래 키가 count/하한 이 아니다');
  }
  t.diagnostic(`측정된 하한: ${measured.join(' · ')}`);

  // 하한이 커지면(=cfg 가 커지면) 같은 u 에서 키는 작아진다 — 단조 응답.
  const cluster = { kind: 'k3', count: 9, u: 1.5, x: 0, y: 0 };
  const small = clusterOrderValue(cluster, { ...BASE_CFG, minimumCoreUnitPx: 1.2 });
  const large = clusterOrderValue(cluster, { ...BASE_CFG, minimumCoreUnitPx: 2.4 });
  assert.ok(large < small, 'cfg 를 키웠는데 키가 안 줄었다 — 하한이 cfg 에 안 묶여 있다');
});

test('ⓒ u 가 전부 하한 아래면 K3 정렬은 count 순서로 퇴화한다', () => {
  const cfg = BASE_CFG;
  const floor = K3_DENSITY_U_FLOOR_FACTOR * cfg.minimumCoreUnitPx;
  // u ≤ 하한 인 k3 만 — **합성으로 만든 구간**이다. ⚠ 실제 축소 패스(480)의 u 분포가
  // 이 구간이라는 armB-density-u.md §8 의 가설은 2026-09-06 실측으로 **반박됐다**
  // (덤프 24장 축소판 u 중앙값 1.58\~3.97, k3 의 12\~92 % 가 하한 위). 즉 이 자는
  // 「하한 아래에서 퇴화한다」는 **키의 성질**을 잴 뿐, 어느 패스가 그 구간이라는
  // 주장은 하지 않는다.
  const clusters = makeClusters(300, { seed: 555, kinds: ['k3'], uMax: 1 })
    .map((cluster) => ({ ...cluster, u: Math.min(cluster.u, floor) }));
  assert.ok(clusters.every((cluster) => cluster.u <= floor));

  const now = clusters.slice().sort(compareClusters(cfg)).map(identity);
  const legacy = clusters.slice().sort(legacyCompare).map(identity);
  assert.deepEqual(now, legacy,
    '하한 아래에서 정렬이 count 와 달라졌다 — 키가 count/상수 로 퇴화하지 않았다');
});

// ───────────────── ⓖ 하한이 «안 하는 일» (반례를 자로 굳힌다) ─────────────────

test('ⓖ 하한은 소-u 군중을 count/하한 으로 **동결**할 뿐이다 — 참을 막아 주지 않는다', (t) => {
  const cfg = BASE_CFG;
  const floor = K3_DENSITY_U_FLOOR_FACTOR * cfg.minimumCoreUnitPx;

  // ① 동결: 하한 아래에서는 u 가 달라도 키가 같다 (분모가 상수).
  const frozenA = clusterOrderValue({ kind: 'k3', count: 16, u: floor / 4, x: 0, y: 0 }, cfg);
  const frozenB = clusterOrderValue({ kind: 'k3', count: 16, u: floor / 1.001, x: 0, y: 0 }, cfg);
  assert.equal(frozenA, frozenB, '하한 아래인데 u 가 키를 움직였다 — 동결이 아니다');
  assert.equal(frozenA, 16 / floor, '동결값이 count/하한 이 아니다');

  // ② **반례**: 참이 크고(u ≫ 하한) 잡음이 작으면(u ≤ 하한) count 만으로 뒤집힌다.
  //    임계 count 를 «유도»한다 — 리터럴을 적지 않는다.
  const truth = { kind: 'k3', count: 42, u: 3 * floor, x: 10, y: 10 };
  const truthKey = clusterOrderValue(truth, cfg);
  const beatingCount = Math.floor(truthKey * floor) + 1;   // count/하한 > 참 키 인 최소 정수
  assert.ok(beatingCount < truth.count,
    '반례가 성립하려면 이기는 데 필요한 잡음 count 가 참 count 보다 작아야 한다');

  const crowd = [];
  for (let i = 0; i < 100; i += 1) {
    crowd.push({ kind: 'k3', count: beatingCount, u: floor * 0.75, x: 100 + i, y: 200 + i });
  }
  const ranked = [truth, ...crowd].sort(compareClusters(cfg)).map(identity);
  assert.equal(ranked.indexOf(identity(truth)), crowd.length,
    '소-u 군중이 참을 못 눌렀다 — 이 자가 반례를 잘못 조립했다');
  t.diagnostic(`참 키 ${truthKey.toFixed(3)} vs 동결 잡음 키 ${(beatingCount / floor).toFixed(3)}`
    + ` (count ${beatingCount} < 참 count ${truth.count})`);

  // ③ 그래서 이 키가 사는 조건은 「하한이 막는다」가 아니라 «참 키 > 군중 최대 키» 다.
  //    군중 count 를 임계 아래로 낮추면 참이 즉시 1위로 돌아온다.
  const tamed = crowd.map((cluster) => ({ ...cluster, count: beatingCount - 1 }));
  const rankedTamed = [truth, ...tamed].sort(compareClusters(cfg)).map(identity);
  assert.equal(rankedTamed.indexOf(identity(truth)), 0,
    '군중 count 를 임계 아래로 내렸는데도 참이 1위가 아니다');
});

// ──────────── ⓕ 선형 참조판 ≡ 격자판 (합성 — 덤프 없는 체크아웃에서도 돈다) ────────────

/** 코어 후보 합성 — `scanConcentricCores` 가 내는 모양 그대로 `{kind, x, y, u}` 다. */
function makeCandidates(count, { seed = 20260906, uMax = 6, span = 200 } = {}) {
  const random = makeRandom(seed);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // 절반은 «앵커 주변 뭉치» — 그래야 클러스터가 실제로 여러 후보를 모은다.
    const anchor = Math.floor(random() * 40);
    const jitter = () => (random() - 0.5) * 4;
    const u = 0.6 + random() * uMax;
    out.push({
      kind: random() < 0.5 ? 'k3' : 'k5',
      x: (anchor % 8) * (span / 8) + jitter(),
      y: Math.floor(anchor / 8) * (span / 5) + jitter(),
      u,
    });
  }
  return out;
}

test('ⓕ 격자판과 선형 참조판이 같은 클러스터를 **같은 순서로** 낸다 (합성 후보)', (t) => {
  const cfg = BASE_CFG;
  const candidates = makeCandidates(3000);
  const grid = clusterCores(candidates, cfg);
  const linear = clusterCoresLinear(candidates, cfg);

  // 자 자신의 검산 — 표본이 시시하면 등가가 «참»이어도 아무것도 안 지킨다.
  assert.ok(grid.length >= 20, `클러스터가 너무 적다(${grid.length}) — 표본이 등가를 못 잰다`);
  assert.ok(grid.some((c) => c.kind === 'k3') && grid.some((c) => c.kind === 'k5'),
    '두 종류가 다 있어야 «종류 간 끼워넣기» 까지 잰다');
  assert.ok(grid.some((c) => c.count >= 3), '군집이 안 생겼다 — 후보가 흩어지기만 했다');

  assert.equal(linear.length, grid.length, '선형판·격자판의 클러스터 개수가 다르다');
  for (let i = 0; i < grid.length; i += 1) {
    assert.deepEqual(
      [linear[i].kind, linear[i].count, linear[i].x, linear[i].y, linear[i].u],
      [grid[i].kind, grid[i].count, grid[i].x, grid[i].y, grid[i].u],
      `선형판·격자판이 ${i} 번째에서 갈렸다`);
  }
  t.diagnostic(`후보 ${candidates.length} → 클러스터 ${grid.length}`
    + ` (k3 ${grid.filter((c) => c.kind === 'k3').length})`);
});

/**
 * ⓗ — ⚠ **철자 자**다. 값이 아니라 «손 사본이 돌아오지 않았다» 를 잰다.
 *
 * `central-beacon-adapt.js` 의 두 발견 입구는 2026-09-06 까지 `csBlockLocator` 오버레이
 * (`maximumPosesPerFamily`·`centreWindowFraction`·`searchMaxSide`)를 서로 손 사본으로 들고
 * 있었다 (REPORT_r1-type-limits §13 적대 검토). 정본을 `BEACON_CS_BLOCK_LOCATOR` 하나로
 * 뽑았으니, 그 정의 **밖**에 이 키들의 `key:` 리터럴이 다시 생기면 사본이 돌아온 것이다.
 *
 * 재는 법: 주석을 벗긴 **코드**만 본다 (산문 속 `searchMaxSide: 480` 은 사본이 아니다).
 * 키 목록은 import 한 상수의 `Object.keys` 에서 유도한다 — 상수에 키가 늘면 자도 따라 늘고,
 * 정의 블록을 못 찾으면 통과가 아니라 **실패**다 (이름·모양이 바뀌면 이 자를 같이 옮겨라).
 * 이 자가 못 덮는 것: 한 입구가 스프레드 자체를 빼 버리는 회귀 — 그건 어댑터 동작 자
 * (`central-v0-beacon-detect.test.js`·`central-n7-detect.test.js`) 의 몫이다.
 */
test('ⓗ 어댑터 csBlockLocator 오버레이는 정본 하나 — 키 리터럴이 BEACON_CS_BLOCK_LOCATOR 정의 밖에 0건 (철자 자)', () => {
  const keys = Object.keys(BEACON_CS_BLOCK_LOCATOR);
  assert.ok(keys.includes('searchMaxSide'), '이 자를 열게 한 키(searchMaxSide)가 상수에 없다');
  assert.ok(Object.isFrozen(BEACON_CS_BLOCK_LOCATOR), '정본은 동결이어야 한다 — 런타임에 갈리면 정본이 아니다');

  const src = readFileSync(new URL('../src/decoder/central-beacon-adapt.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const definition = code.match(/export const BEACON_CS_BLOCK_LOCATOR = Object\.freeze\(\{[\s\S]*?\}\);/);
  assert.ok(definition,
    'BEACON_CS_BLOCK_LOCATOR 의 `export const … = Object.freeze({…});` 정의를 못 찾았다 — 이름·모양이 바뀌었으면 이 자를 같이 옮겨라');

  const keyLiteral = new RegExp(`\\b(${keys.join('|')})\\s*:`, 'g');
  const inside = [...definition[0].matchAll(keyLiteral)].map((m) => m[1]).sort();
  assert.deepEqual(inside, keys.slice().sort(), '정본 안에 각 키가 정확히 한 번씩 있어야 한다');

  const outside = code.replace(definition[0], '');
  const leaks = [...outside.matchAll(keyLiteral)].map((m) => {
    const line = outside.slice(0, m.index).split('\n').length;
    return `${m[1]} (주석 벗긴 코드 ${line} 행 근처)`;
  });
  assert.deepEqual(leaks, [],
    'central-beacon-adapt.js 에 오버레이 키의 손 사본이 돌아왔다 — BEACON_CS_BLOCK_LOCATOR 를 스프레드하라');
});

// ─────────────────── ⓓ·ⓔ 실사진 덤프가 필요한 성질 ───────────────────

const DUMPS = listLumaDumps();
const dumpByName = new Map(DUMPS.map((entry) => [entry.name, entry]));

/**
 * 참 자리·피치 (운영자 제공 앵커 @960, 1440 = ×1.5) — `lanes/tl-locator/core-stage.md` §1.3.
 * `tl-K2-tele` 피치만 대입값이다(양 해상도 복호 실패). 판정 거리가 0.2~1.9 px 라
 * 피치 ±10 % 로는 어떤 판정도 안 바뀐다 (탐색 반경 = 1.5 셀).
 */
const TL_TRUTH_960 = Object.freeze({
  'k26-tl-K0-near': { x: 369.9, y: 473.8, pitch: 10.865 },
  'k26-tl-K0-tele': { x: 359.0, y: 481.1, pitch: 11.287 },
  'k26-tl-K1-near': { x: 376.2, y: 494.4, pitch: 9.621 },
  'k26-tl-K1-tele': { x: 357.6, y: 484.4, pitch: 9.911 },
  'k26-tl-K2-near': { x: 372.9, y: 472.1, pitch: 9.122 },
  'k26-tl-K2-tele': { x: 361.5, y: 485.8, pitch: 9.5 },
});

/**
 * ⓓ 가 재는 경로 = 비컨 어댑터(`central-beacon-adapt.js`)가 **실제로 여는** 코어 스캔.
 * cfg 는 어댑터가 export 하는 `BEACON_CS_BLOCK_LOCATOR` 를 기본 로케이터 설정 위에 얹어
 * 만든다 — 어댑터가 `calibration.csBlockLocator` 로 넘긴 오버레이를 `calibration()` 이 기본값
 * 위에 병합하는 그 모양이다. 이 코퍼스(짧은 변 960·1440)에서 그 오버레이는 «축소 없음»
 * (`factor === 1`) 이어야 하고, 아래에서 프레임마다 단언한다. 어댑터가 `searchMaxSide` 를
 * 480 으로 내리면 **여기서 빨개진다** — 2026-09-06 까지는 «축소 없음» 을 프레임 크기에서
 * 유도해 써서 안 빨개졌다 (파일 머리의 닫힌 축 ②).
 *
 * ⚠ 어댑터 상수를 손으로 옮겨 적지 **않는다** (사본은 썩는다) — import 다. 어댑터의 나머지
 * 오버레이(`centreWindowFraction`·`maximumPosesPerFamily`)는 `detectCellSurfaceBlockShapes`
 * 단계의 값이라 여기서 부르는 `scanConcentricCores`·`clusterCores`·`verifyV0Cluster` 는 읽지
 * 않는다 — cfg 에 실려 있어도 이 자에는 무해하다.
 */
function beaconAdapterCfg() {
  return { ...UNVERIFIED_CS_BLOCK_LOCATOR, ...BEACON_CS_BLOCK_LOCATOR };
}

const TL_FRAMES = Object.keys(TL_TRUTH_960)
  .flatMap((stem) => [960, 1440].map((res) => ({ stem, res, name: `${stem}.${res}.luma` })));
const TL_FRAMES_READY = TL_FRAMES.every((frame) => dumpByName.has(frame.name));

test('ⓓ 12 tl 프레임의 참 K3 가 예산 안에 들고, 소-u 군중에 count 로 안 진다 (휘도 덤프 필요)', {
  timeout: 1_800_000,
  skip: TL_FRAMES_READY ? false : 'tl 프레임 16비트 휘도 덤프 12장이 없다 — 워크트리엔 정션을 물려라',
}, (t) => {
  const budget = UNVERIFIED_CS_BLOCK_LOCATOR.maximumVerifiedPerKind;
  const floor = K3_DENSITY_U_FLOOR_FACTOR * UNVERIFIED_CS_BLOCK_LOCATOR.minimumCoreUnitPx;
  const cfg = beaconAdapterCfg();
  const ranks = [];

  for (const frame of TL_FRAMES) {
    const luma = readLumaDump(dumpByName.get(frame.name).path);
    assert.equal(luma.bitDepth, 16, `${frame.name} 은 16비트 직행 덤프여야 한다`);

    // armB-verify-rank.mjs 와 **같은 방식** — INTERNALS 로 코어 스캔 → 클러스터 → 소스 정렬.
    const reduced = downsampleLumaForSeed(luma, cfg.searchMaxSide);
    assert.equal(reduced.factor, 1,
      `${frame.name} (${luma.width}×${luma.height}): 축소가 걸렸다 (factor ${reduced.factor})`
      + ` — 어댑터 오버레이 searchMaxSide=${cfg.searchMaxSide} 는 이 코퍼스에서 «축소 없음» 이어야 한다`);
    const reducedLuma = reduced.luma;
    const cut = otsuThreshold(reducedLuma);
    const cores = scanConcentricCores(reducedLuma, cut, cfg);
    const clusters = clusterCores(cores, cfg);
    const linear = clusterCoresLinear(cores, cfg);

    // 격자판 ≡ 선형판 등가 계약 (소스 주석이 선 자리) — 정렬을 바꿨으니 같이 잰다.
    assert.equal(linear.length, clusters.length, `${frame.name}: 선형판 길이가 다르다`);
    for (let i = 0; i < clusters.length; i += 1) {
      assert.deepEqual(
        [linear[i].kind, linear[i].count, linear[i].x, linear[i].y, linear[i].u],
        [clusters[i].kind, clusters[i].count, clusters[i].x, clusters[i].y, clusters[i].u],
        `${frame.name}: 선형판·격자판 정렬이 ${i} 번째에서 갈렸다`);
    }

    const scale = frame.res === 1440 ? 1.5 : 1;
    const truth = TL_TRUTH_960[frame.stem];
    const tx = truth.x * scale / reduced.factor;
    const ty = truth.y * scale / reduced.factor;
    const searchR = 1.5 * truth.pitch * scale / reduced.factor;

    let seen = 0;
    let rank = null;
    let trueCluster = null;
    for (const cluster of clusters) {
      if (cluster.kind !== 'k3') continue;
      seen += 1;
      if (Math.hypot(cluster.x - tx, cluster.y - ty) > searchR) continue;
      const hit = verifyV0Cluster(reducedLuma, cut, cluster, cfg);
      if (hit && hit.kind === 'v0-center') { rank = seen; trueCluster = cluster; break; }
    }
    assert.ok(rank !== null,
      `${frame.name}: 참 자리에서 v0-center 로 검증되는 K3 클러스터를 못 찾았다`);

    // 하한이 **동결**하는 무리(u ≤ 하한)는 raw count 로 참과 다툰다 — ⓖ 가 합성으로
    // 굳힌 반례가 실사진에서 얼마나 가까이 서 있는지를 여기서 잰다.
    const k3 = clusters.filter((cluster) => cluster.kind === 'k3');
    const smallU = k3.filter((cluster) => cluster.u <= floor);
    const smallUMaxCount = smallU.reduce((acc, cluster) => Math.max(acc, cluster.count), 0);
    const trueKey = clusterOrderValue(trueCluster, cfg);
    const keyAtBudget = k3.length >= budget ? clusterOrderValue(k3[budget - 1], cfg) : null;
    ranks.push({
      frame: `${frame.stem}.${frame.res}`,
      rank,
      trueCount: trueCluster.count,
      trueU: trueCluster.u,
      smallUMaxCount,
      countMargin: trueCluster.count - smallUMaxCount,
      keyMargin: keyAtBudget === null ? null : trueKey - keyAtBudget,
      smallUBeatingTrue: smallU.filter((c) => clusterOrderValue(c, cfg) > trueKey).length,
    });
  }

  const worst = ranks.reduce((acc, row) => (row.rank > acc.rank ? row : acc), ranks[0]);
  t.diagnostic(`참 K3 순위: ${ranks.map((r) => `${r.frame}=${r.rank}`).join(' · ')}`);
  t.diagnostic(`최악 순위 ${worst.rank} (${worst.frame}) / 예산 ${budget}`);
  t.diagnostic(`count 여유(참 − 소-u 최대): ${ranks.map((r) => `${r.frame}=${r.countMargin}`).join(' · ')}`);
  t.diagnostic(`키 여유(참 − 예산끝): ${ranks.map((r) => `${r.frame}=`
    + (r.keyMargin === null ? 'n/a' : r.keyMargin.toFixed(3))).join(' · ')}`);
  t.diagnostic(`참을 이긴 소-u 개수: ${ranks.map((r) => `${r.frame}=${r.smallUBeatingTrue}`).join(' · ')}`);

  for (const row of ranks) {
    assert.ok(row.rank <= budget,
      `${row.frame}: 참 K3 순위 ${row.rank} 가 검증 예산 ${budget} 밖이다 (정렬 키가 뒤집혔다)`);
    // ⚠ 선행 지표다(충분조건이 아니다) — `K2-near.1440` 은 여유가 +5 인데도 소-u 하나가
    // 참을 이긴다(참 u 가 하한 위라 분모가 살아 있어서다). 음수로 내려가면 하한 동결이
    // 참을 삼키기 시작한 것이니 순위를 다시 재라.
    assert.ok(row.countMargin >= 0,
      `${row.frame}: 참 count ${row.trueCount} 가 소-u 군중 최대 ${row.smallUMaxCount} 보다 작다`
      + ' — 하한 동결이 참을 삼키는 구간이다 (ⓖ 반례 참조)');
  }
  assert.equal(ranks.length, TL_FRAMES.length);
});

/**
 * ⓔ 의 기대표 원천 — 처방 B 측정의 장별 성패 JSONL (측정 산출물, private 문서 repo).
 * **손으로 옮긴 목록이 아니다.** 사본 목록은 썩는다 — 여기서 읽어 유도한다.
 *
 * 경로는 `TL_K26_EXPECT_JSONL` 이 1순위고, 없으면 **배치 관례**를 탐침한다
 * (`finder-footprint.test.js`·`finder-oak-lineup.test.js` 가 정본 팩에 쓰는 그 규약):
 *   ① 중첩 체크아웃  <바깥repo>/TLcube/test → ../../.agent/...
 *   ② 형제 워크트리  <어딘가>/wt-* /test   → ../../TrilLuminanceCube/.agent/...
 * 기계 고정 절대경로를 박으면 다른 체크아웃에서 **조용히 skip** 되어 거짓 초록이 된다.
 */
const K26_EXPECT_LAYOUTS = [
  '../../.agent/lanes/tl-locator/armB-k26.jsonl',
  '../../TrilLuminanceCube/.agent/lanes/tl-locator/armB-k26.jsonl',
];
const K26_EXPECT_PATH = process.env.TL_K26_EXPECT_JSONL
  || K26_EXPECT_LAYOUTS
    .map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
    .find((candidate) => existsSync(candidate))
  || null;

const K26_RE = /^k26-(cube|qr|tl)-K([012])-(near|mid|tele)\.(\d+)\.luma$/;

function readK26Expectations(path) {
  const rows = readFileSync(path, 'utf8').trim().split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    // 밀도 팔만 (`density` · `density-clean`). legacy 는 **바꾸기 전** 이라 기대표가 아니다.
    .filter((row) => typeof row.arm === 'string' && row.arm.startsWith('density'));
  const byName = new Map();
  for (const row of rows) {
    const previous = byName.get(row.name);
    if (previous === undefined) { byName.set(row.name, row.ok === true); continue; }
    // 자 검증: rep 끼리 어긋나면 기대표 자체가 못 믿을 것이다 — 조용히 다수결하지 않는다.
    assert.equal(previous, row.ok === true,
      `${row.name}: 밀도 팔 rep 사이에서 성패가 갈린다 — 기대표를 만들 수 없다`);
  }
  return byName;
}

const K26_JOBS = DUMPS
  .filter((entry) => K26_RE.test(entry.name.replace(/\\/g, '/')))
  .sort((left, right) => (left.name < right.name ? -1 : 1));

/**
 * ⚠ **덤프가 있는데 기대표만 없으면 skip 이 아니라 fail** 이다.
 * 덤프를 정션으로 물린 레인 워크트리에서 기대표 경로만 어긋나 이 자가 통째로 사라지던
 * 자리다 — 「가장 필요한 자리에서만 조용히 없어지는 자」는 거짓 초록이다.
 * 덤프가 아예 없는 체크아웃(공개 repo·CI)은 잴 것이 없으니 그대로 skip 한다.
 */
test('ⓔ k26 27장 × {960,1440} 끝단 복호가 밀도 팔 기록과 장별 동일 (휘도 덤프 필요)', {
  timeout: 3_600_000,
  skip: K26_JOBS.length === 0 ? 'k26 휘도 덤프가 없다 — 워크트리엔 정션을 물려라' : false,
}, (t) => {
  assert.ok(K26_EXPECT_PATH !== null,
    `k26 덤프는 ${K26_JOBS.length}장 있는데 밀도 팔 기대표가 없다 — 환경변수`
    + ` TL_K26_EXPECT_JSONL 로 armB-k26.jsonl 경로를 주거나 문서 repo 를 배치 관례대로 놓아라`
    + ` (탐침한 관례: ${K26_EXPECT_LAYOUTS.join(' · ')})`);
  const expected = readK26Expectations(K26_EXPECT_PATH);
  const names = K26_JOBS.map((job) => job.name);
  assert.deepEqual(names.slice().sort(), [...expected.keys()].sort(),
    'k26 덤프 목록이 기대표의 장 목록과 다르다 — 코퍼스가 움직였다(자 감시)');

  // armB-k26.mjs 와 **같은 호출**이다 (같은 옵션, 같은 lumaToRaster 8비트 sRGB 왕복).
  const decodeOptions = Object.freeze({
    enableCellSurfaceY: true,
    bootstrap: Object.freeze({
      family: Object.freeze({ cube: Object.freeze({ enableCellSurfaceY: true }) }),
    }),
  });

  const mismatches = [];
  let ok = 0;
  for (const job of K26_JOBS) {
    const luma = readLumaDump(job.path);
    const result = decodeFrontend(lumaToRaster(luma), decodeOptions);
    const want = expected.get(job.name);
    if (result.ok) ok += 1;
    if (result.ok !== want) {
      mismatches.push({
        name: job.name,
        expected: want ? 'OK' : 'FAIL',
        actual: result.ok ? 'OK' : 'FAIL',
        reason: result.ok ? undefined : result.reason,
      });
    }
  }
  t.diagnostic(`k26 54행 ok ${ok}/${K26_JOBS.length} (기대 ${[...expected.values()].filter(Boolean).length})`);
  assert.deepEqual(mismatches, [],
    'k26 장별 성패가 밀도 팔 기록과 갈렸다 — 정렬 키가 끝단에서 다르게 선다');
});
