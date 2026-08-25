/**
 * generator-auto-y.test.js — 자동 선정의 **우선순위**를 잠근다.
 *
 * 운영자 신고 (2026-08-25): 「내용 늘리면 Y1-Y2로 먼저 넘어가야 하는데 ECC 축소가
 * 먼저 들어가는 것 같네. v0 선택했다고 v0 고정이 우선순위가 되면 안 됨.」
 *
 * 이 파일이 재는 것은 «어떤 값이 나오나» 가 아니라 **«무엇이 먼저 양보하나»** 다.
 * 값만 잠그면 사다리 순서가 뒤집혀도 우연히 통과하는 표본이 생긴다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveAutoY, AUTO_ECC_LADDER } from '../src/generator-auto-y.js';
import { encodeY } from '../src/encodeY.js';
import { capacityForCellSurfaceFinal } from '../src/cellSurfaceFinal.js';
import {
  LOCATOR_PROFILE_CELL_SURFACE_V0, LOCATOR_PROFILE_CELL_SURFACE_V0TR, LOCATOR_PROFILE_OFF,
} from '../src/locatorY.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('① 신고 재현 — 25 B 는 Y0@M 이 아니라 Y1@H 로 간다', () => {
  // 실측 **페이로드 상한**(maxPayloadBytes, tones=3): v0@13 H=20·M=25·L=29 · v0TR@21 H=58.
  // ⚠ dataBytes(21/26/30) 가 아니다 — headerBytes 1 만큼 다르고, 인코더가 거절하는
  //   기준은 maxPayloadBytes 다. 처음에 dataBytes 로 쟀다가 경계에서 어긋났다.
  // 종전 로직은 「L(30) 에 들어가나」로 물어 v0(Y0) 을 고정했고, 그 뒤 ECC 가 M 으로
  // 내려갔다. 새 규칙은 H 부터 해상도를 훑으므로 Y1 을 먼저 집는다.
  const got = resolveAutoY({ payloadBytes: 25, tones: 3, eccLevel: 'auto' });
  assert.equal(got.version, 1, '해상도가 안 올라갔다 — ECC 가 먼저 양보하고 있다');
  assert.equal(got.ecc, 'H', 'ECC 가 내려갔다 — 해상도를 다 쓰기 전에 양보하면 안 된다');
  assert.equal(got.locatorProfileY, LOCATOR_PROFILE_CELL_SURFACE_V0TR);
});

test('② 사다리 — ECC 가 바깥, 해상도가 안쪽이다 (순서 자체를 잠근다)', () => {
  // 경계 표본: v0@H(20) 에 딱 들어가면 Y0 을 유지해야 한다 (해상도를 헛되이 키우지 않는다).
  assert.equal(resolveAutoY({ payloadBytes: 20, tones: 3, eccLevel: 'auto' }).version, 0);
  assert.equal(resolveAutoY({ payloadBytes: 20, tones: 3, eccLevel: 'auto' }).ecc, 'H');
  // 한 바이트만 넘겨도 **ECC 가 아니라 해상도**가 움직인다.
  const over = resolveAutoY({ payloadBytes: 21, tones: 3, eccLevel: 'auto' });
  assert.equal(over.version, 1, '21 B 에서 해상도가 안 올라갔다');
  assert.equal(over.ecc, 'H', '21 B 에서 ECC 가 내려갔다 — 사다리 순서가 뒤집혔다');
  // v0TR@21/H(58) 를 넘기면 **Y2 로 올라가되 마커는 지킨다** (v0TR@25/H = 93 B).
  // ⚠ 2026-08-25 이전엔 여기서 «끔» 이었다 — n=25 에 셀 표면이 없어서였다.
  // 운영자 신고(「마커가 먼저 없어지는데?」)의 수리가 이 단이다.
  const big = resolveAutoY({ payloadBytes: 59, tones: 3, eccLevel: 'auto' });
  assert.equal(big.version, 2, '59 B 에서 Y2 로 안 갔다');
  assert.equal(big.ecc, 'H');
  assert.equal(big.locatorProfileY, LOCATOR_PROFILE_CELL_SURFACE_V0TR,
    '59 B 에서 마커를 버렸다 — 해상도를 키워서 지킬 수 있는데 버리면 안 된다');
  // 마커를 버리는 것은 **v0TR@25/H(93) 까지 쓴 뒤**다. 그게 마지막 수단이다.
  const dropped = resolveAutoY({ payloadBytes: 94, tones: 3, eccLevel: 'auto' });
  assert.equal(dropped.locatorProfileY, LOCATOR_PROFILE_OFF,
    '94 B 에서도 마커를 들고 있다 — v0TR@25 용량을 넘겼는데 안 놓았다');
  assert.equal(dropped.ecc, 'H', '마커를 버리기도 전에 ECC 를 내렸다');
});

test('③ ECC 는 **최대 해상도를 다 쓴 뒤에만** 내려간다', () => {
  // Y2@H = 113 B. 그것을 넘기면 그때 비로소 ECC 가 M 으로 내려가고, 해상도는 다시
  // 사다리 맨 아래부터 훑는다 (M 에서는 더 작은 단이 다시 후보가 된다).
  const past = resolveAutoY({ payloadBytes: 114, tones: 3, eccLevel: 'auto' });
  assert.equal(past.ecc, 'M', 'Y2@H 를 넘겼는데 ECC 가 안 내려갔다');
  assert.equal(past.version, 2);
  // Y2@L = 168 B 도 넘기면 «안 들어간다» 를 정직하게 보고한다 (조용히 자르지 않는다).
  const impossible = resolveAutoY({ payloadBytes: 5000, tones: 3, eccLevel: 'auto' });
  assert.equal(impossible.fits, false, '들어가지도 않는데 fits=true 다 — 조용한 절단이다');
});

test('④ ECC 를 명시하면 그 안에서만 해상도를 훑는다', () => {
  // 사용자가 H 를 고정하면 자동은 ECC 를 건드리지 않는다 — 해상도만 움직인다.
  const fixed = resolveAutoY({ payloadBytes: 25, tones: 3, eccLevel: 'H' });
  assert.equal(fixed.ecc, 'H');
  assert.equal(fixed.version, 1);
  const fixedL = resolveAutoY({ payloadBytes: 25, tones: 3, eccLevel: 'L' });
  assert.equal(fixedL.ecc, 'L');
  assert.equal(fixedL.version, 0, 'L(29) 에 들어가는데 해상도를 키웠다');
});

test('⑤ 톤 축 — 2톤은 3톤보다 적게 담으므로 같은 바이트에서 더 큰 단이 나올 수 있다', () => {
  const three = resolveAutoY({ payloadBytes: 20, tones: 3, eccLevel: 'auto' });
  const two = resolveAutoY({ payloadBytes: 20, tones: 2, eccLevel: 'auto' });
  assert.ok(two.version >= three.version,
    '2톤이 3톤보다 작은 단을 골랐다 — 톤 축이 용량에 안 걸려 있다');
});

test('⑥ ECC 사다리가 encodeWithEcc 와 **같은 순서**여야 한다', () => {
  // 다르면 자동이 고른 (버전, ECC) 를 인코더가 재현하지 못한다 — 화면과 산출물이 갈린다.
  assert.deepEqual([...AUTO_ECC_LADDER], ['H', 'M', 'L']);
  assert.match(INDEX, /for \(const ecc of \['H', 'M', 'L'\]\)/,
    'encodeWithEcc 의 ECC 사다리가 바뀌었다 — generator-auto-y 의 AUTO_ECC_LADDER 와 맞춰라');
});

test('⑦ 자 검증 — 사다리의 용량이 **인코더 실측**과 일치한다 (모델끼리 대조 금지)', () => {
  // ⚠ 이 테스트가 왜 있나: ①\~⑥ 은 전부 «내 모델» 을 잰다. 기대값을 모델에서 뽑아
  //    적었으니 모델이 틀려도 같이 틀린 채 초록이 된다 — 실제로 그랬다. 처음 판은
  //    `dataBytes` 를 썼는데 인코더가 보는 것은 `maxPayloadBytes` 였고(차이 = headerBytes 1),
  //    여섯 테스트가 전부 통과하는 채로 경계에서 어긋났다. 생성기 용량 게이지가
  //    다른 값을 보여 준 것이 유일한 단서였다.
  //
  //    그래서 여기서는 **다른 자**를 쓴다: 사다리가 «들어간다» 고 한 바이트 수를
  //    진짜 인코더에 먹여 본다. 들어가야 하고, 한 바이트 더는 들어가면 안 된다.
  const fits = (bytes, opts) => {
    try { encodeY('a'.repeat(bytes), opts); return true; } catch { return false; }
  };
  // 사다리의 **믿음**을 이분 탐색으로 캐낸다 — 상수를 다시 적으면 또 «모델끼리 대조» 다.
  // «H 에서 Y0 을 유지하는 최대 바이트» = 사다리가 생각하는 v0@H 용량이다.
  const ladderCapAtH = (() => {
    let lo = 0; let hi = 400;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const r = resolveAutoY({ payloadBytes: mid, tones: 3, eccLevel: 'auto' });
      if (r.version === 0 && r.ecc === 'H') lo = mid; else hi = mid - 1;
    }
    return lo;
  })();
  const V0_H = { tones: 3, version: 0, eccLevel: 'H', cellSurface: true, cellSurfaceLayout: 'v0' };
  assert.equal(fits(ladderCapAtH, V0_H), true,
    '사다리는 ' + ladderCapAtH + ' B 가 v0@H 에 들어간다는데 인코더가 거절한다 — '
    + '용량 필드를 잘못 읽었다 (dataBytes 는 headerBytes 만큼 크다. maxPayloadBytes 를 써라)');
  assert.equal(fits(ladderCapAtH + 1, V0_H), false,
    '사다리가 용량을 **낮게** 잡았다 — ' + (ladderCapAtH + 1) + ' B 도 들어가는데 '
    + '해상도를 헛되이 키운다');
});
