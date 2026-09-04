/**
 * seq-truth.test.js — tools/seq-truth.mjs 를 npm test 글롭에 넣는다.
 *
 * SPEC §3.3 예약절 와이어 플립 트리거 ①은 라벨된 영상 자에서
 * «내용 있는 오정정»이 1건이라도 관측될 때다. 러너가 tools/ 에만 있으면
 * 그 트리거는 사람이 손으로 돌릴 때만 발동한다.
 *
 * 선례: test/decoder-frontend.test.js 실기기 luma 테스트 — 덤프 없으면 skip.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listLumaSequences } from '../tools/read-luma.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABELS_PATH = path.join(ROOT, 'test', 'sequence-truth.json');
const RUNNER_PATH = path.join(ROOT, 'tools', 'seq-truth.mjs');

// ⚠ **이 테스트가 무엇을 잠그는지 조심해서 읽어라** (2026-09-04 에 한 번 썩었다).
// `expect` 는 «코드의 성질» 이 아니라 «우리가 지금까지 잰 것» 이다. 그래서 여기서
// 값을 못박으면 **자가 좋아졌을 때 그 개선을 테스트가 거부한다.**
// 실제로 났다: `y0.expect === null` 을 「단발 0회니까 미확인」으로 박아 뒀는데,
// 그 0회는 코드가 아니라 검출 버그였다 (로케이터가 모서리 QR 을 큐브로 오인 — f3c142c).
// 중앙 창을 선언하니 y0 이 깨끗하게 읽혔고, 그러자 **이 줄이 정답을 오답이라 우겼다.**
// ⇒ 규칙: 여기서 못박는 것은 **파일의 형태**와 «이미 독립 복호로 확인된» 값뿐이다.
//        아직 못 읽은 시퀀스는 `null` 을 못박지 **않는다** — 읽히게 되는 것이 목표다.
test('sequence-truth.json 라벨과 러너가 있다', () => {
  assert.equal(existsSync(RUNNER_PATH), true, 'tools/seq-truth.mjs');
  const labels = JSON.parse(readFileSync(LABELS_PATH, 'utf8'));

  // 형태 — 모든 시퀀스가 `expect` 키를 갖는다 (없는 것과 null 은 다르다).
  const NAMES = [
    'c3-tl', 'c3-daehan', 'swap-c3tl-c3daehan', 'swap-multi-c3-k2-v2-y2',
    'y0', 'y1', 'y2', 'y2-p9rot',
  ];
  for (const name of NAMES) {
    assert.ok(labels[name], `${name} 라벨이 있어야 한다`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(labels[name], 'expect'),
      `${name}.expect 키가 있어야 한다 — 「모른다」도 명시적으로 적는다`,
    );
    const e = labels[name].expect;
    assert.ok(e === null || typeof e === 'string', `${name}.expect 는 문자열 또는 null`);
  }

  // 독립 복호로 확인된 값 — 이것들은 회귀로 못박는다.
  // (y0 은 2026-09-04 에 이 목록으로 **올라왔다**. 내려가는 일은 회귀다.)
  for (const name of ['c3-tl', 'swap-c3tl-c3daehan', 'swap-multi-c3-k2-v2-y2', 'y0', 'y1', 'y2']) {
    assert.equal(labels[name].expect, 'https://tl.estre.so', `${name} 는 확인된 원문이다`);
  }

  // 아직 못 읽은 것 — **null 을 요구하지 않는다.** 읽히면 문자열로 올라오는 게 정상이고
  // 그때 위 목록에 옮기면 된다. 다만 유도 라벨은 `expect` 가 아니라 `expectDerived` 에 둔다.
  for (const name of ['c3-daehan', 'y2-p9rot']) {
    const e = labels[name].expect;
    if (e !== null) {
      assert.equal(e, 'https://tl.estre.so', `${name} 가 읽히기 시작했다면 원문이어야 한다`);
    }
  }
  assert.equal(labels['y2-p9rot'].expectDerived, 'https://tl.estre.so',
    '유도 라벨은 expect 가 아니라 expectDerived 에 산다 — 측정과 유도를 섞지 않는다');
});

test('seq-truth: falseAccept 0 (와이어 플립 트리거 ①)', {
  timeout: 1_800_000,
}, (t) => {
  const sequences = listLumaSequences();
  if (sequences.length === 0) {
    t.skip('휘도 시퀀스 없음');
    return;
  }
  const result = spawnSync(process.execPath, [RUNNER_PATH, '--shards', '6'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 1_800_000,
  });
  assert.equal(result.status, 0, (result.stderr || '') + '\n' + (result.stdout || ''));
  assert.equal(
    typeof result.stdout === 'string' && result.stdout.includes('✓ falseAccept 0'),
    true,
    result.stdout,
  );
});
