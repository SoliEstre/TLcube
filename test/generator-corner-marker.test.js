/**
 * generator-corner-marker.test.js — 코너 마커가 **생성기에서 나오는가** (UI 배선).
 *
 * ⚠ **의도적 갱신 (W2 C4, 2026-08-24)** — 이 파일은 #cornerMarkerSection(켬/끔
 * 2카드)을 재던 자였다. 검출기 3구역 개편으로 그 섹션이 소멸하고 O-CM/A-CM 이
 * 내곽/외곽 **seat 카드**로 흡수됐으므로 (finder-zone-ui.zoneCards() 유도 —
 * FINDER_TAXONOMY 가 유일 입력), 재는 대상을 seat 선택기로 재작성한다.
 * 인코더 계약(cornerMarker 옵션 키)은 그대로다 — buildConfig 가 seat 에서 파생한다.
 *
 * 2026-08-20 이전 상태: `encode(cornerMarker:true)` 는 되는데 생성기가 그 키를
 * **아예 안 넘겼다.** 즉 검출기를 배선해도 읽을 심볼을 만들 수 없었다.
 *
 * 이 파일은 생성기 표면만 잰다 (디코더 쪽은 decoder-corner-marker-wiring.test.js).
 * 고정하는 것:
 *   ① 내곽/외곽 구역·seat 카드 배선이 있고 i18n 8언어 사전이 다 있다
 *   ② `encodeOptsFor` 가 O·A 에서 cornerMarker 를 싣고 Y 에서는 안 싣는다
 *      — cfg 조립은 seat 파생이다
 *   ③ turnA 와 **상호배제** — 둘 다 켜도 encodeA 가 던지지 않는다
 *   ④ 상태 필드(innerSeat/outerSeat)가 lab 게이트(INTERNAL) 뒤에 있고 유도 options 다
 *   ⑤ 마커를 켠 O 심볼은 용량이 줄고 실제로 인코드된다 (불변)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createGeneratorState, GENERATOR_STATE_SCHEMA, exposedGeneratorStateKeys } from '../src/generator-state.js';
import { INNER_SEAT_OPTIONS, OUTER_SEAT_OPTIONS, zoneCards, cmqWireExists } from '../src/finder-zone-ui.js';
import { LAB_OUTER_FINDER_IDS } from '../src/lab-expected-axes.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('① seat 구역 UI 와 배선이 있고 i18n 8언어 사전이 다 있다', () => {
  // 구 섹션은 부재다 — 켬/끔 2카드로 돌아가면 3구역 개편이 되돌려진 것이다.
  assert.doesNotMatch(INDEX, /id="cornerMarkerSection"/, '구 섹션이 되살아났다');
  assert.doesNotMatch(INDEX, /data-cornermarker=/, '구 켬/끔 카드가 되살아났다');
  // 새 구역 — #finderSection 안 (한 제목 «검출기 선택» 아래 3구역).
  const finderSection = INDEX.slice(
    INDEX.indexOf('<div id="finderSection"'),
    INDEX.indexOf('id="rotationGuidance"'),
  );
  for (const id of ['finderInnerZone', 'innerSeatCards', 'innerSeatHint',
    'finderOuterZone', 'outerSeatCards', 'outerSeatHint']) {
    assert.ok(finderSection.includes('id="' + id + '"'),
      id + ' 가 #finderSection 안에 없다');
  }
  // 카드는 zoneCards() 유도로 지연 생성된다 — 빌더와 위임 배선이 있는가.
  assert.match(INDEX, /function ensureSeatCards\(\)/);
  assert.match(INDEX, /wireSeatCards\(els\.innerSeatCards, 'innerSeat'\);/);
  assert.match(INDEX, /wireSeatCards\(els\.outerSeatCards, 'outerSeat'\);/);
  // 아이콘 — 운영자 규약(턴A 때 «아이콘 포함해야됨»)을 유도 카드에도 적용한다:
  // 표현 매핑이 유도 카드 전부를 덮는지 로드 시 throw 로 잡는 줄이 있어야 한다.
  assert.match(INDEX, /seat 카드 표현 누락/);

  // 신규 키 (W2 블록 ① = g850-g859) + 이식된 기존 키가 8언어 전부에 있다.
  for (const key of ['g850', 'g851', 'g852', 'g853', 'g854', 'g855', 'g856', 'g857', 'g858',
    'g576', 'g577', 'g578', 'g579', 'g580']) {
    const count = INDEX.split('"' + key + '":').length - 1;
    assert.equal(count, 8, key + ' 사전 항목이 8개 언어에 다 있어야 한다 (현재 ' + count + ')');
  }
  // g580 오탈자 수리 확인 (2026-08-24) — «바깔때까지» 는 다시 나타나면 안 된다.
  assert.equal(INDEX.includes('바깔때까지'), false, 'g580 오탈자가 되살아났다');
});

test('①-b seat 카드 유도가 분류 정본·기대축과 정합한다', () => {
  const zones = zoneCards();
  assert.deepEqual(zones.inner.map((c) => c.id), ['none', 'o-cm', 'sagoae', 'H']);
  assert.deepEqual(zones.outer.map((c) => c.id), ['none', 'a-cm', 'v-cm', 'k-cm']);
  // 자리만 카드는 클릭 불가(ready=false)다 — sagoae 생성측 합성 렌더는 잔여.
  assert.equal(zones.inner.find((c) => c.id === 'sagoae').ready, false);
  // H (F-35 분류 2 · 생성 축 개통 2026-08-24) — 선택 가능 값이다 (cornerMarker
  // + markerTones 와이어). 판독 배선 전이라 카드 힌트(g871)가 경고를 든다.
  const hCard = zones.inner.find((c) => c.id === 'H');
  assert.equal(hCard.ready, true);
  assert.equal(INNER_SEAT_OPTIONS.includes('H'), true,
    'H 생성 축이 닫혔다 — 2026-08-24 운영자 지시(심볼 적용)의 회귀');
  for (const id of ['v-cm', 'k-cm']) {
    const card = zones.outer.find((c) => c.id === id);
    assert.equal(card.absent, true, id + ' 는 부재 카드여야 한다');
    assert.equal(card.ready, false, id + ' 는 클릭 불가여야 한다');
  }
  // 기대축 대조 — 시험판 축 ③(LAB_OUTER)은 seat 값을 전부 알아야 한다
  // (sagoae 의 lab 텔레메트리 키는 레거시 'daehan' — finder-taxonomy 주석).
  for (const id of [...INNER_SEAT_OPTIONS, ...OUTER_SEAT_OPTIONS]) {
    const labId = id === 'sagoae' ? 'daehan' : id;
    assert.ok(LAB_OUTER_FINDER_IDS.includes(labId),
      'LAB_OUTER_FINDER_IDS 에 ' + labId + ' 가 없다 — 기대축과 seat 유도가 어긋났다');
  }
  // CM+Q 와이어 존재 술어 (C2a 착지 상태) — 병용 잠금이 열려 있어야 한다.
  assert.equal(cmqWireExists('hex'), true);
  assert.equal(cmqWireExists('tri'), true);
  assert.match(INDEX, /cmqWireExists\(family\)/,
    'seat 잠금이 와이어 존재 술어를 안 쓴다 — 상수 잠금으로 돌아갔다');
});

test('② encodeOptsFor 가 O·A 에서만 cornerMarker 를 싣는다 — cfg 조립은 seat 파생', () => {
  // index.html 은 브라우저 모듈이라 여기서 import 할 수 없다. 소스 계약으로 잠근다 —
  // 「어느 분기에 있는가」가 이 검사의 대상이다.
  const opts = INDEX.slice(INDEX.indexOf('function encodeOptsFor'));
  const body = opts.slice(0, opts.indexOf('\n}\n'));
  const yBranch = body.slice(body.indexOf("cfg.type === 'Y'"), body.indexOf("cfg.type === 'A'"));
  assert.equal(yBranch.includes('cornerMarker'), false,
    'Type Y 분기에 cornerMarker 가 들어갔다 — Y 는 자기 로케이터 문법을 쓴다');
  assert.match(body, /cfg\.cornerMarker === true/,
    'cornerMarker 를 cfg 에서 읽는 줄이 없다 — UI 가 인코더에 안 닿는다');
  // cfg 조립: seat 파생 (W2 C4 · H 개통 2026-08-24) — O 는 내곽 o-cm **또는 H**
  // (H = o-cm 자리 + 심볼 톤), A 는 외곽 a-cm 이 켠다.
  assert.match(INDEX,
    /cornerMarker: \(type === 'O'\s*\n?\s*&& \(generatorState\.innerSeat === 'o-cm' \|\| generatorState\.innerSeat === 'H'\)\)\s*\|\| \(type === 'A' && generatorState\.outerSeat === 'a-cm'\)/,
    'cfg 조립이 seat 파생이 아니다 — 다른 타입에서 켜진 채 새어 나간다');
  // H 심볼 톤 — cornerMarker 파생과 같은 자리에서만, encode 계약(자리 없이 톤 불가)
  // 을 따라 실린다.
  assert.match(INDEX, /markerTones: type === 'O' && generatorState\.innerSeat === 'H'/,
    'markerTones 파생이 없다 — H 심볼이 인코더에 안 닿는다');
});

test('③ turnA 와 상호배제 — 인코더가 던지지 않는 조합만 만든다', () => {
  // encodeA 계약 확인: 둘 다 참이면 던진다.
  assert.throws(
    () => encodeA('x', { version: 1, eccLevel: 'M', cornerMarker: true, turnA: true }),
    '둘 다 참인데 안 던진다 — 상호배제 계약이 사라졌으면 UI 잠금 근거가 없어진다',
  );
  // UI 가 그 조합을 못 만드는가 (seat 핸들러가 turnA 를 끈다)
  assert.match(INDEX, /if \(generatorState\.outerSeat === 'a-cm'\) generatorState\.turnA = false;/,
    'seat 를 켤 때 turnA 를 끄는 줄이 없다');
  // turnA 카드 쪽 잠금도 seat 로 갈아탔는가
  assert.match(INDEX, /const locked = generatorState\.outerSeat === 'a-cm';/,
    'syncTurnAUi 잠금이 seat 를 안 본다');
  // encodeOptsFor 에서도 코너 마커가 먼저 이긴다 (저장·URL 로 옛 조합이 들어와도)
  const opts = INDEX.slice(INDEX.indexOf('function encodeOptsFor'));
  const cmAt = opts.indexOf('cfg.cornerMarker === true');
  const turnAt = opts.indexOf('cfg.turnA === true');
  assert.ok(cmAt >= 0 && turnAt >= 0 && cmAt < turnAt,
    'cornerMarker 분기가 turnA 보다 뒤에 있다 — 옛 조합이 들어오면 던지는 쪽으로 간다');
});

test('④ seat 상태 필드는 lab 게이트 뒤(INTERNAL)·유도 options 다', () => {
  const state = createGeneratorState();
  assert.equal(state.innerSeat, 'none', '기본값은 없음이어야 한다');
  assert.equal(state.outerSeat, 'none', '기본값은 없음이어야 한다');
  // 구 boolean 필드는 스키마에서 내렸다 (생성기 상태는 저장되지 않는다 —
  // 하위호환은 finder-selection.normalizeFinderQrState 의 이관이 진다).
  assert.equal('cornerMarker' in GENERATOR_STATE_SCHEMA, false,
    'cornerMarker 필드가 스키마에 남아 있다 — seat 이관이 안 끝났다');
  // options 는 유도 배열이다 (F-37 규약 — 손 목록 금지).
  assert.deepEqual([...GENERATOR_STATE_SCHEMA.innerSeat.options], [...INNER_SEAT_OPTIONS]);
  assert.deepEqual([...GENERATOR_STATE_SCHEMA.outerSeat.options], [...OUTER_SEAT_OPTIONS]);
  // 노출 대조를 **유도**한다 — 상수를 손으로 적으면 exposure 값 이름이 바뀔 때 썩는다.
  for (const mode of ['normal', 'advanced']) {
    for (const key of ['innerSeat', 'outerSeat']) {
      assert.equal(exposedGeneratorStateKeys(mode).includes(key), false,
        key + ' 가 ' + mode + ' 모드에 노출됐다 — 실기기 라운드를 아직 안 돌았다'
        + ' (운영자 확정 2026-08-23·24: lab 유지)');
    }
  }
});

test('⑤ 마커를 켠 O 심볼은 용량이 줄고 실제로 인코드된다', () => {
  const plain = encode('capacity probe', { version: 2, eccLevel: 'M' });
  const marked = encode('capacity probe', { version: 2, eccLevel: 'M', cornerMarker: true });
  assert.equal(marked.capacity.cornerMarker, true, '용량표가 마커 경로를 안 탄다');
  assert.equal(marked.capacity.name, 'V2CM', '마커 버전 이름이 안 붙었다');
  // 격자는 그대로고 **오버헤드만** 늘어야 한다 — 셀을 더 그리는 게 아니라
  // 데이터 셀을 마커로 «빌려 쓰는» 구조이기 때문이다.
  assert.equal(marked.capacity.totalCells, plain.capacity.totalCells,
    '마커가 격자 크기를 바꿨다 — 그러면 파인더 기하가 같이 흔들린다');
  assert.ok(marked.capacity.overhead > plain.capacity.overhead,
    '오버헤드가 안 늘었다 — 회계가 갈리지 않았다는 뜻이다'
    + ' (plain ' + plain.capacity.overhead + ' vs marked ' + marked.capacity.overhead + ')');
  assert.ok(marked.capacity.maxPayloadBytes < plain.capacity.maxPayloadBytes,
    '용량이 안 줄었다 (plain ' + plain.capacity.maxPayloadBytes
    + ' vs marked ' + marked.capacity.maxPayloadBytes + ')');
});
