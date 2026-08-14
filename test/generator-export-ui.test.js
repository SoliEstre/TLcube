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

test('내보내기 영역은 다운로드·복사 큰 레이블과 포맷별 큰 아이콘 위계를 쓴다', () => {
  assert.match(INDEX, /class="export-heading"[^>]*id="exportHeading"/);
  assert.match(INDEX, /class="export-dl-icon"/);
  assert.match(INDEX, /data-i18n="g074">다운로드와 복사</);
  assert.match(INDEX, /"g074": "다운로드와 복사"/);
  assert.match(INDEX, /"g074": "Download and copy"/);
  assert.match(INDEX, /"g074": "ダウンロードとコピー"/);
  assert.match(INDEX, /id="exportPng"[^>]*class="export-fmt"/);
  assert.match(INDEX, /id="exportSvg"[^>]*class="export-fmt"/);
  assert.match(INDEX, /class="export-format-icon"/);
  assert.match(INDEX, /aria-labelledby="exportHeading"/);
  assert.match(INDEX, /id="copyPng"[^>]*data-i18n-attr="title:g021"/);
  assert.match(INDEX, /id="copySvg"[^>]*data-i18n-attr="title:g022"/);
  assert.match(INDEX, /\.export-format-icon \{ width: 22px/);
  assert.match(INDEX, /@media \(max-width: 520px\)[\s\S]*\.export-row \{ flex-direction: column/);
});

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
