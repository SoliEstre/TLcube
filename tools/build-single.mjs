// build-single.mjs — index.html + src/*.js 를 단일 HTML 파일로 묶는 결정적 생성기 (SPEC §8)
//
// ESM 을 텍스트 병합하지 않는다 (식별자 충돌·재작성 취약). 대신 blob URL 로더 방식:
// 각 모듈 소스를 JSON.stringify 문자열로 1회씩 임베드하고, 런타임에 토폴로지 순서대로
// 의존 specifier('./이름.js')를 이미 만든 blob URL 로 문자열 치환한 뒤
// URL.createObjectURL(new Blob([code], {type:'text/javascript'})) 로 등록, 마지막에
// 진입 모듈(app.js — index.html 의 <script type="module"> 블록)을 동적 import 한다.
// 서버 없이 file:// 로 열려야 하므로(SPEC §8) import map 이나 실제 네트워크 fetch 는 쓰지 않는다.
//
// 결정성: 생성물에 타임스탬프·해시·환경 정보를 넣지 않는다. 같은 입력 → 바이트 동일 출력.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FINDER_PATTERN_IDS, LEGACY_FINDER_PATTERN_ID } from '../src/finder-patterns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const INDEX_HTML = path.join(ROOT, 'index.html');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'trilume.html');

export const OFFICIAL_GENERATOR_EDITION = 'official';
export const FINDER_EXPERIMENT_EDITION = 'finder-experiment';
const GENERATOR_EDITIONS = Object.freeze([
  OFFICIAL_GENERATOR_EDITION, FINDER_EXPERIMENT_EDITION,
]);
const BODY_EDITION_DECLARATION = '<body data-generator-edition="official">';
const DEFAULT_FINDER_DECLARATION =
  "export const DEFAULT_FINDER_PATTERN_ID = '" + LEGACY_FINDER_PATTERN_ID + "';";

// 모듈 순서 — 디스크 순회 순서에 기대지 않는다. 의존 그래프상 위상 정렬 순서로 고정.
// TY8: Type Y(+QR fallback) 모듈을 뒤에 추가 — 전부 위 Type O 접두(prefix) 안의
// 모듈만 의존하거나(ygrid→hexgrid, capacityY→capacity/rs211/header, encodeY→...,
// verifyY→verify 등) 새로 추가되는 gf256→rs→qr 체인에 의존한다(qr.js 는 rs.js 를,
// rs.js 는 gf256.js 를 쓴다 — Type O RS 경로의 gfp/rs211 과는 별개 체인).
// 생성기 v2(PM/009): 'vendor/jcodd' → 'payloadform' 을 맨 앞에 추가 — payloadform.js
// 가 vendor/jcodd.js 를 import 하므로(JCODD 직렬화, Wi-Fi·명함 콘텐츠 탭), 등록
// 루프가 'vendor/jcodd' 의 blob URL 을 먼저 만들어 둬야 payloadform.js 원문 안의
// './vendor/jcodd.js' specifier 치환이 성립한다(buildLoaderScript 의 등록 순서 =
// 치환 가능 순서, 본 파일 상단 주석 참조). 다른 Type O/Y 모듈은 payloadform 을
// 의존하지 않으므로 나머지 순서에는 영향이 없다 — index.html(app 코드)만 소비한다.
// Type A (ADR 0005, PM/009 §2b): placementA→layoutA→capacityA→encodeA — 'capacity'
// (Type O) 뒤에 삽입한다. placementA 는 hexgrid·placement 만 의존, layoutA 는
// layout·placement·bullseye·placementA, capacityA 는 hexgrid·capacity·rs211·header·
// bullseye·placement·placementA, encodeA 는 capacityA·header·base211·rs211·mask·
// formatinfo·layoutA·placement·placementA 를 의존한다 — 이 순서면 위상 정렬이
// 성립한다(전 의존이 이미 등록된 뒤에 등록됨). scene.js(Type O) 를 그대로 재사용하므로
// 별도 sceneA 모듈은 없다(buildScene 이 cellDigits 삽입 순서만 순회 — 렌더 경로 공유,
// D7). MODULE_ORDER 등록 = MODULES 배열 등록 순서 = specifier 치환 가능 순서(본 파일
// 상단 주석) — capacity.js 를 import 하는 capacityA 는 반드시 'capacity' 뒤에 온다.
const MODULE_ORDER = [
  'vendor/jcodd', 'payloadform',
  'hexgrid', 'finder-patterns', 'finder-selection', 'finder-card-ui', 'render-status', 'lehmer', 'gfp', 'rs211', 'base211', 'mask', 'formatinfo',
  'header', 'placement', 'bullseye', 'layout', 'capacity',
  'placementA', 'layoutA', 'capacityA', 'encodeA',
  'luminance',
  // gf256→rs→qr 체인은 **scene 앞**에 와야 한다. scene.js 가 폴백 QR 을 그리려고
  // './qr.js' 를 import 하기 때문이다 — 원래는 Type Y 전용이라 보고 뒤에 뒀는데(TY8),
  // Type O 의 scene 이 그걸 쓰게 되면서 전방 참조가 됐다. 등록 순서 = 치환 가능 순서라
  // 전방 참조는 치환이 조용히 건너뛰어지고, 브라우저에서 blob: base 상대 해석 실패로
  // 터진다. 이 불변식은 이제 assertTopologicalOrder() 가 빌드 시점에 강제한다.
  'gf256', 'rs', 'qr', 'generator-state', 'export-filename',
  'encode', 'scene', 'raster', 'verify', 'svg', 'png',
  'ygrid', 'placementY', 'layoutY', 'capacityY', 'tonemap',
  // generator-render-config 는 **capacityY 뒤**여야 한다. 윈도 β 의 Y2·2톤 제약
  // (WINDOW_SUPPORTED_*)을 거기서 가져오기 때문이다 — 상수를 복제하지 않으려는 선택이고,
  // src/ 안에서 이 모듈을 쓰는 곳이 없어(앱만 쓴다) 뒤로 미뤄도 안전하다.
  'generator-render-config',
  'encodeY', 'sceneY', 'verifyY',
  // quietzone 은 순수 기하 모듈이라 의존이 없다 — 끝에 붙여도 위상 정렬이 성립한다.
  'quietzone',
  // i18n 도 의존이 없다(문구는 index.html 안에 인라인이고 여기엔 기구만 있다).
  'i18n',
  // beacon 도 의존이 없다 — 네트워크 전송과 오프라인 큐만 담는다.
  'beacon',
  // pwa-update 도 의존이 없다 — 서비스 워커 등록과 갱신 배너 DOM 만 담는다.
  'pwa-update',
  // lab-telemetry 도 의존이 없다 — WS 전송과 봉투 조립만 담는다. 시험판에서만 켜진다.
  'lab-telemetry',
];

/**
 * MODULE_ORDER 가 위상 정렬인지 빌드 시점에 강제한다.
 *
 * 로더의 치환 루프에는 `if (urls[depName] === undefined) continue;` 가 있다 — 아직 등록되지
 * 않은 의존은 **조용히 건너뛴다**. 그래서 전방 참조가 있으면 specifier 가 원문 그대로 남고,
 * blob URL 모듈 안의 상대 경로라 브라우저가 `Failed to resolve module specifier "./x.js"
 * — base scheme isn't hierarchical` 로 터진다. 원인(순서)과 증상(브라우저 콘솔)이 멀어서
 * 진단이 비싸다. 실제로 scene→qr 전방 참조가 이 경로로 배포까지 나갔다(2026-08-10).
 *
 * 그래서 규칙을 주석이 아니라 **빌드 실패**로 옮긴다. 여기서 던지면 `node tools/build-single.mjs`
 * 도, `buildSingleHtml()` 을 호출하는 번들 테스트도 같이 걸린다.
 *
 * 로더가 실제로 치환하는 형태(작은따옴표 `'./name.js'`)와 **같은 패턴**으로 검사한다 —
 * 검사와 치환이 다른 문법을 보면 검사를 통과하고도 치환이 안 되는 구멍이 생긴다.
 */
function assertTopologicalOrder(moduleSources) {
  const pos = new Map(moduleSources.map(([name], i) => [name, i]));
  const problems = [];

  for (const [name, code] of moduleSources) {
    const deps = new Set(
      [...code.matchAll(/'\.\/([A-Za-z0-9_/-]+)\.js'/g)].map((m) => m[1]),
    );
    for (const dep of deps) {
      if (!pos.has(dep)) {
        problems.push(`${name} → ${dep} : MODULE_ORDER 에 없는 모듈`);
      } else if (pos.get(dep) >= pos.get(name)) {
        problems.push(
          `${name}(${pos.get(name)}) → ${dep}(${pos.get(dep)}) : 전방 참조 — ` +
          `'${dep}' 를 '${name}' 앞으로 옮겨야 한다`,
        );
      }
    }
  }

  if (problems.length) {
    throw new Error(
      `MODULE_ORDER 가 위상 정렬이 아니다 (${problems.length}건). 이대로 빌드하면 ` +
      `specifier 치환이 조용히 건너뛰어져 브라우저에서만 터진다:\n  ` +
      problems.join('\n  '),
    );
  }
}

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(label + ': 빌드 치환 대상을 찾지 못했다');
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(label + ': 빌드 치환 대상이 2개 이상이다');
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

/** index.html 안의 <script type="module"> 블록 정확히 1개를 찾아 반환한다. */
function extractModuleScript(html) {
  const re = /<script type="module">([\s\S]*?)<\/script>/g;
  const matches = [...html.matchAll(re)];
  if (matches.length !== 1) {
    throw new Error(`<script type="module"> 블록이 정확히 1개여야 하는데 ${matches.length}개 발견됨`);
  }
  return matches[0];
}

/** 로더 스크립트 본문을 만든다. MODULES 배열 + specifier 치환 + 마지막 app import. */
function buildLoaderScript(moduleSources, appCode) {
  const modulesLiteral = moduleSources
    .map(([name, code]) => `  [${JSON.stringify(name)}, ${JSON.stringify(code)}]`)
    .join(',\n');

  return `
// Trilume 단일 파일 로더 — blob URL 로 ESM 모듈을 등록한 뒤 app 을 동적 import 한다.
// (tools/build-single.mjs 로 생성됨 — 직접 수정하지 말 것)
const MODULES = [
${modulesLiteral}
];
const APP_CODE = ${JSON.stringify(appCode)};

const urls = {};
for (const [name, code] of MODULES) {
  let rewritten = code;
  for (const [depName] of MODULES) {
    if (urls[depName] === undefined) continue;
    rewritten = rewritten.split(\`'./\${depName}.js'\`).join(\`'\${urls[depName]}'\`);
  }
  const blob = new Blob([rewritten], { type: 'text/javascript' });
  urls[name] = URL.createObjectURL(blob);
}

let appRewritten = APP_CODE;
for (const [depName] of MODULES) {
  appRewritten = appRewritten.split(\`'./\${depName}.js'\`).join(\`'\${urls[depName]}'\`);
}
const appBlob = new Blob([appRewritten], { type: 'text/javascript' });
const appUrl = URL.createObjectURL(appBlob);
await import(appUrl);
`;
}

/** index.html + src/*.js 를 읽어 단일 HTML 문자열을 만든다. 부수효과 없음(결정적, 순수 함수). */
export function buildSingleHtml(options = {}) {
  const defaultFinderPatternId = options.defaultFinderPatternId === undefined
    ? LEGACY_FINDER_PATTERN_ID : options.defaultFinderPatternId;
  const generatorEdition = options.generatorEdition === undefined
    ? OFFICIAL_GENERATOR_EDITION : options.generatorEdition;
  const validFinderIds = [LEGACY_FINDER_PATTERN_ID, ...FINDER_PATTERN_IDS];
  if (!validFinderIds.includes(defaultFinderPatternId)) {
    throw new RangeError('알 수 없는 기본 파인더 id: ' + defaultFinderPatternId);
  }
  if (!GENERATOR_EDITIONS.includes(generatorEdition)) {
    throw new RangeError('알 수 없는 생성기 edition: ' + generatorEdition);
  }
  // 정식판에서 실험 기본값을 허용하지 않는다. 옵션 누락은 위의 레거시 기본값으로
  // 떨어지므로, 플래그가 어긋났을 때도 복호 가능한 코드가 나온다.
  if (generatorEdition === OFFICIAL_GENERATOR_EDITION
      && defaultFinderPatternId !== LEGACY_FINDER_PATTERN_ID) {
    throw new RangeError('정식 생성기의 기본 파인더는 bullseye 여야 한다');
  }

  const sourceIndexHtml = readFileSync(INDEX_HTML, 'utf8');
  const indexHtml = replaceExactlyOnce(
    sourceIndexHtml,
    BODY_EDITION_DECLARATION,
    '<body data-generator-edition="' + generatorEdition + '">',
    'generator edition',
  );
  const [fullMatch, scriptBody] = extractModuleScript(indexHtml);
  const matchStart = indexHtml.indexOf(fullMatch);

  // app.js 가상 모듈: './src/X.js' → './X.js' 로 specifier 재작성.
  let appCode = scriptBody;
  for (const name of MODULE_ORDER) {
    appCode = appCode.split(`'./src/${name}.js'`).join(`'./${name}.js'`);
  }

  const moduleSources = MODULE_ORDER.map((name) => {
    const filePath = path.join(SRC_DIR, `${name}.js`);
    let code = readFileSync(filePath, 'utf8');
    if (name === 'finder-patterns') {
      code = replaceExactlyOnce(
        code,
        DEFAULT_FINDER_DECLARATION,
        "export const DEFAULT_FINDER_PATTERN_ID = '" + defaultFinderPatternId + "';",
        'default finder pattern',
      );
    }
    return [name, code];
  });

  assertTopologicalOrder(moduleSources);

  const loaderBody = buildLoaderScript(moduleSources, appCode);
  const loaderScriptTag = `<script type="module">${loaderBody}</script>`;

  return indexHtml.slice(0, matchStart) +
    loaderScriptTag +
    indexHtml.slice(matchStart + fullMatch.length);
}

function main() {
  const out = buildSingleHtml();
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, out, 'utf8');
  process.stdout.write(`dist/trilume.html 생성됨 (${Buffer.byteLength(out, 'utf8')} B)\n`);
}

// CLI 로 직접 실행됐을 때만 빌드를 돈다 (test/bundle.test.js 는 buildSingleHtml() 만 import).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
