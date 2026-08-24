/**
 * encodeK.test.js — Type K 인코더 + 후단 왕복 (encode → decodeCellsK 원문 일치).
 * 브리프 §3-① «왕복(encode→decodeCells) 원문 일치» 의 자다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeK, chooseVersionK } from '../src/encodeK.js';
import { decodeCellsK } from '../src/decoder/decode-k.js';
import { VERSIONS_K, capacityForK } from '../src/capacityK.js';
import { dataCellsInScanOrderK, layoutMapK } from '../src/layoutK.js';
import { regionCellsK, vertexAnchorsK } from '../src/placementK.js';
import { anchorCells } from '../src/placement.js';

const key = (c) => c.q + ',' + c.r;

function scanDigits(encoded) {
  // scan order-K 전체(데이터 + 필러)의 digit 열 — 디코더 입력 규약 그대로.
  const scan = dataCellsInScanOrderK(encoded.k);
  return scan.map((c) => {
    const entry = encoded.cellDigits.get(key(c));
    assert.ok(entry, `scan 셀 ${key(c)} 이 cellDigits 에 없다`);
    return entry.digit;
  });
}

test('왕복 — 전 버전 × 전 ECC 레벨 × ASCII/UTF-8 원문 일치', () => {
  for (const spec of VERSIONS_K) {
    for (const eccLevel of ['L', 'M', 'H']) {
      for (const text of [
        'K-roundtrip-' + spec.name + '-' + eccLevel,
        '육각별 K 왕복 — ' + spec.name + '/' + eccLevel,
      ]) {
        const encoded = encodeK(text, { version: spec.version, eccLevel });
        assert.equal(encoded.formatIndex, 7, spec.name + ' formatIndex');
        const digits = scanDigits(encoded);
        const decoded = decodeCellsK(digits, {
          version: spec.version, eccLevel, k: spec.k,
        });
        assert.equal(decoded.ok, true, spec.name + '/' + eccLevel + ': ' + (decoded.reason || ''));
        assert.equal(decoded.text, text);
        assert.equal(decoded.corrected, 0);
        // formatIndex + k 경로(디코더 실사용 형태)로도 같은 결과.
        const viaIndex = decodeCellsK(digits, { formatIndex: 7, k: spec.k, eccLevel });
        assert.equal(viaIndex.ok, true);
        assert.equal(viaIndex.text, text);
      }
    }
  }
});

test('오류·소거 복원 — digit 훼손 t개까지, 소거는 2t 경계까지', () => {
  const spec = VERSIONS_K[0];
  const eccLevel = 'M'; // K0/M: nsym 17 → t 8
  const text = 'K-damage-probe';
  const encoded = encodeK(text, { version: spec.version, eccLevel });
  const digits = scanDigits(encoded);
  const cap = capacityForK(spec, eccLevel);
  // 서로 다른 심볼 t개를 훼손한다 (심볼 i 의 첫 digit 을 뒤집는다).
  const t = cap.errorCapacity;
  const damaged = digits.slice();
  for (let i = 0; i < t; i += 1) {
    const cellIndex = i * 3;
    damaged[cellIndex] = (damaged[cellIndex] + 1) % 6;
  }
  const decoded = decodeCellsK(damaged, { version: spec.version, eccLevel, k: spec.k });
  assert.equal(decoded.ok, true, '오류 t개: ' + (decoded.reason || ''));
  assert.equal(decoded.text, text);
  assert.equal(decoded.corrected, t);
  // 소거 선언 경로 — 같은 훼손 + 위치 선언이면 패리티를 절반만 쓴다.
  const erased = decodeCellsK(damaged, { version: spec.version, eccLevel, k: spec.k }, {
    erasureCells: Array.from({ length: t }, (_, i) => i * 3),
  });
  assert.equal(erased.ok, true);
  assert.equal(erased.text, text);
  assert.equal(erased.crsDistance, t, '소거 t개의 C_RS = t');
});

test('버전 자동 선택 — 용량 경계에서 다음 버전으로 넘어간다', () => {
  assert.equal(chooseVersionK('x'.repeat(43), 'M').name, 'K0'); // K0/M 순 페이로드 43
  assert.equal(chooseVersionK('x'.repeat(44), 'M').name, 'K1');
  assert.equal(chooseVersionK('x'.repeat(86), 'M').name, 'K1');
  assert.equal(chooseVersionK('x'.repeat(87), 'M').name, 'K2');
  assert.equal(chooseVersionK('x'.repeat(138), 'M').name, 'K2');
  assert.throws(() => chooseVersionK('x'.repeat(139), 'M'), RangeError);
  const auto = encodeK('x'.repeat(44));
  assert.equal(auto.version, 1);
});

test('셀 지도 — 전 셀 커버(불스아이 제외)·역할 회계·digit 범위', () => {
  for (const spec of VERSIONS_K) {
    const encoded = encodeK('coverage-' + spec.name, { version: spec.version });
    const map = layoutMapK(spec.k);
    // cellDigits = 영역 전 셀 − 불스아이 19.
    assert.equal(encoded.cellDigits.size, regionCellsK(spec.k).length - 19, spec.name);
    const counts = {};
    for (const [cellKey, entry] of encoded.cellDigits) {
      counts[entry.role] = (counts[entry.role] || 0) + 1;
      assert.ok(entry.digit >= 0 && entry.digit <= 5, `${spec.name} ${cellKey} digit 범위`);
      const layoutRole = map.get(cellKey).role;
      // layoutMapK 는 filler 를 data 로 센다 — 그 외 역할은 정확히 일치해야 한다.
      if (entry.role === 'filler') assert.equal(layoutRole, 'data');
      else assert.equal(layoutRole, entry.role, `${spec.name} ${cellKey} 역할`);
    }
    assert.equal(counts.anchor, 9, spec.name + ' 앵커 (육각 3 + 별 6)');
    assert.equal(counts.format, 15);
    const cap = capacityForK(spec, 'M');
    assert.equal(counts.data, cap.usedSymbols * 3);
    assert.equal(counts.filler || 0, cap.residualCells);
    // 앵커 digit 실림 검증 — A 계열 5/0/0 + 반전 1/1/1 + 육각 코너 5/0/0.
    for (const anchor of [...anchorCells(spec.k), ...vertexAnchorsK(spec.k)]) {
      assert.equal(encoded.cellDigits.get(key(anchor)).digit, anchor.digit,
        `${spec.name} 앵커 ${key(anchor)} digit`);
    }
  }
});

test('옵션 배타 — 미검증 조합은 조용히 무시하지 않고 던진다', () => {
  for (const name of ['centerQr', 'centralV0', 'cornerMarker', 'daehanFinder', 'turnA']) {
    assert.throws(() => encodeK('x', { [name]: true }), RangeError, name);
    // false 명시는 허용 (기본값과 같다).
    assert.equal(encodeK('x', { [name]: false }).ok !== false, true);
  }
  assert.throws(() => encodeK(123), TypeError);
  assert.throws(() => encodeK('x', { version: 7 }), RangeError);
});

test('decodeCellsK 프로파일 판별 — formatIndex 는 k 없이 유일하지 않다', () => {
  const encoded = encodeK('ambig', { version: 0 });
  const digits = scanDigits(encoded);
  const noK = decodeCellsK(digits, { formatIndex: 7, eccLevel: 'M' });
  assert.equal(noK.ok, false, 'k 없는 인덱스 조회가 조용히 성공하면 안 된다');
  assert.match(noK.reason, /^format:/);
  const wrongType = decodeCellsK(digits, { type: 'A', version: 0, eccLevel: 'M' });
  assert.equal(wrongType.ok, false);
});
