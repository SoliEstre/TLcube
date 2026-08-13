/**
 * ingest.test.js — kind 별 테이블 분기 · 헤더로만 자격증명 · 소스에 암호 없음.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createIngest } from './ingest.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));

test('frame → events, frameShot → thumbnails. 유저/키는 헤더에만', async () => {
  const calls = [];
  const ingest = createIngest({
    url: 'http://127.0.0.1:8123',
    user: 'tl_lab_ingest',
    key: 'secret-from-env',
    database: 'tl_lab',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, text: async () => '' };
    },
  });

  await ingest.write({
    v: 1, sid: 's', site: 'scan', ts: '2026-08-13T00:00:00.000Z',
    kind: 'frame',
    body: {
      seq: 1, w: 2, h: 3, zoom: 1,
      ms: { total: 1, proposal: 1, verify: 1, format: 1, decode: 1 },
      stage: 'decode', ok: false, reason: '', type: null,
    },
  });
  await ingest.write({
    v: 1, sid: 's', site: 'scan', ts: '2026-08-13T00:00:00.000Z',
    kind: 'frameShot',
    body: { seq: 1, w: 96, h: 64, png: 'data:image/png;base64,AA==' },
  });

  assert.equal(calls.length, 2);
  assert.match(decodeURIComponent(calls[0].url), /INSERT INTO tl_lab\.events FORMAT JSONEachRow/);
  assert.match(decodeURIComponent(calls[1].url), /INSERT INTO tl_lab\.thumbnails FORMAT JSONEachRow/);
  for (const c of calls) {
    assert.equal(c.init.headers['X-ClickHouse-User'], 'tl_lab_ingest');
    assert.equal(c.init.headers['X-ClickHouse-Key'], 'secret-from-env');
    assert.equal(c.url.includes('secret-from-env'), false);
    assert.match(c.init.body, /\n$/);
  }
});

test('유저/키가 없으면 네트워크를 치지 않고 건너뛴다', async () => {
  let n = 0;
  const ingest = createIngest({
    fetchImpl: async () => { n += 1; return { ok: true, status: 200, text: async () => '' }; },
    log() {},
  });
  const r = await ingest.write({
    v: 1, sid: 's', site: 'gen', ts: '2026-08-13T00:00:00.000Z',
    kind: 'env', body: {},
  });
  assert.equal(r.skipped, true);
  assert.equal(n, 0);
});

test('relay/ 구현 소스에 자격증명을 박지 않는다', () => {
  const files = readdirSync(DIR).filter((f) => /\.(mjs|sql|md)$/.test(f));
  for (const f of files) {
    const text = readFileSync(path.join(DIR, f), 'utf8');
    assert.doesNotMatch(text, /IDENTIFIED BY '(?!<암호>)[^']+'/);
    assert.doesNotMatch(text, /TL_LAB_CH_KEY\s*=\s*['"][^'"]+['"]/);
  }
});
