/**
 * export-options.js — 생성기 **내보내기 옵션 4종**의 도메인 + 자동 규칙 (단일 정의)
 *
 * 운영자 지시 2026-08-19. 화면 위→아래 순서 = 이 파일의 절 순서:
 *   ① 고정 이미지 크기        (EXPORT_SIZE_*)
 *   ② 적은 색상 화면 최적화    (EXPORT_DITHER_*)  — 실제 양자화·디더링 (src/dither.js)
 *   ③ 출력 최적화 (고PPI)     (EXPORT_PPI_*)     — PNG 전용 (SVG 는 벡터 — ppi 무의미)
 *   ④ 큐브 입체감             (render-profile.js — 여기는 «자동» 해석만)
 *
 * ## 픽셀 수는 누가 정하나 (계약)
 *
 * **픽셀 수는 언제나 ①이 정한다.** ③의 ppi 는 (a) PNG pHYs 물리 밀도 메타데이터,
 * (b) «인쇄용» 갈래가 ④ 자동을 «약» 으로 트는 문맥, (c) ②의 조합표가 권하는
 * 셀px 스케일의 어휘다. ①이 자동일 때의 픽셀 하한은 ppi 가 아니라 **복호 실측**
 * (minRoundtripPpu)에서 온다 — «하한 최저 = 왕복이 서는 최소 셀px» 라는 운영자
 * 정의가 ppi 와 무관한 픽셀 명제라서다. (③이 픽셀 수를 직접 늘려야 한다는 해석이
 * 필요하면 보고서 «미결» 절 참조.)
 *
 * ## 왜 별도 모듈인가
 *
 * 소비자가 셋이다 — 생성기 UI(index.html) · 내보내기 파이프라인(export-render.js) ·
 * 회귀 테스트. UI 인라인에 규칙을 적으면 테스트가 못 닿고(교훈 .agent/_lessons/009 —
 * 손으로 적은 옵션에서 출발한 회귀는 배선을 안 잠근다), 테스트가 자기 사본을 들면
 * 그 사본이 다음 거짓말이 된다. 규칙은 여기 한 곳에만 산다.
 *
 * 실측 상수(조합표·하한표·배율)의 근거는 전부
 * `test/output/lanes/export-options-report.md` §2 다 — 값을 고치려면 먼저 재라.
 *
 * @module export-options
 */

import {
  RENDER_PROFILE_AUTO,
  RENDER_PROFILE_CHOICES,
  RENDER_PROFILE_PRINT,
  RENDER_PROFILE_SCREEN,
  RENDER_PROFILE_SOFT,
  assertRenderProfile,
} from './render-profile.js';
import { DITHER_BIT_DEPTHS } from './dither.js';
import { CELL_SURFACE_FINAL_NS, versionForFinalN } from './cellSurfaceFinal.js';

// ─────────────────────────────────────────────────────────────────────────────
// ① 고정 이미지 크기
// ─────────────────────────────────────────────────────────────────────────────

/** 자동(하한 최저) — 왕복이 서는 최소 셀px 로 낸 크기. */
export const EXPORT_SIZE_AUTO_MIN = 'auto-min';
/** 자동(최적용량) — 하한 × AUTO_SIZE_MULTIPLIERS[fit]. 기본값. */
export const EXPORT_SIZE_AUTO_FIT = 'auto-fit';
/** 자동(고품질) — 하한 × AUTO_SIZE_MULTIPLIERS[high]. */
export const EXPORT_SIZE_AUTO_HIGH = 'auto-high';
/** 커스텀 — 폭·높이를 따로 받는다 (정사각 강제 해제). */
export const EXPORT_SIZE_CUSTOM = 'custom';
/** 고정 프리셋 (정사각 한 변 px). */
export const EXPORT_FIXED_SIZES = Object.freeze([192, 512, 1024, 2048, 4096]);

export const EXPORT_SIZE_CHOICES = Object.freeze([
  EXPORT_SIZE_AUTO_MIN, EXPORT_SIZE_AUTO_FIT, EXPORT_SIZE_AUTO_HIGH,
  ...EXPORT_FIXED_SIZES, EXPORT_SIZE_CUSTOM,
]);
export const DEFAULT_EXPORT_SIZE = EXPORT_SIZE_AUTO_FIT;

/** 커스텀 폭·높이 기본값 (px). 커스텀을 켠 순간 보이는 초기값일 뿐이다. */
export const DEFAULT_EXPORT_CUSTOM_PX = 1024;

/**
 * 자동 3종의 배율 — «출발점 1.5 / 2.5» 를 왜곡 스윕 실측(보고서 §2.3)으로 **확정**한 값.
 * 실측 요지: 하한(×1.0)은 회전 10°·틸트·감마·S커브·노이즈·JPEG 근사에 전부 생존했고,
 * 유일한 계통 실패는 다운스케일 0.75 (해상도 축 여유 0 — 정의상 당연). 1.5 는 그
 * 다운스케일 생존이 O 계열에서 시작되는 공통 안전선이고(1.25 는 O 에서 죽는다),
 * 2.5 는 전 왜곡 초록 + 복합 왜곡 미측정분의 여유다. 즉 «하한 최저가 무왜곡 전용»
 * 이라는 가설은 광도·기하 축에서는 기각, **해상도 손실 축에서만 성립**했다.
 */
export const AUTO_SIZE_MULTIPLIERS = Object.freeze({
  [EXPORT_SIZE_AUTO_MIN]: 1,
  [EXPORT_SIZE_AUTO_FIT]: 1.5,
  [EXPORT_SIZE_AUTO_HIGH]: 2.5,
});

/** 여백 포함(기본) / 여백 없음. «없음» 의 정의·경고는 보고서 §2.4 실측이 정했다 (아래 표). */
export const EXPORT_MARGIN_INCLUDE = 'margin';
export const EXPORT_MARGIN_TRIM = 'trim';
export const EXPORT_MARGIN_MODES = Object.freeze([EXPORT_MARGIN_INCLUDE, EXPORT_MARGIN_TRIM]);
export const DEFAULT_EXPORT_MARGIN = EXPORT_MARGIN_INCLUDE;

/**
 * «여백 없음» 의 정의 — **quiet zone 은 유지하고 장식 여백만 제거한다** (§2.4 실측 β안).
 * margin 0 은 실제로 복호를 죽인다: O V2 는 체커 배경·ppu10 에서 margin ≤ 1 이 3/3
 * 전멸(no-anchors)했고, Y 도 파일 단독 복호에서 2건 실패했다. 그래서 «없음» 은 0 이
 * 아니라 **타입(·A·K 는 버전)별 최소 안전 margin** 으로 클램프한다 (cellSize 단위):
 *   · Y 1 — margin 1 은 어두운/체커 배경 포함 전 조건 36/36 통과
 *   · O 2 — 1 이하에서 no-anchors 산발 (기전은 quiet zone 폭이 아니라 앵커 검출 간섭).
 *           기본 margin 도 2 라 O 의 trim 은 사실상 무동작이다 — 장식 여백이 애초에 없다.
 *   · A {V0: 10, V1: 13, V2: 17} — **버전 의존이다** (통합 감사 지적 수리, §9 실측).
 *     scene 빌더의 삼각 패치 캔버스 이탈 가드가 버전별로 margin {9, 12, 15} 미만을
 *     던지고, V0/V1 은 빌드최소+1 이 직접·어두움·체커 합성 전부를 통과한다. V2 는
 *     빌드최소+1(16)이 어두운 배경 합성에서 죽어(auto-fit 실측) **+2 = 17** 이
 *     안전선이다. 일률 10 은 A1/A2 «여백 없음» 을 렌더 불능으로 만들었다 (사용자
 *     도달 가능 결함이었다).
 *   · K {V0: 10, V1: 13, V2: 16} — **버전 의존이다** (2026-09-26 실측 — 그전엔 표에 K 가
 *     없어 K «여백 없음» PNG/SVG 가 `알 수 없는 생성기 타입: K` 로 죽었다). K = A ∪ 반전A
 *     라 캔버스·빌드최소가 A 와 같다 ({9, 12, 15}). A 와 같은 규칙(빌드최소+1)을 쓰고,
 *     K 는 +1 에서 직접·어두움·체커 합성과 투명+링이 전부 통과한다 — A2 의 +2 는 K2 에
 *     필요 없었다. «중앙 QR + 코너 QR 병행» 은 이 값에서 빌드가 안 서 buildTrimmedScene
 *     이 빌드최소(17)까지 올린다 (코너 QR 문맥이 qrCorner 로만 잡혀서다 — O·A 와 같은 경로).
 *     ⚠ 이 표가 못 지키는 축: 병행(K0·K2)과 K2 CM + 중앙 QR 은 auto-fit 크기에서 **margin
 *     과 무관하게** 복호가 죽는다 (기본 20 포함 전 margin 실패 · auto-high 는 통과) —
 *     trim 결함이 아니라 K 의 자동 크기 하한(MIN_ROUNDTRIP_PPU 에 K 행 없음 → 폴백 12)
 *     쪽 문제로 보인다(가설, 미확인). 실측: private `.agent/lanes/k-trim-margin-20260926/`.
 */
export const EXPORT_TRIM_MARGINS = Object.freeze({
  O: 2,
  A: Object.freeze({ 0: 10, 1: 13, 2: 17 }),
  Y: 1,
  K: Object.freeze({ 0: 10, 1: 13, 2: 16 }),
});

/**
 * 코너 QR 이 있는 구성의 «여백 없음» 하한 — **전 타입·전 버전 공통 20** (§9 실측:
 * A0\~A2 · O2 · Y v0T 전부 빌드 최소 margin 20). 코너 QR 블록(v2 QR + 콰이어트 존)이
 * 여백 공간에 사는 **기능 요소**라, 그 여백은 장식이 아니다 — trim 은 여기까지만 깎는다.
 */
export const EXPORT_TRIM_CORNER_QR_MARGIN = 20;

/**
 * «여백 없음» 내보내기가 scene 재생성에 쓸 margin (cellSize 1 기준).
 * @param {'O'|'A'|'Y'|'K'} type
 * @param {{version?: number, cornerQr?: boolean}} [ctx] A·K 는 version 필수 (버전 의존 —
 *   위 표), cornerQr 이 true 면 코너 QR 하한(20)으로 클램프한다.
 */
export function trimExportMargin(type, ctx = {}) {
  if (!Object.prototype.hasOwnProperty.call(EXPORT_TRIM_MARGINS, type)) {
    throw new RangeError('알 수 없는 생성기 타입: ' + type);
  }
  let base = EXPORT_TRIM_MARGINS[type];
  // 버전 의존 여부는 표의 모양(버전 → margin 객체)이 정한다 — 타입 이름을 여기 다시
  // 적으면 표와 이 분기가 두 벌이 된다.
  if (typeof base === 'object') {
    if (!Object.prototype.hasOwnProperty.call(base, ctx.version)) {
      throw new RangeError(type + ' 의 trim margin 은 버전 의존이다 — 알 수 없는 버전: ' + ctx.version);
    }
    base = base[ctx.version];
  }
  return ctx.cornerQr === true ? Math.max(base, EXPORT_TRIM_CORNER_QR_MARGIN) : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 적은 색상 화면 최적화 (디더링)
// ─────────────────────────────────────────────────────────────────────────────

/** «자동» = 아무것도 양자화하지 않는다 (24비트 그대로 — 운영자 확정 해석). */
export const EXPORT_DITHER_AUTO = 'auto';
export const EXPORT_DITHER_CHOICES = Object.freeze([EXPORT_DITHER_AUTO, ...DITHER_BIT_DEPTHS]);
export const DEFAULT_EXPORT_DITHER = EXPORT_DITHER_AUTO;

// ─────────────────────────────────────────────────────────────────────────────
// ③ 출력 최적화 (고PPI, PNG 전용)
// ─────────────────────────────────────────────────────────────────────────────

export const EXPORT_PPI_SCREEN = 'screen';
export const EXPORT_PPI_PRINT = 'print';
export const EXPORT_PPI_PURPOSES = Object.freeze([EXPORT_PPI_SCREEN, EXPORT_PPI_PRINT]);
export const DEFAULT_EXPORT_PPI_PURPOSE = EXPORT_PPI_SCREEN;

/** 화면용 세부 4종 — 기본(웹) 72 · 권장(윈도우) 96 · 2x(레티나) 144 · HiDPI 192. */
export const SCREEN_PPI_TIERS = Object.freeze([72, 96, 144, 192]);
/**
 * 인쇄용 세부 4종 — 일반 300 · 1.5배 450 · 2배 600 · 4배 1200.
 * 1200 은 운영자 추가(2026-08-19 후속) — 사무실 프린터의 1200dpi 모드 대응. 기본값은
 * 여전히 300 이고, 픽셀 수는 ①이 정하므로 1200 선택의 효과는 pHYs 밀도 선언
 * (= 같은 픽셀의 물리 크기가 1/4)뿐이다 — 실측·함의는 보고서 §8.
 */
export const PRINT_PPI_TIERS = Object.freeze([300, 450, 600, 1200]);
/** 갈래별 기본값 — 일반 모드는 갈래만 고르고 이 값이 적용된다. */
export const DEFAULT_SCREEN_PPI = 144;
export const DEFAULT_PRINT_PPI = 300;

/** 고급 세부 선택 — «자동» 은 갈래 기본값(144/300) 또는 ② 조합표 값. */
export const EXPORT_PPI_DETAIL_AUTO = 'auto';
export const EXPORT_PPI_DETAIL_CHOICES = Object.freeze([
  EXPORT_PPI_DETAIL_AUTO, ...SCREEN_PPI_TIERS, ...PRINT_PPI_TIERS,
]);

/**
 * ppi ↔ 렌더 밀도(ppu)의 공칭 환산: **96 ppi ≙ ppu 32** (개편 전 내보내기의 고정값
 * ppu 32 를 «권장(윈도우) 96» 으로 소급 명명). 즉 1 scene 단위 = 1/3 inch 로 두는
 * 공칭 물리 모델이고, ②·③의 실측 격자가 ppi 축을 픽셀로 옮길 때 이 환산을 쓴다.
 */
export const PPU_PER_PPI = 32 / 96;
export function ppuForPpi(ppi) { return ppi * PPU_PER_PPI; }

/** 픽셀 폭 + ppi → 물리 폭 mm (pHYs 선언대로 찍었을 때). */
export function exportPhysicalWidthMm(widthPx, ppi) {
  if (!(widthPx > 0) || !(ppi > 0)) {
    throw new RangeError('물리 폭 환산에는 양수 px·ppi 가 필요하다: ' + widthPx + ', ' + ppi);
  }
  return (widthPx / ppi) * 25.4;
}

/**
 * 인쇄용 물리 폭의 안내 경계 (§8.2 실측 근거 — 기본 자동 크기 + 1200ppi 는 7.6mm
 * «스탬프» 가 된다). 이보다 작으면 UI 가 «큰 고정 크기와 함께 쓰라» 고 고르기 전에
 * 경고한다 — 차단이 아니라 안내다 (작게 찍는 사용이 실재할 수 있다).
 */
export const EXPORT_MIN_COMFORT_PRINT_MM = 15;

// ─────────────────────────────────────────────────────────────────────────────
// 실측 조합표 — ② 비트깊이 → (ppi, 입체감) 자동값
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 보고서 §2.2 의 격자(비트깊이 × ppi × 프로파일 왕복 실측)에서 유도한 조합표.
 * 비트깊이를 고르면 «ppi 세부·입체감이 자동일 때» 이 값이 적용된다.
 *
 * ⚠ 값이 null 인 축은 «그 비트깊이에서 자동이 특별히 할 일이 없다(갈래 기본값 그대로)»,
 *   항목 자체가 없으면 «측정 결과 성립 불가 — UI 가 경고를 단다» 다.
 *   (이 표는 §2.2 실측으로 채워진다 — 자리만 먼저 고정한다.)
 */
export const DITHER_AUTO_COMBO = Object.freeze({
  // 필드 셋 — 소비자가 갈린다 (수리 라운드 §10: 통합 감사의 «값만 편집» 판단은 배관까지는
  // 맞았지만 ppi 필드가 **이중 소비**였다):
  //   · profile — 자동 입체감 (resolveRenderProfile)
  //   · ppi     — 화면용 pHYs 메타데이터 권장값 (resolveExportPpi). 픽셀과 무관.
  //   · minPpi  — **자동 크기의 렌더 밀도 하한** (minRoundtripPpu — ppuForPpi 환산).
  //     ppi 에 하한을 실으면 pHYs 가 함께 격하되는 부작용이 있어 필드를 분리했다.
  //
  // 2비트(휘도 4계조): screen/soft 게인은 3톤 레벨을 같은 계조로 뭉개 **전멸**(0/8,
  // no-format-candidate)한다. 3면 동률(print)만 2톤·3톤 모두 왕복 — 자동은 print 강제.
  // minPpi 72(≙ppu 24): 저밀도 실패가 **ppu 비단조**다 (v0t 2톤이 12 는 서고 14·16·20
  // 에서 죽는 디더 aliasing — §10 실측). 자동 3종의 착지점(24/36/60)이 전부 실측 안전
  // 구간에 오는 값으로 잡았다 — 착지점 전수 재검증은 보고서 §10.
  2: Object.freeze({ ppi: null, profile: RENDER_PROFILE_PRINT, minPpi: 72 }),
  // 4비트(R1G2B1): 기본 칸 (144, screen) 이 5/6 — soft·print 는 만점, 입체감을 덜 깎는
  // soft 를 자동값으로. minPpi 48(≙ppu 16): v0(n13) 3톤이 ppu {12,14} 나쁜 구간을 갖고
  // 16 부터 안정 (§10 실측 — 착지점 16/24/40 전수 재검증).
  4: Object.freeze({ ppi: null, profile: RENDER_PROFILE_SOFT, minPpi: 48 }),
  // 8·16비트: 전 칸 만점 — 자동이 특별히 할 일이 없다 (갈래 기본값·기본 하한 그대로).
  8: Object.freeze({ ppi: null, profile: null, minPpi: null }),
  16: Object.freeze({ ppi: null, profile: null, minPpi: null }),
});

// ─────────────────────────────────────────────────────────────────────────────
// 실측 하한표 — ① 자동 크기의 뿌리 (왕복이 서는 최소 ppu)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 버전·레이아웃별 «왕복이 서는 최소 ppu» (pixelsPerUnit — 셀px 가 아니라 scene 단위다.
 * Y cellSize 1 에서는 1 단위 = 1 셀이라 두 수가 같다). 보고서 §2.3 실측으로 채운다.
 *
 * 하한은 버전·레이아웃마다 다르다 — 고정 상수 하나로 때우지 않는다(운영자 지시).
 * 키: 'O:1'..'O:4' · 'A:0'..'A:2' · 'K:0'..'K:2' · 'C:0'..'C:3'(Type C — notchC 문맥) ·
 * 'Y:<cellSurfaceLayout>:<n>' · 'Y:plain:<version>'. 같은 레이아웃 안에서도 n별 측정값을 독립적으로 보존한다.
 * 스키마가 닿는 키는 전부 표에 있어야 한다 — test/export-options.test.js 가 GENERATOR_TYPES × 상태 스키마 선택지로
 * 유도해 잰다(폴백은 «표가 모르는 미래 키» 용이지 알려진 키의 기본값이 아니다).
 */
export const MIN_ROUNDTRIP_PPU = Object.freeze({
  // §2.3 실측(M3, granularity 0.5, 무왜곡·페이로드 3종 전수) + 독립 재검증(기본 옵션
  // decodeFrontend — floor-verify)의 **원소별 최댓값**. A 계열은 재검증에서 8.5 가
  // 2/3 로 갈라져(페이로드 민감) +0.5 보수화했다. 하한은 정의상 경계값이다 —
  // «자동(하한 최저)» 는 그 사실을 그대로 노출하는 선택지이고 기본값이 아니다.
  'O:1': 8.5,
  'O:2': 8.5,
  'O:3': 8,
  'A:0': 9,
  'A:1': 9,
  'A:2': 8.5,
  // 2026-08-26 재측정: 2.0..12.0 ppu, 0.5 간격. 각 행은 2/3톤 × 짧은/중간/최대
  // 수용 페이로드(6조합)를 확인했다. 실패 ppu는 첫 실패 증거를 남기고, 최소와 다음
  // ppu는 6/6을 확인했다. n=21/25의 값이 현재 같아도 입력 축을 합치지 않는다.
  'Y:v0:13': 7.5,
  'Y:v0t:21': 7,
  'Y:v0t:25': 7,
  'Y:v0ty:21': 7,
  'Y:v0ty:25': 7,
  // 2026-09-28 미측정 키 채움 — 그전엔 전부 폴백 12 였다(스키마가 닿는 키인데 표에 없었다: 제품 자동 Y 의 기본
  // 레이아웃 v0tr · 긴 페이로드의 «끔» · K · O4 · C). 같은 방법: 2.0..12.0 ppu · 0.5 간격 · 페이로드 3종(ECC M,
  // Y 는 2/3톤 × 3) · 제품 조립 근사(상태 기본값 — 투명 배경 · 자동 안전영역 · 기본 파인더/자리/코너 QR) +
  // 같은 키로 가는 변형(QR 없음 · O 자동 o-cm(G) · Y 윈도 QR · 중앙 QR)의 **최댓값**. 17 키 전부 기본 구성에서
  // 단조였고 페이로드 민감 없음. 착지점(×1 · ×1.5 · ×2.5) 전수 + 시드 1 페이로드 독립 재검증(하한 · +0.5) 통과.
  // 하한을 내리는 키는 중앙 QR 구성을 옛/새 착지점에서 나란히 재서 **회귀가 없을 때만** 내렸다 — 꾸미기 잰 하한에
  // 걸리는 K:0 · Y:v0tr 은 실측을 적고 12 에 묶었다(각 행 주석). K:2 · C:0 도 처음엔 중앙 QR 섬 때문에 12 에 묶었다가
  // 디코더 수리 뒤 재측정으로 내렸다(2026-09-29, 각 행 주석).
  // 기록: private .agent/lanes/floor-keys-20260928/.
  // O:4 — 기본(G · O) 8, 중앙 QR(· 중앙+코너 병행) 8.5 · 단조(QR 후보 상한을 풀어도 같은 모양 — 섬이 아니라
  // 진짜 하한이라 접는다) → 최댓값 8.5.
  'O:4': 8.5,
  'K:1': 8.5,
  // K:2 — 기본(코너 QR) 8.5 · QR 없음 8 · 중앙 QR(· 중앙+코너 병행) 8, 전부 단조 → 최댓값 8.5.
  // 2026-09-29 전까지는 12 에 묶었다: 같은 키의 중앙 QR 구성이 8 · 8.5 · 9.5 · 12 · 13.5 · 14.5 에 흩어진 섬이었고
  // (QR 삼중쌍 후보 상한 절단), 8.5 로 내리면 auto-fit 12.75 가 그 섬에 떨어졌다(이 파일의 «K 전 버전 × 중앙/코너QR»
  // 자가 잡았다). 디코더의 실패 프레임 소생 단계(bootstrap.js «중앙 QR 소생»)로 섬을 고친 뒤 다시 쟀다 — 위 방법에
  // 중앙 QR 구성까지 판정에 넣고, 착지점(×1 · ×1.5 · ×2.5) + 시드 1 재검증 + 옛 12 ↔ 새 8.5 의 중앙 QR 착지 비교가
  // 전부 통과했다.
  'K:2': 8.5,
  // Type C 는 'C:<v>' 로 갈랐다(minRoundtripPpuKey — 그전엔 C1..C3 이 O1..O3 을 빌렸다). 기본 구성(코너 QR)은
  // C0..C3 모두 8.5. 중앙 QR 구성은 2026-09-29 전까지 8..24 ppu 에 섬이 흩어져 이 값에서도 자동 크기가 안 읽히는
  // 곳이 있었다(QR 후보 상한 절단 + C2 · C3 은 작은 QR 의 척도 오차 — C2 중앙 QR 은 8.5 × {1, 1.5} 둘 다 실패).
  // 디코더 소생 단계로 고친 뒤 C0..C3 중앙 QR 은 제품 조립 8.5 부터 단조다(8..24 · 0.5 간격 · 페이로드 3종).
  // C:0 — 기본 · 중앙 QR · 중앙+코너 병행 모두 8.5 · 단조(재측정 방법은 K:2 와 같다). 그전엔 섬 때문에 12 에 묶었다.
  'C:0': 8.5,
  'C:1': 8.5,
  'C:2': 8.5,
  'C:3': 8.5,
  // Y 셀 표면 밖(«끔» — 제품 자동 사다리가 긴 페이로드에서 고른다 · 시험판 hex 프레임). v2 는 윈도 QR 변형이 8.
  'Y:plain:0': 7,
  'Y:plain:1': 7,
  'Y:plain:2': 8,
  'Y:v0trq:21': 7,
  'Y:v0trq:25': 7,
  'Y:v0try:21': 7,
  'Y:v0try:25': 7,
  // ⚠ **꾸미기 잰 하한에 묶어 12 로 둔 셋** — 실측은 K:0 = 8 · Y:v0tr:21 = 7 · Y:v0tr:25 = 7 이다(같은 방법 ·
  // 착지점 통과). 그런데 꾸미기 허용표가 이 세 키를 제품 하한 12 에서 시작한 사다리로 쟀다(cell-shape-allow
  // MEASURED_FLOORS = 12). 여기서 내리면 test/cell-shape-measured-floors.test.js 가 의도대로 빨개지고, 그 사이
  // ppu 는 꾸미기가 잰 적 없는 구간이 된다 — 내리는 것은 꾸미기 재측정 또는 운영자 결정 몫이다(조용히 착지 금지).
  // 제품 기본 Y(자동 → v0tr)의 자동 크기가 여기에 걸려 있다: 내리면 ×1.5 착지가 18 → 10.5 ppu.
  'K:0': 12,
  'Y:v0tr:21': 12,
  'Y:v0tr:25': 12,
});

/** 하한표에 없는 조합의 보수적 폴백 (실측 최댓값 이상으로 §2.3 에서 확정). */
export const MIN_ROUNDTRIP_PPU_FALLBACK = 12;

/**
 * 인코딩 결과 문맥 → 하한표 키. 인코딩에서 유도한다 — 상수 하나로 때우지 않기 위한 장치.
 *
 * Type C(versionO 'ultra')는 생성기 타입 O 로 렌더되지만(index.html renderTypeO) 실루엣이 노치 C 이고
 * 버전 번호도 C 표(0..3)다. 2026-09-28 까지는 'O:<v>' 로 풀려 C0 은 폴백, C1..C3 은 **O1..O3 의 하한을
 * 빌려 썼다**(다른 실루엣의 측정값). 그래서 호출부가 notchC 를 실어 주면 'C:<v>' 로 가른다 — 인코딩
 * 결과의 encoded.notchC 가 그 문맥이다.
 * @param {{type:'O'|'A'|'Y'|'K', version:number, n?:number|null,
 *          cellSurfaceLayout?:string|null, notchC?:boolean}} ctx
 */
export function minRoundtripPpuKey(ctx) {
  if (ctx.type === 'O' && ctx.notchC === true) return 'C:' + ctx.version;
  if (ctx.type === 'Y') {
    if (!ctx.cellSurfaceLayout) return 'Y:plain:' + ctx.version;
    const ns = CELL_SURFACE_FINAL_NS[ctx.cellSurfaceLayout];
    if (!Array.isArray(ns)) return 'Y:' + ctx.cellSurfaceLayout;
    const n = Number.isInteger(ctx.n) && ns.includes(ctx.n)
      ? ctx.n
      : ns.find((candidate) => versionForFinalN(candidate) === ctx.version);
    return n === undefined
      ? 'Y:' + ctx.cellSurfaceLayout
      : 'Y:' + ctx.cellSurfaceLayout + ':' + n;
  }
  return ctx.type + ':' + ctx.version;
}

/**
 * 왕복이 서는 최소 ppu. 비트깊이가 낮으면 §2.2 실측이 정하는 배율/하한이 얹힌다.
 * @param {{type:'O'|'A'|'Y'|'K', version:number, n?:number|null, cellSurfaceLayout?:string|null,
 *          notchC?:boolean, ditherBits?: number|null}} ctx
 */
export function minRoundtripPpu(ctx) {
  const base = Object.prototype.hasOwnProperty.call(MIN_ROUNDTRIP_PPU, minRoundtripPpuKey(ctx))
    ? MIN_ROUNDTRIP_PPU[minRoundtripPpuKey(ctx)]
    : MIN_ROUNDTRIP_PPU_FALLBACK;
  const bits = ctx.ditherBits === undefined ? null : ctx.ditherBits;
  if (bits === null || bits === 24) return base;
  const combo = DITHER_AUTO_COMBO[bits];
  if (combo === undefined || combo.minPpi === null || combo.minPpi === undefined) return base;
  // 조합표의 minPpi 는 공칭 환산(PPU_PER_PPI)으로 «그 비트깊이가 필요로 하는 셀px
  // 스케일 하한» 이다 — 기본 하한보다 큰 쪽을 택한다 (양자화가 하한을 내려 주지는
  // 않는다). ⚠ ppi 필드가 아니다 — 그쪽은 pHYs 메타데이터 권장값이라 픽셀과 무관하다.
  const quantized = ppuForPpi(combo.minPpi);
  return quantized > base ? quantized : base;
}

// ─────────────────────────────────────────────────────────────────────────────
// 자동 규칙 해석 (④ 큐브 입체감 · ③ ppi · ① 크기)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * «자동» 입체감을 구체 프로파일로 푼다 (§1.1 자동 규칙):
 *   1. 디더링 비트깊이가 낮고 §2.2 조합표가 프로파일을 정하면 → 그 값
 *   2. 출력 최적화가 인쇄용이면 → 약(soft)
 *   3. 그 외 → 중(screen)
 * 자동이 아니면 사용자 선택을 그대로 존중한다 — 말없이 덮어쓰지 않는다.
 */
export function resolveRenderProfile(choice, { printPurpose = false, ditherBits = null } = {}) {
  if (!RENDER_PROFILE_CHOICES.includes(choice)) {
    throw new RangeError('알 수 없는 입체감 선택: ' + choice);
  }
  if (choice !== RENDER_PROFILE_AUTO) return assertRenderProfile(choice);
  if (ditherBits !== null && ditherBits !== 24) {
    const combo = DITHER_AUTO_COMBO[ditherBits];
    if (combo !== undefined && combo.profile !== null && combo.profile !== undefined) {
      return assertRenderProfile(combo.profile);
    }
  }
  return printPurpose ? RENDER_PROFILE_SOFT : RENDER_PROFILE_SCREEN;
}

/**
 * ③ 의 실효 ppi (PNG pHYs 에 실리는 값).
 *   세부가 숫자면 그 값 · 자동이면 ② 조합표(화면용 갈래 한정) → 갈래 기본값(144/300).
 */
export function resolveExportPpi({ purpose, detail = EXPORT_PPI_DETAIL_AUTO, ditherBits = null }) {
  if (!EXPORT_PPI_PURPOSES.includes(purpose)) {
    throw new RangeError('알 수 없는 출력 최적화 갈래: ' + purpose);
  }
  if (detail !== EXPORT_PPI_DETAIL_AUTO) {
    if (!EXPORT_PPI_DETAIL_CHOICES.includes(detail)) {
      throw new RangeError('알 수 없는 ppi 세부값: ' + detail);
    }
    return detail;
  }
  if (purpose === EXPORT_PPI_SCREEN && ditherBits !== null && ditherBits !== 24) {
    const combo = DITHER_AUTO_COMBO[ditherBits];
    if (combo !== undefined && combo.ppi !== null && combo.ppi !== undefined) return combo.ppi;
  }
  return purpose === EXPORT_PPI_PRINT ? DEFAULT_PRINT_PPI : DEFAULT_SCREEN_PPI;
}

/**
 * ① 의 실효 캔버스 크기와 렌더 밀도.
 *
 * 커스텀 외에는 정사각 · 배치는 contain (운영자 확정). 자동 3종은 복호 실측 하한
 * (minPpu) × 배율에서 나오고, 고정/커스텀은 캔버스에 scene 을 contain 으로 맞춘다.
 *
 * @param {{mode: string, customWidth?: number, customHeight?: number,
 *          sceneWidth: number, sceneHeight: number, minPpu: number}} args
 * @returns {{width: number, height: number, ppu: number}}
 */
export function resolveExportSize({ mode, customWidth, customHeight, sceneWidth, sceneHeight, minPpu }) {
  if (!EXPORT_SIZE_CHOICES.includes(mode)) {
    throw new RangeError('알 수 없는 이미지 크기 선택: ' + mode);
  }
  if (!(sceneWidth > 0) || !(sceneHeight > 0)) {
    throw new RangeError('scene 크기가 필요하다: ' + sceneWidth + '×' + sceneHeight);
  }
  const longest = Math.max(sceneWidth, sceneHeight);
  if (mode === EXPORT_SIZE_CUSTOM) {
    for (const [label, v] of [['폭', customWidth], ['높이', customHeight]]) {
      if (!Number.isInteger(v) || v < 16 || v > 16384) {
        throw new RangeError('커스텀 ' + label + '는 16..16384 정수여야 한다: ' + v);
      }
    }
    return {
      width: customWidth,
      height: customHeight,
      ppu: Math.min(customWidth / sceneWidth, customHeight / sceneHeight),
    };
  }
  if (typeof mode === 'number') {
    return { width: mode, height: mode, ppu: mode / longest };
  }
  if (!(minPpu > 0)) throw new RangeError('자동 크기에는 복호 하한 ppu 가 필요하다: ' + minPpu);
  const ppu = minPpu * AUTO_SIZE_MULTIPLIERS[mode];
  const side = Math.ceil(longest * ppu);
  return { width: side, height: side, ppu };
}
