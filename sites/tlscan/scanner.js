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

const FRAME_INTERVAL_MS = 320;
const FRAME_MAX_SIDE = 960;

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
const resultPanel = document.getElementById('scan-result');
const resultTitle = document.getElementById('result-title');
const resultContent = document.getElementById('result-content');
const popupFallback = document.getElementById('popup-fallback');
const openUrlLink = document.getElementById('open-url');
const rescanButton = document.getElementById('rescan');
const closeResultButton = document.getElementById('close-result');
const closeResultSecondaryButton = document.getElementById('close-result-secondary');

if (!scannerApp || !cameraStage || !cameraVideo || !cameraGate || !cameraGateTitle ||
    !cameraGateMessage || !startCameraButton || !chooseImageButton || !gateChooseImageButton ||
    !imageInput || !statusBox || !resultPanel || !resultTitle || !resultContent ||
    !popupFallback || !openUrlLink || !rescanButton || !closeResultButton ||
    !closeResultSecondaryButton) {
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

/**
 * TLcube 디코더 경계입니다. 실제 구현을 연결할 때는 이 함수의 본문만 교체하세요.
 *
 * @param {ImageData} imageData 카메라 또는 업로드 이미지에서 얻은 프레임
 * @returns {Promise<{ ok: boolean, payload?: string, reason?: string }>}
 */
async function decodeFrame(imageData) {
  void imageData;
  return { ok: false, reason: 'decoder-not-implemented' };
}

function setStatus(message) {
  statusBox.textContent = message;
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

  cameraGateTitle.textContent = options.title || '카메라를 시작할까요?';
  cameraGateMessage.textContent = options.message || '카메라 권한을 허용하면 바로 스캔해요.';
  startCameraButton.textContent = options.startLabel || '탭해서 카메라 시작';
  startCameraButton.disabled = !canStart;
  cameraGate.hidden = false;
}

function hideCameraGate() {
  cameraGate.hidden = true;
}

function showSupportedStartGate(message) {
  if (!isSecureForCamera()) {
    showCameraGate({
      title: 'HTTPS 연결이 필요해요',
      message: 'HTTPS가 아닌 연결에서는 카메라를 사용할 수 없어요. 사진에서 스캔할 수 있어요.',
      canStart: false,
      startLabel: 'HTTPS에서 카메라 사용',
    });
    return;
  }

  if (!hasCameraApi()) {
    showCameraGate({
      title: '카메라를 사용할 수 없어요',
      message: '이 브라우저에서는 카메라 기능을 지원하지 않아요. 사진에서 스캔할 수 있어요.',
      canStart: false,
      startLabel: '카메라를 사용할 수 없어요',
    });
    return;
  }

  showCameraGate({
    message: message || '카메라 권한을 허용하면 바로 스캔해요.',
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
}

function cameraFailure(error) {
  const name = error && error.name;

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      title: '카메라 권한이 필요해요',
      message: '브라우저에서 카메라 권한을 허용한 뒤 다시 탭해 주세요.',
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' ||
      name === 'OverconstrainedError' || name === 'NotReadableError' ||
      name === 'AbortError') {
    return {
      title: '카메라를 찾지 못했어요',
      message: '카메라 연결을 확인한 뒤 다시 탭하거나 사진에서 스캔해 주세요.',
    };
  }

  return {
    title: '카메라를 열지 못했어요',
    message: '잠시 후 다시 탭하거나 사진에서 스캔해 주세요.',
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

async function requestCameraStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (error) {
    if (!error || error.name !== 'OverconstrainedError') throw error;
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

function imageDataFromSource(source, width, height) {
  if (!frameContext || !width || !height) return null;

  const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(width, height));
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

function grabVideoFrame() {
  return imageDataFromSource(cameraVideo, cameraVideo.videoWidth, cameraVideo.videoHeight);
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
  if (!payload) {
    if (source === 'file') {
      setStatus('사진에서 결과를 찾지 못했어요. 다른 사진을 선택하거나 카메라를 시작해 주세요.');
      showSupportedStartGate('카메라를 시작하거나 다른 사진을 선택해 주세요.');
    }
    return;
  }

  stopCamera();
  showResult(payload);
  setStatus('코드를 읽었어요.');
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
            setStatus('프레임을 처리하는 중 문제가 생겼어요. 다시 시작해 주세요.');
            showSupportedStartGate('카메라를 다시 시작해 주세요.');
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

  if (!isSecureForCamera()) {
    setStatus('HTTPS 연결이 아니어서 카메라를 사용할 수 없어요.');
    showSupportedStartGate();
    return;
  }

  if (!hasCameraApi()) {
    setStatus('이 브라우저에서는 카메라를 사용할 수 없어요.');
    showSupportedStartGate();
    return;
  }

  if (cameraStream || cameraRequestPending) return;

  const session = ++scanSession;
  cameraRequestPending = true;
  setStatus('카메라를 시작하고 있어요.');

  if (!automatic) {
    hideCameraGate();
  }

  try {
    const stream = await requestCameraStream();

    if (session !== scanSession) {
      stopTracks(stream);
      return;
    }

    cameraStream = stream;
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
    setStatus('코드를 프레임 안에 맞춰 주세요.');
    startFrameLoop(session);
  } catch (error) {
    if (session !== scanSession) return;

    stopCamera();

    if (automatic) {
      setStatus('카메라를 시작하려면 화면을 탭해 주세요.');
      showSupportedStartGate();
      return;
    }

    const problem = cameraFailure(error);
    setStatus(problem.message);
    showCameraGate({
      title: problem.title,
      message: problem.message,
      startLabel: '카메라 다시 시도',
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
  setStatus('사진을 확인하고 있어요.');

  try {
    const image = await loadImage(file);
    const imageData = imageDataFromSource(image, image.naturalWidth, image.naturalHeight);
    if (!imageData) throw new Error('image-data-unavailable');

    const result = await decodeFrame(imageData);
    handleDecodeResult(result, 'file', session);
  } catch {
    if (session === scanSession) {
      setStatus('사진을 읽지 못했어요. 다른 사진을 선택해 주세요.');
      showSupportedStartGate('카메라를 시작하거나 다른 사진을 선택해 주세요.');
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
    setStatus(label + '을(를) 복사하지 못했어요. 직접 선택해서 복사해 주세요.');
    return;
  }

  setStatus(label + '을(를) 복사했어요.');
  if (!button) return;

  const originalLabel = button.textContent;
  button.textContent = '복사했어요';
  window.setTimeout(() => {
    button.textContent = originalLabel;
  }, 1600);
}

function createCopyButton(value, label) {
  const button = document.createElement('button');
  button.className = 'copy-button';
  button.type = 'button';
  button.textContent = '복사';
  button.setAttribute('aria-label', label + ' 복사');
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
  const visibleValue = value === '' ? '없음' : value;
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
  setResultTitle('텍스트를 읽었어요');
  addResultIntro('내용을 확인하거나 복사할 수 있어요.');

  const text = document.createElement('pre');
  text.className = 'text-payload';
  text.textContent = payload;
  resultContent.append(text, createCopyButton(payload, '내용'));
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

  setResultTitle('링크를 읽었어요');
  addResultIntro(opened ? '새 탭에서 주소를 열었어요.' : '아래 버튼을 탭해서 주소를 열어 주세요.');

  const link = document.createElement('a');
  link.className = 'payload-url';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = url;
  resultContent.append(link, createCopyButton(url, '주소'));
}

function renderWifiPayload(data) {
  const wifi = data || {};
  const ssid = stringValue(wifi.s);
  const password = stringValue(wifi.p);
  const security = wifi.e === 'WEP' ? 'WEP' : 'WPA';

  setResultTitle('Wi-Fi 정보를 읽었어요');
  addResultIntro('웹에서는 Wi-Fi에 바로 연결할 수 없어요. 필요한 값을 각각 복사해 사용해 주세요.');
  addPayloadField('SSID', ssid, { copyValue: ssid || '없음' });
  addPayloadField('보안 방식', security);
  addPayloadField('비밀번호', password, { copyValue: password || '없음' });
}

function renderCardPayload(data) {
  const card = data || {};
  const name = stringValue(card.n);
  const organization = stringValue(card.org);
  const telephone = stringValue(card.tel);
  const email = stringValue(card.em);
  const website = stringValue(card.u);
  const safeWebsite = safeHttpUrl(website);

  setResultTitle('명함을 읽었어요');
  addResultIntro('연락처와 웹사이트를 바로 사용할 수 있어요.');
  addPayloadField('이름', name, { copyValue: name || '없음' });

  if (organization !== '') {
    addPayloadField('소속', organization);
  }
  if (telephone !== '') {
    addPayloadField('전화', telephone, { href: 'tel:' + telephone });
  }
  if (email !== '') {
    addPayloadField('이메일', email, { href: 'mailto:' + email });
  }
  if (website !== '') {
    addPayloadField('웹사이트', website, {
      href: safeWebsite || undefined,
      external: Boolean(safeWebsite),
    });
  }
}

function showResult(payload) {
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
  setStatus('계속 스캔하려면 화면을 탭해 주세요.');
  showSupportedStartGate('카메라를 시작하거나 사진에서 스캔해 주세요.');
}

function openImagePicker() {
  imageInput.click();
}

async function initialiseCamera() {
  if (!isSecureForCamera()) {
    setStatus('HTTPS 연결이 아니어서 카메라를 사용할 수 없어요. 사진에서 스캔할 수 있어요.');
    showSupportedStartGate();
    return;
  }

  if (!hasCameraApi()) {
    setStatus('이 브라우저에서는 카메라를 사용할 수 없어요. 사진에서 스캔할 수 있어요.');
    showSupportedStartGate();
    return;
  }

  showSupportedStartGate();
  setStatus('카메라를 시작하려면 화면을 탭해 주세요.');

  if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
    return;
  }

  try {
    const permission = await navigator.permissions.query({ name: 'camera' });

    if (permission.state === 'granted') {
      await startCamera({ automatic: true });
      return;
    }

    if (permission.state === 'denied') {
      setStatus('카메라 권한을 허용한 뒤 다시 탭해 주세요.');
      showCameraGate({
        title: '카메라 권한이 꺼져 있어요',
        message: '브라우저 설정에서 카메라 권한을 허용한 뒤 다시 탭해 주세요.',
        startLabel: '카메라 다시 시도',
      });
    }
  } catch {
    // 권한 상태를 알 수 없으면 제스처 시작 레이어를 유지합니다.
  }
}

startCameraButton.addEventListener('click', () => {
  void startCamera({ automatic: false });
});
chooseImageButton.addEventListener('click', openImagePicker);
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
    setStatus('탭을 떠나면서 카메라를 껐어요. 계속하려면 다시 시작해 주세요.');
    showSupportedStartGate('탭을 떠나면서 카메라를 껐어요. 다시 시작해 주세요.');
  }
});
window.addEventListener('pagehide', stopCamera);

void initialiseCamera();
