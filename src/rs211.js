/**
 * rs211.js — 체계적 Reed-Solomon 부호 over GF(211)
 *
 * ADR 0001 §6 / §8.3: RS 부호화를 **셀 도메인**으로 옮긴다 — RS 심볼 1개 =
 * 셀 3개(digit 3개, base-211). 코드워드 = 메시지 ‖ 패리티, n ≤ 210(체의
 * 곱셈군 위수).
 *
 * ⚠ GF(2^8) 용 `rs.js` 를 그대로 베끼면 안 된다. 표수가 2 가 아니므로:
 *   - 부호화의 "몫 없이 나머지만" 트릭에서 XOR 대신 진짜 뺄셈을 쓴다.
 *   - Berlekamp-Massey 의 갱신식이 뺄셈을 쓴다 (XOR 로는 GF(2^m) 에서만 우연히 맞는다).
 *   - Forney 공식에 **음의 부호가 실재한다** — GF(2^m) 은 -1=1 이라 안 보였을 뿐이다.
 *   - 형식적 미분 Λ'(x) 는 "홀수항만 남는" GF(2^m) 트릭이 아니라 일반 미적분과
 *     같다: d/dx(Λ_k x^k) = (k mod p)·Λ_k·x^(k-1).
 *
 * 복호 실패는 절대 조용히 삼키지 않는다 — `{ ok:false, reason }` 을 돌려주거나
 * `RSDecodeError` 를 던진다. 오류가 t 개를 넘으면 원리적으로 다른 유효
 * 코드워드로 오정정될 수 있고(그때는 ok:true 지만 값이 다름) 이는 부호의
 * 한계이지 버그가 아니다 — 상위 계층(포맷 CRC 등)이 최종 방어선이다.
 *
 * 의존성 0. 브라우저 ESM 으로 그대로 로드된다.
 */

import { P, MULTIPLICATIVE_ORDER, add, sub, mul, div, inverse, alphaPow, polyEval } from './gfp.js';

/** 코드워드 최대 길이. RS over GF(q) 는 n ≤ q − 1 — GF(211) 에서 210. */
export const MAX_CODEWORD_LEN = MULTIPLICATIVE_ORDER;

/** 생성다항식 첫 근 지수 (first consecutive root) 기본값. */
export const DEFAULT_FCR = 0;

/**
 * 규범 nsym 표 — **공식으로 유도하지 않는다** (ADR 0001 §3.3.3: 공식+플래그 조합이
 * 비대칭 비교 사고를 두 번 냈다).
 *
 * 출처를 정확히 가른다 (검증 라운드 지적 반영):
 * - **M 값 (7 / 14 / 23): ADR §3.3.2, 2026-07-29 사용자 확정.** V3 = 23 은 같은 t=11 을
 *   주는 22 대신 +1 B 를 오정정 검출 여유로 지출한 명시적 결정이다 (패리티율 정확히 25.0%).
 * - **V3 H = 37: ADR §8.1 ECC-H 실측 행** (nsym=37 · K=53 B · ε@95% 4.5~5.0%).
 * - **L 값 전부와 V1/V2 의 H 값: 오케스트레이터 파생** — SPEC §6 비율(L 12% / H 40%)을
 *   심볼 수에 곱해 반올림한 것 (V1: 27×0.12→3, 27×0.4→11 / V2: 55×0.12→7, 55×0.4→22 /
 *   V3: 92×0.12→11). ADR·PM 문서에는 없다. SPEC §5.5 재생성 시 이 파생값이 표와 함께
 *   규범으로 승격된다 — 그 전까지는 잠정.
 *
 * **M0 T8 오버헤드 대사 (통합자 사전 검산, placement.js `overheadBreakdown(k)` 실계산과
 * 일치)**: V2 의 overhead 가 잠정 50 → 실계산 49 로 정정되며 데이터 셀이 167 → 168 로
 * 늘고(3의 배수), 이에 따라 사용 심볼 S 가 55 → **56** 으로 바뀐다. **nsym(L7/M14/H22) 은
 * 하나도 바뀌지 않는다** — M=14 는 56 기준으로도 패리티율이 정확히 25.0%(14/56)라
 * ADR §3.3.2 확정값을 그대로 재사용해도 비율 요건이 깨지지 않는다. V1(overhead 45→45,
 * symbols 27 불변)·V3(overhead 55→53, dataCells 276→278, residual 0→2 지만 ⌊278/3⌋=92
 * 로 symbols 92 불변)는 usedSymbols 자체가 바뀌지 않아 nsym 표를 그대로 쓴다.
 */
export const NSYM_TABLE = Object.freeze({
  V1: Object.freeze({ symbols: 27, L: 3, M: 7, H: 11 }),
  V2: Object.freeze({ symbols: 56, L: 7, M: 14, H: 22 }),
  V3: Object.freeze({ symbols: 92, L: 11, M: 23, H: 37 }),
  // ── V4 «대용량» (k=12, 2026-08-30) ────────────────────────────────────────
  //
  // **손으로 고른 수가 하나도 없다.** SPEC §5 가 적은 산출 절차를 S=137 에 그대로
  // 적용한 값이다 (절차: `M = round(0.25·S)` JS half-up, 짝수면 +1 홀수화 /
  // `L = round(0.12·S)` / `H = round(0.40·S)` — 후자 둘은 홀짝 보정 없음):
  //   L = round(0.12·137) = round(16.44) = **16**
  //   M = round(0.25·137) = round(34.25) = 34 (짝수) → +1 = **35**
  //   H = round(0.40·137) = round(54.8)  = **55**
  //
  // S=137 의 유도: `cellCount(12)` 469 − `overheadBreakdown(12).total` 57
  // (불스아이 19 + 앵커 3 + 포맷 15 + 레퍼런스 2·(12−3+1)=20) = 412 데이터 셀,
  // S = ⌊412/3⌋ = 137 · 잔여 셀 1.
  //
  // 절차의 재현성 확인 (같은 식을 기존 행에 되돌려 보면): V1(S=27) → 3/7/11 ✓ ·
  // V3(S=92) → 11/23/37 ✓ · O-CM 세 행(24/53/89) → 3·7·10 / 6·13·21 / 11·23·36 ✓
  // 전부 표와 일치한다. **V2 만 예외**다 — 절차는 M=15(14 는 짝수)를 내는데 표는
  // 14 다. 그건 ADR §3.3.2 의 2026-07-29 확정값을 승계한 자리라서이고(위 헤더가
  // 이미 적어 둔 예외), V4 에는 승계할 확정값이 없으므로 절차값을 그대로 쓴다.
  //
  // base-211 청킹 정합도 확인했다 (SPEC §5 «절차값이 청킹과 어긋나면 최근접 홀수로
  // 대체» 조항의 발동 여부): L/M/H 전부 `symbolCountForByteLength(K)` 가
  // dataSymbols 와 정확히 같아 대체가 **필요 없다**. 실측 잠금은
  // `test/capacity-v4.test.js`.
  V4: Object.freeze({ symbols: 137, L: 16, M: 35, H: 55 }),
});

/**
 * daehan 파인더(79셀 전면) 변형의 nsym 표 — **2026-08-18 운영자 확정**.
 *
 * daehan 은 불스아이 19셀 **밖으로 파인더 셀을 더 쓰는 첫 후보**라 데이터 셀을
 * 실제로 깎는다 (k=6 −20 · k=8 −40 · k=10 −60). 그래서 사용 심볼 S 가 본표와 다르다:
 * 27 → **20** · 56 → **42** · 92 → **72**.
 *
 * **nsym 은 현행 동명 버전의 값을 그대로 승계한다** — 즉 정정능력 t 를 지금과 같게
 * 유지하는 선택이고, 비율(패리티율)이 아니라 **절대 정정능력**을 보존한 것이다.
 * 심볼이 줄었으므로 패리티율은 자동으로 올라간다 (V1D/M = 7/20 = 35.0%, 본표 V1/M
 * 7/27 = 25.9%). 이는 의도된 결과다: 파인더가 커진 만큼 남은 본문이 짧아지므로
 * 같은 t 라도 상대적 보호는 더 두꺼워야 한다.
 *
 * ⚠ **함정 — 절대 본표를 고쳐 재사용하지 마라.**
 *   V1D 의 nsym (3 / 7 / 11) 은 현행 `V1` 과 **문자 그대로 같다**. 그래서 «V1 행에서
 *   symbols 만 27 → 20 으로 고치면 되겠네» 로 읽기 쉽다. 그러면 **이미 발행된 V1
 *   프레임이 전부 깨진다** — `capacityFor` 가 symbols 불일치로 던지거나(운 좋은 경우),
 *   던지지 않으면 데이터 심볼 수가 달라져 조용히 다른 코드가 된다. 별도 키
 *   (`V1D`/`V2D`/`V3D`)로 분리해 둔 이유가 이것이고, 본표 `NSYM_TABLE` 은 daehan
 *   편입으로 **한 값도 바뀌지 않았다**.
 *
 * **V4D (2026-08-30 개방 — daehan × V4 «대용량»)** — 같은 승계 규약의 네 번째 행.
 * k=12 에서 daehan 은 k10 완전판 79셀(예약 60)을 중심 고정 재사용하므로
 * (`finder-daehan.js` templateRadius 클램프 — `DAEHAN_RADII` 는 늘리지 않는다)
 * S = ⌊(469 − 117)/3⌋ = **117** · 잔여 1. nsym 은 V4 절차값(16/35/55)을 승계한다.
 * ⚠ 승계 축의 뉘앙스가 기존 3행과 다르다: V1~V3 는 «절대 t 보존» 이 곧 패리티율
 *   상승(예: M 25.9%→35.0%)이었지만, V4D 는 S 감소 폭이 작아(137→117) 상승분도
 *   작다 (M 25.5%→29.9%). 축 이름은 여전히 «절대 정정능력 보존» 이다 — 절차식
 *   재산출(14/29/47)이 아니라 동명 V4 값이 정본이다 (PM/027 §5.5 잠긴 결론).
 *
 * 결과 순 페이로드 (실측 — `capacityDaehan.js` 가 산출하고 테스트가 값으로 잠근다):
 *   V1D  L 15 B · M 11 B · H 7 B
 *   V2D  L 32 B · M 26 B · H 18 B
 *   V3D  L 57 B · M 46 B · H 32 B
 *   V4D  L 96 B · M 78 B · H 58 B
 */
export const NSYM_TABLE_DAEHAN = Object.freeze({
  V1D: Object.freeze({ symbols: 20, L: 3, M: 7, H: 11 }),
  V2D: Object.freeze({ symbols: 42, L: 7, M: 14, H: 22 }),
  V3D: Object.freeze({ symbols: 72, L: 11, M: 23, H: 37 }),
  V4D: Object.freeze({ symbols: 117, L: 16, M: 35, H: 55 }),
});

function freezeRsBlockLevel(blockCount, dataSymbolsPerBlock, paritySymbolsPerBlock) {
  return Object.freeze({
    blockCount,
    dataSymbolsPerBlock: Object.freeze(dataSymbolsPerBlock),
    paritySymbolsPerBlock,
  });
}

/**
 * Type C(3시 노치) RS 블록 구성 표.
 *
 * 와이어는 `(formatIndex,k)+ECC`로 이 표를 조회한다. 블록 수·블록별 데이터 길이·
 * 블록별 패리티 수는 전부 리터럴이며, 디코더가 S에서 산술로 재구성하지 않는다.
 * 기존 소비자를 위한 L/M/H 숫자는 **총 패리티 수**이고, C0/C0D의 값은 발행값과
 * 문자 그대로 같다. 실제 블록 규약은 같은 행의 `blocks[level]`이 정본이다.
 *
 * 다중 블록 행의 고정 절차:
 *   1. B = ceil(S/210)인 최소 블록 수(현재 모두 2)를 쓴다.
 *   2. 긴 블록 길이 ceil(S/B)에 SPEC §5 비율 절차를 적용하고 모든 블록에 같은
 *      `paritySymbolsPerBlock`을 쓴다.
 *   3. 전체 데이터 심볼 수가 base-211 청킹과 어긋나면 정렬되는 최근접 홀수로
 *      보정한다. 발동은 C1/H 56→57, C1D/L 16→15 두 행뿐이다.
 *   4. 데이터 심볼은 짧은 블록 먼저, 블록 간 길이 차 1 이하로 고정한다.
 *
 * 인터리빙은 QR과 같이 **데이터 라운드로빈 뒤 패리티 라운드로빈**이다. 짧은 블록의
 * 첫 패리티가 긴 블록의 마지막 데이터와 섞이지 않는다.
 */
export const NSYM_TABLE_C = Object.freeze({
  C0: Object.freeze({
    symbols: 187, L: 22, M: 47, H: 75,
    blocks: Object.freeze({
      L: freezeRsBlockLevel(1, [165], 22),
      M: freezeRsBlockLevel(1, [140], 47),
      H: freezeRsBlockLevel(1, [112], 75),
    }),
  }),
  C1: Object.freeze({
    symbols: 281, L: 34, M: 70, H: 114,
    blocks: Object.freeze({
      L: freezeRsBlockLevel(2, [123, 124], 17),
      M: freezeRsBlockLevel(2, [105, 106], 35),
      H: freezeRsBlockLevel(2, [83, 84], 57),
    }),
  }),
  C2: Object.freeze({
    symbols: 393, L: 48, M: 98, H: 158,
    blocks: Object.freeze({
      L: freezeRsBlockLevel(2, [172, 173], 24),
      M: freezeRsBlockLevel(2, [147, 148], 49),
      H: freezeRsBlockLevel(2, [117, 118], 79),
    }),
  }),
  C0D: Object.freeze({
    symbols: 167, L: 20, M: 43, H: 67,
    blocks: Object.freeze({
      L: freezeRsBlockLevel(1, [147], 20),
      M: freezeRsBlockLevel(1, [124], 43),
      H: freezeRsBlockLevel(1, [100], 67),
    }),
  }),
  C1D: Object.freeze({
    symbols: 261, L: 30, M: 66, H: 104,
    blocks: Object.freeze({
      L: freezeRsBlockLevel(2, [115, 116], 15),
      M: freezeRsBlockLevel(2, [97, 98], 33),
      H: freezeRsBlockLevel(2, [78, 79], 52),
    }),
  }),
  C2D: Object.freeze({
    symbols: 373, L: 44, M: 94, H: 150,
    blocks: Object.freeze({
      L: freezeRsBlockLevel(2, [164, 165], 22),
      M: freezeRsBlockLevel(2, [139, 140], 47),
      H: freezeRsBlockLevel(2, [111, 112], 75),
    }),
  }),
});

/** Type C 표에서 한 ECC 레벨의 고정 블록 구성을 조회한다. */
export function rsBlockConfigForC(symbolKey, level) {
  if (!Object.hasOwn(NSYM_TABLE_C, symbolKey)) {
    throw new RangeError(`NSYM_TABLE_C 에 키 ${symbolKey} 가 없다`);
  }
  const row = NSYM_TABLE_C[symbolKey];
  if (!Object.hasOwn(row.blocks, level)) {
    throw new RangeError(`NSYM_TABLE_C.${symbolKey}.blocks 에 레벨 ${level} 이 없다`);
  }
  return row.blocks[level];
}

/** 복호 실패 예외. `reason` / `syndromes` 를 함께 싣는다. */
export class RSDecodeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RSDecodeError';
    Object.assign(this, details);
  }
}

// ── 입력 검증 ───────────────────────────────────────────────────────────

function toSymbols(input, label) {
  if (!Array.isArray(input) && !ArrayBuffer.isView(input)) {
    throw new TypeError(`${label} 는 배열이어야 한다`);
  }
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = input[i];
    if (!Number.isInteger(v) || v < 0 || v >= P) {
      throw new RangeError(`${label}[${i}] 는 0..${P - 1} 정수여야 한다: ${v}`);
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

// ── 다중 RS 블록 인터리빙 ───────────────────────────────────────────────

function rsBlockShape(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('RS 블록 구성 객체가 필요하다');
  }
  const { blockCount, dataSymbolsPerBlock, paritySymbolsPerBlock } = config;
  if (!Number.isInteger(blockCount) || blockCount < 1) {
    throw new RangeError(`blockCount 는 1 이상 정수여야 한다: ${blockCount}`);
  }
  if (!Array.isArray(dataSymbolsPerBlock)
    && !ArrayBuffer.isView(dataSymbolsPerBlock)) {
    throw new TypeError('dataSymbolsPerBlock 는 배열이어야 한다');
  }
  if (dataSymbolsPerBlock.length !== blockCount) {
    throw new RangeError(
      `dataSymbolsPerBlock 길이(${dataSymbolsPerBlock.length})가 blockCount(${blockCount})와 다르다`,
    );
  }
  validateNsym(paritySymbolsPerBlock);

  const dataLengths = [];
  const codewordLengths = [];
  let totalDataSymbols = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const dataLength = dataSymbolsPerBlock[blockIndex];
    if (!Number.isInteger(dataLength) || dataLength < 1) {
      throw new RangeError(
        `dataSymbolsPerBlock[${blockIndex}] 는 1 이상 정수여야 한다: ${dataLength}`,
      );
    }
    if (blockIndex > 0 && dataLength < dataSymbolsPerBlock[blockIndex - 1]) {
      throw new RangeError('RS 데이터 블록은 짧은 블록 먼저여야 한다');
    }
    const codewordLength = dataLength + paritySymbolsPerBlock;
    if (codewordLength > MAX_CODEWORD_LEN) {
      throw new RangeError(
        `RS 블록 ${blockIndex} 길이(${codewordLength})가 ${MAX_CODEWORD_LEN}을 넘는다`,
      );
    }
    dataLengths.push(dataLength);
    codewordLengths.push(codewordLength);
    totalDataSymbols += dataLength;
  }
  if (dataLengths[dataLengths.length - 1] - dataLengths[0] > 1) {
    throw new RangeError('RS 블록 간 데이터 심볼 수 차이는 1 이하여야 한다');
  }
  return {
    blockCount,
    dataLengths,
    codewordLengths,
    paritySymbolsPerBlock,
    totalDataSymbols,
    totalParitySymbols: blockCount * paritySymbolsPerBlock,
    totalCodewordSymbols: totalDataSymbols + blockCount * paritySymbolsPerBlock,
  };
}

/**
 * QR식 2단계 인터리빙의 와이어 인덱스 사상.
 * 데이터 심볼을 라운드로빈한 뒤 패리티 심볼을 별도 라운드로빈한다.
 */
export function rsBlockInterleaveMap(config) {
  const shape = rsBlockShape(config);
  const out = [];
  const maxDataLength = shape.dataLengths[shape.dataLengths.length - 1];
  for (let round = 0; round < maxDataLength; round += 1) {
    for (let blockIndex = 0; blockIndex < shape.blockCount; blockIndex += 1) {
      if (round >= shape.dataLengths[blockIndex]) continue;
      out.push(Object.freeze({ blockIndex, codewordIndex: round, kind: 'data' }));
    }
  }
  for (let round = 0; round < shape.paritySymbolsPerBlock; round += 1) {
    for (let blockIndex = 0; blockIndex < shape.blockCount; blockIndex += 1) {
      out.push(Object.freeze({
        blockIndex,
        codewordIndex: shape.dataLengths[blockIndex] + round,
        kind: 'parity',
      }));
    }
  }
  if (out.length !== shape.totalCodewordSymbols) {
    throw new Error(
      `RS 인터리브 사상 길이(${out.length})가 코드워드 합계(${shape.totalCodewordSymbols})와 다르다`,
    );
  }
  return out;
}

/** 블록별 체계적 코드워드를 QR식 2단계 라운드로빈 심볼열로 인터리빙한다. */
export function interleaveRsBlocks(blocks, config) {
  const shape = rsBlockShape(config);
  if (!Array.isArray(blocks) || blocks.length !== shape.blockCount) {
    throw new RangeError(`blocks 는 길이 ${shape.blockCount} 배열이어야 한다`);
  }
  const normalized = blocks.map((block, blockIndex) => {
    const symbols = toSymbols(block, `blocks[${blockIndex}]`);
    if (symbols.length !== shape.codewordLengths[blockIndex]) {
      throw new RangeError(
        `blocks[${blockIndex}] 길이(${symbols.length})가 표의 코드워드 길이`
        + `(${shape.codewordLengths[blockIndex]})와 다르다`,
      );
    }
    return symbols;
  });
  const out = new Uint8Array(shape.totalCodewordSymbols);
  const map = rsBlockInterleaveMap(config);
  for (let wireIndex = 0; wireIndex < map.length; wireIndex += 1) {
    const { blockIndex, codewordIndex } = map[wireIndex];
    out[wireIndex] = normalized[blockIndex][codewordIndex];
  }
  return out;
}

/** 인터리빙된 심볼열을 표에 고정된 체계적 RS 블록들로 되돌린다. */
export function deinterleaveRsBlocks(interleaved, config) {
  const shape = rsBlockShape(config);
  const symbols = toSymbols(interleaved, 'interleaved');
  if (symbols.length !== shape.totalCodewordSymbols) {
    throw new RangeError(
      `interleaved 길이(${symbols.length})가 표의 코드워드 합계`
      + `(${shape.totalCodewordSymbols})와 다르다`,
    );
  }
  const blocks = shape.codewordLengths.map((length) => new Uint8Array(length));
  const map = rsBlockInterleaveMap(config);
  for (let wireIndex = 0; wireIndex < map.length; wireIndex += 1) {
    const { blockIndex, codewordIndex } = map[wireIndex];
    blocks[blockIndex][codewordIndex] = symbols[wireIndex];
  }
  return blocks;
}

// ── 용량 헬퍼 ───────────────────────────────────────────────────────────

/** nsym 패리티로 정정 가능한 최대 심볼 오류 수 t = ⌊nsym/2⌋ */
export function errorCapacity(nsym) {
  validateNsym(nsym);
  return Math.floor(nsym / 2);
}

/**
 * 소거(erasure) 만 있을 때 정정 가능한 최대 심볼 수 = nsym.
 * 위치를 아는 소거는 오류 1개당 패리티 1개만 쓴다 — 위치를 모르는 오류가
 * 2개를 쓰는 것과 대비된다. 혼합 한계는 `2·v + s ≤ nsym` (v = 오류, s = 소거).
 */
export function erasureCapacity(nsym) {
  validateNsym(nsym);
  return nsym;
}

/** 소거 s 개가 이미 잡혔을 때 추가로 정정 가능한 (위치 미상) 오류 수 ⌊(nsym − s)/2⌋. */
export function errorCapacityWithErasures(nsym, erasureCount) {
  validateNsym(nsym);
  if (!Number.isInteger(erasureCount) || erasureCount < 0) {
    throw new RangeError(`erasureCount 는 0 이상 정수여야 한다: ${erasureCount}`);
  }
  if (erasureCount > nsym) return -1;
  return Math.floor((nsym - erasureCount) / 2);
}

/** 주어진 nsym 에서 한 블록에 실을 수 있는 최대 데이터 심볼 수. n > 210 은 거부된다. */
export function maxDataLen(nsym) {
  validateNsym(nsym);
  return MAX_CODEWORD_LEN - nsym;
}

// ── 부호화 ──────────────────────────────────────────────────────────────

/**
 * 생성 다항식 g(x) = ∏_{i=0}^{nsym-1} (x - α^(fcr+i)) — big-endian, 모닉.
 * **뺄셈이 실재한다**: (x - α^k) 의 상수항은 `sub(0, α^k)` = p - α^k 다
 * (`rs.js` 의 GF(2^8) 버전은 이 자리에서 `+`를 썼는데 표수 2 라서 우연히 맞았다).
 * @returns {Uint8Array} 길이 nsym + 1, g[0] === 1
 */
export function rsGeneratorPoly(nsym, options = {}) {
  const { fcr = DEFAULT_FCR } = options;
  validateNsym(nsym);
  validateFcr(fcr);
  let g = Uint8Array.of(1);
  for (let i = 0; i < nsym; i++) {
    const root = alphaPow(fcr + i);
    const factor = Uint8Array.of(1, sub(0, root)); // (x - root)
    g = polyMulBE(g, factor);
  }
  return g;
}

/** big-endian 다항식 곱 (로컬 — gfp.js 의 polyMul 과 동일하지만 순환 의존 피하려 인라인하지 않고 재사용) */
function polyMulBE(p, q) {
  const out = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++) {
    const pi = p[i];
    if (pi === 0) continue;
    for (let j = 0; j < q.length; j++) out[i + j] = add(out[i + j], mul(pi, q[j]));
  }
  return out;
}

/**
 * 체계적 RS 부호화. 코드워드 = 메시지 ‖ 패리티(nsym 심볼).
 * 표준 LFSR 합성제법: `msg ‖ 0*nsym` 을 g(x) 로 나눈 나머지를 msg 뒤에 붙인다.
 * **`sub` 를 쓴다** — GF(2^8) 판은 XOR 라 add/sub 구분이 없었지만 여기선 다르다.
 * @param {Uint8Array|number[]} msg
 * @param {number} nsym
 * @param {{fcr?: number, generator?: Uint8Array}} [options]
 * @returns {Uint8Array} 길이 msg.length + nsym
 */
export function rsEncode(msg, nsym, options = {}) {
  const { fcr = DEFAULT_FCR, generator } = options;
  const data = toSymbols(msg, 'msg');
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

  const out = new Uint8Array(data.length + nsym);
  out.set(data, 0);
  // 합성 나눗셈: g[0] === 1(모닉)이므로 나눗셈 없이 곱셈만으로 나머지를 구한다.
  // out 은 P(x) = msg(x)·x^nsym 을 나타내고(꼬리가 0으로 채워져 있으므로),
  // 이 루프가 끝나면 out[data.length:] 에는 P(x) 를 g(x) 로 나눈 **나머지 r(x)** 가 남는다.
  for (let i = 0; i < data.length; i++) {
    const coef = out[i];
    if (coef === 0) continue;
    for (let j = 0; j < g.length; j++) {
      out[i + j] = sub(out[i + j], mul(g[j], coef));
    }
  }
  // 코드워드 = P(x) − r(x) 라야 g(x) 로 나누어떨어진다 → 패리티 = **−r**.
  // ⚠ 표수 2(GF(2^8))에서는 −r = r 이라 이 부호가 안 보였다. 여기서 빠뜨리면
  // "나머지를 그대로 패리티로 쓰는" 조용한 부호 버그가 된다 — 실제로 처음엔
  // 이걸 놓쳐서 신드롬이 0이 되지 않았다(개발 중 실측).
  for (let j = data.length; j < out.length; j++) {
    out[j] = sub(0, out[j]);
  }
  // out[0..data.length) 는 위 루프에서 뭉개졌으므로 원 메시지로 복원한다.
  out.set(data, 0);
  return out;
}

/**
 * 고정 블록 표에 따라 데이터 심볼열을 연속 분할하고, 블록별 RS 부호화 뒤 QR식으로
 * 인터리빙한다. base-211 변환은 이 함수보다 앞에서 전체 프레임에 한 번만 끝나 있어야 한다.
 */
export function rsEncodeBlocks(message, config, options = {}) {
  const shape = rsBlockShape(config);
  const data = toSymbols(message, 'message');
  if (data.length !== shape.totalDataSymbols) {
    throw new RangeError(
      `message 길이(${data.length})가 블록 표의 데이터 합계(${shape.totalDataSymbols})와 다르다`,
    );
  }
  const blocks = [];
  let offset = 0;
  for (const dataLength of shape.dataLengths) {
    const blockMessage = data.slice(offset, offset + dataLength);
    blocks.push(rsEncode(blockMessage, shape.paritySymbolsPerBlock, options));
    offset += dataLength;
  }
  if (offset !== data.length) {
    throw new Error(`RS 블록 분할 소비량(${offset})이 데이터 길이(${data.length})와 다르다`);
  }
  return interleaveRsBlocks(blocks, config);
}

/**
 * 신드롬 S_i = C(α^(fcr+i)), i = 0..nsym-1.
 * 유효 코드워드면 전부 0 이다 (RS 의 정의적 성질) — 이 성질 자체를 테스트로 검증한다.
 * @returns {Uint8Array} 길이 nsym
 */
export function rsSyndromes(codeword, nsym, options = {}) {
  const { fcr = DEFAULT_FCR } = options;
  const cw = toSymbols(codeword, 'codeword');
  validateNsym(nsym);
  validateFcr(fcr);
  const s = new Uint8Array(nsym);
  for (let i = 0; i < nsym; i++) s[i] = polyEval(cw, alphaPow(fcr + i));
  return s;
}

// ── 복호 내부: little-endian 다항식 헬퍼 ────────────────────────────────
// Λ(x) = 1 + Λ1·x + Λ2·x² + ... 형태가 자연스러운 알고리즘(BM/Forney)만
// little-endian(index i = x^i 계수) 을 쓴다. gfp.js 의 poly* 는 big-endian.

function polyEvalLE(p, x) {
  let y = 0;
  let xp = 1;
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== 0) y = add(y, mul(p[i], xp));
    xp = mul(xp, x);
  }
  return y;
}

function polyMulLE(p, q) {
  const out = new Array(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) continue;
    for (let j = 0; j < q.length; j++) out[i + j] = add(out[i + j], mul(p[i], q[j]));
  }
  return out;
}

/**
 * 형식적 미분 Λ'(x). **GF(p), p ≠ 2 에서는 일반 미적분과 같다** —
 * d/dx(Λ_k x^k) = (k mod p)·Λ_k·x^(k-1). GF(2^m) 의 "홀수항만 남는다" 트릭은
 * 표수 2 의 우연(짝수 k 는 k mod 2 = 0 이라 소멸)이고 여기서는 성립하지 않는다.
 */
function polyDerivLE(p) {
  const out = new Array(Math.max(p.length - 1, 1)).fill(0);
  for (let k = 1; k < p.length; k++) {
    out[k - 1] = mul(k % P, p[k]);
  }
  return out;
}

/**
 * Berlekamp-Massey. 신드롬열을 만드는 최단 LFSR 의 연결다항식 Λ(x) 를 찾는다.
 * 판별식 d 는 합(연산상 항상 덧셈 — 어느 체에서나 그렇다), 갱신식은 **뺄셈**을 쓴다:
 *   Λ_new(x) = Λ(x) − (d/b)·x^m·B(x)
 * (`rs.js` 의 GF(2^8) 판은 이 자리에서 XOR 를 썼는데 표수 2 라서 우연히 맞았다.)
 * @param {Uint8Array} synd 저차→고차 신드롬
 * @returns {{lambda: number[], L: number}} lambda 는 little-endian, lambda[0] === 1
 */
function berlekampMassey(synd) {
  let lambda = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;

  for (let n = 0; n < synd.length; n++) {
    let d = synd[n];
    for (let i = 1; i <= L; i++) {
      if (i < lambda.length && lambda[i] !== 0) d = add(d, mul(lambda[i], synd[n - i]));
    }

    if (d === 0) {
      m += 1;
      continue;
    }

    const coef = div(d, b);
    const prev = lambda.slice();
    const need = B.length + m;
    if (lambda.length < need) lambda = lambda.concat(new Array(need - lambda.length).fill(0));
    for (let i = 0; i < B.length; i++) {
      if (B[i] !== 0) lambda[i + m] = sub(lambda[i + m], mul(coef, B[i]));
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
    const p = n - 1 - j;
    if (polyEvalLE(lambda, alphaPow(-p)) === 0) positions.push(j);
  }
  return positions;
}

/**
 * Forney 알고리즘으로 오류 크기를 구한다.
 *   Ω(x) = S(x)·Λ(x) mod x^nsym
 *   Y_k = − X_k^(1-fcr) · Ω(X_k^-1) / Λ'(X_k^-1)
 *
 * ⚠ **음의 부호가 실재한다.** GF(2^m) 판(`rs.js`)의 주석은 "표수 2 이므로
 * 부호는 사라진다" 고 적었고 그 자리에서 부호 없이 반환했다 — 여기서 그걸
 * 그대로 베끼면 모든 정정값이 부호 반전으로 틀린다. `sub(0, ...)` 로 반드시 음화한다.
 * @returns {(number|null)[]} positions 와 같은 순서의 오류 크기. 분모가 0 이면 null.
 */
function forney(synd, lambda, positions, n, fcr) {
  const S = Array.from(synd);
  const full = polyMulLE(S, lambda);
  const omega = full.slice(0, synd.length);
  const dLambda = polyDerivLE(lambda);

  return positions.map((j) => {
    const p = n - 1 - j;
    const Xinv = alphaPow(-p);
    const denom = polyEvalLE(dLambda, Xinv);
    if (denom === 0) return null;
    const num = polyEvalLE(omega, Xinv);
    let scale = 1;
    const e = 1 - fcr;
    if (e !== 0) {
      const ee = ((e % MULTIPLICATIVE_ORDER) + MULTIPLICATIVE_ORDER) % MULTIPLICATIVE_ORDER;
      scale = alphaPow(p * ee);
    }
    const magnitude = mul(scale, div(num, denom));
    return sub(0, magnitude); // ← 소수체의 실재하는 부호
  });
}

// ── 소거(erasure) 복호 내부 ─────────────────────────────────────────────

/**
 * 소거 위치 목록 정규화. 배열 인덱스(big-endian 코드워드 기준)를 오름차순
 * 중복 제거해 돌려준다. 범위 밖/비정수는 던진다 — 조용히 버리면 «소거를
 * 넣었는데 왜 못 고치지» 가 디버깅 불가능해진다.
 */
function normalizeErasurePositions(erasures, n) {
  if (erasures === undefined || erasures === null) return [];
  if (!Array.isArray(erasures) && !ArrayBuffer.isView(erasures)) {
    throw new TypeError('erasures 는 배열이어야 한다');
  }
  const seen = new Set();
  const out = [];
  for (let i = 0; i < erasures.length; i++) {
    const v = erasures[i];
    if (!Number.isInteger(v) || v < 0 || v >= n) {
      throw new RangeError(`erasures[${i}] 는 0..${n - 1} 정수여야 한다: ${v}`);
    }
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * 소거 위치자 Γ(x) = ∏(1 − Z_m·x), Z_m = α^(n−1−j_m). little-endian.
 * Chien 탐색이 Λ(X^-1) = 0 을 보는 규약과 같은 규약이다.
 */
function erasureLocator(positions, n) {
  let gamma = [1];
  for (const j of positions) {
    const Z = alphaPow(n - 1 - j);
    gamma = polyMulLE(gamma, [1, sub(0, Z)]);
  }
  return gamma;
}

/**
 * Forney 신드롬. T(x) = S(x)·Γ(x) mod x^nsym 의 **계수 s..nsym−1** 를 돌려준다
 * (길이 nsym − s). 이 잘라내기가 핵심이다: 앞의 s 개 계수에는 소거 항이
 * 남아 있고, s 번째부터가 «소거를 제거한 신드롬열» 이라 BM 이 남은 오류만 본다.
 *
 * ⚠ GF(2^m) 구현(reedsolo 등)의 `f[j] = f[j]·X ^ f[j+1]` 을 그대로 베끼면 안 된다 —
 * 표수 2 에서만 소거 항 (X + X_k) 가 소멸한다. 소수체에서는 **뺄셈** 이 실재해
 * (X_k − X) 라야 소멸한다. 여기서는 Γ 곱셈으로 그 뺄셈을 자동으로 얻는다.
 */
function forneySyndromes(synd, gamma, erasureCount) {
  const S = Array.from(synd);
  const full = polyMulLE(S, gamma);
  return full.slice(erasureCount, S.length);
}

/**
 * RS 소거·오류 혼합 복호. `rsDecode(received, nsym, { erasures })` 의 본체다.
 * 한계는 **2·v + s ≤ nsym** (v = 위치 미상 오류, s = 소거).
 *
 * ### 검출 마진 — 소거를 많이 선언할수록 «틀렸다고 말할 능력» 이 줄어든다
 *
 * 이 함수의 4중 관문(한계 검사 · 위치자 차수 · Chien 근수 · 정정 후 신드롬
 * 재검산)은 **잔여 패리티 `nsym − s` 가 있을 때만** 검출력을 가진다. 한계를
 * 넘긴 입력이 «조용한 오정정»(ok:true + 틀린 코드워드) 으로 나가는 비율은 실측상
 * 잔여 패리티에만 의존한다 (2v+s = nsym+2 rung, nsym ∈ {7,11,14,22,23,37} × 300회):
 *
 * | 잔여 `nsym − s` | 0 | 2 | 4 | 6 | ≥ 8 |
 * |---|---|---|---|---|---|
 * | 조용한 오정정 | **100 %** | 약 19 % | 약 2~4 % | 0.3 % 이하 | 0 % |
 *
 * **`s = nsym` 은 확률이 아니라 절벽이다.** 소거 nsym 개면 신드롬 nsym 개와 미지수
 * nsym 개가 정확히 결정계다 — 해가 유일하게 존재하고 그 해는 정의상 모든 신드롬을
 * 0 으로 만든다. 그래서 미선언 오류가 하나라도 섞여 있으면 정정 결과는 «다른 유효
 * 코드워드» 이고, 마지막 관문인 신드롬 재검산이 **구성상 반드시 통과한다**. 실측
 * 3,500/3,500 조용한 오정정 · 정직 실패 0. RS 의 고유 한계이지 이 구현의 결함이
 * 아니다 — 고칠 수 있는 종류가 아니다.
 *
 * 따라서 **`s` 가 nsym 에 붙는 운용점에서 ECC 는 방어선이 아니다.** 그 지점의
 * 방어는 전적으로 상위층(`decode.js` 의 base-211 범위 · 길이 헤더 · UTF-8 유효성 ·
 * 0 패딩) 몫이다. 호출부는 `erasureCount` 를 보고 «ECC 가 여기서 뭘 보증하는가» 를
 * 판단해야 한다. 이 계약은 `test/rs211.test.js` 의 nsym+2 rung 과
 * `test/decode.test.js` 의 상위층 방어선 테스트가 양쪽에서 고정한다.
 */
function rsDecodeErasures(cw, nsym, fcr, erasurePositions) {
  const n = cw.length;
  const s = erasurePositions.length;
  const syndromes = rsSyndromes(cw, nsym, { fcr });

  const fail = (reason) => ({
    ok: false,
    reason,
    syndromes,
    errorPositions: null,
    erasurePositions: erasurePositions.slice(),
    erasureCount: s,
  });
  const succeed = (out, changed) => {
    const erased = new Set(erasurePositions);
    const errorPositions = changed.filter((position) => !erased.has(position));
    return {
      ok: true,
      codeword: out,
      message: out.slice(0, n - nsym),
      parity: out.slice(n - nsym),
      errorPositions,
      errorCount: errorPositions.length,
      erasurePositions: erasurePositions.slice(),
      erasureCount: s,
      correctedPositions: changed.slice(),
      syndromes,
    };
  };

  if (s > nsym) {
    return fail(`소거 개수(${s})가 패리티 심볼 수(${nsym})를 넘었다 — 원리적으로 복구 불가`);
  }

  let clean = true;
  for (let i = 0; i < syndromes.length; i++) {
    if (syndromes[i] !== 0) {
      clean = false;
      break;
    }
  }
  // 신드롬이 전부 0 이면 수신어가 이미 유효 코드워드다. 소거로 «표시만» 됐을 뿐
  // 값이 우연히 맞은 경우이므로 고칠 것이 없다.
  if (clean) return succeed(cw.slice(), []);

  const gamma = erasureLocator(erasurePositions, n);
  const fsynd = forneySyndromes(syndromes, gamma, s);
  const tRemaining = Math.floor((nsym - s) / 2);

  const { lambda, L } = berlekampMassey(fsynd);
  if (L > tRemaining) {
    return fail(
      `소거 ${s} 개를 제외하고도 오류가 한계를 넘었다 `
      + `(Berlekamp-Massey deg Λ = ${L}, 잔여 t = ${tRemaining})`,
    );
  }
  if (lambda.length - 1 !== L) {
    return fail(`Λ 차수(${lambda.length - 1})와 LFSR 길이(${L})가 불일치 — 정정 불가`);
  }

  const psi = polyMulLE(lambda, gamma);
  while (psi.length > 1 && psi[psi.length - 1] === 0) psi.pop();
  const degree = psi.length - 1;
  if (degree !== L + s) {
    return fail(`errata 위치자 차수(${degree})가 오류 ${L} + 소거 ${s} 와 다르다 — 정정 불가`);
  }

  const positions = chienSearch(psi, n);
  if (positions.length !== degree) {
    return fail(
      `Chien 탐색이 errata 위치자의 근을 전부 찾지 못했다 (${positions.length}/${degree}) — 정정 불가`,
    );
  }

  const magnitudes = forney(syndromes, psi, positions, n, fcr);
  if (magnitudes.some((m) => m === null)) {
    return fail('Forney 분모 Ψ′(X^-1) = 0 — 정정 불가');
  }

  const out = cw.slice();
  const changed = [];
  for (let k = 0; k < positions.length; k++) {
    if (magnitudes[k] === 0) continue;
    out[positions[k]] = sub(out[positions[k]], magnitudes[k]);
    changed.push(positions[k]);
  }

  const after = rsSyndromes(out, nsym, { fcr });
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== 0) {
      return fail('정정 후에도 신드롬이 0 이 아니다 — 2·오류 + 소거 가 nsym 을 넘었다');
    }
  }

  return succeed(out, changed);
}

/**
 * RS 복호. t = ⌊nsym/2⌋ 개까지의 심볼 오류를 정정한다.
 *
 * 실패 검출(조용한 오정정을 막는 4중 관문):
 *   1. L(=degΛ 추정) > t
 *   2. Λ 차수와 BM 이 보고한 L 불일치
 *   3. Chien 탐색이 찾은 근의 개수 ≠ L
 *   4. 정정 적용 후 신드롬 재검산이 0 이 아님
 *
 * `options.erasures` 에 **배열 인덱스** 목록을 주면 소거 복호로 갈아탄다:
 * 한계가 t = ⌊nsym/2⌋ 에서 **2·v + s ≤ nsym** 으로 넓어진다 (소거만이면 nsym 개).
 * 인자를 생략하면 기존 경로와 코드가 문자 그대로 같다 — 소비자 옵트인이다.
 *
 * @param {Uint8Array|number[]} received 수신 코드워드 (메시지 ‖ 패리티)
 * @param {number} nsym
 * @param {{fcr?: number, erasures?: number[]|Uint8Array|Uint16Array}} [options]
 * @returns {{ok:true, codeword:Uint8Array, message:Uint8Array, parity:Uint8Array,
 *            errorPositions:number[], errorCount:number, syndromes:Uint8Array,
 *            erasurePositions?:number[], erasureCount?:number,
 *            correctedPositions?:number[]}
 *         | {ok:false, reason:string, syndromes:Uint8Array, errorPositions:null}}
 */
export function rsDecode(received, nsym, options = {}) {
  const { fcr = DEFAULT_FCR, erasures } = options;
  const cw = toSymbols(received, 'received');
  validateNsym(nsym);
  validateFcr(fcr);
  if (cw.length > MAX_CODEWORD_LEN) {
    throw new RangeError(`코드워드 길이(${cw.length})가 ${MAX_CODEWORD_LEN} 을 넘는다`);
  }
  if (cw.length <= nsym) {
    throw new RangeError(`코드워드 길이(${cw.length})가 nsym(${nsym}) 이하다 — 메시지가 없다`);
  }

  const erasurePositions = normalizeErasurePositions(erasures, cw.length);
  if (erasurePositions.length > 0) {
    return rsDecodeErasures(cw, nsym, fcr, erasurePositions);
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
    return fail(`Chien 탐색이 Λ 의 근을 전부 찾지 못했다 (${positions.length}/${L}) — 정정 불가`);
  }

  const magnitudes = forney(syndromes, lambda, positions, n, fcr);
  if (magnitudes.some((m) => m === null)) {
    return fail('Forney 분모 Λ′(X^-1) = 0 — 정정 불가');
  }

  const out = cw.slice();
  const changed = [];
  for (let k = 0; k < positions.length; k++) {
    if (magnitudes[k] === 0) continue;
    // e_k = magnitudes[k] 는 received = true + E 의 오류값이다 → true = received − e_k
    out[positions[k]] = sub(out[positions[k]], magnitudes[k]);
    changed.push(positions[k]);
  }

  const after = rsSyndromes(out, nsym, { fcr });
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== 0) {
      return fail('정정 후에도 신드롬이 0 이 아니다 — 오류가 정정 한계를 넘었다');
    }
  }

  return succeed(out, changed);
}

/**
 * 인터리빙된 다중 RS 블록 복호. 전역 와이어 소거 인덱스를 같은 인터리브 사상으로
 * `(blockIndex, localCodewordIndex)`에 배달하고, 모든 블록이 성공할 때만 원 메시지를
 * 블록 순서로 재조립한다. 블록 수 1은 발행 경로 무회귀를 위해 `rsDecode` 반환 객체를
 * 그대로 돌려주고, 다중 블록만 `blockResults`와 블록별 `syndromes` 배열을 덧붙인다.
 */
export function rsDecodeBlocks(received, config, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options 는 객체여야 한다');
  }
  const { fcr = DEFAULT_FCR, erasures } = options;
  validateFcr(fcr);
  const shape = rsBlockShape(config);
  const wire = toSymbols(received, 'received');
  if (wire.length !== shape.totalCodewordSymbols) {
    throw new RangeError(
      `received 길이(${wire.length})가 블록 표의 코드워드 합계`
      + `(${shape.totalCodewordSymbols})와 다르다`,
    );
  }

  // 단일 블록은 기존 복호 경로를 문자 그대로 재사용한다. 반환 객체까지 같은 계약이다.
  if (shape.blockCount === 1) {
    return rsDecode(wire, shape.paritySymbolsPerBlock, { fcr, erasures });
  }

  const erasurePositions = normalizeErasurePositions(erasures, wire.length);
  const map = rsBlockInterleaveMap(config);
  const blocks = deinterleaveRsBlocks(wire, config);
  const erasuresByBlock = Array.from({ length: shape.blockCount }, () => []);
  for (const wireIndex of erasurePositions) {
    const { blockIndex, codewordIndex } = map[wireIndex];
    erasuresByBlock[blockIndex].push(codewordIndex);
  }

  const wireIndexByBlock = shape.codewordLengths.map((length) => new Array(length));
  for (let wireIndex = 0; wireIndex < map.length; wireIndex += 1) {
    const { blockIndex, codewordIndex } = map[wireIndex];
    wireIndexByBlock[blockIndex][codewordIndex] = wireIndex;
  }

  const blockResults = [];
  for (let blockIndex = 0; blockIndex < shape.blockCount; blockIndex += 1) {
    const localErasures = erasuresByBlock[blockIndex];
    const result = localErasures.length > 0
      ? rsDecode(blocks[blockIndex], shape.paritySymbolsPerBlock, {
        fcr, erasures: localErasures,
      })
      : rsDecode(blocks[blockIndex], shape.paritySymbolsPerBlock, { fcr });
    blockResults.push(result);
    if (!result.ok) {
      return {
        ok: false,
        reason: `RS 블록 ${blockIndex + 1}/${shape.blockCount}: ${result.reason}`,
        blockIndex,
        blockResults,
        syndromes: blockResults.map((entry) => entry.syndromes),
        errorPositions: null,
        erasurePositions: erasurePositions.slice(),
        erasureCount: erasurePositions.length,
      };
    }
  }

  const correctedBlocks = blockResults.map((result) => result.codeword);
  const codeword = interleaveRsBlocks(correctedBlocks, config);
  const message = new Uint8Array(shape.totalDataSymbols);
  let messageOffset = 0;
  for (const result of blockResults) {
    message.set(result.message, messageOffset);
    messageOffset += result.message.length;
  }
  if (messageOffset !== message.length) {
    throw new Error(
      `RS 블록 메시지 재조립 길이(${messageOffset})가 표의 데이터 합계(${message.length})와 다르다`,
    );
  }

  const errorPositions = [];
  const correctedPositions = [];
  for (let blockIndex = 0; blockIndex < blockResults.length; blockIndex += 1) {
    const result = blockResults[blockIndex];
    for (const localIndex of result.errorPositions) {
      errorPositions.push(wireIndexByBlock[blockIndex][localIndex]);
    }
    const localCorrected = result.correctedPositions ?? result.errorPositions;
    for (const localIndex of localCorrected) {
      correctedPositions.push(wireIndexByBlock[blockIndex][localIndex]);
    }
  }
  errorPositions.sort((left, right) => left - right);
  correctedPositions.sort((left, right) => left - right);

  return {
    ok: true,
    codeword,
    message,
    parity: codeword.slice(shape.totalDataSymbols),
    errorPositions,
    errorCount: errorPositions.length,
    erasurePositions: erasurePositions.slice(),
    erasureCount: erasurePositions.length,
    correctedPositions,
    syndromes: blockResults.map((result) => result.syndromes),
    blockResults,
  };
}

/**
 * 소거 복호 전용 진입점. `rsDecode(received, nsym, { ...options, erasures })` 와 같다.
 * 소비자가 «소거를 쓰고 있다» 는 사실을 호출부에서 읽히게 하려고 따로 둔다.
 * erasures 가 비면 일반 오류 복호로 그대로 내려간다.
 *
 * @param {Uint8Array|number[]} received
 * @param {number} nsym
 * @param {number[]|Uint8Array|Uint16Array} erasures 배열 인덱스 목록
 * @param {{fcr?: number}} [options]
 */
export function rsDecodeWithErasures(received, nsym, erasures, options = {}) {
  return rsDecode(received, nsym, { ...options, erasures });
}

/**
 * `rsDecode` 의 예외 던지는 래퍼. 성공 시 메시지 심볼만 돌려준다.
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

// Type C 블록 표 로드 자기검증. 표가 회계·인터리브 사상과 따로 썩으면 즉시 실패한다.
{
  const levels = ['L', 'M', 'H'];
  const expectedKeys = ['C0', 'C1', 'C2', 'C0D', 'C1D', 'C2D'];
  if (Object.keys(NSYM_TABLE_C).join('|') !== expectedKeys.join('|')) {
    throw new Error('NSYM_TABLE_C 행 명부나 순서가 C0/C1/C2/C0D/C1D/C2D와 다르다');
  }
  for (const symbolKey of expectedKeys) {
    const row = NSYM_TABLE_C[symbolKey];
    if (!Number.isInteger(row.symbols) || row.symbols < 1) {
      throw new Error(`NSYM_TABLE_C.${symbolKey}.symbols 가 양의 정수가 아니다`);
    }
    for (const level of levels) {
      const config = rsBlockConfigForC(symbolKey, level);
      const shape = rsBlockShape(config);
      const minimumBlockCount = Math.ceil(row.symbols / MAX_CODEWORD_LEN);
      if (shape.blockCount !== minimumBlockCount) {
        throw new Error(
          `${symbolKey}/${level}: 블록 수 ${shape.blockCount}가 최소 ${minimumBlockCount}와 다르다`,
        );
      }
      if (shape.totalCodewordSymbols !== row.symbols) {
        throw new Error(
          `${symbolKey}/${level}: 블록 코드워드 합 ${shape.totalCodewordSymbols}`
          + `가 symbols ${row.symbols}와 다르다`,
        );
      }
      if (row[level] !== shape.totalParitySymbols) {
        throw new Error(
          `${symbolKey}/${level}: 총 패리티 ${row[level]}가 블록 합`
          + ` ${shape.totalParitySymbols}와 다르다`,
        );
      }

      // 모든 행에서 인터리브↔디인터리브가 역함수인지 실제 심볼열로 검사한다.
      const blocks = shape.codewordLengths.map((length, blockIndex) =>
        Uint8Array.from({ length }, (_, index) => (blockIndex * 97 + index) % P));
      const interleaved = interleaveRsBlocks(blocks, config);
      const restored = deinterleaveRsBlocks(interleaved, config);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        if (blocks[blockIndex].length !== restored[blockIndex].length
          || blocks[blockIndex].some((value, index) => value !== restored[blockIndex][index])) {
          throw new Error(`${symbolKey}/${level}: 인터리브 왕복이 블록 ${blockIndex}를 바꿨다`);
        }
      }
      if (shape.blockCount === 1
        && interleaved.some((value, index) => value !== blocks[0][index])) {
        throw new Error(`${symbolKey}/${level}: 단일 블록 인터리브가 항등이 아니다`);
      }
    }
  }
}
