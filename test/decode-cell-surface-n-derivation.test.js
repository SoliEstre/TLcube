/**
 * decode-cell-surface-n-derivation.test.js — `decodeCells` 가 format.n 없이
 * 셀 표면 레이아웃 힌트만 받았을 때의 n 해소 계약 (M2, 2026-08-25).
 *
 * 배경: 2026-08-25 `9ce2883` 이 v0T·v0TR 을 n=21 전용에서 **[21, 25]** 로 열었다.
 * decode.js 의 폴백은 그때까지 「v0 면 13, 나머지 T/W/X 계열이면 21」 이라는
 * **손 목록**이었고 두 가지가 동시에 썩어 있었다:
 *   ① v0wq·v0w2·v0wy 가 목록에서 빠져 「v2r2 는 format.n 이 필요하다」로 던졌다
 *      (합법 n 이 21 하나뿐인데도).
 *   ② v0t·v0tr 이 복수 n 이 됐는데도 21 로 떨어뜨렸다 — 그리고 뒤따르는
 *      `assertCellSurfaceFinalN` 은 21 이 NS 에 있으니 **안 던진다**. 즉 v0t@25
 *      프레임이 조용히 v0t@21 회계로 내려갔다.
 *
 * 그래서 계약을 「`CELL_SURFACE_FINAL_NS` 에서 유도하되, 합법 n 이 둘 이상이면
 * 던진다」로 바꿨다. 이 파일은 그 계약을 **NS 를 순회해서** 잰다 — 여기에도
 * 손 목록을 두면 같은 부패가 테스트 쪽에서 반복된다.
 *
 * ⚠ 실제 도달성: 정식 디코더 앞단(`src/decoder/bootstrap.js`)은 셀 표면 경로에서
 * **항상** `decodeFormat.n = dimension` 을 싣는다. 폴백은 `decodeCells` 를 직접
 * 부르는 호출자(도구·테스트·외부 소비자)의 경로다. 그 사실 자체도 아래에서 잰다 —
 * decode.js 주석이 그 사실에 기대고 있으므로 주석이 거짓이 되면 여기서 터진다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeY } from '../src/encodeY.js';
import { decodeCells } from '../src/decode.js';
import {
  CELL_SURFACE_FINAL_IDS,
  CELL_SURFACE_FINAL_NS,
  CELL_SURFACE_FINAL_PROFILE,
  dataCellsInScanOrderCellSurfaceFinal,
  versionForFinalN,
} from '../src/cellSurfaceFinal.js';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAYLOAD = 'https://tl.estre.so';

const SINGLE_N_IDS = CELL_SURFACE_FINAL_IDS.filter((id) => CELL_SURFACE_FINAL_NS[id].length === 1);
const MULTI_N_IDS = CELL_SURFACE_FINAL_IDS.filter((id) => CELL_SURFACE_FINAL_NS[id].length > 1);

function bodyDigits(encoded, id, n) {
  return dataCellsInScanOrderCellSurfaceFinal(n, id)
    .map(({ i, j }) => encoded.cellDigits.get(i + ',' + j).digit);
}

function encodeFor(id, n) {
  return encodeY(PAYLOAD, {
    cellSurfaceLayout: id, version: versionForFinalN(n), tones: 2, eccLevel: 'M',
  });
}

test('표본이 갈린다 — 합법 n 이 하나인 레이아웃과 둘 이상인 레이아웃이 둘 다 있다', () => {
  // 대조군이 없으면 아래 두 테스트 중 하나는 공집합을 돌면서 초록이 된다.
  assert.ok(SINGLE_N_IDS.length > 0, '합법 n 이 하나인 레이아웃이 없다');
  assert.ok(MULTI_N_IDS.length > 0, '합법 n 이 둘 이상인 레이아웃이 없다');
  // ⚠ **의도적 갱신 (2026-08-25 저녁)** — 여기 있던 `['v2r2=21|25','v0t=21|25','v0tr=21|25']`
  //   는 이 테스트가 쓰인 시점(cd047cb)의 라인업을 **손으로 옮겨 적은 것**이었고, 같은 날
  //   QR25 가 슬롯 계열 셋을 열자 3 → 6 이 되며 바로 빨개졌다. 「사본 목록은 썩는다」의
  //   교과서적 사례라, 목록을 갱신하는 대신 **성질**을 잰다: 열린 n 집합은 어느 레이아웃
  //   에서든 `[21, 25]` 여야 하고(제3의 조합이 생기면 이 유도 전체를 다시 봐야 한다),
  //   대조군 두 표본이 비지 않아야 한다. 라인업이 자라도 이 단언은 안 썩는다.
  for (const id of MULTI_N_IDS) {
    assert.deepEqual([...CELL_SURFACE_FINAL_NS[id]], [21, 25],
      id + ' 의 복수-n 조합이 [21, 25] 가 아니다 — n 유도 전제를 다시 봐야 한다');
  }
});

test('합법 n 이 하나면 format.n 없이도 그 n 으로 유도한다 (손 목록 아님)', () => {
  let count = 0;
  for (const id of SINGLE_N_IDS) {
    const [n] = CELL_SURFACE_FINAL_NS[id];
    const encoded = encodeFor(id, n);
    const digits = bodyDigits(encoded, id, n);
    const base = {
      type: 'Y', formatIndex: encoded.formatIndex, eccLevel: 'M', cellSurfaceLayout: id,
    };
    const withN = decodeCells(digits, { ...base, n });
    assert.equal(withN.ok, true, id + '@' + n + ' (n 명시): ' + (withN.reason || ''));
    assert.equal(withN.text, PAYLOAD);
    // n 을 빼도 같은 결과여야 한다 — 여기가 구 손 목록에서 v0wq·v0w2·v0wy 가
    // 「v2r2 는 format.n 이 필요하다」로 던지던 자리다.
    const derived = decodeCells(digits, base);
    assert.equal(derived.ok, true, id + '@' + n + ' (n 생략): ' + (derived.reason || ''));
    assert.equal(derived.text, PAYLOAD);
    // locatorProfile 힌트 경로도 같은 유도를 탄다.
    const byProfile = decodeCells(digits, {
      type: 'Y',
      formatIndex: encoded.formatIndex,
      eccLevel: 'M',
      locatorProfile: CELL_SURFACE_FINAL_PROFILE[id],
    });
    assert.equal(byProfile.ok, true, id + '@' + n + ' (프로파일·n 생략): ' + (byProfile.reason || ''));
    assert.equal(byProfile.text, PAYLOAD);
    count += 1;
  }
  assert.equal(count, SINGLE_N_IDS.length);
});

test('합법 n 이 둘 이상이면 format.n 없이는 **던진다** (조용한 유도 금지)', () => {
  for (const id of MULTI_N_IDS) {
    const ns = CELL_SURFACE_FINAL_NS[id];
    for (const n of ns) {
      const encoded = encodeFor(id, n);
      const digits = bodyDigits(encoded, id, n);
      const base = {
        type: 'Y', formatIndex: encoded.formatIndex, eccLevel: 'M', cellSurfaceLayout: id,
      };
      // n 을 주면 전부 정상 복호된다 — 실패의 원인이 n 해소라는 것의 대조군이다.
      const withN = decodeCells(digits, { ...base, n });
      assert.equal(withN.ok, true, id + '@' + n + ' (n 명시): ' + (withN.reason || ''));
      assert.equal(withN.text, PAYLOAD);

      const derived = decodeCells(digits, base);
      assert.equal(derived.ok, false, id + '@' + n + ' 가 n 없이 풀렸다');
      // 실패의 **단계**가 중요하다: RS/심볼 실패가 아니라 format 해소 실패여야
      // 호출자가 「n 을 실어라」를 읽는다.
      assert.ok(
        derived.reason.startsWith('format:'),
        id + '@' + n + ' 실패 단계가 format 이 아니다: ' + derived.reason,
      );
      assert.match(derived.reason, new RegExp(ns.join('\\|')));
      assert.match(derived.reason, new RegExp(id));

      const byProfile = decodeCells(digits, {
        type: 'Y',
        formatIndex: encoded.formatIndex,
        eccLevel: 'M',
        locatorProfile: CELL_SURFACE_FINAL_PROFILE[id],
      });
      assert.equal(byProfile.ok, false, id + '@' + n + ' 가 프로파일 힌트 + n 없이 풀렸다');
      assert.ok(byProfile.reason.startsWith('format:'), byProfile.reason);
    }
  }
});

test('조용한 오독의 재현 — v0t@25 를 n 없이 넣어도 21 회계로 내려가지 않는다', () => {
  const encoded = encodeFor('v0t', 25);
  assert.equal(encoded.n, 25);
  const digits25 = bodyDigits(encoded, 'v0t', 25);
  const digits21 = dataCellsInScanOrderCellSurfaceFinal(21, 'v0t').length;
  // 두 회계가 실제로 다르다 — 「21 로 떨어뜨린다」가 무해할 수 없다는 근거.
  assert.notEqual(digits25.length, digits21);

  const derived = decodeCells(digits25, {
    type: 'Y', formatIndex: encoded.formatIndex, eccLevel: 'M', cellSurfaceLayout: 'v0t',
  });
  assert.equal(derived.ok, false);
  assert.ok(derived.reason.startsWith('format:'), derived.reason);
  assert.match(derived.reason, /21\|25/);

  // 같은 digits 를 n=25 로 주면 풀린다 — 실패의 원인이 데이터가 아니라 n 해소다.
  const withN = decodeCells(digits25, {
    type: 'Y', n: 25, formatIndex: encoded.formatIndex, eccLevel: 'M', cellSurfaceLayout: 'v0t',
  });
  assert.equal(withN.ok, true, withN.reason || '');
  assert.equal(withN.text, PAYLOAD);
});

test('레이아웃 힌트도 n 도 없으면 던진다 (formatIndex 만으로는 못 정한다)', () => {
  for (const formatIndex of [1, 3]) {
    const decoded = decodeCells([], { type: 'Y', formatIndex, eccLevel: 'M' });
    assert.equal(decoded.ok, false);
    assert.ok(decoded.reason.startsWith('format:'), decoded.reason);
    assert.match(decoded.reason, /13\|21\|25/);
  }
});

test('정식 앞단은 셀 표면 경로에서 항상 n 을 싣는다 (decode.js 주석의 근거)', () => {
  const bootstrap = readFileSync(path.join(ROOT_DIR, 'src', 'decoder', 'bootstrap.js'), 'utf8');
  // 이 한 줄이 사라지면 위 폴백이 **정식 경로에서도** 도달 가능해진다.
  assert.match(bootstrap, /decodeFormat\.n = dimension;/);
  const decodeSrc = readFileSync(path.join(ROOT_DIR, 'src', 'decode.js'), 'utf8');
  assert.match(decodeSrc, /디코더 앞단\(bootstrap\)은 항상 n 을 싣는다/);
  // 그리고 폴백은 NS 유도다 — 손 목록으로 되돌아가면 여기서 터진다.
  assert.match(decodeSrc, /CELL_SURFACE_FINAL_NS\[finalIdHint\]/);
});
