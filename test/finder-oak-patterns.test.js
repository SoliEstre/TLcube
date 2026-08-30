/**
 * finder-oak-patterns.test.js — OAK 후보 편입 (2026-08-18).
 *
 * 이 파일이 지키는 명제는 셋이다.
 *
 *  ① **이진 경로가 안 바뀌었다.** `cellLevels` 도입은 검출기의 목표값 계산과
 *     `lightCount` 정의를 건드렸다. 기존 11개 이진 패턴을 «레벨로 표현한 것» 과
 *     «마스크로 표현한 것» 이 **비트 동일**한 템플릿을 내는지 전수 대조한다.
 *     여기가 초록이면 이 편입은 기존 O/A 검출을 한 값도 안 흔든 것이다.
 *
 *  ② **표가 정본과 같다.** 바깥 repo 의 편집기 export 가 있으면 전수 재유도해
 *     대조한다. 없으면(공개 체크아웃) 그 사실을 밝히고 자기 일관성만 잰다 —
 *     조용히 skip 하지 않는다. skip 은 «통과» 로 읽히고, 그렇게 거짓 초록이 난다.
 *
 *  ③ **라운드트립이 선다.** 생성기가 그린 3레벨 파인더를 검출기가 자기 후보로
 *     되찾고 게이트를 통과하는가. 표현을 둘로 나눠 놓고 이걸 안 재면 «그린 것과
 *     읽는 것» 이 갈려도 아무도 모른다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FINDER_CELL_MASK_PATTERNS, FINDER_CELL_ORDER, FINDER_FACE_BITS,
} from '../src/finder-patterns.js';
import {
  OAK_ALL_FINDER_PATTERNS, OAK_FINDER_PATTERNS, OAK_FINDER_PATTERN_IDS,
  OAK_LEVEL_FACE_INDEX, OAK_RENDER_ONLY_FINDER_PATTERNS,
  getOakFinderPattern, isOakFinderPatternId,
} from '../src/finder-oak-patterns.js';
import { OAK_LINEUP } from '../src/finder-oak-lineup.js';
import { FINDER_CARD_GROUPS } from '../src/finder-card-ui.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, BULLSEYE_MID, DEFAULT_PRESET, getPreset, relativeLuminance,
} from '../src/luminance.js';
import { scoreCellMaskAtHomography, detectCellFinders } from '../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { encode } from '../src/encode.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CANON = ROOT + '../.agent/decoder/data/finder-oak-candidates.json';

/** 이진 마스크 하나를 같은 뜻의 3레벨 삼중으로 옮긴다 (0 → 0, 1 → 2). */
function masksToLevels(cellMasks) {
  return cellMasks.map((mask) => ['T', 'L', 'R'].map(
    (face) => (mask & FINDER_FACE_BITS[face] ? 2 : 0),
  ));
}

test('① 이진 11패턴 — 마스크 표현과 레벨 표현이 같은 템플릿을 낸다', () => {
  // 템플릿 자체는 모듈 밖으로 안 나온다. 대신 **관측 가능한 출구**로 잰다:
  // 같은 휘도장·같은 호모그래피에서 두 표현의 점수가 비트 동일이면 템플릿이 같다.
  const luma = syntheticLuma();
  const H = IDENTITY_H;
  let compared = 0;
  for (const pattern of FINDER_CELL_MASK_PATTERNS) {
    const viaMask = scoreCellMaskAtHomography(luma, [pattern], H, { patternId: pattern.id });
    const viaLevel = scoreCellMaskAtHomography(
      luma,
      [{ id: pattern.id, cellLevels: masksToLevels(pattern.cellMasks) }],
      H,
      { patternId: pattern.id },
    );
    assert.equal(viaMask.ok, viaLevel.ok, pattern.id + ': 성공 여부가 갈렸다');
    if (!viaMask.ok) continue;
    for (const key of ['correlation', 'contrast', 'contrastRatio', 'lightMean', 'darkMean', 'fit']) {
      assert.equal(viaLevel[key], viaMask[key],
        pattern.id + '.' + key + ' 가 표현에 따라 달라졌다 — 이진 경로가 바뀐 것이다');
    }
    compared += 1;
  }
  assert.equal(compared, FINDER_CELL_MASK_PATTERNS.length,
    '이진 패턴 전수를 못 쟀다 — 표본이 준 만큼만 증명된다');
  assert.equal(compared, 11, '이진 패턴이 11개가 아니다 — 이 핀의 전제를 재산정하라');
});

test('② 표가 정본 편집기 export 와 같다 (없으면 자기 일관성만)', () => {
  if (!existsSync(CANON)) {
    // **조용히 통과시키지 않는다.** 정본이 없는 체크아웃에서도 잴 수 있는 것만 잰다.
    assert.equal(OAK_ALL_FINDER_PATTERNS.length, 5, '정본 없이도 후보 수는 고정이다');
    for (const pattern of OAK_ALL_FINDER_PATTERNS) {
      assert.equal(pattern.cellLevels.length, FINDER_CELL_ORDER.length, pattern.id);
    }
    return;
  }
  const canon = JSON.parse(readFileSync(CANON, 'utf8'));
  const byName = new Map(canon.candidates.map((entry) => [entry.name, entry]));
  // W2 신규 2종(2026-08-23)은 **이 정본의 후보가 아니다** — footprint 의 정본은
  // finder-footprint-2026-08-23.json (test/finder-footprint.test.js ① 이 전수 대조),
  // taegeuk-solo 는 finder-daehan.js 유도 (같은 파일 ② 가 대조). 여기서는 «이 정본
  // 밖 후보가 정확히 그 둘뿐» 임을 잠근다 — 늘면 대조 없는 표가 생긴 것이다.
  const outsideThisCanon = OAK_ALL_FINDER_PATTERNS
    .filter((pattern) => !byName.has(pattern.lineupName)).map((pattern) => pattern.id);
  assert.deepEqual(outsideThisCanon.sort(), ['oak-footprint', 'oak-taegeuk-solo'],
    '정본 대조 경로가 없는 OAK 후보 목록이 바뀌었다');
  for (const pattern of OAK_ALL_FINDER_PATTERNS) {
    if (!byName.has(pattern.lineupName)) continue;
    const entry = byName.get(pattern.lineupName);
    assert.ok(entry, pattern.id + ': 정본에 ' + pattern.lineupName + ' 이 없다');
    const tone = { T: new Map(), L: new Map(), R: new Map() };
    for (const face of ['T', 'L', 'R']) {
      for (const cell of (entry.toneOverrides[face] || [])) {
        tone[face].set(cell[0] + ',' + cell[1], cell[2]);
      }
    }
    const derived = FINDER_CELL_ORDER.map((cell) => {
      const key = cell.q + ',' + cell.r;
      // 정본 _note 규약: export 에 없는 면은 중간톤(1).
      return ['T', 'L', 'R'].map((face) => (tone[face].has(key) ? tone[face].get(key) : 1));
    });
    assert.deepEqual(pattern.cellLevels.map((triple) => [...triple]), derived,
      pattern.id + ': 전사가 정본과 다르다');
  }
});

test('② -b 명부와 표가 서로를 가린다 — 표현이 있는 후보는 dead 가 아니다', () => {
  // **의도적 갱신 (C1, 2026-08-23 — Benzene 드랍)**: 원판은 «활성만 표현» 이었는데
  // 규약이 갈라졌다 — 생성은 닫고 판독은 유지. dropped 는 표현이 남는다(발행분 판독
  // + 검출 라인업 안정성), dead 만 표현 금지 (Nitrogen 전례). 카드·상태 스키마는
  // 명부 live-join(finder-card-ui)이 닫는다 — 아래 -c 검사가 그 분업을 잠근다.
  const represented = new Set(OAK_ALL_FINDER_PATTERNS.map((pattern) => pattern.lineupName));
  for (const name of represented) {
    const entry = OAK_LINEUP.find((row) => row.name === name);
    assert.ok(entry, name + ' 이 명부에 없는데 표현이 있다');
    assert.notEqual(entry.status, 'dead', name + ' 은 dead 인데 표현이 있다');
    assert.equal(entry.type, 'O', name + ' 은 타입 O 가 아니다');
  }
  // dropped 인데 표현이 있는 것 = «판독 유지» 대상 — 이름으로 고정 (부재에도 이유가 필요하다).
  const readOnly = [...represented].filter((name) => {
    const entry = OAK_LINEUP.find((row) => row.name === name);
    return entry && entry.status === 'dropped';
  });
  // Aspirin — 운영자 드랍 2026-08-24 (반전판도 실기기 실패·형태상 실익 없음).
  assert.deepEqual(readOnly.sort(), ['Aspirin', 'Benzene', 'Nitrogen r2'],
    '판독-유지 드랍 목록이 바뀌었다 — 명부 note 와 이 목록을 같이 갱신하라');
  const active = OAK_LINEUP.filter((entry) => entry.status === 'active');
  // 표현이 **없는** 활성 후보는 사유가 분명해야 한다. 사유를 값으로 고정해 둔다 —
  // 나중에 «왜 얘만 빠졌지» 를 다시 조사하지 않으려고.
  const missing = active.filter((entry) => !represented.has(entry.name)).map((e) => e.name);
  assert.deepEqual(missing.sort(), ['H2CO3', 'H2O', 'daehan'],
    '표현 없는 활성 후보 목록이 바뀌었다 — 편입했거나 명부가 바뀐 것이다');
});

test('③ 라운드트립 — 생성기가 그린 3레벨 파인더를 검출기가 자기 후보로 되찾는다', () => {
  // 손으로 만든 합성 휘도장이 아니라 **실제 렌더 경로**(buildScene → rasterize)를
  // 탄다. 그래야 이 검사가 «검출기가 자기 표를 읽는가» 가 아니라 «그린 것과 읽는
  // 것이 같은가» 를 재게 된다 — 표현을 두 파일로 나눠 놨으므로 그쪽이 진짜 위험이다.
  const lineup = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS];
  for (const pattern of OAK_FINDER_PATTERNS) {
    const result = detect(render(pattern.id));
    assert.equal(result.ok, true, pattern.id + ': 검출 실패');
    assert.equal(result.candidates[0].patternId, pattern.id,
      pattern.id + ' 프레임이 ' + result.candidates[0].patternId + ' 로 뽑혔다');
    assert.equal(result.candidates[0].orientationSource, 'finder-pattern', pattern.id);
  }
  // 교차 오수용의 **반대 방향**도 본다: 기존 이진 후보 프레임이 OAK 를 라인업에
  // 넣은 뒤에도 여전히 자기 이름으로 뽑히는가. 이게 깨지면 편입이 기존 검출을
  // 오염시킨 것이고, ①(템플릿 동치)만으로는 안 잡힌다.
  for (const pattern of FINDER_CELL_MASK_PATTERNS) {
    const result = detect(render(pattern.id), lineup);
    assert.equal(result.ok, true, pattern.id + ': OAK 편입 후 검출 실패');
    assert.equal(result.candidates[0].patternId, pattern.id,
      pattern.id + ' 가 OAK 편입 후 ' + result.candidates[0].patternId + ' 로 뽑혔다');
  }
});

test('중간톤 상수는 선형 상대휘도 0.5 다 — 8비트 절반(128)이 아니다', () => {
  const mid = relativeLuminance(BULLSEYE_MID);
  assert.equal(relativeLuminance(BULLSEYE_DARK), 0);
  assert.equal(relativeLuminance(BULLSEYE_LIGHT), 1);
  assert.ok(Math.abs(mid - 0.5) < 0.005, '중간톤 Y=' + mid + ' 가 0.5 에서 멀다');
  // 128 이면 안 되는 이유를 값으로 남긴다 (감마를 잊는 것이 이 자리의 표준 실수다).
  assert.ok(relativeLuminance({ r: 128, g: 128, b: 128 }) < 0.25,
    '8비트 128 의 상대휘도가 0.25 미만이 아니다 — 이 경고의 전제가 바뀌었다');
});

test('조회·카드 그룹 배선', () => {
  // **의도적 갱신 (2026-08-23, W2 선행)** — 검출 표는 3 → 4 (footprint, 운영자 셀
  // 편집기 신작). taegeuk 단독(daehan 내부 19 유도)은 **렌더 전용 표**에 있다 —
  // 검출 라인업에 넣으면 daehan 프레임을 부분집합 오수용으로 가로챈다
  // (OAK_RENDER_ONLY_FINDER_PATTERNS 헤더 실측 — 편입은 통합자 몫).
  assert.deepEqual([...OAK_FINDER_PATTERN_IDS],
    ['oak-nitrogen-r2', 'oak-aspirin', 'oak-benzene', 'oak-footprint']);
  assert.deepEqual(OAK_RENDER_ONLY_FINDER_PATTERNS.map((pattern) => pattern.id),
    ['oak-taegeuk-solo']);
  for (const id of [...OAK_FINDER_PATTERN_IDS, 'oak-taegeuk-solo']) {
    assert.equal(isOakFinderPatternId(id), true, id);
    assert.ok(getOakFinderPattern(id), id);
  }
  assert.equal(isOakFinderPatternId('bullseye'), false);
  assert.equal(getOakFinderPattern('없는-id'), undefined);
  // 카드는 «렌더 표현 ∩ 명부 active» 에서 유도된다 (C1 live-join, 2026-08-23) —
  // 렌더 전용(taegeuk-solo)은 카드에 있고(그릴 수 있으면 고를 수 있다), 드랍된
  // Benzene·Aspirin(2026-08-24)·Nitrogen r2(2026-08-30) 은 표현이 남아도
  // (판독 유지) 카드에서 빠진다.
  assert.deepEqual(FINDER_CARD_GROUPS.oak.map((card) => card.id),
    ['oak-footprint', 'oak-taegeuk-solo']);
  // OAK 카드는 기존 그룹 어디에도 안 섞였다 (계보가 카드로 읽혀야 한다).
  for (const group of ['formal', 'generated', 'refined']) {
    for (const card of FINDER_CARD_GROUPS[group]) {
      assert.equal(isOakFinderPatternId(card.id), false, group + ' 에 OAK 가 섞였다: ' + card.id);
    }
  }
  assert.deepEqual(OAK_LEVEL_FACE_INDEX, { T: 0, L: 1, R: 2 });
});

// ── 렌더·검출 헬퍼 ────────────────────────────────────────────────────────
// decoder-cell-finder.test.js 와 **같은 경로**를 쓴다. 다른 경로로 재면 그 차이가
// 결과 차이로 오해된다.

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
});

function render(patternId, text = 'oak-finder') {
  const encoded = encode(text, { version: 2, eccLevel: 'M' });
  const scene = buildScene(encoded, { palette: PALETTE, finderPatternId: patternId });
  return rasterize(scene, { pixelsPerUnit: 12, supersample: 2 });
}

function detect(raster, patternInput) {
  return detectCellFinders(toRelativeLuminance(raster),
    patternInput || [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS],
    { cellSizeSeeds: [12] });
}

// ① 은 두 표현의 **차이만** 보므로 어떤 휘도장이든 된다 — 결정적 의사난수로 만든다
// (Math.random 은 재현을 깬다).
const FRAME = 420;
const IDENTITY_H = Object.freeze([12, 0, FRAME / 2, 0, 12, FRAME / 2, 0, 0, 1]);

function syntheticLuma() {
  const data = new Float32Array(FRAME * FRAME);
  let seed = 20260818;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed % 1000) / 1000;
  }
  return { width: FRAME, height: FRAME, data };
}
