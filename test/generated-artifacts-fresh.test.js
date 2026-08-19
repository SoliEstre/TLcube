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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('표가 실제 산출물을 빠짐없이 덮는다', () => {
  // 이 테스트가 지키는 것은 «표에 있는 것이 맞다» 가 아니라 «빠진 것이 없다» 다.
  // 표에 없는 산출물은 조용히 stale 이 된다 — 그게 이 파일이 생긴 이유다.
  const covered = new Set(ARTIFACTS.map((a) => a.rel));
  covered.add('sites/_shared/scan-new.html');   // 바로 위 테스트가 따로 잠근다
  for (const expected of [
    'dist/tlscan.html',
    'sites/_shared/lab-scan.html',
    'sites/_shared/lab-gen.html',
    'sites/_shared/scan-new.html',
  ]) {
    assert.ok(covered.has(expected),
      expected + ' 가 ARTIFACTS 표에 없다 — 안 잠기면 조용히 stale 이 된다');
  }
});
