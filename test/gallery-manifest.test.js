/**
 * gallery-manifest.test.js — 레퍼런스 갤러리 조합 축이 **유도인가** (PM/022 항목 12).
 *
 * 갤러리는 «지금 살아 있는 후보» 를 찍는 장치다. 조합 표가 손 목록이면 드랍된 후보를
 * 계속 굽고(그 사진으로 A/B 를 하게 되고), 새로 편입된 후보는 영영 안 찍힌다. 그래서
 * 이 파일이 재는 것은 그림이 아니라 **표의 출처**다:
 *
 *   ① 중앙 파인더 축 = 정식 normal 3장 ∪ (렌더 표현 카드 ∩ 명부 active)
 *   ② live 명부 6행 전수 — 축에 없으면 **이유가 있어야 한다** (부재에도 이유가 필요하다)
 *   ③ Type Y 축 = 활성 레이아웃과 1:1 (드랍 레이아웃은 없다)
 *   ④ 버전 축 = 해상도 티어 표 유도 · 조합 id 유일 · 허용값 안
 *   ⑤ 매니페스트가 구워져 있으면 그 표와 조합 유도가 1:1 (파일 실재까지)
 *
 * ⑤ 는 산출물이 gitignore 구역이라 없을 수 있다 — 그때도 **skip 하지 않는다**
 * (finder-oak-patterns.test.js 전례: 없으면 자기 일관성만으로 실패 가능하게 남긴다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GALLERY_TYPES, centralFinderAxis, fallbackForCombo, galleryCombos, gallerySummary,
  lineupCoverage, lineupRowForPattern, yLayoutCoverage, yLocatorAxis,
} from '../tools/gallery-axes.mjs';
import { payloadLadder } from '../tools/gallery-render.mjs';
import {
  CELL_SURFACE_FINAL_ACTIVE_IDS, CELL_SURFACE_FINAL_DROPPED_IDS,
} from '../src/cellSurfaceFinal.js';
import { FINDER_CARD_GROUPS } from '../src/finder-card-ui.js';
import { OAK_ALL_FINDER_PATTERNS } from '../src/finder-oak-patterns.js';
import { OAK_LINEUP, liveOakCandidates } from '../src/finder-oak-lineup.js';
import { OFFICIAL_NORMAL_CENTRAL_IDS } from '../src/finder-zone-ui.js';
import { CENTER_QR_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import {
  GENERATOR_STATE_SCHEMA, RESOLUTION_TIER_VERSIONS,
} from '../src/generator-state.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GALLERY_DIR = path.join(REPO_ROOT, 'test', 'output', 'gallery');

test('① 중앙 파인더 축은 정식 normal ∪ (렌더 카드 ∩ 명부 active) 유도다', () => {
  const axis = centralFinderAxis();
  const official = axis.filter((row) => row.group === 'official').map((row) => row.id);
  assert.deepEqual(official, [...OFFICIAL_NORMAL_CENTRAL_IDS],
    '기준선 군이 정식 normal 3장 유도와 어긋났다');

  // 명부 군을 **여기서 다시 유도**해 대조한다 — 두 유도가 갈리면 어느 한쪽이 손 목록이다.
  const expectedLineup = [...FINDER_CARD_GROUPS.oak, ...FINDER_CARD_GROUPS.daehan]
    .map((card) => card.id)
    .filter((id) => {
      const pattern = OAK_ALL_FINDER_PATTERNS.find((p) => p.id === id);
      if (!pattern) return true; // daehan 처럼 다른 표에 사는 카드
      const row = lineupRowForPattern(pattern);
      return row === null || row.status === 'active';
    });
  assert.deepEqual(
    axis.filter((row) => row.group === 'lineup').map((row) => row.id),
    expectedLineup,
    '명부 군 유도가 카드 × 명부 지위 조인과 어긋났다');

  for (const row of axis) {
    assert.ok(GENERATOR_STATE_SCHEMA.finderPatternId.options.includes(row.id),
      `축의 파인더 ${row.id} 가 생성기 허용값 밖이다`);
  }
});

test('① 드랍·폐기 후보는 축에 없다 (Benzene · Aspirin · Xylene · 구 Nitrogen)', () => {
  const axisIds = new Set(centralFinderAxis().map((row) => row.id));
  const blocked = OAK_LINEUP.filter((row) => row.status !== 'active');
  assert.ok(blocked.length >= 4, '드랍·폐기 행이 사라졌다 — 기록 보존 규약 위반 아닌가');
  for (const row of blocked) {
    const pattern = OAK_ALL_FINDER_PATTERNS
      .find((p) => (p.lineupName === undefined ? p.name : p.lineupName) === row.name);
    if (!pattern) continue; // 렌더 표현 자체가 없는 행 (Xylene · 구 Nitrogen)
    assert.ok(!axisIds.has(pattern.id),
      `${row.name}(${row.status}) 의 렌더 표현 ${pattern.id} 가 축에 살아 있다`);
  }
  // 이름으로도 한 번 — 문자열이 바뀌어도 «벤젠·아스피린이 빠졌다» 는 사실은 남아야 한다.
  for (const name of ['Benzene', 'Aspirin']) {
    const row = OAK_LINEUP.find((entry) => entry.name === name);
    assert.equal(row.status, 'dropped', `${name} 이 드랍이 아니다 — 갤러리 축 기대가 바뀐다`);
  }
});

test('② live 명부 6행은 전수 대조된다 — 축에 없으면 이유가 있다', () => {
  const coverage = lineupCoverage();
  assert.equal(coverage.length, liveOakCandidates().length,
    '명부 대조표가 live 명부 행 수와 다르다');
  const axisIds = new Set(centralFinderAxis().map((row) => row.id));
  for (const row of coverage) {
    if (row.inAxis) {
      assert.ok(axisIds.has(row.cardId), `${row.name} 이 inAxis 인데 축에 카드가 없다`);
      assert.equal(row.reasons.length, 0, `${row.name} 은 축에 있는데 제외 사유가 붙었다`);
    } else {
      assert.ok(row.reasons.length > 0,
        `${row.name} 이 축에서 빠졌는데 이유가 없다 — 부재에도 이유가 필요하다`);
    }
  }
  // Type K 는 생성기 타입 밖이라 반드시 빠진다 (Wave 3 에 들어오면 이 단언이 먼저 깨진다).
  const k = coverage.find((row) => row.type === 'K');
  if (k) {
    assert.equal(k.inAxis, false, 'Type K 후보가 축에 들었다 — 생성기 타입이 늘었나');
    assert.ok(!GALLERY_TYPES.includes('K'), 'GALLERY_TYPES 에 K 가 생겼다 — 축을 다시 짜라');
  }
});

test('③ Type Y 축은 활성 레이아웃과 1:1 이고 드랍 레이아웃을 안 굽는다', () => {
  const coverage = yLayoutCoverage();
  assert.deepEqual(coverage.missing, [], '활성 레이아웃 중 갤러리가 안 굽는 것이 있다');
  assert.deepEqual(coverage.extra, [], '활성 목록 밖 레이아웃을 굽고 있다');
  assert.deepEqual(coverage.covered, [...CELL_SURFACE_FINAL_ACTIVE_IDS].sort());

  const dropped = new Set(CELL_SURFACE_FINAL_DROPPED_IDS);
  for (const row of yLocatorAxis()) {
    assert.ok(GENERATOR_STATE_SCHEMA.locatorProfileY.options.includes(row.profile),
      `Y 축의 프로파일 ${row.profile} 가 생성기 허용값 밖이다`);
    if (row.layoutId !== null) {
      assert.ok(!dropped.has(row.layoutId), `드랍 레이아웃 ${row.layoutId} 를 굽고 있다`);
    }
  }
});

test('④ 조합 id·버전·폴백이 유도 규약을 지킨다', () => {
  const combos = galleryCombos();
  assert.ok(combos.length > 0, '조합이 비었다');
  const ids = combos.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, '조합 id 가 중복이다 — 파일이 서로를 덮는다');

  for (const combo of combos) {
    assert.equal(combo.id, `${combo.type}-V${combo.version}-${combo.axisId}`,
      '조합 id 규약(<type>-V<version>-<axisId>)이 깨졌다');
    assert.ok(GALLERY_TYPES.includes(combo.type), `알 수 없는 타입: ${combo.type}`);
    const tierVersions = Object.values(RESOLUTION_TIER_VERSIONS[combo.type]);
    if (combo.type === 'Y' && combo.layoutId !== null && combo.layoutId !== undefined) {
      // 셀 표면 레이아웃은 n 이 레이아웃 정의라 버전을 레이아웃이 정한다.
      assert.ok(Number.isInteger(combo.version), 'Y 레이아웃 조합의 버전이 정수가 아니다');
    } else {
      assert.ok(tierVersions.includes(combo.version),
        `${combo.id} 의 버전이 해상도 티어 표 밖이다 (${tierVersions.join(',')})`);
    }
    const fallback = fallbackForCombo(combo);
    if (combo.axisId === CENTER_QR_FINDER_PATTERN_ID) {
      assert.equal(fallback.mode, 'center', '중앙 QR 조합의 폴백이 center 가 아니다');
    } else {
      assert.equal(fallback.mode, 'corner', '그 외 조합의 폴백이 corner 가 아니다');
    }
  }
  // 타입마다 대조(control) 조합이 정확히 하나.
  for (const type of GALLERY_TYPES) {
    const controls = combos.filter((c) => c.type === type && c.control);
    assert.equal(controls.length, 1, `타입 ${type} 의 대조 조합이 1개가 아니다`);
  }
});

test('④ 표본 자기식별 페이로드는 조합끼리 유일하다 (최저 칸까지)', () => {
  const combos = galleryCombos();
  for (let rung = 0; rung < payloadLadder(combos[0]).length; rung += 1) {
    const texts = combos.map((combo) => payloadLadder(combo)[rung]);
    assert.equal(new Set(texts).size, texts.length,
      `페이로드 사다리 ${rung} 칸이 조합 간 중복이다 — 사진에서 조합을 못 가른다`);
  }
});

test('⑤ 구워진 매니페스트가 있으면 조합 유도와 1:1 이다', () => {
  const manifestPath = path.join(GALLERY_DIR, 'manifest.json');
  const combos = galleryCombos();
  if (!existsSync(manifestPath)) {
    // 산출물은 gitignore 구역이라 없을 수 있다 — 그래도 skip 하지 않는다.
    // 요약 유도만으로도 축이 서 있는지는 여기서 죽는다.
    const summary = gallerySummary();
    assert.equal(summary.comboCount, combos.length);
    assert.ok(summary.centralFinderAxis.length > 0);
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.combos.map((row) => row.id), combos.map((c) => c.id),
    '매니페스트 조합이 현행 유도와 어긋났다 — gallery-render.mjs 를 다시 돌려라');
  for (const row of manifest.combos) {
    if (row.status === 'unrenderable') {
      assert.ok(row.error, `${row.id} 가 렌더 불가인데 사유가 없다`);
      continue;
    }
    assert.ok(row.file, `${row.id} 에 파일 경로가 없다`);
    assert.ok(existsSync(path.join(GALLERY_DIR, row.file)),
      `${row.id} 의 PNG 가 없다: ${row.file}`);
    assert.ok(row.payload, `${row.id} 에 표본 자기식별 페이로드가 없다`);
    assert.ok(row.selfCheck && row.selfCheck.ok !== undefined,
      `${row.id} 에 자체검증 기록이 없다`);
  }
  const payloads = manifest.combos.filter((row) => row.payload).map((row) => row.payload);
  assert.equal(new Set(payloads).size, payloads.length,
    '구워진 페이로드가 중복이다 — 사진에서 조합을 못 가른다');
});
