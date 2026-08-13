// pwa-update.js — 새 버전이 준비되면 상단 배너로 알리고, 사용자가 누를 때만 적용한다.
//
// 왜 필요한가: 생성기·스캐너는 단일 HTML 한 장이고 서비스 워커가 네트워크 우선이라
// **온라인이면 새로고침만으로 최신이 뜬다.** 문제는 사용자가 그 사실을 모른다는 것이다 —
// 실기기로 시험하는 동안 「배포가 갱신됐나?」를 의심하며 강력 새로고침을 반복하게 된다.
//
// ⚠ **자동 리로드는 하지 않는다.** 스캔 중이거나 코드를 만드는 중에 페이지가 갈아엎히면
//    작업이 날아간다. 「준비됨」을 알리고 적용 시점은 사람이 고른다.
//
// ⚠ 서비스 워커는 `install` 에서 `skipWaiting()` 을 **부르지 않아야** 한다. 부르면 새 워커가
//    대기 상태를 건너뛰어 `registration.waiting` 이 채워지지 않고, 배너를 띄울 순간 자체가
//    사라진다. 적용은 이 모듈이 `SKIP_WAITING` 메시지로 요청한다.

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** 배너는 스타일시트에 기대지 않는다 — 생성기·스캐너가 단일 파일이라 CSS 결합을 피한다. */
function createBanner(text, applyText, onApply) {
  const bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:9999',
    'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
    'padding:10px 14px', 'font:600 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif',
    'background:#1f2937', 'color:#f3f4f6', 'box-shadow:0 2px 10px rgb(0 0 0 / .35)',
  ].join(';');

  const label = document.createElement('span');
  label.textContent = text;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = applyText;
  button.style.cssText = [
    'padding:5px 14px', 'border-radius:999px', 'border:0', 'cursor:pointer',
    'font:inherit', 'background:#7fa3ff', 'color:#0c1220',
  ].join(';');
  button.addEventListener('click', onApply);

  bar.append(label, button);
  return bar;
}

/**
 * @param {{swUrl?: string, scope?: string, text: string, applyText: string}} options
 *   text/applyText 는 호출부가 i18n 을 적용해 넘긴다.
 */
export function startPwaUpdateWatch(options) {
  const { swUrl = '/sw.js', scope = '/', text, applyText } = options || {};
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  let banner = null;
  const show = (registration) => {
    if (banner || !registration.waiting) return;
    banner = createBanner(text, applyText, () => {
      // 적용 요청만 보낸다. 실제 새로고침은 controllerchange 를 보고 한 번만 한다 —
      // 여기서 바로 reload 하면 새 워커가 아직 제어권을 안 잡아 옛 문서가 다시 뜰 수 있다.
      registration.waiting && registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
    document.body.appendChild(banner);
  };

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl, { scope }).then((registration) => {
      show(registration);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // controller 가 없으면 **최초 설치**다 — 갱신이 아니므로 배너를 띄우지 않는다.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            show(registration);
          }
        });
      });

      const check = () => { registration.update().catch(() => {}); };
      setInterval(check, CHECK_INTERVAL_MS);
      // 탭으로 돌아올 때도 본다. 시험 중에는 배포 직후 바로 확인하고 싶은 경우가 많다.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    }).catch(() => {});
  });
}
