import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  layoutX, layoutLeeFo, layoutX8Gpt, validateXLayout, xLayoutCanonical, xOrderedTriples,
  xSiteId, xSiteCoord, leeResidue, X_LAYOUT_IDS,
} from '../src/x-layout.js';

const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');

// RT rt-2750180b3f4d rd-1 — lee-fo-v1 의 회계와 golden hash. Python 참조(.agent/lanes/type-x-core-20260919/tools/
// x-layout-ref.py)와 2026-09-19 교차 일치한 값이에요. 하나라도 바뀌면 코드북(digit 의미)이 바뀐 거예요.
const LEE_FO_GOLDEN = Object.freeze([
  { N: 8, c: 0, centres: 74, digits: 140, residual: 18, sha256: 'b36454ac99c8da05da175b71ac4c4c9174aefeb4e44adb6b1b2bddde3d523d96' },
  { N: 10, c: 0, centres: 143, digits: 271, residual: 44, sha256: '1caf567821f06f46859cb19177c5b34cea2d4386f68c4d0f5c96992061bd18d0' },
  { N: 12, c: 5, centres: 246, digits: 478, residual: 48, sha256: '71bce151b674c7614f03b81e6f3d81f956c4cb0787912ad61722cbb0a1ee6e89' },
  { N: 14, c: 4, centres: 392, digits: 764, residual: 60, sha256: '0e72f3284e625228283cbcdb680a584ad8406855147af02fd4d09f9e6aa68bdb' },
  { N: 15, c: 0, centres: 483, digits: 946, residual: 54, sha256: 'c12c4dac180e4db5cf3340f9cc1911a1690b59fd04dbfc341e9945c363dce53f' },
  { N: 16, c: 4, centres: 585, digits: 1145, residual: 76, sha256: 'cf07341bc2ec81cba519da36b6553606cd45178495e3499686e90862e8f60930' },
]);
const X8_GPT_SHA = '30cf19b8573718f2295558224269ea662ea2e9166ffee4680e4684df54e61b88';

test('siteId 왕복과 Lee 잔여류', () => {
  for (const N of [4, 8, 10]) {
    for (let id = 0; id < N ** 3; id += 7) assert.equal(xSiteId(N, xSiteCoord(N, id)), id);
  }
  assert.equal(leeResidue([0, 0, 0], 0), 0);
  assert.equal(leeResidue([1, 0, 0], 0), 1);
  assert.equal(leeResidue([0, 0, 1], 0), 3);
  assert.deepEqual([...X_LAYOUT_IDS], ['lee-fo-v1', 'x8-gpt-v1']);
});

test('lee-fo-v1 — rd-1 회계·golden hash·단일 소유·fallback 0', () => {
  for (const g of LEE_FO_GOLDEN) {
    const layout = layoutLeeFo(g.N, g.c);
    assert.equal(layout.roleCounts.centres, g.centres, `N${g.N} 중심`);
    assert.equal(layout.digits, g.digits, `N${g.N} digit`);
    assert.equal(layout.roleCounts.residual, g.residual, `N${g.N} 잔여`);
    assert.equal(layout.roleCounts.data, g.digits * 3);
    assert.equal(layout.fallbacks, 0, `N${g.N} 같은 면 고아 fallback`);
    assert.equal(layout.kinds.square, layout.kinds['5arm'], `N${g.N} 5팔 셀 전부 면 정사각`);
    assert.equal(layout.kinds.lt3, 0);
    const v = validateXLayout(layout);
    assert.ok(v.ok, v.errors.slice(0, 3).join(' | '));
    assert.equal(sha(xLayoutCanonical(layout)), g.sha256, `N${g.N} golden`);
  }
});

test('lee-fo-v1 — 트리플 내 점 순서 규칙(첫 비영 축 → + 우선 → 비영 성분 수)', () => {
  const layout = layoutLeeFo(8, 0);
  const key = (N, centre, id) => {
    const q = xSiteCoord(N, centre), p = xSiteCoord(N, id);
    const v = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const axis = v.findIndex(x => x !== 0);
    return [axis, v[axis] > 0 ? 0 : 1, v.filter(x => x !== 0).length];
  };
  for (const cell of layout.cells) {
    for (const triple of cell.triples) {
      const keys = triple.map(id => key(8, cell.centre, id));
      for (let i = 1; i < 3; i += 1) {
        const a = keys[i - 1], b = keys[i];
        const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
        assert.ok(cmp <= 0, `셀 ${cell.centre} 트리플 순서 위반`);
      }
    }
  }
  // 6팔 셀은 {+x,+y,+z} 다음 {−x,−y,−z}
  const six = layout.cells.find(c => c.kind === '6arm');
  const q = xSiteCoord(8, six.centre);
  assert.deepEqual(six.triples[0].map(id => xSiteCoord(8, id)), [[q[0] + 1, q[1], q[2]], [q[0], q[1] + 1, q[2]], [q[0], q[1], q[2] + 1]]);
  assert.deepEqual(six.triples[1].map(id => xSiteCoord(8, id)), [[q[0] - 1, q[1], q[2]], [q[0], q[1] - 1, q[2]], [q[0], q[1], q[2] - 1]]);
});

test('lee-fo-v1 — 중심 집합은 합동식 전부이고 내부 6팔 셀은 내부 합동점과 일치(N8: 30)', () => {
  const layout = layoutLeeFo(8, 0);
  const interior = layout.cells.filter(c => c.kind === '6arm').map(c => xSiteCoord(8, c.centre));
  assert.equal(interior.length, 30);
  assert.ok(interior.every(p => p.every(x => x >= 1 && x <= 6) && leeResidue(p, 0) === 0));
  assert.ok(layout.cells.every(c => leeResidue(xSiteCoord(8, c.centre), 0) === 0));
});

test('x8-gpt-v1 — 표형 회귀 배치 회계와 golden', () => {
  const layout = layoutX8Gpt();
  assert.deepEqual(layout.kinds, { I7: 30, K4: 56, T4: 18 });
  assert.equal(layout.digits, 134);
  assert.equal(layout.roleCounts.data, 402);
  assert.equal(layout.roleCounts.residual, 6);
  assert.equal(layout.roleCounts.centres, 104);
  const v = validateXLayout(layout);
  assert.ok(v.ok, v.errors.slice(0, 3).join(' | '));
  assert.equal(sha(xLayoutCanonical(layout)), X8_GPT_SHA);
  // I7 앵커 30 = 내부 합동점 전부, 그룹 순서 축 순(원본 보존)
  const i7 = layout.cells.filter(c => c.kind === 'I7');
  assert.ok(i7.every(c => { const p = xSiteCoord(8, c.centre); return p.every(x => x >= 1 && x <= 6) && leeResidue(p, 0) === 0; }));
  assert.equal(xOrderedTriples(layout).length, 134);
});

test('layoutX 분기와 범위 오류', () => {
  assert.equal(layoutX({ layoutId: 'lee-fo-v1', N: 10, c: 0 }).digits, 271);
  assert.equal(layoutX({ layoutId: 'x8-gpt-v1' }).digits, 134);
  assert.throws(() => layoutX({ layoutId: 'x8-gpt-v1', N: 10 }), RangeError);
  assert.throws(() => layoutX({ layoutId: 'x8-gpt-v1', N: 8, c: 1 }), /c=0/); // 표형은 다른 잔여류를 조용히 무시하지 않아요
  assert.equal(layoutX({ layoutId: 'x8-gpt-v1', N: 8, c: 0 }).digits, 134);
  assert.throws(() => layoutX({ layoutId: 'nope', N: 8 }), RangeError);
  assert.throws(() => layoutLeeFo(3, 0), RangeError);
  assert.throws(() => layoutLeeFo(8, 7), RangeError);
});
