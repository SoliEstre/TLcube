import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('3D 다운로드 두 행만 6px로 띄우고 다운로드와 복사 버튼 묶음은 유지해요',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/#cubeExportSection\s*>\s*\.export-row\s*\+\s*\.export-row\s*\{\s*margin-top:\s*6px;\s*\}/);
  const section=html.match(/<section id="cubeExportSection"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.equal((section.match(/class="row export-row"/g)||[]).length,2);
  for(const pair of [['exportNetPng','copyNetPng'],['exportNetSvg','copyNetSvg'],['exportCubeGltf','copyCubeGltf']]){
    assert.ok([...section.matchAll(/<div class="export-pair">([\s\S]*?)<\/div>/g)].some(m=>pair.every(id=>m[1].includes(`id="${id}"`))));
  }
});
