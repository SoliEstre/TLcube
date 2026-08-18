/**
 * finder-footprint-refine.test.js — 발자국이 **정교화 경로까지** 흐르는가.
 *
 * 왜 생겼나 (2026-08-18, 실제 사고). 발자국 파라미터화를 하면서
 * `buildFaceSamples` · `faceSamplesFor` · `footprintOf` · `groupByFootprint` ·
 * `scoreAll` · `scoreBest` 까지는 배선했는데 **`scoreParams` 한 곳만 빠졌다.**
 * 거기서 `observationsAt(luma, H, true)` 로 넷째 인자 없이 불러 언제나 기본
 * 19셀 표본을 떴다.
 *
 * 증상이 «검출 실패» 가 아니라는 것이 이 사고의 핵심이다:
 *   · `scoreTemplate` 은 `sampled.values.length` 까지만 돈다
 *   · 관측 228값(19셀) vs 기대 948값(79셀) → **길이 불일치가 조용히 잘린다**
 *   · 결과적으로 «발자국 배열의 **앞 19셀**» 만 비교된다
 * 그래서 같은 셀 집합인데 **배열 순서**가 답을 바꿨다 — 중앙 19를 앞에 두면
 * correlation 1.0000, 정본 등장 순서면 0.6058. 통합자는 후자를 재고 «탐색이
 * 수렴 못 한다» 로 3시간 오진했고, 탐색 파라미터를 54조합 훑어도 값이 미동도
 * 안 했다 (당연하다 — 목적함수가 반경 2 밖을 못 봤으니까).
 *
 * 그래서 이 파일이 잠그는 명제는 «검출된다» 가 아니라 **«배열 순서가 답을 안
 * 바꾼다»** 다. 그것이 누수를 직접 겨누는 유일한 명제다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectCellFinders, scoreCellMaskAtHomography } from '../src/decoder/cell-finder-detect.js';
import { FINDER_CELL_MASK_PATTERNS, FINDER_CELL_ORDER } from '../src/finder-patterns.js';
import { facePolygon } from '../src/hexgrid.js';

const FRAME = 900;
const CELL_PX = 20;
const LEVEL_Y = [0, 0.5, 1];

/** 반경 2 밖까지 퍼진 발자국 — 누수를 드러내려면 19셀보다 커야 한다. */
const OUTER = Object.freeze([
  { q: -6, r: 1 }, { q: -6, r: 3 }, { q: -6, r: 5 },
  { q: -5, r: -1 }, { q: -3, r: -3 }, { q: -1, r: -5 },
  { q: 1, r: 5 }, { q: 3, r: 3 }, { q: 5, r: 1 },
  { q: 6, r: -5 }, { q: 6, r: -3 }, { q: 6, r: -1 },
]);
const INNER = FINDER_CELL_ORDER.map((c) => ({ q: c.q, r: c.r }));

/** 결정적 톤 — 회전 대칭을 깨서 방향이 유일하게 정해지게 한다. */
function toneFor(cell, faceIndex) {
  const h = ((cell.q * 7 + cell.r * 13 + faceIndex * 5) % 4 + 4) % 4;
  return h === 0 ? 0 : h === 3 ? 0 : 2;
}
const levelsFor = (cells) => cells.map((c) => [0, 1, 2].map((f) => toneFor(c, f)));

function paint(cells, levels) {
  const data = new Float32Array(FRAME * FRAME).fill(0.5);
  const layout = { size: CELL_PX, originX: FRAME / 2, originY: FRAME / 2 };
  for (let i = 0; i < cells.length; i += 1) {
    for (let f = 0; f < 3; f += 1) {
      const poly = facePolygon(cells[i].q, cells[i].r, ['T', 'L', 'R'][f], layout);
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)));
      const x1 = Math.min(FRAME - 1, Math.ceil(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const y1 = Math.min(FRAME - 1, Math.ceil(Math.max(...ys)));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          let hit = false;
          // ⚠ `b = a++` 다. `b = a += 1` 로 옮겨 적으면 b === a 가 되어 변 교차
          //   판정이 자기 자신과 비교되고 아무것도 안 칠해진다 (실제로 밟았다).
          for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
            const p = poly[a];
            const q2 = poly[b];
            if ((p.y > y + 0.5) !== (q2.y > y + 0.5)
              && x + 0.5 < (q2.x - p.x) * (y + 0.5 - p.y) / (q2.y - p.y) + p.x) hit = !hit;
          }
          if (hit) data[y * FRAME + x] = LEVEL_Y[levels[i][f]];
        }
      }
    }
  }
  return { width: FRAME, height: FRAME, data };
}

function detectWith(cells) {
  const levels = levelsFor(cells);
  const pattern = {
    id: 'probe-31', renderKind: 'cell-mask', finderCells: cells, cellLevels: levels,
  };
  return detectCellFinders(paint(cells, levels), [pattern], {
    centerSeeds: [{ x: FRAME / 2, y: FRAME / 2 }],
    cellSizeSeeds: [CELL_PX],
  });
}

test('발자국 배열 순서가 검출 결과를 바꾸지 않는다 (정교화 누수 회귀)', () => {
  const centerFirst = [...INNER, ...OUTER];
  const outerFirst = [...OUTER, ...INNER];

  const a = detectWith(centerFirst);
  const b = detectWith(outerFirst);

  assert.equal(a.ok, true, 'center-first 검출 실패 — 합성이나 하네스를 먼저 의심하라');
  assert.equal(b.ok, true, 'outer-first 검출 실패');

  const ca = a.candidates[0];
  const cb = b.candidates[0];
  assert.equal(ca.patternId, 'probe-31');
  assert.equal(cb.patternId, 'probe-31');

  // 핵심 단언 — 같은 셀 집합이므로 두 순서의 점수가 **같아야** 한다.
  // 누수가 있으면 앞 19셀만 비교돼 두 값이 크게 갈린다 (실측 1.0000 vs 0.6058).
  assert.ok(Math.abs(ca.correlation - cb.correlation) < 1e-9,
    '배열 순서가 correlation 을 바꿨다 — scoreParams 가 발자국을 안 받고 있다: '
    + ca.correlation + ' vs ' + cb.correlation);
  assert.ok(Math.abs(ca.orientationMargin - cb.orientationMargin) < 1e-9,
    '배열 순서가 orientationMargin 을 바꿨다: '
    + ca.orientationMargin + ' vs ' + cb.orientationMargin);

  // 정교화가 자기 발자국을 보면 자기 프레임에서 완전 정합이어야 한다.
  // (누수 상태에서는 outer-first 가 0.6 대로 주저앉았다.)
  assert.ok(ca.correlation > 0.99,
    '자기 이상 프레임인데 correlation 이 0.99 미만이다: ' + ca.correlation);
});

test('기존 19셀 후보는 이 변경에 한 값도 안 움직인다', () => {
  // 기존 패턴들은 template.faceSamples === FACE_SAMPLES 라, 인자를 명시해도
  // 같은 값이 들어간다. 그 사실을 값으로 잠근다 — 안 그러면 «고쳤는데 기존이
  // 흔들렸다» 를 나중에 구분할 수 없다.
  const pattern = FINDER_CELL_MASK_PATTERNS[0];
  const cells = INNER;
  const levels = cells.map((_, i) => [0, 1, 2].map(
    (f) => (pattern.cellMasks[i] & (1 << f) ? 2 : 0)));
  const luma = paint(cells, levels);
  const H = [CELL_PX, 0, FRAME / 2, 0, CELL_PX, FRAME / 2, 0, 0, 1];
  const scored = scoreCellMaskAtHomography(luma, [pattern], H, { patternId: pattern.id });
  assert.equal(scored.ok, true, pattern.id);
  assert.ok(scored.correlation > 0.99,
    pattern.id + ': 참 자세 정합이 무너졌다 — ' + scored.correlation);
});
