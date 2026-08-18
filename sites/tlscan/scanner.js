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
import { createI18n, wireLanguageSwitch } from '/src/i18n.js';
import { createBeacon } from '/src/beacon.js';
import { SCANNER_STRINGS } from './strings.js';
import { startPwaUpdateWatch } from '/src/pwa-update.js';
import { decodeFrontend } from '/src/decoder/frontend.js';
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
  guideDotPositions,
  readTrackCapability,
  readTrackZoom,
  resolveZoomPlan,
  snapZoom,
  zoomRangeFor,
  zoomTelemetry,
} from '/src/scanner-zoom.js';
import { createDebugOverlay } from '/src/scanner-debug-overlay.js';
import {
  createSteadyTracker,
  motionAttachPlan,
  requestMotionPermission,
} from '/src/scan-steady.js';
import {
  guidePriorPoses,
  priorPoseBudget,
  refineSeedsFrom,
} from '/src/scan-guide-prior.js';

const FRAME_INTERVAL_MS = 320;

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
export const SCANNER_BUILD = '2026-08-19.01';

/**
 * 연속 실패가 이 횟수를 넘으면 "더 가까이" 안내를 띄운다.
 * 복호 실패의 가장 흔한 원인이 거리(셀당 픽셀 부족)인데, 아무 피드백이 없으면
 * 사용자는 무엇을 바꿔야 할지 알 수 없다.
 */
const HINT_AFTER_FAILED_FRAMES = 24;

/**
 * 2면 이상 잘림(multi-clip)이 이 프레임 수만큼 **연속**이면 "조금 뒤로" 안내를 띄운다.
 * 실측(f2dbb2b 이후 340프레임): multi-clip 구간 성공 0% (274/274) — 코드가 분석
 * 프레임을 넘치면 절대 못 읽는데, 사용자에게는 아무 신호가 없었다.
 * 판정은 프레임마다 이미 계산 가능한 extractGeometry().clipSide 를 재사용한다 —
 * 기기 안 로컬 값이며 안정판 텔레메트리 0바이트 불변식과 무관하다.
 * 3프레임 ≈ 1초(FRAME_INTERVAL_MS 320) — 스치는 잘림에는 침묵한다.
 */
const CLIP_HINT_AFTER_FRAMES = 3;

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
    !steadyMeter || !steadyMeterFill) {
  throw new Error('TLcube scanner markup is incomplete.');
}

const frameCanvas = document.createElement('canvas');
const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });

let cameraStream = null;
let animationFrameId = 0;
let scanSession = 0;
let isDecoding = false;
let cameraRequestPending = false;
let lastDecodeAt = 0;
let stoppedForVisibility = false;
let activeUrl = '';
let returnFocus = null;
let consecutiveFailedFrames = 0;
let clippedFrames = 0;
let frameSeq = 0;
let labEnvSent = false;
let attemptId = '';
let zoomCapability = null;
let userZoom = DEFAULT_USER_ZOOM;
let zoomPlan = resolveZoomPlan({ userZoom: DEFAULT_USER_ZOOM });
/**
 * 연속 실패 자동 크롭 사다리의 현재 단 (§scanner-zoom.autoCropRung).
 * 0 = 개입 없음. 분석 크롭과 프리뷰가 **같은 값**을 쓴다 — 어긋나면 2026-08-15 의
 * «가이드 ≠ 분석» 사고가 재현된다.
 */
let autoCropIndex = 0;
/** 연속 실패가 시작된 시각(ms). 사다리는 프레임 수가 아니라 **시간**으로 오른다. */
let failStreakSince = 0;
let zoomApplyToken = 0;
let zoomApplyTimer = 0;

const lab = createLabTelemetry({ site: 'scan' });

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
 * ── 안정 유지 트리거 + 가이드-사전 스캔 (운영자 요청 2026-08-16) ─────────────────
 *
 * 손떨림 범위 안에서 같은 뷰가 1.5초 유지되면 「코드를 가이드에 어느 정도 맞췄다」 로
 * 보고, 가이드 기하에서 유도한 기대 포즈만 디코더에 넣어 한 프레임을 다시 본다.
 *
 * 배선 원칙:
 *   · **기존 연속 스캔 경로는 무회귀.** 사전 시도는 트리거가 걸린 그 한 프레임 슬롯만
 *     차지하고(중복 실행 아님), 나머지 프레임은 종전 `decodeFrame()` 이 그대로 돈다.
 *     한 슬롯을 «두 번» 돌리면 발동 프레임 비용이 두 배가 되므로 대체를 택했다 —
 *     발동은 최대 1.5초에 한 번이라 연속 경로가 잃는 것은 4\~5 프레임 중 한 장이다.
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

function beginScanAttempt() {
  attemptId = makeAttemptId();
  // 잘림 안내는 시도 단위 상태다 — 이전 세션의 스트릭이 새 카메라를 오염시키면 안 된다.
  clippedFrames = 0;
  if (lab.beginAttempt) lab.beginAttempt(attemptId);
  return attemptId;
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
 * 3링 18점 조준 가이드 — r3 정사각 뷰 좌표계에 직접 그린다.
 *
 * 레이어가 정사각 스테이지(≡ 분석 정사각의 화면 표현) 안에 inset:0 으로 있으므로
 * S = 스테이지 rect 한 변이 곧 분석 정사각 투영이다. 화면 투영 계산(구
 * analysisSquareOnScreen)은 폐기됐다 — 프리뷰(cover) ≡ 분석(cropWindow crop=1)이
 * 구조적으로 동일해 좌표 변환 자체가 없다 (scanner-zoom.js previewSourceWindow 증명).
 *
 * 줌은 다시 그릴 필요가 없다: 트랙 zoom 은 소스가 바뀌고, 크롭 폴백의 CSS scale 은
 * cover 와 함께 정확히 분석 크롭을 보여준다(위 증명). 다시 그리는 트리거는 기하가
 * 실제로 바뀌는 사건뿐(메타데이터·프레임 크기 변화·뷰포트 리사이즈·회전·첫 grab 성공).
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
  const dots = guideDotPositions(side, side / 2, side / 2);
  if (!dots) {
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
  ring(dots.outer, 'dot-outer', outerR);
  ring(dots.middle, 'dot-middle', outerR * 0.85);
  ring(dots.inner, 'dot-inner', outerR * 0.72);
  dotLayer.replaceChildren(fragment);

  // 자가진단 (작업 4): r3 불변식 — 점은 뷰 밖으로 나갈 수 없다(최대 반경 27% < 50%).
  // 위반은 좌표계 회귀이므로 콘솔 경고 + lab 오버레이 표기.
  const outOfBounds = dotsOutOfBounds(dots, side);
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

function reportLabFrame(imageData, result, ms, stage) {
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

/*
 * 언어. 문구가 바뀌면 **이미 떠 있는 화면도 다시 그려야** 한다 — 게이트 문구와 결과
 * 패널은 JS 가 채우므로 `data-i18n` 재적용만으로는 안 돌아온다. onChange 에서 현재
 * 상태에 맞는 화면을 다시 그린다.
 */
const i18n = createI18n(SCANNER_STRINGS, {
  onChange() {
    if (!cameraGate.hidden) showSupportedStartGate();
    if (!resultPanel.hidden && lastResult !== null) showResult(lastResult);
    if (!zoomControls.hidden) refreshZoomChrome();
    // 렌즈 선택지도 JS 가 채운다 — 권한 전에는 기기 이름이 없어 «카메라 1» 같은
    // 대체 이름을 우리가 붙이므로, 언어가 바뀌면 다시 그려야 한다.
    refreshCameraChoices();
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
 * @returns {Promise<{ ok: boolean, payload?: string, reason?: string }>}
 */
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
    const result = decodeFrontend({
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.data,
    }, {
      onStage: (stageName, phase) => clock.onStage(stageName, phase),
      // Type Y 강화 로케이터는 /lab/ 시험판에서만 켠다. 정식 스캐너는 종전
      // 검출 계약과 프레임 비용을 그대로 유지한다.
      // ⚠ cellFinderDaehan 은 **bootstrap 아래**여야 한다. decodeFrontend 는
      //   `options.bootstrap` 만 추려서 넘기고(frontend.js:117), 라인업을 고르는
      //   discoverCellFinders 가 받는 options 는 그 bootstrapOptions 다
      //   (bootstrap.js:849·884). 최상위에 두면 조용히 무시된다 — 토글을 눌러도
      //   아무 일이 안 일어나고, 그게 «daehan 이 효과가 없다» 로 오독된다.
      bootstrap: {
        cellFinderDaehan,
        family: { cube: { enableLocatorY: isLabPath(), enableCellSurfaceY: isLabPath() } },
      },
      // 가이드-사전 포즈. 없으면 이 객체 키 자체가 안 생겨 종전 경로와 동일하다.
      ...(Array.isArray(settings.priorPoses) ? { priorPoses: settings.priorPoses } : {}),
    });
    const stage = classifyStage(result);
    const ms = fillFrameMs(nowMs() - t0, clock.snapshot());
    /*
     * 사전 스캔은 카메라 프레임 **한 장**에 decodeFrame 을 두 번 부른다(coarse → refine).
     * 그대로 보고하면 lab 프레임 행이 2건 생기고 frameSeq 가 +2 라 프레임 시간·레이트
     * 통계가 트리거 프레임을 겹쳐 센다. 그래서 사전 경로는 보고를 호출자에게 미루고
     * (`deferReport`) 마지막에 **한 프레임 = 한 행**으로 합쳐 낸다.
     */
    const report = settings.deferReport ? { result, ms, stage } : null;
    if (!settings.deferReport) {
      reportLabFrame(imageData, result, ms, stage);
      updateDebugOverlay(imageData, result, stage, ms);
    }

    if (result && result.ok === true && typeof result.text === 'string') {
      return {
        ok: true,
        payload: result.text,
        family: result.family,
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
  reportLabFrame(imageData, report.result, ms, report.stage);
  updateDebugOverlay(imageData, report.result, report.stage, ms);
}

async function attemptGuidePriorScan(imageData) {
  const frameSide = Math.min(imageData.width, imageData.height);
  const coarse = coarsePosesFor(frameSide);
  if (coarse.length === 0) return { ok: false, reason: 'prior-no-poses' };

  const first = await decodeFrame(imageData, { priorPoses: coarse, deferReport: true });
  if (first.ok) {
    lastPriorSummary = { stage: 'coarse', poses: coarse.length, ok: true, ms: first.ms };
    flushPriorReport(imageData, first.report, 0);
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
    flushPriorReport(imageData, first.report, 0);
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
  flushPriorReport(imageData, second.report, first.ms || 0);
  return second;
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
  const canStart = options.canStart !== false;

  cameraGateTitle.textContent = options.title || t('gate.title');
  cameraGateMessage.textContent = options.message || t('gate.message');
  startCameraButton.textContent = options.startLabel || t('gate.start');
  startCameraButton.disabled = !canStart;
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

function stopTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

function stopCamera() {
  scanSession += 1;
  cameraRequestPending = false;
  isDecoding = false;
  lastDecodeAt = 0;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }

  const stream = cameraStream;
  cameraStream = null;
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
 * 매 프레임 올리지 않는 이유는 비용이다(복호가 프레임당 수백 ms\~수 초). 흔한 경우는
 * 빠르게 돌리고, 안 될 때만 비싸게 한 번 더 본다.
 */
const FRAME_ESCALATED_SIDE = 1440;
const ESCALATE_EVERY = 5;

function grabVideoFrame() {
  const escalate = consecutiveFailedFrames > 0
    && consecutiveFailedFrames % ESCALATE_EVERY === 0;
  const maxSide = escalate ? FRAME_ESCALATED_SIDE : FRAME_MAX_SIDE;
  const grabbed = imageDataCenterSquare(
    cameraVideo,
    cameraVideo.videoWidth,
    cameraVideo.videoHeight,
    maxSide,
    effectiveCropZoom(),
  );
  if (grabbed) return grabbed;
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
    return imageDataCenterSquare(
      cameraVideo,
      cameraVideo.videoWidth,
      cameraVideo.videoHeight,
      maxSide,
      1,
    );
  }
  return null;
}

function normalizePayload(result) {
  if (!result || result.ok !== true || typeof result.payload !== 'string' || result.payload === '') {
    return null;
  }
  return result.payload;
}

function handleDecodeResult(result, source, session) {
  if (session !== scanSession) return;

  const payload = normalizePayload(result);

  // 거리(셀당 픽셀 부족)가 복호 실패의 가장 흔한 원인인데 아무 피드백이 없으면
  // 사용자는 무엇을 바꿔야 할지 알 수 없다. 연속 실패가 쌓이면 한 번만 안내한다.
  if (source === 'camera') {
    if (payload) {
      consecutiveFailedFrames = 0;
      clippedFrames = 0;
      failStreakSince = 0;
    } else {
      consecutiveFailedFrames += 1;
      if (failStreakSince === 0) failStreakSince = Date.now();
      // 잘림 안내 — multi-clip(2면 이상 잘림) 연속이면 «조금 뒤로». 실측에서 이
      // 상태의 성공률이 0% 라 다른 어떤 힌트보다 우선한다. 해소되면 기본 조준
      // 문구로 되돌린다(한 번 뜨고 눌러앉으면 이미 물러난 사용자를 계속 몬다).
      if (result && result.clipSide === 'multi') {
        clippedFrames += 1;
        if (clippedFrames === CLIP_HINT_AFTER_FRAMES) {
          setStatus(t('status.clipped'));
        }
      } else {
        if (clippedFrames >= CLIP_HINT_AFTER_FRAMES) {
          setStatus(t('status.aim'));
        }
        clippedFrames = 0;
      }
      if (consecutiveFailedFrames === HINT_AFTER_FAILED_FRAMES
        && clippedFrames < CLIP_HINT_AFTER_FRAMES) {
        // 잘림 안내가 떠 있는 동안 «더 가까이» 는 반대 지시라 억제한다.
        setStatus(t('status.closer'));
      }
    }
    // 자동 크롭 사다리 — 실패가 쌓이면 한 단씩 올리고 성공하면 위에서 0 으로
    // 돌아간다. 잘림(«너무 가깝다») 이면 올리지 않는다 — 확대가 정반대 처방이다.
    // 사용자가 확대를 직접 건드렸으면 개입하지 않는다.
    const nextRung = autoCropRung(failStreakSince === 0 ? 0 : Date.now() - failStreakSince, {
      clipped: clippedFrames >= CLIP_HINT_AFTER_FRAMES
        || (result && result.clipSide === 'multi'),
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
      setStatus(t('status.photoNoResult'));
      showScanToast(t('toast.photoNoResult'));
      showSupportedStartGate(t('status.startOrPick'));
    }
    return;
  }

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

    if (!isDecoding && timestamp - lastDecodeAt >= FRAME_INTERVAL_MS) {
      const imageData = grabVideoFrame();

      if (imageData) {
        if (!firstGrabRendered) {
          firstGrabRendered = true;
          renderGuideDots();
        }
        lastDecodeAt = timestamp;
        isDecoding = true;

        /*
         * 안정 유지 판정 — 복호보다 **먼저** 한다. 복호는 수백 ms 걸리므로 그 뒤에
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

        const attempt = usePrior
          ? attemptGuidePriorScan(imageData)
          : decodeFrame(imageData);

        attempt
          .then((result) => {
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
            stopCamera();
            setStatus(t('status.frameError'));
            showSupportedStartGate(t('status.restart'));
          })
          .finally(() => {
            if (usePrior) priorInFlight = false;
            if (session === scanSession) isDecoding = false;
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
  beginScanAttempt();
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

    cameraRequestPending = false;
    setCameraStageActive(true);
    renderGuideDots();
    hideCameraGate();
    setStatus(t('status.aim'));
    sendLabEnvOnce(stream);
    startFrameLoop(session);
  } catch (error) {
    if (session !== scanSession) return;

    sendLabEnvOnce(null);
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

  stopCamera();
  hideCameraGate();
  hideResult({ restoreFocus: false });

  const session = ++scanSession;
  resetFrameSeq();
  beginScanAttempt();
  sendLabEnvOnce(null);
  setStatus(t('status.checkingPhoto'));

  try {
    const image = await loadImage(file);
    const imageData = imageDataWhole(image, image.naturalWidth, image.naturalHeight);
    if (!imageData) throw new Error('image-data-unavailable');

    const result = await decodeFrame(imageData);
    handleDecodeResult(result, 'file', session);
  } catch {
    if (session === scanSession) {
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

  showSupportedStartGate();
  setStatus(t('status.tapToStart'));

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

/*
 * 사용 이벤트 비콘. 페이로드 **내용은 절대 담지 않는다** — 종류(url/text/wifi/card)와
 * 성공 여부 같은 메타만 보낸다. 오프라인이면 큐에 쌓였다가 온라인 복귀 때 흘러간다.
 */
const beacon = createBeacon('scan');
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
      // v2r2 · v1r2 (2026-08-16) · v0xq · v0x · **v0w · v0wq · v0w2 · v0wy
      // (2026-08-17)** 는 검출 라인업에서 내려갔으므로 «기대» 로도 못 고른다 —
      // 저장·URL 등으로 옛 값이 들어와도 여기서 null(모름)로 떨어진다.
      // 값은 레이아웃 id(소문자)와 같아야 한다 — 디코더가
      // hypothesis.cellSurfaceLayout 으로 돌려주는 문자열이 그것이다 (표시만 v0T).
      expectedLocatorLayout = next === 'v0'
        || next === 'v0t' || next === 'v0ty'
        || next === 'v0tr' || next === 'v0trq'
        ? next
        : null;
      for (const other of expectedLayoutRoot.querySelectorAll('[data-expected-layout]')) {
        other.classList.toggle('active', other === button);
      }
    });
  }
}

// daehan 파인더 옵트인 (2026-08-18) — 시험판 전용 즉석 토글.
//
// 왜 토글이 필요한가: daehan 은 «기본 라인업에 올리면 셀 24px 부근에서 레거시
// 5칸을 가져간다» 는 실측 때문에 옵트인으로 들어왔다. 그런데 그 판정을 뒤집으려면
// **실기기에서 켜 보는 수밖에 없다** — 합성 프레임만으로는 실제 촬영 배율 분포를
// 모른다. 코드에만 있는 플래그는 실기기 판정을 못 만든다.
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

// 3링 가이드는 기하가 실제로 바뀔 때만 다시 그린다 — 비디오 메타데이터 도착,
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
    if (cameraStream || cameraRequestPending) {
      stoppedForVisibility = true;
      stopCamera();
    }
    return;
  }

  if (stoppedForVisibility) {
    stoppedForVisibility = false;
    setStatus(t('status.hiddenStopped'));
    showSupportedStartGate(t('status.hiddenRestart'));
  }
});
window.addEventListener('pagehide', stopCamera);

void initialiseCamera();
