/*
 * scanner-i18n.test.js — 스캐너 문구 사전의 완전성.
 *
 * ⚠ 이 파일은 원래 «있다고 주석에 적혀 있었지만 실재하지 않았다**. `strings.js` 머리말이
 *   「키를 추가하면 여덟 언어 모두 채운다 — test/scanner-i18n.test.js 가 누락을 잡는다」고
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
import { SUPPORTED_LANGUAGES } from '../src/i18n.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCANNER_JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');
const SCANNER_HTML = readFileSync(ROOT + 'sites/tlscan/index.html', 'utf8');

const LANGS = Object.keys(SCANNER_STRINGS);

function keysOf(lang) {
  return Object.keys(SCANNER_STRINGS[lang]).sort();
}

// ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): 3언어 → 8언어.
//   이 배열은 «사전이 몇 언어인가» 를 못 박는 자리다. 넓히는 커밋과 사전을 채우는
//   커밋이 갈리면 «키는 다 있는데 언어가 세 개» 인 상태가 통과해 버린다.
//   목록은 `src/i18n.js` 의 `SUPPORTED_LANGUAGES` 와 같아야 한다 — 아래에서 그것도 잰다.
test('여덟 언어 사전의 키 집합이 완전히 같다', () => {
  assert.deepEqual(LANGS.sort(), ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt']);
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

// ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): 값 핀 3 → 8.
//   이 안내는 «왜 내 QR 이 안 읽히나» 를 미리 막는 문구라, 한 언어라도 빠지면 그
//   언어권에서만 지원 문의가 는다. 새 언어에 값이 있는지까지 확인한다.
test('스캔 가이드 아래에 TLcube 전용 범위를 여덟 언어로 알린다', () => {
  assert.match(SCANNER_HTML, /class="scan-scope-note" data-i18n="guide\.tlcubeOnly"/);
  assert.equal(SCANNER_STRINGS.ko['guide.tlcubeOnly'], 'QR 및 다른 바코드는 읽히지 않아요.');
  assert.equal(SCANNER_STRINGS.en['guide.tlcubeOnly'], 'QR codes and other barcodes are not supported.');
  assert.equal(SCANNER_STRINGS.ja['guide.tlcubeOnly'], 'QR コードやその他のバーコードは読み取れません。');
  assert.equal(SCANNER_STRINGS.fr['guide.tlcubeOnly'], 'Les codes QR et les autres codes-barres ne sont pas pris en charge.');
  assert.equal(SCANNER_STRINGS.it['guide.tlcubeOnly'], 'I codici QR e gli altri codici a barre non sono supportati.');
  assert.equal(SCANNER_STRINGS.de['guide.tlcubeOnly'], 'QR-Codes und andere Barcodes werden nicht gelesen.');
  assert.equal(SCANNER_STRINGS.es['guide.tlcubeOnly'], 'Los códigos QR y otros códigos de barras no son compatibles.');
  assert.equal(SCANNER_STRINGS.pt['guide.tlcubeOnly'], 'Os códigos QR e outros códigos de barras não são suportados.');
});

// 사전이 있는데 `SUPPORTED_LANGUAGES` 에 없으면 «드롭다운에 있는데 골라도 안 바뀐다» 가
// 되고, 반대면 «고를 수는 있는데 화면 절반이 한국어» 가 된다. 둘 다 조용한 결함이라
// 여기서 두 목록이 같은 집합인지 못 박는다.
test('스캐너 사전 언어 목록 == src/i18n.js SUPPORTED_LANGUAGES', () => {
  assert.deepEqual([...LANGS].sort(), [...SUPPORTED_LANGUAGES].sort());
});

test('Type Y 강화 로케이터는 /lab/ 스캐너에서만 디코더에 켠다', () => {
  // **의도적 갱신 (2026-08-18)** — 예전 정규식은 `bootstrap` 객체의 **모양 전체**를
  // 한 덩어리로 잠갔다. 그래서 같은 객체에 형제 키를 하나 더하는 것만으로 깨졌다
  // (daehan 옵트인 `cellFinderDaehan`). 이 핀이 지키려는 명제는 «스위치가
  // isLabPath() 에 매여 있다» 이지 «bootstrap 에 다른 키가 없다» 가 아니다.
  // 그래서 **명제만** 잠근다 — 모양을 잠그면 확장할 때마다 거짓 경보가 난다.
  //
  // **의도적 축소 (2026-08-19)** — 예전엔 `enableCellSurfaceY` 도 여기서 같이 잠갔다.
  // 그 축은 **디코더 기본값이 켜짐으로 올라가면서** 이 핀의 대상이 아니게 됐다
  // (운영자 결정: 인쇄 포스터가 v0 셀 표면이 되어, 레퍼런스 기본값이 우리 포스터를
  // 못 읽는 상태를 없애야 했다). 스캐너는 이제 그 키를 **아예 안 적는다** — 같은 뜻을
  // 두 곳에 적으면 언젠가 한쪽만 바뀐다.
  //
  // ⚠ 핀을 **지운 게 아니라 옮겼다.** 새 자리는 아래 두 개다:
  //   · 「셀 표면 검출은 **디코더 기본값**으로 켜져 있다」
  //   · 「포스터 TL 이 **기본 옵션 디코더**로 복호된다」
  //   둘 다 `test/print-poster-v0.test.js` 에 있다 — 거동으로 재야 하는 명제라
  //   렌더 파이프라인이 필요하고, 이 파일(사전 완전성)에 두면 자리가 안 맞는다.
  //   지우면서 «기본값이니까 괜찮다» 로 넘어가면, 기본값이 되돌아가는 날 아무도 못 잡는다.
  assert.match(SCANNER_JS, /enableLocatorY:\s*isLabPath\(\)/);
  assert.match(SCANNER_JS, /family:\s*\{\s*cube:\s*\{\s*enableLocatorY:/);
  assert.doesNotMatch(SCANNER_JS, /enableLocatorY:\s*true/);
  // 스캐너가 셀표면 축을 **다시 명시하지 않는다** — 기본값이 유일한 정본이다.
  assert.doesNotMatch(SCANNER_JS, /enableCellSurfaceY:/);
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
