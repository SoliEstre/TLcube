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

test('내보내기 영역은 TLcube 다운로드·복사 큰 레이블과 포맷별 큰 아이콘 위계를 쓴다', () => {
  assert.match(INDEX, /<section class="export-section" aria-labelledby="exportHeading">/);
  assert.match(INDEX, /class="export-heading"[^>]*id="exportHeading"/);
  assert.match(INDEX, /class="export-dl-icon"/);
  assert.match(INDEX, /data-i18n="g074">TL큐브 다운로드 \/ 복사하기</);
  assert.match(INDEX, /"g074": "TL큐브 다운로드 \/ 복사하기"/);
  assert.match(INDEX, /"g074": "Download \/ copy TLcube"/);
  assert.match(INDEX, /"g074": "TLcubeをダウンロード／コピー"/);
  assert.match(INDEX, /id="exportPng"[^>]*class="export-fmt"/);
  assert.match(INDEX, /id="exportSvg"[^>]*class="export-fmt"/);
  assert.match(INDEX, /class="export-format-icon"/);
  assert.match(INDEX, /aria-labelledby="exportHeading"/);
  assert.match(INDEX, /id="copyPng"[^>]*data-i18n-attr="title:g021"/);
  assert.match(INDEX, /id="copySvg"[^>]*data-i18n-attr="title:g022"/);
  assert.match(INDEX, /\.export-format-icon \{ width: 22px/);
  assert.match(INDEX, /@media \(max-width: 520px\)[\s\S]*\.export-row \{ flex-direction: column/);
  assert.match(INDEX, /id="rotationGuidance"/);
});

test('다운로드는 모바일 DOM 위치를 유지하고 좌우 분할 뷰에서만 패널 맨 위로 올라간다', () => {
  const sharedControls = INDEX.indexOf('id="sharedControls"');
  const exportSection = INDEX.indexOf('class="export-section"');
  assert.ok(sharedControls >= 0 && exportSection > sharedControls,
    '모바일 DOM 순서에서는 다운로드 영역이 기존처럼 공용 설정 뒤에 있어야 해요.');
  assert.match(INDEX, /@media \(min-width: 761px\)[\s\S]*main > \.panel \{ display: flex; flex-direction: column; \}[\s\S]*\.export-section \{ order: -1;/);
});

test('용량 영역은 콘텐츠 입력과 타입 선택 사이에 있다', () => {
  const contentInput = INDEX.indexOf('id="nCardUrl"');
  const capacity = INDEX.indexOf('id="capacitySection"');
  const typeSelection = INDEX.indexOf('id="panelNormal"');
  assert.ok(contentInput >= 0 && contentInput < capacity && capacity < typeSelection,
    '용량 영역은 마지막 콘텐츠 입력 뒤, 타입 선택 패널 앞이어야 해요.');
  assert.equal(INDEX.match(/id="capacitySection"/g)?.length, 1);
  assert.equal(INDEX.match(/id="nGaugeFill"/g)?.length, 1);
  assert.equal(INDEX.match(/id="nGaugeLabel"/g)?.length, 1);
});

test('안전영역의 다섯 선택지는 전용 한 줄 레이아웃을 쓴다', () => {
  assert.equal(INDEX.match(/id="quietModeCards"/g)?.length, 1);
  assert.match(INDEX, /#quietModeCards \{ flex-wrap: nowrap; gap: 6px; \}/);
  assert.match(INDEX, /#quietModeCards \.toggle-card \{ min-width: 0; padding-inline: 2px; font-size: 10px; \}/);
  assert.match(INDEX, /@media \(max-width: 420px\)[\s\S]*#quietModeCards \{ gap: 4px; \}/);
});

test('QR 링크 섹션은 중앙 파인더보다 앞이고 섹션 제목은 강화된 위계를 쓴다', () => {
  const qrLink = INDEX.indexOf('id="qrLinkSection"');
  const finder = INDEX.indexOf('id="finderSection"');
  assert.ok(qrLink >= 0 && qrLink < finder, 'TL스캐너 QR 링크 섹션이 중앙 파인더보다 앞이어야 해요.');
  assert.match(INDEX, /class="section-heading" id="qrLinkHeading" data-i18n="g064"/);
  assert.match(INDEX, /\.section-heading, \.section-title \{[\s\S]*color: var\(--text\); font-size: 13px; font-weight: 700;/);
});

test('회전·인식 제한 안내는 생성기에만 있고 스캐너 UI에는 없다', () => {
  const scanner = readFileSync(resolve(ROOT, 'sites/tlscan/index.html'), 'utf8');
  const scannerJs = readFileSync(resolve(ROOT, 'sites/tlscan/scanner.js'), 'utf8');
  const scannerStrings = readFileSync(resolve(ROOT, 'sites/tlscan/strings.js'), 'utf8');
  assert.match(INDEX, /id="rotationGuidance"[^>]*data-i18n="g514"/);
  assert.doesNotMatch(scanner, /rotationGuidance|g514|회전시키면 인식/);
  assert.doesNotMatch(scannerJs, /rotationGuidance|g514/);
  assert.doesNotMatch(scannerStrings, /회전시키면 인식|rotation tolerance|回転させると認識/);
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
