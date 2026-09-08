// scanner.js — TLcube 웹 스캐너의 입력·수명주기 셸.
//
// 실제 디코더는 아래 decodeFrame() 함수의 본문만 교체해 연결한다.
// 카메라와 이미지 파일은 모두 ImageData를 만들어 같은 경계를 호출한다.

// ⚠ 상대 경로(`../../src/...`)를 쓰지 않는다. 배포 컨테이너에서 `sites/tlscan` 이
//    **문서 루트 그 자체**로 마운트되므로 `../../` 는 루트를 벗어나 404 가 된다.
//    정적 import 라 하나만 실패해도 이 모듈 전체가 로드되지 않는다.
//    dev 서버는 TLcube 루트를 서빙해서 상대 경로가 **동작해 버리므로** 로컬 검증으로는
//    잡히지 않는 dev/prod 괴리다. 절대 경로 + nginx alias(`/src/`)로 양쪽을 일치시킨다.
//    (같은 이유로 `_shared` 도 alias 로 붙인다 — deploy/estre-so/projects/tlcube/static.conf)
import { sniffPayload } from '/src/payloadform.js';
import { tlReaderFamilyHintFromPath } from '/src/qr.js';
import { createI18n, wireLanguageSwitch } from '/src/i18n.js';
import { createBeacon } from '/src/beacon.js';
import { SCANNER_STRINGS } from './strings.js';
import { startPwaUpdateWatch } from '/src/pwa-update.js';
import { textStartsWithBeaconMagic } from '/src/centralBeaconWire.js';
import { decodeFrontend } from '/src/decoder/frontend.js';
import { detectQrFinderTriples } from '/src/decoder/bootstrap.js';
import { toRelativeLuminance } from '/src/decoder/luma.js';
import { localizeCornerQrAssist } from '/src/decoder/corner-qr-assist.js';
import {
  immediateCornerQrHint, normalizeDecodePayload, guideCardVisibility, scanScopeCopyKey, scanViaOf, resultAutoOpen,
  ENGINE_SWITCH_PRODUCT_ENABLED, engineSwitchAvailable, ENGINE_STORAGE_KEY, ENGINE_STORAGE_KEY_LEGACY, resolveEngineChoice,
  stageTapIsCentre, analysisScaleOf,
} from '/src/scanner-scan-assist.js';
import {
  cameraLiveness,
  gatePresentation,
  resumeAction,
} from '/src/scanner-camera-lifecycle.js';
import {
  DAEHAN_FALLBACK_INITIAL_STATE,
  daehanFallbackDecision,
} from '/src/scanner-daehan-fallback.js';
import {
  buildCauseChain,
  classifyStage,
  createLabTelemetry,
  createStageClock,
  emptyConfigSide,
  extractCellSurfaceProbe,
  extractCsAnchors,
  extractGeometry,
  familyToType,
  fillFrameMs,
  frameHasCandidate,
  isLabPath,
  makeAttemptId,
  nowMs,
  observedFromResult,
} from '/src/lab-telemetry.js';
import {
  applyTrackZoom,
  autoCropRung,
  autoCropZoomFor,
  buttonStep,
  cropWindow,
  DEFAULT_USER_ZOOM,
  dotsOutOfBounds,
  EDGE_UNIT_OFFSETS,
  GUIDE_OUTER_FRACTION,
  guideDotPositions,
  readTrackCapability,
  readTrackZoom,
  resolveZoomPlan,
  snapZoom,
  zoomRangeFor,
  zoomTelemetry,
} from '/src/scanner-zoom.js';
import {
  typeCGuideRingPositions,
} from './scan-guide-ui.js';
import { createDebugOverlay } from '/src/scanner-debug-overlay.js';
import { createR2ScanRuntime, r2HitToDecodeResult } from '/src/r2-scan-runtime.js';
import { candidateDisplayState } from '/src/r2-candidate-display.js';
import { createCandidateHudRenderer } from '/src/r2-candidate-hud-renderer.js';
import {
  createQrBridge, qrHitToDecodeResult, qrFrameGateOpen, routeQrHits, frameYieldForQr, summarizeQrBridge,
} from '/src/qr-bridge.js';
import { CELL_MAP_STATE } from '/src/r2/progress.js';
// 좌 패널 «확정/변동» 행 모델 + R2 위치 상태줄 전이·늦은 결과 문 (2b · PM/029B §27.4). 규칙은 전부 저 파일에 있고 여기는
// 색·라벨을 붙이고 setStatus / return 만 한다.
import {
  CONFIRM_STATE, confirmationRows, layoutDisplayId, leadingWithHysteresis, progressNote,
  R2_STATUS_ACTION, r2StatusStep, r2StatusOnReject, lateResultAdmitted,
} from '/src/r2-confirmation-model.js';
// HUD 기하(순수 · 할당 0) — 락 H 로 canonical 격자를 **분석 프레임 px** 로 사영한다. 그리기·좌표 변환은 여기 몫이다.
import {
  HUD_FACES, faceQuadFloats, faceQuadSlot, finiteBoundsInto,
  gridLineCount, gridLineFloats, projectFaceQuadsInto, projectGridLinesInto, projectOutlineInto,
} from '/src/r2/hud-geometry.js';
// HUD 역할·위상 모델(순수) — «무엇을 어떤 묶음으로 그리는가» 는 전부 저기서 유도된다.
import {
  HUD_DISTRUST_STATE_KEY, HUD_RSFIX_STATE_KEY,
  HUD_PHASE, HUD_ROLE, HUD_TONE_NONE, bucketKey, clearHudRoleGrids, countObserved, fadeAlpha, fillCount,
  hudCaptureProjection, hudCorrectionGridOk, hudCorrectionLatch, hudDistrusted, hudPhase, hudProjectionChanged,
  hudRoleGridsInto, hudSurfaceVisibility, hudToneSlot,
  scaleColorAlpha,
  r2HudDebugLine as r2HudDebugLineOf,
} from '/src/r2-hud-model.js';
/*
 * 빚 2 — «무엇을 어떤 알파로 칠하는가» 는 순수 모듈이 정한다. 옛 판은 그 규칙이 렌더러 안에
 * 흩어져 있어서 「채움이 열리는가」를 재는 방법이 **철자**밖에 없었다 (r2-hud.test ⓞ, 퇴역).
 * 붓도 여기서 나간다 — `ctx` 를 받으므로 가짜 ctx 로 붓질을 셀 수 있다.
 * `applyHudSurfaces` 는 «표시 판정 → hidden» 이음새 (3b 검토 F1) — 그 한 칸이 값으로 잰다.
 */
import {
  R2_HUD_SOLID_DASH, applyHudSurfaces, hudPaintPlan, paintCorrectionLayer,
} from '/src/r2-hud-paint.js';
/*
 * ⑯(i) — R2 수용 뒤 «닫기» 유예 (운영자 결정, 실기 4차 2026-09-06). 규칙은 순수 모듈이 쥐고
 * 여기서는 시계(setTimeout)와 표면(stopCamera · 결과 시트)만 연결한다.
 */
import { acceptStopDelayMs, createAcceptStopGate } from '/src/scanner-accept-delay.js';
import {
  normalizeCentralFinderId,
  normalizeExpectedEmphasis,
  normalizeOuterFinderId,
} from '/src/lab-expected-axes.js';
import {
  createSteadyTracker,
  motionAttachPlan,
  requestMotionPermission,
} from '/src/scan-steady.js';
import {
  consumeFramePoseCarry,
  framePoseCarryFromResult,
  guidePriorPoses,
  jitterPoses,
  priorPoseBudget,
  PRIOR_COARSE_OFFSET_CELLS,
  PRIOR_MAX_REFINE_POSES,
  refineSeedsFrom,
} from '/src/scan-guide-prior.js';
import {
  adaptiveFrameIntervalMs,
  idleAfterDecodeMs,
  CLIP_HINT_MS,
  CLOSER_HINT_MS,
  elapsedSinceMs,
  escalationDue,
  scheduleNextEscalationAt,
} from '/src/scanner-frame-rate.js';

/**
 * 디코더에 넘기기 전 프레임을 줄이는 상한(긴 변, px). 미리보기 화질과는 무관하다.
 *
 * ⚠ **셀당 9픽셀이 복호 하한이다** (실측 2026-08-11: V1/V2/V3 전부 ppu 9 에서 처음
 *    성공, 8 이하는 no-format-candidate). 버전과 무관하게 일정한 것은 셀 개수가 아니라
 *    셀당 해상도가 관건이기 때문이다 — 면당 샘플 원판에 들어갈 픽셀 수가 결정한다.
 *
 * 그래서 이 상한이 곧 **최소 촬영 거리**를 정한다. V3(21셀 폭) 코드가 960px 프레임의
 * 절반을 채우면 셀당 약 23px 로 여유롭지만, 1/4 만 차지하면 셀당 약 11px 로 하한에
 * 근접하고 더 멀어지면 못 읽는다. 960 을 더 낮추면 그만큼 사용자가 더 가까이 가야 한다.
 */
const FRAME_MAX_SIDE = 960;

/**
 * 사진 경로의 총 픽셀 상한. 라이브와 달리 자르지 않으므로(코드가 가운데 있으리란 보장이
 * 없다) 짧은 변 기준으로 키우면 세로로 긴 사진이 매우 커질 수 있다 — 비용만 제한한다.
 * 960×2400 정도까지 허용한다.
 */
const PHOTO_MAX_PIXELS = 1440 * 3200;

/**
 * 사진 경로의 짧은 변 상한. 라이브(960)보다 크게 잡는다 — 실시간 제약이 없고, 실측에서
 * 성공/실패가 셀당 9픽셀 하나로 갈렸기 때문에 여유를 두는 편이 낫다.
 * (초광각 사진 7.6px 은 960 에서 실패했다. 1440 이면 11.4px 로 하한을 넘는다.)
 */
const PHOTO_MAX_SHORT_SIDE = 1440;

/**
 * 배포본 식별자. 실기기 피드백에서 **어느 빌드를 보고 있는지** 즉시 알기 위한 것이다.
 * 실제로 이 값이 없어서 "배포가 갱신됐나?" 를 바이트수 비교로 확인해야 했다(2026-08-11).
 * 푸터에 표시하고, 갱신할 때 같이 올린다.
 */
export const SCANNER_BUILD = '2026-09-09.01';

/*
 * 연속 실패가 7.68초를 넘으면 "더 가까이" 안내를 띄운다.
 * 복호 실패의 가장 흔한 원인이 거리(셀당 픽셀 부족)인데, 아무 피드백이 없으면
 * 사용자는 무엇을 바꿔야 할지 알 수 없다. 구 24프레임 × 320ms의 체감 시간을 보존한다.
 *
 * 2면 이상 잘림(multi-clip)이 0.96초 **연속**이면 "조금 뒤로" 안내를 띄운다.
 * 실측(f2dbb2b 이후 340프레임): multi-clip 구간 성공 0% (274/274) — 코드가 분석
 * 프레임을 넘치면 절대 못 읽는데, 사용자에게는 아무 신호가 없었다.
 * 판정은 프레임마다 이미 계산 가능한 extractGeometry().clipSide 를 재사용한다 —
 * 기기 안 로컬 값이며 안정판 텔레메트리 0바이트 불변식과 무관하다.
 * 구 3프레임 × 320ms의 체감 시간이다 — 스치는 잘림에는 침묵한다.
 */

const scannerApp = document.getElementById('scanner-app');
const cameraStage = document.getElementById('camera-stage');
const cameraVideo = document.getElementById('camera-preview');
const cameraGate = document.getElementById('camera-gate');
const cameraGateTitle = document.getElementById('camera-gate-title');
const cameraGateMessage = document.getElementById('camera-gate-message');
const startCameraButton = document.getElementById('start-camera');
const chooseImageButton = document.getElementById('choose-image');
const gateChooseImageButton = document.getElementById('gate-choose-image');
const imageInput = document.getElementById('image-input');
const statusBox = document.getElementById('scan-status');
const scanToast = document.getElementById('scan-toast');
const resultPanel = document.getElementById('scan-result');
const resultTitle = document.getElementById('result-title');
const resultContent = document.getElementById('result-content');
const popupFallback = document.getElementById('popup-fallback');
// «브라우저가 새 탭을 열지 못했어요» 문단 — 자동으로 열지 않은(QR) 결과에선 거짓이라 숨긴다. 하드 가드 밖.
const popupBlockedNote = document.getElementById('popup-blocked-note');
const openUrlLink = document.getElementById('open-url');
const rescanButton = document.getElementById('rescan');
const closeResultButton = document.getElementById('close-result');
const closeResultSecondaryButton = document.getElementById('close-result-secondary');
const zoomControls = document.getElementById('zoom-controls');
const zoomSlider = document.getElementById('zoom-slider');
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const zoomValue = document.getElementById('zoom-value');
const zoomErrorBox = document.getElementById('zoom-error');
const dotLayer = document.getElementById('scan-dot-layer');
const scanGuideMessage = document.getElementById('scan-guide-message');
const scanGuideDetail = document.getElementById('scan-guide-detail');
const scanGuideScope = document.getElementById('scan-guide-scope');
const scannerPanels = document.getElementById('scanner-panels');
const steadyMeter = document.getElementById('steady-meter');
const steadyMeterFill = document.getElementById('steady-meter-fill');
// 처리 fps 배지 — 없는 변형 페이지가 있어도 스캐너는 살아야 하므로 하드 가드 밖.
const procFpsEl = document.getElementById('proc-fps');

if (!scannerApp || !cameraStage || !cameraVideo || !cameraGate || !cameraGateTitle ||
    !cameraGateMessage || !startCameraButton || !chooseImageButton || !gateChooseImageButton ||
    !imageInput || !statusBox || !scanToast || !resultPanel || !resultTitle || !resultContent ||
    !popupFallback || !openUrlLink || !rescanButton || !closeResultButton ||
    !closeResultSecondaryButton || !zoomControls || !zoomSlider || !zoomInButton ||
    !zoomOutButton || !zoomValue || !zoomErrorBox || !dotLayer || !scannerPanels ||
    !scanGuideMessage || !scanGuideDetail || !scanGuideScope ||
    !steadyMeter || !steadyMeterFill) {
  throw new Error('TLcube scanner markup is incomplete.');
}

const frameCanvas = document.createElement('canvas');
const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });
// QR의 `/x` 힌트는 URL 경로에서 한 번만 읽는다. null이면 기존 무힌트 경로와 같은
// 옵션 모양을 유지한다. family의 문자 배정·역해석은 qr.js 등록부가 단독 소유한다.
const scannerFamilyHint = tlReaderFamilyHintFromPath(location.pathname);
const scannerFamilyEvidence = scannerFamilyHint === null
  ? null : Object.freeze({ family: scannerFamilyHint });

let cameraStream = null;
let animationFrameId = 0;
let scanSession = 0;
let isDecoding = false;
let cameraRequestPending = false;
/**
 * 마지막 R1 단발 복호가 **끝난** 시각. ⚠ 시작 시각이 아니다 — 유휴 창을 완료 시각에서 재야
 * 복호와 복호 사이에 실제로 빈 시간이 생긴다 (src/scanner-frame-rate.js R1_IDLE_FRACTION 참조).
 */
let lastDecodeAt = 0;
/** 직전 grab부터 결과 처리까지의 전체 프레임 비용. 다음 유휴 창의 적응 입력이다. */
let lastFrameCostMs = 0;
/**
 * 「이번 rAF 한 번은 통째로 양보한다」 일회용 플래그. 엔진 스위치 탭 핸들러가 세우고
 * `nextFrame` 첫머리가 내린다 — 그 한 프레임에 브라우저가 스위치 페인트를 끝낸다.
 * 스위치가 없는 화면(승격 되돌림)에서는 이 플래그를 세우는 코드가 도달 불가다.
 */
let yieldFrameOnce = false;
let stoppedForVisibility = false;
let hadCameraThisSession = false;
let resumeAttemptsThisTransition = 0;
let cameraTrackEndCleanups = [];
let cameraGatePhase = 'start';
let activeUrl = '';
let returnFocus = null;
let frameSeq = 0;
let labEnvSent = false;
let attemptId = '';
let productAttemptSeq = 0;
let productAttempt = null;
let zoomCapability = null;
let userZoom = DEFAULT_USER_ZOOM;
let zoomPlan = resolveZoomPlan({ userZoom: DEFAULT_USER_ZOOM });
/**
 * 연속 실패 자동 크롭 사다리의 현재 단 (§scanner-zoom.autoCropRung).
 * 0 = 개입 없음. 분석 크롭과 프리뷰가 **같은 값**을 쓴다 — 어긋나면 2026-08-15 의
 * «가이드 ≠ 분석» 사고가 재현된다.
 */
let autoCropIndex = 0;
/** 연속 실패가 시작된 시각(ms). 안내·사다리·승격은 프레임 수가 아니라 **시간**으로 간다. */
let failStreakSince = null;
/** multi-clip 연속 구간의 시작 시각과 안내 소유 상태. */
let clipStreakSince = null;
let clipHintShown = false;
let closerHintShown = false;
/** 다음 1440px 승격이 허용되는 시각. 실패 스트릭이 없으면 null이다. */
let nextEscalationAt = null;
let zoomApplyToken = 0;
let zoomApplyTimer = 0;
/** 직전 프레임의 성공 가설에서 복원한 포즈. 실패 프레임은 null 을 남긴다. */
let lastFramePose = null;

// build (F-68): 화면 푸터에만 찍던 배포 스탬프를 봉투에도 싣는다 — «어느 빌드의
// 프레임인가» 를 적재 시각으로 추정하지 않게 된다.
const lab = createLabTelemetry({ site: 'scan', build: SCANNER_BUILD });

/*
 * lab 전용 디버그 오버레이 (작업 1). 안정판(`/`)에서는 enabled=false 라 팩토리가
 * **어떤 DOM 도 만지지 않는 동결 no-op** 을 돌려준다 — 마크업의 hidden 이 그대로
 * 남는다(불활성 계약, scanner-debug-overlay.test.js 가 기능적으로 단언).
 * 표시는 decodeFrame 경로에 이미 있는 로컬 값의 재사용뿐이다 — 새 전송 경로 없음.
 */
const debugOverlay = createDebugOverlay({
  enabled: isLabPath(),
  layer: document.getElementById('lab-debug-layer'),
  panel: document.getElementById('lab-debug-panel'),
  toggleButton: document.getElementById('lab-debug-toggle'),
  doc: document,
});

/*
 * R2(LTC) 누적 복호기 — **시험판 한정 · 기본 꺼짐** (S5 · PM/029B §22·§23).
 *
 * 코퍼스 실측 (`tools/r2-runtime-probe.mjs`, 2026-09-04): 후보 5개를 동시에 돌려도
 * **참 격자가 이긴다** — y0 f6/143 ms · y1 f5/221 ms · y2 f4/248 ms, 전부 정답이고
 * 레이아웃도 맞다. 같은 코퍼스의 단발 첫 성공이 1,440\~2,768 ms 이므로 **9.3\~12.5×**.
 * 락 뒤 프레임당 3\~5 ms (후보 5개 합).
 *
 * 후보를 여럿 돌리는 이유: 라이브에서 `layoutId` 를 알 수 없고, **포맷 CRC 는 그것을
 * 전혀 못 가른다** (PM/029B §23.6 실측). 레이아웃은 본문 RS 로만 갈린다.
 * 안전 근거: 틀린 격자가 낸 DONE 이 후보 5 × ecc×mask 9 × 3시퀀스 전수에서 **0건**
 * (`tools/wrong-grid-probe.mjs`).
 *
 * ⚠ 켜는 조건은 `r2Available`(engineSwitchAvailable) 하나다. **2026-09-06 승격** 뒤 그것은 시험판 ∧ 정식
 * 양쪽에서 참이고, 그래서 정식 화면 = 시험판 화면이다 (운영자 실기 4차 판정 · 결정 ①).
 * 스위치를 R1 위치로 두면(또는 승격 플래그를 되돌리면) `enabled === false` 라 프레임 루프의 R2 블록이
 * 첫 줄에서 반환하고 **grab 도 안 한다** — 그 경로의 제어 흐름은 승격 전과 완전히 같다.
 */
// «R2 가용» — 시험판이거나 승격됐으면. 이 하나가 런타임·QR probe·패널·스위치·디버그 줄을 다 연다 (§27.4 1단계).
const r2Available = engineSwitchAvailable({ labPath: isLabPath(), productEnabled: ENGINE_SWITCH_PRODUCT_ENABLED });
let r2Wanted = true;
try {
  // 새 키가 있으면 그것, 없으면 옛 시험판 키(1회 이관), 둘 다 없으면 켬.
  r2Wanted = resolveEngineChoice(
    window.localStorage.getItem(ENGINE_STORAGE_KEY),
    window.localStorage.getItem(ENGINE_STORAGE_KEY_LEGACY),
  );
} catch { /* 저장소 접근 불가는 스캔을 막지 않는다 — 기본 켬 */ }
const r2Runtime = createR2ScanRuntime({ enabled: r2Available && r2Wanted });
/*
 * 일반 QR 브리지 (PM/029B §2 ①단계 · §26). 브라우저 BarcodeDetector 에 위임 — 의존성 0,
 * 능력은 실행 시 판정(Android Chrome 가용, Firefox·Windows 데스크톱 불가). R2 토글 아래에서만
 * 돈다 — 즉 **스위치가 R2 위치일 때**이고, 2026-09-06 승격 뒤로는 시험판·정식 양쪽이 그렇다.
 * TL 리더 QR 은 결과로 노출하지 않고 R1 의 가족 힌트로만 쓴다.
 */
const qrBridge = createQrBridge();
/**
 * QR 브리지가 준 가족 힌트 `{ evidence, at }`. URL 경로 힌트(scannerFamilyEvidence)보다 앞선다 —
 * «지금 카메라가 보는 코드» 가 «페이지로 데려온 코드» 보다 확실하다. 다만 **TTL** 이 있다:
 * 스트림 내내 살리면 카메라를 다른 가족의 코드로 옮겼을 때 틀린 힌트가 광학 실패 프레임의
 * 후보를 하나로 접는다. 브리지가 250 ms 마다 다시 보므로 코드가 프레임에 있으면 자연히 갱신된다.
 */
let runtimeFamilyHint = null;
const QR_HINT_TTL_MS = 3000;
/**
 * R2 DONE 래치 `{ layoutId, n, leadingId }` (2b · PM/029B §27.4) — R2 적중을 결과 문에 넘기기 **직전** 스냅샷.
 * 문이 받아들이면 stopCamera 가 r2Runtime.reset() 을 먼저 불러 stats 가 비므로, 결과 카드의 확정 요약
 * (Type Y · Y2 (n25) · v0TR · DONE) 이 읽을 값은 이것뿐이다. `leadingId` 는 적중 프레임에 좌 패널이 보이던 레이아웃 선두 —
 * DONE 의 layoutId 와 다르면 «정정»(운영자 ⑧, renderResultR2Summary 가 강조).
 * ⚠ 스테이지 좌 패널은 카메라가 닫히면 **숨는다**. 옛 안은 거기에 «확정 칩만» 남겼지만 그 칩은 결과 시트(z10)·카메라 게이트
 * (z2 — 스테이지는 isolation: isolate 라 안의 z6 행이 위로 못 올라온다) 아래라 아무도 못 봤다 (적대 검토 F8 실측:
 * elementFromPoint 가 시트·게이트를 돌려줬다). ⑧ 의 «DONE 확정색 / 정정 강조» 가 보이는 표면은 결과 카드다.
 * startFrameLoop(새 세션) · 스위치 핸들러 · 거부된 적중 뒤에 null. 선언이 여기(프레임 루프보다 앞)인 이유: 대입하는 쪽이 먼저 읽힌다.
 */
let r2Latched = null;
let r2DisplayedCandidateId = '';
function liveR2Display() {
  return candidateDisplayState(r2Runtime.stats, r2Runtime.view,
    r2Runtime.hudCandidates || [], r2DisplayedCandidateId);
}
/**
 * 🔴 **RS 정정 강조 래치** (3b · 운영자 결정 ⑦). DONE 적중이 세우고 `hudCorrectionAlpha` 가
 * `R2_HUD_CORRECTION_MS` 뒤 0 으로 내린다. 모양: `{ at, count, cells, layoutId, n }` —
 * `cells` 는 런타임 스크래치의 **뷰**라 다음 DONE 까지만 유효하다(래치도 그때 갈린다).
 *
 * ⚠ **지금 이 그림은 화면에 도달하지 않는다 — 한 프레임도** (3b 검토 F1, 미해소. 옛 주석은
 * 「DONE 프레임 한 장은 남는다」고 적었는데 그것도 거짓이다). 수용된 적중은 같은 태스크에서
 * `handleDecodeResult` → `stopCamera()` 로 이어지고, 그 안의 `renderR2CellMap()` 이
 * `cameraStream === null` 을 보고 캔버스 둘을 `hidden = true` 로 세운다 — 합성 **전**이라
 * 브라우저가 한 장도 안 보여 준다. 거부된 적중은 그리기 전에 이 래치를 null 로 만든다.
 * 배선(래치 → α → 경로 → 붓)은 여기까지 옳고, 표면을 여는 결정은 운영자 몫이다:
 * (i) R2 수용 경로의 `stopCamera()` 를 `R2_HUD_CORRECTION_MS` 만큼 미룸, 또는
 * (ii) 결과 시트에 미니 HUD(항등 H)를 얹고 거기 그림.
 * 그전까지 운영자가 실제로 수를 읽는 표면은 **결과 카드의 DONE 칩(«RS 정정 k»)** 하나다.
 */
let r2Correction = null;
/** R2 모드 상태 문구 위상 — «모으는 중» 을 이미 말했는가 (syncR2Status · 전이 때만 setStatus). */
let r2StatusCollecting = false;
/**
 * 상태 문구 유예 시각 — 거부된 적중(비컨만 등) 뒤 handleDecodeResult 가 쓴 처방을 R2 전이(aim · r2Collecting)가 이 시각까지
 * 덮지 않는다 (F1). 전이 규칙은 r2-confirmation-model 의 r2StatusStep / r2StatusOnReject (순수 함수) 에 있다.
 */
let r2StatusHoldUntil = -Infinity;
function liveFamilyEvidence() {
  if (runtimeFamilyHint === null) return null;
  return nowMs() - runtimeFamilyHint.at <= QR_HINT_TTL_MS ? runtimeFamilyHint.evidence : null;
}

/*
 * ── 안정 유지 트리거 + 가이드-사전 스캔 (운영자 요청 2026-08-16) ─────────────────
 *
 * 손떨림 범위 안에서 같은 뷰가 1.5초 유지되면 「코드를 가이드에 어느 정도 맞췄다」 로
 * 보고, 가이드 기하에서 유도한 기대 포즈만 디코더에 넣어 한 프레임을 다시 본다.
 *
 * 배선 원칙:
 *   · **기존 연속 스캔 경로는 무회귀.** 사전 시도는 트리거가 걸린 그 한 프레임 슬롯만
 *     차지하고(중복 실행 아님), 나머지 프레임은 종전 `decodeFrame()` 이 그대로 돈다.
 *     한 슬롯을 «두 번» 돌리면 발동 프레임 비용이 두 배가 되므로 대체를 택했다 —
 *     발동은 최대 1.5초에 한 번이라 100ms 최속 경로도 잃는 것은 최대 15프레임 중 한 장이다.
 *   · 게이트 완화 0. 사전 포즈는 후보 추가일 뿐이고 수용은 디코더가 그대로 결정한다.
 *   · 텔레메트리 0바이트 불변식 불변 — 안정도 계산은 전부 기기 안 로컬이고, 새 전송
 *     경로를 만들지 않는다(lab 오버레이 표시는 기존 로컬 값 재사용과 같은 성질).
 */
const steady = createSteadyTracker();

/** 사전 스캔이 진행 중인가 (프레임 루프가 겹쳐 던지지 않게 한다). */
let priorInFlight = false;
/** 마지막 사전 시도 요약 — lab 오버레이 표시용. */
let lastPriorSummary = null;
/** 상태 문구를 사전 스캔이 바꿨나 (실패 시 되돌리기 위해). */
let statusOwnedBySteady = false;
/** DeviceMotion 리스너를 이미 붙였나 (중복 부착 금지 — 카운터가 부풀고 계산이 겹친다). */
let motionListenerAttached = false;
/** 권한 요청이 지금 진행 중인가 (버튼 연타 방지 — `await` 뒤에 플래그를 세우면 늦다). */
let motionRequestInFlight = false;
/** 다음 제스처에 붙이기로 예약해 뒀나 (iOS 자동 시작 경로). */
let motionGestureArmed = false;
/**
 * 부착 상태 문자열 — **lab 오버레이에 그대로 찍는다.**
 * 「센서가 켜져 있다」 를 문서가 단정하고 코드가 안 켜던 것이 이번 정정의 출발점이다.
 * 화면이 실제 상태를 말하지 않으면 같은 착각이 다시 자란다.
 */
let motionAttachState = 'idle';

/**
 * 발동 예산 — 문서·오버레이가 같은 수를 말하게 한다.
 *
 * ⚠ **지연 생성**이다. 모듈 로드 시 만들면 오버레이 숫자 하나 때문에 정식 `/` 에서도
 *   720 포즈를 전량 만든다(lab 전용 표시인데). 실제로 필요해질 때 한 번만 만든다.
 */
let priorBudgetCache = null;
function priorBudget() {
  if (!priorBudgetCache) priorBudgetCache = priorPoseBudget({ frameSide: FRAME_MAX_SIDE });
  return priorBudgetCache;
}

function resetFrameSeq() {
  frameSeq = 0;
}

function resetFailureTiming() {
  failStreakSince = null;
  clipStreakSince = null;
  clipHintShown = false;
  closerHintShown = false;
  nextEscalationAt = null;
}

function beginScanAttempt(source) {
  attemptId = makeAttemptId();
  // 포즈도 시도 단위 상태다. 이전 카메라·사진 세션의 픽셀 H 를 새 세션에 넘기지 않는다.
  lastFramePose = null;
  // F-86: 실패·잘림의 모든 시간 상태는 시도 단위다. 남으면 새 시도의 첫 프레임부터
  // ① 1440 승격 ② 안내 ③ 자동 크롭 사다리가 이전 카메라의 시간을 상속한다.
  resetFailureTiming();
  lastFrameCostMs = 0;
  // daehan 폴백의 연속 실패도 시도 단위다 (위 lastFramePose 와 같은 이유).
  daehanFallbackState = DAEHAN_FALLBACK_INITIAL_STATE;
  if (autoCropIndex !== 0) {
    autoCropIndex = 0;
    // 프리뷰를 같은 값으로 즉시 재동기화 (§effectiveCropZoom 의 «가이드 = 분석» 불변식).
    syncPreviewTransform();
  }
  if (lab.beginAttempt) lab.beginAttempt(attemptId);
  productAttemptSeq += 1;
  productAttempt = {
    source,
    attemptSeq: productAttemptSeq,
    startedAt: nowMs(),
    frames: 0,
  };
  beacon('scan_start', { source, attempt_seq: productAttemptSeq });
  return attemptId;
}

function noteProductFrame() {
  if (productAttempt) productAttempt.frames += 1;
}

function scanElapsedMs(attempt) {
  return Math.max(0, Math.min(0xffffffff, Math.round(nowMs() - attempt.startedAt)));
}

function scanContentKind(payload) {
  const kind = sniffPayload(payload).kind;
  return ['url', 'text', 'wifi', 'card'].includes(kind) ? kind : 'text';
}

// 값 집합은 `src/scanner-scan-assist.js` 의 SCAN_VIA_VALUES 가 잠근다 (PM/026 §via enum 갱신).
function scanVia(result) {
  return scanViaOf(result);
}

function finishProductScanOk(result, payload) {
  const attempt = productAttempt;
  if (!attempt) return;
  productAttempt = null;
  const observed = observedFromResult(result);
  beacon('scan_ok', {
    source: attempt.source,
    attempt_seq: attempt.attemptSeq,
    type: observed.type || '',
    version: observed.version == null ? '' : observed.version,
    ecc: observed.ecc || '',
    tones: observed.tones == null ? '' : observed.tones,
    via: scanVia(result),
    content: scanContentKind(payload),
    ms: scanElapsedMs(attempt),
    frames: attempt.frames,
  });
}

function finishProductScanFail(reasonCode) {
  const attempt = productAttempt;
  if (!attempt) return;
  productAttempt = null;
  beacon('scan_fail', {
    source: attempt.source,
    attempt_seq: attempt.attemptSeq,
    reason_code: reasonCode,
    ms: scanElapsedMs(attempt),
    frames: attempt.frames,
  });
}

/** 원시 디코더 오류는 전송하지 않고 이 닫힌 집합으로만 접는다. */
function closedScanReason(result, fallback = 'unreadable') {
  if (result && result.clipSide === 'multi') return 'clipped';
  const raw = String((result && result.reason) || '');
  if (/frame-invalid/i.test(raw)) return 'invalid-frame';
  if (/finder/i.test(raw)) return 'no-finder';
  if (/format/i.test(raw)) return 'no-format';
  if (/geometry|grid|homography|proposal/i.test(raw)) return 'geometry';
  if (/dynamic|contrast|luma/i.test(raw)) return 'low-contrast';
  if (/decode|payload|header|reed|rs-/i.test(raw)) return 'decode-failed';
  return fallback;
}

function cameraStartReason(error) {
  const name = error && error.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'camera-unavailable';
  return 'camera-start-failed';
}

function activeVideoTrack() {
  return cameraStream && cameraStream.getVideoTracks
    ? cameraStream.getVideoTracks()[0]
    : null;
}

function currentZoom() {
  const zoom = readTrackZoom(activeVideoTrack());
  return zoom == null ? 1 : zoom;
}

function currentZoomTelemetry() {
  return zoomTelemetry({
    trackRequested: zoomPlan.trackRequested,
    trackApplied: currentZoom(),
    cropRequested: zoomPlan.cropRequested,
    cropApplied: zoomPlan.cropApplied,
    // 자동 크롭 사다리를 계측에 싣는다 (2026-08-21). 이게 없으면 실패 2초/4초 뒤
    // 걸리는 1.5배·2.2배 중앙 크롭이 텔레메트리에 **한 자리도 안 남는다** —
    // 실제 분석 배율의 유일한 출처는 effectiveCropZoom() = 계획 × 사다리다.
    autoCropRung: autoCropIndex,
    trackNative: zoomPlan.trackNative,
    error: zoomPlan.error,
  });
}

function formatZoomLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '1×';
  const rounded = Math.round(n * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + '×';
}

function setZoomErrorVisible(message) {
  if (!message) {
    zoomErrorBox.hidden = true;
    zoomErrorBox.textContent = '';
    return;
  }
  zoomErrorBox.hidden = false;
  zoomErrorBox.textContent = message;
}

function refreshZoomChrome() {
  const range = zoomRangeFor(zoomCapability);
  zoomSlider.min = String(range.min);
  zoomSlider.max = String(range.max);
  zoomSlider.step = String(range.step);
  zoomSlider.value = String(userZoom);
  zoomSlider.setAttribute('aria-valuemin', String(range.min));
  zoomSlider.setAttribute('aria-valuemax', String(range.max));
  zoomSlider.setAttribute('aria-valuenow', String(userZoom));
  zoomValue.textContent = formatZoomLabel(userZoom);
  zoomOutButton.disabled = userZoom <= range.min;
  zoomInButton.disabled = userZoom >= range.max;
  if (zoomPlan.error) {
    setZoomErrorVisible(t('zoom.failed'));
  } else if (!zoomCapability && zoomPlan.mode === 'crop' && userZoom > 1) {
    setZoomErrorVisible('');
  } else {
    setZoomErrorVisible('');
  }
}

/**
 * 실제로 자를 배율 — 사용자 계획 × 자동 사다리. **분석과 프리뷰의 유일한 출처**다.
 * 둘이 다른 값을 쓰면 «가이드 ≠ 분석» 이 되어 2026-08-15 사고(성공 0%/274)가
 * 재현되므로, 여기 말고 다른 곳에서 크롭 배율을 계산하지 않는다.
 */
function effectiveCropZoom() {
  const base = zoomPlan.cropApplied > 1.001 ? zoomPlan.cropApplied : 1;
  return base * autoCropZoomFor(autoCropIndex);
}

/**
 * 지금 프레임에 걸린 **분석 배율** (크롭뿐 아니라 track 줌까지). 순수 식은
 * `scanner-scan-assist.js` 의 `analysisScaleOf` 하나이고 여기는 «지금 상태» 를 먹여 주는 자리다.
 * ⚠ 프리뷰 변환(`syncPreviewTransform`)은 여전히 `effectiveCropZoom()` 이다 — 트랙이 당긴 배율은
 *   비디오 픽셀에 이미 들어 있어 CSS 로 또 키우면 두 번 확대된다.
 */
function currentAnalysisScale() {
  return analysisScaleOf(zoomPlan, autoCropZoomFor(autoCropIndex));
}

function syncPreviewTransform() {
  const scale = effectiveCropZoom();
  cameraVideo.style.transform = scale <= 1.001 ? '' : 'scale(' + scale + ')';
  cameraVideo.style.transformOrigin = 'center center';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 점 렌더 자가진단 상태 (작업 4). 레이아웃이 아직 0×0 인 프레임(폴드 전개 직후·
 * loadedmetadata 가 레이아웃보다 이른 기기)에서 조용히 포기하지 않고 재시도를 예약한다
 * — 실기기 «점이 안 보임» 후보 ①(S=0 렌더)·③(크기 오계산)의 방어선이다.
 */
const GUIDE_RETRY_LIMIT = 40; // rAF 기준 ≈ 0.7초 — 그 안에 레이아웃이 안 서면 다음 기하 이벤트에 맡긴다.
let guideRetryCount = 0;
let guideRetryScheduled = false;

function scheduleGuideRetry() {
  if (guideRetryScheduled || guideRetryCount >= GUIDE_RETRY_LIMIT) return;
  guideRetryScheduled = true;
  guideRetryCount += 1;
  requestAnimationFrame(() => {
    guideRetryScheduled = false;
    renderGuideDots();
  });
}

/**
 * 점 레이어 스태킹 단언 (작업 4) — video 요소가 가이드를 덮는 회귀를 코드로 잡는다.
 * 계약: 같은 정사각 스테이지 안에서 video 는 z-index auto, 점 레이어는 정수 z-index ≥ 1
 * 이고 DOM 순서도 video 뒤다 (index.html .scan-dot-layer 주석과 짝).
 */
function assertDotLayerStacking() {
  let problem = '';
  if (dotLayer.parentElement !== cameraStage || cameraVideo.parentElement !== cameraStage) {
    problem = 'dot-layer-not-in-stage';
  } else if (!(cameraVideo.compareDocumentPosition(dotLayer) & Node.DOCUMENT_POSITION_FOLLOWING)) {
    problem = 'dot-layer-precedes-video';
  } else {
    const z = Number.parseInt(getComputedStyle(dotLayer).zIndex, 10);
    if (!(z >= 1)) problem = 'dot-layer-zindex:' + getComputedStyle(dotLayer).zIndex;
  }
  if (problem) console.warn('[tlscan] guide dot stacking violated: ' + problem);
  return problem === '';
}

/**
 * K 3링 18점 / C 5점 조준 가이드 — r3 정사각 뷰 좌표계에 직접 그린다.
 *
 * 레이어가 정사각 스테이지(≡ 분석 정사각의 화면 표현) 안에 inset:0 으로 있으므로
 * S = 스테이지 rect 한 변이 곧 분석 정사각 투영이다. 화면 투영 계산(구
 * analysisSquareOnScreen)은 폐기됐다 — 프리뷰(cover) ≡ 분석(cropWindow crop=1)이
 * 구조적으로 동일해 좌표 변환 자체가 없다 (scanner-zoom.js previewSourceWindow 증명).
 *
 * 줌은 다시 그릴 필요가 없다: 트랙 zoom 은 소스가 바뀌고, 크롭 폴백의 CSS scale 은
 * cover 와 함께 정확히 분석 크롭을 보여준다(위 증명). 다시 그리는 트리거는 가이드
 * 유형 선택 또는 기하 변화(메타데이터·프레임 크기·뷰포트·회전·첫 grab 성공)뿐이다.
 */
function renderGuideDots() {
  if (!cameraStream) {
    dotLayer.replaceChildren();
    return;
  }
  const rect = cameraStage.getBoundingClientRect();
  const side = Math.min(rect.width, rect.height);
  if (!(side > 0)) {
    // 자가진단: 레이아웃 미확립 — 포기 대신 재시도 예약 (작업 4).
    dotLayer.replaceChildren();
    scheduleGuideRetry();
    return;
  }
  guideRetryCount = 0;
  // K 18점 + C 링을 **동시에** 그린다 (2026-08-30 운영자 «같이 배치» — 토글 폐지).
  // C 5점은 K 점의 부분집합이 아니다 (E vs C 방향 30° 어긋남) — 두 링을 겹친다.
  const dots = guideDotPositions(side, side / 2, side / 2);
  const typeCRing = typeCGuideRingPositions({
    screenSide: side,
    centerX: side / 2,
    centerY: side / 2,
    edgeUnitOffsets: EDGE_UNIT_OFFSETS,
    outerFraction: GUIDE_OUTER_FRACTION,
  });
  if (!dots || !typeCRing) {
    dotLayer.replaceChildren();
    return;
  }
  dotLayer.setAttribute('viewBox', '0 0 ' + side + ' ' + side);
  // 점 크기는 시각 표식일 뿐 기하가 아니다 — 뷰에 비례하되 4~9px 로 묶는다.
  const outerR = Math.max(4, Math.min(9, side * 0.016));
  const fragment = document.createDocumentFragment();
  const ring = (points, className, radius) => {
    for (const point of points) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('class', className);
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', String(radius));
      fragment.append(circle);
    }
  };
  // 기존 3링 18점의 반지름·스타일·순서를 그대로 보존하고, 그 위에 C 링을 얹는다.
  ring(dots.outer, 'dot-outer', outerR);
  ring(dots.middle, 'dot-middle', outerR * 0.85);
  ring(dots.inner, 'dot-inner', outerR * 0.72);
  ring(typeCRing.dots, 'dot-type-c', outerR);
  // 3시 노치 자리는 «맞출 큐브가 없다» — 속 빈 표식으로 자리만 알린다.
  ring([typeCRing.notch], 'dot-notch', outerR);
  dotLayer.replaceChildren(fragment);

  // 자가진단 (작업 4): r3 불변식 — 점은 뷰 밖으로 나갈 수 없다(최대 반경 27% < 50%).
  // 위반은 좌표계 회귀이므로 콘솔 경고 + lab 오버레이 표기.
  const outOfBounds = dotsOutOfBounds(
    { ...dots, typeC: [...typeCRing.dots, typeCRing.notch] }, side,
  );
  if (outOfBounds.length > 0) {
    console.warn('[tlscan] guide dots out of square view:', outOfBounds);
  }
  debugOverlay.flagDotIssue(outOfBounds);
  debugOverlay.setViewSide(side);
  assertDotLayerStacking();
}

function resetZoomState() {
  zoomCapability = null;
  userZoom = DEFAULT_USER_ZOOM;
  zoomPlan = resolveZoomPlan({ userZoom: DEFAULT_USER_ZOOM });
  // F-61: 자동 크롭 사다리도 줌 상태다 — 안 지우면 stopCamera() 뒤의 사진 경로가
  // 직전 카메라의 사다리 단을 상속해 «분석은 1배(사진은 크롭 안 함), 계측은 2.2배» 로
  // 갈린다 (currentZoomTelemetry 가 autoCropIndex 를 그대로 싣는다).
  autoCropIndex = 0;
  zoomApplyToken += 1;
  if (zoomApplyTimer) {
    clearTimeout(zoomApplyTimer);
    zoomApplyTimer = 0;
  }
  zoomControls.hidden = true;
  setZoomErrorVisible('');
  cameraVideo.style.transform = '';
}

function revealZoomControls() {
  zoomControls.hidden = false;
  refreshZoomChrome();
}

async function commitUserZoom() {
  const token = ++zoomApplyToken;
  // H4 — 이 커밋이 **실제 분석 배율**을 바꿨는지 알려면 커밋 전 값을 들고 있어야 한다 (아래 무효화 게이트).
  const scaleBefore = currentAnalysisScale();
  const range = zoomRangeFor(zoomCapability);
  userZoom = snapZoom(userZoom, range);
  refreshZoomChrome();

  let applyError = null;
  let trackApplied = null;
  let settingsMissing = false;

  if (zoomCapability) {
    const result = await applyTrackZoom(activeVideoTrack(), userZoom);
    if (token !== zoomApplyToken) return;
    if (!result.ok) {
      applyError = result.error || 'applyConstraints-rejected';
      trackApplied = result.applied;
      settingsMissing = result.error === 'settings-unreported';
    } else {
      trackApplied = result.applied;
    }
  }

  if (token !== zoomApplyToken) return;

  const previousError = zoomPlan.error;
  zoomPlan = resolveZoomPlan({
    userZoom,
    capability: zoomCapability,
    trackApplied,
    applyError,
    settingsMissing,
  });
  syncPreviewTransform();
  refreshZoomChrome();

  /*
   * H4 (운영자 실기 3차 ①) — 배율이 실제로 바뀌었으면 R2 의 **락만** 무효화한다. 락 H 는 락 시점 크롭
   * 좌표계의 것이라, 크롭이 바뀌면 같은 H 가 다른 물리 자리를 가리킨다 — 그런데 어댑터는 락 뒤
   * relocateEveryFrame 이 꺼져 있어 옛 H 를 그대로 돌려주므로(adapter-locator detectInto) 스스로 안 푼다.
   * 세션·누적 증거는 유지된다(reset 이 아니다): 버리는 것은 «어디에 있는가» 뿐이고 «무엇을 읽었는가» 가 아니다.
   * R2 가 꺼져 있으면(스위치 R1 위치) 아무것도 안 한다.
   */
  /*
   * ⚠ **크롭이 아니라 분석 배율**로 잰다 (2026-09-06 검토 R3c, 결함 15). `zoomCapability` 가 있는
   * 기기에서 `resolveZoomPlan` 은 `mode:'track'` · `cropApplied:1` 을 돌려주므로, 크롭만 보면
   * 1× → 2× 커밋이 「안 바뀜」이다 — 즉 실기 대다수에서 이 무효화가 아예 안 돌았다.
   */
  if (r2Runtime.enabled && currentAnalysisScale() !== scaleBefore) r2Runtime.invalidateLock();

  if (zoomPlan.error && zoomPlan.error !== previousError) {
    showScanToast(t('zoom.failed'));
    setStatus(t('zoom.failed'));
  }
}

function scheduleUserZoom(nextValue, immediate) {
  const range = zoomRangeFor(zoomCapability);
  userZoom = snapZoom(nextValue, range);
  refreshZoomChrome();
  if (zoomApplyTimer) {
    clearTimeout(zoomApplyTimer);
    zoomApplyTimer = 0;
  }
  if (immediate) {
    void commitUserZoom();
    return;
  }
  zoomApplyTimer = setTimeout(() => {
    zoomApplyTimer = 0;
    void commitUserZoom();
  }, 80);
}

function stripIdentifying(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'deviceId' || key === 'groupId') continue;
    out[key] = value;
  }
  return out;
}

async function collectLabEnv(stream) {
  const uad = typeof navigator !== 'undefined' ? navigator.userAgentData : null;
  const brands = uad && uad.brands;
  const brand = brands ? brands.find((x) => !/Not.?A.?Brand/i.test(x.brand)) : null;
  const cameras = [];
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      for (const device of devices) {
        if (device.kind !== 'videoinput') continue;
        cameras.push({ label: device.label || '', kind: device.kind });
      }
    }
  } catch {
    // 목록을 못 읽어도 env 의 나머지(화면·UA)는 보낸다.
  }

  let track = null;
  const video = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (video) {
    let capabilities = {};
    let settings = {};
    try {
      capabilities = typeof video.getCapabilities === 'function' ? video.getCapabilities() : {};
    } catch {
      capabilities = {};
    }
    try {
      settings = typeof video.getSettings === 'function' ? video.getSettings() : {};
    } catch {
      settings = {};
    }
    track = {
      label: video.label || '',
      capabilities: stripIdentifying(capabilities),
      settings: stripIdentifying(settings),
    };
  }

  const scr = typeof screen !== 'undefined' ? screen : { width: 0, height: 0 };
  return {
    ua: { browser: brand ? brand.brand : '', platform: (uad && uad.platform) || '' },
    screen: {
      w: scr.width || 0,
      h: scr.height || 0,
      dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    },
    cameras,
    track,
  };
}

function sendLabEnvOnce(stream) {
  if (!lab.enabled || labEnvSent) return;
  labEnvSent = true;
  void collectLabEnv(stream).then((body) => {
    try { lab.env(body); } catch { /* 계측 실패는 스캔을 막지 않는다 */ }
  }).catch(() => {});
}

/**
 * @param {object} [extra] frame body 에 그대로 얹을 추가 키. 현재는 daehan 폴백의
 *   `escalated` 하나다 — false = 1차 패스만, true = daehan 2차 패스를 실제로 돌린 프레임.
 *
 * ⚠ **이 키는 아직 좌석에 도달하지 않는다** (2026-08-30 실측). 세 층이 모르는 키를
 *   각자 떨군다:
 *     ① `src/lab-telemetry.js` `normalizeFrameBody` — 반환이 **명시 객체 리터럴**이라
 *        여기서 제일 먼저 죽는다. 와이어에 오르지도 못한다.
 *     ② `relay/protocol.mjs` `eventRow` — 컬럼별 명시 매핑.
 *     ③ `relay/schema.sql` `events` — 명시 컬럼뿐. raw JSON body 컬럼은 **없다**.
 *   즉 「frame body 는 raw JSON 이라 DDL 불요」 는 사실이 아니다. 좌석이 이 키로
 *   폴백 기여를 가르려면 ①②③을 함께 열어야 한다 (기대 축 ③ outerFinderId 가
 *   같은 계열로 이미 겪은 일 — 아래 lab.frame 근처 주석 참조).
 *   여기까지 배선해 두는 이유는, 세 층이 열리는 날 스캐너 쪽에 할 일이 없게 하기 위함이다.
 */
function reportLabFrame(imageData, result, ms, stage, extra) {
  if (!lab.enabled || !imageData) return;
  frameSeq += 1;
  const ok = result && result.ok === true;
  const chain = buildCauseChain(result);
  const geometry = extractGeometry(result, imageData.width, imageData.height);
  const cellSurface = extractCellSurfaceProbe(result);
  const observed = observedFromResult(result);
  const expected = emptyConfigSide();
  if (expectedLocatorLayout) expected.locatorLayout = expectedLocatorLayout;
  // 기대 톤 — 이 한 줄이 없어서 expected_tones 가 전 행 NULL 이었다 (2026-08-15).
  // relay(protocol.mjs configSideNum)와 ClickHouse 컬럼은 처음부터 받고 있었다.
  if (expectedTones != null) expected.tones = expectedTones;
  // 축 ②·③ (2026-08-19). ②는 **이미 있던** expected.finderPatternId 를 기대 쪽에서
  // 처음 쓰는 것이라 relay(expected_finder)·ClickHouse 가 그대로 받는다 — 스키마 변경
  // 없음. ③(outerFinderId)만 새 필드이고, relay 는 모르는 키를 조용히 버리므로 와이어는
  // 안 깨지지만 **ClickHouse 에 컬럼이 생기기 전까지는 저장되지 않는다.**
  if (expectedCentralFinder) expected.finderPatternId = expectedCentralFinder;
  if (expectedOuterFinder) expected.outerFinderId = expectedOuterFinder;
  // 축 ④ (2026-08-29). CONFIG_SIDE_KEYS 에 centralN7Emphasis 가 열려 있어야
  // normalizeConfigSide 를 지나 relay(expected_emphasis)에 닿는다 — 011 ALTER 선행.
  if (expectedEmphasis) expected.centralN7Emphasis = expectedEmphasis;
  if (cellSurface && expectedLocatorLayout && !cellSurface.expectedLayout) {
    cellSurface.expectedLayout = expectedLocatorLayout;
  }
  const reason = ok ? '' : ((result && result.reason) || 'decode-failed');
  try {
    lab.frame({
      seq: frameSeq,
      w: imageData.width,
      h: imageData.height,
      ...currentZoomTelemetry(),
      ms,
      stage,
      ok,
      reason,
      type: observed.type || (ok ? familyToType(result.family) : null),
      cellPx: geometry.cellPx,
      attempt_id: attemptId || null,
      config_id: null,
      expected,
      observed,
      chain,
      geometry,
      cellSurface,
      ...(extra && typeof extra === 'object' ? extra : {}),
    });
    lab.frameShot({
      seq: frameSeq,
      imageData,
      ok,
      reason,
      stage,
      attempt_id: attemptId || null,
      config_id: null,
      chain_failed: chain.failed || '',
      geometry,
      hasCandidate: frameHasCandidate(result, geometry),
    });
  } catch {
    // 계측 실패는 스캔을 막지 않는다.
  }
}

function refreshScanGuideCopy() {
  // 토글 폐지 후 문구는 한 벌이다 — K·C 조준 지시가 guide.dots 에 병합돼 있다.
  scanGuideMessage.setAttribute('data-i18n', 'guide.message');
  scanGuideDetail.setAttribute('data-i18n', 'guide.dots');
  scanGuideMessage.textContent = t('guide.message');
  scanGuideDetail.textContent = t('guide.dots');
  // 범위 안내는 R2 토글을 따른다 (운영자 요구 ②, 2026-09-04). data-i18n 도 같이 바꿔야
  // 언어 전환의 전수 재적용이 되돌리지 않는다. `t()` 는 리터럴 두 번 — 삼항을 안에 넣으면
  // scanner-i18n 의 «사전에 없는 키» 자가 못 본다. R1 위치면 문구가 옛 것으로 환원된다.
  const scopeKey = scanScopeCopyKey(r2Runtime.enabled, qrBridge.supported);
  scanGuideScope.setAttribute('data-i18n', scopeKey);
  // 카드는 위치마다 한 장 (운영자 관측 2026-09-06 — R2 위치에서 조준 + 범위가 겹쳐 «두 카드»).
  // 어느 장이 보이는지는 여기서 정하지 않는다 — `guideCardVisibility` 가 값으로 잠근다(사본 금지).
  // R1 위치면 { detail: true, scope: true } 로 환원돼 승격 전 화면 그대로다 (승격 뒤 정식의 기본은 R2 위치다).
  const cards = guideCardVisibility(r2Runtime.enabled);
  scanGuideDetail.hidden = !cards.detail;
  scanGuideScope.hidden = !cards.scope;
  if (scopeKey === 'guide.scope.r2qr') scanGuideScope.textContent = t('guide.scope.r2qr');
  else if (scopeKey === 'guide.scope.r2') scanGuideScope.textContent = t('guide.scope.r2');
  else scanGuideScope.textContent = t('guide.tlcubeOnly');
}

/*
 * 언어. 문구가 바뀌면 **이미 떠 있는 화면도 다시 그려야** 한다 — 게이트 문구와 결과
 * 패널은 JS 가 채우므로 `data-i18n` 재적용만으로는 안 돌아온다. onChange 에서 현재
 * 상태에 맞는 화면을 다시 그린다.
 */
const i18n = createI18n(SCANNER_STRINGS, {
  onChange() {
    if (!cameraGate.hidden) {
      if (cameraGatePhase === 'preparing') showPreparingCameraGate();
      else showSupportedStartGate();
    }
    if (!resultPanel.hidden && lastResult !== null) showResult(lastResult, lastResultOptions);
    if (!zoomControls.hidden) refreshZoomChrome();
    // 렌즈 선택지도 JS 가 채운다 — 권한 전에는 기기 이름이 없어 «카메라 1» 같은
    // 대체 이름을 우리가 붙이므로, 언어가 바뀌면 다시 그려야 한다.
    refreshCameraChoices();
    refreshScanGuideCopy();
  },
});
const t = (key) => i18n.t(key);
let lastResult = null;
/** 마지막 결과의 표시 옵션(autoOpen 등) — 언어 전환 재렌더가 URL 을 다시 열지 않게 같이 보관한다. */
let lastResultOptions = {};
let selectedCameraId = '';
let knownCameras = [];

/** 지금 열려 있는 스트림이 실제로 쓰는 deviceId. 선택 UI 를 실제 상태와 맞추는 데 쓴다. */
function activeDeviceIdOf(stream) {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track || typeof track.getSettings !== 'function') return '';
  try {
    return track.getSettings().deviceId || '';
  } catch {
    return '';
  }
}

/**
 * 렌즈 선택 UI 를 채운다. 후면 카메라가 **2개 이상일 때만** 보인다 — 하나뿐인 기기에서
 * 고를 것 없는 선택지를 띄우지 않는다.
 */
async function refreshCameraChoices() {
  const picker = document.getElementById('camera-picker');
  if (!picker) return;

  knownCameras = await listRearCameras();
  if (knownCameras.length < 2) {
    picker.hidden = true;
    return;
  }

  const current = selectedCameraId || activeDeviceIdOf(cameraStream);
  picker.replaceChildren();
  knownCameras.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `${t('camera.fallback')} ${index + 1}`;
    if (device.deviceId === current) option.selected = true;
    picker.append(option);
  });
  picker.hidden = false;
}

/**
 * daehan 폴백의 연속 실패 카운터. 판정 규칙은 `scanner-daehan-fallback.js` 가
 * 전부 가지고, 여기는 상태 한 칸만 든다. 시도 단위 상태라 `beginScanAttempt` 가
 * 리셋한다 — 안 하면 새 시도의 첫 실패가 이전 카메라의 실패 횟수를 상속해
 * 「조준하자마자 2차 패스」 라는 이 정책의 목적이 프레임 3장만큼 늦어진다.
 */
let daehanFallbackState = DAEHAN_FALLBACK_INITIAL_STATE;

/**
 * TLcube 디코더 경계.
 *
 * ⚠ `ImageData` 는 `.data` 를, 디코더는 `.pixels` 를 쓴다. 여기서 맞춰 준다 —
 *    디코더가 브라우저 전용 타입(`ImageData`)에 의존하면 Node 측 테스트·M1 하네스에서
 *    그대로 못 쓴다. 경계를 이쪽에 두는 이유다.
 *
 * 반환은 이 셸의 계약(`{ok, payload?, reason?}`)으로 변환한다. 디코더의 상세 실패
 * 코드(`frontend:no-finder` 등)는 reason 에 그대로 실어, 스캔이 안 될 때 **어느 단계에서
 * 포기했는지** 알 수 있게 한다.
 *
 * @param {ImageData} imageData 카메라 또는 업로드 이미지에서 얻은 프레임
 * @param {{priorPoses?: Array, deferReport?: boolean, source?: 'live'|'still'}} [settings]
 *   `source` 를 안 주면 라이브로 본다 — 스로틀이 걸리는 쪽이 기본값이어야
 *   새 호출자가 실수로 무제한 2차 패스를 여는 일이 없다.
 * @returns {Promise<{ ok: boolean, payload?: string, reason?: string }>}
 */
/**
 * 사진 업로드 경로가 로케이터에 선언하는 보정 — **중앙 창을 항등으로 되돌린다.**
 * 근거는 `runPass` 안의 주석. 싱글턴인 이유는 `family.js` 의 cube 타일링 캐시가
 * 옵션을 `Object.is` 로 비교해서다 — 매 호출 새 객체를 만들면 캐시가 어긋난다.
 */
const STILL_LOCATOR_CALIBRATION = Object.freeze({
  csBlockLocator: Object.freeze({ centreWindowFraction: 1 }),
});

async function decodeFrame(imageData, settings = {}) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
    const failed = { ok: false, reason: 'frame-invalid' };
    reportLabFrame(imageData, failed, fillFrameMs(0), 'proposal');
    updateDebugOverlay(imageData, failed, 'proposal', fillFrameMs(0));
    return failed;
  }

  const t0 = nowMs();
  try {
    const clock = createStageClock();
    const raster = {
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.data,
    };
    /*
     * 한 프레임의 패스 하나. 1차·2차가 **같은 함수**를 쓴다 — 옵션을 두 벌 적으면
     * 언젠가 한쪽만 바뀌고, 그러면 「2차 패스가 1차와 다른 조건으로 돌았다」 가
     * 조용히 성립한다. 두 패스의 유일한 차이는 `cellFinderDaehan` 이다.
     * 시계도 하나를 공유한다: 보고는 한 행이고 total 이 두 패스의 합이므로
     * 단계 시간도 합이어야 앞뒤가 맞는다.
     */
    // 실행 시 힌트(QR 브리지, TTL)가 있으면 그것이, 없으면 URL 경로 힌트가. 한 번만 읽어 두 패스가
    // 같은 힌트로 돌고, 조건과 값이 어긋나(TTL 이 그 사이 만료) null 키가 붙는 일이 없다.
    const familyEvidence = liveFamilyEvidence() || scannerFamilyEvidence;
    const runPass = (daehan) => decodeFrontend(raster, {
      onStage: (stageName, phase) => clock.onStage(stageName, phase),
      // QR 힌트는 선택지를 줄이는 보조 증거일 뿐이다. 미지·부재는 키 자체를 생략해
      // 종전의 무힌트 탐색 경로를 바이트 단위로 보존한다.
      // 둘 다 없으면 키 자체를 생략해 종전의 무힌트 탐색 경로를 바이트 단위로 보존한다.
      ...(familyEvidence === null ? {} : { familyEvidence }),
      // Type Y 강화 로케이터는 /lab/ 시험판에서만 켠다. 정식 스캐너의 **1차 패스**는
      // 종전 검출 계약과 프레임 비용을 그대로 유지한다 (daehan 은 실패한 프레임의
      // 2차 패스로만 붙는다 — 아래 폴백).
      // ⚠ cellFinderDaehan 은 **bootstrap 아래**여야 한다. decodeFrontend 는
      //   `options.bootstrap` 만 추려서 넘기고(frontend.js:117), 라인업을 고르는
      //   discoverCellFinders 가 받는 options 는 그 bootstrapOptions 다
      //   (bootstrap.js:849·884). 최상위에 두면 조용히 무시된다 — 토글을 눌러도
      //   아무 일이 안 일어나고, 그게 «daehan 이 효과가 없다» 로 오독된다.
      bootstrap: {
        cellFinderDaehan: daehan,
        // **셀 표면 검출을 정식에서도 켠다** (운영자 확정 2026-08-19).
        //
        // 왜 지금인가 — 인쇄용 포스터를 v0(셀 표면)로 바꾸려는데, 이 스위치가
        // 시험판 전용이라 **정식 스캐너가 그 포스터를 못 읽는다**(실측: 컬러·흑백
        // × ppu 4종 = 0/8 `no-finder`, 시험판 조건에선 8/8 원문 일치).
        // 인쇄물은 한 번 찍으면 못 고치므로 순서를 뒤집을 수 없다 —
        // 스캐너가 먼저 읽을 수 있어야 포스터를 바꾼다.
        //
        // enableLocatorY 는 **그대로 시험판 전용**이다. 둘은 다른 축이고,
        // 한 줄에 있다고 해서 같이 움직일 이유가 없다.
        // `enableCellSurfaceY` 는 **디코더 기본값이 켜짐**이라 여기서 안 적는다
        // (2026-08-19). 같은 뜻을 두 곳에 적으면 언젠가 한쪽만 바뀐다.
        // `enableLocatorY` 는 여전히 시험판 전용이다 — 둘은 다른 축이고, 한 줄에
        // 있었다고 해서 같이 움직일 이유가 없다.
        //
        // 🔴 **사진 업로드는 중앙 창을 끈다** (2026-09-04, 배포 전 독립 사전검증이 잡음).
        // 로케이터 기본값 `centreWindowFraction: 0.75` 의 전제는
        // `cellsurface-block-detect.js` 가 적은 「찾는 블록은 프레임 중앙에 있다」이고,
        // 그 전제는 **라이브 카메라에서만** 참이다 — `imageDataCenterSquare` 가 중앙
        // 정사각을 잘라 주기 때문이다. 반면 `imageDataWhole`(바로 위 docstring)은
        // 「사진은 코드가 가운데 있으리란 보장이 없다」며 **일부러 안 자른다.**
        // 두 계약이 정면 충돌하므로 업로드 경로에서는 창을 항등(=1)으로 되돌린다.
        //
        // ⚠ 이 선언이 로케이터까지 **실제로 닿는** 경로: `bootstrap.family.cube` →
        // `family.js` 의 `scoreCubeTiling`(`options.cube` 가 있으면 그것이 통째로
        // `cubeOptions` 가 된다) → `detectCubeHypotheses` →
        // `detectCellSurfaceBlockShapes(luma, options)` → `calibration(options)` 이
        // `options.calibration.csBlockLocator` 를 읽는다. **최상위나 `bootstrap` 바로
        // 아래에 두면 조용히 무시된다** — 바로 위 `cellFinderDaehan` 주석과 같은 함정이고,
        // 통합자가 R2 어댑터에서 한 층 얕게 넣어 A/B 두 팔이 비트 동일로 나온 적이 있다.
        family: {
          cube: {
            enableLocatorY: isLabPath(),
            ...(settings.source === 'still' ? { calibration: STILL_LOCATOR_CALIBRATION } : {}),
          },
        },
      },
      // 가이드-사전 포즈. 없으면 이 객체 키 자체가 안 생겨 종전 경로와 동일하다.
      ...(Array.isArray(settings.priorPoses) ? { priorPoses: settings.priorPoses } : {}),
    });

    // 1차 패스 — 현행 그대로다. 토글이 꺼진 정식 경로는 여기까지 **비트 동일**이고,
    // 성공하던 프레임은 아래 폴백이 구조상 안 돌아 결과·비용이 안 변한다.
    let result = runPass(cellFinderDaehan);

    /*
     * daehan 폴백 2차 패스 (2026-08-30). 판정은 순수 모듈이 한다 — 분기 규칙을
     * 여기에 다시 적으면 자(test/scanner-daehan-fallback.test.js)와 어긋난다.
     * 2차가 **성공했을 때만** 결과를 갈아끼운다: 실패하면 1차 실패 객체를 그대로
     * 두어야 carryHypothesis·admittedPoses 같은 이월 증거가 안 사라진다.
     */
    const decision = daehanFallbackDecision(daehanFallbackState, {
      source: settings.source === 'still' ? 'still' : 'live',
      firstPassOk: result && result.ok === true,
      daehanForced: cellFinderDaehan,
      usedPriorPoses: Array.isArray(settings.priorPoses),
    });
    daehanFallbackState = decision.state;
    if (decision.escalate) {
      const escalatedResult = runPass(true);
      if (escalatedResult && escalatedResult.ok === true) result = escalatedResult;
    }
    const escalated = decision.escalate;

    const stage = classifyStage(result);
    const ms = fillFrameMs(nowMs() - t0, clock.snapshot());
    /*
     * 사전 스캔은 카메라 프레임 **한 장**에 decodeFrame 을 두 번 부른다(coarse → refine).
     * 그대로 보고하면 lab 프레임 행이 2건 생기고 frameSeq 가 +2 라 프레임 시간·레이트
     * 통계가 트리거 프레임을 겹쳐 센다. 그래서 사전 경로는 보고를 호출자에게 미루고
     * (`deferReport`) 마지막에 **한 프레임 = 한 행**으로 합쳐 낸다.
     * 폴백 2차 패스도 같은 문법을 따른다 — 행을 하나 더 만들지 않고 `escalated`
     * 키 하나로 구분한다 (frameSeq·시간 통계 겹침 금지).
     */
    const report = settings.deferReport ? { result, ms, stage, escalated } : null;
    if (!settings.deferReport) {
      reportLabFrame(imageData, result, ms, stage, { escalated });
      updateDebugOverlay(imageData, result, stage, ms);
    }

    if (result && result.ok === true && typeof result.text === 'string') {
      return {
        ok: true,
        payload: result.text,
        family: result.family,
        version: result.version,
        eccLevel: result.eccLevel,
        tones: result.tones,
        hypothesis: result.hypothesis,
        ms: ms && ms.total,
        report,
      };
    }
    // 잘림 안내용 clipSide. extractGeometry 는 순수 함수라 안정판(`/`)에서도 아무것도
    // 전송하지 않는다 — 반환 객체는 이 셸의 handleDecodeResult 만 소비한다.
    const clipSide = extractGeometry(result, imageData.width, imageData.height).clipSide;
    return {
      ok: false,
      reason: (result && result.reason) || 'decode-failed',
      clipSide,
      // 실패 기하 이월. bootstrap 이 포맷 CRC 통과 뒤 본문에서 죽은 H 만 eligible 로
      // 올리고, scanner 는 그 한 개만 다음 프레임에 한 번 쓴다.
      carryHypothesis: result && result.detail && result.detail.carryHypothesis,
      failureHypothesis: result && result.detail && result.detail.failureHypothesis,
      carryEvidence: result && result.detail && result.detail.carryEvidence,
      // 2단계 지터의 씨앗 — 「포맷 CRC 까지 간」 사전 포즈 id 들.
      admittedPoses: (result && result.detail && result.detail.prior
        && result.detail.prior.admittedPoses) || [],
      ms: ms && ms.total,
      report,
    };
  } catch (error) {
    // 디코더가 던지면 스캐너 루프가 멈추면 안 된다 — 다음 프레임으로 넘어간다.
    const failed = {
      ok: false,
      reason: 'decode-threw:' + (error && error.message ? error.message : 'unknown'),
    };
    const ms = fillFrameMs(nowMs() - t0);
    reportLabFrame(imageData, failed, ms, 'proposal');
    updateDebugOverlay(imageData, failed, 'proposal', ms);
    return failed;
  }
}

/**
 * 가이드-사전 스캔 한 번 (2단계).
 *
 *   1단계 coarse — 8 레이아웃 × 6 회전 × 3 배율 × 5 오프셋(십자). 「가이드에 정확히
 *                  맞았다」 에 가까운 순서로 정렬돼 있고, 디코더가 48개 배치마다
 *                  끊어 평가하다 body-valid 가 나오면 즉시 멈춘다.
 *   2단계 refine — 1단계에서 **포맷 CRC 까지 간** 포즈(최대 4개) 주변으로 배율만
 *                  ±3.6% 정제. 오프셋 축은 1단계가 이미 덮는다(실측: 2단계 오프셋의
 *                  추가 회수 0, 비용 3\~6×).
 *
 * 두 단계 모두 수용은 디코더의 기존 게이트가 결정한다 — 완화 없음.
 */
/*
 * 포즈 목록은 프레임 한 변에만 의존하는 순수 함수 결과다 — 발동마다 720개를 다시
 * 만들 이유가 없다.
 *
 * ⚠ 캐시는 **1칸**이고 프레임 한 변은 평상 960 · 실패 승격 1440 **두 값이 번갈아** 온다
 *   — 즉 1칸 캐시의 최악 케이스다(교대하면 매번 빗나간다). 그래도 두는 이유는 실비용이
 *   무시할 수준이기 때문이지(720 포즈 생성 ≈ 1ms, 발동은 1.5초에 한 번) 「두 값뿐이라
 *   1칸이면 충분」 해서가 아니다 — 근거를 뒤집어 적어 두면 나중에 칸 수를 늘릴 판단이
 *   막힌다. (2026-08-16 정정)
 */
let cachedPriorPoses = null;
let cachedPriorFrameSide = 0;

function coarsePosesFor(frameSide) {
  if (cachedPriorPoses && cachedPriorFrameSide === frameSide) return cachedPriorPoses;
  cachedPriorPoses = guidePriorPoses({ frameSide });
  cachedPriorFrameSide = frameSide;
  return cachedPriorPoses;
}

/**
 * 미뤄 둔 사전 프레임 보고를 **한 번만** 낸다 (F7 — 프레임 한 장 = lab 행 한 개).
 * ms 는 두 패스의 합으로 낸다 — 그것이 이 카메라 프레임의 실제 비용이다.
 */
function flushPriorReport(imageData, report, extraMs) {
  if (!report) return;
  const total = (report.ms && report.ms.total ? report.ms.total : 0) + (extraMs || 0);
  const ms = extraMs ? fillFrameMs(total) : report.ms;
  reportLabFrame(imageData, report.result, ms, report.stage,
    { escalated: report.escalated === true });
  updateDebugOverlay(imageData, report.result, report.stage, ms);
}

async function attemptGuidePriorScan(imageData, previousMs = 0) {
  const frameSide = Math.min(imageData.width, imageData.height);
  const coarse = coarsePosesFor(frameSide);
  if (coarse.length === 0) return { ok: false, reason: 'prior-no-poses' };

  const first = await decodeFrame(imageData, { priorPoses: coarse, deferReport: true });
  if (first.ok) {
    lastPriorSummary = { stage: 'coarse', poses: coarse.length, ok: true, ms: first.ms };
    flushPriorReport(imageData, first.report, previousMs);
    return first;
  }

  const refine = refineSeedsFrom(coarse, first.admittedPoses || [], { frameSide });
  if (refine.length === 0) {
    lastPriorSummary = {
      stage: 'coarse',
      poses: coarse.length,
      ok: false,
      admitted: 0,
      ms: first.ms,
    };
    flushPriorReport(imageData, first.report, previousMs);
    return first;
  }
  const second = await decodeFrame(imageData, { priorPoses: refine, deferReport: true });
  lastPriorSummary = {
    stage: 'refine',
    poses: coarse.length + refine.length,
    ok: Boolean(second.ok),
    admitted: (first.admittedPoses || []).length,
    ms: (first.ms || 0) + (second.ms || 0),
  };
  // 요약을 먼저 세운 뒤 보고한다 — 순서가 뒤바뀌면 오버레이가 **직전 발동**의 요약을 찍는다.
  flushPriorReport(imageData, second.report, previousMs + (first.ms || 0));
  return second;
}

/** 직전 실패 H 를 현재 프레임 해상도로 옮기고, 정확 포즈를 맨 앞에 둔 24개 후보. */
function carriedPosesFor(imageData) {
  if (!lastFramePose || !imageData) return [];
  const consumed = consumeFramePoseCarry(lastFramePose, {
    nowMs: nowMs(),
    targetWidth: imageData.width,
    targetHeight: imageData.height,
  });
  // 한 번 꺼낸 순간 소비한다. 실패 결과가 같은 포즈를 다시 싣더라도 carryMiss 가
  // rememberFramePose 에서 막아 다음 프레임은 전수 탐색으로 돌아간다.
  lastFramePose = consumed.next;
  const seed = consumed.pose;
  if (!seed) return [];
  return [
    seed,
    ...jitterPoses(seed, {
      frameSide: Math.min(imageData.width, imageData.height),
      offsetCells: PRIOR_COARSE_OFFSET_CELLS,
      maxPoses: PRIOR_MAX_REFINE_POSES - 1,
    }),
  ].slice(0, PRIOR_MAX_REFINE_POSES);
}

/** 이번 실패가 다음 프레임에 남길 포즈를 확정한다. 성공은 곧 세션 종료라 남기지 않는다. */
function rememberFramePose(result, imageData) {
  lastFramePose = framePoseCarryFromResult(result, {
    nowMs: nowMs(),
    sourceWidth: imageData && imageData.width,
    sourceHeight: imageData && imageData.height,
  });
}

/** 직전 포즈를 한 번 시도한다. 실패하면 다음 프레임이 종전 전수 탐색으로 폴백한다. */
async function attemptCarriedPoseScan(imageData, useGuidePrior) {
  // 안정 트리거가 이미 예약한 가이드-사전 프레임에 이월 비용을 덧붙이지 않는다.
  if (useGuidePrior) return attemptGuidePriorScan(imageData);
  const poses = carriedPosesFor(imageData);
  if (poses.length === 0) {
    return decodeFrame(imageData);
  }
  const carried = await decodeFrame(imageData, { priorPoses: poses, deferReport: true });
  lastPriorSummary = {
    stage: 'carry', poses: poses.length, ok: Boolean(carried.ok), ms: carried.ms,
  };
  if (carried.ok) {
    flushPriorReport(imageData, carried.report, 0);
    return carried;
  }
  flushPriorReport(imageData, carried.report, 0);
  return { ...carried, carryMiss: true };
}

/**
 * 안정 게이지 표시. 승격(2026-09-06) 전 정식 화면의 유일한 추가 UI 였고(지금은 스위치·R2 패널·HUD 가
 * 같이 뜬다), 값은 전부 기기 안 로컬이다.
 * (lab 오버레이 표기는 `updateDebugOverlay` 가 같은 스냅샷을 한 번 더 쓴다.)
 */
function renderSteadyMeter(snapshot) {
  const progress = snapshot && Number.isFinite(snapshot.progress) ? snapshot.progress : 0;
  steadyMeterFill.style.width = (progress * 100).toFixed(1) + '%';
  steadyMeter.classList.toggle('visible', progress > 0);
  steadyMeter.classList.toggle('armed', Boolean(snapshot && snapshot.armed));
}

function clearSteadyMeter() {
  steadyMeterFill.style.width = '0%';
  steadyMeter.classList.remove('visible', 'armed');
}

/**
 * lab 디버그 오버레이 갱신 (작업 1). decodeFrame 경로에 이미 있는 순수 추출값만
 * 재사용한다 — lab.enabled(텔레메트리 소켓)와 독립이고, 안정판에선 debugOverlay 가
 * no-op 라 이 함수 전체가 불활성이다. 전송 0바이트.
 */
function updateDebugOverlay(imageData, result, stage, ms) {
  if (!debugOverlay.enabled || !imageData) return;
  debugOverlay.frame({
    frameW: imageData.width,
    frameH: imageData.height,
    ms: ms && ms.total,
    ok: Boolean(result && result.ok === true),
    reason: (result && result.reason) || '',
    stage,
    geometry: extractGeometry(result, imageData.width, imageData.height),
    cellSurface: extractCellSurfaceProbe(result),
    anchors: extractCsAnchors(result),
    zoom: currentZoomTelemetry(),
    // QR 브리지 통계 (시험판) — 「왜 안 읽히나」 를 보이게 (§27.4 0a). 통계는 라벨·수치뿐, 페이로드 없음.
    qr: r2Available ? summarizeQrBridge(qrBridge.stats, qrBridge.supported) : '',
    // HUD 위상·비용 (시험판, §27.4 3a) — 「지금 무엇을 그리고 있고 한 프레임에 얼마 드나」. 빈 문자열이면 줄이 안 붙는다.
    hud: r2Available ? r2HudDebugLine() : '',
    // 안정 게이지·트리거 상태 (lab 전용 표시). 스냅샷은 프레임 루프가 이미 만든
    // 로컬 값이고 새 전송 경로가 없다 — 안정판에선 debugOverlay 가 no-op 다.
    // holdMs 는 **추적기가 실제로 쓰는 값**을 넘긴다 (모듈 상수를 넘기면 옵션으로
    // 만드는 날 게이지가 거짓말을 한다).
    steady: {
      ...steady.snapshot(nowMs()),
      holdMs: steady.holdMs,
      // 센서 부착 상태를 정직하게 — 「표본이 오는가」 와 「왜 안 오는가」 는 다른 정보다.
      attach: motionAttachState,
    },
    prior: lastPriorSummary
      ? { ...lastPriorSummary, budget: priorBudget().coarseCount }
      : { budget: priorBudget().coarseCount },
  });
}

function setStatus(message) {
  statusBox.textContent = message;
}

let scanToastTimer = 0;

/**
 * 사진 스캔 실패를 **눈에 띄게** 알린다.
 *
 * 상태줄(`setStatus`)과 중복이지만 의도된 중복이다 — 사진 경로는 시스템 파일 선택기를
 * 거쳐 돌아오는 흐름이라 사용자의 시선이 하단 상태줄에 없고, 실패가 «아무 일도 안 일어남»
 * 으로 보였다(사용자 제보 2026-08-12). 라이브 프레임 실패엔 쓰지 않는다 — 초당 여러 번
 * 실패하는 게 정상이라 토스트를 띄우면 화면이 깜빡인다.
 *
 * 문구는 호출자가 이미 번역해서 넘긴다(사전 키를 여기서 고르지 않는다).
 */
function showScanToast(message) {
  scanToast.textContent = message;
  scanToast.classList.add('visible');
  clearTimeout(scanToastTimer);
  scanToastTimer = setTimeout(() => {
    scanToast.classList.remove('visible');
  }, 4200);
}

function hasCameraApi() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * `getUserMedia` 가 허용되는 컨텍스트인가.
 *
 * ⚠ `location.protocol === 'https:'` 로 판정하면 안 된다. 브라우저는 `http://localhost`
 *    (와 `127.0.0.1`)를 **신뢰할 수 있는 출처**로 취급해서 보안 컨텍스트로 인정하고
 *    카메라도 실제로 열어 준다. 프로토콜만 보면 로컬 개발에서 카메라 검증이 통째로
 *    막히고 — 정작 배포 전에 확인해야 할 경로를 못 밟게 된다.
 *    `isSecureContext` 가 정확히 이 판정을 위한 표준 API 다.
 */
function isSecureForCamera() {
  return window.isSecureContext === true;
}

function setCameraStageActive(active) {
  cameraStage.classList.toggle('is-active', active);
  // 수동 리셋 버튼(⑫)은 **카메라가 켜졌을 때만** 뜬다. r2Available 가 false 면(승격 되돌림) authored hidden 그대로다.
  // scanResetButton 은 모듈 로드 때 잡히고 이 함수는 카메라 시작·정지에서만 불리므로 초기화 뒤에 읽힌다.
  if (scanResetButton) scanResetButton.hidden = !(active && r2Available);
  resetProcFps(active);
}

/*
 * 처리 fps (운영자 지시 2026-08-17) — «초당 몇 프레임을 복호 시도하는가».
 * 카메라 프레임률이 아니라 **복호 완료 기준**이다: 수집·복호 오버헤드가 그대로
 * 반영되므로 시험판(수집 있음)과 정식·스테이징(수집 없음)의 체감 차이를 이 수치로
 * 직접 비교할 수 있다. 5초 롤링 창 · 표시 500ms 스로틀 · 표본 2개 전에는 «—».
 */
const PROC_FPS_WINDOW_MS = 5000;
const procFpsTimes = [];
let procFpsShownAt = 0;

function noteFrameProcessed() {
  if (!procFpsEl) return;
  const now = performance.now();
  procFpsTimes.push(now);
  while (procFpsTimes.length > 0 && now - procFpsTimes[0] > PROC_FPS_WINDOW_MS) {
    procFpsTimes.shift();
  }
  if (procFpsTimes.length < 2 || now - procFpsShownAt < 500) return;
  procFpsShownAt = now;
  const spanSec = (now - procFpsTimes[0]) / 1000;
  const fps = spanSec > 0 ? (procFpsTimes.length - 1) / spanSec : 0;
  procFpsEl.textContent = fps.toFixed(1) + ' fps';
}

function resetProcFps(visible) {
  if (!procFpsEl) return;
  procFpsTimes.length = 0;
  procFpsShownAt = 0;
  procFpsEl.textContent = '—';
  procFpsEl.hidden = !visible;
}

function showCameraGate(settings) {
  const options = settings || {};
  const requestedCanStart = options.canStart !== false;
  const phase = options.phase || (requestedCanStart ? 'start' : 'disabled');
  const presentation = gatePresentation(phase, requestedCanStart);

  cameraGatePhase = phase;
  cameraGateTitle.textContent = options.title || t('gate.title');
  cameraGateMessage.textContent = options.message || t('gate.message');
  startCameraButton.textContent = options.startLabel || t('gate.start');
  startCameraButton.hidden = !presentation.showStart;
  startCameraButton.disabled = !presentation.canStart;
  cameraGate.hidden = false;
}

function hideCameraGate() {
  cameraGate.hidden = true;
}

function showSupportedStartGate(message) {
  if (!isSecureForCamera()) {
    showCameraGate({
      title: t('gate.https.title'),
      message: t('gate.https.message'),
      canStart: false,
      startLabel: t('gate.https.start'),
    });
    return;
  }

  if (!hasCameraApi()) {
    showCameraGate({
      title: t('gate.unsupported.title'),
      message: t('gate.unsupported.message'),
      canStart: false,
      startLabel: t('gate.unsupported.title'),
    });
    return;
  }

  showCameraGate({
    message: message || t('gate.message'),
  });
}

function showPreparingCameraGate() {
  showCameraGate({
    phase: 'preparing',
    title: t('gate.preparing.title'),
    message: t('gate.preparing.message'),
  });
}

function stopTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

function clearCameraTrackEndListeners() {
  cameraTrackEndCleanups.forEach((cleanup) => cleanup());
  cameraTrackEndCleanups = [];
}

/*
 * 자동 재시작 1회 제한이 막아야 하는 것은 «무한 루프» 지 «두 번째 사고» 가 아니다.
 *
 * 카운터를 hidden 전환에서만 0 으로 되돌리면, 복귀 자동 재시작이 **성공한 뒤** 같은
 * 포그라운드 구간에서 카메라가 다시 회수될 때(통화·다른 카메라 앱) 두 번째 죽음은
 * 자동 복구를 못 받고 곧장 탭 게이트로 강등된다 — 사용자에겐 「아까는 알아서 살아났는데
 * 왜 지금은 탭하라 하나」 가 된다. 그건 제한의 의도가 아니라 문자 그대로의 부작용이다.
 *
 * 그래서 **카메라가 실제로 얼마간 살아 있었으면** 다음 사고를 위한 자동 시도 1회를
 * 되돌려 준다. 열리자마자 죽는 기기(다른 앱이 쥐고 있는 경우)는 이 문턱을 못 넘으므로
 * 타이트 루프는 여전히 불가능하다 — 막는 성질은 유지하고 값만 조건부로 만든다.
 */
const RESUME_ATTEMPT_EARNBACK_MS = 5000;

function earnFreshResumeAttempt(session) {
  window.setTimeout(() => {
    if (session !== scanSession) return;
    if (currentCameraLiveness() !== 'live') return;
    resumeAttemptsThisTransition = 0;
  }, RESUME_ATTEMPT_EARNBACK_MS);
}

function watchCameraTrackEnds(stream, session) {
  clearCameraTrackEndListeners();

  for (const track of stream.getVideoTracks()) {
    if (!track || typeof track.addEventListener !== 'function') continue;

    const onEnded = () => {
      if (session !== scanSession || cameraStream !== stream) return;
      if (document.visibilityState === 'hidden') return;
      void recoverCameraAfterResume();
    };
    track.addEventListener('ended', onEnded);
    cameraTrackEndCleanups.push(() => track.removeEventListener('ended', onEnded));
  }
}

/*
 * ⑯(i) 유예 문지기 — 「지금 유예 중인가」와 「닫기의 나머지 절반을 누가 가져가는가」만 쥔다.
 * 시계는 기본값(전역 setTimeout)이고, 규칙·불변식은 src/scanner-accept-delay.js 가 가짜 시계로 잰다.
 */
const acceptStopGate = createAcceptStopGate();

function stopCamera() {
  /*
   * ⑯(i) — 유예 중이었다면 «닫기의 나머지 절반»(결과 시트)을 여기서 회수해 **이 정지 뒤에** 잇는다.
   * 그래서 순서는 승격 전과 같다: stopCamera → 결과 시트. 회수는 한 번뿐이라(gate.take) 늦은 타이머가
   * 카메라를 두 번 끄지 않고, 리셋·가시성 전환처럼 «유예를 기다려 주지 않는» 입구로 정지가 와도
   * 읽은 결과를 버리지 않는다 (사용자가 리셋을 눌렀다고 이미 읽은 답이 사라지면 안 된다).
   */
  const acceptRest = acceptStopGate.take();

  scanSession += 1;
  cameraRequestPending = false;
  isDecoding = false;
  lastDecodeAt = 0;
  lastFrameCostMs = 0;
  // 프레임 양보도 세션에 묶인다 — 탭 뒤 rAF 가 돌기 전에 세션이 끊기면(가시성 전환 → 재개)
  // 살아남은 플래그를 **다음 세션의 첫 프레임**이 삼켜 첫 grab·가이드 점이 한 프레임 밀린다.
  yieldFrameOnce = false;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }

  const stream = cameraStream;
  cameraStream = null;
  clearCameraTrackEndListeners();
  stopTracks(stream);

  try {
    cameraVideo.pause();
  } catch {
    // 재생이 시작되기 전의 pause()는 무시해도 됩니다.
  }
  cameraVideo.srcObject = null;
  setCameraStageActive(false);
  resetZoomState();
  // 안정 유지는 스트림 수명에 묶인다 — 이전 세션의 유지 시간이 새 카메라로 새면
  // 켜자마자 트리거가 걸려 「맞췄다」 는 전제가 거짓이 된다.
  steady.reset();
  priorInFlight = false;
  statusOwnedBySteady = false;
  lastPriorSummary = null;
  clearSteadyMeter();
  renderGuideDots();
  // R2 누적도 스트림 수명에 묶인다 — 세션은 DONE 뒤 흡수 상태라 비우지 않으면 다음
  // 카메라의 첫 프레임에 옛 글자가 결과로 다시 뜬다. 인디케이터·셀맵 잔상도 같이 지운다.
  r2Runtime.reset();
  qrBridge.reset();
  runtimeFamilyHint = null;
  renderR2Progress();
  renderR2CellMap();

  // ⑯(i) — 정지가 끝난 **뒤**에 결과 시트. 위 정리(캔버스 숨김·래치 유지)가 끝난 상태가 승격 전과 같다.
  if (acceptRest) acceptRest();
}

function cameraFailure(error) {
  const name = error && error.name;

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      title: t('gate.denied.title'),
      message: t('gate.denied.message'),
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' ||
      name === 'OverconstrainedError' || name === 'NotReadableError' ||
      name === 'AbortError') {
    return {
      title: t('gate.notfound.title'),
      message: t('gate.notfound.message'),
    };
  }

  return {
    title: t('gate.failed.title'),
    message: t('gate.failed.message'),
  };
}

function waitForVideoMetadata(video) {
  if (video.readyState >= 1) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('camera-video-error'));
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

/**
 * 카메라 스트림을 연다.
 *
 * ⚠ 해상도 제약을 **반드시** 준다. 제약이 없으면 브라우저 기본값이 잡히는데 Android
 *    Chrome 의 기본은 640×480 이고, 그걸 1080p+ 화면에 `object-fit: cover` 로 채우면
 *    확대율이 2\~3배가 되어 눈에 띄게 흐려진다(실기기 확인, 2026-08-10). iOS 는 더 높은
 *    기본값을 고르는 경향이 있어 **안드로이드에서만** 증상이 보였다.
 *
 * `ideal` 을 쓰고 `exact`·`min` 을 쓰지 않는다 — 후자는 못 맞추면 OverconstrainedError 로
 * 카메라 자체가 안 열린다. ideal 은 지원되면 올리고 아니면 조용히 낮은 쪽으로 떨어진다.
 */
/**
 * 후면 카메라 목록. 렌즈가 여러 개인 기기(폴드·프로 계열)에서 **어느 렌즈인지가 복호에
 * 직접 영향**을 준다 — 초광각은 같은 거리에서 코드가 훨씬 작게 잡혀 셀당 픽셀이 하한
 * 아래로 내려간다. `facingMode` 만으로는 브라우저가 임의로 하나를 고른다.
 *
 * ⚠ 권한 부여 **전에는** label 이 빈 문자열이라 렌즈를 구분할 수 없다. 그래서 스트림을
 *    한 번 연 뒤에 목록을 다시 읽는다.
 */
async function listRearCameras() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const rear = cameras.filter((device) => /back|rear|environment|후면/i.test(device.label));
    return rear.length > 0 ? rear : cameras;
  } catch {
    return [];
  }
}

/**
 * 카메라 스트림을 연다.
 *
 * ⚠ 해상도 제약을 **반드시** 준다. 제약이 없으면 브라우저 기본값이 잡히는데 Android
 *    Chrome 의 기본은 640×480 이고, 그걸 `object-fit: cover` 로 채우면 확대율이
 *    2\~3배가 되어 눈에 띄게 흐려진다(실기기 확인, 2026-08-10).
 *
 * r3 화질 결정(2026-08-16): ideal 을 1920×1080 → **2560×1440** 으로 올린다.
 *   · 근거: 승격 프레임(FRAME_ESCALATED_SIDE=1440)은 `min(1440, round(sourceSide))` 로
 *     캡핑된다 — 1080p 스트림에선 승격해도 1080² 가 상한이라 «1440 승격» 이 이름뿐이었다.
 *     1440p 스트림이면 승격이 실제 1440² 가 되어 셀 픽셀 1.33× (A2 8.36→12.5px 급).
 *   · 기본 프레임 비용은 불변: 매 프레임 grab 은 여전히 960² 로 축소된다(아래 결정 참조)
 *     — 스트림 해상도는 grab 의 **소스**만 바꾸지 복호 픽셀 수를 바꾸지 않는다.
 *   · ideal 이라 미지원 기기는 조용히 1080p/720p 로 떨어진다 — 종전과 동일 동작.
 *
 * «target ≤ 960 사전 축소» 유지 결정: Node 실측(tools/probes/probe-square-timing.mjs,
 * 2026-08-16 — 반복 실행 관측 범위) 1440² 이 960² 대비 **1.33\~2.09× 느림** (절대값은
 * 부하에 따라 3배까지 요동해 범위로만 인용; 프로브가 test/output 에 있던 동안 스위트가
 * 매번 재실행·덮어써 스냅샷이 부패했던 전력 — 그래서 tools/probes/ 로 격리했다).
 * 실기기가 이미 프레임당 1.5\~2초대라 상시 1440 은 어떤 관측치로도 주기를 크게 미는
 * 반면, 셀 픽셀은 이미 하한(9px) 위다(바깥 링 채움 시 Y1 12.3px). 그래서 흔한 경로는
 * 960 으로 빠르게 돌리고, 연속 실패 5회마다 1440 승격 한 번(기존 경로)만 비싸게 본다.
 * 이중 열화 여부: grab 은 센서 네이티브 정사각을 **한 번** 축소한다(크롭 → 즉시 960) —
 * 축소 후 재축소 단계가 없어 이중 열화가 아니며, 승격 프레임은 축소 없이 1440² 그대로다.
 *
 * `ideal` 을 쓰고 `exact`·`min` 을 쓰지 않는다 — 후자는 못 맞추면 OverconstrainedError 로
 * 카메라 자체가 안 열린다. 다만 **deviceId 는 exact** 로 준다: 사용자가 고른 렌즈를
 * 브라우저가 조용히 무시하면 선택 UI 가 거짓말이 되기 때문이다.
 */
async function requestCameraStream(deviceId) {
  const video = {
    width: { ideal: 2560 },
    height: { ideal: 1440 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = { ideal: 'environment' };

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (error) {
    if (!error || error.name !== 'OverconstrainedError') throw error;
    // 고른 렌즈가 이 제약을 못 맞추면 해상도 요구를 버리고 그 렌즈만 유지한다.
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false,
        });
      } catch {
        // 렌즈 고정 자체가 실패하면 아래 기본 경로로 떨어진다.
      }
    }
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

/**
 * 지원하는 기기에서 연속 자동초점을 켠다.
 *
 * 스캐너는 근거리 피사체를 계속 겨누는 사용 패턴이라, 단발 초점이면 손이 조금만 움직여도
 * 흐려진 채로 머문다. 능력 조회(`getCapabilities`)로 지원 여부를 먼저 확인하고, 실패는
 * 전부 삼킨다 — 초점 모드는 있으면 좋은 것이지 없다고 스캐너를 막을 이유가 없다.
 */
function tryContinuousFocus(stream) {
  const track = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
  if (!track || typeof track.applyConstraints !== 'function') return;

  let capabilities = null;
  try {
    capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
  } catch {
    return;
  }
  if (!capabilities || !Array.isArray(capabilities.focusMode) ||
      !capabilities.focusMode.includes('continuous')) {
    return;
  }

  track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {
    // 지원한다고 보고했어도 적용이 거부될 수 있다 — 초점은 부가 기능이므로 무시한다.
  });
}

/**
 * 프레임에서 **가이드 정사각**만 잘라 복호 해상도를 확보한다.
 *
 * ⚠ 이전 구현은 `FRAME_MAX_SIDE / max(width, height)` 로 축소했다. 세로로 긴 폰 프레임
 *    (예: 1080×2520, 9:21)에서는 **대부분 빈 공간인 세로**가 960 을 차지하고 정작 코드가
 *    있는 가로가 411 로 무너진다. 실기기 영상 실측(2026-08-11):
 *
 *      긴 변 960  → 411×960   → 셀당 **4.89 px**   ← 하한 9 px 의 절반, 복호 불가
 *      중앙 정사각 960 → 960×960 → 셀당 11.34 px
 *      중앙 정사각 1440 → 1440×1440 → 셀당 17.0 px
 *
 *    화면에 보이는 가이드 윤곽도 중앙 정사각이므로, 사용자가 "가이드 안에 맞췄다" 는
 *    영역과 실제로 복호하는 영역이 일치하게 된다 — 이전에는 어긋나 있었다.
 *
 * 가이드 밖을 버리므로 잡동사니(주변 UI·책상·손)도 같이 빠져 검출이 쉬워진다.
 */
function imageDataCenterSquare(source, width, height, maxSide = FRAME_MAX_SIDE, cropZoom = 1) {
  if (!frameContext || !width || !height) return null;

  const crop = cropWindow(width, height, cropZoom, maxSide);
  if (!crop) return null;

  frameCanvas.width = crop.target;
  frameCanvas.height = crop.target;

  try {
    // 원본 픽셀에서 먼저 자르고, 그 다음에만 target 으로 줄인다.
    frameContext.drawImage(
      source,
      crop.sourceX,
      crop.sourceY,
      crop.sourceSide,
      crop.sourceSide,
      0,
      0,
      crop.target,
      crop.target,
    );
    return frameContext.getImageData(0, 0, crop.target, crop.target);
  } catch {
    return null;
  }
}

/**
 * 고른 **사진 전체**를 복호용으로 축소한다 — 자르지 않는다.
 *
 * 라이브 프레임과 달리 사진은 코드가 가운데 있으리란 보장이 없다(사용자가 이미 찍어 둔
 * 것이다). 그래서 정사각 크롭을 쓰면 코드를 잘라 버릴 수 있다.
 *
 * 대신 **짧은 변**을 기준으로 축소한다. 긴 변 기준으로 하면 세로로 긴 사진에서 가로가
 * 무너져 셀당 픽셀이 하한(9px) 아래로 내려간다 — 라이브 경로에서 실측된 바로 그 결함이다.
 * 실시간 제약이 없으므로 총 픽셀 상한까지만 지키면 된다.
 */
function imageDataWhole(source, width, height) {
  if (!frameContext || !width || !height) return null;

  const shortSideScale = Math.min(1, PHOTO_MAX_SHORT_SIDE / Math.min(width, height));
  const areaScale = Math.min(1, Math.sqrt(PHOTO_MAX_PIXELS / (width * height)));
  const scale = Math.min(shortSideScale, areaScale);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  frameCanvas.width = targetWidth;
  frameCanvas.height = targetHeight;

  try {
    frameContext.drawImage(source, 0, 0, targetWidth, targetHeight);
    return frameContext.getImageData(0, 0, targetWidth, targetHeight);
  } catch {
    return null;
  }
}

/**
 * 실패가 쌓이면 **해상도를 올려** 한 프레임을 다시 시도한다.
 *
 * 왜: 실기기 사진 실측(2026-08-11)에서 성공/실패가 **셀당 픽셀 하나로 갈렸다.**
 *   초광각 7.6px·9.0px → 실패 / 광각 9.1px·10.4px → 성공 / 망원 10.1px·11.9px → 성공
 * 하한이 9px 인데 실패 표본이 정확히 그 아래였다. 즉 마진이 거의 없다.
 *
 * 렌즈 선택 UI 를 뒀지만 기본 렌즈가 초광각인 기기에서는 사용자가 그걸 알 도리가 없다.
 * 그래서 **연속 실패가 쌓이면 스캐너가 스스로 해상도를 올린다** — 같은 거리에서 셀당
 * 픽셀이 1.5배가 되어 하한을 넘긴다.
 *
 * 매 프레임 올리지 않는 이유는 비용이다(복호가 프레임당 수십 ms\~수 초). 흔한 경우는
 * 빠르게 돌리고, 안 될 때만 비싸게 한 번 더 본다.
 */
const FRAME_ESCALATED_SIDE = 1440;
/**
 * 사용자에게 **보이는** 비디오 영역(비디오 픽셀). 프리뷰는 정사각 스테이지 + `object-fit: cover`
 * + `effectiveCropZoom` 배율이라, 센서 프레임의 가운데 정사각을 배율로 나눈 것이다 —
 * R1 의 `imageDataCenterSquare` 와 같은 기하. QR 브리지는 이 밖의 코드를 버린다: 화면에 없는
 * 코드가 읽혀 결과로 뜨면 사용자는 «겨누지도 않은 링크» 를 받는다.
 */
function visibleVideoRegion() {
  const vw = cameraVideo.videoWidth;
  const vh = cameraVideo.videoHeight;
  if (!(vw > 0) || !(vh > 0)) return null;
  const side = Math.min(vw, vh) / effectiveCropZoom();
  return { x: (vw - side) / 2, y: (vh - side) / 2, width: side, height: side };
}
function grabVideoFrame(atMs = nowMs()) {
  const escalate = escalationDue(atMs, nextEscalationAt);
  const maxSide = escalate ? FRAME_ESCALATED_SIDE : FRAME_MAX_SIDE;
  const grabbed = imageDataCenterSquare(
    cameraVideo,
    cameraVideo.videoWidth,
    cameraVideo.videoHeight,
    maxSide,
    effectiveCropZoom(),
  );
  if (grabbed) {
    if (escalate) nextEscalationAt = scheduleNextEscalationAt(atMs);
    return grabbed;
  }
  if (effectiveCropZoom() > 1.001) {
    // 크롭 실패 폴백은 자동 사다리도 함께 내린다 — 안 내리면 다음 프레임이 같은
    // 배율로 또 실패한다.
    autoCropIndex = 0;
    const previousError = zoomPlan.error;
    zoomPlan = {
      ...zoomPlan,
      cropApplied: 1,
      error: zoomPlan.error || 'crop-failed',
    };
    if (zoomPlan.error !== previousError) {
      setZoomErrorVisible(t('zoom.failed'));
      showScanToast(t('zoom.failed'));
    }
    // 크롭 폴백 해제 시 프리뷰의 CSS scale(crop) 잔존을 즉시 재동기화 —
    // 안 하면 이 경로에서만 «가이드 = 분석 영역» 불변식이 화면상 깨진다.
    syncPreviewTransform();
    const fallback = imageDataCenterSquare(
      cameraVideo,
      cameraVideo.videoWidth,
      cameraVideo.videoHeight,
      maxSide,
      1,
    );
    if (fallback && escalate) nextEscalationAt = scheduleNextEscalationAt(atMs);
    return fallback;
  }
  return null;
}

// 문은 하나다 — 본체는 `src/scanner-scan-assist.js`. 옮긴 이유: 테스트가 R2 적중 객체를
// **이 함수에** 넣어 본다 (2026-09-05 삼킴, PM/029B §24.9).
function normalizePayload(result) {
  return normalizeDecodePayload(result);
}

/**
 * 복호가 끝내 실패한 프레임에만 코너 QR 스캔 어시스트를 붙인다.
 *
 * 디코더 옵션이나 포즈 목록에는 되먹이지 않는다. 이 결과의 소비자는 아래 안내 분기뿐이며,
 * 12가설을 한 위치로 좁히지 못하면 `scanAssist.ok === false` 그대로 침묵한다.
 */
function attachCornerQrScanAssist(result, imageData) {
  if (!result || result.ok === true || !imageData) return result;
  try {
    const luma = toRelativeLuminance({
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.data,
    }, { rejectLowDynamicRange: false });
    if (!luma || luma.ok === false) return result;
    const detected = detectQrFinderTriples(luma);
    const candidates = detected && detected.ok === true ? detected.candidates : [];
    return {
      ...result,
      scanAssist: localizeCornerQrAssist(luma, candidates),
    };
  } catch {
    // 어시스트 실패가 기존 시간 기반 안내나 다음 프레임을 막아서는 안 된다.
    return result;
  }
}

function handleDecodeResult(result, source, session) {
  if (session !== scanSession) return;
  /*
   * ⑯(i) — 유예 중이면 **문이 닫혀 있다**. 이미 한 답을 받아들였고 카메라는 정정 강조를 보여 주려고
   * 잠시 더 살아 있을 뿐이다: 여기서 두 번째 수용을 허락하면 결과가 두 번 뜨고(finishProductScanOk 가
   * 두 번) 어느 답이 화면에 남는지도 프레임 운이 정한다. 같은 글자가 다시 와도(누적기는 DONE 뒤
   * 흡수 상태다) 마찬가지다. 실패 분기도 함께 닫는다 — 유예 창의 상태줄은 «읽었다» 여야 한다.
   */
  if (acceptStopGate.isPending()) return;

  const payloadRaw = normalizePayload(result);
  // 중앙 비컨은 문법적으로 완전한 Type Y 코드라 여기까지 «성공» 으로 올라온다.
  // 그대로 보여주면 매직(제어문자) 탓에 **빈 텍스트**가 뜬다 (실기기 재현 2026-08-22).
  // 계약(§4.1): 비컨은 결과가 아니라 «바깥 코드가 있다» 는 신호다 — 종료하지 않고
  // 전체 코드가 잡히게 안내한다.
  const beaconOnly = payloadRaw !== null && textStartsWithBeaconMagic(payloadRaw);
  const payload = beaconOnly ? null : payloadRaw;

  // 거리(셀당 픽셀 부족)가 복호 실패의 가장 흔한 원인인데 아무 피드백이 없으면
  // 사용자는 무엇을 바꿔야 할지 알 수 없다. 연속 실패가 쌓이면 한 번만 안내한다.
  if (source === 'camera') {
    if (payload) {
      resetFailureTiming();
    } else {
      const handledAt = nowMs();
      if (failStreakSince === null) {
        failStreakSince = handledAt;
        nextEscalationAt = scheduleNextEscalationAt(handledAt);
      }
      const failedMs = elapsedSinceMs(failStreakSince, handledAt);
      // 잘림 안내 — multi-clip(2면 이상 잘림) 연속이면 «조금 뒤로». 실측에서 이
      // 상태의 성공률이 0% 라 다른 어떤 힌트보다 우선한다. 해소되면 기본 조준
      // 문구로 되돌린다(한 번 뜨고 눌러앉으면 이미 물러난 사용자를 계속 몬다).
      if (result && result.clipSide === 'multi') {
        if (clipStreakSince === null) clipStreakSince = handledAt;
        if (!clipHintShown
          && elapsedSinceMs(clipStreakSince, handledAt) >= CLIP_HINT_MS) {
          clipHintShown = true;
          setStatus(t('status.clipped'));
        }
      } else {
        if (clipHintShown) setStatus(t('status.aim'));
        clipStreakSince = null;
        clipHintShown = false;
      }
      const immediateHint = immediateCornerQrHint(result);
      if (!closerHintShown && immediateHint) {
        closerHintShown = true;
        setStatus(t(immediateHint.messageKey));
      }
      if (!closerHintShown && failedMs >= CLOSER_HINT_MS) {
        // 문턱은 한 번만 소비한다. 그 순간 잘림 안내가 떠 있으면 반대 지시라 표시만
        // 억제하고, 잘림이 풀린 뒤 뒤늦게 «더 가까이» 를 띄우지는 않는다.
        closerHintShown = true;
        if (!clipHintShown) setStatus(t('status.closer'));
      }
      if (beaconOnly) {
        // 비컨만 읽혔다 = 안쪽은 선명한데 바깥 코드가 안 잡힌다. «더 가까이» 는
        // 정반대 처방이라 이 안내가 다른 힌트를 덮는다.
        setStatus(t('status.beaconOnly'));
      }
    }
    // 자동 크롭 사다리 — 실패가 쌓이면 한 단씩 올리고 성공하면 위에서 0 으로
    // 돌아간다. 잘림(«너무 가깝다») 이면 올리지 않는다 — 확대가 정반대 처방이다.
    // 사용자가 확대를 직접 건드렸으면 개입하지 않는다.
    const handledAt = nowMs();
    const nextRung = autoCropRung(elapsedSinceMs(failStreakSince, handledAt), {
      clipped: clipHintShown
        || (result && result.clipSide === 'multi')
        // 비컨만 읽히는 상태도 «너무 가깝다» 와 같은 축이다 — 확대는 정반대 처방.
        || beaconOnly,
      manual: userZoom !== DEFAULT_USER_ZOOM,
    });
    if (nextRung !== autoCropIndex) {
      autoCropIndex = nextRung;
      // 프리뷰를 같은 값으로 즉시 맞춘다 (§effectiveCropZoom 의 불변식).
      syncPreviewTransform();
    }
  }

  if (!payload) {
    if (source === 'file') {
      finishProductScanFail(beaconOnly ? 'beacon-only' : closedScanReason(result));
      if (beaconOnly) {
        // 비컨은 읽혔다 — «아무것도 없음» 이 아니라 «전체가 안 보임» 을 말해 준다.
        setStatus(t('status.beaconPhoto'));
        showScanToast(t('status.beaconPhoto'));
      } else {
        setStatus(t('status.photoNoResult'));
        showScanToast(t('toast.photoNoResult'));
      }
      showSupportedStartGate(t('status.startOrPick'));
    }
    return;
  }

  finishProductScanOk(result, payload);
  /*
   * 닫기의 «나머지 절반» — stopCamera 뒤에 오는 것. 유예를 걸든 안 걸든 **같은 함수**가 돌아야
   * 두 경로가 어긋나지 않는다 (⑯(i) 는 순서를 바꾸지 않는다: 언제나 정지 → 결과 시트).
   *
   * URL 자동 열기는 **허용 목록**이다 — TL 출처(R1·R2)만 열고, 일반 QR·미지의 출처는 사용자가 누른다
   * (겨누지도 않은 링크가 열리면 피싱 벡터).
   * R2 출처면 확정 요약(래치)을 결과 카드에 같이 넘긴다 (F8 · 운영자 ⑧).
   * 래치를 결과에 묶는 이유: 옛 R2 DONE 뒤 사진 결과가 뜰 때 남은 래치가 사진 결과의 요약으로 읽히면 안 된다.
   *
   * ⚠ 요약은 **수용한 이 순간에** 값으로 붙잡는다. 아래 클로저는 후보 HUD의 150 ms 유예 뒤에 도는데,
   * 그 사이에 래치를 비우는 입구가 실재한다(엔진 스위치 · 리셋 · 새 세션). 클로저가 `r2Latched` 를
   * **호출 시점에** 읽으면 그 입구 하나가 결과 카드의 «Type/n/DONE/RS 정정 k» 를 통째로 지운다 —
   * 유예를 만든 이유(정정을 보여 준다)와 정확히 반대다. 값으로 붙잡으면 누가 언제 래치를 비우든
   * 이 결과의 요약은 이 결과의 것이다. 그래서 이 클로저는 R2 래치를 참조하지 않는다.
   */
  const acceptedR2Summary = result.source === 'r2' ? r2Latched : null;
  const showAccepted = () => {
    showResult(payload, { autoOpen: resultAutoOpen(result), r2Summary: acceptedR2Summary });
  };
  /*
   * 상태줄은 **유예보다 앞**이다. 유예 창의 상태줄은 «읽었다» 여야 한다 — 정정 강조가 «이 셀들을
   * 고쳤다» 를 그리는 유예 동안 문구가 «모으는 중» 이면 두 표면이 서로 다른 말을 한다.
   * 즉시 닫는 갈래도 같은 순서다(`showResult` 는 상태줄을 안 건드리고, `stopCamera` 도 안 건드린다).
   * 유예 중 매 프레임 도는 `syncR2Status()` 는 DONE 위상에서 action='none' 이라 이 문구를 안 덮는다.
   */
  setStatus(t('status.decoded'));
  /*
   * 수용 뒤 «닫기» 유예: 후보 HUD는 정정 유무와 무관하게 성공색을 150 ms 보여 준다.
   * 종전 정정 전용 fallback도 순수 함수에 보존한다. `r2Correction`의 수는 그릴 정정 셀의 근거이며
   * 조건이다 — 수만 있고 셀 매핑이 없으면 미뤄도 화면에 아무 일이 없고 결과만 늦게 뜬다.
   * 미루는 동안 프레임 루프는 계속 돌아 강조가 매 프레임 옅어진다(그게 이 표면의 전부다), 문은
   * 위에서 닫혀 있고, 만료·리셋·가시성 전환 중 무엇이 오든 stopCamera 가 정확히 한 번 돈다.
   */
  const delayMs = acceptStopDelayMs({
    engineR2: result.source === 'r2',
    correctedCount: r2Correction === null ? 0 : r2Correction.count,
    candidateHud: result.source === 'r2',
  });
  if (result.source === 'r2') {
    r2CandidateHud.accept(r2Latched?.candidateId, nowMs());
    renderR2CellMap();
  }
  if (acceptStopGate.arm(delayMs, showAccepted, stopCamera)) return;
  stopCamera();
  showAccepted();
}

function startFrameLoop(session) {
  // 작업 4: 첫 프레임 grab 성공 시 가이드 재렌더. loadedmetadata 는 기기에 따라
  // 레이아웃 확립보다 이르다 — grab 이 성공했다는 것은 videoWidth/Height 와 스테이지
  // 레이아웃이 실재한다는 가장 강한 증거라, 그 시점에 한 번 더 그린다.
  let firstGrabRendered = false;
  // 새 카메라 세션의 첫 프레임 전에 R2 를 비운다 — stopCamera 를 안 거친 경로(트랙
  // ended 등)도 덮는다. 비우지 않으면 옛 DONE 이 첫 프레임에 결과로 되살아난다 (ⓚ).
  r2Runtime.reset();
  qrBridge.reset();
  runtimeFamilyHint = null;
  // DONE 래치·상태 문구 위상·거부 유예도 새 세션에서 비운다 — 옛 확정 값이 새 카메라의 결과로 읽히면
  // «이미 읽었다» 가 된다 (2b · r2-scan-runtime.test ⓡ).
  r2Latched = null;
  r2Correction = null;
  r2StatusCollecting = false;
  r2StatusHoldUntil = -Infinity;
  // 비운 것을 **지금** 그린다 (F3) — 안 그리면 첫 성공 pushFrame(grab ∧ luma ok) 까지 옛 칩·막대가 새 카메라 위에 남는다.
  // stopCamera 를 안 거친 경로(트랙 ended 등)에선 마지막 라이브 렌더가 그대로 있다. cameraStream 은 이미 세팅돼 있어 NONE 행 렌더.
  renderR2Progress();
  renderR2CellMap();

  const nextFrame = (timestamp) => {
    if (session !== scanSession || !cameraStream || document.visibilityState === 'hidden') {
      return;
    }

    /*
     * ── 한 프레임 양보 (⑤ 엔진 스위치 반응) ─────────────────────────────
     * 탭 핸들러가 `yieldFrameOnce` 를 세우면 이 프레임은 QR·R2·R1 을 **전부 건너뛰고** rAF 만
     * 다시 건다. 이유: R1 위치의 동기 복호가 콜백 안에서 1.4\~2.8 s 를 잡아, 탭은 복호 사이
     * 태스크 경계에서 접수돼도 핸들러 직후 첫 프레임이 다시 복호를 시작해 **페인트가 다음 복호
     * 뒤로 밀렸다**. 여기서 한 프레임을 비워 그 페인트 창을 만든다.
     * ⚠ 플래그를 내리는 자리는 **여기 하나** — 세우는 곳(핸들러)과 짝이다 (engine-switch.test ⓙ).
     */
    if (yieldFrameOnce) {
      yieldFrameOnce = false;
      animationFrameId = requestAnimationFrame(nextFrame);
      return;
    }

    /*
     * ── 일반 QR (BarcodeDetector 위임, PM/029B §26) ── R2 토글 아래 · 브라우저가 지원할 때만.
     * <video> 를 그대로 넘긴다 — grab 중복 없음, 전체 해상도. 결과는 비동기라 콜백에서
     * 세션을 다시 확인한다. TL 리더 QR(HTTPS://TLSCAN.ESTRE.SO[/x]) 은 «TL 코드가 있다»
     * 신호라 노출하지 않고 가족 힌트로만 쓴다 (§2 ①). 그 밖은 R1·R2 와 같은 문.
     */
    if (qrFrameGateOpen({
      r2Enabled: r2Runtime.enabled,
      qrSupported: qrBridge.supported,
      readyState: cameraVideo.readyState,
    })) {
      qrBridge.pushFrame(cameraVideo, timestamp, (hits) => {
        // 비동기 콜백 — 세션과 토글을 다시 본다 (토글 off 직후 늦은 결과가 새면 안 된다).
        if (session !== scanSession || !r2Runtime.enabled) return;
        const route = routeQrHits(hits);
        if (route.family !== null) {
          runtimeFamilyHint = { evidence: Object.freeze({ family: route.family }), at: nowMs() };
        }
        if (route.expose !== null) {
          handleDecodeResult(qrHitToDecodeResult(route.expose), 'camera', session);
        }
      }, { region: visibleVideoRegion() });
    }

    // detect 가 비행 중이면 짧게(≤150 ms) R1·R2 의 grab 을 건너뛴다 — 둘 다 동기 복호라 같은 틱에 시작하면
    // detect 결과가 R1 시간(1.4~2.8 s)만큼 밀린다. 브리지가 안 도는 화면(R2 닫힘)은 inFlight=false → 항상 false.
    const yieldForQr = frameYieldForQr({
      inFlight: qrBridge.inFlight,
      submittedAt: qrBridge.stats.submittedAt,
      now: nowMs(),
    });

    /*
     * ── R2(LTC) 독립 캐던스 (S5 · PM/029B §22·§23) ─────────────────────────
     *
     * 🔴 **`!isDecoding` 게이트 «밖»** 이어야 한다. 옛 안(S2)은 그 안에 있었고,
     * 그래서 R2 가 「카메라 프레임당」이 아니라 「단발 복호 1사이클당」 한 장을 받았다 —
     * 복호가 1.4\~2.8초이므로 누적기가 단발보다 프레임을 더 볼 방법이 **구조적으로
     * 없었다** (PM/029 §6.5.1). 여기가 그 수리다.
     *
     * ⚠ **플래그가 꺼져 있으면 이 블록은 통째로 없는 것과 같다** — `r2Runtime.enabled` 가 false 면
     * 첫 줄에서 반환하고 grab 도 안 한다. (아래 R1 블록의 캐던스는 이 플래그가 아니라
     * `r2Available`(스위치 실재)로 갈린다. 2026-09-06 §27.6 · 승격으로 정식도 그 «실재» 쪽이다.)
     * 그 성질을 `test/r2-scan-runtime.test.js` 가 잰다. **켜져 있으면 R1 블록은 건너뛴다**
     * (운영자 결정 ② · 2026-09-05: 스위치 R2 위치 = R2 누적 + QR 만, R1 단발 끔). 그래서
     * R1 이 맡던 부수 효과 — 첫 grab 뒤 가이드 점 재렌더, 시험판 fps 줄 — 를 이 블록이 대신
     * 맡는다. `noteProductFrame()` 은 R1 «복호 시도 회계» 라 여기서 부르지 않는다: R2 는
     * 프레임을 누적하지 시도하지 않고, 부르면 R2 위치의 시도 수가 R1 위치와 다른 뜻이 된다.
     * (⑫ 부수 효과: 토글·줌 입력 지연의 원인이던 R1 동기 복호가 R2 위치에선 안 돈다.)
     *
     * ⚠ grab 을 R1 과 **공유하지 않는다.** 공유하려면 R1 의 캐던스·비용 계산을
     * 건드려야 하고, 그건 플래그 off 에서도 동작이 달라진다는 뜻이다. R2 위치
     * 한정 기능을 위해 R1 위치의 타이밍을 바꾸지 않는다 — 중복 grab 비용은 R2 위치에서만 든다.
     */
    if (r2Runtime.enabled) {
      const r2FrameStartedAt = nowMs();
      // 성공 카드를 그리는 짧은 유예 중에는 무거운 복호를 다시 돌리지 않아요.
      const r2Image = yieldForQr || acceptStopGate.isPending() ? null : grabVideoFrame(r2FrameStartedAt);
      if (acceptStopGate.isPending()) renderR2CellMap();
      if (r2Image) {
        // R1 대신 (②): 첫 grab 이 곧 레이아웃 실재의 증거 — 안 그리면 조준 가이드가 사라진다.
        if (!firstGrabRendered) {
          firstGrabRendered = true;
          renderGuideDots();
        }
        try {
          const r2Luma = toRelativeLuminance({
            width: r2Image.width,
            height: r2Image.height,
            pixels: r2Image.data,
          }, { rejectLowDynamicRange: false });
          if (r2Luma && r2Luma.ok !== false) {
            const hit = r2Runtime.pushFrame(r2Luma, timestamp);
            renderR2Progress();
            renderR2CellMap();
            syncR2Status();
            /*
             * ⑯(i) — 유예 중이면 이 hit 는 **이미 받아들인 그 답**이다 (누적기는 DONE 뒤 흡수 상태라
             * 매 프레임 같은 답을 돌려준다 · ⓚ). 문에 다시 넣지 않고 거부 경로도 타지 않는다 —
             * 거부 경로는 래치와 정정 강조를 비우는데, 그 강조가 정확히 지금 그리고 있는 그림이다.
             * 이 프레임의 렌더는 위 `renderR2CellMap()` 이 이미 했다 (α 가 프레임마다 옅어진다).
             */
            if (hit && typeof hit.text === 'string' && !acceptStopGate.isPending()) {
              // DONE 스냅샷은 문 **앞**에서 — 문이 받아들이면 stopCamera 가 r2Runtime.reset() 을
              // 먼저 불러 stats 가 비므로, 결과 카드의 확정 요약이 읽을 값은 여기서 잡아 둔다 (ⓡ).
              // leadingId = 이 프레임 좌 패널의 레이아웃 선두 (renderR2Progress 가 바로 위에서 갱신) — DONE 과 다르면 «정정»(⑧).
              r2Latched = {
                candidateId: hit.candidateId,
                revision: hit.revision,
                profile: hit.profile || 'Y',
                geometryMode: hit.hudSnapshot?.geometryMode,
                layoutId: hit.layoutId,
                n: hit.n,
                leadingId: r2LeadingId,
                // 3b — 결과 카드 DONE 칩이 읽는 수 (0 이면 칩에 아무 접미도 안 붙는다).
                correctedCount: Number.isInteger(hit.correctedCount) ? hit.correctedCount : 0,
              };
              /*
               * 3b — 정정 강조 래치. 규칙은 순수 모듈이 쥔다 (`hudCorrectionLatch`): 셀이 0개면
               * **아예 안 세우고**(빈 래치는 「그릴 게 있다」로 읽혀 렌더가 헛돈다), 그 셀 번호의
               * 좌표계 셋(변종·n·세대)을 통째로 붙잡는다. 시각은 여기서 주입한다.
               * 🔴 옛 자리는 객체 리터럴이라 «붙잡는 칸이 하나 빠졌다» 를 재는 자가 없었다 —
               * `formatWire` 한 줄을 지우면 정정 강조가 한 픽셀도 안 그려지는데 87/87 초록이었다
               * (3b 검토 rulers F2). 이제 소비자(`hudCorrectionGridOk`)까지 값으로 이어진다.
               */
              r2Correction = hudCorrectionLatch(hit, nowMs());
              // R2 가 먼저 읽었다. 결과 경로는 R1 과 **같은 문**을 쓴다 —
              // 새 표시 경로를 만들면 두 경로가 어긋난다.
              handleDecodeResult(r2HitToDecodeResult(hit), 'camera', session);
              /*
               * 문을 지난 뒤의 갈래는 **셋**이다 (⑯(i) 로 하나 늘었다, 2026-09-06 승격):
               *   ① 수용 + 즉시 닫힘 — `stopCamera` 가 세션을 올렸다. 여기서 끝(rAF 재예약도 없다).
               *   ② 수용 + **닫기 유예** — 세션은 아직 안 올랐지만 거부가 아니다. 카메라를 계속 돌려
               *      정정 강조를 그리는 것이 이 갈래의 존재 이유다 (아래 ③ 의 정리를 타면 안 된다).
               *   ③ 거부 (비컨만 · 빈 페이로드) — 루프를 **계속 돌리고** R2 를 비운다: 세션은 DONE 뒤
               *      흡수 상태라 비우지 않으면 매 프레임 같은 답을 되돌려 영원히 갇힌다 (ⓚ).
               * ⚠ 옛 코드는 `{ text }` 를 넘기고 무조건 return 했다 — 문은 `payload` 만 보므로 성공이
               *   실패로 떨어졌고, return 이 rAF 재예약을 건너뛰어 루프가 죽었다 (.04~.05.02 시험판,
               *   PM/029B §24.9). ⓘ·ⓙ 가 잰다.
               */
              if (session !== scanSession) {
                /*
                 * 🔴 **정정 강조는 문이 «받아들인» 뒤에만 그린다** (3b 검토 F13). 옛 자리는 문 **앞**
                 * 이라, 거부될 적중(비컨만·빈 페이로드)의 강조가 캔버스에 먼저 찍히고 그 뒤에야
                 * `r2Correction = null` 이 돌았다 — 아래 주석이 스스로 금지한 그 거짓말이다.
                 *
                 * ⚠ 이 갈래(①)에 오는 것은 **정정이 0 인 적중뿐**이다: 정정 셀이 있으면 문이 닫기를
                 * 미뤄(갈래 ②) 세션을 안 올린다. 즉 여기서 그릴 강조는 구조적으로 없다 — 3b 가 남겨
                 * 뒀던 «지금은 화면에 도달 못 하는 한 줄» 은 승격과 함께 갈래 ② 로 옮겨 갔고, 그
                 * 표면은 이제 유예 창의 프레임 루프가 매 프레임 그린다.
                 */
                return;
              }
              /*
               * ⑯(i) 갈래 ② — 세션이 안 올랐는데도 «거부» 가 아닌 경우. 아래 거부 정리를 돌리면 방금
               * 확정한 래치·정정 강조를 스스로 지운다(표면의 정반대). 그래서 거부 정리는 «유예가 안
               * 걸렸을 때» 만 돈다. `return` 하지 않는 것이 핵심이다 — 이 프레임도 바닥의 rAF 로 이어져야
               * 유예 창 동안 루프가 살아 강조가 옅어지는 그림이 실제로 합성된다.
               */
              if (!acceptStopGate.isPending()) {
                r2Runtime.reset();
                // 거부된 적중은 확정이 아니다 — 래치도 되돌린다. 정정 강조도 같이: 거부된 복호가
                // «고쳤다» 고 지목한 셀은 그 복호가 틀렸다는 뜻이라 화면에 남기면 거짓말이다.
                r2Latched = null;
                r2Correction = null;
                // 거부 = 락 해제의 다른 이름인데 처방 문구(beaconOnly 등)는 문이 이미 잡았다 — 다음 프레임의 release 전이가
                // status.aim 으로 덮지 않게 위상을 내리고, 재락의 r2Collecting 이 처방을 즉시 덮지 않게 잠시 유예한다
                // (F1 · 규칙은 r2-confirmation-model.r2StatusOnReject — r2-confirmation-model.test (xii) 가 값으로 잰다).
                const afterReject = r2StatusOnReject(nowMs());
                r2StatusCollecting = afterReject.collecting;
                r2StatusHoldUntil = afterReject.holdUntil;
              }
            }
          }
        } catch {
          // R2 는 부가 경로다. 어떤 실패도 단발 스캔을 막지 않는다.
        }
        // R1 대신 (②): 시험판 fps 줄 — «초당 처리 프레임». R2 모드에선 누적 프레임이 곧 처리 프레임이다.
        noteFrameProcessed();
        /*
         * R1 대신 (②): 시험판 하단 패널의 **프레임 요약**. 갱신 호출이 R1 경로(decodeFrame·flushPriorReport)에만
         * 있어서, R2 위치에선 패널이 영원히 안 바뀌었다 — hud·qr 줄이 화면에 도달할 수 없었다 (§27.6 적대 검토).
         * geometry·cs 는 R1 복호의 산물이라 이 위치엔 **없다**: null 을 넘겨 «none / not-attempted» 로 정직하게
         * 비운다 (거짓 0 금지). 안정판에선 debugOverlay 가 no-op 라 이 줄 전체가 불활성이다.
         */
        updateDebugOverlay(r2Image, null, 'r2', { total: nowMs() - r2FrameStartedAt });
      }
    }

    /*
     * ── R1 단발 복호 ── 운영자 결정 ②: 스위치가 R2 위치면 돌지 않는다. **승격(2026-09-06) 뒤에는
     * 정식도 스위치를 갖는다** — 즉 정식에서도 이 블록은 「사용자가 R1 을 골랐을 때만」 돈다
     * (승격 전에는 `r2Available` 가 언제나 false 라 정식이 언제나 이 블록을 돌았다).
     * 그래서 이 안의 캐던스는 `r2Available` 로 한 겹 더 갈리고(아래), 유휴 창은 스위치가
     * **실재하는** 경우 — 승격 뒤로는 시험판·정식 둘 다 — 에 산다.
     * 게이트 줄 `if (!isDecoding && …)` 은 r2-scan-runtime.test ⓑ 가 R2 블록과의 순서를 찍는다.
     */
    if (!r2Runtime.enabled) {
      /*
       * 캐던스는 두 갈래다 — **스위치가 실재하는가**(`r2Available`)로 가른다.
       *
       *  (1) 스위치 실재 (r2Available true — 시험판, 그리고 **2026-09-06 승격 뒤의 정식**)
       *      = **완료 시각 기준 유휴 창**. `lastDecodeAt` 은 아래
       *      `.finally` 에서 복호가 끝난 시각으로 갱신되고, 여기서 그 뒤 `idleAfterDecodeMs` 만큼
       *      지나야 다음 grab 이 도래한다.
       *        거래: 사이클 cost → cost × 1.5, 즉 **처리율 ≈ −33 %**. 그 값으로 복호 사이에 cost/2 의
       *        유휴를 사서 입력·페인트·rAF 가 실제로 돈다 (옛 캐던스는 duty ≈ 99 % 라 유휴가 한 프레임).
       *        사는 것은 밀도가 아니라 **엔진 스위치·줌의 반응성** — 스위치가 없는 화면에서는 살 이유가
       *        없으므로 그 화면은 이 거래를 치르지 않는다. 승격(2026-09-06)은 정식에 스위치를 세웠고,
       *        그래서 **결정 ⑮(정식 R1 유휴 창)은 새 코드 없이 이 갈래를 타고 넘어간다** — 정식의
       *        R1 처리율도 그때부터 −33 % 다. R1_IDLE_FRACTION 의 근거·하한은 src/scanner-frame-rate.js 에.
       *  (2) 스위치 없음 (r2Available false) = 옛 **시작 시각 기준** 간격(`adaptiveFrameIntervalMs`).
       *      승격 뒤 이 갈래에 서는 화면은 없다 — 그러나 지우지 않는다: 승격 플래그를 되돌리면
       *      정식이 정확히 이 갈래로 돌아오고, 그 되돌림이 곧 결정 ①·⑮ 를 다시 여는 일이다.
       *      기준점은 아래 `.finally` 에서 `frameStartedAt` — 옛 코드의 rAF `timestamp` 자리이고
       *      차이는 콜백 진입\~grab 사이(1 ms 미만)뿐이다.
       *
       * ⚠ 파생 효과(시험판 한정, 미측정) — 1440 승격은 **벽시계** 주기다(ESCALATE_INTERVAL_MS 1600,
       *   프레임 수가 아니다). 승격이 **매 프레임** 걸리는 경계가 사이클 기준으로 내려온다:
       *   옛 캐던스(사이클 = cost)는 cost ≥ 1600 ms 부터, 유휴 창(사이클 = 1.5 × cost)은 cost ≥ 1067 ms
       *   부터다. 즉 실제로 승격 빈도가 바뀌는 대역은 **1.07\~1.6 s** 하나고, 1.6 s 이상은 옛 것도
       *   이미 매 프레임이었다. 그 대역에선 1440 비용이 얹혀 저하가 −33 % 를 넘고, 반대로 셀당 픽셀은
       *   늘어 성공률은 오를 수 있다. 어느 쪽인지는 합성 자로 못 잰다 — 실기 타이밍 통계(§27.5)에
       *   960/1440 비율 컬럼을 넣어 이 대역을 따로 봐라.
       * ⚠ `adaptiveFrameIntervalMs(lastFrameCostMs)` 를 그대로 감싼다 — 그것은 «하한 100 으로 묶은
       *   직전 비용» 이고, 유휴 창은 그 값을 R1_IDLE_FRACTION 으로 접은 것이다. 두 함수의 합성은
       *   `idleAfterDecodeMs(lastFrameCostMs)` 와 **모든 입력에서 같다**(scanner-frame-rate.test ⓒ 가
       *   격자로 잰다) — 감싸는 이유는 이 철자를 앵커로 찍는 두 자(qr-bridge.test ⓕ' 의 R1 위치
       *   앵커 · scanner-fpscap.test 의 «직전 전체 비용 소비») 를 살아 있게 두기 위해서다.
       * ⚠ 아래 게이트 리터럴은 r2-scan-runtime.test ⓑ · engine-switch.test ⓕ 가 indexOf 로 찍는다 —
       *   글자를 바꾸지 마라.
       */
      const intervalMs = r2Available
        ? idleAfterDecodeMs(adaptiveFrameIntervalMs(lastFrameCostMs))
        : adaptiveFrameIntervalMs(lastFrameCostMs);
      if (!isDecoding && timestamp - lastDecodeAt >= intervalMs) {
        const frameStartedAt = nowMs();
        const imageData = yieldForQr ? null : grabVideoFrame(frameStartedAt);

        if (imageData) {
          noteProductFrame();
          if (!firstGrabRendered) {
            firstGrabRendered = true;
            renderGuideDots();
          }
          isDecoding = true;

          /*
           * 안정 유지 판정 — 복호보다 **먼저** 한다. 복호는 수십 ms\~수 초 걸리므로 그 뒤에
           * 재면 프레임 사이 간격이 복호 시간에 오염된다(같은 뷰인데 「움직였다」 가 된다).
           * 서명 만들기는 stride 4 다운샘플이라 프레임 grab 비용에 묻힌다.
           */
          const steadyState = steady.observeFrame({ frame: imageData, timeMs: timestamp });
          renderSteadyMeter(steadyState);
          const usePrior = steadyState.trigger && !priorInFlight;
          if (usePrior) {
            steady.markTriggered(timestamp);
            priorInFlight = true;
            if (!statusOwnedBySteady) {
              statusOwnedBySteady = true;
              setStatus(t('status.steadyScan'));
            }
          }

          const attempt = lastFramePose
            ? attemptCarriedPoseScan(imageData, usePrior)
            : usePrior
              ? attemptGuidePriorScan(imageData)
              : decodeFrame(imageData);

          attempt
            .then((result) => {
              // 늦은 결과 문 (F2) — 스위치가 R2 로 넘어간 뒤 완주한 R1 복호는 결과도, 그 실패가 만드는 상태 문구도 버린다
              // (QR 콜백의 세션·토글 재확인과 같은 규약 · 규칙은 r2-confirmation-model.lateResultAdmitted). R1 위치에서는
              // «세션이 같으면 통과» 로 환원된다 — 그 경로의 제어 흐름은 승격 전과 같다. finally 는 그대로 비용 회계를 닫는다.
              if (!lateResultAdmitted('r1', { sameSession: session === scanSession, r2Enabled: r2Runtime.enabled })) return;
              result = attachCornerQrScanAssist(result, imageData);
              if (session === scanSession) rememberFramePose(result, imageData);
              if (usePrior && !result.ok && session === scanSession && statusOwnedBySteady) {
                // 사전이 실패하면 원래 조준 안내로 되돌린다 — 「시도 중」 이 눌러앉으면
                // 사용자는 무엇을 바꿔야 할지 모른 채 기다리게 된다.
                statusOwnedBySteady = false;
                setStatus(t('status.aim'));
              }
              handleDecodeResult(result, 'camera', session);
            })
            .catch(() => {
              // 같은 늦은 결과 문 — R2 위치에서 완주한 R1 의 예외로 R2 세션의 카메라를 끄면 안 된다.
              // ⚠ R1 위치에서도 한 가지는 바뀐다: 옛 세션의 늦은 예외가 «새» 카메라를 끄던 잠재 결함이 같은 문에 막힌다 — 의도된 변경(PM/029B §27.9).
              if (!lateResultAdmitted('r1', { sameSession: session === scanSession, r2Enabled: r2Runtime.enabled })) return;
              lastFramePose = null;
              finishProductScanFail('decoder-error');
              stopCamera();
              setStatus(t('status.frameError'));
              showSupportedStartGate(t('status.restart'));
            })
            .finally(() => {
              if (usePrior) priorInFlight = false;
              if (session === scanSession) {
                lastFrameCostMs = Math.max(0, nowMs() - frameStartedAt);
                // ⚠ 캐던스 기준점 — 위 `intervalMs` 의 두 갈래와 **짝**이다. 스위치가 실재하면(r2Available,
                // 승격 뒤로는 정식 포함) 복호 **완료** 시각(시작 + 실측 비용): 간격이 유휴 창이 되려면
                // 기준이 완료여야 한다. 스위치가 없으면 옛 **시작** 시각 그대로 — 간격 == 비용이라 복호가
                // 끝나는 순간 다음 grab 이 이미 도래한다(duty ≈ 99 %).
                // 값은 시계를 한 번 더 읽지 않고 시작(+ 실측 비용)으로 잡는다 — 위 두 줄과 어긋날 수 없다.
                // (rAF `timestamp` 와 `nowMs()` 는 같은 performance.now() 원점이라 비교가 성립한다.
                //  옛 코드의 `= timestamp` 대신 `frameStartedAt` 을 쓰는 것이 R1 위치의 유일한 차이 —
                //  같은 콜백 안 grab 직전의 시계라 차이는 1 ms 미만이다.)
                lastDecodeAt = r2Available ? frameStartedAt + lastFrameCostMs : frameStartedAt;
                isDecoding = false;
              }
              noteFrameProcessed();
            });
        }
      }
    }

    animationFrameId = requestAnimationFrame(nextFrame);
  };

  animationFrameId = requestAnimationFrame(nextFrame);
}

async function startCamera(options) {
  const settings = options || {};
  const automatic = Boolean(settings.automatic);
  const deviceId = settings.deviceId || selectedCameraId;

  /*
   * 센서 부착은 **모든 시작 경로**에 걸린다 (자동 시작 · 시작 버튼 · 재스캔 · 렌즈 변경).
   * 여기 두는 이유: 스캔 시작점이 하나로 모이는 자리이고, `await` **이전**이라 제스처
   * 경로에서는 아직 사용자 제스처 안이다(iOS `requestPermission()` 요건).
   * `automatic` 은 「제스처 없이 열린 경로」 와 동의어다 — 그 경우 판정이 지연 부착으로 간다.
   */
  void attachMotionAssist({ userGesture: !automatic });

  if (!isSecureForCamera()) {
    setStatus(t('status.noHttps'));
    showSupportedStartGate();
    return;
  }

  if (!hasCameraApi()) {
    setStatus(t('status.unsupported'));
    showSupportedStartGate();
    return;
  }

  if (cameraStream || cameraRequestPending) return;

  const session = ++scanSession;
  resetFrameSeq();
  beginScanAttempt('camera');
  cameraRequestPending = true;
  setStatus(t('status.starting'));

  if (!automatic) {
    hideCameraGate();
  }

  try {
    const stream = await requestCameraStream(deviceId);

    if (session !== scanSession) {
      stopTracks(stream);
      return;
    }

    cameraStream = stream;
    hadCameraThisSession = true;
    watchCameraTrackEnds(stream, session);
    selectedCameraId = activeDeviceIdOf(stream) || deviceId || '';
    tryContinuousFocus(stream);
    zoomCapability = readTrackCapability(activeVideoTrack());
    userZoom = snapZoom(DEFAULT_USER_ZOOM, zoomRangeFor(zoomCapability));
    zoomPlan = resolveZoomPlan({ userZoom, capability: zoomCapability });
    revealZoomControls();
    syncPreviewTransform();
    void commitUserZoom();
    // 권한 부여 뒤에야 label 이 채워지므로 여기서 렌즈 목록을 갱신한다.
    refreshCameraChoices().catch(() => {});
    cameraVideo.srcObject = stream;
    await waitForVideoMetadata(cameraVideo);
    await cameraVideo.play();

    if (session !== scanSession) {
      stopCamera();
      return;
    }

    if (currentCameraLiveness() !== 'live') {
      throw new Error('camera-stream-ended-before-start');
    }

    cameraRequestPending = false;
    setCameraStageActive(true);
    renderGuideDots();
    hideCameraGate();
    setStatus(t('status.aim'));
    sendLabEnvOnce(stream);
    startFrameLoop(session);
    earnFreshResumeAttempt(session);
  } catch (error) {
    if (session !== scanSession) return;

    sendLabEnvOnce(null);
    finishProductScanFail(cameraStartReason(error));
    stopCamera();

    if (automatic) {
      setStatus(t('status.tapToStart'));
      showSupportedStartGate();
      return;
    }

    const problem = cameraFailure(error);
    setStatus(problem.message);
    showCameraGate({
      title: problem.title,
      message: problem.message,
      startLabel: t('gate.retry'),
    });
  } finally {
    if (session === scanSession) {
      cameraRequestPending = false;
    }
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    const cleanup = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('image-load-failed'));
    };
    image.decoding = 'async';
    image.src = objectUrl;
  });
}

async function decodeImageFile(file) {
  if (!file) return;

  finishProductScanFail('source-changed');
  stopCamera();
  hideCameraGate();
  hideResult({ restoreFocus: false });

  const session = ++scanSession;
  resetFrameSeq();
  beginScanAttempt('file');
  sendLabEnvOnce(null);
  setStatus(t('status.checkingPhoto'));

  try {
    const image = await loadImage(file);
    const imageData = imageDataWhole(image, image.naturalWidth, image.naturalHeight);
    if (!imageData) throw new Error('image-data-unavailable');

    noteProductFrame();
    // 업로드는 프레임이 한 장뿐이다 — 스로틀할 다음 프레임이 없으므로 실패하면
    // 항상 daehan 2차 패스를 돈다 (`source: 'still'`).
    const result = await decodeFrame(imageData, { source: 'still' });
    handleDecodeResult(result, 'file', session);
  } catch {
    if (session === scanSession) {
      finishProductScanFail('file-read-error');
      setStatus(t('status.photoUnreadable'));
      showScanToast(t('toast.photoUnreadable'));
      showSupportedStartGate(t('status.startOrPick'));
    }
  } finally {
    imageInput.value = '';
  }
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function safeHttpUrl(value) {
  const text = stringValue(value);
  if (text === '') return '';

  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    // 안전한 HTTP(S) URL이 아니면 일반 텍스트로 표시합니다.
  }
  return '';
}

function setResultTitle(title) {
  resultTitle.textContent = title;
}

function addResultIntro(text) {
  const intro = document.createElement('p');
  intro.className = 'result-intro';
  intro.textContent = text;
  resultContent.append(intro);
}

function copyWithFallback(value) {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.append(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();
  return copied;
}

async function copyValue(value, label, button) {
  let copied = false;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    copied = copyWithFallback(value);
  }

  if (!copied) {
    setStatus(label + t('copy.failSuffix'));
    return;
  }

  setStatus(label + t('copy.doneSuffix'));
  if (!button) return;

  const originalLabel = button.textContent;
  button.textContent = t('copy.done');
  window.setTimeout(() => {
    button.textContent = originalLabel;
  }, 1600);
}

function createCopyButton(value, label) {
  const button = document.createElement('button');
  button.className = 'copy-button';
  button.type = 'button';
  button.textContent = t('copy.button');
  button.setAttribute('aria-label', label + t('copy.suffix'));
  button.addEventListener('click', () => {
    void copyValue(value, label, button);
  });
  return button;
}

function addPayloadField(label, value, options) {
  const settings = options || {};
  const field = document.createElement('section');
  const header = document.createElement('div');
  const labelElement = document.createElement('span');
  const valueElement = settings.href ? document.createElement('a') : document.createElement('div');
  const visibleValue = value === '' ? t('value.none') : value;
  const copyValueText = settings.copyValue === undefined ? visibleValue : settings.copyValue;

  field.className = 'payload-field';
  header.className = 'payload-field-header';
  labelElement.className = 'payload-label';
  valueElement.className = 'payload-value';

  labelElement.textContent = label;
  valueElement.textContent = visibleValue;

  if (settings.href) {
    valueElement.href = settings.href;
    if (settings.external) {
      valueElement.target = '_blank';
      valueElement.rel = 'noopener noreferrer';
    }
  }

  header.append(labelElement, createCopyButton(copyValueText, label));
  field.append(header, valueElement);
  resultContent.append(field);
}

function renderTextPayload(payload) {
  setResultTitle(t('result.text.title'));
  addResultIntro(t('result.text.hint'));

  const text = document.createElement('pre');
  text.className = 'text-payload';
  text.textContent = payload;
  resultContent.append(text, createCopyButton(payload, t('result.text.field')));
}

function tryOpenUrl(url) {
  try {
    return window.open(url, '_blank', 'noopener') !== null;
  } catch {
    return false;
  }
}

function renderUrlPayload(payload, autoOpen = true) {
  const url = payload.trim();
  // autoOpen=false(일반 QR): 열지 않고 링크·«열기» 버튼만 보인다. 사용자가 URL 을 보고 누른다.
  const opened = autoOpen ? tryOpenUrl(url) : false;
  activeUrl = url;
  openUrlLink.href = url;
  popupFallback.hidden = opened;
  // 자동으로 열지 않은 결과엔 «열지 못했어요» 가 거짓이다 — 버튼만 남기고 문단은 숨긴다.
  if (popupBlockedNote) popupBlockedNote.hidden = !autoOpen;

  setResultTitle(t('result.url.title'));
  if (opened) addResultIntro(t('result.url.opened'));
  else if (autoOpen) addResultIntro(t('result.url.manual'));
  else addResultIntro(t('result.url.qrManual'));

  const link = document.createElement('a');
  link.className = 'payload-url';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = url;
  resultContent.append(link, createCopyButton(url, t('result.url.field')));
}

function renderWifiPayload(data) {
  const wifi = data || {};
  const ssid = stringValue(wifi.s);
  const password = stringValue(wifi.p);
  const security = wifi.e === 'WEP' ? 'WEP' : 'WPA';

  setResultTitle(t('result.wifi.title'));
  addResultIntro(t('result.wifi.hint'));
  addPayloadField('SSID', ssid, { copyValue: ssid || t('value.none') });
  addPayloadField(t('result.wifi.security'), security);
  addPayloadField(t('result.wifi.password'), password, { copyValue: password || t('value.none') });
}

function renderCardPayload(data) {
  const card = data || {};
  const name = stringValue(card.n);
  const organization = stringValue(card.org);
  const telephone = stringValue(card.tel);
  const email = stringValue(card.em);
  const website = stringValue(card.u);
  const safeWebsite = safeHttpUrl(website);

  setResultTitle(t('result.card.title'));
  addResultIntro(t('result.card.hint'));
  addPayloadField(t('result.card.name'), name, { copyValue: name || t('value.none') });

  if (organization !== '') {
    addPayloadField(t('result.card.org'), organization);
  }
  if (telephone !== '') {
    addPayloadField(t('result.card.phone'), telephone, { href: 'tel:' + telephone });
  }
  if (email !== '') {
    addPayloadField(t('result.card.email'), email, { href: 'mailto:' + email });
  }
  if (website !== '') {
    addPayloadField(t('result.card.site'), website, {
      href: safeWebsite || undefined,
      external: Boolean(safeWebsite),
    });
  }
}

function showResult(payload, options) {
  const settings = options || {};
  // 언어 전환 시 이 패널을 같은 내용으로 다시 그리기 위해 보관한다 (옵션도 같이 — 재렌더에서
  // URL 을 또 열면 안 된다).
  lastResult = payload;
  lastResultOptions = settings;
  const autoOpen = settings.autoOpen !== false;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  activeUrl = '';
  popupFallback.hidden = true;
  openUrlLink.href = '#';
  resultContent.replaceChildren();
  // R2 확정 요약 (F8) — R2 출처 결과에만 채워지고 그 외엔 숨긴 채다. 언어 전환 재렌더도 이 경로라 r2.state 라벨이 같이 바뀐다.
  renderResultR2Summary(settings.r2Summary || null);

  let sniffed = { kind: 'text' };
  try {
    sniffed = sniffPayload(payload);
  } catch {
    sniffed = { kind: 'text' };
  }

  if (sniffed.kind === 'url') {
    renderUrlPayload(payload, autoOpen);
  } else if (sniffed.kind === 'wifi') {
    renderWifiPayload(sniffed.data);
  } else if (sniffed.kind === 'card') {
    renderCardPayload(sniffed.data);
  } else {
    renderTextPayload(payload);
  }

  resultPanel.hidden = false;
  window.requestAnimationFrame(() => resultPanel.focus({ preventScroll: true }));
}

function hideResult(options) {
  const settings = options || {};
  resultPanel.hidden = true;
  popupFallback.hidden = true;
  activeUrl = '';
  openUrlLink.href = '#';
  resultContent.replaceChildren();
  renderResultR2Summary(null);

  if (settings.restoreFocus !== false && returnFocus && document.contains(returnFocus)) {
    returnFocus.focus({ preventScroll: true });
  }
  returnFocus = null;
}

function closeResult() {
  hideResult();
  setStatus(t('status.tapToContinue'));
  showSupportedStartGate(t('status.startOrPhoto'));
}

function openImagePicker() {
  imageInput.click();
}

function currentCameraLiveness() {
  const stream = cameraStream;
  const tracks = stream && typeof stream.getVideoTracks === 'function'
    ? stream.getVideoTracks()
    : [];

  return cameraLiveness({
    hasStream: Boolean(stream),
    videoTrackStates: tracks.map((track) => track.readyState),
    srcObjectMatches: cameraVideo.srcObject === stream,
    videoEnded: cameraVideo.ended,
  });
}

function stopCameraForLifecycle() {
  resumeAttemptsThisTransition = 0;
  if (!cameraStream && !cameraRequestPending) return;

  /*
   * ⑯(i) — 유예 중의 정지는 «가시성» 이 아니라 «수용 확정» 이다. 승격 전에는 수용 즉시 카메라가
   * 꺼져 이 함수의 첫 줄에서 되돌아갔고, 그래서 `stoppedForVisibility` 가 설 수 없었다. 유예가
   * 그 조합을 실재하게 만든다 — 플래그를 세우면 복귀 때 `resumeAction` 이 'restart' 를 돌려
   * **결과 시트가 열린 채 카메라가 다시 켜진다**(그 프레임 루프가 두 번째 적중으로 읽은 답을 덮을 수도
   * 있다). 그래서 여기서는 플래그 없이 정지만 한다 — `stopCamera` 가 gate 를 회수해 결과를 확정한다.
   */
  if (acceptStopGate.isPending()) {
    stopCamera();
    return;
  }

  stoppedForVisibility = true;
  finishProductScanFail('page-hidden');
  stopCamera();
}

async function recoverCameraAfterResume() {
  if (document.visibilityState === 'hidden' || cameraRequestPending) return;

  const liveness = currentCameraLiveness();
  // 스트림을 결과 표시·사진 선택 등 다른 의도적 경로에서 끈 경우는 복귀 대상이 아니다.
  // pagehide/hidden에서 끈 absent 상태만 stoppedForVisibility로 구분한다.
  if (liveness === 'absent' && !stoppedForVisibility) return;

  const action = resumeAction({
    liveness,
    hadCameraThisSession,
    stoppedForVisibility,
    attemptsThisTransition: resumeAttemptsThisTransition,
    secure: isSecureForCamera(),
    hasApi: hasCameraApi(),
  });

  if (action === 'none') {
    stoppedForVisibility = false;
    return;
  }

  if (action === 'gate') {
    stoppedForVisibility = false;
    if (liveness === 'dead') {
      finishProductScanFail('camera-ended');
      stopCamera();
    }
    setStatus(t('status.hiddenStopped'));

    if (!isSecureForCamera() || !hasCameraApi()) {
      showSupportedStartGate();
    } else {
      showCameraGate({
        message: t('status.hiddenRestart'),
        startLabel: t('gate.retry'),
      });
    }
    return;
  }

  resumeAttemptsThisTransition += 1;
  stoppedForVisibility = false;
  if (liveness === 'dead') {
    finishProductScanFail('camera-ended');
    stopCamera();
  }
  showPreparingCameraGate();
  setStatus(t('status.preparing'));
  await startCamera({ automatic: true });
}

async function initialiseCamera() {
  if (!isSecureForCamera()) {
    setStatus(t('gate.https.message'));
    showSupportedStartGate();
    return;
  }

  if (!hasCameraApi()) {
    setStatus(t('gate.unsupported.message'));
    showSupportedStartGate();
    return;
  }

  showPreparingCameraGate();
  setStatus(t('status.preparing'));

  // 권한 상태를 **먼저 조회해서** 자동 시작 여부를 정하지 않는다.
  //
  // ⚠ Safari 계열은 `permissions.query({name:'camera'})` 를 지원하지 않아 throw 한다.
  //    조회 결과에 자동 시작을 걸어 두면 그 브라우저에서는 **권한을 이미 허용했어도
  //    매번 탭을 요구**하게 된다 — 스캐너의 주 사용처가 아이폰인 걸 감안하면
  //    "접속 즉시 켜짐" 요구가 가장 중요한 기기에서 깨진다.
  //
  // 그래서 순서를 뒤집는다: **일단 시도하고, 실패하면 게이트로 강등**한다.
  //   · 이미 허용돼 있으면 제스처 없이 그대로 열린다 (모든 브라우저 공통).
  //   · 미결정이면 네이티브 권한 프롬프트가 뜬다 — 스캐너 페이지에선 그게 맞는 동선이다.
  //   · 거부됐거나 제스처를 요구하는 브라우저면 reject 되고, catch 에서 게이트를 세운다.
  // 권한 조회는 자동 시작의 **조건이 아니라 문구를 고르는 용도**로만 남긴다.

  let knownState = '';
  if (navigator.permissions && typeof navigator.permissions.query === 'function') {
    try {
      knownState = (await navigator.permissions.query({ name: 'camera' })).state;
    } catch {
      // Safari 등 — 알 수 없음. 아래 시도가 판정한다.
    }
  }

  if (knownState === 'denied') {
    setStatus(t('gate.denied.message'));
    showCameraGate({
      title: t('gate.off.title'),
      message: t('gate.off.message'),
      startLabel: t('gate.retry'),
    });
    sendLabEnvOnce(null);
    return;
  }

  // startCamera 는 실패를 스스로 처리한다 — 재던지지 않고, automatic 실패 시
  // showSupportedStartGate() 로 탭-투-시작 게이트를 세운다. 그래서 여기서 catch 하지
  // 않는다(잡을 것이 없다). 그 계약이 깨지면 이 자동 시작 경로가 조용히 무응답이 된다.
  await startCamera({ automatic: true });
}

/**
 * DeviceMotion 보조 신호 연결.
 *
 * ⚠ **정정 (2026-08-16 적대 검증 F2):** 이전 배선은 이 함수를 **스캔 시작 버튼 클릭
 *    한 곳**에서만 불렀다. 그런데 이 스캐너의 주 동선은 「카메라 권한이 이미 허용된
 *    아이폰 → 접속 → `initialiseCamera()` → `startCamera({automatic:true})`」 라 그 버튼을
 *    아예 거치지 않는다. 즉 센서가 가장 중요한 기기에서 **영원히 off** 였고, 게이트가
 *    떠서 사용자가 버튼을 누른 «실패 경로» 에서만 켜졌다. 문서는 그걸 모른 채
 *    `sensor:on` 을 정상 상태로 서술했다.
 *
 * 그래서 부착 시도를 **모든 시작 경로**(자동 시작 · 시작 버튼 · 재스캔 · 렌즈 변경)에
 * 건다. 경로마다 제스처 유무가 다르므로 판정은 순수 함수 `motionAttachPlan()` 이 한다:
 *
 *   · `no-gate`(Android Chrome 등)     → 로드/자동 시작 시점에 **즉시** 부착.
 *   · `gesture-required`(iOS) + 제스처  → 그 자리에서 `requestPermission()`.
 *   · `gesture-required` + 제스처 없음  → **지연 부착**. 제스처 밖에서 부르면 권한만
 *     소진되므로, 다음 아무 제스처(pointerdown/keydown)에 한 번 붙는다.
 *   · `unsupported`                     → 시각 단독. 정상 경로다.
 *
 * 거부·미지원·예외는 전부 무시한다. 센서가 없으면 `observeMotion` 이 한 번도 안 불리고,
 * 추적기의 거부권은 발동 자체를 못 하므로 **시각 단독 동작과 완전히 같다** (기능 저하 0).
 * 실패는 오류가 아니라 정상 갈래라 사용자에게 보여줄 것이 없다 — 대신 상태 문자열을
 * lab 오버레이에 그대로 찍어 «지금 켜져 있나» 를 화면이 말하게 한다.
 */
function bindMotionListener(state) {
  motionAttachState = state;
  if (motionListenerAttached) return;
  motionListenerAttached = true;
  window.addEventListener('devicemotion', (event) => {
    if (!cameraStream) return;
    steady.observeMotion({
      rotationRate: event.rotationRate,
      acceleration: event.acceleration,
      accelerationIncludingGravity: event.accelerationIncludingGravity,
      timeMs: nowMs(),
    });
  }, { passive: true });
}

/**
 * 다음 제스처 한 번에 부착을 재시도하도록 예약한다 (iOS 자동 시작 경로).
 *
 * **아무 탭이 아니라 «컨트롤 조작»에만** 건다. 빈 화면을 스치듯 누른 것에까지 권한
 * 프롬프트를 띄우면, 사용자는 자기가 요청하지 않은 대화상자를 보게 된다 — 조준 중에
 * 그 팝업이 뜨는 것이 센서 보조로 얻는 것보다 나쁘다. 버튼·선택기·링크는 «지금 이
 * 화면을 조작하고 있다» 는 분명한 신호라 그때 물어보는 것이 자연스럽다.
 */
const MOTION_GESTURE_SELECTOR = 'button, select, input, a, [role="button"]';
function armMotionGestureRetry() {
  if (motionGestureArmed || motionListenerAttached) return;
  motionGestureArmed = true;
  const disarm = () => {
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    motionGestureArmed = false;
  };
  const onGesture = (event) => {
    const target = event.target;
    if (event.type === 'pointerdown'
      && !(target && typeof target.closest === 'function'
        && target.closest(MOTION_GESTURE_SELECTOR))) {
      return;
    }
    disarm();
    void attachMotionAssist({ userGesture: true });
  };
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
}

async function attachMotionAssist(options = {}) {
  if (motionListenerAttached) return;
  // ⚠ in-flight 가드. 예전에는 `motionListenerAttached = true` 가 **await 뒤**라
  //    시작 버튼을 연타하면 devicemotion 리스너가 두 개 붙었다(카운터 부풀림·중복 계산).
  if (motionRequestInFlight) return;

  const plan = motionAttachPlan({ scope: window, userGesture: Boolean(options.userGesture) });
  if (plan.action === 'skip') {
    motionAttachState = 'off:unsupported';
    return;
  }
  if (plan.action === 'defer') {
    motionAttachState = 'off:wait-gesture';
    armMotionGestureRetry();
    return;
  }

  motionRequestInFlight = true;
  try {
    const permission = await requestMotionPermission(window);
    if (!permission.granted) {
      motionAttachState = 'off:' + permission.reason;
      return;
    }
    bindMotionListener('on:' + plan.gate);
  } finally {
    motionRequestInFlight = false;
  }
}

startCameraButton.addEventListener('click', () => {
  // 제스처 안에서 먼저 부른다 — await 뒤로 미루면 iOS 가 제스처를 잃는다.
  void attachMotionAssist({ userGesture: true });
  void startCamera({ automatic: false });
});
chooseImageButton.addEventListener('click', openImagePicker);

// 렌즈를 바꾸면 스트림을 다시 연다 — 같은 스트림에 deviceId 를 적용할 수는 없다.
const cameraPicker = document.getElementById('camera-picker');
if (cameraPicker) {
  cameraPicker.addEventListener('change', () => {
    // 렌즈 변경도 사용자 제스처다 — 자동 시작으로 지연됐던 센서를 여기서 붙일 수 있다.
    void attachMotionAssist({ userGesture: true });
    selectedCameraId = cameraPicker.value || '';
    finishProductScanFail('camera-restarted');
    stopCamera();
    startCamera({ deviceId: selectedCameraId }).catch(() => {});
  });
}

zoomSlider.addEventListener('input', () => {
  scheduleUserZoom(Number(zoomSlider.value), false);
});
zoomSlider.addEventListener('change', () => {
  scheduleUserZoom(Number(zoomSlider.value), true);
});
zoomOutButton.addEventListener('click', () => {
  scheduleUserZoom(userZoom - buttonStep(zoomCapability), true);
});
zoomInButton.addEventListener('click', () => {
  scheduleUserZoom(userZoom + buttonStep(zoomCapability), true);
});

// 빌드 식별자 — 실기기 피드백에서 어느 배포본인지 바로 알기 위한 것.
const buildTag = document.getElementById('build-tag');
if (buildTag) buildTag.textContent = SCANNER_BUILD;

// 초기 언어 적용 — DOM 의 `data-i18n` 을 채우고 <html lang> 을 맞춘다.
document.documentElement.setAttribute('lang', i18n.lang);
i18n.apply();
wireLanguageSwitch(document.getElementById('lang-switch'), i18n);
refreshScanGuideCopy();
// BarcodeDetector 판정은 비동기다 — 끝나면 범위 문구를 3상태로 다시 그린다 (§26). R2 가용일 때만:
// R2 가 닫힌 화면(승격 되돌림)은 QR 을 안 돌리므로 검출기를 만드는 것조차 «불변» 위반이다.
// 승격(2026-09-06) 뒤 정식은 가용이므로 정식에서도 QR 브리지가 돈다.
if (r2Available) void qrBridge.probe().then(() => refreshScanGuideCopy());

/*
 * 사용 이벤트 비콘. 페이로드 **내용은 절대 담지 않는다** — 종류(url/text/wifi/card)와
 * 성공 여부 같은 메타만 보낸다. 오프라인이면 큐에 쌓였다가 온라인 복귀 때 흘러간다.
 */
const beacon = createBeacon('scan', { build: SCANNER_BUILD });
beacon('pageview');

/*
 * 서비스 워커 등록 — PWA 설치 요건(manifest + HTTPS + fetch 핸들러 워커) 중 마지막 조각.
 *
 * 실패는 전부 삼킨다. dev 서버에는 `/sw.js` alias 가 없어 404 가 나고, 비보안 컨텍스트나
 * 미지원 브라우저도 있다 — 설치 가능 여부는 부가 기능이지 스캐너 동작 조건이 아니다.
 */
if (!isLabPath()) {
  startPwaUpdateWatch({ text: t('update.ready'), applyText: t('update.apply') });
}

const labNotice = document.getElementById('lab-notice');
if (labNotice && isLabPath()) labNotice.hidden = false;

let expectedLocatorLayout = null;
const expectedLayoutRoot = document.getElementById('lab-expected-arm');
if (expectedLayoutRoot && isLabPath()) {
  for (const button of expectedLayoutRoot.querySelectorAll('[data-expected-layout]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.expectedLayout;
      // 라인업(2026-08-17 v0T 편입·v0W 계열 전체 드랍까지): v0 = Y0 ·
      // v0t = **Y1 기본** · v0ty = v0T 파생(먼 코너 QR 슬롯) ·
      // **v0tr · v0trq (2026-08-17 v0TR 계열 편입)** — v0T 재설계와 그 중앙 QR 파생.
      // **v0try (2026-08-18)** — v0TR 의 먼 코너 QR 파생 (v0TY 와 같은 슬롯 규약).
      // v2r2 · v1r2 (2026-08-16) · v0xq · v0x · **v0w · v0wq · v0w2 · v0wy
      // (2026-08-17)** 는 검출 라인업에서 내려갔으므로 «기대» 로도 못 고른다 —
      // 저장·URL 등으로 옛 값이 들어와도 여기서 null(모름)로 떨어진다.
      // 값은 레이아웃 id(소문자)와 같아야 한다 — 디코더가
      // hypothesis.cellSurfaceLayout 으로 돌려주는 문자열이 그것이다 (표시만 v0T).
      expectedLocatorLayout = next === 'v0'
        || next === 'v0t' || next === 'v0ty'
        || next === 'v0tr' || next === 'v0trq' || next === 'v0try'
        ? next
        : null;
      for (const other of expectedLayoutRoot.querySelectorAll('[data-expected-layout]')) {
        other.classList.toggle('active', other === button);
      }
    });
  }
}

/*
 * 축 ② 중앙 파인더 · 축 ③ 외곽 파인더 (2026-08-19, 운영자 지시).
 *
 * 위 「기대 레이아웃」과 **독립된 축**이다. 한 축에 몰아넣으면 「무엇이 안 잡혔는가」를
 * 못 가른다 — 그게 이번 라운드 신고의 핵심이었다 («신규 3개 셀 표면 파인더 전부 인식
 * 안 됨» 을 고를 자리가 없었고, 그래서 아무도 그 신고를 계측으로 확인하지 못했다).
 *
 * 유효 값 판정은 `src/lab-expected-axes.js` 가 갖는다 — 검출 라인업에서 유도되므로
 * 라인업이 바뀌면 여기 손 안 대고 따라간다. 라인업 밖 값(저장·URL 등으로 들어온 옛 값
 * 포함)은 null(모름)로 떨어진다. 레이아웃 카드와 같은 배선이다.
 */
let expectedCentralFinder = null;
const expectedFinderRoot = document.getElementById('lab-expected-finder');
if (expectedFinderRoot && isLabPath()) {
  for (const button of expectedFinderRoot.querySelectorAll('[data-expected-finder]')) {
    button.addEventListener('click', () => {
      expectedCentralFinder = normalizeCentralFinderId(button.dataset.expectedFinder);
      for (const other of expectedFinderRoot.querySelectorAll('[data-expected-finder]')) {
        other.classList.toggle('active', other === button);
      }
    });
  }
}

let expectedOuterFinder = null;
const expectedOuterRoot = document.getElementById('lab-expected-outer');
if (expectedOuterRoot && isLabPath()) {
  for (const button of expectedOuterRoot.querySelectorAll('[data-expected-outer]')) {
    button.addEventListener('click', () => {
      expectedOuterFinder = normalizeOuterFinderId(button.dataset.expectedOuter);
      for (const other of expectedOuterRoot.querySelectorAll('[data-expected-outer]')) {
        other.classList.toggle('active', other === button);
      }
    });
  }
}

// 축 ④ 중앙 강조 변이 (2026-08-29) — 파인더/외곽 카드와 같은 배선. 정본 판정은
// src/lab-expected-axes.js(normalizeExpectedEmphasis, centralN7Emphasis.js 에서 유도).
// 라인업 밖 값은 null(모름)로 떨어진다.
let expectedEmphasis = null;
const expectedEmphasisRoot = document.getElementById('lab-expected-emphasis');
if (expectedEmphasisRoot && isLabPath()) {
  for (const button of expectedEmphasisRoot.querySelectorAll('[data-expected-emphasis]')) {
    button.addEventListener('click', () => {
      expectedEmphasis = normalizeExpectedEmphasis(button.dataset.expectedEmphasis);
      for (const other of expectedEmphasisRoot.querySelectorAll('[data-expected-emphasis]')) {
        other.classList.toggle('active', other === button);
      }
    });
  }
}

// daehan 파인더 **1차 패스 강제** (2026-08-18 도입, 2026-08-30 의미 갱신)
// — 시험판 전용 즉석 토글.
//
// ⚠ 이 토글은 더 이상 «정식 스캐너가 daehan 을 읽는 유일한 길» 이 아니다.
//    정식 기본 동작은 decodeFrame 의 **폴백 2차 패스**이고(실패한 프레임에만),
//    이 토글은 그와 직교인 «1차 패스부터 daehan 을 얹는다(강제)» 다. 켜져 있으면
//    폴백은 안 돈다 — 1차가 이미 daehan 이라 2차가 정의상 같은 결과를 낸다.
//
// 왜 토글이 필요한가: daehan 은 «기본 라인업에 올리면 셀 24px 부근에서 레거시
// 5칸을 가져간다» 는 실측 때문에 옵트인으로 들어왔다. 그 판정을 뒤집으려면
// **실기기에서 켜 보는 수밖에 없다** — 합성 프레임만으로는 실제 촬영 배율 분포를
// 모른다. 코드에만 있는 플래그는 실기기 판정을 못 만든다. 폴백이 붙은 뒤에도
// 이 토글은 «1차 패스에 얹었을 때의 비용·오수용» 을 재는 자로 남는다.
//
// localStorage 에 남기는 이유: 실기기 비교 측정은 앱을 껐다 켜며 하게 되는데,
// 매번 다시 눌러야 하면 «껐다고 생각했는데 켜져 있던» 프레임이 섞인다.
const DAEHAN_TOGGLE_KEY = 'tlscan.lab.daehanFinder';
let cellFinderDaehan = false;
try {
  cellFinderDaehan = isLabPath() && window.localStorage.getItem(DAEHAN_TOGGLE_KEY) === '1';
} catch { /* 저장소 접근 불가(사생활 모드 등)는 스캔을 막지 않는다 — 기본 꺼짐 */ }
const daehanToggle = document.getElementById('lab-daehan-toggle');
if (daehanToggle && isLabPath()) {
  daehanToggle.hidden = false;
  const paint = () => {
    daehanToggle.setAttribute('aria-pressed', String(cellFinderDaehan));
    daehanToggle.classList.toggle('active', cellFinderDaehan);
  };
  paint();
  daehanToggle.addEventListener('click', () => {
    cellFinderDaehan = !cellFinderDaehan;
    try { window.localStorage.setItem(DAEHAN_TOGGLE_KEY, cellFinderDaehan ? '1' : '0'); }
    catch { /* 저장 실패해도 이번 세션엔 적용된다 */ }
    paint();
  });
}

/*
 * R1/R2 토글 (2026-09-04, 운영자 요구). **기본 켬**, 그리고 **2026-09-06 승격**(결정 ①) 뒤로는
 * 시험판 전용이 아니다 — 정식(/)에도 스위치가 뜨고 저장값 없는 첫 방문의 기본 위치가 R2 다.
 *
 * 왜 있나: ① 「R2 가 R1 을 완전대체 가능할거라고 생각하지 않기 때문에」 —
 * 실제로 실기 1차에서 **Y0 은 R1 이 더 빠르고 Y1·Y2 는 R2 가 훨씬 빠르다**는
 * 관측이 나왔다 (PM/029B §25.1). ② 같은 코드로 A/B 하려면 앱을 다시 띄우지 않고
 * 전환돼야 한다.
 *
 * ⚠ 끄면 런타임이 후보 세션을 **버린다** — 껐다 켰을 때 옛 누적이 살아 있으면
 * 「껐다고 생각했는데 그때 모은 증거로 풀린」 프레임이 섞여 A/B 가 오염된다.
 */
/*
 * R2 좌 패널 — 점진 확정 칩 + 진행 인디케이터 (PM/029 §17 · PM/029B §27.4 2b).
 * 표시 게이트는 `r2Available` 하나다 — **2026-09-06 승격** 뒤로는 시험판·정식 양쪽에서 그려진다.
 *
 * 칩 네 행(타입 · 버전 · 레이아웃 · 진행)의 **규칙은 `src/r2-confirmation-model.js` 에만** 있다 —
 * 여기는 행 배열을 받아 DOM 에 옮기고 색·라벨을 붙인다. 운영자 결정 ⑦(표기 «Type Y» → «Y2 (n25)») ·
 * ⑧(확정 = 락 시점, 레이아웃 변종은 DONE 까지 변동, DONE 의 변종이 직전 선두와 다르면 «정정»)은
 * 모델의 state 와 아래 «정정 효과» 로 나타난다.
 *
 * 표시 후퇴 금지(A6): D 가 내려가도 막대 폭을 줄이지 않는다 — 사용자에게 「되돌아갔다」는
 * 신호는 조준을 망친다. 드랍(후보 폐기)일 때만 0 으로 되돌린다.
 * 값은 기기 안 로컬 계산이고 전송 경로가 없다 (안정 게이지와 같은 규약).
 *
 * DOM 은 값이 달라졌을 때만 만진다 — 매 프레임 textContent 를 다시 쓰면 레이아웃이 매 틱 흔들린다.
 */
const r2ProgressRoot = document.getElementById("r2-progress");
const r2ProgressRows = document.getElementById("r2-rows");
const r2ProgressBar = document.getElementById("r2-progress-bar");
const r2ProgressFill = document.getElementById("r2-progress-fill");
const r2ProgressNote = document.getElementById("r2-progress-note");
let r2ShownD = 0;
// r2Latched(DONE 래치) · r2StatusCollecting 은 r2Runtime 곁(위쪽)에 선언돼 있다.
/** 레이아웃 선두의 히스테리시스 상태 — 후보 0 이거나 락 세대(lockRevision)가 바뀌면 '' 로 리셋. */
let r2LeadingId = '';
let r2LeadingLockRevision = 0;
/** 정정 강조 타이머 — 칩 요소별. animationend 대신 타이머인 이유: reduced-motion 에선 애니메이션이 없어 끝 사건도 없다. */
const r2ChipCorrectTimers = new WeakMap();
const R2_CHIP_CORRECT_MS = 700;
/**
 * 행 키 → 칩 요소, **컨테이너별**. 모델이 주는 행 순서(type → version → layout → progress)대로 처음 만날 때 만들어 붙인다.
 * 두 컨테이너: 스테이지 좌 패널(라이브 · 변동/확정)과 결과 카드의 확정 요약(DONE 뒤 · F8). 같은 칩 규칙(.r2-chip)을 쓴다.
 */
const r2Chips = new Map();
/** 결과 카드의 확정 요약 컨테이너 (index.html `#result-r2-rows`, authored hidden) — 카메라가 닫힌 뒤 ⑧ 이 실제로 보이는 표면. */
const resultR2Rows = document.getElementById('result-r2-rows');
const resultR2Chips = new Map();

function chipFor(container, chips, key) {
  if (!container) return null;
  let chip = chips.get(key);
  if (!chip) {
    chip = document.createElement('span');
    chip.className = 'r2-chip';
    chip.dataset.key = key;
    chip.dataset.state = CONFIRM_STATE.NONE;
    chip.hidden = true;
    container.appendChild(chip);
    chips.set(key, chip);
  }
  return chip;
}

/** 한 행의 텍스트가 «비어 있지 않은 값 → 다른 값» 으로 바뀌면 잠시 강조색(정정, ⑧). */
function flagR2ChipCorrected(chip) {
  const pending = r2ChipCorrectTimers.get(chip);
  if (pending) {
    clearTimeout(pending);
    chip.classList.remove('is-corrected');
    void chip.offsetWidth; // 애니메이션 재시작 — 클래스를 같은 틱에 떼고 붙이면 브라우저가 합쳐 버린다.
  }
  chip.classList.add('is-corrected');
  r2ChipCorrectTimers.set(chip, setTimeout(() => {
    chip.classList.remove('is-corrected');
    r2ChipCorrectTimers.delete(chip);
  }, R2_CHIP_CORRECT_MS));
}

function renderConfirmationChips(container, chips, rows) {
  for (const row of rows) {
    const chip = chipFor(container, chips, row.key);
    if (!chip) continue;
    if (row.state === CONFIRM_STATE.NONE) {
      if (!chip.hidden) {
        chip.hidden = true;
        chip.textContent = '';
        chip.dataset.state = CONFIRM_STATE.NONE;
        chip.dataset.rsfix = '0';
      }
      continue;
    }
    // progress 행만 상태 라벨이 붙는다 — 동적 키라 scanner-i18n 의 «R2 상태 칩 동적 키» 자가 사전을 잰다.
    let text = row.key === 'progress' && row.stateKey
      ? `${row.text} · ${t('r2.state.' + row.stateKey)}`
      : row.text;
    /*
     * 3b — **RS 정정 수** (운영자 결정 ⑦ · 단위 = 심볼). 모델이 0 이면 키 자체를 안 싣는다
     * («있을 때만» 규약). 낱말도 키도 상수에서 온다 — 문자열을 여기 다시 적으면 상수를 바꾸는 날
     * 화면만 옛 키를 불러 «빈 라벨» 이 된다 (불신 상태 단어와 같은 규율).
     */
    const rsfix = Number.isInteger(row.correctedCount) && row.correctedCount > 0 ? row.correctedCount : 0;
    if (rsfix > 0) text += ' · ' + fillCount(t('r2.state.' + HUD_RSFIX_STATE_KEY), rsfix);
    const rsfixFlag = rsfix > 0 ? '1' : '0';
    if (chip.dataset.rsfix !== rsfixFlag) chip.dataset.rsfix = rsfixFlag;
    if (chip.textContent !== text) {
      // 정정(⑧) = **확정** 행의 값이 «비어 있지 않은 다른 값» 을 갈아치울 때 — DONE 의 변종이 직전 선두와
      // 다르거나 재락으로 버전이 바뀐 경우. 변동(tentative) 행의 선두 교체는 변동색 그대로고, progress 행은
      // 매 프레임 D 가 움직이는 계기라 정정 대상이 아니다 (통합자 해석 — 매 틱 깜빡이면 강조가 뜻을 잃는다).
      if (row.state === CONFIRM_STATE.CONFIRMED && row.key !== 'progress' && chip.textContent !== '' && !chip.hidden) {
        flagR2ChipCorrected(chip);
      }
      chip.textContent = text;
    }
    if (chip.dataset.state !== row.state) chip.dataset.state = row.state;
    if (chip.hidden) chip.hidden = false;
  }
}

function renderR2Progress() {
  if (!r2ProgressRoot || !r2Available) return;
  if (!r2Runtime.enabled) {
    r2ProgressRoot.hidden = true;
    r2ShownD = 0;
    r2LeadingId = '';
    return;
  }
  const display = liveR2Display();
  const { stats, view } = display;
  // 카메라가 닫혀 있으면 **숨긴다**. 옛 안은 DONE 래치가 있을 때 «확정 칩만» 남겼지만 그 칩은 결과 시트(z10)·카메라 게이트(z2)
  // 아래라 아무도 못 봤다 (F8 실측) — 확정 요약은 결과 카드가 그린다 (renderResultR2Summary). 마지막 막대가 남아도 같은 이유로 안 보이지만
  // 재스캔의 첫 프레임(startFrameLoop 의 재렌더) 전까지 «아직 모으는 중» 상태를 DOM 에 남기지 않는다.
  if (!cameraStream) {
    r2ShownD = 0;
    r2LeadingId = '';
    r2ProgressRoot.hidden = true;
    return;
  }
  r2ProgressRoot.hidden = false;
  // 선두 히스테리시스 — 후보가 없거나 락 세대가 바뀌면 처음부터.
  if (stats.candidateCount === 0 || view.lockRevision !== r2LeadingLockRevision) {
    r2LeadingId = '';
    r2LeadingLockRevision = view.lockRevision;
  }
  r2LeadingId = display.candidateId ? display.leadingId : leadingWithHysteresis(r2LeadingId, stats.candidates);
  // 래치는 결과 카드의 몫 — 라이브 패널은 stats·view 만 본다 (래치가 있는 순간은 문 → stopCamera 안이라 이미 카메라가 닫혀 있다).
  const rows = confirmationRows({ stats, view, latched: null, leadingId: r2LeadingId, family: display.family });
  /*
   * 3d — «격자 재확인». progress 행의 상태 단어를 불신일 때만 갈아 끼운다.
   *
   * ⚠ 왜 모델이 아니라 여기인가: 상태 단어를 만드는 곳은 `src/r2-confirmation-model.js` 의
   * `confirmationRows` 이고 그 파일은 **이 레인의 쓰기 범위 밖**이다. 그래서 «안 했다 + 이유» 를
   * 적는다 — 모델은 여전히 인디케이터 이름만 낸다. 불신은 인디케이터와 **다른 축**이라
   * (모으는 중이면서 격자를 못 믿을 수 있다) 모델로 내릴 때도 배타 축으로 합치면 안 된다.
   * 키는 `HUD_DISTRUST_STATE_KEY` 한 곳에서 온다 — 사전 자가 같은 상수에서 유도한다.
   */
  if (stats.lockDistrusted) {
    for (const row of rows) {
      if (row.key === 'progress' && row.stateKey) row.stateKey = HUD_DISTRUST_STATE_KEY;
    }
  }
  renderConfirmationChips(r2ProgressRows, r2Chips, rows);
  // 후보가 없으면(락 없음·폐기) 0 으로 되돌린다 — 후보가 없는데 막대가 차 있으면 거짓말이다.
  const d = stats.candidateCount > 0 ? stats.progressD : 0;
  r2ShownD = d === 0 ? 0 : Math.max(r2ShownD, d);
  if (r2ProgressFill) r2ProgressFill.style.width = `${Math.round(Math.min(1, r2ShownD) * 100)}%`;
  // 메모는 칩과 **같은 락 판정**(progressNote — view.n 우선)에서 나온다: 락 상실 코스팅 중 «칩 없음 · n0·5» 모순이 없다 (F5).
  if (r2ProgressNote) r2ProgressNote.textContent = progressNote({ stats, view });
}

/**
 * 결과 카드의 R2 확정 요약 (F8 · 운영자 ⑧) — R2 출처 결과에만. 래치 `{ layoutId, n, leadingId }` 로 네 행 전부 확정색
 * (Type Y · Y2 (n25) · v0TR · DONE · <r2.state.done>). DONE 의 layoutId 가 적중 프레임의 선두와 다르면 레이아웃 칩에 «정정» 강조 —
 * **첫 표시에서만** (언어 전환 재렌더에 다시 깜빡이지 않게). 래치가 없으면(R1·QR·사진 결과) 숨긴다 — 승격(2026-09-06)
 * 뒤에는 정식에도 R2 출처가 있으므로 이 요약은 정식 결과 카드에도 뜬다.
 */
function renderResultR2Summary(latched) {
  if (!resultR2Rows) return;
  if (!latched || !r2Available) {
    if (!resultR2Rows.hidden) {
      resultR2Rows.hidden = true;
      for (const chip of resultR2Chips.values()) {
        chip.hidden = true;
        chip.textContent = '';
        chip.dataset.state = CONFIRM_STATE.NONE;
        chip.dataset.rsfix = '0';
      }
    }
    return;
  }
  const firstShow = resultR2Rows.hidden;
  renderConfirmationChips(resultR2Rows, resultR2Chips, confirmationRows({ latched }));
  resultR2Rows.hidden = false;
  if (firstShow && typeof latched.leadingId === 'string' && latched.leadingId !== '' && latched.leadingId !== latched.layoutId) {
    const layoutChip = resultR2Chips.get('layout');
    if (layoutChip) flagR2ChipCorrected(layoutChip);
  }
}

/*
 * R2 모드의 상태 문구 (2b · 변경 2). R2 위치에선 R1 상태 기계(status.aim/closer/clipped…)가 멈추므로
 * 인디케이터 **전이** 때만 한 번 setStatus 한다 — 매 프레임 쓰면 낭독기가 매 틱 다시 읽는다.
 *   락 진입(LOCKED | COLLECTING | FINALIZING, 후보 > 0) → status.r2Collecting 1회
 *   락 해제(후보 0 또는 DROPPED | FAILED)             → status.aim 1회
 *   거부된 적중 뒤 유예(r2StatusHoldUntil) 중            → 둘 다 침묵 — 문이 쓴 처방(beaconOnly 등)이 산다 (F1)
 * 규칙은 r2-confirmation-model.r2StatusStep (순수) — 여기는 action 대로 setStatus 하고 위상을 되쓴다.
 */
function syncR2Status() {
  const step = r2StatusStep({ collecting: r2StatusCollecting, holdUntil: r2StatusHoldUntil }, liveR2Display().stats, nowMs());
  r2StatusCollecting = step.collecting;
  if (step.action === R2_STATUS_ACTION.COLLECTING) setStatus(t('status.r2Collecting'));
  else if (step.action === R2_STATUS_ACTION.AIM) setStatus(t('status.aim'));
}

/*
 * R2 HUD 렌더 (PM/029 §18\~19 → §27.4 3a). 표시 게이트는 `r2Available` 하나다 —
 * **2026-09-06 승격** 뒤로는 시험판·정식 양쪽에서 그려진다 (승격을 되돌리면 둘 다 닫힌다).
 *
 * 두 표면을 `renderR2CellMap()` **한 함수**가 그린다 (이름·프레임 루프 호출은 2b 그대로 — 바꾸면 호출처 넷이
 * 같이 흔들린다):
 *   · 전면 오버레이(`#r2-hud`, 스테이지 전면) — 락 H 로 사영한 **실제 자리**에 세 면 마름모 + 격자선 + 실루엣 (⑨).
 *   · 우측 미니 HUD(`#r2-cellmap`, 상단 행 우 칸) — **아이소메트릭 기준**(항등 H, 운영자 요구 ⑪): 카메라
 *     자세와 무관한 canonical 기하를 bbox 에 맞춰 축소하고, 위상별 점진 표시(실루엣 → 격자 → 역할·데이터).
 *
 * 자리는 **어댑터가 정합에 쓰는 것과 같은 H·같은 canonical 기저**에서 온다 (`src/r2/hud-geometry.js` 가
 * `ygrid.faceBasis` · `hexgrid.CORNER_UNIT_OFFSETS` 에서 유도 — 사본 상수 없음). 두 그림이 어긋나면 사용자는
 * 「정합이 보는 곳」이 아니라 「내가 그린 곳」을 본다.
 *
 * 색은 `CELL_MAP_STATE` 와 `HUD_ROLE` 을 **키로** 쓴다 — 숫자 손 사본 금지. 상태·역할이 늘면 여기가
 * 자동으로 따라간다(없는 상태는 미관측 색으로 떨어진다).
 * A6 규율: 코드 사영 영역만(bbox 안) · **반복** 플래시 금지(상태 색만 바뀜) · 확정은 정적. 시간 기반 효과는
 * 셋뿐이다: 락 직후 페이드인(`fadeAlpha`, 300 ms) · SEARCHING 스캔선(CSS · reduced-motion 이면 없음) ·
 * **DONE 직후 RS 정정 강조**(`hudCorrectionAlpha`, 600 ms — 3b · 운영자 결정 ⑦). 셋 다 «상태 전이 1회» 라
 * 주기적으로 깜빡이지 않는다 — A6 이 금지한 것은 그 깜빡임이다.
 */
/**
 * 미니 상자 불신 테두리의 글로우 알파 배율. 3c 가 손으로 고른 두 알파(테두리 0.85 · 글로우 0.18)의
 * 비다 — 그 «세기» 는 유지하고 **색상만** 셀맵에서 유도한다.
 */
const R2_HUD_DISTRUST_GLOW_RATIO = 0.18 / 0.85;
const R2_CELL_COLOR = Object.freeze({
  [CELL_MAP_STATE.UNOBSERVED]: 'rgba(126,249,208,0.14)',
  [CELL_MAP_STATE.CANDIDATE]: 'rgba(255,196,64,0.75)',
  [CELL_MAP_STATE.CONFIRMED]: 'rgba(126,249,208,0.95)',
  [CELL_MAP_STATE.ERASURE]: 'rgba(255,90,170,0.85)',
  /*
   * 🔴 **RS 정정** (3b · 운영자 결정 ⑦). 키가 `CELL_MAP_STATE` 값이 **아닌** 이유: 이것은 셀의
   * «상태» 가 아니라 DONE 한 순간의 **지목**이다. 상태 열거에 끼우면 `HUD_BUCKETS` · 셀맵 칠하기가
   * 있지도 않은 상태를 하나 더 갖게 되고, 누적기가 그 값을 절대 안 써서 «죽은 묶음» 이 생긴다.
   * 그래서 키는 `HUD_RSFIX_STATE_KEY`(사전·CSS·팔레트가 공유하는 그 한 낱말)다.
   *
   * 색: **소거 분홍과 갈려야 한다** — 두 그림이 같은 화면에 뜨고(격자 불신 점선 · 정정 강조) 뜻이
   * 반대다(「못 믿는다」 vs 「고쳤다」). 색상환에서 또 한 자리를 빼앗는 대신 **채도 0 · 최대 명도**로
   * 지목한다: 팔레트의 넷은 전부 유채색이라 흰색은 어느 것과도 안 섞이고, 카메라 영상 위에서
   * 외곽 실선과 함께 가장 잘 읽힌다. `test/r2-corrections.test.js` ⓒ 가 «갈린다» 를 값으로 잰다.
   */
  [HUD_RSFIX_STATE_KEY]: 'rgba(255,255,255,0.92)',
});
/*
 * 좌 패널 칩 색은 셀맵 색표에서 **유도**한다 (사본 금지 — 확정·변동·정정이 셀맵의 확정·후보·소거와 같은 색이어야
 * 두 그림이 한 어휘로 읽힌다). CSS 는 var(--r2-fixed / --r2-live / --r2-fix) 만 본다 — engine-switch.test ⓖ.
 * r2Available 게이트 안 — R2 가 닫힌 화면의 <html> 인라인 스타일에 변수가 심기면 렌더는 같아도 DOM 스냅샷이
 * 달라진다 (F4). 승격(2026-09-06) 뒤 정식은 게이트 **안**이라 변수가 심긴다 — 그게 정식 화면 = 시험판 화면이다.
 * 칩은 R2 가 켜졌을 때만 만들어지므로 게이트 밖에 둘 이유가 없다.
 */
if (r2Available) {
  document.documentElement.style.setProperty('--r2-fixed', R2_CELL_COLOR[CELL_MAP_STATE.CONFIRMED]);
  document.documentElement.style.setProperty('--r2-live', R2_CELL_COLOR[CELL_MAP_STATE.CANDIDATE]);
  document.documentElement.style.setProperty('--r2-fix', R2_CELL_COLOR[CELL_MAP_STATE.ERASURE]);
  /*
   * 미니 상자 불신 테두리의 **바깥 번짐**(3d 검토 결함 6). 색상은 테두리와 같은 소거색이고
   * 세기만 낮춘다 — CSS 에 분홍 rgba 를 다시 적으면 셀맵 색을 바꾸는 날 이 글로우만 옛 색으로
   * 남는다(그 블록 주석이 스스로 금지한 것이다). 배율은 «색» 이 아니라 «세기» 라 여기 산다.
   */
  const r2FixGlow = scaleColorAlpha(R2_CELL_COLOR[CELL_MAP_STATE.ERASURE], R2_HUD_DISTRUST_GLOW_RATIO);
  document.documentElement.style.setProperty('--r2-fix-glow', r2FixGlow);
  // 3b — 결과 카드 DONE 칩의 «RS 정정 k» 색. 캔버스 강조와 **같은 값**이라 두 표면이 한 어휘로 읽힌다.
  document.documentElement.style.setProperty('--r2-rsfix', R2_CELL_COLOR[HUD_RSFIX_STATE_KEY]);
}
const r2CellMapCanvas = document.getElementById('r2-cellmap');
const r2HudCanvas = document.getElementById('r2-hud');
const r2HudMini = document.getElementById('r2-hud-mini');
/*
 * 🔴 **표시 판정이 닿는 세 표면** (3b 검토 F1). 이름은 `hudSurfaceVisibility` 의 출력 키에서
 * 접미 `Hidden` 을 뗀 것이다 — 짝짓기는 `applyHudSurfaces` 가 유도하므로 여기 손 목록이 아니라
 * «어느 요소가 어느 표면인가» 만 적는다. **한 번만 만든다**: 프레임마다 만들면 그것이 매 프레임
 * 할당이고, 요소 참조는 세션 내내 안 바뀐다.
 */
const r2HudSurfaces = Object.freeze({
  overlay: r2HudCanvas,
  mini: r2HudMini,
  cellMap: r2CellMapCanvas,
});

/**
 * **디자인 톤 명암** (운영자 요구 ⑧ — 「로케이터 초록 + 디자인(휘도)」). 인덱스 = 그 면의 설계 톤
 * (0 어두움 → 2 밝음, `buildRoleGrids` 의 toneGrid). 로케이터는 초록 명암, 레퍼런스는 보라 명암 —
 * 즉 사용자는 HUD 에서 **코드에 실제로 인쇄된 밝기 순서**를 본다.
 *
 * 🔴 **지켜야 하는 성질은 «개수 3» 이 아니라 «상대휘도가 단조 증가»** 다 (2026-09-06 검토 R3c, 결함 17).
 * 옛 자는 줄당 스와치 3개만 셌다 — 그러면 세 색이 같아도, 순서가 뒤집혀도 초록이다. 그 표가 말하는 것은
 * 「코드에 인쇄된 밝기 순서」이므로 **순서가 곧 계약**이다. `test/r2-hud.test.js` ⓘ 가 rgb 를 파싱해
 * 상대휘도 단조를 단언한다.
 *
 * 톤을 갖는 역할이 곧 이 표의 키다 — 아래 색표 유도가 이 표를 훑어 «역할 × 톤» 묶음을 만든다.
 */
const R2_HUD_TONE_COLOR = Object.freeze({
  [HUD_ROLE.LOCATOR]: Object.freeze(['rgb(16 78 52)', 'rgb(52 158 108)', 'rgb(140 255 210)']),
  [HUD_ROLE.REFERENCE]: Object.freeze(['rgb(58 34 96)', 'rgb(140 100 210)', 'rgb(222 196 255)']),
});
/** 톤 표의 **중간 톤** — 「톤을 모르는 면」의 기준색은 여기서 유도한다 (사본 금지). */
const R2_HUD_TONE_MID = 1;
/**
 * 역할색 (운영자 결정 ⑩ · 2026-09-05 → 실기 3차 ⑧ 로 조정). 키는 **HUD_ROLE 에서** 온다 — 리터럴 숫자 키를
 * 적으면 역할 값이 바뀌는 날 아무도 모르게 어긋난다 (test/r2-hud.test.js 가 그 유도를 잰다).
 *
 * 이 표는 «톤을 모르는 면» 의 기준색이다. 로케이터·레퍼런스는 위 `R2_HUD_TONE_COLOR` 의 명암으로
 * 갈려 그려지고, 여기 값은 toneGrid 가 `HUD_TONE_NONE` 을 주는 면(있어선 안 되지만 «없음» 이 값인 자리)의
 * 폴백이다 — 그래서 **톤 표의 중간 톤에서 유도**한다. 손으로 적으면 톤을 바꾸는 날 폴백만 옛 색으로 남는다.
 *
 * ⚠ **초록은 이 파일 한 곳이 아니다** (2026-09-06 검토 R3c 정정 — 옛 주석은 「팔레트는 여기 한 곳뿐」이라
 *   적었고 그것이 거짓이었다). 지금 초록은 **세 어휘**로 산다:
 *     ① 톤 표(위) — 로케이터 3단. 역할 폴백이 여기서 유도된다.
 *     ② `R2_HUD_OUTLINE_STROKE`(아래) — 실루엣 선. **사이트 액센트 초록**(126 249 208)이다.
 *     ③ CSS 의 같은 액센트 — `.scan-reset` 테두리 · `.r2-progress-track` 배경 등 (index.html).
 *   ②③ 은 「HUD 톤」이 아니라 「사이트 액센트」라 **의도적으로 다른 축**이다. 묶는 자는 없다 —
 *   묶으려면 CSS 변수 하나로 내려야 하고, 그건 스캐너 전역 DOM 을 건드리므로 이 레인의 범위 밖이다.
 *   ⇒ 톤을 바꿀 때 ②③ 은 따라오지 **않는다**. 그것이 지금의 계약이다.
 */
const R2_HUD_ROLE_COLOR = Object.freeze({
  [HUD_ROLE.LOCATOR]: R2_HUD_TONE_COLOR[HUD_ROLE.LOCATOR][R2_HUD_TONE_MID],
  [HUD_ROLE.REFERENCE]: R2_HUD_TONE_COLOR[HUD_ROLE.REFERENCE][R2_HUD_TONE_MID],
  [HUD_ROLE.FORMAT]: '#4ad8ff',
  [HUD_ROLE.SLOT]: 'rgb(120 140 170)',
});
/** 「묶음 키 + 톤」 의 구분자. 묶음 키가 이미 ':' 를 쓰므로 다른 글자여야 두 축이 안 섞인다. */
const R2_HUD_TONE_SEP = '#';
/** 락 직후 페이드인(⑩ 사이버 효과) 길이 · 격자선/외곽선 색. */
const R2_HUD_FADE_MS = 300;
const R2_HUD_GRID_STROKE = 'rgba(233,246,255,0.18)';
const R2_HUD_OUTLINE_STROKE = 'rgba(126,249,208,0.7)';
/*
 * **«격자 불신» 의 그림** (3d · 요구 3) — 마진 게이트 미달, 즉 「락은 있는데 그 격자를 못 믿는다」.
 *
 * 사용자가 이 그림에서 읽어야 하는 것은 «잘못됐다» 가 아니라 «지금 다시 확인하는 중이다» 다 —
 * 이 상태에서도 락은 살아 있고 재검출이 돌고 있다. 그래서 지우지 않고 **약하게·점선으로** 그린다.
 *   · 색은 셀맵의 «정정»(ERASURE) 색에서 **유도**한다 (사본 금지 — 좌 패널 칩 `--r2-fix` 와 같은 분홍이라
 *     세 표면이 한 어휘로 읽힌다). 여기서 rgba 를 다시 적으면 셀맵 색을 바꾸는 날 HUD 만 옛 색으로 남는다.
 *   · 점선은 **정지 패턴**이다 (A6 플래시 금지 — 흐르는 점선은 애니메이션이고 reduced-motion 계약을 깬다).
 *   · α 는 채움에 곱한다: 「보이긴 하는데 확정처럼 보이지 않는다」.
 */
const R2_HUD_DISTRUST_STROKE = R2_CELL_COLOR[CELL_MAP_STATE.ERASURE];
/**
 * **RS 정정 강조의 붓 색** (3b). 색은 팔레트의 «rsfix» 항목 하나에서 온다 (사본 금지 — 좌 패널 칩의
 * `--r2-rsfix` 도 같은 값). 붓질 자체(채움 배율·외곽 굵기·실선)는 `src/r2-hud-paint.js` 가 쥔다 —
 * 그 파일엔 색이 하나도 없고 여기서 **값으로** 건네므로, 가짜 ctx 로 붓질을 셀 수 있다 (빚 2).
 */
const R2_HUD_CORRECTION_STYLE = Object.freeze({ color: R2_CELL_COLOR[HUD_RSFIX_STATE_KEY] });
/** 미니 실루엣만 그리는 위상(락 전·DROPPED)의 α — «찾는 중» 의 자리만 알린다. */
const R2_HUD_MINI_IDLE_ALPHA = 0.35;
/** 점선 간격은 **화면 CSS px** 다 — 선폭과 같은 이유로 변환 역수로 되돌려 쓴다. */
const R2_HUD_DISTRUST_DASH = Object.freeze([6, 4]);

/** 점선 스크래치 — `setLineDash` 는 인자를 **복사**하므로 한 배열을 계속 덧써도 된다 (핫 경로 할당 금지). */
const r2HudDashScratch = [0, 0];

/** 격자·실루엣 선의 붓 — 불신이면 분홍 점선, 아니면 기존 색의 실선. `ctx` 를 그 자리에서 세운다. */
function setR2HudStroke(ctx, distrusted, baseColor, unitPx) {
  ctx.strokeStyle = distrusted ? R2_HUD_DISTRUST_STROKE : baseColor;
  if (!distrusted) {
    ctx.setLineDash(R2_HUD_SOLID_DASH);
    return;
  }
  for (let k = 0; k < R2_HUD_DISTRUST_DASH.length; k += 1) {
    r2HudDashScratch[k] = R2_HUD_DISTRUST_DASH[k] * unitPx;
  }
  ctx.setLineDash(r2HudDashScratch);
}
/**
 * 묶음 키 → { 색, 알파 }. 키 문자열을 손으로 다시 적지 않는다 — `bucketKey` 로 **유도**한다.
 * 역할은 변동(DONE 전) 0.55 · 확정 0.95 (⑧·⑩), 데이터 셀은 셀맵 상태색 그대로(1).
 * ⚠ 확정(`:c`) 절반은 **DONE 정정 강조 재렌더에서만** 칠해진다 (3b) — 다른 넷은 래치가 null 인 자리라
 *   변동색만 쓴다(renderR2CellMap 의 `tentative` 주석). 3d 까지는 「이 표면에서 아예 안 칠해진다」였다.
 *   표를 전부 채워 두는 이유는 그때나 지금이나 같다: 색표가 묶음(역할×변동/확정 × 톤 ∪ 데이터×상태)을 다
 *   덮어야 «색 없는 묶음» 이라는 조용한 구멍이 안 생긴다(ⓒ 와 같은 규율). 만드는 비용은 로드 때 한 번이다.
 */
const R2_HUD_BUCKET_PAINT = new Map();
/** 칠하는 순서 = 이 배열의 순서. `R2_HUD_BUCKET_PAINT` 와 **같은 자리에서** 자라므로 색 없는 키가 생길 수 없다. */
const R2_HUD_PAINT_KEYS = [];
function addR2HudPaint(key, color, alpha) {
  if (!key || R2_HUD_BUCKET_PAINT.has(key)) return;
  R2_HUD_BUCKET_PAINT.set(key, { color, alpha });
  R2_HUD_PAINT_KEYS.push(key);
}
for (const [role, color] of Object.entries(R2_HUD_ROLE_COLOR)) {
  const roleValue = Number(role);
  const tones = R2_HUD_TONE_COLOR[roleValue];
  for (const tentative of [true, false]) {
    const key = bucketKey(roleValue, CELL_MAP_STATE.UNOBSERVED, tentative);
    const alpha = tentative ? 0.55 : 0.95;
    // 톤 없음(HUD_TONE_NONE) 폴백이 먼저, 그다음 톤별 묶음 — 둘 다 같은 알파 규칙(변동/확정)을 쓴다.
    addR2HudPaint(key, color, alpha);
    if (key && tones) {
      for (let tone = 0; tone < tones.length; tone += 1) {
        addR2HudPaint(key + R2_HUD_TONE_SEP + tone, tones[tone], alpha);
      }
    }
  }
}
for (const state of Object.values(CELL_MAP_STATE)) {
  addR2HudPaint(bucketKey(HUD_ROLE.DATA, state, false), R2_CELL_COLOR[state], 1);
}
/**
 * 묶음별 Path2D — Map 은 재사용하고 Path2D 만 매 프레임 새로. fill 호출 수 = 묶음 수(마름모 수가 아니라).
 * **두 벌**인 이유(H1 · 운영자 요구 ⑪): 오버레이는 락 H 사영, 미니는 항등 H(아이소메트릭)라 같은 셀이
 * 서로 다른 좌표를 갖는다. 두 벌을 **한 번의 셀 순회**에서 같이 채운다 — 격자를 두 번 걷지 않는다.
 */
const r2HudPaths = new Map();
const r2HudMiniPaths = new Map();
/**
 * 항등 H — **미니 HUD 의 유일한 사영**이다 (운영자 요구 ⑪: 「미니는 카메라 실루엣이 아니라 아이소메트릭
 * 기준」). canonical 좌표를 그대로 얻어(px ≡ canonical) bbox 로 정규화해 그리므로, 카메라가 기울거나
 * 코드가 화면 구석에 있어도 미니는 늘 같은 아이소메트릭 자세다. 실제 자세는 전면 오버레이가 보여 준다(⑨).
 */
const R2_HUD_IDENTITY_H = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const r2HudBounds = new Float64Array(4);
/**
 * HUD 렌더 상태. 사영 버퍼는 **n 이 바뀔 때만** 새로 잡고, 재사영은 **사영 입력 여섯이 바뀔 때만** —
 * 락 뒤 H 는 고정이라(트래킹 없음) 매 프레임 다시 풀 이유가 없다. 여섯이 무엇이고 왜 여섯인지는
 * `hudProjectionChanged`(src/r2-hud-model.js) 머리말에 있다.
 */
const r2Hud = {
  // ⚠ frameW/frameH 는 «지금 프레임» 이 아니라 **마지막 사영 프레임**의 폭·높이다 — H 는 그 프레임의 px
  // 좌표계이고(adapter-locator installLock · 트래킹 없음) 사영 버퍼도 그때 푼 값이다. view.frameWidth 는 매
  // 프레임 현재 luma 폭으로 덧써지므로(r2-scan-runtime pushFrame · r2-scan-runtime.test ⓣ), 그것으로 나누면
  // 사영과 자가 다른 프레임을 말한다. 그래서 재사영과 **같은 자리에서만**(hudCaptureProjection) 갱신한다.
  lockRevision: -1, bindRevision: -1, n: 0, frameW: 0, frameH: 0, H: null,
  /*
   * 역할 격자 캐시의 키는 **셋**이다 (빚 3): n · 선두 레이아웃 · **포맷 세대**. 세대가 빠지면
   * 세대만 바뀐 재bind 가 옛 격자를 그대로 써서, 레거시(와이어 1) 프레임의 정정 강조·소거
   * 색칠이 순번 7 부터 다른 칸을 지목한다. 규칙과 무효화는 순수 모듈이 쥔다(`hudRoleGridsInto`).
   */
  layoutId: '', gridN: 0, gridWire: 0,
  quads: null, lines: null, outline: new Float64Array(12), roleGrids: null,
  /** 3b — 스캔 순번 k → 격자 인덱스. `roleGrids` 와 **같은 자리에서** 다시 만든다 (유도, 사본 아님). */
  scanInverse: null,
  lockedAt: 0, phase: '', lastMs: 0, maxMs: 0,
};
/**
 * 미니 HUD 의 **아이소메트릭(항등 H) 기하** — n 이 바뀔 때만 다시 푼다. 락 H·프레임 폭과 무관하므로
 * 락이 없어도(n 미상 → 단위 육각 n=1) 실루엣을 그릴 수 있다.
 */
const r2HudIso = { n: 0, quads: null, lines: null, outline: new Float64Array(12) };

/*
 * 정사각 한 변 캐시 (스테이지 · 미니 상자). 렌더는 프레임마다 DOM 을 먼저 쓴 뒤(hidden·data-phase·칩) 크기를
 * 읽는다 — 그 순서면 `getBoundingClientRect` 가 **강제 동기 레이아웃**을 프레임마다 부른다. 크기가 바뀌는
 * 계기는 리사이즈뿐이므로 ResizeObserver 를 **무효화 신호로만** 쓰고, 값은 여전히 같은 rect 로 잰다
 * (관측 박스 대신 rect 를 쓰는 이유: 스테이지엔 1px 테두리가 있어 border-box ≠ contentRect 다).
 * ResizeObserver 가 없는 브라우저면 예전처럼 매 프레임 잰다 — 회전 뒤 자가 틀리는 것보다 낫다.
 */
const R2_SIDE_STAGE = 0;
const R2_SIDE_MINI = 1;
const r2SideCache = [-1, -1];
// r2Available 게이트 안 — R2 가 닫힌 화면(승격 되돌림)에는 HUD 가 없으니 관측자도 만들지 않는다.
const r2SideObserved = r2Available && typeof ResizeObserver === 'function';
if (r2SideObserved) {
  const observer = new ResizeObserver(() => { r2SideCache[R2_SIDE_STAGE] = -1; r2SideCache[R2_SIDE_MINI] = -1; });
  if (cameraStage) observer.observe(cameraStage);
  if (r2CellMapCanvas) observer.observe(r2CellMapCanvas);
}
function squareSideOf(element, slot) {
  if (r2SideObserved && r2SideCache[slot] >= 0) return r2SideCache[slot];
  const rect = element.getBoundingClientRect();
  const side = Math.min(rect.width, rect.height);
  r2SideCache[slot] = side;
  return side;
}

/** 꺼짐 / 카메라 없음 — 캔버스 둘을 숨기고 재사영 상태를 되돌린다. */
function hideR2Hud() {
  r2CandidateHud.reset();
  // «그릴 근거가 없다» 는 입력 하나로 셋을 다 닫는다 — 규칙은 renderR2CellMap 과 **같은 순수 함수**고,
  // 판정을 `hidden` 으로 옮기는 이음새도 **같은 함수**다 (없는 요소는 그쪽이 건너뛴다).
  applyHudSurfaces(r2HudSurfaces, hudSurfaceVisibility({ hasStream: false }));
  r2Hud.lockRevision = -1;
  r2Hud.bindRevision = -1;
  // H 스냅샷도 버린다 — 남기면 다음 락의 H 가 우연히 같은 9값일 때 재사영이 «필요 없음» 으로 읽힌다.
  r2Hud.H = null;
  // 격자 캐시 다섯 칸은 **한 함수**가 비운다 — 렌더러와 여기가 각자 적으면 새 칸(세대)을 한쪽만 잊는다.
  clearHudRoleGrids(r2Hud);
  r2Hud.maxMs = 0;
  r2Hud.phase = '';
  // 락 폭도 같이 버린다 — 다음 락의 재사영이 자기 프레임 폭을 다시 심는다.
  r2Hud.frameW = 0;
  r2Hud.frameH = 0;
}

/** 묶음 채우기 — 순서는 `R2_HUD_PAINT_KEYS` 고정(역할×톤 → 데이터 상태). alpha 는 락 페이드인. */
function paintR2HudBuckets(ctx, alpha, paths) {
  for (const key of R2_HUD_PAINT_KEYS) {
    const path = paths.get(key);
    const paint = R2_HUD_BUCKET_PAINT.get(key);
    if (!path || !paint) continue;
    ctx.globalAlpha = alpha * paint.alpha;
    ctx.fillStyle = paint.color;
    ctx.fill(path);
  }
  ctx.globalAlpha = alpha;
}

/**
 * 마름모 한 장을 묶음 경로에 잇는다. 꼭짓점 하나라도 NaN 이면 그 마름모는 **통째로** 건너뛴다 —
 * NaN 은 「사영 불가」의 표현이다(hud-geometry 규약). 경로는 실제로 쓸 때만 만든다.
 */
function appendR2HudQuad(paths, key, buffer, slot) {
  if (!quadFinite(buffer, slot)) return;
  let path = paths.get(key);
  if (path === undefined) {
    path = new Path2D();
    paths.set(key, path);
  }
  appendR2HudQuadInto(path, buffer, slot);
}

/** 꼭짓점 넷이 전부 유한한가 — «사영 불가» 판정의 **정본**. 묶음 경로와 정정 경로가 같이 쓴다. */
function quadFinite(buffer, slot) {
  for (let k = 0; k < 8; k += 1) {
    if (!Number.isFinite(buffer[slot + k])) return false;
  }
  return true;
}

/** 마름모 한 장을 **주어진** 경로에 잇는다 (3b 정정 강조 — 묶음 Map 을 거치지 않는 자리). */
function appendR2HudQuadInto(path, buffer, slot) {
  if (!quadFinite(buffer, slot)) return;
  path.moveTo(buffer[slot], buffer[slot + 1]);
  path.lineTo(buffer[slot + 2], buffer[slot + 3]);
  path.lineTo(buffer[slot + 4], buffer[slot + 5]);
  path.lineTo(buffer[slot + 6], buffer[slot + 7]);
  path.closePath();
}

/** 격자선 — 선분 버퍼(끝점 2개)를 그대로 잇는다. NaN 선분은 건너뛴다. */
function appendR2HudLines(path, buffer, segments) {
  for (let s = 0; s < segments; s += 1) {
    const o = s * 4;
    const ax = buffer[o]; const ay = buffer[o + 1];
    const bx = buffer[o + 2]; const by = buffer[o + 3];
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
    path.moveTo(ax, ay);
    path.lineTo(bx, by);
  }
}

/** 육각 실루엣 — 6점 중 유한한 것만 잇는다. 유한한 점이 하나도 없으면 빈 경로다. */
function appendR2HudOutline(path, buffer) {
  let started = false;
  for (let c = 0; c < 6; c += 1) {
    const x = buffer[c * 2];
    const y = buffer[c * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!started) { path.moveTo(x, y); started = true; } else path.lineTo(x, y);
  }
  if (started) path.closePath();
  return started;
}

/**
 * 시험판 하단 패널의 hud 줄 — 비어 있으면 패널이 줄을 안 붙인다 (qr 과 같은 «있을 때만» 규약).
 *
 * H6: 단계별 ms(detect/align/decode) · 카운터 · 락 F · 포맷을 «있을 때만» 덧붙인다. 프레임 줄은
 * 총합만 내므로(scanner-debug-overlay) 「어디서 시간이 가는가」·「무엇이 증거를 버렸는가」는 여기서만 보인다.
 *
 * ⚠ **문자열을 만드는 곳은 여기가 아니다** (2026-09-06 검토 R3c, 결함 16). 옛 판은 이 함수 안에서
 * 조립했고, 길이 자가 `
` 개수(논리 줄)뿐이라 **한 줄 188자**가 초록이었다 — 패널이 287px 스테이지에서
 * 시각 4\~5줄을 먹었다. 이제 순수 빌더(`r2HudDebugLineOf`)가 만들고 자는 그 **출력 길이**를 잰다.
 * 이 자리는 「무엇을 먹여 주나」만 안다: 위상·렌더 ms·격자 이름은 화면 상태이고 나머지는 런타임 stats 다.
 */
function r2HudDebugLine() {
  if (!r2Available) return '';
  return r2HudDebugLineOf({
    phase: r2Hud.phase,
    lastMs: r2Hud.lastMs,
    maxMs: r2Hud.maxMs,
    n: r2Hud.n,
    layoutId: layoutDisplayId(r2Hud.layoutId),
    /*
     * 3b — RS 정정 수. 원천은 래치라 600 ms 창과 무관하다.
     * ⚠ **지금 구조에선 이 값이 줄에 실릴 수 없다** (3b 검토 F10 · 잠자는 경로): R2 위치에서 hud 줄을
     * 만드는 유일한 호출처(`updateDebugOverlay(r2Image, …)`)는 프레임 루프 끝인데, 그 앞에서
     * 수용이면 `return` 하고 거부면 `r2Latched = null` 이 먼저 돈다. 즉 이 자리의 래치는 언제나
     * null 이다. 3b 검토 F1 의 표면 결정((i) stopCamera 유예 · (ii) 결과 시트 HUD)이 서면 그때
     * 실제로 뜬다 — 그전까지는 배선만 서 있다.
     */
    corrected: r2Latched && Number.isInteger(r2Latched.correctedCount) ? r2Latched.correctedCount : 0,
  }, r2Runtime.stats);
}

// 외곽 12좌석과 겹치던 조작부는 뷰파인더 위, 진단은 기존 스크롤 패널로 옮겨요.
if (r2Available) {
  const dock = document.createElement('div');
  dock.className = 'candidate-control-dock';
  const engine = document.getElementById('engine-switch');
  const reset = document.getElementById('scan-reset');
  if (engine) dock.append(engine);
  if (reset) dock.append(reset);
  cameraStage.parentElement.insertBefore(dock, cameraStage);
  cameraStage.parentElement.classList.add('has-candidate-dock');
  const debug = document.getElementById('lab-debug-panel');
  const panels = document.getElementById('scanner-panels');
  if (debug && panels) panels.append(debug);
}

const r2CandidateHud = r2Available ? createCandidateHudRenderer({
  container: document.getElementById('r2-candidate-ring'),
  overlay: r2HudCanvas,
  stage: cameraStage,
  labelFor: (key) => t('r2.state.' + key),
  paintFor(role, state, tone, corrected) {
    if (corrected) return { color: R2_HUD_CORRECTION_STYLE.color, alpha: 1 };
    const key = bucketKey(role, state, true);
    return R2_HUD_BUCKET_PAINT.get(tone === null ? key : key + R2_HUD_TONE_SEP + tone);
  },
}) : Object.freeze({ render() {}, reset() {}, accept() { return false; }, model: null });

function renderCandidateR2CellMap() {
    r2HudMini.hidden = true;
    r2CellMapCanvas.hidden = true;
    const paintStartedAt = nowMs();
    r2CandidateHud.render(r2Runtime.hudCandidates || [], paintStartedAt, {
      enabled: r2Runtime.enabled && Boolean(cameraStream),
      correction: r2Correction && r2Latched ? { ...r2Correction,
        candidateId: r2Latched.candidateId, revision: r2Latched.revision } : null,
    });
    const leader = r2CandidateHud.model.slots.find((slot) => slot?.id === r2CandidateHud.model.leaderId);
    r2DisplayedCandidateId = leader?.id || '';
    r2LeadingId = leader?.candidate.layoutId || '';
    r2Hud.n = leader?.candidate.n || 0;
    r2Hud.layoutId = r2LeadingId;
    r2Hud.phase = leader?.status || 'searching';
    r2Hud.lastMs = nowMs() - paintStartedAt;
    r2Hud.maxMs = Math.max(r2Hud.maxMs, r2Hud.lastMs);
}

function renderR2CellMap() {
  if (r2Available) { renderCandidateR2CellMap(); return; }
  if (!r2CellMapCanvas || !r2HudCanvas || !r2HudMini || !r2Available) return;
  const startedAt = nowMs();
  const view = r2Runtime.view;
  const stats = r2Runtime.stats;
  if (!r2Runtime.enabled || !cameraStream || !view) {
    hideR2Hud();
  } else {
    /*
     * 위상과 불신을 **한 입력**에서 뽑는다 (3d) — 두 판정이 서로 다른 프레임 상태를 보면 화면의
     * 두 그림(위상 진행 · 분홍 점선)이 어긋나 「무엇을 보고 있는지」가 사라진다.
     */
    const hudInput = {
      locked: stats.locked,
      candidateCount: stats.candidateCount,
      cellCount: view.cellCount,
      observedCells: countObserved(view.cellMap, view.cellCount),
      indicator: stats.indicator,
      latched: r2Latched !== null,
      distrusted: stats.lockDistrusted,
    };
    const phase = hudPhase(hudInput);
    // «격자 불신» — 마진 게이트 미달. 판정은 순수 모듈이 하고(그릴 게 없는 위상은 스스로 뺀다) 여기는 그린다.
    const distrusted = hudDistrusted(hudInput);
    r2Hud.phase = phase;

    const n = Number.isInteger(view.n) && view.n > 0 ? view.n : 0;
    if (view.H && n > 0) {
      if (n !== r2Hud.n || r2Hud.quads === null) {
        r2Hud.quads = new Float64Array(faceQuadFloats(n));
        r2Hud.lines = new Float64Array(gridLineFloats(n));
      }
      /*
       * 재사영 조건 (H5 · 운영자 실기 3차 ①). 락 세대(lockRevision)만 보면 **재bind 를 못 본다** —
       * `disposeCandidates` 는 view.H 를 비우고 n 을 0 으로 두지만 lockRevision 은 안 건드리므로, 락이
       * 살아 있으면 다음 프레임에 같은 세대·같은 n 으로 곧장 재bind 된다. 그래서 여섯(락 세대 · bind
       * 세대 · n · 프레임 폭·높이 · H 9값)을 본다. 판정은 순수 모듈에 있다(가짜 view 로 잴 수 있게).
       */
      const projection = {
        lockRevision: view.lockRevision,
        bindRevision: stats.bindRevision,
        n,
        frameW: view.frameWidth,
        frameH: view.frameHeight,
        H: view.H,
      };
      // 페이드인은 «새 락» 의 효과지 «다시 푼 사영» 의 효과가 아니다 — 재bind(42프레임마다)마다 넣으면
      // 화면이 주기적으로 깜빡인다 (A6: 플래시 금지). 그래서 락 세대가 바뀐 프레임에만 시각을 새로 잡는다.
      const relocked = view.lockRevision !== r2Hud.lockRevision;
      if (hudProjectionChanged(r2Hud, projection)) {
        projectFaceQuadsInto(view.H, n, r2Hud.quads);
        projectGridLinesInto(view.H, n, r2Hud.lines);
        projectOutlineInto(view.H, n, r2Hud.outline);
        // 여섯을 **한 자리에서** 기록한다 (H 는 어댑터 버퍼 참조라 9값을 복사한다). 화면 변환의 분모가
        // 여기 심긴 frameW 라, 매 프레임 덧쓰면 사영과 자가 다른 프레임을 말하게 된다.
        hudCaptureProjection(r2Hud, projection);
        if (relocked) r2Hud.lockedAt = nowMs();
      }
    }
    /*
     * 미니의 아이소메트릭 기하 (⑪) — **항등 H**, n 이 바뀔 때만 푼다. 락과 무관하므로 락 전에도 그릴 수
     * 있고, n 을 모르면 단위 육각(n=1)으로 «캔버스 실루엣» 만 낸다.
     */
    const isoN = n > 0 ? n : 1;
    if (r2HudIso.n !== isoN || r2HudIso.quads === null) {
      r2HudIso.quads = new Float64Array(faceQuadFloats(isoN));
      r2HudIso.lines = new Float64Array(gridLineFloats(isoN));
      projectFaceQuadsInto(R2_HUD_IDENTITY_H, isoN, r2HudIso.quads);
      projectGridLinesInto(R2_HUD_IDENTITY_H, isoN, r2HudIso.lines);
      projectOutlineInto(R2_HUD_IDENTITY_H, isoN, r2HudIso.outline);
      r2HudIso.n = isoN;
    }
    /*
     * 역할 격자의 선두는 좌 패널과 **같은 히스테리시스 값**(r2LeadingId) «뿐» 이다 — 선두가 바뀌면 역할색이
     * 통째로 바뀌므로(⑧), 좌 패널이 NONE 인 프레임에 HUD 가 옛 선두로 색을 칠하면 두 표면이 다른 레이아웃을
     * 말한다. r2LeadingId 가 '' 이면(살아 있는 후보 0) 역할 격자를 **버린다** — 격자선·실루엣은 그대로 그린다.
     */
    /*
     * 🔴 **빚 3** — 격자를 만드는 세대는 런타임이 후보를 묶은 세대다 (`view.formatWire`). 규칙·캐시
     * 무효화는 순수 모듈이 쥐고(`hudRoleGridsInto`) 여기서는 「무엇을 먹여 주나」만 안다: 선두 ·
     * 락 n · 그 세대. 역표(정정 강조가 거꾸로 묻는 표)도 같은 호출에서 같이 만들어진다 —
     * 한쪽만 갱신하면 셀 번호와 칸이 어긋난다.
     */
    hudRoleGridsInto(r2Hud, { n, layoutId: r2LeadingId, formatWire: view.formatWire });

    const grids = r2Hud.roleGrids;
    const quads = r2Hud.quads;
    /*
     * 레이아웃 변종은 DONE 까지 변동(⑧). 렌더 호출은 **다섯**이고 그중 넷은 래치가 null 인 자리다
     * (프레임 루프는 래치 설정 **앞** · 스위치 · startFrameLoop · manualRescan 은 null 로 만든 뒤 그린다).
     * ⚠ **다섯 번째가 예외다** (3b): 수용된 DONE 뒤의 정정 강조 재렌더는 래치가 **선 채**로 들어오므로
     * 거기서 `tentative === false` 이고, 확정 알파(0.95)·확정 묶음(`:c`)이 그 한 장에서 실제로 쓰인다
     * (운영자 결정 ⑨·⑩ 이 이미 정의해 둔 색). 그 한 장이 화면에 도달하는지는 3b 검토 F1 — 운영자 결정
     * 대기다. 옛 주석은 「항상 true」라고 적어 두었는데 3b 가 다섯 번째 호출처를 만든 순간 거짓이 됐다.
     */
    const tentative = r2Latched === null;
    // 「오버레이 기하가 있나」와 「그릴 위상인가」를 가른다 — 정정 강조는 앞의 것만 필요하다(3b).
    const overlayGeom = Boolean(view.H) && quads !== null && r2Hud.n === n;
    const isoGeom = r2HudIso.n === n && r2HudIso.quads !== null;
    /*
     * 🔴 **RS 정정 강조를 «이 격자에» 찍어도 되는가** (3b · 빚 3). 규칙은 순수 모듈이 쥔다
     * (`hudCorrectionGridOk` — 입력이 평범한 객체·수뿐이라 DOM 이 없다). 옛 자리는 여기 지역
     * 논리곱 여덟이었고 **아무 자도 못 봤다**: 세대 항 한 줄을 지워도 자 전부가 초록이었는데,
     * 그 변이는 정정 강조를 통째로 끄는 변이다 (3b 검토 F2). 이제 값으로 재진다.
     * 「지금 그릴 α 가 있나」는 여기 없다 — 그것은 계획이 판정한다.
     */
    const corrGridOk = hudCorrectionGridOk(r2Hud, r2Correction, n);
    /*
     * 🔴 **칠 계획** (빚 2) — 「어느 층이 열리고 어떤 α 인가」는 순수 모듈이 정한다(`hudPaintPlan`).
     * 옛 자리는 여기 대여섯 개의 지역 상수였고, 그래서 「채움이 열리는가」를 재는 방법이 **철자**밖에
     * 없었다 (r2-hud.test ⓞ — 정상 개명을 거부하던 자다). 이제 그 규칙은 값으로 재진다
     * (`test/r2-hud-paint.test.js`) 그리고 여기는 계획대로 그리기만 한다.
     *
     * 계획이 답하는 것: 정정 강조가 살아 있나 · 오버레이를 열까 · 채움/격자를 그릴까(오버레이·미니
     * 규칙이 다르다) · 정정 강조를 어느 표면에 그릴까 · 불신을 어떤 α 로 눕힐까.
     * 계획이 **모르는 것**: 캔버스·좌표·색 — 전부 이 자리의 몫이다.
     */
    const plan = hudPaintPlan({
      /*
       * 🔴 **시계 주입** (빚 1). 정정 강조 α 는 위상이 아니라 **래치 시각**에서 나오고(위상 밖의 층),
       * 그 α 하나가 ⑯(i) 유예 창에서 오버레이를 여는 유일한 입력이다. 시각을 인자로 넣으므로
       * 자가 프레임을 여러 장 밀어 「hidden=false 인 프레임이 몇 장이었나」를 값으로 셀 수 있다
       * (`test/scanner-accept-delay.test.js` ⓘ).
       */
      nowMs: nowMs(),
      correction: r2Correction,
      // 그릴 근거 셋 — 이 갈래에선 다 참이지만, 계획이 «꺼진 프레임» 도 표현할 수 있어야
      // 유예가 끝난 다음 프레임(카메라 정지)을 자가 같은 함수로 잰다.
      hasStream: Boolean(cameraStream),
      runtimeEnabled: r2Runtime.enabled,
      hasView: Boolean(view),
      phase,
      n,
      overlayGeom,
      isoGeom,
      corrGridOk,
      // 페이드인 α (⑩) — 시계는 여기서 주입한다. 재사영이 아니라 «새 락» 이 시각을 잡는다.
      lockAlpha: fadeAlpha(nowMs(), r2Hud.lockedAt, R2_HUD_FADE_MS),
      distrusted,
    });
    /*
     * 표시 판정은 **순수 함수**에 있고(⑯(i) · hudSurfaceVisibility, 이제 계획 안), 그 값을 세
     * 표면의 `hidden` 으로 옮기는 것도 **순수 이음새**다 (`applyHudSurfaces`). 옛 자리는 여기
     * 세 대입이었고 — 판정이 계획으로 옮겨간 뒤에도 그 세 줄만은 무자로 남아, 오버레이를
     * `hidden = true` 로 못박아도 표적 전부가 초록이었다 (3b 검토 F1). 이제 이음새 하나를
     * 평범한 객체 셋으로 밀어 「판정 → 실제 표시」를 값으로 잰다.
     *   · 미니 HUD·셀맵은 R2 켬 + 카메라면 **항상** 보인다 (점진 표시가 SEARCHING 부터 시작한다).
     *   · 전면 오버레이는 «그릴 H 가 있는 위상» ∨ «정정 강조가 살아 있음». 후자가 DONE 위상에서도
     *     오버레이를 여는 유일한 입력이고, 그 프레임이 실제로 합성되도록 ⑯(i) 가 닫기를 미룬다.
     * 위상은 CSS 가 읽는다(스캔선).
     */
    applyHudSurfaces(r2HudSurfaces, plan.surfaces);
    if (r2HudMini.dataset.phase !== phase) r2HudMini.dataset.phase = phase;
    // 상자 테두리도 같이 갈린다 — 캔버스 안 점선만으로는 140px 미니에서 눈에 안 든다 (CSS 는 index.html).
    const distrustFlag = distrusted ? '1' : '0';
    if (r2HudMini.dataset.distrust !== distrustFlag) r2HudMini.dataset.distrust = distrustFlag;

    /*
     * 채움을 **아무도 안 그릴 위상**(SEARCHING·DROPPED)에서는 Path2D 를 만들지도 않는다. 락 상실 코스팅 중에는
     * view.n 이 남아 있어서 조건이 서고, n=25 면 마름모 1875개를 매 프레임 헛만든다 — 가장 흔한 위상에서.
     * 미니의 채움 위상은 오버레이와 다르다(점진 표시의 마지막 두 칸뿐) — 그래서 계획이 조건을 따로 내고,
     * 둘 중 하나라도 참일 때만 격자를 한 번 걷는다. 둘 다 참인 프레임(DATA·FINALIZING)에서만 마름모가 두 벌이다.
     */
    const gridPath = new Path2D();
    const outlinePath = new Path2D();
    const miniGridPath = new Path2D();
    const miniOutlinePath = new Path2D();
    r2HudPaths.clear();
    r2HudMiniPaths.clear();
    if (grids && n > 0 && r2HudIso.n === n && (plan.overlayFills || plan.miniFills)) {
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          const idx = j * n + i;
          const role = grids.roleGrid[idx];
          if (role === HUD_ROLE.EMPTY) continue;
          let state = CELL_MAP_STATE.UNOBSERVED;
          if (role === HUD_ROLE.DATA) {
            const k = grids.scanGrid[idx];
            if (k >= 0 && view.cellMap && k < view.cellMap.length) state = view.cellMap[k];
          }
          const key = bucketKey(role, state, tentative);
          if (key === null) continue;
          for (let f = 0; f < HUD_FACES.length; f += 1) {
            /*
             * 면마다 **설계 톤**이 다르다 (H2 · 운영자 요구 ⑧). 톤이 있으면 «묶음 + 톤» 이 칠 키가 되고,
             * 없으면(HUD_TONE_NONE) 역할 기준색 묶음으로 떨어진다. 색이 없는 키는 그리지 않는다 — 경로도
             * 만들지 않는다 (r2-hud.test ⓒ 와 같은 규율: 색표가 묶음을 다 덮어야 조용한 구멍이 안 생긴다).
             */
            const tone = grids.toneGrid[hudToneSlot(n, f, i, j)];
            const paintKey = tone === HUD_TONE_NONE ? key : key + R2_HUD_TONE_SEP + tone;
            if (!R2_HUD_BUCKET_PAINT.has(paintKey)) continue;
            const slot = faceQuadSlot(n, f, i, j);
            if (plan.overlayFills) appendR2HudQuad(r2HudPaths, paintKey, quads, slot);
            if (plan.miniFills) appendR2HudQuad(r2HudMiniPaths, paintKey, r2HudIso.quads, slot);
          }
        }
      }
    }
    /*
     * 🔴 **RS 정정 강조의 경로** (3b). 셀 목록이 짧아서(정정 수 × 3) 격자를 다시 걷지 않는다 —
     * 스캔 순번 → 격자 칸을 역표로 곧장 물어 그 칸의 세 면만 잇는다.
     *
     * ⚠ 경로 객체는 **그릴 게 있을 때만** 만든다 (3b 검토 F16). 위 채움 경로가 세운 규율과 같다:
     * 정정 없는 프레임(거의 전부)에서 Path2D 두 개를 헛만들면 그것이 매 프레임 할당이다.
     * 「그릴 게 있나」는 계획이 이미 답했다 — 두 표면 중 하나라도 열렸을 때만 걷는다.
     */
    let corrPath = null;
    let corrMiniPath = null;
    let corrCells = 0;
    if (plan.overlayCorrection || plan.miniCorrection) {
      corrPath = new Path2D();
      corrMiniPath = new Path2D();
      const inverse = r2Hud.scanInverse;
      for (let c = 0; c < r2Correction.cells.length; c += 1) {
        const k = r2Correction.cells[c];
        const idx = (Number.isInteger(k) && k >= 0 && k < inverse.length) ? inverse[k] : -1;
        if (idx < 0) continue;
        const i = idx % n;
        const j = (idx - i) / n;
        corrCells += 1;
        for (let f = 0; f < HUD_FACES.length; f += 1) {
          const slot = faceQuadSlot(n, f, i, j);
          if (plan.overlayCorrection) appendR2HudQuadInto(corrPath, quads, slot);
          if (plan.miniCorrection) appendR2HudQuadInto(corrMiniPath, r2HudIso.quads, slot);
        }
      }
    }
    // 계획이 «그린다» 고 해도 역표가 한 칸도 못 짚으면 그릴 것이 없다 (수는 맞고 자리는 모른다).
    const corrOverlay = corrCells > 0 && plan.overlayCorrection;
    const corrMini = corrCells > 0 && plan.miniCorrection;

    if (plan.overlayGrid && r2Hud.lines) appendR2HudLines(gridPath, r2Hud.lines, gridLineCount(n));
    if (plan.miniGrid && r2HudIso.lines && r2HudIso.n === n) {
      appendR2HudLines(miniGridPath, r2HudIso.lines, gridLineCount(n));
    }
    if (view.H && r2Hud.n === n && n > 0) appendR2HudOutline(outlinePath, r2Hud.outline);
    // 미니 실루엣은 **락과 무관하게** 늘 있다 (락 전엔 단위 육각) — 그래서 «찾는 중» 에도 자리를 알린다.
    const haveIso = appendR2HudOutline(miniOutlinePath, r2HudIso.outline)
      && finiteBoundsInto(r2HudIso.outline, 6, r2HudBounds);

    // 스테이지 정사각 한 변 — renderGuideDots 와 **같은 방식**이다 (분석 프레임 ≡ 화면 정사각, 설계 불변식).
    // 다만 매 프레임 재는 대신 캐시를 읽는다 (바로 위에서 hidden·data-phase 를 썼고 칩도 방금 바뀌어, 여기서
    // rect 를 읽으면 프레임마다 **강제 동기 레이아웃**이 든다 — 크기는 리사이즈에만 바뀐다).
    const side = squareSideOf(cameraStage, R2_SIDE_STAGE);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    /*
     * 3d — 불신이면 **채움만** 더 눕힌다: 선은 색·점선으로 갈리고 채움은 α 로 갈린다.
     * 두 표면(오버레이·미니)이 계획의 **같은 수**를 쓴다 — 한쪽만 눕히면 「같은 상태의 두 그림」이
     * 다른 말을 한다 (배율·유도는 `hudPaintPlan` 이 쥐고, test/r2-hud-paint.test ⓐ⑤ 가 값으로 잰다).
     */
    const paintAlpha = plan.paintAlpha;
    /*
     * ⚠ 게이트가 `corrOverlay` 가 아니라 **`plan.overlayOpen`** 인 이유: 위에서 캔버스를 같은 판정으로
     * 열었으므로, 여기서 더 좁은 조건을 쓰면 「보이는데 안 지운 캔버스」(옛 프레임 잔상)가 남는다.
     * 그릴 게 없으면 `clearRect` 만 하고 끝난다 — 그것이 이 자리의 옳은 일이다.
     */
    if (plan.overlayOpen && side > 0 && r2Hud.frameW > 0 && r2Hud.frameH > 0) {
      const backing = Math.round(side * dpr);
      // width/height 대입은 캔버스를 **지운다** — 달라졌을 때만 건드린다.
      if (r2HudCanvas.width !== backing) r2HudCanvas.width = backing;
      if (r2HudCanvas.height !== backing) r2HudCanvas.height = backing;
      const ctx = r2HudCanvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, backing, backing);
        // ⚠ 나누는 폭은 **사영한 프레임**의 것이다 (r2Hud.frameW). view.frameWidth 는 매 프레임 현재 luma 폭이라
        // 사영을 안 다시 푼 프레임에서 그것으로 나누면 그림이 다른 배율로 좌상단에 붙는다 — 사영은 그대로인데 자만 바뀌므로.
        const sx = backing / r2Hud.frameW;
        const sy = backing / r2Hud.frameH;
        ctx.setTransform(sx, 0, 0, sy, 0, 0);
        paintR2HudBuckets(ctx, paintAlpha, r2HudPaths);
        // 선폭·점선 간격은 화면 CSS px 고정 — 변환 역수로 되돌린다(dpr 은 backing 에 이미 들어 있다).
        setR2HudStroke(ctx, distrusted, R2_HUD_GRID_STROKE, dpr / sx);
        ctx.lineWidth = dpr / sx;
        ctx.stroke(gridPath);
        setR2HudStroke(ctx, distrusted, R2_HUD_OUTLINE_STROKE, dpr / sx);
        ctx.lineWidth = (2 * dpr) / sx;
        ctx.stroke(outlinePath);
        // 3b — 정정 강조는 **맨 위**다: 아래 층(역할·데이터 색)이 그 셀을 이미 칠했으므로 덮어야 보인다.
        if (corrOverlay) {
          paintCorrectionLayer(ctx, corrPath, plan.correctionAlpha, dpr / sx, R2_HUD_CORRECTION_STYLE);
        }
        // 점선은 이 캔버스 컨텍스트에 남는다 — 다음 프레임이 실선으로 돌아가도 되게 여기서 되돌린다.
        ctx.setLineDash(R2_HUD_SOLID_DASH);
        ctx.globalAlpha = 1;
      }
    }

    // 우측 미니 HUD — **아이소메트릭 기준**(⑪). 락 H 사영이 아니라 항등 H 기하를 bbox 에 맞춰 채운다. 한 변은 캐시.
    const miniSide = squareSideOf(r2CellMapCanvas, R2_SIDE_MINI);
    if (miniSide > 0) {
      const miniBacking = Math.round(miniSide * dpr);
      if (r2CellMapCanvas.width !== miniBacking) r2CellMapCanvas.width = miniBacking;
      if (r2CellMapCanvas.height !== miniBacking) r2CellMapCanvas.height = miniBacking;
      const mctx = r2CellMapCanvas.getContext('2d');
      if (mctx) {
        mctx.setTransform(1, 0, 0, 1, 0, 0);
        mctx.clearRect(0, 0, miniBacking, miniBacking);
        const boxW = r2HudBounds[2] - r2HudBounds[0];
        const boxH = r2HudBounds[3] - r2HudBounds[1];
        if (haveIso && boxW > 0 && boxH > 0) {
          const pad = 8 * dpr;
          const scale = Math.min((miniBacking - 2 * pad) / boxW, (miniBacking - 2 * pad) / boxH);
          const originX = (miniBacking - boxW * scale) / 2 - r2HudBounds[0] * scale;
          const originY = (miniBacking - boxH * scale) / 2 - r2HudBounds[1] * scale;
          mctx.setTransform(scale, 0, 0, scale, originX, originY);
          // 락 전(n 미상)·DROPPED 엔 실루엣만 옅게 — «찾는 중» 의 자리만 알린다. 스캔선은 CSS 가 맡는다.
          if (plan.miniIdle) {
            mctx.globalAlpha = R2_HUD_MINI_IDLE_ALPHA;
            // idle 위상(SEARCHING·DROPPED)에는 «불신» 이 뜻이 없다 — hudDistrusted 가 이미 그 셋을 뺐다.
            setR2HudStroke(mctx, false, R2_HUD_OUTLINE_STROKE, dpr / scale);
            mctx.lineWidth = dpr / scale;
            mctx.stroke(miniOutlinePath);
            mctx.globalAlpha = 1;
          } else {
            // 점진 표시(운영자 원 요구): 실루엣 → 격자 → 역할색 → 데이터. 위상이 그 순서를 탄다.
            // DONE 위상이 여기 오는 경로는 하나뿐이다 — 정정 강조 재렌더(3b · 계획이 채움을 연다).
            // 그 밖의 DONE 뒤엔 결과 시트가 덮는다(⑨).
            if (plan.miniFills) paintR2HudBuckets(mctx, paintAlpha, r2HudMiniPaths);
            if (plan.miniGrid) {
              mctx.globalAlpha = plan.lockAlpha;
              setR2HudStroke(mctx, distrusted, R2_HUD_GRID_STROKE, dpr / scale);
              mctx.lineWidth = dpr / scale;
              mctx.stroke(miniGridPath);
            }
            mctx.globalAlpha = plan.lockAlpha;
            setR2HudStroke(mctx, distrusted, R2_HUD_OUTLINE_STROKE, dpr / scale);
            mctx.lineWidth = (2 * dpr) / scale;
            mctx.stroke(miniOutlinePath);
            // 3b — 오버레이와 **같은 함수·같은 α**. 미니는 항등 H 라 카메라 자세와 무관하게 같은 칸을 짚는다.
            if (corrMini) {
              paintCorrectionLayer(mctx, corrMiniPath, plan.correctionAlpha, dpr / scale, R2_HUD_CORRECTION_STYLE);
            }
            mctx.setLineDash(R2_HUD_SOLID_DASH);
            mctx.globalAlpha = 1;
          }
        }
      }
    }
  }
  // 비용 — 한 번의 ms 와 세션 최대. 시험판 하단 패널의 hud 줄이 이 둘을 읽는다.
  const ms = nowMs() - startedAt;
  r2Hud.lastMs = ms;
  if (ms > r2Hud.maxMs) r2Hud.maxMs = ms;
}

/*
 * 엔진 스위치 — 제품 컴포넌트 (§27.4 1단계 · 운영자 요구 ⑤). 뷰파인더 상단 중앙 «스캐너 엔진 선택»
 * role=switch. **R2 위치 = R2 누적 + QR 만, R1 단발 끔 · R1 위치 = R1 단발만** (운영자 결정 ② · 2026-09-05,
 * 잠긴 결론 — R2 위치에서 다른 TL 타입(K·C·Y 단발)은 읽히지 않는다).
 * **2026-09-06 승격** — 정식에서도 스위치가 뜨고, 저장값이 없는 첫 방문의 기본 엔진은 R2 다
 * (결정 ① · `resolveEngineChoice` 의 기본 켬이 그대로 정식의 기본이다). 선택은 localStorage(새 키).
 */
const engineSwitch = document.getElementById('engine-switch');
const engineSwitchControl = document.getElementById('engine-switch-control');
if (engineSwitch && engineSwitchControl && r2Available) {
  engineSwitch.hidden = false;
  const paintEngineSwitch = () => {
    engineSwitchControl.setAttribute('aria-checked', String(r2Runtime.enabled));
    engineSwitchControl.dataset.engine = r2Runtime.enabled ? 'r2' : 'r1';
  };
  paintEngineSwitch();
  engineSwitchControl.addEventListener('click', () => {
    /*
     * ⑯(i) — 정정 강조 유예 중이면 **먼저 끝낸다** (manualRescan 과 같은 규약). 이 핸들러는 아래에서
     * 래치·정정을 비우고 엔진을 바꾸는데, 유예를 남겨 두면 600 ms 뒤의 만료 콜백이 **방금 바꾼**
     * 카메라를 끄고 결과 시트를 띄운다 — 사용자가 한 일과 아무 상관없는 정지다.
     * 여기서 `stopCamera()` 를 부르면 gate 가 회수되어 읽은 결과가 그 자리에서 확정되고(결과 시트),
     * 타이머는 죽는다. 엔진 전환 자체는 그 뒤에 그대로 일어난다.
     */
    if (acceptStopGate.isPending()) stopCamera();
    r2Runtime.setEnabled(!r2Runtime.enabled);
    // ⚠ **시각 상태를 먼저** (⑤) — 아래의 무거운 렌더(패널·셀맵·문구)보다 앞이어야 이 태스크가
    // 끝나는 순간 스위치가 이미 새 위치에 있다. 순서만 바뀌었고 하는 일은 같다.
    paintEngineSwitch();
    // 켜든 끄든 QR 브리지·힌트도 버린다 — off 직후 늦은 QR 결과가 뜨거나 옛 힌트가 R1 을 계속
    // 편향하면 «R2 off = 기준선» 이 거짓이 된다 (R2 의 setEnabled 와 같은 «전환 시 증거 폐기»).
    qrBridge.reset();
    runtimeFamilyHint = null;
    // DONE 래치도 버린다 — 엔진을 바꾼 뒤 옛 확정 값이 남으면 다른 엔진의 결과처럼 읽힌다.
    r2Latched = null;
    r2Correction = null;
    // 거부 유예도 버린다 — 그 처방은 옛 엔진 위치의 것이다.
    r2StatusHoldUntil = -Infinity;
    // R2 가 상태줄을 «모으는 중» 으로 잡고 있었다면 돌려준다 — R1 위치에선 R1 상태 기계가 다시 맡는다.
    if (r2StatusCollecting) {
      r2StatusCollecting = false;
      if (cameraStream) setStatus(t('status.aim'));
    }
    try { window.localStorage.setItem(ENGINE_STORAGE_KEY, r2Runtime.enabled ? '1' : '0'); }
    catch { /* 저장 실패해도 이번 세션엔 적용된다 */ }
    // 인디케이터·셀맵도 즉시 반영한다 — 끄면 숨고, 켜면 0 부터 다시 찬다.
    renderR2Progress();
    renderR2CellMap();
    // 범위 안내도 스위치를 따른다 (요구 ②). 하단 카드 한 장 규칙도 여기서 다시 적용된다.
    refreshScanGuideCopy();
    // ⚠ 마지막 줄 — 다음 rAF 한 번을 통째로 양보해 위의 페인트가 실제로 화면에 닿게 한다.
    // R1 위치에선 이 한 프레임이 없으면 페인트가 다음 동기 복호(1.4\~2.8 s) 뒤로 밀린다.
    yieldFrameOnce = true;
  });
}
/*
 * 수동 리셋 (§27.4 · 운영자 요구 ⑫ · 실기 3차 ③) — 「지금까지 모은 것을 버리고 처음부터」.
 *
 * 왜 필요한가: 큰 코드(가이드 크기)에서 수집은 되는데 리셋이 반복될 때, 사용자에게 **개입할 손잡이가
 * 없었다**. 자동 폐기 경로(코스트·후보 인내·거부)는 전부 기계가 정하고, 사람은 카메라를 껐다 켜는
 * 것 말고 할 수 있는 게 없었다.
 *
 * 두 입구가 **같은 함수**를 부른다 — 버튼(#scan-reset)과 뷰파인더 중앙 탭(⑫). 입구를 둘로 두고 동작을
 * 둘로 두면 「버튼은 되는데 탭은 반쯤 된다」 가 된다.
 *
 * ⚠ 이것은 `r2Runtime.invalidateLock()`(자세만 버림, H4) 과 **다른 것**이다: 여기서는 세션·누적 증거까지
 *   전부 버린다. 사용자가 「처음부터」 라고 말한 것이므로 반쯤 남기지 않는다.
 */
const scanResetButton = document.getElementById('scan-reset');

function manualRescan() {
  /*
   * ⑯(i) — 정정 강조 유예 중이면 「처음부터」보다 **이미 읽은 답이 먼저**다. 유예를 지금 끝내
   * (stopCamera 가 gate.take 로 결과 시트를 이어 붙인다) 확정하고, 아래 초기화는 그 뒤의 빈 화면을
   * 위한 것이 된다. 사용자가 리셋을 눌렀다는 이유로 읽은 결과를 버리면 그건 리셋이 아니라 유실이다.
   * 늦은 타이머가 카메라를 두 번 끄지도 않는다 — 회수는 한 번뿐이다.
   */
  if (acceptStopGate.isPending()) stopCamera();
  // R2 — 누적기·후보·락·래치·상태 위상을 전부 버린다 (startFrameLoop 의 새 세션 비우기와 같은 목록).
  r2Runtime.reset();
  qrBridge.reset();
  runtimeFamilyHint = null;
  r2Latched = null;
  // 3b 검토 F11 — 정정 강조도 같이 버린다. 「처음부터」라고 해 놓고 옛 DONE 이 지목한 셀이
  // 남으면 새 화면이 없는 결함을 가리킨다 (`startFrameLoop` · 스위치 · 거부와 **같은 목록**).
  r2Correction = null;
  r2StatusCollecting = false;
  r2StatusHoldUntil = -Infinity;
  /*
   * R1 위치의 **시도 단위** 상태 — 포즈 carry · 실패/잘림 시간 · daehan 폴백 · 자동 크롭 사다리.
   * 목록은 `beginScanAttempt` 와 같다: 남으면 「처음부터」 라고 해 놓고 새 첫 프레임이 이전 실패의
   * 시간을 상속해 사다리를 올린 채 시작한다. beginScanAttempt 자체를 부르지 않는 이유는 그것이
   * attemptId·비컨(scan_start)까지 새로 만들기 때문이다 — 리셋은 계측상 새 «시도» 가 아니다.
   */
  lastFramePose = null;
  resetFailureTiming();
  daehanFallbackState = DAEHAN_FALLBACK_INITIAL_STATE;
  if (autoCropIndex !== 0) {
    autoCropIndex = 0;
    // 프리뷰를 같은 값으로 즉시 재동기화 (§effectiveCropZoom 의 «가이드 = 분석» 불변식).
    syncPreviewTransform();
  }
  // 안정 유지도 처음부터 — 옛 유지 시간이 남으면 리셋 직후에 트리거가 걸려 「맞췄다」 가 거짓이 된다.
  steady.reset();
  statusOwnedBySteady = false;
  clearSteadyMeter();
  // HUD 상태 — 재사영 스냅샷·역할 격자·위상을 버리고 «지금» 을 한 번 그린다 (다음 프레임까지 옛 그림이 남지 않게).
  hideR2Hud();
  renderR2Progress();
  renderR2CellMap();
  if (cameraStream) setStatus(t('status.aim'));
}

if (scanResetButton && r2Available) {
  scanResetButton.addEventListener('click', () => { manualRescan(); });
  /*
   * 뷰파인더 **중앙 탭** (⑫) — 기하 판정은 순수 함수(`stageTapIsCentre`)가 하고, 여기서는 DOM 만 안다:
   * 카메라가 켜져 있는가 · 그 탭이 상단 행이나 리셋 버튼(자기 핸들러를 가진 컨트롤) 위였는가.
   * 스테이지는 정사각이지만 rect 가 정확히 정사각이 아닐 수 있어(소수점 · 테두리) 짧은 변을 기준으로
   * 가운데 정사각을 잡는다 — renderGuideDots·HUD 와 **같은 기하**다.
   */
  cameraStage.addEventListener('click', (event) => {
    if (!cameraStream) return;
    const target = event.target;
    if (target && target !== cameraStage && typeof target.closest === 'function'
      && target.closest('#stage-top-row, #scan-reset')) return;
    const rect = cameraStage.getBoundingClientRect();
    const stageSide = Math.min(rect.width, rect.height);
    const x = event.clientX - rect.left - (rect.width - stageSide) / 2;
    const y = event.clientY - rect.top - (rect.height - stageSide) / 2;
    if (!stageTapIsCentre(x, y, stageSide)) return;
    manualRescan();
  });
}

// 기대 톤 — 레이아웃 카드와 같은 배선. 2·3 만 유효, 그 외(모름 포함)는 null(미상)이다.
let expectedTones = null;
const expectedTonesRoot = document.getElementById('lab-expected-tones');
if (expectedTonesRoot && isLabPath()) {
  for (const button of expectedTonesRoot.querySelectorAll('[data-expected-tones]')) {
    button.addEventListener('click', () => {
      const next = Number(button.dataset.expectedTones);
      expectedTones = next === 2 || next === 3 ? next : null;
      for (const other of expectedTonesRoot.querySelectorAll('[data-expected-tones]')) {
        other.classList.toggle('active', other === button);
      }
    });
  }
}
gateChooseImageButton.addEventListener('click', openImagePicker);
imageInput.addEventListener('change', () => {
  void decodeImageFile(imageInput.files && imageInput.files[0]);
});
rescanButton.addEventListener('click', () => {
  // 재스캔도 제스처 경로다 (결과 화면에서 돌아오는 흐름 — 자동 시작으로 센서가 지연됐다면
  // 여기가 그 다음 기회다).
  void attachMotionAssist({ userGesture: true });
  hideResult({ restoreFocus: false });
  void startCamera({ automatic: false });
});
closeResultButton.addEventListener('click', closeResult);
closeResultSecondaryButton.addEventListener('click', closeResult);
openUrlLink.addEventListener('click', (event) => {
  if (activeUrl === '') event.preventDefault();
});
resultPanel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeResult();
});

// K/C 가이드는 기하가 실제로 바뀌거나 사용자가 유형을 고를 때 다시 그린다 — 비디오 메타데이터 도착,
// 프레임 크기 변화(HTMLVideoElement 'resize' — 회전 시 vW/vH 스왑), 뷰포트 리사이즈,
// 그리고 첫 grab 성공(startFrameLoop, 작업 4). 줌 변화는 정사각 뷰 크기와 무관해
// 트리거가 아니다. 정사각 뷰 한 변은 뷰포트에만 의존하므로 window resize 로 충분하다.
cameraVideo.addEventListener('loadedmetadata', renderGuideDots);
cameraVideo.addEventListener('resize', renderGuideDots);
window.addEventListener('resize', renderGuideDots);
window.addEventListener('orientationchange', renderGuideDots);

/*
 * 패널 내부 스크롤 힌트 (r5). r5 재배열로 잘리는 쪽이 «설명 문구» 가 됐는데, 잘렸다는
 * 사실을 안 보여 주면 안내가 애초에 없는 화면처럼 읽힌다. 하단 페이드(index.html
 * `.scanner-panels.has-more`)를 켤지 말지만 여기서 정한다.
 *
 * 판정은 «아래에 더 있나» 다. 스크롤 위치가 맨 위인 평상 상태에서는 이것이 곧
 * `scrollHeight > clientHeight`(= 내부 오버플로) 이고, 끝까지 내리면 저절로 꺼진다 —
 * 끝에서도 페이드가 남으면 «아직 더 있다» 는 거짓말이 된다.
 *
 * 관측 전용이다: 클래스 하나만 토글하고 레이아웃·전송·디코딩 경로는 건드리지 않는다.
 */
function syncPanelScrollHint() {
  const more = scannerPanels.scrollTop + scannerPanels.clientHeight < scannerPanels.scrollHeight - 1;
  scannerPanels.classList.toggle('has-more', more);
}
scannerPanels.addEventListener('scroll', syncPanelScrollHint, { passive: true });
window.addEventListener('resize', syncPanelScrollHint);
window.addEventListener('orientationchange', syncPanelScrollHint);
/*
 * ⚠ 패널 **자신**만 관찰하면 부족하다. 콘텐츠가 늘어나는 사건(줌 컨트롤 노출·렌즈
 *   선택 등장·상태 문구 줄바꿈)은 이미 넘친 패널의 clientHeight 를 안 바꾸고
 *   scrollHeight 만 늘리기 때문에 관찰자가 안 깨어난다. 자식까지 함께 본다.
 */
if (typeof ResizeObserver === 'function') {
  const panelResizeObserver = new ResizeObserver(syncPanelScrollHint);
  panelResizeObserver.observe(scannerPanels);
  for (const panelChild of scannerPanels.children) panelResizeObserver.observe(panelChild);
}
syncPanelScrollHint();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopCameraForLifecycle();
    return;
  }

  void recoverCameraAfterResume();
});
window.addEventListener('pagehide', stopCameraForLifecycle);
window.addEventListener('pageshow', () => {
  void recoverCameraAfterResume();
});
document.addEventListener('resume', () => {
  void recoverCameraAfterResume();
});

void initialiseCamera();
