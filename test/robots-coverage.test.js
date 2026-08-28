/*
 * robots-coverage.test.js — robots 가 «무엇을 막는다고 적혀 있나» 가 아니라
 * «실제로 그 파일들을 막는가» 를 잰다.
 *
 * 2026-08-28 실측: 두 robots 가 각각 `Disallow: /_shared/gen-` 과
 * `/_shared/scan-` 만 갖고 있었다. 접두어를 **손으로 고른** 목록이라,
 * 그 뒤에 늘어난 파일이 전부 샜다 —
 *   · tlscan: `_shared/lab-scan.html` (200) · `/lab/` (200)
 *   · tlcube: `_shared/lab-gen.html` (200) · `_shared/cell-editor.html` (200) · `/lab/` (200)
 * 즉 시험판이 색인에 열려 있었다. 시험판은 「기기·카메라 정보와 축소 이미지를 실시간
 * 전송한다」고 스스로 고지하는 빌드다.
 *
 * ⚠ 이 자를 «robots 에 그 줄이 있나» 로 쓰지 마라. 그건 철자를 재는 것이라 규칙을
 *   고치는 정당한 변경마다 깨지고, 정작 파일이 늘어난 날엔 아무 말도 안 한다.
 *   그래서 목록을 손으로 안 쓴다 — `sites/_shared/` 를 **훑어서** 대조한다.
 *   파일이 늘면 이 자가 저절로 그 파일을 요구한다.
 *
 * 반대 방향도 같이 잰다: 자산(CSS·JS·아이콘·webmanifest)은 **막히면 안 된다**.
 * 렌더를 평가 못 하면 안정판 자체의 색인 품질이 떨어지므로, 「덜 막는 것」과
 * 「너무 막는 것」이 둘 다 결함이다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_DIR = path.join(ROOT, 'sites', '_shared');

/** 호스트별 robots 소스. 배포는 이 파일을 각 호스트의 `/robots.txt` 로 얹는다. */
const HOSTS = [
  { id: 'tlcube', file: 'robots-tlcube.txt', origin: 'https://tlcube.estre.so' },
  { id: 'tlscan', file: 'robots-tlscan.txt', origin: 'https://tlscan.estre.so' },
];

/**
 * robots 의 `Disallow` 값 하나를 경로 매처로 바꾼다.
 * 지원: `*`(임의 문자열) · `$`(끝 고정). 나머지는 접두어 일치 — RFC 9309 와 같다.
 */
function matchesRule(rule, urlPath) {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + (anchored ? '$' : '')).test(urlPath);
}

function disallowRules(robotsText) {
  return robotsText
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => /^Disallow:/i.test(line))
    .map((line) => line.replace(/^Disallow:\s*/i, ''))
    .filter(Boolean);
}

function isBlocked(rules, urlPath) {
  return rules.some((rule) => matchesRule(rule, urlPath));
}

/** `sites/_shared/` 의 HTML 을 **훑어서** 얻는다 — 손 목록이 아니다. */
function sharedHtmlPaths() {
  return readdirSync(SHARED_DIR)
    .filter((name) => name.endsWith('.html'))
    .sort()
    .map((name) => '/_shared/' + name);
}

for (const host of HOSTS) {
  const robots = readFileSync(path.join(SHARED_DIR, host.file), 'utf8');
  const rules = disallowRules(robots);

  test(host.id + ': _shared 의 HTML 이 하나도 빠짐없이 색인에서 제외된다', () => {
    const html = sharedHtmlPaths();
    assert.ok(html.length >= 4, '_shared HTML 이 ' + html.length + '개뿐 — 디렉터리를 잘못 읽었다');

    const leaked = html.filter((p) => !isBlocked(rules, p));
    assert.deepEqual(
      leaked,
      [],
      host.id + ' robots 가 안 막는 _shared HTML 이 있다. ' +
        '접두어 목록을 늘리지 말고 규칙(`/_shared/*.html$`)이 살아 있는지 봐라.',
    );
  });

  test(host.id + ': /lab/ 경로가 색인에서 제외된다', () => {
    // `/lab/` 은 컨테이너가 lab-*.html 을 얹는 **별칭 경로**라, `_shared` 를 막아도
    // 이쪽이 안 막히면 같은 시험판이 다른 주소로 그대로 색인된다 (실제로 그랬다).
    assert.ok(isBlocked(rules, '/lab/'), host.id + ' robots 가 /lab/ 을 안 막는다');
    assert.ok(isBlocked(rules, '/lab/index.html'), host.id + ' robots 가 /lab/ 하위를 안 막는다');
  });

  test(host.id + ': 렌더에 필요한 자산은 막지 않는다', () => {
    /*
     * 실서빙 경로로 확인한 것들이다 (2026-08-28, HTTP 200).
     * 이걸 막으면 크롤러가 페이지를 렌더 못 해 **안정판의** 색인 품질이 떨어진다 —
     * 즉 「더 세게 막기」가 그냥 더 안전한 방향이 아니다.
     */
    const mustBeCrawlable = [
      '/_shared/site.css',
      '/_shared/site.js',
      '/_shared/icon-192.png',
      '/_shared/icon-512.png',
      '/_shared/favicon.svg',
      '/_shared/' + host.id + '.webmanifest',
      '/llms.txt',
      '/',
    ];

    const blocked = mustBeCrawlable.filter((p) => isBlocked(rules, p));
    assert.deepEqual(blocked, [], host.id + ' robots 가 렌더에 필요한 자산을 막는다');
  });

  test(host.id + ': robots 가 자기 호스트의 sitemap 을 가리킨다', () => {
    assert.match(
      robots,
      new RegExp('^Sitemap:\\s*' + host.origin.replace(/[.]/g, '\\.') + '/sitemap\\.xml$', 'm'),
      host.id + ' robots 의 Sitemap 줄이 자기 오리진을 안 가리킨다',
    );
  });
}

test('매처 자체가 동작한다 (자를 먼저 잰다)', () => {
  // 이 매처가 늘 true 를 돌려주면 위 단언들이 전부 «거짓 초록» 이 된다.
  assert.ok(matchesRule('/_shared/*.html$', '/_shared/lab-scan.html'));
  assert.ok(!matchesRule('/_shared/*.html$', '/_shared/site.css'));
  assert.ok(!matchesRule('/_shared/*.html$', '/_shared/lab-scan.html.txt'), '$ 가 끝을 안 고정한다');
  assert.ok(matchesRule('/lab/', '/lab/'));
  assert.ok(matchesRule('/lab/', '/lab/anything'));
  assert.ok(!matchesRule('/lab/', '/labs'));
  assert.ok(matchesRule('/_shared/gen-', '/_shared/gen-finder.html'), '접두어 일치가 깨졌다');
});
