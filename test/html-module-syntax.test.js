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
 * ⚠ 번들(dist/*.html)은 앱 소스를 APP_CODE **문자열**로 물고 있다. 그래서 인라인
 *   스크립트만 파싱하면 **로더만** 검사되고 앱 본체는 통째로 지나간다 — 실제로 이
 *   구분을 잊고 라이브를 «파싱 OK» 로 오판했다(2026-08-12, 그때 라이브는 죽어 있었다).
 *   사슬 논증(index.html 이 파싱된다 → 빌더가 그 본문을 그대로 APP_CODE 로 넣는다 →
 *   gen-variants 가 바이트 동일을 단언한다)으로도 닿기는 하지만, 사슬은 사람이 틀리기
 *   쉽다. 아래에서 APP_CODE 를 **직접 꺼내 파싱**한다.
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
// 단일 파일 번들의 앱 본체. 로더가 blob URL 로 만들어 import 하는 «진짜 앱» 이다.
const APP_CODE = /const APP_CODE = ("(?:\\.|[^"\\])*");/;

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

test('인라인 모듈과 번들 앱 본체가 모두 자바스크립트로 파싱된다', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'tlcube-syntax-'));
  let checked = 0;
  let appBodies = 0;

  // --check 는 «파싱만» 한다 — 실행하지 않으므로 DOM 이 없어도 안전하다.
  const parses = (source, label) => {
    const scratchFile = path.join(scratch, checked + '.mjs');
    writeFileSync(scratchFile, source, 'utf8');
    checked += 1;
    try {
      execFileSync(process.execPath, ['--check', scratchFile], { stdio: 'pipe' });
    } catch (error) {
      const detail = String(error.stderr || error.message)
        .split('\n').filter((line) => /SyntaxError|\^/.test(line)).join(' ');
      assert.fail(label + ' 이 파싱되지 않는다: ' + detail);
    }
  };

  for (const file of htmlFiles(ROOT)) {
    const html = readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    MODULE_SCRIPT.lastIndex = 0;
    let match;
    let index = 0;
    while ((match = MODULE_SCRIPT.exec(html)) !== null) {
      parses(match[1], rel + ' 의 ' + index + '번째 인라인 모듈');
      index += 1;
    }
    const app = APP_CODE.exec(html);
    if (app !== null) {
      parses(JSON.parse(app[1]), rel + ' 의 APP_CODE(번들 앱 본체)');
      appBodies += 1;
    }
  }

  // 0 개를 «전부 통과» 로 보고하는 사고를 막는다 — 추출이 깨지면 조용히 0 이 된다.
  assert.ok(checked >= 5, '인라인 모듈을 ' + checked + '개만 찾았다 — 추출이 깨졌는지 확인');
  assert.ok(appBodies >= 2, 'APP_CODE 를 ' + appBodies + '개만 찾았다 — 번들이 검사에서 빠졌다');
});
