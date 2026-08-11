/**
 * beacon.js — 사용 이벤트 비콘 + **오프라인 큐**.
 *
 * ## 왜 별도 모듈인가
 *
 * 허브(tl.estre.so)는 `sites/_shared/site.js` 를 `<script src>` 로 불러 쓴다. 하지만
 * 생성기·스캐너는 **단일 HTML 파일**로 배포되고 생성기는 `file://` 로도 열려야 해서
 * (SPEC §8) 외부 스크립트를 참조할 수 없다. 그래서 번들에 들어가는 ESM 으로 따로 둔다.
 *
 * ⚠ `site.js` 에 같은 규약의 구현이 하나 더 있다(허브용). 둘 중 하나만 고치면 어긋난다 —
 *   `test/beacon-contract.test.js` 가 페이로드 필드 집합을 양쪽에 대해 고정한다.
 *
 * ## 오프라인 큐 (이 파일의 존재 이유)
 *
 * `sendBeacon` 은 오프라인에서 **던지지도 않고 그냥 실패**한다(false 반환). PWA 로 설치해
 * 쓰는 사용자는 오프라인 구간이 흔해서, 그대로 두면 그 구간 이벤트가 통째로 사라진다.
 * 그래서 실패한 이벤트를 localStorage 에 쌓아 두고 `online` 이벤트·다음 방문에 흘려보낸다.
 *
 * 큐 설계에서 지키는 것:
 *   · **상한**을 둔다(`MAX_QUEUE`). 오프라인이 길어도 저장소를 채우지 않는다 — 넘치면
 *     **오래된 것부터** 버린다(최신 행동이 더 쓸모 있다).
 *   · **나이 상한**도 둔다. 며칠 지난 이벤트는 통계를 흐리기만 한다.
 *   · flush 는 **전부 성공했을 때만** 큐를 비운다. 부분 성공이면 남은 것을 되돌려 둔다.
 *   · 개인 식별자를 담지 않는다 — 큐에 들어가는 것도 원래 비콘과 같은 메타뿐이다.
 *
 * @module beacon
 */

const ENDPOINT = 'https://tl.estre.so/i';
const QUEUE_KEY = 'tl-beacon-queue';
const MAX_QUEUE = 50;
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(list) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    // 저장소가 막혀 있으면 큐를 포기한다 — 사이트 기능과 무관하다.
  }
}

/** 실제 전송 한 건. 성공 여부를 돌려준다(오프라인이면 false). */
function post(row) {
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
  try {
    return navigator.sendBeacon(
      ENDPOINT,
      new Blob([`${JSON.stringify(row)}\n`], { type: 'text/plain' }),
    ) === true;
  } catch {
    return false;
  }
}

/** 큐를 비운다. 실패한 것만 되돌려 둔다. */
export function flushQueue() {
  const queued = readQueue();
  if (queued.length === 0) return { sent: 0, kept: 0 };
  const cutoff = Date.now() - MAX_AGE_MS;
  const fresh = queued.filter((row) => !row.queued_at || row.queued_at >= cutoff);

  const kept = [];
  let sent = 0;
  for (const row of fresh) {
    // 큐 표식은 보내지 않는다 — 스키마에 없는 필드다.
    const { queued_at: _ignored, ...payload } = row;
    if (post(payload)) sent += 1;
    else kept.push(row);
  }
  writeQueue(kept);
  return { sent, kept: kept.length };
}

function enqueue(row) {
  const queued = readQueue();
  queued.push({ ...row, queued_at: Date.now() });
  // 넘치면 **오래된 것부터** 버린다 — 최신 행동이 더 쓸모 있다.
  writeQueue(queued.slice(-MAX_QUEUE));
}

/**
 * 비콘 하나를 만든다.
 *
 * @param {string} site `body[data-site]` 에 해당하는 사이트 식별자
 * @returns {(event: string, props?: Record<string, unknown>) => void}
 */
export function createBeacon(site) {
  /** 탭 수명 임시 ID — 영속 식별자가 아니다. */
  const session = (() => {
    try {
      const existing = sessionStorage.getItem('tl-sid');
      if (existing) return existing;
      const made = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('tl-sid', made);
      return made;
    } catch {
      return 'nostore';
    }
  })();

  // 온라인으로 돌아오면 밀린 것을 흘려보낸다. 첫 로드에서도 한 번 시도한다.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => flushQueue());
    flushQueue();
  }

  return function send(event, props) {
    const row = {
      site,
      event,
      ts: new Date().toISOString().replace('T', ' ').replace('Z', ''),
      path: typeof location === 'undefined' ? '' : location.pathname,
      lang: typeof document === 'undefined' ? '' : (document.documentElement.lang || ''),
      session,
      // ⚠ props 는 Map(String, String) 컬럼이라 **객체**로 보내고 값도 문자열로 맞춘다.
      props: props
        ? Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)]))
        : {},
    };
    // 오프라인이면 큐에 쌓는다. navigator.onLine 은 거짓 양성이 있으므로 전송 결과도 본다.
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online || !post(row)) enqueue(row);
  };
}
