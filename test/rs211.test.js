import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P, alphaPow } from '../src/gfp.js';
import {
  MAX_CODEWORD_LEN,
  NSYM_TABLE,
  rsGeneratorPoly,
  rsEncode,
  rsSyndromes,
  rsDecode,
  rsDecodeMessage,
  RSDecodeError,
  errorCapacity,
  maxDataLen,
} from '../src/rs211.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randMsg(rnd, len) {
  return Array.from({ length: len }, () => Math.floor(rnd() * P));
}

/** 코드워드에 정확히 count 개의 서로 다른 위치에 0 이 아닌 오류를 주입한다. */
function injectErrors(codeword, count, rnd) {
  const out = codeword.slice();
  const positions = new Set();
  while (positions.size < count) {
    positions.add(Math.floor(rnd() * out.length));
  }
  for (const pos of positions) {
    let delta = 1 + Math.floor(rnd() * (P - 1)); // 1..210, 0 이 아님
    out[pos] = (out[pos] + delta) % P;
  }
  return { corrupted: out, positions: [...positions].sort((a, b) => a - b) };
}

// ── RS 정의 성질 ────────────────────────────────────────────────────────

test('유효 코드워드는 α^(fcr+i) 에서 평가가 전부 0 (임의 메시지·임의 nsym)', () => {
  const rnd = mulberry32(10);
  for (let trial = 0; trial < 100; trial++) {
    const nsym = 1 + Math.floor(rnd() * 20);
    const msgLen = 1 + Math.floor(rnd() * 30);
    if (msgLen + nsym > MAX_CODEWORD_LEN) continue;
    const fcr = Math.floor(rnd() * 3);
    const msg = randMsg(rnd, msgLen);
    const cw = rsEncode(msg, nsym, { fcr });
    for (let i = 0; i < nsym; i++) {
      let y = 0;
      const root = alphaPow(fcr + i);
      for (const c of cw) y = (y * root + c) % P; // Horner, big-endian
      assert.equal(y, 0, `trial=${trial} i=${i}`);
    }
    const synd = rsSyndromes(cw, nsym, { fcr });
    assert.ok(synd.every((s) => s === 0));
  }
});

test('생성다항식 g(x) 는 모닉이고 차수 = nsym', () => {
  for (const nsym of [1, 2, 7, 23, 92, 210]) {
    const g = rsGeneratorPoly(nsym);
    assert.equal(g.length, nsym + 1);
    assert.equal(g[0], 1);
  }
});

test('결정성 — 같은 입력은 항상 같은 코드워드', () => {
  const msg = [1, 2, 3, 4, 5, 200, 199];
  const a = rsEncode(msg, 10);
  const b = rsEncode(msg, 10);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('n > 210 은 거부된다', () => {
  assert.throws(() => rsEncode(new Array(200).fill(0), 20)); // 220 > 210
  assert.throws(() => rsDecode(new Array(220).fill(0), 20));
});

// ── nsym 규범 표 (ADR §3.3.2) ──────────────────────────────────────────

test('nsym 표: V1/V2/V3 심볼 수·M·t', () => {
  assert.equal(NSYM_TABLE.V1.symbols, 27);
  // T8 오버헤드 대사 (2026-08-08): overhead 49 → 데이터 셀 168 = 56·3 → symbols 56.
  // nsym(L7/M14/H22)은 불변 — M=14 는 56 기준 패리티율 정확히 25.0%.
  assert.equal(NSYM_TABLE.V2.symbols, 56);
  assert.equal(NSYM_TABLE.V3.symbols, 92);
  assert.equal(NSYM_TABLE.V1.M, 7);
  assert.equal(NSYM_TABLE.V2.M, 14);
  assert.equal(NSYM_TABLE.V3.M, 23);
});

test('V3 에서 nsym=23 이 t=11 이고 패리티율 정확히 25.0%(=23/92)', () => {
  const { symbols, M } = NSYM_TABLE.V3;
  assert.equal(M, 23);
  assert.equal(errorCapacity(M), 11);
  assert.equal(M / symbols, 0.25);
});

test('errorCapacity / maxDataLen 일관성', () => {
  assert.equal(errorCapacity(23), 11);
  assert.equal(errorCapacity(22), 11);
  assert.equal(maxDataLen(23), MAX_CODEWORD_LEN - 23);
  assert.throws(() => errorCapacity(0));
  assert.throws(() => errorCapacity(211));
});

// ── 오류 정정 — t 개까지 성공, t+1 은 검출 ─────────────────────────────

test('t = ⌊nsym/2⌋ 개 오류 임의 주입 → 항상 복원 (고정 시드, 수백 회)', () => {
  const rnd = mulberry32(20);
  const nsym = 23;
  const msgLen = 69; // V3 상당
  const t = errorCapacity(nsym);
  let successes = 0;
  const trials = 400;
  for (let i = 0; i < trials; i++) {
    const msg = randMsg(rnd, msgLen);
    const cw = rsEncode(msg, nsym);
    const { corrupted } = injectErrors(cw, t, rnd);
    const result = rsDecode(corrupted, nsym);
    if (result.ok && Array.from(result.message).every((v, k) => v === msg[k])) {
      successes++;
    } else {
      assert.fail(`trial ${i}: t=${t} 오류 정정 실패 — ${result.ok ? '값 불일치' : result.reason}`);
    }
  }
  assert.equal(successes, trials);
});

test('t+1 개 오류 주입 → 실패로 검출 (조용한 오정정률 측정)', () => {
  const rnd = mulberry32(21);
  const nsym = 23;
  const msgLen = 69;
  const t = errorCapacity(nsym);
  const trials = 400;
  let detectedFail = 0;
  let silentMiscorrect = 0;
  for (let i = 0; i < trials; i++) {
    const msg = randMsg(rnd, msgLen);
    const cw = rsEncode(msg, nsym);
    const { corrupted } = injectErrors(cw, t + 1, rnd);
    const result = rsDecode(corrupted, nsym);
    if (!result.ok) {
      detectedFail++;
    } else if (!Array.from(result.message).every((v, k) => v === msg[k])) {
      silentMiscorrect++;
    }
    // ok:true 이면서 값이 같다면 그건 오정정이 아니라 우연히 원래 코드워드로
    // 돌아온 것 — t+1 오류에서는 이론상 가능하지만 실무적으로 거의 없다.
  }
  // t+1 은 정정 보장 범위 밖이라 100% 검출을 요구하지 않는다. 다만 압도적
  // 다수는 검출돼야 하고(설계 의도), 조용한 오정정률을 그대로 보고한다.
  assert.ok(detectedFail + silentMiscorrect === trials || detectedFail > trials * 0.5,
    `t+1 오류에서 검출 실패 비율이 비정상적으로 낮다: detected=${detectedFail}/${trials}`);
  // numbers_check 보고용 — 이 값 자체가 성질이다(무결점 신뢰 X). 상한을 두지 않되 기록한다.
  console.log(`[rs211] t+1(=${t + 1}) 오류: 검출=${detectedFail}/${trials}, 조용한 오정정=${silentMiscorrect}/${trials}`);
});

test('오류 없음 → 신드롬 전부 0, 코드워드 그대로 반환', () => {
  const rnd = mulberry32(22);
  const msg = randMsg(rnd, 40);
  const cw = rsEncode(msg, 16);
  const result = rsDecode(cw, 16);
  assert.ok(result.ok);
  assert.equal(result.errorCount, 0);
  assert.deepEqual(Array.from(result.message), msg);
});

test('rsDecodeMessage — 성공 시 메시지만, 실패 시 RSDecodeError', () => {
  const rnd = mulberry32(23);
  const msg = randMsg(rnd, 20);
  const nsym = 10;
  const cw = rsEncode(msg, nsym);
  const t = errorCapacity(nsym);
  const { corrupted } = injectErrors(cw, t, rnd);
  const recovered = rsDecodeMessage(corrupted, nsym);
  assert.deepEqual(Array.from(recovered), msg);

  const overCorrupted = injectErrors(cw, nsym, rnd).corrupted; // 확실히 t 초과
  assert.throws(() => rsDecodeMessage(overCorrupted, nsym), RSDecodeError);
});

// ── 버스트 경계 (ADR §8.4: 3t−2 항상 보장, 이 값은 셀 단위이므로 심볼
//    도메인 테스트에서는 "연속 심볼 오류"로 근사 검증한다) ──────────────

test('연속(버스트) 심볼 오류 t개 → 정정 성공', () => {
  const rnd = mulberry32(24);
  const nsym = 23;
  const msgLen = 69;
  const t = errorCapacity(nsym);
  for (let trial = 0; trial < 50; trial++) {
    const msg = randMsg(rnd, msgLen);
    const cw = rsEncode(msg, nsym);
    const start = Math.floor(rnd() * (cw.length - t));
    const corrupted = cw.slice();
    for (let k = 0; k < t; k++) {
      const pos = start + k;
      const delta = 1 + Math.floor(rnd() * (P - 1));
      corrupted[pos] = (corrupted[pos] + delta) % P;
    }
    const result = rsDecode(corrupted, nsym);
    assert.ok(result.ok, `trial=${trial} 버스트 정정 실패: ${result.ok ? '' : result.reason}`);
    assert.deepEqual(Array.from(result.message), msg);
  }
});

// ── ADR 대조 (numbers_check) ───────────────────────────────────────────
// V3(92심볼, nsym=23) 에서 "셀 2% 상당" = 심볼 오류율 5.88% 주입 시
// ADR 의 99.4% 와 ±2%p 이내로 정합하는지 측정한다.

test('ADR 대조 — V3(92심볼,nsym=23) 심볼오류율 5.88% 성공률', () => {
  // ADR §2.4/§9.3 의 실측은 "정확히 k개 오류" 고정 주입이 아니라 심볼별
  // 독립 확률 ε 의 베르누이 과정이다 (그래야 t=11 을 넘는 꼬리가 생겨
  // 99.4% 같은 <100% 값이 나온다). errCount 를 total*errRate 로 고정하면
  // 항상 t 이내라 100% 로 트리비얼해진다 — 그 오류를 여기서 바로잡는다.
  const rnd = mulberry32(30);
  const nsym = 23;
  const total = 92;
  const msgLen = total - nsym; // 69
  const errRate = 0.0588; // "셀 오류율 2% 상당" (ADR §2.4)
  const trials = 3000;
  let ok = 0;
  for (let i = 0; i < trials; i++) {
    const msg = randMsg(rnd, msgLen);
    const cw = rsEncode(msg, nsym);
    const corrupted = cw.slice();
    for (let pos = 0; pos < corrupted.length; pos++) {
      if (rnd() < errRate) {
        const delta = 1 + Math.floor(rnd() * (P - 1));
        corrupted[pos] = (corrupted[pos] + delta) % P;
      }
    }
    const result = rsDecode(corrupted, nsym);
    if (result.ok && Array.from(result.message).every((v, k) => v === msg[k])) ok++;
  }
  const successRate = (ok / trials) * 100;
  console.log(
    `[rs211][numbers_check] V3 nsym=23, 심볼오류율=${(errRate * 100).toFixed(2)}% (베르누이), ` +
      `성공률=${successRate.toFixed(2)}% (ADR 기대 99.4% ±2%p)`,
  );
  // 이 assert 는 "성질" 이 아니라 ADR 대조 보고용 — 실패해도 숨기지 않는다.
  // ±2%p 밖이면 조용히 맞추지 말고 그대로 보고한다(테스트도 실패로 표시).
  assert.ok(
    Math.abs(successRate - 99.4) <= 2,
    `ADR 기대(99.4%)와 ±2%p 를 벗어났다: 실측 ${successRate.toFixed(2)}% — 조용히 맞추지 말고 보고할 것`,
  );
});

// ── 결정성 재확인 ───────────────────────────────────────────────────────

test('디코더도 결정적이다 — 같은 손상 입력은 항상 같은 결과', () => {
  const rnd = mulberry32(40);
  const msg = randMsg(rnd, 20);
  const nsym = 10;
  const cw = rsEncode(msg, nsym);
  const { corrupted } = injectErrors(cw, errorCapacity(nsym), rnd);
  const r1 = rsDecode(corrupted, nsym);
  const r2 = rsDecode(corrupted, nsym);
  assert.deepEqual(Array.from(r1.message), Array.from(r2.message));
  assert.deepEqual(r1.errorPositions, r2.errorPositions);
});
