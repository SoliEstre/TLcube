import test from 'node:test';
import assert from 'node:assert/strict';

import { VERSIONS, capacityFor } from '../src/capacity.js';
import {
  CELL_SURFACE_FINAL_V0, CENTRAL_V0_SOURCE_N, centralV0FinderCells,
  capacityForCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import { encode } from '../src/encode.js';
import { CENTRAL_V0_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import { FACES } from '../src/hexgrid.js';
import { DIGIT_COUNT, ECC_LEVEL, encode as encodeFormat } from '../src/formatinfo.js';
import { markerGSpec } from '../src/markerG.js';
import { buildScene } from '../src/scene.js';
import { encodeY } from '../src/encodeY.js';
import { versionForFinalN } from '../src/cellSurfaceFinal.js';
import {
  BEACON_MAGIC,
  BEACON_ECC_LEVEL, BEACON_FLAG_NAMES, BEACON_PAYLOAD_BYTES, BEACON_RESERVED_BYTES,
  BEACON_SCHEMA_VERSION, BEACON_TONES, BEACON_USED_BYTES,
  encodeCentralBeacon, familyAlphabet, familyIndex,
  finderIdentityIds, finderIndex, packBeaconBytes, packBeaconText,
  readBeaconFromEncodedY, unpackBeaconText,
} from '../src/centralBeacon.js';

const PALETTE = Object.freeze({
  background: Object.freeze({ r: 3, g: 7, b: 11 }),
  levels: Object.freeze([
    Object.freeze({ r: 24, g: 36, b: 52 }),
    Object.freeze({ r: 92, g: 118, b: 151 }),
    Object.freeze({ r: 182, g: 204, b: 228 }),
  ]),
  bullseyeDark: Object.freeze({ r: 0, g: 0, b: 0 }),
  bullseyeLight: Object.freeze({ r: 255, g: 255, b: 255 }),
});

function sceneFor(encoded) {
  return buildScene(encoded, {
    palette: PALETTE,
    finderPatternId: CENTRAL_V0_FINDER_PATTERN_ID,
  });
}

test('바닥이 깔렸다 — 칠해지는 모듈 위치는 정본 n² 전부 (locator 30이 아니다)', () => {
  const n = CENTRAL_V0_SOURCE_N;
  const locatorCount = centralV0FinderCells().length;
  assert.notEqual(locatorCount, n * n,
    '이 단언은 locator 만 칠하던 옛 계약이 아직 같으면 공허하다');

  const encoded = encode('beacon-floor', { version: 2, eccLevel: 'M', centralV0: true });
  const scene = sceneFor(encoded);
  // 앞의 FACES.length 개는 분리 띠(슬롯 배경) — 2026-08-22 비컨 2차.
  const finderShapes = scene.shapes.slice(
    encoded.cellDigits.size * FACES.length + FACES.length);
  const painted = new Set();
  for (let s = 0; s < finderShapes.length; s += FACES.length) {
    painted.add(Math.floor(s / FACES.length));
  }
  assert.equal(finderShapes.length, n * n * FACES.length);
  assert.equal(painted.size, n * n);
  assert.notEqual(painted.size, locatorCount);
});

test('팔레트 잠금 — 비컨 렌더 색이 palette.bullseyeLight 와 같지 않다', () => {
  const encoded = encode('beacon-palette', { version: 2, eccLevel: 'M', centralV0: true });
  const scene = sceneFor(encoded);
  const tail = scene.shapes.slice(encoded.cellDigits.size * FACES.length);
  // 분리 띠는 배경색이고(순백 아님), 비컨 면은 levels 만 쓴다.
  for (const cover of tail.slice(0, FACES.length)) {
    assert.strictEqual(cover.color, PALETTE.background);
    assert.notDeepEqual(cover.color, PALETTE.bullseyeLight);
  }
  const finderShapes = tail.slice(FACES.length);
  assert.ok(finderShapes.length > 0);
  for (const shape of finderShapes) {
    assert.notDeepEqual(shape.color, PALETTE.bullseyeLight);
    assert.ok(PALETTE.levels.includes(shape.color));
  }
});

test('회계 무회귀 — 바깥 k·dataDigits.length 가 불스아이판과 같다 (V2·M 값)', () => {
  const spec = VERSIONS.find((row) => row.version === 2);
  const capacity = capacityFor(spec, 'M');
  const bullseye = encode('x', { version: spec.version, eccLevel: 'M' });
  const central = encode('x', { version: spec.version, eccLevel: 'M', centralV0: true });
  assert.equal(central.k, bullseye.k);
  assert.equal(central.dataDigits.length, bullseye.dataDigits.length);
  assert.equal(central.k, spec.k);
  assert.equal(central.dataDigits.length, capacity.usedSymbols * 3);
  assert.equal(central.k, 8);
  assert.equal(central.dataDigits.length, 168);
  assert.deepEqual(central.formatDigits, bullseye.formatDigits);
});

test('왕복 — 비컨 페이로드를 넣고 인코딩한 뒤 cellDigits 에서 같은 메타데이터가 나온다', () => {
  const encoded = encode('roundtrip', {
    version: 2, eccLevel: 'M', centralV0: true, cornerMarker: true, markerTones: true,
  });
  const beacon = encodeCentralBeacon(encoded, CENTRAL_V0_FINDER_PATTERN_ID);
  assert.equal(beacon.n, CENTRAL_V0_SOURCE_N);
  assert.equal(beacon.cellDigits.size, CENTRAL_V0_SOURCE_N * CENTRAL_V0_SOURCE_N);
  assert.equal(beacon.eccLevel, BEACON_ECC_LEVEL);
  assert.equal(beacon.tones, BEACON_TONES);
  assert.equal(beacon.cellSurfaceLayout, CELL_SURFACE_FINAL_V0);

  const meta = readBeaconFromEncodedY(beacon);
  assert.equal(meta.schemaVersion, BEACON_SCHEMA_VERSION);
  assert.equal(meta.family, 'G');
  assert.equal(meta.finderPatternId, CENTRAL_V0_FINDER_PATTERN_ID);
  assert.equal(meta.cornerMarker, true);
  assert.equal(meta.markerTones, true);
  assert.equal(meta.daehanFinder, false);
  assert.deepEqual(meta.formatDigits, encoded.formatDigits.slice(0, DIGIT_COUNT));

  const versionIndex = markerGSpec('hex', encoded.version).formatIndex;
  assert.deepEqual(
    meta.formatDigits,
    encodeFormat({ version: versionIndex, eccLevel: ECC_LEVEL[encoded.eccLevel] }),
    '포맷 워드는 formatinfo.encode 결과 그대로여야 한다',
  );
});

test('왕복 — Type O 불스아이 대체 경로의 포맷 워드도 formatinfo.encode 정본이다', () => {
  const encoded = encode('roundtrip-o', { version: 2, eccLevel: 'M', centralV0: true });
  const meta = readBeaconFromEncodedY(
    encodeCentralBeacon(encoded, CENTRAL_V0_FINDER_PATTERN_ID),
  );
  assert.equal(meta.family, 'O');
  assert.equal(meta.cornerMarker, false);
  const versionIndex = (encoded.version - 1) + (encoded.centerQr ? 4 : 0);
  assert.deepEqual(
    meta.formatDigits,
    encodeFormat({ version: versionIndex, eccLevel: ECC_LEVEL[encoded.eccLevel] }),
  );
});

test('인덱스는 정본 표에서 유도한다 — 손 enum 이 아니다', () => {
  const families = familyAlphabet();
  assert.ok(families.includes('O'));
  assert.ok(families.includes('G'));
  assert.ok(families.includes('Y'));
  assert.equal(familyIndex('O'), families.indexOf('O'));
  assert.equal(familyIndex('G'), families.indexOf('G'));

  const finderIds = finderIdentityIds();
  assert.equal(
    finderIndex(CENTRAL_V0_FINDER_PATTERN_ID),
    finderIds.indexOf(CENTRAL_V0_FINDER_PATTERN_ID),
  );
  assert.equal(BEACON_FLAG_NAMES[0], 'cornerMarker');
  assert.equal(BEACON_ECC_LEVEL, 'H');

  const cap = capacityForCellSurfaceFinal(
    CENTRAL_V0_SOURCE_N, BEACON_ECC_LEVEL, BEACON_TONES, CELL_SURFACE_FINAL_V0,
  );
  assert.equal(BEACON_PAYLOAD_BYTES, cap.maxPayloadBytes);
  assert.equal(BEACON_USED_BYTES + BEACON_RESERVED_BYTES, BEACON_PAYLOAD_BYTES);
  assert.ok(BEACON_RESERVED_BYTES > 0);
  const packed = packBeaconBytes({
    family: 'O',
    formatDigits: encodeFormat({ version: 1, eccLevel: ECC_LEVEL.M }),
    finderPatternId: CENTRAL_V0_FINDER_PATTERN_ID,
    cornerMarker: false,
    markerTones: false,
    daehanFinder: false,
  });
  assert.equal(packed.length, BEACON_PAYLOAD_BYTES);
  assert.equal(packBeaconText({
    family: 'O',
    formatDigits: packed.slice(2, 2 + DIGIT_COUNT),
    finderPatternId: CENTRAL_V0_FINDER_PATTERN_ID,
  }).length, BEACON_PAYLOAD_BYTES);
  let reserved = 0;
  for (let i = packed.length - 1; i >= 0; i -= 1) {
    if (packed[i] !== 0) break;
    reserved += 1;
  }
  assert.ok(reserved >= 1, '예약 바이트가 없다');
  const round = unpackBeaconText(String.fromCharCode(...packed));
  assert.equal(round.schemaVersion, BEACON_SCHEMA_VERSION);
  assert.equal(round.family, 'O');
});

// ─────────────────────────────────────────────────────────────────────────────
// 「나는 페이로드가 아니다」 — 계약서 §4.1
//
// 비컨은 **문법적으로 완전한** Type Y v0 코드다. 구분자가 없으면 스캐너가 중앙
// 블록만 잡았을 때 그걸 독립 코드로 복호해 **성공하고**, 메타데이터 바이트를
// 사용자에게 「내용」으로 보여준다. 스캔은 성공하고 내용만 틀린다 — 조용한 오작동.
// 그래서 이 두 검사는 «있으면 좋은 것» 이 아니라 **결함 방지**다.
// ─────────────────────────────────────────────────────────────────────────────

test('구분자 — 같은 v0 판에 실린 보통 사용자 텍스트를 비컨으로 읽지 않는다', () => {
  // 비컨과 **완전히 같은** 형태(n·레이아웃·ECC·톤)로 사용자 텍스트를 인코딩한다.
  // 다른 것은 페이로드뿐이다 — 그래야 매직만이 둘을 가른다는 것이 증명된다.
  const standalone = encodeY('https://tl.estre.so/', {
    version: versionForFinalN(CENTRAL_V0_SOURCE_N),
    eccLevel: BEACON_ECC_LEVEL,
    tones: BEACON_TONES,
    cellSurfaceLayout: CELL_SURFACE_FINAL_V0,
  });
  assert.throws(
    () => readBeaconFromEncodedY(standalone),
    /비컨 매직이 아니다/,
    '독립 코드를 비컨으로 읽으면 사용자에게 바깥 URL 대신 메타데이터가 뜬다',
  );

  // 대조군: 같은 경로로 만든 진짜 비컨은 읽힌다 (위 검사가 «항상 던진다» 가 아님).
  const encoded = encode('discriminator', { version: 2, eccLevel: 'M', centralV0: true });
  const beacon = encodeCentralBeacon(encoded, CENTRAL_V0_FINDER_PATTERN_ID);
  assert.equal(readBeaconFromEncodedY(beacon).schemaVersion, BEACON_SCHEMA_VERSION);
});

test('구분자 — 매직은 생성기 페이로드 경로가 만들 수 없는 제어문자다', () => {
  assert.ok(BEACON_MAGIC.length >= 2, '1바이트 매직은 우연 일치가 너무 흔하다');
  for (const b of BEACON_MAGIC) {
    // ASCII 7bit 안이어야 한다 (packBeaconText 가 String.fromCharCode 로 만든다).
    assert.ok(b >= 0 && b <= 0x7f, `매직 바이트가 ASCII 7bit 밖이다: ${b}`);
    // 그리고 인쇄 가능 문자가 아니어야 한다 — URL·텍스트·Wi-Fi·vCard 는 전부
    // 인쇄 가능 문자로 시작한다. 여기에 'T' 같은 글자를 쓰면 「TL…」로 시작하는
    // 사용자 텍스트가 매직을 통과한다.
    assert.ok(b < 0x20, `매직 바이트가 인쇄 가능 문자다: ${b} — 사용자 텍스트와 겹친다`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 비컨 2차 (운영자 지시 2026-08-22) — 3톤 입체감 · 스캐너 가드 배선
// ─────────────────────────────────────────────────────────────────────────────

test('3톤 — 비컨 면 색이 palette.levels 세 값을 전부 쓴다 (평평한 2톤 회귀 방지)', () => {
  const encoded = encode('beacon-3tone', { version: 2, eccLevel: 'M', centralV0: true });
  const scene = sceneFor(encoded);
  const beaconShapes = scene.shapes.slice(
    encoded.cellDigits.size * FACES.length + FACES.length);
  const used = new Set(beaconShapes.map((shape) => PALETTE.levels.indexOf(shape.color)));
  // 2톤(Y0)이면 중간 레벨(1)이 통째로 사라져 평평한 QR 처럼 보인다 — 실기기에서
  // 운영자가 지적한 «입체감 없음» 이 바로 그 상태였다. BEACON_TONES 를 확인하라.
  assert.deepEqual([...used].sort(), [0, 1, 2]);
});

test('스캐너 배선 — 표시 경로가 매직을 보고 비컨을 내용으로 보여주지 않는다', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');
  // 배선이 끊기면 비컨이 «빈 텍스트» 결과로 뜬다 (실기기 재현 2026-08-22 — 매직이
  // 제어문자라 화면에 아무것도 안 보이고, 스캔은 «성공» 한 것으로 끝난다).
  assert.match(src, /from '\/src\/centralBeaconWire\.js'/,
    '스캐너가 매직 표식 모듈을 안 문다');
  const handle = src.slice(
    src.indexOf('function handleDecodeResult'), src.indexOf('function startFrameLoop'));
  assert.match(handle, /textStartsWithBeaconMagic\(/,
    'handleDecodeResult 가 매직을 안 본다 — 비컨이 빈 텍스트로 표시된다');
  assert.match(handle, /status\.beaconOnly/, '카메라 경로의 비컨 안내가 없다');
  assert.match(handle, /status\.beaconPhoto/, '사진 경로의 비컨 안내가 없다');
});

test('스캐너 문구 — 비컨 안내 2키가 모든 언어에 있다 (하나만 빠져도 잡히게)', async () => {
  const { SCANNER_STRINGS } = await import('../sites/tlscan/strings.js');
  const langs = Object.keys(SCANNER_STRINGS);
  assert.ok(langs.length >= 8, '언어가 ' + langs.length + '개뿐이다 — 8언어 체계가 줄었다');
  for (const lang of langs) {
    for (const key of ['status.beaconOnly', 'status.beaconPhoto']) {
      assert.equal(typeof SCANNER_STRINGS[lang][key], 'string',
        lang + ' 에 ' + key + ' 가 없다 — 그 언어에서 안내가 키 이름 그대로 뜬다');
      assert.ok(SCANNER_STRINGS[lang][key].length > 0);
    }
  }
});
