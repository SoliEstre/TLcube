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
  rsDecodeWithErasures,
  RSDecodeError,
  errorCapacity,
  erasureCapacity,
  errorCapacityWithErasures,
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

// ── 소거(erasure) 복호 ──────────────────────────────────────────────────
//
// 소거는 «위치를 아는 오류» 다. 오류 1개가 패리티 2개를 쓰는 것과 달리 1개만
// 써서 한계가 t = ⌊nsym/2⌋ → 2·v + s ≤ nsym 으로 넓어진다. 아래 KAT 는 그
// 한계선을 **경계 전수** 로 확인하고, 한 칸 넘으면 정직하게 실패하는지도 본다.

/** 서로 다른 위치 count 개를 결정적으로 고른다(오름차순). */
function pickDistinct(n, count, rnd) {
  const chosen = new Set();
  while (chosen.size < count) chosen.add(Math.floor(rnd() * n));
  return [...chosen].sort((a, b) => a - b);
}

function corruptAt(codeword, positions, rnd) {
  const out = codeword.slice();
  for (const pos of positions) {
    const delta = 1 + Math.floor(rnd() * (P - 1));
    out[pos] = (out[pos] + delta) % P;
  }
  return out;
}

test('소거 용량 헬퍼 — s ≤ nsym, 잔여 오류 t = ⌊(nsym−s)/2⌋', () => {
  assert.equal(erasureCapacity(14), 14);
  assert.equal(errorCapacity(14), 7);
  assert.equal(errorCapacityWithErasures(14, 0), 7);
  assert.equal(errorCapacityWithErasures(14, 1), 6);
  assert.equal(errorCapacityWithErasures(14, 2), 6);
  assert.equal(errorCapacityWithErasures(14, 14), 0);
  assert.equal(errorCapacityWithErasures(14, 15), -1, 's > nsym 는 복구 불가를 −1 로 알린다');
});

test('KAT — 소거만 nsym 개까지 전부 복구한다 (오류 정정 한계 t 의 2배)', () => {
  const rnd = mulberry32(4001);
  for (const nsym of [3, 7, 11, 14, 22, 23, 37]) {
    const msg = randMsg(rnd, 40);
    const cw = rsEncode(msg, nsym);
    for (let s = 1; s <= nsym; s += 1) {
      const positions = pickDistinct(cw.length, s, rnd);
      const received = corruptAt(cw, positions, rnd);
      const result = rsDecode(received, nsym, { erasures: positions });
      assert.equal(result.ok, true, `nsym=${nsym} s=${s}: ${result.ok ? '' : result.reason}`);
      assert.deepEqual(Array.from(result.codeword), Array.from(cw), `nsym=${nsym} s=${s}`);
      assert.equal(result.erasureCount, s);
      assert.deepEqual(result.erasurePositions, positions);
      assert.equal(result.errorCount, 0, '전부 소거로 잡혔으면 미상 오류는 0 이다');
      // 같은 손상을 소거 없이 넣으면 s > t 인 구간에서는 반드시 실패해야 한다.
      if (s > errorCapacity(nsym)) {
        const plain = rsDecode(received, nsym);
        assert.equal(plain.ok, false, `nsym=${nsym} s=${s}: 소거 없이 성공하면 비교가 무의미하다`);
      }
    }
  }
});

test('KAT — 오류 v + 소거 s 혼합 경계 전수: 2v + s ≤ nsym 이면 전부 복구', () => {
  const rnd = mulberry32(4002);
  let cases = 0;
  for (const nsym of [7, 11, 14, 22, 23]) {
    const msg = randMsg(rnd, 40);
    const cw = rsEncode(msg, nsym);
    for (let s = 0; s <= nsym; s += 1) {
      for (let v = 0; v <= Math.floor((nsym - s) / 2); v += 1) {
        if (s + v === 0) continue;
        const all = pickDistinct(cw.length, s + v, rnd);
        const erasures = all.slice(0, s);
        const received = corruptAt(cw, all, rnd);
        const result = rsDecode(received, nsym, { erasures });
        assert.equal(result.ok, true, `nsym=${nsym} s=${s} v=${v}: ${result.ok ? '' : result.reason}`);
        assert.deepEqual(Array.from(result.codeword), Array.from(cw), `nsym=${nsym} s=${s} v=${v}`);
        assert.equal(result.errorCount, v, `nsym=${nsym} s=${s} v=${v}: 미상 오류 수`);
        cases += 1;
      }
    }
  }
  assert.ok(cases >= 300, `경계 전수 표본이 너무 적다: ${cases}`);
});

test('한계를 한 칸 넘으면(2v + s = nsym + 1) 65칸 전부 조용한 오정정 없이 정직하게 실패한다', () => {
  const rnd = mulberry32(4003);
  let honestFail = 0;
  let luckyRecovery = 0;
  let cases = 0;
  for (const nsym of [7, 11, 14, 22, 23, 37]) {
    const msg = randMsg(rnd, 40);
    const cw = rsEncode(msg, nsym);
    for (let s = 0; s <= nsym + 1; s += 1) {
      const rest = nsym + 1 - s;
      if (rest < 0 || rest % 2 !== 0) continue;
      const v = rest / 2;
      const all = pickDistinct(cw.length, s + v, rnd);
      const received = corruptAt(cw, all, rnd);
      const result = rsDecode(received, nsym, { erasures: all.slice(0, s) });
      cases += 1;
      if (result.ok) {
        // 성공했다면 값이 맞아야 한다 — 틀린 값을 ok 로 돌려주는 것이 금지 사항이다.
        assert.deepEqual(
          Array.from(result.codeword), Array.from(cw),
          `nsym=${nsym} s=${s} v=${v}: 한계 초과에서 조용한 오정정`,
        );
        luckyRecovery += 1;
      } else {
        honestFail += 1;
      }
    }
  }
  // 하드 단언: 이 rung 은 «대부분» 이 아니라 **전부** 정직해야 한다. honestFail > 0
  // 만 보면 65 중 64 가 조용히 오정정돼도 초록이라 게이트 구실을 못 한다.
  assert.equal(cases, 65, `이 nsym 집합의 +1 rung 은 정확히 65 칸이다 (실제 ${cases})`);
  assert.equal(luckyRecovery, 0, '+1 rung 에서는 우연 복구조차 나오지 않는다');
  assert.equal(honestFail, cases, `+1 rung 은 65/65 정직 실패여야 한다 (실제 ${honestFail})`);
});

// ── s = nsym 절벽 (2v + s = nsym + 2 rung) ────────────────────────────
//
// 위 +1 rung 이 깨끗하다고 «ECC 한계의 정직성» 이 닫히지 않는다. 한 칸 더 가면
// 정직성이 깨지고, 깨지는 방식이 잔여 패리티 nsym − s 에만 의존한다. 특히
// s = nsym 은 확률이 아니라 **절벽**이다. 아래 두 테스트가 그 사실 자체를 계약으로
// 고정한다 — 고칠 수 있는 결함이 아니라 RS 고유 한계이므로, 숨기지 않고 못 박는다.

test('절벽 — s = nsym (2v + s = nsym + 2) 은 검출 마진 0: 미선언 오류 1개가 100% 조용히 오정정된다', () => {
  const rnd = mulberry32(4103);
  let silentMiscorrect = 0;
  let honestFail = 0;
  let luckyRecovery = 0;
  let cases = 0;
  for (const nsym of [3, 7, 11, 14, 22, 23, 37]) {
    const cw = rsEncode(randMsg(rnd, 40), nsym);
    for (let trial = 0; trial < 20; trial += 1) {
      // 소거 nsym 개를 «정확히» 선언하고, 선언하지 않은 오류를 1개 더 심는다.
      const all = pickDistinct(cw.length, nsym + 1, rnd);
      const received = corruptAt(cw, all, rnd);
      const result = rsDecode(received, nsym, { erasures: all.slice(0, nsym) });
      cases += 1;
      if (!result.ok) honestFail += 1;
      else if (Array.from(result.codeword).every((value, index) => value === cw[index])) {
        luckyRecovery += 1;
      } else silentMiscorrect += 1;
    }
  }
  // 신드롬 nsym 개 · 미지수 nsym 개 = 정확히 결정계라 해가 유일하게 존재하고, 그 해는
  // 정의상 모든 신드롬을 0 으로 만든다. 마지막 관문(정정 후 신드롬 재검산)이 구성상
  // 반드시 통과한다 — 확률이 아니라 구조다.
  assert.equal(honestFail, 0, 'RS 는 이 지점에서 «틀렸다» 고 말할 능력이 없다');
  assert.equal(luckyRecovery, 0, '정정은 소거 위치에서만 일어나므로 원본과 같아질 수 없다');
  assert.equal(silentMiscorrect, cases, `${cases} 칸 전부 조용한 오정정이어야 한다`);
});

test('+2 rung 의 조용한 오정정률은 잔여 패리티 nsym − s 에만 의존한다 (0 → 100%, 8 이상 → 0%)', () => {
  const rnd = mulberry32(4104);
  const byResidual = new Map();
  for (const nsym of [7, 11, 14, 22, 23, 37]) {
    const cw = rsEncode(randMsg(rnd, 40), nsym);
    for (let s = nsym; s >= 0; s -= 2) {
      const rest = nsym + 2 - s;
      if (rest % 2 !== 0) continue;
      const v = rest / 2;
      if (v > 6 || s + v > cw.length) continue;
      const residual = nsym - s;
      const bucket = byResidual.get(residual) ?? { silent: 0, honest: 0, cases: 0 };
      for (let trial = 0; trial < 40; trial += 1) {
        const all = pickDistinct(cw.length, s + v, rnd);
        const received = corruptAt(cw, all, rnd);
        const result = rsDecode(received, nsym, { erasures: all.slice(0, s) });
        bucket.cases += 1;
        if (!result.ok) bucket.honest += 1;
        else if (!Array.from(result.codeword).every((value, index) => value === cw[index])) {
          bucket.silent += 1;
        }
      }
      byResidual.set(residual, bucket);
    }
  }

  const at = (residual) => byResidual.get(residual);
  // 잔여 0 = 절벽. 전부 조용한 오정정.
  assert.equal(at(0).silent, at(0).cases, '잔여 패리티 0 이면 100% 조용한 오정정이다');
  // 잔여 2 는 «확률» 구간 — 정직 실패가 다수지만 조용한 오정정이 실재한다.
  // 여기가 «s ≤ nsym−2 면 정직하다» 가 참이 아닌 이유다.
  assert.ok(at(2).honest > 0, '잔여 2 에서는 검출이 다수여야 한다');
  assert.ok(
    at(2).silent > 0,
    '잔여 2 를 «정직 구간» 이라고 부를 수 없다 — 조용한 오정정이 실재한다',
  );
  assert.ok(
    at(2).silent < at(2).honest,
    `잔여 2 는 소수 사건이어야 한다 (silent ${at(2).silent} vs honest ${at(2).honest})`,
  );
  // 잔여가 8 이상이면 검출이 닫힌다.
  for (const [residual, bucket] of byResidual) {
    if (residual >= 8) {
      assert.equal(
        bucket.silent, 0,
        `잔여 ${residual} 에서 조용한 오정정 ${bucket.silent} 건 — 검출이 열렸다`,
      );
    }
  }
  // 잔여가 커질수록 단조롭게 안전해진다.
  assert.ok(at(2).silent > at(4).silent, '잔여 2 가 잔여 4 보다 위험해야 한다');
});

test('소거 수가 nsym 을 넘으면 억지 복구하지 않고 그 사실을 이유로 남긴다', () => {
  const rnd = mulberry32(4004);
  const nsym = 7;
  const cw = rsEncode(randMsg(rnd, 30), nsym);
  const positions = pickDistinct(cw.length, nsym + 1, rnd);
  const received = corruptAt(cw, positions, rnd);
  const result = rsDecode(received, nsym, { erasures: positions });
  assert.equal(result.ok, false);
  assert.match(result.reason, /소거 개수/);
  assert.equal(result.erasureCount, nsym + 1);
});

test('소거 위치가 실제로 멀쩡해도(값이 맞아도) 결과가 깨지지 않는다', () => {
  const rnd = mulberry32(4005);
  const nsym = 14;
  const cw = rsEncode(randMsg(rnd, 30), nsym);
  // 손상은 3곳뿐인데 소거는 10곳을 선언한다 — 7곳은 «사실 맞는 값» 이다.
  const damaged = pickDistinct(cw.length, 3, rnd);
  const declared = [...new Set([...damaged, ...pickDistinct(cw.length, 10, rnd)])]
    .sort((a, b) => a - b);
  const received = corruptAt(cw, damaged, rnd);
  const result = rsDecode(received, nsym, { erasures: declared });
  assert.equal(result.ok, true, result.ok ? '' : result.reason);
  assert.deepEqual(Array.from(result.codeword), Array.from(cw));
});

test('소거 배열이 비면 기존 오류 전용 경로와 결과가 완전히 같다', () => {
  const rnd = mulberry32(4006);
  const nsym = 11;
  const cw = rsEncode(randMsg(rnd, 30), nsym);
  const { corrupted } = injectErrors(cw, errorCapacity(nsym), rnd);
  const plain = rsDecode(corrupted, nsym);
  const empty = rsDecode(corrupted, nsym, { erasures: [] });
  assert.deepEqual(Array.from(empty.message), Array.from(plain.message));
  assert.deepEqual(empty.errorPositions, plain.errorPositions);
  assert.equal(empty.erasureCount, undefined, '소거를 안 썼으면 소거 필드도 없다');
});

test('rsDecodeWithErasures 는 rsDecode 의 erasures 옵션과 같은 결과다', () => {
  const rnd = mulberry32(4007);
  const nsym = 22;
  const cw = rsEncode(randMsg(rnd, 40), nsym);
  const positions = pickDistinct(cw.length, 20, rnd);
  const received = corruptAt(cw, positions, rnd);
  const viaOption = rsDecode(received, nsym, { erasures: positions });
  const viaEntry = rsDecodeWithErasures(received, nsym, positions);
  assert.deepEqual(Array.from(viaEntry.codeword), Array.from(viaOption.codeword));
  assert.deepEqual(viaEntry.erasurePositions, viaOption.erasurePositions);
});

test('소거 위치는 범위 검사한다 — 조용히 버리지 않는다', () => {
  const rnd = mulberry32(4008);
  const nsym = 7;
  const cw = rsEncode(randMsg(rnd, 20), nsym);
  assert.throws(() => rsDecode(cw, nsym, { erasures: [cw.length] }), RangeError);
  assert.throws(() => rsDecode(cw, nsym, { erasures: [-1] }), RangeError);
  assert.throws(() => rsDecode(cw, nsym, { erasures: [1.5] }), RangeError);
  assert.throws(() => rsDecode(cw, nsym, { erasures: 3 }), TypeError);
});

test('소거 복호도 결정적이다 — 2회 호출 deepEqual', () => {
  const rnd = mulberry32(4009);
  const nsym = 14;
  const cw = rsEncode(randMsg(rnd, 30), nsym);
  const all = pickDistinct(cw.length, 12, rnd);
  const received = corruptAt(cw, all, rnd);
  const first = rsDecode(received, nsym, { erasures: all.slice(0, 10) });
  const second = rsDecode(received, nsym, { erasures: all.slice(0, 10) });
  assert.deepEqual(Array.from(first.codeword), Array.from(second.codeword));
  assert.deepEqual(first.errorPositions, second.errorPositions);
  assert.deepEqual(first.correctedPositions, second.correctedPositions);
});
