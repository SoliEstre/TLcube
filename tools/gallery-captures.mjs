#!/usr/bin/env node

/**
 * gallery-captures.mjs — 수동 캡처 색인 (레퍼런스 갤러리 1차).
 *
 * 정적 페이지는 디렉터리를 나열하지 못한다. 그래서 «실기기 캡처» 슬롯의 목록은
 * 이 도구가 파일로 만든다 — 사진을 넣고 이걸 한 번 돌리면 갤러리가 본다.
 *
 *   test/output/gallery/captures/<조합id>/*.jpg   ← 사람이 넣는다 (수동 투입 규약)
 *   test/output/gallery/captures.json             ← 이 도구가 만든다
 *   test/output/gallery/captures.js               ← 같은 표의 file:// 폴백
 *
 * **캡처 매니페스트 의무** (PM/022 항목 12 · F-105 교훈): 사진이 어느 조합의 것인지
 * 폴더 이름 하나에 걸려 있으므로, 조합 표에 없는 폴더는 조용히 넘기지 않고
 * `unknown` 으로 표에 싣는다 (그리고 종료 코드는 0 — 색인은 성공했다).
 *
 * 사용: node tools/gallery-captures.mjs [--output <gallery dir>]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { galleryCombos } from './gallery-axes.mjs';
import { DEFAULT_GALLERY_DIR } from './gallery-render.mjs';

/** 캡처로 인정하는 확장자 — 뷰파인더 사진(jpg)이 정본, 나머지는 편의. */
const CAPTURE_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png', '.webp']);

export async function indexCaptures(galleryDir = DEFAULT_GALLERY_DIR) {
  const capturesDir = path.join(galleryDir, 'captures');
  await fs.mkdir(capturesDir, { recursive: true });
  const knownIds = new Set(galleryCombos().map((c) => c.id));

  const entries = await fs.readdir(capturesDir, { withFileTypes: true });
  const byCombo = {};
  const unknown = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = (await fs.readdir(path.join(capturesDir, entry.name), { withFileTypes: true }))
      .filter((f) => f.isFile()
        && CAPTURE_EXTENSIONS.includes(path.extname(f.name).toLowerCase()))
      .map((f) => f.name)
      .sort();
    const stats = [];
    for (const name of files) {
      const stat = await fs.stat(path.join(capturesDir, entry.name, name));
      stats.push({
        file: `captures/${entry.name}/${name}`,
        bytes: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
    if (!knownIds.has(entry.name)) unknown.push(entry.name);
    byCombo[entry.name] = stats;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: 'tools/gallery-captures.mjs',
    extensions: CAPTURE_EXTENSIONS,
    // 조합 표 밖의 폴더 — 오타이거나, 조합 축이 바뀌어 사라진 조합의 옛 사진이다.
    unknownFolders: unknown,
    counts: {
      combosWithCaptures: Object.keys(byCombo).filter((id) => byCombo[id].length > 0).length,
      files: Object.values(byCombo).reduce((n, list) => n + list.length, 0),
    },
    byCombo,
  };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  await fs.writeFile(path.join(galleryDir, 'captures.json'), json, 'utf8');
  await fs.writeFile(
    path.join(galleryDir, 'captures.js'),
    'window.__TL_GALLERY_CAPTURES__ = ' + json,
    'utf8',
  );
  return manifest;
}

function argValue(args, name, fallback) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  if (!args[at + 1]) throw new RangeError(name + ' 뒤에 값이 필요하다');
  return args[at + 1];
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const dir = argValue(process.argv.slice(2), '--output', null);
    const manifest = await indexCaptures(dir ? path.resolve(dir) : DEFAULT_GALLERY_DIR);
    console.log(`캡처 색인 — 조합 ${manifest.counts.combosWithCaptures}개 ·`
      + ` 파일 ${manifest.counts.files}장`);
    for (const name of manifest.unknownFolders) {
      console.log(`  ⚠ 조합 표에 없는 폴더: ${name}`);
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}
