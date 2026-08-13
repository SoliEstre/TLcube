/**
 * schema.test.js — relay/schema.sql 이 계약 §6 과 행 매퍼 키를 지키는지 고정한다.
 *
 * 비콘과 같은 함정: JSONEachRow + skip_unknown_fields 면 키 오타가 행을 죽이지
 * 않고 그 컬럼만 영영 빈 칸이 된다. 매퍼와 DDL 을 같은 테스트가 묶는다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { eventRow, thumbnailRow } from './protocol.mjs';

const SQL = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const HERE = fileURLToPath(new URL('.', import.meta.url));

function schemaColumns(table) {
  const start = SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `${table} 정의를 못 찾았다`);
  const open = SQL.indexOf('(', start);
  const close = SQL.indexOf('\n)', open);
  const body = SQL.slice(open + 1, close);
  return body
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0].replace(/,$/, ''))
    .filter((name) => /^[a-z_]+$/.test(name));
}

function tableBlock(table) {
  const start = SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, table);
  const next = SQL.indexOf('CREATE TABLE', start + 1);
  return SQL.slice(start, next === -1 ? undefined : next);
}

test('테이블 둘 — events 와 thumbnails. 기존 events 를 재사용하지 않는다', () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS tl_lab\.events/);
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS tl_lab\.thumbnails/);
  // 주석에 옛 이름을 적을 수는 있다. CREATE/INSERT/GRANT 대상이면 안 된다.
  assert.doesNotMatch(SQL, /(?:CREATE TABLE|INSERT INTO|GRANT \w+ ON)\s+tl_analytics\./);
  assert.doesNotMatch(SQL, /(?:CREATE TABLE|INSERT INTO|GRANT \w+ ON)\s+tlcube\./);
  assert.doesNotMatch(SQL, /(?:CREATE TABLE|INSERT INTO)\s+service_events_v1/);
  assert.match(SQL, /재사용하지 않는다/);
});

test('양쪽 MergeTree · PARTITION BY toYYYYMM', () => {
  for (const table of ['tl_lab.events', 'tl_lab.thumbnails']) {
    const block = tableBlock(table);
    assert.match(block, /ENGINE = MergeTree/);
    assert.match(block, /PARTITION BY toYYYYMM\(ts\)/);
  }
});

test('TTL — 이벤트 14일, 썸네일 7일', () => {
  assert.match(tableBlock('tl_lab.events'), /INTERVAL 14 DAY/);
  assert.match(tableBlock('tl_lab.thumbnails'), /INTERVAL 7 DAY/);
  assert.doesNotMatch(tableBlock('tl_lab.events'), /INTERVAL 7 DAY/);
  assert.doesNotMatch(tableBlock('tl_lab.thumbnails'), /INTERVAL 14 DAY/);
});

test('eventRow 키가 tl_lab.events 컬럼과 같다', () => {
  const cols = schemaColumns('tl_lab.events');
  const row = eventRow({
    v: 1,
    sid: 's',
    site: 'scan',
    ts: '2026-08-13T00:00:00.000Z',
    kind: 'frame',
    body: {
      seq: 1, w: 2, h: 3, zoom: 1,
      ms: { total: 1, proposal: 1, verify: 1, format: 1, decode: 1 },
      stage: 'decode', ok: false, reason: '', type: null, cellPx: null,
    },
  });
  assert.deepEqual(Object.keys(row).sort(), cols.slice().sort());
});

test('thumbnailRow 키가 tl_lab.thumbnails 컬럼과 같다', () => {
  const cols = schemaColumns('tl_lab.thumbnails');
  const row = thumbnailRow({
    v: 1,
    sid: 's',
    site: 'scan',
    ts: '2026-08-13T00:00:00.000Z',
    kind: 'frameShot',
    body: { seq: 1, w: 96, h: 64, png: 'data:image/png;base64,AA==' },
  });
  assert.deepEqual(Object.keys(row).sort(), cols.slice().sort());
});

test('INSERT-only 유저 — SELECT/DDL 권한을 주지 않고 암호도 파일에 없다', () => {
  const grants = [...SQL.matchAll(/GRANT\s+([A-Z,\s]+)\s+ON/g)].map((m) => m[1]);
  for (const g of grants) {
    assert.match(g, /INSERT/);
    assert.doesNotMatch(g, /SELECT|ALTER|DROP|CREATE|ALL/);
  }
  assert.doesNotMatch(SQL, /IDENTIFIED BY '[^'<][^']+'/);
  assert.match(SQL, /IDENTIFIED BY '<암호>'/);
  void HERE;
});
