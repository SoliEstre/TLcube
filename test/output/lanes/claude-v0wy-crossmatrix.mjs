/**
 * claude-v0wy-crossmatrix.mjs — 이상 표본기 교차 수용 행렬 (v0WY 편입 후).
 * 직전 레인의 같은 이름 스크립트를 승계했고, 후보 집합만 활성 4후보로 늘렸다.
 * 실물 래스터 판정은 `claude-v0wy-probe.mjs` §④ 다 — 이것은 **기전 관측**이다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { evaluateCellSurfaceGeometry } from '../../../src/decoder/cellSurfaceY-detect.js';
import {
  finalLayoutIdsForN, locatorCellsCellSurfaceFinal, slotCellsCellSurfaceFinal,
} from '../../../src/cellSurfaceFinal.js';
import { digitToPattern } from '../../../src/tonemap.js';

const PAYLOAD = 'https://tl.estre.so';
// 후보 집합을 인자로 받는다 — 기본은 현재 활성 라인업이고,
// `--only v0w,v0wq,v0w2` 로 **편입 전 3후보 대조군**을 같은 자로 돌린다.
// 대조군이 있어야 «새 별칭이 편입 때문인가» 를 가릅다.
const onlyFlag = process.argv.indexOf('--only');
const ACTIVE21 = onlyFlag >= 0
  ? process.argv[onlyFlag + 1].split(',').map((x) => x.trim()).filter(Boolean)
  : [...finalLayoutIdsForN(21)];
console.log('활성 n=21 후보:', ACTIVE21.join(', '));

// ⚠ `test/cellSurfaceFinal.test.js` 의 같은 이름 헬퍼와 **정확히 같아야** 한다 —
// 데이터 셀도 관측으로 돌려준다 (손으로 «로케이터만» 으로 줄이면 분모가
// 달라져 별칭 집합이 조용히 바뀐다 — 이 레인이 첫 판에서 그 함정을 밟았다).
function idealSampleCellForEncoded(encoded, cycle = ['T', 'L', 'R']) {
  const map = encoded.cellDigits;
  return (i, j) => {
    const entry = map.get(i + ',' + j);
    if (!entry) return { i, j, ok: false };
    if (entry.role === 'slot') return { i, j, ok: false };
    const level = {};
    if (entry.role === 'locator' && entry.tones) {
      for (const face of ['T', 'L', 'R']) level[face] = entry.tones[face];
    } else {
      const pattern = digitToPattern(entry.digit);
      for (const face of ['T', 'L', 'R']) level[face] = pattern[face] ? 2 : 0;
    }
    return {
      i, j, ok: true,
      T: { median: level[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: level[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: level[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

const upright = [];
const rotated = [];
for (const layout of ACTIVE21) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const scoreAll = { cellSurfaceLayouts: ACTIVE21 };
  const scored = evaluateCellSurfaceGeometry(
    { n: 21 }, idealSampleCellForEncoded(encoded), scoreAll,
  );
  for (const rival of ACTIVE21) {
    if (rival === layout) continue;
    if (scored.diagnostics.layouts[rival].accepted) {
      upright.push(layout + '|' + rival
        + ' (agreement ' + scored.diagnostics.layouts[rival].agreement.toFixed(4) + ')');
    }
  }
  for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
    const wrong = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(encoded, cycle), scoreAll,
    );
    for (const rival of ACTIVE21) {
      if (wrong.diagnostics.layouts[rival].accepted) {
        rotated.push(layout + '|' + cycle.join('') + '|' + rival
          + ' (agreement ' + wrong.diagnostics.layouts[rival].agreement.toFixed(4) + ')');
      }
    }
  }
}
console.log('\n정방향 별칭:');
for (const line of upright.sort()) console.log('  ' + line);
console.log('\n회전 별칭:');
for (const line of rotated.sort()) console.log('  ' + line);

console.log('\n부분집합 관계 (셀 좌표·톤):');
const key = (c) => c.i + ',' + c.j;
const tone = (c) => key(c) + ':' + c.T + c.L + c.R;
for (const a of ACTIVE21) {
  for (const b of ACTIVE21) {
    if (a === b) continue;
    const A = locatorCellsCellSurfaceFinal(21, a);
    const B = new Map(locatorCellsCellSurfaceFinal(21, b).map((c) => [key(c), c]));
    const slotB = new Set(slotCellsCellSurfaceFinal(21, b).map(key));
    const same = A.filter((c) => B.has(key(c)) && tone(B.get(key(c))) === tone(c)).length;
    const inSlot = A.filter((c) => !B.has(key(c)) && slotB.has(key(c))).length;
    const conflict = A.filter((c) => B.has(key(c)) && tone(B.get(key(c))) !== tone(c)).length;
    console.log('  ' + a + ' 셀 ' + A.length + ' 중 → ' + b + ': 톤까지 일치 ' + same
      + ' · ' + b + ' 슬롯 안 ' + inSlot + ' · 톤 충돌 ' + conflict
      + ' · 어디에도 없음 ' + (A.length - same - inSlot - conflict));
  }
}
