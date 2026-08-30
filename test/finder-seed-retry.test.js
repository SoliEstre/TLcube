/**
 * finder-seed-retry.test.js — 시드 정권의 기하 전멸은 무시드 재시도로 복구된다.
 *
 * ## 계보 (2026-08-30, V4/k12 편입 회귀)
 *
 * `bootstrap.finderRadiusSeeds` 는 외곽선 면적에서 (family 무관) k 별 반지름을 뽑아
 * `detectBullseyes` 에 힌트로 넘기고, 힌트가 있으면 기하 사다리를 **대체** 한다.
 * hex k=12 셀수(469)와 tri k=10 셀수(496)가 2.84% 로 근접해, V4 편입 뒤 tri k10
 * 프레임(턴A V-CM)에서 k12 힌트가 참 반지름 +2.8% 자리에 앉아 처음으로 «성공» —
 * 어긋난 finder 로 코너 마커 CO2 톤 6셀이 전멸했다 (agreement 15/21 = 0.7143 <
 * 0.78, 벽이 no-format-candidate → no-anchors 로 이동).
 *
 * 세 방향이 실측으로 기각됐다:
 *   · 힌트 «표» 정정(hex+tri 셀수 모델) · k≤10 핀 — 둘 다 V4 왕복(capacity-v4)을
 *     같은 자리에서 죽였다. 근접쌍이 존재하는 한 표로는 못 가른다.
 *   · 힌트·사다리 **합집합** — 성공하던 한계 프레임(H 톤 k6, finder-H ⑥)의 승자
 *     finder 를 바꿔 절대 톤 경로를 죽였다. 점수 서열은 톤 정밀도를 보증하지 않는다.
 *
 * 채택안: **실패 시 무시드 재시도** (frontend.js §무시드 재시도) — 시드 정권은
 * 그대로 두고(성공 프레임 전부 비트 동일), 기하 가설이 전멸(no-anchors)한 시드
 * 프레임만 시드를 끄고 한 번 더 돈다. 소생 전용 방향이다.
 *
 * ⚠ 값 리터럴(참 cellSize·agreement)은 재지 않는다 — 재는 것은 «벽의 위치» 와
 *   «왕복 생존» 이라는 성질이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
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

function render(encoded, sceneOptions = {}) {
  return rasterize(buildScene(encoded, { palette: PALETTE, ...sceneOptions }),
    { pixelsPerUnit: 12, supersample: 1 });
}

// 사고 프레임 — 턴A V2CM + 기존 중앙 + 강제 CO2 톤 (죽어야 하는 음성 대조 조합).
// finder-CO2 ⑥ 의 벽 표와 같은 조건이다.
function wallFrame() {
  return render(encodeA('TLcube', {
    version: 2, eccLevel: 'M', turnA: true, cornerMarker: true, co2AnchorTones: true,
  }), { margin: 20 });
}

test('① 시드 정권의 기하 전멸이 벽을 옮기지 않는다 — 재시도가 포맷 단계까지 닿는다', () => {
  const result = decodeFrontend(wallFrame());
  assert.equal(result.ok, false, '음성 대조 프레임이 살아났다 — 벽 조건을 다시 측정하라');
  // 시드 finder 단독이면 no-anchors(기하 전멸)로 죽는다. 재시도가 사다리 finder 로
  // 코너 마커 가설을 세워, 기준선과 같은 «포맷에서 정직하게 죽는» 벽이 복원된다.
  assert.ok(String(result.reason).includes('no-format-candidate'),
    '벽이 옮겨갔다 — 기대 no-format-candidate · 실제 ' + result.reason
    + ' (no-anchors 면 무시드 재시도가 안 돈 것이다)');
});

test('② 재시도 조건 밖 시드 프레임은 그대로 산다 — H 톤 k6 (합집합 방식의 격침 지점)', () => {
  const encoded = encode('TLcube-H', {
    version: 1, eccLevel: 'M', cornerMarker: true, markerTones: true,
  });
  const result = decodeFrontend(render(encoded));
  assert.equal(result.ok, true,
    'H 톤 k6 왕복이 죽었다 — 시드 정권(성공 프레임)의 finder 가 바뀌었다: ' + (result.reason || ''));
  assert.equal(result.text, 'TLcube-H');
});

test('③ disableOutlineSeeds 옵션은 실제로 시드를 끈다 — 재시도가 도달하는 경로의 실재', () => {
  const result = decodeFrontend(wallFrame(), {
    bootstrap: { disableOutlineSeeds: true },
  });
  // 무시드(사다리) 경로 단독으로도 같은 벽 — 재시도의 목적지가 실재하고 같은 답을 낸다.
  assert.equal(result.ok, false);
  assert.ok(String(result.reason).includes('no-format-candidate'),
    '무시드 경로의 벽이 다르다: ' + result.reason);
});
