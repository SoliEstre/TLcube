/**
 * ingest.mjs — ClickHouse HTTP INSERT. 자격증명은 인자/환경변수로만 받는다.
 *
 * 실패는 throw 한다. 호출측(createHub)이 잡아서 브로드캐스트와 격리한다.
 * 쿼리 문자열은 이 모듈이 고정한다 — 클라이언트가 SQL 을 넣을 구멍은 없다.
 */

import { EVENT_KINDS, eventRow, thumbnailRow } from './protocol.mjs';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function createIngest({
  url = 'http://127.0.0.1:8123',
  user = '',
  key = '',
  database = 'tl_lab',
  fetchImpl = globalThis.fetch,
  log = () => {},
} = {}) {
  if (!IDENT.test(database)) throw new Error('TL_LAB_CH_DATABASE 가 식별자가 아니다');
  const enabled = Boolean(user && key);
  let warned = false;

  async function post(table, row) {
    if (!IDENT.test(table)) throw new Error('bad table');
    if (!enabled) {
      if (!warned) {
        try { log('ingest-skip', 'TL_LAB_CH_USER / TL_LAB_CH_KEY 가 없어 적재를 건너뛴다'); } catch { /* */ }
        warned = true;
      }
      return { skipped: true };
    }
    const query = `INSERT INTO ${database}.${table} FORMAT JSONEachRow`;
    const endpoint = `${String(url).replace(/\/$/, '')}/?async_insert=1&wait_for_async_insert=1&query=${encodeURIComponent(query)}`;
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'X-ClickHouse-User': user,
        'X-ClickHouse-Key': key,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: `${JSON.stringify(row)}\n`,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* */ }
      throw new Error(`clickhouse ${res.status} ${detail}`);
    }
    return { ok: true };
  }

  async function write(event) {
    if (event.kind === 'frameShot') return post('thumbnails', thumbnailRow(event));
    if (!EVENT_KINDS.includes(event.kind)) throw new Error(`unknown kind ${event.kind}`);
    return post('events', eventRow(event));
  }

  return { write, enabled, database };
}
