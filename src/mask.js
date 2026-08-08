// mask.js — 고정 마스크 m(q,r) (SPEC §4.3)
//
// SPEC §4.3: 고정 마스크 1종(QR 식 마스크 선택 없음). 데이터 digit 에 m(q,r) 을
// mod-6 가산해 시각 균일화 + 레퍼런스와의 혼동 방지를 노린다.
//
// ── 선정 절차 (순서 고정 — 규칙 먼저, 측정 다음, 선택 마지막) ────────────────
//
//   ① 카이제곱 균등성: 측정 영역(regionCells(k) 중 중심 2링 19셀 제외)에서
//      chi2(df=5) <= 15.086 (alpha=0.01 임계값)
//   ② 이웃 상관: 6방향을 3 정준 방향으로 축약(대칭 쌍 중복 제거)해 각 방향의
//      Cramér's V 를 재고, 후보의 대표값은 버전×방향 전체의 **최대값**. 이 최대값이
//      가장 작은 후보가 승자 후보.
//   ③ 축 방향 자기상관: 원점을 지나는 세 격자축 직선(t=-100..100)을 따라
//      주기 <=6 인 반복이 있으면 FAIL. (아핀형은 mod-6 선형이라 필연적으로
//      period | 6 이므로 여기서 항상 FAIL — 이것이 "축 밴딩" 예상 실패 모드다.)
//
//   ①③ 을 **둘 다** 통과한 후보만 ② 비교에 들어간다. ①③ 을 통과하는 후보가
//   하나뿐이면 ② 비교는 자명하게 그 후보가 승자다(TLcube/test/mask.test.js 의
//   실측이 이 상황임을 재확인한다). 동률이면 공식이 단순한 쪽.
//
// ── 실측 결과 요약 (T4 numbers_check 전문 참조) ───────────────────────────
//
//   candidate   ①(chi2<=15.086)      ③(주기<=6 없음)   ② maxV(참고, 비교 대상 아님)
//   affine      PASS (전 버전 <1)     FAIL(선형 필연)    1.0 (탈락이라 무의미)
//   quadratic   FAIL (전 버전 >>15)   FAIL              0.29~0.35 (탈락이라 무의미)
//   hash        PASS (전 버전 <9)     PASS               0.12~0.22
//
//   → ①③ 을 모두 통과하는 후보는 **hash** 뿐이다. CHOSEN = 'hash'.
//
// 정수 연산 안전성: q, r 이 |q|,|r| <= 20 범위(V3 k=10 보다 넉넉한 여유)에서
// ⚠ 첫 곱셈 `q * 0x9e3779b1` 은 int32 를 넘는다 (|q|=20 에서 ~5.3e10). 그래도 안전한
// 이유: double 은 2^53 까지 정수를 정확히 표현하고(|q|,|r| ≤ 2^21 에서 곱이 2^53 미만),
// 직후의 `| 0` / `^` 가 ToInt32 로 결정적으로 축약한다. 이후 단계는 `Math.imul` /
// `>>> ` 로 JS 정수 연산의 브라우저·Node 결정성을 못 박는다.

function mod6(n) {
  return ((n % 6) + 6) % 6;
}

// ── 후보 ①: 아핀형 (대조군) ────────────────────────────────────────────────
// (a·q + b·r) mod 6. mod-6 선형이라 계수 조합에 따라 반드시 어떤 축 방향으로
// 등차수열(주기 | 6)이 나타난다 — 실측 ③이 이를 확인한다. 대조군으로만 남긴다.
function affine(q, r) {
  return mod6(1 * q + 2 * r);
}

// ── 후보 ②: 이차형 ─────────────────────────────────────────────────────────
// (a·q + b·r + c·qr + d·q² + e·r²) mod 6. 짧은 주기는 피하지만(③ 통과 못함 —
// 이차항도 mod 6 에서 결국 주기적이다) 균등성이 실측상 크게 무너진다(① FAIL).
function quadratic(q, r) {
  return mod6(1 * q + 2 * r + 3 * q * r + 1 * q * q + 5 * r * r);
}

// ── 후보 ③: 정수 해시형 (선정) ─────────────────────────────────────────────
// 곱셈-시프트-XOR. 첫 곱은 double 정밀 정수 곱 + ToInt32 축약(위 헤더 주석 참조),
// 이후는 `Math.imul` — 전 단계가 IEEE754/ECMA 규정 연산이라 브라우저·Node 동일 결과다
// (테스트가 이를 단언한다). ⚠ 이 공식은 측정으로 확정됐다(SPEC §4.3) — 수정 금지.
function hash(q, r) {
  let h = (q * 0x9e3779b1) ^ (r * 0x85ebca77);
  h |= 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  h |= 0;
  return mod6(h);
}

/** 재측정 가능하도록 전 후보를 노출한다 (T4 선정 규칙 재실행용). */
export const CANDIDATES = Object.freeze({ affine, quadratic, hash });

/** 확정된 후보 이름. */
export const CHOSEN = 'hash';

/**
 * 확정 마스크 공식. m(q, r) → {0..5}.
 * @param {number} q
 * @param {number} r
 * @returns {number}
 */
export function maskValue(q, r) {
  return hash(q, r);
}

/**
 * 데이터 digit 에 마스크를 mod-6 가산한다 (인코더가 쓴다).
 * @param {number} digit 0..5
 * @param {number} q
 * @param {number} r
 * @returns {number} 마스킹된 digit 0..5
 */
export function maskAdd(digit, q, r) {
  return mod6(digit + maskValue(q, r));
}

/**
 * 마스크를 걷어낸다 (디코더가 쓴다). maskAdd 의 역연산.
 * @param {number} maskedDigit 0..5
 * @param {number} q
 * @param {number} r
 * @returns {number} 원본 digit 0..5
 */
export function maskSub(maskedDigit, q, r) {
  return mod6(maskedDigit - maskValue(q, r));
}
