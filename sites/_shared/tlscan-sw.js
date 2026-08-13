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
      .catch(() => undefined),
  );
});

/*
 * 갱신 적용은 **사용자가 배너를 누를 때만** 한다. install 에서 skipWaiting() 을 부르면
 * registration.waiting 이 채워지지 않아 배너를 띄울 순간 자체가 사라진다 (src/pwa-update.js).
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/*
 * ⚠ 시험판(`/lab/`)은 **가로채지 않는다.**
 * 이 워커는 `scope: '/'` 라 경로를 안 가리면 시험판까지 지배한다. 캐시는 시험의 적이다 —
 * 「고쳤는데 왜 그대로지」의 정확한 경로이고, 오프라인은 안정판의 요구사항이지 시험판의
 * 것이 아니다. 시험판은 워커를 등록하지도 않는다.
 */
const LAB_PREFIX = '/lab/';

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(LAB_PREFIX)) return;

  /*
   * ⚠ navigate 응답을 **자기 URL 로** 캐시한다. 종전엔 어느 페이지를 열든 고정 키 `SHELL`
   * 에 덮어써서, 한 페이지를 연 뒤 다른 페이지 로드가 실패하면 **엉뚱한 페이지가 떴다.**
   * 폴백도 같은 순서로 좁힌다: 그 URL 의 캐시 → 없으면 셸.
   */
  const isNavigate = request.mode === 'navigate';
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && isNavigate) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request)
        .then((cached) => cached || (isNavigate ? caches.match(SHELL) : undefined))
        .then((cached) => cached || Response.error())),
  );
});
