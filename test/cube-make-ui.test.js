/**
 * «만들기용 파일 — 3D 인쇄 · 종이» 섹션(#cubeMakeSection)의 UI 계약이에요(설계 §4 · §6-19 · §6-20).
 *
 * 하네스(test/helpers/cube-make-harness.mjs)는 index.html 의 실제 마크업을 파싱해 가짜 DOM 을 만들고,
 * «cubeMake VM 슬라이스» 표시 사이의 핸들러를 그대로 잘라 실제 src 모듈과 함께 VM 에서 돌려요.
 * 그래서 이 파일은 «화면이 부르는 경로» 로 나온 바이트·파일명·상태를 재요. 값·배치가 아니라 성질을 재고,
 * 파일 끝의 «자 검증» 은 핸들러에 결함을 심은 변이 원문으로 같은 자가 빨개지는지 확인해요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

import {physicalHCube} from '../src/cube-physical.js';
import {generatorCubeModel} from '../src/generator-cube-export.js';
import {hDisplayMap, H_ARRANGEMENTS} from '../src/h-face-arrangement.js';
import {PAPER_SIZES, paperMethodOptions, paperPlan, paperPngPlan, printScaleTag} from '../src/paper-net.js';
import {buildPrintParts, hollowPlan, printBedPlacement, standCornerFaces} from '../src/print-mesh.js';
import {hExportIconMarkup} from '../src/h-preview-decor.js';
import {MODULE_ORDER} from '../tools/build-single.mjs';
import {check3mfZip, parseBinaryStl, readZip, signedVolume} from './helpers/mesh-export-verify.mjs';
import {inspectPdf, structureFailures} from './helpers/pdf-structure.mjs';
import {surfaceComponents} from './helpers/print-mesh-probe.mjs';
import {fullOnly} from './helpers/scope.mjs';
import {
  INDEX, SLICE_START, SLICE_END, codeKeyTable, createCubeMakeHarness, cubeMakeMarkup, cubeMakeSlice,
  hCurrent, memoryStorage, missingCodeKeys, missingMarkupIds, parseMarkup, referencedKeys, throwingStorage,
} from './helpers/cube-make-harness.mjs';
import * as cubePhysicalModule from '../src/cube-physical.js';
import * as paperNetModule from '../src/paper-net.js';
import * as pdfWriterModule from '../src/pdf-writer.js';
import * as printMeshModule from '../src/print-mesh.js';
import * as meshExportModule from '../src/mesh-export.js';

const LANGS = ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt'];
const HANGUL = /[가-힣]/;
const SLICE = cubeMakeSlice();
const MARKUP = cubeMakeMarkup();
const PAPER_IDS = ['makePaperSvg', 'makePaperPng', 'makePaperPdf', 'makePaperPrint'];
const PRINT_IDS = ['makePrint3mf', 'makePrintStl', 'makePrintStand'];
const ALL_IDS = [...PAPER_IDS, ...PRINT_IDS];
const BUTTON_KEYS = {makePaperSvg: 'g1050', makePaperPng: 'g1052', makePaperPdf: 'g1054', makePaperPrint: 'g1056', makePrint3mf: 'g1058', makePrintStl: 'g1060', makePrintStand: 'g1062'};

/** 페이지와 같은 경로로 물리 큐브를 따로 만들어요(하네스의 계산과 독립인 기대값용). */
const physOf = (current, cellUm) => physicalHCube(generatorCubeModel(current, undefined), cellUm ? {cellUm} : {});
const fakePng = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
/** 3MF 안의 코어 오브젝트를 {positions, indices} 와 부피로 꺼내요. */
function coreOf(bytes) {
  const {issues, model} = check3mfZip(bytes);
  assert.deepEqual(issues, [], '3MF 가 유효하지 않아요');
  const core = model.objects.find((o) => /-core-ffffff$/.test(o.name ?? ''));
  assert.ok(core, '코어 파트가 없어요');
  const mesh = {positions: Float64Array.from(core.vertices.flat()), indices: Uint32Array.from(core.triangles.flat())};
  return {mesh, volume: signedVolume(core.triangles.map((t) => t.map((k) => core.vertices[k]))), model};
}
/** 버튼들이 모두 조건대로 막혔는지(문제 목록을 돌려줘요 — 자 검증이 같은 함수를 재사용해요). */
function busyProblems(h, busyIds, freeIds) {
  const out = [];
  for (const id of busyIds) if (!h.$(id).disabled) out.push(`${id} 가 busy 중에 열려 있어요`);
  for (const id of freeIds) if (h.$(id).disabled) out.push(`${id} 가 다른 묶음 busy 때문에 막혔어요`);
  return out;
}

// ── 자리 · 표시 조건 · 마크업 ────────────────────────────────────────────

test('형제 섹션 자리: 3D 데이터 뒤 · 회전 영상 앞, 기본 hidden, 슬라이스는 기존 두 VM 슬라이스 밖이에요', () => {
  const at = (needle) => { const i = INDEX.indexOf(needle); assert.ok(i >= 0, needle); return i; };
  assert.ok(at('<section id="cubeExportSection"') < at('<section id="cubeMakeSection"'));
  assert.ok(at('<section id="cubeMakeSection"') < at('<section id="cubeVideoSection"'));
  assert.match(MARKUP, /^<section id="cubeMakeSection" class="export-section" aria-labelledby="cubeMakeHeading" hidden>/);
  // 회전 영상(let cubeVideoJob → CUBE_EXPORT_IDS) · 3D 데이터(CUBE_EXPORT_IDS → flashCopied) 슬라이스에 새 코드가 섞이지 않아요.
  const video = INDEX.slice(at('let cubeVideoJob=null;'), at('const CUBE_EXPORT_IDS='));
  const exportSlice = INDEX.slice(at('const CUBE_EXPORT_IDS='), at('function flashCopied('));
  for (const slice of [video, exportSlice]) assert.doesNotMatch(slice, /cubeMake|CUBE_MAKE/);
  assert.ok(at(SLICE_START) > at('function flashCopied(') && at(SLICE_END) > at(SLICE_START));
  // 3D 데이터 섹션의 두 행 잠금(cube-export-spacing)은 형제 섹션이라 그대로예요.
  const exportSection = /<section id="cubeExportSection"[\s\S]*?<\/section>/.exec(INDEX)[0];
  assert.equal((exportSection.match(/class="row export-row"/g) || []).length, 2);
});

test('코드가 부르는 id 는 모두 마크업에 있어요(자 검증: id 하나를 지우면 그 id 가 잡혀요)', () => {
  assert.deepEqual(missingMarkupIds(MARKUP, SLICE), []);
  assert.deepEqual(missingMarkupIds(MARKUP.replace('id="makePrintStand"', ''), SLICE), ['makePrintStand']);
  assert.deepEqual(missingMarkupIds(MARKUP.replace('id="makeVentMm"', ''), SLICE), ['makeVentMm']);
});

test('아이콘 버튼엔 data-i18n 이 없고, 여덟 언어 모두에서 아이콘 + 번역 라벨이 유지돼요', async () => {
  const {byId} = parseMarkup(MARKUP);
  for (const id of ALL_IDS) assert.equal(byId.get(id).hasAttribute('data-i18n'), false, `${id} 에 data-i18n 이 있어요`);
  // 새 아이콘 다섯 종은 서로 다르고, 모르는 kind 의 대체 아이콘(큐브)으로 떨어지지 않아요.
  const kinds = [...new Set([...SLICE.matchAll(/:\['([a-z0-9]+)','g\d+','g\d+'\]/gi)].map((m) => m[1]))];
  assert.deepEqual(kinds.sort(), ['paper', 'pdf', 'print3d', 'printer', 'stand']);
  const fallback = hExportIconMarkup('unknown-kind');
  assert.equal(new Set(kinds.map((k) => hExportIconMarkup(k))).size, kinds.length);
  for (const kind of kinds) assert.notEqual(hExportIconMarkup(kind), fallback, kind);
  const h = createCubeMakeHarness();
  await h.expand();
  for (const lang of LANGS) {
    h.c.genI18n.lang = lang;
    h.sync();
    for (const id of ALL_IDS) {
      const button = h.$(id), label = h.dict[lang][BUTTON_KEYS[id]];
      assert.match(button.innerHTML, /^<svg[\s\S]*<\/svg><span>/, `${lang}/${id}: 아이콘이 사라졌어요`);
      assert.ok(button.innerHTML.endsWith(`<span>${label}</span>`), `${lang}/${id}: 라벨`);
      assert.ok(button.title.length > 10 && button.getAttribute('aria-label') === button.title, `${lang}/${id}: 설명`);
      if (lang !== 'ko') assert.doesNotMatch(button.innerHTML + button.title, HANGUL, `${lang}/${id}: 한국어가 섞였어요`);
    }
    if (lang !== 'ko') for (const id of ['makePaperStatus', 'makePrintStatus']) assert.doesNotMatch(h.$(id).textContent, HANGUL, `${lang}/${id}`);
  }
  assert.deepEqual([...h.missingKeys], []);
});

test('표시 조건: isLabPath() && hGeneratorActive() 일 때만 보여요', () => {
  for (const lab of [false, true]) for (const hActive of [false, true]) {
    const h = createCubeMakeHarness({lab, h: hActive});
    h.sync();
    assert.equal(h.$('cubeMakeSection').hidden, !(lab && hActive), `lab=${lab} H=${hActive}`);
  }
});

test('기본은 접혀 있고, 토글이 본문 · aria-expanded · 설명을 함께 바꿔요', async () => {
  const h = createCubeMakeHarness();
  h.sync();
  const toggle = h.$('cubeMakeToggle');
  assert.equal(h.$('cubeMakeBody').hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.title, h.text('g1048'));
  await h.expand();
  assert.equal(h.$('cubeMakeBody').hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.title, h.text('g1049'));
  assert.match(toggle.innerHTML, /<svg/);
});

test('current 가 없거나 H 가 아니면 버튼 7개가 막히고 상태 줄이 비고, 눌러도 부수효과가 없어요', async () => {
  for (const current of [null, {label: 'y', type: 'Y', encoded: {}, sceneOpts: {}}]) {
    const h = createCubeMakeHarness({current});
    await h.expand();
    for (const id of ALL_IDS) assert.equal(h.$(id).disabled, true, `${current?.type ?? 'null'}/${id}`);
    assert.equal(h.$('makePaperStatus').textContent, '');
    assert.equal(h.$('makePrintStatus').textContent, '');
    for (const id of ALL_IDS) await h.click(id);
    assert.equal(h.downloads.length + h.prints.length, 0);
  }
});

// ── 산출물: 파일명 · MIME · 바이트 ───────────────────────────────────────

test('3F 기본값: 3MF · STL 묶음 · 받침대 파일명이 설계 §4.3 치환 형태이고 바이트가 유효해요', async () => {
  const current = hCurrent('old', {version: 0, mode: 3});
  const h = createCubeMakeHarness({current});
  await h.expand();
  for (const id of PRINT_IDS) await h.click(id);
  const phys = physOf(current, 2000), plan = hollowPlan(phys, {depthUm: 1000});
  assert.equal(plan.enabled, true, '속 비우기 기본값은 켬이에요(운영자 요청)');
  const [threeMf, stl, stand] = h.downloads;
  assert.equal(threeMf.filename, 'old_print-c2000um-d1000um-hollow-rf3.3mf');
  assert.equal(threeMf.mime, 'model/3mf');
  const {issues, model} = check3mfZip(threeMf.bytes);
  assert.deepEqual(issues, []);
  assert.equal(model.structure, 'components');
  // 판 배치: 부모 build item 하나에 평행 이동 하나(Cura 는 3MF 원점을 판 앞-왼 모서리에 둬요). 메쉬 좌표는 [0, L] 그대로예요.
  assert.deepEqual(model.buildTranslations, [[...printBedPlacement(phys.sideUm).translationMm]]);
  assert.deepEqual(model.buildTranslations, [[37, 37, 0]], 'v0 · 셀 2 mm: 발자국 [37, 63] mm = 100 mm 판 한가운데');
  const lo3mf = Math.min(...model.objects.filter((o) => o.vertices).flatMap((o) => o.vertices.flatMap((v) => [v[0], v[1], v[2]])));
  assert.equal(lo3mf, 0, '3MF 메쉬 좌표는 옮기지 않아요');
  assert.equal(stl.filename, 'old_print-c2000um-d1000um-hollow-rf3_stl.zip');
  assert.equal(stl.mime, 'application/zip');
  const zip = readZip(stl.bytes);
  assert.deepEqual(zip.issues, []);
  assert.equal(zip.entries.length, model.objects.filter((o) => o.vertices).length, 'STL 묶음 파일 수 = 3MF 파트 수');
  for (const entry of zip.entries) {
    assert.match(entry.name, /^old_print-c2000um-d1000um-hollow-rf3_\d+-(k|w|t\d+|core)-[0-9a-f]{6}\.stl$/);
    assert.deepEqual(parseBinaryStl(entry.data).issues, [], entry.name);
  }
  // STL 은 옮기지 않아요(슬라이서가 가운데로 옮기거나 배치해요): 묶음 전체 최소 좌표가 0 이에요.
  const stlLo = Math.min(...zip.entries.flatMap((entry) => parseBinaryStl(entry.data).triangles.flatMap((t) => t.v.flat())));
  assert.equal(stlLo, 0);
  assert.equal(stand.filename, `old_stand-L${phys.sideUm}um.stl`);
  assert.equal(stand.mime, 'model/stl');
  assert.deepEqual(parseBinaryStl(stand.bytes).issues, []);
  assert.match(h.$('makePrintStatus').textContent, /\d/);
});

test('속 비우기 켬(기본)은 공동 있는 코어를, 끔은 솔리드 코어를 내고 — 어느 쪽도 밀폐 공동이 없어요', async () => {
  const current = hCurrent('old', {version: 0, mode: 3});
  const h = createCubeMakeHarness({current});
  await h.expand();
  await h.click('makePrint3mf');
  const on = coreOf(h.downloads[0].bytes);
  const offCard = h.$('makeHollowCards').children.find((c) => c.dataset.hollow === 'off');
  await offCard.fire('click');
  await h.click('makePrint3mf');
  const last = h.downloads.at(-1);
  assert.equal(last.filename, 'old_print-c2000um-d1000um-rf3.3mf');
  const off = coreOf(last.bytes);
  const solid = buildPrintParts(physOf(current, 2000), {depthUm: 1000, hollow: false}).parts.at(-1);
  assert.ok(Math.abs(off.volume - solid.volumeMm3) < 1e-3, `끔 코어 부피 ${off.volume} ≠ 솔리드 ${solid.volumeMm3}`);
  assert.ok(on.volume < off.volume - 1, `켬 코어가 비지 않았어요: ${on.volume} vs ${off.volume}`);
  for (const core of [on, off]) assert.equal(surfaceComponents(core.mesh), 1, '코어 표면이 둘 이상 = 밀폐 공동');
});

test('3F + 6면(반복): 상태 줄에 «반대면 복제 켬», 빈 면이 없어 «켬» 이 막히고 솔리드 · 파일명 -rf6', async () => {
  const current = hCurrent('rep', {version: 0, mode: 3, renderFaces: 6});
  const h = createCubeMakeHarness({current});
  await h.expand();
  assert.ok(h.$('makePrintStatus').textContent.includes(h.text('g1095')));
  const cards = Object.fromEntries(h.$('makeHollowCards').children.map((c) => [c.dataset.hollow, c]));
  assert.equal(cards.on.disabled, true);
  assert.equal(cards.on.title, h.text('g1110'));
  await h.click('makePrint3mf');
  assert.equal(h.downloads[0].filename, 'rep_print-c2000um-d1000um-rf6.3mf');
  // 제목의 «솔리드» 를 재요: 코어 부피 = 속 비우기 끔 코어 부피, 표면 성분 1.
  const core = coreOf(h.downloads[0].bytes);
  const solid = buildPrintParts(physOf(current, 2000), {depthUm: 1000, hollow: false}).parts.at(-1);
  assert.ok(Math.abs(core.volume - solid.volumeMm3) < 1e-3, `코어 부피 ${core.volume} ≠ 솔리드 ${solid.volumeMm3}`);
  assert.equal(surfaceComponents(core.mesh), 1);
});

test('6F: 숨구멍 면이 없으면 «켬» 이 막히고 사유가 보이며, 솔리드로 내보내요', async () => {
  const current = hCurrent('six', {version: 0, mode: 6});
  const h = createCubeMakeHarness({current});
  await h.expand();
  const cards = Object.fromEntries(h.$('makeHollowCards').children.map((c) => [c.dataset.hollow, c]));
  assert.equal(cards.on.disabled, true);
  assert.equal(cards.on.title, h.text('g1110'));
  assert.equal(cards.off.getAttribute('aria-pressed'), 'true');
  // 상태 줄에는 문장 키가 아니라 조각 키(소문자 · 마침표 없음)가 들어가요.
  assert.ok(h.$('makePrintStatus').textContent.includes(h.text('g1122')));
  await h.click('makePrint3mf');
  assert.equal(h.downloads[0].filename, 'six_print-c2000um-d1000um-rf6.3mf');
  const core = coreOf(h.downloads[0].bytes);
  const solid = buildPrintParts(physOf(current, 2000), {depthUm: 1000, hollow: false}).parts.at(-1);
  assert.ok(Math.abs(core.volume - solid.volumeMm3) < 1e-3);
  assert.equal(surfaceComponents(core.mesh), 1);
});

test('종이 SVG · PDF: 파일명 = 기존 이름 + paper-net 계획 꼬리표, 실척 mm SVG, 구조가 유효한 PDF', async () => {
  const current = hCurrent('old', {version: 0, mode: 3});
  let pngCall = null;
  const h = createCubeMakeHarness({current, overrides: {renderExportPng: (scene, plan) => { pngCall = {scene, plan}; return fakePng; }}});
  await h.expand();
  for (const id of ['makePaperSvg', 'makePaperPng', 'makePaperPdf']) await h.click(id);
  const plan = paperPlan(physOf(current), {paper: 'A4', thicknessMm: 0.1});
  const [svg, png, pdf] = h.downloads;
  assert.equal(svg.filename, `old_${plan.fileTag}.svg`);
  assert.match(svg.filename, /^old_(sheet|skin|board)-[A-Za-z0-9]+-s\d+um-t\d+um\.svg$/);
  assert.equal(svg.mime, 'image/svg+xml');
  assert.match(new TextDecoder().decode(svg.bytes), /^<svg [^>]*width="210mm" height="297mm" viewBox="0 0 210 297"/);
  assert.equal(png.filename, `old_${plan.fileTag}.png`);
  assert.equal(png.mime, 'image/png');
  assert.deepEqual(pngCall.plan, paperPngPlan(pngCall.scene), 'PNG 는 paperPngPlan(300 dpi) 경로를 써요');
  assert.equal(pdf.filename, `old_${plan.fileTag}.pdf`);
  assert.equal(pdf.mime, 'application/pdf');
  assert.deepEqual(structureFailures(inspectPdf(pdf.bytes)), []);
  assert.match(h.$('makePaperStatus').textContent, new RegExp(h.text('g1119').replace(/[.]/g, '\\.')));
});

test('인쇄: 대화상자 전에 실척 안내를 보이고, 1:1 mm SVG 와 용지 항목을 본문 인쇄 호스트로 넘기고, 파일은 안 내려받아요', async () => {
  const h = createCubeMakeHarness({raf: 'manual'});
  await h.expand();
  const job = h.click('makePaperPrint');
  assert.equal(h.prints.length, 0, '양보 전에는 인쇄를 부르지 않아요');
  assert.ok(h.$('makePaperStatus').textContent.endsWith(h.text('g1120')), '인쇄 전 안내가 먼저 보여야 해요');
  h.release();
  await job;
  assert.equal(h.downloads.length, 0);
  assert.equal(h.prints.length, 1);
  assert.equal(h.prints[0].paper, PAPER_SIZES.find((p) => p.id === 'A4'));
  assert.match(h.prints[0].svgText, /^<svg [^>]*width="210mm" height="297mm" viewBox="0 0 210 297"/);
  assert.ok(h.$('makePaperStatus').textContent.endsWith(h.text('g1120')));
});

// ── busy · 스냅샷 · 압축 · 오류 ───────────────────────────────────────────

test('busy: 묶음마다 잠기고(다른 묶음은 살아 있어요), 중복 클릭은 무시되고, 끝나면 풀려요', async () => {
  for (const [id, mine, other, busyKey] of [['makePaperPdf', PAPER_IDS, PRINT_IDS, 'g1117'], ['makePrint3mf', PRINT_IDS, PAPER_IDS, 'g1118']]) {
    const h = createCubeMakeHarness({raf: 'manual'});
    await h.expand();
    const job = h.click(id);
    assert.deepEqual(busyProblems(h, mine, other), [], id);
    assert.ok((mine === PAPER_IDS ? h.$('makePaperStatus') : h.$('makePrintStatus')).textContent.endsWith(h.text(busyKey)));
    const repeats = mine.map((x) => h.click(x));
    assert.equal(h.pendingFrames(), 1, `${id}: busy 중 클릭이 새 작업을 열었어요`);
    h.release();
    await Promise.all([job, ...repeats]);
    assert.equal(h.downloads.length, 1);
    assert.deepEqual(busyProblems(h, [], ALL_IDS), []);
  }
});

test('한 프레임 양보 중 current 가 바뀌어도 파일명 · 내용은 클릭 시점 본문이에요', async () => {
  const oldCurrent = hCurrent('old', {version: 0, mode: 3});
  const h = createCubeMakeHarness({current: oldCurrent, raf: 'manual'});
  await h.expand();
  const job = h.click('makePrint3mf');
  h.c.current = hCurrent('new', {version: 2, mode: 3});
  h.release();
  await job;
  assert.equal(h.downloads.length, 1);
  assert.ok(h.downloads[0].filename.startsWith('old_'));
  // 파트 전체의 좌표 상한 = 인쇄 방향 큐브의 한 변 L 이에요. 옛 본문(H0)과 새 본문(H2)은 L 이 달라요.
  const {model} = coreOf(h.downloads[0].bytes);
  const maxCoord = Math.max(...model.objects.filter((o) => o.vertices).flatMap((o) => o.vertices.flat()));
  const oldSide = physOf(oldCurrent).sideUm / 1000, newSide = physOf(h.c.current).sideUm / 1000;
  assert.notEqual(oldSide, newSide, '대조가 성립하려면 두 본문의 한 변이 달라야 해요');
  assert.ok(Math.abs(maxCoord - oldSide) < 1e-6, `옛 큐브 한 변이 아니에요: ${maxCoord}`);
});

test('예약 렌더가 있으면 새 본문부터 만든 뒤 내보내요', async () => {
  const h = createCubeMakeHarness();
  await h.expand();
  h.c.pendingCurrent = hCurrent('new', {version: 0, mode: 3});
  await h.click('makePaperSvg');
  assert.equal(h.c.flushes >= 1, true);
  assert.ok(h.downloads[0].filename.startsWith('new_'));
});

test("'deflate-raw' 가 없어도 3MF · STL 묶음은 살아 있고 설명에 무압축 안내가 붙어요", async () => {
  const h = createCubeMakeHarness({overrides: {supportsDeflateRaw: () => false}});
  await h.expand();
  for (const id of ['makePrint3mf', 'makePrintStl']) {
    assert.equal(h.$(id).disabled, false);
    assert.ok(h.$(id).title.endsWith(h.text('g1121')), id);
  }
  assert.ok(!h.$('makePrintStand').title.includes(h.text('g1121')));
  await h.click('makePrint3mf');
  assert.equal(h.downloads.length, 1);
});

test('오류: TLP 코드는 대응 문구, 그 밖의 예외는 공통 문구 + 코드만(원문 메시지를 흘리지 않아요)', async () => {
  const topo = Object.assign(new RangeError('내부 위상 메시지'), {code: 'TLP_TOPOLOGY'});
  const cap = Object.assign(new RangeError('내부 상한 메시지'), {code: 'TLP_TRI_CAP', triangleCap: 123456});
  const plain = new RangeError('한국어 내부 메시지');
  for (const lang of ['ko', 'en']) {
    for (const [error, expected] of [[topo, (h) => h.text('g1108')], [cap, (h) => h.text('g1109').replace('{cap}', new Intl.NumberFormat(lang).format(123456))], [plain, (h) => h.text('g1116').replace('{code}', 'RangeError')]]) {
      const h = createCubeMakeHarness({lang, overrides: {buildPrintParts: () => { throw error; }, buildPaperSheet: () => { throw error; }}});
      await h.expand();
      await h.click('makePrint3mf');
      await h.click('makePaperPdf');
      assert.equal(h.downloads.length, 0);
      for (const id of ['makePrintStatus', 'makePaperStatus']) {
        const text = h.$(id).textContent;
        assert.ok(text.endsWith(expected(h)), `${lang}/${error.message}/${id}: ${text}`);
        assert.ok(!text.includes(error.message), '원문 메시지가 화면에 나왔어요');
        if (lang !== 'ko') assert.doesNotMatch(text, HANGUL);
      }
      assert.deepEqual(busyProblems(h, [], ALL_IDS), []);
    }
  }
});

// ── 옵션 컨트롤 ─────────────────────────────────────────────────────────

test('매립 깊이 카드: 비활성 ⟺ print-mesh 가 TLP_DEPTH_GT_CELL 을 던지는 조합이에요(셀 0.8–5.0 mm 전수)', async () => {
  const current = hCurrent('old', {version: 0, mode: 3});
  const h = createCubeMakeHarness({current});
  await h.expand();
  const model = generatorCubeModel(current, undefined);
  for (let cellUm = 800; cellUm <= 5000; cellUm += 200) {
    await h.input('makeCellMm', cellUm / 1000);
    assert.equal(h.state().cellUm, cellUm);
    const phys = physicalHCube(model, {cellUm});
    let pressed = 0;
    for (const card of h.$('makeDepthCards').children) {
      const depthUm = Number(card.dataset.depthUm);
      let code = null;
      try { hollowPlan(phys, {depthUm}); } catch (error) { code = error.code; }
      assert.equal(card.disabled, code === 'TLP_DEPTH_GT_CELL', `c=${cellUm} d=${depthUm}`);
      if (card.getAttribute('aria-pressed') === 'true') { pressed += 1; assert.equal(card.disabled, false, '눌린 카드가 막혀 있어요'); }
    }
    assert.equal(pressed, 1, `c=${cellUm}: 눌린 깊이 카드가 하나가 아니에요`);
  }
  // 셀 0.8 mm 에서 고른 1.0 mm 는 들어가지 않아 가장 깊은 가능한 카드(0.6 mm)로 내보내요.
  await h.input('makeCellMm', 0.8);
  await h.click('makePrint3mf');
  assert.match(h.downloads.at(-1).filename, /_print-c800um-d600um-/);
});

test('셀 크기 입력은 0.2 mm 눈금 · 0.8–5.0 mm 로 맞추고, 숫자가 아니면 이전 값을 지켜요', async () => {
  const h = createCubeMakeHarness();
  await h.expand();
  for (const [input, expected] of [['1.05', 1000], ['1.1', 1200], ['9', 5000], ['0.1', 800], ['2.3', 2400], ['abc', 2400], ['', 2400]]) {
    await h.input('makeCellMm', input);
    assert.equal(h.state().cellUm, expected, input);
    assert.equal(h.$('makeCellMm').value, String(expected / 1000), input);
  }
  assert.equal(h.$('makeCellMm').min, '0.8');
  assert.equal(h.$('makeCellMm').step, '0.2');
});

test('Enter 로 확정해 포커스가 칸에 남아도 칸은 적용값(범위 · 눈금에 맞춘 값)으로 바로 바뀌어요', async () => {
  const h = createCubeMakeHarness();
  await h.expand();
  const cell = h.$('makeCellMm');
  h.c.document.activeElement = cell; // Enter: change 는 오지만 포커스는 칸에 남아요.
  for (const [typed, shown, um] of [['7', '5', 5000], ['0.9', '1', 1000], ['abc', '1', 1000], ['2.3', '2.4', 2400]]) {
    await h.input('makeCellMm', typed);
    assert.equal(h.state().cellUm, um, typed);
    assert.equal(cell.value, shown, `${typed}: 칸이 적용값과 달라요`);
  }
  // 다른 컨트롤이 부른 sync 는 입력 중인 칸을 덮지 않아요(타이핑 보호는 그대로예요).
  cell.value = '3.';
  await h.$('makeHollowCards').children.find((c) => c.dataset.hollow === 'off').fire('click');
  assert.equal(cell.value, '3.');
  h.c.document.activeElement = null;
  // 자 검증: 확정 칸 정규화를 빼먹은 핸들러는 포커스가 남은 칸에 친 값(7)이 그대로 남아요.
  const bad = createCubeMakeHarness({source: mutate('input.value=String(cubeMakeState[key]/1000);\n  syncCubeMakeUi();', 'syncCubeMakeUi();')});
  await bad.expand();
  bad.c.document.activeElement = bad.$('makeCellMm');
  await bad.input('makeCellMm', '7');
  assert.equal(bad.state().cellUm, 5000);
  assert.equal(bad.$('makeCellMm').value, '7', '결함을 심었는데 칸이 정규화됐어요 — 자가 비어 있어요');
});

test('매립 깊이 카드 라벨은 언어 소수점 표기를 따라요(상태 줄과 같은 표기)', async () => {
  for (const [lang, expected] of [['ko', ['0.6 mm', '1.0 mm', '1.6 mm', '2.0 mm']], ['fr', ['0,6 mm', '1,0 mm', '1,6 mm', '2,0 mm']], ['de', ['0,6 mm', '1,0 mm', '1,6 mm', '2,0 mm']]]) {
    const h = createCubeMakeHarness({lang});
    await h.expand();
    const labels = h.$('makeDepthCards').children.map((card) => card.textContent);
    assert.deepEqual(labels, expected, lang);
  }
});

test('상태 줄은 « · » 조각 목록이라 여덟 언어 모두 조각이 문장 마침표로 끝나지 않아요(자 검증: 문장 키를 넣으면 빨개져요)', async () => {
  const segments = (h) => ['makePrintStatus', 'makePaperStatus'].flatMap((id) => h.$(id).textContent.split(' · '));
  const sentenceEnd = /[.。]$/;
  for (const lang of LANGS) for (const current of [hCurrent('six', {version: 0, mode: 6}), hCurrent('three', {version: 0, mode: 3})]) {
    const h = createCubeMakeHarness({lang, current});
    await h.expand();
    // 막힌 방식 카드 사유(2.0 mm 판 → 판 직접 인쇄 불가)와 셀에 맞춰 낮춘 깊이 조각까지 같이 봐요.
    await h.select('makePaperThickness', 'board20');
    await h.input('makeCellMm', 0.8);
    const bad = segments(h).filter((s) => sentenceEnd.test(s));
    assert.deepEqual(bad, [], `${lang}/${current.label}`);
  }
  const mutated = createCubeMakeHarness({lang: 'en', current: hCurrent('six', {version: 0, mode: 6}),
    source: mutate('function cubeMakeReasonText(code){return CUBE_MAKE_REASON_KEYS[code]?t(CUBE_MAKE_REASON_KEYS[code]):cubeMakeCodeText(code);}', 'function cubeMakeReasonText(code){return cubeMakeCodeText(code);}')});
  await mutated.expand();
  assert.ok(segments(mutated).some((s) => sentenceEnd.test(s)), '문장 키를 넣었는데 자가 통과했어요');
});

test('막힌 카드의 사유는 title(hover)만이 아니라 상태 줄에도 보여요 — 터치 기기(깊이 낮춤 · 방식 카드 · 6F 속 비우기)', async () => {
  const h = createCubeMakeHarness({current: hCurrent('old', {version: 0, mode: 3})});
  await h.expand();
  const print = () => h.$('makePrintStatus').textContent, paper = () => h.$('makePaperStatus').textContent;
  const lowered = (mm) => h.text('g1125').replace('{depth}', mm);
  // 기본(셀 2.0 · 깊이 1.0)은 낮추지 않아요.
  assert.ok(!print().includes(lowered('0.6')) && !print().includes(lowered('1.0')));
  // 셀 0.8 mm 에서 고른 1.0 mm 는 0.6 mm 로 내보내요 — 상태 줄이 그 값을 말해요.
  await h.input('makeCellMm', 0.8);
  assert.ok(print().includes(lowered('0.6')), print());
  await h.input('makeCellMm', 2);
  assert.ok(!print().includes(lowered('0.6')), '셀을 되돌리면 조각이 사라져요');
  // 2.0 mm 판: 판 직접 인쇄 카드가 막히고, 그 사유가 상태 줄에 조각으로 있어요.
  await h.select('makePaperThickness', 'board20');
  const board = h.$('makePaperMethodCards').children.find((c) => c.dataset.paperMethod === 'board');
  assert.equal(board.disabled, true);
  assert.ok(paper().includes(h.text('g1126').replace('{method}', h.text('g1069')).replace('{reason}', h.text('g1127'))), paper());
  await h.select('makePaperThickness', 'board10');
  assert.ok(!paper().includes(h.text('g1069')), '막히지 않으면 사유 조각이 없어요');
  // paper-net 이 방식 카드를 막을 때 싣는 모든 TLP 코드(src 에서 유도)에 상태 줄 조각 키가 있어요 — 없으면 문장 키로 떨어져요.
  const paperCodes = new Set([...readFileSync(new URL('../src/paper-net.js', import.meta.url), 'utf8').matchAll(/tlpError\('(TLP_[A-Z_]+)'/g)].map((m) => m[1]));
  const reasonKeys = Object.fromEntries([.../const CUBE_MAKE_REASON_KEYS=\{([\s\S]*?)\};/.exec(SLICE)[1].matchAll(/(TLP_[A-Z_]+):'(g\d+)'/g)].map((m) => [m[1], m[2]]));
  assert.ok(paperCodes.size >= 4, `코드 유도가 무너졌어요(${[...paperCodes]})`);
  assert.deepEqual([...paperCodes].filter((code) => !reasonKeys[code]), []);
  // 6F: «끔» 을 골라 둬도 «켬» 이 막힌 사유를 보여요.
  const six = createCubeMakeHarness({current: hCurrent('six', {version: 0, mode: 6})});
  await six.expand();
  await six.$('makeHollowCards').children.find((c) => c.dataset.hollow === 'off').fire('click');
  assert.ok(six.$('makePrintStatus').textContent.includes(six.text('g1122')));
});

test('막힌 카드 · 버튼 · 칸은 보이게 흐려져요: #cubeMakeSection 에 :disabled 모양이 있고 hover 강조를 되돌려요(자 검증: 규칙을 지우면 빨개져요)', () => {
  // VM 하네스에는 CSS 가 없어서 disabled 속성만 재요. 전역 button · .toggle-card 저작자 규칙이 UA 비활성 모양을 덮으므로
  // 막힌 카드가 켜진 카드와 똑같이 보이던 결함은 이 정적 자가 막아요. pointer-events 는 끄지 않아요(title 사유가 떠야 해요).
  const css = (source) => source.slice(source.indexOf('<style'), source.indexOf('</style>'));
  const problems = (source) => {
    const style = css(source).replace(/\/\*[\s\S]*?\*\//g, ''), out = [];
    const selectors = [...style.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    for (const selector of ['#cubeMakeSection .toggle-card:disabled', '#cubeMakeSection button:disabled', '#cubeMakeSection input:disabled'])
      if (!selectors.includes(selector)) out.push(`${selector} 규칙이 없어요`);
    if (!/#cubeMakeSection \.toggle-card:disabled:not\(\.active\):hover\s*\{[^}]*border-color:var\(--line\)/.test(style)) out.push('카드 hover 강조를 안 되돌려요');
    if (!/#cubeMakeSection \.export-row button:disabled:hover\s*\{[^}]*border-color:var\(--line\)/.test(style)) out.push('버튼 hover 강조를 안 되돌려요');
    const block = /#cubeMakeSection \.toggle-card:disabled[^{]*\{([^}]*)\}/.exec(style)?.[1] ?? '';
    if (!/opacity:\s*\.\d/.test(block)) out.push('흐리게 하지 않아요');
    if (/pointer-events:\s*none/.test(block)) out.push('pointer-events:none 이면 title 사유가 안 떠요');
    return out;
  };
  assert.deepEqual(problems(INDEX), []);
  // 슬라이스가 막는 방식이 disabled 속성인지(클래스 관례 .disabled 는 pointer-events:none 이라 쓰지 않아요).
  assert.ok(SLICE.includes('card.disabled=') && !SLICE.includes("classList.toggle('disabled'"));
  const stripped = INDEX.replace(/\n\s*#cubeMakeSection \.toggle-card:disabled, #cubeMakeSection button:disabled, #cubeMakeSection input:disabled \{[^}]*\}/, '');
  assert.notEqual(stripped, INDEX, '변이 자리를 못 찾았어요');
  assert.ok(problems(stripped).length >= 3, '규칙을 지웠는데 자가 통과했어요');
});

test('상태 줄(aria-live) · 버튼 마크업은 바뀔 때만 써요 — 같은 상태로 sync 를 반복해도 다시 쓰지 않아요(자 검증: 매번 쓰면 빨개져요)', async () => {
  const counted = (h) => {
    const writes = {status: 0, html: 0};
    for (const id of ['makePaperStatus', 'makePrintStatus']) {
      const node = h.$(id); let value = node.textContent;
      Object.defineProperty(node, 'textContent', {get: () => value, set: (v) => { writes.status += 1; value = v; }});
    }
    for (const id of [...ALL_IDS, 'cubeMakeToggle']) {
      const node = h.$(id); let value = node.innerHTML;
      Object.defineProperty(node, 'innerHTML', {get: () => value, set: (v) => { writes.html += 1; value = v; }});
    }
    return writes;
  };
  const h = createCubeMakeHarness();
  await h.expand();
  const text = h.$('makePrintStatus').textContent;
  const writes = counted(h);
  for (let k = 0; k < 10; k += 1) h.sync();
  assert.deepEqual(writes, {status: 0, html: 0});
  assert.equal(h.$('makePrintStatus').textContent, text);
  // 상태가 바뀌면 그 줄은 다시 써요(언어 전환은 버튼 라벨도).
  await h.input('makeCellMm', 3);
  assert.ok(writes.status >= 1 && h.$('makePrintStatus').textContent !== text);
  h.c.genI18n.lang = 'en'; h.sync();
  const relabeled = ALL_IDS.filter((id) => h.dict.ko[BUTTON_KEYS[id]] !== h.dict.en[BUTTON_KEYS[id]]).length;
  assert.ok(relabeled >= 1 && writes.html >= relabeled, `언어를 바꾸면 라벨이 달라진 버튼을 다시 그려요(${writes.html}/${relabeled})`);
  // 'deflate-raw' 생성자는 처음 한 번만 만들어 봐요.
  let probes = 0;
  const probed = createCubeMakeHarness({overrides: {supportsDeflateRaw: () => { probes += 1; return true; }}});
  await probed.expand();
  for (let k = 0; k < 5; k += 1) probed.sync();
  assert.equal(probes, 1);
  // 자 검증: 상태 줄을 매번 쓰는 핸들러는 잡혀요.
  const bad = createCubeMakeHarness({source: mutate('function cubeMakeSetText(el,text){if(el.textContent!==text)el.textContent=text;}', 'function cubeMakeSetText(el,text){el.textContent=text;}')});
  await bad.expand();
  const badWrites = counted(bad);
  for (let k = 0; k < 3; k += 1) bad.sync();
  assert.ok(badWrites.status >= 6, `매번 쓰는 결함인데 ${badWrites.status}회만 셌어요`);
});

test('표기: 용지 치수는 언어 소수점으로 적고 언어가 바뀌면 다시 채워요 · 로마자 언어 3D 상태 줄은 대문자로 시작 · ja 새 키는 전각 콜론', async () => {
  const h = createCubeMakeHarness({lang: 'ko'});
  await h.expand();
  const option = (id) => new RegExp(`<option value="${id}">([^<]*)</option>`).exec(h.$('makePaperSize').innerHTML)?.[1];
  assert.equal(option('Letter'), 'Letter · 215.9 × 279.4 mm');
  for (const [lang, comma] of [['fr', true], ['de', true], ['en', false], ['pt', true]]) {
    h.c.genI18n.lang = lang; h.sync();
    assert.equal(option('Letter'), comma ? 'Letter · 215,9 × 279,4 mm' : 'Letter · 215.9 × 279.4 mm', lang);
    assert.equal(option('A4'), 'A4 · 210 × 297 mm', `${lang}: 정수는 소수 없이`);
    // 같은 섹션 두께 select 와 같은 소수점이에요.
    assert.ok(h.$('makePaperThickness').innerHTML.includes(comma ? '0,1 mm' : '0.1 mm'), `${lang}: 두께 소수점`);
  }
  for (const lang of ['en', 'fr', 'it', 'es', 'pt', 'de']) {
    const x = createCubeMakeHarness({lang});
    await x.expand();
    assert.match(x.$('makePrintStatus').textContent, /^\p{Lu}/u, `${lang}: 3D 상태 줄 첫 글자`);
  }
  // ja: 이 섹션 키(g1042–g1130 · 배율 보정 g1133–g1139)에는 반각 콜론(뒤에 숫자 · 슬래시가 오지 않는)이 없어요(기존 g480 선례).
  // (g1131 · g1132 는 이 섹션 밖 — 구 전개도 버튼 설명 — 이라 범위에서 빠져요.)
  const sectionKey = (n) => (n >= 1042 && n <= 1130) || (n >= 1133 && n <= 1139);
  const halfColon = Object.keys(h.dict.ja).filter((k) => /^g\d{4}$/.test(k) && sectionKey(Number(k.slice(1))) && /:(?![\d/])/.test(h.dict.ja[k]));
  assert.deepEqual(halfColon, []);
});

test('받침대 버튼 설명: 받침대가 잡는 꼭짓점에 데이터 면이 닿으면(6F 등) 포켓이 그 모서리를 가린다고 알려요', async () => {
  for (const [current, covered] of [[hCurrent('iso', {version: 0, mode: 3}), false], [hCurrent('six', {version: 0, mode: 6}), true],
    [hCurrent('hor', {version: 0, mode: 3, arrangement: 'horizontal'}), null]]) {
    const h = createCubeMakeHarness({current});
    await h.expand();
    // 기대값은 하네스 계산과 독립으로 print-mesh 에서 유도해요(배치 표를 옮겨 적지 않아요).
    const expected = standCornerFaces(physOf(current)).coveredDataFaces.length > 0;
    if (covered !== null) assert.equal(expected, covered, current.label);
    const title = h.$('makePrintStand').title;
    assert.equal(title.endsWith(h.text('g1124')), expected, `${current.label}: ${title}`);
    assert.equal(h.$('makePrintStand').getAttribute('aria-label'), title);
  }
});

test('두께 직접 입력: 칸이 «직접 입력» 에서만 보이고, µm 로 반올림한 값이 방식 판정 · 파일명에 그대로 가요', async () => {
  const h = createCubeMakeHarness();
  await h.expand();
  assert.equal(h.$('makePaperThicknessCustomRow').hidden, true);
  await h.select('makePaperThickness', 'custom');
  assert.equal(h.$('makePaperThicknessCustomRow').hidden, false);
  await h.input('makePaperThicknessCustom', '0.3004');
  assert.equal(h.state().thicknessCustomUm, 300);
  assert.equal(h.$('makePaperMethodRow').hidden, true, '0.3 mm 는 한 장 전개도뿐이에요');
  await h.click('makePaperSvg');
  assert.match(h.downloads.at(-1).filename, /_sheet-A4-s\d+um-t300um\.svg$/);
  await h.input('makePaperThicknessCustom', '0.61');
  assert.equal(h.$('makePaperMethodRow').hidden, false, '0.45 mm 를 넘으면 방식 카드가 보여요');
  await h.click('makePaperSvg');
  assert.match(h.downloads.at(-1).filename, /_skin-A4-s\d+um-t610um\.svg$/);
});

test('방식 카드: 0.45 mm 이하면 숨고, 두꺼우면 paper-net 판정대로 켜지고 막혀요', async () => {
  const current = hCurrent('old', {version: 0, mode: 3});
  const h = createCubeMakeHarness({current});
  await h.expand();
  assert.equal(h.$('makePaperMethodRow').hidden, true);
  const phys = physOf(current);
  for (const thickness of ['board10', 'board20', 'fluteC']) {
    await h.select('makePaperThickness', thickness);
    assert.equal(h.$('makePaperMethodRow').hidden, false, thickness);
    const thicknessMm = h.c.THICKNESS_PRESETS.find((p) => p.id === thickness).thicknessMm;
    const options = paperMethodOptions(phys, {paper: 'A4', thicknessMm});
    for (const card of h.$('makePaperMethodCards').children) {
      const option = options.find((o) => o.method === card.dataset.paperMethod);
      assert.equal(card.disabled, !option.enabled, `${thickness}/${option.method}`);
      assert.equal(card.title, option.enabled ? '' : h.text({TLP_BOARD_THICK: 'g1115', TLP_BOARD_EDGE: 'g1114', TLP_PAPER_FIT: 'g1112', TLP_PAPER_MODULE: 'g1113'}[option.reason]));
    }
  }
  // 막힌 «판에 직접 인쇄» 를 눌러도 가능한 방식(붙이기)으로 만들어요.
  const board = h.$('makePaperMethodCards').children.find((c) => c.dataset.paperMethod === 'board');
  await board.fire('click');
  assert.ok(h.$('makePaperStatus').textContent.includes(h.text('g1090').split(' · ')[0]));
  await h.select('makePaperThickness', 'board10');
  assert.ok(h.$('makePaperStatus').textContent.includes(h.text('g1091').split(' · ')[0]));
  await h.click('makePaperPdf');
  assert.match(h.downloads.at(-1).filename, /^old_board-A4-s\d+um-t1000um\.pdf$/);
});

test('고급 컨트롤은 고급 모드에서만 보이고, 모드는 노출만 바꿔요(값은 그대로 적용돼요)', async () => {
  const h = createCubeMakeHarness({uiMode: 'advanced'});
  await h.expand();
  assert.equal(h.$('makePaperAdvanced').hidden, false);
  assert.equal(h.$('makePrintAdvanced').hidden, false);
  const ribsOff = h.$('makeRibCards').children.find((c) => c.dataset.ribs === 'off');
  await ribsOff.fire('click');
  assert.ok(h.$('makePrintStatus').textContent.includes(h.text('g1097').replace('{rooms}', '1').replace('{vents}', '1')));
  h.c.mode = 'normal';
  h.sync();
  assert.equal(h.$('makePaperAdvanced').hidden, true);
  assert.equal(h.$('makePrintAdvanced').hidden, true);
  assert.equal(h.state().ribs, false);
  assert.ok(h.$('makePrintStatus').textContent.includes(h.text('g1097').replace('{rooms}', '1').replace('{vents}', '1')));
});

test('한 변 «직접 입력» 은 지금 자동 최대 값에서 시작하고, 파일명 꼬리표가 그 값을 따라가요', async () => {
  const current = hCurrent('old', {version: 0, mode: 3});
  const h = createCubeMakeHarness({current, uiMode: 'advanced'});
  await h.expand();
  const auto = paperPlan(physOf(current), {paper: 'A4', thicknessMm: 0.1});
  const manual = h.$('makePaperSideCards').children.find((c) => c.dataset.paperSide === 'manual');
  await manual.fire('click');
  assert.equal(h.state().sideUm, auto.sideUm);
  assert.equal(h.$('makePaperSideRow').hidden, false);
  await h.input('makePaperSide', 50.04);
  assert.equal(h.state().sideUm, 50000);
  await h.click('makePaperSvg');
  assert.equal(h.downloads.at(-1).filename, `old_${paperPlan(physOf(current), {paper: 'A4', thicknessMm: 0.1, sideMm: 50}).fileTag}.svg`);
  await h.input('makePaperSide', 500);
  assert.equal(h.$('makePaperSvg').disabled, true, '용지에 안 들어가면 막혀요');
  assert.ok(h.$('makePaperStatus').textContent.includes(h.text('g1112')));
});

// ── 인쇄 배율 보정(보정 없이 인쇄한 50 mm 막대를 잰 길이 — 절대값 · 용지 크기마다 따로) ─────────────
// 2026-09-24 운영자 실측: Windows «Class Driver» 가 쪽 전체를 0.966 배로 줄여 막대가 48.3 mm 로 나왔어요(브라우저 설정 무관).

const BAR_PREFIX = 'tlcube-paper-bar-mm';
/** 저장소 키는 용지 크기마다 따로예요(드라이버가 쪽을 맞추는 비율이 용지마다 달라요). */
const barKey = (paper) => `${BAR_PREFIX}:${paper}`;
const BAR_KEY = barKey('A4');
/** 상태 줄 배율 조각 / 틀린 값 사유 조각(하네스 언어의 사전 원문을 치환해요). k 는 도안 캡션과 같은 글자예요. */
const scaleItem = (h, factor, bar, k = 'k=0.966') => h.text('g1135').replace('{k}', k).replace('{factor}', factor).replace('{bar}', bar);
/** g1135 의 앞 이름(«배율 보정 » 등) — 보정이 없으면 상태 줄에 없어야 해요. 자리표시자 앞까지라 번역이 바뀌어도 따라가요. */
const scaleHead = (h) => h.text('g1135').split('{')[0];
const barErrorItem = (h, bar, min = '45.0', max = '51.0') => h.text('g1136').replace('{min}', min).replace('{max}', max).replace('{bar}', bar);
const ko1 = (um) => new Intl.NumberFormat('ko', {minimumFractionDigits: 1, maximumFractionDigits: 1}).format(um / 1000);

test('배율 보정 칸: 기본 50 mm 는 보정 없음(꼬리표 · 조각 없음), 48.3 mm 는 s = 0.966 계획 — 파일명 -k966 · 상태 줄 ×1.035 · SVG · PDF · 인쇄는 용지 크기 그대로', async () => {
  const current = hCurrent('old', {version: 0, mode: 3});
  const h = createCubeMakeHarness({current});
  await h.expand();
  const bar = h.$('makePaperBarMm'), reset = h.$('makePaperBarReset'), status = () => h.$('makePaperStatus').textContent;
  assert.deepEqual([bar.value, bar.min, bar.max, bar.step, reset.disabled], ['50', '45', '51', '0.1', true]);
  assert.equal(h.state().barUm, 50000);
  const plain = paperPlan(physOf(current), {paper: 'A4', thicknessMm: 0.1});
  assert.ok(scaleHead(h).trim().length >= 4, scaleHead(h));
  assert.ok(!status().includes(scaleHead(h)), status());
  await h.click('makePaperSvg');
  assert.equal(h.downloads.at(-1).filename, `old_${plain.fileTag}.svg`);
  await h.input('makePaperBarMm', '48.3');
  assert.deepEqual([h.state().barUm, bar.value, reset.disabled, h.storage.map.get(BAR_KEY)], [48300, '48.3', false, '48.3']);
  const scaled = paperPlan(physOf(current), {paper: 'A4', thicknessMm: 0.1, printScale: 0.966});
  assert.ok(status().includes(scaleItem(h, '1.035', '48.3')), status());
  // 상태 줄의 k 는 도안 캡션과 같은 글자예요(사용자가 종이 위 «k=0.966» 과 맞춰 봐요).
  assert.ok(status().includes(printScaleTag(0.966)) && printScaleTag(0.966) === 'k=0.966', status());
  // 상태 줄 한 변 · 피치는 보정한 계획(가상 용지)의 값 = 드라이버가 줄인 뒤 종이 위 치수예요.
  assert.ok(scaled.sideUm < plain.sideUm);
  assert.ok(status().startsWith(h.text('g1088').replace('{paper}', 'A4').replace('{side}', ko1(scaled.sideUm)).replace('{pitch}', ko1(scaled.pitchUm)).split('{')[0]), status());
  for (const id of ['makePaperSvg', 'makePaperPdf']) await h.click(id);
  const [svg, pdf] = h.downloads.slice(-2);
  assert.equal(svg.filename, `old_${scaled.fileTag}.svg`);
  assert.match(svg.filename, /-t100um-k966\.svg$/);
  assert.match(new TextDecoder().decode(svg.bytes), /^<svg [^>]*width="210mm" height="297mm" viewBox="0 0 210 297"/);
  assert.equal(pdf.filename, `old_${scaled.fileTag}.pdf`);
  assert.deepEqual(structureFailures(inspectPdf(pdf.bytes)), []);
  await h.click('makePaperPrint');
  assert.equal(h.prints.at(-1).paper, PAPER_SIZES.find((p) => p.id === 'A4'));
  assert.match(h.prints.at(-1).svgText, /^<svg [^>]*width="210mm" height="297mm" viewBox="0 0 210 297"/);
  // 파일 안 도형은 보정한 장면이에요: 보정 없는 SVG 와 달라요(같으면 보정이 산출물에 안 닿은 거예요).
  assert.notEqual(new TextDecoder().decode(svg.bytes), new TextDecoder().decode(h.downloads[0].bytes));
});

test('배율 보정 칸: 범위 밖(45.0–51.0 mm) · 숫자 아님은 마지막 유효 값을 지키고 상태 줄에 사유 조각 — 다음 유효 값에서 사라져요', async () => {
  for (const lang of ['ko', 'en']) {
    const h = createCubeMakeHarness({lang});
    await h.expand();
    await h.input('makePaperBarMm', '48.3');
    // 숫자 아닌 글자(abc · 4e · - · 공백)는 하네스가 브라우저처럼 value '' + validity.badInput 으로 넘겨요 — 빈 칸(되돌리기)과 갈라야 해요.
    for (const bad of ['44.9', '51.1', '0', '-48.3', 'abc', '1e9', '4e', '-', '  ']) {
      await h.input('makePaperBarMm', bad);
      const text = h.$('makePaperStatus').textContent;
      assert.deepEqual([h.state().barUm, h.$('makePaperBarMm').value, h.storage.map.get(BAR_KEY)], [48300, '48.3', '48.3'], `${lang}/${bad}`);
      assert.ok(text.includes(barErrorItem(h, '48.3')), `${lang}/${bad}: ${text}`);
      assert.ok(text.includes(scaleItem(h, '1.035', '48.3')), `${lang}/${bad}: 이전 값으로 계속 보정해요`);
      if (lang !== 'ko') assert.doesNotMatch(text, HANGUL, `${lang}/${bad}`);
    }
    // 눈금(0.1 mm)에 맞춘 뒤 범위를 봐요: 44.96 → 45.0 · 51.04 → 51.0 은 받아요.
    await h.input('makePaperBarMm', '44.96');
    assert.equal(h.state().barUm, 45000);
    assert.ok(!h.$('makePaperStatus').textContent.includes(barErrorItem(h, '48.3')), `${lang}: 유효 값이면 사유가 사라져요`);
    await h.input('makePaperBarMm', '51.04');
    assert.deepEqual([h.state().barUm, h.$('makePaperBarMm').value], [51000, '51'], lang);
  }
});

test('배율 보정 되돌리기: ↺ 버튼 · 빈 칸은 50 mm(보정 없음) — 저장소에서도 지우고, 사유 조각 · 파일명 꼬리표가 사라져요', async () => {
  const h = createCubeMakeHarness();
  await h.expand();
  await h.input('makePaperBarMm', '48.3');
  await h.input('makePaperBarMm', 'abc');
  assert.ok(h.$('makePaperStatus').textContent.includes(barErrorItem(h, '48.3')));
  await h.click('makePaperBarReset');
  assert.deepEqual([h.state().barUm, h.$('makePaperBarMm').value, h.storage.map.has(BAR_KEY), h.$('makePaperBarReset').disabled], [50000, '50', false, true]);
  assert.ok(!h.$('makePaperStatus').textContent.includes(barErrorItem(h, '48.3')), '되돌리면 사유도 지워요');
  assert.ok(!h.$('makePaperStatus').textContent.includes(scaleHead(h)));
  await h.click('makePaperSvg');
  assert.doesNotMatch(h.downloads.at(-1).filename, /-k\d+\.svg$/);
  await h.input('makePaperBarMm', '49');
  assert.equal(h.storage.map.get(BAR_KEY), '49');
  // 정말 빈 칸(badInput 아님)만 되돌리기예요. 공백 · 틀린 글자는 브라우저에서 badInput 이라 위 사유 조각 쪽이에요.
  await h.input('makePaperBarMm', '');
  assert.deepEqual([h.state().barUm, h.$('makePaperBarMm').value, h.storage.map.has(BAR_KEY)], [50000, '50', false]);
});

test('배율 보정 ↺: 키보드로 누르면(버튼에 포커스) 막히는 버튼 대신 칸으로 포커스를 옮기고, 포커스가 없던 클릭은 옮기지 않아요', async () => {
  const h = createCubeMakeHarness();
  await h.expand();
  const bar = h.$('makePaperBarMm'), reset = h.$('makePaperBarReset');
  await h.input('makePaperBarMm', '48.3');
  h.c.document.activeElement = reset;
  await h.click('makePaperBarReset');
  assert.equal(reset.disabled, true);
  assert.equal(h.c.document.activeElement, bar, '막힌 버튼에 포커스가 남으면 body 로 떨어져요');
  h.c.document.activeElement = null;
  await h.input('makePaperBarMm', '48.3');
  await h.click('makePaperBarReset');
  assert.equal(h.c.document.activeElement, null);
});

test('배율 보정 기억: 저장한 값을 다음에 열 때 읽고, 틀린 저장 값 · 던지는 저장소에서도 기본값으로 동작해요(저장에 실패해도 적용은 돼요)', async () => {
  const saved = createCubeMakeHarness({storage: memoryStorage({[BAR_KEY]: '48.3'})});
  assert.equal(saved.state().barUm, 48300, '저장소에 실제로 닿아 읽었어요');
  await saved.expand();
  assert.equal(saved.$('makePaperBarMm').value, '48.3');
  assert.ok(saved.$('makePaperStatus').textContent.includes(scaleItem(saved, '1.035', '48.3')));
  for (const stored of ['abc', '60', '44', '', '48.3mm']) assert.equal(createCubeMakeHarness({storage: memoryStorage({[BAR_KEY]: stored})}).state().barUm, 50000, stored);
  const blocked = throwingStorage();
  const h = createCubeMakeHarness({storage: blocked});
  assert.equal(h.state().barUm, 50000);
  assert.equal(blocked.calls, 1, '읽기를 한 번 시도했어요');
  await h.expand();
  await h.input('makePaperBarMm', '48.3');
  assert.equal(h.state().barUm, 48300, '저장하지 못해도 이 쪽에서는 적용돼요');
  await h.click('makePaperSvg');
  assert.match(h.downloads.at(-1).filename, /-k966\.svg$/);
  await h.click('makePaperBarReset');
  assert.equal(h.state().barUm, 50000);
  assert.equal(blocked.calls, 3, '쓰기 · 지우기도 시도했어요');
});

test('배율 보정은 용지 크기마다 따로예요: A4 값이 A3 에 번지지 않고, 돌아오면 A4 값이 남아요(저장소가 막혀도) — 용지를 바꾸면 틀린 값 사유도 지워요', async () => {
  for (const storage of [memoryStorage(), throwingStorage()]) {
    const label = storage.map ? 'memory' : 'throwing';
    const h = createCubeMakeHarness({storage});
    await h.expand();
    const status = () => h.$('makePaperStatus').textContent;
    await h.input('makePaperBarMm', '48.3');
    await h.input('makePaperBarMm', '60');
    assert.ok(status().includes(barErrorItem(h, '48.3')), label);
    await h.select('makePaperSize', 'A3');
    assert.deepEqual([h.state().paper, h.state().barUm, h.$('makePaperBarMm').value, h.$('makePaperBarReset').disabled], ['A3', 50000, '50', true], label);
    assert.ok(!status().includes(barErrorItem(h, '48.3')), `${label}: 앞 용지의 사유가 남았어요`);
    assert.ok(!status().includes(scaleHead(h)), `${label}: A4 보정이 A3 에 번졌어요 — ${status()}`);
    await h.click('makePaperSvg');
    assert.doesNotMatch(h.downloads.at(-1).filename, /-k\d+\.svg$/, label);
    await h.input('makePaperBarMm', '48.8');
    assert.ok(status().includes(scaleItem(h, '1.025', '48.8', 'k=0.976')), `${label}: ${status()}`);
    await h.select('makePaperSize', 'A4');
    assert.deepEqual([h.state().barUm, h.$('makePaperBarMm').value], [48300, '48.3'], label);
    await h.select('makePaperSize', 'A3');
    assert.equal(h.state().barUm, 48800, label);
    if (storage.map) assert.deepEqual(Object.fromEntries(storage.map), {[barKey('A4')]: '48.3', [barKey('A3')]: '48.8'});
  }
  // 새 페이지(같은 저장소): 용지마다 저장 값을 읽어요. 저장하지 않은 용지는 50 mm(보정 없음)예요.
  const h = createCubeMakeHarness({storage: memoryStorage({[barKey('A4')]: '48.3', [barKey('A3')]: '48.8'})});
  assert.equal(h.state().barUm, 48300);
  await h.expand();
  for (const [paper, um] of [['A3', 48800], ['Letter', 50000], ['A4', 48300]]) {
    await h.select('makePaperSize', paper);
    assert.equal(h.state().barUm, um, paper);
  }
});

test('배율 보정은 절대값이에요: 보정 도안(k=…)을 인쇄하면 안내가 «막대가 50 mm 여야 · 다르면 그 길이를 적지 말고 ↺» 로 바뀌고, 보정 중에 적은 값은 겹치지 않고 바뀌어요', async () => {
  const h = createCubeMakeHarness({raf: 'manual'});
  await h.expand();
  const status = () => h.$('makePaperStatus').textContent;
  await h.input('makePaperBarMm', '48.3');
  const notice = h.text('g1138').replace('{k}', printScaleTag(0.966));
  let job = h.click('makePaperPrint');
  assert.ok(status().endsWith(notice), `인쇄 전: ${status()}`);
  assert.ok(!status().includes(h.text('g1120')), '보정 도안에 «잰 길이를 칸에 적어요» 안내를 보이면 보정이 덮어써져요');
  h.release();
  await job;
  assert.ok(status().endsWith(notice), `인쇄 후: ${status()}`);
  // 절대값: 보정 도안에서 잰 49.8 을 적으면 s = 0.996 이에요(0.966 × 0.996 로 겹치지 않아요) — 그래서 안내가 적지 말라고 해요.
  await h.input('makePaperBarMm', '49.8');
  assert.equal(h.state().barUm, 49800);
  assert.ok(status().includes(scaleItem(h, '1.004', '49.8', 'k=0.996')), status());
  // 되돌리면 안내도 g1120(보정 없는 도안 — 잰 길이를 칸에 적어요)으로 돌아와요.
  await h.click('makePaperBarReset');
  job = h.click('makePaperPrint');
  h.release();
  await job;
  assert.ok(status().endsWith(h.text('g1120')), status());
});

test('배율 보정 중 SVG · PNG · PDF 버튼 설명은 «×1.035 로 그린 파일 · 커팅기 · 편집용 실척은 ↺ 후» 를 붙이고, 인쇄 버튼 · 보정 없음에는 안 붙여요', async () => {
  for (const lang of ['ko', 'en']) {
    const h = createCubeMakeHarness({lang});
    await h.expand();
    const note = h.text('g1139').replace('{k}', 'k=0.966').replace('{factor}', '1.035');
    const noted = () => PAPER_IDS.filter((id) => h.$(id).title.includes(note));
    assert.deepEqual(noted(), [], lang);
    await h.input('makePaperBarMm', '48.3');
    assert.deepEqual(noted(), ['makePaperSvg', 'makePaperPng', 'makePaperPdf'], lang);
    for (const [id, desc] of [['makePaperSvg', 'g1051'], ['makePaperPng', 'g1053'], ['makePaperPdf', 'g1055']]) assert.equal(h.$(id).title, `${h.text(desc)} — ${note}`, `${lang}/${id}`);
    assert.equal(h.$('makePaperPrint').title, h.text('g1057'), lang);
    await h.click('makePaperBarReset');
    assert.deepEqual(noted(), [], lang);
  }
});

test('배율 보정 값은 이 브라우저에만: 생성기 저장 · 공유 · URL 상태에 싣지 않아요(저장소 키는 슬라이스 한 곳, data-state-keys 에 없음)', () => {
  const key = `'${BAR_PREFIX}'`;
  assert.equal(INDEX.split(key).length - 1, 1, '저장소 키 문자열은 한 곳에서만 써요');
  assert.ok(SLICE.includes(key));
  const stateKeys = [...INDEX.matchAll(/data-state-keys="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.ok(stateKeys.length >= 20, `상태 키 유도가 무너졌어요(${stateKeys.length})`);
  assert.deepEqual(stateKeys.filter((k) => /bar|scale/i.test(k)), []);
  const {byId} = parseMarkup(MARKUP);
  for (const id of ['makePaperBarMm', 'makePaperBarReset']) assert.deepEqual(Object.keys(byId.get(id).attrs).filter((a) => a.startsWith('data-state')), [], id);
  // 슬라이스는 생성기 상태 · 주소창을 쓰지 않아요(cubeMakeState 는 페이지 안 옵션이에요).
  assert.doesNotMatch(SLICE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''), /generatorState\.[A-Za-z]+\s*=|history\.|location\.|URLSearchParams/);
});

test('배율 보정 문구: 여덟 언어의 상태 줄 조각이 마침표로 끝나지 않고 자리표시자를 다 갖고, 도움말 g1045 · 인쇄 안내 g1120 · g1138 · PDF 설명 g1055 가 칸 이름과 드라이버 · 절대값 의미를 말해요', async () => {
  for (const lang of LANGS) {
    const h = createCubeMakeHarness({lang});
    await h.expand();
    await h.input('makePaperBarMm', '48.3');
    await h.input('makePaperBarMm', '60');
    const text = h.$('makePaperStatus').textContent, segments = text.split(' · ');
    assert.ok(segments.length >= 4, `${lang}: ${text}`);
    assert.deepEqual(segments.filter((s) => /[.。]$/.test(s)), [], lang);
    if (lang !== 'ko') assert.doesNotMatch(text, HANGUL, lang);
    const d = h.dict[lang];
    for (const [key, holes] of [['g1135', ['{k}', '{factor}', '{bar}']], ['g1136', ['{min}', '{max}', '{bar}']], ['g1138', ['{k}']], ['g1139', ['{k}', '{factor}']]]) for (const hole of holes) assert.ok(d[key].includes(hole), `${lang}/${key} ${hole}`);
    // 칸 라벨 «배율 보정 — …» 의 앞 이름을 도움말 · 인쇄 전 안내 · PDF 설명이 그대로 불러요(라벨을 바꾸면 안내도 따라가야 해요).
    const fieldName = d.g1133.split(' — ')[0], lower = fieldName.toLowerCase();
    assert.ok(fieldName.length >= 4 && fieldName !== d.g1133, `${lang}: 라벨 «이름 — 설명» 꼴`);
    assert.ok(d.g1045.includes(fieldName), `${lang}: g1045 가 칸 이름(${fieldName})을 안 불러요`);
    assert.ok(d.g1045.includes('Class Driver'), `${lang}: g1045 드라이버 예`);
    for (const key of ['g1120', 'g1138', 'g1055']) assert.ok(d[key].toLowerCase().includes(lower), `${lang}: ${key} 가 칸 이름을 안 불러요`);
    // 절대값 의미: 보정 도안(캡션 k=…)이면 «적지 말고 ↺» — 도움말 · 칸 설명 · 보정 도안 안내가 말하고, 보정 없는 안내 g1120 은 «적어요» 쪽이라 ↺ 가 없어요.
    for (const key of ['g1045', 'g1134']) assert.ok(d[key].includes('k=0.966') && d[key].includes('↺'), `${lang}: ${key} 가 캡션 k= 와 ↺ 를 설명하지 않아요`);
    assert.ok(d.g1138.includes('↺') && !d.g1120.includes('↺'), lang);
    // g1138 의 인쇄 설정 조각은 g1120 에서 유도해요(끝 두 조각 «인쇄 후 재기 · 다르면 적기» 만 달라요) — 설정 문구를 한쪽만 고치면 빨개져요.
    const settings = d.g1120.split(' · ').slice(0, -2);
    assert.ok(settings.length >= 4, `${lang}: ${d.g1120}`);
    assert.deepEqual(d.g1138.split(' · ').slice(0, settings.length), settings, lang);
    assert.deepEqual(d.g1138.split(' · ').filter((s) => /[.。]$/.test(s)), [], `${lang}: 인쇄 안내 조각`);
    // PDF 도 같은 드라이버를 거쳐요 — «실척 인쇄에 가장 확실해요» 류 주장을 되살리지 않아요(운영자 실측: 줄임은 드라이버에서 나요).
    assert.doesNotMatch(d.g1055, /가장 확실|most reliable|最も確実|le plus sûr|più sicuro|zuverlässigste|más fiable|mais fiável/, lang);
  }
});

test('배선: 슬라이스가 쓰는 src export 는 index.html 이 그 모듈에서 import 해요 — 하네스는 모듈을 통째로 주입해서 import 누락을 못 봐요(자 검증 포함)', () => {
  const modules = {'cube-physical': cubePhysicalModule, 'paper-net': paperNetModule, 'pdf-writer': pdfWriterModule, 'print-mesh': printMeshModule, 'mesh-export': meshExportModule};
  const code = SLICE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const missing = (source) => {
    const out = [];
    for (const [name, mod] of Object.entries(modules)) {
      const m = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'\\./src/${name}\\.js'`).exec(source);
      const imported = new Set((m?.[1] ?? '').split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean));
      for (const exp of Object.keys(mod)) if (new RegExp(`\\b${exp}\\b`).test(code) && !imported.has(exp)) out.push(`${name}:${exp}`);
    }
    return out.sort();
  };
  assert.deepEqual(missing(INDEX), []);
  const dropped = INDEX.replace('CALIBRATION_BAR_MM, PRINT_SCALE_MIN, PRINT_SCALE_MAX,', '');
  assert.notEqual(dropped, INDEX, '변이 자리를 못 찾았어요');
  assert.deepEqual(missing(dropped), ['paper-net:CALIBRATION_BAR_MM', 'paper-net:PRINT_SCALE_MAX', 'paper-net:PRINT_SCALE_MIN']);
});

test('자 검증: 배율 보정 자는 심은 결함에서 빨개져요(범위 밖을 끝값으로 자르기 · 계획에 s 안 넘기기 · 저장 안 하기 · badInput 무시 · 용지별 값 안 읽기 · 보정 도안 안내 없음)', async () => {
  // ① 범위 밖을 끝값으로 자르는 핸들러: «이전 값을 지켜요» 자가 잡아요.
  {
    const h = createCubeMakeHarness({source: mutate('return um>=min&&um<=max?um:null;', 'return Math.min(max,Math.max(min,um));')});
    await h.expand();
    await h.input('makePaperBarMm', '48.3');
    await h.input('makePaperBarMm', '44.9');
    assert.notEqual(h.state().barUm, 48300, '결함을 심었는데 이전 값이 남았어요 — 자가 비어 있어요');
  }
  // ② 계획에 printScale 을 안 넘기는 모델: 파일명 꼬리표 자가 잡아요.
  {
    const h = createCubeMakeHarness({source: mutate('method:pick.method,printScale});', 'method:pick.method});')});
    await h.expand();
    await h.input('makePaperBarMm', '48.3');
    await h.click('makePaperSvg');
    assert.doesNotMatch(h.downloads.at(-1).filename, /-k966\.svg$/);
  }
  // ③ 저장하지 않는 핸들러: 저장소 자가 잡아요.
  {
    const h = createCubeMakeHarness({source: mutate('cubeMakeState.barUm=um;cubeMakeBarSave(cubeMakeState.paper,um);', 'cubeMakeState.barUm=um;')});
    await h.expand();
    await h.input('makePaperBarMm', '48.3');
    assert.equal(h.storage.map.has(BAR_KEY), false);
  }
  // ④ badInput 을 안 보는 핸들러: 브라우저가 넘기는 '' 를 빈 칸으로 읽어 보정을 끄고 저장 값을 지워요 — «숫자 아님은 이전 값» 자가 잡아요.
  {
    const h = createCubeMakeHarness({source: mutate('um=input.validity?.badInput?null:cubeMakeBarParse(input.value);', 'um=cubeMakeBarParse(input.value);')});
    await h.expand();
    await h.input('makePaperBarMm', '48.3');
    await h.input('makePaperBarMm', 'abc');
    assert.deepEqual([h.state().barUm, h.storage.map.has(BAR_KEY)], [50000, false], '결함을 심었는데 이전 값이 남았어요 — 하네스가 badInput 을 흉내 내지 않아요');
  }
  // ⑤ 용지를 바꿔도 값을 다시 읽지 않는 핸들러: A4 보정이 A3 에 번져요 — 용지별 자가 잡아요.
  {
    const h = createCubeMakeHarness({source: mutate('cubeMakeState.paper=paper;cubeMakeState.barUm=cubeMakeBarLoad(paper);', 'cubeMakeState.paper=paper;')});
    await h.expand();
    await h.input('makePaperBarMm', '48.3');
    await h.select('makePaperSize', 'A3');
    assert.equal(h.state().barUm, 48300);
  }
  // ⑥ 보정 도안에도 «잰 길이를 칸에 적어요» 안내(g1120)를 보이는 인쇄: 절대값 자가 잡아요.
  {
    const h = createCubeMakeHarness({source: mutate("function cubeMakePrintNotice(plan){return plan?.printScale===undefined?t('g1120'):tf('g1138',cubeMakeScaleVars(plan));}", "function cubeMakePrintNotice(plan){return t('g1120');}")});
    await h.expand();
    await h.input('makePaperBarMm', '48.3');
    await h.click('makePaperPrint');
    assert.ok(h.$('makePaperStatus').textContent.endsWith(h.text('g1120')));
  }
});

// ── i18n · 코드 표 · 배선 ───────────────────────────────────────────────

test('TLP 코드 표: src 가 쓰는 모든 TLP_* 에 g-키가 있고 그 키가 여덟 언어에 있어요(자 검증: 한 줄 빼면 잡혀요)', () => {
  const codes = new Set();
  for (const file of readdirSync(new URL('../src/', import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/['"`](TLP_[A-Z0-9_]+)['"`]/g)) codes.add(m[1]);
  }
  assert.ok(codes.size >= 13, `TLP 코드 유도가 무너졌어요(${codes.size})`);
  const table = codeKeyTable(SLICE);
  assert.deepEqual(missingCodeKeys(table, codes), []);
  const dict = createCubeMakeHarness().dict;
  for (const key of Object.values(table)) for (const lang of LANGS) assert.ok(typeof dict[lang][key] === 'string' && dict[lang][key].length > 0, `${lang}/${key}`);
  const {TLP_TOPOLOGY, ...withoutTopology} = table;
  assert.ok(TLP_TOPOLOGY);
  assert.deepEqual(missingCodeKeys(withoutTopology, codes), ['TLP_TOPOLOGY']);
});

test('i18n: 섹션이 부르는 모든 키가 여덟 언어에 있고, 4자리 help 키는 유일하며 비-ko 에 한국어가 없어요', () => {
  const dict = createCubeMakeHarness().dict;
  const keys = referencedKeys(MARKUP, SLICE);
  assert.ok(keys.length >= 70, `키 유도가 무너졌어요(${keys.length})`);
  const missing = (list) => list.filter((key) => LANGS.some((lang) => typeof dict[lang][key] !== 'string'));
  assert.deepEqual(missing(keys), []);
  for (const key of keys) for (const lang of LANGS.slice(1)) assert.doesNotMatch(dict[lang][key], HANGUL, `${lang}/${key}`);
  // 기존 도움말 자(generator-help-ui)는 3자리 키만 봐요. 4자리 help 키는 여기서 존재 · 유일 · 속성을 재요.
  const dots = [...INDEX.matchAll(/<button type="button" class="help-dot" data-help="(g\d{4})"([^>]*)>/g)];
  assert.ok(dots.length >= 5, `4자리 help 키가 너무 적어요(${dots.length})`);
  const helpKeys = dots.map((m) => m[1]);
  assert.equal(new Set(helpKeys).size, helpKeys.length, `help 키 중복: ${helpKeys}`);
  for (const [, key, rest] of dots) {
    assert.match(rest, /aria-expanded="false"/);
    assert.match(rest, /data-i18n-attr="aria-label:g931"/);
    assert.deepEqual(missing([key]), [], key);
  }
  for (const key of ['g1043', 'g1045', 'g1047']) {
    assert.ok(helpKeys.includes(key), key);
    for (const lang of LANGS) assert.ok(dict[lang][key].split('\n').length >= 3, `${lang}/${key} 도움말이 너무 짧아요`);
  }
  // 자 검증: 사전에 없는 키를 부르는 마크업이면 잡혀요.
  assert.deepEqual(missing(referencedKeys(MARKUP.replace('data-help="g1045"', 'data-help="g9999"'), SLICE).filter((k) => k === 'g9999')), ['g9999']);
});

test('배선: TEXT_SYNCERS 등록 · syncHUi 가 부름 · 새 모듈 6개가 import 되고 MODULE_ORDER 에 있어요 · 스탬프 형식', () => {
  const syncers = /const TEXT_SYNCERS = \[([\s\S]*?)\];/.exec(INDEX)[1].split(',').map((s) => s.trim());
  assert.ok(syncers.includes('syncCubeMakeUi'));
  const syncHUi = INDEX.slice(INDEX.indexOf('function syncHUi(){'), INDEX.indexOf('\n}\n', INDEX.indexOf('function syncHUi(){')));
  assert.match(syncHUi, /syncCubeMakeUi\(\);/);
  const modules = ['cube-physical', 'paper-net', 'pdf-writer', 'print-sheet', 'print-mesh', 'mesh-export'];
  for (const name of modules) {
    assert.match(INDEX, new RegExp(`from '\\./src/${name}\\.js'`), name);
    assert.ok(MODULE_ORDER.includes(name), name);
    assert.ok(MODULE_ORDER.indexOf(name) > MODULE_ORDER.indexOf('png') && MODULE_ORDER.indexOf(name) > MODULE_ORDER.indexOf('h-profile'), name);
  }
  assert.ok(MODULE_ORDER.indexOf('print-mesh') > MODULE_ORDER.indexOf('cube-physical'));
  assert.match(/const GENERATOR_BUILD = '([^']+)'/.exec(INDEX)[1], /^\d{4}-\d{2}-\d{2}\.\d{2}$/);
});

// ── 자 검증: 핸들러에 결함을 심은 변이 원문 ─────────────────────────────

/** 슬라이스 안 문자열 하나를 바꾼 index.html 원문(바꿀 자리가 정확히 하나여야 해요). */
function mutate(from, to) {
  const count = SLICE.split(from).length - 1;
  assert.equal(count, 1, `변이 자리를 못 찾았어요: ${from}`);
  return INDEX.replace(SLICE, SLICE.replace(from, to));
}

test('자 검증: 파일명 · busy · 게이트 · 오류 문구 자는 심은 결함에서 빨개져요', async () => {
  // ① 파일명에서 -hollow 를 빼먹은 핸들러
  {
    const h = createCubeMakeHarness({source: mutate("${plan.enabled?'-hollow':''}", '')});
    await h.expand();
    await h.click('makePrint3mf');
    assert.notEqual(h.downloads[0].filename, 'old_print-c2000um-d1000um-hollow-rf3.3mf');
  }
  // ② busy 를 세우지 않는 핸들러
  {
    const h = createCubeMakeHarness({source: mutate('cubeMakeBusy[group]=id;cubeMakeNotes', 'cubeMakeNotes'), raf: 'manual'});
    await h.expand();
    const job = h.click('makePaperPdf');
    assert.notDeepEqual(busyProblems(h, PAPER_IDS, PRINT_IDS), []);
    h.release();
    await job;
  }
  // ③ 시험판 게이트를 빼먹은 표시 조건
  {
    const h = createCubeMakeHarness({source: mutate('function cubeMakeVisible(){return isLabPath()&&hGeneratorActive();}', 'function cubeMakeVisible(){return hGeneratorActive();}'), lab: false});
    h.sync();
    assert.equal(h.$('cubeMakeSection').hidden, false, '게이트 결함이 드러나야 해요');
  }
  // ④ 예외 원문을 그대로 흘리는 오류 문구
  {
    const plain = new RangeError('한국어 내부 메시지');
    const h = createCubeMakeHarness({lang: 'en', source: mutate("return tf('g1116',{code:code||String(error?.name||'Error')});", 'return String(error.message);'),
      overrides: {buildPrintParts: () => { throw plain; }}});
    await h.expand();
    await h.click('makePrint3mf');
    assert.match(h.$('makePrintStatus').textContent, HANGUL);
  }
  // ⑤ 6F 에서 «켬» 카드를 막지 않는 핸들러
  {
    const h = createCubeMakeHarness({source: mutate('card.disabled=blocked;', 'card.disabled=false;'), current: hCurrent('six', {version: 0, mode: 6})});
    await h.expand();
    assert.equal(h.$('makeHollowCards').children.find((c) => c.dataset.hollow === 'on').disabled, false);
  }
});

// ── full: 실제 PNG · 모드 전수 ─────────────────────────────────────────

fullOnly(() => test('full: PNG 도안은 실제 300 dpi(A4 2480 × 3508, pHYs 11811 ppm)예요', async () => {
  const h = createCubeMakeHarness();
  await h.expand();
  await h.click('makePaperPng');
  const bytes = h.downloads[0].bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(16), 2480);
  assert.equal(view.getUint32(20), 3508);
  const at = new TextDecoder('latin1').decode(bytes).indexOf('pHYs');
  assert.ok(at > 0);
  assert.equal(view.getUint32(at + 4), 11811);
  assert.equal(view.getUint32(at + 8), 11811);
}));

fullOnly(() => test('full: 모드 1–6 × 톤 2/3 × 배치에서 3MF 파일명(rf · hollow)과 속 비우기 판정이 print-mesh 와 같고 밀폐 공동이 없어요', async () => {
  let checked = 0;
  for (const mode of [1, 2, 3, 4, 5, 6]) for (const tones of [2, 3]) for (const arrangement of H_ARRANGEMENTS) for (const renderFaces of [3, 6]) {
    const current = hCurrent(`m${mode}`, {version: 2, mode, tones, arrangement, renderFaces, text: Uint8Array.of(mode), ecc: 'M', mask: mode % 8, finder: 'frame'});
    try { hDisplayMap(current.encoded, {arrangement, renderFaces}); } catch { continue; }
    const map = hDisplayMap(current.encoded, {arrangement, renderFaces});
    const h = createCubeMakeHarness({current});
    await h.expand();
    await h.click('makePrint3mf');
    const plan = hollowPlan(physOf(current, 2000), {depthUm: 1000});
    const label = `${mode}F/${tones}톤/${arrangement}/rf${renderFaces}`;
    assert.equal(h.downloads[0].filename, `m${mode}_print-c2000um-d1000um${plan.enabled ? '-hollow' : ''}-rf${map.renderFaces}.3mf`, label);
    assert.equal(h.$('makeHollowCards').children.find((c) => c.dataset.hollow === 'on').disabled, plan.reason === 'TLP_NO_VENT_FACE', label);
    const core = coreOf(h.downloads[0].bytes);
    assert.equal(surfaceComponents(core.mesh), 1, label);
    assert.deepEqual(core.model.buildTranslations, [[...printBedPlacement(physOf(current, 2000).sideUm).translationMm]], label);
    const duplicateNote = h.$('makePrintStatus').textContent.includes(h.text(map.renderFaces === 6 ? 'g1095' : 'g1096'));
    assert.equal(duplicateNote, mode <= 3 && map.arrangement !== 'symmetric', label);
    checked += 1;
  }
  assert.ok(checked >= 20, `조합 유도가 무너졌어요(${checked})`);
}));

test('숨은 탭: rAF 가 끝내 오지 않아도 타이머 폴백으로 내보내기가 끝나요', async () => {
  const h = createCubeMakeHarness({raf: 'manual'});
  await h.expand();
  const job = h.click('makePaperPdf');
  await job; // release() 없이 끝나야 해요
  assert.equal(h.downloads.length, 1);
  assert.equal(h.pendingFrames(), 1, 'rAF 는 여전히 대기 중이어야 폴백 경로로 끝난 것이 확인돼요');
  assert.deepEqual(busyProblems(h, [], ALL_IDS), []);
});
