/**
 * typeK-roundtrip.test.js — Type K(육각별) 픽셀 왕복 + 검출 판별 (브리프 ③).
 *
 * encode → buildScene(육각별) → rasterize → decodeFrontend 가 **원문까지** 돌아온다.
 * 검출 경로: family.scoreStarTiling(코어 + 두 계열 패치 + 균형) → star 분류 →
 * findKAnchorHypotheses(별 꼭짓점 6 — 5/0/0·1/1/1) → 포맷 7(star 축) → decode-k.
 *
 * ⚠ 게이트·문턱은 하나도 안 바꿨다 — star 는 «추가 가설 축» 이고 기존 hex/tri/cube
 * 평가는 K 오양성이 없는 한 비트 동일이다 (무회귀는 대조군 + 기존 스위트 + 코퍼스
 * A/B 가 잰다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeK } from '../src/encodeK.js';
import { encodeA } from '../src/encodeA.js';
import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { addQuietZone } from '../src/quietzone.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { familiesForBeaconMeta } from '../src/decoder/central-beacon-adapt.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { classifyFamily, scoreCubeTiling, scoreStarTiling } from '../src/decoder/family.js';
import { findKAnchorHypotheses } from '../src/decoder/anchor-detect.js';
import { VERSIONS_K } from '../src/capacityK.js';
import { VERSIONS_KCM } from '../src/markerK.js';
import { axialToPixel } from '../src/hexgrid.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const PPU = 12;

function renderK(text, version, options = {}) {
  const { qrText, finderPatternId, ...encodeOptions } = options;
  const encoded = encodeK(text, { version, eccLevel: 'M', ...encodeOptions });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: 20,
    ...(qrText === undefined ? {} : { qrText }),
    ...(finderPatternId === undefined ? {} : { finderPatternId }),
  });
  return {
    encoded,
    scene,
    raster: rasterize(scene, { pixelsPerUnit: PPU, supersample: 1 }),
  };
}

test('K 왕복 — K0/K1/K2 가 star 가설·포맷 7 로 원문까지 돌아온다', () => {
  for (const spec of VERSIONS_K) {
    const text = 'typeK-roundtrip-' + spec.name;
    const { raster } = renderK(text, spec.version);
    const result = decodeFrontend(raster);
    assert.equal(result.ok, true,
      spec.name + ' 왕복 실패: ' + (result.reason || '') + ' '
      + JSON.stringify(result.detail && result.detail.pipelineCode));
    assert.equal(result.text, text, spec.name + ': 원문이 다르다');
    assert.equal(result.family, 'star', spec.name + ': 패밀리가 star 가 아니다');
    assert.equal(result.version, spec.version, spec.name + ': 버전이 다르다');
    assert.equal(result.versionName, spec.name);
    assert.equal(result.hypothesis.k, spec.k);
    assert.equal(result.diagnostics.format.formatIndex, 7,
      spec.name + ': 소비된 formatIndex 가 star 축 표(7)와 다르다');
    // F-107 잠금 검사 — cube 독립 양성이 파인더 경로를 잠그면 K 는 재시도 안전망
    // 없이는 죽는다. 성공 프레임의 진단으로 «잠기지 않았다» 를 명시 단언한다.
    const cubeDiag = result.diagnostics.bootstrap.geometry.cube;
    assert.equal(cubeDiag.ok, false,
      spec.name + ': cube 경로가 K 실루엣에 양성으로 섰다 — F-107 함정이 K 에 열렸다. '
      + '재시도 안전망(retryFinderComparison)에 기대기 시작한 것이니 잠금 검사를 갱신하라');
  }
});

test('K 육망성 안전영역 왕복 — K0/K1/K2 원문 복호와 오목 실루엣이 함께 산다', () => {
  for (const spec of VERSIONS_K) {
    const text = 'typeK-quiet-roundtrip-' + spec.name;
    const encoded = encodeK(text, { version: spec.version, eccLevel: 'M' });
    const bare = buildScene(encoded, { palette: PALETTE, margin: 20 });
    const scene = addQuietZone(bare, {
      color: { r: 255, g: 255, b: 255 },
      margin: 2,
      selfQuietColors: [BULLSEYE_LIGHT, BULLSEYE_DARK],
    });
    const [quiet] = scene.shapes;
    let signed = 0;
    for (let i = 0, j = quiet.points.length - 1; i < quiet.points.length; j = i, i += 1) {
      signed += quiet.points[j].x * quiet.points[i].y - quiet.points[i].x * quiet.points[j].y;
    }
    const winding = signed > 0 ? 1 : -1;
    let reflex = 0;
    for (let i = 0; i < quiet.points.length; i += 1) {
      const a = quiet.points[(i - 1 + quiet.points.length) % quiet.points.length];
      const b = quiet.points[i];
      const c = quiet.points[(i + 1) % quiet.points.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross * winding < -1e-9) reflex += 1;
    }
    assert.equal(reflex, 6, spec.name + ': 안전영역이 육각형으로 되돌아갔다');

    const result = decodeFrontend(rasterize(scene, { pixelsPerUnit: PPU, supersample: 1 }));
    assert.equal(result.ok, true,
      spec.name + ' 안전영역 왕복 실패: ' + (result.reason || '') + ' '
      + JSON.stringify(result.detail && result.detail.pipelineCode));
    assert.equal(result.text, text, spec.name + ': 안전영역 뒤 원문이 다르다');
    assert.equal(result.family, 'star', spec.name + ': 안전영역 뒤 family가 star가 아니다');
  }
});

test('K 포즈 정합 — 비 bullseye 중앙 파인더도 K0/K1/K2 원문까지 돌아온다', () => {
  // 2026-08-25 POSE 회귀: 이 셋은 모두 중앙 파인더 H 자체는 있었지만 star 분류가
  // 3k 거리 패치에서 먼저 깨져, 정상 경로에 star 가설이 0개였다. 그 결과 수백 개
  // hex/tri 가설이 포맷 7을 한 번도 평가하지 못했다(formatProposalCount=0).
  // 각 계보(하이브리드 불스아이 / 3톤 큐브 / cell-mask)의 실측 실패 대표를 전 버전으로
  // 잠근다. finder 목록 전체의 변동 추적은 lane-out/pose-matrix.mjs가 카드 표에서 유도한다.
  const finderPatternIds = [
    'cube-bullseye',
    'central-cube-3tone',
    'pinwheel-3-0101-cw-missing-solid',
  ];
  for (const finderPatternId of finderPatternIds) {
    for (const spec of VERSIONS_K) {
      const text = 'K-pose-' + finderPatternId + '-' + spec.name;
      const encoded = encodeK(text, { version: spec.version, eccLevel: 'M' });
      const scene = buildScene(encoded, {
        palette: PALETTE,
        margin: 20,
        finderPatternId,
      });
      const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 1 });
      const result = decodeFrontend(raster);
      assert.equal(result.ok, true,
        finderPatternId + ' ' + spec.name + ' 왕복 실패: '
        + (result.reason || '') + ' ' + JSON.stringify(result.detail?.pipelineCode));
      assert.equal(result.text, text, finderPatternId + ' ' + spec.name + ': 원문이 다르다');
      assert.equal(result.family, 'star', finderPatternId + ' ' + spec.name + ': star가 아니다');
      assert.equal(result.version, spec.version,
        finderPatternId + ' ' + spec.name + ': 버전이 다르다');
    }
  }
});

// K-CM 은 **생성·후단 복호까지** 열려 있었고, 프론트엔드는 2026-08-25 에 반쯤 배선됐다.
//
// ## 벽이 어디로 옮겨갔나 (2026-08-25 실측)
//
// 배선한 것: `validVersionIndices` 가 star 축에서 formatIndex **8 을 함께 내놓고**
// (그전엔 7 뿐이라 포맷 단계에서 죽었다), 포맷 워드가 8 이면 `decodeFormat.cornerMarker`
// 를 켜며, 본문은 `dataCellsInScanOrderKMarker` 로 다시 뽑는다.
// 그 결과 **포맷 단계는 통과한다** (formatProposalCount 0 → 1).
//
// 처음에는 `layoutForHypothesis` 가 평 K 역할 맵을 쓰므로 재배치 레퍼런스가 디지트를
// 어긋나게 한다고 보았다. 그러나 같은 CM scan order로 인코더 `cellDigits`와 광학 grid를
// 전수 대조하니 **163/163 일치 · erasures 0**이었다. `decodeCellsK`도 실제로 성공했다.
// 진짜 벽은 그 다음이었다: `familyProfiles('star')`가 평 K 3행만 소유해 포맷 8의 성공
// 후보를 `profileForFormatCandidate`가 되찾지 못했고, 빈 후보가 접힌 `BODY_RS_FAILED`로
// 보고됐다. K-CM 3행을 star 소유 표에 넣어 그 마지막 승격 경로를 닫았다.
//
// 종전 음성 락은 지우지 않고 같은 자리에서 양성 왕복 락으로 뒤집는다 (배타 개설 정형 ③).
test('K-CM 왕복 — K0CM/K1CM/K2CM이 포맷 8과 CM scan order로 원문까지 돌아온다', () => {
  for (const spec of VERSIONS_KCM) {
    const text = 'K-CM-frontend-' + spec.name;
    const { encoded, raster } = renderK(text, spec.version, { cornerMarker: true });
    assert.equal(encoded.formatIndex, 8, spec.name + ': K-CM 와이어 값이 8 이 아니다');
    const result = decodeFrontend(raster);
    assert.equal(result.ok, true,
      spec.name + ' 왕복 실패: ' + (result.reason || '') + ' '
      + JSON.stringify(result.detail && result.detail.pipelineCode));
    assert.equal(result.text, text, spec.name + ': 원문이 다르다');
    assert.equal(result.family, 'star', spec.name + ': 패밀리가 star가 아니다');
    assert.equal(result.version, spec.version, spec.name + ': 버전이 다르다');
    assert.equal(result.versionName, spec.name, spec.name + ': 프로파일 이름이 다르다');
    assert.equal(result.hypothesis.k, spec.k, spec.name + ': 격자 크기가 다르다');
    assert.equal(result.diagnostics.format.formatIndex, 8,
      spec.name + ': 소비 formatIndex가 star 축 CM 값(8)과 다르다');
  }
});

test('K 중앙 QR 왕복 — 평/CM × 전 k × 전 ECC가 기존 와이어로 원문까지 돌아온다', () => {
  const profiles = [
    ...VERSIONS_K.map((spec) => ({ spec, cornerMarker: false })),
    ...VERSIONS_KCM.map((spec) => ({ spec, cornerMarker: true })),
  ];
  for (const { spec, cornerMarker } of profiles) {
    for (const eccLevel of ['L', 'M', 'H']) {
      const text = 'KQ-' + spec.name + '-' + eccLevel;
      const { encoded, raster } = renderK(text, spec.version, {
        eccLevel, cornerMarker, centerQr: true, qrText: text,
      });
      assert.equal(encoded.formatIndex, spec.formatIndex, `${spec.name}/${eccLevel}: 와이어 공유 실패`);
      const result = decodeFrontend(raster);
      assert.equal(result.ok, true,
        `${spec.name}/${eccLevel} 중앙 QR 왕복 실패: ${result.reason || ''} `
        + JSON.stringify(result.detail?.pipelineCode));
      assert.equal(result.text, text, `${spec.name}/${eccLevel}: 원문이 다르다`);
      assert.equal(result.family, 'star', `${spec.name}/${eccLevel}: star가 아니다`);
      assert.equal(result.versionName, spec.name, `${spec.name}/${eccLevel}: 프로파일이 다르다`);
      assert.equal(result.diagnostics.format.formatIndex, spec.formatIndex,
        `${spec.name}/${eccLevel}: 소비 와이어가 다르다`);
    }
  }
});

test('K 중앙 v0 왕복 — 평/CM × 전 k × 전 ECC가 기존 와이어로 원문까지 돌아온다', () => {
  const profiles = [
    ...VERSIONS_K.map((spec) => ({ spec, cornerMarker: false })),
    ...VERSIONS_KCM.map((spec) => ({ spec, cornerMarker: true })),
  ];
  for (const { spec, cornerMarker } of profiles) {
    for (const eccLevel of ['L', 'M', 'H']) {
      const text = 'KB-' + spec.name + '-' + eccLevel;
      const { encoded, raster } = renderK(text, spec.version, {
        eccLevel, cornerMarker, centralV0: true, finderPatternId: 'central-v0',
      });
      assert.equal(encoded.formatIndex, spec.formatIndex, `${spec.name}/${eccLevel}: 와이어 공유 실패`);
      // 비컨 본문 우선 경로에서도 현재 계열 추론(O=평 K, G=K-CM)을 포맷 7/8이
      // star로 되짚어야 한다. 직접 locator 경로만 초록이고 재분류 경로가 죽는 것을 막는다.
      assert.deepEqual(familiesForBeaconMeta({
        family: cornerMarker ? 'G' : 'O',
        formatDigits: encoded.formatDigits.slice(0, 5),
      }), ['star'], `${spec.name}/${eccLevel}: 비컨 메타가 star로 재분류되지 않는다`);
      const result = decodeFrontend(raster);
      assert.equal(result.ok, true,
        `${spec.name}/${eccLevel} 중앙 v0 왕복 실패: ${result.reason || ''} `
        + JSON.stringify(result.detail?.pipelineCode));
      assert.equal(result.text, text, `${spec.name}/${eccLevel}: 원문이 다르다`);
      assert.equal(result.family, 'star', `${spec.name}/${eccLevel}: star가 아니다`);
      assert.equal(result.versionName, spec.name, `${spec.name}/${eccLevel}: 프로파일이 다르다`);
      assert.equal(result.diagnostics.format.formatIndex, spec.formatIndex,
        `${spec.name}/${eccLevel}: 소비 와이어가 다르다`);
      if (cornerMarker) {
        const beaconHypotheses = result.diagnostics.bootstrap.geometry.poseDiagnostics
          .filter((pose) => pose.source === 'central-v0-finder');
        assert.ok(beaconHypotheses.length >= 9,
          `${spec.name}/${eccLevel}: 중앙 비컨 가설이 상위 컷에서 밀렸다 (${beaconHypotheses.length})`);
      }
    }
  }
});

test('K 중앙 v0 — 1080×1440 여백 프레임에서도 K0/K1/K2 가 선다', {
  timeout: 120_000,
}, () => {
  // 레인 TLK (2026-08-25): 실사 k26-tl 는 모니터 전체 샷이라 기본 검색 캡 480 이
  // 비컨 K3 코어를 죽였다. 어댑터가 캡만 올린 것을, 합성을 같은 크기로 심어 잠근다.
  // 문턱은 그대로다 — 여백이 늘어 검색 축소가 커지는 경로만 연다.
  const canvasW = 1080;
  const canvasH = 1440;
  const fill = PALETTE.background;
  for (const spec of VERSIONS_K) {
    const text = 'K-pad1440-' + spec.name;
    const { raster } = renderK(text, spec.version, {
      centralV0: true, finderPatternId: 'central-v0',
    });
    assert.ok(raster.width <= canvasW && raster.height <= canvasH,
      spec.name + ': 합성 래스터가 1440 캔버스를 넘는다');
    const padded = {
      width: canvasW,
      height: canvasH,
      pixels: new Uint8ClampedArray(canvasW * canvasH * 4),
    };
    for (let index = 0; index < canvasW * canvasH; index += 1) {
      padded.pixels[index * 4] = fill.r;
      padded.pixels[index * 4 + 1] = fill.g;
      padded.pixels[index * 4 + 2] = fill.b;
      padded.pixels[index * 4 + 3] = 255;
    }
    const ox = Math.floor((canvasW - raster.width) / 2);
    const oy = Math.floor((canvasH - raster.height) / 2);
    for (let y = 0; y < raster.height; y += 1) {
      padded.pixels.set(
        raster.pixels.subarray(y * raster.width * 4, (y + 1) * raster.width * 4),
        ((oy + y) * canvasW + ox) * 4,
      );
    }
    const result = decodeFrontend(padded);
    assert.equal(result.ok, true,
      spec.name + ' 1440 여백 왕복 실패: ' + (result.reason || '')
      + ' ' + JSON.stringify(result.detail && result.detail.pipelineCode));
    assert.equal(result.text, text, spec.name + ': 원문이 다르다');
    assert.equal(result.family, 'star', spec.name + ': star 가 아니다');
  }
});

test('대조군 무회귀 — 같은 하네스에서 O·A 는 기존 패밀리로 이긴다 (star 오양성 없음)', () => {
  const encodedA = encodeA('plain-A-control', { version: 1, eccLevel: 'M' });
  const sceneA = buildScene(encodedA, { palette: PALETTE, margin: 20 });
  const resultA = decodeFrontend(rasterize(sceneA, { pixelsPerUnit: PPU, supersample: 1 }));
  assert.equal(resultA.ok, true, 'A1 대조군 실패: ' + resultA.reason);
  assert.equal(resultA.text, 'plain-A-control');
  assert.equal(resultA.family, 'tri', 'A 프레임을 star 가 먹었다 — 배제 규칙 오발');

  const encodedO = encode('plain-O-control', { version: 2, eccLevel: 'M' });
  const sceneO = buildScene(encodedO, { palette: PALETTE });
  const resultO = decodeFrontend(rasterize(sceneO, { pixelsPerUnit: PPU, supersample: 1 }));
  assert.equal(resultO.ok, true, 'O V2 대조군 실패: ' + resultO.reason);
  assert.equal(resultO.text, 'plain-O-control');
  assert.equal(resultO.family, 'hex');
});

test('A 프레임에서 star 채점은 하드체크에 못 선다 — 반전 계열·균형 문턱 (배제 오발 방어)', () => {
  const encodedA = encodeA('star-guard-A', { version: 0, eccLevel: 'M' });
  const sceneA = buildScene(encodedA, { palette: PALETTE, margin: 20 });
  const raster = rasterize(sceneA, { pixelsPerUnit: PPU, supersample: 1 });
  const luma = toRelativeLuminance(raster, {});
  const center = axialToPixel(0, 0, sceneA.layout);
  const star = scoreStarTiling(luma, {
    center: { x: center.x * PPU, y: center.y * PPU },
    cellSize: PPU,
  }, { starKs: [6] });
  assert.equal(star.ok, true);
  assert.equal(star.hardChecks.all, false,
    'A0 프레임에서 star 하드체크가 섰다 — 반전 계열 문턱·균형이 무력하다');
});

test('60° 오가설 사멸 — 앵커 판정만으로 죽는다 (계약 K-2 채택 근거 실측)', () => {
  const spec = VERSIONS_K[0];
  const { scene, raster } = renderK('sixty-degree-probe', spec.version);
  const luma = toRelativeLuminance(raster, {});
  const center = axialToPixel(0, 0, scene.layout);
  const bullseye = {
    center: { x: center.x * PPU, y: center.y * PPU },
    cellSize: PPU,
  };
  // 대조: 올바른 포즈에서는 앵커 6/6 이 선다.
  const upright = findKAnchorHypotheses(luma, bullseye, [spec.k], {});
  assert.equal(upright.ok, true, '대조 실패: ' + (upright.reason || ''));
  assert.ok(upright.hypotheses.some((h) => h.hardChecks.all && h.orientation === 0));
  // 60° 회전 H 주입 — A 계열 꼭짓점 자리가 반전 계열 자리로 간다. digit 배정
  // (5/0/0 vs 1/1/1)이 다르므로 expectedPattern 이 전 방향에서 죽어야 한다.
  const angle = Math.PI / 3;
  const H60 = new Float64Array([
    PPU * Math.cos(angle), -PPU * Math.sin(angle), bullseye.center.x,
    PPU * Math.sin(angle), PPU * Math.cos(angle), bullseye.center.y,
    0, 0, 1,
  ]);
  const rotated = findKAnchorHypotheses(luma, bullseye, [spec.k], { H: H60, cellSizeSearch: false });
  assert.equal(rotated.ok, false, '60° 오가설이 앵커를 통과했다 — digit 1 배정이 무력하다');
  const rejectedAtK = rotated.detail.rejected.filter((r) => r.k === spec.k);
  assert.ok(rejectedAtK.length > 0);
  for (const rejection of rejectedAtK) {
    assert.equal(rejection.hardChecks.expectedPattern, false,
      '60° 오가설의 기각 사유가 expectedPattern 이 아니다 (' + JSON.stringify(rejection.hardChecks)
      + ') — 위치가 아니라 digit 이 죽여야 한다');
  }
});

test('K-CM 반전 꼭짓점 전면-dark — K0CM/K1CM/K2CM × ppu 10/12/16 원문까지', () => {
  // 레인 KVTX: 운영자 작화는 반전 꼭짓점 3셀이 3면 다 dark. 문턱은 안 내린다.
  for (const spec of VERSIONS_KCM) {
    for (const ppu of [10, 12, 16]) {
      const text = 'K-CM-flatdark-' + spec.name + '-ppu' + ppu;
      const encoded = encodeK(text, { version: spec.version, eccLevel: 'M', cornerMarker: true });
      const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
      const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 1 });
      const result = decodeFrontend(raster);
      assert.equal(result.ok, true,
        spec.name + ' ppu' + ppu + ' 왕복 실패: ' + (result.reason || '') + ' '
        + JSON.stringify(result.detail && result.detail.pipelineCode));
      assert.equal(result.text, text, spec.name + ' ppu' + ppu + ': 원문이 다르다');
      assert.equal(result.family, 'star', spec.name + ' ppu' + ppu + ': star 가 아니다');
    }
  }
});

test('cube 잠금 이중 검사 — K 실루엣에서 cube 채점이 서지 않는다 (F-107 이중 자물쇠)', () => {
  // 위 왕복 테스트의 진단 단언과 겹으로: 검출기 단독 호출에서도 양성이 아니어야
  // 한다 (성공 경로가 바뀌어도 이 자물쇠가 남는다 — 턴A 레인 안전망 전례).
  for (const spec of VERSIONS_K) {
    const { raster } = renderK('cube-lock-' + spec.name, spec.version);
    const luma = toRelativeLuminance(raster, {});
    const cube = scoreCubeTiling(luma, undefined, {});
    const positive = cube.ok === true && cube.hardChecks && cube.hardChecks.all === true;
    assert.equal(positive, false,
      spec.name + ': cube 채점이 K 실루엣에 hard 양성이다 — F-107 함정');
  }
});

test('star 채점은 starKs 없이는 서지 않는다 — 교차-k 도플갱어 잠금 (opt-in 규약)', () => {
  // 실측(2026-08-24): star k6 영역이 A k8 영역에 거의 전부 들어가서 A1 프레임을
  // star k6 로 재면 코어·A 계열·반전 계열이 **전부 진짜 셀**이라 균형까지 통과한다.
  // 그래서 star 의 k 는 «남에게서 물려받으면 안 되는» 값이고 (hex 면적 모델의
  // options.ks 도 마찬가지 — K 총 셀이 hex 의 약 2배), 호출자가 star 면적 모델로
  // 고른 값을 starKs 로 직접 줘야 한다. 이 두 단언이 그 규약의 자물쇠다.
  const encodedA = encodeA('cross-k-doppel', { version: 1, eccLevel: 'M' });
  assert.equal(encodedA.k, 8, 'A1 의 k 가 8 이 아니다 — 이 테스트의 전제가 바뀌었다');
  const sceneA = buildScene(encodedA, { palette: PALETTE, margin: 20 });
  const raster = rasterize(sceneA, { pixelsPerUnit: PPU, supersample: 1 });
  const luma = toRelativeLuminance(raster, {});
  const center = axialToPixel(0, 0, sceneA.layout);
  const finder = { center: { x: center.x * PPU, y: center.y * PPU }, cellSize: PPU };

  // ① 근거 — 남의 k(6)를 물려 쓰면 A1 프레임에서 star 가 hard 로 선다.
  const borrowed = scoreStarTiling(luma, finder, { starKs: [6] });
  assert.equal(borrowed.ok, true);
  assert.equal(borrowed.hardChecks.all, true,
    '교차-k 도플갱어가 사라졌다면 opt-in 규약의 근거를 다시 재라 (완화 금지 — 근거 갱신)');

  // ② 규약 — starKs 미공급이면 star 가설 자체가 서지 않는다 (기본 sweep 금지).
  const noKs = scoreStarTiling(luma, finder, {});
  assert.equal(noKs.ok, false, 'starKs 없이 star 가 채점됐다 — 기본 sweep 이 되살아났다');
  assert.equal(noKs.reason, 'frontend:no-grid-hypothesis');

  // ③ 그 결과 classifyFamily 는 이 레인 이전과 같은 답(tri)을 낸다.
  const classified = classifyFamily(luma, { finder }, { ks: [encodedA.k], minSeparation: 0.04 });
  assert.equal(classified.ok, true);
  assert.equal(classified.family, 'tri',
    'starKs 미공급 classifyFamily 가 star 로 뒤집혔다 — 무회귀 규약 위반');
});

test('star 오양성은 평가 집합을 넓히지 않는다 — familyWithoutStar 사슬 (무회귀 자물쇠)', () => {
  // star 가 오양성으로 서면 bootstrap 은 «star + star 가 없었을 때의 분류 하나» 만
  // 평가한다. 상수 ['star','tri','hex'] 로 넓히면 base 가 못 읽던 프레임이 우연히
  // 살아난다 — 실측 2026-08-24: 투명 O trim(export-options §9)이 tri 분류로 죽던
  // 것이 hex 까지 평가돼 읽혔고, 링 재적용 규칙의 전제가 조용히 무너졌다.
  const encodedA = encodeA('chain-narrow', { version: 1, eccLevel: 'M' });
  const sceneA = buildScene(encodedA, { palette: PALETTE, margin: 20 });
  const raster = rasterize(sceneA, { pixelsPerUnit: PPU, supersample: 1 });
  const luma = toRelativeLuminance(raster, {});
  const center = axialToPixel(0, 0, sceneA.layout);
  const finder = { center: { x: center.x * PPU, y: center.y * PPU }, cellSize: PPU };

  // 남의 k(6)를 물려 준 A1 프레임 = star 오양성이 서는 자리 (위 도플갱어 테스트의 ①).
  const misread = classifyFamily(luma, { finder },
    { ks: [encodedA.k], starKs: [6], minSeparation: 0.04 });
  assert.equal(misread.ok, true);
  assert.equal(misread.family, 'star', '오양성 전제가 사라졌다 — 근거를 다시 재라');
  assert.equal(misread.diagnostics.familyWithoutStar, 'tri',
    'star 없이는 tri 였는데 사슬 폴백이 그 값을 못 낸다 — 평가 집합이 넓어진다');
  // bootstrap 이 실제로 읽는 것은 **집합** 이다 (빈 집합이면 base 의
  // body-validated-hex 폴백을 재현해야 한다 — 그걸 놓쳐서 회전 30° sweep 이
  // 한 번 죽었다: 좁히는 방향의 회귀도 실재한다).
  assert.deepEqual(misread.diagnostics.familiesWithoutStar, ['tri']);

  // star 가 없는 평범한 A 프레임에서도 같은 값이 나온다 (계산이 star 유무에 안 걸린다).
  const plain = classifyFamily(luma, { finder }, { ks: [encodedA.k], minSeparation: 0.04 });
  assert.equal(plain.family, 'tri');
  assert.equal(plain.diagnostics.familyWithoutStar, 'tri');
});
