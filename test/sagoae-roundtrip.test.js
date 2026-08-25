/**
 * sagoae-roundtrip.test.js — 내곽 자리 sagoae 의 생성측 합성 + C2c 왕복.
 *
 * 구 락은 «상태값은 있으나 생성측 합성 렌더가 없어 ready:false»였다. 이 파일은
 * 그 음성 락을 다음 양성 계약으로 뒤집는다.
 *   ① sagoae 는 기존 daehan 예약 레이아웃/formatIndex 를 공유한다.
 *   ② scene 은 선택된 중앙 cell-mask 를 유지한 채 불스아이 밖 고리만 합성한다.
 *   ③ encode → scene → rasterize → decodeFrontend 가 O/A 전 버전 × ECC × 해상도에서
 *      원문까지 돌아온다. 디코더 게이트(cellFinderDaehan)는 기존 C2c 계약 그대로다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCellFinders } from '../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { daehanPatternId, sagoaeCells } from '../src/finder-daehan.js';
import { FINDER_CELL_MASK_PATTERNS } from '../src/finder-patterns.js';
import {
  OAK_FINDER_PATTERNS, OAK_RENDER_ONLY_FINDER_PATTERNS,
} from '../src/finder-oak-patterns.js';

const preset = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: preset.background,
  levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

const CENTRAL_TAEGEUK = 'oak-taegeuk-solo';
// 원자 daehan 과 시각적으로 같지 않은 중앙을 써야 왕복이 정말 «중앙 ∥ 고리»
// 분해를 통과했음을 안다. taegeuk 조합은 아래 픽셀 동일성 테스트가 따로 잠근다.
const CENTRAL_FOR_DECOMPOSED_ROUNDTRIP = 'oak-aspirin';
// 원자 daehan 패턴을 일부러 뺀 중앙 검출 명부. 여기서 찾은 중앙 증거를
// decodeFrontend 에 넘기면 성공 경로는 반드시 C2c `*-sagoae` 가설이다.
const LINEUP_NO_ATOMIC = Object.freeze([
  ...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, ...OAK_RENDER_ONLY_FINDER_PATTERNS,
]);
const PAYLOAD = 'SAGOAE'; // V1D/H 7 B 한계에도 정확히 들어간다.
const ECC_LEVELS = Object.freeze(['L', 'M', 'H']);
const RESOLUTIONS = Object.freeze([12, 24]);

const TYPE_CASES = Object.freeze([
  Object.freeze({
    type: 'O', versions: Object.freeze([1, 2, 3]),
    encode: (text, options) => encode(text, options), margin: undefined,
  }),
  Object.freeze({
    type: 'A', versions: Object.freeze([0, 1, 2]),
    encode: (text, options) => encodeA(text, options), margin: 20,
  }),
]);

function rasterOf(encoded, finderPatternId, pixelsPerUnit = 12, margin) {
  const scene = buildScene(encoded, {
    palette: PALETTE,
    finderPatternId,
    ...(margin === undefined ? {} : { margin }),
  });
  return {
    scene,
    raster: rasterize(scene, { pixelsPerUnit, supersample: 1 }),
  };
}

function pixelHash(raster) {
  return createHash('sha256').update(Buffer.from(raster.pixels.buffer)).digest('hex');
}

function decomposedCentralEvidence(raster) {
  const luma = toRelativeLuminance(raster, {});
  const detected = detectCellFinders(luma, LINEUP_NO_ATOMIC, {
    centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }],
  });
  assert.equal(detected.ok, true, '합성 장면에서 중앙 cell-mask 를 못 찾았다');
  const finder = detected.candidates.find(
    (candidate) => candidate.patternId === CENTRAL_FOR_DECOMPOSED_ROUNDTRIP,
  );
  assert.ok(finder, '원자 제외 명부에서 선택 중앙 파인더 증거가 없다');
  return finder;
}

test('① 와이어 공유 — 새 formatIndex 없이 daehan 예약 회계만 재사용한다', () => {
  for (const row of TYPE_CASES) {
    for (const version of row.versions) {
      for (const eccLevel of ECC_LEVELS) {
        const plain = row.encode(PAYLOAD, { version, eccLevel });
        const sagoae = row.encode(PAYLOAD, { version, eccLevel, sagoae: true });
        assert.equal(sagoae.sagoae, true, `${row.type}${version}/${eccLevel}`);
        assert.equal(sagoae.daehanFinder, true, '후단 예약 회계 신호가 열리지 않았다');
        assert.deepEqual(sagoae.formatDigits, plain.formatDigits,
          `${row.type}${version}/${eccLevel}: sagoae 가 새 포맷 값을 만들었다`);
        for (const cell of sagoaeCells(sagoae.k)) {
          assert.equal(sagoae.cellDigits.has(`${cell.q},${cell.r}`), false,
            `${row.type}${version}/${eccLevel}: 예약 셀이 데이터에 남았다`);
        }
      }
    }
  }
});

test('② 합성 렌더 — taegeuk + sagoae 픽셀은 기존 원자 daehan 과 동일하다', () => {
  for (const row of TYPE_CASES) {
    for (const version of row.versions) {
      const split = row.encode(PAYLOAD, { version, eccLevel: 'M', sagoae: true });
      const atomic = row.encode(PAYLOAD, { version, eccLevel: 'M', daehanFinder: true });
      assert.deepEqual(split.cellDigits, atomic.cellDigits,
        `${row.type}${version}: 같은 예약 회계의 본문이 갈렸다`);
      const splitRender = rasterOf(split, CENTRAL_TAEGEUK, 12, row.margin);
      const atomicRender = rasterOf(atomic, daehanPatternId(atomic.k), 12, row.margin);
      assert.equal(splitRender.scene.sagoae, true);
      assert.equal(splitRender.scene.finderPatternId, CENTRAL_TAEGEUK,
        'sagoae 가 선택된 중앙 파인더를 원자 daehan 으로 강제했다');
      assert.equal(pixelHash(splitRender.raster), pixelHash(atomicRender.raster),
        `${row.type}${version}: 분해 합성 픽셀이 원자 daehan 과 다르다`);
    }
  }
});

for (const row of TYPE_CASES) {
  for (const version of row.versions) {
    for (const eccLevel of ECC_LEVELS) {
      for (const pixelsPerUnit of RESOLUTIONS) {
        test(`③ C2c 원문 왕복 ${row.type}${version}/${eccLevel} ppu=${pixelsPerUnit}`, () => {
          const encoded = row.encode(PAYLOAD, { version, eccLevel, sagoae: true });
          const { raster } = rasterOf(
            encoded, CENTRAL_FOR_DECOMPOSED_ROUNDTRIP, pixelsPerUnit, row.margin,
          );
          const central = decomposedCentralEvidence(raster);
          const result = decodeFrontend(raster, {
            familyEvidence: { finders: [central] },
            bootstrap: { cellFinderDaehan: true },
          });
          assert.equal(result.ok, true,
            `${row.type}${version}/${eccLevel}/ppu${pixelsPerUnit}: ${result.reason}`);
          assert.equal(result.text, PAYLOAD);
          assert.match(result.hypothesis.id, /-sagoae$/,
            '원자 daehan 경로가 분해 합성 C2c 검증을 대신했다');
          assert.equal(result.diagnostics.format.formatIndex,
            row.type === 'O' ? version - 1 : encoded.formatIndex,
            '공유 formatIndex 가 다른 값으로 소비됐다');
        });
      }
    }
  }
}

test('④ 잘못된 조합은 조용히 일반 코드나 중복 고리로 강등되지 않는다', () => {
  assert.throws(
    () => encode(PAYLOAD, { sagoae: true, daehanFinder: true }),
    /원자 daehan 이 sagoae 를 이미 포함/,
  );
  assert.throws(
    () => encodeA(PAYLOAD, { sagoae: true, centerQr: true }),
    /검출 합성 미지원 조합/,
  );
  const encoded = encode(PAYLOAD, { version: 1, eccLevel: 'M', sagoae: true });
  assert.throws(
    () => buildScene(encoded, { palette: PALETTE, finderPatternId: 'bullseye' }),
    /독립 중앙 cell-mask/,
  );
});
