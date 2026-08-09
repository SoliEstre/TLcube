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

  function send(event, props) {
    if (!navigator.sendBeacon) return;
    const row = {
      site,
      event,
      ts: new Date().toISOString().replace('T', ' ').replace('Z', ''),
      path: location.pathname,
      ref: refDomain(),
      session,
      props: props ? JSON.stringify(props) : '',
    };
    try {
      navigator.sendBeacon(ENDPOINT, new Blob([`${JSON.stringify(row)}\n`], { type: 'text/plain' }));
    } catch { /* 엔드포인트 미배선·차단 — 사이트 기능과 무관하므로 삼킨다 */ }
  }
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
