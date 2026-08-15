// build-cell-editor.mjs — 다중 타입 셀 & 파인더 에디터를 독립 HTML로 빌드한다.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readSourceLf } from './embed-source.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MODULE_DIR, '..');
const SRC_DIR = path.join(ROOT, 'src');
const TEMPLATE_PATH = path.join(MODULE_DIR, 'cell-editor-template.html');
const APP_PATH = path.join(MODULE_DIR, 'cell-editor-app.js');
const OUTPUT_SHARED_PATH = path.join(ROOT, 'sites', '_shared', 'cell-editor.html');
const LOADER_TOKEN = '<!-- CELL_EDITOR_LOADER -->';

export const CELL_EDITOR_MODULE_ORDER = Object.freeze([
  'hexgrid', 'ygrid', 'locatorY', 'finder-patterns', 'finder-editor-pattern',
  'lehmer', 'gfp', 'rs211', 'base211', 'mask', 'formatinfo', 'header',
  'placement', 'bullseye', 'layout', 'capacity',
  'placementA', 'layoutA', 'capacityA', 'encodeA',
  'placementY', 'autoplaceY', 'type-y-cell-editor', 'layoutY', 'capacityY',
  'cellSurfaceY', 'cellSurfaceLayouts', 'cellSurfaceFinal', 'encodeY',
  'luminance', 'export-filename', 'cell-editor-core',
]);

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(label + ' must occur exactly once');
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function assertTopologicalOrder(moduleSources) {
  const positions = new Map(moduleSources.map(([name], index) => [name, index]));
  const problems = [];
  for (const [name, source] of moduleSources) {
    const dependencies = new Set(
      [...source.matchAll(/'\.\/([A-Za-z0-9_/-]+)\.js'/g)].map((match) => match[1]),
    );
    for (const dependency of dependencies) {
      if (!positions.has(dependency)) problems.push(name + ' -> ' + dependency + ' (missing)');
      else if (positions.get(dependency) >= positions.get(name)) {
        problems.push(name + ' -> ' + dependency + ' (forward reference)');
      }
    }
  }
  if (problems.length) throw new Error('cell editor module order is invalid: ' + problems.join('; '));
}

function buildLoaderScript(moduleSources, appSource) {
  const modulesLiteral = moduleSources
    .map(([name, source]) => '  [' + JSON.stringify(name) + ', ' + JSON.stringify(source) + ']')
    .join(',\n');
  return '<script type="module">\n'
    + '// tools/build-cell-editor.mjs generated this loader.\n'
    + 'const MODULES = [\n' + modulesLiteral + '\n];\n'
    + 'const APP_SOURCE = ' + JSON.stringify(appSource) + ';\n'
    + 'const urls = {};\n'
    + 'const quote = String.fromCharCode(39);\n'
    + 'for (const [name, source] of MODULES) {\n'
    + '  let rewritten = source;\n'
    + '  for (const [dependency] of MODULES) {\n'
    + '    if (urls[dependency] === undefined) continue;\n'
    + '    rewritten = rewritten.split(quote + "./" + dependency + ".js" + quote).join(quote + urls[dependency] + quote);\n'
    + '  }\n'
    + '  urls[name] = URL.createObjectURL(new Blob([rewritten], { type: "text/javascript" }));\n'
    + '}\n'
    + 'let app = APP_SOURCE;\n'
    + 'for (const [dependency] of MODULES) {\n'
    + '  app = app.split(quote + "./" + dependency + ".js" + quote).join(quote + urls[dependency] + quote);\n'
    + '}\n'
    + 'const appUrl = URL.createObjectURL(new Blob([app], { type: "text/javascript" }));\n'
    + 'await import(appUrl);\n'
    + '</script>';
}

export function buildCellEditorHtml() {
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const appSource = readSourceLf(APP_PATH);
  const moduleSources = CELL_EDITOR_MODULE_ORDER.map((name) => [
    name,
    readSourceLf(path.join(SRC_DIR, name + '.js')),
  ]);
  assertTopologicalOrder(moduleSources);
  return replaceExactlyOnce(
    template,
    LOADER_TOKEN,
    buildLoaderScript(moduleSources, appSource),
    'cell editor loader token',
  );
}

export function writeCellEditorBundle() {
  const html = buildCellEditorHtml();
  mkdirSync(path.dirname(OUTPUT_SHARED_PATH), { recursive: true });
  writeFileSync(OUTPUT_SHARED_PATH, html, 'utf8');
  process.stdout.write('sites/_shared/cell-editor.html 생성됨 (' + Buffer.byteLength(html, 'utf8') + ' B)\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) writeCellEditorBundle();
