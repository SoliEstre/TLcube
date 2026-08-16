/**
 * help-popover.js — 섹션 제목 우측 «?» 도움말의 **단일 구현**.
 *
 * 왜 모듈로 빼는가: 생성기의 부연 설명은 원래 두 군데에 흩어져 있었다 —
 * ① 카드마다 붙은 `title=` (네이티브 툴팁: 모바일에서 안 뜨고, 지연이 브라우저마다
 * 다르고, 줄바꿈이 안 된다) ② 섹션 아래 `.hint` 여러 줄(항상 자리를 차지해 옵션
 * 목록이 스크롤 밖으로 밀린다). 둘을 하나의 «?» 버튼으로 모으면서, 열림 상태 관리·
 * 뷰포트 보정·접근성 속성을 **한 곳에만** 두려고 분리했다. 섹션마다 복제하면
 * «어떤 섹션은 ESC 로 안 닫힌다» 같은 편차가 반드시 생긴다.
 *
 * 동작 계약:
 *   · hover (포인터가 hover 를 지원할 때) → 임시 툴팁. 포인터가 떠나면 닫힌다.
 *   · click / tap → **고정(pinned)**. 우측 상단 X · ESC · 바깥 클릭으로 닫는다.
 *   · hover 불가 기기(터치) → 탭이 곧 고정. hover 단계가 없다.
 *   · 열려 있는 버튼을 다시 누르면 닫힌다 (토글).
 *   · 다른 «?» 를 누르면 그쪽으로 옮겨 간다.
 *   · ESC 는 **어느 경로로 열렸든** 닫는다. 포커스는 «원래 이쪽에 있었을 때만» 앵커로
 *     되돌린다 — hover 로 연 창이 ESC 로 포커스를 훔치면 안 된다.
 *
 * 접근성: 버튼은 `<button type="button">` 이어야 하고(호출 측 책임), 이 모듈이
 * `aria-expanded` 와 `aria-describedby` 를 상태에 맞춰 유지한다. 팝오버는
 * `role="tooltip"` 이며 닫혀 있을 때 `hidden` 이라 접근성 트리에서 빠진다.
 * 고정 상태에서는 **팝오버 안 X 버튼으로 포커스를 옮긴다** — 그러지 않으면 X 가
 * 키보드로 도달 불가한 컨트롤이 된다 (닫기 경로가 ESC 하나뿐이 된다).
 *
 * 런타임 의존성 0 · 순수 ESM. `positionHelpPopover` 는 DOM 을 안 만지는 순수 함수라
 * 뷰포트 가장자리 보정을 단위 테스트로 고정할 수 있다.
 */

/** 앵커와 팝오버 사이 간격(px). */
export const HELP_POPOVER_GAP = 8;
/** 뷰포트 가장자리 최소 여백(px). */
export const HELP_POPOVER_EDGE = 8;

/**
 * 팝오버의 좌표를 정한다 — 앵커 아래 중앙 정렬이 기본이고, 뷰포트를 벗어나면
 * ① 좌우는 가장자리 여백까지 밀어 넣고 ② 아래가 모자라면 위로 뒤집고
 * ③ 위아래 어디도 안 되면 세로도 밀어 넣는다(clamped).
 *
 * 폭이 뷰포트보다 넓으면 왼쪽 여백에 맞춘다 — 오른쪽이 잘리는 편이 왼쪽(제목 쪽)이
 * 잘리는 것보다 읽기 쉽다.
 *
 * @param {{left:number, top:number, width:number, height:number, bottom:number}} anchor 앵커 사각형(뷰포트 좌표)
 * @param {{width:number, height:number}} size 팝오버 크기
 * @param {{width:number, height:number}} viewport 뷰포트 크기
 * @param {{gap?:number, edge?:number}} [options]
 * @returns {{left:number, top:number, placement:'below'|'above'|'clamped'}}
 */
export function positionHelpPopover(anchor, size, viewport, options = {}) {
  const gap = options.gap === undefined ? HELP_POPOVER_GAP : options.gap;
  const edge = options.edge === undefined ? HELP_POPOVER_EDGE : options.edge;

  let left = anchor.left + anchor.width / 2 - size.width / 2;
  const maxLeft = viewport.width - size.width - edge;
  if (left > maxLeft) left = maxLeft;
  if (left < edge) left = edge;

  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const bottomLimit = viewport.height - edge;

  // ⚠ «above >= edge» 만 보면 모자란다. 앵커가 뷰포트 **아래로 벗어나 있으면**
  //   (고정된 팝오버를 두고 스크롤한 경우) above 가 큰 양수가 되어 위 분기를 통과한
  //   뒤 아래쪽으로 삐져나간다. 실제로 그렇게 창이 화면 밖(top 795 / h 206 / 뷰포트
  //   812)에 섰다 — 두 분기 모두 «완전히 들어가는가» 로 판정한다.
  let top;
  let placement;
  if (below + size.height <= bottomLimit) {
    top = below;
    placement = 'below';
  } else if (above >= edge && above + size.height <= bottomLimit) {
    top = above;
    placement = 'above';
  } else {
    top = Math.max(edge, viewport.height - size.height - edge);
    placement = 'clamped';
  }
  return { left, top, placement };
}

/** 이 환경이 진짜 hover 를 지원하는가 (터치 전용이면 false). */
function defaultHoverCapable(view) {
  if (!view || typeof view.matchMedia !== 'function') return true;
  try {
    return view.matchMedia('(hover: hover)').matches;
  } catch {
    return true;
  }
}

/**
 * 도움말 팝오버 컨트롤러를 만든다.
 *
 * @param {object} config
 * @param {HTMLElement} config.popover  팝오버 컨테이너 (`role="tooltip"`, 초기 `hidden`)
 * @param {HTMLElement} config.body     본문이 들어갈 요소
 * @param {HTMLElement} [config.closeButton] 고정 상태의 X 버튼
 * @param {(button: HTMLElement) => string[]} config.linesFor 버튼 → 본문 줄 배열
 * @param {Document} [config.doc]
 * @param {Window} [config.view]
 * @returns {{attach:Function, open:Function, close:Function, refresh:Function, isOpen:Function, isPinned:Function, currentButton:Function}}
 */
export function createHelpPopover(config) {
  const { popover, body, closeButton, linesFor } = config;
  if (!popover || !body || typeof linesFor !== 'function') {
    throw new TypeError('popover · body · linesFor 가 필요하다');
  }
  const doc = config.doc || (typeof document !== 'undefined' ? document : null);
  const view = config.view || (typeof window !== 'undefined' ? window : null);
  if (!doc) throw new TypeError('document 를 찾을 수 없다');

  const hoverCapable = typeof config.hoverCapable === 'function'
    ? config.hoverCapable
    : () => defaultHoverCapable(view);

  if (!popover.id) popover.id = 'helpPopover';

  const buttons = new Set();
  let openButton = null;
  let pinned = false;
  /**
   * 프로그램적 `focus()` 가 `focus` 리스너를 타고 방금 닫은 창을 다시 여는 것을 막는다.
   * `HTMLElement.focus()` 는 focus 이벤트를 **동기로** 발화하므로 try/finally 로 충분하다.
   */
  let suppressFocusOpen = false;

  function focusWithoutReopen(el) {
    if (!el || typeof el.focus !== 'function') return;
    suppressFocusOpen = true;
    try { el.focus(); } finally { suppressFocusOpen = false; }
  }

  /** 지금 포커스가 앵커 버튼이나 팝오버 안에 있는가 (= 닫을 때 돌려줘야 하는가). */
  function focusIsInside(button) {
    const active = doc.activeElement;
    if (!active) return false;
    if (active === button) return true;
    return typeof popover.contains === 'function' && popover.contains(active);
  }

  function paint(button) {
    // textContent 로만 쓴다 — 사전 문자열이라도 innerHTML 경로를 열어 두지 않는다.
    body.textContent = '';
    for (const line of linesFor(button)) {
      const p = doc.createElement('p');
      p.className = 'help-popover-line';
      p.textContent = line;
      body.appendChild(p);
    }
  }

  function place(button) {
    const rect = button.getBoundingClientRect();
    const size = { width: popover.offsetWidth, height: popover.offsetHeight };
    const viewport = {
      width: (view && view.innerWidth) || size.width,
      height: (view && view.innerHeight) || size.height,
    };
    const at = positionHelpPopover(
      {
        left: rect.left, top: rect.top, width: rect.width,
        height: rect.height, bottom: rect.bottom,
      },
      size,
      viewport,
    );
    popover.style.left = `${Math.round(at.left)}px`;
    popover.style.top = `${Math.round(at.top)}px`;
    popover.dataset.placement = at.placement;
  }

  function open(button, { pin = false } = {}) {
    if (!button) return;
    if (openButton && openButton !== button) markClosed(openButton);
    openButton = button;
    pinned = pin;
    paint(button);
    popover.hidden = false;
    popover.classList.toggle('pinned', pinned);
    if (closeButton) closeButton.hidden = !pinned;
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-describedby', popover.id);
    place(button);
    // 고정 상태의 X 는 팝오버 **안**에 있어서 탭 순서상 앵커 다음이 아니다. 포커스를
    // 옮겨 주지 않으면 키보드·보조기술 사용자에게 «닫기» 컨트롤이 사실상 없다.
    // (임시 hover 상태로는 옮기지 않는다 — 마우스가 지나갈 때마다 포커스가 튄다.)
    if (pinned) focusWithoutReopen(closeButton);
  }

  function markClosed(button) {
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-describedby');
  }

  function close() {
    if (openButton) markClosed(openButton);
    openButton = null;
    pinned = false;
    popover.hidden = true;
    popover.classList.remove('pinned');
    if (closeButton) closeButton.hidden = true;
  }

  /** 언어 전환 등으로 문구가 바뀐 뒤 열려 있는 팝오버를 다시 그린다. */
  function refresh() {
    if (!openButton) return;
    paint(openButton);
    place(openButton);
  }

  function attach(button) {
    if (!button || buttons.has(button)) return;
    buttons.add(button);
    button.setAttribute('aria-expanded', 'false');

    button.addEventListener('mouseenter', () => {
      if (!hoverCapable() || pinned) return;
      open(button, { pin: false });
    });
    button.addEventListener('mouseleave', () => {
      if (pinned) return;
      if (openButton === button) close();
    });
    button.addEventListener('focus', () => {
      if (pinned || suppressFocusOpen) return;
      open(button, { pin: false });
    });
    button.addEventListener('blur', () => {
      if (pinned) return;
      if (openButton === button) close();
    });
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (pinned && openButton === button) {
        close();
        // 고정 중에는 포커스가 팝오버 안(X)에 있다. 그대로 닫으면 포커스가 사라진
        // 요소에 남아 body 로 떨어진다 — 누른 버튼으로 돌려준다.
        focusWithoutReopen(button);
        return;
      }
      open(button, { pin: true });
    });
  }

  if (closeButton) {
    closeButton.hidden = true;
    closeButton.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const anchor = openButton;
      close();
      focusWithoutReopen(anchor);
    });
  }

  doc.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !openButton) return;
    const focusTarget = openButton;
    // ⚠ 포커스 복귀는 **조건부**다. hover 로 열린 창은 앵커에 포커스가 없는데, 거기서
    //   무조건 `focus()` 를 부르면 ① 포커스를 훔치고 ② 그 focus 이벤트가 방금 닫은
    //   창을 다시 열어 «ESC 로 안 닫힌다» 가 된다 (2026-08-16 적대 검증 case A).
    //   그래서 포커스가 이미 이 위젯 안에 있을 때만 앵커로 돌려주고, 그 호출조차
    //   `suppressFocusOpen` 으로 감싼다.
    const restore = focusIsInside(focusTarget);
    close();
    if (restore) focusWithoutReopen(focusTarget);
  });

  doc.addEventListener('pointerdown', (ev) => {
    if (!openButton || !pinned) return;
    const target = ev.target;
    if (popover.contains(target)) return;
    if (openButton.contains && openButton.contains(target)) return;
    close();
  });

  if (view && typeof view.addEventListener === 'function') {
    view.addEventListener('resize', () => { if (openButton) place(openButton); });
    view.addEventListener('scroll', () => { if (openButton) place(openButton); }, true);
  }

  return {
    attach,
    open,
    close,
    refresh,
    isOpen: () => openButton !== null,
    isPinned: () => pinned,
    currentButton: () => openButton,
  };
}
