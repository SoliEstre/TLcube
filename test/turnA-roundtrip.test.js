/**
 * turnA-roundtrip.test.js — 턴A(내부 타입 V) 픽셀 왕복 (Wave 3 ②, 2026-08-24).
 *
 * encode → buildScene(▽) → rasterize → decodeFrontend 가 **원문까지** 돌아온다.
 * 2026-08-19 의 «라이브 0/3» (PM/019 §3 — 기하 미구현 + 검출 미배선)이 이 파일로
 * 닫힌다. 검출 경로 실측 (2026-08-24):
 *   · V0/V1/V2  — 앵커 경로: findAAnchorHypotheses 의 turn 변형 (반전 꼭짓점 자리,
 *     100% 배타)이 가설을 세우고, V 표 formatIndex 가 CRC+RS 로 확정된다.
 *   · V*Q — 중앙 QR 경로: qrGeometryHypotheses 의 tri turn 쌍둥이가 이긴다
 *     (A*Q 와 같은 경로 — 포즈는 중앙 QR, 표본 자리만 반전 사상).
 *
 * ⚠ 게이트·문턱은 하나도 안 바꿨다 — turn 은 «추가 가설 축» 이고 기존 가설
 * 평가는 비트 동일하다 (정삼각 무회귀는 아래 대조군 + 기존 스위트가 잰다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { turnASpec } from '../src/turnA.js';
import { BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset } from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});
const CENTER_QR_TEXT = 'HTTPS://TL.ESTRE.SO/';

function renderTurnA(text, version, options = {}) {
  const centerQr = options.centerQr === true;
  const encoded = encodeA(text, {
    version, eccLevel: 'M', turnA: true, centerQr,
  });
  const scene = buildScene(encoded, {
    palette: PALETTE,
    margin: 20,
    ...(centerQr ? { qrText: CENTER_QR_TEXT } : {}),
  });
  return { encoded, raster: rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }) };
}

test('턴A 왕복 — V0/V1/V2 × (±centerQr) 6종이 원문까지 돌아온다', () => {
  for (const version of [0, 1, 2]) {
    for (const centerQr of [false, true]) {
      const spec = turnASpec(version, { centerQr });
      const text = 'turnA-roundtrip-' + spec.name;
      const { encoded, raster } = renderTurnA(text, version, { centerQr });
      assert.equal(encoded.formatIndex, spec.formatIndex,
        spec.name + ': 인코더 formatIndex 가 V 표와 다르다');
      const result = decodeFrontend(raster);
      assert.equal(result.ok, true,
        spec.name + ' 왕복 실패: ' + (result.reason || '') + ' '
        + JSON.stringify(result.detail && result.detail.pipelineCode));
      assert.equal(result.text, text, spec.name + ': 원문이 다르다');
      assert.equal(result.family, 'tri', spec.name + ': 패밀리가 tri 가 아니다');
      assert.equal(result.version, version, spec.name + ': 버전이 다르다');
      assert.equal(result.hypothesis.turn, true,
        spec.name + ': 이긴 가설이 turn 이 아니다 — 다른 경로로 우연히 성공했다 ('
        + result.hypothesis.id + ')');
      assert.equal(result.diagnostics.format.formatIndex, spec.formatIndex,
        spec.name + ': 소비된 formatIndex 가 V 표와 다르다');
    }
  }
});

test('정삼각 대조군 — 같은 하네스에서 기존 A 는 기존 가설로 이긴다 (무회귀)', () => {
  for (const version of [0, 1, 2]) {
    const encoded = encodeA('plain-' + version, { version, eccLevel: 'M' });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
    const result = decodeFrontend(rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }));
    assert.equal(result.ok, true, 'A' + version + ' 왕복 실패: ' + result.reason);
    assert.equal(result.text, 'plain-' + version);
    assert.equal(result.hypothesis.turn, false,
      'A' + version + ': 정삼각 프레임을 turn 가설이 이겼다 — 오수용');
    assert.ok(!result.hypothesis.id.endsWith('-turn'),
      'A' + version + ': 가설 id 가 turn 이다: ' + result.hypothesis.id);
  }
});

test('교차 오수용 없음 — 턴A 프레임에서 정삼각 formatIndex 가 소비되지 않는다', () => {
  // V2Q(3) 와 A0Q(3) 이 같은 값을 쓰는 유일 공유 조합 — k(기하)가 갈라야 한다.
  const { raster } = renderTurnA('cross-' + 2, 2, { centerQr: true });
  const result = decodeFrontend(raster);
  assert.equal(result.ok, true, 'V2Q 왕복 실패: ' + result.reason);
  assert.equal(result.version, 2, 'V2Q(k=10) 가 A0Q(k=6) 로 오독됐다');
  assert.equal(result.hypothesis.k, 10);
  assert.equal(result.hypothesis.turn, true);
});
