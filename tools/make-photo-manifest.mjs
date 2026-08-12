/**
 * make-photo-manifest.mjs — `test/output/photos/` 의 이미지 목록을 manifest.json 으로 굽는다.
 *
 * dev-server 는 디렉터리 목록을 내주지 않는다(의도적으로 정적 파일만 서빙). 그래서
 * photo-probe.html 이 읽을 목록을 여기서 만든다. 사진도 manifest 도 gitignore 되는
 * `test/output/` 안이라 public repo 로 넘어가지 않는다.
 *
 * 촬영 세션마다 하위 폴더로 나눠 담으므로(`cube-20260812c/` 처럼) **재귀로 훑는다**.
 * 최상위만 보던 시절엔 세션 폴더를 통째로 못 보고 «덤프가 없다» 로 읽혔다.
 * 경로는 `photos/` 기준 상대경로이고 `/` 로 잇는다 — 그대로 URL 이 된다.
 *
 * 사용: node tools/make-photo-manifest.mjs
 */

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../test/output/photos/', import.meta.url));
const IMAGE = /\.(jpe?g|png|webp)$/i;
// 덤프 출력 폴더는 훑지 않는다 — 이미지가 아니지만 커지면 순회만 낭비다.
const SKIP = new Set(['luma']);

async function collect(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      found.push(...await collect(join(directory, entry.name), `${prefix}${entry.name}/`));
    } else if (IMAGE.test(entry.name)) {
      found.push(prefix + entry.name);
    }
  }
  return found;
}

const names = (await collect(DIR)).sort();
await writeFile(join(DIR, 'manifest.json'), `${JSON.stringify(names, null, 2)}\n`);

console.log(`${names.length}장 → test/output/photos/manifest.json`);
for (const n of names) console.log(`  ${n}`);
