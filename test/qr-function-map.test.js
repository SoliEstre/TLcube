// qr-function-map.test.js — QR v1 모듈 역할 맵 (DESIGN_001 §3.3 · §4.1 · §7.5)
//
// 맵은 `qr.js` 를 고치지 않고 ISO/IEC 18004 v1 규격에서 다시 유도한 것이다. 그래서 이
// 테스트는 맵을 **실제 인코더 출력(`qrMatrix`)** 에 대 본다:
//   ① 집계: 기능 233 = 파인더+분리자 192 + 타이밍 10 + 포맷 30 + dark module 1, 데이터 208 = 26×8.
//   ② 여러 페이로드(길이 0–25, 힌트 URL 포함)에서 파인더 · 타이밍 · dark module 값이 규격
//      패턴 그대로 불변이다. 포맷 두 사본은 서로 같고 `formatInfoBits(mask)` 중 하나다.
//   ③ 페이로드마다 바뀌는 모듈은 데이터 ∪ 포맷 안에만 있고, 데이터 208칸은 페이로드 집합에서
//      모두 0 과 1 을 한 번 이상 가진다(맵이 데이터를 기능으로 잘못 가두지 않았다).
//   ④ 맵의 데이터 칸 · 배치 순서로 비트를 읽고 포맷의 마스크를 벗기면 26 코드워드가 **유효한
//      RS 코드워드**(신드롬 0)이고, 머리 비트가 알파뉴메릭 모드(0010) + 문자 수다.
//      — 데이터 위치와 순서가 모두 맞아야만 서는 성질이다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QR_V1_SIZE,
  QR_MODULE_ROLES,
  qrFunctionMapV1,
  qrModuleRole,
  qrModuleColor,
} from '../src/qr-function-map.js';
import {
  qrMatrix,
  formatInfoBits,
  QR_ALNUM_CHARSET,
  QR_V1L_CAPACITY,
  TL_READER_URL,
  TL_READER_HINT_REGISTRY,
  tlReaderUrlWithHint,
} from '../src/qr.js';
import { rsSyndromes } from '../src/rs.js';

const SIZE = QR_V1_SIZE;
const map = qrFunctionMapV1();

// 결정적 의사난수(선형 합동) — 페이로드 표본.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function payloads() {
  const rnd = lcg(20260926);
  const out = ['', 'A', '0', TL_READER_URL, ...TL_READER_HINT_REGISTRY.map((e) => tlReaderUrlWithHint(e.hint))];
  for (let len = 1; len <= QR_V1L_CAPACITY; len += 1) {
    for (let k = 0; k < 3; k += 1) {
      let t = '';
      for (let i = 0; i < len; i += 1) t += QR_ALNUM_CHARSET[Math.floor(rnd() * QR_ALNUM_CHARSET.length)];
      out.push(t);
    }
  }
  return out;
}
const PAYLOADS = payloads();
const MATRICES = PAYLOADS.map((t) => ({ text: t, qr: qrMatrix(t) }));

const at = (qr, x, y) => qr.modules[y * SIZE + x];

// 규격의 기대 패턴(이 테스트가 독립으로 적는다).
const FINDERS = [[3, 3], [SIZE - 4, 3], [3, SIZE - 4]];
function expectedFixedValue(x, y) {
  for (const [cx, cy] of FINDERS) {
    const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
    if (d <= 4) return d === 2 || d === 4 ? 0 : 1; // 7×7 파인더(0·1·3 어두움) + 분리자(4 밝음)
  }
  if (x === 6 || y === 6) return (x + y) % 2 === 0 ? 1 : 0; // 타이밍: 짝수 인덱스 어두움
  return 1; // dark module
}

// 포맷 비트 읽기 — ISO 부속서 C 배치(사본 1: 좌상 둘레, 사본 2: 우상 행 8 + 좌하 열 8).
function readFormat(qr) {
  let a = 0;
  let b = 0;
  const copy1 = [];
  for (let i = 0; i <= 5; i += 1) copy1.push([8, i]);
  copy1.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i += 1) copy1.push([14 - i, 8]);
  const copy2 = [];
  for (let i = 0; i <= 7; i += 1) copy2.push([SIZE - 1 - i, 8]);
  for (let i = 8; i < 15; i += 1) copy2.push([8, SIZE - 15 + i]);
  copy1.forEach(([x, y], i) => { a |= at(qr, x, y) << i; });
  copy2.forEach(([x, y], i) => { b |= at(qr, x, y) << i; });
  return { a, b, positions: [...copy1, ...copy2] };
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

test('집계: 기능 233(파인더+분리자 192 · 타이밍 10 · 포맷 30 · dark module 1) · 데이터 208 = 26×8', () => {
  assert.equal(map.size, 21);
  const c = map.counts;
  assert.equal(c.finder, 3 * 64);
  assert.equal(c.timing, 10);
  assert.equal(c.format, 30);
  assert.equal(c['dark-module'], 1);
  assert.equal(c.function, 233);
  assert.equal(c.data, 208);
  assert.equal(c.data, 26 * 8);
  // roleAt 재집계가 counts 와 같다(두 경로가 한 유도에서 나온다).
  const tally = Object.fromEntries(QR_MODULE_ROLES.map((r) => [r, 0]));
  let eye = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      tally[map.roleAt(x, y)] += 1;
      assert.equal(map.isFunctionModule(x, y), map.roleAt(x, y) !== 'data');
      if (map.isEyeModule(x, y)) {
        eye += 1;
        assert.equal(map.roleAt(x, y), 'finder', '눈은 파인더 영역 안');
      }
    }
  }
  assert.deepEqual(tally, { data: 208, finder: 192, timing: 10, format: 30, 'dark-module': 1 });
  assert.equal(eye, 3 * 49, '눈 = 파인더 7×7 × 3 (분리자 제외)');
  assert.equal(map.dataOrder.length, 208);
  assert.equal(new Set(map.dataOrder.map((p) => `${p.x},${p.y}`)).size, 208, '배치 순서에 중복 없음');
  assert.ok(map.dataOrder.every((p) => map.roleAt(p.x, p.y) === 'data'));
  assert.equal(map.roleAt(8, 13), 'dark-module');
  assert.throws(() => map.roleAt(21, 0), RangeError);
  assert.equal(qrFunctionMapV1(), map, '한 번 유도해 공유');
});

test(`${PAYLOADS.length} 페이로드: 파인더 · 타이밍 · dark module 값이 규격 패턴 그대로 불변, 포맷 두 사본 일치`, () => {
  for (const { text, qr } of MATRICES) {
    assert.equal(qr.size, SIZE);
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const role = map.roleAt(x, y);
        if (role === 'finder' || role === 'timing' || role === 'dark-module') {
          assert.equal(at(qr, x, y), expectedFixedValue(x, y), `${JSON.stringify(text)} (${x},${y}) ${role}`);
        }
      }
    }
    const { a, b, positions } = readFormat(qr);
    assert.equal(a, b, `${JSON.stringify(text)}: 포맷 두 사본`);
    assert.ok([0, 1, 2, 3, 4, 5, 6, 7].some((m) => formatInfoBits(m) === a), '포맷 = formatInfoBits(mask)');
    assert.ok(positions.every(([x, y]) => map.roleAt(x, y) === 'format'), '읽은 포맷 위치 30칸 = 맵의 format');
    assert.equal(new Set(positions.map(([x, y]) => `${x},${y}`)).size, 30);
  }
});

test('페이로드 사이에 바뀌는 모듈은 데이터 ∪ 포맷 안에만 있고, 데이터 208칸은 모두 0 · 1 을 다 가진다', () => {
  const seen0 = new Uint8Array(SIZE * SIZE);
  const seen1 = new Uint8Array(SIZE * SIZE);
  for (const { qr } of MATRICES) {
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      if (qr.modules[i] === 1) seen1[i] = 1; else seen0[i] = 1;
    }
  }
  let dataVarying = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      const varies = seen0[i] === 1 && seen1[i] === 1;
      const role = map.roleAt(x, y);
      if (varies) assert.ok(role === 'data' || role === 'format', `(${x},${y}) ${role} 가 페이로드마다 바뀐다`);
      if (role === 'data' && varies) dataVarying += 1;
    }
  }
  assert.equal(dataVarying, 208);
});

test('맵의 데이터 칸 · 순서로 읽고 마스크를 벗기면 유효한 RS 코드워드 + 알파뉴메릭 머리(0010 · 문자 수)', () => {
  for (const { text, qr } of MATRICES) {
    const { a } = readFormat(qr);
    const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((m) => formatInfoBits(m) === a);
    const bits = map.dataOrder.map(({ x, y }) => at(qr, x, y) ^ (MASKS[mask](x, y) ? 1 : 0));
    const codewords = [];
    for (let i = 0; i < 26; i += 1) {
      let v = 0;
      for (let k = 0; k < 8; k += 1) v = (v << 1) | bits[i * 8 + k];
      codewords.push(v);
    }
    assert.ok(rsSyndromes(codewords, 7).every((s) => s === 0), `${JSON.stringify(text)}: RS 신드롬 0`);
    const mode = (bits[0] << 3) | (bits[1] << 2) | (bits[2] << 1) | bits[3];
    assert.equal(mode, 0b0010, '알파뉴메릭 모드');
    let count = 0;
    for (let k = 4; k < 13; k += 1) count = (count << 1) | bits[k];
    assert.equal(count, text.length, '문자 수');
  }
});

test('qrModuleRole · qrModuleColor: 밝은 모듈 null · 어두운 기능 fixed · 어두운 데이터 data · 눈만 eye 색', () => {
  const deco = { dark: { r: 1, g: 2, b: 3 }, eye: { r: 4, g: 5, b: 6 } };
  for (const { qr } of MATRICES.slice(0, 8)) {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const role = qrModuleRole(qr, y, x);
        if (at(qr, x, y) !== 1) assert.equal(role, null);
        else assert.equal(role, map.isFunctionModule(x, y) ? 'fixed' : 'data');
        assert.equal(qrModuleColor(deco, y, x), map.isEyeModule(x, y) ? deco.eye : deco.dark);
      }
    }
  }
  assert.throws(() => qrModuleRole({ size: 25, modules: new Uint8Array(625) }, 0, 0), RangeError);
});
