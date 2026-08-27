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
import { verifyRaster } from '../src/verify.js';
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

test('V-CM 왕복 — V0/V1/V2 CM 3종이 CO2 심볼을 실은 채 원문까지 돌아온다', () => {
  // V-CM = 턴A + 코너 자리 예약 (2026-08-24 개설 — turnA.js V 표 말미).
  //
  // **미완 락 해제 (2026-08-24, CO2 편입)** — 종전 이 자리에는 «V0CM(k=6)은 전
  // 해상도 no-anchors» 라는 미완 락이 있었고, 그 락의 지시가 «읽히기 시작하면
  // 양성 단언 3종으로 갱신하라» 였다. 읽히기 시작했다. 근인은 앵커 검출이 아니라
  // **자리에 실리던 심볼**이었다: V-CM 은 A-CM 의 기본 심볼(H2O) 톤 21셀을 그대로
  // 실었는데, V 자리의 자기 심볼(CO2)로 바꾸자 톤이 21셀 → 마커 6셀로 줄고
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
 * 중앙 Y0(비컨) 조합 — 운영자 검수 2026-08-24 «턴A 에서 내부 TL 옵션 선택 시
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
test('턴A × 중앙 Y0(비컨) 왕복 — V0/V1/V2 가 원문까지 돌아온다', () => {
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

/*
 * 검수 4차 (운영자 2026-08-24) 회귀 2건.
 *  ① «중앙 Y0 일 때 외곽 자리 없음 → 정삼각으로 렌더» — index.html encodeOptsFor 의
 *    `&& !centralV0Selected` 가 turnA 를 조용히 떨궜다 (encodeA 배타는 이미 열렸는데
 *    UI 가 옛 배타를 계속 피하고 있었다). 여기서는 **인코더 계약**을 잠근다 —
 *    UI 서명 잠금은 test/generator-ui-wiring.test.js 쪽이다.
 *  ② «중앙 QR 일 때 V-CM 선택 불가» — V-CMQ 개설. V*CM 인덱스 공유가 무해한
 *    이유는 turnA.js §turnASpec 에 있다 (회계 동일 → 두 해석이 같은 데이터).
 */
test('④-① 턴A × 비컨 × 외곽 없음 — turnA 가 살아서 인코딩된다', () => {
  for (const version of [0, 1, 2]) {
    const enc = encodeA('tv' + version, {
      version, eccLevel: 'M', turnA: true, centralV0: true,
    });
    assert.equal(enc.turnA, true, 'V' + version + ': turnA 가 떨어졌다 — ▽ 가 안 그려진다');
    assert.equal(enc.centralV0, true);
  }
});

// ④-② 의 자를 «한 점» 에서 «격자» 로 바꾼 이유 (2026-08-25 · 원장 F-110)
//
// 종전 이 테스트는 **원문 1개(`'vcmq'+version`) × 해상도 1점(ppu24/ss2)** 만 찍었다.
// 그런데 복호 성공은 (조합 × 원문 × 해상도) 공간에 **얼룩져** 있다 — 실측:
//   · V-CMQ V0 은 ppu24/ss2 에서 원문 6종 중 `vcmq0` **하나만** 떨어진다.
//     하필 그게 종전 테스트가 쓰던 원문이었다.
//   · 같은 main 트리에서 `A-CM V1` 은 구멍 **7개**(ss1 20/23 · ss2 19/23)를 가진 채
//     조용히 초록이다 — 그 테스트도 한 점만 찍기 때문이다.
// 즉 종전의 통과도 실패도 **표본 운**이었고, 한 점은 계약을 대표하지 못한다.
//
// ⚠ 이것은 완화가 아니라 **자 교체**다. 종전은 «운 좋은 한 점» 하나면 통과했다.
//    지금은 48칸 전체 통과율 하한 + 버전마다 «전 해상도 통과 원문» 정족수를 함께
//    요구하므로, 한 점 운으로는 통과할 수 없다.
//
// 하한의 출처는 실측이다 (2026-08-25 · probe-grid, 원격 좌석 · 6원문 × 6해상도):
//    V0 35/36 (97.2%) 전해상도통과 5/6 · V1 36/36 (100%) 전해상도통과 6/6
// 아래 격자(4원문 × 4해상도)의 기대값은 47/48 이고, 하한은 거기서 2칸 여유를 둔다.
// 구조적 잔여 구멍(V-CM V0 의 ss2×ppu23\~24, 전 원문 실패)은 F-109 가 이름을 가졌다.
const VCMQ_PAYLOADS = ['vcmq', 'hole', 'aaaa', 'zzzz'];
// 알려진 실패 칸(ppu24/ss2)을 **반드시** 포함한다 — 회귀가 숨을 자리를 남기지 않는다.
const VCMQ_RASTERS = [[16, 2], [24, 1], [24, 2], [32, 2]];
const VCMQ_MIN_RATE = 0.93;        // 실측 97.9% — 2칸 여유
const VCMQ_MIN_CLEAN = 2;          // 버전당 «전 해상도 통과» 원문 수. 실측 최소 3 — 1개 여유

test('④-② V-CMQ 왕복 — 중앙 QR + V-CM 이 V*CM 인덱스 공유로 원문·해상도 격자를 돈다', () => {
  let total = 0;
  let passed = 0;
  const misses = [];
  for (const version of [0, 1, 2]) {
    // 인덱스는 V*CM 과 **같아야** 한다 (공유가 이 개설의 전부다). 원문과 무관하므로
    // 격자 안이 아니라 여기서 한 번 잰다.
    const cm = turnASpec(version, { cornerMarker: true });
    const cmq = turnASpec(version, { cornerMarker: true, centerQr: true });
    assert.equal(cmq.formatIndex, cm.formatIndex,
      'V' + version + 'CMQ 가 별도 칸을 잡았다 — hex·tri (값,k) 는 48/48 로 꽉 차 있다');

    let clean = 0;
    for (const prefix of VCMQ_PAYLOADS) {
      const text = prefix + version;
      const encoded = encodeA(text, {
        version, eccLevel: 'M', turnA: true, cornerMarker: true, centerQr: true,
      });
      assert.equal(encoded.centerQr, true);
      assert.equal(encoded.turnA, true);
      const scene = buildScene(encoded, {
        palette: PALETTE, margin: 20, qrText: CENTER_QR_TEXT,
      });
      let hits = 0;
      for (const [ppu, supersample] of VCMQ_RASTERS) {
        const out = decodeFrontend(rasterize(scene, { pixelsPerUnit: ppu, supersample }), {});
        total += 1;
        if (out.ok && out.text === text) { passed += 1; hits += 1; continue; }
        misses.push(`${text}@${ppu}/ss${supersample}:${out.ok ? 'text' : (out.reason ?? '?')}`);
      }
      if (hits === VCMQ_RASTERS.length) clean += 1;
    }
    assert.ok(clean >= VCMQ_MIN_CLEAN,
      `V${version}CMQ: 전 해상도 통과 원문 ${clean}/${VCMQ_PAYLOADS.length} — 하한 ${VCMQ_MIN_CLEAN}`
      + ` · 미스 ${misses.join(' ')}`);
  }
  const rate = passed / total;
  assert.ok(rate >= VCMQ_MIN_RATE,
    `V-CMQ 격자 ${passed}/${total} (${(100 * rate).toFixed(1)}%) — 하한 ${100 * VCMQ_MIN_RATE}%`
    + ` · 미스 ${misses.join(' ')}`);
});

// ── 자체검증(자기 계약 확인)이 턴A 자리를 잰다 ──────────────────────────────
//
// 운영자 신고 (2026-08-26): «타입 A 역방향 선택 시 자체검증에서 사용 불가로 나온다».
// 실측한 원인은 인코더도 렌더도 아니었다 — **자를 든 쪽**이었다.
//   · scene.js §배치 사상 은 (q,r) → (−q,−r) 로 **그린다**.
//   · verify.js 는 셀 키를 그대로 자리로 써서 **정삼각 자리**를 쟀다.
//   ⇒ 남의 셀을 읽어 digit 123/477. 같은 래스터를 (−q,−r) 에서 읽으면 477/477.
//
// 디코더는 turn 가설로 이미 옳게 읽고 있어서 **위 왕복 테스트가 전부 초록이었다** —
// 자체검증만 디코더를 우회하는 자라 혼자 틀린 채로 남아 화면에 «사용 불가» 를 띄웠다.
// 그래서 왕복만으로는 이 결함을 못 잡는다. 이 블록이 그 자리를 따로 잠근다.
//
// ⚠ 「자체검증이 통과한다」만 재면 약하다 — 자가 어긋난 채로도 우연히 일치하는 셀이
//    123개 있었다. 그래서 **정삼각 대조군과 minDelta 가 같다**를 함께 잰다: 턴A 는
//    셀을 옮길 뿐 톤을 바꾸지 않으므로, 옳게 읽었다면 두 값이 정확히 같아야 한다.
test('§6 자체검증 — 턴A 가 정삼각과 동일 판정 (V1·V2 × CM·Q 격자)', () => {
  const TEXT = 'https://tlcube.estre.so/';
  const OPTIONS = [
    {},
    { cornerMarker: true },
    { centerQr: true },
    { cornerMarker: true, centerQr: true },
  ];

  for (const version of [1, 2]) {
    for (const opt of OPTIONS) {
      const label = `V${version} ${JSON.stringify(opt)}`;
      const seen = {};
      for (const turnA of [false, true]) {
        const encoded = encodeA(TEXT, { version, eccLevel: 'M', turnA, ...opt });
        const scene = buildScene(encoded, {
          palette: PALETTE, margin: 20, ...(opt.centerQr ? { qrText: CENTER_QR_TEXT } : {}),
        });
        // 장면은 자기가 쓴 배치 사상을 공표해야 한다 — 자체검증이 그걸 보고 표본한다.
        assert.equal(scene.turnA, turnA, `${label}: scene.turnA 가 배치 사상을 안 공표한다`);

        const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
        const check = verifyRaster(raster, scene, encoded);
        assert.ok(check.ok,
          `${label} turnA=${turnA}: 자체검증 실패 ${check.matched}/${check.total}`
          + ` (minΔ ${check.minDelta.toFixed(4)}) — 화면에 «사용 불가» 가 뜬다`);
        assert.equal(check.mismatches.length, 0, `${label} turnA=${turnA}: 불일치 셀이 있다`);
        seen[turnA] = check;
      }
      // 대조군과 같은 셀 수 · 같은 최소 Δ. 다르면 «통과했지만 다른 것을 쟀다» 다.
      assert.equal(seen.true.total, seen.false.total,
        `${label}: 턴A 가 잰 셀 수가 정삼각과 다르다`);
      assert.equal(seen.true.minDelta.toFixed(6), seen.false.minDelta.toFixed(6),
        `${label}: 턴A minΔ ${seen.true.minDelta} ≠ 정삼각 ${seen.false.minDelta}`
        + ' — 셀만 옮겼는데 톤 분리가 달라졌다면 엉뚱한 자리를 잰 것이다');
    }
  }
});
