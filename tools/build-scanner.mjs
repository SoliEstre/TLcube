// build-scanner.mjs — sites/tlscan을 결정적 단일 HTML로 만드는 빌더.
//
// 이름 선택: build-single.mjs는 생성기 index.html 전용 이름이다. 이 파일은 같은
// 패키징 기법을 스캐너에 적용하되 대상이 명확해야 하므로 build-scanner.mjs로 둔다.
//
// ESM을 텍스트 병합하지 않는다. 병합하면 모듈별 lexical scope가 사라져 식별자 충돌과
// 재작성 취약점이 생긴다. 대신 각 소스를 독립 blob URL 모듈로 등록하고 마지막에
// scanner.js를 동적 import한다. 이 방식은 static server와 file URL 환경 모두에서
// 네트워크 module fetch 없이 동작한다.
//
// 스캐너는 src/decoder와 src 루트 양쪽으로 넓고 자주 변하는 그래프를 가진다. 수동
// MODULE_ORDER 목록은 import 하나를 놓치면 브라우저에서만 깨지는 전방 참조를 만든다.
// 그래서 여기서는 정적 로컬 ESM import를 수집해 안정적인 Kahn 위상 정렬을 만든다.
// 동률은 module id의 코드포인트 순서로 고정해 filesystem 순회에 의존하지 않는다.
//
// 결정성: 타임스탬프, 해시, 환경 정보는 넣지 않는다. 같은 입력은 같은 바이트를 낸다.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readSourceLf } from './embed-source.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const SCANNER_DIR = path.join(ROOT, 'sites', 'tlscan');
const INDEX_HTML = path.join(SCANNER_DIR, 'index.html');
const ENTRY_FILE = path.join(SCANNER_DIR, 'scanner.js');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'tlscan.html');
// 수렴 지문 대상 (rebuild-all.mjs) — 쓰기가 사용하는 경로 상수에서 유도한다.
export const OUTPUTS = Object.freeze([OUT_FILE]);
const ENTRY_MODULE_ID = '/scanner.js';
const SOURCE_PREFIX = '/src/';

// 이 parser가 만든 dependency record를 위상 가드와 placeholder 치환이 함께 쓴다.
// 즉 검사 문법과 실제 치환 문법이 달라져 검사를 통과하고도 브라우저에서 깨지는 구멍을
// 만들지 않는다. 현재 공개 스캐너의 정적 import/export from 문법만 허용한다.
const STATIC_MODULE_SPECIFIER_RE =
  /(?:^|[;\r\n])\s*(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+(?:[^'";]*?\s+from\s+)?)(['"])([^'"]+)\1/g;
const RELATIVE_JS_SPECIFIER_RE = /(['"])(?:\.\/|\.\.\/)[^'"]+\.js\1/g;

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function compareModuleIds(a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function moduleIdForFile(filePath) {
  const normalized = path.resolve(filePath);

  if (normalized === ENTRY_FILE) return ENTRY_MODULE_ID;

  if (isWithin(SRC_DIR, normalized)) {
    return SOURCE_PREFIX + toPosixPath(path.relative(SRC_DIR, normalized));
  }

  if (isWithin(SCANNER_DIR, normalized)) {
    return '/tlscan/' + toPosixPath(path.relative(SCANNER_DIR, normalized));
  }

  throw new Error('스캐너 번들이 허용하지 않는 로컬 모듈 경로: ' + normalized);
}

function resolveLocalModuleSpecifier(specifier, fromFile, fromId) {
  let candidate;

  if (specifier.startsWith(SOURCE_PREFIX)) {
    candidate = path.resolve(ROOT, '.' + specifier);
  } else if (specifier.startsWith('.')) {
    candidate = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith('/')) {
    throw new Error(
      fromId + '가 허용하지 않는 절대 module specifier를 import한다: ' + specifier +
      ' (스캐너 번들은 /src/만 허용)',
    );
  } else {
    throw new Error(
      fromId + '가 외부 또는 bare module specifier를 import한다: ' + specifier +
      ' (런타임 의존성 0 계약 위반)',
    );
  }

  if (path.extname(candidate) !== '.js') {
    throw new Error(fromId + '의 로컬 import는 .js여야 한다: ' + specifier);
  }

  const normalized = path.resolve(candidate);
  moduleIdForFile(normalized);

  if (!existsSync(normalized)) {
    throw new Error(fromId + '가 존재하지 않는 로컬 모듈을 import한다: ' + specifier);
  }

  return {
    filePath: normalized,
    id: moduleIdForFile(normalized),
  };
}

function extractStaticDependencies(code, fromFile, fromId) {
  const dependencies = [];
  const seenTokens = new Set();

  for (const match of code.matchAll(STATIC_MODULE_SPECIFIER_RE)) {
    const quote = match[1];
    const specifier = match[2];
    const token = quote + specifier + quote;
    const tokenKey = quote + '\u0000' + specifier;

    if (seenTokens.has(tokenKey)) continue;
    seenTokens.add(tokenKey);

    const target = resolveLocalModuleSpecifier(specifier, fromFile, fromId);
    dependencies.push({
      id: target.id,
      filePath: target.filePath,
      quote,
      token,
    });
  }

  return dependencies;
}

function topologicallySortModules(modules) {
  const byId = new Map();

  for (const moduleSource of modules) {
    if (byId.has(moduleSource.id)) {
      throw new Error('스캐너 모듈 id가 중복됨: ' + moduleSource.id);
    }
    byId.set(moduleSource.id, moduleSource);
  }

  const indegree = new Map();
  const dependents = new Map();

  for (const moduleSource of modules) {
    indegree.set(moduleSource.id, 0);
    dependents.set(moduleSource.id, []);
  }

  for (const moduleSource of modules) {
    const dependencyIds = [...new Set(moduleSource.dependencies.map((dependency) => dependency.id))];

    for (const dependencyId of dependencyIds) {
      if (!byId.has(dependencyId)) {
        throw new Error(moduleSource.id + '의 의존 모듈이 그래프에 없음: ' + dependencyId);
      }
      indegree.set(moduleSource.id, indegree.get(moduleSource.id) + 1);
      dependents.get(dependencyId).push(moduleSource);
    }
  }

  const ready = modules.filter((moduleSource) => indegree.get(moduleSource.id) === 0)
    .sort(compareModuleIds);
  const ordered = [];

  while (ready.length) {
    const moduleSource = ready.shift();
    ordered.push(moduleSource);

    for (const dependent of dependents.get(moduleSource.id)) {
      const nextIndegree = indegree.get(dependent.id) - 1;
      indegree.set(dependent.id, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(dependent);
        ready.sort(compareModuleIds);
      }
    }
  }

  if (ordered.length !== modules.length) {
    const cyclicIds = modules
      .filter((moduleSource) => indegree.get(moduleSource.id) > 0)
      .map((moduleSource) => moduleSource.id)
      .sort();
    throw new Error(
      '스캐너의 정적 로컬 ESM 그래프에 순환 의존이 있어 blob URL 등록 순서를 만들 수 없음: ' +
      cyclicIds.join(', '),
    );
  }

  return ordered;
}

/**
 * scanner.js에서 도달하는 정적 로컬 ESM 모듈을 수집하고 안정적으로 위상 정렬한다.
 * 반환값은 테스트의 순서 뮤테이션 검증에도 사용한다.
 */
export function collectScannerModuleSources() {
  const modules = new Map();
  const visiting = [];

  function visit(filePath) {
    const normalized = path.resolve(filePath);
    const id = moduleIdForFile(normalized);
    const cycleAt = visiting.indexOf(id);

    if (cycleAt !== -1) {
      throw new Error(
        '스캐너의 정적 로컬 ESM 그래프에 순환 의존이 있음: ' +
        visiting.slice(cycleAt).concat(id).join(' -> '),
      );
    }

    if (modules.has(id)) return;

    visiting.push(id);
    const code = readSourceLf(normalized);
    const moduleSource = {
      id,
      filePath: normalized,
      code,
      dependencies: [],
    };
    modules.set(id, moduleSource);

    moduleSource.dependencies = extractStaticDependencies(code, normalized, id);
    for (const dependency of moduleSource.dependencies) {
      visit(dependency.filePath);
    }
    visiting.pop();
  }

  visit(ENTRY_FILE);
  return topologicallySortModules([...modules.values()]);
}

/**
 * 등록 순서가 blob 로더의 의존 선행 조건을 만족하는지 빌드 시점에 강제한다.
 *
 * 로더는 아직 등록되지 않은 blob URL을 만들 수 없으므로 전방 참조를 조용히 건너뛸 수
 * 없다. 이 가드가 없으면 남은 placeholder가 browser에서만 module resolution 오류를
 * 낸다. dependency record는 extractStaticDependencies가 만들며, placeholder 치환도
 * 같은 record를 사용한다.
 */
export function assertTopologicalOrder(moduleSources) {
  const positions = new Map();
  const problems = [];

  for (let index = 0; index < moduleSources.length; index += 1) {
    const id = moduleSources[index].id;
    if (positions.has(id)) {
      problems.push('module id 중복: ' + id);
    }
    positions.set(id, index);
  }

  for (let index = 0; index < moduleSources.length; index += 1) {
    const moduleSource = moduleSources[index];

    for (const dependency of moduleSource.dependencies) {
      if (!positions.has(dependency.id)) {
        problems.push(moduleSource.id + ' -> ' + dependency.id + ' : 번들 목록에 없는 모듈');
      } else if (positions.get(dependency.id) >= index) {
        problems.push(
          moduleSource.id + '(' + index + ') -> ' + dependency.id + '(' +
          positions.get(dependency.id) + ') : 전방 참조',
        );
      }
    }
  }

  if (problems.length) {
    throw new Error(
      '스캐너 모듈 등록 순서가 위상 정렬이 아니다 (' + problems.length + '건). ' +
      '이대로 빌드하면 specifier 치환이 누락되어 브라우저에서만 실패한다:\n  ' +
      problems.join('\n  '),
    );
  }
}

function assertNoRelativeJsSpecifiers(moduleSources) {
  const problems = [];

  for (const moduleSource of moduleSources) {
    const matches = [...moduleSource.code.matchAll(RELATIVE_JS_SPECIFIER_RE)];
    for (const match of matches) {
      problems.push(moduleSource.id + '에 잔존: ' + match[0]);
    }
  }

  if (problems.length) {
    throw new Error(
      '스캐너 단일 파일에 상대 .js specifier가 남아 있음:\n  ' +
      problems.join('\n  '),
    );
  }
}

function prepareModuleSources(moduleSources) {
  const placeholders = new Map();

  for (let index = 0; index < moduleSources.length; index += 1) {
    placeholders.set(
      moduleSources[index].id,
      '__TLSCAN_BLOB_' + String(index).padStart(3, '0') + '__',
    );
  }

  for (const moduleSource of moduleSources) {
    for (const placeholder of placeholders.values()) {
      if (moduleSource.code.includes(placeholder)) {
        throw new Error(
          moduleSource.id + '의 원문이 내부 blob placeholder와 충돌함: ' + placeholder,
        );
      }
    }
  }

  const prepared = moduleSources.map((moduleSource) => {
    let code = moduleSource.code;

    for (const dependency of moduleSource.dependencies) {
      const placeholder = placeholders.get(dependency.id);
      const replacement = dependency.quote + placeholder + dependency.quote;
      code = code.split(dependency.token).join(replacement);
    }

    return {
      id: moduleSource.id,
      code,
    };
  });

  assertNoRelativeJsSpecifiers(prepared);

  return {
    moduleSources: prepared,
    placeholderPairs: moduleSources.map((moduleSource) => [
      placeholders.get(moduleSource.id),
      moduleSource.id,
    ]),
  };
}

function extractScannerModuleScript(html) {
  const matches = [...html.matchAll(/<script\b[^>]*>\s*<\/script>/gi)].filter((match) => {
    const tag = match[0];
    return /\btype\s*=\s*(["'])module\1/i.test(tag) &&
      /\bsrc\s*=\s*(["'])scanner\.js\1/i.test(tag);
  });

  if (matches.length !== 1) {
    throw new Error(
      'scanner.js를 가리키는 module script가 정확히 1개여야 하는데 ' +
      matches.length + '개 발견됨',
    );
  }

  return matches[0];
}

function buildLoaderScript(moduleSources, placeholderPairs) {
  const modulesLiteral = moduleSources
    .map((moduleSource) => '  [' + JSON.stringify(moduleSource.id) + ', ' +
      JSON.stringify(moduleSource.code) + ']')
    .join(',\n');
  const placeholdersLiteral = placeholderPairs
    .map((pair) => '  [' + JSON.stringify(pair[0]) + ', ' + JSON.stringify(pair[1]) + ']')
    .join(',\n');

  return [
    '',
    '// TLcube scanner single-file loader. Generated by tools/build-scanner.mjs.',
    'const MODULES = [',
    modulesLiteral,
    '];',
    'const PLACEHOLDERS = [',
    placeholdersLiteral,
    '];',
    'const ENTRY_MODULE_ID = ' + JSON.stringify(ENTRY_MODULE_ID) + ';',
    '',
    'const urls = Object.create(null);',
    'for (const [moduleId, moduleCode] of MODULES) {',
    '  let rewritten = moduleCode;',
    '  for (const [placeholder, dependencyId] of PLACEHOLDERS) {',
    '    if (urls[dependencyId] === undefined) continue;',
    '    rewritten = rewritten.split(placeholder).join(urls[dependencyId]);',
    '  }',
    '  const blob = new Blob([rewritten], { type: "text/javascript" });',
    '  urls[moduleId] = URL.createObjectURL(blob);',
    '}',
    'await import(urls[ENTRY_MODULE_ID]);',
    '',
  ].join('\n');
}

/**
 * index.html과 scanner.js 도달 그래프를 읽어 단일 HTML 문자열을 만든다.
 *
 * options.moduleSources는 회귀 테스트에서 위상 순서를 일부러 훼손할 때만 쓴다.
 * 일반 호출은 항상 현재 소스 그래프를 자동 수집한다.
 */
export function buildScannerHtml(options = {}) {
  const indexHtml = readFileSync(INDEX_HTML, 'utf8');
  const scriptMatch = extractScannerModuleScript(indexHtml);
  const moduleSources = options.moduleSources === undefined
    ? collectScannerModuleSources()
    : options.moduleSources;

  if (!Array.isArray(moduleSources)) {
    throw new TypeError('options.moduleSources는 모듈 배열이어야 함');
  }

  assertTopologicalOrder(moduleSources);

  const prepared = prepareModuleSources(moduleSources);
  const loaderBody = buildLoaderScript(prepared.moduleSources, prepared.placeholderPairs);
  const loaderScriptTag = '<script type="module">' + loaderBody + '</script>';
  const scriptStart = indexHtml.indexOf(scriptMatch[0]);

  return indexHtml.slice(0, scriptStart) + loaderScriptTag +
    indexHtml.slice(scriptStart + scriptMatch[0].length);
}

function main() {
  const out = buildScannerHtml();
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, out, 'utf8');
  process.stdout.write('dist/tlscan.html 생성됨 (' + Buffer.byteLength(out, 'utf8') + ' B)\n');
}

const isMain = typeof process !== 'undefined' && process.argv && process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
