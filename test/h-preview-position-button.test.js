import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileHPositionMode} from '../src/h-preview-decor.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('새 사각 로케이터 프로필은 면 확인을 밖으로 바꾸고 명시 선택은 같은 프로필에서 유지해요',()=>{
  const frame={version:2,mode:3,finder:'frame'},corners={version:8,mode:6,finder:'corners'};
  for(const mode of ['none','inside','outside']){
    assert.equal(reconcileHPositionMode(mode,null,corners),'outside');
    assert.equal(reconcileHPositionMode(mode,frame,corners),'outside');
    assert.equal(reconcileHPositionMode(mode,corners,{...corners}),mode);
    assert.equal(reconcileHPositionMode(mode,corners,{...corners,version:7}),'outside');
    assert.equal(reconcileHPositionMode(mode,corners,{...corners,mode:3}),'outside');
    assert.equal(reconcileHPositionMode(mode,corners,frame),mode);
  }
  assert.equal(reconcileHPositionMode('invalid',corners,corners),'outside');
  assert.match(html,/import \{[^}]*reconcileHPositionMode[^}]*\} from '\.\/src\/h-preview-decor\.js'/);
  assert.match(html,/hFacePositionMode=reconcileHPositionMode\(hFacePositionMode,hPositionProfile,result\.encoded\)/);
  assert.match(html,/else hPositionProfile=null;/);
  assert.match(html,/data-h-position-mode="none"[^>]*>면 확인 없음<\/button>/);
});

test('원근 바는 뒤의 일반/모바일 y3d-range 고정 폭보다 높은 우선순위로 채워요',()=>{
  assert.match(html,/#y3dBar #y3dViewRow \.y3d-range\s*\{\s*width:100%;min-width:0;\s*\}/);
  assert.match(html,/#y3dViewRow\s*\{[^}]*grid-template-columns:auto 30px minmax\(45px,1fr\) 30px auto;/);
});

test('위치 확인은 정렬 버튼 뒤의 우측 세 버튼이며 빈 면 유무와 독립이에요',()=>{
  const row=html.slice(html.indexOf('<div class="y3d-row" id="y3dOrbitRow"'),html.indexOf('<div class="y3d-row" id="y3dViewRow"'));
  assert.match(row,/<div[^>]*id="hFacePositionCheck"[^>]*role="group"[^>]*aria-controls="hPreviewLabels"/);
  for(const mode of ['none','outside','inside'])assert.match(row,new RegExp('<button[^>]*data-h-position-mode="'+mode+'"'));
  assert.ok(row.indexOf('id="hAlignVertical"')<row.indexOf('id="hFacePositionCheck"'));
  assert.match(html,/#hFacePositionCheck\s*\{\s*margin-left:auto;/);
  assert.match(html,/positionGroup\.hidden=!hGeneratorActive\(\);/);
  assert.doesNotMatch(html,/<input[^>]*id="hFacePositionCheck"/);
  assert.equal((html.match(/id="hFacePositionCheck"/g)||[]).length,1);
});

test('위치 확인 기본은 큐브 밖이고 모드·눌림·렌더가 같은 선택을 써요',()=>{
  assert.match(html,/let hFacePositionMode='outside';/);
  assert.match(html,/const on=button\.dataset\.hPositionMode===hFacePositionMode;/);
  assert.match(html,/button\.classList\.toggle\('on',on\);button\.setAttribute\('aria-pressed',String\(on\)\);/);
  assert.match(html,/hFacePositionMode=button\.dataset\.hPositionMode;syncHFaceImagesUi\(\);paintY3dPreview\(\);/);
  assert.match(html,/positionMode:hFacePositionMode/);
  assert.match(html,/host\.hidden=hFacePositionMode==='none'/);
});

test('안쪽 배지는 기존 16보다 작은 12이고 바깥 글자는 12의 두 배 24예요',()=>{
  assert.match(html,/\.h-preview-face-label span\s*\{[^}]*padding:1px 2px;[^}]*font:700 12px\/1\.1/);
  assert.match(html,/\.h-preview-face-label\.h-callout\s*\{ width:64px;height:40px;/);
  assert.match(html,/\.h-preview-face-label\.h-callout span\s*\{[^}]*font:700 24px\/40px/);
  assert.match(html,/positionInsideNote/);
});
