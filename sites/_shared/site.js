// site.js — tl / tlscan 공용 스크립트: 테마 토글 + 사용 이벤트 비콘.
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

  function send(event, props) {
    if (!navigator.sendBeacon) return;
    const row = {
      site,
      event,
      ts: new Date().toISOString().replace('T', ' ').replace('Z', ''),
      path: location.pathname,
      ref: refDomain(),
      ua_browser: uaBrowser,
      ua_os: uaOs,
      lang: document.documentElement.lang || '',
      session,
      // ⚠ props 컬럼은 Map(String, String) 이다 — JSON **객체**로 보내야 하고
      //   문자열로 보내면 JSONEachRow 파싱이 실패한다. 값도 전부 문자열로 맞춘다.
      props: props
        ? Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)]))
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

  // 이탈 훅 이중 — 큐가 비어 있어도 비용이 없다.
  let done = false;
  const flush = () => { if (done) return; done = true; };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
})();
