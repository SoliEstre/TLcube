import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildGeneratorLabHtml, buildGeneratorVariants, LAB_GENERATOR_PATH,
} from '../tools/build-gen-variants.mjs';
import {
  buildScannerLabHtml, LAB_SCANNER_PATH,
} from '../tools/build-scan-variants.mjs';
import {
  buildLabVariants, LAB_OUTPUTS,
} from '../tools/build-lab.mjs';

test('lab 빌드는 기존 생성기 실험 변형과 현재 스캐너 빌더를 그대로 재사용한다', () => {
  const built = buildLabVariants();

  assert.equal(built.generator, buildGeneratorLabHtml());
  assert.equal(built.generator, buildGeneratorVariants().lab);
  assert.equal(built.scanner, buildScannerLabHtml());
  assert.match(built.generator, /<!doctype html>/i);
  assert.match(built.scanner, /<!doctype html>/i);
});

test('lab 빌드는 같은 입력에서 두 번 모두 바이트가 같다', () => {
  const first = buildLabVariants();
  const second = buildLabVariants();

  assert.equal(first.generator, second.generator);
  assert.equal(first.scanner, second.scanner);
});

test('lab 타깃은 dist가 아니라 _shared의 전용 파일 두 개만 대상으로 선언한다', () => {
  assert.equal(LAB_OUTPUTS.generator, LAB_GENERATOR_PATH);
  assert.equal(LAB_OUTPUTS.scanner, LAB_SCANNER_PATH);
  assert.equal(path.basename(LAB_OUTPUTS.generator), 'lab-gen.html');
  assert.equal(path.basename(LAB_OUTPUTS.scanner), 'lab-scan.html');

  for (const output of Object.values(LAB_OUTPUTS)) {
    const normalized = output.split(path.sep).join('/');
    assert.match(normalized, /\/sites\/_shared\/lab-[^/]+\.html$/);
    assert.doesNotMatch(normalized, /\/dist\//);
  }
});

// ⚠ 계약 §1 과 서비스 워커 주석이 「시험판은 워커를 등록하지 않는다」고 말한다.
// 실제로 첫 통합에서 시험판 산출물이 워커를 등록하고 있었다 — 루트 워커가 `/lab/` 요청을
// 안 가로채니 캐시 사고는 없지만, 배너가 시험 중에 떠서 시험판을 새로고침시키고
// 무엇보다 **적어 둔 주장이 거짓**이 된다. 주장을 테스트로 고정한다.
test('시험판 산출물은 서비스 워커를 등록하지 않는다', () => {
  for (const name of ['lab-gen.html', 'lab-scan.html']) {
    const html = readFileSync(new URL(`../sites/_shared/${name}`, import.meta.url), 'utf8');
    // 등록 호출이 코드에 남아 있어도 되지만(공용 모듈이라), `/lab/` 가드가 반드시 함께 있어야 한다.
    if (/serviceWorker\.register/.test(html)) {
      assert.match(html, /pathname === '\/lab' \|\| location\.pathname\.startsWith\('\/lab\/'\)/,
        `${name}: 워커 등록이 있는데 /lab/ 가드가 없다`);
    }
  }
});
