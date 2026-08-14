import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { wireSelectAllOnActivate } from '../src/input-select-all.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function fakeInput(value) {
  const listeners = {};
  return {
    value,
    selected: '',
    select() { this.selected = this.value; },
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    fire(type, event) {
      for (const fn of listeners[type] || []) fn(event || {});
    },
  };
}

test('키보드 포커스는 값을 전부 고른다', async () => {
  const input = fakeInput('example.com/trilume');
  wireSelectAllOnActivate(input);
  input.fire('focus');
  await Promise.resolve();
  assert.equal(input.selected, 'example.com/trilume');
});

test('첫 클릭의 mouseup 은 선택을 유지하고 두 번째 클릭은 부분 선택을 막지 않는다', async () => {
  const input = fakeInput('example.com/trilume');
  wireSelectAllOnActivate(input);
  const prevented = [];
  input.fire('focus');
  input.fire('mouseup', { preventDefault() { prevented.push(1); } });
  await Promise.resolve();
  assert.equal(input.selected, 'example.com/trilume');
  assert.equal(prevented.length, 1);

  input.selected = 'com';
  input.fire('mouseup', { preventDefault() { prevented.push(1); } });
  assert.equal(input.selected, 'com');
  assert.equal(prevented.length, 1);
});

test('생성기는 URL 칸에만 전체 선택을 연결한다', () => {
  const html = readFileSync(ROOT + 'index.html', 'utf8');
  assert.match(html, /from '\.\/src\/input-select-all\.js'/);
  assert.match(html, /wireSelectAllOnActivate\(els\.nUrlPayload\)/);
  assert.doesNotMatch(html, /wireSelectAllOnActivate\(els\.nTextPayload\)/);
});
