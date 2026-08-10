/*
 * tlscan-sw.js — TLcube 스캐너 서비스 워커.
 *
 * 목적은 오프라인 캐시가 아니라 **설치 가능(PWA)** 요건 충족이다. Chrome 은 manifest +
 * HTTPS 에 더해 **fetch 핸들러를 가진 서비스 워커**가 있어야 설치를 제안한다.
 *
 * ⚠ 캐시 우선(cache-first)으로 만들지 않는다. 스캐너는 단일 HTML 한 장이라 그걸 캐시에
 *    고정해 버리면 **배포해도 사용자에게 갱신이 안 간다.** 실기기 피드백 루프가 통째로
 *    막히므로(이 프로젝트에서 실제로 "배포가 갱신됐나?" 를 의심하게 만든 적이 있다)
 *    네트워크 우선 + 실패 시 캐시 폴백으로 둔다. 온라인이면 항상 최신이 뜬다.
 *
 * 서비스 워커의 제어 범위는 스크립트 경로에 종속된다. 이 파일은 `_shared` 에 있지만
 * nginx 가 `/sw.js` 로 alias 하고 `Service-Worker-Allowed: /` 를 붙여 루트 범위를 준다
 * (deploy/estre-so/projects/tlcube/static.conf).
 */

const CACHE = 'tlscan-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
  // 셸 한 장만 미리 담는다. 실패해도 설치를 막지 않는다 — 오프라인은 부가 기능이다.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 네트워크 우선. 성공하면 최신을 돌려주고 캐시도 갱신한다.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && request.mode === 'navigate') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request.mode === 'navigate' ? SHELL : request)
        .then((cached) => cached || Response.error())),
  );
});
