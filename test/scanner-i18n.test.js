/*
 * scanner-i18n.test.js — 스캐너 문구 사전의 완전성.
 *
 * ⚠ 이 파일은 원래 «있다고 주석에 적혀 있었지만 실재하지 않았다**. `strings.js` 머리말이
 *   「키를 추가하면 세 언어 모두 채운다 — test/scanner-i18n.test.js 가 누락을 잡는다」고
 *   단언하는데, 그 파일이 없었다(2026-08-12 발견). 주석이 약속한 방어는 실재해야 한다 —
 *   없으면 그 거짓말이 «이미 검사된다» 는 착각을 만들어 진짜 누락을 통과시킨다.
 *
 * 키를 손으로 나열하지 않는다. 사전과 소스를 훑어 **쓰이는 키 전체**를 대조한다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCANNER_JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
const SCANNER_HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');

const LANGS = Object.keys(SCANNER_STRINGS);

function keysOf(lang) {
  return Object.keys(SCANNER_STRINGS[lang]).sort();
}

test('세 언어 사전의 키 집합이 완전히 같다', () => {
  assert.deepEqual(LANGS.sort(), ['en', 'ja', 'ko']);
  const base = keysOf('ko');
  assert.ok(base.length > 40, '한국어 키가 ' + base.length + '개뿐 — 사전을 잘못 읽었다');
  for (const lang of LANGS) {
    const missing = base.filter((key) => !(key in SCANNER_STRINGS[lang]));
    const extra = keysOf(lang).filter((key) => !base.includes(key));
    assert.deepEqual(missing, [], lang + '에 없는 키');
    assert.deepEqual(extra, [], lang + '에만 있는 키');
  }
});

test('빈 문구가 없다 — 빠진 번역은 조용히 빈 화면이 된다', () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(SCANNER_STRINGS[lang])) {
      assert.equal(typeof value, 'string', lang + '/' + key);
      assert.ok(value.trim().length > 0, lang + '/' + key + ' 가 비어 있다');
    }
  }
});

test('scanner.js 가 부르는 t() 키가 전부 사전에 있다', () => {
  const used = [...SCANNER_JS.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  assert.ok(used.length > 10, 't() 호출을 ' + used.length + '개만 찾았다 — 추출이 깨졌다');
  const unknown = [...new Set(used)].filter((key) => !(key in SCANNER_STRINGS.ko));
  assert.deepEqual(unknown, [], '사전에 없는 키를 부른다');
});

test('index.html 의 data-i18n 키가 전부 사전에 있다', () => {
  const direct = [...SCANNER_HTML.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  const attrs = [...SCANNER_HTML.matchAll(/data-i18n-attr="([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/).map((pair) => pair.split(':')[1]));
  const used = [...new Set([...direct, ...attrs])].filter(Boolean);
  assert.ok(used.length > 10, 'data-i18n 을 ' + used.length + '개만 찾았다 — 추출이 깨졌다');
  const unknown = used.filter((key) => !(key in SCANNER_STRINGS.ko));
  assert.deepEqual(unknown, [], '사전에 없는 키를 참조한다');
});

test('스캔 가이드 아래에 TLcube 전용 범위를 세 언어로 알린다', () => {
  assert.match(SCANNER_HTML, /class="scan-scope-note" data-i18n="guide\.tlcubeOnly"/);
  assert.equal(SCANNER_STRINGS.ko['guide.tlcubeOnly'], 'QR 및 다른 바코드는 읽히지 않아요.');
  assert.equal(SCANNER_STRINGS.en['guide.tlcubeOnly'], 'QR codes and other barcodes are not supported.');
  assert.equal(SCANNER_STRINGS.ja['guide.tlcubeOnly'], 'QR コードやその他のバーコードは読み取れません。');
});

test('Type Y 강화 로케이터는 /lab/ 스캐너에서만 디코더에 켠다', () => {
  assert.match(
    SCANNER_JS,
    /bootstrap:\s*\{\s*family:\s*\{\s*cube:\s*\{\s*enableLocatorY:\s*isLabPath\(\),\s*enableCellSurfaceY:\s*isLabPath\(\)\s*\}\s*\}\s*\}/,
  );
  assert.doesNotMatch(SCANNER_JS, /enableLocatorY:\s*true/);
  assert.doesNotMatch(SCANNER_JS, /enableCellSurfaceY:\s*true/);
});

test('사진 스캔 실패 두 경로가 모두 토스트를 띄운다', () => {
  // 사진 경로의 실패는 «결과 없음» 과 «읽기 실패» 둘뿐이고, 둘 다 알려야 한다.
  // ⚠ 소스 매칭이라 «호출이 적혀 있다» 까지만 보증한다 — 실제로 보이는지는 실브라우저로
  //   확인했다(파일 선택 → 토스트 표시). 이 테스트는 두 경로 중 하나가 조용히 빠지는
  //   회귀만 막는다.
  for (const key of ['toast.photoNoResult', 'toast.photoUnreadable']) {
    assert.match(SCANNER_JS, new RegExp('showScanToast\\(t\\(\'' + key.replace('.', '\\.') + '\'\\)\\)'));
  }
  // 라이브 프레임은 초당 여러 번 실패하는 게 정상이라 토스트를 걸면 안 된다.
  const cameraBranch = SCANNER_JS.slice(
    SCANNER_JS.indexOf("if (source === 'camera')"),
    SCANNER_JS.indexOf("if (!payload)"),
  );
  assert.ok(cameraBranch.length > 0, 'camera 분기를 못 찾았다');
  assert.doesNotMatch(cameraBranch, /showScanToast/);
});
