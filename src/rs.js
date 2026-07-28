/**
 * rs.js — Reed-Solomon 부호 over GF(2^8)
 *
 * SPEC §6: RS 는 **바이트 스트림 단계** 에 적용한다 (base-6 변환 *전*).
 * 즉 이 모듈의 입출력은 순수 바이트 배열이고, base-6 / 셀 배치는 모른다.
 *
 * 체계적(systematic) 부호: 코드워드 = 메시지 ‖ 패리티.
 * 생성 다항식 g(x) = ∏_{i=0}^{nsym-1} (x - α^(fcr+i)).
 * 표수 2 이므로 뺄셈 = 덧셈 = XOR.
 *
 * 복호는 신드롬 → Berlekamp-Massey → Chien 탐색 → Forney 의 표준 4단이며
 * t = ⌊nsym/2⌋ 개까지 정정한다.
 *
 * ── 실패 규약 ─────────────────────────────────────────────────────────
 * `rsDecode` 는 절대 던지지 않고 `{ ok: false, reason }` 을 돌려준다.
 * `rsDecodeMessage` 는 실패 시 `RSDecodeError` 를 던진다.
 * 둘 다 "조용히 틀린 값" 을 돌려주지 않는다 — 단, 오류가 t 개를 넘으면
 * 수신어가 **다른 유효 코드워드** 의 반경 t 안에 들어갈 수 있고 그때는
 * 어떤 RS 복호기도 원리적으로 구분할 수 없다(오정정, miscorrection).
 * 그 경우 `ok: true` 지만 값이 다르다. 이는 부호의 한계이지 버그가 아니며,
 * 상위 계층(SPEC §5.4 포맷 CRC 등)이 최종 방어선이다.
 *
 * 의존성 0. 브라우저 ESM 으로 그대로 로드된다.
 */

import {
  mul,
  div,
  inverse,
  alphaPow,
  polyMul,
  polyDiv,
  polyEval,
  MULTIPLICATIVE_ORDER,
} from './gf256.js';

/** 코드워드 최대 길이 = 곱셈군 위수 (GF(2^8) RS 의 자연 블록 길이) */
export const MAX_CODEWORD_LEN = MULTIPLICATIVE_ORDER; // 255

/** 기본 first consecutive root. g(x) = ∏(x - α^(fcr+i)), i = 0..nsym-1 */
export const DEFAULT_FCR = 0;

/**
 * ECC 레벨 → 패리티 비율 (SPEC §6: L ~12% / M ~25% / H ~40%).
 * 비율의 **기준(basis)** 은 SPEC 에 명시돼 있지 않다 → `nsymForLevel` 의
 * `basis` 옵션으로 노출하고 기본값 근거를 거기에 적어 뒀다.
 */
export const ECC_LEVELS = Object.freeze({ L: 0.12, M: 0.25, H: 0.4 });

/** SPEC §6: 기본 M */
export const DEFAULT_ECC_LEVEL = 'M';

/** 복호 실패 예외. `reason` / `syndromes` 를 함께 싣는다. */
export class RSDecodeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RSDecodeError';
    Object.assign(this, details);
  }
}

// ── 입력 검증 ───────────────────────────────────────────────────────────

function toBytes(input, label) {
  if (input instanceof Uint8Array) return input;
  if (!Array.isArray(input) && !ArrayBuffer.isView(input)) {
    throw new TypeError(`${label} 는 Uint8Array 또는 숫자 배열이어야 한다`);
  }
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (!Number.isInteger(v) || v < 0 || v > 255) {
      throw new RangeError(`${label}[${i}] 는 0..255 정수여야 한다: ${v}`);
    }
    out[i] = v;
  }
  return out;
}

function validateNsym(nsym) {
  if (!Number.isInteger(nsym) || nsym < 1 || nsym > MAX_CODEWORD_LEN) {
    throw new RangeError(`nsym 은 1..${MAX_CODEWORD_LEN} 정수여야 한다: ${nsym}`);
  }
}

function validateFcr(fcr) {
  if (!Number.isInteger(fcr) || fcr < 0) {
    throw new RangeError(`fcr 은 0 이상 정수여야 한다: ${fcr}`);
  }
}

// ── 용량 헬퍼 ───────────────────────────────────────────────────────────

/** nsym 패리티로 정정 가능한 최대 심볼 오류 수 t = ⌊nsym/2⌋ */
export function errorCapacity(nsym) {
  validateNsym(nsym);
  return Math.floor(nsym / 2);
}

/** 주어진 nsym 에서 한 블록에 실을 수 있는 최대 데이터 바이트 수 */
export function maxDataLen(nsym) {
  validateNsym(nsym);
  return MAX_CODEWORD_LEN - nsym;
}

/**
 * ECC 레벨에 대응하는 nsym 을 계산한다.
 *
 * @param {number} dataLen 데이터 바이트 수
 * @param {'L'|'M'|'H'} level SPEC §6 ECC 레벨 (기본 M)
 * @param {object} [options]
 * @param {'codeword'|'data'} [options.basis='codeword']
 *   비율의 분모를 무엇으로 볼 것인가.
 *   - 'codeword': nsym / (dataLen + nsym) ≈ ratio  ← **기본값**
 *   - 'data'    : nsym / dataLen         ≈ ratio
 *   근거: SPEC §5.5 용량표가 "gross → ECC-M(25%) 순 페이로드" 로 총량에서
 *   깎아내는 서술이고, 'codeword' 기준이 그 표를 재현한다.
 *     V3: 순 66 B → nsym 22 → 총 88 = 표의 gross 88 (정확히 일치)
 *     V2: 순 40 B → nsym 14 → 총 54 ≈ 표의 53
 *     V1: 순 19 B → nsym  6 → 총 25 ≈ 표의 26
 *   'data' 기준이면 각각 88 이 아니라 76/50/24 가 되어 표와 맞지 않는다.
 *   다만 SPEC 본문에 기준이 명시돼 있지 않으므로 확정하지 않고 옵션으로 남긴다.
 * @param {boolean} [options.forceEven=true]
 *   nsym 을 짝수로 올린다. 홀수 nsym 은 t = ⌊nsym/2⌋ 가 같은 짝수 대비
 *   패리티 1바이트를 정정능력 없이 쓰는 셈이라 레벨 표기와 실제 정정능력이
 *   어긋난다. (홀수 여분은 오정정 검출력에는 도움이 되므로 옵션으로 남김.)
 * @param {number} [options.minNsym=2] 최소 nsym (t >= 1 보장)
 * @returns {number} nsym
 * @throws {RangeError} dataLen + nsym 이 255 를 넘으면
 */
export function nsymForLevel(dataLen, level = DEFAULT_ECC_LEVEL, options = {}) {
  const { basis = 'codeword', forceEven = true, minNsym = 2 } = options;
  if (!Number.isInteger(dataLen) || dataLen < 0) {
    throw new RangeError(`dataLen 은 0 이상 정수여야 한다: ${dataLen}`);
  }
  if (!Object.prototype.hasOwnProperty.call(ECC_LEVELS, level)) {
    throw new RangeError(`알 수 없는 ECC 레벨: ${level} (가능: ${Object.keys(ECC_LEVELS).join(', ')})`);
  }
  if (basis !== 'codeword' && basis !== 'data') {
    throw new RangeError(`basis 는 'codeword' 또는 'data' 여야 한다: ${basis}`);
  }
  const r = ECC_LEVELS[level];
  let nsym = basis === 'codeword' ? Math.round((dataLen * r) / (1 - r)) : Math.round(dataLen * r);
  if (nsym < minNsym) nsym = minNsym;
  if (forceEven && nsym % 2 !== 0) nsym += 1;
  if (dataLen + nsym > MAX_CODEWORD_LEN) {
    throw new RangeError(
      `dataLen(${dataLen}) + nsym(${nsym}) = ${dataLen + nsym} > ${MAX_CODEWORD_LEN}. ` +
        '블록을 나누거나 ECC 레벨을 낮춰야 한다',
    );
  }
  return nsym;
}

// ── 부호화 ──────────────────────────────────────────────────────────────

/**
 * 생성 다항식 g(x) = ∏_{i=0}^{nsym-1} (x - α^(fcr+i)) — big-endian, 모닉.
 * @returns {Uint8Array} 길이 nsym + 1, g[0] === 1
 */
export function rsGeneratorPoly(nsym, options = {}) {
  const { fcr = DEFAULT_FCR } = options;
  validateNsym(nsym);
  validateFcr(fcr);
  let g = Uint8Array.of(1);
  for (let i = 0; i < nsym; i++) {
    // (x - α^(fcr+i)) = (x + α^(fcr+i)) — 표수 2
    g = polyMul(g, Uint8Array.of(1, alphaPow(fcr + i)));
  }
  return g;
}

/**
 * 체계적 RS 부호화. 코드워드 = 메시지 ‖ 패리티(nsym 바이트).
 * @param {Uint8Array|number[]} msg
 * @param {number} nsym
 * @param {{fcr?: number, generator?: Uint8Array}} [options]
 *        generator 를 주면 재계산을 건너뛴다 (같은 nsym/fcr 반복 시 최적화).
 * @returns {Uint8Array} 길이 msg.length + nsym
 */
export function rsEncode(msg, nsym, options = {}) {
  const { fcr = DEFAULT_FCR, generator } = options;
  const data = toBytes(msg, 'msg');
  validateNsym(nsym);
  validateFcr(fcr);
  if (data.length + nsym > MAX_CODEWORD_LEN) {
    throw new RangeError(
      `msg.length(${data.length}) + nsym(${nsym}) = ${data.length + nsym} > ${MAX_CODEWORD_LEN}`,
    );
  }
  const g = generator ?? rsGeneratorPoly(nsym, { fcr });
  if (g.length !== nsym + 1) {
    throw new RangeError(`generator 차수가 nsym 과 다르다: deg=${g.length - 1}, nsym=${nsym}`);
  }
  // m(x) * x^nsym 을 g(x) 로 나눈 나머지가 패리티다.
  const dividend = new Uint8Array(data.length + nsym);
  dividend.set(data, 0);
  const { remainder } = polyDiv(dividend, g);
  const out = new Uint8Array(data.length + nsym);
  out.set(data, 0);
  out.set(remainder, data.length);
  return out;
}

/**
 * 신드롬 S_i = C(α^(fcr+i)), i = 0..nsym-1. 저차 → 고차 순서.
 * 유효 코드워드면 전부 0 이다 (RS 의 정의적 성질).
 * @returns {Uint8Array} 길이 nsym
 */
export function rsSyndromes(codeword, nsym, options = {}) {
  const { fcr = DEFAULT_FCR } = options;
  const cw = toBytes(codeword, 'codeword');
  validateNsym(nsym);
  validateFcr(fcr);
  const s = new Uint8Array(nsym);
  for (let i = 0; i < nsym; i++) s[i] = polyEval(cw, alphaPow(fcr + i));
  return s;
}

// ── 복호 내부: little-endian 다항식 헬퍼 ────────────────────────────────
// Λ(x) = 1 + Λ1·x + Λ2·x² + ... 형태가 자연스러운 알고리즘(BM/Forney)만
// 여기서 little-endian(index i = x^i 계수) 을 쓴다. gf256.js 의 poly* 는
// big-endian 이므로 섞지 않도록 이름에 LE 를 붙였다.

function polyEvalLE(p, x) {
  let y = 0;
  let xp = 1;
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== 0) y ^= mul(p[i], xp);
    xp = mul(xp, x);
  }
  return y;
}

function polyMulLE(p, q) {
  const out = new Array(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) continue;
    for (let j = 0; j < q.length; j++) out[i + j] ^= mul(p[i], q[j]);
  }
  return out;
}

/**
 * 형식적 미분 Λ'(x) — 표수 2 에서 짝수 차수 항은 소멸한다.
 * Λ'(x) = Σ_{i 홀수} Λ_i · x^(i-1)
 */
function polyDerivLE(p) {
  const out = new Array(Math.max(p.length - 1, 1)).fill(0);
  for (let i = 1; i < p.length; i += 2) out[i - 1] = p[i];
  return out;
}

/**
 * Berlekamp-Massey. 신드롬열을 만드는 최단 LFSR 의 연결다항식 Λ(x) 를 찾는다.
 * @param {Uint8Array} synd 저차→고차 신드롬
 * @returns {{lambda: number[], L: number}} lambda 는 little-endian, lambda[0] === 1
 */
function berlekampMassey(synd) {
  let lambda = [1]; // Λ(x), little-endian
  let B = [1]; // 직전 갱신 시점의 Λ
  let L = 0; // 현재 LFSR 길이 = 추정 오류 개수
  let m = 1; // 마지막 갱신 이후 경과 스텝
  let b = 1; // 마지막 갱신 시점의 불일치값

  for (let n = 0; n < synd.length; n++) {
    // 불일치 d = S_n + Σ_{i=1..L} Λ_i · S_{n-i}
    let d = synd[n];
    for (let i = 1; i <= L; i++) {
      if (i < lambda.length && lambda[i] !== 0) d ^= mul(lambda[i], synd[n - i]);
    }

    if (d === 0) {
      m += 1;
      continue;
    }

    // Λ_new(x) = Λ(x) - (d/b)·x^m·B(x)   (표수 2 → XOR)
    const coef = div(d, b);
    const prev = lambda.slice();
    const need = B.length + m;
    if (lambda.length < need) lambda = lambda.concat(new Array(need - lambda.length).fill(0));
    for (let i = 0; i < B.length; i++) {
      if (B[i] !== 0) lambda[i + m] ^= mul(coef, B[i]);
    }

    if (2 * L <= n) {
      L = n + 1 - L;
      B = prev;
      b = d;
      m = 1;
    } else {
      m += 1;
    }
  }

  // 선행 0 제거 (deg 를 정확히 읽기 위해)
  while (lambda.length > 1 && lambda[lambda.length - 1] === 0) lambda.pop();
  return { lambda, L };
}

/**
 * Chien 탐색. Λ(x) 의 근 x = X_k^{-1} 를 찾아 **코드워드 배열 인덱스** 로 환산한다.
 * big-endian 코드워드에서 배열 인덱스 j 는 x^(n-1-j) 항이므로 X_k = α^(n-1-j).
 * @returns {number[]} 오름차순 오류 위치(배열 인덱스)
 */
function chienSearch(lambda, n) {
  const positions = [];
  for (let j = 0; j < n; j++) {
    const p = n - 1 - j; // 이 위치의 x 차수
    // Λ(α^-p) === 0 이면 위치 j 에 오류
    if (polyEvalLE(lambda, alphaPow(-p)) === 0) positions.push(j);
  }
  return positions;
}

/**
 * Forney 알고리즘으로 오류 크기를 구한다.
 * Ω(x) = S(x)·Λ(x) mod x^nsym,  Y_k = X_k^(1-fcr) · Ω(X_k^-1) / Λ'(X_k^-1)
 * (표수 2 이므로 부호는 사라진다.)
 * @returns {number[]} positions 와 같은 순서의 오류 크기
 */
function forney(synd, lambda, positions, n, fcr) {
  const S = Array.from(synd); // little-endian: S[i] = S_i
  const full = polyMulLE(S, lambda);
  const omega = full.slice(0, synd.length);
  const dLambda = polyDerivLE(lambda);

  return positions.map((j) => {
    const p = n - 1 - j;
    const X = alphaPow(p); // 오류위치자 X_k
    const Xinv = alphaPow(-p);
    const denom = polyEvalLE(dLambda, Xinv);
    if (denom === 0) return null; // 특이 — 호출부에서 실패 처리
    const num = polyEvalLE(omega, Xinv);
    // X^(1-fcr)
    let scale = 1;
    const e = 1 - fcr;
    if (e !== 0) {
      const ee = ((e % MULTIPLICATIVE_ORDER) + MULTIPLICATIVE_ORDER) % MULTIPLICATIVE_ORDER;
      scale = alphaPow(p * ee);
    }
    return mul(scale, div(num, denom));
  });
}

/**
 * RS 복호. t = ⌊nsym/2⌋ 개까지의 심볼 오류를 정정한다.
 *
 * @param {Uint8Array|number[]} received 수신 코드워드 (메시지 ‖ 패리티)
 * @param {number} nsym
 * @param {{fcr?: number}} [options]
 * @returns {{ok: true, codeword: Uint8Array, message: Uint8Array, parity: Uint8Array,
 *            errorPositions: number[], errorCount: number, syndromes: Uint8Array}
 *         | {ok: false, reason: string, syndromes: Uint8Array, errorPositions: null}}
 *   던지지 않는다 (인자 자체가 잘못된 경우 제외).
 */
export function rsDecode(received, nsym, options = {}) {
  const { fcr = DEFAULT_FCR } = options;
  const cw = toBytes(received, 'received');
  validateNsym(nsym);
  validateFcr(fcr);
  if (cw.length > MAX_CODEWORD_LEN) {
    throw new RangeError(`코드워드 길이(${cw.length})가 ${MAX_CODEWORD_LEN} 을 넘는다`);
  }
  if (cw.length <= nsym) {
    throw new RangeError(`코드워드 길이(${cw.length})가 nsym(${nsym}) 이하다 — 메시지가 없다`);
  }

  const n = cw.length;
  const t = Math.floor(nsym / 2);
  const syndromes = rsSyndromes(cw, nsym, { fcr });

  const fail = (reason) => ({ ok: false, reason, syndromes, errorPositions: null });
  const succeed = (out, positions) => ({
    ok: true,
    codeword: out,
    message: out.slice(0, n - nsym),
    parity: out.slice(n - nsym),
    errorPositions: positions,
    errorCount: positions.length,
    syndromes,
  });

  let clean = true;
  for (let i = 0; i < syndromes.length; i++) {
    if (syndromes[i] !== 0) {
      clean = false;
      break;
    }
  }
  if (clean) return succeed(cw.slice(), []);

  const { lambda, L } = berlekampMassey(syndromes);
  if (L === 0 || L > t) {
    return fail(`오류 개수가 정정 한계를 넘었다 (Berlekamp-Massey deg Λ = ${L}, t = ${t})`);
  }
  if (lambda.length - 1 !== L) {
    return fail(`Λ 차수(${lambda.length - 1})와 LFSR 길이(${L})가 불일치 — 정정 불가`);
  }

  const positions = chienSearch(lambda, n);
  if (positions.length !== L) {
    return fail(
      `Chien 탐색이 Λ 의 근을 전부 찾지 못했다 (${positions.length}/${L}) — 정정 불가`,
    );
  }

  const magnitudes = forney(syndromes, lambda, positions, n, fcr);
  if (magnitudes.some((m) => m === null)) {
    return fail('Forney 분모 Λ′(X^-1) = 0 — 정정 불가');
  }

  const out = cw.slice();
  const changed = [];
  for (let k = 0; k < positions.length; k++) {
    if (magnitudes[k] === 0) continue; // 크기 0 = 실제로 바뀐 게 없는 허근
    out[positions[k]] ^= magnitudes[k];
    changed.push(positions[k]);
  }

  // 최종 검산: 정정 후 신드롬이 전부 0 이어야 유효 코드워드다.
  const after = rsSyndromes(out, nsym, { fcr });
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== 0) {
      return fail('정정 후에도 신드롬이 0 이 아니다 — 오류가 정정 한계를 넘었다');
    }
  }

  return succeed(out, changed);
}

/**
 * `rsDecode` 의 예외 던지는 래퍼. 성공 시 메시지 바이트만 돌려준다.
 * @throws {RSDecodeError}
 */
export function rsDecodeMessage(received, nsym, options = {}) {
  const result = rsDecode(received, nsym, options);
  if (!result.ok) {
    throw new RSDecodeError(`RS 복호 실패: ${result.reason}`, {
      reason: result.reason,
      syndromes: result.syndromes,
    });
  }
  return result.message;
}
