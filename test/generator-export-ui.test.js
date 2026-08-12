/**
 * generator-export-ui.test.js — 다운로드 파일명·모바일 Toast 연결 계약.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

test('PNG·SVG는 고유 실험 라벨 파일명과 세 언어 상태 Toast를 함께 쓴다', () => {
  assert.match(INDEX, /createExportFilenameFactory\(\)/);
  assert.match(INDEX, /exportFilename\('png'\)/);
  assert.match(INDEX, /exportFilename\('svg'\)/);
  assert.match(INDEX, /id="downloadToast"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(INDEX, /function showDownloadToast\(filename\)[\s\S]*tf\('g507', \{ filename \}\)/);
  assert.match(INDEX, /"g507": "\{filename\}으로 다운로드되었습니다\."/);
  assert.match(INDEX, /"g507": "Downloaded as \{filename\}\."/);
  assert.match(INDEX, /"g507": "\{filename\} としてダウンロードしました。"/);
  assert.match(INDEX, /setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 10_000\)/);
});
