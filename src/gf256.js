// ⚠ @deprecated (2026-08-08, ADR 0001) — GF(2⁸) 경로는 사장됐다. 신규 코드는 gfp.js(GF 211)
// 를 쓴다. 이 파일은 ADR 비교 기준·회귀 대조군으로만 유지한다. 수정 금지.
/**
 * gf256.js — GF(2^8) 유한체 산술 + 다항식 연산
 *
 * SPEC §6: 오류 정정은 GF(2^8) 위의 Reed-Solomon 으로 한다. 이 모듈은 그
 * 아래층인 체(field) 산술만 담당하고, RS 부호 자체는 `rs.js` 가 담는다.
 *
 * 의존성 0. 브라우저에서 `<script type="module">` 로 그대로 로드된다
 * (Node 전용 API 없음).
 *
 * ── 다항식 표현 규약 (중요) ─────────────────────────────────────────────
 * 이 모듈의 poly* 함수는 **big-endian(내림차순)** 계수 배열을 쓴다.
 *   poly[0] = 최고차항 계수, poly[poly.length - 1] = 상수항
 *   예) [1, 2, 3] = x^2 + 2x + 3
 * 이유: RS 코드워드가 "메시지 ‖ 패리티" 순서로 그대로 다항식 계수가 되어
 *       체계적 부호화에서 인덱스 변환이 필요 없다.
 * (rs.js 내부의 오류위치 다항식 Λ(x)·Ω(x) 만 little-endian 을 쓰며,
 *  그쪽 파일에 별도로 명시돼 있다.)
 */

/**
 * 원시 다항식: x^8 + x^4 + x^3 + x^2 + 1 = 0x11D
 *
 * 선택 근거:
 * - QR Code(ISO/IEC 18004), DataMatrix, CCSDS 텔레메트리 등이 쓰는 사실상의
 *   관례값이라 외부 레퍼런스·테스트 벡터·교차검증 자료가 가장 풍부하다.
 *   본 프로젝트는 RS 를 직접 구현하므로(architecture.md §2) 검증 자료의
 *   양이 곧 위험 감소다.
 * - AES 의 0x11B 도 기약이지만 그 체에서 x(=2) 는 원시원소가 아니다(위수 51).
 *   RS 는 α^i 를 훑어야 하므로 "α = 2 가 원시원소"인 0x11D 가 편하다.
 *
 * 하드코딩이 아니다: 아래 `createField(poly, generator)` 로 다른 원시 다항식
 * 위의 체를 언제든 만들 수 있고, 원시원소가 아닌 생성원을 주면 예외로 막는다.
 */
export const PRIMITIVE_POLY = 0x11d;

/** 생성원 α = 2 (= 다항식 x). 0x11D 에 대해 곱셈군 위수 255 의 원시원소다. */
export const GENERATOR = 0x02;

/** 체 원소 개수 |GF(2^8)| = 256 */
export const FIELD_SIZE = 256;

/** 곱셈군 위수 |GF(2^8)^*| = 255 */
export const MULTIPLICATIVE_ORDER = 255;

/**
 * 테이블 없이 GF(2^8) 곱을 계산한다 (carry-less 곱 → 원시 다항식으로 축약).
 * log/antilog 테이블을 **생성**하는 데만 쓰인다. 런타임 곱은 테이블을 쓴다.
 */
function clmulReduce(a, b, poly) {
  let x = a & 0xff;
  let y = b & 0xff;
  let p = 0;
  while (y !== 0) {
    if ((y & 1) !== 0) p ^= x;
    y >>= 1;
    x <<= 1;
  }
  // 곱의 최대 차수는 7 + 7 = 14. 높은 항부터 poly 를 XOR 해 8비트로 내린다.
  for (let bit = 14; bit >= 8; bit--) {
    if ((p & (1 << bit)) !== 0) p ^= poly << (bit - 8);
  }
  return p & 0xff;
}

/**
 * 주어진 원시 다항식·생성원으로 GF(2^8) 체를 만든다.
 *
 * @param {number} primitivePoly 9비트 원시 다항식 (0x100..0x1FF)
 * @param {number} generator     곱셈군의 원시원소 후보 (2..255)
 * @returns {Readonly<object>} 체 연산 묶음
 * @throws {RangeError} 인자 범위 위반
 * @throws {Error} generator 가 해당 체에서 원시원소가 아닐 때
 */
export function createField(primitivePoly = PRIMITIVE_POLY, generator = GENERATOR) {
  if (!Number.isInteger(primitivePoly) || primitivePoly < 0x100 || primitivePoly > 0x1ff) {
    throw new RangeError(`원시 다항식은 9비트(0x100..0x1FF)여야 한다: ${primitivePoly}`);
  }
  if (!Number.isInteger(generator) || generator < 2 || generator > 0xff) {
    throw new RangeError(`생성원은 2..255 여야 한다: ${generator}`);
  }

  // EXP 는 길이 512. 앞 255개가 α^0..α^254 이고 뒤는 그 복제다.
  // 덕분에 mul 이 LOG[a] + LOG[b] (최대 254+254 = 508) 를 mod 없이 색인한다.
  const EXP = new Uint8Array(2 * MULTIPLICATIVE_ORDER + 2);
  // LOG[0] 은 정의되지 않는다 → -1 센티넬. (0 으로 두면 log(0) = log(1) 이 되어
  // 조용한 오프바이원 버그의 온상이 된다.)
  const LOG = new Int16Array(FIELD_SIZE).fill(-1);

  let x = 1;
  for (let i = 0; i < MULTIPLICATIVE_ORDER; i++) {
    if (LOG[x] !== -1) {
      throw new Error(
        `generator 0x${generator.toString(16)} 는 poly 0x${primitivePoly.toString(16)} 에서 ` +
          `원시원소가 아니다 (주기 ${i} < ${MULTIPLICATIVE_ORDER})`,
      );
    }
    EXP[i] = x;
    LOG[x] = i;
    x = clmulReduce(x, generator, primitivePoly);
  }
  if (x !== 1) {
    // 255 스텝 후 1 로 돌아오지 않으면 primitivePoly 가 기약이 아니다.
    throw new Error(`poly 0x${primitivePoly.toString(16)} 는 기약 다항식이 아니다`);
  }
  // 순환 복제: EXP[i] = EXP[i - 255] (i >= 255). EXP[255] = EXP[0] = 1.
  for (let i = MULTIPLICATIVE_ORDER; i < EXP.length; i++) {
    EXP[i] = EXP[i - MULTIPLICATIVE_ORDER];
  }

  /** 덧셈 = XOR (표수 2) */
  const add = (a, b) => (a ^ b) & 0xff;

  /** 뺄셈 = 덧셈 (표수 2 에서 -a = a) */
  const sub = add;

  const mul = (a, b) => {
    const aa = a & 0xff;
    const bb = b & 0xff;
    if (aa === 0 || bb === 0) return 0;
    return EXP[LOG[aa] + LOG[bb]];
  };

  const div = (a, b) => {
    const aa = a & 0xff;
    const bb = b & 0xff;
    if (bb === 0) throw new RangeError('GF(2^8) 0 으로 나눌 수 없다');
    if (aa === 0) return 0;
    // + 255 로 음수 색인을 피한다. 최대 254 + 255 = 509 < EXP.length.
    return EXP[LOG[aa] + MULTIPLICATIVE_ORDER - LOG[bb]];
  };

  const inverse = (a) => {
    const aa = a & 0xff;
    if (aa === 0) throw new RangeError('GF(2^8) 0 의 역원은 없다');
    return EXP[MULTIPLICATIVE_ORDER - LOG[aa]];
  };

  /** 이산로그. log(0) 은 정의되지 않으므로 예외. */
  const log = (a) => {
    const aa = a & 0xff;
    if (aa === 0) throw new RangeError('GF(2^8) log(0) 은 정의되지 않는다');
    return LOG[aa];
  };

  /** α^n. n 은 음수·255 이상도 허용 (mod 255 로 감싼다). */
  const alphaPow = (n) => {
    if (!Number.isInteger(n)) throw new TypeError(`지수는 정수여야 한다: ${n}`);
    const e = ((n % MULTIPLICATIVE_ORDER) + MULTIPLICATIVE_ORDER) % MULTIPLICATIVE_ORDER;
    return EXP[e];
  };

  /**
   * 거듭제곱 a^n. n 은 음수 허용.
   * 관례: 0^0 = 1 (빈 곱), 0^n (n>0) = 0, 0^n (n<0) 은 예외.
   */
  const pow = (a, n) => {
    if (!Number.isInteger(n)) throw new TypeError(`지수는 정수여야 한다: ${n}`);
    const aa = a & 0xff;
    if (aa === 0) {
      if (n === 0) return 1;
      if (n < 0) throw new RangeError('GF(2^8) 0 의 음수 거듭제곱은 정의되지 않는다');
      return 0;
    }
    const e = ((LOG[aa] * n) % MULTIPLICATIVE_ORDER + MULTIPLICATIVE_ORDER) % MULTIPLICATIVE_ORDER;
    return EXP[e];
  };

  // ── 다항식 연산 (big-endian: index 0 = 최고차) ────────────────────────

  /** p(x) * scalar */
  const polyScale = (p, scalar) => {
    const out = new Uint8Array(p.length);
    for (let i = 0; i < p.length; i++) out[i] = mul(p[i], scalar);
    return out;
  };

  /** p(x) + q(x). 길이가 다르면 **상수항 기준(오른쪽)** 으로 정렬해 XOR. */
  const polyAdd = (p, q) => {
    const len = Math.max(p.length, q.length);
    const out = new Uint8Array(len);
    for (let i = 0; i < p.length; i++) out[i + len - p.length] ^= p[i] & 0xff;
    for (let i = 0; i < q.length; i++) out[i + len - q.length] ^= q[i] & 0xff;
    return out;
  };

  /** p(x) * q(x) */
  const polyMul = (p, q) => {
    if (p.length === 0 || q.length === 0) return new Uint8Array(0);
    const out = new Uint8Array(p.length + q.length - 1);
    for (let i = 0; i < p.length; i++) {
      const pi = p[i] & 0xff;
      if (pi === 0) continue;
      for (let j = 0; j < q.length; j++) out[i + j] ^= mul(pi, q[j] & 0xff);
    }
    return out;
  };

  /** 선행 0 계수를 제거한다. 전부 0 이면 [0] 을 돌려준다. */
  const polyTrim = (p) => {
    let i = 0;
    while (i < p.length - 1 && (p[i] & 0xff) === 0) i++;
    const out = new Uint8Array(Math.max(p.length - i, 1));
    for (let j = 0; j < out.length; j++) out[j] = (p[i + j] ?? 0) & 0xff;
    return out;
  };

  /**
   * 다항식 나눗셈 (synthetic division).
   * @returns {{quotient: Uint8Array, remainder: Uint8Array}}
   *          remainder 길이 = deg(divisor) (선행 0 포함, 고정 길이)
   */
  const polyDiv = (dividend, divisor) => {
    const dv = polyTrim(divisor);
    if (dv.length === 1 && dv[0] === 0) throw new RangeError('0 다항식으로 나눌 수 없다');
    const degDiv = dv.length - 1;
    if (dividend.length < dv.length) {
      // 몫은 0, 나머지는 피제수 그대로 (deg(divisor) 길이로 오른쪽 정렬)
      const rem = new Uint8Array(degDiv);
      for (let i = 0; i < dividend.length; i++) {
        rem[i + degDiv - dividend.length] = dividend[i] & 0xff;
      }
      return { quotient: new Uint8Array([0]), remainder: rem };
    }
    const work = new Uint8Array(dividend.length);
    for (let i = 0; i < dividend.length; i++) work[i] = dividend[i] & 0xff;
    const qLen = dividend.length - degDiv;
    for (let i = 0; i < qLen; i++) {
      const coef = div(work[i], dv[0]);
      work[i] = coef;
      if (coef === 0) continue;
      for (let j = 1; j < dv.length; j++) {
        if (dv[j] !== 0) work[i + j] ^= mul(dv[j], coef);
      }
    }
    return { quotient: work.slice(0, qLen), remainder: work.slice(qLen) };
  };

  /** Horner 법 평가 p(x) */
  const polyEval = (p, x) => {
    if (p.length === 0) return 0;
    let y = p[0] & 0xff;
    for (let i = 1; i < p.length; i++) y = mul(y, x) ^ (p[i] & 0xff);
    return y;
  };

  return Object.freeze({
    primitivePoly,
    generator,
    EXP,
    LOG,
    add,
    sub,
    mul,
    div,
    inverse,
    log,
    pow,
    alphaPow,
    polyScale,
    polyAdd,
    polyMul,
    polyDiv,
    polyEval,
    polyTrim,
  });
}

/** 기본 체 — PRIMITIVE_POLY(0x11D) · GENERATOR(2) */
export const defaultField = createField(PRIMITIVE_POLY, GENERATOR);

// 기본 체의 연산을 최상위 이름으로 재노출한다.
// 다른 원시 다항식이 필요하면 `createField(...)` 를 직접 쓴다.
export const EXP = defaultField.EXP;
export const LOG = defaultField.LOG;
export const add = defaultField.add;
export const sub = defaultField.sub;
export const mul = defaultField.mul;
export const div = defaultField.div;
export const inverse = defaultField.inverse;
export const log = defaultField.log;
export const pow = defaultField.pow;
export const alphaPow = defaultField.alphaPow;
export const polyScale = defaultField.polyScale;
export const polyAdd = defaultField.polyAdd;
export const polyMul = defaultField.polyMul;
export const polyDiv = defaultField.polyDiv;
export const polyEval = defaultField.polyEval;
export const polyTrim = defaultField.polyTrim;
