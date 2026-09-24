// site.js — 소개 허브(tl.estre.so) 스크립트: 테마 토글 + 언어 드롭다운 + 사용 이벤트 비콘
//           + 타입 H 영상 재생 제어(맨 아래 별도 블록).
//
// 생성기·스캐너는 단일 HTML 이라 이 파일을 참조하지 않는다 — 그쪽 비콘은 `src/beacon.js` 다.
//
// 비콘 설계는 PM/010 확정안을 따른다 (요지):
//   · 엔드포인트 `/i` — `analytics`·`collect`·`track`·`event` 같은 단어를 쓰면
//     광고차단 필터가 경로 패턴으로 잡는다 (plausible #610 사례).
//   · sendBeacon + Blob(text/plain) — simple request 라 **preflight 가 없다**.
//     `application/json` 으로 보내면 OPTIONS 가 붙어 비콘의 이점이 사라진다.
//   · 이탈 훅은 visibilitychange(hidden) + pagehide **이중**. unload 계열은
//     모바일에서 발화하지 않는 것이 현행 합의라 쓰지 않는다.
//   · 페이로드 내용은 절대 수집하지 않는다 — 크기·종류 같은 메타만.
//
// 엔드포인트가 아직 없으면 비콘은 조용히 실패한다(sendBeacon 은 throw 하지 않는다).
// 사이트 기능에는 영향이 없다.

(() => {
  'use strict';

  // ── 테마 ────────────────────────────────────────────────
  const KEY = 'tl-theme';
  const root = document.documentElement;
  const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

  function syncThemeButtons() {
    const cur = root.getAttribute('data-theme') || 'auto';
    document.querySelectorAll('[data-theme-choice]').forEach((b) => {
      b.classList.toggle('active', b.dataset.themeChoice === cur);
    });
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-theme-choice]');
    if (!btn) return;
    const c = btn.dataset.themeChoice;
    if (c === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', c);
    try { localStorage.setItem(KEY, c); } catch { /* 사파리 프라이빗 등 — 무시 */ }
    syncThemeButtons();
  });
  syncThemeButtons();

  // ── 언어 드롭다운 ────────────────────────────────────────
  // 마크업이 없으면 손대지 않는다. 같은 IIFE 아래 비콘이 있어서, 여기서
  // throw 하면 이 마크업이 없는 페이지(tlscan)의 사용 집계까지 같이 죽는다.
  // 링크 기본 동작은 막지 않는다 — 인라인 스크립트가 클릭으로 선택을 저장한다.
  const langDrop = document.querySelector('[data-lang-drop]');
  const langToggle = langDrop && langDrop.querySelector('.lang-drop-toggle');
  const langMenu = langDrop && langDrop.querySelector('.lang-drop-menu');
  if (langToggle && langMenu) {
    const langOpen = () => langToggle.getAttribute('aria-expanded') === 'true';
    const langSet = (open) => {
      langToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      langMenu.hidden = !open;
    };
    langToggle.addEventListener('click', () => { langSet(!langOpen()); });
    document.addEventListener('click', (e) => {
      if (!langOpen() || langDrop.contains(e.target)) return;
      langSet(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !langOpen()) return;
      langSet(false);
      langToggle.focus();
    });
  }

  // ── 비콘 ────────────────────────────────────────────────
  const ENDPOINT = 'https://tl.estre.so/i';
  const site = document.body.dataset.site || 'hub';
  const buildMeta = document.querySelector('meta[name="tl-build"]');
  const build = document.body.dataset.build || (buildMeta && buildMeta.content) || '';

  /** 탭 수명 임시 ID — 영속 식별자가 아니다(sessionStorage). */
  const session = (() => {
    try {
      let s = sessionStorage.getItem('tl-s');
      if (!s) {
        s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        sessionStorage.setItem('tl-s', s);
      }
      return s;
    } catch { return ''; }
  })();

  /** referrer 는 **도메인만** 남긴다 (전체 URL 미저장 — PM/010 §4). */
  function refDomain() {
    try {
      if (!document.referrer) return '';
      const u = new URL(document.referrer);
      return u.hostname === location.hostname ? '' : u.hostname;
    } catch { return ''; }
  }

  /** UA 힌트 — 문자열 파싱을 하지 않는다. 없으면 빈 값으로 두고 컬럼 기본값에 맡긴다. */
  const uad = navigator.userAgentData;
  const uaBrowser = (() => {
    const brands = uad && uad.brands;
    if (!brands) return '';
    const b = brands.find((x) => !/Not.?A.?Brand/i.test(x.brand));
    return b ? b.brand : '';
  })();
  const uaOs = (uad && uad.platform) || '';

  function usageSurface() {
    if (location.protocol === 'file:') return 'file';
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return 'pwa';
      if (navigator.standalone === true) return 'pwa';
    } catch { /* 일반 웹 표면으로 폴백 */ }
    return 'web';
  }

  function send(event, props) {
    if (!navigator.sendBeacon) return;
    const eventProps = props ? Object.assign({}, props) : {};
    if (event === 'pageview') {
      eventProps.surface = usageSurface();
      eventProps.online = navigator.onLine === false ? 0 : 1;
    }
    const row = {
      site,
      event,
      ts: new Date().toISOString().replace('T', ' ').replace('Z', ''),
      path: location.pathname,
      ref: refDomain(),
      ua_browser: uaBrowser,
      ua_os: uaOs,
      lang: document.documentElement.lang || '',
      build,
      session,
      // ⚠ props 컬럼은 Map(String, String) 이다 — JSON **객체**로 보내야 하고
      //   문자열로 보내면 JSONEachRow 파싱이 실패한다. 값도 전부 문자열로 맞춘다.
      props: Object.keys(eventProps).length
        ? Object.fromEntries(Object.entries(eventProps).map(([k, v]) => [k, String(v)]))
        : {},
    };
    // 오프라인이면 큐에 쌓았다가 온라인 복귀·다음 방문에 흘려보낸다.
    // sendBeacon 은 오프라인에서 **던지지 않고 false 만** 돌려주므로 반환값을 본다.
    const online = navigator.onLine !== false;
    if (!online || !post(row)) enqueue(row);
  }

  /* ── 오프라인 큐 ──────────────────────────────────────────
     ⚠ `src/beacon.js` 에 같은 규약의 구현이 하나 더 있다(생성기·스캐너용 ESM).
        허브는 이 파일을 classic script 로 불러 쓰고, 저 둘은 **단일 파일**이라 외부
        스크립트를 못 참조해서 갈라져 있다. 둘 중 하나만 고치면 어긋난다.
     상한을 두고 넘치면 **오래된 것부터** 버린다 — 최신 행동이 더 쓸모 있다.
     나이 상한도 둔다 — 며칠 지난 이벤트는 통계를 흐리기만 한다. */
  const QUEUE_KEY = 'tl-beacon-queue';
  const MAX_QUEUE = 50;
  const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

  function readQueue() {
    try {
      const list = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }
  function writeQueue(list) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch { /* 저장소 차단 */ }
  }
  function post(row) {
    if (!navigator.sendBeacon) return false;
    try {
      return navigator.sendBeacon(
        ENDPOINT, new Blob([JSON.stringify(row) + String.fromCharCode(10)], { type: 'text/plain' }),
      ) === true;
    } catch { return false; }
  }
  function enqueue(row) {
    const q = readQueue();
    q.push(Object.assign({}, row, { queued_at: Date.now() }));
    writeQueue(q.slice(-MAX_QUEUE));
  }
  function flushQueue() {
    const q = readQueue();
    if (q.length === 0) return;
    const cutoff = Date.now() - MAX_AGE_MS;
    const kept = [];
    for (const row of q.filter((r) => !r.queued_at || r.queued_at >= cutoff)) {
      const payload = Object.assign({}, row);
      delete payload.queued_at;
      if (!post(payload)) kept.push(row);
    }
    writeQueue(kept);
  }
  window.addEventListener('online', flushQueue);
  flushQueue();
  window.tlSend = send;

  send('pageview');

  // 외부로 나가는 링크 — hub 의 `out` 이벤트 (PM/010 §3).
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-out]');
    if (a) send('out', { to: a.dataset.out });
  });

  // 보이는 구간만 누적한다. hidden 뒤 pagehide 가 이어져도 마지막 조각은 한 번만 간다.
  let visibleSince = document.visibilityState === 'hidden' ? null : Date.now();
  let interacted = false;
  const markInteracted = () => { interacted = true; };
  for (const name of ['pointerdown', 'keydown', 'input']) {
    document.addEventListener(name, markInteracted, { passive: true });
  }
  const finishVisible = (reason) => {
    if (visibleSince === null) return;
    const activeMs = Math.max(0, Math.min(0xffffffff, Date.now() - visibleSince));
    visibleSince = null;
    if (activeMs > 0) {
      send('engage', {
        active_ms_delta: Math.round(activeMs),
        reason,
        interacted: interacted ? 1 : 0,
      });
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') finishVisible('hidden');
    else if (visibleSince === null) visibleSince = Date.now();
  });
  window.addEventListener('pagehide', () => finishVisible('pagehide'));
  if (site === 'gen' || site === 'scan') {
    window.addEventListener('appinstalled', () => send('pwa_install', { surface: 'pwa' }));
  }
})();

// ── 타입 H 영상 ─────────────────────────────────────────────
// ⚠ 위 블록과 **따로 둔다.** 여기서 던져도 테마·비콘은 이미 돌았고, 영상은 마크업만으로
//   완결돼 있다(포스터 + 네이티브 controls + preload="none").
//
// 아무것도 안 하는 경우 — 동작 줄이기(prefers-reduced-motion) · 데이터 절약(Save-Data) ·
//   IntersectionObserver 없음. 그러면 포스터만 내려오고 MP4 는 사용자가 재생을 누를 때 받는다.
// 그 밖에는:
//   · 네이티브 controls 를 걷고 소리 없이(muted) 둔 채 **멈춤/재생 버튼**을 붙인다.
//     5초 넘게 움직이는 것은 멈출 수단이 있어야 하고(WCAG 2.2.2), 키보드로 닿아야 한다 —
//     그래서 진짜 <button> 이다. 버튼이나 영상을 누르면 토글된다.
//   · 화면에 25 % 이상 보일 때만 재생하고, 벗어나거나 탭이 가려지면(visibilitychange) 멈춘다.
//   · 사용자가 멈추면 다시 화면에 들어와도 스스로 재생하지 않는다.
//   · 도중에 동작 줄이기가 켜지면 멈추고 네이티브 controls 로 되돌린다(버튼 제거).
//   · 보임 관찰은 페이지 load 뒤 **한가해진 다음**(requestIdleCallback, 없으면 짧은 타이머)에
//     시작한다. 세로가 긴 데스크톱에서는 H 카드가 첫 화면에 걸려 있어서, 곧장 관찰하면 1.8 MB
//     MP4 가 첫 화면 그림·CSS 와 같이 받아진다(첫 로드 약 2.4 MB). 그림이 다 뜬 뒤에 받게 한다.
//     그 사이에도 버튼은 동작한다 — 사용자가 먼저 누르면 그대로 재생된다.
// 버튼 이름은 상태에 따라 «재생»/«멈춤» 으로 바뀐다(마크업의 data-label-play/-pause).
//   이름이 바뀌는 버튼에 aria-pressed 를 겹치면 «멈춤, 눌림» 처럼 뜻이 뒤집혀 읽히므로
//   쓰지 않는다 — 토글 버튼은 둘 중 하나만 쓴다.
(() => {
  'use strict';

  const videos = Array.prototype.slice.call(document.querySelectorAll('video[data-autoplay]'));
  if (videos.length === 0) return;

  const motion = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  const reduced = () => Boolean(motion && motion.matches);
  const saveData = (() => {
    try { return Boolean(navigator.connection && navigator.connection.saveData); } catch { return false; }
  })();
  if (reduced() || saveData || typeof window.IntersectionObserver !== 'function') return;

  const VISIBLE_RATIO = 0.25;
  const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">'
    + '<path class="icon-pause" d="M4 3h3v10H4zM9 3h3v10H9z"/>'
    + '<path class="icon-play" d="M5 2.5v11L13.5 8z"/></svg>';

  const players = videos.map((video) => {
    let visible = false;
    let userPaused = false;
    let released = false;
    const labelPlay = video.getAttribute('data-label-play') || 'Play';
    const labelPause = video.getAttribute('data-label-pause') || 'Pause';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'video-toggle';
    button.innerHTML = ICON;

    const render = () => {
      if (released) return;
      const playing = !video.paused;
      const label = playing ? labelPause : labelPlay;
      button.setAttribute('data-state', playing ? 'playing' : 'paused');
      button.setAttribute('aria-label', label);
      button.title = label;
    };
    const attempt = () => {
      let pending = null;
      try { pending = video.play(); } catch { pending = null; }
      // 자동 재생 거부(절전 모드 등)는 오류가 아니다 — 버튼이 «재생» 으로 남아 누르면 된다.
      if (pending && typeof pending.catch === 'function') pending.catch(render);
    };
    const sync = () => {
      if (released) return;
      const want = visible && !userPaused && document.visibilityState !== 'hidden';
      if (want && video.paused) attempt();
      else if (!want && !video.paused) video.pause();
      render();
    };
    const toggle = () => {
      if (released) return;
      if (video.paused) {
        userPaused = false;
        attempt();
      } else {
        userPaused = true;
        video.pause();
      }
      render();
    };

    video.muted = true;
    video.controls = false;
    video.after(button);
    button.addEventListener('click', toggle);
    video.addEventListener('click', toggle);
    video.addEventListener('play', render);
    video.addEventListener('pause', render);
    render();

    return {
      video,
      sync,
      setVisible(value) {
        visible = value;
        sync();
      },
      release() {
        if (released) return;
        video.pause();
        released = true;
        // 네이티브 controls 는 영상 클릭으로 스스로 토글한다 — 우리 리스너가 남아 있으면
        // 한 번 누를 때 두 번 토글돼 아무 일도 안 일어난다.
        video.removeEventListener('click', toggle);
        video.removeEventListener('play', render);
        video.removeEventListener('pause', render);
        video.controls = true;
        button.remove();
      },
    };
  });

  const byVideo = new Map(players.map((player) => [player.video, player]));
  const observer = new window.IntersectionObserver((entries) => {
    for (const entry of entries) {
      const player = byVideo.get(entry.target);
      // 경계에서 비율이 0.2499… 로 올 수 있어 아주 조금 느슨하게 본다.
      if (player) player.setVisible(entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO - 0.01);
    }
  }, { threshold: [0, VISIBLE_RATIO] });

  let stopped = false;
  const startObserving = () => {
    if (stopped) return;
    players.forEach((player) => observer.observe(player.video));
  };
  const whenIdle = () => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(startObserving, { timeout: 2000 });
    else window.setTimeout(startObserving, 200);
  };
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });

  document.addEventListener('visibilitychange', () => players.forEach((player) => player.sync()));

  const onMotionChange = () => {
    if (!reduced()) return;
    stopped = true;
    observer.disconnect();
    players.forEach((player) => player.release());
  };
  if (motion && typeof motion.addEventListener === 'function') motion.addEventListener('change', onMotionChange);
  else if (motion && typeof motion.addListener === 'function') motion.addListener(onMotionChange);
})();
