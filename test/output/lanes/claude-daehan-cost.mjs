/**
 * claude-daehan-cost.mjs — daehan 31셀 발자국이 **용량을 얼마나 먹는가**.
 *
 * 발자국을 19 → 31 로 넓히면 바깥 12셀이 데이터에서 빠진다. 그런데 그 12셀이
 * 원래 무슨 역할이었는지에 따라 비용이 완전히 달라진다:
 *   · 전부 data 였다 → 용량 -12셀. 용량표(§5.5)·RS 파라미터가 **파인더 의존**이 된다.
 *   · 이미 anchor/format/reference 였다 → 용량 손실 0. 겹쳐 칠하는 문제만 남는다.
 * 추정하지 않고 roleOf 로 센다.
 */
import { readFileSync } from 'node:fs';
import { roleOf, buildRoleSets, overheadBreakdown } from '../../../src/placement.js';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { VERSIONS } from '../../../src/capacity.js';

const d = JSON.parse(readFileSync('../.agent/decoder/data/finder-daehan-editor.json', 'utf8'));
const orderSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
const outside = d.cells.filter((c) => !orderSet.has(c[0] + ',' + c[1]));

const K = d.k;
console.log('daehan k =', K, ' 정본 counts =', JSON.stringify(d.counts));
const sets = buildRoleSets(K);
const tally = {};
console.log('\n바깥 12셀의 현행 역할:');
for (const c of outside) {
  const role = roleOf(c[0], c[1], K, sets);
  tally[role] = (tally[role] || 0) + 1;
  console.log('  (' + String(c[0]).padStart(2) + ',' + String(c[1]).padStart(2) + ')  ' + role);
}
console.log('\n집계:', JSON.stringify(tally));
console.log('\n현행 오버헤드 k=' + K + ':', JSON.stringify(overheadBreakdown(K)));
const spec = VERSIONS.find((v) => v.k === K);
console.log('용량표 항목:', spec ? JSON.stringify(spec) : '(없음)');
const dataLost = tally.data || 0;
console.log('\n→ daehan 편입 시 **데이터 셀 손실 = ' + dataLost + '**');
console.log(dataLost === 0
  ? '   손실 0 — 용량표·RS 를 안 건드린다.'
  : '   손실 ' + dataLost + ' — 용량이 파인더에 의존하게 된다 (§5.5·RS 파라미터·SPEC 동기화).');
