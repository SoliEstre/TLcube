import test from 'node:test';
import assert from 'node:assert/strict';
import { childEnv, parseArgs, skippedCount, testArgs } from '../tools/test-scope-runner.mjs';

test('full runner는 stdout의 마지막 root TAP skipped 요약만 읽고 누락을 거부한다', () => {
  const spec = (skipped) => `ℹ tests 4\nℹ suites 0\nℹ pass 4\nℹ fail 0\nℹ cancelled 0\nℹ skipped ${skipped}\nℹ todo 0\nℹ duration_ms 12.5\n`;
  const tap = (skipped) => `# tests 4\n# suites 0\n# pass 4\n# fail 0\n# cancelled 0\n# skipped ${skipped}\n# todo 0\n# duration_ms 12\n`;
  assert.equal(skippedCount(spec(0)), 0);
  assert.equal(skippedCount(tap(3)), 3);
  assert.equal(skippedCount(`ℹ skipped 99\n${spec(0)}`), 0);
  assert.throws(() => skippedCount('ℹ tests 4\nℹ skipped 0\n'), /최종 TAP skipped/);
  assert.throws(() => skippedCount(`${spec(0)}test body: ℹ skipped 99\n`), /최종 TAP skipped/);
});

test('runner CLI는 중복/알 수 없는 flag를 거부하고 bench 상속을 fail-closed로 지워요', () => {
  assert.deepEqual(parseArgs([]), {scope: 'default', bench: false});
  assert.deepEqual(parseArgs(['--full', '--bench']), {scope: 'full', bench: true});
  for (const argv of [['--full', '--full'], ['--bench', '--bench'], ['--evil']]) {
    assert.throws(() => parseArgs(argv), /사용법/);
  }
  assert.deepEqual(childEnv({TL_TEST_BENCH: '1', SAFE: 'ok'}, {scope: 'default', bench: false}),
    {TL_TEST_SCOPE: 'default', SAFE: 'ok'});
  assert.equal(childEnv({TL_TEST_BENCH: 'unexpected'}, {scope: 'full', bench: true}).TL_TEST_BENCH, '1');
});

test('원격 full gate는 명시한 양의 정수 동시성만 Node에 전달해요', () => {
  assert.deepEqual(testArgs({}), ['--test', 'test/*.test.js', 'test/harness/*.test.js', 'relay/*.test.js']);
  assert.deepEqual(testArgs({TL_TEST_CONCURRENCY: '2'}),
    ['--test', '--test-concurrency=2', 'test/*.test.js', 'test/harness/*.test.js', 'relay/*.test.js']);
  for (const value of ['0', '-1', '1.5', ' 2', '2 ', 'two', '9007199254740992']) {
    assert.throws(() => testArgs({TL_TEST_CONCURRENCY: value}), /TL_TEST_CONCURRENCY/);
  }
});
