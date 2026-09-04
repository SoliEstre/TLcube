/**
 * r2-cleanroom.test.js — **클린룸 경계의 자.**
 *
 * 🔴 왜 있나 (2026-09-04, P2 설계 반증에서): 이 저장소의 클린룸 규약 —
 * 「`src/r2/**` 는 `src/decoder/**` 를 import 하지 않는다. 다리는
 * `src/r2/adapter-locator.js` 하나」 — 을 **지키는 자가 0건**이었다.
 * 규칙이 사는 곳은 `adapter-locator.js` 머리의 주석 한 문단뿐이었고,
 * `package.json` 에 `exports` 맵도 없어 아무것도 강제하지 않았다.
 *
 * 그래서 이런 일이 초록으로 착지한다: 어느 레인이 `src/r2/session.js` 에
 * `import { … } from '../decoder/bootstrap.js'` 한 줄을 적는다. 전 스위트가 통과한다.
 * 그런데 **`bootstrap.js` 는 82파일 폐포**라, R2 의 의존이 30파일에서 89파일로 뛰고
 * 거기에 **R2 가 대체하려고 존재하는 R1 하드결정 복호기(`src/decode.js`)와
 * 인코더(`src/encodeY.js`)** 가 들어온다 (통합자 실측 2026-09-04).
 *
 * 클린룸의 존재 이유는 export 개수가 아니라 **C++ 이식 범위 봉쇄**다
 * (PM/029B §0:10 · §6). 그래서 이 파일은 두 축을 다 잰다:
 *   ① **누가** decoder 를 보는가 (다리는 한 파일)
 *   ② 그 다리가 **무엇을** 끌어오는가 (허용목록 + 폐포 크기 상한)
 *
 * ⚠ 허용목록을 **여기** 두는 것이 요점이다. 늘리려면 이 자가 빨개져 사람이 본다.
 * 늘리는 것 자체는 금지가 아니다 — **조용히** 늘리는 것이 금지다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BACKSLASH = String.fromCharCode(92);
const posix = (p) => p.split(BACKSLASH).join('/');
const rel = (p) => posix(relative(ROOT, p));

// 다리가 오늘 끌어오는 decoder 모듈. **손 목록이 아니라 계약이다.**
const BRIDGE = 'adapter-locator.js';
const BRIDGE_ALLOWED = Object.freeze([
  '../decoder/cellsurface-block-detect.js',
  '../decoder/homography.js',
]);

function decoderImportsOf(file) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from\s+['"](\.\.\/decoder\/[^'"]+)['"]/g)].map((m) => m[1]).sort();
}

function closureOf(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      let target = resolve(dirname(file), m[1]);
      if (!target.endsWith('.js')) target += '.js';
      queue.push(posix(target));
    }
  }
  return seen;
}

const R2_DIR = resolve(ROOT, 'src/r2');
const R2_FILES = readdirSync(R2_DIR).filter((f) => f.endsWith('.js'));

test('클린룸 ① — `src/r2/**` 에서 decoder 를 보는 파일은 다리 하나뿐이다', () => {
  // 공허 방지: 훑기가 무너지면 「위반이 없다」가 아니라 「잴 게 없다」가 된다.
  assert.ok(R2_FILES.length >= 8,
    `src/r2 에 파일이 ${R2_FILES.length}개뿐이다 — 훑기가 무너졌다`);

  const violations = [];
  for (const name of R2_FILES) {
    const imports = decoderImportsOf(resolve(R2_DIR, name));
    if (name === BRIDGE) continue;
    if (imports.length > 0) violations.push(`${name}: ${imports.join(' ')}`);
  }
  assert.deepEqual(violations, [],
    `클린룸이 뚫렸다:\n      ${violations.join('\n      ')}\n`
    + `    다리는 src/r2/${BRIDGE} 하나다. 다른 파일이 decoder 를 봐야 한다면 `
    + '그것은 설계 변경이지 import 한 줄이 아니다 (PM/029B §13.6).');
});

test('클린룸 ② — 다리가 끌어오는 decoder 모듈은 허용목록과 정확히 같다', () => {
  const imports = decoderImportsOf(resolve(R2_DIR, BRIDGE));
  assert.ok(imports.length > 0, `${BRIDGE} 가 decoder 를 하나도 안 본다 — 정규식이 죽었다`);
  assert.deepEqual(imports, [...BRIDGE_ALLOWED].sort(),
    '다리의 decoder import 가 허용목록과 다르다.\n'
    + `    지금: ${imports.join(' ')}\n`
    + `    허용: ${BRIDGE_ALLOWED.join(' ')}\n`
    + '    → 늘리는 것 자체는 금지가 아니다. **조용히** 늘리는 것이 금지다.\n'
    + '      늘릴 거면 아래 ③ 의 폐포 상한을 같이 재고, 무엇이 딸려 오는지 PM 에 적어라.\n'
    + '      특히 `bootstrap.js` 는 82파일 폐포라 R2 의존이 30 → 89 로 뛰고\n'
    + '      src/decode.js(R1 복호기)와 src/encodeY.js(인코더)가 들어온다.');
});

test('클린룸 ③ — R2 의 의존 폐포에 R1 복호기·인코더가 없다', () => {
  const closure = closureOf([
    posix(resolve(R2_DIR, 'session.js')),
    posix(resolve(R2_DIR, BRIDGE)),
  ]);
  const names = new Set([...closure].map(rel));

  // 공허 방지: 폐포가 안 걸어지면 「없다」가 공짜로 참이 된다.
  assert.ok(closure.size >= 20,
    `폐포가 ${closure.size}파일뿐이다 — import 추적이 죽었다`);

  // 🔴 이식 범위를 정하는 축. 이름을 붙여 둔다 — 「무엇이 들어오면 안 되나」.
  const FORBIDDEN = Object.freeze([
    'src/decode.js',          // R1 하드결정 복호 — R2 가 대체하려고 존재하는 것
    'src/encodeY.js',         // 인코더. 스캐너 폐포에 있을 이유가 없다
    'src/decoder/bootstrap.js', // 82파일 폐포의 입구
    'src/decoder/decode-k.js',
    'src/decoder/decode-c.js',
  ]);
  const leaked = FORBIDDEN.filter((f) => names.has(f));
  assert.deepEqual(leaked, [],
    `R2 폐포에 들어오면 안 되는 모듈이 있다: ${leaked.join(' ')}\n`
    + `    폐포 크기 ${closure.size}파일. 클린룸의 존재 이유는 export 개수가 아니라\n`
    + '    **C++ 이식 범위 봉쇄**다 (PM/029B §0:10 · §6).');
});
