/*
 * 인라인 module과 번들 APP_CODE를 한 child의 SourceTextModule로 독립 parse한다.
 * module마다 `node --check`를 spawn하지 않으며, parser는 link/evaluate를 호출하지 않는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHECKER = path.join(ROOT, 'tools', 'module-syntax-check.mjs');

test('인라인 module과 APP_CODE는 한 parse-only child에서 독립 문법 검사를 통과한다', () => {
  let output;
  try {
    output = execFileSync(process.execPath, ['--experimental-vm-modules', CHECKER], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    assert.fail('module syntax child 실패:\n' + String(error.stderr || error.message));
  }
  assert.match(output, /^module syntax OK: \d+ sources, \d+ APP_CODE$/m);
});
