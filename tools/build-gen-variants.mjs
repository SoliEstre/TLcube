// build-gen-variants.mjs — 같은 index.html/src에서 정식판과 실험 파인더 시험판을 만든다.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSingleHtml, FINDER_EXPERIMENT_EDITION,
} from './build-single.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MODULE_DIR, '..');
const OFFICIAL_PATH = path.join(ROOT, 'dist', 'trilume.html');
const EXPERIMENT_PATH = path.join(ROOT, 'sites', '_shared', 'gen-finder.html');

export const FINDER_EXPERIMENT_DEFAULT_ID = 'pinwheel-c2-2-1100-cw';

export function buildGeneratorVariants() {
  return Object.freeze({
    official: buildSingleHtml(),
    experiment: buildSingleHtml({
      generatorEdition: FINDER_EXPERIMENT_EDITION,
      defaultFinderPatternId: FINDER_EXPERIMENT_DEFAULT_ID,
    }),
  });
}

function main() {
  const built = buildGeneratorVariants();
  mkdirSync(path.dirname(OFFICIAL_PATH), { recursive: true });
  mkdirSync(path.dirname(EXPERIMENT_PATH), { recursive: true });
  writeFileSync(OFFICIAL_PATH, built.official, 'utf8');
  writeFileSync(EXPERIMENT_PATH, built.experiment, 'utf8');
  process.stdout.write('dist/trilume.html 생성됨 (' + Buffer.byteLength(built.official, 'utf8') + ' B)\n');
  process.stdout.write('sites/_shared/gen-finder.html 생성됨 (' + Buffer.byteLength(built.experiment, 'utf8') + ' B)\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
