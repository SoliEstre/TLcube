/**
 * finder-taxonomy.test.js — 파인더 3분류 재편 회귀 (2026-08-21).
 *
 * 잠그는 명제:
 *   ① 분류 배정은 코드 표에서 유도한다 (손 목록 금지).
 *   ② daehan → taegeuk + sagoae 가 표시·분류 층에서 갈리고, 원자 oak-daehan-k*
 *      는 와이어 합성이지 분류 1+2 를 한 id 가 붙잡지 않는다.
 *   ③ i18n 8개 언어를 유도로 센다 — 한 언어라도 taegeuk/sagoae 키가 빠지면 잡힌다.
 *   ④ 와이어 무회귀: formatIndex · 포맷 워드가 기존 발행값과 바이트 동일.
 *   ⑤ CM 은 파인더가 아니라 자리 예약. H2O 는 분류 3 확장 영역 파인더.
 *
 * 변이 검증: `daehanSplitHolds` 에 합성 항목을 분류 1+2 로 넣으면 false 가 되고,
 * 모듈 로드 자기검증이 그 상태를 거부한다. 실제 파일 변이는 verify 원문에 적는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LANGUAGES } from '../src/i18n.js';
import {
  FINDER_TAXONOMY, FINDER_CLASS, KIND_FINDER, KIND_SEAT, KIND_WIRE,
  SEAT_DEFAULT_FINDER, taxonomyByClass, taxonomyItem, daehanSplitHolds,
  taegeukEqualsCentralSlot,
} from '../src/finder-taxonomy.js';
import {
  DAEHAN_FINDER_PATTERN_IDS, DAEHAN_NAME, TAEGUK_ID, SAGOAE_ID,
  taegeukCells, sagoaeCells, daehanReservedCells, daehanPatternId,
} from '../src/finder-daehan.js';
import { FINDER_CELL_ORDER } from '../src/finder-patterns.js';
import { FINDER_CARD_GROUPS } from '../src/finder-card-ui.js';
import { oakCandidate, liveOakCandidates } from '../src/finder-oak-lineup.js';
import { GENERATOR_TYPES } from '../src/generator-state.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { encodeReplicated, ECC_LEVEL } from '../src/formatinfo.js';
import { MARKER_G_FORMAT_INDEX, markerGSpec } from '../src/markerG.js';
import { MARKER_CELL_COUNT_K } from '../src/markerK.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');

test('① 분류 배정은 표에서 유도 — 손 목록과 불일치하면 실패', () => {
  const formalIds = FINDER_CARD_GROUPS.formal.map((d) => d.id);
  assert.equal(formalIds.length, 4);
  for (const id of formalIds) {
    const row = taxonomyItem(id);
    assert.ok(row, id + ' 가 분류 표에 없다');
    assert.equal(row.class, 1, id + ' 가 분류 1 이 아니다');
    assert.equal(row.kind, KIND_FINDER);
  }
  // live A/K 후보는 분류 3 (finderMode 로 분류 1 에 넣지 않는다)
  for (const cand of liveOakCandidates().filter((e) => e.type === 'A' || e.type === 'K')) {
    const row = taxonomyItem(cand.id);
    assert.ok(row, cand.name + ' 가 분류 표에 없다');
    assert.equal(row.class, 3, cand.name + ' 가 분류 3 이 아니다 — finderStarter 오독?');
    assert.equal(row.kind, KIND_FINDER);
  }
  assert.equal(taxonomyItem(oakCandidate('H2O').id).coordBasis, '꼭짓점');
  assert.equal(taxonomyItem('central-v0').class, 1, 'F-34 — 비컨이 분류 1 에 등재돼야 한다 (C1 편입)');
  // v-cm — 실체 전환 (2026-08-24): 구 락(class 'U' 단언)을 양성 단언으로.
  assert.equal(taxonomyItem('v-cm').class, 3, 'v-cm 이 분류 3 자리 예약이 아니다');
  assert.equal(taxonomyItem('v-cm').kind, KIND_SEAT);
  // k-cm — 실체 전환 (2026-08-24): 구 락(class 'U' 단언)을 양성 단언으로.
  assert.equal(taxonomyItem('k-cm').class, 3, 'k-cm 이 분류 3 자리 예약이 아니다');
  assert.equal(taxonomyItem('k-cm').kind, KIND_SEAT);
  assert.equal(taxonomyItem('k-cm').cells, String(MARKER_CELL_COUNT_K));
  // ⚠ **의도적 갱신 (2026-08-25)** — 생성기 타입에 K 가 편입됐다 (⑤ 잔여 해소).
  // 구 락은 `deepEqual(GENERATOR_TYPES, ['O','A','Y'])` 로 «화면 없음» 을 잠갔었다.
  // 이제 양성 단언으로 뒤집는다: K 는 목록에 **있고**, 목록의 정의는 한 곳
  // (generator-types.js)이며, 그 안에 파생 내부 타입(G·V)은 **없다**.
  assert.ok(GENERATOR_TYPES.includes('K'), '생성기 타입에서 K 가 빠졌다 — 편입이 되돌아갔나');
  assert.deepEqual([...GENERATOR_TYPES], ['O', 'A', 'Y', 'K']);
  for (const derived of ['G', 'V']) {
    assert.ok(!GENERATOR_TYPES.includes(derived),
      derived + ' 가 생성기 타입에 들었다 — 자리·옵션에서 유도되는 파생 타입이지 카드 축이 아니다');
  }
});

test('② daehan 분리 — taegeuk 분류1 · sagoae 분류2 · 원자는 와이어 합성', () => {
  assert.equal(TAEGUK_ID, 'taegeuk');
  assert.equal(SAGOAE_ID, 'sagoae');
  assert.notEqual(TAEGUK_ID, DAEHAN_NAME);
  assert.notEqual(SAGOAE_ID, DAEHAN_NAME);
  assert.equal(taegeukEqualsCentralSlot, true);
  assert.equal(taegeukCells().length, 19);
  const slot = new Set(FINDER_CELL_ORDER.map((c) => c.q + ',' + c.r));
  const inner = new Set(taegeukCells().map((c) => c.q + ',' + c.r));
  assert.equal(inner.size, slot.size);
  for (const k of inner) assert.ok(slot.has(k), 'taegeuk 좌표 ' + k + ' 가 슬롯에 없다');

  for (const k of [6, 8, 10]) {
    assert.equal(sagoaeCells(k).length, daehanReservedCells(k).length);
    assert.equal(daehanPatternId(k), 'oak-daehan-k' + k);
  }
  assert.deepEqual([...DAEHAN_FINDER_PATTERN_IDS], ['oak-daehan-k6', 'oak-daehan-k8', 'oak-daehan-k10']);

  const taegeuk = taxonomyItem(TAEGUK_ID);
  const sagoae = taxonomyItem(SAGOAE_ID);
  assert.equal(taegeuk.class, 1);
  assert.equal(taegeuk.kind, KIND_FINDER);
  assert.equal(sagoae.class, 2);
  assert.equal(sagoae.kind, KIND_FINDER);
  assert.equal(sagoae.innerSplit, '중심부 기준');

  for (const id of DAEHAN_FINDER_PATTERN_IDS) {
    const row = taxonomyItem(id);
    assert.equal(row.class, 'W', id + ' 가 와이어 합성이 아니다');
    assert.equal(row.kind, KIND_WIRE);
  }
  assert.equal(daehanSplitHolds(), true);
  assert.equal(FINDER_TAXONOMY.some((r) => r.class === '1+2'), false,
    '원자 id 가 분류 1+2 를 다시 붙잡고 있다');
  // 카드는 합성 한 장 — 와이어 id 유지
  assert.deepEqual(FINDER_CARD_GROUPS.daehan.map((d) => d.id), ['oak-daehan-k10']);
});

test('② 변이 — 분리를 되돌리면 daehanSplitHolds 가 false', () => {
  const mutated = FINDER_TAXONOMY.map((r) => {
    if (r.id === 'oak-daehan-k10') {
      return { ...r, class: '1+2', kind: KIND_FINDER };
    }
    return r;
  }).filter((r) => r.id !== TAEGUK_ID && r.id !== SAGOAE_ID);
  assert.equal(daehanSplitHolds(mutated), false,
    '분리를 되돌려도 회귀가 안 빨개진다 — 불변식이 약하다');
  assert.equal(daehanSplitHolds(FINDER_TAXONOMY), true);
});

test('③ i18n 8개 언어를 유도로 센다 — taegeuk/sagoae 가 한 언어라도 빠지면 실패', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 8,
    'SUPPORTED_LANGUAGES 가 8이 아니다: ' + SUPPORTED_LANGUAGES.join(','));
  assert.deepEqual(
    [...SUPPORTED_LANGUAGES],
    ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt'],
  );

  // 생성기 사전: 언어 블록을 소스에서 유도해 센다.
  const langBlocks = [];
  const re = /["']?(ko|en|ja|fr|it|de|es|pt)["']?\s*:\s*\{/g;
  let m;
  while ((m = re.exec(INDEX))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < INDEX.length; i += 1) {
      if (INDEX[i] === '{') depth += 1;
      else if (INDEX[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          langBlocks.push({ lang: m[1], body: INDEX.slice(open, i + 1) });
          break;
        }
      }
    }
  }
  const generatorDicts = langBlocks.filter((b) => b.body.includes('"g569"') || b.body.includes("'g569'"));
  const langsWithG569 = [...new Set(generatorDicts.map((b) => b.lang))];
  assert.equal(langsWithG569.length, SUPPORTED_LANGUAGES.length,
    'g569 가 있는 언어 수가 8이 아니다: ' + langsWithG569.join(','));
  for (const lang of SUPPORTED_LANGUAGES) {
    const block = generatorDicts.find((b) => b.lang === lang);
    assert.ok(block, lang + ' 생성기 사전에 g569 블록이 없다');
    for (const key of ['g569', 'g570', 'g571']) {
      assert.ok(block.body.includes(key), lang + ' 에 ' + key + ' 가 없다');
    }
    assert.ok(block.body.includes('taegeuk'), lang + ' g569 계열에 taegeuk 이 없다');
    assert.ok(block.body.includes('sagoae'), lang + ' g569 계열에 sagoae 가 없다');
  }

  // 스캐너 사전: 객체 키에서 유도.
  const scannerLangs = Object.keys(SCANNER_STRINGS);
  assert.equal(scannerLangs.length, SUPPORTED_LANGUAGES.length,
    '스캐너 언어 수가 8이 아니다: ' + scannerLangs.join(','));
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.ok(SCANNER_STRINGS[lang], lang + ' 스캐너 사전이 없다');
    const outer = SCANNER_STRINGS[lang]['lab.expectedOuter.daehan'];
    const toggle = SCANNER_STRINGS[lang]['lab.daehan.toggle'];
    assert.ok(typeof outer === 'string' && outer.length > 0, lang + ' expectedOuter.daehan 빈값');
    assert.ok(typeof toggle === 'string' && toggle.length > 0, lang + ' daehan.toggle 빈값');
    assert.ok(outer.includes('sagoae') || toggle.includes('sagoae') || toggle.includes('taegeuk'),
      lang + ' 스캐너 라벨에 sagoae/taegeuk 이 없다: ' + outer + ' / ' + toggle);
  }
});

test('④ 와이어 무회귀 — daehanFinder 가 formatIndex·포맷 워드를 안 바꾼다', () => {
  const text = 'TL';
  for (const [version, index] of [[1, 0], [2, 1], [3, 2]]) {
    const plain = encode(text, { version, eccLevel: 'M' });
    const daehan = encode(text, { version, eccLevel: 'M', daehanFinder: true });
    const want = encodeReplicated({ version: index, eccLevel: ECC_LEVEL.M }).flat();
    assert.deepEqual(Array.from(plain.formatDigits), want,
      'O V' + version + ' 레거시 포맷 워드가 움직였다');
    assert.deepEqual(Array.from(daehan.formatDigits), Array.from(plain.formatDigits),
      'O V' + version + 'D 포맷 워드가 레거시와 다르다 — formatIndex 가 갈렸다');
    assert.equal(daehan.daehanFinder, true);
    assert.equal(daehan.k, plain.k);
  }
  for (const [version, index] of [[0, 1], [1, 12], [2, 13]]) {
    const plain = encodeA(text, { version, eccLevel: 'M' });
    const daehan = encodeA(text, { version, eccLevel: 'M', daehanFinder: true });
    assert.equal(plain.formatIndex, index, 'A' + version + ' 레거시 formatIndex 가 움직였다');
    assert.equal(daehan.formatIndex, plain.formatIndex,
      'A' + version + 'D formatIndex 가 레거시와 다르다');
  }
  // G 자리 예약 인덱스도 이 패치에서 안 움직인다.
  for (const spec of [[1, 6], [2, 0], [3, 1]]) {
    const encoded = encode('TL', { version: spec[0], eccLevel: 'M', cornerMarker: true });
    assert.equal(encoded.capacity.formatIndex, spec[1],
      'V' + spec[0] + 'CM formatIndex 가 ' + spec[1] + ' 이 아니다');
    assert.equal(markerGSpec('hex', spec[0]).formatIndex, spec[1]);
  }
  // **의도적 갱신 (C2a, 2026-08-23)**: CMQ 6칸 추가 — 6 → 12. CM 쪽 값(위 3단언)은
  // 한 자리도 안 움직였다 — 그게 이 테스트의 원 주장이고 그대로 참이다.
  assert.equal(MARKER_G_FORMAT_INDEX.length, 12);
});

test('⑤ CM 격하 · H2O 는 확장 영역 파인더 · 자리의 기본 파인더', () => {
  assert.equal(SEAT_DEFAULT_FINDER['a-cm'], 'H2O');
  assert.equal(SEAT_DEFAULT_FINDER['o-cm'], 'H');
  // **양성 전환 (2026-08-24 NO2 편입)** — 종전 이 자리에는 «v-cm 도 H2O» 라는
  // 잠정 락이 모듈 로드 자기검증에 있었다. V 자리의 자기 심볼이 생겨 그 락을
  // 양성 단언으로 뒤집는다 (배타 개설 정형 3단 ③). a-cm 의 H2O 는 그대로다.
  assert.equal(SEAT_DEFAULT_FINDER['v-cm'], 'NO2');
  const no2 = taxonomyItem('NO2');
  assert.equal(no2.class, 3, 'NO2 는 분류 3 (VAK 확장 영역 · 꼭짓점 기준)');
  assert.equal(no2.kind, KIND_FINDER, 'NO2 는 심볼이지 자리가 아니다');
  assert.ok(no2.renderPath.includes('finder-NO2'), 'NO2 renderPath 가 정본 모듈을 안 가리킨다');
  const vcm = taxonomyItem('v-cm');
  assert.equal(vcm.kind, KIND_SEAT);
  assert.ok(vcm.note.includes('기본 파인더=NO2'), 'v-cm 행이 기본 심볼 전환을 안 적는다');
  const ocm = taxonomyItem('o-cm');
  const acm = taxonomyItem('a-cm');
  assert.equal(ocm.kind, KIND_SEAT);
  assert.equal(ocm.class, 2);
  assert.equal(ocm.innerSplit, '꼭짓점 기준');
  assert.equal(acm.kind, KIND_SEAT);
  assert.equal(acm.class, 3);
  const h = taxonomyItem('H');
  // F-35 (2026-08-24 코드 반영): H = 분류 2 — O-CM 자리(육각 경계 12셀) 심볼.
  // renderable 은 H2O 규약대로 false (인코더 톤 표는 실재·화면 축 미배선).
  assert.equal(h.class, 2);
  assert.equal(h.kind, KIND_FINDER);
  assert.equal(h.renderable, false);
  assert.ok(h.renderPath.includes('finder-H'), 'H renderPath 가 finder-H 정본을 안 가리킨다');
  const h2o = taxonomyItem(oakCandidate('H2O').id);
  assert.ok(h2o.note.includes('기준선'), 'H2O 주석이 finderStarter 오독을 막지 않는다');
  assert.equal(h2o.class, 3);

  const class1 = taxonomyByClass(1).map((r) => r.id);
  const class2 = taxonomyByClass(2).map((r) => r.id);
  const class3 = taxonomyByClass(3).map((r) => r.id);
  assert.ok(class1.includes(TAEGUK_ID));
  assert.ok(class2.includes(SAGOAE_ID));
  assert.ok(class2.includes('o-cm'));
  assert.ok(class2.includes('H'), 'F-35: H 는 분류 2 (O-CM 자리) — 분류 3 은 폐기된 문장');
  assert.equal(class3.includes('H'), false);
  assert.ok(class3.includes('a-cm'));
  assert.ok(class3.includes(oakCandidate('H2O').id));
  assert.ok(class3.includes(oakCandidate('H2CO3').id));
  assert.ok(FINDER_CLASS[1].length > 0);
});
