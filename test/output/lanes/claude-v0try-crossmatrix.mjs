/**
 * claude-v0try-crossmatrix.mjs — n=21 활성 라인업 **5후보**의 교차 수용 전수 실측.
 *
 * `claude-v0tr-crossmatrix.mjs` 를 그대로 확장한 것이다 (브리프 §4-①ⓕ). 표본기는
 * `cellSurfaceFinal.test.js` 의 `idealSampleCellForEncoded` 와 **같은 규칙**이다:
 * 파인더는 레이아웃 톤, 나머지는 실제 digit 의 2톤 패턴, **슬롯은 «관측 없음»**.
 *
 * ⚠ 게이트는 한 값도 안 건드린다 — agreement 0.78 · orientationMargin 0.035.
 * **0.78 을 넘는 별칭은 전부 보고한다** (브리프 지시).
 */
import { encodeY } from '../../../src/encodeY.js';
import { evaluateCellSurfaceGeometry } from '../../../src/decoder/cellSurfaceY-detect.js';
import { digitToPattern } from '../../../src/tonemap.js';
import {
  finalLayoutIdsForN, locatorCellsCellSurfaceFinal, slotCellsCellSurfaceFinal,
} from '../../../src/cellSurfaceFinal.js';

const PAYLOAD = 'https://tl.estre.so';
const N = 21;
const AGREEMENT_GATE = 0.78;
const ACTIVE = [...finalLayoutIdsForN(N)];
console.log('활성 n=21 라인업: [%s]', ACTIVE.join(', '));

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
      i,
      j,
      ok: true,
      T: { median: level[cycle[0]] === 0 ? 0.08 : 0.82 },
      L: { median: level[cycle[1]] === 0 ? 0.08 : 0.82 },
      R: { median: level[cycle[2]] === 0 ? 0.08 : 0.82 },
    };
  };
}

const scoreAll = { cellSurfaceLayouts: ACTIVE };
const upright = [];
const rotated = [];
const table = new Map();
let ownLoses = 0;
for (const layout of ACTIVE) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version: 1, tones: 2, eccLevel: 'M',
  });
  const scored = evaluateCellSurfaceGeometry(
    { n: N }, idealSampleCellForEncoded(encoded), scoreAll,
  );
  const own = scored.diagnostics.layouts[layout];
  const picked = scored.scored.layoutId;
  if (picked !== layout) ownLoses += 1;
  console.log('\n[%s] 자기 수용 %s · agreement %s · 뽑힌 레이아웃 %s%s · margin %s',
    layout, own.accepted, own.agreement.toFixed(4), picked,
    picked === layout ? '' : '  ★★ 자기 계열이 진다 (§6 탈출구)',
    scored.scored.orientationMargin.toFixed(4));
  const row = new Map([[layout, { agreement: own.agreement, accepted: own.accepted }]]);
  for (const rival of ACTIVE) {
    if (rival === layout) continue;
    const d = scored.diagnostics.layouts[rival];
    row.set(rival, { agreement: d.agreement, accepted: d.accepted });
    console.log('   vs %s: accepted %s · agreement %s%s', rival.padEnd(6), d.accepted,
      d.agreement.toFixed(4),
      d.agreement >= AGREEMENT_GATE ? '   ← 게이트 0.78 초과' : '');
    if (d.accepted) upright.push(layout + '|' + rival);
  }
  table.set(layout, row);
  for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
    const wrong = evaluateCellSurfaceGeometry(
      { n: N }, idealSampleCellForEncoded(encoded, cycle), scoreAll,
    );
    for (const rival of ACTIVE) {
      if (wrong.diagnostics.layouts[rival].accepted) {
        rotated.push(layout + '|' + cycle.join('') + '|' + rival);
      }
    }
  }
}

console.log('\n=== 교차 수용 행렬 (행 = 프레임 · 열 = 채점 후보 · 값 = agreement) ===');
console.log('  | 프레임 | %s |', ACTIVE.map((id) => id.padEnd(6)).join(' | '));
for (const frame of ACTIVE) {
  const cells = ACTIVE.map((id) => {
    const cell = table.get(frame).get(id);
    return (cell.agreement.toFixed(4) + (cell.accepted ? ' 수용' : ' 거부')).padEnd(11);
  });
  console.log('  | %s | %s |', frame.padEnd(6), cells.join(' | '));
}

console.log('\n=== 별칭 실측 ===');
console.log("정방향 (%d): ['%s']", upright.length, upright.sort().join("', '"));
console.log("회전   (%d): ['%s']", rotated.length, rotated.sort().join("', '"));
console.log('자기 계열이 지는 프레임: %d (0 기대 — 하나라도 나오면 §6 탈출구)', ownLoses);

console.log('\n=== 0.78 을 넘는 별칭 전수 (브리프 지시 — 수용 여부와 무관하게 전부) ===');
for (const frame of ACTIVE) {
  for (const rival of ACTIVE) {
    if (frame === rival) continue;
    const cell = table.get(frame).get(rival);
    if (cell.agreement >= AGREEMENT_GATE) {
      console.log('  %s 프레임 → %s: agreement %s (%s)', frame.padEnd(6), rival.padEnd(6),
        cell.agreement.toFixed(4), cell.accepted ? '수용' : '거부');
    }
  }
}

// 부분집합 관계 — 별칭의 «원인» 을 좌표로 확인한다.
console.log('\n=== 로케이터 부분집합 관계 (톤까지 같은 셀만) ===');
const key = (c) => c.i + ',' + c.j;
const tone = (c) => key(c) + ':' + c.T + c.L + c.R;
const loc = new Map(ACTIVE.map((id) => [id, locatorCellsCellSurfaceFinal(N, id)]));
const slotOf = new Map(ACTIVE.map((id) => [id, new Set(slotCellsCellSurfaceFinal(N, id).map(key))]));
for (const a of ACTIVE) {
  for (const b of ACTIVE) {
    if (a === b) continue;
    const bByKey = new Map(loc.get(b).map((c) => [key(c), c]));
    const shared = loc.get(a).filter((c) => {
      const twin = bByKey.get(key(c));
      return twin !== undefined && tone(twin) === tone(c);
    });
    const missing = loc.get(a).filter((c) => !bByKey.has(key(c)));
    const inBSlot = missing.filter((c) => slotOf.get(b).has(key(c)));
    console.log('  %s(%d) ⊂ %s(%d)? 톤 일치 %d · 상대에 없는 셀 %d (그중 슬롯 안 %d) → %s',
      a, loc.get(a).length, b, loc.get(b).length, shared.length, missing.length,
      inBSlot.length,
      shared.length + missing.length === loc.get(a).length && missing.length === inBSlot.length
        ? '구조적 별칭 (분모에서 빠짐)' : '갈린다');
  }
}
