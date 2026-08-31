/**
 * generated-artifacts-fresh.test.js — **커밋된 생성 산출물이 소스와 일치하는가.**
 *
 * ── 왜 생겼나 (2026-08-19) ──────────────────────────────────────────────────
 *
 * `sites/tlscan/scanner.js` 를 고치고 `dist/tlscan.html` 만 다시 구웠다. 그런데 같은
 * 소스에서 나오는 산출물이 **셋** 이다 — `dist/tlscan.html` · `sites/_shared/lab-scan.html` ·
 * `sites/_shared/scan-new.html`. 뒤의 둘이 **stale 인 채 커밋에 들어갔다** (`694b343`).
 *
 * 그리고 이게 **네 번 연속** 같은 자리에서 났다. 매번 사람이 «이번엔 잊지 말자» 로
 * 대응했고 매번 다시 빠졌다 — 즉 **기억의 문제가 아니라 구조의 문제**다:
 *
 *   · `bundle-scanner.test.js` 는 `dist/tlscan.html` **한 개**의 바이트만 잠근다.
 *   · `lab-build.test.js` 를 포함해 스위트 52/52 가 초록인 트리에서
 *     `lab-scan.html` 이 **30,773자 stale** 이었다. 어떤 테스트도 그 바이트를 안 봤다.
 *
 * 초록 테스트가 「배포될 파일이 최신이다」를 뜻하지 않았다. 그 간극을 여기서 닫는다.
 *
 * ── 이 테스트가 잠그는 명제 ─────────────────────────────────────────────────
 *
 * **빌더를 지금 돌린 결과 == 저장소에 커밋된 바이트.**
 *
 * 실패하면 고치는 법은 「테스트를 고치는 것」이 아니라 **빌더를 돌리고 커밋하는 것**이다.
 * 실패 메시지에 그 커맨드를 적어 둔다 — 새벽에 이걸 만난 사람이 헤매지 않게.
 *
 * ⚠ 새 생성 산출물을 추가하면 **이 표에 한 줄 더한다.** 표에 없으면 안 잠긴다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { buildScannerHtml } from '../tools/build-scanner.mjs';
import { buildLabVariants, LAB_OUTPUTS } from '../tools/build-lab.mjs';
import { buildScannerLabHtml } from '../tools/build-scan-variants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 커밋된 산출물 ↔ 그것을 만드는 빌더.
 * `rebuild` 는 산출물 문자열을 **그대로** 돌려주는 순수 호출이어야 한다.
 */
const ARTIFACTS = [
  {
    rel: 'dist/tlscan.html',
    command: 'node tools/build-scanner.mjs',
    rebuild: () => buildScannerHtml(),
  },
];

// lab 변형들은 한 번의 빌드가 여러 파일을 낸다 — 키가 곧 산출물 이름이다.
for (const key of Object.keys(LAB_OUTPUTS)) {
  ARTIFACTS.push({
    rel: path.posix.join('sites/_shared', path.basename(LAB_OUTPUTS[key])),
    command: 'node tools/build-lab.mjs',
    rebuild: () => buildLabVariants()[key],
  });
}

for (const artifact of ARTIFACTS) {
  test('산출물이 소스와 일치한다 — ' + artifact.rel, { timeout: 300_000 }, () => {
    const fresh = artifact.rebuild();
    assert.equal(typeof fresh, 'string',
      artifact.rel + ': 빌더가 문자열을 안 돌려준다 (이 표의 rebuild 가 틀렸다)');

    let onDisk;
    try {
      onDisk = readFileSync(path.join(ROOT, artifact.rel), 'utf8');
    } catch (error) {
      assert.fail(artifact.rel + ' 를 못 읽는다 (' + error.code + ') — `'
        + artifact.command + '` 를 돌려 만들어라');
    }

    if (onDisk === fresh) return;

    // 어디서 갈렸는지 한 줄로 — 2MB 짜리 diff 를 쏟지 않는다.
    let at = 0;
    while (at < onDisk.length && at < fresh.length && onDisk[at] === fresh[at]) at += 1;
    assert.fail(
      artifact.rel + ' 가 **stale** 이다 (커밋된 ' + onDisk.length + '자 vs 소스 기준 '
      + fresh.length + '자, ' + at + '자째부터 갈림).\n'
      + '  고치는 법: `' + artifact.command + '` 를 돌리고 산출물을 커밋해라.\n'
      + '  ⚠ 이 테스트를 고쳐서 통과시키지 마라 — 그러면 배포될 파일이 소스와 다른 채로 나간다.',
    );
  });
}

/*
 * `scan-new.html` 은 위 표에 못 넣는다 — **순수 함수가 아니다.**
 * `build-scan-variants.mjs` 가 현재 빌드에 «버전 선택 바» 를 `<body>` 바로 뒤에
 * 주입해서 만드는데, 그 바에는 **다른 변형(scan-old)의 빌드 태그**가 들어가고
 * 그건 옛 커밋을 워크트리로 꺼내야 나온다. 테스트가 그걸 재현하는 것은 비싸고,
 * 재현하려다 빌더 산술을 복제하면 그 복제본이 곧 다음 거짓말이 된다.
 *
 * 그래서 **재현 대신 포함 관계**를 잠근다: 바를 걷어내면 현재 빌드와 바이트 동일이다.
 * 이 명제만으로도 오늘의 결함(스캐너를 고치고 이 파일을 안 구움)은 정확히 잡힌다.
 */
test('산출물이 소스와 일치한다 — sites/_shared/scan-new.html (선택 바 제외)', {
  timeout: 300_000,
}, () => {
  const fresh = buildScannerLabHtml();
  const onDisk = readFileSync(path.join(ROOT, 'sites/_shared/scan-new.html'), 'utf8');

  const at = fresh.indexOf('>', fresh.indexOf('<body')) + 1;
  assert.ok(at > 0, '현재 빌드에서 <body> 를 못 찾았다 — 이 테스트의 전제가 바뀌었다');

  const head = fresh.slice(0, at);
  const tail = fresh.slice(at);
  const hint = '\n  고치는 법: `node tools/build-scan-variants.mjs` 를 돌리고 커밋해라.'
    + '\n  ⚠ 이 테스트를 고쳐서 통과시키지 마라 — 배포될 파일이 소스와 달라진다.';

  assert.ok(onDisk.startsWith(head),
    'scan-new.html 의 <body> 앞부분이 현재 빌드와 다르다 (stale).' + hint);
  assert.ok(onDisk.endsWith(tail),
    'scan-new.html 의 본문이 현재 빌드와 다르다 (stale · 커밋된 ' + onDisk.length
    + '자 vs 소스 기준 ' + fresh.length + '자 + 선택 바).' + hint);
  assert.ok(onDisk.length > fresh.length,
    'scan-new.html 에 버전 선택 바가 없다 — 주입 단계가 빠졌다');
});

/**
 * 다른 테스트가 이미 자기 산출물의 신선도를 잠그는 빌더들.
 *
 * ⚠ 이 목록은 **면제부가 아니라 청구서**다. 여기 이름을 올리려면 그 테스트가 실제로
 * «커밋된 바이트 == 지금 빌드» 를 재야 한다. 아래 테스트가 그 파일들을 실제로 실행해
 * 확인하므로, 거짓으로 올리면 잡힌다.
 */
const COVERED_ELSEWHERE = Object.freeze({
  'build-cell-editor.mjs': 'test/finder-editor.test.js',
  'build-finder-editor.mjs': 'test/finder-editor.test.js',
  'build-gen-variants.mjs': 'test/gen-variants.test.js',
  'build-hub.mjs': 'test/hub-build.test.js',
  'build-single.mjs': 'test/gen-variants.test.js',
});

test('**모든 빌더**가 어딘가에서 신선도로 잠긴다', async () => {
  // ⚠ 이 테스트는 원래 내가 손으로 적은 이름 4개만 확인했다. 그러고 나서 전체 스위트가
  //   `build-cell-editor` · `build-gen-variants` 산출물의 stale 로 **2건 빨개졌다** —
  //   즉 이 «커버리지» 테스트 자신이 커버리지 구멍을 갖고 있었다. 오늘 세 번째로 같은
  //   모양이다 (교훈 009 · stale 번들 · 조합 미검사). 그래서 목록을 **손으로 적지 않고
  //   `tools/` 에서 유도**한다 — 빌더가 새로 생기면 여기서 자동으로 걸린다.
  const builders = readdirSync(path.join(ROOT, 'tools'))
    .filter((f) => f.startsWith('build-') && f.endsWith('.mjs'));
  assert.ok(builders.length >= 9, '빌더를 ' + builders.length + '개밖에 못 찾았다 — 경로가 바뀌었나');

  const mine = new Set(ARTIFACTS.map((a) => path.basename(a.command.split(' ').pop())));
  mine.add('build-scan-variants.mjs');            // scan-new.html 을 위 테스트가 따로 잠근다
  mine.add('build-print-poster.mjs');             // test/print-poster.test.js:92 가 잠근다

  // 산출물이 **전부 gitignore 영역**인 빌더는 신선도 대상이 아니다 — 「커밋된 바이트 ==
  // 지금 빌드」를 잴 커밋된 바이트가 아예 없기 때문이다 (build-layout-packs 는 팩을
  // test/output/ 아래에만 굽는다). 이것도 손 목록으로 두지 않고 **빌더의 OUTPUTS 선언에서
  // 유도**한다 — 위 주석이 말하는 그 교훈의 연장이다.
  const ignoredOnly = new Set();
  for (const builder of builders) {
    const file = path.join(ROOT, 'tools', builder);
    let outputs = null;
    try {
      if (!/export\s+const\s+OUTPUTS/.test(readFileSync(file, 'utf8'))) continue;
      ({ OUTPUTS: outputs } = await import(pathToFileURL(file).href));
    } catch { continue; }
    if (!Array.isArray(outputs) || outputs.length === 0) continue;
    const allIgnored = outputs.every((out) => {
      const rel = String(out).replace(/\\/g, '/');
      try {
        execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    });
    if (allIgnored) ignoredOnly.add(builder);
  }

  const orphans = builders.filter(
    (b) => !mine.has(b) && !COVERED_ELSEWHERE[b] && !ignoredOnly.has(b),
  );
  assert.deepEqual(orphans, [],
    '이 빌더들의 산출물을 아무도 신선도로 안 잠근다 — 조용히 stale 이 된다: '
    + orphans.join(', '));

  // 청구서 회수: COVERED_ELSEWHERE 가 가리키는 테스트 파일이 **실재**해야 한다.
  for (const [builder, testFile] of Object.entries(COVERED_ELSEWHERE)) {
    assert.ok(existsSync(path.join(ROOT, testFile)),
      builder + ' 를 잠근다고 적힌 ' + testFile + ' 가 없다 — 주석이 거짓이 된다');
  }
});
