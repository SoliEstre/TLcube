/**
 * gfp.js — 소수체 GF(p), p = 211 산술 + 다항식 연산
 *
 * ADR 0001 §2.3·§6: RS 부호를 셀 도메인(3 digit = 1 심볼, 알파벳 크기 216)에서
 * 직접 걸려면 216 이하 최대 소수인 **211** 위의 체가 필요하다. 6³=216 자체는
 * 소수거듭제곱이 아니라서(2³·3³) 체를 이루지 못한다 — GF(6³) 은 "비표준"이
 * 아니라 **존재하지 않는다**.
 *
 * ⚠ 표수가 2 가 아니다. GF(2^8)(`gf256.js`) 습관을 그대로 옮기면 전부 틀린다.
 *   - **뺄셈 ≠ 덧셈.** GF(2^m) 에서는 -a = a (XOR 자기역) 이지만 GF(p), p 홀수
 *     소수에서는 -a = p - a ≠ a (a≠0 일 때). `sub` 를 `add` 로 대체하면 안 된다.
 *   - **부호가 실재한다.** 오류 크기(Forney)·다항식 뺄셈 전부에서 부호를
 *     놓치면 "조용히" 틀린 값이 나온다 (XOR 세계와 달리 대칭이 없어 자가진단이
 *     안 된다) — 검증 라운드가 이 함정을 실제로 실증했다(ADR §6 리스크표).
 *   - **형식적 미분 계수도 다르다.** GF(2^m) 은 짝수차항이 미분에서 소멸하는
 *     "홀수항 트릭"을 쓰지만, GF(p) 의 형식적 미분은 일반 미적분과 같다:
 *     d/dx (c_k x^k) = (k mod p)·c_k · x^(k-1). 홀수항 트릭을 복사하면 틀린다.
 *
 * 의존성 0. 브라우저 ESM 으로 그대로 로드된다 (Node 전용 API 없음).
 *
 * ── 다항식 표현 규약 ─────────────────────────────────────────────────────
 * `gf256.js` 와 동일하게 **big-endian(내림차순)** 계수 배열을 기본으로 쓴다.
 *   poly[0] = 최고차항 계수, poly[poly.length - 1] = 상수항
 * (RS 복호 내부의 Λ(x)·Ω(x) 는 `rs211.js` 안에서 little-endian 을 따로 쓰며
 *  그 파일에 명시돼 있다 — gfp.js 는 big-endian 만 다룬다.)
 */

/** 체의 위수(소수) — 6³ = 216 이하 최대 소수. ADR 0001 §2.3 근거 2. */
export const P = 211;

/** 곱셈군 위수 |GF(211)^*| = 210 = 2·3·5·7 */
export const MULTIPLICATIVE_ORDER = P - 1; // 210

/** 210 의 소인수 — 생성원 위수 검증에 쓴다 (210 = 2·3·5·7). */
const ORDER_PRIME_FACTORS = Object.freeze([2, 3, 5, 7]);

// ── 스칼라 연산 (테이블 독립, 체 생성보다 먼저 필요) ────────────────────

/** a + b mod p */
export function add(a, b) {
  return (a + b) % P;
}

/**
 * a - b mod p.
 * **뺄셈 ≠ 덧셈.** JS 의 `%` 는 음수를 남길 수 있으므로 +P 로 보정한다.
 */
export function sub(a, b) {
  return ((a - b) % P + P) % P;
}

/** a * b mod p */
export function mul(a, b) {
  return (a * b) % P;
}

/**
 * a^n mod p (n >= 0). 반복 제곱(square-and-multiply).
 * 체 생성(테이블 구축) 이전에도 써야 하므로 테이블에 의존하지 않는다.
 */
export function modPow(a, n) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`modPow 의 지수는 0 이상 정수여야 한다: ${n}`);
  }
  let base = ((a % P) + P) % P;
  let exp = n;
  let result = 1;
  while (exp > 0) {
    if (exp & 1) result = mul(result, base);
    base = mul(base, base);
    exp >>= 1;
  }
  return result;
}

/**
 * a 의 곱셈 역원. **페르마의 소정리** a^(p-2) ≡ a^-1 (mod p) 를 쓴다.
 *
 * 선택 근거: p 가 작은 소수(211)라 `modPow` 반복제곱이 최대 ~8 회 곱셈으로
 * 끝나 확장 유클리드 호제법과 성능 차이가 무의미하고, 나눗셈 없는 곱셈만
 * 쓰므로 구현이 짧고 부호 실수가 끼어들 자리가 없다(확장 유클리드는 몫·나머지
 * 부호 처리가 또 다른 함정이다 — 이 파일 상단 경고와 같은 종류의 실수).
 */
export function inverse(a) {
  const aa = ((a % P) + P) % P;
  if (aa === 0) throw new RangeError('GF(211) 0 의 역원은 없다');
  return modPow(aa, P - 2);
}

/** a / b mod p */
export function div(a, b) {
  return mul(a, inverse(b));
}

// ── 생성원 탐색 + exp/log 테이블 ─────────────────────────────────────────

/**
 * g 가 GF(211)^* (위수 210) 의 원시원소(생성원)인지 판정한다.
 * 정의: g^210 = 1 (페르마 소정리로 항상 참) 이고, 210 의 모든 소인수 q 에
 * 대해 g^(210/q) ≠ 1. 이 조건이 위수가 정확히 210(= 부분군 아님)임을 보장한다.
 */
function isPrimitiveRoot(g) {
  if (modPow(g, MULTIPLICATIVE_ORDER) !== 1) return false; // 안전망 (항상 참이어야 함)
  for (const q of ORDER_PRIME_FACTORS) {
    if (modPow(g, MULTIPLICATIVE_ORDER / q) === 1) return false;
  }
  return true;
}

/**
 * 최소 생성원을 계산으로 찾는다 (외우지 않는다 — ADR 지시).
 * 2..p-1 을 순회하며 `isPrimitiveRoot` 로 검증한 첫 값을 쓴다.
 */
function findGenerator() {
  for (let g = 2; g < P; g++) {
    if (isPrimitiveRoot(g)) return g;
  }
  throw new Error('GF(211) 에서 원시원소를 찾지 못했다 — 산술 구현 버그');
}

/** 생성원 α. 계산으로 찾되(=2), 값 자체를 export 해 테스트가 재검증할 수 있게 한다. */
export const GENERATOR = findGenerator();

/**
 * EXP[i] = α^i mod p, i = 0..209.
 * LOG[EXP[i]] = i (log(0) 은 정의되지 않음 → -1 센티넬).
 *
 * 주기가 210(= MULTIPLICATIVE_ORDER)이다 — GF(2^8) 의 255 와 다르다.
 * 길이를 2*210 으로 잡아 mul/div 색인에서 mod 없이 더할 수 있게 한다.
 */
const EXP = new Uint8Array(2 * MULTIPLICATIVE_ORDER);
const LOG = new Int16Array(P).fill(-1);

{
  let x = 1;
  for (let i = 0; i < MULTIPLICATIVE_ORDER; i++) {
    if (LOG[x] !== -1) {
      throw new Error(`생성원 ${GENERATOR} 검증 실패 — 주기가 210 미만이다 (i=${i})`);
    }
    EXP[i] = x;
    LOG[x] = i;
    x = mul(x, GENERATOR);
  }
  if (x !== 1) {
    throw new Error('GF(211) 생성원 순환 검증 실패 — α^210 ≠ 1');
  }
  for (let i = MULTIPLICATIVE_ORDER; i < EXP.length; i++) {
    EXP[i] = EXP[i - MULTIPLICATIVE_ORDER];
  }
}

export { EXP, LOG };

/** 이산로그. log(0) 은 정의되지 않으므로 예외. */
export function log(a) {
  const aa = ((a % P) + P) % P;
  if (aa === 0) throw new RangeError('GF(211) log(0) 은 정의되지 않는다');
  return LOG[aa];
}

/**
 * α^n. n 은 음수·210 이상도 허용한다 (mod 210 으로 감싼다).
 * 테이블 기반이라 `modPow` 보다 빠르고, 체 구축 이후의 정상 경로다.
 */
export function alphaPow(n) {
  if (!Number.isInteger(n)) throw new TypeError(`지수는 정수여야 한다: ${n}`);
  const e = ((n % MULTIPLICATIVE_ORDER) + MULTIPLICATIVE_ORDER) % MULTIPLICATIVE_ORDER;
  return EXP[e];
}

/**
 * 테이블 기반 거듭제곱 a^n (n 은 음수 허용, a ≠ 0 이어야 함 — 0 은 `modPow` 로).
 * 관례: 0^0 = 1(빈 곱), 0^n(n>0) = 0, 0^n(n<0) 은 예외.
 */
export function pow(a, n) {
  if (!Number.isInteger(n)) throw new TypeError(`지수는 정수여야 한다: ${n}`);
  const aa = ((a % P) + P) % P;
  if (aa === 0) {
    if (n === 0) return 1;
    if (n < 0) throw new RangeError('GF(211) 0 의 음수 거듭제곱은 정의되지 않는다');
    return 0;
  }
  const e = (((LOG[aa] * n) % MULTIPLICATIVE_ORDER) + MULTIPLICATIVE_ORDER) % MULTIPLICATIVE_ORDER;
  return EXP[e];
}

// ── 다항식 연산 (big-endian: index 0 = 최고차) ────────────────────────────

/** p(x) * scalar */
export function polyScale(p, scalar) {
  const out = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = mul(p[i], scalar);
  return out;
}

/** p(x) + q(x). 길이가 다르면 **상수항 기준(오른쪽)** 으로 정렬해 더한다. */
export function polyAdd(p, q) {
  const len = Math.max(p.length, q.length);
  const out = new Uint8Array(len);
  for (let i = 0; i < p.length; i++) {
    const idx = i + len - p.length;
    out[idx] = add(out[idx], p[i]);
  }
  for (let i = 0; i < q.length; i++) {
    const idx = i + len - q.length;
    out[idx] = add(out[idx], q[i]);
  }
  return out;
}

/**
 * p(x) - q(x). **표수 2 가 아니므로 `polyAdd` 와 다른 결과다.**
 * (`gf256.js` 에는 이 함수가 없다 — 거기서는 sub === add 라서 불필요했다.)
 */
export function polySub(p, q) {
  const len = Math.max(p.length, q.length);
  const out = new Uint8Array(len);
  for (let i = 0; i < p.length; i++) {
    const idx = i + len - p.length;
    out[idx] = add(out[idx], p[i]);
  }
  for (let i = 0; i < q.length; i++) {
    const idx = i + len - q.length;
    out[idx] = sub(out[idx], q[i]);
  }
  return out;
}

/** p(x) * q(x) */
export function polyMul(p, q) {
  if (p.length === 0 || q.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++) {
    const pi = p[i];
    if (pi === 0) continue;
    for (let j = 0; j < q.length; j++) {
      out[i + j] = add(out[i + j], mul(pi, q[j]));
    }
  }
  return out;
}

/** 선행 0 계수를 제거한다. 전부 0 이면 [0] 을 돌려준다. */
export function polyTrim(p) {
  let i = 0;
  while (i < p.length - 1 && p[i] === 0) i++;
  const out = new Uint8Array(Math.max(p.length - i, 1));
  for (let j = 0; j < out.length; j++) out[j] = p[i + j] ?? 0;
  return out;
}

/**
 * 다항식 나눗셈 (synthetic division).
 * @returns {{quotient: Uint8Array, remainder: Uint8Array}}
 *          remainder 길이 = deg(divisor) (선행 0 포함, 고정 길이)
 */
export function polyDiv(dividend, divisor) {
  const dv = polyTrim(divisor);
  if (dv.length === 1 && dv[0] === 0) throw new RangeError('0 다항식으로 나눌 수 없다');
  const degDiv = dv.length - 1;
  if (dividend.length < dv.length) {
    const rem = new Uint8Array(degDiv);
    for (let i = 0; i < dividend.length; i++) {
      rem[i + degDiv - dividend.length] = dividend[i];
    }
    return { quotient: new Uint8Array([0]), remainder: rem };
  }
  const work = new Uint8Array(dividend.length);
  for (let i = 0; i < dividend.length; i++) work[i] = dividend[i];
  const qLen = dividend.length - degDiv;
  const dvLeadInv = inverse(dv[0]);
  for (let i = 0; i < qLen; i++) {
    const coef = mul(work[i], dvLeadInv);
    work[i] = coef;
    if (coef === 0) continue;
    for (let j = 1; j < dv.length; j++) {
      if (dv[j] !== 0) work[i + j] = sub(work[i + j], mul(dv[j], coef));
    }
  }
  return { quotient: work.slice(0, qLen), remainder: work.slice(qLen) };
}

/** Horner 법 평가 p(x) */
export function polyEval(p, x) {
  if (p.length === 0) return 0;
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = add(mul(y, x), p[i]);
  return y;
}
