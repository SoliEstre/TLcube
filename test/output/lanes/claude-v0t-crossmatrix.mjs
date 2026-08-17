/**
 * claude-v0t-crossmatrix.mjs — 이상 표본기 교차 수용 행렬 (v0T 편입·v0W 계열 드랍 후).
 * `claude-v0wy-crossmatrix.mjs` 를 승계 — 후보 집합이 활성 [v0t, v0ty] 로 바뀌었다.
 *
 * `--only v0w,v0wq,v0w2,v0wy` 로 **드랍 전 4후보 대조군**을 같은 자로 돌린다
 * (복원 스위치 검증 — 드랍이 별칭 구조를 만든 것이 아님을 가른다).
 * n=13 v0 와의 교차는 §③ — n 이 달라 같은 프레임에서 경쟁하지 않지만,
 * 브리프 «남은 라인업 양방향 전수» 를 위해 셀 관계를 값으로 남긴다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { evaluateCellSurfaceGeometry } from '../../../src/decoder/cellSurfaceY-detect.js';
import {
  finalLayoutIdsForN, locatorCellsCellSurfaceFinal, slotCellsCellSurfaceFinal,
} from '../../../src/cellSurfaceFinal.js';
import { digitToPattern } from '../../../src/tonemap.js';

const PAYLOAD = 'https://tl.estre.so';
const onlyFlag = process.argv.indexOf('--only');
const ACTIVE21 = onlyFlag >= 0
  ? process.argv[onlyFlag + 1].split(',').map((x) => x.trim()).filter(Boolean)
  : [...finalLayoutIdsForN(21)];
console.log('활성 n=21 후보:', ACTIVE21.join(', '));

// ⚠ `test/cellSurfaceFinal.test.js` 의 같은 이름 헬퍼와 **정확히 같아야** 한다.
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
const picks = [];
for (const layout of ACTIVE21) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const scoreAll = { cellSurfaceLayouts: ACTIVE21 };
  const scored = evaluateCellSurfaceGeometry(
    { n: 21 }, idealSampleCellForEncoded(encoded), scoreAll,
  );
  picks.push(layout + ' 프레임 → 선택 ' + scored.scored.layoutId
    + ' (자기 agreement ' + scored.diagnostics.layouts[layout].agreement.toFixed(4) + ')');
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
console.log('\n프레임별 선택 (타이브레이크 포함):');
for (const line of picks) console.log('  ' + line);
console.log('\n정방향 별칭:');
for (const line of upright.sort()) console.log('  ' + (upright.length ? line : ''));
if (upright.length === 0) console.log('  (없음)');
console.log('\n회전 별칭:');
for (const line of rotated.sort()) console.log('  ' + line);
if (rotated.length === 0) console.log('  (없음)');

console.log('\n부분집합 관계 (셀 좌표·톤):');
const key = (c) => c.i + ',' + c.j;
const tone = (c) => key(c) + ':' + c.T + c.L + c.R;
const PAIRS = [...ACTIVE21];
for (const a of PAIRS) {
  for (const b of PAIRS) {
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

// §③ n=13 v0 와의 셀 관계 — n 이 달라 같은 프레임에서 경쟁하지 않는다 (기록용).
console.log('\nn=13 v0 와의 셀 관계 (교차 채점은 n 이 갈라 «구조적 0» — 기록용):');
for (const b of ACTIVE21) {
  const A = locatorCellsCellSurfaceFinal(13, 'v0');
  const B = new Map(locatorCellsCellSurfaceFinal(21, b).map((c) => [key(c), c]));
  const same = A.filter((c) => B.has(key(c)) && tone(B.get(key(c))) === tone(c)).length;
  console.log('  v0(13) 셀 ' + A.length + ' 중 → ' + b + '(21) 좌표·톤 일치 ' + same);
}
