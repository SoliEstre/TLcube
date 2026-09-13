/** 단일 HTML은 app(index.html)의 모든 ./src import를 MODULE_ORDER에 실어야 해요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULE_ORDER} from '../tools/build-single.mjs';

const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('단일 HTML MODULE_ORDER는 index app의 모든 src ESM import를 포함해요',()=>{
  const imports=[...index.matchAll(/\bfrom\s+'\.\/src\/([A-Za-z0-9_/-]+)\.js'/g)].map(match=>match[1]);
  assert.ok(imports.length>0,'index app src import를 찾지 못했어요');
  const missing=[...new Set(imports.filter(name=>!MODULE_ORDER.includes(name)))];
  assert.deepEqual(missing,[],`단일 HTML MODULE_ORDER 누락: ${missing.join(', ')}`);
});
