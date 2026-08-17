/**
 * generator-help-capacity.test.js — 화면 문구에 적힌 **용량 수치를 정본 함수로 대조**한다.
 *
 * 왜 필요한가: 2026-08-16 적대 검증이 g906 의 «n=21 세 후보는 담을 수 있는 양이 서로
 * 같아요 (L 94 · M 79 · H 63 B)» 를 반증했다. 원인은 측정 실수 하나다 —
 *
 *     capacityForCellSurfaceFinal(n, level = 'M', tones = 2, id = undefined)
 *
 * 의 네 번째 인자 `id` 를 **생략하면** `finalLayoutIdForN(21)` → `'v2r2'` 로 해소된다.
 * 세 후보를 «각각» 잰다고 부른 세 번의 호출이 전부 v2r2 를 잰 것이었고, 그래서 셋이
 * 같게 나왔다. 같아 보이는 세 숫자가 나오면 그것 자체가 «자를 잘못 댔다» 는 신호였는데
 * 그대로 3언어 사전에 실려 출고됐다.
 *
 * 이 테스트가 막는 것은 두 가지다:
 *   ① 정본 함수를 **id 를 넘겨** 다시 재서 12값(n=21 네 후보 × L/M/H)을 핀으로 박는다.
 *      («왜 문구가 저 숫자인가» 의 답이 코드 안에 있게 된다.)
 *   ② 사전 문구에서 숫자를 **파싱해** 그 핀과 대조한다. 한쪽만 고치면 여기서 깨진다.
 *
 * 대상은 «점유 셀 수 + 최대 payload» 뿐이다. 로케이터 셀 수는 문구가 이미 틀린 적이
 * 있어서(g546 «65셀», 정본 74) 같이 고정한다.
 *
 * v0xq 편입 (2026-08-17): 이 후보만 **점유 ≠ 파인더**다 — 중앙 QR 슬롯 81셀이 파인더도
 * 데이터도 아닌 제3 역할로 빠진다. 파인더 셀만 보면 42 로 가장 작은데 용량은 넷 중 가장
 * 작다(L 80 B). 즉 «파인더 셀이 적다 → 용량이 크다» 라는 기존 문구의 추론이 v0xq 에서
 * 뒤집힌다. 그래서 파인더 수와 슬롯 수를 **따로** 파싱해 대조한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  capacityForCellSurfaceFinal,
  cellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdForN,
  wirePreferredFinalLayoutIdForN,
  locatorCellsCellSurfaceFinal,
  slotCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');
// ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): ko/en/ja → 8언어.
//   숫자는 언어를 타지 않으므로 이 목록을 늘리면 새 언어 사전도 같은 자로 재진다.
const LANGS = ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt'];
const LEVELS = ['L', 'M', 'H'];

// ⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장): 숫자 옆에 오는 «단위 낱말» 은
//   언어마다 다르다. 정규식에 언어별 낱말을 박아 두면 새 언어가 붙을 때마다 조용히
//   통과해 버리므로(= 아무 것도 안 재는 패턴), 낱말을 여기 한 곳에 모아 둔다.
//   낱말이 빠지면 그 언어 줄은 «못 찾았다» 로 **실패**한다 — 그게 의도다.
const CELL_WORDS = '셀|cells?|セル|cellules?|celle|Zellen|celdas?|células?';
/** «파인더 N셀» 을 라벨에 결합해 찾을 때의 앵커 낱말 (숫자까지 14자 이내). */
const FINDER_WORDS = '파인더|finder|ファインダ|motif|pattern|Suchmuster|patrón|padrão';
/** «슬롯 N셀» 앵커. */
const SLOT_WORDS = '슬롯|slot|スロット|emplacement|ranura|ranhura';
/** «데이터 N» 앵커 (뒤에 숫자가 오는 형태). */
const DATA_WORDS = '데이터|データ|données|dati|Daten|datos|dados';

function langBlock(lang) {
  const start = INDEX.indexOf('const GENERATOR_STRINGS = {');
  assert.ok(start >= 0, 'GENERATOR_STRINGS 를 못 찾았다');
  const at = INDEX.indexOf(`  ${lang}: {`, start);
  assert.ok(at > start, `${lang} 사전을 못 찾았다`);
  const open = INDEX.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < INDEX.length; i += 1) {
    if (INDEX[i] === '{') depth += 1;
    else if (INDEX[i] === '}') {
      depth -= 1;
      if (depth === 0) return INDEX.slice(open, i + 1);
    }
  }
  throw new Error(`${lang} 사전이 닫히지 않는다`);
}

function entry(lang, key) {
  const m = new RegExp(`"${key}": "((?:[^"\\\\]|\\\\.)*)"`).exec(langBlock(lang));
  assert.ok(m, `${lang} 에 ${key} 가 없다`);
  return m[1];
}

/** id 를 **반드시** 넘겨서 잰다 — 생략이 바로 이번 사고의 원인이다. */
const payload = (n, id) => LEVELS.map(
  (level) => capacityForCellSurfaceFinal(n, level, 2, id).maxPayloadBytes,
);

// ── ① 정본 실측 핀 ────────────────────────────────────────────────────────

test('n=21 «id 생략» 은 와이어 선호(v2r2)로 해소된다 — 후보 전부를 하나로 뭉갠다', () => {
  // **의도적 갱신 «드랍 정본화» (2026-08-16)** — v2r2·v1r2 를 검출 라인업에서
  // 내리면서 `finalLayoutIdForN(21)` 은 v0x 가 됐다. 하지만 이 테스트가 재는 사고는
  // «용량 헬퍼에 id 를 안 넘기면 무엇으로 해소되나» 이고, 그 기본값은 라인업이
  // 아니라 **와이어 선호**(`wirePreferredFinalLayoutIdForN`)로 고정했다 —
  // 드랍이 발행된 프레임의 용량 회계를 조용히 바꾸면 안 되기 때문이다.
  // 그래서 «id 생략 = v2r2» 라는 사고 자체는 그대로 살아 있고, 여기서 계속 잡는다.
  //
  // **의도적 갱신 «v0X 드랍» (2026-08-17, 판정 3라운드)** — 라인업 기본이
  // v0x → **v0w** 로 승계됐다. 이 테스트가 잡는 사고(«id 생략 = 와이어 선호»)는
  // 그대로고, 두 값이 **서로 다르다**는 사실 자체가 이 테스트의 전제라 함께 재산한다.
  // **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (2026-08-17)** — 라인업 기본이
  // v0w → **v0t** 로 승계됐다. 이 테스트가 잡는 사고(«id 생략 = 와이어 선호»)는
  // 그대로다 — 와이어 선호는 여전히 v2r2 고, 두 값이 서로 다르다.
  assert.equal(wirePreferredFinalLayoutIdForN(21), 'v2r2');
  assert.equal(finalLayoutIdForN(21), 'v0t', '라인업 기본은 v0W 계열 드랍 뒤 v0t 다');
  assert.notEqual(wirePreferredFinalLayoutIdForN(21), finalLayoutIdForN(21),
    '와이어 선호와 라인업 기본이 같아졌다 — 이 테스트의 전제가 사라졌다');
  // id 를 생략한 호출은 후보와 무관하게 전부 같은 값이 된다. 이것이 «세 후보 용량
  // 동일» 이라는 거짓 결론의 기계적 원인이다 — 재현해서 남겨 둔다.
  const omitted = LEVELS.map((level) => capacityForCellSurfaceFinal(21, level).maxPayloadBytes);
  assert.deepEqual(omitted, payload(21, 'v2r2'));
  assert.notDeepEqual(omitted, payload(21, 'v0x'), 'id 를 넘기면 값이 달라져야 한다');
  assert.notDeepEqual(omitted, payload(21, 'v1r2'), 'id 를 넘기면 값이 달라져야 한다');
  assert.notDeepEqual(omitted, payload(21, 'v0xq'), 'id 를 넘기면 값이 달라져야 한다');
  // v0W 프로그램 편입 후에도 같은 사고가 같은 방식으로 잡힌다 (후보 4→6).
  // v0X 드랍 뒤에도 마찬가지다 — 드랩은 용량 회계를 한 자리도 안 바꿋다.
  assert.notDeepEqual(omitted, payload(21, 'v0w'), 'id 를 넘기면 값이 달라져야 한다');
  assert.notDeepEqual(omitted, payload(21, 'v0wq'), 'id 를 넘기면 값이 달라져야 한다');
  // v0T 편입 뒤에도 마찬가지다 (2026-08-17) — 새 활성 둘도 와이어 선호와 다르다.
  assert.notDeepEqual(omitted, payload(21, 'v0t'), 'id 를 넘기면 값이 달라져야 한다');
  assert.notDeepEqual(omitted, payload(21, 'v0ty'), 'id 를 넘기면 값이 달라져야 한다');
});

test('n=21 네 후보의 로케이터 셀 수와 최대 payload (L/M/H) 실측 핀', () => {
  const expected = {
    v0x: { cells: 65, payload: [96, 81, 65], symbols: 115 },
    // v0xq 의 `cells` 는 **파인더만** 이다 (locatorCellsCellSurfaceFinal 의 정의).
    // 중앙 QR 슬롯 81셀은 파인더가 아니라 제3 역할이라 여기 안 들어가고, 대신 아래
    // 슬롯 핀에서 따로 잰다 — 둘을 합쳐 «123셀 파인더» 라고 부르면 거짓말이 된다.
    v0xq: { cells: 42, payload: [80, 67, 54], symbols: 96 },
    v1r2: { cells: 80, payload: [92, 77, 62], symbols: 110 },
    v2r2: { cells: 74, payload: [94, 79, 63], symbols: 112 },
  };
  for (const [id, want] of Object.entries(expected)) {
    assert.equal(locatorCellsCellSurfaceFinal(21, id).length, want.cells, `${id} 셀 수`);
    assert.deepEqual(payload(21, id), want.payload, `${id} L/M/H payload`);
    assert.equal(capacityForCellSurfaceFinal(21, 'L', 2, id).usedSymbols, want.symbols,
      `${id} 심볼 예산`);
    // 톤 수는 용량을 바꾸지 않는다 (문구가 톤을 안 나눠 적는 근거).
    assert.deepEqual(
      LEVELS.map((l) => capacityForCellSurfaceFinal(21, l, 3, id).maxPayloadBytes),
      want.payload, `${id}: 3톤이 2톤과 달라졌다`,
    );
  }
  // 넷은 «같지 않다». 점유(파인더 ∪ 슬롯)가 적을수록 심볼 예산이 크다 — 문구가 말하는 방향.
  assert.ok(expected.v0x.symbols > expected.v2r2.symbols);
  assert.ok(expected.v2r2.symbols > expected.v1r2.symbols);
  assert.ok(expected.v1r2.symbols > expected.v0xq.symbols);
  // 슬롯 없는 세 후보끼리의 폭은 L 기준 4 B 뿐이다 — «대용량» 류 부제를 못 쓰는 근거.
  assert.equal(expected.v0x.payload[0] - expected.v1r2.payload[0], 4);
  // v0xq 는 그 띠 밖이다. 파인더는 **가장 작은데**(42 < 65) 최종 용량은 **가장 작다** —
  // 슬롯 81셀이 파인더 셀 수만 보는 직관을 뒤집는다. 문구가 «점유» 로 말해야 하는 이유고,
  // 그 폭(L 기준 16 B)은 4 B 띠와 달리 사용자가 알아야 할 크기다.
  assert.ok(expected.v0xq.cells < expected.v0x.cells);
  assert.equal(expected.v0x.payload[0] - expected.v0xq.payload[0], 16);
  assert.equal(slotCellsCellSurfaceFinal(21, 'v0xq').length, 81);
  assert.equal(
    locatorCellsCellSurfaceFinal(21, 'v0xq').length + slotCellsCellSurfaceFinal(21, 'v0xq').length,
    123, 'v0xq 점유 = 파인더 42 + 슬롯 81',
  );
  // 슬롯은 v0xq 전용이다 — 나머지 후보에 생기면 위 4 B 띠 주장이 조용히 무너진다.
  for (const id of ['v0x', 'v1r2', 'v2r2']) {
    assert.equal(slotCellsCellSurfaceFinal(21, id).length, 0, `${id} 에 슬롯이 생겼다`);
  }
});

test('나머지 두 칸(v0@13 · v2r2@25)도 문구와 같은 자로 잰다', () => {
  assert.equal(locatorCellsCellSurfaceFinal(13, 'v0').length, 30);
  assert.deepEqual(payload(13, 'v0'), [29, 25, 20]);
  assert.deepEqual(payload(25, 'v2r2'), [145, 124, 99]);
  assert.equal(locatorCellsCellSurfaceFinal(25, 'v2r2').length, 74);
});

// ── ② 사전 문구 ↔ 실측 대조 ──────────────────────────────────────────────

test('g906 본문의 셀 수·payload 가 여덟 언어 모두 실측과 일치한다', () => {
  const rows = [
    { label: 'v0', n: 13, id: 'v0' },
    { label: 'v0X', n: 21, id: 'v0x' },
    // v0XQ 줄은 파인더 셀과 슬롯 셀을 **따로** 적는다 — 합계 하나만 적으면 «파인더가
    // 123셀» 로 읽힌다. 그래서 슬롯 수까지 파싱해 대조한다.
    { label: 'v0XQ', n: 21, id: 'v0xq' },
    { label: 'v1r2', n: 21, id: 'v1r2' },
    { label: 'v2r2', n: 21, id: 'v2r2' },
  ];
  for (const lang of LANGS) {
    const body = entry(lang, 'g906');
    for (const row of rows) {
      // «· v0X — 65셀 (n=21) · 96 / 81 / 65 B» 형태에서 그 줄만 뽑는다.
      // (라벨 뒤 공백까지 봐야 «· v0X » 가 «· v0XQ …» 를 집지 않는다.)
      const line = body.split('\\n').find((l) => l.trim().startsWith(`· ${row.label} `));
      assert.ok(line, `${lang}/g906: ${row.label} 줄이 없다`);
      const cells = locatorCellsCellSurfaceFinal(row.n, row.id).length;
      const slot = slotCellsCellSurfaceFinal(row.n, row.id).length;
      // 라벨 앵커 결합 (통합 렌즈 A) — 슬롯이 있는 행은 숫자가 «그 줄 어딘가에» 로는
      // 파인더↔슬롯 스왑을 못 잡는다 (스왑 돌연변이 초록 실증). 그 행만 라벨에 붙은
      // 숫자를 각각 재고, 슬롯 없는 행은 종전 형태를 유지한다 (라벨 표기가 없다).
      if (slot > 0) {
        assert.match(line, new RegExp(`(${FINDER_WORDS})[^0-9]{0,14}${cells}\\s*(${CELL_WORDS})|${cells}\\s*cells? of finder`, 'i'),
          `${lang}/g906 ${row.label}: 파인더 셀 수가 라벨 결합으로 실측(${cells})과 다르다`);
      } else {
        assert.match(line, new RegExp(`\\b${cells}\\s*(${CELL_WORDS})`),
          `${lang}/g906 ${row.label}: 셀 수가 실측(${cells})과 다르다`);
      }
      if (slot > 0) {
        assert.match(line, new RegExp(`(${SLOT_WORDS})[^0-9]{0,14}${slot}\\s*(${CELL_WORDS})|${slot}(-cell)`, 'i'),
          `${lang}/g906 ${row.label}: 슬롯 셀 수가 실측(${slot})과 다르다`);
      }
      const [L, M, H] = payload(row.n, row.id);
      assert.ok(line.includes(`${L} / ${M} / ${H} B`),
        `${lang}/g906 ${row.label}: payload 가 실측(${L} / ${M} / ${H})과 다르다`);
    }
    // v2r2 줄은 n=25 값도 같이 적는다.
    const v2 = body.split('\\n').find((l) => l.trim().startsWith('· v2r2 '));
    const [L25, M25, H25] = payload(25, 'v2r2');
    assert.ok(v2.includes(`${L25} / ${M25} / ${H25} B`),
      `${lang}/g906: n=25 payload 가 실측과 다르다`);
  }
});

test('«세 후보 용량 동일» 이라는 거짓 주장이 여덟 언어 모두에서 사라졌다', () => {
  const falseClaims = [
    /담을 수 있는 양이 서로 같아요/,
    /hold the same payload/i,
    /入るデータ量が同じです/,
    /용량으로는 갈리지 않아요/,
    /capacity does not separate them/i,
    /容量では差がつきません/,
  ];
  for (const lang of LANGS) {
    const body = entry(lang, 'g906');
    for (const claim of falseClaims) {
      assert.doesNotMatch(body, claim, `${lang}/g906: 거짓 주장이 남았다`);
    }
  }
  // 옛 수치 조합(94 / 79 / 63 이 «세 후보 공통» 으로 쓰이던 형태)도 함께 막는다.
  for (const lang of LANGS) {
    assert.doesNotMatch(entry(lang, 'g906'), /L 94 B/);
  }
});

// 이 레인이 §11-2b 로 «측정만 하고 안 고쳤다» 고 남겨 둔 두 수치다. 통합 레인에서
// 고쳤으므로 여기에 핀을 박는다 — 안 박으면 다음 세대 개정에서 똑같이 조용히 썩는다
// (+3 은 포맷 블록이 레거시 15셀이던 시절 값이었다. 현행 와이어는 18셀).
test('lab 로케이터 힌트의 «데이터 N» 이 정본 dataCells 와 일치한다 (8언어)', () => {
  const rows = [
    { key: 'g541', n: 13, id: 'v0' },
    { key: 'g603', n: 21, id: 'v0x' },
    { key: 'g605', n: 21, id: 'v0xq' },
    { key: 'g548', n: 21, id: 'v1r2' },
  ];
  for (const row of rows) {
    const data = dataCellsInScanOrderCellSurfaceFinal(row.n, row.id).length;
    // 정본 두 경로가 같은 답을 내는지 먼저 확인한다 — 자가 어긋나면 핀이 무의미하다.
    assert.equal(data, cellSurfaceFinal(row.n, row.id).declaredDataCells, `${row.id} dataCells`);
    for (const lang of LANGS) {
      const body = entry(lang, row.key);
      assert.match(body, new RegExp(`(${DATA_WORDS})\\s*${data}\\b|\\b${data} data\\b`),
        `${lang}/${row.key}: 데이터 셀 수가 정본(${data})과 다르다`);
    }
  }
  // 옛 값(레거시 15셀 시절)이 어느 언어에도 남아 있으면 안 된다.
  for (const lang of LANGS) {
    assert.doesNotMatch(entry(lang, 'g541'), /112/, `${lang}/g541: 옛 112 가 남았다`);
    assert.doesNotMatch(entry(lang, 'g548'), /334/, `${lang}/g548: 옛 334 가 남았다`);
  }
});

test('lab 로케이터 힌트 g546 의 셀 수가 정본과 일치한다', () => {
  // 기존 결함 — «65셀» 로 적혀 있었다. 정본은 74 이고, 같은 화면의 g906 이 74 를
  // 말하기 시작하면서 두 숫자가 나란히 모순됐다.
  const cells = locatorCellsCellSurfaceFinal(21, 'v2r2').length;
  assert.equal(cells, 74);
  for (const lang of LANGS) {
    const body = entry(lang, 'g546');
    assert.match(body, new RegExp(`${cells}\\s*(${CELL_WORDS})`),
      `${lang}/g546: v2r2 셀 수가 ${cells} 가 아니다`);
    assert.doesNotMatch(body, new RegExp(`65\\s*(${CELL_WORDS})`), `${lang}/g546: 옛 65셀 표기가 남았다`);
  }
});
