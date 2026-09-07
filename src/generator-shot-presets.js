/**
 * generator-shot-presets.js — 시험판 생성기 «촬영 프리셋» 의 **선언 정본**.
 *
 * ─ 왜 생겼나 (운영자 답 카드 `d-3d-observation-layer`, 2026-09-07 17:32 KST) ─────
 * 「A 로 하고 적절한 조건의 렌더 프리셋을 시험판 생성기에 프리셋 섹션을 추가해서
 *  항목 선택하면 해당 프리셋으로 선택되게 해줘.」
 *
 * (A) = 3D 실루엣 관측층을 **실물에서** 재측정하기 위한 회전/원근 코퍼스 촬영.
 * 그 촬영에 쓸 코드를 사람이 옵션을 하나씩 맞추는 대신 **항목 하나로** 세운다.
 *
 * ─ 기존 «스타일 프리셋» 과 무엇이 다른가 (이름 충돌 방지) ────────────────────
 *   · 스타일 프리셋 = `luminance.js` 의 `PRESETS`(slate·ember·mono) — 팔레트 **하나**.
 *     상태 키 `preset`, 이탈 표지 `'custom'`.
 *   · 촬영 프리셋 = 여기 — 여러 상태 필드의 **묶음**.
 *     상태 키 `shotPreset`, 이탈 표지 `SHOT_PRESET_NONE`.
 * 겹치는 것은 낱말 「프리셋」뿐이고 식별자는 한 자도 안 겹친다.
 *
 * ─ 규약 ─────────────────────────────────────────────────────────────────────
 * **선언 하나가 정본이고 UI 목록·상태 허용값·자가 전부 여기서 유도된다.** 손으로
 * 나란히 유지하는 목록을 0 으로 둔다 (교훈 「사본 목록은 썩는다」). 새 프리셋을
 * 더하면 카드도·허용값도·자도 함께 늘어난다.
 *
 * ⚠ **강조(`centralN7Emphasis`) 축은 여기 안 들어온다.** 2026-09-07 현재 별도 레인
 *   (emph-c)이 강조의 «범위» 자체를 고치는 중이라, 그 값을 지금 프리셋에 굳히면
 *   착지 뒤 뜻이 달라진 값을 잠그게 된다. 강조 촬영 가족(카드 `d-emph-b-default`
 *   의 7조합)은 emph-c 착지 뒤 **`family: 'shot-emph'` 로 이 배열에 더한다** —
 *   자료구조는 그 자리를 이미 열어 두었고, `assertNoEmphasisFields` 가 그때까지
 *   실수로 새어 들어오는 것을 막는다.
 *
 * ⚠ 이 모듈은 `generator-state.js` 를 **import 하지 않는다** (순환 회피 —
 *   generator-state 가 이쪽을 읽어 `shotPreset` 허용값을 만든다). 필드 키가 실제
 *   상태 스키마에 있는지는 스키마를 **인자로 받아** 검사한다(`assertShotPresetFields`)
 *   — finder-zone-ui 가 세운 «검증되는 사본» 전례와 같은 처방이다.
 *
 * @module generator-shot-presets
 */

import {
  ORBIT_VIEW_3D, assertOrbitPresetFields, orbitPerspToDeg,
} from './generator-orbit-view.js';
import { LOCATOR_PROFILE_CELL_SURFACE_V0TR } from './locatorY.js';
import { DEFAULT_PRESET } from './luminance.js';
import { QUIET_COLOR_NONE } from './quiet-auto.js';
import { RENDER_PROFILE_SCREEN } from './render-profile.js';
import { SHADING_OFF } from './shading.js';

/** 프리셋 미선택 = «이 화면은 어떤 촬영 프리셋도 주장하지 않는다». */
export const SHOT_PRESET_NONE = 'none';

/** 가족 — 촬영 목적별 묶음. 늘리는 자리다(강조 가족은 emph-c 착지 뒤). */
export const SHOT_PRESET_FAMILY_3D = 'shot-3d';

/**
 * 3D 촬영 가족의 **공통 조건**.
 *
 * 값의 근거는 전부 실측이다 (「내 가설은 가설로 표시하라」 — 아래 각 줄의 출처):
 *
 *   · `type: 'Y'` — 3D 실루엣 관측층은 Type Y 큐브 실루엣 축이다
 *     (`REPORT_silhouette-pose.md` 전편).
 *   · `versionY: 2` · `tone: 3` · `eccLevel: 'H'` · `locatorProfileY: v0tr` —
 *     실루엣 경로의 **유일한 실물 표본** `y2-p9rot` 이 그 조건이다:
 *     `test/output/photos/videos/LABELS.md` §2차 「y2 가 Y2T-CS-V0TR」 +
 *     `REPORT_silhouette-pose.md` §72 표 「n25 · v0tr · ecc H · mask 0 · wire 2」.
 *     ⚠ 카드 표기 「y2 = n25 v0tr H」의 **H 는 ECC** 이지 파인더 H 가 아니다.
 *   · `qrPosition: 'none'` — 코너 QR 은 같은 지면 위의 **경쟁 전경 덩어리**다.
 *     실측 근거: LABELS.md y0 정정 「로케이터가 모서리 QR 을 큐브로 오인했다
 *     (TLcube f3c142c)」. 실루엣 추출기는 전경의 볼록껍질을 쓰므로 같은 종류의
 *     오염을 받는다(그쪽은 이 레인이 안 쟀다 — 추론이다).
 *   · `quietMode: 'none'` — Type Y 안전영역은 **«없음» 이 실측 최선**이다
 *     (`src/quiet-auto.js` §131~146: 없음 65.2% ≫ 표면색 최선 58.7% ≫ 39.1%).
 *     그리고 흑·백 판은 프레임 테두리 띠에 그 색이 없으면 배경으로 마스킹되지
 *     못하고 **코드보다 큰 경쟁 실루엣**이 된다(같은 절 §13 법칙, 띠=판색 9/9 ·
 *     띠=없음 0/9). 촬영 프리셋에서는 특히 치명적이다.
 *   · `quietMarginAuto: false` — 자동 두께는 렌더 뒤 피복률을 보고 `quietMargin`
 *     을 **되쓴다**(`index.html` §syncQuietModeUi). 촬영 사이에 기하가 흔들리면
 *     안 되고, 그 되쓰기는 «사용자가 안 건드렸는데 프리셋 이탈» 로도 보인다.
 *   · `preset: DEFAULT_PRESET` — 팔레트를 고정해야 장(場)이 재현된다. 스타일
 *     프리셋의 **의미·기본값은 안 건드린다** — 있는 것 중 하나를 고를 뿐이다.
 *   · `renderProfile: 'screen'` — y2 는 «자동» 으로 렌더됐고 화면 문맥에서 자동은
 *     «중(screen)» 으로 푼다(`export-options.resolveRenderProfile` 실측: auto +
 *     printPurpose=false → screen · true → soft). 촬영본은 **인쇄**하므로 자동인
 *     채로 두면 내보내기 갈래에 따라 면 게인이 soft 로 바뀌어 y2 와 다른 그림이
 *     된다. 구체 프로파일로 못 박아 그 결합을 끊는다.
 *   · `shading: 'off'` · `shadingRim: false` — 음영은 배경·안전영역을 채워
 *     **Y 전경 실루엣 검출을 깬다**(`generator-state.js` §shading 주석 실측).
 *
 * ⛔ 여기 **없는** 것: `centralN7Emphasis`(emph-c 레인) · 내보내기 크기/ppi/여백
 *    (물리 인쇄 크기는 프리셋이 아니라 운영자 안내가 정한다) · `quietMargin`
 *    (색이 «없음» 이라 안 그려지고, 값을 굳히면 이탈 표시가 헛돈다).
 */
const SHOT_3D_COMMON = Object.freeze({
  type: 'Y',
  versionY: 2,
  tone: 3,
  eccLevel: 'H',
  locatorProfileY: LOCATOR_PROFILE_CELL_SURFACE_V0TR,
  qrPosition: 'none',
  preset: DEFAULT_PRESET,
  renderProfile: RENDER_PROFILE_SCREEN,
  quietMode: QUIET_COLOR_NONE,
  quietMarginAuto: false,
  shading: SHADING_OFF,
  shadingRim: false,
  // ─ 궤도 축 (2026-09-07 21:0x, 운영자 지시 「8개 자세 x 2 배경」) ────────────
  // **자세 8은 카메라가 아니라 렌더의 궤도 회전이다** (`GUIDE_3d-shoot-32.md` §1):
  // 인쇄물을 비스듬히 찍으면 큐브 세 면이 여전히 한 평면이라 단일 H 로 풀리고,
  // 3D 관측층이 필요해지는 «면별 H» 는 렌더가 돌았을 때만 생긴다.
  orbitView: ORBIT_VIEW_3D,
  // roll 0 — y2-p9rot 실측도 roll ≈ 0 이었고, roll 축은 이번 코퍼스 밖이다
  // (`rot-analysis.md` §0 · `GUIDE_3d-shoot-32.md` §2).
  orbitRoll: 0,
  // 원근 노브 15 = t 0.15 = 반각 α 9° — `rot-analysis.md` §0 의 「p9」.
  // 전 자세 공통으로 못 박는 이유는 **유일한 성공 사례와 한 축만 다르게** 두기
  // 위해서다(「대조군은 한 축만 바꿔라」). 유도식은 generator-orbit-view.js 가
  // 로드 시점에 자기검증한다 — 여기서 9 를 다시 적지 않는다.
  orbitPersp: 15,
});

/**
 * 자세 8 — **`GUIDE_3d-shoot-32.md` §2 표와 값이 같아야 한다** (N-way sync).
 *
 * `pose` 문자열은 UI 카드 라벨이자 **촬영 파일명 토큰**이다:
 * `sil3d-<dark|light>-<pose>-<near|far>.jpg` (GUIDE §4-5). 그래서 이 낱말은
 * 번역하지 않는다 — 촬영자가 화면에서 그대로 옮겨 적어야 하고, 번역된 라벨은
 * 그 옮겨 적기를 깨뜨린다.
 *
 * 각 값의 근거:
 *   · `front` 0/0 — 기준선. 여기서 안 읽히면 나머지는 볼 필요가 없다.
 *   · `yawp15`/`yawm15` — yaw 단독 중간 + **부호 대칭**(추출기 비대칭이 여기서 갈린다).
 *   · `yawp30` — 합성 한계 ±35° 바로 안쪽. 실물이 합성만큼 버티는지.
 *   · `pitchm20` — y2-p9rot 의 pitch 성분(−19.7°) 단독. `pitchp20` 은 그 부호 대칭.
 *   · `known` −5/−20 — **y2-p9rot 재현**(실측 yaw −4.9 · pitch −19.7). 화면 촬영 →
 *     인쇄 촬영으로 축이 하나 바뀔 때 값이 유지되는지 보는 **다리**다.
 *   · `hard` +30/−30 — 합성에서도 파단 근처인 복합. **실패를 재는 축**이고,
 *     전부 성공하면 사다리를 더 벌려야 한다는 신호다(「사다리 범위가 결론을 정한다」).
 */
export const SHOT_3D_POSES = Object.freeze([
  Object.freeze({ pose: 'front', yaw: 0, pitch: 0 }),
  Object.freeze({ pose: 'yawp15', yaw: 15, pitch: 0 }),
  Object.freeze({ pose: 'yawm15', yaw: -15, pitch: 0 }),
  Object.freeze({ pose: 'yawp30', yaw: 30, pitch: 0 }),
  Object.freeze({ pose: 'pitchm20', yaw: 0, pitch: -20 }),
  Object.freeze({ pose: 'pitchp20', yaw: 0, pitch: 20 }),
  Object.freeze({ pose: 'known', yaw: -5, pitch: -20 }),
  Object.freeze({ pose: 'hard', yaw: 30, pitch: -30 }),
]);

/**
 * 배경 2 — 카드 **그룹**이자 파일명의 첫 토큰.
 *
 * ─ 왜 두 그룹인가 (한쪽은 «실패를 재는 자» 다) ──────────────────────────────
 * `REPORT_extractor-v3.md` §0-1-4·5 실측: **정면 실물(밝은 배경)은 전역 문턱
 * 6후보 전부에서 큐브가 안 갈라진다** — 전경 0.78~3.01% · 채움률 1.3~7.1% ·
 * 본문 36/36 실패(대조: y2-p9rot 은 전경 52.3% · 채움률 69.7%). 막는 것은 극성이
 * 아니라 «배경↔큐브의 전역 휘도 분리가 없는 장면» 이다. 밝은 배경을 빼면 그
 * 한계선을 실물에서 다시 못 잰다.
 *
 * ⚠ **사전 키는 새로 안 만든다.** `g1033`~`g1036` 은 종전 두 카드의 라벨·부제였고
 *   문구가 그대로 그룹 제목·부제다(「3D 촬영 · 어두운 배경」 / 「Y2T · v0TR ·
 *   ECC H · 검은 지면」). 8언어 번역이 이미 서 있는 것을 버리고 새로 만들 이유가
 *   없다 — 뜻도 한 글자 안 바뀐다.
 */
export const SHOT_3D_BACKDROPS = Object.freeze([
  // 코드 자신의 지면을 검정으로 채운다 → 어두운 무지 배경 위에 놓으면 프레임
  // 테두리 띠와 지면이 **같은 색**이 되어 큐브만 남는 전역 분리가 생긴다
  // (quiet-auto §13 법칙의 «띠에 있는 색» 조건을 지면 전체로 만족시킨다).
  Object.freeze({
    backdrop: 'dark', bgMode: 'black', headingKey: 'g1033', headingSubKey: 'g1034',
  }),
  // 위의 거울상. **알려진 어려운 축**이다 — 실패를 재기 위해 남긴다.
  Object.freeze({
    backdrop: 'light', bgMode: 'white', headingKey: 'g1035', headingSubKey: 'g1036',
  }),
]);

/** 각도 표기 — 부호를 항상 보인다(`+15°` / `-15°` / `0°`). 번역 대상이 아니다. */
function signedDeg(value) {
  return (value > 0 ? '+' : '') + value + '°';
}

/**
 * 촬영 프리셋 선언 — **이 배열이 정본이다.**
 *
 * `fields` 의 키는 전부 `GENERATOR_STATE_SCHEMA` 의 키여야 하고 값도 그 허용값
 * 안이어야 한다 (`assertShotPresetFields` 가 로드 시점에 검사한다).
 *
 * ─ 이 배열은 손으로 안 적는다: **표 둘의 곱**이다 ──────────────────────────
 * `SHOT_3D_BACKDROPS`(2) × `SHOT_3D_POSES`(8) = **16장** (운영자 지시 2026-09-07
 * 21:0x 「8개 자세 x 2 배경 해서 16개 프리셋 카드」). 장수·순서·소속·id·라벨이
 * 전부 두 표에서 유도되므로 자세를 하나 더하면 **카드도·허용값도·자도 함께 는다.**
 * 값의 근거는 각 표 옆에 적혀 있다 — 여기 다시 적으면 그게 사본이고 곧 어긋난다
 * (밝은 배경이 왜 «실패를 재는 자» 인지는 `SHOT_3D_BACKDROPS` 주석).
 *
 * ─ 대조 구조 (「대조군은 한 축만 바꿔라」) ──────────────────────────────────
 *   · 같은 자세의 dark ↔ light 는 `bgMode` **한 축**만 다르다.
 *   · 같은 배경의 자세 여덟은 `orbitYaw`·`orbitPitch` **두 축**만 다르다.
 * 자①(dark/light 전수)과 자①-3D(자세 전수 지문)가 그 둘을 각각 잰다.
 */
export const SHOT_PRESETS = Object.freeze(SHOT_3D_BACKDROPS.flatMap((bg) =>
  SHOT_3D_POSES.map((p) => Object.freeze({
    // id 규칙: `shot-3d-<pose>-<dark|light>`. **pose 이름이 촬영 파일명 토큰과 같아야**
    // 촬영자가 화면에서 그대로 옮겨 적는다 (`sil3d-<bg>-<pose>-<near|far>.jpg`).
    id: 'shot-3d-' + p.pose + '-' + bg.backdrop,
    family: SHOT_PRESET_FAMILY_3D,
    group: bg.backdrop,
    pose: p.pose,
    /*
     * ⚠ **라벨에 사전 키가 없다 — 의도다.**
     *
     * 종전 두 장은 `labelKey`/`subKey` 로 8언어 사전을 탔다. 16장으로 늘리면서
     * 그 방식을 버렸는데, 이유가 둘이다:
     *   ① 카드에 적히는 것이 **번역할 문장이 아니라 식별자와 수**다. `yawp15` 는
     *      촬영 파일명 토큰이고(위), `+15°` 는 숫자다. 번역하면 옮겨 적기가 깨진다.
     *   ② 16장 × 2키 × 8언어 = **256줄의 사전**이 생기고, 자세를 하나 더할 때마다
     *      16줄이 따라온다 — 「사본 목록은 썩는다」가 사전으로 번진다.
     * 그룹 제목·부제(사람 말)는 그대로 사전을 탄다 — `SHOT_3D_BACKDROPS`.
     */
    label: p.pose,
    sub: 'yaw ' + signedDeg(p.yaw) + ' · pitch ' + signedDeg(p.pitch),
    fields: Object.freeze({
      ...SHOT_3D_COMMON,
      bgMode: bg.bgMode,
      orbitYaw: p.yaw,
      orbitPitch: p.pitch,
    }),
  }))));

/** 선언에서 유도한 id 목록 (UI 카드 순서 = 이 순서). */
export const SHOT_PRESET_IDS = Object.freeze(SHOT_PRESETS.map((p) => p.id));

/** 상태 필드 `shotPreset` 의 허용값 = «미선택» + 선언 전수. 손 목록 0. */
export const SHOT_PRESET_STATE_VALUES = Object.freeze([
  SHOT_PRESET_NONE, ...SHOT_PRESET_IDS,
]);

if (new Set(SHOT_PRESET_IDS).size !== SHOT_PRESET_IDS.length
  || SHOT_PRESET_IDS.includes(SHOT_PRESET_NONE)) {
  throw new Error('촬영 프리셋 id 가 중복이거나 미선택 표지와 충돌한다: '
    + SHOT_PRESET_IDS.join(','));
}

/** id → 선언. 모르는 id 면 null (미선택 표지도 null 이다 — 선언이 아니므로). */
export function shotPresetById(id) {
  return SHOT_PRESETS.find((preset) => preset.id === id) || null;
}

/** 선언 전체가 세우는 상태 키의 합집합 — 자와 이탈 판정이 이 집합만 본다. */
export function shotPresetFieldKeys() {
  const keys = new Set();
  for (const preset of SHOT_PRESETS) {
    for (const key of Object.keys(preset.fields)) keys.add(key);
  }
  return Object.freeze([...keys].sort());
}

/**
 * 선언이 실제 상태 스키마와 맞는가 — **스키마를 인자로 받는다**(순환 회피).
 * `generator-state.js` 가 로드 시점에 부른다. 어긋나면 그 자리에서 던진다:
 * 조용히 두면 「고르면 아무 일도 안 일어나는」 프리셋이 된다.
 */
export function assertShotPresetFields(schema) {
  if (schema === null || typeof schema !== 'object') {
    throw new TypeError('생성기 상태 스키마가 필요하다');
  }
  for (const preset of SHOT_PRESETS) {
    const entries = Object.entries(preset.fields);
    if (entries.length === 0) {
      throw new Error('촬영 프리셋이 아무 필드도 안 세운다: ' + preset.id);
    }
    for (const [key, value] of entries) {
      const descriptor = schema[key];
      if (descriptor === undefined) {
        throw new Error('촬영 프리셋 ' + preset.id + ' 가 없는 상태 키를 세운다: ' + key);
      }
      if (descriptor.options !== undefined && !descriptor.options.includes(value)) {
        throw new Error('촬영 프리셋 ' + preset.id + ' 의 ' + key + ' 값이 허용값 밖이다: '
          + String(value) + ' (허용 ' + descriptor.options.join(', ') + ')');
      }
    }
    /*
     * ⚠ **궤도 각도 축은 위 검사가 원리적으로 못 본다.** 연속값이라 스키마에
     *   `options` 가 없고, `descriptor.options !== undefined` 가 false 라 그냥
     *   지나간다 — 「시스템 자신의 «없음» 출력이 곧 입력이다」의 정확한 형태다.
     *   대답하는 질문이 다르므로 형제 가드를 따로 부른다.
     */
    assertOrbitPresetFields(preset.fields);
  }
  return true;
}

/**
 * 강조 축이 프리셋 필드로 새어 들어왔는가 — **emph-c 레인 경계의 자**.
 *
 * 「형제 가드는 상수를 공유해도 일은 다르다」: 위 `assertShotPresetFields` 는
 * «스키마에 있는 키인가» 를 묻고, 이쪽은 «지금 다른 레인이 뜻을 고치는 중인 축을
 * 굳히고 있지 않은가» 를 묻는다. 강조 가족을 더하는 날 이 자를 **의도적으로**
 * 고쳐야 한다 — 그때가 emph-c 착지 뒤다.
 */
export const SHOT_PRESET_FORBIDDEN_FIELD_KEYS = Object.freeze(['centralN7Emphasis']);

export function assertNoEmphasisFields() {
  for (const preset of SHOT_PRESETS) {
    for (const key of SHOT_PRESET_FORBIDDEN_FIELD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(preset.fields, key)) {
        throw new Error('촬영 프리셋 ' + preset.id + ' 가 강조 축(' + key
          + ')을 세운다 — emph-c 레인이 그 축의 범위를 고치는 중이라 잠그면 안 된다');
      }
    }
  }
  return true;
}

/**
 * 지금 상태가 이 프리셋을 «그대로» 들고 있는가 — 이탈 표시(H2)의 판정.
 *
 * 선언한 필드만 본다. 선언 밖 필드(내용·QR URL·내보내기 크기 등)를 사용자가
 * 바꾸는 것은 이탈이 아니다 — 프리셋이 주장하지 않은 축이기 때문이다.
 */
export function shotPresetMatches(preset, state) {
  if (preset === null || typeof preset !== 'object') return false;
  if (state === null || typeof state !== 'object') return false;
  return Object.entries(preset.fields).every(([key, value]) => state[key] === value);
}

/**
 * 지금 상태가 어느 프리셋과도 같지 않으면 `SHOT_PRESET_NONE`.
 *
 * ⚠ 「고른 프리셋을 기억한다」가 아니라 **「지금 상태가 무엇인가」** 를 답한다.
 *   전자로 만들면 사용자가 옵션을 되돌려 놓아도 화면이 «이탈» 이라고 거짓말한다.
 */
export function shotPresetIdForState(state) {
  const hit = SHOT_PRESETS.find((preset) => shotPresetMatches(preset, state));
  return hit === undefined ? SHOT_PRESET_NONE : hit.id;
}

/**
 * 프리셋을 상태에 얹은 **새 객체**를 만든다 (원본 불변 — 호출자가 대입한다).
 *
 * 미선택(`SHOT_PRESET_NONE`)은 **아무것도 안 되돌린다**: «되돌리기» 는 이 레인의
 * 계약이 아니고(무엇으로 되돌릴지 정의가 없다), 카드를 다시 눌러 끄는 동작도 없다.
 * 모르는 id 는 던진다 — 조용한 무시는 「켰는데 안 먹는」의 씨앗이다.
 */
export function applyShotPresetToState(id, state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('생성기 상태가 필요하다');
  }
  if (id === SHOT_PRESET_NONE) return { ...state, shotPreset: SHOT_PRESET_NONE };
  const preset = shotPresetById(id);
  if (preset === null) throw new RangeError('알 수 없는 촬영 프리셋: ' + String(id));
  return { ...state, ...preset.fields, shotPreset: preset.id };
}

/**
 * 이 프리셋이 `detectorAutoY`(로케이터 «자동» — **상태가 아니라 UI 정책 플래그**)를
 * 내려야 하는가.
 *
 * 왜 필요한가 (실측): `index.html` 의 `applyAutoLocatorProfileY()` 는 자동이 켜져
 * 있으면 QR 위치·버전·타입이 바뀔 때마다 `locatorProfileY` 를 **덮어쓴다**. 프리셋이
 * 로케이터를 지정해 놓고 이 플래그를 안 내리면 「켰는데 안 먹는」이 된다 —
 * 상태 계층만 훑는 자로는 안 보이는 소비자다(「배타를 열면 소비자도 쓸어라」).
 */
export function shotPresetPinsLocator(id) {
  const preset = shotPresetById(id);
  return preset !== null
    && Object.prototype.hasOwnProperty.call(preset.fields, 'locatorProfileY');
}

/**
 * UI 카드 모형 — **화면이 그릴 목록의 정본**.
 *
 * index.html 은 이 배열을 돌면서 카드를 만든다. 그래서 `index.html` 안에 프리셋
 * id·순서·개수의 **사본이 0** 이고(교훈 「사본 목록은 썩는다」), 목록이 선언과
 * 어긋날 방법이 구조적으로 없다. 자는 이 함수를 직접 잰다 —
 * 「초록 테스트는 동작하는 UI 가 아니다」라 DOM 은 못 재지만, 적어도 **모형과 선언의
 * 일치**는 유도 사실로 만들 수 있다.
 *
 * @param {object} state 현재 생성기 상태
 * @returns {{cards: ReadonlyArray<{id,labelKey,subKey,family,active:boolean}>,
 *            selected: string, drifted: boolean}}
 *   `drifted` = «프리셋을 골랐다고 상태에 적혀 있는데 지금 상태가 그 프리셋이 아니다».
 *   H2 의 화면 문구가 이 한 술어에서만 온다.
 */
export function shotPresetUiModel(state) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('생성기 상태가 필요하다');
  }
  const claimed = state.shotPreset;
  const actual = shotPresetIdForState(state);
  const cardOf = (preset) => Object.freeze({
    id: preset.id,
    label: preset.label,
    sub: preset.sub,
    family: preset.family,
    group: preset.group,
    pose: preset.pose,
    // 활성은 «고른 값» 이 아니라 **«지금 상태가 그것인가»** 다. 골라 놓고 옵션을
    // 되돌린 화면이 계속 활성으로 보이면 그림이 거짓말을 한다.
    active: actual === preset.id,
  });
  const cards = SHOT_PRESETS.map(cardOf);
  /*
   * ⭐ **그룹은 배경 2 × 자세 8** (운영자 지시 「8개 자세 x 2 배경 해서 16개」).
   *
   * 16장을 한 줄로 늘어놓으면 못 고른다. 배경으로 묶는 이유는 그것이 **촬영
   * 세션의 단위**이기 때문이다 — 어두운 무지 바탕을 깔아 두고 여덟 장, 바탕을
   * 갈고 다시 여덟 장. 자세로 묶으면 바탕을 열여섯 번 갈아야 한다.
   *
   * ⚠ `cards`(평평한 16)와 `groups` 는 **같은 선언에서 같은 함수로** 유도된다.
   *   둘 다 손 목록이 아니고, 어느 쪽도 상대의 사본이 아니다.
   */
  const groups = SHOT_3D_BACKDROPS.map((bg) => Object.freeze({
    group: bg.backdrop,
    headingKey: bg.headingKey,
    headingSubKey: bg.headingSubKey,
    cards: Object.freeze(cards.filter((card) => card.group === bg.backdrop)),
  }));
  return Object.freeze({
    cards: Object.freeze(cards),
    groups: Object.freeze(groups),
    selected: actual,
    drifted: claimed !== SHOT_PRESET_NONE && claimed !== actual,
  });
}

// ── 로드 시점 자기검증 ────────────────────────────────────────────────────────
// 선언이 «배경 2 × 자세 8 = 16» 을 실제로 낳았는가. 운영자 지시가 장수라서,
// 유도가 조용히 줄어드는 것(예: 표에서 한 줄이 빠짐)을 여기서 바로 잡는다.
if (SHOT_PRESETS.length !== SHOT_3D_BACKDROPS.length * SHOT_3D_POSES.length) {
  throw new Error('촬영 프리셋 장수가 배경 × 자세 유도와 다르다: ' + SHOT_PRESETS.length);
}
// 카드 부제가 원근을 안 적는 대신, 공통값이 「p9」인지 여기서 확인한다.
if (orbitPerspToDeg(SHOT_3D_COMMON.orbitPersp) !== 9) {
  throw new Error('3D 촬영 공통 원근이 반각 9° 가 아니다 — y2-p9rot 과 축이 둘 갈린다');
}
