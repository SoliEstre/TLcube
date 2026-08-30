/**
 * cell-finder-seed-gate.test.js — cell-finder 경로에도 무시드 소생 계약이 배선돼 있다.
 *
 * ## 계보 (2026-08-30, V4/k12 회귀 후속 점검)
 *
 * bullseye 경로의 V4 회귀(hex k12 시드가 tri k10 참값 +2.8% 자리에서 «그럴듯하게»
 * 성공 → CO2 톤 전멸)는 «기하 전멸 시 무시드 재시도» 로 수리됐다
 * (finder-seed-retry.test.js — 합집합 방식은 H 톤 k6 격침으로 기각). 같은
 * «시드가 사다리를 대체·선점하는» 구조가 cell-finder 의 `scaleSeeds()` 에도 있는데,
 * 소생 계약 두 가닥이 이 경로엔 끊겨 있었다:
 *   · `disableOutlineSeeds` 가 `discoverCellFinders` 의 척도 시드 유도에 안 닿았고
 *     (게이트를 켜도 시드 정권 그대로 — 실측: V2D·K1D 에서 탐색 규모 무변),
 *   · 셀마스크 finder 의 시드 위 성공이 `outlineSeedsUsed` 마커로 전파되지 않아
 *     frontend 무시드 재시도가 이 경로에서 영영 발화할 수 없었다.
 *
 * ## 이 자가 재는 성질 (값 리터럴 없음)
 *
 * ① 시드 정권의 성공 프레임은 그대로 산다 — daehan V(tri)·K(star) 옵트인 왕복.
 *    (수리는 소생 전용이어야 한다 — bullseye 전례의 «성공 프레임 비트 동일» 규율.)
 * ② `disableOutlineSeeds` 는 이 경로의 시드를 **실제로** 끈다 — 게이트를 켜면
 *    (a) 같은 답이 사다리에서도 나오고 (무시드 재시도 종착지의 실재 + 커버리지),
 *    (b) 첫 셀파인더 호출의 조대 탐색 규모가 시드 정권보다 **엄격히 커진다**
 *    (시드 삼중점 ⊊ 기하 사다리 — 시드가 꺼졌다는 행동적 증거).
 *
 * ## 이 자가 못 지키는 축 (이름을 남긴다)
 *
 * «시드 위 성공 + 기하 전멸(no-anchors)» 프레임 — frontend 재시도의 실제 발화 —
 * 은 합성 렌더로 재현하지 못했다 (2026-08-30 실측: 정렬된 셀마스크 검출은 가설
 * 팬아웃이 커서 벽이 검증 단계(BODY_RS/format)에 서고, 130점 시드 스윕에서
 * 어긋난-성공은 0건 — ok 창은 단봉 ±0.40 log). 그 축은 실기기 사진 코퍼스
 * (test/output/photos/)의 tri·star daehan 프레임이 생기면 그쪽 게이트가 덮는다.
 * 재시도 루프 자체(조건·1회 한정·소생 전용)는 finder-seed-retry.test.js 가 잰다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeA } from '../src/encodeA.js';
import { encodeK } from '../src/encodeK.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { daehanPatternId } from '../src/finder-daehan.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function renderDaehan(enc) {
  const scene = buildScene(enc, {
    palette: PALETTE, margin: 20, finderPatternId: daehanPatternId(enc.k),
  });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 1 });
}

// 시드 정권이 실제로 이 경로를 타는 두 소비자 — tri(턴A)·star 는 hex 셀수 모델과
// 참 셀수가 다른 패밀리라, bullseye 회귀와 같은 «모델 근사» 위에 서 있는 쪽이다.
const FRAMES = [
  {
    label: 'V2D (tri k10 daehan)',
    text: 'TLcube-V2D',
    family: 'tri',
    make: () => renderDaehan(encodeA('TLcube-V2D', {
      version: 2, eccLevel: 'M', turnA: true, daehanFinder: true,
    })),
  },
  {
    label: 'K1D (star k8 daehan)',
    text: 'TLcube-K1D',
    family: 'star',
    make: () => renderDaehan(encodeK('TLcube-K1D', {
      version: 1, eccLevel: 'M', daehanFinder: true,
    })),
  },
];

function decodeWithProfile(raster, gate) {
  const profile = {};
  const result = decodeFrontend(raster, {
    bootstrap: {
      cellFinderDaehan: true,
      ...(gate ? { disableOutlineSeeds: true } : {}),
      cellFinder: { _proposalProfile: profile },
    },
  });
  return { result, calls: profile.cellFinderCalls || [] };
}

for (const frame of FRAMES) {
  test(`①② ${frame.label} — 시드 정권 보존 + disableOutlineSeeds 실효`, {
    timeout: 120_000,
  }, () => {
    const raster = frame.make();

    // ① 시드 정권(기본)의 성공 프레임 — 소생 전용 수리의 무회귀 파수.
    const seeded = decodeWithProfile(raster, false);
    assert.equal(seeded.result.ok, true,
      frame.label + ' 시드 정권 왕복이 죽었다: ' + (seeded.result.reason || ''));
    assert.equal(seeded.result.text, frame.text);
    assert.equal(seeded.result.family, frame.family);
    assert.ok(seeded.calls.length >= 1,
      '셀파인더가 호출되지 않았다 — 이 프레임이 더는 이 경로를 안 탄다면 자의 전제를 재측정하라');

    // ② 게이트를 켜면 사다리 finder 로 같은 답 — 무시드 재시도 종착지의 실재.
    const gated = decodeWithProfile(raster, true);
    assert.equal(gated.result.ok, true,
      frame.label + ' 무시드(사다리) 경로가 죽었다 — 재시도 종착지가 사라졌다: '
      + (gated.result.reason || ''));
    assert.equal(gated.result.text, frame.text, '사다리 경로가 다른 답을 냈다');
    assert.equal(gated.result.family, frame.family);

    // ②(b) 게이트의 행동적 증거 — 시드 삼중점이 아니라 기하 사다리를 훑었다.
    // 값이 아니라 «엄격 증가» 성질만 잰다: 시드 정권은 시드별 3점(±로그 0.198)만
    // 보고, 사다리는 min→max 등비 전체를 본다. 게이트가 시드 유도에 안 닿으면
    // (2026-08-30 수리 전 상태) 두 규모가 같아져 여기서 잡힌다.
    assert.ok(gated.calls.length >= 1, '게이트 경로에서 셀파인더가 호출되지 않았다');
    assert.ok(gated.calls[0].evaluatedGeometry > seeded.calls[0].evaluatedGeometry,
      'disableOutlineSeeds 가 cell-finder 척도 시드에 닿지 않는다 — 게이트 탐색 규모('
      + gated.calls[0].evaluatedGeometry + ') ≤ 시드 정권(' + seeded.calls[0].evaluatedGeometry + ')');
  });
}
