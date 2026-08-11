/*
 * tlcube-sw.js — TLcube **생성기** 서비스 워커.
 *
 * 스캐너용(`tlscan-sw.js`)과 같은 자세다. 목적은 오프라인 캐시가 아니라 **설치 가능(PWA)**
 * 요건 충족이다 — Android Chrome 은 manifest + HTTPS 에 더해 fetch 핸들러를 가진 서비스
 * 워커가 있어야 설치를 제안한다.
 *
 * ⚠ 캐시 우선으로 만들지 않는다. 생성기도 단일 HTML 한 장이라 캐시에 고정하면 배포해도
 *    갱신이 안 간다. 네트워크 우선 + 실패 시 캐시 폴백이라 온라인이면 항상 최신이다.
 *
 * 파일을 스캐너와 공유하지 않고 따로 두는 이유: 캐시 이름과 scope 가 사이트마다 달라야
 * 하고(호스트가 다르다), 한쪽 갱신이 다른 쪽 캐시를 무효화하는 결합을 만들지 않기 위해서다.
 */

const CACHE = 'tlcube-gen-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
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
