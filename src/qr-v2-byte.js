/**
 * qr-v2-byte.js — QR 버전 2 (25×25) 인코더, ECC-L 고정, **바이트 모드 전용**
 *
 * 포스터·재사용용 최소 구현. `qr.js` 의 v1-L 알파뉴메릭 공개 계약은 건드리지 않는다.
 * 소문자 19바이트(`https://tl.estre.so`) 는 v1-L 바이트 용량(17B)을 넘으므로
 * 여기로 인코드한다.
 *
 * ── 구현 범위 (ISO/IEC 18004) ────────────────────────────────────────────
 * - 행렬 25×25. 데이터 코드워드 34 + EC 코드워드 10 = 44 (단일 블록).
 * - 잔여 비트 7 (0 으로 두고 마스크만 적용).
 * - 비트스트림: 모드(0100, 4bit) + 문자수(8bit, v1–9 바이트 모드) + 각 바이트
 *   8bit + 종결자(≤4bit) + 8bit 정렬 패드 + 0xEC/0x11 교대 패드.
 * - 기능 패턴: 파인더 3 + 타이밍(행/열 6) + 정렬 1개(중심 18,18, 5×5) +
 *   다크 모듈(열8, 행 4·v+9 = 17). 버전 정보는 v7 미만이라 없다.
 * - 데이터 배치: 우하단부터 2열 지그재그, 타이밍 열(6) 스킵.
 * - 마스크: 8종 → ISO 패널티 N1–N4 최소, 동점 시 낮은 번호.
 * - 포맷 정보: `qr.js` 의 `formatInfoBits` (BCH(15,5), ECC-L, XOR 0x5412).
 *
 * RS 는 `rs.js` (GF(2^8)/0x11D/fcr=0) — `qr.js` 와 같은 체. 사장 모듈을
 * 표준 QR 용으로 재사용하는 근거는 `qr.js` 상단과 같다. `rs.js` 는 수정하지 않는다.
 *
 * 의존성: `rs.js`, `qr.js` 의 `formatInfoBits` 만. 런타임 의존성 0.
 */

import { rsEncode } from './rs.js';
import { formatInfoBits } from './qr.js';

export const QR_V2_SIZE = 25;
export const QR_V2L_DATA_CODEWORDS = 34;
export const QR_V2L_EC_CODEWORDS = 10;
export const QR_V2L_TOTAL_CODEWORDS = QR_V2L_DATA_CODEWORDS + QR_V2L_EC_CODEWORDS;
export const QR_V2_REMAINDER_BITS = 7;
/** v2-L 바이트 모드 순 용량 (바이트 수). ISO/IEC 18004 표 7. */
export const QR_V2L_BYTE_CAPACITY = 32;
export const QR_V2_ALIGNMENT_CENTER = 18;
export const QR_MODE_BYTE = 0b0100;

const SIZE = QR_V2_SIZE;
const DATA_CODEWORDS = QR_V2L_DATA_CODEWORDS;
const EC_CODEWORDS = QR_V2L_EC_CODEWORDS;
const TOTAL_DATA_BITS = DATA_CODEWORDS * 8;
const CHAR_COUNT_BITS = 8;
const PAD_BYTES = [0xec, 0x11];

const FINDER_CENTERS = Object.freeze([
  [3, 3],
  [SIZE - 4, 3],
  [3, SIZE - 4],
]);

const PENALTY_N1_BASE = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4_STEP = 10;

const N3_PATTERN_LEAD = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
const N3_PATTERN_TRAIL = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

const MASK_FORMULAS = Object.freeze([
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]);

function toLatin1Bytes(text) {
  if (typeof text !== 'string') throw new TypeError('text 는 문자열이어야 한다');
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 255) {
      throw new RangeError(`QR v2-L 바이트 모드는 0..255 코드유닛만 받는다: U+${c.toString(16)}`);
    }
    out[i] = c;
  }
  if (out.length > QR_V2L_BYTE_CAPACITY) {
    throw new RangeError(
      `QR v2-L 바이트 용량(${QR_V2L_BYTE_CAPACITY}B)을 초과했다: ${out.length}B`,
    );
  }
  return out;
}

class BitWriter {
  constructor() {
    this.bits = [];
  }

  push(value, len) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length() {
    return this.bits.length;
  }

  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) out[i >> 3] |= 1 << (7 - (i & 7));
    }
    return out;
  }
}

function buildDataCodewords(bytes) {
  const bw = new BitWriter();
  bw.push(QR_MODE_BYTE, 4);
  bw.push(bytes.length, CHAR_COUNT_BITS);
  for (const b of bytes) bw.push(b, 8);
  const remaining = TOTAL_DATA_BITS - bw.length;
  if (remaining < 0) {
    throw new RangeError('데이터가 v2-L 데이터 코드워드 용량(272bit)을 초과했다');
  }
  bw.push(0, Math.min(4, remaining));
  while (bw.length % 8 !== 0) bw.push(0, 1);
  const packed = bw.toBytes();
  const out = new Uint8Array(DATA_CODEWORDS);
  out.set(packed.subarray(0, Math.min(packed.length, DATA_CODEWORDS)));
  for (let i = packed.length, p = 0; i < DATA_CODEWORDS; i++, p++) {
    out[i] = PAD_BYTES[p % 2];
  }
  return out;
}

function idx(x, y) {
  return y * SIZE + x;
}

function inBounds(x, y) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

function createGrid() {
  return { dark: new Uint8Array(SIZE * SIZE), isFunction: new Uint8Array(SIZE * SIZE) };
}

function setFn(grid, x, y, dark) {
  if (!inBounds(x, y)) return;
  grid.isFunction[idx(x, y)] = 1;
  grid.dark[idx(x, y)] = dark ? 1 : 0;
}

function drawFunctionPatterns(grid) {
  for (let i = 0; i < SIZE; i++) {
    setFn(grid, 6, i, i % 2 === 0);
    setFn(grid, i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of FINDER_CENTERS) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(grid, cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  }
  const ac = QR_V2_ALIGNMENT_CENTER;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(grid, ac + dx, ac + dy, dist !== 1);
    }
  }
  setFn(grid, 8, 4 * 2 + 9, true);
  reserveFormatInfoModules(grid);
}

function reserveFormatInfoModules(grid) {
  for (let i = 0; i <= 5; i++) setFn(grid, 8, i, false);
  setFn(grid, 8, 7, false);
  setFn(grid, 8, 8, false);
  setFn(grid, 7, 8, false);
  for (let i = 9; i < 15; i++) setFn(grid, 14 - i, 8, false);
  for (let i = 0; i <= 7; i++) setFn(grid, SIZE - 1 - i, 8, false);
  for (let i = 8; i < 15; i++) setFn(grid, 8, SIZE - 15 + i, false);
}

function writeFormatBits(dark, mask) {
  const data = formatInfoBits(mask);
  const bit = (i) => (data >> i) & 1;
  const set = (x, y, v) => {
    dark[idx(x, y)] = v;
  };
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i <= 7; i++) set(SIZE - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, SIZE - 15 + i, bit(i));
  set(8, SIZE - 8, 1);
}

function dataModulePositions(grid) {
  const order = [];
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < SIZE; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? SIZE - 1 - vert : vert;
        if (!grid.isFunction[idx(x, y)]) order.push({ x, y });
      }
    }
  }
  return order;
}

function placeDataBits(grid, codewords) {
  const positions = dataModulePositions(grid);
  const totalBits = codewords.length * 8;
  const expected = totalBits + QR_V2_REMAINDER_BITS;
  if (positions.length !== expected) {
    throw new Error(
      `내부 불변 위반: 데이터 배치 칸(${positions.length}) != 코드워드+잔여(${expected})`,
    );
  }
  for (let i = 0; i < totalBits; i++) {
    const byte = codewords[i >> 3];
    const bit = (byte >> (7 - (i & 7))) & 1;
    const { x, y } = positions[i];
    grid.dark[idx(x, y)] = bit;
  }
}

function applyMask(grid, maskIndex) {
  const formula = MASK_FORMULAS[maskIndex];
  const out = grid.dark.slice();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (grid.isFunction[idx(x, y)]) continue;
      if (formula(x, y)) out[idx(x, y)] ^= 1;
    }
  }
  return out;
}

function get(dark, x, y) {
  return dark[idx(x, y)] === 1;
}

function runPenalty(colorAt) {
  let total = 0;
  let runColor = colorAt(0);
  let runLen = 1;
  for (let i = 1; i < SIZE; i++) {
    const c = colorAt(i);
    if (c === runColor) {
      runLen++;
    } else {
      if (runLen >= 5) total += PENALTY_N1_BASE + (runLen - 5);
      runColor = c;
      runLen = 1;
    }
  }
  if (runLen >= 5) total += PENALTY_N1_BASE + (runLen - 5);
  return total;
}

function penaltyN1(dark) {
  let total = 0;
  for (let y = 0; y < SIZE; y++) total += runPenalty((x) => get(dark, x, y));
  for (let x = 0; x < SIZE; x++) total += runPenalty((y) => get(dark, x, y));
  return total;
}

function penaltyN2(dark) {
  let total = 0;
  for (let y = 0; y < SIZE - 1; y++) {
    for (let x = 0; x < SIZE - 1; x++) {
      const c = get(dark, x, y);
      if (c === get(dark, x + 1, y) && c === get(dark, x, y + 1) && c === get(dark, x + 1, y + 1)) {
        total += PENALTY_N2;
      }
    }
  }
  return total;
}

function countPattern(bits, pattern) {
  let count = 0;
  for (let i = 0; i + pattern.length <= bits.length; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (bits[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) count++;
  }
  return count;
}

function penaltyN3(dark) {
  let total = 0;
  for (let y = 0; y < SIZE; y++) {
    const row = [];
    for (let x = 0; x < SIZE; x++) row.push(get(dark, x, y) ? 1 : 0);
    total += (countPattern(row, N3_PATTERN_LEAD) + countPattern(row, N3_PATTERN_TRAIL)) * PENALTY_N3;
  }
  for (let x = 0; x < SIZE; x++) {
    const col = [];
    for (let y = 0; y < SIZE; y++) col.push(get(dark, x, y) ? 1 : 0);
    total += (countPattern(col, N3_PATTERN_LEAD) + countPattern(col, N3_PATTERN_TRAIL)) * PENALTY_N3;
  }
  return total;
}

function penaltyN4(dark) {
  let darkCount = 0;
  for (let i = 0; i < dark.length; i++) if (dark[i]) darkCount++;
  const percent = (darkCount * 100) / (SIZE * SIZE);
  const prev = Math.floor(percent / 5) * 5;
  const next = prev + 5;
  const a = Math.abs(prev - 50) / 5;
  const b = Math.abs(next - 50) / 5;
  return Math.min(a, b) * PENALTY_N4_STEP;
}

function totalPenalty(dark) {
  return penaltyN1(dark) + penaltyN2(dark) + penaltyN3(dark) + penaltyN4(dark);
}

/**
 * 텍스트 → QR v2(25×25) 행렬, ECC-L, 바이트 모드.
 *
 * 각 문자의 코드유닛(0..255)을 그대로 1바이트로 싣는다. ASCII URL 은
 * UTF-8 과 동일하다. 대소문자를 바꾸지 않는다.
 *
 * @param {string} text 0..32 코드유닛, 각 값이 0..255
 * @returns {{size: 25, modules: Uint8Array}} modules 는 행 우선, 1 = 어두움
 */
export function qrV2ByteMatrix(text) {
  const bytes = toLatin1Bytes(text);
  const dataCodewords = buildDataCodewords(bytes);
  const codewords = rsEncode(dataCodewords, EC_CODEWORDS);

  const grid = createGrid();
  drawFunctionPatterns(grid);
  placeDataBits(grid, codewords);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(grid, mask);
    writeFormatBits(masked, mask);
    const penalty = totalPenalty(masked);
    if (best === null || penalty < best.penalty) {
      best = { mask, penalty, dark: masked };
    }
  }

  return { size: SIZE, modules: best.dark };
}
