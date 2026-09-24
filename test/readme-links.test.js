// readme-links.test.js — README 들의 이미지·상대 링크·앵커가 **실제로 닿는지** 지킨다.
//
// 왜 필요한가: README 는 손으로 쓰는 표면이라, 가리키는 쪽(SPEC 제목 · 자산 파일 · 소개 허브
// 섹션)이 바뀌어도 README 는 모른다. 실제로 SPEC §13 제목에서 낱말 하나가 빠진 개정 뒤
// 두 README 의 §13 링크가 죽은 채로 남아 있었다 — GitHub 는 없는 앵커를 오류 없이 문서
// 맨 위로 보내서, 눌러 본 사람도 «깨졌다» 보다 «위치가 좀 다르다» 로 읽는다.
//
// ⚠ 이 자가 재는 것과 못 재는 것:
//   · 잰다 — 상대 경로 이미지(`<img src>` · `<source srcset>` · `![](…)`)의 파일이 있는가.
//   · 잰다 — 상대 링크의 파일이 있는가, 그리고 `#앵커`(같은 README · 다른 .md)가 GitHub 의
//     제목 슬러그 규칙으로 실제 제목에 닿는가.
//   · 잰다 — 우리 사이트(`*.estre.so`) 링크가 **배포 compose 의 볼륨 마운트**로 풀리는
//     저장소 파일에 닿는가, `#앵커` 면 그 HTML 에 같은 id 가 있는가. 문서 루트는 손으로
//     적지 않고 compose 에서 유도한다 — 허브가 다른 폴더로 옮겨 가면 자도 따라간다.
//   · 못 잰다 — 바깥 사이트(GitHub 등)는 네트워크 없이 확인할 수 없어 건너뛴다.
//   · 못 잰다 — GitHub 가 실제로 그리는 모양(표·<details>·애니메이션). 슬러그 규칙은
//     GitHub 구현(github-slugger)을 옮긴 것이라, GitHub 가 규칙을 바꾸면 이 자도 고쳐야 한다.
//
// README 목록도 손으로 적지 않는다 — 루트의 `README*.md` 를 훑는다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const COMPOSE = 'deploy/estre-so/projects/tlcube/docker-compose.yml';
// compose 의 `${ROOT_DOMAIN}` 값은 저장소 밖(배포 환경 파일)에 있다. README 가 쓰는 공개
// 도메인은 이것 하나라 여기만 적는다 — 서브도메인·문서 루트는 전부 compose 에서 읽는다.
const PUBLIC_DOMAIN = 'estre.so';

const READMES = readdirSync(ROOT).filter((name) => /^README.*\.md$/.test(name)).sort();

// ── 마크다운 전처리 ──────────────────────────────────────────────────────────

/** 펜스 코드 블록과 HTML 주석을 지운다 — 그 안의 링크 모양 글자는 링크가 아니다. */
function stripNonContent(markdown) {
  const lines = [];
  let fence = null;
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const open = /^ {0,3}(`{3,}|\x7e{3,})/.exec(line); // \x7e = 물결표 펜스
    if (fence === null && open) { fence = open[1][0]; lines.push(''); continue; }
    if (fence !== null) {
      if (new RegExp(`^ {0,3}\\${fence}{3,}\\s*$`).test(line)) fence = null;
      lines.push('');
      continue;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** 인라인 코드 안의 글자는 링크가 아니다 — 자리만 남긴다 (`[`x`](y)` 의 링크는 살아야 한다). */
function blankInlineCode(text) {
  return text.replace(/`[^`\n]*`/g, 'code');
}

// ── GitHub 제목 슬러그 ───────────────────────────────────────────────────────

/** 제목 줄의 마크다운 장식을 벗겨 GitHub 가 슬러그를 만드는 «보이는 글자» 로. */
function headingText(raw) {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*+/g, '')
    .trim();
}

/**
 * GitHub(github-slugger) 규칙 — 소문자로 바꾸고, 문자·결합표시·숫자·연결 문장부호·
 * 공백·하이픈이 아닌 글자는 지우고, 공백 하나를 하이픈 하나로. 연속 하이픈은 **접지 않는다**
 * (`13. H-v2 — Y` → `13-h-v2--y`: 마침표·줄표가 지워지고 양옆 공백이 하이픈 둘로 남는다).
 */
function slugBase(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

/** 문서가 가진 앵커 전부 — 제목 슬러그(같은 슬러그는 -1, -2 …)와 `<a id|name>`. */
function anchorsOf(markdown) {
  const ids = new Set();
  const seen = new Map();
  for (const line of stripNonContent(markdown).split('\n')) {
    const m = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (!m) continue;
    const base = slugBase(headingText(m[1]));
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    ids.add(count === 0 ? base : `${base}-${count}`);
  }
  for (const m of markdown.matchAll(/<a\s[^>]*\b(?:id|name)="([^"]+)"/gi)) ids.add(m[1]);
  return ids;
}

// ── 링크 추출 ────────────────────────────────────────────────────────────────

/** README 의 참조를 `{ kind: 'image' | 'link', target }` 목록으로. */
function referencesOf(markdown) {
  const text = blankInlineCode(stripNonContent(markdown));
  const refs = [];
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?/g)) refs.push({ kind: 'image', target: m[1] });
  for (const m of text.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/gi)) refs.push({ kind: 'image', target: m[1] });
  for (const m of text.matchAll(/<source\b[^>]*\ssrcset="([^"]+)"/gi)) {
    for (const candidate of m[1].split(',')) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) refs.push({ kind: 'image', target: url });
    }
  }
  // 링크 글 안에 대괄호 한 겹(이미지 링크 `[![a](b)](c)`)까지 허용한다.
  const mdLink = /(!?)\[(?:[^[\]]|\[[^[\]]*\])*\]\(\s*<?([^\s)>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  for (const m of text.matchAll(mdLink)) if (m[1] !== '!') refs.push({ kind: 'link', target: m[2] });
  for (const m of text.matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)) refs.push({ kind: 'link', target: m[1] });
  return refs;
}

function splitFragment(target) {
  const hash = target.indexOf('#');
  return hash === -1 ? { pathPart: target, fragment: null } : {
    pathPart: target.slice(0, hash),
    fragment: decodeURIComponent(target.slice(hash + 1)),
  };
}

// ── 우리 사이트 → 저장소 파일 (compose 에서 유도) ────────────────────────────

/**
 * `{ 서브도메인: [{ dest, src }] }` — 서비스마다 Traefik Host 규칙과 저장소 볼륨 마운트를 읽는다.
 * 허브는 디렉터리 마운트(sites/tl → 문서 루트), 생성기·스캐너는 단일 파일 마운트다.
 */
function siteMounts() {
  const compose = readFileSync(path.join(ROOT, COMPOSE), 'utf8');
  const services = /^services:\s*$([\s\S]*?)(?=^\S)/m.exec(compose);
  assert.ok(services, `${COMPOSE}: services 블록을 못 찾았다 — 자가 고장 났다`);
  const sites = {};
  for (const block of services[1].split(/^ {2}(?=[\w-]+:\s*$)/m)) {
    const host = /Host\(`([a-z0-9-]+)\.\$\{ROOT_DOMAIN\}`\)/.exec(block);
    if (!host) continue;
    const mounts = [...block.matchAll(/^\s*-\s*\$\{TLCUBE_SRC[^}]*\}\/([^:\s]+):(\/[^:\s]+)(?::ro)?\s*$/gm)]
      .map((m) => ({ src: m[1], dest: m[2] }));
    sites[host[1]] = mounts;
  }
  return sites;
}

/** 서빙 경로를 저장소 파일로. 못 풀면 null (마운트 밖 경로). */
function localFileFor(mounts, urlPath) {
  const served = path.posix.join('/usr/share/nginx/html', urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
  for (const { src, dest } of mounts) {
    if (served === dest) return src;
    if (served.startsWith(dest + '/')) return path.posix.join(src, served.slice(dest.length + 1));
  }
  return null;
}

// ── 판정 ─────────────────────────────────────────────────────────────────────

const SITES = siteMounts();
const anchorCache = new Map();
function anchorsOfFile(relPath) {
  if (!anchorCache.has(relPath)) anchorCache.set(relPath, anchorsOf(readFileSync(path.join(ROOT, relPath), 'utf8')));
  return anchorCache.get(relPath);
}

function isFile(relPath) {
  const full = path.join(ROOT, relPath);
  return existsSync(full) && statSync(full).isFile();
}

/**
 * 참조 하나를 판정해 `{ scope, problem }` 을 돌려준다. scope 는 어느 자가 쟀는지
 * ('relative' · 'anchor' · 'site' · 'external'), problem 은 null 이면 통과.
 */
function check(readme, { kind, target }) {
  if (/^mailto:/i.test(target)) return { scope: 'external', problem: null };

  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    const suffix = '.' + PUBLIC_DOMAIN;
    const sub = url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : null;
    const mounts = sub === null ? undefined : SITES[sub];
    if (!mounts) return { scope: 'external', problem: null };
    const file = localFileFor(mounts, decodeURIComponent(url.pathname || '/'));
    if (file === null) return { scope: 'site', problem: `${target}: 배포 마운트 밖의 경로라 저장소 파일로 못 푼다` };
    if (!isFile(file)) return { scope: 'site', problem: `${target} → ${file} 이 없다` };
    const fragment = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
    if (fragment !== null) {
      const html = readFileSync(path.join(ROOT, file), 'utf8');
      if (!html.includes(`id="${fragment}"`)) return { scope: 'site', problem: `${target} → ${file} 에 id="${fragment}" 가 없다` };
    }
    return { scope: 'site', problem: null };
  }

  const { pathPart, fragment } = splitFragment(target);
  if (pathPart === '') {
    // 같은 README 안의 앵커.
    const ids = anchorsOfFile(readme);
    return { scope: 'anchor', problem: ids.has(fragment) ? null : `${target}: ${readme} 에 이 앵커의 제목이 없다` };
  }

  const relPath = path.posix.normalize(decodeURIComponent(pathPart));
  const full = path.join(ROOT, relPath);
  if (!existsSync(full)) return { scope: 'relative', problem: `${target}: ${relPath} 이 없다` };
  if (kind === 'image' && !statSync(full).isFile()) return { scope: 'relative', problem: `${target}: 이미지가 파일이 아니다` };
  if (fragment !== null && relPath.endsWith('.md')) {
    const ids = anchorsOfFile(relPath);
    return { scope: 'anchor', problem: ids.has(fragment) ? null : `${target}: ${relPath} 에 이 앵커의 제목이 없다` };
  }
  return { scope: 'relative', problem: null };
}

function resultsFor(readme) {
  const refs = referencesOf(readFileSync(path.join(ROOT, readme), 'utf8'));
  return refs.map((ref) => ({ ...ref, ...check(readme, ref) }));
}

/** 같은 대상을 두 번 가리키면 문제도 두 번 나온다 — 읽기 좋게 한 번씩만. */
function problemsOf(results) {
  return [...new Set(results.filter((r) => r.problem).map((r) => r.problem))];
}

// ── 자기 검사 — 자가 고장 나서 «0건이라 통과» 하지 않게 ─────────────────────

test('자 자기 검사 — 슬러그 규칙과 추출기가 알려진 입력에서 맞게 동작한다', () => {
  // 합성 입력만 쓴다 — 실제 문서 제목을 박으면 그 철자가 바뀔 때 자가 먼저 썩는다.
  assert.equal(slugBase('13. H-v2 — Y 그룹의 실제 큐브 확장'), '13-h-v2--y-그룹의-실제-큐브-확장');
  assert.equal(slugBase('13.7 H-v2f / H-v2fc — 2·4·5개의 고유 데이터 면'), '137-h-v2f--h-v2fc--245개의-고유-데이터-면');
  assert.equal(slugBase(headingText('Type H — true 3D cube (Y group)')), 'type-h--true-3d-cube-y-group');
  assert.equal(slugBase(headingText('Why `now` **here**')), 'why-now-here');

  const sample = [
    '# Top', '## Dup', '## Dup', '<a id="manual"></a>',
    '```md', '## Not a heading', '[fenced](nowhere.md)', '```',
    '\x7e\x7e\x7e', '## Also not a heading', '[tilde-fenced](nowhere2.md)', '\x7e\x7e\x7e',
    '<!-- [commented](nowhere.md) -->',
    '[![logo](img/a.png)](doc.md#part) · [`code`](b.md) · <a href="#dup-1">x</a>',
    '<img width="10" src="img/b.webp" alt="">',
    '<picture><source type="image/webp" srcset="img/c.webp 1x, img/d.webp 2x"></picture>',
  ].join('\n');
  assert.deepEqual([...anchorsOf(sample)].sort(), ['dup', 'dup-1', 'manual', 'top']);
  const refs = referencesOf(sample).map((r) => `${r.kind}:${r.target}`).sort();
  assert.deepEqual(refs, [
    'image:img/a.png', 'image:img/b.webp', 'image:img/c.webp', 'image:img/d.webp',
    'link:#dup-1', 'link:b.md', 'link:doc.md#part',
  ]);

  // 배포 매핑: 허브는 디렉터리 마운트여야 앵커·자산 링크를 잴 수 있다.
  assert.ok(Object.keys(SITES).length > 0, `${COMPOSE} 에서 사이트를 하나도 못 읽었다 — 자가 고장 났다`);
  const hub = Object.entries(SITES).find(([, mounts]) => mounts.some((m) => m.dest === '/usr/share/nginx/html'));
  assert.ok(hub, `${COMPOSE}: 문서 루트 디렉터리를 마운트하는 사이트를 못 찾았다 — 자가 고장 났다`);
  assert.equal(localFileFor(hub[1], '/').endsWith('/index.html'), true);
});

test('README 훑기가 언어판 README 들을 찾는다 — 훑기 자체가 고장 나지 않았다', () => {
  assert.ok(READMES.includes('README.md'), `README 훑기 결과가 이상하다: ${READMES.join(', ')}`);
  assert.ok(READMES.length >= 2, `README 가 ${READMES.length} 개뿐이다 — 언어판이 사라졌나`);
});

// ── 본 검사 — README 마다 ──────────────────────────────────────────────────

for (const readme of READMES) {
  test(`${readme}: 상대 경로 이미지 파일이 전부 있다`, () => {
    const images = resultsFor(readme).filter((r) => r.kind === 'image' && r.scope === 'relative');
    assert.ok(images.length > 0, `${readme}: 상대 경로 이미지를 하나도 못 읽었다 — 추출기가 고장 났나`);
    const problems = problemsOf(images);
    assert.deepEqual(problems, [], `${readme}: 없는 이미지를 가리킨다\n  ${problems.join('\n  ')}`);
  });

  test(`${readme}: 상대 링크 파일과 #앵커가 실제 제목에 닿는다`, () => {
    const results = resultsFor(readme).filter((r) => r.kind === 'link' && (r.scope === 'relative' || r.scope === 'anchor'));
    assert.ok(results.some((r) => r.scope === 'anchor' && /\.md#/.test(r.target)),
      `${readme}: 다른 문서의 #앵커 링크를 하나도 못 읽었다 — 추출기가 고장 났나 (SPEC 링크가 사라졌나)`);
    const problems = problemsOf(results);
    assert.deepEqual(problems, [],
      `${readme}: 죽은 링크·앵커가 있다 (GitHub 슬러그 규칙 기준)\n  ${problems.join('\n  ')}`
      + '\n  — 제목을 바꿨다면 그 제목을 가리키는 README 링크도 같은 변경에서 고쳐라');
  });

  test(`${readme}: 우리 사이트 링크가 배포 문서 루트의 파일과 id 에 닿는다`, () => {
    const results = resultsFor(readme).filter((r) => r.scope === 'site');
    assert.ok(results.length > 0, `${readme}: *.${PUBLIC_DOMAIN} 링크를 하나도 못 읽었다 — 추출기나 compose 해석이 고장 났나`);
    const problems = problemsOf(results);
    assert.deepEqual(problems, [], `${readme}: 사이트 링크가 저장소 파일에 닿지 않는다\n  ${problems.join('\n  ')}`);
  });
}
