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

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { languages, strings, stats } from './hub-content.mjs';

const ROOT = fileURLToPath(new URL('../sites/tl/', import.meta.url));
const ORIGIN = 'https://tl.estre.so';

/** 정적 자산은 언어 디렉터리에서 한 단계 위로 올라가야 한다. */
const prefix = (lang) => (lang.dir === '' ? '' : '../');

function alternates() {
  return languages
    .map((l) => `<link rel="alternate" hreflang="${l.code}" href="${ORIGIN}/${l.dir}">`)
    .concat(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`)
    .join('\n');
}

function langSwitch(current, t) {
  const items = languages.map((l) => {
    const active = l.code === current.code;
    return `<a href="${ORIGIN}/${l.dir}" hreflang="${l.code}"${active ? ' aria-current="true"' : ''} data-lang-pick="${l.code}">${l.label}</a>`;
  }).join('\n        ');
  return `<div class="lang-switch" role="group" aria-label="${t.langLabel}">\n        ${items}\n      </div>`;
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
<link rel="stylesheet" href="${p}../_shared/site.css">
</head>
<body data-site="hub">
<div class="wrap">

  <header class="bar">
    <a class="brand" href="${ORIGIN}/${lang.dir}">TL<span class="mark">cube</span></a>
    <nav>
      <a href="#what">${t.navWhat}</a>
      <a href="#types">${t.navTypes}</a>
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
    <div class="cta">
      <a class="btn primary" href="https://tlcube.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlcube">${t.ctaMake}</a>
      <a class="btn" href="https://github.com/SoliEstre/TLcube" data-out="github">GitHub</a>
    </div>
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
          <tr><td>${t.rowYName}</td><td>${badge('ok', s.types.Y.decoded)}</td><td>${lang.code === 'ko' ? s.types.Y.ms : lang.code === 'en' ? s.types.Y.msEn : s.types.Y.msJa}</td><td>${badge('ok', t.badgeUsable)}</td></tr>
          <tr><td>${t.rowOName}</td><td>${badge('ok', s.types.O.decoded)}</td><td>${lang.code === 'ko' ? s.types.O.ms : lang.code === 'en' ? s.types.O.msEn : s.types.O.msJa}</td><td>${badge('warn', t.badgeSlow)}</td></tr>
          <tr><td>${t.rowAName}</td><td>${badge('warn', s.types.A.decoded)}</td><td>${lang.code === 'ko' ? s.types.A.ms : lang.code === 'en' ? s.types.A.msEn : s.types.A.msJa}</td><td>${badge('warn', t.badgeSlow)}</td></tr>
          <tr><td>${t.rowCenterQr}</td><td>${badge('ok', s.centerQr.decoded)}</td><td>—</td><td>${badge('warn', t.badgeSlow)}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="dim" style="margin-top:16px">${t.statusNote1}</p>
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
          <tr><td><a href="https://tlscan.estre.so" target="_blank" rel="noopener noreferrer" data-out="tlscan">tlscan.estre.so</a></td><td>${t.roleScanner}</td><td><a href="#scanner-status" style="color:inherit;text-decoration:none">${badge('warn', t.stateDev)}</a></td></tr>
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
<script src="${p}../_shared/site.js"></script>${LANG_SCRIPT}
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
