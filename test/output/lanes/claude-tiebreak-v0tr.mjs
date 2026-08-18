/**
 * claude-tiebreak-v0tr.mjs — n=21 기본을 v0t → v0tr 로 바꾼 뒤 **동률 타이브레이크가
 * 실제로 어디로 가는가**를 잰다 (추정 금지, 실측).
 *
 * `pickBetterLayout` 의 확정 규칙 (src/decoder/cellSurfaceY-detect.js 실독):
 *   accepted → agreement → **preferred id(= 그 n 의 기본)** → 그래도 동률이면 left(앞선 후보).
 * 즉 기본이 바뀌면 «동률에서 누가 이름을 갖는가» 가 두 자리에서 동시에 움직인다:
 *   ⓐ 기본이 낀 쌍은 순서 무관하게 기본이 이긴다  ⓑ 기본이 안 낀 쌍은 순서가 가른다.
 *
 * 이상 표본기(idealSampleCellForEncoded)는 테스트 로컬 헬퍼라 그대로 **복사**해 왔다
 * — 정본은 test/cellSurfaceFinal.test.js 이고, 여기 값이 다르면 이 복사본을 의심한다.
 */
import { encodeY } from '../../../src/encodeY.js';
import { evaluateCellSurfaceGeometry } from '../../../src/decoder/cellSurfaceY-detect.js';
import { finalLayoutIdForN, finalLayoutIdsForN } from '../../../src/cellSurfaceFinal.js';
import { digitToPattern } from '../../../src/tonemap.js';

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

const PAYLOAD = 'TIEBREAK';
console.log('기본(preferred id) =', finalLayoutIdForN(21));
console.log('선언 순서          =', finalLayoutIdsForN(21).join(', '));

const IDS = ['v0t', 'v0ty', 'v0tr', 'v0trq'];
const ORDERS = [
  ['v0t', 'v0ty'], ['v0ty', 'v0t'],
  ['v0t', 'v0tr'], ['v0tr', 'v0t'],
  ['v0tr', 'v0trq'], ['v0trq', 'v0tr'],
  null,
];

console.log('\n프레임    후보순서            뽑힘      agreement (후보별)');
for (const frameId of IDS) {
  const frame = encodeY(PAYLOAD, {
    cellSurfaceLayout: frameId, version: 1, tones: 2, eccLevel: 'M',
  });
  const sample = idealSampleCellForEncoded(frame);
  for (const order of ORDERS) {
    const opts = order ? { cellSurfaceLayouts: order } : {};
    const r = evaluateCellSurfaceGeometry({ n: 21 }, sample, opts);
    const got = r.scored ? r.scored.layoutId : '(실패)';
    const per = Object.entries(r.diagnostics && r.diagnostics.layouts ? r.diagnostics.layouts : {})
      .map(([id, v]) => id + '=' + (Number.isFinite(v.agreement)
        ? v.agreement.toFixed(3) + (v.accepted ? '' : '✗') : '-'))
      .join(' ');
    const mark = got === frameId ? ' ' : '★';
    console.log(mark + frameId.padEnd(9)
      + (order ? order.join(',') : '(전체 라인업)').padEnd(20)
      + got.padEnd(10) + per);
  }
  console.log();
}
console.log('판독: ★ = 프레임의 이름과 다르게 뽑힌 것. 이상 표본기에서는 별칭 쌍이');
console.log('      agreement 1.000 으로 갈리지 않으므로 ★ 는 결함이 아니라 좌표다.');
