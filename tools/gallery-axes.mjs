/**
 * gallery-axes.mjs — 레퍼런스 갤러리의 **조합 축 유도** (PM/022 항목 12 · 1차).
 *
 * ─ 왜 유도인가 ─────────────────────────────────────────────────────────────
 * 조합 표를 손 목록으로 들면 반드시 원본과 어긋난다 (F-37 전례 · 메모리
 * `hand-maintained-parallel-lists-rot`). 갤러리는 «지금 살아 있는 후보» 를 찍는
 * 장치이므로, 드랍된 후보(Benzene 2026-08-23 · Aspirin 2026-08-24)가 이 표에서
 * **자동으로** 빠져야 한다. 그래서 축을 세 live 원천에서만 유도한다:
 *
 *   ① 중앙 파인더 카드 — `FINDER_CARD_GROUPS`(finder-card-ui.js).
 *      oak 행은 이미 명부 live-join 이다 (`OAK_LINEUP.status === 'active'`) —
 *      드랍하면 카드가 닫히고, 카드가 닫히면 이 축에서도 사라진다.
 *   ② 정식 normal 중앙 3장 — `OFFICIAL_NORMAL_CENTRAL_IDS`(finder-zone-ui.js).
 *      기준선(baseline) 군이다.
 *   ③ Type Y 활성 레이아웃 — `CELL_SURFACE_FINAL_ACTIVE_IDS`(cellSurfaceFinal.js)
 *      를 **로케이터 프로파일 경유로** 유도한다: 생성기 상태 스키마의 live 프로파일
 *      목록을 `encodeOptionsForY` 에 넣어 나온 `cellSurfaceLayout` 이 곧 활성
 *      레이아웃이다. 두 목록의 1:1 은 아래 자기검증 + `test/gallery-manifest.test.js`
 *      가 잰다.
 *
 * 버전 축도 손 목록이 아니다 — `RESOLUTION_TIER_VERSIONS`(생성기 해상도 티어)를
 * 그대로 쓴다. Type 마다 번호가 다르므로(O 1·2·3 / A·Y 0·1·2) «V1» 이라는 절대
 * 번호가 아니라 **티어**(low = 기본 · high = 대조)가 축이다.
 *
 * ─ 이 모듈이 하지 않는 것 ──────────────────────────────────────────────────
 * 인코딩·렌더는 `gallery-render.mjs` 가 한다. 여기는 «무엇을 구울지» 만 정한다 —
 * 테스트가 렌더 없이 축만 대조할 수 있어야 하기 때문이다.
 */

import { CELL_SURFACE_FINAL_ACTIVE_IDS, hasCenterQrSlot } from '../src/cellSurfaceFinal.js';
import { DAEHAN_FINDER_PATTERNS } from '../src/finder-daehan.js';
import { FINDER_CARD_GROUPS } from '../src/finder-card-ui.js';
import { OAK_ALL_FINDER_PATTERNS } from '../src/finder-oak-patterns.js';
import { OAK_LINEUP, liveOakCandidates } from '../src/finder-oak-lineup.js';
import { OFFICIAL_NORMAL_CENTRAL_IDS } from '../src/finder-zone-ui.js';
import { SEAT_DEFAULT_FINDER } from '../src/finder-taxonomy.js';
import { CENTER_QR_FINDER_PATTERN_ID } from '../src/finder-selection.js';
import { encodeOptionsForY } from '../src/generator-render-config.js';
import {
  GENERATOR_DEFAULT_FINDER_PATTERN_ID,
  GENERATOR_STATE_SCHEMA,
  GENERATOR_TYPES,
  RESOLUTION_TIER_VERSIONS,
} from '../src/generator-state.js';

/** 1차 갤러리가 쓰는 티어 두 개 — low = 기본판, high = 대조판. */
export const GALLERY_TIERS = Object.freeze(['low', 'high']);

/** 대조(high)는 **타입마다 한 조합**만 굽는다 — 기본 파인더/기본 로케이터로. */
export const GALLERY_CONTROL_TIER = 'high';
export const GALLERY_BASE_TIER = 'low';

/** O/A 조합의 QR 폴백 — 생성기 상태 기계와 같은 규약. */
const DEFAULT_QR_CORNER = 'TL';

/**
 * 갤러리 축에 쓰는 타입.
 *
 * ⚠ **GENERATOR_TYPES 와 일부러 분리한다** (2026-08-25). 종전에는 그대로 별칭이었고
 * 「Type K 는 아직 없다」는 주석이 붙어 있었는데, K 가 생성기에 편입되는 순간 갤러리가
 * K 조합을 굽기 시작한다 — 그런데 갤러리는 **이미지를 굽는 표면**이고 K 캡처 규약도
 * 참조 산출물도 아직 없다. 축이 자동으로 넓어지면 «빈 칸이 있는 갤러리» 가 조용히 는다.
 *
 * 그래서 배제는 **자동 파생이 아니라 명시**로 둔다 — 부재에도 이유가 필요하다.
 * 해제 조건: K 캡처 규약(gallery-captures) + 참조 산출물이 서면 이 목록에서 걷는다.
 */
const GALLERY_EXCLUDED_TYPES = Object.freeze(['K']);
export const GALLERY_TYPES = Object.freeze(
  GENERATOR_TYPES.filter((t) => !GALLERY_EXCLUDED_TYPES.includes(t)),
);
if (GALLERY_TYPES.length === 0) {
  throw new Error('갤러리 타입 축이 비었다 — 제외 목록이 생성기 타입을 전부 먹었다');
}

function assertKnownFinderId(id) {
  if (!GENERATOR_STATE_SCHEMA.finderPatternId.options.includes(id)) {
    throw new Error('갤러리 축의 파인더 id 가 생성기 허용값 밖이다: ' + id
      + ' — 카드 유도가 깨졌거나 상태 스키마가 어긋났다');
  }
  return id;
}

/** 렌더 표현 전부 (oak + daehan 잘림본) — 명부 조인의 왼쪽. */
function renderPatternsById() {
  const rows = new Map();
  for (const pattern of OAK_ALL_FINDER_PATTERNS) rows.set(pattern.id, pattern);
  for (const pattern of DAEHAN_FINDER_PATTERNS) rows.set(pattern.id, pattern);
  return rows;
}

/**
 * 렌더 표현 → 명부 행 **조인 키는 이름**이다 (`lineupName` 우선, 없으면 `name`).
 *
 * ⚠ 실측 2026-08-24: `params.candidate` 로 잇는 finder-card-ui.js 의 live-join 은
 * 두 행에서 **안 걸린다** — Footprint(`O-footprint` vs candidate
 * `O-footprint-fullsurface`) · daehan(`O-daehan` vs `O-daehan-k10-fullsurface`).
 * 그쪽은 «행이 없으면 통과» 규칙이라 조용히 카드가 살아 있고, 그 둘을 명부에서
 * 드랍해도 카드가 안 닫힌다. 갤러리는 그 구멍을 물려받지 않으려고 이름으로 잇고,
 * 조인 불일치 자체를 `candidateJoins: false` 로 표에 남긴다 (보고서 제안 항목).
 */
export function lineupRowForPattern(pattern) {
  const key = pattern.lineupName === undefined ? pattern.name : pattern.lineupName;
  return OAK_LINEUP.find((row) => row.name === key) || null;
}

/**
 * 중앙 파인더 축 (Type O/A 공용).
 *
 * · `official` — 정식 normal 3장 (기준선).
 * · `lineup`   — 운영자 편집기 계보의 **live 카드**: oak 행 + daehan 대표 카드에
 *                **이름 조인 명부 지위(active)** 를 한 번 더 건다. 드랍(Benzene ·
 *                Aspirin)은 카드 유도에서 이미 빠지고, 카드 조인이 못 잡는 행
 *                (Footprint · daehan)도 여기서 닫힌다.
 */
export function centralFinderAxis() {
  const rows = [];
  const seen = new Set();
  const patterns = renderPatternsById();
  const push = (id, group) => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push(Object.freeze({ id: assertKnownFinderId(id), group }));
  };
  for (const id of OFFICIAL_NORMAL_CENTRAL_IDS) push(id, 'official');
  for (const card of [...FINDER_CARD_GROUPS.oak, ...FINDER_CARD_GROUPS.daehan]) {
    const pattern = patterns.get(card.id);
    const row = pattern ? lineupRowForPattern(pattern) : null;
    // 명부에 이름이 있으면 지위를 따르고, 아예 없으면(명부 밖 계보) 카드를 믿는다.
    if (row && row.status !== 'active') continue;
    push(card.id, 'lineup');
  }
  return Object.freeze(rows);
}

/**
 * live 명부(`liveOakCandidates`) → 갤러리 축 편입 여부의 **대조표**.
 *
 * 명부 6행 중 몇은 중앙 19셀 렌더 표현이 없다. 그것을 손으로 지우지 않고 여기서
 * «왜 안 구워지는가» 를 유도해 남긴다 — 갤러리 매니페스트와 보고서가 이 표를
 * 그대로 싣는다 («부재에도 이유가 필요하다»).
 *
 *   · 렌더 표현 있음 → oak 패턴 표(또는 daehan 표)에 candidate 로 걸린다.
 *   · 타입이 생성기에 없음 → Type K (Wave 3 미구현) — `GENERATOR_TYPES` 에서 유도.
 *   · 자리(seat) 기본 심볼 → `SEAT_DEFAULT_FINDER` 의 값 (a-cm = H2O) — 중앙
 *     파인더가 아니라 외곽 자리의 심볼이라 중앙 축에 들어가지 않는다.
 */
export function lineupCoverage() {
  const axisIds = new Set(centralFinderAxis().map((row) => row.id));
  const cardIds = new Set([...FINDER_CARD_GROUPS.oak, ...FINDER_CARD_GROUPS.daehan]
    .map((card) => card.id));
  const patterns = [...renderPatternsById().values()];
  const seatByFinderName = new Map(
    Object.entries(SEAT_DEFAULT_FINDER).map(([seat, name]) => [name, seat]),
  );
  return Object.freeze(liveOakCandidates().map((row) => {
    // 이름 조인 (§lineupRowForPattern) — 카드가 여럿(daehan 잘림본 k6/k8/k10)이면
    // 카드 목록에 실제로 있는 대표를 집는다.
    const matched = patterns.filter((pattern) => {
      const joined = lineupRowForPattern(pattern);
      return joined !== null && joined.name === row.name;
    });
    const card = matched.find((pattern) => cardIds.has(pattern.id)) || null;
    const cardId = card ? card.id : null;
    const inAxis = cardId !== null && axisIds.has(cardId);
    const reasons = [];
    if (!inAxis) {
      if (!GALLERY_TYPES.includes(row.type)) {
        reasons.push('타입 ' + row.type + ' 는 생성기 타입(' + GALLERY_TYPES.join('/')
          + ') 밖이다 — 미구현');
      }
      if (seatByFinderName.has(row.name)) {
        reasons.push('자리(' + seatByFinderName.get(row.name)
          + ') 기본 심볼 — 중앙 파인더 축이 아니다');
      }
      if (matched.length === 0) reasons.push('중앙 19셀 렌더 표현 없음');
      else if (cardId === null) reasons.push('렌더 표현은 있으나 카드 목록 밖');
    }
    return Object.freeze({
      name: row.name,
      candidate: row.id,
      type: row.type,
      cardId,
      inAxis,
      // finder-card-ui.js 의 candidate 조인이 이 행에서 성립하는가 (위 ⚠ 참조).
      candidateJoins: matched.some((pattern) => pattern.params
        && pattern.params.candidate === row.id),
      reasons: Object.freeze(reasons),
    });
  }));
}

/**
 * Type Y 축 — live 로케이터 프로파일에서 유도한다. `cellSurfaceLayout` 이 나오는
 * 프로파일은 **활성 레이아웃과 1:1** 이고, 안 나오는 둘(off · hex-frame-v1)은
 * 셀 표면 로케이터가 없는 정식 경로다.
 */
export function yLocatorAxis(tier = GALLERY_BASE_TIER) {
  const version = RESOLUTION_TIER_VERSIONS.Y[tier];
  if (version === undefined) throw new RangeError('알 수 없는 해상도 티어: ' + tier);
  const tone = GENERATOR_STATE_SCHEMA.tone.defaultValue;
  return Object.freeze(GENERATOR_STATE_SCHEMA.locatorProfileY.options.map((profile) => {
    const opts = encodeOptionsForY({
      tone,
      versionY: version,
      fallback: { mode: 'corner', corner: DEFAULT_QR_CORNER },
      locatorProfileY: profile,
    });
    return Object.freeze({
      profile,
      layoutId: opts.cellSurfaceLayout === undefined ? null : opts.cellSurfaceLayout,
      cellSurface: opts.cellSurface === true,
      // 셀 표면 레이아웃은 n 이 레이아웃 정의라 티어가 버전을 못 정한다 — 그때는
      // encodeOptionsForY 가 돌려준 버전이 정본이다.
      version: opts.version === undefined ? version : opts.version,
      tones: opts.tones,
      encodeOptions: Object.freeze({ ...opts }),
      // QR 슬롯이 레이아웃 정의인 변형은 qrText 가 필수다 (index.html §renderTypeY).
      needsQrText: opts.cellSurface === true && hasCenterQrSlot(opts.cellSurfaceLayout),
    });
  }));
}

/** 활성 레이아웃 ↔ Y 축의 1:1 대조 (테스트와 자기검증이 함께 쓴다). */
export function yLayoutCoverage(tier = GALLERY_BASE_TIER) {
  const axis = yLocatorAxis(tier);
  const covered = axis.map((row) => row.layoutId).filter((id) => id !== null);
  const active = [...CELL_SURFACE_FINAL_ACTIVE_IDS];
  return Object.freeze({
    covered: Object.freeze([...covered].sort()),
    active: Object.freeze([...active].sort()),
    missing: Object.freeze(active.filter((id) => !covered.includes(id))),
    extra: Object.freeze(covered.filter((id) => !active.includes(id))),
  });
}

function comboId(type, version, axisId) {
  return `${type}-V${version}-${axisId}`;
}

/**
 * 조합 전체 — 갤러리가 굽고 보여 주는 단위.
 *
 * 규칙 (1차): **모든 축 값을 기본 티어(low)로 한 장씩** + 타입마다 **대조 한 장**
 * (기본 파인더/기본 로케이터를 high 티어로). PM/022 ⑤ 의 «대표 × V1 + 대조 V3
 * 1종» 을 타입 상대 버전으로 옮긴 것이다.
 */
export function galleryCombos() {
  const combos = [];
  const finderAxis = centralFinderAxis();

  for (const type of GALLERY_TYPES) {
    if (type === 'Y') {
      for (const row of yLocatorAxis(GALLERY_BASE_TIER)) {
        combos.push(Object.freeze({
          id: comboId(type, row.version, row.profile),
          type,
          tier: GALLERY_BASE_TIER,
          version: row.version,
          axis: 'locatorProfileY',
          axisId: row.profile,
          group: row.cellSurface ? 'layout' : 'official',
          layoutId: row.layoutId,
          tones: row.tones,
          control: false,
        }));
      }
      const control = yLocatorAxis(GALLERY_CONTROL_TIER)
        .find((row) => row.profile === GENERATOR_STATE_SCHEMA.locatorProfileY.defaultValue);
      if (control && !combos.some((c) => c.id === comboId(type, control.version, control.profile))) {
        combos.push(Object.freeze({
          id: comboId(type, control.version, control.profile),
          type,
          tier: GALLERY_CONTROL_TIER,
          version: control.version,
          axis: 'locatorProfileY',
          axisId: control.profile,
          group: 'control',
          layoutId: control.layoutId,
          tones: control.tones,
          control: true,
        }));
      }
      continue;
    }

    const baseVersion = RESOLUTION_TIER_VERSIONS[type][GALLERY_BASE_TIER];
    for (const row of finderAxis) {
      combos.push(Object.freeze({
        id: comboId(type, baseVersion, row.id),
        type,
        tier: GALLERY_BASE_TIER,
        version: baseVersion,
        axis: 'finderPatternId',
        axisId: row.id,
        group: row.group,
        control: false,
      }));
    }
    const controlVersion = RESOLUTION_TIER_VERSIONS[type][GALLERY_CONTROL_TIER];
    combos.push(Object.freeze({
      id: comboId(type, controlVersion, GENERATOR_DEFAULT_FINDER_PATTERN_ID),
      type,
      tier: GALLERY_CONTROL_TIER,
      version: controlVersion,
      axis: 'finderPatternId',
      axisId: GENERATOR_DEFAULT_FINDER_PATTERN_ID,
      group: 'control',
      control: true,
    }));
  }
  return Object.freeze(combos);
}

/** 축 요약 — 매니페스트 머리와 보고서가 같은 수를 쓰도록 한 곳에서 만든다. */
export function gallerySummary() {
  const combos = galleryCombos();
  const byType = {};
  for (const type of GALLERY_TYPES) {
    byType[type] = combos.filter((c) => c.type === type).length;
  }
  return Object.freeze({
    types: Object.freeze([...GALLERY_TYPES]),
    tiers: Object.freeze({ base: GALLERY_BASE_TIER, control: GALLERY_CONTROL_TIER }),
    versions: RESOLUTION_TIER_VERSIONS,
    centralFinderAxis: centralFinderAxis(),
    lineupCoverage: lineupCoverage(),
    yLayoutCoverage: yLayoutCoverage(),
    comboCount: combos.length,
    comboCountByType: Object.freeze(byType),
  });
}

/** 조합의 QR 폴백 상태 — 생성기 finder-selection 규약과 같은 모양. */
export function fallbackForCombo(combo) {
  if (combo.type === 'Y') return Object.freeze({ mode: 'corner', corner: DEFAULT_QR_CORNER });
  return combo.axisId === CENTER_QR_FINDER_PATTERN_ID
    ? Object.freeze({ mode: 'center', cornerToo: false })
    : Object.freeze({ mode: 'corner', corner: DEFAULT_QR_CORNER });
}

/* ── 로드 자기검증 (turnA.js·finder-zone-ui.js 전례) ────────────────────── */
{
  const axis = centralFinderAxis();
  if (axis.length === 0) throw new Error('중앙 파인더 축이 비었다');
  // 드랍 회귀 — 명부에서 내린 후보(Benzene · Aspirin · Xylene · 구 Nitrogen)의
  // 렌더 표현이 축에 살아 있으면 그 자리에서 죽는다. 조인은 이름으로 한다.
  const droppedNames = new Set(OAK_LINEUP.filter((row) => row.status !== 'active')
    .map((row) => row.name));
  for (const [id, pattern] of renderPatternsById()) {
    const row = lineupRowForPattern(pattern);
    if (row && droppedNames.has(row.name) && axis.some((entry) => entry.id === id)) {
      throw new Error('드랍된 후보가 갤러리 축에 있다: ' + id
        + ' (명부 ' + row.name + ' = ' + row.status + ')');
    }
  }
  const coverage = yLayoutCoverage();
  if (coverage.missing.length > 0 || coverage.extra.length > 0) {
    throw new Error('Y 축이 활성 레이아웃과 1:1 이 아니다 — 빠짐 ['
      + coverage.missing.join(',') + '] 남음 [' + coverage.extra.join(',') + ']');
  }
  const ids = galleryCombos().map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('조합 id 가 중복이다 — 파일명이 서로를 덮어쓴다');
  }
}
