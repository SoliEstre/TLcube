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
const Y_BRIDGE_ALLOWED = Object.freeze([
  '../decoder/cellsurface-block-detect.js',
  '../decoder/homography.js',
  /*
   * 🔴 +1 (2026-09-06, 레인 R · 변경 R6) — **왜 늘렸나.**
   * R2 는 ecc 'H' · mask 0 을 못박고 있었다. 인코더의 `auto` 는 용량이 되면 H, 길면 M/L 을
   * 쓰므로 **ecc M/L 로 찍힌 코드는 R2 가 구조적으로 DONE 을 낼 수 없었다** — RS 패리티
   * 수(nsym)가 틀리면 본문 RS 가 절대 서지 않는다. 카메라 앞에서 ecc×mask 9조합을 스윕할
   * 수는 없으므로 코드가 스스로 말하는 포맷 워드를 읽는다.
   *
   * 딸려 오는 것(실측, 아래 ③ 이 값으로 잰다): 폐포 **30 → 61 파일**. 금지 5종은 하나도
   * 들어오지 않는다 — `locator-format.js` 는 `format-read.js` · `cellSurfaceY-detect.js` ·
   * `cube-detect.js` 계열을 끌어오고 `bootstrap.js`(82파일 입구) · `decode.js` · `encodeY.js`
   * 는 그 폐포에 없다. 그래도 두 배는 두 배다 — 그래서 이 커밋에서 ③ 에 **상한**을 신설했다.
   */
  '../decoder/locator-format.js',
]);

// C 관측 전용 두 번째 다리. Y 목록/소스/호출은 바꾸지 않아요.
// 80→88 합집합 delta: adapter-c 자체 + centralN7Codec + n7 관측/공유 모듈
// + v3 커서 + anchor-detect + luma + luminance. grid-sample/format-read는 기존 폐포예요.
// 2026-09-08 격리 실측 88→101(+13):
//   r2: bound-candidate-session, c-candidate-runtime, type-expansion-runtime, router, cursor-budget (+5)
//   decoder: c-body-track, c-photometric-track (+2; 현재 영상 기하 재관측)
//   decoder: cq-observe, qr-finder-observe, qr-center-geometry (+3; R1 순수 함수 공유)
//   decoder: c-daehan-observe, cell-finder-detect (+2; 실제 대한 파인더 관측)
//   decoder: cq-structural-refine (+1; caller opt-in, 전체 셀 구조 점수 cursor)
// 2026-09-09 격리 실측 101→102(+1): r2/y-layout만 추가예요.
// 기존 r2-scan-runtime의 buildLayout을 순수 추출해 공용 조립식으로 사용해요.
// d3160ec 원함수와 registry102 반환/구형미지원10 예외가 정확히 같고,
// 새 decoder 직접 import 및 금지 모듈 유입은 0개예요.
// cellsurface-block-detect 직접 사용은 기존 합집합에 있어 delta 0이에요.
// 기본 Y 소스/직접 다리3개, legacy 상한66은 보존하고 두 다리 밖 decoder import는 금지해요.
const C_BRIDGE = 'adapter-c.js';
const C_BRIDGE_ALLOWED = Object.freeze([
  '../decoder/anchor-detect.js',
  '../decoder/c-body-track.js',
  '../decoder/c-daehan-observe.js',
  '../decoder/cellsurface-block-detect.js',
  '../decoder/central-beacon-observation-shared.js',
  '../decoder/central-n7-observe.js',
  '../decoder/cq-observe.js',
  '../decoder/cq-structural-refine.js',
  '../decoder/cs-verified-cursor-v3-prototype.js',
  '../decoder/format-read.js',
  '../decoder/grid-sample.js',
]);
const BRIDGE_ALLOWED = Object.freeze([...new Set([...Y_BRIDGE_ALLOWED, ...C_BRIDGE_ALLOWED])]);

/*
 * 폐포 «상한». 여태 ③ 은 하한(20)만 재서 「공허 방지」였고, 다리를 늘려 폐포가 두 배가
 * 돼도 아무 자도 안 빨개졌다. 이식 범위 봉쇄가 목적이라면 **위쪽**이 본론이다.
 * 값은 실측(2026-09-06 이 워크트리에서 61) + 여유 5 = 66.
 * ⚠ 이 수는 «세는 숫자» 다 — 다리를 늘리거나 decoder 쪽 리팩터가 import 를 늘리면 움직인다.
 * 움직였을 때 할 일은 이 수를 올리는 것이 아니라 **무엇이 들어왔는지 적는 것**이다.
 */
const LEGACY_CLOSURE_CEILING = 66;
// 2026-09-07: 재귀 탐색으로 모든 R2 모듈을 진입점으로 삼는다.
// 기존 전체 범위 76 → 80: mask.js + candidate-key.js + decode-rs-blocks.js + profiles/c.js.
// 옛 session+adapter 범위는 61 그대로이며 상한 66도 유지한다. 전체 범위는 여유 없이 80.
// 기존 범위 밖 15파일이 재귀 감사로 드러난 것이지 새 decoder 의존 15개가 아니다.
// 전체 여유 0은 의도다: 새 프로필 파일 1개도 폐포 증가를 검토하는 계기로 삼는다.
// 다음 프로필 레인은 파일 추가 때 전체 폐포를 재측정하고, 증가 목록·사유와 상한 갱신을
// 같은 커밋에 담아야 한다. 기존 다리의 여유 5를 전체 프로필 범위에 자동 승계하지 않는다.
const FULL_CLOSURE_CEILING = 102;

/**
 * ⚠ **주석을 먼저 벗긴다** (2026-09-06 검토 R3c).
 *
 * 옛 정규식은 raw 텍스트에 걸려 **주석 속 경로**를 import 로 셌다. 돌연변이로 확인한 값:
 * `adapter-locator.js` 끝에 `// probe: from '../decoder/bootstrap.js'` 한 줄을 붙이면
 * ② 「지금: …bootstrap.js…」와 ③ 「폐포 91 (상한 66)」이 **둘 다** 빨개진다 — 코드는 그대로인데.
 * 이 파일들은 설명 주석이 많고 그 안에 «금지 목록» 을 **경로로** 적는 것이 규약이라
 * (BRIDGE_ALLOWED 주석의 `bootstrap.js` 문단) 오탐이 구조적이다.
 *
 * 벗기는 방법은 문자열 리터럴 안의 `/*` 까지 가르지 못하는 **근사**다. 그래서 아래 「자의 자」가
 * 이 근사가 실제로 어느 쪽으로 틀리는지를 값으로 못박는다 — 주석 한 줄은 초록이어야 하고,
 * 진짜 import 한 줄은 빨개져야 한다.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function decoderImportsIn(source, file = resolve(ROOT, 'src/r2/probe.js')) {
  const decoderDir = posix(resolve(ROOT, 'src/decoder'));
  return [...stripComments(source).matchAll(/from\s+['"](\.[^'"]+)['"]/g)]
    .map((m) => m[1])
    .filter((specifier) => {
      const target = posix(resolve(dirname(file), specifier));
      return target === decoderDir || target.startsWith(`${decoderDir}/`);
    }).sort();
}

function decoderImportsOf(file) {
  return decoderImportsIn(readFileSync(file, 'utf8'), file);
}

function closureOf(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      let target = resolve(dirname(file), m[1]);
      if (!target.endsWith('.js')) target += '.js';
      queue.push(posix(target));
    }
  }
  return seen;
}

const R2_DIR = resolve(ROOT, 'src/r2');
// 프로필 종류의 손 목록을 만들지 않는다. 새 하위 폴더도 같은 경계를 통과한다.
function jsFilesBelow(root, readDirectory = readdirSync) {
  const files = [], pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readDirectory(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(file);
    }
  }
  return files.sort();
}
const R2_FILES = jsFilesBelow(R2_DIR).map((file) => posix(relative(R2_DIR, file)));

test('클린룸 ① — `src/r2/**` 에서 decoder 를 보는 파일은 승인된 Y/C 다리뿐이다', () => {
  // 공허 방지: 훑기가 무너지면 「위반이 없다」가 아니라 「잴 게 없다」가 된다.
  assert.ok(R2_FILES.length >= 8,
    `src/r2 에 파일이 ${R2_FILES.length}개뿐이다 — 훑기가 무너졌다`);

  const violations = [];
  for (const name of R2_FILES) {
    const imports = decoderImportsOf(resolve(R2_DIR, name));
    if (name === BRIDGE || name === C_BRIDGE) continue;
    if (imports.length > 0) violations.push(`${name}: ${imports.join(' ')}`);
  }
  assert.deepEqual(violations, [],
    `클린룸이 뚫렸다:\n      ${violations.join('\n      ')}\n`
    + `    다리는 src/r2/${BRIDGE}와 ${C_BRIDGE}뿐이다. 다른 파일이 decoder 를 봐야 한다면 `
    + '그것은 설계 변경이지 import 한 줄이 아니다 (PM/029B §13.6).');
});

test('클린룸 ② — 다리가 끌어오는 decoder 모듈은 허용목록과 정확히 같다', () => {
  const yImports = decoderImportsOf(resolve(R2_DIR, BRIDGE));
  const cImports = decoderImportsOf(resolve(R2_DIR, C_BRIDGE));
  assert.deepEqual(yImports, [...Y_BRIDGE_ALLOWED].sort(), '기존 Y 다리는 바뀌지 않아요');
  assert.deepEqual(cImports, [...C_BRIDGE_ALLOWED].sort(), 'C 실제 import만 정확하게 승인해요');
  const imports = [...new Set([...yImports, ...cImports])].sort();
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
  const legacy = closureOf(['session.js', BRIDGE].map((file) => posix(resolve(R2_DIR, file))));
  assert.ok(legacy.size <= LEGACY_CLOSURE_CEILING,
    `기존 session+adapter 폐포 ${legacy.size} (상한 ${LEGACY_CLOSURE_CEILING})`);
  const closure = closureOf(R2_FILES.map((file) => posix(resolve(R2_DIR, file))));
  const names = new Set([...closure].map(rel));

  // 공허 방지: 폐포가 안 걸어지면 「없다」가 공짜로 참이 된다.
  assert.ok(closure.size >= 20,
    `폐포가 ${closure.size}파일뿐이다 — import 추적이 죽었다`);

  // 🔴 상한 (2026-09-06 신설). 하한만 있으면 다리를 늘려 폐포가 두 배가 돼도 초록이다.
  assert.ok(closure.size <= FULL_CLOSURE_CEILING,
    `전체 R2 폐포가 ${closure.size}파일이다 (상한 ${FULL_CLOSURE_CEILING}).\n`
    + '    클린룸의 존재 이유는 **C++ 이식 범위 봉쇄**다 — 금지목록에 없어도 폐포가\n'
    + '    커지는 것 자체가 그 목표를 갉는다. 무엇이 새로 들어왔는지 먼저 세고,\n'
    + '    그 이유를 위 BRIDGE_ALLOWED 주석에 적은 뒤에 이 수를 옮겨라.');

  // 🔴 이식 범위를 정하는 축. 이름을 붙여 둔다 — 「무엇이 들어오면 안 되나」.
  const FORBIDDEN = Object.freeze([
    'src/decode.js',          // R1 하드결정 복호 — R2 가 대체하려고 존재하는 것
    'src/encode.js',         // 타입 공통 인코더도 순수 프로필 표의 의존이 아니다
    'src/encodeY.js',         // 인코더. 스캐너 폐포에 있을 이유가 없다
    'src/decoder/bootstrap.js', // 82파일 폐포의 입구
    'src/decoder/decode-k.js',
    'src/decoder/decode-c.js',
    'src/decoder/central-beacon-adapt.js', // n7는 순수 관측 모듈만 다리로 열어요
  ]);
  const leaked = FORBIDDEN.filter((f) => names.has(f));
  assert.deepEqual(leaked, [],
    `R2 폐포에 들어오면 안 되는 모듈이 있다: ${leaked.join(' ')}\n`
    + `    폐포 크기 ${closure.size}파일. 클린룸의 존재 이유는 export 개수가 아니라\n`
    + '    **C++ 이식 범위 봉쇄**다 (PM/029B §0:10 · §6).');
});

/*
 * ⚠ **자의 자** (2026-09-06 검토 R3c). 위 두 훑기는 정규식이고, 정규식은 「무엇을 안 세는가」를
 * 말해 주지 않는다. 그래서 **합성 소스**로 진리표를 박아 둔다 — 이 파일이 지키는 성질은
 * 「import 를 센다」이지 「'../decoder/' 라는 글자를 센다」가 아니다.
 */
test('클린룸 ⓐ — 훑기가 주석 속 경로를 import 로 세지 않는다 (자의 자)', () => {
  const real = "import { a } from '../decoder/homography.js';";
  assert.deepEqual(decoderImportsIn(real), ['../decoder/homography.js'],
    '진짜 import 를 못 센다 — 정규식이 죽었으면 위 ①②가 공허하게 초록이다');

  // 줄 주석 · 블록 주석 · 여러 줄 블록 주석 안의 같은 문장은 **세면 안 된다**.
  const lineComment = "// probe: from '../decoder/bootstrap.js'";
  const blockComment = "/* 금지: from '../decoder/bootstrap.js' 는 82파일 폐포다 */";
  const multiline = ['/*', " * 늘리려면: from '../decoder/decode-c.js'", ' */'].join('\n');
  for (const [name, source] of [['줄 주석', lineComment], ['블록 주석', blockComment], ['여러 줄', multiline]]) {
    assert.deepEqual(decoderImportsIn(source), [],
      name + ' 속 경로를 import 로 센다 — 문서 성격 주석이 많은 이 파일들에서 구조적 오탐이다');
  }

  // 그리고 주석이 **진짜 import 를 가리지도** 않는다 (벗기기가 너무 세면 반대 방향 결함이다).
  assert.deepEqual(decoderImportsIn(blockComment + '\n' + real), ['../decoder/homography.js'],
    '주석을 벗기면서 그 뒤의 진짜 import 까지 지운다');
});

test('클린룸 ⓑ — 새 프로필과 더 깊은 폴더를 손 목록 없이 발견한다', () => {
  const root = resolve(ROOT, 'virtual-r2');
  const file = (name) => ({ name, isDirectory: () => false, isFile: () => true });
  const directory = (name) => ({ name, isDirectory: () => true, isFile: () => false });
  const tree = new Map([
    [root, [file('session.js'), directory('profiles')]],
    [resolve(root, 'profiles'), [file('future.js'), file('README.md'), directory('nested')]],
    [resolve(root, 'profiles/nested'), [file('other.js')]],
  ]);
  const found = jsFilesBelow(root, (path) => {
    assert.ok(tree.has(path), `가상 파일 목록의 경로가 아니다: ${path}`);
    return tree.get(path);
  }).map((path) => posix(relative(root, path))).sort();
  assert.deepEqual(found, ['profiles/future.js', 'profiles/nested/other.js', 'session.js']);
});

test('클린룸 ⓒ — 중첩 프로필의 상위 경로를 실제 decoder 디렉터리로 해석한다', () => {
  const file = resolve(R2_DIR, 'profiles/future.js');
  const bad = "import { x } from '../../decoder/bootstrap.js';";
  assert.deepEqual(decoderImportsIn(bad, file), ['../../decoder/bootstrap.js']);
  assert.deepEqual(decoderImportsIn(`// ${bad}`, file), []);
  assert.deepEqual(decoderImportsIn("import { x } from '../../capacityC.js';", file), []);
  assert.deepEqual(decoderImportsIn("import { x } from '../../decoder-extra/helpers.js';", file), []);
  const deeper = resolve(R2_DIR, 'profiles/nested/other.js');
  assert.deepEqual(decoderImportsIn("export { x } from '../../../decoder/homography.js';", deeper),
    ['../../../decoder/homography.js']);
});
