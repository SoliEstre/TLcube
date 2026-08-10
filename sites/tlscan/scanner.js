// scanner.js — TLcube 웹 스캐너의 입력·수명주기 셸.
//
// 실제 디코더는 아래 decodeFrame() 함수의 본문만 교체해 연결한다.
// 카메라와 이미지 파일은 모두 ImageData를 만들어 같은 경계를 호출한다.

(() => {
  'use strict';

  const FRAME_INTERVAL_MS = 320;
  const FRAME_MAX_SIDE = 960;

  const cameraStage = document.getElementById('camera-stage');
  const cameraVideo = document.getElementById('camera-preview');
  const cameraPlaceholder = document.getElementById('camera-placeholder');
  const startCameraButton = document.getElementById('start-camera');
  const stopCameraButton = document.getElementById('stop-camera');
  const imageInput = document.getElementById('image-input');
  const chooseImageButton = document.getElementById('choose-image');
  const statusBox = document.getElementById('scan-status');
  const statusTitle = document.getElementById('scan-status-title');
  const statusMessage = document.getElementById('scan-status-message');
  const resultPanel = document.getElementById('scan-result');
  const resultLink = document.getElementById('result-link');
  const resultText = document.getElementById('result-text');
  const copyResultButton = document.getElementById('copy-result');

  if (!cameraStage || !cameraVideo || !startCameraButton || !stopCameraButton ||
      !imageInput || !chooseImageButton || !statusBox || !statusTitle ||
      !statusMessage || !resultPanel || !resultLink || !resultText || !copyResultButton) {
    return;
  }

  const frameCanvas = document.createElement('canvas');
  const frameContext = frameCanvas.getContext('2d', { willReadFrequently: true });

  let cameraStream = null;
  let animationFrameId = 0;
  let scanSession = 0;
  let isDecoding = false;
  let cameraRequestPending = false;
  let lastDecodeAt = 0;
  let decoderStubReported = false;
  let stoppedForVisibility = false;
  let activePayload = '';

  const statusCopy = {
    ready: {
      title: '카메라를 열어 주세요',
      message: '카메라 권한을 허용하면 코드를 찾기 시작해요.',
    },
    requesting: {
      title: '카메라 권한을 요청하고 있어요',
      message: '브라우저의 권한 안내에서 카메라를 허용해 주세요.',
    },
    insecure: {
      title: 'HTTPS 연결이 필요해요',
      message: '지금 주소는 HTTPS가 아니어서 카메라를 열 수 없어요. 이미지 파일은 선택할 수 있어요.',
    },
    unavailable: {
      title: '사용할 카메라를 찾지 못했어요',
      message: '카메라가 연결돼 있는지 확인하거나 이미지 파일을 선택해 주세요.',
    },
    denied: {
      title: '카메라 권한이 거부됐어요',
      message: '브라우저 설정에서 카메라 권한을 허용하거나 이미지 파일을 선택해 주세요.',
    },
    scanning: {
      title: '코드를 찾고 있어요',
      message: '코드 전체가 프레임 안에 들어오도록 맞춰 주세요.',
    },
    processing: {
      title: '이미지를 확인하고 있어요',
      message: '선택한 이미지에서 TLcube 코드를 찾고 있어요.',
    },
    success: {
      title: '코드를 읽었어요',
      message: '읽은 내용을 아래에서 확인하거나 복사할 수 있어요.',
    },
    failure: {
      title: '코드를 읽지 못했어요',
      message: '더 선명한 이미지로 다시 시도해 주세요.',
    },
  };

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

  function setStatus(state, message) {
    const copy = statusCopy[state] || statusCopy.failure;
    statusBox.dataset.state = state;
    statusTitle.textContent = copy.title;
    statusMessage.textContent = message || copy.message;
  }

  function hasCameraApi() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function isHttpsPage() {
    return location.protocol === 'https:';
  }

  function syncCameraControls() {
    const canStart = isHttpsPage() && hasCameraApi() && !cameraStream && !cameraRequestPending;
    startCameraButton.disabled = !canStart;
    stopCameraButton.hidden = !cameraStream;
  }

  function setCameraStageActive(active) {
    cameraStage.classList.toggle('is-active', active);
    cameraPlaceholder.hidden = active;
  }

  function stopTracks(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
  }

  function stopCamera(options) {
    const settings = options || {};

    scanSession += 1;
    cameraRequestPending = false;
    isDecoding = false;
    lastDecodeAt = 0;

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }

    stopTracks(cameraStream);
    cameraStream = null;

    try {
      cameraVideo.pause();
    } catch {
      // 재생이 시작되기 전의 pause()는 무시해도 됩니다.
    }
    cameraVideo.srcObject = null;
    setCameraStageActive(false);
    syncCameraControls();

    if (settings.announce) {
      setStatus('ready', '카메라를 껐어요. 다시 읽으려면 카메라를 열어 주세요.');
    }
  }

  function cameraFailure(error) {
    const name = error && error.name;

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { state: 'denied', message: statusCopy.denied.message };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' ||
        name === 'OverconstrainedError' || name === 'NotReadableError' ||
        name === 'AbortError') {
      return { state: 'unavailable', message: statusCopy.unavailable.message };
    }
    return {
      state: 'failure',
      message: '잠시 후 다시 시도하거나 이미지 파일을 선택해 주세요.',
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
              stopCamera({ announce: false });
              setStatus('failure', '프레임을 처리하는 중 문제가 생겼어요. 다시 카메라를 열어 주세요.');
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

  async function startCamera() {
    clearResult();

    if (!isHttpsPage()) {
      setStatus('insecure');
      syncCameraControls();
      return;
    }
    if (!hasCameraApi()) {
      setStatus('unavailable', '이 브라우저에서는 카메라 기능을 지원하지 않아요. 이미지 파일을 선택해 주세요.');
      syncCameraControls();
      return;
    }
    if (cameraStream || cameraRequestPending) return;

    const session = ++scanSession;
    cameraRequestPending = true;
    decoderStubReported = false;
    setStatus('requesting');
    syncCameraControls();

    try {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch (error) {
        if (!error || error.name !== 'OverconstrainedError') throw error;
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      if (session !== scanSession) {
        stopTracks(cameraStream);
        cameraStream = null;
        return;
      }

      cameraVideo.srcObject = cameraStream;
      await waitForVideoMetadata(cameraVideo);
      await cameraVideo.play();

      if (session !== scanSession) {
        stopTracks(cameraStream);
        cameraStream = null;
        return;
      }

      cameraRequestPending = false;
      setCameraStageActive(true);
      setStatus('scanning');
      syncCameraControls();
      startFrameLoop(session);
    } catch (error) {
      if (session !== scanSession) return;

      stopCamera({ announce: false });
      const problem = cameraFailure(error);
      setStatus(problem.state, problem.message);
    } finally {
      if (session === scanSession) {
        cameraRequestPending = false;
        syncCameraControls();
      }
    }
  }

  function normalizePayload(result) {
    if (!result || result.ok !== true || typeof result.payload !== 'string' || !result.payload) {
      return null;
    }
    return result.payload;
  }

  function handleDecodeResult(result, source, session) {
    if (session !== scanSession) return;

    const payload = normalizePayload(result);
    if (!payload) {
      if (source === 'file') {
        const message = result && result.reason === 'decoder-not-implemented'
          ? '이미지 입력은 준비됐지만 실제 디코더가 아직 연결되지 않았어요.'
          : undefined;
        setStatus('failure', message);
        return;
      }

      if (result && result.reason === 'decoder-not-implemented' && !decoderStubReported) {
        decoderStubReported = true;
        setStatus('scanning', '카메라 스트림은 정상이에요. 실제 디코더를 연결하면 이 프레임에서 바로 내용을 읽어요.');
      }
      return;
    }

    activePayload = payload;
    stopCamera({ announce: false });
    showResult(payload);
    setStatus('success');
  }

  function safeLinkFor(payload) {
    try {
      const url = new URL(payload.trim());
      if (url.protocol === 'https:' || url.protocol === 'http:' ||
          url.protocol === 'mailto:' || url.protocol === 'tel:') {
        return url.href;
      }
    } catch {
      // URL이 아니면 일반 텍스트로 표시합니다.
    }
    return '';
  }

  function showResult(payload) {
    const link = safeLinkFor(payload);
    resultLink.hidden = !link;
    resultText.hidden = Boolean(link);

    if (link) {
      resultLink.href = link;
      resultLink.textContent = payload;
      resultText.textContent = '';
    } else {
      resultText.textContent = payload;
      resultLink.removeAttribute('href');
      resultLink.textContent = '';
    }

    resultPanel.hidden = false;
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    resultPanel.focus({ preventScroll: true });
  }

  function clearResult() {
    activePayload = '';
    resultPanel.hidden = true;
    resultLink.hidden = true;
    resultText.hidden = true;
    resultLink.removeAttribute('href');
    resultLink.textContent = '';
    resultText.textContent = '';
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

    stopCamera({ announce: false });
    clearResult();
    const session = ++scanSession;
    setStatus('processing');

    try {
      const image = await loadImage(file);
      const imageData = imageDataFromSource(image, image.naturalWidth, image.naturalHeight);
      if (!imageData) throw new Error('image-data-unavailable');

      const result = await decodeFrame(imageData);
      handleDecodeResult(result, 'file', session);
    } catch {
      if (session === scanSession) {
        setStatus('failure', '이미지 파일을 읽지 못했어요. 다른 이미지로 다시 시도해 주세요.');
      }
    } finally {
      imageInput.value = '';
    }
  }

  async function copyPayload() {
    if (!activePayload) return;

    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(activePayload);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = activePayload;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      textarea.remove();
    }

    if (copied) {
      const originalLabel = copyResultButton.textContent;
      copyResultButton.textContent = '복사했어요';
      setStatus('success', '내용을 클립보드에 복사했어요.');
      window.setTimeout(() => {
        copyResultButton.textContent = originalLabel;
      }, 1800);
    } else {
      setStatus('failure', '자동으로 복사하지 못했어요. 내용을 길게 누르거나 선택해서 복사해 주세요.');
    }
  }

  startCameraButton.addEventListener('click', startCamera);
  stopCameraButton.addEventListener('click', () => stopCamera({ announce: true }));
  chooseImageButton.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => decodeImageFile(imageInput.files && imageInput.files[0]));
  copyResultButton.addEventListener('click', copyPayload);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (cameraStream || cameraRequestPending) {
        stoppedForVisibility = true;
        stopCamera({ announce: false });
      }
      return;
    }

    if (stoppedForVisibility) {
      stoppedForVisibility = false;
      setStatus('ready', '탭을 떠날 때 카메라를 껐어요. 계속하려면 카메라를 다시 열어 주세요.');
    }
  });
  window.addEventListener('pagehide', () => stopCamera({ announce: false }));

  if (!isHttpsPage()) {
    setStatus('insecure');
  } else if (!hasCameraApi()) {
    setStatus('unavailable', '이 브라우저에서는 카메라 기능을 지원하지 않아요. 이미지 파일을 선택해 주세요.');
  } else {
    setStatus('ready');
  }
  syncCameraControls();
})();
