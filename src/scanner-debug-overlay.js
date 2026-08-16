/**
 * scanner-debug-overlay.js — lab 전용 검출 상태 디버그 오버레이 (운영자 요청 2026-08-16).
 *
 * 실기기에서 «가이드가 안 보인다 / 프레임이 잘린다» 를 원격 추정이 아니라 눈으로
 * 판별하기 위한 실시간 인디케이터다. 표시 항목은 전부 decodeFrame 경로에 **이미
 * 로컬로 존재하는 값**(extractGeometry · extractCellSurfaceProbe · extractCsAnchors ·
 * zoomTelemetry)의 재표시다 — 새 전송 경로를 만들지 않는다(안정판 텔레메트리
 * 0바이트 불변식은 이 모듈이 아예 활성화되지 않는 것으로 지킨다).
 *
 * ## 안정판(`/`) 불활성 계약
 * `createDebugOverlay({ enabled: isLabPath(), … })` — enabled 가 아니면 **어떤 DOM 도
 * 만지지 않는 동결된 no-op API** 를 돌려준다. 마크업의 요소들은 authored `hidden`
 * 그대로 남는다. scanner-debug-overlay.test.js 가 기록형 스텁으로 «mutation 0» 을
 * 기능적으로 단언한다 (regex 신뢰가 아니라 실행 증거).
 *
 * ## 좌표계 (r3 정사각 뷰)
 * 분석 프레임(변 frameW=frameH px)과 정사각 뷰(변 side px)는 **둘 다 중앙 정렬
 * 정사각**이라 투영이 순수 배율이다: view = frame × side/frameSide. 역투영 수식이
 * 없다 — 그것이 r3 구조의 목적이다. 분석 정사각 외곽선은 뷰 경계 자체다(clamp 없음,
 * 뷰 = 분석 영역이므로 «화면 밖으로 이어질» 것이 존재하지 않는다).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** clipSide → 테두리 색. none=초록 · 단면=노랑 · multi=빨강 · 미상=회청. */
export const CLIP_COLORS = Object.freeze({
  none: '#31d07c',
  single: '#f3c53d',
  multi: '#ef5350',
  unknown: '#7f93a8',
});

export function clipColorOf(clipSide) {
  if (clipSide === 'none') return CLIP_COLORS.none;
  if (clipSide === 'multi') return CLIP_COLORS.multi;
  if (typeof clipSide === 'string' && clipSide !== '') return CLIP_COLORS.single;
  return CLIP_COLORS.unknown;
}

/**
 * 분석 프레임 좌표 → 정사각 뷰 좌표. 둘 다 중앙 정렬 정사각이라 배율만 있다.
 * (사진 경로처럼 프레임이 정사각이 아니면 축별 배율로 일반화 — 마커 위치는
 * 프리뷰가 없는 경로라 참고용이다.)
 */
export function projectFramePoint(point, frameW, frameH, viewSide) {
  const x = Number(point && point.x);
  const y = Number(point && point.y);
  const w = Number(frameW);
  const h = Number(frameH);
  const side = Number(viewSide);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0) || !(side > 0)) {
    return null;
  }
  return { x: (x / w) * side, y: (y / h) * side };
}

/**
 * 표시용 수 포맷 — 소수부의 꼬리 0 만 지운다.
 *
 * ⚠ [수정 2026-08-16] 구현이 `toFixed(digits).replace(/\.?0+$/, '')` 였다. 소수점이
 *   **없는** 문자열에도 그 정규식이 걸려서 정수의 꼬리 0 을 먹었다:
 *     fmt(1200, 0) → '12'   ·  fmt(340, 0) → '34'  ·  fmt(0, 0) → ''
 *   즉 프레임 시간 340ms 가 오버레이에 «34ms» 로 찍히고 있었다 (기존 테스트 표본이
 *   342.4 라 꼬리 0 이 없어 통과했다). 소수점이 있을 때만 자른다.
 */
function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  const text = Number(value).toFixed(digits);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * 프레임 1개의 디버그 텍스트 라인. 순수 함수 — 패널 DOM 은 이걸 그대로 붙인다.
 * 파이프라인 도달: geometry 유무 → cs_attempted → cs_accepted → body/RS.
 */
export function summarizeFrameDebug({
  frameW,
  frameH,
  ms,
  ok,
  reason,
  stage,
  geometry,
  cellSurface,
  anchors,
  zoom,
  steady,
  prior,
} = {}) {
  const geo = geometry || {};
  const cs = cellSurface || {};
  const z = zoom || {};
  const lines = [];
  lines.push(
    'frame ' + (frameW || '—') + 'x' + (frameH || '—')
    + ' · ' + fmt(Number(ms), 0) + 'ms'
    + ' · zoom ' + fmt(Number(z.zoom)) + (z.zoomError ? '!' + z.zoomError : '')
    + ' crop ' + fmt(Number(z.crop))
    + ' eff ' + fmt(Number(z.effectiveZoom)),
  );
  lines.push(
    'geo ' + (geo.geometryStage || 'none')
    + ' · clip ' + (geo.clipSide || '—')
    + ' · occ ' + fmt(Number(geo.occupancy))
    + ' · cell ' + fmt(Number(geo.cellPx), 1) + 'px',
  );
  const csState = cs.attempted
    ? (cs.accepted ? 'accepted' : 'rejected')
    : 'not-attempted';
  lines.push(
    'cs ' + csState
    + ' · agree ' + fmt(Number(cs.score))
    + ' · layout ' + (cs.layoutId || '—')
    + (cs.expectedLayout ? ' (exp ' + cs.expectedLayout + ')' : '')
    + (cs.reason ? ' · ' + cs.reason : '')
    + ' · anchors ' + (Array.isArray(anchors) ? anchors.length : 0),
  );
  lines.push(
    'stage ' + (stage || '—')
    + (ok ? ' · OK' : (reason ? ' · ' + reason : '')),
  );
  if (steady) lines.push(steadyLine(steady, prior));
  return lines;
}

/** 게이지 막대 — 폭 10칸. 「1.5s 가 얼마나 찼나」 를 한눈에. */
function gaugeBar(progress, width = 10) {
  const value = Number(progress);
  const filled = Number.isFinite(value)
    ? Math.max(0, Math.min(width, Math.round(value * width)))
    : 0;
  return '[' + '#'.repeat(filled) + '·'.repeat(width - filled) + ']';
}

/**
 * 안정 유지 + 가이드-사전 상태 한 줄 (lab 전용).
 * 표시 항목은 전부 프레임 루프가 이미 만든 로컬 값이다 — 새 전송 경로 없음.
 *
 * ⚠ 센서 표기는 **두 가지 사실을 분리해서** 낸다 (2026-08-16 정정).
 *   · `sensor:on|off|VETO` — 지금 **표본이 실제로 오고 있나** (`sensorActive` 는 전 필드
 *     null 인 이벤트를 세지 않는다).
 *   · 괄호 안 `attach` — **왜** 안 오는가 / 어떤 경로로 붙었나
 *     (`off:wait-gesture` = iOS 자동 시작이라 다음 제스처까지 지연, `off:unsupported`,
 *      `off:denied`, `on:no-gate`, `on:gesture-required`).
 *   이 둘을 한 글자로 합치면 「센서가 켜져 있다」 는 착각이 화면에서부터 자란다 —
 *   실제로 정식 주 경로에서 센서가 한 번도 안 붙던 것을 문서가 못 본 원인이 그것이다.
 */
export function steadyLine(steady, prior) {
  const s = steady || {};
  const p = prior || {};
  const sensor = 'sensor:' + (s.sensorActive
    ? (s.motionVetoed ? 'VETO' : 'on')
    : 'off')
    + (s.attach ? '(' + s.attach + ')' : '');
  const held = fmt(Number(s.heldMs), 0) + '/' + fmt(Number(s.holdMs), 0) + 'ms'
    // 표본 수 — 「1.5초」 가 표본 몇 장으로 만들어졌나. 복호가 느려 표본이 드물면
    // 캡(sampleCapMs) 때문에 시간이 천천히 찬다는 것을 화면이 설명해야 한다.
    + (Number.isFinite(Number(s.holdSamples)) ? '(n' + fmt(Number(s.holdSamples), 0) + ')' : '');
  const parts = [
    'steady ' + gaugeBar(s.progress),
    held,
    'd ' + fmt(Number(s.delta), 3) + '/' + fmt(Number(s.tolerance), 3),
    'a ' + fmt(Number(s.anchorDelta), 3) + '/' + fmt(Number(s.anchorTolerance), 3),
    s.armed ? 'ARMED' : (s.stable ? 'hold' : 'move'),
    sensor,
  ];
  if (p.stage) {
    parts.push('prior ' + p.stage + ':' + (p.ok ? 'OK' : 'fail')
      + ' n' + fmt(Number(p.poses), 0)
      + (Number.isFinite(Number(p.admitted)) ? ' adm' + fmt(Number(p.admitted), 0) : '')
      + ' ' + fmt(Number(p.ms), 0) + 'ms');
  } else if (Number.isFinite(Number(p.budget))) {
    parts.push('prior budget ' + fmt(Number(p.budget), 0));
  }
  return parts.join(' · ');
}

const INERT_OVERLAY = Object.freeze({
  enabled: false,
  isVisible() { return false; },
  setViewSide() {},
  frame() {},
  flagDotIssue() {},
  toggle() {},
});

/**
 * lab 디버그 오버레이 팩토리.
 *
 * @param {{
 *   enabled: boolean,        // isLabPath() — 아닐 때 동결 no-op (안정판 불활성 계약)
 *   layer: Element|null,     // 정사각 뷰 안 SVG (외곽선 + 앵커 마커)
 *   panel: Element|null,     // 텍스트 패널
 *   toggleButton: Element|null,
 *   doc: Document|null,
 * }} deps
 */
export function createDebugOverlay({
  enabled,
  layer,
  panel,
  toggleButton,
  doc,
} = {}) {
  if (enabled !== true || !layer || !panel || !doc) return INERT_OVERLAY;

  let visible = true; // 기본 켬 (운영자 요청) — lab 한정이므로 항상 켜고 시작한다.
  let viewSide = 0;
  let dotIssueText = '';

  const outline = doc.createElementNS(SVG_NS, 'rect');
  outline.setAttribute('class', 'lab-debug-outline');
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', CLIP_COLORS.unknown);
  outline.setAttribute('stroke-width', '3');
  const markerGroup = doc.createElementNS(SVG_NS, 'g');
  markerGroup.setAttribute('class', 'lab-debug-anchors');
  layer.append(outline, markerGroup);

  /*
   * ⚠ `.hidden` **프로퍼티**를 쓰지 않는다 — SVG 요소(HTMLElement 가 아님)에는 hidden
   * IDL 이 없어서 대입이 렌더에 아무 효과 없는 expando 가 된다(실브라우저 확인
   * 2026-08-16: svg.hidden === undefined). 속성 조작 + 스타일시트의
   * `[hidden] { display: none !important }` 조합은 HTML·SVG 모두에서 동작한다.
   */
  function setHiddenAttr(element, state) {
    if (state) element.setAttribute('hidden', '');
    else element.removeAttribute('hidden');
  }

  function applyVisibility() {
    setHiddenAttr(layer, !visible);
    setHiddenAttr(panel, !visible);
    if (toggleButton) {
      toggleButton.setAttribute('aria-pressed', visible ? 'true' : 'false');
      toggleButton.classList.toggle('active', visible);
    }
  }

  function setViewSide(side) {
    const s = Number(side);
    if (!(s > 0)) return;
    viewSide = s;
    layer.setAttribute('viewBox', '0 0 ' + s + ' ' + s);
    // 외곽선 = 분석 정사각 경계 그 자체 (r3: 뷰 ≡ 분석). stroke 절반만 안쪽으로.
    outline.setAttribute('x', '1.5');
    outline.setAttribute('y', '1.5');
    outline.setAttribute('width', String(s - 3));
    outline.setAttribute('height', String(s - 3));
  }

  function renderAnchors(anchors, frameW, frameH) {
    const fragment = doc.createDocumentFragment();
    if (Array.isArray(anchors) && viewSide > 0) {
      for (const anchor of anchors) {
        const projected = projectFramePoint(anchor, frameW, frameH, viewSide);
        if (!projected) continue;
        const mark = doc.createElementNS(SVG_NS, 'circle');
        mark.setAttribute('class', 'lab-debug-anchor');
        mark.setAttribute('cx', String(projected.x));
        mark.setAttribute('cy', String(projected.y));
        const u = Number(anchor.u);
        const radius = Number.isFinite(u) && u > 0 && frameW > 0
          ? Math.max(4, (u / frameW) * viewSide)
          : 6;
        mark.setAttribute('r', String(radius));
        fragment.append(mark);
      }
    }
    markerGroup.replaceChildren(fragment);
  }

  function frame(update = {}) {
    if (!visible) return;
    outline.setAttribute('stroke', clipColorOf(update.geometry && update.geometry.clipSide));
    renderAnchors(update.anchors, update.frameW, update.frameH);
    const lines = summarizeFrameDebug(update);
    if (dotIssueText) lines.push(dotIssueText);
    panel.textContent = lines.join('\n');
  }

  function flagDotIssue(outOfBounds) {
    dotIssueText = Array.isArray(outOfBounds) && outOfBounds.length > 0
      ? 'DOT-OOB ' + outOfBounds.map((d) => d.ring + '#' + d.index).join(' ')
      : '';
  }

  function toggle() {
    visible = !visible;
    applyVisibility();
  }

  if (toggleButton) {
    setHiddenAttr(toggleButton, false);
    toggleButton.addEventListener('click', toggle);
  }
  applyVisibility();

  return Object.freeze({
    enabled: true,
    isVisible() { return visible; },
    setViewSide,
    frame,
    flagDotIssue,
    toggle,
  });
}
