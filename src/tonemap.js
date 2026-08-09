// tonemap.js — Type Y 2톤(면당 2채널) 배정표 · 등급 iii 분류기 · 분리 계약
// (SPEC §14, ADR 0003 v3.1 §4b D9 · U14 · U17)
//
// 2톤 메인 전환의 와이어 계약 원본. 3톤(순위 3! 배정)은 lehmer.js 소관 그대로이고,
// 이 모듈은 2톤 전용(면당 밝음/어두움 2상태) 배정표 · 분류기 · 분리 하한만 다룬다.
// sceneY.js(인코딩→색) · verifyY.js(관측→복호) 양쪽이 이 모듈 하나만 참조한다
// (배정표 이중정의 금지 — D9 신규 와이어 계약).
//
// 런타임 의존성 0 · 순수 ESM (node: API 금지, Math.random/Date/hypot/삼각함수 금지 —
// 결정성 계약, AGENTS.md 공통 규약. Math.sqrt/Math.log/Math.exp 는 삼각함수가 아니라
// 허용 대상이다).

/**
 * D9 배정표 — digit(0..5) → (T,L,R) 비트, 이 순서 고정. 1=밝음, 0=어두움.
 * d<3 = 단독 밝음 면(그 면만 1) · d>=3 = 단독 어두움 면(그 면만 0, =d-3 의 보수) ·
 * 보수쌍 d<->d+3. 전부-밝음(1,1,1)·전부-어두움(0,0,0) 은 표에 없다 — 불법 트리플이다.
 * @type {ReadonlyArray<ReadonlyArray<number>>}
 */
export const TONE_PATTERNS = Object.freeze([
  Object.freeze([1, 0, 0]), // d0 — T만 밝음
  Object.freeze([0, 1, 0]), // d1 — L만 밝음
  Object.freeze([0, 0, 1]), // d2 — R만 밝음
  Object.freeze([0, 1, 1]), // d3 — T만 어두움 (d0 의 보수)
  Object.freeze([1, 0, 1]), // d4 — L만 어두움 (d1 의 보수)
  Object.freeze([1, 1, 0]), // d5 — R만 어두움 (d2 의 보수)
]);

/** 심볼 알파벳 크기 = 6 (lehmer.js RADIX 와 동일 채널, 여기서는 독립 상수로 둔다 —
 * tonemap.js 가 lehmer.js 를 참조하지 않는다: 2톤 배정표는 순열이 아니라 직접
 * 열거된 표이므로 3! 유도 경로가 필요 없다). */
const RADIX = TONE_PATTERNS.length;

/** "TLR 비트 문자열" → digit 역방향 조회. 모듈 로드 시 1회 구성. */
const PATTERN_TO_DIGIT = new Map();
TONE_PATTERNS.forEach((pattern, digit) => {
  PATTERN_TO_DIGIT.set(pattern.join(''), digit);
});

function assertDigit(digit) {
  if (!Number.isInteger(digit) || digit < 0 || digit >= RADIX) {
    throw new RangeError(`digit 범위 위반: ${digit} (허용 0..${RADIX - 1})`);
  }
}

function assertBit(bit, label) {
  if (bit !== 0 && bit !== 1) {
    throw new RangeError(`${label} 는 0 또는 1 이어야 한다: ${bit}`);
  }
}

/**
 * digit → (T,L,R) 비트 객체(1=밝음). sceneY.js 가 face 문자열로 바로 인덱싱할 수
 * 있도록 배열이 아니라 객체로 노출한다.
 * @param {number} digit 0..5
 * @returns {{T:number, L:number, R:number}}
 */
export function digitToPattern(digit) {
  assertDigit(digit);
  const [t, l, r] = TONE_PATTERNS[digit];
  return { T: t, L: l, R: r };
}

/**
 * (T,L,R) 비트 → digit. 전부-밝음(1,1,1)·전부-어두움(0,0,0) 은 표에 없는 불법
 * 트리플이므로 `null` 을 반환한다(throw 하지 않는다 — 디코더 정상 경로, 자기표식
 * 소거 후보로 다루는 것이 호출측(verifyY.js)의 몫이다, U18).
 * @param {number} bitsT 0|1
 * @param {number} bitsL 0|1
 * @param {number} bitsR 0|1
 * @returns {number|null}
 */
export function patternToDigit(bitsT, bitsL, bitsR) {
  assertBit(bitsT, 'bitsT');
  assertBit(bitsL, 'bitsL');
  assertBit(bitsR, 'bitsR');
  const found = PATTERN_TO_DIGIT.get(`${bitsT}${bitsL}${bitsR}`);
  return found === undefined ? null : found;
}

/**
 * U14 — 면별 임계 θ_f 산출: **D2 필드 정규화 후 앵커 적합치**(obsLo, obsHi) 의
 * 로그 중점 √(obsLo·obsHi) (등급 iii). 모델 상수 임계((obsLo+obsHi)/2, 산술 중점)는
 * 규약상 금지 — 이 함수만이 θ_f 산출 경로다(ADR 0003 v3.1 D9).
 * @param {number} obsLo 어두운 앵커 적합치 (정규화 후, 양수)
 * @param {number} obsHi 밝은 앵커 적합치 (정규화 후, 양수)
 * @returns {number}
 */
export function thetaFromAnchors(obsLo, obsHi) {
  if (!(obsLo > 0) || !(obsHi > 0)) {
    throw new RangeError(`앵커 적합치는 양수여야 한다: obsLo=${obsLo}, obsHi=${obsHi}`);
  }
  return Math.sqrt(obsLo * obsHi);
}

/**
 * 면별 관측값(정규화 후) vs 면별 임계 θ_f 로 트리플을 분류한다. face 값 >
 * theta_f 이면 그 면은 밝음(1). 불법 트리플(전부-밝음/전부-어두움)은
 * `{digit: null, illegal: true}` — mismatch 가 아니라 소거 후보다.
 * @param {{T:number, L:number, R:number}} values 면별 관측(정규화 후)
 * @param {{T:number, L:number, R:number}} theta 면별 θ_f
 * @returns {{digit: number|null, illegal: boolean}}
 */
export function classifyTriple(values, theta) {
  const bitsT = values.T > theta.T ? 1 : 0;
  const bitsL = values.L > theta.L ? 1 : 0;
  const bitsR = values.R > theta.R ? 1 : 0;
  const digit = patternToDigit(bitsT, bitsL, bitsR);
  return { digit, illegal: digit === null };
}

/**
 * U17 — 2톤 분리 계약 하한. ρ = y_hi/y_lo >= RHO_MIN 이면 √ρ >= 3.162 로, 3톤
 * 실현 결정 마진(3.161, ADR 0003 §4b) 이상을 보장한다. slate 프리셋 실측 ρ ≈ 12.59
 * (levels[0] vs levels[2]) — 여유 있게 통과.
 */
export const RHO_MIN = 10;

/**
 * 팔레트 2톤 분리 게이트(U17). ρ = yHi/yLo < RHO_MIN 이면 RangeError.
 * @param {number} yLo 어두운 레벨(levels[0]) 상대휘도
 * @param {number} yHi 밝은 레벨(levels[2]) 상대휘도
 */
export function assertToneSeparation(yLo, yHi) {
  if (!(yLo > 0) || !(yHi > 0)) {
    throw new RangeError(`분리 검증 대상은 양수여야 한다: yLo=${yLo}, yHi=${yHi}`);
  }
  const rho = yHi / yLo;
  if (!(rho >= RHO_MIN)) {
    throw new RangeError(
      `2톤 분리비 ρ=${rho} 가 RHO_MIN(${RHO_MIN}) 미달이다 (U17: yLo=${yLo}, yHi=${yHi})`,
    );
  }
}
