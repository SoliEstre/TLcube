/**
 * build-hub.mjs — 소개 허브를 **한국어·영어·일본어 3벌**로 생성한다.
 *
 * 왜 생성하나: 세 언어 HTML 을 손으로 들고 있으면 반드시 어긋난다. 특히 스캐너 현황
 * 표는 실측이 바뀔 때마다 갱신되는데, 세 벌을 따로 고치면 한 언어만 옛 숫자를 남긴다.
 * 문구·수치는 `tools/hub-content.mjs` 하나에만 두고 여기서 찍어 낸다.
 *
 * 산출:
 *   sites/tl/index.html      (ko, 정본 URL `/`)
 *   sites/tl/en/index.html   (en, `/en/`)
 *   sites/tl/ja/index.html   (ja, `/ja/`)
 *
 * SEO: 세 문서가 서로를 `hreflang` 로 가리키고 `x-default` 는 한국어(`/`)다.
 * 언어 자동 선택은 **첫 방문에만** 하고 선택을 기억한다 — 매번 튕기면 사용자가
 * 고른 언어로 돌아올 수 없다.
 *
 * 사용: node tools/build-hub.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

/* 언어 선택은 **접힌 레이어**다. 펼친 pill 3개로 두면 상단 바에서 자리를 너무 먹는다
   — 내비 5 + 외부 링크 2 + 테마 3버튼이 이미 있어 좁은 화면에서 줄이 접혔다.
   현재 언어를 토글에 적어 두면 접혀 있어도 «지금 무슨 언어인지»는 계속 보인다.

   ⚠ `role="menu"` 를 쓰지 않는다. ARIA 메뉴는 «명령» 을 담는 위젯이라 보조기술이
   방향키 조작을 기대하고 Tab 을 건너뛴다. 여기 든 것은 그냥 **링크 3개**이므로
   disclosure(펼침) 패턴이 맞다 — 버튼의 `aria-expanded` + `aria-controls` 만으로 족하고
   Tab 이동이 그대로 산다.
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
    var want = (navigator.languages || [navigator.language || 'ko'])
      .map(function (l) { return String(l).toLowerCase().split('-')[0]; })
      .filter(function (l) { return l === 'ko' || l === 'en' || l === 'ja'; })[0];
    if (!want || want === here) return;
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
<meta property="og:image" content="${ORIGIN}/assets/type-Y.png">
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
        <img src="${p}assets/type-A.png" alt="${t.typeAName}">
        <h3>${t.typeAName}</h3>
        <p class="dim">${t.typeADesc}</p>
        <div class="meta">${t.typeAMeta}</div>
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
          <tr><td>${t.rowYName}</td><td>${badge('ok', s.types.Y.decoded)}</td><td>${lang.code === 'ko' ? s.types.Y.ms : lang.code === 'en' ? s.types.Y.msEn : s.types.Y.msJa}</td><td>${badge('warn', t.badgePending)}</td></tr>
          <tr><td>${t.rowOName}</td><td>${badge('ok', s.types.O.decoded)}</td><td>${lang.code === 'ko' ? s.types.O.ms : lang.code === 'en' ? s.types.O.msEn : s.types.O.msJa}</td><td>${badge('warn', t.badgePending)}</td></tr>
          <tr><td>${t.rowAName}</td><td>${badge('ok', s.types.A.decoded)}</td><td>${lang.code === 'ko' ? s.types.A.ms : lang.code === 'en' ? s.types.A.msEn : s.types.A.msJa}</td><td>${badge('warn', t.badgePending)}</td></tr>
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

for (const lang of languages) {
  const dir = ROOT + lang.dir;
  if (lang.dir) mkdirSync(dir, { recursive: true });
  const html = render(lang);
  writeFileSync(dir + 'index.html', html);
  console.log(`${(lang.dir || './').padEnd(6)} ${lang.label.padEnd(8)} ${html.length.toLocaleString()} chars`);
}
console.log(`\n→ ${ROOT}`);
