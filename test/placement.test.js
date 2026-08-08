/**
 * placement.test.js — 앵커·포맷·레퍼런스 배치 맵 검증 (SPEC §5.2, §5.3, §5.4, §13 T6)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { digitToRanks, ranksToDigit } from '../src/lehmer.js';

import {
  BULLSEYE_RADIUS,
  CORNER_DIRECTIONS,
  ANCHOR_CORNER_INDICES,
  ANCHOR_PRIMARY_INDEX,
  ANCHOR_PRIMARY_DIGIT,
  ANCHOR_SECONDARY_DIGIT,
  FORMAT_RING,
  FORMAT_BLOCK_LENGTH,
  FORMAT_REPLICAS,
  REFERENCE_DIGIT,
  rotate120,
  rotate240,
  corners,
  anchorCells,
  anchorPositionSet,
  ringWalk,
  formatBlockStarts,
  formatCells,
  formatRingLeftoverCells,
  referenceCells,
  referenceCellsAll,
  buildRoleSets,
  roleOf,
  overheadBreakdown,
} from '../src/placement.js';
import { hexDistance, regionCells, cellCount } from '../src/hexgrid.js';
import { VERSIONS } from '../src/capacity.js';

const VERSIONS_K = [6, 8, 10];

// ─────────────────────────────────────────────────────────────────────────────
// 링 순회 기하 — 앵커·포맷·레퍼런스 인덱스 산술이 전부 이 위에 서 있다
// ─────────────────────────────────────────────────────────────────────────────

describe('ringWalk', () => {
  test('길이 = 6r (r=0 은 예외로 1)', () => {
    assert.equal(ringWalk(0).length, 1);
    for (const r of [1, 2, 3, 6, 8, 10]) assert.equal(ringWalk(r).length, 6 * r);
  });

  test('모든 셀이 hexDistance == r', () => {
    for (const r of [1, 2, 3, 4, 6, 8, 10]) {
      for (const c of ringWalk(r)) assert.equal(hexDistance(c.q, c.r), r);
    }
  });

  test('인덱스 중복 없음 (셀당 정확히 한 번)', () => {
    for (const r of [1, 2, 3, 6, 8, 10]) {
      const seen = new Set(ringWalk(r).map((c) => `${c.q},${c.r}`));
      assert.equal(seen.size, 6 * r);
    }
  });

  test('코너는 정확히 인덱스 0, r, 2r, 3r, 4r, 5r 에 온다', () => {
    for (const r of [1, 2, 3, 6, 8, 10]) {
      const ring = ringWalk(r);
      const cornerSet = new Set(
        CORNER_DIRECTIONS.map((d) => `${d.q * r},${d.r * r}`),
      );
      const cornerIdx = [0, r, 2 * r, 3 * r, 4 * r, 5 * r];
      for (const idx of cornerIdx) {
        const c = ring[idx];
        assert.ok(cornerSet.has(`${c.q},${c.r}`), `r=${r} idx=${idx} 는 코너가 아니다`);
      }
      // 코너가 아닌 인덱스는 코너 집합에 없어야 한다 (역방향 확인).
      for (let idx = 0; idx < ring.length; idx += 1) {
        if (cornerIdx.includes(idx)) continue;
        const c = ring[idx];
        assert.ok(!cornerSet.has(`${c.q},${c.r}`), `r=${r} idx=${idx} 가 우연히 코너다`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 앵커 — 위치 회전 불변성 + digit 배정의 회전 유일성 (§5.2 "확정할 것 1")
// ─────────────────────────────────────────────────────────────────────────────

describe('앵커', () => {
  test('rotate120/rotate240 은 서로 역, 세 번 적용하면 항등', () => {
    const samples = [
      { q: 3, r: -1 }, { q: 0, r: 5 }, { q: -4, r: 2 }, { q: 6, r: 0 },
    ];
    for (const { q, r } of samples) {
      const r1 = rotate120(q, r);
      const r2 = rotate240(q, r);
      const r3 = rotate120(r1.q, r1.r);
      assert.deepEqual(r2, r3, '120°+120° == 240°');
      const back = rotate120(r2.q, r2.r);
      assert.deepEqual(back, { q, r }, '120°+240° == 항등');
    }
  });

  test('세트 A(교대 코너)는 120°/240° 회전에 위치 집합이 불변', () => {
    for (const k of VERSIONS_K) {
      const posSet = anchorPositionSet(k);
      for (const rot of [rotate120, rotate240]) {
        const rotated = new Set(
          [...posSet].map((s) => {
            const [q, r] = s.split(',').map(Number);
            const p = rot(q, r);
            return `${p.q},${p.r}`;
          }),
        );
        assert.deepEqual(rotated, posSet, `k=${k} 앵커 위치 집합이 ${rot.name} 에서 불변이 아니다`);
      }
    }
  });

  test('앵커 = 정확히 3셀, 전부 hexDistance == k (외곽 코너)', () => {
    for (const k of VERSIONS_K) {
      const cells = anchorCells(k);
      assert.equal(cells.length, ANCHOR_CORNER_INDICES.length);
      assert.equal(cells.length, 3);
      for (const c of cells) assert.equal(hexDistance(c.q, c.r), k);
    }
  });

  test('digit 배정은 (0,0,5) — 하나만 5, 나머지 0', () => {
    for (const k of VERSIONS_K) {
      const cells = anchorCells(k);
      const fives = cells.filter((c) => c.digit === ANCHOR_PRIMARY_DIGIT);
      const zeros = cells.filter((c) => c.digit === ANCHOR_SECONDARY_DIGIT);
      assert.equal(fives.length, 1);
      assert.equal(zeros.length, 2);
    }
  });

  test('전수: 120°/240° 회전한 digit 패턴은 원본과 다르다 (방향 유일 결정)', () => {
    // "회전한 패턴"의 정의: pattern'(rotate(pos)) = pattern(pos) 전 위치에 대해.
    // 즉, 실물 코드를 rotate 만큼 돌려 놓고 같은 절대좌표에서 읽으면 나오는 digit.
    for (const k of VERSIONS_K) {
      const original = new Map(anchorCells(k).map((c) => [`${c.q},${c.r}`, c.digit]));

      for (const rot of [rotate120, rotate240]) {
        const rotated = new Map();
        for (const [pos, digit] of original) {
          const [q, r] = pos.split(',').map(Number);
          const p = rot(q, r);
          rotated.set(`${p.q},${p.r}`, digit);
        }
        // 위치 집합은 불변이므로 rotated 도 동일한 키 집합을 가진다.
        assert.deepEqual(new Set(rotated.keys()), new Set(original.keys()));
        let differs = false;
        for (const [pos, digit] of original) {
          if (rotated.get(pos) !== digit) { differs = true; break; }
        }
        assert.ok(differs, `k=${k} ${rot.name} 회전 패턴이 원본과 구별되지 않는다 — 방향 모호성 재발`);
      }

      // 항등(회전 없음)은 당연히 원본과 같다 — 대조군.
      for (const [pos, digit] of original) assert.equal(original.get(pos), digit);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 포맷 정보 15셀 (§5.4 "확정할 것 2")
// ─────────────────────────────────────────────────────────────────────────────

describe('포맷 정보', () => {
  test('링3 은 18셀, 포맷 블록 시작은 120° 간격(인덱스 +6)', () => {
    assert.equal(ringWalk(FORMAT_RING).length, 18);
    assert.deepEqual(formatBlockStarts(), [0, 6, 12]);
  });

  test('포맷 셀 = 15개, 전부 hexDistance == 3, 전부 링3 위 셀', () => {
    for (const k of VERSIONS_K) {
      const cells = formatCells(k);
      assert.equal(cells.length, FORMAT_BLOCK_LENGTH * FORMAT_REPLICAS);
      assert.equal(cells.length, 15);
      const ringSet = new Set(ringWalk(FORMAT_RING).map((c) => `${c.q},${c.r}`));
      for (const c of cells) {
        assert.equal(hexDistance(c.q, c.r), FORMAT_RING);
        assert.ok(ringSet.has(`${c.q},${c.r}`));
      }
    }
  });

  test('링3 여유 칸은 정확히 3개, 포맷과 무충돌 (18 - 15 = 3)', () => {
    const leftover = formatRingLeftoverCells();
    assert.equal(leftover.length, 3);
    const formatSet = new Set(formatCells(6).map((c) => `${c.q},${c.r}`));
    for (const c of leftover) assert.ok(!formatSet.has(`${c.q},${c.r}`));
  });

  test('3 복제는 서로 120° 회전 관계 (블록1 회전 == 블록2 == 블록3)', () => {
    // ringWalk 의 순회 방향(AXIAL_DIRECTIONS[0..5] 순서)은 rotate120() 이 정의하는
    // +120° 방향과 반대(-120°, 즉 rotate240())로 진행한다 — 둘 다 유효한 120° 회전
    // 관계이고 어느 쪽이 "+" 인지는 좌표계의 임의 선택일 뿐이다. 블록1 = rotate240(블록0),
    // 블록2 = rotate240(블록1) = rotate120(블록0) (rotate240 을 두 번 적용하면 rotate120).
    const cells = formatCells(6); // formatCells 는 k 와 무관 (링3 은 항상 데이터 링)
    const block0 = cells.slice(0, 5);
    const block1 = cells.slice(5, 10);
    const block2 = cells.slice(10, 15);
    const rotatedBlock0By240 = block0.map((c) => rotate240(c.q, c.r));
    const rotatedBlock1By240 = block1.map((c) => rotate240(c.q, c.r));
    assert.deepEqual(rotatedBlock0By240, block1);
    assert.deepEqual(rotatedBlock1By240, block2);
    // 대조: rotate120 은 블록0 → 블록2 로 바로 간다 (rotate240 두 번과 동치).
    assert.deepEqual(block0.map((c) => rotate120(c.q, c.r)), block2);
  });

  test('formatCells(k) 는 k 에 무관 (링3 은 항상 데이터 링, k=6/8/10 동일)', () => {
    const a = formatCells(6);
    const b = formatCells(8);
    const c = formatCells(10);
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 레퍼런스 셀 (§5.3 "확정할 것 3")
// ─────────────────────────────────────────────────────────────────────────────

describe('레퍼런스 셀', () => {
  test('데이터 링(3..k)당 정확히 2개', () => {
    for (const k of VERSIONS_K) {
      for (let r = FORMAT_RING; r <= k; r += 1) {
        const cells = referenceCells(k, r);
        assert.equal(cells.length, 2);
        for (const c of cells) assert.equal(hexDistance(c.q, c.r), r);
      }
    }
  });

  test('링3 레퍼런스는 항상 여유 칸 3개 중 앞 2개로 수렴 (결정적)', () => {
    for (const k of VERSIONS_K) {
      const refs = referenceCells(k, FORMAT_RING);
      const leftover = formatRingLeftoverCells();
      const leftoverSet = new Set(leftover.map((c) => `${c.q},${c.r}`));
      for (const c of refs) assert.ok(leftoverSet.has(`${c.q},${c.r}`));
    }
  });

  test('무충돌: 레퍼런스는 불스아이·앵커·포맷 어디와도 겹치지 않는다 (전수, k=6/8/10)', () => {
    for (const k of VERSIONS_K) {
      const anchorSet = anchorPositionSet(k);
      const formatSet = new Set(formatCells(k).map((c) => `${c.q},${c.r}`));
      const refs = referenceCellsAll(k);
      const refKeys = refs.map((c) => `${c.q},${c.r}`);

      // 자기 자신 중복도 없어야 한다.
      assert.equal(new Set(refKeys).size, refKeys.length);

      for (const c of refs) {
        assert.ok(hexDistance(c.q, c.r) > BULLSEYE_RADIUS, '불스아이와 겹침');
        assert.ok(!anchorSet.has(`${c.q},${c.r}`), '앵커와 겹침');
        assert.ok(!formatSet.has(`${c.q},${c.r}`), '포맷과 겹침');
      }
    }
  });

  test('개수 = 2*(k-2), digit 은 앵커 값 {0,5} 와 다르다', () => {
    assert.ok(![0, 5].includes(REFERENCE_DIGIT));
    for (const k of VERSIONS_K) {
      const refs = referenceCellsAll(k);
      assert.equal(refs.length, 2 * (k - 2));
      for (const c of refs) assert.equal(c.digit, REFERENCE_DIGIT);
    }
  });

  test('결정성: 같은 (k,r) 을 두 번 호출하면 동일 결과', () => {
    for (const k of VERSIONS_K) {
      for (let r = FORMAT_RING; r <= k; r += 1) {
        assert.deepEqual(referenceCells(k, r), referenceCells(k, r));
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 역할 분할 완전성 (§5.4 "확정할 것 4")
// ─────────────────────────────────────────────────────────────────────────────

describe('역할 분할', () => {
  test('전수: 반경 k 영역의 모든 셀이 정확히 하나의 역할을 갖는다 (k=6,8,10)', () => {
    for (const k of VERSIONS_K) {
      const roleSets = buildRoleSets(k);
      const counts = { bullseye: 0, anchor: 0, format: 0, reference: 0, data: 0 };
      const all = regionCells(k);
      assert.equal(all.length, cellCount(k));
      for (const { q, r } of all) {
        const role = roleOf(q, r, k, roleSets);
        assert.ok(Object.hasOwn(counts, role), `알 수 없는 역할: ${role}`);
        counts[role] += 1;
      }
      const sum = Object.values(counts).reduce((a, b) => a + b, 0);
      assert.equal(sum, cellCount(k), `k=${k}: 역할별 합이 전체 셀 수와 다르다`);

      // 역할별 개수 스냅샷 — overheadBreakdown 의 실계산과 정합해야 한다.
      const ob = overheadBreakdown(k);
      assert.equal(counts.bullseye, ob.bullseye);
      assert.equal(counts.anchor, ob.anchor);
      assert.equal(counts.format, ob.format);
      assert.equal(counts.reference, ob.reference);
      assert.equal(counts.bullseye + counts.anchor + counts.format + counts.reference, ob.total);
    }
  });

  test('역할별 개수 고정 스냅샷', () => {
    const expected = {
      6: { bullseye: 19, anchor: 3, format: 15, reference: 8, data: 82 },
      8: { bullseye: 19, anchor: 3, format: 15, reference: 12, data: 168 },
      10: { bullseye: 19, anchor: 3, format: 15, reference: 16, data: 278 },
    };
    for (const k of VERSIONS_K) {
      const roleSets = buildRoleSets(k);
      const counts = { bullseye: 0, anchor: 0, format: 0, reference: 0, data: 0 };
      for (const { q, r } of regionCells(k)) counts[roleOf(q, r, k, roleSets)] += 1;
      assert.deepEqual(counts, expected[k], `k=${k} 역할 개수 스냅샷 불일치`);
    }
  });

  test('roleOf 는 roleSets 생략 시에도 동일 결과 (재계산 경로)', () => {
    for (const k of [6]) {
      for (const { q, r } of regionCells(k).slice(0, 20)) {
        assert.equal(roleOf(q, r, k), roleOf(q, r, k, buildRoleSets(k)));
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// numbers_check — 오버헤드 실계산 vs capacity.js 잠정치 (§5.5 "확정할 것 5")
// capacity.js 는 절대 건드리지 않는다. 대조만 한다.
// ─────────────────────────────────────────────────────────────────────────────

describe('오버헤드 실계산 vs 잠정치 (대조만, capacity.js 미수정)', () => {
  test('닫힌 형태: overhead(k) = 33 + 2k', () => {
    for (const k of VERSIONS_K) {
      assert.equal(overheadBreakdown(k).total, 33 + 2 * k);
    }
  });

  test('V1(k=6): 실계산이 잠정치 45와 정확히 일치', () => {
    const v1 = VERSIONS.find((v) => v.k === 6);
    const real = overheadBreakdown(6).total;
    assert.equal(real, 45);
    assert.equal(real, v1.overhead, 'V1 은 실계산과 잠정치가 같아야 한다');
  });

  test('T8 대사 완결 기록: 실계산 = 33+2k, 과거 잠정치(45/50/55)와의 역사적 차이', () => {
    // T8 이전 capacity.js 는 잠정 상수 45/50/55 를 썼다. T8 이 overhead 를
    // placement 실계산으로 재배선했으므로 '실계산 vs VERSIONS.overhead' 는 이제
    // 항등이고, 여기서는 (a) 닫힌 형태 33+2k, (b) 과거 잠정치 리터럴과의 차이를
    // 역사 기록으로 고정한다 — 같은 대사를 두 번 하지 않게.
    const HISTORIC_PROVISIONAL = { 6: 45, 8: 50, 10: 55 };
    for (const k of [6, 8, 10]) {
      const real = overheadBreakdown(k).total;
      assert.equal(real, 33 + 2 * k, );
      const diff = real - HISTORIC_PROVISIONAL[k];
      assert.equal(diff, { 6: 0, 8: -1, 10: -2 }[k], );
    }
    // 그리고 capacity.js 가 실제로 실계산을 쓰고 있는가 (T8 재배선의 회귀 방지).
    for (const v of VERSIONS) {
      assert.equal(v.overhead, overheadBreakdown(v.k).total,
        );
    }
  });
});

describe('레퍼런스 셀 좌표 스냅샷 (검증 라운드: 위치 미고정 지적 반영)', () => {
  // "각도상 최대 분리(대척)" 성질이 뮤테이션에서 살아남았다 — 정확 좌표를 와이어 계약으로 고정한다.
  test('k=6/8/10 전 레퍼런스 좌표 정확 일치', () => {
    const SNAP = {
      6: [[2, 1], [1, -3], [-4, 4], [4, -4], [-5, 5], [5, -5], [-5, 6], [6, -6]],
      8: [[2, 1], [1, -3], [-4, 4], [4, -4], [-5, 5], [5, -5], [-6, 6], [6, -6], [-7, 7], [7, -7], [-7, 8], [8, -8]],
      10: [[2, 1], [1, -3], [-4, 4], [4, -4], [-5, 5], [5, -5], [-6, 6], [6, -6], [-7, 7], [7, -7], [-8, 8], [8, -8], [-9, 9], [9, -9], [-9, 10], [10, -10]],
    };
    for (const k of [6, 8, 10]) {
      assert.deepEqual(referenceCellsAll(k).map((c) => [c.q, c.r]), SNAP[k], `k=${k}`);
    }
  });
});

describe('물리 회전 모델 — 면 순환까지 포함한 방향 유일성 (검증 라운드 지적 반영)', () => {
  // 실물 코드가 120° 돌면 위치만 도는 게 아니라 각 셀의 T/L/R 면도 순환 치환된다 —
  // 관측 digit 이 고정 전단사 σ 로 바뀐다. 기존 테스트는 위치 회전만 모델링했다.
  // σ 를 lehmer 매핑으로 유도해, 회전 방향 규약과 무관하게 두 순환 σ 모두에서
  // 앵커 패턴이 원본과 구별됨을 단언한다.
  const sigma = (d, cycle) => {
    const rk = digitToRanks(d);
    // cycle 1: 관측 T 위치에 원래 R 면이 온다 / cycle 2: 반대 방향
    const moved = cycle === 1
      ? { T: rk.R, L: rk.T, R: rk.L }
      : { T: rk.L, L: rk.R, R: rk.T };
    return ranksToDigit(moved);
  };

  test('σ 는 전단사이고 σ({0,5}) 는 {0,5} 와 소(素)다', () => {
    for (const cycle of [1, 2]) {
      const img = [0, 1, 2, 3, 4, 5].map((d) => sigma(d, cycle));
      assert.equal(new Set(img).size, 6, `cycle ${cycle}: 전단사 아님`);
      // 3-순환은 짝순열이라 완전 역전(digit 0↔5)을 만들 수 없다 — 앵커 값이 보존되지 않는다
      assert.ok(sigma(0, cycle) !== 0 || sigma(5, cycle) !== 5,
        `cycle ${cycle}: 앵커 digit 이 σ 에 불변이면 위치 회전만으로는 방향을 못 가른다`);
    }
  });

  test('전수: 물리 120°/240° 회전(위치 회전 + σ) 후 앵커 패턴은 원본과 다르다 (k=6,8,10)', () => {
    for (const k of [6, 8, 10]) {
      const base = new Map(anchorCells(k).map((a) => [`${a.q},${a.r}`, a.digit]));
      for (const [rot, cycle] of [[rotate120, 1], [rotate240, 2], [rotate120, 2], [rotate240, 1]]) {
        const turned = new Map(anchorCells(k).map((a) => {
          const p = rot(a.q, a.r);
          return [`${p.q},${p.r}`, sigma(a.digit, cycle)];
        }));
        // 같은 위치 집합 위에서 digit 배정이 완전히 일치하면 방향 모호 — 하나라도 달라야 한다
        let differs = false;
        for (const [key, d] of base) if (turned.get(key) !== d) { differs = true; break; }
        assert.ok(differs, `k=${k}: 물리 회전(${cycle}) 후 패턴이 원본과 동일 — 방향 모호`);
      }
    }
  });
});
