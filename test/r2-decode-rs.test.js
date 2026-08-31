import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesToSymbols, symbolCountForByteLength } from '../src/base211.js';
import { rsEncode } from '../src/rs211.js';
import { createRsDecodeInto, nsymFor } from '../src/r2/decode-rs.js';
import { R2_SESSION_STATUS } from '../src/r2/session.js';

/*
 * decode-rs 는 R2 세션의 `decodeInto` 를 실물 RS 로 채운 것이다. 여기서 재는 것은
 * **계약**이다 — 무엇을 수용하고 무엇을 거부하며, 실패를 어떻게 신호하는가.
 *
 * ⚠ 「복호가 된다」만 재면 안 된다. 이 프로젝트에서 반복된 사고가 «RS 가 대량 정정해
 *    빈 페이로드를 성공으로 반환» 이었고, 그건 성공 경로만 재는 테스트를
 *    그대로 통과한다. 그래서 오정정 거부를 **주입해서** 잡히는지 확인한다.
 */

const PAYLOAD = new Uint8Array([0x54, 0x4c, 0x63, 0x75, 0x62, 0x65, 0x21]);

/** 페이로드를 세션이 넘겨줄 모양(코드워드 · 신뢰도 · 소거)으로 만든다. */
function buildFrame(payload, nsym) {
  const message = bytesToSymbols(payload);
  const codeword = rsEncode(message, nsym);
  const symbolCount = codeword.length;
  const values = new Uint8Array(symbolCount);
  values.set(codeword);
  const confidence = new Int16Array(symbolCount);
  confidence.fill(2000);          // 충분히 확신하는 관측
  const erasures = new Uint8Array(symbolCount);
  return { values, confidence, erasures, symbolCount, messageLength: message.length };
}

/** 심볼을 손상시키고 **신뢰도도 낮춘다** — 실제 오독은 그렇게 보인다. */
function corrupt(frame, index, delta) {
  frame.values[index] = (frame.values[index] + delta) % 211;
  frame.confidence[index] = 40;   // 문턱(3*Q8_ONE = 768) 한참 아래
}

function runDecode(frame, layoutOverride = undefined) {
  const decodeInto = createRsDecodeInto();
  const output = { accepted: 0, payloadLength: 0, tResidual: 0 };
  const buffer = new Uint8Array(256);
  const layout = layoutOverride ?? { nsym: frame.symbolCount - frame.messageLength };
  const status = decodeInto(
    frame.values,
    frame.confidence,
    frame.erasures,
    frame.symbolCount,
    layout,
    output,
    buffer,
  );
  return { status, output, buffer };
}

test('① 무결 코드워드는 페이로드를 그대로 되돌린다', () => {
  const nsym = 8;
  const frame = buildFrame(PAYLOAD, nsym);
  const { status, output, buffer } = runDecode(frame);
  assert.equal(status, R2_SESSION_STATUS.OK);
  assert.equal(output.accepted, 1, '무결 입력이 거부되면 나머지 테스트가 공허하다');
  assert.ok(output.payloadLength >= PAYLOAD.length);
  assert.deepEqual(
    Array.from(buffer.subarray(0, PAYLOAD.length)),
    Array.from(PAYLOAD),
  );
});

test('② 오류가 **낮은 신뢰도**로 표시되면 정정해서 살려낸다', () => {
  // 실제 관측에서 잘못 읽힌 셀은 신뢰도가 낮게 나온다. 그 조건이라야 정정이 수용된다.
  const nsym = 12;
  const frame = buildFrame(PAYLOAD, nsym);
  corrupt(frame, 0, 7);
  corrupt(frame, 5, 91);
  const { output, buffer } = runDecode(frame);
  assert.equal(output.accepted, 1, '낮은 신뢰도로 표시된 2오류는 복구되어야 한다');
  assert.deepEqual(
    Array.from(buffer.subarray(0, PAYLOAD.length)),
    Array.from(PAYLOAD),
  );
});

test('②-b **고신뢰 플립 과반 거부** — 확신했던 심볼을 뒤집는 정정은 수용하지 않는다', () => {
  // acceptDecode 의 마지막 규칙: highConfidenceCorrections * 2 <= correctedCount.
  // 오정정 방어의 핵심이고 눈에 안 보인다. 명시적으로 잠근다.
  // ⚠ 나는 처음에 모든 심볼에 높은 신뢰도를 줘서 ② 가 실패했고, 그걸 «여력 규칙» 으로
  //    오진했다. 진짜 규칙은 이것이다.
  const frame = buildFrame(PAYLOAD, 12);
  // 값만 바꾸고 신뢰도는 **높은 채로** 둔다 = 「확신했는데 디코더가 뒤집는다」
  frame.values[0] = (frame.values[0] + 7) % 211;
  frame.values[5] = (frame.values[5] + 91) % 211;
  assert.equal(
    runDecode(frame).output.accepted, 0,
    '고신뢰 심볼을 과반 뒤집는 정정이 수용되면 오정정 방어가 사라진 것',
  );
});
test('③ 능력을 넘는 오류는 **수용하지 않는다** — 그리고 세션 오류로 올리지 않는다', () => {
  const nsym = 4;                       // 정정 능력 2 심볼
  const frame = buildFrame(PAYLOAD, nsym);
  for (let i = 0; i < 6; i += 1) frame.values[i] = (frame.values[i] + 37 + i) % 211;
  const { status, output } = runDecode(frame);
  assert.equal(output.accepted, 0);
  // 🔴 복호 실패는 «증거 부족» 이지 «디코더 고장» 이 아니다. OK 가 아니면 세션이
  //    FAILED 로 죽어 누적을 포기한다 — 다중 프레임 누적의 존재 이유가 사라진다.
  assert.equal(status, R2_SESSION_STATUS.OK);
});

test('④ 오정정 거부 — 빈 페이로드 ∧ 정정>0 은 성공으로 치지 않는다', () => {
  // 0 바이트 페이로드를 정상 부호화한 뒤 오류를 주입한다. RS 가 그걸 «정정» 해서
  // 0 으로 되돌리면 «빈 페이로드 + 정정>0» 이 성립한다 — 그게 거부 대상이다.
  const zero = new Uint8Array(7);
  const nsym = 8;
  const frame = buildFrame(zero, nsym);
  frame.values[1] = (frame.values[1] + 13) % 211;
  frame.values[9] = (frame.values[9] + 57) % 211;
  const { status, output } = runDecode(frame);
  assert.equal(status, R2_SESSION_STATUS.OK);
  assert.equal(output.accepted, 0, '빈 페이로드를 정정으로 만들어 낸 것은 거부해야 한다');
});

test('④-b 대조군 — 정정이 0 이면 빈 페이로드도 정상 수용된다', () => {
  // ④ 가 «빈 페이로드면 무조건 거부» 로 과잉 작동하면 이 테스트가 잡는다.
  const zero = new Uint8Array(7);
  const frame = buildFrame(zero, 8);
  const { output } = runDecode(frame);
  assert.equal(output.accepted, 1, '무결한 빈 페이로드까지 막으면 두 축 조건이 아니다');
});

test('⑤ nsym 유도 — 명시값이 이기고, 없으면 K 에서 유도하며, 둘 다 없으면 0', () => {
  assert.equal(nsymFor({ nsym: 9 }, 40), 9);
  assert.equal(nsymFor({ K: 30 }, 40), 10);
  assert.equal(nsymFor({ requiredSymbolCount: 25 }, 40), 15);
  assert.equal(nsymFor({}, 40), 0, '모르면 지어내지 말고 0 을 내야 한다');
  assert.equal(nsymFor(null, 40), 0);
  assert.equal(nsymFor({ K: 40 }, 40), 0, 'K >= symbolCount 는 패리티가 없다');
});

test('⑥ 계약 — 잘못된 입력에 **예외를 던지지 않는다**', () => {
  const decodeInto = createRsDecodeInto();
  const output = { accepted: 0, payloadLength: 0, tResidual: 0 };
  const buffer = new Uint8Array(64);
  const frame = buildFrame(PAYLOAD, 8);
  const bad = [
    [null, frame.confidence, frame.erasures, frame.symbolCount, { nsym: 8 }],
    [frame.values, null, frame.erasures, frame.symbolCount, { nsym: 8 }],
    [frame.values, frame.confidence, frame.erasures, 0, { nsym: 8 }],
    [frame.values, frame.confidence, frame.erasures, frame.symbolCount, null],
    [frame.values, frame.confidence, frame.erasures, frame.symbolCount, { nsym: 0 }],
    [frame.values, frame.confidence, frame.erasures, frame.symbolCount, { nsym: 9999 }],
  ];
  for (const args of bad) {
    assert.doesNotThrow(() => {
      const status = decodeInto(...args, output, buffer);
      assert.ok(Number.isInteger(status));
      assert.equal(output.accepted, 0);
    }, `이 입력에서 던졌다: ${JSON.stringify(args[4])}`);
  }
});

test('⑦ 세션에 실제로 꽂힌다 — 주입 계약과 시그니처가 맞는다', async () => {
  const { createR2Session } = await import('../src/r2/session.js');
  const frame = buildFrame(PAYLOAD, 8);
  const cellCount = frame.symbolCount * 3;
  const session = createR2Session({
    layout: { cellCount, K: frame.messageLength, nsym: frame.symbolCount - frame.messageLength },
    decodeInto: createRsDecodeInto(),
  });
  // 세션이 «설정 유효» 로 서고 decodeInto 를 스텁이 아니라 이걸로 잡았는지.
  assert.equal(session.result.status, R2_SESSION_STATUS.OK);
  assert.equal(session.buffers.symbolValues.length, frame.symbolCount);
});
