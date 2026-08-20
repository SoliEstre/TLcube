/**
 * finder-oak-renderable.test.js — 명부의 «유망함» 과 «구현됨» 을 갈라 놓는다.
 *
 * 2026-08-20, 운영자 보고: 「그거 선택해도 렌더링 안되더라」.
 * 원인 — `status: 'active'` 는 「탈락하지 않았다」이지 「그릴 수 있다」가 아닌데,
 * 명부 표에 그 구분이 **없었다**. margin 순 1위(H2O 0.6667)·3위(H2CO3 0.4667)가
 * 둘 다 그릴 수 없는 후보인데 표만 보면 알 수 없었다.
 *
 * 고정하는 것:
 *   ① 렌더 가능 여부는 **유도된다** (손으로 적은 목록이 아니다)
 *   ② 「그릴 수 있다」고 표시된 후보는 **실제로 렌더 표현을 갖는다**
 *   ③ H2O·H2CO3 가 못 그려지는 이유는 «기하 부재» 가 아니다 — 발자국은 markerA 에 있다
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { OAK_LINEUP } from '../src/finder-oak-lineup.js';
import {
  OAK_FINDER_PATTERNS, oakRenderStatus, oakRenderSummary,
} from '../src/finder-oak-patterns.js';
import { markerCellsA, markerGroupsA } from '../src/markerA.js';

test('① 렌더 상태는 유도된다 — 패턴표를 바꾸면 요약도 따라온다', () => {
  const summary = oakRenderSummary();
  assert.equal(summary.length, OAK_LINEUP.length, '명부 전원이 요약에 있어야 한다');

  // 유도의 근거: 패턴표에 있는 것과 «oak-pattern-table» 로 표시된 것이 정확히 같다.
  const inTable = new Set(OAK_FINDER_PATTERNS.map((p) => p.lineupName));
  const marked = new Set(summary.filter((r) => r.render === 'oak-pattern-table').map((r) => r.name));
  assert.deepEqual([...marked].sort(), [...inTable].sort(),
    '패턴표와 요약이 어긋났다 — 유도가 끊겼거나 누가 손으로 적기 시작했다');
});

test('② 그릴 수 있다고 표시된 후보는 실제로 표현을 갖는다', () => {
  for (const row of oakRenderSummary()) {
    if (row.render !== 'oak-pattern-table') continue;
    const pattern = OAK_FINDER_PATTERNS.find((p) => p.lineupName === row.name);
    assert.ok(pattern, row.name + ' 이 렌더 가능으로 표시됐는데 패턴이 없다');
    assert.equal(pattern.cellLevels.length, 19, row.name + ' 의 cellLevels 가 19가 아니다');
  }
});

test('③ 못 그리는 후보가 실재하고, 그 사실이 표에 드러난다', () => {
  const blocked = oakRenderSummary().filter((r) => r.status === 'active' && r.render === 'not-renderable');
  // 이 검사가 0 이 되는 날은 H2O·H2CO3 가 구현된 날이다. 그때 이 파일을 고쳐라.
  assert.ok(blocked.length > 0,
    'active 인데 못 그리는 후보가 0 이다 — H2O·H2CO3 가 구현됐다면 이 테스트를 갱신하라');
  const names = blocked.map((r) => r.name).sort();
  assert.deepEqual(names, ['H2CO3', 'H2O'],
    '못 그리는 active 후보 목록이 바뀌었다: ' + JSON.stringify(names));
  // 그리고 그것들이 **margin 상위**라는 점이 이 표가 필요한 이유다.
  const top = oakRenderSummary().slice().sort((a, b) => b.margin - a.margin)[0];
  assert.equal(top.name, 'H2O');
  assert.equal(top.render, 'not-renderable',
    'margin 1위가 렌더 가능해졌다 — 축하한다. 이 단언을 갱신하라');
});

test('④ H2O 가 막힌 것은 기하가 아니라 톤이다 — 발자국은 이미 있다', () => {
  // 발자국 규칙: 꼭짓점에서 (−1,+2) 2칸 안쪽 셀을 중심으로 한 반경-1 육각 링 3개.
  // 링 18셀 + 링 중심 3셀 = 21셀. (claude-oak-markers.md §5.1, k=4 에서 정본과 집합 일치)
  for (const k of [4, 6, 8, 10]) {
    const cells = markerCellsA(k);
    assert.equal(cells.length, 21,
      'k=' + k + ' 의 A 마커 발자국이 21셀이 아니다 — 정본 H2O 발자국이 바뀌었다');
    const groups = markerGroupsA(k);
    assert.equal(groups.length, 3, 'k=' + k + ' 의 링이 3개가 아니다');
  }
  // 즉 기하는 있다. 못 그리는 이유는 톤(비-순열)이고 그것은 렌더러 계약 문제다.
  assert.equal(oakRenderStatus('H2O'), 'not-renderable');
});
