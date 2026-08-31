/**
 * 지원되는 R2 레이아웃 팩 전수를 test/output 아래에 굽는다.
 * import만으로는 파일을 쓰지 않는다.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LAYOUT_PACK_FORMAT,
  SUPPORTED_LAYOUT_PACK_SPECS,
  buildLayoutPack,
  layoutPackFileName,
  layoutPackSpecKey,
} from '../src/r2/layout-pack.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const OUTPUT_DIRECTORY = path.join(ROOT, 'test', 'output', 'r2-layout-packs');
export const MANIFEST_FILE = 'manifest.json';

const OUTPUT_RELATIVE_DIRECTORY = 'test/output/r2-layout-packs';
const PACK_OUTPUTS = SUPPORTED_LAYOUT_PACK_SPECS.map(
  (spec) => `${OUTPUT_RELATIVE_DIRECTORY}/${layoutPackFileName(spec)}`,
);

/** rebuild-all이 수렴 지문을 만들 때 읽는 선언. */
export const OUTPUTS = Object.freeze([
  ...PACK_OUTPUTS,
  `${OUTPUT_RELATIVE_DIRECTORY}/${MANIFEST_FILE}`,
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 파일 쓰기 전의 결정적 산출물과 manifest를 메모리에서 만든다. */
export function buildLayoutPackArtifacts() {
  const packs = SUPPORTED_LAYOUT_PACK_SPECS.map((spec) => {
    const bytes = buildLayoutPack(spec);
    return Object.freeze({
      spec,
      key: layoutPackSpecKey(spec),
      file: layoutPackFileName(spec),
      bytes,
      sha256: sha256(bytes),
    });
  });
  const manifest = {
    schema: 'tlcube-r2-layout-packs/v1',
    packFormat: {
      magic: LAYOUT_PACK_FORMAT.magic,
      version: LAYOUT_PACK_FORMAT.version,
      endian: LAYOUT_PACK_FORMAT.endian,
      headerBytes: LAYOUT_PACK_FORMAT.headerBytes,
    },
    count: packs.length,
    entries: packs.map((pack) => ({
      key: pack.key,
      file: pack.file,
      family: pack.spec.family,
      k: pack.spec.k,
      flags: pack.spec.flags,
      bytes: pack.bytes.byteLength,
      sha256: pack.sha256,
    })),
  };
  return Object.freeze({
    packs: Object.freeze(packs),
    manifest,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
  });
}

/** 전수 팩과 manifest를 지정 디렉터리에 쓴다. 기존 목록 밖 파일은 지우지 않는다. */
export function writeLayoutPacks(outputDirectory = OUTPUT_DIRECTORY) {
  const artifacts = buildLayoutPackArtifacts();
  mkdirSync(outputDirectory, { recursive: true });
  for (const pack of artifacts.packs) {
    writeFileSync(path.join(outputDirectory, pack.file), pack.bytes);
  }
  writeFileSync(path.join(outputDirectory, MANIFEST_FILE), artifacts.manifestText, 'utf8');
  return Object.freeze({
    outputDirectory,
    packCount: artifacts.packs.length,
    outputCount: artifacts.packs.length + 1,
    manifest: artifacts.manifest,
  });
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = writeLayoutPacks();
  console.log(
    `R2 레이아웃 팩 ${result.packCount}개 + manifest 1개 생성: ${result.outputDirectory}`,
  );
}
