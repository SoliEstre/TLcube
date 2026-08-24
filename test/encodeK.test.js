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
import { regionCellsK, vertexAnchorsK, invertedVertexAnchors } from '../src/placementK.js';
import { anchorCells } from '../src/placement.js';
import {
  VERSIONS_KCM,
  MARKER_CELL_COUNT_K,
  MARKER_OVERHEAD_ADDED_K,
  markerCellsK,
  dataCellsInScanOrderKMarker,
} from '../src/markerK.js';

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
  // cornerMarker 는 2026-08-24 개설로 이 목록에서 **빠졌다** (배타 개설 정형 3단 ③ —
  // 구 락을 양성 단언으로). 아래 «K-CM 개설» 테스트가 그 자리를 대신 진다.
  for (const name of ['centerQr', 'centralV0', 'daehanFinder', 'turnA']) {
    assert.throws(() => encodeK('x', { [name]: true }), RangeError, name);
    // false 명시는 허용 (기본값과 같다).
    assert.equal(encodeK('x', { [name]: false }).ok !== false, true);
  }
  assert.throws(() => encodeK(123), TypeError);
  assert.throws(() => encodeK('x', { version: 7 }), RangeError);
  assert.throws(() => encodeK('x', { cornerMarker: 1 }), TypeError);
});

test('K-CM 개설 — 회계·와이어·발자국 (구 배타 락의 양성 전환)', () => {
  for (const spec of VERSIONS_KCM) {
    const plain = VERSIONS_K.find((entry) => entry.version === spec.version);
    // 회계 한 줄: overhead(K*CM) = overhead(K*) + 27 (markerK 헤더 §3).
    assert.equal(spec.overhead, plain.overhead + MARKER_OVERHEAD_ADDED_K, spec.name);
    assert.equal(spec.k, plain.k);
    assert.notEqual(spec.formatIndex, plain.formatIndex, '와이어가 안 갈리면 회계를 못 읽는다');

    const encoded = encodeK('K-CM ' + spec.name, { version: spec.version, cornerMarker: true });
    assert.equal(encoded.cornerMarker, true);
    assert.equal(encoded.formatIndex, spec.formatIndex);

    // 마커 30셀이 전부 실렸고, 그 중 반전 꼭짓점 3셀은 앵커 digit 과 **같은 값**이다.
    const vertices = new Set(invertedVertexAnchors(spec.k).map((c) => `${c.q},${c.r}`));
    let markerRole = 0;
    let anchorOverlap = 0;
    for (const cell of markerCellsK(spec.k)) {
      const kk = `${cell.q},${cell.r}`;
      const placed = encoded.cellDigits.get(kk);
      assert.ok(placed, `${spec.name} 마커 셀 ${kk} 이 안 실렸다`);
      assert.equal(placed.digit, cell.digit, `${spec.name} 마커 ${kk} digit`);
      if (placed.role === 'marker') markerRole += 1;
      if (vertices.has(kk)) {
        anchorOverlap += 1;
        assert.equal(placed.role, 'anchor', '꼭짓점은 회계상 앵커다 (한 번만 센다)');
      }
    }
    assert.equal(anchorOverlap, 3);
    assert.equal(markerRole, MARKER_CELL_COUNT_K - 3);

    // 데이터 셀이 정확히 27 줄었다 — «회계 한 줄» 의 셀 단위 확인.
    const plainEncoded = encodeK('K-CM ' + spec.name, { version: spec.version });
    assert.equal(
      plainEncoded.capacity.dataCells - encoded.capacity.dataCells,
      MARKER_OVERHEAD_ADDED_K,
      `${spec.name} 데이터 셀 감소`,
    );
  }
});

test('K-CM 왕복 — 전 버전 × 전 레벨, formatIndex 경로로도 갈린다', () => {
  for (const spec of VERSIONS_KCM) {
    for (const level of ['L', 'M', 'H']) {
      for (const text of ['', 'K-CM 왕복', 'https://tlcube.example/kcm']) {
        const encoded = encodeK(text, { version: spec.version, eccLevel: level, cornerMarker: true });
        const digits = dataCellsInScanOrderKMarker(encoded.k)
          .map((c) => encoded.cellDigits.get(`${c.q},${c.r}`).digit);
        const byVersion = decodeCellsK(digits, {
          type: 'K', version: spec.version, eccLevel: level, cornerMarker: true,
        });
        assert.equal(byVersion.ok, true, `${spec.name}/${level} 버전 경로`);
        assert.equal(byVersion.text, text);
        // 와이어만 보고도 갈린다 — (값 8, k) 가 K-CM 해석을 유일하게 정한다.
        const byWire = decodeCellsK(digits, {
          type: 'K', formatIndex: encoded.formatIndex, k: encoded.k, eccLevel: level,
        });
        assert.equal(byWire.ok, true, `${spec.name}/${level} 와이어 경로`);
        assert.equal(byWire.text, text);
      }
    }
  }
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
