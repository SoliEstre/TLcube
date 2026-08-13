// build-lab.mjs — 기존 변형 빌더의 현재 시험판 둘만 /lab/ 배포 파일로 쓴다.
//
// 산출물은 sites/_shared 에 있지만 nginx 는 /lab/ exact alias 로 서빙한다. 따라서
// _shared 의 장기 캐시 정책을 물려받지 않는다. 이 도구는 통합자가 번들을 굽는 마지막
// 단계에서만 실행한다.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildGeneratorLabHtml, LAB_GENERATOR_PATH,
} from './build-gen-variants.mjs';
import {
  buildScannerLabHtml, LAB_SCANNER_PATH,
} from './build-scan-variants.mjs';

export const LAB_OUTPUTS = Object.freeze({
  generator: LAB_GENERATOR_PATH,
  scanner: LAB_SCANNER_PATH,
});

export function buildLabVariants() {
  return Object.freeze({
    generator: buildGeneratorLabHtml(),
    scanner: buildScannerLabHtml(),
  });
}

export function writeLabVariants(built = buildLabVariants()) {
  for (const [kind, file] of Object.entries(LAB_OUTPUTS)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, built[kind], 'utf8');
    process.stdout.write(
      path.relative(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), file)
        .split(path.sep).join('/')
      + ' 생성됨 (' + Buffer.byteLength(built[kind], 'utf8') + ' B)\n',
    );
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) writeLabVariants();
