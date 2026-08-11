import test from 'node:test';
import assert from 'node:assert/strict';

import { renderWithErrorDisplay } from '../src/render-status.js';

test('실패 렌더 뒤 성공 렌더는 이전 에러 표시를 비운다', () => {
  const errorBox = { textContent: '' };
  let cleanupCalls = 0;

  assert.equal(renderWithErrorDisplay(errorBox, () => {
    throw new Error('스쳐간 렌더 오류');
  }, () => {
    cleanupCalls += 1;
  }), false);
  assert.equal(errorBox.textContent, '스쳐간 렌더 오류');
  assert.equal(cleanupCalls, 1);

  assert.equal(renderWithErrorDisplay(errorBox, () => ''), true);
  assert.equal(errorBox.textContent, '');
});
