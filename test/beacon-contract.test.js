// beacon-contract.test.js — 비콘 페이로드 ↔ ClickHouse 테이블 컬럼 일치를 고정한다.
//
// 왜 필요한가: 수집은 `INSERT INTO tlcube.events FORMAT JSONEachRow` 다. 컬럼에 없는 키가
// 하나라도 섞이면 그 행은 파싱 단계에서 거부되는데, 프록시가 `async_insert=1&
// wait_for_async_insert=0` 으로 호출하므로 **클라이언트엔 아무 에러도 안 보인다.**
// 즉 잘못돼도 «조용히 아무것도 안 쌓이는» 증상만 남는다 — 배포하고도 한참 모른다.
//
// 실제로 그럴 뻔했다: `src/beacon.js` 초판이 스키마에 없는 `lang` 을 보내고 `ref`·`ua_*`
// 를 빠뜨려서, 수집을 켰어도 스캐너·생성기 이벤트가 전부 버려질 상태였다(2026-08-11 발견).
// 그때 커밋 메시지엔 "이 테스트가 고정한다" 고 적어 놓고 정작 파일은 없었다.
//
// ⚠ 구현이 **둘**이라 더 위험하다 — 허브는 `sites/_shared/site.js`(classic script),
//    생성기·스캐너는 `src/beacon.js`(번들 ESM). 로딩 방식이 달라 합칠 수 없었고,
//    한쪽만 고치면 조용히 어긋난다. 그래서 양쪽을 같은 기준으로 검사한다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFileSync(ROOT + rel, 'utf8');

/** 프로비저닝 SQL 의 `CREATE TABLE tlcube.events` 에서 컬럼 이름을 뽑는다. */
function schemaColumns() {
  const sql = read('deploy/estre-so/clickhouse/001_tlcube_provisioning.sql');
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS tlcube.events');
  assert.ok(start >= 0, 'tlcube.events 정의를 못 찾았다');
  const open = sql.indexOf('(', start);
  const close = sql.indexOf('\n)', open);
  const body = sql.slice(open + 1, close);
  return body
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0].replace(/,$/, ''))
    .filter((name) => /^[a-z_]+$/.test(name));
}

/** 구현 소스의 `const row = { … }` 에서 최상위 키를 뽑는다. */
function payloadKeys(rel) {
  const src = read(rel);
  const start = src.indexOf('const row = {');
  assert.ok(start >= 0, `${rel}: const row 를 못 찾았다`);
  // 중괄호 깊이로 끝을 찾는다 — props 안의 객체 리터럴에 속지 않게.
  let depth = 0;
  let end = start;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(src.indexOf('{', start) + 1, end);

  const keys = [];
  let level = 0;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
    if (!line) continue;
    if (level === 0) {
      const m = /^([A-Za-z_][\w]*)\s*[,:]/.exec(line);
      if (m) keys.push(m[1]);
    }
    level += (line.match(/[{[(]/g) || []).length - (line.match(/[}\])]/g) || []).length;
  }
  return keys;
}

test('테이블 컬럼 집합을 읽어낼 수 있다 (파서 자체 검증)', () => {
  const cols = schemaColumns();
  assert.ok(cols.length >= 8, `컬럼을 너무 적게 읽었다: ${JSON.stringify(cols)}`);
  for (const required of ['site', 'event', 'ts', 'path', 'session', 'props']) {
    assert.ok(cols.includes(required), `${required} 컬럼이 없다 — 파서가 깨졌을 수 있다`);
  }
});

for (const [label, rel] of [
  ['생성기·스캐너 (src/beacon.js)', 'src/beacon.js'],
  ['허브 (sites/_shared/site.js)', 'sites/_shared/site.js'],
]) {
  test(`${label} 페이로드가 테이블 컬럼과 정확히 일치한다`, () => {
    const cols = schemaColumns();
    const keys = payloadKeys(rel);
    assert.ok(keys.length > 0, `${rel}: 키를 하나도 못 읽었다`);

    // 컬럼에 없는 키 → JSONEachRow 가 그 행 전체를 거부한다. 이게 치명적인 쪽이다.
    const unknown = keys.filter((k) => !cols.includes(k));
    assert.deepEqual(unknown, [],
      `${rel} 이 테이블에 없는 필드를 보낸다: ${unknown.join(', ')} — 그 행은 조용히 버려진다`);

    // 컬럼에 있는데 안 보내는 것 → DEFAULT 로 채워져 동작은 하지만, 두 구현이 갈리면
    // 사이트마다 빈 컬럼이 달라져 집계가 어긋난다.
    const missing = cols.filter((c) => !keys.includes(c));
    assert.deepEqual(missing, [],
      `${rel} 이 안 보내는 컬럼: ${missing.join(', ')} — 두 구현이 같은 집합이어야 한다`);
  });
}

test('두 구현의 필드 집합이 서로 같다', () => {
  const a = payloadKeys('src/beacon.js').slice().sort();
  const b = payloadKeys('sites/_shared/site.js').slice().sort();
  assert.deepEqual(a, b, '한쪽만 고쳐서 갈라졌다');
});

test('큐 표식(queued_at)은 전송 페이로드에서 제거된다', () => {
  // 스키마에 없는 필드라 그대로 보내면 행이 거부된다.
  const src = read('src/beacon.js');
  assert.match(src, /queued_at:\s*_?\w*\s*,?\s*\.\.\.payload|delete payload\.queued_at|queued_at: _/,
    'flush 경로가 queued_at 을 떼어내지 않는다');
  const hub = read('sites/_shared/site.js');
  assert.match(hub, /delete payload\.queued_at/, '허브 flush 가 queued_at 을 떼어내지 않는다');
});
