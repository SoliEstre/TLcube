// build-gen-variants.mjs — 같은 index.html/src에서 정식판과 실험 파인더 시험판을 만든다.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSingleHtml, FINDER_EXPERIMENT_EDITION,
} from './build-single.mjs';
import { buildFinderEditorHtml } from './build-finder-editor.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MODULE_DIR, '..');
const OFFICIAL_PATH = path.join(ROOT, 'dist', 'trilume.html');
const EXPERIMENT_PATH = path.join(ROOT, 'sites', '_shared', 'gen-finder.html');
const EDITOR_PATH = path.join(ROOT, 'sites', '_shared', 'gen-finder-editor.html');
export const LAB_GENERATOR_PATH = path.join(ROOT, 'sites', '_shared', 'lab-gen.html');
// 수렴 지문 대상 (rebuild-all.mjs) — main() 의 쓰기 4건이 사용하는 상수 그대로.
export const OUTPUTS = Object.freeze([OFFICIAL_PATH, EXPERIMENT_PATH, EDITOR_PATH, LAB_GENERATOR_PATH]);

export const FINDER_EXPERIMENT_DEFAULT_ID = 'pinwheel-c2-2-1100-cw';

export function buildGeneratorLabHtml() {
  return buildSingleHtml({
    generatorEdition: FINDER_EXPERIMENT_EDITION,
    defaultFinderPatternId: FINDER_EXPERIMENT_DEFAULT_ID,
  });
}

export function buildGeneratorVariants() {
  const experiment = buildGeneratorLabHtml();
  return Object.freeze({
    official: buildSingleHtml(),
    experiment,
    editor: buildFinderEditorHtml(),
    // /lab/ 은 기존 실험 변형을 별도 URL에서 서빙한다. 소스·툴체인을 복제하지 않는다.
    lab: experiment,
  });
}

function main() {
  const built = buildGeneratorVariants();
  mkdirSync(path.dirname(OFFICIAL_PATH), { recursive: true });
  mkdirSync(path.dirname(EXPERIMENT_PATH), { recursive: true });
  writeFileSync(OFFICIAL_PATH, built.official, 'utf8');
  writeFileSync(EXPERIMENT_PATH, built.experiment, 'utf8');
  writeFileSync(EDITOR_PATH, built.editor, 'utf8');
  writeFileSync(LAB_GENERATOR_PATH, built.lab, 'utf8');
  process.stdout.write('dist/trilume.html 생성됨 (' + Buffer.byteLength(built.official, 'utf8') + ' B)\n');
  process.stdout.write('sites/_shared/gen-finder.html 생성됨 (' + Buffer.byteLength(built.experiment, 'utf8') + ' B)\n');
  process.stdout.write('sites/_shared/gen-finder-editor.html 생성됨 (' + Buffer.byteLength(built.editor, 'utf8') + ' B)\n');
  process.stdout.write('sites/_shared/lab-gen.html 생성됨 (' + Buffer.byteLength(built.lab, 'utf8') + ' B)\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
