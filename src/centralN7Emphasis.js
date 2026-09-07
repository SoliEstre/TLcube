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
 * 강조 팔레트를 **실제로 소비하는 renderKind** — 렌더(scene.js)와 분류
 * (generator-render-config.detectorEmphasisApplicability)의 **공통 계약**이다
 * (2026-09-07, 결정 ⑭ (B) · PM/029B §27.14.2).
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
 *   · `central-marker-n7` — 고정 코드북 49셀을 `palette.levels[cell[face]]` 로 그린다.
 *     페이로드가 없어 **로케이터/데이터 구분이 없다** — `locator` 와 `all` 이 같은
 *     그림이고, 그 «해당 없음» 을 자 ⓕ 가 잠근다.
 *
 * 안 들어오는 것과 이유:
 *   · `three-tone-cube` — 고정 상수 `FINDER_CUBE_TONES`. 강조 dark(순검정)가 어두운
 *     배경에 먹혀 실루엣 검출 전패 (2026-08-29 §2.4 실측 거부, 아래 ⛔ 주석).
 *   · `cell-mask` · `bullseye` · `center-qr` — 파인더 축(bullseyeDark = 순검정)이라
 *     강조가 light 를 낮추는 방향밖에 못 간다.
 *   · `cube-bullseye` — 링은 파인더 축, 안쪽 3면은 `FINDER_CUBE_TONES`. `palette.levels`
 *     면이 **한 장도 없다** (2026-09-06 F1 실측).
 */
export const DETECTOR_EMPHASIS_RENDER_KINDS = Object.freeze([
  'central-n7-payload', 'central-v0', 'central-marker-n7',
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
