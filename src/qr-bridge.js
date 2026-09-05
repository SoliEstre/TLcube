/**
 * 일반 QR 브리지 — 브라우저 `BarcodeDetector` 에 위임한다 (PM/029B §2 ①단계 · §26).
 *
 * 왜 위임인가: 의존성 0 으로 «기존 QR 스캐너의 상위집합» 이 되어야 스캐너 자체로든
 * 라이브러리로든 TL 스캔을 끼워 넣어 보급할 수 있다 (운영자 결정 2026-09-05). 자체
 * QR 복호기는 이 프로그램의 범위가 아니다.
 *
 * 능력은 **실행 시 판정**이다 — Android Chrome(ML Kit 위임)·macOS/iOS Safari(Vision 위임)
 * 가용, Firefox 미지원, Windows 데스크톱 Chrome 은 생성자만 있고 `qr_code` 포맷이 없다.
 * 그래서 안내 문구도 판정을 따른다 (`scanScopeCopyKey(r2Enabled, qrCapable)`).
 *
 * 규약: TL 리더 QR(`HTTPS://TLSCAN.ESTRE.SO[/x]`) 은 «TL 코드가 있다» 는 신호라 결과로
 * 노출하지 않고 R1 의 가족 힌트로만 쓴다. 그 밖의 QR 은 R1·R2 와 **같은 결과 문**을 지난다 —
 * 단 URL 은 자동으로 열지 않는다(피싱 벡터 · 스캐너 쪽 `showResult` 의 `autoOpen`).
 *
 * 이 파일의 순수 부분(`classifyQrValue` · `routeQrHits` · `qrFrameGateOpen`)이 규약의 정본이다 —
 * 스캐너 배선은 그것을 부르기만 하고, 테스트는 그것을 값으로 잰다.
 */

import { TL_READER_URL, tlReaderFamilyHintFromPath } from './qr.js';

export const QR_VALUE_KIND = Object.freeze({
  /** TL 리더 URL + 등록부 힌트 글자 — 가족 힌트로 쓴다. 비노출. */
  TL_HINT: 'tl-hint',
  /** TL 리더 URL 만(또는 예약·미지의 한 글자) — «TL 코드다» 는 알지만 가족은 모른다. 비노출. */
  TL_PLAIN: 'tl-plain',
  /** 그 밖의 QR — 결과로 노출한다. */
  OTHER: 'other',
  /** 빈 값·비문자열. */
  EMPTY: 'empty',
});

/**
 * QR 원문을 분류한다. 순수 함수 — 브리지·테스트·(장차) 라이브러리가 같은 규약을 쓴다.
 *
 * TL 종류는 규약 그대로 **정확히** `URL` · `URL/` · `URL/x`(한 글자 [0-9A-Z]) 만이다.
 * `URL/lab` 같은 페이지 링크는 일반 QR(노출)이다 — 넓게 잡으면 시험판 링크 QR 을 찍은 사용자가
 * «아무 일도 안 일어난다» 를 본다. TL 리더 URL 은 대문자 알파뉴메릭이지만 디코더가 소문자로
 * 줄 수도 있어 대문자로 맞춰 본다.
 */
export function classifyQrValue(raw) {
  if (typeof raw !== 'string' || raw === '') return { kind: QR_VALUE_KIND.EMPTY, family: null, text: '' };
  const upper = raw.trim().toUpperCase();
  const isTl = upper === TL_READER_URL
    || upper === TL_READER_URL + '/'
    || (upper.length === TL_READER_URL.length + 2
      && upper.charCodeAt(TL_READER_URL.length) === 47
      && /^[0-9A-Z]$/.test(upper.slice(TL_READER_URL.length + 1)));
  if (isTl) {
    const path = upper.slice(TL_READER_URL.length);
    const family = tlReaderFamilyHintFromPath(path === '' ? '/' : path);
    return {
      kind: family === null ? QR_VALUE_KIND.TL_PLAIN : QR_VALUE_KIND.TL_HINT,
      family,
      text: raw,
    };
  }
  return { kind: QR_VALUE_KIND.OTHER, family: null, text: raw };
}

/**
 * QR 적중을 R1·R2 와 **같은 문**(`normalizeDecodePayload`)이 받는 모양으로 만든다.
 * TL 종류는 노출 대상이 아니므로 null — 호출자가 힌트로만 쓴다.
 */
export function qrHitToDecodeResult(hit) {
  if (!hit || hit.kind !== QR_VALUE_KIND.OTHER || typeof hit.text !== 'string' || hit.text === '') {
    return null;
  }
  // autoOpen:false 를 직접 싣는다 — 스캐너의 허용 목록(resultAutoOpen)과 이중 안전.
  return { ok: true, payload: hit.text, source: 'qr', qrKind: hit.kind, autoOpen: false };
}

/**
 * 프레임 루프의 QR 게이트 — 세 조건이 **모두** 참일 때만 detect 를 제출한다.
 *  · r2Enabled: 시험판 R2 토글(정식 경로는 항상 false → 정식 불변).
 *  · qrSupported: 실행 시 판정.
 *  · readyState ≥ 2(HAVE_CURRENT_DATA): 그 아래에서 `detect(<video>)` 는 InvalidStateError 다.
 */
export function qrFrameGateOpen(state) {
  return Boolean(state)
    && state.r2Enabled === true
    && state.qrSupported === true
    && Number.isFinite(state.readyState) && state.readyState >= 2;
}

/**
 * 한 프레임의 분류된 적중들을 «힌트» 와 «노출» 로 나눈다 (순수).
 *  · TL 종류는 전부 힌트 — 가족이 있는 마지막 것을 채택한다.
 *  · TL 종류가 하나라도 있으면 **아무것도 노출하지 않는다** — TL 코드를 겨눈 사용자 의도가
 *    옆의 링크 QR 보다 앞선다 (통합자 결정 2026-09-05).
 *  · 그 밖에는 첫 OTHER 를 노출한다 — 브리지가 가시 영역 중심에 가까운 순으로 정렬해 준다.
 */
export function routeQrHits(hits) {
  let family = null;
  let sawTl = false;
  let expose = null;
  for (const hit of Array.isArray(hits) ? hits : []) {
    if (!hit) continue;
    if (hit.kind === QR_VALUE_KIND.TL_HINT || hit.kind === QR_VALUE_KIND.TL_PLAIN) {
      sawTl = true;
      if (typeof hit.family === 'string' && hit.family) family = hit.family;
    } else if (hit.kind === QR_VALUE_KIND.OTHER && expose === null) {
      expose = hit;
    }
  }
  return { family, expose: sawTl ? null : expose };
}

/**
 * `BarcodeDetector` 지원 판정. 생성자·`getSupportedFormats`·`qr_code` 셋을 다 확인한다 —
 * 생성자만 있고 QR 포맷이 없는 조합(Windows 데스크톱 Chrome)이 실재한다. node 에선 `no-api`.
 */
export async function probeQrDetector(Ctor) {
  if (typeof Ctor !== 'function') return { supported: false, reason: 'no-api' };
  try {
    const formats = typeof Ctor.getSupportedFormats === 'function'
      ? await Ctor.getSupportedFormats()
      : [];
    if (!Array.isArray(formats) || !formats.includes('qr_code')) {
      return { supported: false, reason: 'no-qr-format' };
    }
    return { supported: true, reason: '' };
  } catch {
    return { supported: false, reason: 'probe-threw' };
  }
}

/** 검출 항목의 중심(소스 픽셀). boundingBox → cornerPoints 순. 못 찾으면 null. */
function detectedCentre(code) {
  const box = code && code.boundingBox;
  if (box && Number.isFinite(box.x) && Number.isFinite(box.width)
    && Number.isFinite(box.y) && Number.isFinite(box.height)) {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  const pts = code && code.cornerPoints;
  if (Array.isArray(pts) && pts.length > 0
    && pts.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
    let sx = 0;
    let sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  }
  return null;
}

/**
 * 브리지 — 한 번에 하나만 비행(in-flight 가드) · 간격 캐던스 · 세션 토큰 · 가시 영역 필터.
 *
 *  · `detect()` 는 비동기다. 프레임 루프는 동기이므로 결과는 콜백으로 나가고, `reset()`
 *    뒤에 늦게 도착한 결과는 토큰이 달라 버린다 (카메라 재시작 뒤 옛 QR 이 뜨지 않는다).
 *    토큰 검사는 in-flight 해제보다 **앞**이다 — 옛 결과가 새 비행의 잠금을 풀면 안 된다.
 *  · 입력은 `<video>` 자체를 권한다 — grab 중복이 없고 전체 해상도다. 그래서 **가시 영역**을
 *    같이 받는다: 프리뷰는 센서 프레임의 가운데 정사각만 보여 주므로, 사용자가 못 보는 가장자리의
 *    QR 을 읽어 결과로 내면 «화면에 없는 코드가 읽혔다» 가 된다. 영역 밖은 버리고, 안쪽은 영역
 *    중심에 가까운 순으로 정렬해 넘긴다. 위치를 못 주는 구현(boundingBox·cornerPoints 없음)의
 *    항목은 살리되 `stats.unlocated` 로 센다.
 *  · 실패(detect 가 던짐 · 콜백이 던짐)는 세기만 하고 삼킨다. 부가 경로가 단발을 막지 않는다.
 */
export function createQrBridge(options = {}) {
  const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(0, options.intervalMs) : 250;
  const Ctor = options.BarcodeDetector !== undefined
    ? options.BarcodeDetector
    : (typeof globalThis !== 'undefined' ? globalThis.BarcodeDetector : undefined);
  let detector = null;
  let supported = false;
  let probed = false;
  let reason = '';
  let inFlight = false;
  let lastAt = -Infinity;
  let session = 0;
  const stats = { detects: 0, hits: 0, errors: 0, dropped: 0, outside: 0, unlocated: 0, lastKind: '' };

  async function probe() {
    const verdict = await probeQrDetector(Ctor);
    probed = true;
    supported = verdict.supported;
    reason = verdict.reason;
    if (supported) {
      try {
        detector = new Ctor({ formats: ['qr_code'] });
      } catch {
        detector = null;
        supported = false;
        reason = 'construct-threw';
      }
    }
    return supported;
  }

  function reset() {
    session += 1;
    inFlight = false;
    lastAt = -Infinity;
  }

  function selectVisible(codes, region) {
    const list = Array.isArray(codes)
      ? codes.filter((c) => c && typeof c.rawValue === 'string' && c.rawValue !== '')
      : [];
    if (!region || !(region.width > 0) || !(region.height > 0)) return list;
    const cx = region.x + region.width / 2;
    const cy = region.y + region.height / 2;
    const kept = [];
    for (const code of list) {
      const centre = detectedCentre(code);
      if (centre === null) { stats.unlocated += 1; kept.push({ code, d: Infinity }); continue; }
      const inside = centre.x >= region.x && centre.x <= region.x + region.width
        && centre.y >= region.y && centre.y <= region.y + region.height;
      if (!inside) { stats.outside += 1; continue; }
      const dx = centre.x - cx;
      const dy = centre.y - cy;
      kept.push({ code, d: dx * dx + dy * dy });
    }
    kept.sort((a, b) => a.d - b.d);
    return kept.map((k) => k.code);
  }

  /**
   * 프레임을 넘긴다. 즉시 true(제출됨)/false(건너뜀)를 돌려주고, 적중은 `onHits(classified[])`
   * 로 — 가시 영역 안의 것만, 중심에 가까운 순. 콜백 안에서 호출자가 세션·토글을 다시
   * 확인해야 한다 — 브리지는 자기 토큰만 안다.
   */
  function pushFrame(source, timestamp, onHits, frameOptions = {}) {
    if (!supported || detector === null || inFlight) return false;
    if (!(timestamp - lastAt >= intervalMs)) return false;
    lastAt = timestamp;
    inFlight = true;
    const token = session;
    const region = frameOptions && frameOptions.region ? frameOptions.region : null;
    stats.detects += 1;
    let promise;
    try {
      promise = Promise.resolve(detector.detect(source));
    } catch {
      inFlight = false;
      stats.errors += 1;
      return true;
    }
    promise.then((codes) => {
      if (token !== session) { stats.dropped += 1; return; }
      inFlight = false;
      const visible = selectVisible(codes, region);
      if (visible.length === 0) return;
      const classified = visible.map((c) => classifyQrValue(c.rawValue));
      stats.hits += 1;
      stats.lastKind = classified[0].kind;
      if (typeof onHits === 'function') {
        try {
          onHits(classified);
        } catch {
          stats.errors += 1;
        }
      }
    }, () => {
      if (token !== session) { stats.dropped += 1; return; }
      inFlight = false;
      stats.errors += 1;
    });
    return true;
  }

  return {
    probe,
    pushFrame,
    reset,
    get supported() { return supported; },
    get probed() { return probed; },
    get reason() { return reason; },
    get inFlight() { return inFlight; },
    stats,
  };
}
