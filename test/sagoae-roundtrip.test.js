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
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import { TL_READER_URL } from '../src/qr.js';

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
  // ⚠ **의도적 갱신 (T2 2026-08-30)** — 구 락 «encodeA sagoae×centerQr 던짐»·
  // «buildScene 불스아이 던짐» 은 정식 중앙 3종 개통으로 양성 단언이 됐다 (아래
  // ⑤~⑦ 왕복이 그 자리). 여기 남는 음성은 **3종 밖** 조합이다.
  //  · sagoae × centralV0 — v0 비컨 포즈 위 C2c 미실측 (encode·encodeA 공통).
  for (const fn of [encode, encodeA]) {
    assert.throws(
      () => fn(PAYLOAD, { sagoae: true, centralV0: true }),
      /centralV0.*미개통/,
      fn.name,
    );
  }
  //  · 큐브 계열 중앙 — 큐브가 슬롯 반경 3.5~4셀이라 3종에 없다 (renderKind 성질 잠금).
  const encoded = encode(PAYLOAD, { version: 1, eccLevel: 'M', sagoae: true });
  for (const blocked of ['cube-bullseye', 'central-cube-3tone']) {
    assert.throws(
      () => buildScene(encoded, { palette: PALETTE, finderPatternId: blocked }),
      /합성할 수 없는 중앙/,
      blocked,
    );
  }
  //  · CDQ (Type C 사괘 분해 × 중앙 QR) — 와이어 행 부재 (formatC 표 정본, T2 는
  //    와이어 불변 트랙이라 행을 만들지 않았다). 인코더 경계에서 명시 거절.
  assert.throws(
    () => encode(PAYLOAD, { notchC: true, version: 0, sagoae: true, centerQr: true }),
    /CDQ/,
  );
});

/*
 * ── T2 (2026-08-30, PM/028 §4) — 사괘 × 정식 중앙 3종 합성 ──────────────────
 *
 * 구 락 «정식 중앙(불스아이·TL·QR) 합성은 검증기 확장 대기» 의 양성 전환.
 * 와이어 불변: V*D/A*D 는 레거시 Q 오프셋(O +4 · A +2)을 그대로 받고, 회계는
 * 디코더의 C2c 검증(sagoaeVerified 스탬프)이 연다. 가설 id 의 `-sagoae` 접미가
 * «원자 daehan 경로가 아니라 분해 검증이 이겼다» 는 표식이다.
 */
const REGULAR_CENTRAL_CASES = Object.freeze([
  Object.freeze({
    label: 'bullseye',
    encodeExtra: Object.freeze({}),
    sceneOpts: () => ({ finderPatternId: 'bullseye' }),
  }),
  Object.freeze({
    label: 'TL',
    encodeExtra: Object.freeze({ centralN7: true }),
    sceneOpts: (family) => ({
      finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
      centralN7Family: family,
    }),
  }),
  Object.freeze({
    label: 'QR',
    encodeExtra: Object.freeze({ centerQr: true }),
    sceneOpts: () => ({ qrText: TL_READER_URL }),
  }),
]);

function regularCentralRaster(encoded, sceneOpts, pixelsPerUnit, margin) {
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin,
    ...sceneOpts,
  });
  assert.equal(scene.sagoae, true, '합성 장면이 sagoae 를 공표하지 않는다');
  return rasterize(scene, { pixelsPerUnit, supersample: 1 });
}

for (const central of REGULAR_CENTRAL_CASES) {
  for (const version of [2, 3]) {
    test(`⑤ 정식 중앙 합성 왕복 O${version} × ${central.label}`, () => {
      const text = `O${version}-${central.label}`;
      const plain = encode(text, { version, eccLevel: 'M', ...central.encodeExtra });
      const encoded = encode(text, {
        version, eccLevel: 'M', sagoae: true, ...central.encodeExtra,
      });
      // 와이어 공유 — 정식 중앙 병용에서도 새 포맷 값이 없다 (Q 오프셋 포함).
      assert.deepEqual(encoded.formatDigits, plain.formatDigits,
        'sagoae 병용이 포맷 값을 바꿨다 — 와이어 불변 위반');
      const raster = regularCentralRaster(encoded, central.sceneOpts('hex'), 12, 20);
      const result = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
      assert.equal(result.ok, true, `${text}: ${result.reason}`);
      assert.equal(result.text, text);
      // 승자는 C2c 분해 쌍(`-sagoae`) **또는** 원자 daehan 템플릿 후보다 — 둘 다
      // 같은 daehan 회계를 열고 판정은 RS/CRC 몫이다 (레인 T2 실측: 포즈 정밀도에
      // 따라 승자가 갈린다 — QR/TL 은 대체로 쌍, 불스아이는 대체로 원자 템플릿).
      // «사괘 회계가 아닌 경로가 이겼다» 만 오수용이다.
      assert.match(result.hypothesis.id, /-sagoae|oak-daehan/,
        `${text}: daehan 회계 가설이 아니라 다른 경로가 이겼다 — ${result.hypothesis.id}`);
    });
  }
}

for (const central of REGULAR_CENTRAL_CASES) {
  test(`⑥ 턴A(V) 합성 왕복 V1 × ${central.label}`, () => {
    const text = `V1-${central.label}`;
    const encoded = encodeA(text, {
      version: 1, eccLevel: 'M', turnA: true, sagoae: true, ...central.encodeExtra,
    });
    const raster = regularCentralRaster(encoded, central.sceneOpts('tri'), 12, 20);
    const result = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
    assert.equal(result.ok, true, `${text}: ${result.reason}`);
    assert.equal(result.text, text);
    assert.equal(result.hypothesis.turn, true, `${text}: 턴A 가설이 아니다`);
    // ⑤ 와 같은 규칙 — 분해 쌍이든 원자 템플릿이든 daehan 회계 승자면 합격.
    assert.match(result.hypothesis.id, /-sagoae|oak-daehan/, `${text}: ${result.hypothesis.id}`);
  });
}

test('⑦ Type C — C*D(사괘 분해) × 중앙 TL 왕복 (와이어는 C*D 행 그대로)', {
  timeout: 600_000,
}, () => {
  const text = 'C0D-TL-사괘';
  const encoded = encode(text, {
    notchC: true, version: 0, sagoae: true, centralN7: true,
  });
  assert.equal(encoded.sagoae, true);
  assert.equal(encoded.centralN7, true);
  assert.equal(encoded.capacity.name, 'C0D', 'C 사괘 분해가 C*D 행을 안 탔다');
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: 20,
    finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
    centralN7Family: 'hex',
  });
  assert.equal(scene.sagoae, true);
  const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
  // C*D 는 회계가 와이어(포맷 인덱스 1)에 실려 있어 C2c 옵트인이 없어도 돌아와야
  // 한다 — 분해는 렌더 층 합성이고 판별은 RS/CRC 다.
  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, `${text}: ${result.reason}`);
  assert.equal(result.text, text);
  assert.equal(result.versionName, 'C0D');
});

for (const central of REGULAR_CENTRAL_CASES) {
  test(`⑧ 오수용 대조군 — 사괘 없는 O2 × ${central.label} 프레임에서 사괘 가설이 못 이긴다`, () => {
    const text = `plain-O2-${central.label}`;
    const encoded = encode(text, { version: 2, eccLevel: 'M', ...central.encodeExtra });
    const scene = buildScene(encoded, {
      palette: PALETTE, margin: 20, ...central.sceneOpts('hex'),
    });
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
    // 옵트인을 켠 채 잰다 — «추가 가설이 죽는» 게 아니라 «RS/CRC 에서 못 이김» 이
    // 계약이다. 원문이 그대로 오고 이긴 가설에 사괘 표식이 없어야 한다.
    const result = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
    assert.equal(result.ok, true, `${text}: ${result.reason}`);
    assert.equal(result.text, text);
    assert.doesNotMatch(result.hypothesis.id, /-sagoae|oak-daehan/,
      `${text}: 사괘 없는 프레임을 daehan 회계 가설이 이겼다 — 오수용`);
  });
}
