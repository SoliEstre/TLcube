/**
 * make-photo-manifest.mjs — `test/output/photos/` 의 이미지 목록을 manifest.json 으로 굽는다.
 *
 * dev-server 는 디렉터리 목록을 내주지 않는다(의도적으로 정적 파일만 서빙). 그래서
 * photo-probe.html 이 읽을 목록을 여기서 만든다. 사진도 manifest 도 gitignore 되는
 * `test/output/` 안이라 public repo 로 넘어가지 않는다.
 *
 * 사용: node tools/make-photo-manifest.mjs
 */

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../test/output/photos/', import.meta.url));
const IMAGE = /\.(jpe?g|png|webp)$/i;

const names = (await readdir(DIR)).filter((n) => IMAGE.test(n)).sort();
await writeFile(join(DIR, 'manifest.json'), `${JSON.stringify(names, null, 2)}\n`);

console.log(`${names.length}장 → test/output/photos/manifest.json`);
for (const n of names) console.log(`  ${n}`);
