// bundle.test.js — tools/build-single.mjs 로 생성한 dist/trilume.html 검증 (SPEC §8)
//
// 실행: node --test test/bundle.test.js (cwd: repo 루트, 이 파일만 실행 — 전체 스위트 아님)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSingleHtml } from '../tools/build-single.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_FILE = path.join(ROOT, 'dist', 'trilume.html');
const SRC_DIR = path.join(ROOT, 'src');

// tools/build-single.mjs 의 MODULE_ORDER 의 **부분집합 검사** (전체 동기 아님 — help-popover·cell-editor 계열 등 미등재, 통합 렌즈 D 실측. 여기 있는 이름의 존재만 강제) — Type A(ADR 0005) 4개
// 추가: placementA·layoutA·capacityA·encodeA ('capacity' 뒤, 위상 순서).
const MODULE_ORDER = [
  'vendor/jcodd', 'payloadform',
  'hexgrid', 'locatorY', 'finder-patterns', 'finder-selection', 'finder-card-ui', 'generator-render-config', 'render-status', 'lehmer', 'gfp', 'rs211', 'base211', 'mask', 'formatinfo',
  'header', 'placement', 'bullseye', 'layout', 'capacity',
  'placementA', 'layoutA', 'capacityA', 'encodeA',
  'luminance',
  'gf256', 'rs', 'qr', 'generator-state', 'export-filename',
  'encode', 'scene', 'raster', 'verify', 'svg', 'png',
  'ygrid', 'placementY', 'autoplaceY', 'type-y-cell-editor', 'layoutY', 'capacityY', 'cellSurfaceY', 'tonemap',
  'encodeY', 'centralBeacon', 'sceneY', 'verifyY',
  'quietzone', 'i18n', 'beacon',
];

test('동기화: buildSingleHtml() 결과가 dist/trilume.html 과 바이트 동일하다', () => {
  const built = buildSingleHtml();
  const onDisk = readFileSync(DIST_FILE, 'utf8');
  assert.equal(built, onDisk,
    'dist/trilume.html 이 최신이 아니에요 — src 또는 index.html 변경 후 node tools/build-single.mjs 재실행 필요');
});

test('구조: 전 모듈 이름이 정확히 1회씩 등장한다', () => {
  const out = buildSingleHtml();
  for (const name of MODULE_ORDER) {
    const needle = `[${JSON.stringify(name)},`;
    const count = out.split(needle).length - 1;
    assert.equal(count, 1, `모듈 "${name}" 이 MODULES 배열에 정확히 1회 등장해야 함 (실제 ${count}회)`);
  }
});

test('구조: 각 src 파일 원문이 JSON.stringify 된 문자열로 출력에 포함된다', () => {
  const out = buildSingleHtml();
  for (const name of MODULE_ORDER) {
    const filePath = path.join(SRC_DIR, `${name}.js`);
    const source = readFileSync(filePath, 'utf8');
    const embedded = JSON.stringify(source);
    assert.ok(out.includes(embedded), `"${name}.js" 원문이 JSON.stringify 형태로 임베드되어야 함`);
  }
});

test('구조: app 코드에 \'./src/\' specifier 가 남아있지 않다', () => {
  const out = buildSingleHtml();
  assert.ok(!out.includes("'./src/"), "'./src/' specifier 가 재작성되지 않고 남아있음");
});

test('구조: <script type="module"> 블록이 정확히 1개다', () => {
  const out = buildSingleHtml();
  const re = /<script type="module">/g;
  const count = (out.match(re) || []).length;
  assert.equal(count, 1, `<script type="module"> 블록이 정확히 1개여야 하는데 ${count}개 발견됨`);
});

test('결정성: buildSingleHtml() 을 2회 호출해도 동일한 문자열이 나온다', () => {
  const a = buildSingleHtml();
  const b = buildSingleHtml();
  assert.equal(a, b);
});
