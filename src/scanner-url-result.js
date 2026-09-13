/**
 * URL 결과의 출처/권한/한 번의 열기 결과를 DOM에서 분리해요.
 * `urlOpenState`는 표시 캐시일 뿐 URL payload·worker wire·telemetry에 직렬화하지 않아요.
 */
const URL_ORIGINS = new Set(['tl', 'qr', 'unknown']);
const URL_OPEN_STATES = new Set(['opened', 'blocked', 'manual']);

function verifiedH(result, verifier) {
  try { return typeof verifier === 'function' && verifier(result) === true; } catch { return false; }
}

export function urlOriginOf(result, { isVerifiedHResult } = {}) {
  if (!result || typeof result !== 'object') return 'unknown';
  if (result.source === 'h') return verifiedH(result, isVerifiedHResult) ? 'tl' : 'unknown';
  if (result.source === undefined || result.source === 'r2') return 'tl';
  if (result.source === 'qr') return 'qr';
  return 'unknown';
}

export function resultAutoOpen(result, options = {}) {
  return Boolean(result && result.autoOpen !== false && urlOriginOf(result, options) === 'tl');
}

export function resolveUrlResultPresentation({
  autoOpen = false,
  urlOrigin = 'unknown',
  urlOpenState = null,
  tryOpenUrl = () => false,
} = {}) {
  const origin = URL_ORIGINS.has(urlOrigin) ? urlOrigin : 'unknown';
  const state = URL_OPEN_STATES.has(urlOpenState)
    ? urlOpenState
    : (autoOpen === true ? (tryOpenUrl() ? 'opened' : 'blocked') : 'manual');
  return Object.freeze({
    state,
    fallbackVisible: state !== 'opened',
    popupBlockedVisible: state === 'blocked',
    introKey: state === 'opened' ? 'result.url.opened'
      : state === 'blocked' ? 'result.url.manual'
        : origin === 'qr' ? 'result.url.qrManual' : 'result.url.manual',
  });
}
