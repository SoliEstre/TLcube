/**
 * scanner-zoom.js — 스캐너 확대·크롭·실효 배율.
 *
 * 화면 CSS 확대는 디코더에 전달되지 않는다. 이 모듈은
 *   1) 트랙 `applyConstraints({ advanced: [{ zoom }] })` (지원 시)
 *   2) 원본 해상도에서 중앙 크롭 후 축소 (미지원·거부 시)
 * 두 경로의 수치만 맡는다. DOM 은 스캐너 셸이 소유한다.
 */

/** 복호 하한(셀당 px). scanner.js 주석의 실측(2026-08-11)과 같다. */
export const CELL_PX_FLOOR = 9;

/** 디코더에 넘기는 프레임 긴 변 상한. scanner.js FRAME_MAX_SIDE 와 같아야 한다. */
export const FRAME_MAX_SIDE = 960;

/**
 * 스캐너가 켤 때 쓰는 기본 배율. **한 곳에서만 바꾼다.**
 * 2 가 최적이라는 근거는 없다. 1배 성공률보다 낫다는 실측만 있다.
 */
export const DEFAULT_USER_ZOOM = 2;

/**
 * 조준 가이드의 기준 셀 수.
 * Type O V3 는 k=10 → 2k+1 = 21. Type Y Y1 은 n=21.
 * Y2 는 n=25 이라 같은 9px 하한에서 더 큰 점유율이 필요하다 — aimGuideFractions 가 따로 계산한다.
 */
export const GUIDE_CELLS_V3 = 21;
export const GUIDE_CELLS_Y2 = 25;

/** 크롭 배율 기본 범위. 하드웨어 zoom 이 없으면 이 값을 쓴다. */
export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 8;
export const CROP_ZOOM_STEP = 0.1;

/** 권장 점유율(프레임 한 변 대비). 하한 계산은 aimGuideFractions(). */
export const AIM_RECOMMEND_MIN = 0.3;
export const AIM_RECOMMEND_MAX = 0.5;
export const AIM_RECOMMEND = 0.4;

export function parseZoomCapability(capabilities) {
  const raw = capabilities && capabilities.zoom;
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const min = Number(raw.min);
    const max = Number(raw.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return null;
    const step = Number(raw.step);
    return {
      min,
      max,
      step: Number.isFinite(step) && step > 0 ? step : CROP_ZOOM_STEP,
    };
  }
  return null;
}

export function defaultZoomRange() {
  return { min: CROP_ZOOM_MIN, max: CROP_ZOOM_MAX, step: CROP_ZOOM_STEP };
}

export function zoomRangeFor(capability) {
  return capability || defaultZoomRange();
}

export function snapZoom(value, range) {
  const spec = zoomRangeFor(range);
  const n = Number(value);
  if (!Number.isFinite(n)) return spec.min;
  const clamped = Math.min(spec.max, Math.max(spec.min, n));
  const step = spec.step;
  if (!(step > 0)) return clamped;
  const snapped = spec.min + Math.round((clamped - spec.min) / step) * step;
  const bounded = Math.min(spec.max, Math.max(spec.min, snapped));
  return Number(bounded.toFixed(4));
}

/** ± 버튼은 한 손으로 쓸 수 있게 최소 0.5 배씩 움직인다. */
export function buttonStep(range) {
  const spec = zoomRangeFor(range);
  return Math.max(spec.step, 0.5);
}

export function zoomConstraint(value) {
  return { advanced: [{ zoom: value }] };
}

export function zoomMismatch(requested, applied, step) {
  if (!Number.isFinite(requested) || !Number.isFinite(applied)) return true;
  const tol = Math.max(Number(step) || CROP_ZOOM_STEP, 0.05);
  return Math.abs(requested - applied) > tol + 1e-6;
}

/**
 * 원본 프레임에서 중앙 정사각을 크롭한 뒤, 필요할 때만 축소한다.
 * 축소 후 크롭하면 셀 픽셀이 이미 사라진 뒤다.
 *
 * cropZoom=1 → 기존 imageDataCenterSquare 와 동일(짧은 변 전체).
 * cropZoom=2 → 짧은 변의 절반만 남긴다.
 * target 은 크롭 한 변과 maxSide 중 작은 값 — 없는 픽셀을 만들어 올리지 않는다.
 */
export function cropWindow(width, height, cropZoom, maxSide = FRAME_MAX_SIDE) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0) || !(h > 0)) return null;
  const zoom = Math.max(1, Number(cropZoom) || 1);
  const fullSide = Math.min(w, h);
  const sourceSide = Math.max(1, fullSide / zoom);
  const cap = Number(maxSide) > 0 ? Number(maxSide) : FRAME_MAX_SIDE;
  return {
    sourceX: (w - sourceSide) / 2,
    sourceY: (h - sourceSide) / 2,
    sourceSide,
    target: Math.max(1, Math.min(cap, Math.round(sourceSide))),
    cropZoom: fullSide / sourceSide,
  };
}

/**
 * 원본(확대·크롭 없음) 대비 셀이 몇 배로 커졌는가.
 * 트랙 zoom 은 getSettings() 값, cropZoom 은 실제로 자른 배율.
 */
export function effectiveMagnification({
  trackZoom = 1,
  trackNative = 1,
  cropZoom = 1,
} = {}) {
  const track = Number(trackZoom);
  const native = Number(trackNative);
  const crop = Number(cropZoom);
  const t = Number.isFinite(track) && track > 0 ? track : 1;
  const n = Number.isFinite(native) && native > 0 ? native : 1;
  const c = Number.isFinite(crop) && crop >= 1 ? crop : 1;
  return (t / n) * c;
}

/**
 * 요청값과 적용값을 한 객체로 고정한다.
 * 실패해도 요청값은 남긴다 — 오늘 사고의 본질이 «조용히 1 로 보임» 이었다.
 */
export function zoomTelemetry(state = {}) {
  const trackRequested = Number.isFinite(Number(state.trackRequested))
    ? Number(state.trackRequested)
    : 1;
  const trackApplied = Number.isFinite(Number(state.trackApplied))
    ? Number(state.trackApplied)
    : 1;
  const cropRequested = Number.isFinite(Number(state.cropRequested))
    ? Number(state.cropRequested)
    : 1;
  const cropApplied = Number.isFinite(Number(state.cropApplied))
    ? Number(state.cropApplied)
    : 1;
  const native = Number.isFinite(Number(state.trackNative)) && Number(state.trackNative) > 0
    ? Number(state.trackNative)
    : 1;
  const error = typeof state.error === 'string' && state.error ? state.error : '';
  return {
    zoom: trackApplied,
    zoomRequested: trackRequested,
    crop: cropApplied,
    cropRequested,
    effectiveZoom: effectiveMagnification({
      trackZoom: trackApplied,
      trackNative: native,
      cropZoom: cropApplied,
    }),
    zoomError: error,
  };
}

export function aimGuideFractions(frameSide = FRAME_MAX_SIDE, cellPx = CELL_PX_FLOOR) {
  const side = Number(frameSide) > 0 ? Number(frameSide) : FRAME_MAX_SIDE;
  const px = Number(cellPx) > 0 ? Number(cellPx) : CELL_PX_FLOOR;
  const minV3 = (GUIDE_CELLS_V3 * px) / side;
  const minY2 = (GUIDE_CELLS_Y2 * px) / side;
  return {
    floorPx: px,
    frameSide: side,
    minV3,
    minY2,
    recommendMin: AIM_RECOMMEND_MIN,
    recommendMax: AIM_RECOMMEND_MAX,
    recommend: AIM_RECOMMEND,
    innerInset: (1 - AIM_RECOMMEND) / 2,
  };
}

/**
 * 사용자 배율을 트랙 확대 / 크롭으로 나눈다.
 *
 * - 트랙이 지원되고 적용이 맞으면 크롭은 1.
 * - 트랙이 없거나 적용이 거부·불일치면 같은 배율을 크롭으로 돌린다.
 *   실패를 숨기지 않도록 error 코드를 남긴다.
 */
export function resolveZoomPlan({
  userZoom,
  capability = null,
  trackApplied = null,
  applyError = null,
  settingsMissing = false,
} = {}) {
  const range = zoomRangeFor(capability);
  const wanted = snapZoom(userZoom, range);
  const native = capability ? capability.min : 1;

  if (!capability) {
    const cropApplied = wanted >= 1 ? wanted : 1;
    return {
      mode: 'crop',
      trackRequested: 1,
      trackApplied: 1,
      cropRequested: wanted,
      cropApplied,
      trackNative: 1,
      error: wanted > 1 && cropApplied <= 1 ? 'fallback-1x' : '',
    };
  }

  if (applyError) {
    return {
      mode: 'crop-fallback',
      trackRequested: wanted,
      trackApplied: Number.isFinite(trackApplied) ? trackApplied : native,
      cropRequested: wanted,
      cropApplied: wanted,
      trackNative: native,
      error: String(applyError),
    };
  }

  if (settingsMissing || trackApplied == null || !Number.isFinite(trackApplied)) {
    return {
      mode: 'crop-fallback',
      trackRequested: wanted,
      trackApplied: native,
      cropRequested: wanted,
      cropApplied: wanted,
      trackNative: native,
      error: 'settings-unreported',
    };
  }

  if (zoomMismatch(wanted, trackApplied, capability.step)) {
    return {
      mode: 'crop-fallback',
      trackRequested: wanted,
      trackApplied,
      cropRequested: wanted,
      cropApplied: wanted,
      trackNative: native,
      error: 'mismatch',
    };
  }

  return {
    mode: 'track',
    trackRequested: wanted,
    trackApplied,
    cropRequested: 1,
    cropApplied: 1,
    trackNative: native,
    error: '',
  };
}

/**
 * 트랙에 zoom 을 건다. 실패 이유를 삼키지 않고 코드로 돌려준다.
 *
 * @param {{
 *   applyConstraints?: Function,
 *   getSettings?: Function,
 * }} track
 * @param {number} value
 */
export async function applyTrackZoom(track, value) {
  if (!track || typeof track.applyConstraints !== 'function') {
    return { ok: false, applied: null, error: 'no-applyConstraints' };
  }
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) {
    return { ok: false, applied: null, error: 'bad-zoom' };
  }

  let rejected = '';
  try {
    await track.applyConstraints(zoomConstraint(zoom));
  } catch (err) {
    rejected = (err && err.name ? err.name + ':' : '') +
      (err && err.message ? err.message : 'applyConstraints-rejected');
    try {
      await track.applyConstraints({ zoom });
    } catch (err2) {
      const second = (err2 && err2.name ? err2.name + ':' : '') +
        (err2 && err2.message ? err2.message : rejected);
      return { ok: false, applied: readTrackZoom(track), error: second || rejected };
    }
  }

  const applied = readTrackZoom(track);
  if (applied == null) {
    return { ok: false, applied: null, error: 'settings-unreported' };
  }
  return { ok: true, applied, error: '' };
}

export function readTrackZoom(track) {
  if (!track || typeof track.getSettings !== 'function') return null;
  try {
    const zoom = track.getSettings().zoom;
    return Number.isFinite(zoom) ? zoom : null;
  } catch {
    return null;
  }
}

export function readTrackCapability(track) {
  if (!track || typeof track.getCapabilities !== 'function') return null;
  try {
    return parseZoomCapability(track.getCapabilities());
  } catch {
    return null;
  }
}
