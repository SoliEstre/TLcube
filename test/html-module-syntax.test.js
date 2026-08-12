/*
 * HTML 안 인라인 모듈 스크립트의 **문법**을 잰다.
 *
 * ⚠ 이 파일이 왜 있는지: 2026-08-12, index.html 의 i18n 사전에서 항목 하나 뒤에 쉼표가
 *   빠졌다("g507" 뒤). 객체 리터럴이 깨지면서 **앱 전체가 부팅하지 못했다** — 카드도,
 *   렌더도, 빌드 태그도 없었다. 그런데 `npm test` 는 1189/1189 초록이었다.
 *
 *   이유는 단순하다. 다른 테스트는 index.html 을 **텍스트로만** 읽는다(정규식 매칭).
 *   문자열로 보는 한 문법 오류는 그냥 «그런 글자» 이지 오류가 아니다. 그래서 스위트를
 *   아무리 늘려도 이 층은 안 덮인다 — 파서를 한 번 통과시키는 테스트가 따로 필요하다.
 *
 * 파일 목록을 손으로 적지 않는다. repo 를 훑어 인라인 모듈을 **가진 모든 HTML** 을
 * 검사하므로, 새 페이지가 생겨도 자동으로 포함된다.
 *
 * 번들(dist/*.html)은 앱 소스를 APP_CODE **문자열**로 물고 있어서 로더만 파싱된다.
 * 그쪽 보장은 사슬로 성립한다: index.html 이 파싱된다 → 빌더가 그 모듈 본문을 그대로
 * 잘라 APP_CODE 로 넣는다 → gen-variants 테스트가 산출물이 방금 빌드와 바이트 동일임을
 * 단언한다. 사슬의 첫 고리가 여기다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', '.playwright-mcp', 'test']);
const MODULE_SCRIPT = /<script type="module">([\s\S]*?)<\/script>/g;

function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...htmlFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.html')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

test('인라인 모듈을 가진 모든 HTML 이 자바스크립트로 파싱된다', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'tlcube-syntax-'));
  let checked = 0;
  for (const file of htmlFiles(ROOT)) {
    const html = readFileSync(file, 'utf8');
    MODULE_SCRIPT.lastIndex = 0;
    let match;
    let index = 0;
    while ((match = MODULE_SCRIPT.exec(html)) !== null) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const scratchFile = path.join(scratch, checked + '.mjs');
      writeFileSync(scratchFile, match[1], 'utf8');
      try {
        // --check 는 «파싱만» 한다 — 실행하지 않으므로 DOM 이 없어도 안전하다.
        execFileSync(process.execPath, ['--check', scratchFile], { stdio: 'pipe' });
      } catch (error) {
        const detail = String(error.stderr || error.message)
          .split('\n').filter((line) => /SyntaxError|\^/.test(line)).join(' ');
        assert.fail(rel + ' 의 ' + index + '번째 인라인 모듈이 파싱되지 않는다: ' + detail);
      }
      checked += 1;
      index += 1;
    }
  }
  // 0 개를 «전부 통과» 로 보고하는 사고를 막는다 — 추출 정규식이 죽으면 조용히 0 이 된다.
  assert.ok(checked >= 5, '인라인 모듈을 ' + checked + '개만 찾았다 — 추출이 깨졌는지 확인');
});
