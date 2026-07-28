/**
 * rs.test.js — Reed-Solomon 부호의 **정의적 성질** 검증
 *
 * 원칙: 외부 테스트 벡터를 쓰지 않는다. RS 의 정의는
 *   "유효 코드워드는 g(x) 의 근 α^(fcr+i), i = 0..nsym-1 에서 전부 0"
 * 이므로, 임의 메시지·임의 nsym 에 대해 이 성질을 직접 단언한다.
 * 이게 성립하면 인코더는 사실상 맞다 (특정 벡터가 맞는 것보다 강한 진술).
 *
 * 복호는 "t = ⌊nsym/2⌋ 개까지의 임의 위치·임의 값 오류를 복원한다" 를
 * 고정 시드 난수로 수백 회 반복해 검증하고, t+1 개일 때의 **조용한 오정정률**
 * 을 실측한다 (RS 의 원리적 한계이므로 0 일 필요는 없지만 숫자를 알아야 한다).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { alphaPow, polyEval, mul } from '../src/gf256.js';
import {
  MAX_CODEWORD_LEN,
  DEFAULT_FCR,
  ECC_LEVELS,
  DEFAULT_ECC_LEVEL,
  RSDecodeError,
  rsGeneratorPoly,
  rsEncode,
  rsSyndromes,
  rsDecode,
  rsDecodeMessage,
  nsymForLevel,
  errorCapacity,
  maxDataLen,
} from '../src/rs.js';

// ── 테스트 전용 도구 ────────────────────────────────────────────────────

/** 결정적 PRNG (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randBytes(rand, len) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

/** 서로 다른 위치 count 개에 **반드시 값이 바뀌는** 오류를 주입한다. */
function injectErrors(rand, cw, count) {
  const codeword = cw.slice();
  const positions = new Set();
  while (positions.size < count) positions.add(Math.floor(rand() * codeword.length));
  for (const p of positions) {
    let e = 0;
    while (e === 0) e = Math.floor(rand() * 256); // 크기 0 = 오류 아님
    codeword[p] ^= e;
  }
  return { codeword, positions: [...positions].sort((a, b) => a - b) };
}

const bytes = (u8) => Array.from(u8);

// ── 생성 다항식 ─────────────────────────────────────────────────────────

describe('생성 다항식 g(x)', () => {
  test('차수 === nsym, 최고차 계수 === 1 (모닉)', () => {
    for (const nsym of [1, 2, 3, 4, 8, 10, 16, 32, 64, 128]) {
      const g = rsGeneratorPoly(nsym);
      assert.equal(g.length - 1, nsym, `nsym=${nsym} 차수 불일치`);
      assert.equal(g[0], 1, `nsym=${nsym} 모닉 아님`);
    }
  });

  test('g(α^(fcr+i)) === 0 for i = 0..nsym-1 (정의)', () => {
    for (const fcr of [0, 1, 2, 7, 200]) {
      for (const nsym of [1, 2, 4, 8, 16, 31]) {
        const g = rsGeneratorPoly(nsym, { fcr });
        for (let i = 0; i < nsym; i++) {
          assert.equal(polyEval(g, alphaPow(fcr + i)), 0, `fcr=${fcr} nsym=${nsym} i=${i}`);
        }
      }
    }
  });

  test('근은 정확히 nsym 개 — 그 밖의 α^j 에서는 0 이 아니다', () => {
    const nsym = 8;
    const fcr = 0;
    const g = rsGeneratorPoly(nsym, { fcr });
    let extraRoots = 0;
    for (let j = 0; j < 255; j++) {
      const isDesignedRoot = j >= fcr && j < fcr + nsym;
      const v = polyEval(g, alphaPow(j));
      if (!isDesignedRoot && v === 0) extraRoots++;
      if (isDesignedRoot) assert.equal(v, 0);
    }
    assert.equal(extraRoots, 0, '설계 근 밖에서 0 이 나온다 — 차수/생성 로직 오류');
  });

  test('결정성: 같은 인자면 같은 다항식', () => {
    assert.deepEqual(bytes(rsGeneratorPoly(10)), bytes(rsGeneratorPoly(10)));
    assert.deepEqual(bytes(rsGeneratorPoly(10, { fcr: 3 })), bytes(rsGeneratorPoly(10, { fcr: 3 })));
    assert.notDeepEqual(bytes(rsGeneratorPoly(10)), bytes(rsGeneratorPoly(10, { fcr: 3 })));
  });

  test('잘못된 인자는 예외', () => {
    assert.throws(() => rsGeneratorPoly(0), RangeError);
    assert.throws(() => rsGeneratorPoly(-1), RangeError);
    assert.throws(() => rsGeneratorPoly(256), RangeError);
    assert.throws(() => rsGeneratorPoly(4.5), RangeError);
    assert.throws(() => rsGeneratorPoly(4, { fcr: -1 }), RangeError);
  });
});

// ── 부호화: 정의적 성질 ─────────────────────────────────────────────────

describe('부호화 — 정의적 성질', () => {
  test('임의 메시지·임의 nsym: 코드워드가 α^(fcr+i) 에서 전부 0', () => {
    const rand = rng(0x5eed01);
    for (const fcr of [0, 1, 5]) {
      for (const nsym of [1, 2, 3, 4, 7, 8, 16, 32]) {
        for (let trial = 0; trial < 25; trial++) {
          const msgLen = 1 + Math.floor(rand() * 60);
          const msg = randBytes(rand, msgLen);
          const cw = rsEncode(msg, nsym, { fcr });
          for (let i = 0; i < nsym; i++) {
            assert.equal(
              polyEval(cw, alphaPow(fcr + i)),
              0,
              `fcr=${fcr} nsym=${nsym} msgLen=${msgLen} i=${i}`,
            );
          }
        }
      }
    }
  });

  test('신드롬이 전부 0 (위 성질의 API 표현)', () => {
    const rand = rng(0x5eed02);
    for (let trial = 0; trial < 200; trial++) {
      const nsym = 2 + Math.floor(rand() * 30);
      const msg = randBytes(rand, 1 + Math.floor(rand() * 100));
      const cw = rsEncode(msg, nsym);
      assert.deepEqual(bytes(rsSyndromes(cw, nsym)), new Array(nsym).fill(0));
    }
  });

  test('체계적: 코드워드 앞부분 === 메시지, 길이 === msgLen + nsym', () => {
    const rand = rng(0x5eed03);
    for (let trial = 0; trial < 200; trial++) {
      const nsym = 1 + Math.floor(rand() * 40);
      const msg = randBytes(rand, 1 + Math.floor(rand() * 100));
      const cw = rsEncode(msg, nsym);
      assert.equal(cw.length, msg.length + nsym);
      assert.deepEqual(bytes(cw.slice(0, msg.length)), bytes(msg));
    }
  });

  test('결정성: 같은 입력 → 완전히 같은 출력 (M0 완료 기준)', () => {
    const rand = rng(0x5eed04);
    for (let trial = 0; trial < 50; trial++) {
      const msg = randBytes(rand, 1 + Math.floor(rand() * 80));
      const nsym = 2 + Math.floor(rand() * 20);
      assert.deepEqual(bytes(rsEncode(msg, nsym)), bytes(rsEncode(msg, nsym)));
    }
  });

  test('generator 옵션 재사용 결과 === 매번 재계산 결과', () => {
    const rand = rng(0x5eed05);
    const nsym = 12;
    const g = rsGeneratorPoly(nsym);
    for (let trial = 0; trial < 50; trial++) {
      const msg = randBytes(rand, 1 + Math.floor(rand() * 60));
      assert.deepEqual(bytes(rsEncode(msg, nsym, { generator: g })), bytes(rsEncode(msg, nsym)));
    }
    assert.throws(() => rsEncode([1, 2, 3], nsym, { generator: rsGeneratorPoly(4) }), RangeError);
  });

  test('선형성: RS 는 선형 부호 — enc(a) ^ enc(b) === enc(a ^ b)', () => {
    const rand = rng(0x5eed06);
    const nsym = 8;
    for (let trial = 0; trial < 100; trial++) {
      const len = 1 + Math.floor(rand() * 50);
      const a = randBytes(rand, len);
      const b = randBytes(rand, len);
      const x = new Uint8Array(len);
      for (let i = 0; i < len; i++) x[i] = a[i] ^ b[i];
      const ea = rsEncode(a, nsym);
      const eb = rsEncode(b, nsym);
      const ex = rsEncode(x, nsym);
      for (let i = 0; i < ex.length; i++) assert.equal(ex[i], ea[i] ^ eb[i], `i=${i}`);
    }
  });

  test('빈 메시지 경계: 패리티 전부 0 (영 코드워드는 유효 코드워드)', () => {
    const cw = rsEncode(new Uint8Array(0), 6);
    assert.equal(cw.length, 6);
    assert.deepEqual(bytes(cw), [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(bytes(rsSyndromes(cw, 6)), [0, 0, 0, 0, 0, 0]);
  });

  test('길이 1 메시지도 정상', () => {
    for (let v = 0; v < 256; v += 17) {
      const cw = rsEncode(Uint8Array.of(v), 4);
      assert.equal(cw.length, 5);
      assert.equal(cw[0], v);
      assert.deepEqual(bytes(rsSyndromes(cw, 4)), [0, 0, 0, 0]);
    }
  });
});

// ── 경계 / 입력 검증 ────────────────────────────────────────────────────

describe('경계와 입력 검증', () => {
  test('msgLen + nsym === 255 는 성공, 256 은 명확한 에러', () => {
    const ok = rsEncode(new Uint8Array(245), 10);
    assert.equal(ok.length, MAX_CODEWORD_LEN);
    assert.deepEqual(bytes(rsSyndromes(ok, 10)), new Array(10).fill(0));

    assert.throws(() => rsEncode(new Uint8Array(246), 10), (e) => {
      assert.ok(e instanceof RangeError);
      assert.match(e.message, /256 > 255/);
      return true;
    });
    assert.throws(() => rsEncode(new Uint8Array(200), 200), RangeError);
  });

  test('255 길이 코드워드도 t 개까지 정정된다 (최대 블록 경계)', () => {
    const rand = rng(0xb0dee);
    const nsym = 32;
    const msg = randBytes(rand, MAX_CODEWORD_LEN - nsym);
    const cw = rsEncode(msg, nsym);
    assert.equal(cw.length, MAX_CODEWORD_LEN);
    const { codeword } = injectErrors(rand, cw, errorCapacity(nsym));
    const r = rsDecode(codeword, nsym);
    assert.ok(r.ok, r.reason);
    assert.deepEqual(bytes(r.message), bytes(msg));
  });

  test('nsym 범위 위반은 예외', () => {
    assert.throws(() => rsEncode([1, 2, 3], 0), RangeError);
    assert.throws(() => rsEncode([1, 2, 3], -4), RangeError);
    assert.throws(() => rsEncode([1, 2, 3], 1.5), RangeError);
    assert.throws(() => rsEncode([1, 2, 3], 256), RangeError);
  });

  test('바이트 범위 밖 값은 예외', () => {
    assert.throws(() => rsEncode([1, 2, 256], 4), RangeError);
    assert.throws(() => rsEncode([1, -1, 3], 4), RangeError);
    assert.throws(() => rsEncode([1, 2.5, 3], 4), RangeError);
    assert.throws(() => rsEncode('abc', 4), TypeError);
  });

  test('일반 배열 입력도 Uint8Array 와 동일 결과', () => {
    const arr = [72, 101, 108, 108, 111];
    assert.deepEqual(bytes(rsEncode(arr, 6)), bytes(rsEncode(Uint8Array.from(arr), 6)));
  });

  test('복호 입력 경계: 코드워드가 nsym 이하이거나 255 초과면 예외', () => {
    assert.throws(() => rsDecode(new Uint8Array(6), 6), RangeError);
    assert.throws(() => rsDecode(new Uint8Array(5), 6), RangeError);
    assert.throws(() => rsDecode(new Uint8Array(256), 6), RangeError);
  });
});

// ── 복호 ────────────────────────────────────────────────────────────────

describe('복호 — 무손상', () => {
  test('오류 0개: 원본 그대로, errorCount 0, 신드롬 전부 0', () => {
    const rand = rng(0xc1ea0);
    for (let trial = 0; trial < 200; trial++) {
      const nsym = 2 + Math.floor(rand() * 24);
      const msg = randBytes(rand, 1 + Math.floor(rand() * 80));
      const cw = rsEncode(msg, nsym);
      const r = rsDecode(cw, nsym);
      assert.ok(r.ok);
      assert.equal(r.errorCount, 0);
      assert.deepEqual(r.errorPositions, []);
      assert.deepEqual(bytes(r.syndromes), new Array(nsym).fill(0));
      assert.deepEqual(bytes(r.message), bytes(msg));
      assert.deepEqual(bytes(r.codeword), bytes(cw));
      assert.deepEqual(bytes(r.parity), bytes(cw.slice(msg.length)));
    }
  });

  test('rsDecodeMessage 는 무손상 입력에서 메시지를 그대로 돌려준다', () => {
    const msg = Uint8Array.from([1, 2, 3, 4, 5]);
    const cw = rsEncode(msg, 8);
    assert.deepEqual(bytes(rsDecodeMessage(cw, 8)), bytes(msg));
  });
});

describe('복호 — t 개 오류 정정', () => {
  test('임의 위치·임의 값 t 개 오류를 항상 복원 (고정 시드 다수 반복)', () => {
    const rand = rng(0x7e57);
    const configs = [
      { nsym: 2, msgLen: 10 },
      { nsym: 3, msgLen: 12 }, // 홀수 nsym → t = 1
      { nsym: 4, msgLen: 20 },
      { nsym: 8, msgLen: 40 },
      { nsym: 10, msgLen: 30 },
      { nsym: 16, msgLen: 60 },
      { nsym: 32, msgLen: 100 },
      { nsym: 64, msgLen: 191 },
    ];
    let total = 0;
    for (const { nsym, msgLen } of configs) {
      const t = errorCapacity(nsym);
      for (let trial = 0; trial < 60; trial++) {
        const msg = randBytes(rand, msgLen);
        const cw = rsEncode(msg, nsym);
        const { codeword, positions } = injectErrors(rand, cw, t);
        const r = rsDecode(codeword, nsym);
        assert.ok(r.ok, `nsym=${nsym} trial=${trial} 실패: ${r.reason}`);
        assert.deepEqual(bytes(r.message), bytes(msg), `nsym=${nsym} trial=${trial}`);
        assert.deepEqual(bytes(r.codeword), bytes(cw));
        assert.deepEqual(r.errorPositions, positions, '보고된 오류 위치가 주입 위치와 다르다');
        assert.equal(r.errorCount, t);
        total++;
      }
    }
    assert.equal(total, configs.length * 60);
  });

  test('1..t 개 오류 전 구간에서 복원 (개수별)', () => {
    const rand = rng(0x7e58);
    const nsym = 16;
    const t = errorCapacity(nsym);
    for (let e = 0; e <= t; e++) {
      for (let trial = 0; trial < 20; trial++) {
        const msg = randBytes(rand, 50);
        const cw = rsEncode(msg, nsym);
        const { codeword, positions } = injectErrors(rand, cw, e);
        const r = rsDecode(codeword, nsym);
        assert.ok(r.ok, `e=${e} 실패: ${r.reason}`);
        assert.deepEqual(bytes(r.message), bytes(msg), `e=${e}`);
        assert.deepEqual(r.errorPositions, positions, `e=${e}`);
      }
    }
  });

  test('패리티 영역만 손상돼도 복원 (오류가 메시지에 없어도 됨)', () => {
    const rand = rng(0x7e59);
    const nsym = 10;
    const msg = randBytes(rand, 30);
    const cw = rsEncode(msg, nsym);
    const corrupted = cw.slice();
    for (let i = 0; i < 5; i++) corrupted[msg.length + i] ^= 0xa5;
    const r = rsDecode(corrupted, nsym);
    assert.ok(r.ok, r.reason);
    assert.deepEqual(bytes(r.codeword), bytes(cw));
  });

  test('연집(burst) 오류 t 개 — 인접 위치도 동일하게 정정', () => {
    const rand = rng(0x7e5a);
    const nsym = 12;
    const t = errorCapacity(nsym);
    for (let trial = 0; trial < 60; trial++) {
      const msg = randBytes(rand, 40);
      const cw = rsEncode(msg, nsym);
      const start = Math.floor(rand() * (cw.length - t));
      const corrupted = cw.slice();
      for (let i = 0; i < t; i++) {
        let e = 0;
        while (e === 0) e = Math.floor(rand() * 256);
        corrupted[start + i] ^= e;
      }
      const r = rsDecode(corrupted, nsym);
      assert.ok(r.ok, `trial=${trial} 실패: ${r.reason}`);
      assert.deepEqual(bytes(r.message), bytes(msg));
    }
  });

  test('fcr != 0 에서도 부호화·복호가 왕복한다', () => {
    const rand = rng(0x7e5b);
    for (const fcr of [0, 1, 2, 120, 254]) {
      const nsym = 8;
      const t = errorCapacity(nsym);
      for (let trial = 0; trial < 30; trial++) {
        const msg = randBytes(rand, 30);
        const cw = rsEncode(msg, nsym, { fcr });
        assert.deepEqual(bytes(rsSyndromes(cw, nsym, { fcr })), new Array(nsym).fill(0));
        const { codeword, positions } = injectErrors(rand, cw, t);
        const r = rsDecode(codeword, nsym, { fcr });
        assert.ok(r.ok, `fcr=${fcr} 실패: ${r.reason}`);
        assert.deepEqual(bytes(r.message), bytes(msg), `fcr=${fcr}`);
        assert.deepEqual(r.errorPositions, positions, `fcr=${fcr}`);
      }
    }
  });

  test('복호는 입력 배열을 변형하지 않는다', () => {
    const rand = rng(0x7e5c);
    const msg = randBytes(rand, 20);
    const cw = rsEncode(msg, 8);
    const { codeword } = injectErrors(rand, cw, 4);
    const snapshot = bytes(codeword);
    rsDecode(codeword, 8);
    assert.deepEqual(bytes(codeword), snapshot);
  });

  test('복호 결정성: 같은 입력 → 같은 결과', () => {
    const rand = rng(0x7e5d);
    const msg = randBytes(rand, 40);
    const cw = rsEncode(msg, 12);
    const { codeword } = injectErrors(rand, cw, 6);
    const a = rsDecode(codeword, 12);
    const b = rsDecode(codeword, 12);
    assert.deepEqual(bytes(a.codeword), bytes(b.codeword));
    assert.deepEqual(a.errorPositions, b.errorPositions);
  });
});

// ── 정정 한계 초과 ──────────────────────────────────────────────────────

describe('복호 — 정정 한계 초과 (t+1 개 오류)', () => {
  test('불변식: ok:true 를 돌려주면 결과는 반드시 유효 코드워드다', (ctx) => {
    // 조용한 오정정이 일어나더라도 "쓰레기"를 돌려주지는 않는다는 계약.
    // t+1 개 오류에서는 원본과 거리 t+1 이므로 "맞게 복원" 은 원리적으로 불가 —
    // ok:true 는 전부 오정정(다른 유효 코드워드)이어야 한다.
    const rand = rng(0xfa11);
    const configs = [
      { nsym: 2, msgLen: 10 },
      { nsym: 4, msgLen: 20 },
      { nsym: 6, msgLen: 20 },
      { nsym: 8, msgLen: 40 },
      { nsym: 16, msgLen: 60 },
    ];
    const lines = [];
    for (const { nsym, msgLen } of configs) {
      const t = errorCapacity(nsym);
      const trials = 1000;
      let reported = 0;
      let silent = 0;
      for (let trial = 0; trial < trials; trial++) {
        const msg = randBytes(rand, msgLen);
        const cw = rsEncode(msg, nsym);
        const { codeword } = injectErrors(rand, cw, t + 1);
        const r = rsDecode(codeword, nsym);
        if (!r.ok) {
          reported++;
          assert.equal(r.errorPositions, null);
          assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
          continue;
        }
        // ok:true 면 신드롬이 전부 0 인 유효 코드워드여야 한다.
        assert.deepEqual(
          bytes(rsSyndromes(r.codeword, nsym)),
          new Array(nsym).fill(0),
          'ok:true 인데 유효 코드워드가 아니다 — 계약 위반',
        );
        assert.notDeepEqual(
          bytes(r.message),
          bytes(msg),
          't+1 오류인데 원본이 복원됐다 — 오류 주입이 잘못됐다',
        );
        silent++;
      }
      assert.equal(reported + silent, trials);
      const rate = (silent / trials) * 100;
      lines.push(`nsym=${nsym} t=${t} n=${msgLen + nsym}: 실패보고 ${((reported / trials) * 100).toFixed(2)}% / 조용한 오정정 ${rate.toFixed(2)}%`);

      // 상한은 유계거리 복호의 부피 상한 V_t(n)/q^nsym 을 따른다.
      // nsym=2(t=1) 이 가장 취약: V_1/q^2 = (1 + n·255)/65536 ≈ 4.7%.
      const bound = nsym === 2 ? 10 : nsym === 4 ? 3 : 1;
      assert.ok(rate < bound, `조용한 오정정률 ${rate.toFixed(2)}% >= 상한 ${bound}%`);
    }
    for (const l of lines) ctx.diagnostic(l);
  });

  test('t+2 이상 대량 오류: 대부분 실패로 보고되고, 성공 시엔 유효 코드워드', () => {
    const rand = rng(0xfa12);
    const nsym = 8;
    const t = errorCapacity(nsym);
    let reported = 0;
    const trials = 500;
    for (let trial = 0; trial < trials; trial++) {
      const msg = randBytes(rand, 40);
      const cw = rsEncode(msg, nsym);
      const { codeword } = injectErrors(rand, cw, t + 2 + Math.floor(rand() * 10));
      const r = rsDecode(codeword, nsym);
      if (!r.ok) reported++;
      else {
        assert.deepEqual(bytes(rsSyndromes(r.codeword, nsym)), new Array(nsym).fill(0));
      }
    }
    assert.ok(reported / trials > 0.9, `실패 보고율 ${(reported / trials) * 100}% 가 너무 낮다`);
  });

  test('rsDecodeMessage 는 정정 불가 시 RSDecodeError 를 던진다 (조용히 반환 금지)', () => {
    const rand = rng(0xfa13);
    const nsym = 8;
    const msg = randBytes(rand, 40);
    const cw = rsEncode(msg, nsym);
    // 전체를 망가뜨리면 확실히 정정 불가
    const wrecked = cw.slice();
    for (let i = 0; i < wrecked.length; i++) wrecked[i] ^= 0xff;
    assert.throws(
      () => rsDecodeMessage(wrecked, nsym),
      (e) => {
        assert.ok(e instanceof RSDecodeError);
        assert.equal(e.name, 'RSDecodeError');
        assert.ok(typeof e.reason === 'string' && e.reason.length > 0);
        assert.ok(e.syndromes instanceof Uint8Array);
        return true;
      },
    );
  });

  test('rsDecode 는 정정 불가를 예외 대신 ok:false 로 알린다', () => {
    const rand = rng(0xfa14);
    const nsym = 4;
    const msg = randBytes(rand, 20);
    const cw = rsEncode(msg, nsym);
    const wrecked = cw.slice();
    for (let i = 0; i < wrecked.length; i++) wrecked[i] = (wrecked[i] + 7) & 0xff;
    const r = rsDecode(wrecked, nsym);
    assert.equal(r.ok, false);
    assert.equal(r.errorPositions, null);
    assert.match(r.reason, /정정|불가|한계|신드롬/);
  });
});

// ── ECC 레벨 헬퍼 ───────────────────────────────────────────────────────

describe('ECC 레벨 → nsym', () => {
  test('SPEC §6 비율: L 12% / M 25% / H 40%, 기본 M', () => {
    assert.deepEqual(ECC_LEVELS, { L: 0.12, M: 0.25, H: 0.4 });
    assert.equal(DEFAULT_ECC_LEVEL, 'M');
    assert.equal(DEFAULT_FCR, 0);
    assert.equal(nsymForLevel(100), nsymForLevel(100, 'M'));
  });

  test('레벨이 높을수록 nsym 이 크다 (단조)', () => {
    for (let len = 4; len <= 150; len += 7) {
      const l = nsymForLevel(len, 'L');
      const m = nsymForLevel(len, 'M');
      const h = nsymForLevel(len, 'H');
      assert.ok(l <= m && m <= h, `len=${len}: L=${l} M=${m} H=${h}`);
    }
  });

  test('데이터가 길수록 nsym 이 줄지 않는다 (단조)', () => {
    let prev = 0;
    for (let len = 0; len <= 150; len++) {
      const n = nsymForLevel(len, 'M');
      assert.ok(n >= prev, `len=${len}: ${n} < ${prev}`);
      prev = n;
    }
  });

  test("basis='codeword' 기본값: nsym/(data+nsym) 이 목표 비율에 근접", () => {
    for (const level of ['L', 'M', 'H']) {
      for (const len of [40, 66, 100, 120]) {
        const nsym = nsymForLevel(len, level);
        const actual = nsym / (len + nsym);
        assert.ok(
          Math.abs(actual - ECC_LEVELS[level]) < 0.03,
          `${level} len=${len}: 실제 ${(actual * 100).toFixed(1)}% vs 목표 ${ECC_LEVELS[level] * 100}%`,
        );
      }
    }
  });

  test("basis='data' 는 nsym/data 를 목표 비율에 맞춘다 (기본값과 다름)", () => {
    for (const len of [40, 66, 100]) {
      const nsym = nsymForLevel(len, 'M', { basis: 'data' });
      assert.ok(Math.abs(nsym / len - 0.25) < 0.05, `len=${len} nsym=${nsym}`);
      assert.ok(nsym < nsymForLevel(len, 'M'), 'data basis 가 codeword basis 보다 작아야 한다');
    }
  });

  test('SPEC §5.5 용량표와 정합 — V3: 데이터 66 B + ECC-M → 총 88 심볼', () => {
    // SPEC §5.5: V3 gross ~88 B, ECC-M(25%) 순 페이로드 ~66 B.
    // basis='codeword' 기본값이 이 표를 정확히 재현한다는 것이 기본값의 근거다.
    assert.equal(nsymForLevel(66, 'M'), 22);
    assert.equal(66 + nsymForLevel(66, 'M'), 88);
    // V2: gross ~53 B, 순 ~40 B
    assert.equal(40 + nsymForLevel(40, 'M'), 54); // 반올림·짝수화로 53 이 아닌 54
    // V1: gross ~26 B, 순 ~19 B
    assert.equal(19 + nsymForLevel(19, 'M'), 25);
  });

  test('forceEven 기본값 true → nsym 은 항상 짝수, false 면 홀수 허용', () => {
    for (let len = 1; len <= 120; len++) {
      assert.equal(nsymForLevel(len, 'M') % 2, 0, `len=${len}`);
    }
    let sawOdd = false;
    for (let len = 1; len <= 120; len++) {
      if (nsymForLevel(len, 'M', { forceEven: false }) % 2 === 1) sawOdd = true;
    }
    assert.ok(sawOdd, 'forceEven:false 인데 홀수가 하나도 안 나온다');
  });

  test('minNsym 하한: 아주 짧은 데이터도 t >= 1 을 보장', () => {
    for (let len = 0; len <= 8; len++) {
      const nsym = nsymForLevel(len, 'L');
      assert.ok(nsym >= 2, `len=${len} nsym=${nsym}`);
      assert.ok(errorCapacity(nsym) >= 1);
    }
  });

  test('255 를 넘기면 명확한 에러 — 조용한 절삭 금지', () => {
    assert.throws(() => nsymForLevel(250, 'H'), /255/);
    assert.throws(() => nsymForLevel(200, 'H'), RangeError);
    assert.throws(() => nsymForLevel(250, 'L'), RangeError); // 250 + 34 = 284
    // 같은 데이터 길이라도 레벨이 낮으면 통과하는 지점이 있다
    const nsym = nsymForLevel(220, 'L');
    assert.ok(220 + nsym <= MAX_CODEWORD_LEN, `220 + ${nsym} > ${MAX_CODEWORD_LEN}`);
    // 통과한 값은 실제로 부호화까지 된다 (헬퍼가 거짓말하지 않는다)
    assert.equal(rsEncode(new Uint8Array(220), nsym).length, 220 + nsym);
  });

  test('잘못된 인자는 예외', () => {
    assert.throws(() => nsymForLevel(-1, 'M'), RangeError);
    assert.throws(() => nsymForLevel(1.5, 'M'), RangeError);
    assert.throws(() => nsymForLevel(10, 'Q'), RangeError);
    assert.throws(() => nsymForLevel(10, 'M', { basis: 'nope' }), RangeError);
  });

  test('errorCapacity / maxDataLen', () => {
    assert.equal(errorCapacity(2), 1);
    assert.equal(errorCapacity(3), 1); // 홀수는 내림
    assert.equal(errorCapacity(10), 5);
    assert.equal(maxDataLen(10), 245);
    assert.equal(maxDataLen(255), 0);
    assert.throws(() => errorCapacity(0), RangeError);
    assert.throws(() => maxDataLen(0), RangeError);
  });

  test('ECC 레벨별 실제 정정 능력이 표기 비율을 만족한다 (왕복 검증)', () => {
    const rand = rng(0xecc0);
    for (const level of ['L', 'M', 'H']) {
      const msgLen = 60;
      const nsym = nsymForLevel(msgLen, level);
      const t = errorCapacity(nsym);
      for (let trial = 0; trial < 30; trial++) {
        const msg = randBytes(rand, msgLen);
        const cw = rsEncode(msg, nsym);
        const { codeword } = injectErrors(rand, cw, t);
        const r = rsDecode(codeword, nsym);
        assert.ok(r.ok, `${level} 실패: ${r.reason}`);
        assert.deepEqual(bytes(r.message), bytes(msg));
      }
      // 심볼 오류율 관점: t / n
      const symbolErrorRate = t / (msgLen + nsym);
      assert.ok(symbolErrorRate > 0, `${level} 정정 가능 심볼 오류율 ${symbolErrorRate}`);
    }
  });
});

// ── SPEC §2 H2 관련 참고 성질 ───────────────────────────────────────────

describe('SPEC 관련 성질', () => {
  test('ECC-M 은 **RS 바이트** 오류율 8% 를 흡수한다', () => {
    // ⚠ 이 테스트는 SPEC §2 H2 를 검증하지 **않는다**. 재는 양이 다르다.
    //
    //   여기서 재는 것: RS 코드워드 **바이트**에 8% 오류 → 흡수됨 (아래에서 통과)
    //   H2 가 말하는 것: **셀(base-6 digit)** 오류율 8% — SPEC §4.1/§5.5 의 "심볼"
    //
    // 둘은 같지 않다. base-6 청크(25 digit ↔ 8 byte)에서 digit 1개 오류는 평균
    // 3.47 바이트를 오염시키므로(실측), 셀 오류율 8% 는 바이트 40~50% 손상으로
    // 증폭된다. 실측 복호 성공률:
    //
    //   V3 ECC-M · 바이트 8% 오류  → 97.0%   ← 이 테스트
    //   V3 ECC-M · 셀   8% 오류    →  0.0%   ← H2 가 주장하는 것
    //
    // 즉 H2 의 "<8% @ ECC-M" 은 심볼=바이트로 읽을 때만 성립하고, 심볼=셀로 읽으면
    // 실측 한계는 0.2~0.5% 다. M1 킬 기준이 이 숫자에 걸려 있다.
    // → `.agent/_lessons/001_base6_error_amplification.md` · `_questions/open/` 참조.
    //
    // 이 테스트는 그대로 유효하다 — 다만 **RS 계층의 성질**이지 H2 의 검증이 아니다.
    const rand = rng(0x82);
    for (const msgLen of [19, 40, 66, 100]) {
      const nsym = nsymForLevel(msgLen, 'M');
      const n = msgLen + nsym;
      const t = errorCapacity(nsym);
      assert.ok(t / n >= 0.08, `msgLen=${msgLen}: t/n = ${(t / n).toFixed(4)} < 0.08`);

      // 8% 오류를 실제로 주입해 복원되는지
      const errCount = Math.floor(n * 0.08);
      for (let trial = 0; trial < 20; trial++) {
        const msg = randBytes(rand, msgLen);
        const cw = rsEncode(msg, nsym);
        const { codeword } = injectErrors(rand, cw, errCount);
        const r = rsDecode(codeword, nsym);
        assert.ok(r.ok, `msgLen=${msgLen} 8% 오류 복원 실패: ${r.reason}`);
        assert.deepEqual(bytes(r.message), bytes(msg));
      }
    }
  });

  test('GF 곱셈이 rs 모듈에서도 같은 체를 쓴다 (모듈 간 일관성)', () => {
    // rs.js 가 다른 체를 import 했다면 생성 다항식 근 검증이 깨진다.
    const g = rsGeneratorPoly(2);
    // g(x) = (x + α^0)(x + α^1) = x^2 + (1+α)x + α
    assert.equal(g[0], 1);
    assert.equal(g[1], 1 ^ alphaPow(1));
    assert.equal(g[2], mul(alphaPow(0), alphaPow(1)));
  });
});
