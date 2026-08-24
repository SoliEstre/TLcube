// build-finder-editor.mjs — 파인더 에디터 소스와 현재 src 모듈을 단일 HTML로 묶는다.

import { readFileSync, writeFileSync } from 'node:fs';
import { readSourceLf } from './embed-source.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MODULE_DIR, '..');
const SRC_DIR = path.join(ROOT, 'src');
const TEMPLATE_PATH = path.join(MODULE_DIR, 'finder-editor-template.html');
const APP_PATH = path.join(MODULE_DIR, 'finder-editor-app.js');
const OUTPUT_PATH = path.join(ROOT, 'sites', '_shared', 'gen-finder-editor.html');
const LOADER_TOKEN = '<!-- FINDER_EDITOR_LOADER -->';

export const FINDER_EDITOR_MODULE_ORDER = Object.freeze([
  // finder-oak-lineup/-patterns 는 scene.js 가 OAK 후보를 렌더하려고 쓴다 (2026-08-18).
  // finder-patterns 뒤 · scene 앞이어야 한다.
  'hexgrid', 'finder-patterns', 'finder-oak-lineup',
  'finder-editor-pattern', 'lehmer', 'gfp', 'rs211', 'base211',
  'mask', 'formatinfo', 'header', 'placement', 'bullseye', 'layout', 'capacity',
  // daehan (2026-08-18) — scene.js 가 finder-daehan 을, encode.js 가 capacityDaehan 을
  // 쓴다. 둘 다 capacity 뒤 · encode/scene 앞.
  // **의도적 이동 (2026-08-23, W2 선행)**: `finder-oak-patterns` 가 daehan 뒤로 왔고
  // `finder-footprint`(의존: finder-patterns 뿐)가 새로 등록됐다 — OAK 표가 footprint
  // 표와 taegeuk 유도(finder-daehan)를 import 하게 됐기 때문이다 (build-single.mjs 동일).
  'finder-daehan', 'finder-footprint', 'finder-oak-patterns', 'capacityDaehan',
  // O-CM/A-CM 코너 마커 (2026-08-16) — encode.js·encodeA.js 가 markerO/markerA 를 쓰므로
  // 그 앞에 온다. autoplaceHex 는 autoplaceY 의 AutoplaceError 를 재사용하고 autoplaceY 는
  // placementY 만 쓴다. markerA 는 layoutA·capacityA·markerO 전부의 뒤여야 한다.
  'placementY', 'autoplaceY', 'autoplaceHex',
  // turnA 는 encodeA 앞 (2026-08-18 턴A 편입 — encodeA 가 표를 조회한다).
  'placementA', 'layoutA', 'capacityA', 'turnA', 'markerG', 'markerO', 'finder-H', 'markerA', 'finder-NO2', 'encodeA', 'luminance', 'export-filename',
  // finder-selection(의존 0) 과 Y 표면 체인은 **scene 앞**이다 (2026-08-21, 중앙 v0
  // 파인더). scene.js 가 중앙 슬롯 점유자 id 를 finder-selection 에서, v0 의 모듈
  // 사각형·정본 셀을 ygrid·cellSurfaceFinal 에서 가져온다. 위상 검사는 정적이라
  // 이 편집기가 v0 를 실제로 렌더하든 안 하든 번들에 들어와야 한다.
  'finder-selection',
  'ygrid', 'type-y-cell-editor', 'layoutY', 'capacityY', 'cellSurfaceY', 'cellSurfaceLayouts', 'cellSurfaceFinal',
  // **의도적 이동 (2026-08-21, 중앙 v0 비컨)**: scene.js 가 중앙 슬롯을 완전한
  // v0 코드로 채우려고 encodeY·centralBeacon 을 부르고, 데이터 셀 톤에 tonemap 을
  // 쓴다. encodeY 의 로컬 의존 layoutY 도 여기 온다 (capacityY 옆 — cell-editor
  // 표와 같은 자리). 위상 검사는 정적이라 이 편집기가 비컨을 실제로 렌더하든
  // 안 하든 번들에 들어와야 한다.
  'tonemap', 'encodeY', 'centralBeaconWire', 'centralBeacon',
  'gf256', 'rs', 'qr', 'encode', 'scene', 'raster', 'png',
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
  if (problems.length) throw new Error('finder editor module order is invalid: ' + problems.join('; '));
}

function buildLoaderScript(moduleSources, appSource) {
  const modulesLiteral = moduleSources
    .map(([name, source]) => '  [' + JSON.stringify(name) + ', ' + JSON.stringify(source) + ']')
    .join(',\n');
  return '<script type="module">\n'
    + '// tools/build-finder-editor.mjs generated this loader.\n'
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

export function buildFinderEditorHtml() {
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const appSource = readSourceLf(APP_PATH);
  const moduleSources = FINDER_EDITOR_MODULE_ORDER.map((name) => [
    name,
    readSourceLf(path.join(SRC_DIR, name + '.js')),
  ]);
  assertTopologicalOrder(moduleSources);
  return replaceExactlyOnce(
    template,
    LOADER_TOKEN,
    buildLoaderScript(moduleSources, appSource),
    'finder editor loader token',
  );
}

function main() {
  const html = buildFinderEditorHtml();
  writeFileSync(OUTPUT_PATH, html, 'utf8');
  process.stdout.write('sites/_shared/gen-finder-editor.html 생성됨 (' + Buffer.byteLength(html, 'utf8') + ' B)\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
