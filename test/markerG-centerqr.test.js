/**
 * markerG-centerqr.test.js — CM+Q 조합 개설의 근거 (C2a, 2026-08-23 · PM/022 항목 1ⓑ).
 *
 * 원판 인코더는 «배치 검증 미실시 조합» 으로 던졌다. 이 파일이 그 검증이다:
 *   ① 배치 — O-CM/A-CM 레이아웃의 **모든** 회계 셀(data·format·reference·fixed)이
 *     중앙 슬롯(hexDistance ≤ BULLSEYE_RADIUS) 밖이다. 마커 도입으로 format·reference
 *     가 재배치되므로(autoplaceHex) «레거시가 안 겹치니 마커도 안 겹친다» 는 유도가
 *     아니라 실측이어야 한다.
 *   ② 왕복 — encode(cornerMarker+centerQr) → scene → raster → decodeFrontend 가
 *     hex 3버전 · tri 3버전 전부에서 원문 복원. CMQ 와이어(6칸)의 끝단 증명.
 *   ③ 와이어 — CM 과 CMQ 는 다른 인덱스다 (같으면 디코더가 중앙 점유를 못 가른다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { markerGSpec } from '../src/markerG.js';
import { hexDistance } from '../src/hexgrid.js';
import { BULLSEYE_RADIUS } from '../src/placement.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { TL_READER_URL } from '../src/qr.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

test('① 배치 — CM 회계 셀 전부가 중앙 슬롯 밖이다 (hex·tri × 전 버전)', () => {
  const cases = [
    { fn: encode, versions: [1, 2, 3], label: 'hex' },
    { fn: encodeA, versions: [0, 1, 2], label: 'tri' },
  ];
  for (const { fn, versions, label } of cases) {
    for (const version of versions) {
      const encoded = fn('placement', { version, eccLevel: 'M', cornerMarker: true, centerQr: true });
      let checked = 0;
      for (const [key] of encoded.cellDigits) {
        const [q, r] = key.split(',').map(Number);
        assert.ok(hexDistance(q, r) > BULLSEYE_RADIUS,
          `${label} v${version}: 셀 (${q},${r}) 이 중앙 슬롯(≤${BULLSEYE_RADIUS}) 안이다 — 중앙 QR 과 겹친다`);
        checked += 1;
      }
      assert.ok(checked > 50, `${label} v${version}: 검사한 셀이 ${checked}개뿐 — 회계가 비었다`);
    }
  }
});

test('② 왕복 — CM+Q 6종이 전부 원문을 되읽는다', { timeout: 120_000 }, () => {
  const cases = [
    { fn: encode, versions: [1, 2, 3], label: 'hex', ppu: 12 },
    { fn: encodeA, versions: [0, 1, 2], label: 'tri', ppu: 14 },
  ];
  for (const { fn, versions, label, ppu } of cases) {
    for (const version of versions) {
      const text = `cmq-${label}-v${version}`;
      const encoded = fn(text, { version, eccLevel: 'M', cornerMarker: true, centerQr: true });
      assert.equal(encoded.centerQr, true);
      const scene = buildScene(encoded, {
        palette: PALETTE, qrText: TL_READER_URL, centerQr: true,
        ...(label === 'tri' ? { margin: 20 } : {}),
      });
      const raster = rasterize(scene, { pixelsPerUnit: ppu, supersample: 2 });
      const result = decodeFrontend(raster);
      assert.equal(result.ok, true, `${label} v${version}: ${result.reason} ${JSON.stringify(result.detail?.pipelineCode)}`);
      assert.equal(result.text, text, `${label} v${version}`);
    }
  }
});

test('③ 와이어 — CM 과 CMQ 인덱스는 전 버전에서 갈린다', () => {
  for (const [family, versions] of [['hex', [1, 2, 3]], ['tri', [0, 1, 2]]]) {
    for (const version of versions) {
      const cm = markerGSpec(family, version, false);
      const cmq = markerGSpec(family, version, true);
      assert.notEqual(cm.formatIndex, cmq.formatIndex,
        `${family} v${version}: CM 과 CMQ 가 같은 인덱스 — 중앙 점유를 와이어로 못 가른다`);
      assert.equal(cm.k, cmq.k);
      assert.equal(cm.defaultFinder, cmq.defaultFinder, '자리(코너) 심볼은 Q 와 무관');
    }
  }
});
