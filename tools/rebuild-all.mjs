/**
 * rebuild-all.mjs — `tools/build-*.mjs` 를 **전수 × 수렴**까지 돌린다.
 *
 * ⚠ **왜 한 번으론 모자라나** (2026-08-26 사고):
 * 종전 절차는 `for b in tools/build-*.mjs; do node "$b"; done` 한 번이었다.
 * 그 순회는 **알파벳 순**이라 `build-scan-variants.mjs` 가 `build-scanner.mjs` 보다
 * **먼저** 돈다. 그런데 변형본은 스캐너 번들을 입력으로 먹으므로, 한 번만 돌리면
 * 변형본이 **직전 빌드의 낡은 `dist/tlscan.html`** 로 만들어진다.
 * 고침은 «순서를 손으로 정하기» 가 아니라 **수렴**이다 — 손 순서 목록은 빌더가 하나
 * 늘 때마다 어긋난다(이 저장소의 상습 사고). 산출물이 더 이상 안 바뀔 때까지 돌린다.
 *
 * ⚠ **왜 지문이 «내용»이어야 하나** (2026-08-29 사고):
 * 수렴 지문을 `git status --porcelain`(파일 **집합**)으로 뒀더니, `dist/tlscan.html`
 * 이 패스 1에서도 「수정됨」· 패스 2에서도 「수정됨」이라 porcelain 출력이 바이트
 * 동일 → 내용이 한 빌드 낡았는데 「수렴」으로 통과했다. 발견은 러너가 아니라 하류의
 * `test/generated-artifacts-fresh.test.js` 가 빨개져서 했다. 그래서 지문은 산출물
 * **내용의 sha256** 이고, 대상 목록은 각 빌더의 `export const OUTPUTS` 합집합에서
 * 유도한다 — 손 목록을 두지 않는다. 성질 자: `test/rebuild-convergence.test.js`.
 *
 * 사용: node tools/rebuild-all.mjs
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_PASSES = 5;

export function listBuilders(toolsDir = TOOLS) {
  // ⚠ 이 파일 이름이 `build-` 로 시작하면 **자기 자신을 돌려 무한 재귀**가 되고,
  //    `generated-artifacts-fresh.test.js` 의 「모든 빌더는 신선도로 잠긴다」 자에도
  //    걸린다 (실제로 `build-all.mjs` 로 냈다가 원격 스위트에서 빨개졌다 — 그 자가
  //    옳다: 빌더 목록을 손으로 안 들고 글롭으로 유도하기 때문이다).
  //    그래서 이름을 `rebuild-` 로 뒀다. 예외 목록을 만들지 않는다.
  const builders = readdirSync(toolsDir)
    .filter((f) => f.startsWith('build-') && f.endsWith('.mjs'))
    .sort();
  if (builders.length === 0) throw new Error('빌더를 하나도 못 찾았다 — 유도가 깨졌다');
  return builders;
}

/**
 * 산출물 대상 = 각 빌더 모듈의 `export const OUTPUTS` **합집합**.
 * 빌더는 쓰기 호출이 사용하는 경로 상수를 그대로 선언하고(절대/상대 혼재 허용),
 * repo 상대 POSIX 로의 정규화는 여기 한 곳에서만 한다 — 철자 사본을 두지 않는다.
 */
export async function collectDeclaredOutputs(builders, { toolsDir = TOOLS, root = ROOT } = {}) {
  const union = new Set();
  for (const b of builders) {
    const mod = await import(pathToFileURL(path.join(toolsDir, b)).href);
    if (!Array.isArray(mod.OUTPUTS) || mod.OUTPUTS.length === 0) {
      throw new Error(b + ' 가 OUTPUTS 를 선언하지 않는다 — 새 빌더는 자기 산출물 경로를 '
        + '`export const OUTPUTS` 로 선언해야 수렴 지문에 잡힌다 (쓰기가 사용하는 경로 상수 그대로)');
    }
    for (const declared of mod.OUTPUTS) {
      const rel = (path.isAbsolute(declared) ? path.relative(root, declared) : declared)
        .split(path.sep).join('/');
      if (rel === '' || rel === '.' || rel.startsWith('../')) {
        throw new Error(b + ' 의 OUTPUTS 가 repo 밖을 가리킨다: ' + declared);
      }
      union.add(rel);
    }
  }
  return [...union].sort();
}

/**
 * 수렴 지문 — 산출물 **내용**의 sha256 을 「경로\t해시」 줄로 이어 붙인 매니페스트.
 * 파일 집합·mtime·크기가 아니라 바이트를 본다 (위 2026-08-29 사고의 교정).
 * 해시 하나로 접지 않고 줄로 두는 이유: 비수렴 시 «어느 파일이 아직 변하는지» 를
 * 이름으로 찍을 수 있어야 순환 의존을 추적할 수 있다.
 */
export function fingerprintOutputs(root, outputs) {
  return outputs.map((rel) => {
    let digest;
    try {
      digest = createHash('sha256').update(readFileSync(path.join(root, rel))).digest('hex');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      digest = '결측'; // 첫 패스 전에는 아직 없을 수 있다 — 생성도 «변화»로 잡힌다
    }
    return rel + '\t' + digest;
  }).join('\n');
}

function changedBetween(previous, now) {
  const before = new Map(previous.split('\n').map((line) => line.split('\t')));
  return now.split('\n')
    .map((line) => line.split('\t'))
    .filter(([rel, digest]) => before.get(rel) !== digest)
    .map(([rel]) => rel);
}

async function main() {
  const builders = listBuilders();
  const outputs = await collectDeclaredOutputs(builders);

  let previous = null;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    for (const b of builders) {
      try {
        execFileSync(process.execPath, [TOOLS + b], { cwd: ROOT, stdio: 'pipe' });
      } catch (error) {
        const out = (error.stdout || '') + (error.stderr || '');
        console.error('✖ ' + b + ' 실패\n' + String(out).slice(-1200));
        process.exit(1);
      }
    }
    const now = fingerprintOutputs(ROOT, outputs);
    console.log('패스 ' + (pass + 1) + ' — 빌더 ' + builders.length + '개 · 산출물 ' + outputs.length + '개');
    if (previous !== null) {
      if (now === previous) {
        console.log('수렴 (패스 ' + (pass + 1) + ')');
        return;
      }
      console.log('  아직 변함: ' + changedBetween(previous, now).join(', '));
    }
    previous = now;
  }

  console.error('✖ ' + MAX_PASSES + '패스에서 수렴하지 않았다 — 빌더 사이에 순환 의존이 있다');
  process.exit(1);
}

// 테스트가 지문·유도 함수를 import 한다 — import 만으로 빌드가 돌면 안 된다.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
