// site-og-image.test.js — 링크 미리보기 이미지가 표면들 사이에서 어긋나지 않게 지킨다.
//
// 왜 필요한가: `og:image` 블록은 **표면마다 손으로 나뉘어** 있다 —
// 허브 8언어는 `tools/build-hub.mjs` 가 굽고, 생성기(`index.html`)와
// 스캐너(`sites/tlscan/index.html`)는 정적 단일 파일이라 아무도 안 굽고,
// `sites/_shared/` 의 시험판·비교본은 그 둘에서 파생된다.
// 손으로 유지하는 사본은 반드시 어긋난다. 한 표면만 고치고 나머지를 잊으면
// 테스트는 초록인데 X·Slack 링크는 옛 이미지를 문다.
//
// ⚠ 표면 목록을 **손으로 적지 않는다.** 손 목록이야말로 이 자가 막으려는 병이다
//   (처음 이 파일을 셋만 적어 놓고 돌렸더니 여덟 중 다섯을 못 봤다).
//   `sites/**` 와 루트 `index.html` 을 훑어 `og:image` 를 선언한 파일을 **찾아낸다** —
//   새 사이트·새 시험판이 생기면 자동으로 범위에 들어온다.
//
// ⚠ 그리고 이 자는 «배치·파일 이름» 이 아니라 **성질** 을 잰다:
//   ① 선언한 크기가 실제 PNG 와 같은가 (숫자를 지어내면 크롤러가 먼저 믿는다)
//   ② `summary_large_image` 를 선언한 표면의 이미지가 실제로 «가로로 긴가»
//   ③ 현행 트리에서 나온 표면들이 **같은** 이미지를 가리키는가
// 배너를 다시 그리거나 이름을 바꿔도 위 셋이 지켜지면 그대로 통과한다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VARIANTS } from '../tools/build-scan-variants.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/* IHDR 은 시그니처 8 B + 길이 4 B + 타입 4 B 뒤에 폭·높이가 big-endian 으로 온다. */
function pngSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.readUInt32BE(12), 0x49484452, `${file}: IHDR 이 첫 청크가 아니다`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const meta = (html, property) => {
  const hit = html.match(
    new RegExp(`<meta\\s+(?:property|name)="${property}"\\s+content="([^"]*)">`),
  );
  return hit ? hit[1] : null;
};

/*
 * 현행 트리가 아니라 **옛 커밋에서 빌드된** 표면. `build-scan-variants.mjs` 가
 * `ref` 로 그 커밋의 트리를 통째로 꺼내 그 안에서 빌드하므로, head 도 그 시절 것이다.
 * 「그 커밋이 낸 그대로」가 이 파일의 존재 이유라서 현행 배너를 강요하지 않는다.
 * 색인도 안 된다 — `sites/_shared/robots-tlscan.txt` 가 `/_shared/scan-` 을 막고,
 * canonical 도 운영본을 가리킨다. 조사 끝나면 파일째 지운다.
 */
const ARCHIVED = new Set(
  VARIANTS.filter((v) => v.ref !== null)
    .map((v) => path.join(ROOT, 'sites', '_shared', `scan-${v.id}.html`)),
);

/** `sites/**` + 루트 `index.html` 중 og:image 를 선언한 HTML 을 전부 찾는다. */
function surfaces() {
  const files = [path.join(ROOT, 'index.html')];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) files.push(full);
    }
  };
  walk(path.join(ROOT, 'sites'));

  const found = files
    .map((file) => ({ file, html: readFileSync(file, 'utf8') }))
    .filter((s) => meta(s.html, 'og:image') !== null)
    .map((s) => ({
      ...s,
      name: path.relative(ROOT, s.file).split(path.sep).join('/'),
      archived: ARCHIVED.has(s.file),
    }));

  // 값이 있나 → 값이 맞나. 훑기가 조용히 0건이 되면 아래 단언은 전부 «통과» 한다.
  assert.ok(found.length >= 10,
    `og:image 를 선언한 표면이 ${found.length}개뿐이다 — 허브 8언어 + 생성기 + 스캐너만 해도 10개다`);
  return found;
}

/* 표면의 og:image URL 을 저장소 안 파일 경로로 되돌린다. 세 사이트가 한 장을
   공유하므로 어느 오리진이든 `/assets/…` 는 sites/tl/assets/ 다. */
function localPathOf(name, url) {
  const hit = url.match(/^https:\/\/[^/]+(\/assets\/.+)$/);
  assert.ok(hit, `${name}: og:image 가 절대 URL 의 /assets/ 경로가 아니다: ${url}`);
  return path.join(ROOT, 'sites', 'tl', hit[1]);
}

test('링크 미리보기: 선언한 og:image 크기가 실제 PNG 와 같다', () => {
  for (const s of surfaces()) {
    if (s.archived) continue;
    const actual = pngSize(localPathOf(s.name, meta(s.html, 'og:image')));
    const declared = {
      width: Number(meta(s.html, 'og:image:width')),
      height: Number(meta(s.html, 'og:image:height')),
    };
    assert.deepEqual(declared, actual,
      `${s.name}: 선언 ${declared.width}×${declared.height} ≠ 실제 ${actual.width}×${actual.height}`);
  }
});

// X 는 1.91:1 을 큰 카드의 기준으로 삼는다. 종전에 523×575(0.91:1) 을 걸어 놓고
// summary_large_image 를 선언해 **작은 썸네일로 강등**되던 상태가 이 자의 계기다.
// 관용 폭을 두는 이유: 배너 비율을 조금 손봐도 «가로로 길다» 는 성질은 그대로다.
const LARGE_CARD_MIN_RATIO = 1.7;

test('링크 미리보기: summary_large_image 를 선언했으면 이미지가 실제로 가로로 길다', () => {
  for (const s of surfaces()) {
    if (s.archived) continue;
    if (meta(s.html, 'twitter:card') !== 'summary_large_image') continue;
    const { width, height } = pngSize(localPathOf(s.name, meta(s.html, 'og:image')));
    const ratio = width / height;
    assert.ok(ratio >= LARGE_CARD_MIN_RATIO,
      `${s.name}: ${width}×${height} = ${ratio.toFixed(2)}:1 — `
      + `${LARGE_CARD_MIN_RATIO}:1 미만이면 큰 카드가 아니라 작은 썸네일로 강등된다`);
  }
});

test('링크 미리보기: 현행 표면이 모두 같은 이미지를 가리키고 alt 가 비어 있지 않다', () => {
  const live = surfaces().filter((s) => !s.archived);
  const paths = new Set(live.map((s) => localPathOf(s.name, meta(s.html, 'og:image'))));
  assert.equal(paths.size, 1,
    `표면마다 og:image 가 다르다 — 손으로 유지하는 사본이 ${paths.size}장이 됐다:\n`
    + [...paths].join('\n'));

  for (const s of live) {
    const alt = meta(s.html, 'og:image:alt');
    assert.ok(alt && alt.trim().length > 0, `${s.name}: og:image:alt 가 비어 있다`);
  }
});
