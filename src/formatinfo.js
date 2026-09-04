// formatinfo.js — 포맷 정보: CRC-6 + 12bit ↔ 5digit 변환 + 고정 마스크 + 3중 복제 다수결 (SPEC §5.4)
//
// ─────────────────────────────────────────────────────────────────────────────
// 배경 — SPEC §13 TBD 2건을 이 모듈이 확정한다
// ─────────────────────────────────────────────────────────────────────────────
//
// 포맷 정보 내용(§5.4): 버전 인덱스 4bit + ECC 레벨 2bit + CRC 6bit = 12bit.
// 채널이 보는 것은 **digit** 이므로(불스아이 인접 링에 5심볼씩 3중 복제·다수결 판독),
// CRC 다항식 선정은 bit 도메인이 아니라 **digit 도메인 전쌍 최소 해밍 거리**를
// 1순위로 삼는다. 64개 유효 페이로드(6bit) 전수에 대해 5개 표준 후보를 전수 비교한
// 결과는 이 파일 하단 주석 [측정표]에 있다 — 선정 근거가 회귀 테스트로 보호된다
// (formatinfo.test.js 가 SELECTED_MIN_DIGIT_DISTANCE 를 고정 상수로 단언).
//
// **선정 결과: CRC-6/CDMA2000-B (poly 0x07)**.
//   1순위(digit 최소 거리) 동률 2건 — CRC-6/ITU(0x03) 와 CRC-6/CDMA2000-B(0x07),
//   둘 다 digit 최소 거리 2. 2순위(bit 최소 거리)로 갈라짐 — CDMA2000-B 는 4,
//   ITU 는 3. CDMA2000-B 승.
//
// CRC 계산 규약: **비반사(non-reflected), MSB-first, init=0, xorout=0**, 6bit
// 메시지 뒤에 6bit 0 을 붙여 나눈 것과 동일한 표준 bit-serial 나눗셈. 여기서
// "CRC-6/CDMA2000-B" 라는 이름은 다항식 상수(0x07)의 출처 식별자일 뿐, refin/refout
// 까지 포함한 외부 표준과의 bit-exact 호환을 주장하지 않는다 — 이 필드는 이 포맷
// 안에서만 왕복하면 되는 폐쇄 채널이다.
//
// ─────────────────────────────────────────────────────────────────────────────
// 포맷 **v2** (6 digit) — 2026-08-16 운영자 승인 개정, 마스크 선택 도입
// ─────────────────────────────────────────────────────────────────────────────
//
// 마스크 선택(`src/mask.js`)이 고른 index 를 와이어에 실어야 한다. 자릿수 예산
// (`claude-mimic-rate.md` §5.2):
//
//   6^5 = 7776 >= 2^12 = 4096 — 그러나 2^13 = 8192 > 7776 이라 **5 digit 에 13번째
//   비트는 못 넣는다**. 남은 0.92 bit 는 쓸 수 없다.
//   6^6 = 46656 >= 2^15 = 32768 — **6 digit 이면 15 bit** 까지 들어간다 (+3 bit).
//
// **옵션 A 채택** (운영자 지시): 6번째 digit 추가 → 포맷 셀 15 → **18** (3중 복제 × 6).
//
//   payload 9 bit = 버전 4 + ECC 2 + **마스크 2** + 예약 1
//   codeword 15 bit = payload 9 + CRC 6
//
// 필드 순서(MSB-first): `version(4) | ecc(2) | mask(2) | reserved(1)`.
//
// **왜 A 인가 — 실패의 종류.** 버전 필드를 쪼개는 대안(B/C)은 코드워드 폭이 그대로라
// 구 디코더가 CRC-6 을 통과시킨 뒤 버전만 틀리게 읽는다(조용한 오독). A 는 포맷 셀
// 수 자체가 달라져 구 디코더가 **반드시 CRC 에서 떨어진다** — 깨끗한 거부다.
// 대가는 데이터 셀 −3 = payload −1 B (§회계표).
//
// **v1(5 digit) 경로는 그대로 남는다** — 레거시 프레임 판독용. 두 경로는 상수·함수가
// 완전히 분리돼 있고(`*_V2` 접미사), CRC 다항식·계산 규약·마스크 유도 규칙은 공유한다.

// ── 페이로드 필드 폭 ─────────────────────────────────────────────────────────

/** 버전 인덱스 필드 폭 (bit). */
export const VERSION_BITS = 4;

/** ECC 레벨 필드 폭 (bit). */
export const ECC_BITS = 2;

/** 페이로드(버전+ECC) 폭 (bit). 유효 워드 2^6 = 64개. */
export const PAYLOAD_BITS = VERSION_BITS + ECC_BITS; // 6

/** CRC 폭 (bit). */
export const CRC_BITS = 6;

/** 코드워드(페이로드+CRC) 폭 (bit). */
export const CODEWORD_BITS = PAYLOAD_BITS + CRC_BITS; // 12

/** 5-digit(base-6) 로 표현 가능한 상태 수. 6^5 = 7776 >= 2^12 = 4096 이 성립해야 한다. */
export const DIGIT_COUNT = 5;

/** digit 1개의 알파벳 크기 (base-6, SPEC §4.1 과 동일 채널). */
export const DIGIT_BASE = 6;

// 모듈 로드 시 1회 자기검증: 6^5 >= 2^12.
(() => {
  const capacity = DIGIT_BASE ** DIGIT_COUNT;
  const need = 2 ** CODEWORD_BITS;
  if (capacity < need) {
    throw new Error(`자기검증 실패: ${DIGIT_BASE}^${DIGIT_COUNT}=${capacity} < 2^${CODEWORD_BITS}=${need}`);
  }
})();

/** ECC 레벨 열거값. 3(예약)은 인코더가 거부하고 디코더는 ok:false 로 처리한다 (SPEC §6). */
export const ECC_LEVEL = Object.freeze({ L: 0, M: 1, H: 2, RESERVED: 3 });

/**
 * ECC 값 → 이름. **`ECC_LEVEL` 에서 유도한다** — 손으로 적으면 어긋난다.
 *
 * 🔴 2026-09-04: 저장소에 이 역표의 손 사본이 이미 셋 있다
 * (`src/decode.js` · `src/decoder/decode-c.js` · `src/decoder/decode-k.js` 의
 * `ECC_LEVEL_BY_VALUE`). 넷째를 만들지 않으려고 여기 원본 옆에 유도해 둔다.
 * 새 소비자는 이것을 쓴다. 기존 셋의 통합은 별건이다.
 *
 * ⚠ `RESERVED` 는 **뺀다.** 이름으로 내보내면 소비자가 그대로 용량 API 에 넘기고
 * `capacityForCellSurfaceFinal(..., 'RESERVED', ...)` 가 RangeError 를 던진다.
 * 오늘은 `format-proposals.js` 가 RESERVED 후보를 먼저 버려 잠복이지만,
 * 그건 **우연한 방패**이지 이 표의 방어가 아니다.
 */
export const ECC_NAME_BY_VALUE = Object.freeze(Object.fromEntries(
  Object.entries(ECC_LEVEL)
    .filter(([name]) => name !== 'RESERVED')
    .map(([name, value]) => [value, name]),
));

// ── CRC-6 — 선정된 다항식 (측정표는 파일 하단) ──────────────────────────────

/** 선정된 CRC-6 다항식 (CRC-6/CDMA2000-B, 6bit, 암묵적 최상위 항 제외). */
export const CRC_POLY = 0x07;

/** 선정 근거로 고정하는 회귀 상수 — digit 도메인 전쌍 최소 해밍 거리 (64 코드워드). */
export const SELECTED_MIN_DIGIT_DISTANCE = 2;

/** 선정 근거로 고정하는 회귀 상수 — bit 도메인 전쌍 최소 해밍 거리 (12bit, 64 코드워드). */
export const SELECTED_MIN_BIT_DISTANCE = 4;

/**
 * 표준 비반사 bit-serial CRC. `dataBits` 하위 `dataLen` bit 뒤에 `n` bit 의 0 을
 * 붙여 나눈 것과 동치인 결과를 낸다(명시적 패딩 없이 레지스터 shift 만으로 계산).
 * @param {number} dataBits 메시지 (하위 dataLen bit 사용)
 * @param {number} dataLen 메시지 폭 (bit)
 * @param {number} poly 생성 다항식 (n bit, 암묵적 최상위 항 제외)
 * @param {number} n CRC 폭 (bit)
 * @returns {number} CRC 값 (0..2^n − 1)
 */
export function crcCompute(dataBits, dataLen, poly, n) {
  const mask = (1 << n) - 1;
  let reg = 0;
  for (let i = dataLen - 1; i >= 0; i -= 1) {
    const inBit = (dataBits >> i) & 1;
    const msb = (reg >> (n - 1)) & 1;
    reg = ((reg << 1) | inBit) & mask;
    if (msb) reg ^= poly;
  }
  for (let i = 0; i < n; i += 1) {
    const msb = (reg >> (n - 1)) & 1;
    reg = (reg << 1) & mask;
    if (msb) reg ^= poly;
  }
  return reg;
}

/**
 * 선정된 다항식으로 6bit 페이로드의 CRC-6 을 계산한다.
 * @param {number} payload6 0..63
 * @returns {number} 0..63
 */
export function crc6(payload6) {
  if (!Number.isInteger(payload6) || payload6 < 0 || payload6 >= (1 << PAYLOAD_BITS)) {
    throw new RangeError(`페이로드는 0..${(1 << PAYLOAD_BITS) - 1}: ${payload6}`);
  }
  return crcCompute(payload6, PAYLOAD_BITS, CRC_POLY, CRC_BITS);
}

// ── 12bit ↔ 5digit (base-6, MSD-first) ──────────────────────────────────────

/**
 * 0..4095 → 5-digit(base-6, MSD-first). §13 TBD "12bit → 5심볼 변환 규약" 확정.
 * @param {number} value 0..(6^5 − 1) 범위까지 허용(4096..7775 는 코드워드 도메인
 *   밖이지만 디코더가 마스크 해제 후 범위검사를 하려면 변환 자체는 열려 있어야 한다).
 * @returns {number[]} 길이 5, 각 원소 0..5
 */
export function toDigits5(value) {
  const max = DIGIT_BASE ** DIGIT_COUNT;
  if (!Number.isInteger(value) || value < 0 || value >= max) {
    throw new RangeError(`값 범위 위반: ${value} (허용 0..${max - 1})`);
  }
  const digits = new Array(DIGIT_COUNT).fill(0);
  let v = value;
  for (let i = DIGIT_COUNT - 1; i >= 0; i -= 1) {
    digits[i] = v % DIGIT_BASE;
    v = Math.floor(v / DIGIT_BASE);
  }
  return digits;
}

/**
 * 5-digit(base-6, MSD-first) → 0..7775. `toDigits5` 의 역함수.
 * @param {number[]} digits 길이 5, 각 원소 0..5
 * @returns {number}
 */
export function fromDigits5(digits) {
  assertDigits5(digits);
  let v = 0;
  for (let i = 0; i < DIGIT_COUNT; i += 1) v = v * DIGIT_BASE + digits[i];
  return v;
}

function assertDigits5(digits) {
  if (!digits || typeof digits.length !== 'number' || digits.length !== DIGIT_COUNT) {
    throw new TypeError(`digits 는 길이 ${DIGIT_COUNT} 배열이어야 한다`);
  }
  for (let i = 0; i < DIGIT_COUNT; i += 1) {
    const d = digits[i];
    if (!Number.isInteger(d) || d < 0 || d >= DIGIT_BASE) {
      throw new RangeError(`digit 범위 위반 (위치 ${i}): ${d} (허용 0..${DIGIT_BASE - 1})`);
    }
  }
}

// ── 고정 출력 마스크 ─────────────────────────────────────────────────────────
//
// 유도 과정(매직넘버 금지 — SPEC 요구): 전부 0 페이로드(버전=0, ECC=0)의 CRC 도
// 0 이므로 마스크가 없으면 코드워드=0, 5digit=[0,0,0,0,0] → 균일 패치로 렌더된다.
// 마스크 상수는 **이미 선정된 CRC_POLY 하나에서만** 유도한다(새 독립 상수 도입 금지):
// CRC_POLY(6bit, 0x07)를 12bit 폭으로 두 번 이어붙인 값 (POLY<<6 | POLY) 을
// 코드워드와 같은 5digit 변환기에 통과시킨 것이 마스크다. POLY 를 그대로 상위
// 6bit 에 반복해 쓰는 이유는, POLY 한 번만으로는 상위 6bit(=페이로드 폭)가 0으로
// 남아 5digit 중 앞쪽 자리가 여전히 0에 치우치기 때문 — 반복으로 12bit 전역에
// CRC_POLY 유래 비트를 퍼뜨린다.
//
// 이 마스크는 §4.3 데이터 마스크와 무관한 **별도 상수**다 — 포맷 셀은 데이터
// 마스크 대상이 아니다(SPEC §5.4 주석).

const MASK_SEED_12BIT = (CRC_POLY << CRC_BITS) | CRC_POLY;

/** 고정 출력 마스크 (5digit, mod-6 가산). CRC_POLY 유래 — 별도 매직넘버 아님. */
export const MASK_DIGITS = Object.freeze(toDigits5(MASK_SEED_12BIT));

/**
 * 5digit 에 고정 마스크를 mod-6 가산한다(인코더 방향).
 * @param {number[]} digits 길이 5
 * @returns {number[]} 길이 5, 마스크 적용됨
 */
export function applyMask(digits) {
  assertDigits5(digits);
  return digits.map((d, i) => (d + MASK_DIGITS[i]) % DIGIT_BASE);
}

/**
 * 마스크를 해제한다(디코더 방향). `applyMask` 의 역함수.
 * @param {number[]} digits 길이 5, 마스크 적용된 상태
 * @returns {number[]} 길이 5, 마스크 해제됨
 */
export function removeMask(digits) {
  assertDigits5(digits);
  return digits.map((d, i) => (d - MASK_DIGITS[i] + DIGIT_BASE) % DIGIT_BASE);
}

// ── 인코더 ───────────────────────────────────────────────────────────────────

/**
 * {version, eccLevel} → 5digit(base-6, 마스크 적용됨). 이 값을 3곳(120° 간격)에
 * 동일하게 반복 배치하는 것이 §5.4 의 "3중 복제" — 배치(레이아웃)는 이 모듈의
 * 소관이 아니라 호출측(hexgrid.js 사용부)의 몫이다.
 * @param {{version:number, eccLevel:number}} info
 * @returns {number[]} 길이 5
 */
export function encode({ version, eccLevel }) {
  if (!Number.isInteger(version) || version < 0 || version >= (1 << VERSION_BITS)) {
    throw new RangeError(`버전은 0..${(1 << VERSION_BITS) - 1}: ${version}`);
  }
  if (eccLevel === ECC_LEVEL.RESERVED) {
    throw new RangeError('ECC 레벨 3(예약값)은 인코더가 거부한다');
  }
  if (!Number.isInteger(eccLevel) || eccLevel < 0 || eccLevel >= (1 << ECC_BITS)) {
    throw new RangeError(`ECC 레벨은 0..${(1 << ECC_BITS) - 1}: ${eccLevel}`);
  }
  const payload = (version << ECC_BITS) | eccLevel;
  const crc = crc6(payload);
  const codeword = (payload << CRC_BITS) | crc;
  return applyMask(toDigits5(codeword));
}

/**
 * `encode` 결과를 3개의 동일한 복제로 반환한다(테스트/편의용 — 실제 위치는
 * 레이아웃 소관).
 * @param {{version:number, eccLevel:number}} info
 * @returns {number[][]} 길이 3, 각 원소 길이 5
 */
export function encodeReplicated(info) {
  const one = encode(info);
  return [one.slice(), one.slice(), one.slice()];
}

// ── 디코더 ───────────────────────────────────────────────────────────────────

/**
 * 마스크 적용된 5digit 1개를 단독으로 복호한다(다수결 없이).
 * @param {number[]} maskedDigits 길이 5
 * @returns {{version:number, eccLevel:number, ok:boolean}}
 */
export function decodeSingle(maskedDigits) {
  assertDigits5(maskedDigits);
  const unmasked = removeMask(maskedDigits);
  const codeword = fromDigits5(unmasked); // 0..7775 (5digit 전체 상태)
  if (codeword >= (1 << CODEWORD_BITS)) {
    // 4096..7775 는 12bit 코드워드 도메인 밖 — digit 조합 자체가 무효.
    return { version: 0, eccLevel: 0, ok: false };
  }
  const payload = codeword >> CRC_BITS;
  const crcField = codeword & ((1 << CRC_BITS) - 1);
  const version = payload >> ECC_BITS;
  const eccLevel = payload & ((1 << ECC_BITS) - 1);
  if (eccLevel === ECC_LEVEL.RESERVED) {
    return { version, eccLevel, ok: false };
  }
  const expectedCrc = crc6(payload);
  if (expectedCrc !== crcField) {
    return { version: 0, eccLevel: 0, ok: false };
  }
  return { version, eccLevel, ok: true };
}

/**
 * digit 위치별 다수결. 3개 읽기 중 2개 이상 일치하는 값을 채택한다.
 * @param {number[][]} reads 길이 3, 각 원소 길이 5
 * @returns {{digits:number[], hasMajority:boolean}} hasMajority 는 5자리 전부
 *   2표 이상 합의가 있었는지
 */
export function majorityVote(reads) {
  if (!Array.isArray(reads) || reads.length !== 3) {
    throw new TypeError('reads 는 길이 3 배열이어야 한다');
  }
  reads.forEach(assertDigits5);
  const digits = new Array(DIGIT_COUNT).fill(0);
  let hasMajority = true;
  for (let i = 0; i < DIGIT_COUNT; i += 1) {
    const counts = new Map();
    for (const r of reads) counts.set(r[i], (counts.get(r[i]) ?? 0) + 1);
    let bestVal = reads[0][i];
    let bestCount = 0;
    for (const [val, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestVal = val;
      }
    }
    if (bestCount < 2) hasMajority = false;
    digits[i] = bestVal;
  }
  return { digits, hasMajority };
}

/**
 * 3중 복제 다수결 복호 (SPEC §5.4). 디코더 진입점.
 * 순서: ① digit 별 다수결 → CRC 검증. 실패하면 ② 각 복제를 개별 시도해 첫 성공을
 * 채택. 전부 실패하면 ok:false.
 * @param {number[][]} reads 길이 3, 각 원소 길이 5 (마스크 적용된 원판독값)
 * @returns {{version:number, eccLevel:number, ok:boolean}}
 */
export function decode(reads) {
  if (!Array.isArray(reads) || reads.length !== 3) {
    throw new TypeError('reads 는 길이 3 배열이어야 한다');
  }
  const { digits: majorityDigits } = majorityVote(reads);
  const majorityResult = decodeSingle(majorityDigits);
  if (majorityResult.ok) return majorityResult;

  for (const r of reads) {
    const single = decodeSingle(r);
    if (single.ok) return single;
  }
  return { version: 0, eccLevel: 0, ok: false };
}

// ═════════════════════════════════════════════════════════════════════════════
// 포맷 v2 — 15bit ↔ 6digit (마스크 선택 2bit + 예약 1bit)
// ═════════════════════════════════════════════════════════════════════════════
//
// 위 v1 경로는 한 줄도 바뀌지 않았다. 아래는 **추가**다.

/** v2 마스크 index 필드 폭 (bit). `src/mask.js` MASK_INDEX_BITS 와 동일해야 한다. */
export const MASK_BITS_V2 = 2;

/** v2 예약 필드 폭 (bit). 인코더는 0 만 쓰고 디코더는 0 이 아니면 거부한다. */
export const RESERVED_BITS_V2 = 1;

/** v2 페이로드(버전+ECC+마스크+예약) 폭 (bit). 유효 워드 2^9 = 512개. */
export const PAYLOAD_BITS_V2 = VERSION_BITS + ECC_BITS + MASK_BITS_V2 + RESERVED_BITS_V2; // 9

/** v2 코드워드(페이로드+CRC) 폭 (bit). */
export const CODEWORD_BITS_V2 = PAYLOAD_BITS_V2 + CRC_BITS; // 15

/** v2 digit 수. 6^6 = 46656 >= 2^15 = 32768 이 성립해야 한다. */
export const DIGIT_COUNT_V2 = 6;

/** v2 포맷 셀 수 = 3중 복제 × 6 digit. (v1 은 15.) */
export const FORMAT_CELLS_V2 = 3 * DIGIT_COUNT_V2; // 18

/** 마스크 index 예약값 — 후보가 3종이라 2bit 중 3 은 미사용이다. */
export const MASK_INDEX_RESERVED = 3;

// 모듈 로드 시 1회 자기검증: 6^6 >= 2^15, 그리고 v1 이 그대로인지.
(() => {
  const capacity = DIGIT_BASE ** DIGIT_COUNT_V2;
  const need = 2 ** CODEWORD_BITS_V2;
  if (capacity < need) {
    throw new Error(`v2 자기검증 실패: ${DIGIT_BASE}^${DIGIT_COUNT_V2}=${capacity} < 2^${CODEWORD_BITS_V2}=${need}`);
  }
  if (DIGIT_COUNT !== 5 || CODEWORD_BITS !== 12) {
    throw new Error('v1 포맷 상수가 바뀌었다 — 레거시 판독 계약 위반');
  }
})();

/**
 * v2 페이로드의 CRC-6. **다항식·계산 규약은 v1 과 같다** (CRC_POLY 0x07, 비반사,
 * MSB-first, init=0, xorout=0) — 폭만 6bit → 9bit 메시지로 늘었다.
 * @param {number} payload9 0..511
 * @returns {number} 0..63
 */
export function crc6v2(payload9) {
  if (!Number.isInteger(payload9) || payload9 < 0 || payload9 >= (1 << PAYLOAD_BITS_V2)) {
    throw new RangeError(`v2 페이로드는 0..${(1 << PAYLOAD_BITS_V2) - 1}: ${payload9}`);
  }
  return crcCompute(payload9, PAYLOAD_BITS_V2, CRC_POLY, CRC_BITS);
}

// ── [v2 측정표] 같은 5 후보를 9bit 페이로드 / 15bit 코드워드 / 6digit 로 재측정 ──
//
// 방법은 v1 과 동일(파일 하단 [측정표] 주석). 512 코드워드 전수 · C(512,2)=130,816 쌍.
//
// | 이름              | poly | digit 최소거리 | bit 최소거리 |
// |-------------------|------|----------------|--------------|
// | CRC-6/ITU         | 0x03 | 1              | 3            |
// | CRC-6/CDMA2000-A  | 0x27 | 1              | 3            |
// | CRC-6/CDMA2000-B  | 0x07 | 1              | **4**        |
// | CRC-6/DARC        | 0x19 | 1              | **4**        |
// | CRC-6/GSM         | 0x2F | 1              | **4**        |
//
// 1순위(digit 최소거리)가 **전 후보 동률 1** 로 무너진다 — 15bit 를 6digit(6^6)에
// 넣으면 코드워드가 digit 공간에서 더 촘촘해져 «한 digit만 다른 유효 코드워드 쌍» 이
// 생긴다(v1 은 12bit/5digit 에서 2였다). 2순위(bit 최소거리)로 {0x07, 0x19, 0x2F} 3파전
// 동률 4. **재선정 근거가 없으므로 다항식은 v1 그대로 0x07 을 유지한다** (브리프 지시와
// 일치). 다항식을 바꿔도 얻는 것이 없다는 것이 이 표의 결론이다.
//
// 대가의 실측 (확정 0x07, 유효 페이로드 144개 = 예약 bit 0 · 마스크 index != 3 ·
// ECC != 3, 단일 복제 기준):
//   1-digit 오염 4,320종 중 미검출 **2** → 검출율 99.9537 % (v1 은 100 %)
//   2-digit 오염 54,000종 중 미검출 196 → 검출율 99.6370 % (v1 5digit 은 99.11 %)
// 즉 1-digit 이 100 %→99.95 % 로 내려가고 2-digit 은 오히려 올라간다. 그리고
// **3중 복제 다수결은 «한 복제의 1-digit 오염» 을 전수 복구한다** (테스트가 단언).

/** 선정 근거로 고정하는 회귀 상수 — v2 digit 도메인 전쌍 최소 해밍 거리 (512 코드워드). */
export const SELECTED_MIN_DIGIT_DISTANCE_V2 = 1;

/** 선정 근거로 고정하는 회귀 상수 — v2 bit 도메인 전쌍 최소 해밍 거리 (15bit, 512 코드워드). */
export const SELECTED_MIN_BIT_DISTANCE_V2 = 4;

/**
 * 0..(6^6−1) → 6-digit(base-6, MSD-first).
 * @param {number} value
 * @returns {number[]} 길이 6, 각 원소 0..5
 */
export function toDigits6(value) {
  const max = DIGIT_BASE ** DIGIT_COUNT_V2;
  if (!Number.isInteger(value) || value < 0 || value >= max) {
    throw new RangeError(`값 범위 위반: ${value} (허용 0..${max - 1})`);
  }
  const digits = new Array(DIGIT_COUNT_V2).fill(0);
  let v = value;
  for (let i = DIGIT_COUNT_V2 - 1; i >= 0; i -= 1) {
    digits[i] = v % DIGIT_BASE;
    v = Math.floor(v / DIGIT_BASE);
  }
  return digits;
}

/**
 * 6-digit(base-6, MSD-first) → 0..46655. `toDigits6` 의 역함수.
 * @param {number[]} digits 길이 6
 * @returns {number}
 */
export function fromDigits6(digits) {
  assertDigits6(digits);
  let v = 0;
  for (let i = 0; i < DIGIT_COUNT_V2; i += 1) v = v * DIGIT_BASE + digits[i];
  return v;
}

function assertDigits6(digits) {
  if (!digits || typeof digits.length !== 'number' || typeof digits === 'string'
    || digits.length !== DIGIT_COUNT_V2) {
    throw new TypeError(`digits 는 길이 ${DIGIT_COUNT_V2} 배열이어야 한다`);
  }
  for (let i = 0; i < DIGIT_COUNT_V2; i += 1) {
    const d = digits[i];
    if (!Number.isInteger(d) || d < 0 || d >= DIGIT_BASE) {
      throw new RangeError(`digit 범위 위반 (위치 ${i}): ${d} (허용 0..${DIGIT_BASE - 1})`);
    }
  }
}

// v2 고정 출력 마스크 — v1 과 **같은 유도 규칙**(CRC_POLY 를 코드워드 폭만큼 반복)을
// 폭 15bit 로 확장한다. 새 상수 없음: (POLY<<12) | (POLY<<6) | POLY.
const MASK_SEED_15BIT = (CRC_POLY << (CRC_BITS * 2)) | (CRC_POLY << CRC_BITS) | CRC_POLY;

/** v2 고정 출력 마스크 (6digit, mod-6 가산). CRC_POLY 유래 — 별도 매직넘버 아님. */
export const MASK_DIGITS_V2 = Object.freeze(toDigits6(MASK_SEED_15BIT));

/**
 * 6digit 에 v2 고정 마스크를 mod-6 가산한다(인코더 방향).
 * @param {number[]} digits 길이 6
 * @returns {number[]}
 */
export function applyMaskV2(digits) {
  assertDigits6(digits);
  return digits.map((d, i) => (d + MASK_DIGITS_V2[i]) % DIGIT_BASE);
}

/**
 * v2 마스크를 해제한다(디코더 방향). `applyMaskV2` 의 역함수.
 * @param {number[]} digits 길이 6
 * @returns {number[]}
 */
export function removeMaskV2(digits) {
  assertDigits6(digits);
  return digits.map((d, i) => (d - MASK_DIGITS_V2[i] + DIGIT_BASE) % DIGIT_BASE);
}

/**
 * v2 필드 → 9bit 페이로드. 필드 순서는 MSB-first `version|ecc|mask|reserved`.
 * @param {{version:number, eccLevel:number, maskIndex?:number, reserved?:number}} info
 * @returns {number} 0..511
 */
export function packPayloadV2({ version, eccLevel, maskIndex = 0, reserved = 0 }) {
  if (!Number.isInteger(version) || version < 0 || version >= (1 << VERSION_BITS)) {
    throw new RangeError(`버전은 0..${(1 << VERSION_BITS) - 1}: ${version}`);
  }
  if (eccLevel === ECC_LEVEL.RESERVED) {
    throw new RangeError('ECC 레벨 3(예약값)은 인코더가 거부한다');
  }
  if (!Number.isInteger(eccLevel) || eccLevel < 0 || eccLevel >= (1 << ECC_BITS)) {
    throw new RangeError(`ECC 레벨은 0..${(1 << ECC_BITS) - 1}: ${eccLevel}`);
  }
  if (maskIndex === MASK_INDEX_RESERVED) {
    throw new RangeError(`마스크 index ${MASK_INDEX_RESERVED}(예약값)은 인코더가 거부한다`);
  }
  if (!Number.isInteger(maskIndex) || maskIndex < 0 || maskIndex >= (1 << MASK_BITS_V2)) {
    throw new RangeError(`마스크 index 는 0..${(1 << MASK_BITS_V2) - 1}: ${maskIndex}`);
  }
  if (reserved !== 0) {
    throw new RangeError(`예약 bit 는 0 이어야 한다: ${reserved}`);
  }
  return (version << (ECC_BITS + MASK_BITS_V2 + RESERVED_BITS_V2))
    | (eccLevel << (MASK_BITS_V2 + RESERVED_BITS_V2))
    | (maskIndex << RESERVED_BITS_V2)
    | reserved;
}

/**
 * v2 포맷 인코더. {version, eccLevel, maskIndex} → 6digit(base-6, 마스크 적용됨).
 * 이 값을 3곳에 동일하게 반복 배치하는 것이 3중 복제 — 배치는 호출측 몫이다.
 * @param {{version:number, eccLevel:number, maskIndex?:number}} info
 * @returns {number[]} 길이 6
 */
export function encodeV2(info) {
  const payload = packPayloadV2(info);
  const crc = crc6v2(payload);
  const codeword = (payload << CRC_BITS) | crc;
  return applyMaskV2(toDigits6(codeword));
}

/**
 * `encodeV2` 결과를 3개의 동일한 복제로 반환한다.
 * @param {{version:number, eccLevel:number, maskIndex?:number}} info
 * @returns {number[][]} 길이 3, 각 원소 길이 6
 */
export function encodeReplicatedV2(info) {
  const one = encodeV2(info);
  return [one.slice(), one.slice(), one.slice()];
}

/**
 * 마스크 적용된 6digit 1개를 단독으로 복호한다(다수결 없이).
 * @param {number[]} maskedDigits 길이 6
 * @returns {{version:number, eccLevel:number, maskIndex:number, reserved:number, ok:boolean}}
 */
export function decodeSingleV2(maskedDigits) {
  assertDigits6(maskedDigits);
  const fail = { version: 0, eccLevel: 0, maskIndex: 0, reserved: 0, ok: false };
  const unmasked = removeMaskV2(maskedDigits);
  const codeword = fromDigits6(unmasked); // 0..46655
  if (codeword >= (1 << CODEWORD_BITS_V2)) {
    // 32768..46655 는 15bit 코드워드 도메인 밖 — digit 조합 자체가 무효.
    return { ...fail };
  }
  const payload = codeword >> CRC_BITS;
  const crcField = codeword & ((1 << CRC_BITS) - 1);
  const reserved = payload & ((1 << RESERVED_BITS_V2) - 1);
  const maskIndex = (payload >> RESERVED_BITS_V2) & ((1 << MASK_BITS_V2) - 1);
  const eccLevel = (payload >> (RESERVED_BITS_V2 + MASK_BITS_V2)) & ((1 << ECC_BITS) - 1);
  const version = payload >> (RESERVED_BITS_V2 + MASK_BITS_V2 + ECC_BITS);
  // 값싼 의미론 reject 는 CRC 보다 먼저 — v1 decodeSingle 의 순서를 그대로 따른다.
  if (eccLevel === ECC_LEVEL.RESERVED) {
    return { version, eccLevel, maskIndex, reserved, ok: false };
  }
  if (maskIndex === MASK_INDEX_RESERVED) {
    return { version, eccLevel, maskIndex, reserved, ok: false };
  }
  if (reserved !== 0) {
    // 예약 bit 를 쓰는 미래 개정본 — **조용히 오독하지 않고 거부**한다.
    return { version, eccLevel, maskIndex, reserved, ok: false };
  }
  if (crc6v2(payload) !== crcField) {
    return { ...fail };
  }
  return { version, eccLevel, maskIndex, reserved, ok: true };
}

/**
 * v2 digit 위치별 다수결. 3개 읽기 중 2개 이상 일치하는 값을 채택한다.
 * (v1 `majorityVote` 와 같은 구조 — digit 수만 6 이다. 소거 인지 다수결은
 * 다른 레인 소관이라 여기서는 손대지 않는다.)
 * @param {number[][]} reads 길이 3, 각 원소 길이 6
 * @returns {{digits:number[], hasMajority:boolean}}
 */
export function majorityVoteV2(reads) {
  if (!Array.isArray(reads) || reads.length !== 3) {
    throw new TypeError('reads 는 길이 3 배열이어야 한다');
  }
  reads.forEach(assertDigits6);
  const digits = new Array(DIGIT_COUNT_V2).fill(0);
  let hasMajority = true;
  for (let i = 0; i < DIGIT_COUNT_V2; i += 1) {
    const counts = new Map();
    for (const r of reads) counts.set(r[i], (counts.get(r[i]) ?? 0) + 1);
    let bestVal = reads[0][i];
    let bestCount = 0;
    for (const [val, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestVal = val;
      }
    }
    if (bestCount < 2) hasMajority = false;
    digits[i] = bestVal;
  }
  return { digits, hasMajority };
}

/**
 * v2 3중 복제 다수결 복호. 순서는 v1 `decode` 와 동일: ① digit 별 다수결 → CRC 검증,
 * 실패하면 ② 각 복제 개별 시도 첫 성공.
 * @param {number[][]} reads 길이 3, 각 원소 길이 6
 * @returns {{version:number, eccLevel:number, maskIndex:number, reserved:number, ok:boolean}}
 */
export function decodeV2(reads) {
  if (!Array.isArray(reads) || reads.length !== 3) {
    throw new TypeError('reads 는 길이 3 배열이어야 한다');
  }
  const { digits: majorityDigits } = majorityVoteV2(reads);
  const majorityResult = decodeSingleV2(majorityDigits);
  if (majorityResult.ok) return majorityResult;

  for (const r of reads) {
    const single = decodeSingleV2(r);
    if (single.ok) return single;
  }
  return { version: 0, eccLevel: 0, maskIndex: 0, reserved: 0, ok: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// [측정표] CRC-6 후보 전수 비교 (64 페이로드, 12bit 코드워드, 5digit 변환 후)
// ─────────────────────────────────────────────────────────────────────────────
//
// 방법: 각 후보 다항식으로 payload=0..63 전부에 대해 codeword=(payload<<6)|crc6
// 을 만들고 toDigits5 로 5digit 화. 64개 코드워드의 C(64,2)=2016 쌍 전수에 대해
// digit 도메인 해밍 거리(0..5)와 bit 도메인 해밍 거리(0..12)의 최솟값을 구함.
// 검출력은 각 유효 워드에서 단일 복제 내 1-digit(5자리×5값=25종/워드) 및
// 2-digit(C(5,2)×5×5=250종/워드) 오염을 전수 열거해 CRC(+범위검사)가 잡아내는
// 비율로 측정(범위 밖 4096..7775 로 튀는 조합은 자동 검출로 함께 집계).
//
// | 이름                | poly | digit 최소거리 | bit 최소거리 | 1-digit 검출율 | 2-digit 검출율 |
// |---------------------|------|-----------------|--------------|------------------|------------------|
// | CRC-6/ITU           | 0x03 | 2               | 3            | 100.00%          | 99.15%           |
// | CRC-6/CDMA2000-A    | 0x27 | 1               | 3            | 99.00%           | 98.975%          |
// | CRC-6/CDMA2000-B    | 0x07 | **2**           | **4**        | **100.00%**      | 99.1125%         |
// | CRC-6/DARC          | 0x19 | 1               | 4            | 99.375%          | 99.2375%         |
// | CRC-6/GSM           | 0x2F | 1               | 4            | 98.00%           | 98.925%          |
//
// 선정 규칙 적용: 1순위 digit 최소거리 최대 → {ITU(2), CDMA2000-B(2)} 동률.
// 2순위 bit 최소거리 최대 → CDMA2000-B(4) > ITU(3). **CDMA2000-B(0x07) 채택.**
// (3순위 "표준 채택 사례" 타이브레이크는 2순위에서 이미 갈렸으므로 불필요.)
