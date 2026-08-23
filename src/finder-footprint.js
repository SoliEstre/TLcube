/**
 * finder-footprint.js — Footprint 파인더의 **좌표·톤 정본 유도** (2026-08-23 편입).
 *
 * ─ 정본과 유도 ─────────────────────────────────────────────────────────────
 * 정본: 바깥 repo `.agent/decoder/data/finder-footprint-2026-08-23.json`
 *       (schema `tlcube-cell-editor/v2` · 운영자 셀 편집기 export 2026-08-23 ·
 *       type O · size 4 · 중앙 19셀 · userNonData 19 · toneOverrides 57 = 19셀×3면).
 * 정본은 private repo 라 여기 임베드하지 못한다. 그래서 **표 + 검증 쌍**
 * (finder-daehan.js 전례)을 쓴다: 아래 표는 손 전사가 아니라 유도 스크립트가
 * 정본에서 기계로 찍은 것이고, `deriveFootprintCellLevels` 가 그 유도 규약의
 * 코드 정본이다. `test/finder-footprint.test.js` ① 이 정본 JSON 이 있는
 * 체크아웃에서 전수 재유도해 이 표와 대조한다 — **어긋나면 던진다**.
 *
 * 유도 규약 (OAK 정본 `_note` 와 동일):
 *   · 좌표는 축 좌표 {q,r} → `FINDER_CELL_ORDER` 순서로 정렬
 *   · 톤은 면별 override 이고, export 에 없는 면은 중간톤(1)
 *     ⚠ footprint 정본은 19×3 = 57 면 **전부** override 를 든다 — 중간톤 규약은
 *       이 후보에서 한 번도 발동하지 않고, 표는 0/2 이진이다. 그래도 `cellLevels`
 *       표현을 쓴다 (OAK 계열 공통 표현 — finder-oak-patterns.js §왜 cellLevels 인가).
 *   · 여기 삼중은 [T, L, R]
 *
 * ─ ⚠ 이 정본의 toneOverrides 는 **평면 목록**이다 ──────────────────────────
 * `finder-oak-candidates.json` 은 면 키로 묶인 `{T: [[q,r,tone],…], …}` 이고,
 * 이 export 는 `[{face,q,r,tone}, …]` 평면 목록이다. 형태를 섞어 읽으면 override
 * 0건으로 «전부 중간톤» 이 조용히 유도된다 — 그래서 아래가 override 수 57 을
 * 직접 세어 잠근다.
 *
 * 렌더·검출 등재는 `finder-oak-patterns.js` (id `oak-footprint`) — 이 모듈은
 * 데이터와 유도만 든다. 런타임 의존성 0 · 순수 ESM.
 */

import { FINDER_CELL_ORDER } from './finder-patterns.js';

/** 정본 이름 — 명부(lineup) 조회 키이자 표시명. */
export const FOOTPRINT_NAME = 'Footprint';

/** `cellLevels` 삼중의 면 순서 — OAK 표·검출기·렌더러와 **같은 표**여야 한다. */
export const FOOTPRINT_LEVEL_FACE_INDEX = Object.freeze({ T: 0, L: 1, R: 2 });

/**
 * 19셀 면 톤 [T, L, R] — `FINDER_CELL_ORDER` 순서.
 * 이 블록은 손 전사가 아니다 — 유도 스크립트(정본 → deriveFootprintCellLevels 와
 * 같은 규약)가 기계로 찍었다. 전수 대조: `test/finder-footprint.test.js` ①.
 */
export const FOOTPRINT_CELL_LEVELS = Object.freeze([
  [2, 2, 0], // -2,0
  [0, 2, 2], // -2,1
  [2, 2, 2], // -2,2
  [2, 2, 2], // -1,-1
  [2, 0, 2], // -1,0
  [2, 2, 0], // -1,1
  [0, 2, 2], // -1,2
  [2, 2, 0], // 0,-2
  [0, 0, 0], // 0,-1
  [0, 2, 2], // 0,0
  [2, 0, 2], // 0,1
  [2, 2, 2], // 0,2
  [0, 0, 0], // 1,-2
  [0, 0, 0], // 1,-1
  [2, 2, 0], // 1,0
  [0, 2, 2], // 1,1
  [2, 0, 2], // 2,-2
  [2, 2, 2], // 2,-1
  [2, 0, 2], // 2,0
].map((triple) => Object.freeze([...triple])));

const cellKey = (cell) => cell.q + ',' + cell.r;

/**
 * 정본 편집기 export(파싱된 JSON) → `FINDER_CELL_ORDER` 순 cellLevels.
 *
 * 일회성 손 변환의 대체물이자 대조 테스트의 자다. 정본이 바뀌면 여기가 먼저
 * 던지거나(형태·계수) 테스트 대조가 빨개진다(값). 조용한 폴백은 없다.
 */
export function deriveFootprintCellLevels(doc) {
  if (!doc || doc.schema !== 'tlcube-cell-editor/v2') {
    throw new Error('footprint 유도: 스키마가 tlcube-cell-editor/v2 가 아니다: '
      + (doc && doc.schema));
  }
  if (!Array.isArray(doc.userNonData) || !Array.isArray(doc.toneOverrides)) {
    throw new Error('footprint 유도: userNonData/toneOverrides 배열이 없다');
  }
  const byKey = new Map();
  for (const cell of doc.userNonData) {
    const key = cellKey(cell);
    if (byKey.has(key)) throw new Error('footprint 유도: userNonData 좌표 중복 ' + key);
    // 정본 _note 규약: export 에 없는 면은 중간톤(1).
    byKey.set(key, { T: 1, L: 1, R: 1 });
  }
  if (byKey.size !== FINDER_CELL_ORDER.length) {
    throw new Error('footprint 유도: userNonData 가 ' + FINDER_CELL_ORDER.length
      + ' 셀이 아니다: ' + byKey.size);
  }
  let overrides = 0;
  for (const override of doc.toneOverrides) {
    if (override.face !== 'T' && override.face !== 'L' && override.face !== 'R') {
      throw new Error('footprint 유도: 알 수 없는 면 ' + override.face);
    }
    const tones = byKey.get(cellKey(override));
    if (!tones) {
      throw new Error('footprint 유도: toneOverrides 가 userNonData 밖 좌표를 가리킨다: '
        + cellKey(override));
    }
    tones[override.face] = override.tone;
    overrides += 1;
  }
  if (overrides !== FINDER_CELL_ORDER.length * 3) {
    throw new Error('footprint 유도: override 가 ' + (FINDER_CELL_ORDER.length * 3)
      + ' 면이 아니다: ' + overrides + ' — 평면 목록 형태가 바뀌었나');
  }
  // 좌표 19/19 일치 — 슬롯 좌표가 정본에 전부 있어야 한다 (위 크기 검사와 합쳐
  // 집합 동일까지 잠긴다).
  return FINDER_CELL_ORDER.map((cell) => {
    const tones = byKey.get(cellKey(cell));
    if (!tones) {
      throw new Error('footprint 유도: 슬롯 좌표 ' + cellKey(cell) + ' 가 정본에 없다');
    }
    return [tones.T, tones.L, tones.R];
  });
}

// ── 로드 자기검증 ──────────────────────────────────────────────────────────
// 표 주도 데이터는 조용히 썩는다 (finder-oak-patterns.js 전례). 모듈이 로드되는 것
// 자체가 아래 명제들의 통과를 뜻하게 만든다.
{
  // ① 슬롯과 같은 19행 · [T,L,R] 삼중.
  if (FOOTPRINT_CELL_LEVELS.length !== FINDER_CELL_ORDER.length) {
    throw new Error('footprint: 표가 ' + FINDER_CELL_ORDER.length + ' 행이 아니다: '
      + FOOTPRINT_CELL_LEVELS.length);
  }
  for (const triple of FOOTPRINT_CELL_LEVELS) {
    if (triple.length !== 3) throw new Error('footprint: 톤 삼중이 아니다 ' + triple);
  }

  // ② 톤 값 집합이 정확히 {0, 2} 다 — 정본은 0/2 이진이고(toneLevels dark/bright 만
  //    쓴다), 중간톤이 나타나면 유도 규약의 «없는 면 = 1» 이 발동한 것 = 정본과
  //    어긋난 것이다. 두 값이 다 있으므로 균일 톤(검출기 norm2 = 0 사망)도 아니다.
  const tones = new Set(FOOTPRINT_CELL_LEVELS.flat());
  if (tones.size !== 2 || !tones.has(0) || !tones.has(2)) {
    throw new Error('footprint: 톤 집합이 {0,2} 가 아니다 — '
      + JSON.stringify([...tones].sort()));
  }

  // ③ 정본의 독립 계수 — 밝은 면 T12/L12/R12 (유도 스크립트 실측 2026-08-23).
  //    표가 한 값이라도 썩으면 여기서 잡힌다 (daehan ② 와 같은 가드).
  const bright = { T: 0, L: 0, R: 0 };
  for (const triple of FOOTPRINT_CELL_LEVELS) {
    if (triple[FOOTPRINT_LEVEL_FACE_INDEX.T] === 2) bright.T += 1;
    if (triple[FOOTPRINT_LEVEL_FACE_INDEX.L] === 2) bright.L += 1;
    if (triple[FOOTPRINT_LEVEL_FACE_INDEX.R] === 2) bright.R += 1;
  }
  if (bright.T !== 12 || bright.L !== 12 || bright.R !== 12) {
    throw new Error('footprint: 밝은 면 계수가 정본과 다르다 — ' + JSON.stringify(bright)
      + ' (정본 T12/L12/R12)');
  }
}
