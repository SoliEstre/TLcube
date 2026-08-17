/**
 * claude-v0wy-crossmatrix.mjs — n=21 교차 수용 행렬 (이상 표본기).
 *
 * `cellSurfaceFinal.test.js` 의 `idealSampleCellForEncoded` 와 **같은 모델**로
 * 프레임을 만들고, 후보 전부를 채점해 accepted/agreement 를 표로 찍는다.
 * 게이트는 손대지 않는다 — 읽기만 한다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { evaluateCellSurfaceGeometry } from '../../../src/decoder/cellSurfaceY-detect.js';
import { digitToPattern } from '../../../src/tonemap.js';

const PAYLOAD = 'https://tl.estre.so/x';
const ALL21 = ['v2r2', 'v1r2', 'v0x', 'v0xq', 'v0w', 'v0wq', 'v0w2'];

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

const rows = [];
for (const own of ALL21) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: own, version: 1, tones: 2, eccLevel: 'M',
  });
  const scored = evaluateCellSurfaceGeometry(
    { n: 21 }, idealSampleCellForEncoded(encoded), { cellSurfaceLayouts: ALL21 },
  );
  const cells = [];
  for (const rival of ALL21) {
    const d = scored.diagnostics.layouts[rival];
    cells.push({
      rival,
      accepted: d.accepted,
      agreement: Number(d.agreement.toFixed(4)),
      margin: Number(d.orientationMargin.toFixed(4)),
      observed: d.observedLocatorCells,
      reject: d.rejectReason,
    });
  }
  rows.push({ own, picked: scored.scored.layoutId, ambiguous: scored.diagnostics.ambiguous, cells });
}

const pad = (s, n) => String(s).padEnd(n);
process.stdout.write('# n=21 교차 수용 행렬 (이상 표본기 · 2톤 · rot0)\n');
process.stdout.write('# 행 = 프레임 레이아웃 / 열 = 채점 후보. A=accepted · a=agreement · o=관측 로케이터 셀\n\n');
process.stdout.write(pad('frame', 8) + ALL21.map((r) => pad(r, 24)).join('') + '\n');
for (const row of rows) {
  const line = pad(row.own, 8) + row.cells.map((c) =>
    pad(`${c.accepted ? 'A' : '.'} a${c.agreement} o${c.observed}`, 24)).join('');
  process.stdout.write(line + '  → picked ' + row.picked
    + (row.ambiguous ? ' (ambiguous)' : '') + '\n');
}

process.stdout.write('\n# 교차 수용(자기 아닌 후보가 accepted) 목록 — rot0\n');
let leaks = 0;
for (const row of rows) {
  for (const c of row.cells) {
    if (c.rival !== row.own && c.accepted) {
      leaks += 1;
      process.stdout.write(`  ${row.own} 프레임 → ${c.rival} accepted `
        + `(agreement ${c.agreement} · margin ${c.margin} · 관측 ${c.observed}셀)\n`);
    }
  }
}
process.stdout.write(`  총 ${leaks} 칸\n`);

// ── 회전 오방향(±120°) — «뽑힌 것» 만이 아니라 **후보 전수**로 본다 ────────────
process.stdout.write('\n# 회전 오방향 수용 (면 순환 ±120°) — 후보 전수\n');
let rotLeaks = 0;
for (const own of ALL21) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: own, version: 1, tones: 2, eccLevel: 'M',
  });
  for (const cycle of [['L', 'R', 'T'], ['R', 'T', 'L']]) {
    const wrong = evaluateCellSurfaceGeometry(
      { n: 21 }, idealSampleCellForEncoded(encoded, cycle), { cellSurfaceLayouts: ALL21 },
    );
    for (const rival of ALL21) {
      const d = wrong.diagnostics.layouts[rival];
      if (d.accepted) {
        rotLeaks += 1;
        process.stdout.write(`  ${own} 프레임 ${cycle.join('')} → ${rival} accepted `
          + `(agreement ${d.agreement.toFixed(4)} · margin `
          + `${d.orientationMargin.toFixed(4)} · 관측 ${d.observedLocatorCells}셀)`
          + (wrong.scored.layoutId === rival ? '  ← 이것이 «뽑힌» 후보' : '') + '\n');
      }
    }
    if (wrong.accepted) {
      process.stdout.write(`  !! ${own} ${cycle.join('')}: 최종 accepted 로 뽑혔다 `
        + `(${wrong.scored.layoutId})\n`);
    }
  }
}
process.stdout.write(`  총 ${rotLeaks} 칸 (후보 단위)\n`);
