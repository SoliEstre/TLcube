import { BULLSEYE_DARK } from './luminance.js';

export const CENTRAL_N7_EMPHASIS_MODES = Object.freeze(['default', 'locator', 'all']);
export const DEFAULT_CENTRAL_N7_EMPHASIS = 'default';

/**
 * **생성기 UI 의 초기 선택** — 라이브러리 기본(`DEFAULT_CENTRAL_N7_EMPHASIS`)과
 * 별개다 (finderPatternId 의 GENERATOR_DEFAULT ↔ DEFAULT 와 같은 관계).
 *
 * 'all' 인 근거: 운영자 실기 A2 비교 (2026-08-29) — 로케이터만/전체 모두 기본보다
 * 향상, 전체가 미묘하게 우세.
 *
 * ⚠ **그 근거는 2026-09-07 (B) 로 만료됐다** (검토 F7). A2 가 잰 'all' 은 «중앙
 * 슬롯만» 강조하던 시절의 처치이고, (B) 뒤 같은 이름의 값은 **바깥 코드 셀까지**
 * 바꾼다 (기본 설정 코드에서 바뀌는 면이 82 → 코드 면의 45\~61 % — 검토 §5 실측).
 * 이름은 같고 처치가 달라졌으므로 옛 실기 비교는 새 기본값을 떠받치지 못한다.
 * 되돌릴지(`'default'`)는 실사진 A/B 뒤 **운영자 결정**이고, 그 전까지 이 상수는
 * «만료된 근거로 서 있는 값» 이다 — 레인이 임의로 안 바꿨다.
 *
 * ⚠ 라이브러리 기본은 'default' 그대로 둔다 — 그쪽은
 * emphasis 를 안 준 buildScene 호출자(임베더)의 계약이라, 바꾸면 기존 발행 출력의
 * 재생성이 조용히 달라진다.
 *
 * 저장 상태 마이그레이션: 해당 없음 (2026-08-29 실측 — 생성기 상태는 어디에도
 * 저장되지 않는다. index.html 의 localStorage 는 'tlcube-theme' 하나뿐이다).
 */
export const GENERATOR_DEFAULT_CENTRAL_N7_EMPHASIS = 'all';

export function assertCentralN7Emphasis(value = DEFAULT_CENTRAL_N7_EMPHASIS) {
  if (!CENTRAL_N7_EMPHASIS_MODES.includes(value)) {
    throw new RangeError(
      `알 수 없는 중앙 n=7 강조: ${value} (허용: ${CENTRAL_N7_EMPHASIS_MODES.join(', ')})`,
    );
  }
  return value;
}

function assertRgb(color, label) {
  if (color === null || typeof color !== 'object'
    || !['r', 'g', 'b'].every((channel) => Number.isFinite(color[channel]))) {
    throw new TypeError(`${label} RGB 색이 필요하다`);
  }
}

/**
 * 현재 팔레트의 밝은 레벨은 보존하고, 어두운 레벨을 순검정으로 고정한다.
 * 중간톤은 선형광이 아니라 **인코딩된 sRGB 8비트 채널 공간**에서 두 끝점의 산술
 * 중점을 가장 가까운 정수로 반올림한다. 이 선택은 색상 혼합이 아니라 명시된 렌더
 * 실험 축이며, 디코더가 읽는 순위 0 < 1 < 2는 그대로다.
 */
export function centralN7EmphasisLevels(levels) {
  if (!Array.isArray(levels) || levels.length !== 3) {
    throw new TypeError('중앙 n=7 강조에는 3단계 팔레트가 필요하다');
  }
  const light = levels[2];
  assertRgb(light, '밝은 레벨');
  const middle = Object.freeze({
    r: Math.round((BULLSEYE_DARK.r + light.r) / 2),
    g: Math.round((BULLSEYE_DARK.g + light.g) / 2),
    b: Math.round((BULLSEYE_DARK.b + light.b) / 2),
  });
  return Object.freeze([BULLSEYE_DARK, middle, light]);
}

/** 로케이터 30셀과 데이터 19셀이 각각 소비할 레벨 표를 선택한다. */
export function centralN7LevelPalettes(levels, emphasis = DEFAULT_CENTRAL_N7_EMPHASIS) {
  const mode = assertCentralN7Emphasis(emphasis);
  if (mode === DEFAULT_CENTRAL_N7_EMPHASIS) {
    return Object.freeze({ locator: levels, data: levels });
  }
  const emphasized = centralN7EmphasisLevels(levels);
  return Object.freeze({
    locator: emphasized,
    data: mode === 'all' ? emphasized : levels,
  });
}

/**
 * «강조를 켠 모드에서 **검출 셀만** 치환하는» 모드 — 팔 선택의 이름이지 UI 선택지가
 * 아니다. 철자를 옮겨 적지 않으려고 폐쇄집합에서 뽑는다.
 */
export const DETECTOR_ONLY_EMPHASIS_MODE = CENTRAL_N7_EMPHASIS_MODES[1];
if (DETECTOR_ONLY_EMPHASIS_MODE === DEFAULT_CENTRAL_N7_EMPHASIS) {
  throw new Error('검출 셀 전용 팔 선택이 기본 모드와 같다 — 폐쇄집합 순서가 바뀌었다');
}

/**
 * **코드 셀 표면**(바깥 셀 루프 · Type Y 셀 표면)이 쓰는 팔 선택 —
 * 「강조는 검출기 셀에만, 코드 페이로드는 어떤 모드에서도 안 건드린다」.
 *
 * ⭐ **왜 `centralN7LevelPalettes` 와 다른 함수인가 (운영자 카드 `d-emph-b-default`,
 *    2026-09-07 17:25 KST)**: (B) 는 바깥 셀 루프에 `centralN7LevelPalettes` 를 그대로
 *    물려, `'all'` 에서 **코드 페이로드 셀까지** 강조 팔레트를 받게 했다 (실측: 코드
 *    면의 45\~61 % — O V1 216면 · K K1 819면 · C0 노치 1184면). 운영자 판정은
 *    「H·H2O·CO2·H2CO3 같은 파인더만 강조되어야 하는데 모든 코드 영역이 강조가 됐다」다.
 *
 *    그래서 **표면마다 «페이로드» 의 뜻이 다르다**:
 *      · 중앙 슬롯(중앙 TL 49셀 · 중앙 v0 비컨) — 그 페이로드는 **검출기 자신의 몸**이라
 *        `'all'` 이 여전히 치환한다 (`centralN7LevelPalettes` 그대로 · (B) 착지본과
 *        바이트 동일). 이것이 `'all'` 과 `'locator'` 를 가르는 유일한 자리다.
 *      · 코드 셀 표면 — 그 페이로드는 **코드 그 자체**라 안 건드린다 (이 함수).
 *
 *    즉 이 함수는 «`'all'` 을 `'locator'` 로 낮춘다» 가 아니라 «이 표면에는 강조할
 *    데이터 팔이 없다» 는 성질의 이름이다. `'default'` 는 두 팔이 `levels` 그대로라
 *    이전 출력과 바이트 동일이다.
 */
export function detectorCellLevelPalettes(levels, emphasis = DEFAULT_CENTRAL_N7_EMPHASIS) {
  const mode = assertCentralN7Emphasis(emphasis);
  return centralN7LevelPalettes(levels, mode === DEFAULT_CENTRAL_N7_EMPHASIS
    ? mode : DETECTOR_ONLY_EMPHASIS_MODE);
}

/**
 * **검출기 자신의 몸**이 강조 팔레트를 소비하는 renderKind — 중앙 슬롯 렌더
 * (scene.js 의 중앙 세 분기 · sceneY.js 의 셀 표면 로케이터)와 분류
 * (generator-render-config.detectorEmphasisApplicability)의 **공통 계약**이다
 * (2026-09-07, 결정 ⑭ (B) · PM/029B §27.14.2).
 *
 * ⭐ **범위가 «검출기 자신» 으로 좁혀졌다 (2026-09-07 emph-centerqr · 운영자 실기 20:1x)**.
 * 종전엔 `scene.js` 의 **바깥 셀 루프**도 이 집합을 게이트로 썼고, 그래서 목록에 없는
 * 중앙(중앙 QR · 불스아이 · cell-mask · 3톤 큐브)을 고르면 **바깥 마커 검출 셀까지**
 * 강조가 꺼졌다 — 실측: `center-qr` × H·H2O·CO2·H2CO3 에서 검출 셀 12·21·6·30 개가
 * 실려 있는데 바뀐 면이 0 이었다(바뀔 수 있었던 면 24·36·8·51).
 * 원자료 `.agent/lanes/emph-centerqr/cqr-status.jsonl`.
 * 바깥 셀 루프가 묻는 질문은 «이 셀이 검출 셀인가»(`isDetectorToneCell`) 하나이고 이
 * 집합과 **무관**하다. 아래 「안 들어오는 것과 이유」도 전부 **검출기 자신**에 대한
 * 판단이지, 그 검출기를 고른 코드 전체에 대한 판단이 아니다.
 *
 * 왜 여기인가: 이 목록은 «강조가 무엇을 바꾸는가» 의 정의라 팔레트 소유자와 같은
 * 층이다. 분류 쪽은 `finder-taxonomy` 를 못 읽고(node:url top-level import 라 브라우저
 * 번들에서 죽는다 — build-single MODULE_ORDER 주석), 렌더 쪽은 분류 모듈을 안 읽는다.
 * 두 소비자가 각자 손 목록을 들면 «켰는데 안 먹는» / «안 먹는다고 써 놓고 먹는» 이
 * 둘 다 생긴다 (2026-09-06 (A) 레인 F4 와 같은 사고).
 *
 * ⚠ **이 목록은 «손 선언» 이다** (2026-09-07 검토 F11 — 정직하게 적는다). 유도되는
 * 것은 «id → renderKind» 이고, «어느 renderKind 가 대상인가» 는 여기서 손으로 적는다.
 * 정본이 요구한 `finder-taxonomy` 유도를 못 쓰는 이유는 아래 «왜 여기인가» 그대로다.
 *
 * ⚠ **그래서 자가 그 선언을 «독립 출처» 로 반증한다** —
 * `test/detector-emphasis-cells.test.js` ⓐ 는 이 상수를 **한 번도 안 읽고**, 렌더 가능한
 * finderPatternId **전수**에 대해 «`palette.levels` 만 바꾼 두 팔레트에서 검출기 자신의
 * 그림이 달라지는가»(= 이 화법이 셀 팔레트 축인가)를 재고, 그 답을 판정·렌더와 대조한다.
 * 종전 판은 «이 집합에 있다 ⟺ 'all' 렌더가 다르다» 였는데 양변이 이 상수 하나에서
 * 나오는 **항진명제**라, 비대상 renderKind 를 몰래 넣어도 5/5 초록이었다(검토 F3 실측).
 * 지금은 목록에 없는 화법을 넣으면 «levels 에 안 반응하는데 applies» 로 빨개지고,
 * 넣고 배선을 안 하면 «levels 에 반응하는데 렌더가 그대로» 로 빨개진다.
 *
 * 근거(실측, scene.js 분기):
 *   · `central-n7-payload` — 로케이터 30 + 데이터 19 를 `palette.levels` 로 그린다.
 *   · `central-v0` — 비컨 로케이터(tones) + 데이터(digit)를 `palette.levels` 로 그린다.
 *   · `cell-surface-locator` — **Type Y** (`sceneY.js`). 레이아웃이 톤을 고정한 로케이터
 *     셀(`role === 'locator'`)을 `gainedLevels[face][levelIndex]` 로 그린다 — 게인만
 *     얹힌 `palette.levels` 축이다. 배선은 2026-09-07 (C) (운영자 「Y 의 경우는 v0 이나
 *     v0T, v0TR 같은 로케이터 강조가 되어야 하는데 이쪽은 미지원 상태」). 여기엔
 *     페이로드 팔이 없다 — Y 데이터 셀은 digit 순위라 안 건드리고, 중앙 슬롯 QR 은
 *     레벨 축이 아니다. 그래서 `locator` 와 `all` 이 **같은 그림**이다 (중앙 M7 과 같은
 *     «해당 없음» — 자 ⓙ 가 잠근다).
 *   · `central-marker-n7` — 고정 코드북 49셀을 `palette.levels[cell[face]]` 로 그린다.
 *     페이로드가 없어 **로케이터/데이터 구분이 없다** — `locator` 와 `all` 이 같은
 *     그림이고, 그 «해당 없음» 을 자 ⓕ 가 잠근다.
 *
 * 안 들어오는 것과 이유 (**전부 «그 검출기 자신» 에 대한 판단이다** — 그 검출기를
 * 고른 코드의 바깥 마커 검출 셀은 이 목록과 무관하게 강조된다):
 *   · `three-tone-cube` — 고정 상수 `FINDER_CUBE_TONES`. 강조 dark(순검정)가 어두운
 *     배경에 먹혀 실루엣 검출 전패 (2026-08-29 §2.4 실측 거부, 아래 ⛔ 주석).
 *   · `cell-mask` · `bullseye` · `center-qr` — 파인더 축(bullseyeDark = 순검정)이라
 *     강조가 light 를 낮추는 방향밖에 못 간다. 2026-09-07 재실측으로 **값이 붙었다**:
 *     `center-qr` 은 `palette.levels` 세 색만 바꿔도 자기 셰이프 **0/227** 이 움직인다
 *     (= 안 움직인다). 즉 사유는 사실이고, 좁혀진 것은 그 사유의 **적용 범위**다.
 *   · `cube-bullseye` — 링은 파인더 축, 안쪽 3면은 `FINDER_CUBE_TONES`. `palette.levels`
 *     면이 **한 장도 없다** (2026-09-06 F1 실측).
 */
/**
 * Type Y 의 «검출기» 화법 — 셀 표면 로케이터(블록 로케이터). 중앙 파인더가 아니라
 * **셀 격자 위에 레이아웃이 톤을 고정한 셀들**이 검출기라, id 축이 `finderPatternId`
 * 가 아니라 `locatorProfileY`(= `cell-surface-*`)다.
 *
 * 철자를 여기 두는 이유: 이 상수는 `DETECTOR_EMPHASIS_RENDER_KINDS` 의 원소라
 * **집합 소유자와 같은 층**이어야 한다. `finder-render-kind.js` 가 이걸 가져다
 * «Y 로케이터 프로파일 id → 이 화법» 을 답하므로, 분류(applicability)·렌더(sceneY)·
 * 화면이 전부 한 출처를 본다 (사본 금지 — (A) 레인 F4 사고).
 */
export const CELL_SURFACE_LOCATOR_RENDER_KIND = 'cell-surface-locator';

export const DETECTOR_EMPHASIS_RENDER_KINDS = Object.freeze([
  'central-n7-payload', 'central-v0', 'central-marker-n7',
  CELL_SURFACE_LOCATOR_RENDER_KIND,
]);

/**
 * 이 셀이 **검출 셀**(레이아웃이 고정한 절대 톤)인가, 페이로드 셀인가.
 *
 * 판정 축은 `entry.tones` 하나다 — 새 규약이 아니라 **렌더가 이미 쓰는 축**이다:
 * `scene.faceColor` 가 «tones 가 있으면 면별 절대 톤, 없으면 digit 순위» 로 갈리고,
 * 중앙 v0 비컨 분기가 바로 그 성질로 로케이터/데이터 팔레트를 갈라 쓴다. 인코더 쪽도
 * 같은 규약을 명시한다 (encodeK §H2CO3 톤 채택 — 「digit 은 그대로 두고 tones 를
 * 얹는다」).
 *
 * 그래서 **역할 손 목록이 필요 없다**: H(O-CM) · H2O(A-CM) · CO2(V-CM) ·
 * H2CO3(K-CM) 는 인코더가 `tones` 를 실어 주므로 자동으로 로케이터 팔이고,
 * 마커 발자국 안의 앵커도 `tones` 가 보존돼 같이 따라온다 (encodeK 앵커 패스).
 *
 * ⚠ **앵커·레퍼런스·노치 림은 여기서 «데이터» 다.** 그 셋은 절대 톤이 아니라 digit
 * 알파벳으로 그려져서 (`faceColor` 의 digitToRanks 갈래), 렌더에는 그것을 데이터 셀과
 * 가르는 축이 없다 — 「고정 digit 이다」는 인코더 층의 사실이지 렌더 층의 축이 아니다.
 * 그래서 그 셋은 `locator` 팔이 아니라 **`all` 팔에서** 치환된다 (PM/029B §27.14.1 (B)
 * 「앵커·레퍼런스는 데이터 알파벳이라 신중」과 같은 판단). 자 ⓕ 가 이 경계를 잠근다.
 *
 * @param {{tones?: {T:number,L:number,R:number}}|undefined} entry
 */
export function isDetectorToneCell(entry) {
  return Boolean(entry && entry.tones);
}

/**
 * 셀 하나가 소비할 레벨 표 — `centralN7LevelPalettes` 의 두 갈래 중 하나를 고른다.
 * 소비자가 `entry.tones` 삼항을 손으로 다시 적지 않게 하는 얇은 이름이다.
 */
export function emphasisLevelsForCell(entry, palettes) {
  return isDetectorToneCell(entry) ? palettes.locator : palettes.data;
}

// ⛔ 3톤 큐브용 톤 선택 함수(centralN7FinderTones)는 **여기 두지 않는다** — 그 확장은
// 2026-08-29 §2.4 왕복 자에서 거부됐다 (강조 dark 순검정이 어두운 프리셋 배경과의
// 차 0.0053 < 마스크 허용오차 0.018 로 배경에 먹혀 실루엣 검출 전패 — scene.js
// three-tone-cube 분기 주석 실측). 되살리려면 순검정 대신 FINDER_CUBE_SEAM 식
// 두-제약(배경 문턱 초과 + 최암면과의 분리) 앵커부터 다시 재라.
