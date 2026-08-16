/**
 * i18n.js — 생성기·스캐너 공용 **런타임 언어 전환 기구**.
 *
 * ⚠ 여기엔 문구가 없다. 사전(dictionary)은 각 페이지가 갖고, 이 파일은 "고르고·기억하고·
 *    DOM 에 적용하는" 기계만 담는다. 포맷 의미론과 무관하다.
 *
 * ## 왜 허브(tl.estre.so)와 방식이 다른가
 *
 * 허브는 언어별 **HTML 3벌을 생성**한다(`tools/build-hub.mjs`). 문서라서 언어별 URL 이
 * SEO 상 유리하고, 정적 파일이라 나누는 비용이 없다.
 *
 * 생성기·스캐너는 그렇게 못 한다. 둘 다 **단일 HTML 파일**로 배포되고(SPEC §8 — 생성기는
 * `file://` 로도 열려야 한다), 배포도 파일 하나를 index.html 로 마운트하는 구조다.
 * 언어별로 쪼개면 그 성질이 깨지고 compose 마운트도 언어 수만큼 늘어난다.
 * 그래서 **한 파일 안에서 런타임 전환**한다 — 새로고침 없이 바뀌는 건 덤이다.
 *
 * ## 자동 선택 규약 (허브와 동일)
 *
 * 브라우저 언어로 **첫 방문에만** 맞춘다. 사용자가 고르면 그 선택을 기억하고 다시는
 * 자동으로 바꾸지 않는다 — 매번 브라우저 언어를 따르면 고른 언어로 돌아올 수 없다.
 *
 * @module i18n
 */

export const SUPPORTED_LANGUAGES = ['ko', 'en', 'ja'];
/** 사전 미스키 폴백 — 저작 원본 언어. 사전은 ko 가 완본이므로 여기만 ko 를 쓴다. */
export const DEFAULT_LANGUAGE = 'ko';
/** 브라우저 언어가 지원 밖일 때(예: fr·de) 보여줄 언어 — 국제 기본값 (운영자 지시 2026-08-16). */
export const FALLBACK_LANGUAGE = 'en';
const STORAGE_KEY = 'tlcube-lang';

/** 저장소가 막혀 있어도(사파리 프라이빗 등) 페이지는 그대로 동작해야 한다. */
function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 기억하지 못할 뿐, 이번 세션의 전환은 정상 동작한다.
  }
}

/**
 * 브라우저가 선호하는 언어 중 지원하는 첫 번째. 지역 부호는 버린다(`en-US` → `en`).
 * 지원 언어가 하나도 없으면 **영어**로 폴백한다 — ko 는 저작 언어지 국제 기본값이
 * 아니다 (미스키 폴백 DEFAULT_LANGUAGE 와 역할이 다르다).
 * @param {string[]} [preferred] 주입 가능 — 테스트에서 `navigator` 없이 쓴다.
 */
export function detectLanguage(preferred) {
  const list = preferred
    || (typeof navigator === 'undefined'
      ? []
      : navigator.languages || [navigator.language]).filter(Boolean);
  for (const raw of list) {
    const code = String(raw).toLowerCase().split('-')[0];
    if (SUPPORTED_LANGUAGES.includes(code)) return code;
  }
  return FALLBACK_LANGUAGE;
}

/** 저장된 선택이 있으면 그것, 없으면 브라우저 언어. */
export function initialLanguage(preferred) {
  return readStored() || detectLanguage(preferred);
}

/**
 * 사전에서 키를 찾는다. 없으면 **한국어로 폴백**한다 — 번역이 빠져도 빈 화면이 되지
 * 않게. 그마저 없으면 키 자체를 돌려줘서 누락이 눈에 띄게 한다.
 */
export function translate(dictionaries, lang, key) {
  const table = dictionaries[lang];
  if (table && key in table) return table[key];
  const base = dictionaries[DEFAULT_LANGUAGE];
  if (base && key in base) return base[key];
  return key;
}

/**
 * `data-i18n*` 표시가 붙은 요소를 현재 언어로 채운다.
 *
 *   data-i18n="key"            → textContent
 *   data-i18n-html="key"       → innerHTML (강조·줄바꿈이 든 문구용)
 *   data-i18n-attr="placeholder:key;aria-label:key2"
 *
 * 부분 갱신이 가능하도록 root 를 받는다(결과 패널처럼 나중에 그려지는 영역).
 */
export function applyTranslations(root, dictionaries, lang) {
  const scope = root || document;
  const t = (key) => translate(dictionaries, lang, key);

  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  // ⚠ innerHTML 은 **번들에 박힌 정적 사전**만 받는다. 사용자 입력·URL·스캔 결과 등
  //   외부에서 온 문자열을 사전에 넣지 마라 — 그 순간 XSS 경로가 된다.
  //   (사용자 입력을 보여주는 자리는 전부 textContent 를 쓴다.)
  //   `<strong>`·`<br>` 같은 강조/줄바꿈 때문에 필요한 것이지 임의 HTML 용이 아니다.
  scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.getAttribute('data-i18n-attr').split(';')) {
      const [attr, key] = pair.split(':').map((s) => s && s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

/**
 * 페이지 하나의 i18n 상태.
 *
 * @param {Record<string, Record<string, string>>} dictionaries
 * @param {{onChange?: (lang: string) => void, documentElement?: HTMLElement}} [options]
 */
export function createI18n(dictionaries, options = {}) {
  let lang = initialLanguage();

  const state = {
    get lang() { return lang; },
    t(key) { return translate(dictionaries, lang, key); },
    apply(root) { applyTranslations(root, dictionaries, lang); },
    setLanguage(next, { remember = true } = {}) {
      if (!SUPPORTED_LANGUAGES.includes(next) || next === lang) return;
      lang = next;
      if (remember) writeStored(next);
      const html = options.documentElement
        || (typeof document === 'undefined' ? null : document.documentElement);
      if (html) html.setAttribute('lang', next);
      applyTranslations(null, dictionaries, lang);
      if (options.onChange) options.onChange(lang);
    },
  };

  return state;
}

/**
 * 언어 선택 버튼들을 붙인다. 컨테이너에 `<button data-lang="ko">` 들이 있다고 가정하고,
 * 현재 언어에 `aria-current` 를 세운다(허브의 링크판과 같은 표시 규약).
 */
export function wireLanguageSwitch(container, i18n) {
  if (!container) return;
  const buttons = [...container.querySelectorAll('[data-lang]')];
  const sync = () => buttons.forEach((b) => {
    const on = b.getAttribute('data-lang') === i18n.lang;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  buttons.forEach((b) => b.addEventListener('click', () => {
    i18n.setLanguage(b.getAttribute('data-lang'));
    sync();
  }));
  sync();
}
