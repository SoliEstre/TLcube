// bundle-scanner.test.js — tools/build-scanner.mjs의 스캐너 단일 파일 회귀 검증.
//
// 실행: node --test test/bundle-scanner.test.js (cwd: TLcube)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildScannerHtml,
  collectScannerModuleSources,
} from '../tools/build-scanner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_FILE = path.join(ROOT, 'dist', 'tlscan.html');
const RELATIVE_JS_SPECIFIER_RE = /(['"])(?:\.\/|\.\.\/)[^'"]+\.js\1/;

test('결정성: buildScannerHtml()을 2회 호출해도 바이트가 동일하다', () => {
  const first = buildScannerHtml();
  const second = buildScannerHtml();

  assert.equal(first, second);
});

test('구조: 산출물에 상대 .js import와 외부 scanner.js script가 남지 않는다', () => {
  const out = buildScannerHtml();

  assert.doesNotMatch(
    out,
    RELATIVE_JS_SPECIFIER_RE,
    '상대 .js specifier가 남아 blob URL 로더가 브라우저에서 다시 상대 경로를 해석할 수 있음',
  );
  assert.doesNotMatch(
    out,
    /<script\b[^>]*\bsrc\s*=\s*(["'])scanner\.js\1/i,
    'scanner.js를 별도 네트워크 module로 불러오는 script가 남아 있음',
  );
  assert.doesNotMatch(
    out,
    /\b(?:import|export)\s+[^;]*?\s+from\s+['"]\/src\//,
    '실행되는 /src/ import가 단일 파일 안에 남아 있음',
  );
});

test('위상 정렬 가드: scanner.js를 선두로 옮긴 뮤테이션은 빌드를 실패시킨다', () => {
  const ordered = collectScannerModuleSources();
  const entry = ordered.find((moduleSource) => moduleSource.id === '/scanner.js');

  assert.ok(entry, 'scanner.js 진입 모듈을 찾지 못함');

  const mutated = [
    entry,
    ...ordered.filter((moduleSource) => moduleSource !== entry),
  ];

  assert.throws(
    () => buildScannerHtml({ moduleSources: mutated }),
    /위상 정렬이 아니다/,
    '의존 모듈보다 scanner.js를 먼저 등록하는 뮤테이션은 빌드에서 차단되어야 함',
  );
});

test('동기화: buildScannerHtml() 결과가 dist/tlscan.html과 바이트 동일하다', () => {
  const built = buildScannerHtml();
  const onDisk = readFileSync(DIST_FILE, 'utf8');

  assert.equal(
    built,
    onDisk,
    'dist/tlscan.html이 최신이 아니에요. scanner 또는 src 변경 후 node tools/build-scanner.mjs를 다시 실행하세요.',
  );
});
