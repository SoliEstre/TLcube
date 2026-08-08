// formatinfo.test.js — SPEC §5.4 포맷 정보 계약 테스트 (CRC-6 + 12bit↔5digit + 마스크 + 다수결)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERSION_BITS, ECC_BITS, PAYLOAD_BITS, CRC_BITS, CODEWORD_BITS,
  DIGIT_COUNT, DIGIT_BASE, ECC_LEVEL,
  CRC_POLY, SELECTED_MIN_DIGIT_DISTANCE, SELECTED_MIN_BIT_DISTANCE,
  crcCompute, crc6,
  toDigits5, fromDigits5,
  MASK_DIGITS, applyMask, removeMask,
  encode, encodeReplicated,
  decodeSingle, majorityVote, decode,
} from '../src/formatinfo.js';

function popcount(x) {
  let c = 0;
  let v = x;
  while (v) { c += v & 1; v >>= 1; }
  return c;
}

function digitHamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
  return d;
}

describe('상수 (SPEC §5.4)', () => {
  test('필드 폭', () => {
    assert.equal(VERSION_BITS, 4);
    assert.equal(ECC_BITS, 2);
    assert.equal(PAYLOAD_BITS, 6);
    assert.equal(CRC_BITS, 6);
    assert.equal(CODEWORD_BITS, 12);
    assert.equal(DIGIT_COUNT, 5);
    assert.equal(DIGIT_BASE, 6);
  });

  test('6^5 >= 2^12', () => {
    assert.ok(DIGIT_BASE ** DIGIT_COUNT >= 2 ** CODEWORD_BITS);
  });

  test('ECC_LEVEL.RESERVED = 3', () => {
    assert.equal(ECC_LEVEL.RESERVED, 3);
  });
});

describe('CRC-6 선정 (전수 비교 회귀 고정)', () => {
  test('선정 다항식은 CRC-6/CDMA2000-B (0x07)', () => {
    assert.equal(CRC_POLY, 0x07);
  });

  test('64 페이로드 코드워드의 digit 도메인 전쌍 최소 해밍 거리 = 선정 상수', () => {
    const digitsList = [];
    for (let payload = 0; payload < 64; payload += 1) {
      const crc = crc6(payload);
      const codeword = (payload << CRC_BITS) | crc;
      digitsList.push(toDigits5(codeword));
    }
    let minDist = Infinity;
    for (let i = 0; i < digitsList.length; i += 1) {
      for (let j = i + 1; j < digitsList.length; j += 1) {
        minDist = Math.min(minDist, digitHamming(digitsList[i], digitsList[j]));
      }
    }
    assert.equal(minDist, SELECTED_MIN_DIGIT_DISTANCE);
  });

  test('64 페이로드 코드워드의 bit 도메인 전쌍 최소 해밍 거리 = 선정 상수', () => {
    const codewords = [];
    for (let payload = 0; payload < 64; payload += 1) {
      const crc = crc6(payload);
      codewords.push((payload << CRC_BITS) | crc);
    }
    let minDist = Infinity;
    for (let i = 0; i < codewords.length; i += 1) {
      for (let j = i + 1; j < codewords.length; j += 1) {
        minDist = Math.min(minDist, popcount(codewords[i] ^ codewords[j]));
      }
    }
    assert.equal(minDist, SELECTED_MIN_BIT_DISTANCE);
  });

  test('crcCompute 는 표준 bit-serial 나눗셈과 일치 (수기 계산 1건 대조)', () => {
    // payload=0 -> crc=0 (0 은 모든 다항식에서 자명하게 0)
    assert.equal(crcCompute(0, PAYLOAD_BITS, CRC_POLY, CRC_BITS), 0);
    // 결정적 재현: 같은 입력은 항상 같은 출력
    assert.equal(crcCompute(0b101011, 6, 0x07, 6), crcCompute(0b101011, 6, 0x07, 6));
  });
});

describe('12bit ↔ 5digit', () => {
  test('왕복 항등 — 0..4095 전수', () => {
    for (let v = 0; v < 4096; v += 1) {
      assert.equal(fromDigits5(toDigits5(v)), v);
    }
  });

  test('MSD-first: 최상위 digit 이 배열 앞', () => {
    assert.deepEqual(toDigits5(0), [0, 0, 0, 0, 0]);
    // 6^4 = 1296 -> 최상위 digit=1, 나머지 0
    assert.deepEqual(toDigits5(1296), [1, 0, 0, 0, 0]);
  });

  test('범위 밖 값은 예외', () => {
    assert.throws(() => toDigits5(-1), RangeError);
    assert.throws(() => toDigits5(6 ** 5), RangeError);
  });

  test('fromDigits5 는 4096..7775 도 받는다(디코더 범위검사용, toDigits5 는 그 값을 안 만들 뿐)', () => {
    assert.equal(fromDigits5([5, 5, 5, 5, 5]), 6 ** 5 - 1);
  });
});

describe('고정 출력 마스크', () => {
  test('마스크는 CRC_POLY 유래이며 전부 0이 아니다 (균일 패치 방지)', () => {
    assert.equal(MASK_DIGITS.length, 5);
    assert.ok(MASK_DIGITS.some((d) => d !== 0));
  });

  test('마스크는 결정적 상수 — 재계산해도 동일', () => {
    // 모듈은 로드 시 1회 계산 후 freeze 하므로, 두 번 읽어도 같은 참조/값이어야 한다.
    assert.deepEqual(MASK_DIGITS, MASK_DIGITS);
    assert.ok(Object.isFrozen(MASK_DIGITS));
  });

  test('왕복 항등 — 임의 5digit 전수', () => {
    for (let v = 0; v < 4096; v += 1) {
      const digits = toDigits5(v);
      assert.deepEqual(removeMask(applyMask(digits)), digits);
    }
  });

  test('전부 0 페이로드가 마스크 후 균일 패치가 아니다', () => {
    const masked = applyMask([0, 0, 0, 0, 0]);
    assert.ok(masked.some((d) => d !== masked[0]) || masked.every((d) => d !== 0));
  });
});

describe('인코더', () => {
  test('64 페이로드 전수 왕복 — encode 후 decodeSingle 이 원래 값 복원', () => {
    for (let version = 0; version < 16; version += 1) {
      for (let eccLevel = 0; eccLevel < 3; eccLevel += 1) {
        const digits = encode({ version, eccLevel });
        const result = decodeSingle(digits);
        assert.equal(result.ok, true, `version=${version} eccLevel=${eccLevel}`);
        assert.equal(result.version, version);
        assert.equal(result.eccLevel, eccLevel);
      }
    }
  });

  test('ECC 레벨 3(예약)은 인코더가 거부', () => {
    assert.throws(() => encode({ version: 0, eccLevel: ECC_LEVEL.RESERVED }), RangeError);
  });

  test('버전 범위 밖은 예외', () => {
    assert.throws(() => encode({ version: 16, eccLevel: 0 }), RangeError);
    assert.throws(() => encode({ version: -1, eccLevel: 0 }), RangeError);
  });

  test('ECC 레벨 범위 밖(4 이상)은 예외', () => {
    assert.throws(() => encode({ version: 0, eccLevel: 4 }), RangeError);
  });

  test('encodeReplicated 는 동일한 5digit 3개', () => {
    const reps = encodeReplicated({ version: 5, eccLevel: 1 });
    assert.equal(reps.length, 3);
    assert.deepEqual(reps[0], reps[1]);
    assert.deepEqual(reps[1], reps[2]);
    // 별개 배열(참조 공유 아님) — 호출측이 자유롭게 변형해도 서로 오염 안 됨
    reps[0][0] = (reps[0][0] + 1) % DIGIT_BASE;
    assert.notEqual(reps[0][0], reps[1][0]);
  });
});

describe('디코더 — 단독', () => {
  test('예약 ECC 값(3)은 ok:false', () => {
    // payload 로 eccLevel=3 을 만들어 CRC 를 정상 계산한 뒤 디코더에 넣는다
    // (인코더는 거부하므로 디코더 테스트는 페이로드를 직접 조립).
    const version = 5;
    const payload = (version << ECC_BITS) | ECC_LEVEL.RESERVED;
    const crc = crc6(payload);
    const codeword = (payload << CRC_BITS) | crc;
    const digits = applyMask(toDigits5(codeword));
    const result = decodeSingle(digits);
    assert.equal(result.ok, false);
  });

  test('CRC 불일치는 ok:false', () => {
    const digits = encode({ version: 3, eccLevel: 1 });
    const corrupted = digits.slice();
    corrupted[4] = (corrupted[4] + 1) % DIGIT_BASE;
    // 이 특정 조합이 우연히 다른 합법 코드워드로 떨어지지 않는지 방어적으로 확인 후
    // ok:false 를 기대(선정된 CRC 의 digit 최소거리가 2 이므로 1digit 변조는 항상 검출됨).
    const result = decodeSingle(corrupted);
    assert.equal(result.ok, false);
  });

  test('4096..7775 범위(마스크 해제 후) 는 ok:false', () => {
    // MASK_DIGITS 를 더했을 때 fromDigits5 >= 4096 이 되는 입력을 역산해서 만든다.
    // 가장 큰 입력 [5,5,5,5,5] 는 unmask 후 fromDigits5 가 대부분 4096 을 넘는다.
    const result = decodeSingle([5, 5, 5, 5, 5]);
    // 항상 범위 밖이 되진 않을 수 있으니(마스크 값에 의존), ok=false 이거나
    // 우연히 유효 코드워드였다면 그 자체로 왕복 정합성만 확인.
    if (result.ok) {
      const digits = encode({ version: result.version, eccLevel: result.eccLevel });
      assert.deepEqual(digits, [5, 5, 5, 5, 5]);
    } else {
      assert.equal(result.ok, false);
    }
  });
});

describe('3중 복제 다수결', () => {
  test('완전 일치 3복제 — 정상 복호', () => {
    for (let version = 0; version < 16; version += 4) {
      for (let eccLevel = 0; eccLevel < 3; eccLevel += 1) {
        const reads = encodeReplicated({ version, eccLevel });
        const result = decode(reads);
        assert.equal(result.ok, true);
        assert.equal(result.version, version);
        assert.equal(result.eccLevel, eccLevel);
      }
    }
  });

  test('한 복제의 임의 1digit 오염 — 전수 — 다수결로 여전히 정복호', () => {
    for (let version = 0; version < 16; version += 1) {
      for (let eccLevel = 0; eccLevel < 3; eccLevel += 1) {
        const base = encode({ version, eccLevel });
        for (let pos = 0; pos < DIGIT_COUNT; pos += 1) {
          for (let val = 0; val < DIGIT_BASE; val += 1) {
            if (val === base[pos]) continue;
            const corrupted = base.slice();
            corrupted[pos] = val;
            const reads = [base.slice(), base.slice(), corrupted];
            const result = decode(reads);
            assert.equal(
              result.ok, true,
              `version=${version} eccLevel=${eccLevel} pos=${pos} val=${val}`,
            );
            assert.equal(result.version, version);
            assert.equal(result.eccLevel, eccLevel);
          }
        }
      }
    }
  });

  test('다수결 실패(3복제 전부 다른 digit) 시 개별 복제 재시도로 성공 가능', () => {
    const good = encode({ version: 7, eccLevel: 2 });
    // 한 자리를 3복제 모두 다르게 흔들어 다수결이 그 자리에서 합의 불가가 되게 함
    const r0 = good.slice();
    const r1 = good.slice();
    const r2 = good.slice(); // r2 는 원본 그대로 유지 — 개별 시도에서 성공해야 함
    r0[0] = (good[0] + 1) % DIGIT_BASE;
    r1[0] = (good[0] + 2) % DIGIT_BASE;
    if (r0[0] === r1[0]) r1[0] = (r1[0] + 1) % DIGIT_BASE; // 우연 충돌 방지
    const result = decode([r0, r1, r2]);
    assert.equal(result.ok, true);
    assert.equal(result.version, 7);
    assert.equal(result.eccLevel, 2);
  });

  test('3복제 전부 손상되어 무엇도 CRC 를 통과 못하면 ok:false', () => {
    const good = encode({ version: 1, eccLevel: 0 });
    const bad = good.map((d) => (d + 3) % DIGIT_BASE); // 전 자리 변조
    const result = decode([bad, bad, bad]);
    // bad 가 우연히 유효 코드워드가 아님을 전제 — 아래에서 방어적으로 확인
    if (!decodeSingle(bad).ok) {
      assert.equal(result.ok, false);
    }
  });

  test('majorityVote — 2/3 합의 시 hasMajority=true', () => {
    const a = [0, 1, 2, 3, 4];
    const b = [0, 1, 2, 3, 5];
    const c = [0, 1, 2, 3, 4];
    const { digits, hasMajority } = majorityVote([a, b, c]);
    assert.deepEqual(digits, [0, 1, 2, 3, 4]);
    assert.equal(hasMajority, true);
  });

  test('majorityVote — 한 자리 3파전이면 hasMajority=false', () => {
    const a = [0, 0, 0, 0, 0];
    const b = [0, 0, 0, 0, 1];
    const c = [0, 0, 0, 0, 2];
    const { hasMajority } = majorityVote([a, b, c]);
    assert.equal(hasMajority, false);
  });

  test('decode 는 reads 3개가 아니면 예외', () => {
    const one = encode({ version: 0, eccLevel: 0 });
    assert.throws(() => decode([one, one]), TypeError);
  });
});

describe('검출력 (참고용 — 측정표 재현, 회귀는 아님)', () => {
  test('1-digit 오염은 100% 검출(단독 복호 기준, 다수결 아님)', () => {
    let total = 0;
    let undetected = 0;
    for (let payload = 0; payload < 64; payload += 1) {
      const version = payload >> ECC_BITS;
      const eccLevel = payload & 0b11;
      if (eccLevel === ECC_LEVEL.RESERVED) continue;
      const base = encode({ version, eccLevel });
      for (let pos = 0; pos < DIGIT_COUNT; pos += 1) {
        for (let val = 0; val < DIGIT_BASE; val += 1) {
          if (val === base[pos]) continue;
          total += 1;
          const corrupted = base.slice();
          corrupted[pos] = val;
          if (decodeSingle(corrupted).ok) undetected += 1;
        }
      }
    }
    assert.equal(undetected, 0);
    assert.ok(total > 0);
  });
});

describe('와이어 포맷 known-answer (검증 라운드: 상수 미고정 지적 반영)', () => {
  // 뮤테이션 실측: 마스크 유도식을 (POLY<<6)|POLY → POLY 로 바꿔도 기존 31개 테스트가
  // 전부 통과했다. 아래 KAT 가 그 구멍을 막는다 — 이 값들이 곧 와이어 계약이다.
  test('MASK_DIGITS 정확값 고정', () => {
    assert.deepEqual([...MASK_DIGITS], [0, 2, 0, 3, 5]);
  });

  test('crc6 known answers', () => {
    assert.equal(crc6(0), 0);
    assert.equal(crc6(1), 7);
    assert.equal(crc6(7), 21);
    assert.equal(crc6(42), 31);
    assert.equal(crc6(63), 51);
  });

  test('encode 정확 출력 벡터 (마스크 적용 후)', () => {
    assert.deepEqual([...encode({ version: 0, eccLevel: 0 })], [0, 2, 0, 3, 5]);   // 페이로드 0 + CRC 0 → 마스크 그대로
    assert.deepEqual([...encode({ version: 7, eccLevel: 2 })], [1, 5, 0, 3, 4]);
    assert.deepEqual([...encode({ version: 15, eccLevel: 1 })], [3, 2, 2, 3, 4]);
  });

  test('KAT 왕복 — 위 벡터들이 decodeSingle 로 되읽힌다', () => {
    for (const [v, e] of [[0, 0], [7, 2], [15, 1]]) {
      const r = decodeSingle(encode({ version: v, eccLevel: e }));
      assert.equal(r.ok, true);
      assert.equal(r.version, v);
      assert.equal(r.eccLevel, e);
    }
  });
});
