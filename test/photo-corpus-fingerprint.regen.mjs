/**
 * 실사진 코퍼스 지문 재생성 (F-105 재발 방지 장치의 절반).
 *
 * 언제 돌리나: 코퍼스를 **의도적으로** 바꿨을 때만 — 새 촬영 라운드 추가, 승인된
 * 재굽기(복원) 등. 돌리기 전에 `.agent/_coordination/EXPECTED_RED.md` 에 이벤트를
 * 1줄 기록하는 것이 규율이다 (8/20 무기록 재생성이 F-105 를 낳았다).
 *
 *   node test/photo-corpus-fingerprint.regen.mjs
 */
import { createHash } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { listLumaDumps } from '../tools/read-luma.mjs';

const rows = listLumaDumps()
  .map(({ name, path }) => ({ name, bytes: statSync(path).size }))
  .sort((a, b) => (a.name < b.name ? -1 : 1));
const digest = createHash('sha256')
  .update(JSON.stringify(rows))
  .digest('hex');
const out = {
  _note: '실사진 luma 코퍼스 지문 — (이름, 바이트) 목록의 SHA-256. 갱신 규율은 이 파일을 만드는 regen 스크립트 헤더 참조.',
  count: rows.length,
  digest,
};
const target = fileURLToPath(new URL('./photo-corpus-fingerprint.json', import.meta.url));
writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('지문 갱신:', out.count + '장', digest.slice(0, 16) + '…');
