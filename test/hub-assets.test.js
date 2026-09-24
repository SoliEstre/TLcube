// hub-assets.test.js — 허브가 가리키는 그림·영상이 **실제로 있고**, 버전 쿼리와 선언 크기가
// 파일과 함께 움직이며, H 영상이 약속한 때에만 받아지는지 지킨다.
//
// 왜 필요한가: 허브의 자산 참조는 전부 손으로 늘어 왔다. 그리고 어긋남이 조용했다 —
//   · 타입 C 카드는 이미지 없이 한동안 서 있었다(카드는 있는데 그림 파일이 없었다).
//   · `/assets/` 는 7일 캐시인데 같은 이름으로 다시 만든 그림에 버전이 없어서, 재방문자는
//     새 HTML 옆에 옛 그림을 봤다.
// 그래서 이 자는 목록을 손으로 들지 않고 **빌드된 여덟 언어 페이지와 문자열 키에서 유도**한다.
//   ① 페이지의 src · poster · srcset 중 assets/ 를 가리키는 것 전부 → 파일이 있고 ?v= 가 내용 해시
//   ② img 의 width/height 가 파일의 실제 크기, video 의 width/height 가 포스터 크기
//   ③ `type<문자>Name` 키가 있는 타입마다 `assets/type-<문자>.png` 가 있고 그 카드가 쓴다
//      — 새 타입은 그림을 같이 가져와야 한다
//   ④ H 영상은 마크업만으로 «포스터만 먼저» 다(preload="none" · autoplay 속성 없음 · controls)
//   ⑤ og:image 에는 버전 쿼리를 달지 않는다(site-og-image 자가 URL 경로를 파일로 되돌린다)
//   ⑥ site.js 의 영상 제어가 동작 줄이기 · 데이터 절약 · IO 없음에서 손대지 않고, 그 밖에는
//      25 % 이상 보일 때만 재생하고 멈춤 버튼 · 탭 가림 · 도중의 동작 줄이기를 지키는지,
//      그리고 보임 관찰을 페이지 load 뒤 한가해진 다음에야 시작하는지
//      (브라우저 없이 가짜 DOM 위에서 실제 site.js 를 돌린다)
//
// ⚠ 이 자가 못 재는 것: 그림이 **무엇을 담았는지**(타입 기본값 · https://tl.estre.so 복호),
//   MP4 의 코덱·길이·용량 — 그건 매체 도구의 보고서와 test/hub-media.test.js 몫이다.
//   실제 브라우저의 레이아웃·재생 체감도 못 잰다 — 그건 브라우저 창 점검 몫이다.
// ⚠ 크기 파서를 tools/build-hub.mjs 에서 가져오지 않고 여기 따로 둔다. 빌더와 같은 파서로
//   빌더의 출력을 재면 파서가 틀렸을 때 둘이 같이 틀려 초록이 된다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { languages, strings } from '../tools/hub-content.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TL = path.join(ROOT, 'sites', 'tl');
const ORIGIN = 'https://tl.estre.so';

const pages = () => languages.map((lang) => ({
  lang,
  html: readFileSync(path.join(TL, lang.dir, 'index.html'), 'utf8'),
}));

const sha8 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);

/** 태그 한 개의 속성 → 객체 (불리언 속성은 ''). */
const attrsOf = (tag) => Object.fromEntries(
  [...tag.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? '']),
);

/** 페이지 URL 기준으로 풀어 sites/tl 아래 파일로 되돌린다 (언어 디렉터리의 ../ 를 실제로 푼다). */
function resolveAsset(lang, url) {
  const resolved = new URL(url, `${ORIGIN}/${lang.dir}`);
  return { resolved, file: path.join(TL, ...decodeURIComponent(resolved.pathname).split('/').filter(Boolean)) };
}

/** src · poster · srcset 중 assets/ 를 가리키는 참조를 전부 모은다. */
function assetRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/\s(src|poster|srcset)="([^"]*)"/g)) {
    const [, attr, value] = m;
    const urls = attr === 'srcset' ? value.split(',').map((part) => part.trim().split(/\s+/)[0]) : [value];
    for (const url of urls) if (/(^|\/)assets\//.test(url)) refs.push({ attr, url });
  }
  return refs;
}

/*
 * 크기 파서 (빌더와 **독립** 구현).
 *   PNG  — IHDR 의 폭·높이 (시그니처 8 B + 길이 4 B + 타입 4 B 뒤, big-endian).
 *   WebP — RIFF/WEBP 뒤 첫 청크: VP8X(24비트 LE 캔버스-1) · VP8L(0x2F 뒤 14비트씩) ·
 *          'VP8 '(키프레임 시작 코드 뒤 14비트 LE).
 */
function imageSize(file) {
  const b = readFileSync(file);
  const s = (from, to) => b.toString('latin1', from, to);
  if (s(1, 4) === 'PNG') {
    assert.equal(s(12, 16), 'IHDR', `${file}: IHDR 이 첫 청크가 아니다`);
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  assert.ok(s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP', `${file}: PNG 도 WebP 도 아니다`);
  const chunk = s(12, 16);
  if (chunk === 'VP8X') return { width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
  if (chunk === 'VP8L') {
    assert.equal(b[20], 0x2f, `${file}: VP8L 서명 바이트`);
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    assert.deepEqual([b[23], b[24], b[25]], [0x9d, 0x01, 0x2a], `${file}: VP8 시작 코드`);
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  assert.fail(`${file}: 모르는 WebP 청크 ${JSON.stringify(chunk)}`);
}

/** `type<문자>Name` 키에서 타입 문자를 유도한다 — 개수·목록을 손으로 적지 않는다. */
const typeLetters = () => Object.keys(strings.ko)
  .map((key) => /^type([A-Z])Name$/.exec(key))
  .filter(Boolean)
  .map((m) => m[1]);

/** 타입 절의 카드들 (data-type 으로 찾는다). */
function cardsOf(html) {
  const start = html.indexOf('<section id="types"');
  assert.ok(start >= 0, '타입 절을 못 찾았다');
  const types = html.slice(start, html.indexOf('</section>', start));
  const starts = [...types.matchAll(/<div\b[^>]*\sdata-type="([A-Z])"[^>]*>/g)];
  return starts.map((m, i) => ({
    type: m[1],
    html: types.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : types.length),
  }));
}

test('허브의 모든 자산 참조가 실제 파일로 풀리고 ?v= 가 그 파일의 내용 해시다', () => {
  const minimum = typeLetters().length + 2; // 타입마다 스틸 1 + H 포스터 + H MP4
  for (const { lang, html } of pages()) {
    const refs = assetRefs(html);
    // 값이 있나 → 값이 맞나. 수집이 조용히 0건이 되면 아래 단언은 전부 «통과» 한다.
    assert.ok(refs.length >= minimum,
      `${lang.code}: 자산 참조가 ${refs.length}개뿐이다(최소 ${minimum}) — 수집 정규식이 안 맞는 것일 수 있다`);
    for (const { attr, url } of refs) {
      const { resolved, file } = resolveAsset(lang, url);
      assert.ok(resolved.pathname.startsWith('/assets/'),
        `${lang.code}: ${attr}="${url}" 가 ${resolved.pathname} 로 풀린다 — 언어 디렉터리에서는 ../assets/ 여야 한다`);
      assert.ok(existsSync(file), `${lang.code}: ${attr}="${url}" 의 파일이 없다 (${path.relative(ROOT, file)})`);
      const v = resolved.searchParams.get('v');
      assert.match(v || '', /^[0-9a-f]{8}$/, `${lang.code}: ${attr}="${url}" 에 내용 해시 쿼리가 없다`);
      assert.equal(v, sha8(file),
        `${lang.code}: ${url} 의 ?v= 가 파일 내용과 다르다 — node tools/build-hub.mjs 를 다시 돌리세요`);
    }
  }
});

test('img 의 width/height 는 파일의 실제 크기이고 video 의 크기는 포스터 크기다', () => {
  for (const { lang, html } of pages()) {
    const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => attrsOf(m[0]));
    assert.ok(imgs.length >= typeLetters().length, `${lang.code}: img 가 ${imgs.length}개뿐이다`);
    for (const img of imgs) {
      const { file } = resolveAsset(lang, img.src);
      const actual = imageSize(file);
      assert.deepEqual({ width: Number(img.width), height: Number(img.height) }, actual,
        `${lang.code}: ${img.src} 의 선언 크기가 실제와 다르다`);
      assert.ok(img.alt && img.alt.trim(), `${lang.code}: ${img.src} 에 alt 가 없다`);
    }
    const videos = [...html.matchAll(/<video\b[^>]*>/g)].map((m) => attrsOf(m[0]));
    assert.ok(videos.length >= 1, `${lang.code}: video 가 없다`);
    for (const video of videos) {
      const actual = imageSize(resolveAsset(lang, video.poster).file);
      assert.deepEqual({ width: Number(video.width), height: Number(video.height) }, actual,
        `${lang.code}: video 크기가 포스터 크기와 다르다`);
    }
  }
});

test('타입 이름 키가 있는 타입마다 그림이 있고 그 카드가 그 그림을 쓴다', () => {
  const letters = typeLetters();
  assert.ok(letters.length >= 4, `type*Name 키에서 타입을 ${letters.length}개만 찾았다 — 유도가 깨졌다`);
  for (const letter of letters) {
    const rel = `assets/type-${letter}.png`;
    assert.ok(existsSync(path.join(TL, rel)),
      `sites/tl/${rel} 가 없다 — 타입 ${letter} 카드에 그림이 없다(새 타입은 그림을 같이 가져와야 한다)`);
  }
  for (const { lang, html } of pages()) {
    const cards = cardsOf(html);
    for (const letter of letters) {
      const card = cards.find((c) => c.type === letter);
      assert.ok(card, `${lang.code}: 타입 ${letter} 카드(data-type="${letter}")가 없다`);
      const img = /<img\b[^>]*>/.exec(card.html);
      assert.ok(img, `${lang.code}: 타입 ${letter} 카드에 img 가 없다`);
      assert.match(attrsOf(img[0]).src || '', new RegExp(`(^|/)assets/type-${letter}\\.png\\?v=`),
        `${lang.code}: 타입 ${letter} 카드가 제 그림을 안 쓴다`);
    }
  }
});

test('H 영상은 마크업만으로 «포스터 먼저» 다 — 파일이 있고 자동으로 받지 않는다', () => {
  for (const rel of ['type-H.mp4', 'type-H.webp']) {
    assert.ok(existsSync(path.join(TL, 'assets', rel)), `sites/tl/assets/${rel} 가 없다`);
  }
  // 형식 확인만 한다(코덱·길이·용량은 hub-media 자 몫). 이름만 .mp4 인 다른 파일을 막는다.
  const mp4 = readFileSync(path.join(TL, 'assets', 'type-H.mp4'));
  assert.equal(mp4.toString('latin1', 4, 8), 'ftyp', 'type-H.mp4 가 MP4(ftyp 로 시작)가 아니다');

  for (const { lang, html } of pages()) {
    const h = cardsOf(html).find((c) => c.type === 'H');
    assert.ok(h, `${lang.code}: H 카드가 없다`);
    const tag = /<video\b[^>]*>/.exec(h.html);
    assert.ok(tag, `${lang.code}: H 카드에 video 가 없다`);
    const video = attrsOf(tag[0]);
    // JS 없이도 쓸 수 있고(controls), 스스로 받지 않는다(preload none · autoplay 없음).
    // 소리 없는 인라인 재생 조건(muted · playsinline)은 site.js 가 재생을 걸 때 필요하다.
    assert.equal(video.preload, 'none', `${lang.code}: preload="none" 이 아니면 보이기 전에 MP4 를 받는다`);
    assert.ok(!('autoplay' in video), `${lang.code}: autoplay 속성은 동작 줄이기·데이터 절약을 무시한다`);
    for (const flag of ['controls', 'muted', 'playsinline', 'loop', 'data-autoplay']) {
      assert.ok(flag in video, `${lang.code}: video 에 ${flag} 가 없다`);
    }
    for (const key of ['aria-label', 'data-label-play', 'data-label-pause']) {
      assert.ok(video[key] && video[key].trim(), `${lang.code}: video 의 ${key} 가 비었다`);
    }
  }
});

test('og:image 에는 버전 쿼리를 달지 않는다', () => {
  for (const { lang, html } of pages()) {
    const og = /<meta property="og:image" content="([^"]*)">/.exec(html);
    assert.ok(og, `${lang.code}: og:image 가 없다`);
    assert.ok(!og[1].includes('?'),
      `${lang.code}: og:image 에 쿼리가 붙었다 (${og[1]}) — 크롤러는 다른 이미지로 보고, site-og-image 자는 경로를 파일로 되돌린다`);
  }
});

/* ────────────────────────────────────────────────────────────────────
 * ⑥ site.js 영상 제어 — 실제 site.js 를 가짜 DOM 위에서 돌린다.
 *
 * 가짜 DOM 은 site.js 가 실제로 부르는 것만 흉내 낸다. 비콘은 sendBeacon 이 없으면 곧장
 * 돌아가므로 아무것도 보내지 않는다.
 * video 의 play() 는 브라우저처럼 paused 를 false 로 두고 'play' 를 쏜다 — 단 rejectPlay 면
 * 자동 재생 거부(절전 모드 등)를 흉내 내 거절 Promise 를 돌려준다.
 * ──────────────────────────────────────────────────────────────────── */
const SITE_JS = readFileSync(path.join(ROOT, 'sites', '_shared', 'site.js'), 'utf8');
const LABEL_PLAY = '재생-라벨';
const LABEL_PAUSE = '멈춤-라벨';

function fakeElement(tag) {
  const attrs = {};
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(), type: '', className: '', innerHTML: '', title: '', removed: false,
    setAttribute: (name, value) => { attrs[name] = String(value); },
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    click: () => { for (const fn of [...(listeners.click || [])]) fn({ type: 'click', target: el }); },
    remove: () => { el.removed = true; },
  };
  return el;
}

function fakeVideo({ rejectPlay }) {
  const attrs = { 'data-autoplay': '', 'data-label-play': LABEL_PLAY, 'data-label-pause': LABEL_PAUSE };
  const listeners = {};
  const video = {
    paused: true, muted: false, controls: true, plays: 0, pauses: 0, next: null,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    listeners: (type) => (listeners[type] || []).length,
    fire: (type) => { for (const fn of [...(listeners[type] || [])]) fn({ type, target: video }); },
    play: () => {
      video.plays += 1;
      if (rejectPlay) return Promise.reject(Object.assign(new Error('자동 재생 거부'), { name: 'NotAllowedError' }));
      if (video.paused) { video.paused = false; video.fire('play'); }
      return Promise.resolve();
    },
    pause: () => {
      video.pauses += 1;
      if (!video.paused) { video.paused = true; video.fire('pause'); }
    },
    after: (el) => { video.next = el; },
  };
  return video;
}

/*
 * phase — site.js 는 보임 관찰을 페이지 load 뒤 한가해진 다음(requestIdleCallback)에 시작한다.
 *   'idle'(기본): load 도 끝났고 한가해진 뒤의 페이지 — 관찰이 이미 붙어 있다.
 *   'loading'   : 아직 load 전. fireLoad() → runIdle() 로 한 단계씩 넘긴다.
 */
function runSite({ reduce = false, saveData = false, observer = true, rejectPlay = false, phase = 'idle' } = {}) {
  const video = fakeVideo({ rejectPlay });
  const docListeners = {};
  const winListeners = {};
  const idleQueue = [];
  const motionListeners = [];
  const motion = {
    media: '(prefers-reduced-motion: reduce)', matches: reduce,
    addEventListener: (type, fn) => { if (type === 'change') motionListeners.push(fn); },
  };
  const observers = [];
  class FakeObserver {
    constructor(callback, options) {
      this.callback = callback; this.options = options; this.targets = new Set();
      observers.push(this);
    }
    observe(el) { this.targets.add(el); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
  }
  const storage = () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const document = {
    documentElement: { lang: 'ko', getAttribute: () => null, setAttribute: () => {}, removeAttribute: () => {} },
    body: { dataset: { site: 'hub' } },
    referrer: '',
    readyState: phase === 'loading' ? 'loading' : 'complete',
    visibilityState: 'visible',
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === 'video[data-autoplay]' ? [video] : []),
    addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
    createElement: fakeElement,
  };
  const sandbox = {
    document,
    navigator: { onLine: true, connection: { saveData } },
    location: { protocol: 'https:', hostname: 'tl.estre.so', pathname: '/' },
    localStorage: storage(),
    sessionStorage: storage(),
    matchMedia: (query) => (query === motion.media ? motion : { media: query, matches: false }),
    addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
    requestIdleCallback: (fn) => { idleQueue.push(fn); return idleQueue.length; },
    console,
  };
  if (observer) sandbox.IntersectionObserver = FakeObserver;
  sandbox.window = sandbox;
  vm.runInNewContext(SITE_JS, sandbox, { filename: 'site.js' });

  const runIdle = () => { for (const fn of idleQueue.splice(0)) fn({ didTimeout: false, timeRemaining: () => 50 }); };
  if (phase === 'idle') runIdle();

  return {
    video,
    observers,
    button: () => video.next,
    /** load 이벤트 — 문서가 complete 가 되고 창의 load 리스너가 돈다. */
    fireLoad() {
      document.readyState = 'complete';
      for (const fn of [...(winListeners.load || [])]) fn({ type: 'load' });
    },
    /** 쌓인 requestIdleCallback 을 돌린다(브라우저가 한가해진 순간). */
    runIdle,
    /** 화면에 보이는 비율을 바꾼다 — 관찰 중인 관찰자에게만 알린다(끊긴 관찰자는 못 듣는다). */
    see(ratio) {
      for (const o of observers) {
        if (o.targets.has(video)) o.callback([{ target: video, isIntersecting: ratio > 0, intersectionRatio: ratio }], o);
      }
    },
    setVisibility(state) {
      document.visibilityState = state;
      for (const fn of [...(docListeners.visibilitychange || [])]) fn({ type: 'visibilitychange' });
    },
    turnOnReducedMotion() {
      motion.matches = true;
      for (const fn of motionListeners) fn({ matches: true, media: motion.media });
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const [label, options] of [
  ['동작 줄이기', { reduce: true }],
  ['데이터 절약(Save-Data)', { saveData: true }],
  ['IntersectionObserver 없음', { observer: false }],
]) {
  test(`H 영상 제어: ${label} 이면 손대지 않는다 — 네이티브 controls 와 포스터만`, () => {
    const env = runSite(options);
    assert.equal(env.video.controls, true, 'controls 가 걷혔다');
    assert.equal(env.button(), null, '버튼을 붙였다');
    assert.equal(env.observers.length, 0, '보임 관찰을 시작했다');
    assert.equal(env.video.plays, 0, '재생을 걸었다 — MP4 를 받게 된다');
  });
}

test('H 영상 제어: 25 % 이상 보일 때만 재생하고 벗어나거나 탭이 가려지면 멈춘다', () => {
  const env = runSite();
  const { video } = env;
  assert.equal(video.controls, false, 'controls 를 걷어야 한다');
  assert.equal(video.muted, true, '소리 없이 두어야 한다');
  const button = env.button();
  assert.ok(button, '멈춤/재생 버튼이 없다');
  assert.equal(button.tagName, 'BUTTON', '키보드로 닿으려면 진짜 button 이어야 한다');
  assert.equal(button.type, 'button');
  assert.match(button.className, /\bvideo-toggle\b/);
  assert.equal(env.observers.length, 1);
  assert.ok(env.observers[0].options.threshold.includes(0.25), '25 % 경계에서 알림을 받아야 한다');
  assert.equal(video.plays, 0, '보이기 전에 재생을 걸었다');
  assert.equal(button.getAttribute('aria-label'), LABEL_PLAY);
  assert.equal(button.getAttribute('data-state'), 'paused');

  env.see(0.1);
  assert.equal(video.plays, 0, '10 % 만 보였는데 재생했다');
  env.see(0.5);
  assert.equal(video.paused, false, '절반이 보이는데 멈춰 있다');
  assert.equal(button.getAttribute('aria-label'), LABEL_PAUSE);
  assert.equal(button.getAttribute('data-state'), 'playing');
  env.see(0);
  assert.equal(video.paused, true, '화면을 벗어났는데 돈다');
  assert.equal(button.getAttribute('aria-label'), LABEL_PLAY);

  env.see(0.6);
  assert.equal(video.paused, false);
  env.setVisibility('hidden');
  assert.equal(video.paused, true, '탭이 가려졌는데 돈다');
  env.setVisibility('visible');
  assert.equal(video.paused, false, '탭으로 돌아왔는데 다시 안 돈다');
});

test('H 영상 제어: 사용자가 멈추면 다시 보여도 스스로 재생하지 않고, 버튼·영상 클릭으로 토글된다', () => {
  const env = runSite();
  const { video } = env;
  env.see(0.8);
  assert.equal(video.paused, false);
  env.button().click();
  assert.equal(video.paused, true, '멈춤 버튼이 안 먹는다');
  assert.equal(env.button().getAttribute('aria-label'), LABEL_PLAY);
  const plays = video.plays;
  env.see(0);
  env.see(0.9);
  env.setVisibility('hidden');
  env.setVisibility('visible');
  assert.equal(video.plays, plays, '사용자가 멈췄는데 스스로 다시 재생했다');
  assert.equal(video.paused, true);
  env.button().click();
  assert.equal(video.paused, false, '재생 버튼이 안 먹는다');
  video.fire('click');
  assert.equal(video.paused, true, '영상을 눌러도 멈추지 않는다');
});

test('H 영상 제어: 도중에 동작 줄이기가 켜지면 멈추고 네이티브 controls 로 되돌린다', () => {
  const env = runSite();
  const { video } = env;
  const button = env.button();
  env.see(0.7);
  assert.equal(video.paused, false);
  env.turnOnReducedMotion();
  assert.equal(video.paused, true, '동작 줄이기가 켜졌는데 돈다');
  assert.equal(video.controls, true, 'controls 를 되돌리지 않았다');
  assert.equal(button.removed, true, '버튼을 치우지 않았다');
  // 네이티브 controls 는 영상 클릭으로 스스로 토글한다 — 우리 리스너가 남으면 두 번 토글된다.
  assert.equal(video.listeners('click'), 0, '영상 클릭 리스너가 남았다');
  const plays = video.plays;
  env.see(0.9);
  assert.equal(video.plays, plays, '되돌린 뒤에도 보임에 따라 재생했다');
});

test('H 영상 제어: 자동 재생이 거부돼도 오류 없이 «재생» 버튼으로 남는다', async () => {
  const env = runSite({ rejectPlay: true });
  env.see(0.9);
  assert.equal(env.video.plays, 1);
  await flush();
  assert.equal(env.video.paused, true);
  assert.equal(env.button().getAttribute('aria-label'), LABEL_PLAY);
  assert.equal(env.button().getAttribute('data-state'), 'paused');
});

// 세로가 긴 데스크톱에서는 H 카드가 첫 화면에 걸린다. 곧장 관찰하면 1.8 MB MP4 가 첫 화면
// 그림·CSS 와 같이 받아진다(첫 로드 약 2.4 MB). 그래서 관찰은 load 뒤 한가해진 다음에 시작한다.
test('H 영상 제어: 보임 관찰은 load 뒤 한가해진 다음에 시작한다 — 그 전엔 첫 화면에 걸려도 받지 않는다', () => {
  const env = runSite({ phase: 'loading' });
  const { video } = env;
  assert.ok(env.button(), '버튼은 load 전에도 곧장 붙어야 한다');
  assert.equal(env.observers.length, 1);
  assert.equal(env.observers[0].targets.size, 0, 'load 전에 보임 관찰을 시작했다');
  env.see(0.9);
  assert.equal(video.plays, 0, 'load 전에 재생을 걸었다 — MP4 가 첫 화면과 같이 받아진다');
  env.fireLoad();
  assert.equal(env.observers[0].targets.size, 0, 'load 직후(한가해지기 전)에 관찰을 시작했다');
  env.runIdle();
  assert.ok(env.observers[0].targets.has(video), '한가해진 뒤에도 관찰을 시작하지 않았다');
  env.see(0.9);
  assert.equal(video.paused, false, '관찰이 시작된 뒤 보이는데 멈춰 있다');
});

test('H 영상 제어: 관찰 전에도 버튼으로 재생되고, 그 사이 동작 줄이기가 켜지면 관찰을 시작하지 않는다', () => {
  const early = runSite({ phase: 'loading' });
  early.button().click();
  assert.equal(early.video.paused, false, 'load 전에 누른 재생 버튼이 안 먹는다');

  const env = runSite({ phase: 'loading' });
  env.turnOnReducedMotion();
  env.fireLoad();
  env.runIdle();
  assert.equal(env.observers[0].targets.size, 0, '동작 줄이기로 되돌린 뒤에 관찰을 다시 붙였다');
  assert.equal(env.video.controls, true, 'controls 를 되돌리지 않았다');
  env.see(0.9);
  assert.equal(env.video.plays, 0, '되돌린 뒤에 보임에 따라 재생했다');
});
