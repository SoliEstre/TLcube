/**
 * typeC-frontend.test.js — Type C의 raster → 프런트엔드 복호 계약.
 *
 * C0/C0D는 formatIndex만으로는 같은 k의 wire를 가를 수 없고, 노치 8셀은 데이터가
 * 아니라 배경이다. 이 파일은 생성측 자체검증(typeC-roundtrip) 다음 경계에서 그 두
 * 사실이 실제 scan·CRC·RS 수락까지 닫히는지 잰다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { decodeCellsC } from '../src/decoder/decode-c.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { daehanPatternId, daehanReservedCells } from '../src/finder-daehan.js';
import { dataCellsInScanOrder } from '../src/layout.js';
import {
  BULLSEYE_DARK,
  BULLSEYE_LIGHT,
  DEFAULT_PRESET,
  getPreset,
} from '../src/luminance.js';
import { notchCellCountC, typeCReservedCells } from '../src/notchC.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { distortImage } from './harness/distort.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

function bodyDigits(encoded) {
  const reserved = typeCReservedCells(
    encoded.k,
    encoded.daehanFinder ? daehanReservedCells(encoded.k) : undefined,
  );
  return Uint8Array.from(dataCellsInScanOrder(encoded.k, reserved).map((cell) => {
    const entry = encoded.cellDigits.get(cell.q + ',' + cell.r);
    assert.ok(entry, 'Type C scan 셀에 digit가 없다: ' + cell.q + ',' + cell.r);
    return entry.digit;
  }));
}

function renderTypeC(text, options = {}) {
  const encoded = encode(text, {
    notchC: true,
    version: 0,
    eccLevel: options.eccLevel || 'M',
    ...(options.daehanFinder ? { daehanFinder: true } : {}),
    ...(options.sagoae ? { sagoae: true } : {}),
  });
  const finderPatternId = encoded.daehanFinder
    ? (options.sagoae ? 'oak-taegeuk-solo' : daehanPatternId(encoded.k))
    : 'bullseye';
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: 20,
    finderPatternId,
  });
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
  return { encoded, raster };
}

function assertDecoded(result, text, name) {
  assert.equal(result.ok, true, name + ': ' + JSON.stringify(result));
  assert.equal(result.text, text, name);
  assert.equal(result.family, 'hex', name);
  assert.equal(result.version, 0, name);
  assert.equal(result.hypothesis.k, 14, name);
  assert.equal(result.hypothesis.notchC, true, name);
  assert.equal(result.hypothesis.notchHint.sampled, notchCellCountC(result.hypothesis.k), name);
  assert.equal(result.hypothesis.notchHint.background, notchCellCountC(result.hypothesis.k), name);
  assert.equal(result.hypothesis.notchHint.foreground, 0, name);
  assert.ok(result.hypothesis.notchHint.backgroundRate >= 0.75, name);
  assert.equal(result.crsDistance, 2 * result.corrected, name);
}

function assertClassificationBoundary(result, name) {
  const dimensions = result.diagnostics.bootstrap.geometry.capacityDimensions;
  for (const ck of [14, 16, 18, 20]) {
    assert.ok(dimensions.hex.includes(ck), name + `: C 사다리 k=${ck}가 hex 프로필에 없다`);
  }
  const shared = dimensions.hex.filter((k) => dimensions.tri.includes(k));
  assert.deepEqual(shared, [6, 8, 10], name + ': C k가 공유 1패스 축에 섞였다');
}

test('C0 본문은 (formatIndex,k) 표 조회로 직접 복호된다', () => {
  for (const eccLevel of ['L', 'M', 'H']) {
    const text = 'C0-' + eccLevel + '-프런트';
    const { encoded } = renderTypeC(text, { eccLevel });
    const decoded = decodeCellsC(bodyDigits(encoded), {
      type: 'C',
      k: encoded.k,
      formatIndex: encoded.capacity.formatIndex,
      eccLevel,
    });
    assert.equal(decoded.ok, true, eccLevel + ': ' + decoded.reason);
    assert.equal(decoded.text, text, eccLevel);
  }
});

test('C0 × ECC L/M/H: raster가 노치 힌트와 CRC·RS를 거쳐 원문으로 돌아온다', {
  timeout: 180_000,
}, () => {
  for (const eccLevel of ['L', 'M', 'H']) {
    const text = 'C0-' + eccLevel + '-프런트';
    const { raster } = renderTypeC(text, { eccLevel });
    const result = decodeFrontend(raster);
    assertDecoded(result, text, 'C0/' + eccLevel);
    assertClassificationBoundary(result, 'C0/' + eccLevel);
    assert.equal(result.diagnostics.format.formatIndex, 0, 'C0/' + eccLevel);
  }
});

test('C0D × M: 원자 daehan·분해 sagoae가 3방향 daehan 후보 경로에서 원문으로 돌아온다', {
  timeout: 240_000,
}, () => {
  for (const variant of [
    { label: 'atomic', daehanFinder: true },
    { label: 'split', sagoae: true },
  ]) {
    const text = 'C0D-' + variant.label + '-프런트';
    const { raster } = renderTypeC(text, variant);
    for (const rotation of [0, 120, 240]) {
      const result = decodeFrontend(distortImage(raster, { rotation, fill: FILL }), {
        bootstrap: { cellFinderDaehan: true },
      });
      const name = 'C0D/' + variant.label + '/rotation=' + rotation;
      assertDecoded(result, text, name);
      assert.equal(result.diagnostics.format.formatIndex, 1, name);
      assert.equal(result.versionName, 'C0D', name);
      assert.equal(result.hypothesis.orientation, rotation / 120, name);
      assert.equal(result.hypothesis.notchHint.orientation, rotation / 120, name);
    }
  }
});

test('C0D 기본 탐색과 daehan 재시도는 별개다', {
  timeout: 180_000,
}, () => {
  for (const variant of [
    { label: 'atomic', daehanFinder: true },
    { label: 'split', sagoae: true },
  ]) {
    const text = 'C0D-fallback-' + variant.label;
    const { raster } = renderTypeC(text, variant);
    const defaultResult = decodeFrontend(raster);
    const daehanResult = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
    assertDecoded(daehanResult, text, 'C0D/' + variant.label + '/daehan 재시도');
    // 이 단언은 기본 경로가 daehan finder를 무단으로 넓히지 않는 기존 scanner 비용
    // 계약도 함께 고정한다. 실제 C0D 수락은 두 번째 결과의 CRC·RS가 담당한다.
    assert.equal(defaultResult.ok, false,
      'C0D/' + variant.label + '가 기본 탐색만으로 읽혀 폴백 경계가 사라졌다');
    assert.equal(defaultResult.reason, 'frontend:no-format-candidate',
      'C0D/' + variant.label + ' 기본 실패 사유가 스캐너 폴백 계약과 다르다');
  }
});

test('C0/M은 0·120·240도 회전에서도 노치 방향 힌트 뒤에 원문으로 돌아온다', {
  timeout: 240_000,
}, () => {
  const text = 'C0-rotation-프런트';
  const { raster } = renderTypeC(text, { eccLevel: 'M' });
  for (const rotation of [0, 120, 240]) {
    const result = decodeFrontend(distortImage(raster, { rotation, fill: FILL }));
    const name = 'C0/rotation=' + rotation;
    assertDecoded(result, text, name);
    assert.equal(result.hypothesis.orientation, rotation / 120, name);
    assert.equal(result.hypothesis.notchHint.orientation, rotation / 120, name);
  }
});

// **의도적 갱신 (2026-08-30, 리허설 머지)** — 구 자는 «C1/C2 는 다중 블록 미정의
// 사유를 보존한다» 였다. 레인 typec-rs 가 그 규약을 신설해 사유 자체가 소멸했고
// (TYPE_C_RS_BLOCK_UNDEFINED_REASON 수출 제거), C1/C2 의 **양성 왕복**은
// test/typeC-cross.test.js 가 잠근다. 빈 셀 입력의 방어는 아래 성질로 남긴다.
test('C1/C2 도 이제 열려 있다 — 빈 입력은 사유 있는 실패지 로드 사망이 아니다', () => {
  for (const [k, formatIndex] of [
    [17, 0], [20, 0], [17, 1], [20, 1],
  ]) {
    const result = decodeCellsC([], {
      type: 'C',
      k,
      formatIndex,
      eccLevel: 'M',
    });
    assert.equal(result.ok, false, 'k=' + k + ', format=' + formatIndex
      + ' — 빈 셀 입력이 성공으로 둔갑하면 안 된다');
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0, '실패 사유가 비어 있다');
  }
});
