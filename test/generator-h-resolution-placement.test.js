import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('H 해상도/마스크 카드는 기존 해상도 자리의 단일 ID이며 H에서만 기존 카드와 교대해요',()=>{
  for(const id of ['hVersionCards','hMaskCards','hResolutionOptions','resolutionHeading','resolutionHelpDot'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id);
  const resolutionAt=html.indexOf('id="resolutionHeading"'),hAt=html.indexOf('id="hResolutionOptions"'),resCardsAt=html.indexOf('id="resTierCards"');
  assert.ok(resolutionAt>=0&&hAt>resolutionAt&&resCardsAt>hAt,'H 카드는 기존 해상도 제목과 Y/O/K/A 카드 사이에 있어야 한다');
  const oldSidebar=html.slice(html.indexOf('id="hOptions"'),html.indexOf('</section>',html.indexOf('id="hOptions"')));
  assert.ok(!oldSidebar.includes('id="hVersionCards"')&&!oldSidebar.includes('id="hMaskCards"'),'H cards가 이전 sidebar에 중복됐다');
  assert.match(html,/\$\('hResolutionOptions'\)\.hidden=!active/);
  assert.match(html,/els\.resTierCards\.hidden=isH/);assert.match(html,/els\.resTierHint\.hidden=isH/);
  assert.match(html,/#resTierCards\[hidden\], #hResolutionOptions\[hidden\], #resolutionHelpDot\[hidden\] \{ display: none; \}/);
});
test('H는 해상도 제목을 쓰고, H 아닌 타입은 원래 i18n·도움말·ARIA를 보존해요',()=>{
  assert.match(html,/\$\('resolutionHeading'\)\.textContent=t\('g044'\)/);
  assert.match(html,/\$\('resolutionHelpDot'\)\.hidden=active/);
  assert.match(html,/id="hVersionCards" class="card-row" role="group" aria-labelledby="resolutionHeading"/);
  assert.match(html,/id="hMaskCards" class="card-row" role="group" aria-labelledby="hMaskHeading"/);
});
test('H 해상도 단일 요소는 일반/고급 전환과 타입 복귀 때 보이는 패널로 이동해요',()=>{
  const normal={append(child){child.parentElement=this;}},advanced={append(child){child.parentElement=this;}},section={parentElement:normal};
  const context=vm.createContext({mode:'normal',$:id=>({hResolutionHostNormal:normal,hResolutionHostAdvanced:advanced,hResolutionSection:section})[id]});
  const start=html.indexOf('function placeHResolutionControls(active){'),end=html.indexOf('function syncHUi(){',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(html.slice(start,end),context);
  vm.runInContext('placeHResolutionControls(true)',context);assert.equal(section.parentElement,normal);
  vm.runInContext("mode='advanced';placeHResolutionControls(true)",context);assert.equal(section.parentElement,advanced);
  vm.runInContext('placeHResolutionControls(false)',context);assert.equal(section.parentElement,normal);
  vm.runInContext("mode='normal';placeHResolutionControls(true)",context);assert.equal(section.parentElement,normal);
  assert.match(html,/placeHResolutionControls\(active\)/);
});
