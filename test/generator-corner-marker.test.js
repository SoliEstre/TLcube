/**
 * generator-corner-marker.test.js — 코너 마커가 **생성기에서 나오는가** (UI 배선).
 *
 * 2026-08-20 이전 상태: `encode(cornerMarker:true)` 는 되는데 생성기가 그 키를
 * **아예 안 넘겼다** — index.html 의 주석이 스스로 그렇게 적어 두고 있었다
 * («지금 이 경로는 cornerMarker 를 아예 안 주므로 … O-CM/A-CM 이 UI 에 붙는 날
 * 여기가 같이 바뀐다»). 즉 검출기를 배선해도 **읽을 심볼을 만들 수 없었다.**
 *
 * 이 파일은 생성기 표면만 잰다 (디코더 쪽은 decoder-corner-marker-wiring.test.js).
 * 고정하는 것:
 *   ① UI 섹션·카드·힌트가 존재하고 8개 언어 사전이 다 있다
 *   ② `encodeOptsFor` 가 O·A 에서 cornerMarker 를 싣고 Y 에서는 안 싣는다
 *   ③ turnA 와 **상호배제** — 둘 다 켜도 encodeA 가 던지지 않는다
 *   ④ 상태 필드가 lab 게이트(INTERNAL) 뒤에 있다
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createGeneratorState, GENERATOR_STATE_SCHEMA, exposedGeneratorStateKeys } from '../src/generator-state.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('① 코너 마커 UI 섹션과 카드가 있고 8개 언어 사전이 다 있다', () => {
  assert.match(INDEX, /id="cornerMarkerSection"/, '섹션이 없다');
  assert.match(INDEX, /id="cornerMarkerCards"/, '카드 행이 없다');
  assert.match(INDEX, /data-cornermarker="off"/, 'off 카드가 없다');
  assert.match(INDEX, /data-cornermarker="on"/, 'on 카드가 없다');
  // 아이콘 포함 — 운영자 규약(턴A 때 «아이콘 포함해야됨»)을 같은 자리에 적용한다.
  const section = INDEX.slice(INDEX.indexOf('id="cornerMarkerSection"'));
  const body = section.slice(0, section.indexOf('</div>\n\n'));
  assert.ok(body.includes('<svg'), '카드에 아이콘이 없다');

  for (const key of ['g576', 'g577', 'g578', 'g579']) {
    const count = INDEX.split('"' + key + '":').length - 1;
    assert.equal(count, 8, key + ' 사전 항목이 8개 언어에 다 있어야 한다 (현재 ' + count + ')');
  }
});

test('② encodeOptsFor 가 O·A 에서만 cornerMarker 를 싣는다', () => {
  // index.html 은 브라우저 모듈이라 여기서 import 할 수 없다. 소스 계약으로 잠근다 —
  // 「어느 분기에 있는가」가 이 검사의 대상이다.
  const opts = INDEX.slice(INDEX.indexOf('function encodeOptsFor'));
  const body = opts.slice(0, opts.indexOf('\n}\n'));
  const yBranch = body.slice(body.indexOf("cfg.type === 'Y'"), body.indexOf("cfg.type === 'A'"));
  assert.equal(yBranch.includes('cornerMarker'), false,
    'Type Y 분기에 cornerMarker 가 들어갔다 — Y 는 자기 로케이터 문법을 쓴다');
  assert.match(body, /cfg\.cornerMarker === true/,
    'cornerMarker 를 cfg 에서 읽는 줄이 없다 — UI 가 인코더에 안 닿는다');
  // cfg 조립부에서도 O·A 로 제한하는가
  assert.match(INDEX, /cornerMarker: \(type === 'O' \|\| type === 'A'\)/,
    'cfg 조립에서 타입 제한이 없다 — 다른 타입에서 켜진 채 새어 나간다');
});

test('③ turnA 와 상호배제 — 인코더가 던지지 않는 조합만 만든다', () => {
  // encodeA 계약 확인: 둘 다 참이면 던진다.
  assert.throws(
    () => encodeA('x', { version: 1, eccLevel: 'M', cornerMarker: true, turnA: true }),
    '둘 다 참인데 안 던진다 — 상호배제 계약이 사라졌으면 UI 잠금 근거가 없어진다',
  );
  // UI 가 그 조합을 못 만드는가 (핸들러가 turnA 를 끈다)
  assert.match(INDEX, /if \(generatorState\.cornerMarker\) generatorState\.turnA = false;/,
    '코너 마커를 켤 때 turnA 를 끄는 줄이 없다');
  // encodeOptsFor 에서도 코너 마커가 먼저 이긴다 (저장·URL 로 옛 조합이 들어와도)
  const opts = INDEX.slice(INDEX.indexOf('function encodeOptsFor'));
  const cmAt = opts.indexOf('cfg.cornerMarker === true');
  const turnAt = opts.indexOf('cfg.turnA === true');
  assert.ok(cmAt >= 0 && turnAt >= 0 && cmAt < turnAt,
    'cornerMarker 분기가 turnA 보다 뒤에 있다 — 옛 조합이 들어오면 던지는 쪽으로 간다');
});

test('④ 상태 필드는 lab 게이트 뒤(INTERNAL)에 있다', () => {
  const state = createGeneratorState();
  assert.equal(state.cornerMarker, false, '기본값은 꺼짐이어야 한다');
  const field = GENERATOR_STATE_SCHEMA.cornerMarker;
  assert.ok(field, 'GENERATOR_STATE_SCHEMA 에 cornerMarker 가 없다');
  assert.deepEqual(field.options, [false, true]);
  // 노출 대조를 **유도**한다 — 상수를 손으로 적으면 exposure 값 이름이 바뀔 때 썩는다.
  for (const mode of ['normal', 'advanced']) {
    assert.equal(exposedGeneratorStateKeys(mode).includes('cornerMarker'), false,
      mode + ' 모드에 노출됐다 — 실기기 라운드를 아직 안 돌았다 (turnA 와 같은 게이트)');
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
