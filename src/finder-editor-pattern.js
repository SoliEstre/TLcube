// finder-editor-pattern.js — 파인더 에디터가 저장·편집하는 공개 표현
//
// 3톤 큐브는 19셀 bit mask의 변형이 아니다. finder-patterns.js의 renderKind와
// toneRanks(0=어두움, 1=중간, 2=밝음) 순열을 그대로 보존해, 에디터에서 만든 값이
// 렌더러·디코더가 읽는 표현과 갈라지지 않게 한다.

import { FACES } from './hexgrid.js';
import { FINDER_CELL_ORDER } from './finder-patterns.js';

export const FINDER_EDITOR_RENDER_KINDS = Object.freeze(['cell-mask', 'three-tone-cube']);

function assertRenderKind(renderKind) {
  if (!FINDER_EDITOR_RENDER_KINDS.includes(renderKind)) {
    throw new RangeError('알 수 없는 파인더 표현: ' + renderKind);
  }
}

function assertToneRanks(toneRanks) {
  if (toneRanks === null || typeof toneRanks !== 'object') {
    throw new TypeError('toneRanks는 객체여야 한다');
  }
  const ranks = FACES.map((face) => toneRanks[face]);
  if (ranks.slice().sort((a, b) => a - b).join(',') !== '0,1,2') {
    throw new RangeError('toneRanks는 0/1/2 순열이어야 한다');
  }
}

/** finder-patterns.js의 두 표현을 에디터가 소유할 가변 사본으로 바꾼다. */
export function cloneFinderEditorPattern(pattern) {
  if (pattern === null || typeof pattern !== 'object') {
    throw new TypeError('파인더 패턴 객체가 필요하다');
  }
  const renderKind = pattern.renderKind || 'cell-mask';
  assertRenderKind(renderKind);
  if (renderKind === 'cell-mask') {
    if (!Array.isArray(pattern.cellMasks) || pattern.cellMasks.length !== FINDER_CELL_ORDER.length) {
      throw new RangeError('cellMasks는 19개여야 한다');
    }
    return { renderKind, cellMasks: [...pattern.cellMasks] };
  }
  assertToneRanks(pattern.toneRanks);
  if (!Number.isFinite(pattern.radiusCells) || pattern.radiusCells <= 0
      || !Number.isFinite(pattern.slotRadiusCells) || pattern.slotRadiusCells <= 0) {
    throw new RangeError('3톤 큐브 반지름은 양수여야 한다');
  }
  return {
    renderKind,
    radiusCells: pattern.radiusCells,
    slotRadiusCells: pattern.slotRadiusCells,
    toneRanks: { ...pattern.toneRanks },
  };
}

/** 두 표현 중 하나를 직렬화해 finder-patterns.js의 pattern 본문에 그대로 붙일 수 있게 한다. */
export function serializeFinderEditorPattern(pattern) {
  const copy = cloneFinderEditorPattern(pattern);
  if (copy.renderKind === 'cell-mask') {
    return 'cellMasks: [' + copy.cellMasks.join(', ') + ']';
  }
  return [
    'renderKind: "three-tone-cube",',
    'radiusCells: ' + copy.radiusCells + ',',
    'slotRadiusCells: ' + copy.slotRadiusCells + ',',
    'toneRanks: { T: ' + copy.toneRanks.T + ', L: ' + copy.toneRanks.L + ', R: ' + copy.toneRanks.R + ' },',
  ].join('\n');
}

/**
 * 선택한 면이 실제로 dark → mid → bright (또는 역순)으로 이동하도록 해당 rank의
 * 소유 면과 교환한다. 그래서 매 단계도 중앙 큐브가 요구하는 0/1/2 순열로 남는다.
 */
export function cycleCubeToneRanks(toneRanks, face, direction) {
  assertToneRanks(toneRanks);
  if (!FACES.includes(face)) throw new RangeError('알 수 없는 큐브 면: ' + face);
  if (direction !== 1 && direction !== -1) throw new RangeError('방향은 1 또는 -1이어야 한다');

  const current = toneRanks[face];
  const next = (current + direction + 3) % 3;
  const otherFace = FACES.find((candidate) => toneRanks[candidate] === next);
  const result = { ...toneRanks, [face]: next, [otherFace]: current };
  assertToneRanks(result);
  return result;
}

export function finderEditorPatternsEqual(left, right) {
  const a = cloneFinderEditorPattern(left);
  const b = cloneFinderEditorPattern(right);
  if (a.renderKind !== b.renderKind) return false;
  if (a.renderKind === 'cell-mask') {
    return a.cellMasks.every((mask, index) => mask === b.cellMasks[index]);
  }
  return a.radiusCells === b.radiusCells
    && a.slotRadiusCells === b.slotRadiusCells
    && FACES.every((face) => a.toneRanks[face] === b.toneRanks[face]);
}
