/**
 * render-profile.js — **렌더 프로파일** (Type Y 면 게인 묶음)의 단일 정의.
 *
 * 면 게인은 지금까지 sceneY.js 의 `DEFAULT_FACE_GAINS` 상수 하나뿐이었다. 그런데
 * «어디에 쓰이는 코드인가» 에 따라 최적값이 갈린다는 것이 실측으로 나왔다:
 *
 *   · **화면용** — 입체감(3면이 서로 다른 밝기)이 그림의 정체성이고, 화면·촬영
 *     경로에서는 그 대비 차이가 스캐너에도 도움이 된다. 다만 R 면이 너무 어두우면
 *     기하 후보 자체가 안 만들어진다 → R 을 0.52 에서 0.62 로 올린다 (§ 아래).
 *   · **출력물용** — 인쇄물은 잉크·용지·조명이 저게인 면을 한 번 더 깎는다. 3면
 *     **동률**(게인 1)이면 그 손실이 없다. 디코더는 면별로 앵커를 다시 잡으므로
 *     («면별 앵커 재고정») 게인이 없어도 순위 판독이 성립한다 — 즉 동률은 판독을
 *     포기하는 선택이 아니다. 이 비의존성은 왕복 벤치로 실증한다.
 *   · **오리지널** — 구 기본값 {1, 0.72, 0.52}. **lab 전용**이고, R 게인 변경의
 *     A/B 재스캔 대조군으로만 남긴다. 정식 화면에는 노출하지 않는다.
 *
 * ## R 0.52 → 0.62 의 근거
 *
 * 다른 모든 것을 고정하고 `faceGains.R` 만 바꾼 합성 절제 (v0·n13 · tones{2,3} ·
 * cell_px{10,12} · S커브 0.6 · 노이즈 σ{0.02,0.04} · JPEG q45 · θ{0,20,29,40,45,51}
 * × 축{h,v}, 게이트 무변경):
 *
 *   R 0.52 → 70/88 (80 %) · R 0.62 → 82/88 (93 %) · R 0.72 → 82/88 (93 %)
 *   짝지음 88쌍 McNemar 양측 정확검정 p ≈ 0.0042.
 *
 * 실패 사유 분해가 결정적이다 — R0.52 실패 18건 중 **14건이 `no-grid-hypothesis`**
 * (기하 후보 자체가 안 생김)였고, R0.72 의 실패 6건은 전부 그다음 단계
 * (`no-format-candidate`)였다. 즉 기전은 «R 면 셀을 오독» 이 아니라 «R 면의 낮은
 * 대비가 CS 블록/실루엣 단계에서 후보 기하를 못 만들게 한다» 이다. 효과는 0.62 에서
 * 이미 포화하므로 γ 여유를 다 쓰지 않는다.
 * 정본: `test/output/claude-skew-real.md` §2.4.
 *
 * ⚠ 이 절제는 **합성**이다. 실사진 확증은 아직 없다 — R 게인이 다른 심볼을 새로
 *   인쇄/표시해 같은 조건으로 다시 찍어야 한다 (같은 문서 §7.3 의 유보).
 *
 * ## 이 모듈이 의존을 갖지 않는 이유
 *
 * `sceneY.js`(렌더 코어)와 `generator-state.js`(UI 상태)가 **둘 다** 이 표를 읽는다.
 * 번들 로더는 등록 순서 = specifier 치환 가능 순서라 전방 참조를 조용히 깨뜨린다
 * (`tools/build-single.mjs` assertTopologicalOrder). 의존이 0 이면 MODULE_ORDER 어디에
 * 놓아도 위상 정렬이 성립하므로, 상수를 복제하는 대신 잎(leaf) 모듈로 둔다.
 *
 * @module render-profile
 */

/** 화면·촬영용 (기본). 입체감 유지 + R 면 대비 보강. UI 라벨 «중». */
export const RENDER_PROFILE_SCREEN = 'screen';
/**
 * 약한 입체감 (2026-08-19 신설, «큐브 입체감» 개편). 인쇄물에서 3면 동률(평면)은
 * 입체감이라는 정체성을 완전히 버리는 선택이라, 잉크·용지의 저게인 면 손실을
 * 감안하고도 순위 판독이 서는 **가장 얕은 게인**을 따로 둔다. UI 라벨 «약».
 * 게인 값 근거는 직전 레인 실측 + 이 레인 재측정 — `test/output/lanes/export-options-report.md` §2.1.
 */
export const RENDER_PROFILE_SOFT = 'soft';
/** 인쇄물용. 3면 동률 — 잉크·용지가 저게인 면을 한 번 더 깎는 것을 피한다. UI 라벨 «평면». */
export const RENDER_PROFILE_PRINT = 'print';
/** 구 기본값 (lab 전용 A/B 대조군). UI 라벨 «강». */
export const RENDER_PROFILE_ORIGINAL = 'original';

/**
 * UI 전용 선택값 «자동» — **게인 행이 아니다.** 상태에는 저장되지만 렌더 직전에
 * `export-options.js` 의 resolveRenderProfile() 이 구체 프로파일로 푼다.
 * assertRenderProfile / faceGainsForRenderProfile 은 이 값을 **거부한다** — 자동을
 * 풀지 않고 게인 표를 읽으려는 호출은 배선 결함이므로 조용히 기본값으로 떨어지면 안 된다.
 */
export const RENDER_PROFILE_AUTO = 'auto';

/** 정식 라인업 — 중(화면)·약·평면 3종. 카드 순서가 이 순서다 (§1.1 자동-강-중-약-평면). */
export const OFFICIAL_RENDER_PROFILES = Object.freeze([
  RENDER_PROFILE_SCREEN, RENDER_PROFILE_SOFT, RENDER_PROFILE_PRINT,
]);

/** lab 라인업 — «오리지널(강)» 이 **맨 앞**이다 (A/B 재스캔에서 대조군을 먼저 집는다). */
export const LAB_RENDER_PROFILES = Object.freeze([
  RENDER_PROFILE_ORIGINAL, ...OFFICIAL_RENDER_PROFILES,
]);

/** 게인 표가 있는 구체 프로파일 전부 = lab 라인업 (저장된 lab 선택이 정식에서 죽지 않는다). */
export const RENDER_PROFILE_IDS = LAB_RENDER_PROFILES;

/**
 * 상태 스키마가 허용하는 **선택값** = «자동» + 구체 프로파일. 저장·복원은 이 목록으로
 * 검증하고, 렌더 경로는 자동을 푼 뒤 RENDER_PROFILE_IDS 세계에서만 산다.
 */
export const RENDER_PROFILE_CHOICES = Object.freeze([
  RENDER_PROFILE_AUTO, ...RENDER_PROFILE_IDS,
]);

/** 기본 프로파일(구체). `DEFAULT_FACE_GAINS` 가 이 프로파일의 게인이다. */
export const DEFAULT_RENDER_PROFILE = RENDER_PROFILE_SCREEN;

/**
 * 생성기 상태의 기본 **선택값**은 «자동» 이다 (운영자 지시 2026-08-19 §1.1).
 * 자동은 인쇄용·디더링 문맥이 없으면 «중(screen)» 으로 풀리므로, 아무것도 안 고른
 * 사용자의 렌더 픽셀은 이 개편 전과 동일하다.
 */
export const DEFAULT_RENDER_PROFILE_CHOICE = RENDER_PROFILE_AUTO;

/**
 * 프로파일별 면 게인. T 는 언제나 1(기준면)이다 — 게인은 «T 대비 얼마나 어두운가» 라서
 * T 를 1 이 아닌 값으로 두면 같은 그림을 두 가지 수로 쓰게 된다.
 */
export const RENDER_PROFILE_FACE_GAINS = Object.freeze({
  [RENDER_PROFILE_ORIGINAL]: Object.freeze({ T: 1, L: 0.72, R: 0.52 }),
  [RENDER_PROFILE_SCREEN]: Object.freeze({ T: 1, L: 0.72, R: 0.62 }),
  // «약» — 평면(1/1/1)과 중(0.72/0.62) 사이. R 게인 재측정은
  // test/output/lanes/export-options-report.md §2.1 (왕복·Δmin 계약 확인 포함).
  [RENDER_PROFILE_SOFT]: Object.freeze({ T: 1, L: 0.85, R: 0.78 }),
  [RENDER_PROFILE_PRINT]: Object.freeze({ T: 1, L: 1, R: 1 }),
});

/** 게인비 γ = max/min. SPEC §14 렌더러 의무는 γ ≤ 2 다. */
export function renderProfileGainRatio(profile) {
  const g = faceGainsForRenderProfile(profile);
  return Math.max(g.T, g.L, g.R) / Math.min(g.T, g.L, g.R);
}

/** 알 수 없는 id 는 던진다 — 조용히 기본값으로 떨어지면 «왜 안 바뀌지» 가 된다. */
export function assertRenderProfile(profile) {
  if (!RENDER_PROFILE_IDS.includes(profile)) {
    throw new RangeError('알 수 없는 렌더 프로파일: ' + profile);
  }
  return profile;
}

/** 프로파일 → 면 게인 (frozen). */
export function faceGainsForRenderProfile(profile) {
  return RENDER_PROFILE_FACE_GAINS[assertRenderProfile(profile)];
}

/** 정식 화면에 노출하지 않는 프로파일인가 (= lab 전용). */
export function isLabOnlyRenderProfile(profile) {
  return assertRenderProfile(profile) === RENDER_PROFILE_ORIGINAL;
}

/** 지금 화면(정식/lab)에서 보여 줄 카드 순서. */
export function renderProfilesForSurface(lab) {
  return lab ? LAB_RENDER_PROFILES : OFFICIAL_RENDER_PROFILES;
}
