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
  // **의도적 갱신 (2026-08-26)** — innerSeatHint 는 목록에서 빠졌다. 3줄짜리 g579 가
  // «?»(help-dot)로 갔기 때문이다 (운영자 «두 줄 넘어가는 설명은 ?버튼으로»).
  // 구역이 설명을 **갖고 있는가** 는 그대로 잰다 — 자리만 문단에서 버튼으로 옮겼다.
  for (const id of ['finderInnerZone', 'innerSeatCards',
    'finderOuterZone', 'outerSeatCards']) {
    assert.ok(finderSection.includes('id="' + id + '"'),
      id + ' 가 #finderSection 안에 없다');
  }
  // 두 구역은 **대칭**이어야 한다 — 한쪽만 «?» 면 서로 다른 종류의 컨트롤로 읽힌다.
  // (처음엔 내곽만 옮겼다. 한국어에선 외곽 힌트가 2줄이라 규칙에 안 걸렸고,
  //  8언어로 다시 재서야 독일어 3줄이 드러났다 — 한 언어는 계약이 아니다.)
  for (const key of ['g579', 'g858']) {
    assert.ok(finderSection.includes('data-help="' + key + '"'),
      `자리 설명(${key})이 #finderSection 안에 없다 — 문단도 «?» 도 없으면 설명이 사라진 것이다`);
  }
  // 카드는 zoneCards() 유도로 지연 생성된다 — 빌더와 위임 배선이 있는가.
  assert.match(INDEX, /function ensureSeatCards\(\)/);
  assert.match(INDEX, /wireSeatCards\(els\.innerSeatCards, 'innerSeat'\);/);
  assert.match(INDEX, /wireSeatCards\(els\.outerSeatCards, 'outerSeat'\);/);
  // 아이콘 — 운영자 규약(턴A 때 «아이콘 포함해야됨»)을 유도 카드에도 적용한다:
  // 표현 매핑이 유도 카드 전부를 덮는지 로드 시 throw 로 잡는 줄이 있어야 한다.
  assert.match(INDEX, /seat 카드 표현 누락/);

  // 신규 키 (W2 블록 ① = g850-g859 · 턴A 레인 블록 = g875-g876) + 이식된 기존 키가
  // 8언어 전부에 있다 (카운트 단언 — 브리프 §3.4).
  for (const key of ['g850', 'g851', 'g852', 'g853', 'g854', 'g855', 'g856', 'g857', 'g858',
    'g875', 'g876',
    'g576', 'g577', 'g578', 'g579', 'g580']) {
    const count = INDEX.split('"' + key + '":').length - 1;
    assert.equal(count, 8, key + ' 사전 항목이 8개 언어에 다 있어야 한다 (현재 ' + count + ')');
  }
  // g580 오탈자 수리 확인 (2026-08-24) — «바깔때까지» 는 다시 나타나면 안 된다.
  assert.equal(INDEX.includes('바깔때까지'), false, 'g580 오탈자가 되살아났다');
});

test('①-b seat 카드 유도가 분류 정본·기대축과 정합한다', () => {
  const zones = zoneCards();
  // H 는 카드가 아니다 (운영자 2026-08-24 확정 2차) — o-cm 선택이 곧 «자리 + H
  // 심볼» 이다 (A-CM=H2O 문법). 별도 카드·별도 상태 값이 다시 생기면 회귀다.
  assert.deepEqual(zones.inner.map((c) => c.id), ['none', 'o-cm', 'sagoae']);
  assert.deepEqual(zones.outer.map((c) => c.id), ['none', 'a-cm', 'v-cm', 'k-cm']);
  // sagoae 는 기존 daehan 예약 회계/formatIndex 공유 + C2c 합성 왕복이 서서
  // 구 `ready:false` 락이 양성 카드 단언으로 뒤집혔다.
  assert.equal(zones.inner.find((c) => c.id === 'sagoae').ready, true);
  assert.equal(INNER_SEAT_OPTIONS.includes('H'), false,
    'H 가 상태 값으로 되살아났다 — o-cm 통합(2026-08-24)의 회귀');
  // v-cm · k-cm — 실체 전환 (2026-08-24, 배타 개설 정형 ③): 부재 카드 단언(구 락)을
  // 양성 단언으로. 둘 다 이제 부재가 아니다 — 부재 카드는 하나도 안 남았다.
  {
    const vcm = zones.outer.find((c) => c.id === 'v-cm');
    assert.equal(vcm.absent, false, 'v-cm 이 아직 부재 카드다 — 2026-08-24 실체 전환 회귀');
    assert.equal(vcm.ready, true, 'v-cm 이 클릭 불가다');
    assert.deepEqual([...vcm.types], ['A'], 'v-cm 은 Type A(×turnA) 전용이다');
    const kcm = zones.outer.find((c) => c.id === 'k-cm');
    assert.equal(kcm.absent, false, 'k-cm 이 아직 부재 카드다 — 2026-08-24 실체 전환 회귀');
    assert.equal(kcm.ready, true, 'k-cm 이 클릭 불가다');
    assert.deepEqual([...kcm.types], ['K'], 'k-cm 은 Type K 전용이다');
    // ⭐ **k-cm 상태값 개설 (2026-08-25)**. 이 자리는 자기가 터질 조건을 미리 적어
    // 뒀고 — 「K 가 편입되면 게이트가 걷히고, 그 순간 LAB_OUTER_FINDER_IDS 에 k-cm 이
    // 없다로 터진다」 — **정확히 그 순서로 일어났다**. 그래서 요구한 것을 먼저 했다:
    // 스캐너 기대축 등재(src/lab-expected-axes.js) + 버튼 + 8언어. 그 다음 이 락을
    // 양성으로 뒤집는다. 아래 전수 루프가 이제 k-cm 을 **실제로** 검사한다.
    assert.equal(OUTER_SEAT_OPTIONS.includes('k-cm'), true,
      'k-cm 이 상태 값에서 빠졌다 — 카드는 서는데 클릭이 상태에 안 실린다');
    assert.equal(zones.outer.some((c) => c.absent), false, '부재 카드가 남아 있다');
  }
  // 기대축 대조 — 시험판 축 ③(LAB_OUTER)은 seat 값을 전부 알아야 한다
  // (sagoae 의 lab 텔레메트리 키는 레거시 'daehan' — finder-taxonomy 주석).
  // ⚠ v-cm 제외 (2026-08-24): 스캐너 기대축 등재는 sites/tlscan 버튼 + 8언어
  // 동반이라 **통합자 몫**이다 (턴A 레인은 스캐너 소스 접촉 금지). 등재되면
  // 아래 부재 단언이 터진다 — 그때 이 제외를 걷어라 (부재에는 이유·날짜).
  for (const id of [...INNER_SEAT_OPTIONS, ...OUTER_SEAT_OPTIONS]) {
    const labId = id === 'sagoae' ? 'daehan' : id;
    assert.ok(LAB_OUTER_FINDER_IDS.includes(labId),
      'LAB_OUTER_FINDER_IDS 에 ' + labId + ' 가 없다 — 기대축과 seat 유도가 어긋났다');
  }
  // v-cm 기대축 등재 완료 (2026-08-24 통합자) — 전수 대조가 v-cm 을 포함한다.
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
  // ⚠ Y 분기의 끝은 «A 분기의 시작» 이 아니라 **다음 타입 분기 어느 것이든**이다.
  // 종전 식은 타입이 셋이라 성립했고, 2026-08-25 에 K 분기가 Y 와 A 사이에 들어오자
  // K 의 주석이 «Y 분기» 로 딸려 들어와 거짓 경보가 났다. 타입이 늘어도 안 깨지게 바꾼다.
  const yStart = body.indexOf("cfg.type === 'Y'");
  const nextBranch = [...body.matchAll(/cfg.type === '[A-Z]'/g)]
    .map((m) => m.index).filter((i) => i > yStart);
  const yBranch = body.slice(yStart, nextBranch.length ? nextBranch[0] : body.length);
  assert.equal(yBranch.includes('cornerMarker'), false,
    'Type Y 분기에 cornerMarker 가 들어갔다 — Y 는 자기 로케이터 문법을 쓴다');
  assert.match(body, /cfg\.cornerMarker === true/,
    'cornerMarker 를 cfg 에서 읽는 줄이 없다 — UI 가 인코더에 안 닿는다');
  // cfg 조립: seat 파생 (W2 C4 · Wave 3 ④ 재편) — O 는 내곽 o-cm, A 는 외곽
  // 코너 자리가 방향과 짝일 때만 켠다: a-cm×정삼각 / v-cm×역삼각.
  // **의도적 갱신 (2026-08-25)** — K 절(k-cm)이 O 와 A 사이에 들어왔다. K 는 방향 축이
  // 없으므로(육각별은 turnA 가 성립 안 한다) 자리 하나로 끝난다.
  assert.match(INDEX,
    /cornerMarker: \(type === 'O' && generatorState\.innerSeat === 'o-cm'\)\s*\|\| \(type === 'K' && generatorState\.outerSeat === 'k-cm'\)\s*\|\| \(type === 'A' && \(\(generatorState\.outerSeat === 'a-cm' && generatorState\.turnA !== true\)\s*\|\| \(generatorState\.outerSeat === 'v-cm' && generatorState\.turnA === true\)\)\)/,
    'cfg 조립이 seat×방향 파생이 아니다 — 어긋난 상태가 던짐 조합으로 새어 나간다');
  // o-cm = 자리 + H 심볼 통합 (2026-08-24 확정 2차, A-CM=H2O 문법) — markerTones
  // 는 o-cm 과 함께만 실린다 (encode 계약: 자리 없이 톤 불가).
  assert.match(INDEX, /markerTones: type === 'O' && generatorState\.innerSeat === 'o-cm'/,
    'markerTones 파생이 없다 — o-cm 의 H 심볼 통합이 인코더에 안 닿는다');

  // ⚠ **단선 회귀 (2026-08-25, agy 검수 적발)** — `co2AnchorTones` 를 buildConfig 에만
  // 넣고 encodeOptsFor 에서 안 실어서, 정책은 계산되는데 인코더까지 못 갔다.
  // 생성기가 **항상 false 로 동작**했고 배포까지 나간 뒤에야 잡혔다.
  // 이 프로젝트에서 세 번째 같은 부류다(한 층에서 열고 소비자를 안 쓸었다) —
  // 그래서 «정책이 있다» 와 «전달된다» 를 **따로** 잠근다. 하나만 재면 또 샌다.
  assert.match(INDEX, /co2AnchorTones: type === 'A'/,
    'co2AnchorTones 정책이 cfg 조립에 없다');
  assert.match(INDEX, /if \(cfg\.co2AnchorTones === true\) opts\.co2AnchorTones = true;/,
    'co2AnchorTones 가 encodeOptsFor 에서 안 실린다 — 정책이 인코더에 안 닿는 단선이다');
});

test('③ turnA 상호배제의 재편 — a-cm 은 배제, v-cm(=turnA+CM) 은 개설이다', () => {
  // 2026-08-24 배타 개설 (정형 ③ — 구 «둘 다 참이면 던진다» 락의 전환):
  // turnA + cornerMarker 는 이제 V-CM 이다. 인코더가 V 표 말미 값으로 인코드된다.
  const vcm = encodeA('x', { version: 1, eccLevel: 'M', cornerMarker: true, turnA: true });
  assert.equal(vcm.formatIndex, 3, 'V1CM 의 formatIndex 가 V 표(3, k8)와 다르다');
  assert.equal(vcm.turnA, true);
  assert.equal(vcm.cornerMarker, true);
  // **의도적 갱신 (2026-08-24 검수 4차)** — V-CMQ 도 개설됐다 (운영자 «중앙 QR 일 때
  // V-CM 선택 가능해야 됨»). 새 칸을 만든 게 아니라 **V*CM 인덱스 공유**다 —
  // centerQr 는 셀 회계를 안 바꾸므로 두 해석이 같은 데이터를 낸다 (turnA.js
  // §turnASpec). 구 «던진다» 락은 그 공유를 재는 양성 단언으로 전환.
  const vcmq = encodeA('x', {
    version: 1, eccLevel: 'M', cornerMarker: true, turnA: true, centerQr: true,
  });
  assert.equal(vcmq.formatIndex, vcm.formatIndex,
    'V1CMQ 가 V1CM 과 다른 칸을 잡았다 — hex·tri (값,k) 는 48/48 로 꽉 차 있다');
  assert.equal(vcmq.centerQr, true);
  // UI 의 방향-자리 일관성 (Wave 3 ④): 자리를 고르면 방향이 확정되고,
  assert.match(INDEX, /if \(generatorState\.outerSeat === 'a-cm'\) generatorState\.turnA = false;/,
    'a-cm 선택이 방향(정삼각)을 확정하는 줄이 없다');
  assert.match(INDEX, /if \(generatorState\.outerSeat === 'v-cm'\) generatorState\.turnA = true;/,
    'v-cm 선택이 방향(역삼각)을 확정하는 줄이 없다');
  // 방향을 바꾸면 자리가 승계된다 (a-cm ↔ v-cm).
  assert.match(INDEX, /generatorState\.outerSeat = 'v-cm';/,
    '턴A on 시 a-cm → v-cm 승계 줄이 없다');
  assert.match(INDEX, /generatorState\.outerSeat = 'a-cm';/,
    '턴A off 시 v-cm → a-cm 승계 줄이 없다');
  // v-cm × 중앙 QR 잠금은 **걷혔다** (V-CMQ 개설) — 되살아나면 회귀다.
  assert.doesNotMatch(INDEX, /const vcmQrLocked =/,
    'v-cm 의 중앙 QR 잠금이 되살아났다 — V-CMQ 개설(2026-08-24)의 회귀');
  assert.match(INDEX, /const vcmLocked = seat === 'v-cm' && !turnAOn;/,
    'v-cm 잠금이 «방향 필요» 하나로 좁혀지지 않았다');
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
