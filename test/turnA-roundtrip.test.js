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

test('V-CM 왕복 — V0/V1/V2 CM 3종이 NO2 심볼을 실은 채 원문까지 돌아온다', () => {
  // V-CM = 턴A + 코너 자리 예약 (2026-08-24 개설 — turnA.js V 표 말미).
  //
  // **미완 락 해제 (2026-08-24, NO2 편입)** — 종전 이 자리에는 «V0CM(k=6)은 전
  // 해상도 no-anchors» 라는 미완 락이 있었고, 그 락의 지시가 «읽히기 시작하면
  // 양성 단언 3종으로 갱신하라» 였다. 읽히기 시작했다. 근인은 앵커 검출이 아니라
  // **자리에 실리던 심볼**이었다: V-CM 은 A-CM 의 기본 심볼(H2O) 톤 21셀을 그대로
  // 실었는데, V 자리의 자기 심볼(NO2)로 바꾸자 톤이 21셀 → 마커 6셀로 줄고
  // (나머지 15셀 digit-only) V0CM 이 선다. 즉 k=6 CM 앵커를 «가리고 있던» 것이
  // H2O 였다 — 앵커 검출 코드는 한 줄도 안 바뀌었다 (이 레인은 decoder/ 무접촉).
  //
  // ⚠ 남은 구멍은 «범위» 가 아니라 **고립 딥**이다 (ppu 10\~48 × supersample 1·2
  //   14점 스윕 실측): V0CM 은 24/2 하나, V1CM 은 16/2 하나에서만 죽고 나머지
  //   13/14 는 원문까지 온다. 표본 위상 결함 꼴이라 «미완» 으로 이름 붙이지 않는다.
  for (const version of [0, 1, 2]) {
    const text = 'vcm-roundtrip-' + version;
    const encoded = encodeA(text, { version, eccLevel: 'M', turnA: true, cornerMarker: true });
    const scene = buildScene(encoded, { palette: PALETTE, margin: 20 });
    const result = decodeFrontend(rasterize(scene, { pixelsPerUnit: 12, supersample: 1 }));
    assert.equal(result.ok, true, 'V' + version + 'CM 왕복 실패: ' + result.reason);
    assert.equal(result.text, text);
    assert.equal(result.hypothesis.turn, true);
    assert.equal(result.diagnostics.format.formatIndex,
      turnASpec(version, { cornerMarker: true }).formatIndex);
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

/*
 * 중앙 TL(비컨) 조합 — 운영자 검수 2026-08-24 «턴A 에서 내부 TL 옵션 선택 시
 * 렌더링 안 됨». 세 겹이 겹쳐 있었다:
 *   ① encodeA 가 centralV0 × turnA 를 «배치 검증 미실시» 로 던졌다 — 턴A 기하가
 *      «배치만 180° 회전·셀 정립» 으로 확정되며 근거 소멸 (중앙 슬롯은 회전 불변
 *      자리이고 회계상 셀 밖이다). 이 파일이 그 «배치 검증» 이다.
 *   ② 코너 QR 이 있으면 비컨 검출이 0 이었다 — QR 파인더가 v0-center 로 1.00 을
 *      받아 상위 컷(slice 0,3)을 점거하고 진짜 비컨(0.81)을 밀어냈다. 처방은
 *      예산 증액이 아니라 **계약 주입**(centreWindowFraction — 비컨은 중앙 고정).
 *   ③ 비컨 시딩 가설에 turn 쌍둥이가 없어 ▽ 프레임이 format-crc 로 전멸했다 —
 *      중앙 QR 경로(qr-center)의 관용구를 미러.
 */
test('턴A × 중앙 TL(비컨) 왕복 — V0/V1/V2 가 원문까지 돌아온다', () => {
  // ① encodeA 의 «centralV0 × turnA 배치 검증 미실시» 던짐이 열렸고 ③ 비컨 시딩에
  // turn 쌍둥이가 생겨 성립하는 왕복이다. 코너 QR 병용은 **아직 불안정**이라 여기서
  // 안 잰다 — 원장 F-108 (검출 0 · 페이로드 의존 CRC). 게이트를 낮춰 초록을 만들지
  // 않는다: 되는 범위만 값으로 잠그고, 안 되는 범위는 이름으로 남긴다.
  for (const version of [0, 1, 2]) {
    const text = 'beacon-V' + version;
    const encoded = encodeA(text, {
      version, eccLevel: 'M', turnA: true, centralV0: true,
    });
    const scene = buildScene(encoded, {
      palette: PALETTE, margin: 20, finderPatternId: 'central-v0',
    });
    const out = decodeFrontend(rasterize(scene, { pixelsPerUnit: 24, supersample: 2 }), {});
    assert.equal(out.ok, true, text + ': ' + JSON.stringify(out.reason ?? null));
    assert.equal(out.text, text, text);
  }
});

test('턴A × 비컨 렌더 개설 — 코너 QR 조합도 **렌더는** 선다 (구 던짐의 회귀 락)', () => {
  // 운영자 신고의 실체는 렌더 불가(encodeA 던짐)였다. 복호 안정화(F-108)와 무관하게
  // 이 조합이 다시 던지면 화면에서 «선택했는데 아무것도 안 나온다» 가 되돌아온다.
  const encoded = encodeA('render-only', {
    version: 1, eccLevel: 'M', turnA: true, centralV0: true,
  });
  assert.equal(encoded.turnA, true);
  const scene = buildScene(encoded, {
    palette: PALETTE, finderPatternId: 'central-v0',
    qrText: CENTER_QR_TEXT, qrCorner: 'TL',
  });
  assert.ok(scene.shapes.length > 0, '턴A × 비컨 × 코너 QR 렌더가 비었다');
});
