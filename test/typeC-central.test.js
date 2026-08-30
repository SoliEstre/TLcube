/**
 * typeC-central.test.js — Type C × 중앙 슬롯 개통 (2026-08-30, PM/027 §5.3·§5.4).
 *
 * 잠그는 계약:
 *   ① 중앙 TL(centralN7) — 안 ①: 비컨 payload = 표면 포맷 사본이라 평 C 행
 *      (formatIndex 0..3)이 현행 코덱 그대로 실린다 (와이어 변경 0). 끝단 왕복 +
 *      **상대 우세 필터(orientationMargin, best − 1/18 컷) 통과 계측** — 검증 레인
 *      지적: v0 가짜 후보가 참 n=7 을 자를 수 있는 축이라 왕복 자에 진단을 넣는다.
 *   ② 중앙 QR(CQ) — formatIndex 4, 평 C 전용 4행. 용량·scan order 는 평 C 와 완전
 *      동일 (19셀 슬롯 점유자 교체 — O 가족 V*Q 선례).
 *   ③ 남는 배타의 대조군 — centralV0(미검증) · C*D×TL / CDQ(중앙 슬롯 단일 점유 +
 *      검증기 확장 트랙) · CM(공용 사유). 개통 축은 양성 단언으로 잠근다.
 *
 * ⚠ CQ 끝단 왕복은 ppu 24 로 잰다 — 실측(2026-08-30): 중앙 QR 트리플 검출이
 *   ppu ≤ 20 에서 payload 의존으로 흔들린다 (CQ2/특정 페이로드 no-format-candidate,
 *   ppu 24 는 8/8 안정). C 는 근접·확대 전용 포맷(§4.12 물리 봉투)이라 계약 위반이
 *   아니고, 저해상 강건화는 공유 QR 검출기 트랙 몫이다 — 보고서 리스크 절 참조.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { discoverCentralBeaconFinders } from '../src/decoder/central-beacon-adapt.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../src/centralN7Schema.js';
import {
  C_FORMAT_INDEX, TYPE_C_CM_UNSUPPORTED_REASON, cFormatSpec,
} from '../src/formatC.js';
import { VERSIONS_C, VERSIONS_C_Q } from '../src/capacityC.js';
import { TL_READER_URL } from '../src/qr.js';

const PALETTE = Object.freeze({
  background: Object.freeze({ r: 248, g: 249, b: 251 }),
  levels: Object.freeze([
    Object.freeze({ r: 20, g: 28, b: 42 }),
    Object.freeze({ r: 96, g: 116, b: 145 }),
    Object.freeze({ r: 218, g: 228, b: 242 }),
  ]),
  bullseyeDark: Object.freeze({ r: 0, g: 0, b: 0 }),
  bullseyeLight: Object.freeze({ r: 255, g: 255, b: 255 }),
});

test('C0..C3 × 중앙 TL: 끝단 왕복 + 상대 우세 필터(margin 컷) 통과 계측', {
  timeout: 600_000,
}, (t) => {
  for (const spec of VERSIONS_C) {
    const text = `${spec.name}-TL-끝단`;
    const encoded = encode(text, { notchC: true, version: spec.version, centralN7: true });
    assert.equal(encoded.centralN7, true, spec.name);
    assert.equal(encoded.capacity.formatIndex, spec.formatIndex, spec.name);
    const scene = buildScene(encoded, {
      palette: PALETTE,
      margin: 20,
      finderPatternId: CENTRAL_N7_FINDER_PATTERN_ID,
      // C 는 hex 기하 공유 — 생성기의 정본 유도(centralN7FamilyForType('O'))와 같은 값.
      centralN7Family: 'hex',
    });
    const raster = rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });

    // (b) 상대 우세 필터 계측 — discoverCentralBeaconFinders 는 orientationMargin
    // 내림차순 정렬 후 best − 1/18 밖을 버린다. 참 n=7 파인더가 그 컷 **뒤에도**
    // 남아 있어야 하며, family 는 코드워드가 직접 증명한 hex 여야 한다.
    const luma = toRelativeLuminance(raster);
    const finders = discoverCentralBeaconFinders(luma, {});
    assert.ok(finders.length > 0, `${spec.name}: margin 컷 뒤 비컨 파인더가 0개다`);
    const best = finders[0].orientationMargin;
    const trueN7 = finders.filter((finder) =>
      finder.centralN7 && finder.centralN7.family === 'hex');
    assert.ok(trueN7.length > 0,
      `${spec.name}: 참 n=7(hex) 파인더가 margin 컷(best=${best})에서 잘렸다 — `
      + `생존 ${finders.length}개: ${finders.map((f) => `${f.kind}:${f.orientationMargin.toFixed(3)}`).join(', ')}`);
    for (const finder of trueN7) {
      assert.ok(finder.orientationMargin >= best - 1 / 18, spec.name);
    }
    t.diagnostic(`${spec.name} margins: best=${best.toFixed(3)} `
      + `n7=[${trueN7.map((f) => f.orientationMargin.toFixed(3)).join(',')}] `
      + `survivors=${finders.length}`);

    // (a) 끝단 왕복 — 포맷은 비컨 3복제 확정 관측, 본문은 세트 B 앵커 배율 정합
    // 가설(레인 CTLQ 신설)이 나른다.
    const result = decodeFrontend(raster);
    assert.equal(result.ok, true, `${spec.name}: ${result.reason}`);
    assert.equal(result.text, text, spec.name);
    assert.equal(result.family, 'hex', spec.name);
    assert.equal(result.hypothesis.k, spec.k, spec.name);
    assert.equal(result.hypothesis.notchC, true, spec.name);
    assert.equal(result.versionName, spec.name, spec.name);
    assert.equal(result.hypothesis.finderPatternId, CENTRAL_N7_FINDER_PATTERN_ID, spec.name);
  }
});

test('C0..C3 × 중앙 QR: CQ 행(formatIndex 4)으로 원문 왕복 — 용량은 평 C 와 동일', {
  timeout: 600_000,
}, () => {
  for (const spec of VERSIONS_C_Q) {
    const text = `${spec.name}-끝단`;
    const encoded = encode(text, { notchC: true, version: spec.version, centerQr: true });
    assert.equal(encoded.centerQr, true, spec.name);
    assert.equal(encoded.capacity.name, spec.name, spec.name);
    assert.equal(encoded.capacity.formatIndex, 4, spec.name);
    // 용량 동일성 — 잠긴 결론: CQ = 평 C 완전 동일 (19셀 슬롯 점유자 교체).
    const plain = encode(text, { notchC: true, version: spec.version });
    assert.equal(
      encoded.capacity.maxPayloadBytes, plain.capacity.maxPayloadBytes, spec.name,
    );
    assert.equal(encoded.capacity.dataCells, plain.capacity.dataCells, spec.name);

    const scene = buildScene(encoded, {
      palette: PALETTE, margin: 20, qrText: TL_READER_URL,
    });
    const raster = rasterize(scene, { pixelsPerUnit: 24, supersample: 2 });
    const result = decodeFrontend(raster);
    assert.equal(result.ok, true, `${spec.name}: ${result.reason}`);
    assert.equal(result.text, text, spec.name);
    assert.equal(result.hypothesis.k, spec.k, spec.name);
    assert.equal(result.hypothesis.notchC, true, spec.name);
    assert.equal(result.versionName, spec.name, spec.name);
  }
});

test('남는 배타 대조군 — centralV0·C*D×TL·CDQ·CM 은 명시 거절, 개통 축은 양성', () => {
  // 개통 축 양성 단언 (평 C 전 행 × TL, CQ 전 행) — 위 왕복 자와 별개로 인코더
  // 경계에서 싸게 잠근다.
  for (const row of C_FORMAT_INDEX) {
    if (row.daehanFinder) continue;
    if (row.centerQr) {
      const encoded = encode('x', { notchC: true, version: row.version, centerQr: true });
      assert.equal(encoded.capacity.name, row.name);
    } else {
      const encoded = encode('x', { notchC: true, version: row.version, centralN7: true });
      assert.equal(encoded.centralN7, true, row.name);
      assert.equal(encoded.capacity.formatIndex, row.formatIndex, row.name);
    }
  }

  // centralV0 — C 실루엣 v0 비컨 검증 미실측. 사유는 양성 단언(개통분 명시)을 겸한다.
  assert.throws(
    () => encode('x', { notchC: true, version: 0, centralV0: true }),
    (error) => error instanceof RangeError
      && /centralV0.*미개통/.test(error.message)
      && /중앙 TL/.test(error.message)
      && /CQ 행/.test(error.message),
  );
  // C*D × 비컨(TL) · CDQ — 중앙 슬롯 단일 점유 가드 (daehan 이 이미 점유자다).
  for (const extra of [{ centralN7: true }, { centerQr: true }]) {
    assert.throws(
      () => encode('x', { notchC: true, version: 0, daehanFinder: true, ...extra }),
      (error) => error instanceof RangeError && /중앙 슬롯 점유자는 하나다/.test(error.message),
      JSON.stringify(extra),
    );
  }
  // CDQ 와이어 행 부재 — 표 계층에서도 같은 결론 (sagoae×정식 중앙 검증기 트랙 몫).
  assert.throws(
    () => cFormatSpec(0, { daehanFinder: true, centerQr: true }),
    (error) => error instanceof RangeError && /CDQ/.test(error.message),
  );
  // CM — 공용 사유 그대로.
  assert.throws(
    () => encode('x', { notchC: true, version: 0, cornerMarker: true }),
    (error) => error instanceof RangeError
      && error.message === TYPE_C_CM_UNSUPPORTED_REASON,
  );
});
