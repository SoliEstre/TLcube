/**
 * finder-seed-union.test.js — 파인더 «반지름 힌트» 는 기하 사다리를 대체하지 않는다.
 *
 * ## 왜 이 파일이 있나 (2026-08-29)
 *
 * `bootstrap.finderRadiusSeeds` 는 외곽선 면적에서 (family 무관) k 별 반지름을 뽑아
 * `detectBullseyes` 에 힌트로 넘긴다. 그 힌트가 사다리를 **대체** 하던 시절엔, 힌트 모델이
 * 조금이라도 어긋난 프레임에서 참 반지름이 애초에 후보로 안 올라왔다 — 게다가 어긋난
 * 힌트 쪽이 «성공» 을 반환하면 호출자의 무시드 재시도마저 안 돌아 **선점** 이 완성된다.
 *
 * 실측한 사고: hex k=12 셀수(469)와 tri k=10 셀수(496)가 2.8% 밖에 안 떨어져 있어,
 * V4(k=12) 편입 뒤 tri k10 프레임(턴A V-CM)에서 k12 힌트가 참 반지름 +2.8% 자리에 앉아
 * 처음으로 «성공» 했다. 2.9% 어긋난 finder 로 코너 마커 CO2 6셀이 전멸했고
 * (agreement 0.7143 < 0.78) 벽이 no-format-candidate 에서 no-anchors 로 옮겨갔다.
 *
 * 힌트 «표» 를 고치는 두 방향(셀수 모델 정정 · k≤10 핀)은 **둘 다 반대 축을 죽였다**.
 * 두 셀수가 근접해 있는 한 표로는 못 가른다. 그래서 고친 곳은 표가 아니라 **결정하는
 * 단계** — 힌트와 사다리가 한 패스에 공존하고 하류 점수가 가른다.
 *
 * ## 무엇을 성질로 재나
 *   ① 공존 — 힌트를 줘도 무시드 사다리의 원시 제안이 그대로 남는다.
 *      (대체 시절엔 이 비율이 **0** 이었다 — 3프레임 × 2방향 전부. 지금은 96\~98%.)
 *   ② 선점 없음 — 힌트 경로가 «성공» 한 프레임에서도, 같은 luma 를 **순수 사다리로**
 *      돌린 대조군과 이긴 finder 의 cellSize 가 일치한다.
 *
 * ⚠ cellSize 참값을 리터럴로 적지 않는다. 참값은 매 실행에서 대조군이 만든다 —
 *   렌더·다운샘플이 바뀌면 두 값이 함께 움직이고, 재는 성질만 남는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { rasterize } from '../src/raster.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { BULLSEYE_DISCOVERY_TEST_ONLY } from '../src/decoder/bullseye-detect.js';
import { enumerateGeometryHypotheses } from '../src/decoder/bootstrap.js';
import { cellCount } from '../src/hexgrid.js';
import { regionCellsTurnA } from '../src/placementA.js';
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

const { collectRawProposals } = BULLSEYE_DISCOVERY_TEST_ONLY;

/**
 * 사고를 일으킨 «어긋남» 그 자체 — 힌트 표가 hex k=12 셀수로 잰 반지름과 tri k=10 의
 * 실제 셀수가 만드는 반지름의 비. 두 수를 베끼지 않고 **두 표에서 그대로 읽는다** —
 * 어느 쪽 표가 움직여도 이 자가 같이 움직이고, 근접이 사라지면 아래 첫 단언이 그걸 말한다.
 */
const SEED_MODEL_ERROR = Math.sqrt(regionCellsTurnA(10).length / cellCount(12));

function lumaOf(encoded) {
  return toRelativeLuminance(rasterize(
    buildScene(encoded, { palette: PALETTE, margin: 20 }),
    { pixelsPerUnit: 12, supersample: 1 },
  ));
}

test('① 공존 — 반지름 힌트를 줘도 무시드 사다리의 원시 제안이 남는다', () => {
  // 힌트가 사다리를 «대체» 하던 시절 이 비율은 정확히 0 이었다 (3프레임 × 2방향 전부).
  assert.ok(SEED_MODEL_ERROR > 1.02 && SEED_MODEL_ERROR < 1.05,
    '시드 모델 어긋남이 2\~5% 대가 아니다 (' + SEED_MODEL_ERROR
    + ') — 셀수 표가 바뀌었으면 이 시나리오를 다시 세워라');

  const FRAMES = [
    ['hex-V4/M', () => encode('v4 frontend 대용량', { version: 4, eccLevel: 'M' })],
    ['tri-A2 턴A/M', () => encodeA('turna v2', { version: 2, eccLevel: 'M', turnA: true })],
    ['tri-A2 V-CM+CO2/M', () => encodeA('TLcube', {
      version: 2, eccLevel: 'M', turnA: true, cornerMarker: true, co2AnchorTones: true,
    })],
  ];
  // 원시 제안의 동일성은 «중심 + 바깥 반지름» 이다 (vote 는 같은 반지름이면 같은 값).
  const key = (proposal) => proposal.center.x + '|' + proposal.center.y
    + '|' + proposal.outerRadius;

  for (const [label, make] of FRAMES) {
    const luma = lumaOf(make());
    const ladder = collectRawProposals(luma, {});
    assert.ok(ladder.length > 0, label + ': 무시드 사다리가 제안을 하나도 못 냈다');

    for (const direction of [SEED_MODEL_ERROR, 1 / SEED_MODEL_ERROR]) {
      // 가장 표를 많이 받은 사다리 제안을 «참» 으로 두고 그만큼 어긋난 힌트를 만든다.
      const seed = ladder[0].outerRadius * direction;
      const seeded = collectRawProposals(luma, { outerRadiusSeeds: [seed] });
      const seededKeys = new Set(seeded.map(key));
      const kept = ladder.filter((proposal) => seededKeys.has(key(proposal))).length;
      const ratio = kept / ladder.length;
      const tag = label + ' ×' + direction.toFixed(4) + ': ';
      // 힌트 반지름이 사다리 눈금과 22% 안쪽이면 원시 NMS 가 둘 중 하나를 지운다.
      // 그래서 «전부» 가 아니라 «압도적 다수» 를 요구한다 — 0 과는 자릿수가 다르다.
      assert.ok(ratio >= 0.9,
        tag + '사다리 제안이 ' + kept + '/' + ladder.length
        + ' 만 남았다 — 힌트가 사다리를 대체하고 있다 (대체 시절 값 = 0)');
      assert.ok(seeded.length >= ladder.length,
        tag + '힌트를 줬더니 제안 수가 줄었다 (' + seeded.length + ' < ' + ladder.length
        + ') — 합집합이 아니다');
    }
  }
});

test('② 선점 없음 — 힌트가 성공하는 프레임도 순수 사다리 대조군과 같은 finder 로 간다', () => {
  // 이 프레임이 바로 사고 현장이다: k12 힌트가 참 반지름 +2.8% 에서 «성공» 해
  // 무시드 재시도를 막았다.
  const luma = lumaOf(encodeA('TLcube', {
    version: 2, eccLevel: 'M', turnA: true, cornerMarker: true, co2AnchorTones: true,
  }));

  // 대조군은 **같은 luma** 를 순수 사다리로 돈다. `outerRadiusSeeds: []` 는 힌트 0개 →
  // 합집합이 사다리 그 자체이고, 호출자 고정 탐색이라 재시도 경로도 안 탄다.
  const legs = [
    ['기본(힌트 있음)', 'seeded', enumerateGeometryHypotheses(luma, undefined, {})],
    ['순수 사다리', 'ladder', enumerateGeometryHypotheses(luma, undefined, {
      finder: { outerRadiusSeeds: [] },
    })],
  ];

  const finders = {};
  for (const [name, slot, result] of legs) {
    assert.equal(result.ok, true, name + ': 기하 가설이 하나도 안 섰다 ('
      + result.reason + ')');
    const hypothesis = result.hypotheses[0];
    // QR 트리플 폴백으로 새면 cellSize 가 4배로 튀어 «일치» 가 무의미해진다.
    // 두 다리 모두 이 프레임의 실제 (family, k) 위에 서 있어야 대조가 성립한다.
    assert.equal(hypothesis.family, 'tri', name + ': family 가 tri 가 아니다');
    assert.equal(hypothesis.k, 10, name + ': k 가 10 이 아니다');
    const finder = hypothesis.finder;
    assert.ok(finder && Number.isFinite(finder.cellSize) && finder.cellSize > 0,
      name + ': 이긴 가설에 finder cellSize 가 없다');
    finders[slot] = finder;
  }

  const relativeGap = Math.abs(finders.seeded.cellSize / finders.ladder.cellSize - 1);
  // 가르는 자: 시드 모델 어긋남(≈2.8%)의 1/3. 힌트가 패스를 가로챘다면 이 값은
  // 어긋남 전체 크기로 벌어진다 — 실측은 0(같은 후보가 이긴다).
  const limit = (SEED_MODEL_ERROR - 1) / 3;
  assert.ok(relativeGap < limit,
    '힌트 경로의 finder 가 순수 사다리와 ' + (relativeGap * 100).toFixed(3)
    + '% 어긋났다 (한계 ' + (limit * 100).toFixed(3) + '%) — 힌트가 패스를 선점했다');

  // 중심도 같이 잰다. 스케일만 맞고 중심이 밀리면 코너 마커 톤이 다시 죽는다.
  const centerShift = Math.hypot(
    finders.seeded.center.x - finders.ladder.center.x,
    finders.seeded.center.y - finders.ladder.center.y,
  ) / finders.ladder.cellSize;
  assert.ok(centerShift < 0.25,
    '힌트 경로의 finder 중심이 순수 사다리 대비 ' + centerShift.toFixed(3)
    + ' 셀 밀렸다 — 선점의 다른 얼굴이다');
});
