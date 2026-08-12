import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FINDER_CUBE_FACE_RANKS, THREE_TONE_CUBE_FINDER_PATTERN_ID, getFinderPattern,
} from '../src/finder-patterns.js';
import {
  cloneFinderEditorPattern, cycleCubeToneRanks, serializeFinderEditorPattern,
} from '../src/finder-editor-pattern.js';
import { buildFinderEditorHtml } from '../tools/build-finder-editor.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('3톤 큐브 에디터 표현은 finder-patterns.js의 renderKind·반지름·toneRanks를 그대로 쓴다', () => {
  const cube = getFinderPattern(THREE_TONE_CUBE_FINDER_PATTERN_ID);
  const editable = cloneFinderEditorPattern(cube);

  assert.deepEqual(editable, {
    renderKind: 'three-tone-cube',
    radiusCells: cube.radiusCells,
    slotRadiusCells: cube.slotRadiusCells,
    toneRanks: { ...FINDER_CUBE_FACE_RANKS },
  });
  assert.equal(serializeFinderEditorPattern(editable), [
    'renderKind: "three-tone-cube",',
    'radiusCells: ' + cube.radiusCells + ',',
    'slotRadiusCells: ' + cube.slotRadiusCells + ',',
    'toneRanks: { T: 2, L: 1, R: 0 },',
  ].join('\n'));
});

test('3톤 큐브의 좌·우 방향 편집은 순열을 유지하며 선택 면을 정·역순으로 돌린다', () => {
  const initial = { ...FINDER_CUBE_FACE_RANKS };
  const forward = cycleCubeToneRanks(initial, 'T', 1);
  assert.deepEqual(forward, { T: 0, L: 1, R: 2 });
  assert.deepEqual(Object.values(forward).sort((a, b) => a - b), [0, 1, 2]);
  assert.deepEqual(cycleCubeToneRanks(forward, 'T', -1), initial);
});

test('에디터는 캔버스에서만 우클릭 메뉴를 막고 현재 소스에서 다시 생성된다', () => {
  const app = readFileSync(ROOT + 'tools/finder-editor-app.js', 'utf8');
  assert.match(app, /elements\.preview\.addEventListener\('contextmenu'/);
  assert.doesNotMatch(app, /document\.addEventListener\('contextmenu'/);
  assert.match(app, /event\.button === 2 \? -1 : 1/);
  assert.match(app, /cycleCubeToneRanks\(state\.pattern\.toneRanks, details\.face, state\.drag\.direction\)/);
  assert.equal(
    readFileSync(ROOT + 'sites/_shared/gen-finder-editor.html', 'utf8'),
    buildFinderEditorHtml(),
  );
});
