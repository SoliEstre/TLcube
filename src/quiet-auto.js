/**
 * quiet-auto.js — 안전영역 **흰/검 자동 선택** 규칙 (과업 #18). 순수 함수, 의존 0.
 *
 * ## 무엇이 바뀌었나 — «죽은 타이브레이크» 의 입력 승격
 *
 * 종전 규칙(`index.html highContrastQuietColor`)은 이랬다:
 *
 *   1순위  셀 레벨과의 분리 sep 이 큰 쪽
 *   2순위  (|sepW − sepB| ≤ 0.02 일 때만) 배치 표면 휘도와 다른 쪽
 *
 * 그런데 **2순위가 한 번도 실행되지 않았다** (2026-08-16 적대 검증 ⑤). UI 로 만들 수
 * 있는 팔레트의 |sepW − sepB| 가 전부 0.02 밖이기 때문이다 — slate 0.1689 ·
 * ember 0.2507 · mono 0.0257 · 커스텀 hue 0\~359 는 0.1629\~0.1764. 즉 배치 미리보기
 * 사진을 넣어도 안전영역 색은 **절대 안 바뀌었다**.
 *
 * 이 모듈은 그 입력을 **1급**으로 올린다. 문턱 0.02 는 그대로 두고(내리지 않는다),
 * 대신 **순서**를 바꾼다 — 두 실패가 같은 무게가 아니기 때문이다:
 *
 *   · 안전영역 색 ≈ **셀** 색  → 안전영역이 코드에 붙어 실루엣이 코드보다 커진다.
 *                                 격자 가설이 깨진다. **적극적으로 해롭다.**
 *   · 안전영역 색 ≈ **표면** 색 → 안전영역이 안 보일 뿐, 상태는 «안전영역 없음» 과
 *                                 같다. 쓸모가 없을 뿐 해롭지는 않다.
 *
 * 그래서 결합은 «둘의 평균» 도 «둘 중 약한 쪽» 도 아니라 **바닥 + 최대화**다:
 *
 *   ① 셀 분리가 계약 바닥(0.05, SPEC §7.1 = index.html BG_SEPARATION_MIN)을 못 넘는
 *      색은 **탈락**한다. 하나만 남으면 그게 답이다.
 *   ② 둘 다 바닥을 넘으면 **표면 분리가 큰 쪽**을 고른다 ← 여기서 사진이 결정한다.
 *   ③ 표면 분리가 거의 같으면(≤ 0.02) 셀 분리가 큰 쪽.
 *
 * 사진이 없으면 ②③ 이 없으니 종전 규칙 그대로다 — 즉 이 변경은 사진이 있을 때만
 * 거동을 바꾼다.
 *
 * ### 왜 문턱(0.02)을 안 내렸나 · 바닥(0.05)은 어디서 왔나 (조정 근거)
 *
 * 문턱을 내려서 죽은 분기를 살리는 방법도 있었다. 안 한 이유: 그 분기는 «셀 분리가
 * 사실상 동점일 때 표면으로 가른다» 는 **약한 규칙**이라, 문턱을 0 까지 내려도 표면이
 * 결정을 뒤집지 못한다 — slate 실측 sepW 0.2301 · sepB 0.0612 라 흰 벽 위에서도 계속
 * 흰색이 뽑힌다. 고쳐야 할 것은 문턱이 아니라 **순서**였다. 문턱 0.02 는 ③ 의 마지막
 * 갈림에 그대로 남는다.
 *
 * 새로 쓰는 수는 **바닥 0.05 하나**이고, 그것도 새 상수가 아니다 — 배경 분리 계약
 * (SPEC §7.1)의 값이며 이 화면이 이미 «분리 0.0xx (권장 ≥ 0.05)» 로 사용자에게 보여
 * 주고 있던 숫자다. 즉 규칙이 화면에 이미 적힌 계약을 따르게 됐을 뿐이다.
 * 호출자가 `separationFloor` 로 그 값을 **넘겨준다** — 두 곳에 숫자를 적지 않는다.
 *
 * ## 결정 규칙 (정본)
 *
 *   quietMode 'none'                       → 없음
 *   quietMode 'white' / 'black'            → 그 색 (사용자 명시 — 사진과 무관)
 *   quietMode 'contrast'                   → decide()
 *   quietMode 'auto'  + 배경 투명           → decide()
 *   quietMode 'auto'  + 배경 흰/검          → 없음 (불투명 배경이 이미 분리를 준다)
 *
 *   decide(sepW, sepB, surfaceY):
 *     사진 없음(surfaceY = null) → 셀 분리가 큰 쪽 (완전 동점이면 흰색 — 종전
 *                                 highContrastQuietColor 와 동일; 문턱은 이 가지에
 *                                 관여하지 않는다)
 *     사진 있음                  → okW = sepW ≥ 0.05 · okB = sepB ≥ 0.05
 *                                 okW ≠ okB          → 통과한 쪽
 *                                 둘 다 탈락          → 셀 분리가 큰 쪽
 *                                 둘 다 통과          → |1−Ys| vs |0−Ys| 가 큰 쪽
 *                                                      (차이 ≤ 0.02 면 셀 분리가 큰 쪽)
 *
 * 표면 휘도는 **코드 주변 국소** 값이다 (index.html measureBackdrop — 불투명 영역
 * bbox 를 8 % 넓힌 안쪽에서 코드가 안 덮은 픽셀만 평균). 사진 구석까지 재면 «코드가
 * 놓일 자리» 와 무관한 값이 나온다.
 *
 * @module quiet-auto
 */

/** 안전영역 색 후보의 상대휘도. 흰 1 · 검 0 — 정의상 고정이라 계산하지 않는다. */
export const QUIET_WHITE_LUMINANCE = 1;
export const QUIET_BLACK_LUMINANCE = 0;

/**
 * «거의 동점» 문턱. 종전 값을 그대로 쓴다 (모듈 상단 «왜 문턱을 안 내렸나»).
 */
export const QUIET_TIE_THRESHOLD = 0.02;

/**
 * 셀 분리 **바닥**의 폴백. 정본은 호출자가 넘기는 `separationFloor` 이고
 * (index.html 은 `BG_SEPARATION_MIN` 을 넘긴다), 이 값은 단독 사용 시의 기본값이다.
 * 두 곳에 다른 수가 적히는 것을 막으려고 테스트가 둘의 일치를 확인한다.
 */
export const QUIET_CELL_SEPARATION_FLOOR = 0.05;

/** 결정 결과의 색 이름. */
export const QUIET_COLOR_WHITE = 'white';
export const QUIET_COLOR_BLACK = 'black';
export const QUIET_COLOR_NONE = 'none';

/**
 * 흰/검 결정. **순수 함수** — 여기 들어오는 수치 넷이 전부다.
 *
 * @param {{sepWhite:number, sepBlack:number, surfaceLuminance:number|null,
 *          tieThreshold?:number, separationFloor?:number}} input
 *   sepWhite/sepBlack = 후보색과 셀 레벨들 사이의 최소 상대휘도 분리.
 *   surfaceLuminance = 배치 미리보기 사진의 **코드 주변 국소** 평균 상대휘도.
 *     사진이 없으면 null.
 *   separationFloor = 셀 분리 바닥 (호출자가 BG_SEPARATION_MIN 을 넘긴다).
 * @returns {{color:'white'|'black', reason:string, scoreWhite:number, scoreBlack:number}}
 *   reason 은 어느 갈림에서 정해졌는지, score* 는 그 갈림에서 실제로 비교한 두 수다 —
 *   화면 문구·테스트가 이 값을 읽는다.
 */
export function decideQuietColor(input) {
  const tie = input.tieThreshold === undefined ? QUIET_TIE_THRESHOLD : input.tieThreshold;
  const floor = input.separationFloor === undefined
    ? QUIET_CELL_SEPARATION_FLOOR : input.separationFloor;
  const sepW = input.sepWhite;
  const sepB = input.sepBlack;
  const surfaceY = input.surfaceLuminance;

  if (!Number.isFinite(sepW) || !Number.isFinite(sepB)) {
    throw new TypeError('sepWhite·sepBlack 은 유한수여야 한다');
  }

  /** 셀 분리만으로 가르는 종전 규칙 — 사진이 없을 때와 모든 동점의 마지막 갈림. */
  const byCellSeparation = (reason) => ({
    color: sepW >= sepB ? QUIET_COLOR_WHITE : QUIET_COLOR_BLACK,
    reason,
    scoreWhite: sepW,
    scoreBlack: sepB,
  });

  if (surfaceY === null || surfaceY === undefined) {
    // 사진 없음 — 종전 규칙 그대로 (셀 분리만 본다).
    if (Math.abs(sepW - sepB) > tie) {
      return {
        color: sepW > sepB ? QUIET_COLOR_WHITE : QUIET_COLOR_BLACK,
        reason: 'cell-separation',
        scoreWhite: sepW,
        scoreBlack: sepB,
      };
    }
    return byCellSeparation('cell-separation-tie');
  }

  if (!Number.isFinite(surfaceY)) {
    throw new TypeError('surfaceLuminance 는 유한수 또는 null 이어야 한다');
  }

  // ① 셀 분리 바닥 — 못 넘는 색은 «안전영역이 코드에 붙는» 쪽이라 탈락시킨다.
  const okW = sepW >= floor;
  const okB = sepB >= floor;
  if (okW !== okB) {
    return {
      color: okW ? QUIET_COLOR_WHITE : QUIET_COLOR_BLACK,
      reason: 'cell-floor',
      scoreWhite: sepW,
      scoreBlack: sepB,
    };
  }
  if (!okW && !okB) return byCellSeparation('cell-floor-both-fail');

  // ② 둘 다 바닥을 넘었다 — 여기서 **사진이 결정한다**.
  const surfW = Math.abs(QUIET_WHITE_LUMINANCE - surfaceY);
  const surfB = Math.abs(QUIET_BLACK_LUMINANCE - surfaceY);
  if (Math.abs(surfW - surfB) > tie) {
    return {
      color: surfW > surfB ? QUIET_COLOR_WHITE : QUIET_COLOR_BLACK,
      reason: 'surface-separation',
      scoreWhite: surfW,
      scoreBlack: surfB,
    };
  }
  // ③ 표면 분리가 거의 같다(회색 표면) — 마지막 갈림은 셀 분리다.
  return byCellSeparation('surface-tie-cell');
}

/**
 * quietMode + 배경 모드까지 포함한 **전체** 결정. 색을 안 넣는 경우도 여기서 정한다.
 *
 * @param {{quietMode:string, bgMode:string, sepWhite:number, sepBlack:number,
 *          surfaceLuminance:number|null, tieThreshold?:number,
 *          separationFloor?:number}} input
 * @returns {{color:'white'|'black'|'none', reason:string,
 *            scoreWhite:number|null, scoreBlack:number|null}}
 */
export function resolveQuietZoneChoice(input) {
  const { quietMode, bgMode } = input;
  if (quietMode === 'none') {
    return {
      color: QUIET_COLOR_NONE, reason: 'user-none', scoreWhite: null, scoreBlack: null,
    };
  }
  if (quietMode === QUIET_COLOR_WHITE || quietMode === QUIET_COLOR_BLACK) {
    return {
      color: quietMode, reason: 'user-fixed', scoreWhite: null, scoreBlack: null,
    };
  }
  if (quietMode === 'auto' && bgMode !== 'transparent') {
    // 불투명 배경은 실효 배경이 확정돼 있어 분리가 이미 보증된다.
    return {
      color: QUIET_COLOR_NONE, reason: 'auto-opaque-background', scoreWhite: null, scoreBlack: null,
    };
  }
  if (quietMode !== 'auto' && quietMode !== 'contrast') {
    throw new RangeError('알 수 없는 안전영역 모드: ' + quietMode);
  }
  return decideQuietColor(input);
}
