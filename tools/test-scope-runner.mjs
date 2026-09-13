/** 셸별 환경변수 문법 없이 test scope를 전달한다. full에서는 skip을 성공으로 허용하지 않는다. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// Node 24의 spec 출력은 실패 목록을 summary 뒤에 붙여 full gate의 끝-summary 파서를 흔든다.
// TAP을 명시하면 summary가 최종 레코드가 되어 skipped=0 검사가 형식에 의존하지 않는다.
const TEST_ARGS = ['--test', '--test-reporter=tap', 'test/*.test.js', 'test/harness/*.test.js', 'relay/*.test.js'];

/** 원격/저사양 좌석이 명시한 양의 안전 정수만 Node의 test worker 수로 쓴다. */
export function testArgs(baseEnv) {
  const raw = baseEnv.TL_TEST_CONCURRENCY;
  if (raw === undefined || raw === '') return TEST_ARGS;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error('TL_TEST_CONCURRENCY는 양의 정수여야 한다');
  }
  const concurrency = Number(raw);
  if (!Number.isSafeInteger(concurrency)) {
    throw new Error('TL_TEST_CONCURRENCY는 안전한 양의 정수여야 한다');
  }
  return ['--test', '--test-reporter=tap', `--test-concurrency=${concurrency}`, 'test/*.test.js', 'test/harness/*.test.js', 'relay/*.test.js'];
}

export function skippedCount(stdout) {
  // Node의 root summary는 subtest 출력 후 `tests`부터 `duration_ms`까지 한 블록으로 끝난다.
  // 테스트 본문이 흉내 낸 "skipped N" 한 줄이나 stderr는 gate 입력으로 쓰지 않는다.
  const summary = /(?:^|\n)(?:ℹ\s+|#\s*)tests\s+\d+\s*\n(?:ℹ\s+|#\s*)suites\s+\d+\s*\n(?:ℹ\s+|#\s*)pass\s+\d+\s*\n(?:ℹ\s+|#\s*)fail\s+\d+\s*\n(?:ℹ\s+|#\s*)cancelled\s+\d+\s*\n(?:ℹ\s+|#\s*)skipped\s+(\d+)\s*\n(?:ℹ\s+|#\s*)todo\s+\d+\s*\n(?:ℹ\s+|#\s*)duration_ms\s+[\d.]+\s*$/;
  const match = stdout.match(summary);
  if (!match) throw new Error('stdout 최종 TAP skipped 요약을 찾지 못했다 — runner 출력 형식이 바뀌었다');
  return Number(match[1]);
}

export function parseArgs(argv) {
  const allowed = new Set(['--full', '--bench']);
  if (argv.some((arg) => !allowed.has(arg)) || new Set(argv).size !== argv.length) {
    throw new Error('사용법: node tools/test-scope-runner.mjs [--full] [--bench]');
  }
  return { scope: argv.includes('--full') ? 'full' : 'default', bench: argv.includes('--bench') };
}

export function childEnv(baseEnv, {scope, bench}) {
  const env = { ...baseEnv, TL_TEST_SCOPE: scope };
  // 부모 shell이 남긴 bench 플래그가 기본/전수 기능 gate에 새어들지 않게 한다.
  if (bench) env.TL_TEST_BENCH = '1'; else delete env.TL_TEST_BENCH;
  return env;
}

export async function run({ scope, bench }) {
  const env = childEnv(process.env, {scope, bench});
  const child = spawn(process.execPath, testArgs(env), { cwd: ROOT, env, stdio: ['inherit', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (chunk) => { const text = String(chunk); stdout += text; process.stdout.write(text); });
  child.stderr.on('data', (chunk) => { process.stderr.write(String(chunk)); });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) process.exitCode = code ?? 1;
  if (scope === 'full') {
    const skipped = skippedCount(stdout);
    if (skipped !== 0) {
      process.stderr.write(`full scope 거부: skipped ${skipped}; 덤프/fixture를 준비한 뒤 다시 실행하라.\n`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(parseArgs(process.argv.slice(2))).catch((error) => {
    process.stderr.write(error.stack + '\n');
    process.exitCode = 1;
  });
}
