/** dev-server-lab.test.js — 로컬에서도 배포와 같은 /lab/ 경로 계약을 제공한다. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../tools/dev-server.mjs', import.meta.url)),
  'utf8',
);

test('개발 서버는 /lab 과 /lab/ 을 시험판 생성기 산출물로 보낸다', () => {
  assert.match(SOURCE, /pathname === '\/lab'/);
  assert.match(SOURCE, /pathname === '\/lab\/'/);
  assert.match(SOURCE, /'\/sites\/_shared\/lab-gen\.html'/);
});

test('개발 서버는 /celleditor 와 /lab/cell-editor 를 전용 셀 에디터 산출물로 보낸다', () => {
  assert.match(SOURCE, /pathname === '\/celleditor'/);
  assert.match(SOURCE, /pathname === '\/lab\/cell-editor'/);
  assert.match(SOURCE, /'\/sites\/_shared\/cell-editor\.html'/);
});
