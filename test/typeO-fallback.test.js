// typeO-fallback.test.js — Type O QR fallback 계약 검증 (ADR 0004 §1 전체 확정 5건)
//
// 다루는 계약:
//   (1) V1Q~V3Q 포맷 정보 버전 인덱스 왕복 (encode.js centerQr → formatinfo.decode)
//   (2) 코너 QR — codeBounds 무교차 + 콰이어트 4모듈 규격 (scene.js)
//   (3) V*Q — 불스아이 disc 부재 + QR 모듈 크기 √26·cellSize/29 + 축 정렬
//   (4) 코너·중앙 동시 표시 시 QR 내용 동일 계약 (§1-4)
//   (5) 결정성
//
// 판독성(jsQR 실측)은 이 스위트가 아니라 repo 밖 스크래치에서 확인했다(과제 지침) —
// 그 결과는 이 임무의 최종 JSON metrics 필드에 기록된다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { VERSIONS } from '../src/capacity.js';
import { decode as decodeFormatInfo, ECC_LEVEL } from '../src/formatinfo.js';
import { buildScene } from '../src/scene.js';
import { codeBounds, layoutForRegion } from '../src/hexgrid.js';
import { maxSafeRadius } from '../src/bullseye.js';
import { qrMatrix, TL_READER_URL } from '../src/qr.js';

const PALETTE = {
  background: { r: 255, g: 255, b: 255 },
  levels: [
    { r: 20, g: 20, b: 20 },
    { r: 128, g: 128, b: 128 },
    { r: 235, g: 235, b: 235 },
  ],
  bullseyeDark: { r: 0, g: 0, b: 0 },
  bullseyeLight: { r: 255, g: 255, b: 255 },
};

const QR_QUIET_MODULES = 4;
const QR_BLOCK_MODULES = 29; // 4 + 21 + 4

/** row-major QR 모듈 좌표 목록(다크만), (x,y) 오름차순. */
function darkModuleCoords(qr) {
  const out = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.modules[y * qr.size + x] === 1) out.push({ x, y });
    }
  }
  return out;
}

/** shapes 슬라이스(다크 모듈 폴리곤들)를 블록 원점 기준 모듈 좌표로 역산한다. */
function extractModuleCoords(darkShapes, blockOriginX, blockOriginY, qrModuleSize) {
  return darkShapes
    .map((s) => {
      const minX = Math.min(...s.points.map((p) => p.x));
      const minY = Math.min(...s.points.map((p) => p.y));
      const x = Math.round((minX - blockOriginX) / qrModuleSize) - QR_QUIET_MODULES;
      const y = Math.round((minY - blockOriginY) / qrModuleSize) - QR_QUIET_MODULES;
      return { x, y };
    })
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

describe('(1) V1Q~V3Q 포맷 정보 버전 인덱스 왕복', () => {
  test('centerQr=true → 디코드된 버전 인덱스 = 4/5/6 (V1Q/V2Q/V3Q)', () => {
    const expected = { 1: 4, 2: 5, 3: 6 };
    for (const spec of VERSIONS) {
      const result = encode('typeO fallback KAT', {
        version: spec.version,
        eccLevel: 'M',
        centerQr: true,
      });
      const reads = [
        result.formatDigits.slice(0, 5),
        result.formatDigits.slice(5, 10),
        result.formatDigits.slice(10, 15),
      ];
      const decoded = decodeFormatInfo(reads);
      assert.equal(decoded.ok, true, `V${spec.version}Q 복호 실패`);
      assert.equal(decoded.version, expected[spec.version]);
      assert.equal(decoded.eccLevel, ECC_LEVEL.M);
    }
  });

  test('centerQr=false(기본) → 디코드된 버전 인덱스 = 0/1/2 (기존 경로 무변경)', () => {
    for (const spec of VERSIONS) {
      const result = encode('typeO fallback KAT', { version: spec.version, eccLevel: 'M' });
      const reads = [
        result.formatDigits.slice(0, 5),
        result.formatDigits.slice(5, 10),
        result.formatDigits.slice(10, 15),
      ];
      const decoded = decodeFormatInfo(reads);
      assert.equal(decoded.ok, true);
      assert.equal(decoded.version, spec.version - 1);
    }
  });
});

describe('(2) 코너 QR — codeBounds 무교차 + 콰이어트 4모듈 규격', () => {
  const encoded = encode('corner qr test', { version: 1, eccLevel: 'M' });

  test('기본 margin 에서 겹치지 않는다(throw 없음)', () => {
    assert.doesNotThrow(() => buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL }));
  });

  test('실측: 코너 QR 블록 bbox 와 codeBounds(k, layout) 가 실제로 분리되어 있다', () => {
    const cellSize = 1;
    const margin = 20 * cellSize; // scene.js DEFAULT_MARGIN_FACTOR_QR
    const layout = layoutForRegion(encoded.k, { size: cellSize, margin });
    const silhouette = codeBounds(encoded.k, layout);
    const qrModuleSize = cellSize / 2;
    const blockSide = QR_BLOCK_MODULES * qrModuleSize;
    const blockMaxX = margin * 0.25 + blockSide;
    const blockMaxY = margin * 0.25 + blockSide;
    assert.ok(blockMaxX <= silhouette.minX && blockMaxY <= silhouette.minY);
  });

  test('margin 을 너무 작게 강제하면 겹침이 감지되어 throw', () => {
    assert.throws(
      () => buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, margin: 2 }),
      /겹친다/,
    );
  });

  test('콰이어트 패치가 QR 을 정확히 4모듈로 감싼다(폭 = 29·qrModuleSize)', () => {
    const scene = buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL });
    const cellShapeCount = 3 * encoded.cellDigits.size;
    // (1) 셀 폴리곤 → (2) 불스아이 6 disc(centerQr=false) → (3) 코너 QR(콰이어트+다크).
    const quiet = scene.shapes[cellShapeCount + 6];
    assert.equal(quiet.kind, 'polygon');
    assert.deepEqual(quiet.color, PALETTE.bullseyeLight);
    const xs = quiet.points.map((p) => p.x);
    const ys = quiet.points.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const qrModuleSize = 0.5; // cellSize=1 기본
    assert.ok(Math.abs(width - QR_BLOCK_MODULES * qrModuleSize) < 1e-9);
    assert.ok(Math.abs(height - QR_BLOCK_MODULES * qrModuleSize) < 1e-9);
  });
});

describe('(3) V*Q — 불스아이 disc 부재 + QR 모듈 크기 √26·cellSize/29 + 축 정렬', () => {
  const encoded = encode('center qr test', { version: 1, eccLevel: 'M', centerQr: true });

  test('centerQr=true 이고 qrText 미지정이면 RangeError (V*Q 는 QR 없이 무의미)', () => {
    assert.throws(() => buildScene(encoded, { palette: PALETTE, centerQr: true }), RangeError);
  });

  test('centerQr=true 시 shapes 에 disc 가 하나도 없다(불스아이 6 disc 생략)', () => {
    const scene = buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, centerQr: true });
    const discs = scene.shapes.filter((s) => s.kind === 'disc');
    assert.equal(discs.length, 0);
  });

  test('QR 모듈 크기 = maxSafeRadius(cellSize)·√2/29 = √26·cellSize/29 (ADR 0004 §2)', () => {
    const cellSize = 3; // 1 이 아닌 값으로도 선형성 확인.
    const scene = buildScene(encoded, {
      palette: PALETTE, qrText: TL_READER_URL, centerQr: true, cellSize,
    });
    const cellShapeCount = 3 * encoded.cellDigits.size;
    const quiet = scene.shapes[cellShapeCount]; // centerQr: 셀 폴리곤 바로 다음이 QR 콰이어트 패치.
    assert.deepEqual(quiet.color, PALETTE.bullseyeLight);
    const xs = quiet.points.map((p) => p.x);
    const width = Math.max(...xs) - Math.min(...xs);
    const qrModuleSize = width / QR_BLOCK_MODULES;

    const rFromCode = maxSafeRadius(cellSize);
    const expectedFromR = (rFromCode * Math.sqrt(2)) / QR_BLOCK_MODULES;
    const expectedClosedForm = (Math.sqrt(26) * cellSize) / QR_BLOCK_MODULES; // ADR 0004 §2 닫힌 형태.
    assert.ok(Math.abs(qrModuleSize - expectedFromR) < 1e-9);
    assert.ok(Math.abs(qrModuleSize - expectedClosedForm) < 1e-9);
  });

  test('축 정렬: 콰이어트 패치·다크 모듈 폴리곤 전부 축평행 사각형(각 변 x 또는 y 값 2종뿐)', () => {
    const scene = buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, centerQr: true });
    const cellShapeCount = 3 * encoded.cellDigits.size;
    for (let i = cellShapeCount; i < scene.shapes.length; i += 1) {
      const s = scene.shapes[i];
      assert.equal(s.kind, 'polygon');
      const xs = new Set(s.points.map((p) => p.x));
      const ys = new Set(s.points.map((p) => p.y));
      assert.ok(xs.size <= 2, `x 값이 2종을 넘음(축 정렬 위반): ${[...xs]}`);
      assert.ok(ys.size <= 2, `y 값이 2종을 넘음(축 정렬 위반): ${[...ys]}`);
    }
  });

  test('블록 중심이 격자 원점(불스아이 중심)과 일치 — 축 정렬 + 중심 정렬', () => {
    const cellSize = 1;
    const scene = buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, centerQr: true, cellSize });
    const cellShapeCount = 3 * encoded.cellDigits.size;
    const quiet = scene.shapes[cellShapeCount];
    const xs = quiet.points.map((p) => p.x);
    const ys = quiet.points.map((p) => p.y);
    const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const centerY = (Math.max(...ys) + Math.min(...ys)) / 2;
    assert.ok(Math.abs(centerX - scene.layout.originX) < 1e-9);
    assert.ok(Math.abs(centerY - scene.layout.originY) < 1e-9);
  });
});

describe('(4) 코너·중앙 동시 표시 시 QR 내용 동일 계약 (ADR 0004 §1-4)', () => {
  test('centerQr=true + cornerToo=true — 두 블록의 다크 모듈 좌표 집합이 완전히 같다', () => {
    const encoded = encode('same content both', { version: 1, eccLevel: 'M', centerQr: true });
    const qr = qrMatrix(TL_READER_URL);
    const expected = darkModuleCoords(qr);
    const darkCount = expected.length;
    assert.ok(darkCount > 0, 'QR 매트릭스에 다크 모듈이 하나도 없음(텍스트를 바꿔야 함)');

    const cellSize = 2;
    const scene = buildScene(encoded, {
      palette: PALETTE, qrText: TL_READER_URL, centerQr: true, cornerToo: true, cellSize,
    });

    const cellShapeCount = 3 * encoded.cellDigits.size;
    // painter 순서(구현 계약): 셀 폴리곤 → 중앙 QR(콰이어트+다크) → 코너 QR(콰이어트+다크).
    const centerQuietIdx = cellShapeCount;
    const centerDarkStart = centerQuietIdx + 1;
    const centerDarkEnd = centerDarkStart + darkCount;
    const cornerQuietIdx = centerDarkEnd;
    const cornerDarkStart = cornerQuietIdx + 1;
    const cornerDarkEnd = cornerDarkStart + darkCount;
    assert.equal(scene.shapes.length, cornerDarkEnd, '전체 shape 수가 예상과 다름 — painter 순서/개수 확인');

    const centerQuiet = scene.shapes[centerQuietIdx];
    const cornerQuiet = scene.shapes[cornerQuietIdx];
    assert.deepEqual(centerQuiet.color, PALETTE.bullseyeLight);
    assert.deepEqual(cornerQuiet.color, PALETTE.bullseyeLight);

    const centerQrModuleSize =
      (Math.max(...centerQuiet.points.map((p) => p.x)) - Math.min(...centerQuiet.points.map((p) => p.x)))
      / QR_BLOCK_MODULES;
    const cornerQrModuleSize = cellSize / 2;

    const centerOriginX = Math.min(...centerQuiet.points.map((p) => p.x));
    const centerOriginY = Math.min(...centerQuiet.points.map((p) => p.y));
    const cornerOriginX = Math.min(...cornerQuiet.points.map((p) => p.x));
    const cornerOriginY = Math.min(...cornerQuiet.points.map((p) => p.y));

    const centerDark = extractModuleCoords(
      scene.shapes.slice(centerDarkStart, centerDarkEnd),
      centerOriginX, centerOriginY, centerQrModuleSize,
    );
    const cornerDark = extractModuleCoords(
      scene.shapes.slice(cornerDarkStart, cornerDarkEnd),
      cornerOriginX, cornerOriginY, cornerQrModuleSize,
    );

    assert.deepEqual(centerDark, expected, '중앙 QR 다크 모듈 좌표가 qrMatrix(TL_READER_URL) 과 다름');
    assert.deepEqual(cornerDark, expected, '코너 QR 다크 모듈 좌표가 qrMatrix(TL_READER_URL) 과 다름');
    assert.deepEqual(centerDark, cornerDark, '코너·중앙 QR 내용이 서로 다름 — §1-4 동일 강제 위반');
  });

  test('centerQr=true, cornerToo 생략(기본 false) 시 코너 QR 은 생략된다', () => {
    const encoded = encode('center only', { version: 1, eccLevel: 'M', centerQr: true });
    const scene = buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL, centerQr: true });
    const cellShapeCount = 3 * encoded.cellDigits.size;
    const qr = qrMatrix(TL_READER_URL);
    const darkCount = darkModuleCoords(qr).length;
    // 셀 폴리곤 + 중앙 QR(콰이어트 1 + 다크 darkCount) 뿐 — 코너분 추가 없음.
    assert.equal(scene.shapes.length, cellShapeCount + 1 + darkCount);
  });
});

describe('(5) 결정성', () => {
  test('centerQr=true, cornerToo=true 동일 입력 2회 호출 → deepEqual', () => {
    const encoded = encode('determinism check', { version: 1, eccLevel: 'M', centerQr: true });
    const opts = { palette: PALETTE, qrText: TL_READER_URL, centerQr: true, cornerToo: true };
    const a = buildScene(encoded, opts);
    const b = buildScene(encoded, opts);
    assert.deepEqual(a, b);
  });

  test('코너 QR 전용(centerQr=false) 동일 입력 2회 호출 → deepEqual', () => {
    const encoded = encode('det check', { version: 1, eccLevel: 'M' });
    const opts = { palette: PALETTE, qrText: TL_READER_URL };
    const a = buildScene(encoded, opts);
    const b = buildScene(encoded, opts);
    assert.deepEqual(a, b);
  });
});

// ── (6) centerQr 단일 소스 계약 (검증 라운드 major 대응) ──────────────────────
// buildScene 의 centerQr 는 encoded.centerQr 에서 파생된다 — 포맷 인덱스(V*Q 4~6)와
// 렌더 파인더가 어긋난 자기모순 아티팩트를 API 수준에서 차단한다 (ADR 0004 §1-3).

describe('centerQr 단일 소스 (encoded 파생 + 명시 불일치 throw)', () => {
  test('encoded.centerQr=true 면 opts 생략만으로 V*Q 렌더 (불스아이 disc 부재)', () => {
    const encoded = encode('single-source', { version: 1, eccLevel: 'M', centerQr: true });
    const scene = buildScene(encoded, { palette: PALETTE, qrText: TL_READER_URL });
    assert.equal(scene.shapes.filter((s) => s.kind === 'disc').length, 0);
  });

  test('불일치 조합은 양방향 throw', () => {
    const withQ = encode('mismatch-a', { version: 1, eccLevel: 'M', centerQr: true });
    assert.throws(
      () => buildScene(withQ, { palette: PALETTE, qrText: TL_READER_URL, centerQr: false }),
      RangeError,
    );
    const withoutQ = encode('mismatch-b', { version: 1, eccLevel: 'M' });
    assert.throws(
      () => buildScene(withoutQ, { palette: PALETTE, qrText: TL_READER_URL, centerQr: true }),
      RangeError,
    );
  });
});
