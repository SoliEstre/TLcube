// beacon-contract.test.js — 비콘 페이로드 ↔ ClickHouse 테이블 컬럼 일치를 고정한다.
//
// 왜 필요한가: 수집은 `INSERT INTO tlcube.events FORMAT JSONEachRow` 인데 프록시가
// `async_insert=1&wait_for_async_insert=0` 으로 호출하므로 **서버가 뭘 하든 클라이언트엔
// 아무 에러도 안 보인다.** 어긋나도 증상은 «수치가 이상하다» 뿐이라 한참 모른다.
// 그래서 보내는 쪽에서 미리 고정하는 이 테스트 말고는 방어 지점이 없다.
//
// ⚠ 서버 반응은 추측하지 말고 실측한 것만 쓴다(2026-08-11, estre.so 실측):
//   · 미지 컬럼 → `input_format_skip_unknown_fields=1` 이라 **그 키만 버려지고 행은 산다.**
//     («미지 키가 섞이면 행이 통째로 거부된다» 는 초판의 전제는 틀렸다. 존재하지 않는
//      컬럼을 낀 대조 프로브가 멀쩡히 적재되는 걸로 반증됐다.)
//   · 타입 불일치(Map 컬럼에 문자열 등) → **행 전체 거부.** 유일한 행 단위 손실 경로다.
//   · 누락 컬럼 → DEFAULT 로 채워진다.
// 즉 필드 집합이 어긋났을 때의 실제 피해는 «전수 유실» 이 아니라 «그 필드만 영영 빈 칸».
// 행이 죽지 않아 더 안 들킨다 — 수집되는 줄 알고 대시보드를 보게 되므로.
//
// 초판이 실제로 그랬다: `src/beacon.js` 가 스키마에 없던 `lang` 을 보내고 `ref`·`ua_*` 를
// 빠뜨렸다(2026-08-11 발견). 그때 커밋 메시지엔 "이 테스트가 고정한다" 고 적어 놓고
// 정작 파일은 없었다.
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

// 스키마도 **둘**이다 — 우리 배포(estre.so 공용 호스트, DB=tlcube)와 공개 저장소가
// 자체 호스팅용으로 제공하는 것(DB=tl_analytics). 둘의 컬럼 집합이 갈리면 자체 호스팅
// 이용자 쪽에서만 조용히 전부 버려진다. 실제로 갈려 있었다 — 자체 호스팅 스키마에
// `lang` 이 없었다(2026-08-11 발견).
const SCHEMAS = [
  ['우리 배포 (tlcube)', 'deploy/estre-so/clickhouse/001_tlcube_provisioning.sql', 'tlcube.events'],
  ['자체 호스팅 (tl_analytics)', 'deploy/clickhouse-init.sql', 'tl_analytics.events'],
];
const CANONICAL = SCHEMAS[0];

/** SQL 의 `CREATE TABLE <table>` 에서 컬럼 이름을 뽑는다. */
function schemaColumns(rel = CANONICAL[1], table = CANONICAL[2]) {
  const sql = read(rel);
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  assert.ok(start >= 0, `${rel}: ${table} 정의를 못 찾았다`);
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

for (const [label, rel, table] of SCHEMAS) {
  test(`${label} 컬럼 집합을 읽어낼 수 있다 (파서 자체 검증)`, () => {
    const cols = schemaColumns(rel, table);
    assert.ok(cols.length >= 8, `컬럼을 너무 적게 읽었다: ${JSON.stringify(cols)}`);
    for (const required of ['site', 'event', 'ts', 'path', 'session', 'props']) {
      assert.ok(cols.includes(required), `${required} 컬럼이 없다 — 파서가 깨졌을 수 있다`);
    }
  });
}

test('두 스키마의 컬럼 집합이 서로 같다', () => {
  const [[labelA, relA, tableA], [labelB, relB, tableB]] = SCHEMAS;
  const a = schemaColumns(relA, tableA).slice().sort();
  const b = schemaColumns(relB, tableB).slice().sort();
  assert.deepEqual(a, b,
    `${labelA} 와 ${labelB} 의 컬럼이 갈렸다 — 갈린 쪽 호스팅에서만 행이 조용히 버려진다`);
});

for (const [label, rel] of [
  ['생성기·스캐너 (src/beacon.js)', 'src/beacon.js'],
  ['허브 (sites/_shared/site.js)', 'sites/_shared/site.js'],
]) {
  test(`${label} 페이로드가 테이블 컬럼과 정확히 일치한다`, () => {
    const cols = schemaColumns();
    const keys = payloadKeys(rel);
    assert.ok(keys.length > 0, `${rel}: 키를 하나도 못 읽었다`);

    // 컬럼에 없는 키 → 그 키만 조용히 폐기된다(행은 산다). 수집되는 줄 알고 보는데
    // 영영 빈 칸이라 오히려 안 들킨다.
    const unknown = keys.filter((k) => !cols.includes(k));
    assert.deepEqual(unknown, [],
      `${rel} 이 테이블에 없는 필드를 보낸다: ${unknown.join(', ')} — 그 필드는 조용히 폐기된다`);

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
  // 스키마에 없는 필드라 그대로 보내면 조용히 폐기된다 — 큐를 거친 이벤트만 그렇게 되면
  // 오프라인 구간 통계가 온라인 구간과 미묘하게 달라지는데, 그건 알아채기 거의 불가능하다.
  const src = read('src/beacon.js');
  assert.match(src, /queued_at:\s*_?\w*\s*,?\s*\.\.\.payload|delete payload\.queued_at|queued_at: _/,
    'flush 경로가 queued_at 을 떼어내지 않는다');
  const hub = read('sites/_shared/site.js');
  assert.match(hub, /delete payload\.queued_at/, '허브 flush 가 queued_at 을 떼어내지 않는다');
});

test('F-66 — file:// 의 경로는 비콘 path 에 실리지 않는다', async () => {
  /*
   * 단일 파일 생성기는 file:// 이 정상 사용 경로(SPEC §8)인데, 그때 pathname 은
   * OS 계정명이 든 로컬 절대경로다 — 실사용자 개인정보가 그대로 샜다 (원장 F-66,
   * 통합자 pathname 원문 재현). beaconPath 가 프로토콜로 가른다.
   */
  const { beaconPath } = await import('../src/beacon.js');
  assert.equal(beaconPath({ protocol: 'file:', pathname: '/C:/Users/estre/Desktop/trilume.html' }), '');
  assert.equal(beaconPath({ protocol: 'https:', pathname: '/lab/' }), '/lab/');
  assert.equal(beaconPath(null), '');
});
