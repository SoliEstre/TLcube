/**
 * qr.js — QR 버전 1 (21×21) 인코더, ECC-L 고정, **알파뉴메릭 모드 전용**
 *
 * SPEC §14 (Type Y) 코너 QR fallback 용. **범용 QR 라이브러리가 아니다** — 스코프는
 * ISO/IEC 18004 버전 1(21×21) · ECC 레벨 L · 알파뉴메릭 모드 하나로 고정한다.
 * 용량: v1-L 알파뉴메릭 **25자** (`QR_V1L_CAPACITY`). 그 이상·문자셋 밖 입력은
 * `RangeError`.
 *
 * ── RS 패리티 재사용 (중요, 의도적 설계 결정) ───────────────────────────────
 * QR 의 Reed-Solomon 은 GF(2^8), 원시다항식 x^8+x^4+x^3+x^2+1(0x11D), fcr=0 —
 * 이는 이 저장소의 `src/gf256.js` / `src/rs.js` 가 이미 구현한 체와 **정확히 같다**
 * (ADR 0001 로 메인 파이프라인은 GF(211) 로 옮겨갔지만, gf256/rs 는 그 이전에
 * 이미 QR 과 동일한 관례값을 근거로 선택된 체다 — gf256.js 상단 주석 참조).
 * `rs.js` 는 ADR 0001 로 **사장(deprecated)** 되어 신규 코드가 쓰지 않는 게
 * 원칙이지만, 이 모듈은 Type Y 코드 자체가 아니라 그 fallback 인 표준 QR 을
 * 구현하는 것이므로 그 체가 필요하다 — 사장된 모듈을 이 용도로 부활시키는 것은
 * 정당하다. `rs.js` 본체는 수정하지 않는다 (요청 규약).
 *
 * ── 구현 범위 (ISO/IEC 18004) ────────────────────────────────────────────
 * - 데이터 코드워드 19 + EC 코드워드 7 = 26 (v1-L 총 코드워드).
 * - 비트스트림: 모드(0010, 4bit) + 문자수(9bit) + 알파뉴메릭 데이터(2자쌍=45진
 *   11bit · 홀수 꼬리 1자=6bit) + 종결자(≤4bit) + 8bit 정렬 패드 + 0xEC/0x11
 *   교대 패드.
 * - 기능 패턴: 파인더 3(7×7+분리자) + 타이밍(행/열 6, 교대) + 다크 모듈
 *   (열8, 행 4·v+9 = 13) — v1 은 정렬 패턴이 없다.
 * - 데이터 배치: 우하단부터 2열 지그재그(상향/하향 교대), 타이밍 열(6) 스킵.
 * - 마스크: 8종 전부 생성 → ISO 패널티 N1(런)+N2(2×2)+N3(1:1:3:1:1 패턴)+
 *   N4(암비율) 합산 최소 선택, 동점 시 낮은 마스크 번호(결정성).
 * - 포맷 정보: BCH(15,5) 생성다항식 0x537 + 마스크 XOR 0x5412, ECC-L(01) +
 *   마스크 3bit, 2곳(파인더 인접) 배치.
 *
 * 의존성: `rs.js` 하나뿐(그 아래 `gf256.js`). 브라우저 호환 순수 ESM.
 */

import { rsEncode } from './rs.js';

// ── 공개 상수 ────────────────────────────────────────────────────────────

/** QR 알파뉴메릭 문자셋. 인덱스 자체가 45진 인코딩 값이다 (ISO/IEC 18004 표 5). */
export const QR_ALNUM_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** v1-L 알파뉴메릭 모드 순 용량 (문자 수). */
export const QR_V1L_CAPACITY = 25;

/**
 * TL 리더 URL — 코너 QR·중앙 QR(V*Q) 공용 상수 (PM/008 규범, ADR 0004 §1-4).
 * 23자, v1-L 알파뉴메릭 용량(25자) 이내, 문자셋(대문자·숫자·`:` `/` `.`) 전부
 * `QR_ALNUM_CHARSET` 안에 있다. 전 소비자(scene.js·sceneY.js 및 그 상위)는 이
 * 상수만 import 해서 쓴다 — 리터럴 재작성 금지.
 */
export const TL_READER_URL = 'HTTPS://TLSCAN.ESTRE.SO';

/**
 * TL 리더 QR의 1글자 가족 힌트 등록부.
 *
 * `aliases`는 생성기가 실제로 넘기는 타입(O/A/K/Y)과 그 파생 타입(G/V/C0~C3),
 * 그리고 스캐너가 쓰는 기하 family를 한 등록부에서 만난다. URL 문자 배정은 이 표만
 * 소유한다. C는 육각 해석을 쓰되 3시 노치 실루엣이라는 별도 힌트이므로, parser의
 * 반환값은 디코더가 이해하는 `hex`로 통일한다.
 */
export const TL_READER_HINT_REGISTRY = Object.freeze([
  Object.freeze({ hint: 'O', family: 'hex', aliases: Object.freeze(['O', 'G', 'hex']) }),
  Object.freeze({ hint: 'A', family: 'tri', aliases: Object.freeze(['A', 'V', 'tri']) }),
  Object.freeze({ hint: 'K', family: 'star', aliases: Object.freeze(['K', 'star']) }),
  Object.freeze({ hint: 'Y', family: 'cube', aliases: Object.freeze(['Y', 'cube']) }),
  Object.freeze({ hint: 'C', family: 'hex', aliases: Object.freeze(['C', 'C0', 'C1', 'C2', 'C3', 'hex-notch']) }),
]);

function readerHintEntryForFamily(family) {
  if (typeof family !== 'string') return null;
  return TL_READER_HINT_REGISTRY.find((entry) => entry.aliases.includes(family)) || null;
}

function readerHintEntryForCharacter(hint) {
  return TL_READER_HINT_REGISTRY.find((entry) => entry.hint === hint) || null;
}

/**
 * 가족 힌트를 붙인 TL 리더 URL. 등록부 밖 입력은 기존 무힌트 URL을 바이트 그대로
 * 돌려 하위 호환을 지킨다. v1-L 알파뉴메릭 최대 25자에 정확히 맞는다.
 */
export function tlReaderUrlWithHint(family) {
  const entry = readerHintEntryForFamily(family);
  return entry === null ? TL_READER_URL : TL_READER_URL + '/' + entry.hint;
}

/**
 * tlscan pathname의 정확히 한 글자 `/x` 힌트를 디코더 family로 푼다.
 *
 * location을 직접 읽지 않는 순수 함수라 브라우저 경로와 국소 자가가 같은 규약을 쓴다.
 * 예약 숫자·미지 문자·부재·여러 글자 경로는 모두 무힌트(null)다.
 */
export function tlReaderFamilyHintFromPath(pathname) {
  if (typeof pathname !== 'string') return null;
  const match = /^\/([A-Z])$/.exec(pathname);
  if (match === null) return null;
  const entry = readerHintEntryForCharacter(match[1]);
  return entry === null ? null : entry.family;
}

// ── 내부 상수 ────────────────────────────────────────────────────────────

const SIZE = 21; // QR v1 모듈 한 변
const DATA_CODEWORDS = 19; // v1-L 데이터 코드워드
const EC_CODEWORDS = 7; // v1-L EC 코드워드 (nsym)
const TOTAL_DATA_BITS = DATA_CODEWORDS * 8; // 152

const MODE_ALNUM = 0b0010;
const CHAR_COUNT_BITS = 9; // v1-9 알파뉴메릭 모드 문자수 인디케이터 폭
const PAD_BYTES = [0xec, 0x11]; // 패드 코드워드, 0xEC 부터 교대

const FORMAT_ECC_L = 0b01; // ISO/IEC 18004 표 25: L=01
const FORMAT_BCH_GENERATOR = 0x537; // BCH(15,5) 생성다항식
const FORMAT_MASK_XOR = 0x5412; // 포맷 정보 고정 XOR 마스크

const FINDER_CENTERS = Object.freeze([
  [3, 3],
  [SIZE - 4, 3],
  [3, SIZE - 4],
]);

const PENALTY_N1_BASE = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4_STEP = 10;

const N3_PATTERN_LEAD = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]; // 패턴 + 밝음4
const N3_PATTERN_TRAIL = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]; // 밝음4 + 패턴

const CHAR_INDEX = new Map();
for (let i = 0; i < QR_ALNUM_CHARSET.length; i++) CHAR_INDEX.set(QR_ALNUM_CHARSET[i], i);

// ── 입력 검증 ────────────────────────────────────────────────────────────

function charIndex(ch) {
  const v = CHAR_INDEX.get(ch);
  if (v === undefined) {
    throw new RangeError(`QR v1 알파뉴메릭 문자셋 밖의 문자: ${JSON.stringify(ch)}`);
  }
  return v;
}

function validateText(text) {
  if (typeof text !== 'string') throw new TypeError('text 는 문자열이어야 한다');
  if (text.length > QR_V1L_CAPACITY) {
    throw new RangeError(
      `QR v1-L 알파뉴메릭 용량(${QR_V1L_CAPACITY}자)을 초과했다: ${text.length}자`,
    );
  }
  for (const ch of text) charIndex(ch); // 문자셋 밖이면 여기서 던진다
}

// ── 비트스트림 → 데이터 코드워드 ───────────────────────────────────────────

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

/** 텍스트 → v1-L 데이터 코드워드 19바이트 (모드+문자수+데이터+종결자+패드). */
function buildDataCodewords(text) {
  const bw = new BitWriter();
  bw.push(MODE_ALNUM, 4);
  bw.push(text.length, CHAR_COUNT_BITS);
  for (let i = 0; i < text.length; i += 2) {
    if (i + 1 < text.length) {
      const v = 45 * charIndex(text[i]) + charIndex(text[i + 1]);
      bw.push(v, 11);
    } else {
      bw.push(charIndex(text[i]), 6);
    }
  }
  const remaining = TOTAL_DATA_BITS - bw.length;
  if (remaining < 0) {
    // QR_V1L_CAPACITY 검증을 통과했다면 이 경로는 도달하지 않는다 (방어적 가드).
    throw new RangeError('데이터가 v1-L 데이터 코드워드 용량(152bit)을 초과했다');
  }
  bw.push(0, Math.min(4, remaining)); // 종결자 0000, 공간 없으면 잘라서
  while (bw.length % 8 !== 0) bw.push(0, 1); // 8bit 경계 정렬

  const bytes = bw.toBytes();
  const out = new Uint8Array(DATA_CODEWORDS);
  out.set(bytes.subarray(0, Math.min(bytes.length, DATA_CODEWORDS)));
  for (let i = bytes.length, p = 0; i < DATA_CODEWORDS; i++, p++) {
    out[i] = PAD_BYTES[p % 2]; // 0xEC, 0x11 교대
  }
  return out;
}

// ── 격자 좌표 헬퍼 ───────────────────────────────────────────────────────

function idx(x, y) {
  return y * SIZE + x;
}

function inBounds(x, y) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

// ── 기능 패턴 ────────────────────────────────────────────────────────────

function createGrid() {
  return { dark: new Uint8Array(SIZE * SIZE), isFunction: new Uint8Array(SIZE * SIZE) };
}

function setFn(grid, x, y, dark) {
  if (!inBounds(x, y)) return;
  grid.isFunction[idx(x, y)] = 1;
  grid.dark[idx(x, y)] = dark ? 1 : 0;
}

/**
 * 파인더 3 + 분리자 + 타이밍 + 다크 모듈 + 포맷 정보 예약 영역을 그린다.
 * 타이밍을 먼저 그리고 파인더로 겹치는 부분을 덮어쓴다 (ISO 배치 순서와 동일 —
 * 파인더 자체 패턴이 타이밍 셀과 겹치는 자리에서 최종 우선한다).
 */
function drawFunctionPatterns(grid) {
  // 타이밍 패턴: 열 6 · 행 6, 교대(짝수 인덱스 = 어두움).
  for (let i = 0; i < SIZE; i++) {
    setFn(grid, 6, i, i % 2 === 0);
    setFn(grid, i, 6, i % 2 === 0);
  }
  // 파인더 패턴 + 분리자: 중심으로부터 체비셰프 거리 dist ∈ {2,4} 는 밝음
  // (분리자·파인더 테두리 안쪽 링), 그 외(0,1,3)는 어두움 — 7×7 파인더 +
  // 둘레 1모듈 분리자를 한 번에 그린다. 그리드 경계 밖은 setFn 이 무시한다.
  for (const [cx, cy] of FINDER_CENTERS) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(grid, cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  }
  // 다크 모듈: 열 8, 행 4v+9 (v=1 → 13). 항상 어둡다.
  setFn(grid, 8, 4 * 1 + 9, true);
  // 포맷 정보 영역 예약 (값은 마스크별로 writeFormatBits 가 나중에 채운다).
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

// ── 포맷 정보 (BCH(15,5), ISO/IEC 18004 부속서 C) ─────────────────────────

function formatBchRemainder(data5) {
  let value = data5 << 10;
  for (let bitpos = 14; bitpos >= 10; bitpos--) {
    if ((value >> bitpos) & 1) value ^= FORMAT_BCH_GENERATOR << (bitpos - 10);
  }
  return value & 0x3ff;
}

/**
 * 포맷 정보 15bit (ECC-L 고정 + 마스크 3bit → BCH(15,5) → 0x5412 XOR).
 * KAT: mask=0 → 0b111011111000100 = 0x77C4 (ISO/IEC 18004 부속서 C 공지 예시).
 */
export function formatInfoBits(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new RangeError(`mask 는 0..7 정수여야 한다: ${mask}`);
  }
  const data5 = (FORMAT_ECC_L << 3) | mask;
  const rem = formatBchRemainder(data5);
  const combined = (data5 << 10) | rem;
  return combined ^ FORMAT_MASK_XOR;
}

/** 포맷 정보 15bit 를 두 사본(파인더 인접) 위치에 그린다. 마지막에 다크 모듈 재확정. */
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
  set(8, SIZE - 8, 1); // 다크 모듈
}

// ── 데이터 배치 (지그재그) ──────────────────────────────────────────────

/**
 * 우하단부터 2열씩 지그재그(상향/하향 교대)로 순회하는 데이터 셀 좌표열.
 * 열 6(타이밍)은 스킵한다. `isFunction` 이 아닌 셀만 담는다.
 */
function dataModulePositions(grid) {
  const order = [];
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // 타이밍 열 스킵
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
  if (positions.length !== totalBits) {
    // v1 은 잔여 비트(remainder bits)가 0 이므로 정확히 일치해야 한다 — 기능
    // 패턴 마킹이 어긋나면 여기서 바로 드러난다(조용한 배치 오류 방지).
    throw new Error(
      `내부 불변 위반: 데이터 배치 칸(${positions.length}) != 코드워드 비트 수(${totalBits})`,
    );
  }
  for (let i = 0; i < positions.length; i++) {
    const byte = codewords[i >> 3];
    const bit = (byte >> (7 - (i & 7))) & 1;
    const { x, y } = positions[i];
    grid.dark[idx(x, y)] = bit;
  }
}

// ── 마스크 ──────────────────────────────────────────────────────────────

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

/** 기능 패턴 셀은 건드리지 않고, 데이터 셀에만 마스크 XOR 을 적용한 사본을 만든다. */
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

// ── ISO 패널티 N1~N4 ─────────────────────────────────────────────────────

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

/** N1: 5개 이상 연속 동색 런 — 행·열 각각. */
function penaltyN1(dark) {
  let total = 0;
  for (let y = 0; y < SIZE; y++) total += runPenalty((x) => get(dark, x, y));
  for (let x = 0; x < SIZE; x++) total += runPenalty((y) => get(dark, x, y));
  return total;
}

/** N2: 2×2 동색 블록(슬라이딩, 겹침 허용) 1개당 3점. */
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

/**
 * N3: 1:1:3:1:1 패턴(파인더 유사 오인식 방지), 밝음4 패딩 포함, 행·열 각각.
 * 명시적 선택 (검증 라운드): 격자 **밖(콰이어트 존)을 밝음으로 확장하지 않는다** —
 * 확장하는 통용 구현(Nayuki 계열)과 30% 입력에서 마스크 선택이 갈리지만, 포맷 정보가
 * 마스크를 자기서술하므로 어떤 리더든 유효 판독이다(상호운용성 무영향, 스냅샷 안정 우선).
 */
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

/** N4: 암모듈 비율이 50% 에서 얼마나 벗어났는가 (5% 단위 반올림, 더 가까운 쪽). */
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

// ── 공개 API ────────────────────────────────────────────────────────────

/**
 * 텍스트 → QR v1(21×21) 행렬, ECC-L, 알파뉴메릭 모드 전용.
 *
 * @param {string} text 알파뉴메릭 문자셋(`QR_ALNUM_CHARSET`) 안의 문자열, 0..25자
 * @returns {{size: 21, modules: Uint8Array}} modules 는 행 우선(row-major),
 *          1 = 어두운 모듈, 길이 441 (= size²)
 * @throws {RangeError} 문자셋 밖 문자, 또는 25자 초과
 */
export function qrMatrix(text) {
  validateText(text);
  const dataCodewords = buildDataCodewords(text);
  // rs.js 재사용 (파일 상단 주석 참조) — QR 과 동일한 GF(2^8)/0x11D/fcr=0 체.
  const codewords = rsEncode(dataCodewords, EC_CODEWORDS);

  const grid = createGrid();
  drawFunctionPatterns(grid);
  placeDataBits(grid, codewords);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const masked = applyMask(grid, mask);
    writeFormatBits(masked, mask); // 포맷 정보 셀은 applyMask 대상 밖이라 별도로 그린다
    const penalty = totalPenalty(masked);
    if (best === null || penalty < best.penalty) {
      best = { mask, penalty, dark: masked };
    }
    // 동점 시 낮은 마스크 번호 — mask 는 0→7 오름차순으로 순회하므로
    // `penalty < best.penalty` (강한 부등호)만으로 이미 결정적이다.
  }

  return { size: SIZE, modules: best.dark };
}
