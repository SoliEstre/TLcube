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
import { immediateCornerQrHint } from '/src/scanner-scan-assist.js';
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
import { createR2ScanRuntime } from '/src/r2-scan-runtime.js';
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
export const SCANNER_BUILD = '2026-09-05.01';

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
    !scanGuideMessage || !scanGuideDetail ||
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
let lastDecodeAt = 0;
/** 직전 grab부터 결과 처리까지의 전체 프레임 비용. 다음 시작 간격의 적응 입력이다. */
let lastFrameCostMs = 0;
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
 * ⚠ `isLabPath()` 로만 켠다. 정식 경로에서는 `enabled === false` 라 프레임 루프의
 * R2 블록이 첫 줄에서 반환하고 **grab 도 안 한다** — 제어 흐름이 완전히 불변이다.
 */
const R2_TOGGLE_KEY = 'tlscan.lab.r2Accumulate';
let r2Wanted = true;   // 시험판 기본은 **켬** — 이 표면의 존재 이유가 R2 실기다.
try {
  // 저장된 값이 '0' 일 때만 끈다. 없으면 켬 (daehan 토글과 기본값이 반대인 이유는
  // 그쪽이 «구멍이 있는 옵트인» 이고 이쪽은 «시험판의 주 기능» 이라서다).
  if (window.localStorage.getItem(R2_TOGGLE_KEY) === '0') r2Wanted = false;
} catch { /* 저장소 접근 불가는 스캔을 막지 않는다 — 기본 켬 */ }
const r2Runtime = createR2ScanRuntime({ enabled: isLabPath() && r2Wanted });

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

function scanVia(result) {
  const hypothesis = result && result.hypothesis;
  return hypothesis && (hypothesis.centerQr === true || /qr/i.test(hypothesis.source || ''))
    ? 'qr'
    : 'cube';
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
    if (!resultPanel.hidden && lastResult !== null) showResult(lastResult);
    if (!zoomControls.hidden) refreshZoomChrome();
    // 렌즈 선택지도 JS 가 채운다 — 권한 전에는 기기 이름이 없어 «카메라 1» 같은
    // 대체 이름을 우리가 붙이므로, 언어가 바뀌면 다시 그려야 한다.
    refreshCameraChoices();
    refreshScanGuideCopy();
  },
});
const t = (key) => i18n.t(key);
let lastResult = null;
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
    const runPass = (daehan) => decodeFrontend(raster, {
      onStage: (stageName, phase) => clock.onStage(stageName, phase),
      // QR 힌트는 선택지를 줄이는 보조 증거일 뿐이다. 미지·부재는 키 자체를 생략해
      // 종전의 무힌트 탐색 경로를 바이트 단위로 보존한다.
      ...(scannerFamilyEvidence === null ? {} : { familyEvidence: scannerFamilyEvidence }),
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
 * 안정 게이지 표시. 정식 화면의 유일한 추가 UI 이고, 값은 전부 기기 안 로컬이다.
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

function stopCamera() {
  scanSession += 1;
  cameraRequestPending = false;
  isDecoding = false;
  lastDecodeAt = 0;
  lastFrameCostMs = 0;

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

function normalizePayload(result) {
  if (!result || result.ok !== true || typeof result.payload !== 'string' || result.payload === '') {
    return null;
  }
  return result.payload;
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
  stopCamera();
  showResult(payload);
  setStatus(t('status.decoded'));
}

function startFrameLoop(session) {
  // 작업 4: 첫 프레임 grab 성공 시 가이드 재렌더. loadedmetadata 는 기기에 따라
  // 레이아웃 확립보다 이르다 — grab 이 성공했다는 것은 videoWidth/Height 와 스테이지
  // 레이아웃이 실재한다는 가장 강한 증거라, 그 시점에 한 번 더 그린다.
  let firstGrabRendered = false;

  const nextFrame = (timestamp) => {
    if (session !== scanSession || !cameraStream || document.visibilityState === 'hidden') {
      return;
    }

    /*
     * ── R2(LTC) 독립 캐던스 (S5 · PM/029B §22·§23) ─────────────────────────
     *
     * 🔴 **`!isDecoding` 게이트 «밖»** 이어야 한다. 옛 안(S2)은 그 안에 있었고,
     * 그래서 R2 가 「카메라 프레임당」이 아니라 「단발 복호 1사이클당」 한 장을 받았다 —
     * 복호가 1.4\~2.8초이므로 누적기가 단발보다 프레임을 더 볼 방법이 **구조적으로
     * 없었다** (PM/029 §6.5.1). 여기가 그 수리다.
     *
     * ⚠ **플래그가 꺼져 있으면 아래 R1 블록의 제어 흐름이 완전히 불변**이다.
     * `r2Runtime.enabled` 가 false 면 이 블록은 첫 줄에서 반환하고 grab 도 안 한다.
     * 그 성질을 `test/r2-scan-runtime.test.js` 가 잰다.
     *
     * ⚠ grab 을 R1 과 **공유하지 않는다.** 공유하려면 R1 의 캐던스·비용 계산을
     * 건드려야 하고, 그건 플래그 off 에서도 동작이 달라진다는 뜻이다. 시험판
     * 한정 기능을 위해 정식 경로의 타이밍을 바꾸지 않는다 — 중복 grab 비용은
     * 시험판에서만 든다.
     */
    if (r2Runtime.enabled) {
      const r2Image = grabVideoFrame(nowMs());
      if (r2Image) {
        try {
          const r2Luma = toRelativeLuminance({
            width: r2Image.width,
            height: r2Image.height,
            pixels: r2Image.data,
          }, { rejectLowDynamicRange: false });
          if (r2Luma && r2Luma.ok !== false) {
            const hit = r2Runtime.pushFrame(r2Luma, timestamp);
            renderR2Progress();
            if (hit && typeof hit.text === 'string') {
              // R2 가 먼저 읽었다. 결과 경로는 R1 과 **같은 문**을 쓴다 —
              // 새 표시 경로를 만들면 두 경로가 어긋난다.
              handleDecodeResult(
                { ok: true, text: hit.text, source: 'r2' },
                'camera',
                session,
              );
              return;
            }
          }
        } catch {
          // R2 는 부가 경로다. 어떤 실패도 단발 스캔을 막지 않는다.
        }
      }
    }

    const intervalMs = adaptiveFrameIntervalMs(lastFrameCostMs);
    if (!isDecoding && timestamp - lastDecodeAt >= intervalMs) {
      const frameStartedAt = nowMs();
      const imageData = grabVideoFrame(frameStartedAt);

      if (imageData) {
        noteProductFrame();
        if (!firstGrabRendered) {
          firstGrabRendered = true;
          renderGuideDots();
        }
        lastDecodeAt = timestamp;
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
            if (session !== scanSession) return;
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
              isDecoding = false;
            }
            noteFrameProcessed();
          });
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

function renderUrlPayload(payload) {
  const url = payload.trim();
  const opened = tryOpenUrl(url);
  activeUrl = url;
  openUrlLink.href = url;
  popupFallback.hidden = opened;

  setResultTitle(t('result.url.title'));
  addResultIntro(opened ? t('result.url.opened') : t('result.url.manual'));

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

function showResult(payload) {
  // 언어 전환 시 이 패널을 같은 내용으로 다시 그리기 위해 보관한다.
  lastResult = payload;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  activeUrl = '';
  popupFallback.hidden = true;
  openUrlLink.href = '#';
  resultContent.replaceChildren();

  let sniffed = { kind: 'text' };
  try {
    sniffed = sniffPayload(payload);
  } catch {
    sniffed = { kind: 'text' };
  }

  if (sniffed.kind === 'url') {
    renderUrlPayload(payload);
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
 * R1/R2 토글 (2026-09-04, 운영자 요구). **시험판 전용 · 기본 켬.**
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
 * R2 진행 인디케이터 렌더 (PM/029 §17). **시험판 전용.**
 *
 * 표시 후퇴 금지(A6): D 가 내려가도 폭을 줄이지 않는다 — 사용자에게 「되돌아갔다」는
 * 신호는 조준을 망친다. 드랍(후보 폐기)일 때만 0 으로 되돌린다.
 * 값은 기기 안 로컬 계산이고 전송 경로가 없다 (안정 게이지와 같은 규약).
 */
const r2ProgressRoot = document.getElementById("r2-progress");
const r2ProgressFill = document.getElementById("r2-progress-fill");
const r2ProgressNote = document.getElementById("r2-progress-note");
let r2ShownD = 0;
function renderR2Progress() {
  if (!r2ProgressRoot || !isLabPath()) return;
  if (!r2Runtime.enabled) {
    r2ProgressRoot.hidden = true;
    r2ShownD = 0;
    return;
  }
  r2ProgressRoot.hidden = false;
  const stats = r2Runtime.stats;
  // 후보가 없으면(락 없음·폐기) 0 으로 되돌린다 — 후보가 없는데 막대가 차 있으면 거짓말이다.
  const d = stats.candidateCount > 0 ? stats.progressD : 0;
  r2ShownD = d === 0 ? 0 : Math.max(r2ShownD, d);
  if (r2ProgressFill) r2ProgressFill.style.width = `${Math.round(Math.min(1, r2ShownD) * 100)}%`;
  if (r2ProgressNote) {
    r2ProgressNote.textContent = stats.candidateCount > 0
      ? `n${stats.lockedN}·${stats.candidateCount}`
      : "";
  }
}

const r2Toggle = document.getElementById('lab-r2-toggle');
if (r2Toggle && isLabPath()) {
  r2Toggle.hidden = false;
  const paintR2 = () => {
    r2Toggle.setAttribute('aria-pressed', String(r2Runtime.enabled));
    r2Toggle.classList.toggle('active', r2Runtime.enabled);
  };
  paintR2();
  r2Toggle.addEventListener('click', () => {
    r2Runtime.setEnabled(!r2Runtime.enabled);
    try { window.localStorage.setItem(R2_TOGGLE_KEY, r2Runtime.enabled ? '1' : '0'); }
    catch { /* 저장 실패해도 이번 세션엔 적용된다 */ }
    paintR2();
    // 인디케이터도 즉시 반영한다 — 끄면 숨고, 켜면 0 부터 다시 찬다.
    renderR2Progress();
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
