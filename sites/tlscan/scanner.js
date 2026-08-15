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
  buttonStep,
  cropWindow,
  DEFAULT_USER_ZOOM,
  readTrackCapability,
  readTrackZoom,
  resolveZoomPlan,
  snapZoom,
  zoomRangeFor,
  zoomTelemetry,
} from '/src/scanner-zoom.js';

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
export const SCANNER_BUILD = '2026-08-15.02';

/**
 * 연속 실패가 이 횟수를 넘으면 "더 가까이" 안내를 띄운다.
 * 복호 실패의 가장 흔한 원인이 거리(셀당 픽셀 부족)인데, 아무 피드백이 없으면
 * 사용자는 무엇을 바꿔야 할지 알 수 없다.
 */
const HINT_AFTER_FAILED_FRAMES = 24;

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

if (!scannerApp || !cameraStage || !cameraVideo || !cameraGate || !cameraGateTitle ||
    !cameraGateMessage || !startCameraButton || !chooseImageButton || !gateChooseImageButton ||
    !imageInput || !statusBox || !scanToast || !resultPanel || !resultTitle || !resultContent ||
    !popupFallback || !openUrlLink || !rescanButton || !closeResultButton ||
    !closeResultSecondaryButton || !zoomControls || !zoomSlider || !zoomInButton ||
    !zoomOutButton || !zoomValue || !zoomErrorBox) {
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
let frameSeq = 0;
let labEnvSent = false;
let attemptId = '';
let zoomCapability = null;
let userZoom = DEFAULT_USER_ZOOM;
let zoomPlan = resolveZoomPlan({ userZoom: DEFAULT_USER_ZOOM });
let zoomApplyToken = 0;
let zoomApplyTimer = 0;

const lab = createLabTelemetry({ site: 'scan' });

function resetFrameSeq() {
  frameSeq = 0;
}

function beginScanAttempt() {
  attemptId = makeAttemptId();
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

function syncPreviewTransform() {
  const scale = zoomPlan.cropApplied > 1.001 ? zoomPlan.cropApplied : 1;
  cameraVideo.style.transform = scale === 1 ? '' : 'scale(' + scale + ')';
  cameraVideo.style.transformOrigin = 'center center';
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
async function decodeFrame(imageData) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
    const failed = { ok: false, reason: 'frame-invalid' };
    reportLabFrame(imageData, failed, fillFrameMs(0), 'proposal');
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
      bootstrap: { family: { cube: { enableLocatorY: isLabPath(), enableCellSurfaceY: isLabPath() } } },
    });
    const stage = classifyStage(result);
    const ms = fillFrameMs(nowMs() - t0, clock.snapshot());
    reportLabFrame(imageData, result, ms, stage);

    if (result && result.ok === true && typeof result.text === 'string') {
      return { ok: true, payload: result.text, family: result.family, hypothesis: result.hypothesis };
    }
    return { ok: false, reason: (result && result.reason) || 'decode-failed' };
  } catch (error) {
    // 디코더가 던지면 스캐너 루프가 멈추면 안 된다 — 다음 프레임으로 넘어간다.
    const failed = {
      ok: false,
      reason: 'decode-threw:' + (error && error.message ? error.message : 'unknown'),
    };
    reportLabFrame(imageData, failed, fillFrameMs(nowMs() - t0), 'proposal');
    return failed;
  }
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
 *    Chrome 의 기본은 640×480 이고, 그걸 1080p+ 화면에 `object-fit: cover` 로 채우면
 *    확대율이 2\~3배가 되어 눈에 띄게 흐려진다(실기기 확인, 2026-08-10).
 *
 * `ideal` 을 쓰고 `exact`·`min` 을 쓰지 않는다 — 후자는 못 맞추면 OverconstrainedError 로
 * 카메라 자체가 안 열린다. 다만 **deviceId 는 exact** 로 준다: 사용자가 고른 렌즈를
 * 브라우저가 조용히 무시하면 선택 UI 가 거짓말이 되기 때문이다.
 */
async function requestCameraStream(deviceId) {
  const video = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
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
    zoomPlan.cropApplied,
  );
  if (grabbed) return grabbed;
  if (zoomPlan.cropApplied > 1.001) {
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
    } else {
      consecutiveFailedFrames += 1;
      if (consecutiveFailedFrames === HINT_AFTER_FAILED_FRAMES) {
        setStatus(t('status.closer'));
      }
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
  const nextFrame = (timestamp) => {
    if (session !== scanSession || !cameraStream || document.visibilityState === 'hidden') {
      return;
    }

    if (!isDecoding && timestamp - lastDecodeAt >= FRAME_INTERVAL_MS) {
      const imageData = grabVideoFrame();

      if (imageData) {
        lastDecodeAt = timestamp;
        isDecoding = true;

        decodeFrame(imageData)
          .then((result) => handleDecodeResult(result, 'camera', session))
          .catch(() => {
            if (session !== scanSession) return;
            stopCamera();
            setStatus(t('status.frameError'));
            showSupportedStartGate(t('status.restart'));
          })
          .finally(() => {
            if (session === scanSession) isDecoding = false;
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

startCameraButton.addEventListener('click', () => {
  void startCamera({ automatic: false });
});
chooseImageButton.addEventListener('click', openImagePicker);

// 렌즈를 바꾸면 스트림을 다시 연다 — 같은 스트림에 deviceId 를 적용할 수는 없다.
const cameraPicker = document.getElementById('camera-picker');
if (cameraPicker) {
  cameraPicker.addEventListener('change', () => {
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
      // 최종 라인업(2026-08-15): v0 · v2r2 만 기대 레이아웃 후보다.
      expectedLocatorLayout = next === 'v0' || next === 'v2r2' ? next : null;
      for (const other of expectedLayoutRoot.querySelectorAll('[data-expected-layout]')) {
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
