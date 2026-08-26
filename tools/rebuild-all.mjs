/**
 * rebuild-all.mjs — `tools/build-*.mjs` 를 **전수 × 수렴**까지 돌린다.
 *
 * ⚠ **왜 한 번으론 모자라나** (2026-08-26 사고):
 * 종전 절차는 `for b in tools/build-*.mjs; do node "$b"; done` 한 번이었다.
 * 그 순회는 **알파벳 순**이라 `build-scan-variants.mjs` 가 `build-scanner.mjs` 보다
 * **먼저** 돈다. 그런데 변형본은 스캐너 번들을 입력으로 먹으므로, 한 번만 돌리면
 * 변형본이 **직전 빌드의 낡은 `dist/tlscan.html`** 로 만들어진다.
 * 결과: 원격 스위트에서 신선도 자 4건이 빨개졌다
 * (`dist/tlscan.html` · `sites/_shared/lab-scan.html` · `scan-new.html` · 동기화 자).
 *
 * 고침은 «순서를 손으로 정하기» 가 아니라 **수렴**이다 — 손 순서 목록은 빌더가 하나
 * 늘 때마다 어긋난다(이 저장소의 상습 사고). 산출물이 더 이상 안 바뀔 때까지 돌린다.
 *
 * 사용: node tools/rebuild-all.mjs
 */
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_PASSES = 5;

const builders = readdirSync(TOOLS)
  // ⚠ 이 파일 이름이 `build-` 로 시작하면 **자기 자신을 돌려 무한 재귀**가 되고,
  //    `generated-artifacts-fresh.test.js` 의 「모든 빌더는 신선도로 잠긴다」 자에도
  //    걸린다 (실제로 `build-all.mjs` 로 냈다가 원격 스위트에서 빨개졌다 — 그 자가
  //    옳다: 빌더 목록을 손으로 안 들고 글롭으로 유도하기 때문이다).
  //    그래서 이름을 `rebuild-` 로 뒀다. 예외 목록을 만들지 않는다.
  .filter((f) => f.startsWith('build-') && f.endsWith('.mjs'))
  .sort();
if (builders.length === 0) throw new Error('빌더를 하나도 못 찾았다 — 유도가 깨졌다');

/** 산출물 지문 — git 이 «변경» 이라 부르는 것 전체. 손 목록을 두지 않는다. */
function fingerprint() {
  return execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], {
    encoding: 'utf8', maxBuffer: 64 << 20,
  });
}

let previous = null;
let pass = 0;
for (; pass < MAX_PASSES; pass += 1) {
  for (const b of builders) {
    try {
      execFileSync(process.execPath, [TOOLS + b], { cwd: ROOT, stdio: 'pipe' });
    } catch (error) {
      const out = (error.stdout || '') + (error.stderr || '');
      console.error('✖ ' + b + ' 실패\n' + String(out).slice(-1200));
      process.exit(1);
    }
  }
  const now = fingerprint();
  console.log('패스 ' + (pass + 1) + ' — 빌더 ' + builders.length + '개');
  if (previous !== null && now === previous) {
    console.log('수렴 (패스 ' + (pass + 1) + ')');
    process.exit(0);
  }
  previous = now;
}

console.error('✖ ' + MAX_PASSES + '패스에서 수렴하지 않았다 — 빌더 사이에 순환 의존이 있다');
process.exit(1);
