// mask.js — 마스크 m(q,r) · 후보 3종 + 선택 (SPEC §4.3 → 마스크 선택 개정)
//
// SPEC §4.3(구): 고정 마스크 1종(QR 식 마스크 선택 없음). 데이터 digit 에 m(q,r) 을
// mod-6 가산해 시각 균일화 + 레퍼런스와의 혼동 방지를 노린다.
//
// **개정 (2026-08-16, 운영자 지시)**: 데이터 필드가 파인더로 오인되는 문제
// (`claude-mimic-rate.md` §2\~§3 실측 — 검증 통과 히트의 67\~73 % 가 mimic)에 대응해
// **후보 3종 중 렌더-스캔 페널티 최소 후보를 인코더가 고른다.** 고른 index 는 포맷
// v2 의 6번째 digit(마스크 2 bit)에 실린다 — 와이어에 실리므로 디코더가 되읽는다.
//
// ── 후보 family — «새 매직넘버 금지» 를 지키는 유도 ─────────────────────────
//
// 후보는 **이미 선정된 hash 공식 하나에서만** 파생한다(새 상수 도입 금지):
// 아발란치 직전 단계에 **그 공식이 이미 쓰는 상수**를 seed 로 XOR 한다.
//
//   seed 0 = 0            → XOR 항등 ⇒ **현행 hash 와 바이트 동일** (와이어 보존)
//   seed 1 = 0x9e3779b1   → 이 공식의 q 계수 (황금비 상수)
//   seed 2 = 0x85ebca77   → 이 공식의 r 계수 (murmur3 fmix32 상수)
//
// seed 는 좌표에 곱해지지 않고 상수로 XOR 되므로 후보 간 관계가 «좌표 평행이동» 이
// 아니다 — 아발란치(shift-xor · imul)를 통과하며 세 필드가 서로 무상관해진다(§실측표).
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
// ── 후보 3종 3관문 재측정 (2026-08-16, `test/output/lanes/mask-gates.mjs`) ──
//
//   같은 3관문을 seed 파생 후보 3종에 그대로 돌린 결과. ③ 은 세 후보 모두 주기 없음.
//
//   후보(seed)          ① chi2 V1/V2/V3       ①판정   ② maxV(hex)  ② maxV(Y)
//   mask0 (0x00000000)  8.556 / 5.636 / 4.692  PASS    0.2237       0.1918
//   mask1 (0x9e3779b1)  4.889 / 8.485 / 9.115  PASS    0.2647       0.1715
//   mask2 (0x85ebca77)  5.333 / 5.091 / 2.538  PASS    0.2387       0.1975
//
//   ② 는 «①③ 통과자 중 하나를 고르는» 타이브레이크였다. 마스크 **선택** 체제에서는
//   셋 다 남기므로 ② 는 기각 기준이 아니라 참고값이다 — 그래도 세 후보가 모두
//   affine(1.0)·quadratic(0.29\~0.35) 대비 낮은 대역(0.14\~0.27)에 있음을 확인한다.
//   후보 간 «같은 digit» 비율은 Y1(441셀)에서 0.127 / 0.145 / 0.191 로 무상관
//   기대치 1/6 ≈ 0.167 부근 — 세 필드가 서로의 평행이동이 아니다.
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
//
// `seed` 는 2026-08-16 마스크 선택 개정이 더한 유일한 자유도다. seed=0 이면
// `h ^ 0 === h` 라 **개정 전 공식과 연산 하나까지 동일**하다 — 구 와이어 보존.
function hashSeeded(q, r, seed) {
  let h = (q * 0x9e3779b1) ^ (r * 0x85ebca77);
  h ^= seed;
  h |= 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  h |= 0;
  return mod6(h);
}

function hash(q, r) {
  return hashSeeded(q, r, 0);
}

/**
 * 마스크 후보 seed — 새 상수 없음. 0(항등) · hash 공식의 q 계수 · r 계수.
 * 순서가 곧 **마스크 index** 이고 그대로 와이어(포맷 v2 6번째 digit)에 실린다.
 */
export const MASK_SEEDS = Object.freeze([0, 0x9e3779b1, 0x85ebca77]);

/** 후보 수. 포맷 v2 의 마스크 필드는 2 bit(0..3) — 3 사용 · 1 예약. */
export const MASK_COUNT = MASK_SEEDS.length;

/** 마스크 index 필드 폭 (bit). 포맷 v2 payload 와 공유하는 계약. */
export const MASK_INDEX_BITS = 2;

/** 개정 전 동작(마스크 선택 없음)의 index — 생략 시 기본값. */
export const DEFAULT_MASK_INDEX = 0;

export function assertMaskIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MASK_COUNT) {
    throw new RangeError(`마스크 index 는 0..${MASK_COUNT - 1}: ${index}`);
  }
  return index;
}

/** 재측정 가능하도록 전 후보를 노출한다 (T4 선정 규칙 재실행용). */
export const CANDIDATES = Object.freeze({ affine, quadratic, hash });

/**
 * 마스크 index → 공식. 3관문 재측정(`test/mask.test.js`)이 이 배열을 훑는다.
 * 원소 0 은 `CANDIDATES.hash` 와 **같은 값을 낸다**(seed 0 항등).
 */
export const MASK_CANDIDATES = Object.freeze(
  MASK_SEEDS.map((seed) => Object.freeze((q, r) => hashSeeded(q, r, seed))),
);

/** 확정된 후보 이름 (family). */
export const CHOSEN = 'hash';

/**
 * 마스크 공식. m(q, r) → {0..5}.
 * @param {number} q
 * @param {number} r
 * @param {number} [maskIndex] 0..MASK_COUNT−1. 생략하면 0 = 개정 전 고정 마스크.
 * @returns {number}
 */
export function maskValue(q, r, maskIndex = DEFAULT_MASK_INDEX) {
  return hashSeeded(q, r, MASK_SEEDS[assertMaskIndex(maskIndex)]);
}

/**
 * 데이터 digit 에 마스크를 mod-6 가산한다 (인코더가 쓴다).
 * @param {number} digit 0..5
 * @param {number} q
 * @param {number} r
 * @param {number} [maskIndex]
 * @returns {number} 마스킹된 digit 0..5
 */
export function maskAdd(digit, q, r, maskIndex = DEFAULT_MASK_INDEX) {
  return mod6(digit + maskValue(q, r, maskIndex));
}

/**
 * 마스크를 걷어낸다 (디코더가 쓴다). maskAdd 의 역연산.
 * @param {number} maskedDigit 0..5
 * @param {number} q
 * @param {number} r
 * @param {number} [maskIndex]
 * @returns {number} 원본 digit 0..5
 */
export function maskSub(maskedDigit, q, r, maskIndex = DEFAULT_MASK_INDEX) {
  return mod6(maskedDigit - maskValue(q, r, maskIndex));
}
