/**
 * QR v2 ECC-L 바이트 모드 전용 복호. src/qr-v2-byte.js 인코더의 역.
 * 깨끗한 인라인 심볼용이며 일반 사진 QR 리더가 아니다.
 *
 * 기능 마스크·포맷 위치·지그재그는 ISO/IEC 18004 구조로 독립 구현한다.
 * RS 검증은 기존 `rs.js` (`rsDecode` / `rsSyndromes`) 를 쓴다.
 */
import {
  QR_MODE_BYTE,
  QR_V2_ALIGNMENT_CENTER,
  QR_V2_REMAINDER_BITS,
  QR_V2_SIZE,
  QR_V2L_EC_CODEWORDS,
  QR_V2L_TOTAL_CODEWORDS,
} from '../../src/qr-v2-byte.js';
import { rsDecode, rsSyndromes } from '../../src/rs.js';

const SIZE = QR_V2_SIZE;
const FORMAT_MASK_XOR = 0x5412;
const MASK_FORMULAS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function idx(x, y) {
  return y * SIZE + x;
}

export function v2FunctionMask() {
  const fn = new Uint8Array(SIZE * SIZE);
  const mark = (x, y) => {
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) fn[idx(x, y)] = 1;
  };
  for (let i = 0; i < SIZE; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  for (const [cx, cy] of [[3, 3], [SIZE - 4, 3], [3, SIZE - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
    }
  }
  const ac = QR_V2_ALIGNMENT_CENTER;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) mark(ac + dx, ac + dy);
  }
  mark(8, 4 * 2 + 9);
  for (let i = 0; i <= 5; i += 1) mark(8, i);
  mark(8, 7);
  mark(8, 8);
  mark(7, 8);
  for (let i = 9; i < 15; i += 1) mark(14 - i, 8);
  for (let i = 0; i <= 7; i += 1) mark(SIZE - 1 - i, 8);
  for (let i = 8; i < 15; i += 1) mark(8, SIZE - 15 + i);
  return fn;
}

function dataModulePositions(fn) {
  const order = [];
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < SIZE; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? SIZE - 1 - vert : vert;
        if (!fn[idx(x, y)]) order.push({ x, y });
      }
    }
  }
  return order;
}

export function readFormatMask(modules) {
  const bit = (x, y) => modules[idx(x, y)] & 1;
  let packed = 0;
  const pos = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i += 1) packed |= bit(pos[i][0], pos[i][1]) << i;
  return ((packed ^ FORMAT_MASK_XOR) >> 10) & 7;
}

export function readFormatBits(modules) {
  const bit = (x, y) => modules[idx(x, y)] & 1;
  let packed = 0;
  const pos = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i += 1) packed |= bit(pos[i][0], pos[i][1]) << i;
  return packed;
}

export function extractCodewords(modules) {
  if (!modules || modules.length !== SIZE * SIZE) {
    throw new RangeError(`QR v2 모듈은 ${SIZE * SIZE}개여야 한다`);
  }
  const fn = v2FunctionMask();
  const mask = readFormatMask(modules);
  const formula = MASK_FORMULAS[mask];
  const unmasked = Uint8Array.from(modules);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (fn[idx(x, y)]) continue;
      if (formula(x, y)) unmasked[idx(x, y)] ^= 1;
    }
  }
  const positions = dataModulePositions(fn);
  const totalBits = QR_V2L_TOTAL_CODEWORDS * 8;
  if (positions.length !== totalBits + QR_V2_REMAINDER_BITS) {
    throw new Error(`데이터 칸 수 불일치: ${positions.length}`);
  }
  const codewords = new Uint8Array(QR_V2L_TOTAL_CODEWORDS);
  for (let i = 0; i < totalBits; i += 1) {
    const { x, y } = positions[i];
    if (unmasked[idx(x, y)]) codewords[i >> 3] |= 1 << (7 - (i & 7));
  }
  return { codewords, mask, unmasked, positions };
}

function parseBytePayload(data) {
  const bits = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  }
  let cursor = 0;
  const take = (n) => {
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      v = (v << 1) | bits[cursor];
      cursor += 1;
    }
    return v;
  };
  const mode = take(4);
  if (mode !== QR_MODE_BYTE) throw new Error(`바이트 모드가 아니다: ${mode}`);
  const count = take(8);
  let text = '';
  for (let i = 0; i < count; i += 1) text += String.fromCharCode(take(8));
  return { text, mode, count };
}

export function decodeQrV2Byte(modules) {
  const { codewords, mask } = extractCodewords(modules);
  const syndromes = rsSyndromes(codewords, QR_V2L_EC_CODEWORDS);
  const decoded = rsDecode(codewords, QR_V2L_EC_CODEWORDS);
  if (!decoded.ok) throw new Error(`RS 복호 실패: ${decoded.reason}`);
  const payload = parseBytePayload(decoded.message);
  return {
    text: payload.text,
    mask,
    mode: 'byte',
    version: 2,
    ecc: 'L',
    count: payload.count,
    syndromes,
  };
}

export function modulesFromQrSvg(svg, quiet = 4) {
  const vb = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
  if (!vb) throw new Error('QR SVG viewBox 가 없다');
  const n = Number(vb[1]);
  const size = n - quiet * 2;
  if (size !== SIZE) {
    throw new RangeError(`포스터 QR 은 v2 ${SIZE}×${SIZE} 여야 한다: ${size}`);
  }
  const mods = new Uint8Array(SIZE * SIZE);
  const re = /<rect class="mod" x="(\d+)" y="(\d+)"/g;
  let match;
  let count = 0;
  while ((match = re.exec(svg))) {
    const x = Number(match[1]) - quiet;
    const y = Number(match[2]) - quiet;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
      throw new RangeError(`QR 모듈이 격자 밖이다: ${x},${y}`);
    }
    mods[idx(x, y)] = 1;
    count += 1;
  }
  if (count === 0) throw new Error('인라인 QR 모듈 rect 가 없다');
  return mods;
}
