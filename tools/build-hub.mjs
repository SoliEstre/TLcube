/**
 * build-hub.mjs — 소개 허브를 **여덟 언어**(ko·en·ja·fr·it·de·es·pt)로 생성한다.
 *
 * 왜 생성하나: 언어별 HTML 을 손으로 들고 있으면 반드시 어긋난다. 특히 스캐너 현황
 * 표는 실측이 바뀔 때마다 갱신되는데, 여러 벌을 따로 고치면 한 언어만 옛 숫자를 남긴다.
 * 문구·수치는 `tools/hub-content.mjs` 하나에만 두고 여기서 찍어 낸다.
 * 3벌일 때도 그랬고, 8벌이 된 지금은 손으로 유지하는 선택지가 아예 없다(2026-08-17).
 *
 * 산출:
 *   sites/tl/index.html         (ko, 정본 URL `/`)
 *   sites/tl/<code>/index.html  (나머지 7언어, `/en/` `/ja/` `/fr/` `/it/` `/de/` `/es/` `/pt/`)
 *   sites/tl/sitemap.xml        (언어판 목록 — 문서 수만큼 자동으로 는다)
 *
 * SEO: 모든 문서가 서로를 `hreflang` 로 가리키고 `x-default` 는 한국어(`/`)다.
 * 언어 자동 선택은 **첫 방문에만** 하고 선택을 기억한다 — 매번 튕기면 사용자가
 * 고른 언어로 돌아올 수 없다.
 *
 * 사용: node tools/build-hub.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { languages, strings, stats } from './hub-content.mjs';

const ROOT = fileURLToPath(new URL('../sites/tl/', import.meta.url));
const SHARED = fileURLToPath(new URL('../sites/_shared/', import.meta.url));
const ORIGIN = 'https://tl.estre.so';

/*
 * ⚠ 공유 자산은 **내용 해시를 쿼리로 달아야 한다.**
 * nginx 가 `_shared/*` 에 `Cache-Control: public, max-age=604800`(7일)을 주는데 HTML 에는
 * 안 준다. 그래서 CSS/JS 만 고치면 재방문자는 **새 HTML + 옛 CSS/JS** 를 받는다 —
 * 마크업은 바뀌었는데 그걸 꾸밀 CSS 도 동작시킬 JS 도 없는 상태다.
 * 실제로 언어 드롭다운이 이 조합으로 «모양 깨지고 클릭 무반응» 이 됐다.
 * 해시가 바뀌면 URL 이 바뀌므로 HTML 과 자산이 항상 같이 움직인다.
 */
function assetVersion(name) {
  return createHash('sha256').update(readFileSync(SHARED + name)).digest('hex').slice(0, 8);
}
const SITE_CSS_V = assetVersion('site.css');
const SITE_JS_V = assetVersion('site.js');

/** 정적 자산은 언어 디렉터리에서 한 단계 위로 올라가야 한다. */
const prefix = (lang) => (lang.dir === '' ? '' : '../');

function alternates() {
  return languages
    .map((l) => `<link rel="alternate" hreflang="${l.code}" href="${ORIGIN}/${l.dir}">`)
    .concat(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`)
    .join('\n');
}

/* 언어 선택은 **접힌 레이어**다. 펼친 pill 로 두면 상단 바에서 자리를 너무 먹는다
   — 내비 5 + 외부 링크 2 + 테마 3버튼이 이미 있어 3언어일 때도 좁은 화면에서 줄이
   접혔다. 8언어가 된 지금은 더 말할 것도 없다(2026-08-17).
   현재 언어를 토글에 적어 두면 접혀 있어도 «지금 무슨 언어인지»는 계속 보인다.

   ⚠ `role="menu"` 를 쓰지 않는다. ARIA 메뉴는 «명령» 을 담는 위젯이라 보조기술이
   방향키 조작을 기대하고 Tab 을 건너뛴다. 여기 든 것은 그냥 **링크 목록**이므로
   disclosure(펼침) 패턴이 맞다 — 버튼의 `aria-expanded` + `aria-controls` 만으로 족하고
   Tab 이동이 그대로 산다.
   ⚠ 생성기·스캐너는 같은 자리에 `<select>` 를 쓴다. 여기만 링크인 이유는 허브가
   **언어별 URL 을 실제로 갖기** 때문이다 — 링크여야 크롤러가 언어판을 따라간다.
   생성기·스캐너는 단일 파일 런타임 전환이라 따라갈 URL 자체가 없다.
   ⚠ 크롤러는 hreflang 을 보므로 메뉴가 `hidden` 이어도 색인에는 영향이 없다. */
function langSwitch(current, t) {
  const items = languages.map((l) => {
    const active = l.code === current.code;
    return `<a href="${ORIGIN}/${l.dir}" hreflang="${l.code}"${active ? ' aria-current="true"' : ''} data-lang-pick="${l.code}">${l.label}</a>`;
  }).join('\n          ');
  return `<div class="lang-drop" data-lang-drop>
        <button type="button" class="lang-drop-toggle" aria-expanded="false" aria-controls="lang-menu" aria-label="${t.langLabel}">
          <span class="lang-drop-current">${current.label}</span>
          <span class="lang-drop-caret" aria-hidden="true"></span>
        </button>
        <div class="lang-drop-menu" id="lang-menu" hidden>
          ${items}
        </div>
      </div>`;
}

function jsonLd(lang, t) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${ORIGIN}/#website`,
        name: 'TLcube',
        alternateName: 'TrilLuminance (cube)',
        url: `${ORIGIN}/`,
        inLanguage: languages.map((l) => l.code),
      },
      {
        '@type': 'TechArticle',
        headline: t.jsonHeadline,
        description: t.jsonDescription,
        url: `${ORIGIN}/${lang.dir}`,
        inLanguage: lang.code,
        isPartOf: { '@id': `${ORIGIN}/#website` },
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        author: { '@type': 'Organization', name: 'SoliEstre' },
      },
      {
        '@type': 'SoftwareSourceCode',
        name: 'TLcube reference implementation',
        codeRepository: 'https://github.com/SoliEstre/TLcube',
        programmingLanguage: 'JavaScript',
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
      },
    ],
  }, null, 2);
}

/** 첫 방문에만 언어를 맞춰 보내고, 사용자가 고르면 그 선택을 기억한다. */
const LANG_SCRIPT = `
<script>
/* 언어 자동 선택 — **첫 방문에만** 한다.
   매번 브라우저 언어로 튕기면 사용자가 고른 언어로 돌아올 수 없다. 그래서 링크를
   누른 순간 선택을 저장하고, 저장된 선택이 있으면 자동 이동을 하지 않는다.
   크롤러는 hreflang 을 보므로 이 스크립트에 의존하지 않는다. */
(function () {
  var KEY = 'tlcube-lang';
  var here = document.documentElement.lang;
  try {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-lang-pick]');
      if (a) localStorage.setItem(KEY, a.getAttribute('data-lang-pick'));
    });
    if (localStorage.getItem(KEY)) return;
    /* 언어 URL 을 **직접 연 경우엔 튕기지 않는다.** /en/ 링크를 받은 사람이 브라우저
       언어가 다르다는 이유로 루트로 끌려가면 공유한 링크가 무의미해진다. 자동 선택은
       기본 문서(루트)에 온 사람에게만 의미가 있다. */
    if (location.pathname !== '/' && location.pathname !== '/index.html') return;
    /* 지원 목록은 languages 배열에서 찍어 낸다 — 손으로 적으면 언어판을 늘린 날
       리다이렉트만 옛 3언어로 남아 «새 언어판이 있는데 아무도 못 간다» 가 된다. */
    var supported = ${JSON.stringify(languages.map((l) => l.code))};
    var want = (navigator.languages || [navigator.language || 'ko'])
      .map(function (l) { return String(l).toLowerCase().split('-')[0]; })
      .filter(function (l) { return supported.indexOf(l) >= 0; })[0];
    /* 지원 밖 언어(nl·pl 등)는 영어로 — ko 는 저작 언어지 국제 기본값이 아니다
       (운영자 지시 2026-08-16). 생성기·스캐너의 i18n.js FALLBACK_LANGUAGE 와 동일 규약. */
    if (!want) want = 'en';
    if (want === here) return;
    localStorage.setItem(KEY, want);
    location.replace(want === 'ko' ? '/' : '/' + want + '/');
  } catch (err) { /* 저장소가 막혀 있으면 자동 선택을 포기한다 — 페이지는 그대로 쓴다. */ }
})();
</script>`;

function render(lang) {
  const t = strings[lang.code];
  const p = prefix(lang);
  const s = stats;
  const badge = (cls, text) => `<span class="badge ${cls}">${text}</span>`;
  /* 복호 시간 표기는 언어별 맵에서 찾는다. 예전엔 ko/en/else 삼항이라 언어를 늘리면
     새 언어가 조용히 일본어 표기를 물려받았다 — 맵이면 빠진 언어가 en 으로 떨어진다. */
  const msOf = (type) => s.types[type].ms[lang.code] || s.types[type].ms.en;
  /*
   * 성능표의 타입 행은 **`stats.types` 에서 유도한다.** 종전엔 Y·O·A 세 줄을 손으로
   * 들고 있었고, Type K 를 더할 때 이 자리가 통째로 빠졌다 — 손 목록은 반드시 어긋난다.
   * 라벨은 `row<타입>Name` 규약으로 찾고 **없으면 던진다**: 조용히 `undefined` 가 표에
   * 찍히는 것보다 빌드가 죽는 편이 낫다 (8언어 중 한 언어만 빠지는 게 이 파일의 상습 사고).
   */
  const ogImageAlt = () => {
    if (!t.ogImageAlt) throw new Error(`og:image:alt 문자열이 없다 (${lang.code})`);
    return t.ogImageAlt;
  };
  const typeRows = () => Object.keys(s.types).map((k) => {
    const label = t[`row${k}Name`];
    if (!label) throw new Error(`허브 성능표: row${k}Name 문자열이 없다 (타입 ${k}, ${lang.code})`);
    return `<tr><td>${label}</td><td>${badge('ok', s.types[k].decoded)}</td>`
      + `<td>${msOf(k)}</td><td>${badge('warn', t.badgePending)}</td></tr>`;
  }).join('\n          ');

  return `<!doctype html>
<html lang="${lang.htmlLang}" prefix="og: https://ogp.me/ns#">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<meta name="description" content="${t.description}">
<link rel="canonical" href="${ORIGIN}/${lang.dir}">
${alternates()}
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TLcube">
<meta property="og:title" content="${t.ogTitle}">
<meta property="og:description" content="${t.ogDescription}">
<meta property="og:url" content="${ORIGIN}/${lang.dir}">
<meta property="og:image" content="${ORIGIN}/assets/og-banner.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${ogImageAlt()}">
<meta property="og:locale" content="${lang.ogLocale}">
${languages.filter((l) => l.code !== lang.code).map((l) => `<meta property="og:locale:alternate" content="${l.ogLocale}">`).join('\n')}
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
${jsonLd(lang, t)}
</script>
<link rel="icon" href="${p}../_shared/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${p}../_shared/site.css?v=${SITE_CSS_V}">
</head>
<body data-site="hub">
<div class="wrap">

  <header class="bar">
    <a class="brand" href="${ORIGIN}/${lang.dir}">TL<span class="mark">cube</span></a>
    <nav>
      <!-- ⚠ 내비 순서는 **본문 섹션 순서와 같아야 한다** — 목차가 실제 순서와 어긋나면
           «건너뛴 게 있나» 하고 되짚게 된다. 본문은 why-now → types → what 이다
           (감이 먼저 오고 그다음 원리). 내비만 옛 순서로 남아 있었다. -->
      <a href="#why-now">${t.navWhyNow}</a>
      <a href="#types">${t.navTypes}</a>
      <a href="#what">${t.navWhat}</a>
      <a href="#scanner-status">${t.navStatus}</a>
      <a href="#spec">${t.navSpec}</a>
      <a href="https://tlcube.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlcube">${t.navGenerator}</a>
      <a href="https://tlscan.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlscan">${t.navScanner}</a>
      ${langSwitch(lang, t)}
      <div class="theme-toggle" role="group" aria-label="${t.themeLabel}">
        <button type="button" data-theme-choice="auto">${t.themeAuto}</button>
        <button type="button" data-theme-choice="light">${t.themeLight}</button>
        <button type="button" data-theme-choice="dark">${t.themeDark}</button>
      </div>
    </nav>
  </header>

  <section id="hero">
    <h1>${t.heroTitle}</h1>
    <p class="lead">${t.heroLead}</p>
    <p class="lead">${t.heroLead2}</p>
    <div class="cta">
      <a class="btn primary" href="https://tlcube.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlcube">${t.ctaMake}</a>
      <a class="btn" href="https://github.com/SoliEstre/TLcube" data-out="github">GitHub</a>
    </div>
  </section>


  <!-- «왜 지금» — 외부 검토(grok·gemini) 공통 진단이었다. 기존 카피는 메커니즘부터
       시작하는 스펙 리드였고, 방문자가 묻는 «이게 나한테 무슨 일인지»에 답하지 않았다.
       실제로 만든 사람이 채팅에서 즉석으로 한 설명(공감 → 왜 지금 → 가치)이 훨씬 잘
       통했다는 관측이 근거다. 그 순서를 사이트에 옮긴 것이 이 섹션이다. -->
  <section id="why-now">
    <h2>${t.whyNowTitle}</h2>
    <p class="lead">${t.whyNow1}</p>
    <p class="lead">${t.whyNow2}</p>
    <p class="lead">${t.whyNow3}</p>
  </section>

  <section id="types">
    <h2>${t.typesTitle}</h2>
    <p class="dim">${t.typesLead}</p>
    <div class="grid" style="margin-top:18px">
      <div class="card">
        <img src="${p}assets/type-Y.png" alt="${t.typeYName}">
        <h3>${t.typeYName}</h3>
        <p class="dim">${t.typeYDesc}</p>
        <div class="meta">${t.typeYMeta}</div>
      </div>
      <div class="card">
        <img src="${p}assets/type-O.png" alt="${t.typeOName}">
        <h3>${t.typeOName}</h3>
        <p class="dim">${t.typeODesc}</p>
        <div class="meta">${t.typeOMeta}</div>
      </div>
      <div class="card">
        <h3>${t.typeCName}</h3>
        <p class="dim">${t.typeCDesc}</p>
        <div class="meta">${t.typeCMeta}</div>
      </div>
      <div class="card">
        <img src="${p}assets/type-A.png" alt="${t.typeAName}">
        <h3>${t.typeAName}</h3>
        <p class="dim">${t.typeADesc}</p>
        <div class="meta">${t.typeAMeta}</div>
      </div>
      <!-- Type K (2026-08-26 편입). 카드 순서는 Y·O·A·K — A 바로 뒤가 맞다.
           K = A ∪ 반전 A 라 A 를 본 다음에 읽어야 «그 별» 이 이해된다.
           ⚠ 이 주석은 **템플릿 리터럴 안**이다 — 백틱을 쓰면 문자열이 그 자리에서
              닫힌다 (실제로 한 번 밟았다). 파일명은 홑따옴표로 적는다.
           자산 'assets/type-K.png' 는 인코더 산출이고 자체검증을 통과한 것이다
           (셀 234 · Δmin 0.1824). 용량 43/86/138 B 는 capacityK.js 실측값이다. -->
      <div class="card">
        <img src="${p}assets/type-K.png" alt="${t.typeKName}">
        <h3>${t.typeKName}</h3>
        <p class="dim">${t.typeKDesc}</p>
        <div class="meta">${t.typeKMeta}</div>
      </div>
    </div>
    <p class="dim" style="margin-top:16px">${t.typesFoot}</p>
  </section>

  <section id="what">
    <h2>${t.howTitle}</h2>
    <div class="grid">
      <div class="card"><h3>${t.how1Title}</h3><p class="dim">${t.how1Desc}</p></div>
      <div class="card"><h3>${t.how2Title}</h3><p class="dim">${t.how2Desc}</p></div>
      <div class="card"><h3>${t.how3Title}</h3><p class="dim">${t.how3Desc}</p></div>
    </div>
    <h2 style="margin-top:32px">${t.whyTitle}</h2>
    <p class="lead">${t.why1}</p>
    <p class="lead">${t.why2}</p>
    <p class="lead">${t.why3}</p>
  </section>

  <section id="scanner-status">
    <h2>${t.statusTitle}</h2>
    <p class="lead">${t.statusLead}</p>
    <div class="table-scroll" style="margin-top:20px">
      <table>
        <thead>
          <tr><th>${t.thType}</th><th>${t.thDecoded}</th><th>${t.thTime}</th><th>${t.thRealtime}</th></tr>
        </thead>
        <tbody>
          <!-- 정지사진 1회 복호 시간만으로 라이브 등급을 만들지 않는다. 초기 실기기
               텔레메트리에서 첫 잠금은 성공까지 필요한 프레임 수에 따라 순위가 뒤집혔다. -->
          ${typeRows()}
          <tr><td>${t.rowCenterQr}</td><td>${badge('ok', s.centerQr.decoded)}</td><td>—</td><td>${badge('warn', t.badgePending)}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="dim" style="margin-top:16px">${t.statusNote0}</p>
    <p class="dim">${t.statusNote1}</p>
    <p class="dim">${t.statusNote2}</p>
    <p class="dim">${t.statusNote3}</p>
    <p class="dim" style="margin-top:16px"><small>${t.statusFoot}</small></p>
  </section>

  <section id="spec">
    <h2>${t.specTitle}</h2>
    <p class="lead">${t.spec1}</p>
    <p class="lead">${t.spec2}</p>
    <div class="cta">
      <a class="btn" href="https://github.com/SoliEstre/TLcube/blob/main/SPEC.md" data-out="github">${t.ctaSpec}</a>
      <a class="btn" href="https://github.com/SoliEstre/TLcube" data-out="github">${t.ctaImpl}</a>
    </div>
    <div class="table-scroll" style="margin-top:24px">
      <table>
        <thead><tr><th>${t.thSite}</th><th>${t.thRole}</th><th>${t.thState}</th></tr></thead>
        <tbody>
          <tr><td><a href="https://tlcube.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlcube">tlcube.estre.so</a></td><td>${t.roleGenerator}</td><td>${badge('ok', t.stateWorking)}</td></tr>
          <tr><td><a href="https://tlscan.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlscan">tlscan.estre.so</a></td><td>${t.roleScanner}</td><td><a href="#scanner-status" style="color:inherit;text-decoration:none">${badge('ok', t.stateScanner)}</a></td></tr>
          <tr><td>tl.estre.so</td><td>${t.roleHub}</td><td>${badge('ok', t.stateHere)}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <footer>
    <div class="links">
      <a href="https://tlcube.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlcube">${t.navGenerator}</a>
      <a href="https://tlscan.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlscan">${t.navScanner}</a>
      <a href="https://github.com/SoliEstre/TLcube" data-out="github">GitHub</a>
    </div>
    <div>${t.footerTrademark}</div>
    <small class="copyright">${t.footerCopyright}</small>
  </footer>

</div>
<script src="${p}../_shared/site.js?v=${SITE_JS_V}"></script>${LANG_SCRIPT}
</body>
</html>
`;
}

/*
 * sitemap 도 여기서 찍는다 (2026-08-17).
 *
 * 왜 손으로 두지 않나: 언어판이 3개일 때는 URL 3 × hreflang 4 = 12줄이라 손으로 버텼는데,
 * 8개가 되면 8 × 9 = 72줄이다. 손으로 유지하면 언어를 늘린 날 sitemap 만 옛 목록으로
 * 남고 — 그게 조용하다. 페이지는 살아 있는데 색인에는 없는 상태가 된다.
 *
 * ⚠ `LASTMOD` 는 **상수**다. 오늘 날짜를 쓰면 빌드를 돌릴 때마다 파일이 바뀌어
 *   «동기화 가드» 테스트가 매번 깨진다. 내용이 실제로 바뀐 날에 손으로 올린다.
 */
const LASTMOD = '2026-08-30';

function sitemap() {
  const alts = languages
    .map((l) => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${ORIGIN}/${l.dir}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/"/>`)
    .join('\n');
  const entries = languages.map((l) => [
    '  <url>',
    `    <loc>${ORIGIN}/${l.dir}</loc>`,
    alts,
    `    <lastmod>${LASTMOD}</lastmod>`,
    // 갱신 빈도는 정본(루트)에만 적는다 — 언어판은 같은 문서의 번역이라 같은 주기다.
    ...(l.dir === '' ? ['    <changefreq>weekly</changefreq>'] : []),
    '  </url>',
  ].join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`;
}

// 수렴 지문 대상 (rebuild-all.mjs) — 쓰기 루프와 같은 languages 테이블·ROOT 에서 유도한다.
export const OUTPUTS = Object.freeze([
  ...languages.map((l) => ROOT + l.dir + 'index.html'),
  ROOT + 'sitemap.xml',
]);

export function writeHub() {
  for (const lang of languages) {
    const dir = ROOT + lang.dir;
    if (lang.dir) mkdirSync(dir, { recursive: true });
    const html = render(lang);
    writeFileSync(dir + 'index.html', html);
    console.log(`${(lang.dir || './').padEnd(6)} ${lang.label.padEnd(10)} ${html.length.toLocaleString()} chars`);
  }
  writeFileSync(`${ROOT}sitemap.xml`, sitemap());
  console.log(`${'sitemap'.padEnd(6)} ${String(languages.length).padEnd(10)} URLs`);
  console.log(`\n→ ${ROOT}`);
}

// rebuild-all.mjs 가 OUTPUTS 를 읽으려고 이 모듈을 import 한다 — import 만으로 빌드가
// 돌면 안 되므로 CLI 직접 실행일 때만 쓴다 (다른 빌더 8개와 같은 가드).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) writeHub();
