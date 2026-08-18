/**
 * claude-r10-scoreparams-fix.mjs — 원격 레인이 지목한 결함을 **통합자가 직접** 재현하고
 * 수정 전후를 대조한다. 레인 주장을 그대로 받지 않는다.
 *
 * 결함 (통합자가 c8e66b6 에서 만든 것): scoreParams 가
 *   observationsAt(luma, H, true)          ← 넷째 인자 없음 → 언제나 기본 19셀 표본
 * 를 부른다. 발자국 파라미터화가 buildFaceSamples/faceSamplesFor/footprintOf/
 * groupByFootprint/scoreAll/scoreBest 까지 갔는데 **정교화 경로만 빠졌다.**
 *
 * scoreTemplate 은 sampled.values.length 까지만 돌므로 길이 불일치가 조용히 잘리고,
 * 결과적으로 «발자국 배열의 앞 19셀» 만 비교된다 → 순서에 따라 답이 달라진다.
 */
import { readFileSync } from 'node:fs';
import { FINDER_CELL_ORDER } from '../../../src/finder-patterns.js';
import { facePolygon } from '../../../src/hexgrid.js';

const NEW = JSON.parse(readFileSync('test/output/lanes/daehan-k10.json', 'utf8'));
const cells = NEW.userNonData.map((c) => ({ q: c.q, r: c.r }));
const tone = new Map(NEW.toneOverrides.map((t) => [t.face + ':' + t.q + ',' + t.r, t.tone]));
const lv = (cs) => cs.map((c) => ['T', 'L', 'R'].map((f) =>
  tone.has(f + ':' + c.q + ',' + c.r) ? tone.get(f + ':' + c.q + ',' + c.r) : 1));

// 두 발자국 순서 — 같은 셀 집합, 다른 배열 순서.
const innerSet = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
const CANONICAL = cells;
const CENTER_FIRST = [
  ...cells.filter((c) => innerSet.has(c.q + ',' + c.r)),
  ...cells.filter((c) => !innerSet.has(c.q + ',' + c.r)),
];

const FRAME = 900, CELL_PX = 20, LEVEL_Y = [0, 0.5, 1];
function paint(cs, levels) {
  const data = new Float32Array(FRAME * FRAME).fill(0.5);
  const layout = { size: CELL_PX, originX: FRAME / 2, originY: FRAME / 2 };
  for (let i = 0; i < cs.length; i += 1) for (let f = 0; f < 3; f += 1) {
    const poly = facePolygon(cs[i].q, cs[i].r, ['T', 'L', 'R'][f], layout);
    const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(FRAME - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(FRAME - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      let hit = false;
      // ⚠ b = a++ 다. `b = a += 1` 로 옮겨 적으면 b === a 가 되어 변 교차 판정이
      //   자기 자신과 비교되고 아무것도 안 칠해진다 (통합자가 실제로 밟았다).
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const p = poly[a], q2 = poly[b];
        if ((p.y > y + 0.5) !== (q2.y > y + 0.5)
          && x + 0.5 < (q2.x - p.x) * (y + 0.5 - p.y) / (q2.y - p.y) + p.x) hit = !hit;
      }
      if (hit) data[y * FRAME + x] = LEVEL_Y[levels[i][f]];
    }
  }
  return { width: FRAME, height: FRAME, data };
}

const detect = await import('../../../src/decoder/cell-finder-detect.js');
console.log('발자국 순서       앞19가 중앙19인가   patternId              correlation  margin');
for (const [label, cs] of [['canonical', CANONICAL], ['center-first', CENTER_FIRST]]) {
  const levels = lv(cs);
  const head19 = cs.slice(0, 19).filter((c) => innerSet.has(c.q + ',' + c.r)).length;
  const pat = { id: 'oak-daehan-k10', renderKind: 'cell-mask', finderCells: cs, cellLevels: levels };
  const r = detect.detectCellFinders(paint(cs, levels), [pat], {
    centerSeeds: [{ x: FRAME / 2, y: FRAME / 2 }], cellSizeSeeds: [CELL_PX],
  });
  const out = r.ok
    ? r.candidates[0].patternId.padEnd(23) + r.candidates[0].correlation.toFixed(4).padEnd(13)
      + r.candidates[0].orientationMargin.toFixed(4)
    : '검출 실패';
  console.log(label.padEnd(18) + (head19 + '/19').padEnd(20) + out);
}
console.log('\n판독: 두 줄이 다르면 결함이 살아 있다 (같은 셀 집합인데 배열 순서가 답을 바꾼다).');
