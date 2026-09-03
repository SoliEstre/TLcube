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

test('sequence-truth.json 라벨과 러너가 있다', () => {
  assert.equal(existsSync(RUNNER_PATH), true, 'tools/seq-truth.mjs');
  const labels = JSON.parse(readFileSync(LABELS_PATH, 'utf8'));
  assert.equal(labels['c3-tl'].expect, 'https://tl.estre.so');
  assert.equal(labels['swap-c3tl-c3daehan'].expect, 'https://tl.estre.so');
  assert.equal(labels['c3-daehan'].expect, null);
  assert.equal(labels['y0'].expect, null);
  assert.equal(labels['y2-p9rot'].expect, null);
  assert.equal(labels['y1'].expect, 'https://tl.estre.so');
  assert.equal(labels['y2'].expect, 'https://tl.estre.so');
  assert.equal(labels['swap-multi-c3-k2-v2-y2'].expect, 'https://tl.estre.so');
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
