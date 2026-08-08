/**
 * png.js — 결정적 PNG 인코더 (SPEC §8 내보내기, T10)
 *
 * 왜 자체 구현인가: M0 완료 기준이 "동일 입력 → 바이트 동일 출력(PNG 해시 일치)"인데,
 * 브라우저 canvas.toBlob 은 (1) 벡터 래스터화 픽셀이 엔진·버전별로 다르고 (2) PNG
 * 인코딩(필터 선택·zlib 전략)도 구현마다 달라 바이트 결정성이 원리적으로 불가능하다.
 * 그래서 픽셀은 raster.js(순수 결정적 래스터라이저)가 만들고, 이 모듈이 그 픽셀을
 * 고정된 규칙으로만 직렬화한다 — 적응적 선택이 하나도 없다:
 *
 * - 색 타입 2 (RGB 8bit). 래스터의 알파는 항상 255 라 버린다.
 * - 스캔라인 필터: 첫 행 Sub(1), 나머지 전 행 Up(2). 고정 — 행별 휴리스틱 없음.
 * - deflate: **고정 허프만(BTYPE=01) 단일 블록 + 거리-1 RLE 매치**만 사용.
 *   평면 채색 이미지는 필터 후 데이터가 0 의 장주기 런이라, 거리 1 매치(=직전
 *   바이트 반복)만으로 대부분의 압축이 나온다. 해시 체인 탐색 같은 구현 자유도를
 *   일부러 두지 않는다 — 자유도가 없어야 바이트가 고정된다.
 *
 * 표준 준수는 테스트가 오라클로 단언한다: node:zlib inflate 로 우리 deflate 를
 * 되풀어 원본과 대조하고, IDAT 을 풀어 언필터한 픽셀이 래스터와 일치함을 본다.
 * (zlib 은 테스트에서만 쓴다 — 이 모듈 자체는 브라우저 호환 순수 ESM 이다.)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 체크섬
// ─────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** PNG 청크 CRC-32 (ISO 3309, poly 0xEDB88320 반사형). */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** zlib 트레일러 Adler-32 (RFC 1950, mod 65521). */
export function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// deflate — 고정 허프만 + 거리-1 RLE (RFC 1951 §3.2.6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 비트 기록기. deflate 는 바이트 안에서 LSB-first 로 채우되, 허프만 코드만
 * MSB-first 로 쓰는 혼합 규약이다 (RFC 1951 §3.1.1) — 그래서 메서드가 둘이다.
 */
class BitWriter {
  constructor() {
    this.bytes = [];
    this.cur = 0;
    this.nbits = 0;
  }

  /** 값의 하위 count 비트를 LSB-first 로 (블록 헤더·엑스트라 비트용). */
  writeBits(value, count) {
    for (let i = 0; i < count; i += 1) {
      this.cur |= ((value >>> i) & 1) << this.nbits;
      this.nbits += 1;
      if (this.nbits === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }

  /** 허프만 코드를 MSB-first 로 (RFC 1951 §3.1.1 "packed starting with the MSB"). */
  writeHuff(code, len) {
    for (let i = len - 1; i >= 0; i -= 1) this.writeBits((code >>> i) & 1, 1);
  }

  finish() {
    if (this.nbits > 0) {
      this.bytes.push(this.cur);
      this.cur = 0;
      this.nbits = 0;
    }
    return Uint8Array.from(this.bytes);
  }
}

/** 고정 허프만 리터럴/길이 코드 (RFC 1951 §3.2.6 표). 심볼 → {code, len}. */
function fixedLitCode(sym) {
  if (sym <= 143) return { code: 0x30 + sym, len: 8 };
  if (sym <= 255) return { code: 0x190 + (sym - 144), len: 9 };
  if (sym <= 279) return { code: sym - 256, len: 7 };
  return { code: 0xc0 + (sym - 280), len: 8 };
}

/** 길이 3..258 → {sym, extraBits, base} (RFC 1951 §3.2.5 길이 표). */
const LENGTH_CODES = (() => {
  const rows = [
    // [첫 길이, 심볼 시작, 엑스트라 비트, 그 엑스트라의 항목 수]
    [3, 257, 0, 8], [11, 265, 1, 4], [19, 269, 2, 4], [35, 273, 3, 4],
    [67, 277, 4, 4], [131, 281, 5, 4],
  ];
  const table = [];
  for (const [firstLen, firstSym, extra, count] of rows) {
    let len = firstLen;
    for (let i = 0; i < count; i += 1) {
      table.push({ minLen: len, sym: firstSym + i, extraBits: extra });
      len += 1 << extra;
    }
  }
  return table;
})();

function lengthToCode(length) {
  if (length === 258) return { sym: 285, extraBits: 0, base: 258 };
  for (let i = LENGTH_CODES.length - 1; i >= 0; i -= 1) {
    if (length >= LENGTH_CODES[i].minLen) {
      return { sym: LENGTH_CODES[i].sym, extraBits: LENGTH_CODES[i].extraBits, base: LENGTH_CODES[i].minLen };
    }
  }
  throw new RangeError(`deflate 매치 길이 범위 밖: ${length}`);
}

/**
 * 고정 허프만 단일 블록 deflate. 매치는 거리 1 만 본다 (모듈 헤더 참조).
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function deflateFixed(data) {
  const w = new BitWriter();
  w.writeBits(1, 1); // BFINAL
  w.writeBits(1, 2); // BTYPE=01 고정 허프만

  let i = 0;
  while (i < data.length) {
    if (i > 0) {
      const b = data[i - 1];
      let run = 0;
      while (run < 258 && i + run < data.length && data[i + run] === b) run += 1;
      if (run >= 3) {
        const { sym, extraBits, base } = lengthToCode(run);
        const lit = fixedLitCode(sym);
        w.writeHuff(lit.code, lit.len);
        if (extraBits > 0) w.writeBits(run - base, extraBits);
        // 거리 코드 0 (= 거리 1), 5비트 고정, 엑스트라 없음 (RFC 1951 §3.2.6).
        w.writeHuff(0, 5);
        i += run;
        continue;
      }
    }
    const lit = fixedLitCode(data[i]);
    w.writeHuff(lit.code, lit.len);
    i += 1;
  }

  const eob = fixedLitCode(256);
  w.writeHuff(eob.code, eob.len);
  return w.finish();
}

/** deflate 를 zlib 스트림(RFC 1950)으로 감싼다: 헤더 0x78 0x01 + 데이터 + Adler-32. */
export function zlibWrap(rawData) {
  const deflated = deflateFixed(rawData);
  const out = new Uint8Array(2 + deflated.length + 4);
  out[0] = 0x78; // CMF: deflate, 32K 윈도
  out[1] = 0x01; // FLG: FCHECK 만 ((0x78·256 + 0x01) % 31 === 0), FDICT 0, FLEVEL 0
  out.set(deflated, 2);
  writeU32BE(out, 2 + deflated.length, adler32(rawData));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG 조립
// ─────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BYTES_PER_PIXEL = 3; // 색 타입 2 (RGB)

function writeU32BE(buf, offset, value) {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  writeU32BE(out, 0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32BE(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * RGBA 래스터 → 필터 적용된 스캔라인 스트림 (행마다 [필터 타입, RGB…]).
 * 첫 행 Sub(1), 나머지 Up(2) — 고정 규칙 (모듈 헤더 참조).
 */
export function filterScanlines(pixels, width, height) {
  const stride = width * BYTES_PER_PIXEL;
  const out = new Uint8Array((stride + 1) * height);
  const row = new Uint8Array(stride);
  const prev = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = x * BYTES_PER_PIXEL;
      row[dst] = pixels[src];
      row[dst + 1] = pixels[src + 1];
      row[dst + 2] = pixels[src + 2];
    }
    const base = y * (stride + 1);
    if (y === 0) {
      out[base] = 1; // Sub
      for (let j = 0; j < stride; j += 1) {
        const left = j >= BYTES_PER_PIXEL ? row[j - BYTES_PER_PIXEL] : 0;
        out[base + 1 + j] = (row[j] - left) & 0xff;
      }
    } else {
      out[base] = 2; // Up
      for (let j = 0; j < stride; j += 1) {
        out[base + 1 + j] = (row[j] - prev[j]) & 0xff;
      }
    }
    prev.set(row);
  }
  return out;
}

/**
 * 래스터(rasterize() 산출물) → PNG 파일 바이트. 완전 결정적.
 * @param {{width:number, height:number, pixels:Uint8ClampedArray}} raster
 * @returns {Uint8Array}
 */
export function rasterToPng(raster) {
  const { width, height, pixels } = raster;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`래스터 크기가 유효하지 않다: ${width}×${height}`);
  }
  if (pixels.length !== width * height * 4) {
    throw new RangeError(`픽셀 버퍼 길이 불일치: ${pixels.length} ≠ ${width * height * 4}`);
  }

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8; //  비트 심도
  ihdr[9] = 2; //  색 타입 RGB
  ihdr[10] = 0; // 압축 (deflate)
  ihdr[11] = 0; // 필터 방식 0
  ihdr[12] = 0; // 논인터레이스

  const idat = zlibWrap(filterScanlines(pixels, width, height));

  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
