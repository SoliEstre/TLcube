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
  // finder-oak-lineup/-patterns: scene.js 의 OAK 렌더 경로 (2026-08-18).
  'hexgrid', 'ygrid', 'locatorY', 'finder-patterns', 'finder-oak-lineup',
  'finder-editor-pattern',
  'lehmer', 'gfp', 'rs211', 'base211', 'mask', 'formatinfo', 'header',
  'placement', 'bullseye', 'layout', 'capacity',
  // O-CM/A-CM 코너 마커 (2026-08-16) — encodeA.js 가 markerA 를, markerA 가 markerO 를,
  // markerO 가 autoplaceHex 를, autoplaceHex 가 autoplaceY(→placementY) 를 쓴다.
  'placementY', 'autoplaceY', 'autoplaceHex',
  // turnA 는 encodeA 앞 (2026-08-18 턴A 편입 — encodeA 가 표를 조회한다).
  // finder-daehan 은 capacityA 앞 (2026-08-19 daehan × Type A 지원 — capacityA 와
  // encodeA 가 daehan 표를 조회한다). ⚠ 이 줄이 빠져서 빌더의 위상 검사가
  // 「capacityA -> finder-daehan (missing)」으로 죽었다 — **검사가 일했다.**
  // 새 의존을 추가하는 레인은 번들 위상표도 같이 봐야 한다.
  // **의도적 이동 (2026-08-23, W2 선행)**: `finder-oak-patterns` 가 daehan 뒤로 왔고
  // `finder-footprint` 가 새로 등록됐다 — OAK 표가 footprint 표와 taegeuk 유도
  // (finder-daehan)를 import 하게 됐기 때문이다 (build-single.mjs 동일).
  'finder-daehan', 'finder-footprint', 'finder-oak-patterns',
  'placementA', 'layoutA', 'capacityA', 'turnA', 'markerG', 'markerO', 'finder-H', 'markerA', 'encodeA',
  'type-y-cell-editor', 'layoutY', 'capacityY',
  'cellSurfaceY', 'cellSurfaceLayouts', 'cellSurfaceFinal',
  // **의도적 유지 (2026-08-21, 중앙 v0 비컨)**: encodeY 는 scene 앞으로 가야 한다.
  // 이 편집기는 scene 을 안 실지만 encodeY 는 이미 cellSurfaceFinal 뒤에 있다 —
  // 생성기 표에서 앞으로 옮긴 것과 같은 상대 순서다. centralBeacon 은 scene
  // 전용이라 여기 넣지 않는다 (넣으면 쓰이지 않는 전방 의존만 생긴다).
  'encodeY',
  'luminance', 'export-filename', 'cell-editor-history', 'cell-editor-core',
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
