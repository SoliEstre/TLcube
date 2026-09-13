import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { engineSwitchAvailable, resolveEngineChoice, ENGINE_SWITCH_PRODUCT_ENABLED, ENGINE_STORAGE_KEY, ENGINE_STORAGE_KEY_LEGACY } from '../src/scanner-scan-assist.js';
import { H_SCANNER_COPY, hScannerText } from '../src/h-scanner-ui.js';
import { hUiLabel } from '../src/generator-h.js';
import { SUPPORTED_LANGUAGES } from '../src/i18n.js';

const source = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');
const generator = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scannerHtml = readFileSync(new URL('../sites/tlscan/index.html', import.meta.url), 'utf8');
const start = source.indexOf('const r2Available =');
const end = source.indexOf('let hPhotoSnapshot', start);

function initialize({ labPath, productEnabled = ENGINE_SWITCH_PRODUCT_ENABLED, stored = null }) {
  assert.ok(start >= 0 && end > start, '제품 availability/worker/photo 초기화 경계를 못 찾았어요');
  let workerOptions, photoReaders = 0, writes = 0;
  const context = {
    engineSwitchAvailable, resolveEngineChoice, ENGINE_STORAGE_KEY, ENGINE_STORAGE_KEY_LEGACY,
    ENGINE_SWITCH_PRODUCT_ENABLED: productEnabled,
    isLabPath: () => labPath,
    window: { localStorage: { getItem: key => key === ENGINE_STORAGE_KEY ? stored : null, setItem: () => { writes++; } } },
    createR2WorkerRuntime: options => { workerOptions = options; return { enabled: options.enabled }; },
    createHPhotoReader: () => { photoReaders++; return {}; },
  };
  vm.runInNewContext(source.slice(start, end) + '\nresult = {r2Available,hAvailable,r2Wanted};', context);
  return { ...context.result, workerOptions, photoReaders, writes };
}

test('H는 정식/시험판 제품 R2 가용성으로 camera worker와 photo reader를 함께 열어요', () => {
  for (const labPath of [false, true]) for (const productEnabled of [false, true]) {
    const result = initialize({ labPath, productEnabled });
    const expected = labPath || productEnabled;
    assert.equal(result.r2Available, expected);
    assert.equal(result.hAvailable, expected);
    assert.equal(result.workerOptions.enabled, expected);
    assert.equal(result.workerOptions.engineOptions.enableH, expected);
    assert.equal(result.photoReaders, expected ? 1 : 0);
    assert.equal(result.writes, 0, '가용성 승격이 저장된 엔진 선택을 바꾸면 안 돼요');
  }
  assert.equal(initialize({ labPath: false }).hAvailable, true, '현재 정식 제품에서 H가 닫혔어요');
});

test('H 정식 가용성은 사용자의 수동 R1 선택이나 Type Y lab-only 로케이터를 바꾸지 않아요', () => {
  const result = initialize({ labPath: false, stored: '0' });
  assert.equal(result.hAvailable, true);
  assert.equal(result.workerOptions.enabled, false);
  assert.equal(result.r2Wanted, false);
  assert.equal(result.writes, 0);
  assert.match(source, /enableLocatorY:\s*isLabPath\(\)/);
  assert.doesNotMatch(source, /enableLocatorY:\s*true/);
  assert.match(source, /hAvailable\s*\?\s*imageDataCenterSquare/);
});

test('H 수집 제목과 중간 가이드가 8언어에서 정식 UI에 맞고 완료 검증 문구를 유지해요', () => {
  assert.deepEqual(Object.keys(H_SCANNER_COPY).sort(), [...SUPPORTED_LANGUAGES].sort());
  const keys = Object.keys(H_SCANNER_COPY.ko).sort();
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(H_SCANNER_COPY[lang]).sort(), keys);
    assert.ok(hScannerText(lang, 'cubeGuide').length > 20);
    assert.doesNotMatch(hScannerText(lang, 'title'), /trial|experimental|시험판|試験版|expérimental|sperimentale|experimentell/i);
    assert.notEqual(hScannerText(lang, 'checking'), hScannerText(lang, 'done'));
  }
  assert.match(scannerHtml, /id="h-collection-title">H 큐브 수집<\/strong>/);
});

test('생성기8언어는 M0/없는 SPEC절 대신 H 공개 계약을 안내하고 H8 경계를 포함해요', () => {
  const headings = [...generator.matchAll(/"g023":\s*"([^"]+)"/g)].map(match => match[1]);
  const footers = [...generator.matchAll(/"g301":\s*"([^"]+)"/g)].map(match => match[1]);
  assert.equal(headings.length, SUPPORTED_LANGUAGES.length);
  assert.equal(footers.length, SUPPORTED_LANGUAGES.length);
  for (const heading of headings) { assert.doesNotMatch(heading, /\bM0\b/); assert.match(heading, /H/); }
  for (const footer of footers) { assert.doesNotMatch(footer, /§14/); assert.match(footer, /SPEC.*§13/); }
  assert.match(generator, /data-i18n="g023">3면[^<]*True 3D H/);
  assert.match(hUiLabel('frame', 'ko'), /6면 H7 이상/);
  assert.doesNotMatch(hUiLabel('notice', 'en'), /shading.*unavailable/);
});
