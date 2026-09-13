/**
 * HTML 안의 인라인 module 및 번들 APP_CODE를 실행하지 않고 각각 독립 파싱한다.
 * SourceTextModule 생성은 parse까지만 수행한다. link/evaluate/import는 의도적으로 없다.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', '.playwright-mcp', 'test']);
const MODULE_SCRIPT = /<script type="module">([\s\S]*?)<\/script>/g;
const APP_CODE = /const APP_CODE = ("(?:\\.|[^"\\])*");/;

export function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        found.push(...htmlFiles(path.join(dir, entry.name)));
      }
    } else if (entry.name.endsWith('.html')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

export function collectModuleSources(root = ROOT) {
  const sources = [];
  for (const file of htmlFiles(root)) {
    const html = readFileSync(file, 'utf8');
    const rel = path.relative(root, file).split(path.sep).join('/');
    MODULE_SCRIPT.lastIndex = 0;
    let match;
    let index = 0;
    while ((match = MODULE_SCRIPT.exec(html)) !== null) {
      sources.push({ label: `${rel} 인라인 module ${index}`, source: match[1] });
      index += 1;
    }
    APP_CODE.lastIndex = 0;
    const app = APP_CODE.exec(html);
    if (app !== null) sources.push({ label: `${rel} APP_CODE`, source: JSON.parse(app[1]), appCode: true });
  }
  return sources;
}

export function parseOnly(sources) {
  let appBodies = 0;
  for (const { label, source, appCode } of sources) {
    try {
      // 생성만 한다. evaluate()나 link()가 없으므로 body와 import는 절대 실행되지 않는다.
      new SourceTextModule(source, { identifier: label });
    } catch (error) {
      const detail = new SyntaxError(`${label} 이 파싱되지 않는다: ${error.message}`);
      detail.cause = error;
      throw detail;
    }
    if (appCode) appBodies += 1;
  }
  return { checked: sources.length, appBodies };
}

function selfCheck() {
  assert.throws(() => parseOnly([{ label: 'malformed source', source: 'const = 1;' }]), SyntaxError);
  assert.throws(() => parseOnly([{ label: 'malformed APP_CODE', source: 'export {' }]), SyntaxError);
  delete globalThis.__tlcubeSyntaxCheckExecuted;
  parseOnly([{ label: 'must not execute', source: 'globalThis.__tlcubeSyntaxCheckExecuted = true;' }]);
  assert.equal(globalThis.__tlcubeSyntaxCheckExecuted, undefined, 'parse가 module body를 실행했다');
}

function main() {
  selfCheck();
  const result = parseOnly(collectModuleSources(ROOT));
  assert.ok(result.checked >= 5, `module source가 ${result.checked}개뿐이다 — 추출 규칙을 확인하라`);
  assert.ok(result.appBodies >= 2, `APP_CODE가 ${result.appBodies}개뿐이다 — 번들이 검사에서 빠졌다`);
  process.stdout.write(`module syntax OK: ${result.checked} sources, ${result.appBodies} APP_CODE\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
