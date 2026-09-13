import test from 'node:test';
import assert from 'node:assert/strict';
import {hContentFitsSingleView,hContentFitsVisibleFaces} from '../src/h-face-arrangement.js';
import {hCanPreview25,hPlanarPreviewOptions,hQuadHomography,hBlankFaceLabels,hCubeIconMarkup} from '../src/h-preview-decor.js';
import {reconcileHContentRotation,selectHAlignmentPose,selectHRepresentation,selectHRotationMode,selectHRotationSpeed} from '../src/generator-h.js';
import {createGeneratorState} from '../src/generator-state.js';
import {hModeFaces} from '../src/h-profile.js';
import {hProjection} from '../src/h-render.js';
const encoded=mode=>({mode,version:2,n:21,faces:Object.fromEntries(hModeFaces(mode).map(face=>[face,true]))});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('한 시점에 서로 반대 면은 못 담고 같은 콘텐츠의 반대면 반복은 중복으로 세지 않아요',()=>{
  assert.equal(hContentFitsSingleView(encoded(2),{},{renderFaces:6}),true);
  assert.equal(hContentFitsSingleView(encoded(2),{ZM:{}},{renderFaces:6}),true);
  assert.equal(hContentFitsSingleView(encoded(2),{ZM:{},ZP:{}},{renderFaces:3}),false);
  assert.equal(hContentFitsSingleView(encoded(3),{}),true);
  for(const face of ['ZP','XP','YP'])assert.equal(hContentFitsSingleView(encoded(3),{[face]:{}}),false);
  for(const mode of [4,5,6])assert.equal(hContentFitsSingleView(encoded(mode),{}),false);
  assert.equal(hContentFitsSingleView(encoded(3),{},{arrangement:'horizontal'}),false);
  assert.equal(hContentFitsSingleView(encoded(3),{},{arrangement:'vertical'}),false);
});
test('8개의 시점 방향에서 모두 같은 의미 있는 면 수 판정이에요',()=>{
  for(const x of ['XM','XP'])for(const y of ['YM','YP'])for(const z of ['ZM','ZP']){
    const images={[x]:{},[y]:{},[z]:{}};
    // Only blank targets count; images on code faces cannot introduce phantom content.
    const expected=x==='XM'&&y==='YM';
    assert.equal(hContentFitsSingleView(encoded(2),images),expected);
  }
});
test('2.5D 버튼과 명시적 자동회전 OFF, 이미 실행 중인 ON을 분리해요',()=>{
  const persisted=createGeneratorState({hRotationDirectionX:-1,hRotationDirectionY:1,hAutoRotateIntent:'off'});
  assert.equal(persisted.hRotationDirectionX,-1);assert.equal(persisted.hRotationDirectionY,1);assert.equal(persisted.hAutoRotateIntent,'off');
  const base={type:'Y',yRepresentation:'3d',hFaces:3,hRenderFaces:3,hArrangement:'isometric',hAutoRotate:false,hAutoRotateIntent:'auto',orbitView:'2.5d'};
  assert.equal(hCanPreview25(base),true);assert.equal(hCanPreview25(base,{ZP:{}}),false);
  assert.equal(reconcileHContentRotation(base).hAutoRotate,true);
  const needed=reconcileHContentRotation(base,{ZP:{}});assert.equal(needed.hAutoRotate,true);assert.equal(needed.orbitView,'3d');
  const off={...base,hAutoRotateIntent:'off'};assert.deepEqual(reconcileHContentRotation(off,{ZP:{}}),off);
  assert.equal(reconcileHContentRotation({...base,hAutoRotate:true}).hAutoRotate,true);
});
test('H 첫 선택과 새 H 상태는 회전하고 명시 pause·고정 정렬은 유지해요',()=>{
  const yDefault=createGeneratorState();
  assert.equal(yDefault.yRepresentation,'2.5d');assert.equal(yDefault.hAutoRotate,false);
  const freshH=createGeneratorState({type:'Y',yRepresentation:'3d'});
  assert.equal(freshH.hAutoRotate,true);assert.equal(freshH.hAutoRotateIntent,'auto');
  const paused=createGeneratorState({type:'Y',yRepresentation:'3d',hAutoRotate:false});
  assert.equal(paused.hAutoRotate,false);assert.equal(paused.hAutoRotateIntent,'off');
  const entered=selectHRepresentation({...yDefault,hAutoRotateIntent:'auto'},'3d');
  assert.equal(entered.hAutoRotate,true);
  const fixed=selectHAlignmentPose(entered,'horizontal');
  assert.equal(fixed.hAutoRotate,false);assert.equal(fixed.hAutoRotateIntent,'off');
  assert.deepEqual(reconcileHContentRotation(fixed,{ZP:{}}),fixed);
});
test('H 축 전환은 auto 자이로에만 60°/s를 쓰고 수동 속도는 보존해요',()=>{
  const h=createGeneratorState({type:'Y',yRepresentation:'3d'});
  assert.equal(selectHRotationMode(h,'gyro').hRotationSpeed,60);
  const manual=selectHRotationSpeed(h,28);
  assert.equal(selectHRotationMode(manual,'gyro').hRotationSpeed,28);
});
test('quad homography와 CSS matrix는 네 모서리 및 면 중심의 원근을 보존해요',()=>{
  const corners=[{x:10,y:20},{x:80,y:25},{x:70,y:90},{x:5,y:75}],H=hQuadHomography(corners);
  for(const [i,[u,v]]of [[0,0],[1,0],[1,1],[0,1]].entries()){
    const den=H[6]*u+H[7]*v+1;near((H[0]*u+H[1]*v+H[2])/den,corners[i].x);near((H[3]*u+H[4]*v+H[5])/den,corners[i].y);
  }
  assert.equal(hQuadHomography([{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0}]),null);
  const labels=hBlankFaceLabels(encoded(3),{rotateX:Math.PI,perspective:.3,zoom:1.2},512);assert.ok(labels.length>0);
  for(const row of labels){const m=row.matrix3d.slice(9,-1).split(',').map(Number);for(const [i,[u,v]]of [[0,0],[100,0],[100,100],[0,100]].entries()){
    const w=m[3]*u+m[7]*v+m[15];near((m[0]*u+m[4]*v+m[12])/w,row.points[i].x);near((m[1]*u+m[5]*v+m[13])/w,row.points[i].y);
  }}
});
test('확대는 중심 기준 투영만 바꾸고 면 가림과 장면 크기는 바꾸지 않아요',()=>{
  const a=hProjection(21,{zoom:1}),b=hProjection(21,{zoom:2}),point=[0,0,0];
  assert.equal(a.width,b.width);assert.deepEqual(a.visible,b.visible);
  near(b.project(point).x-b.width/2,2*(a.project(point).x-a.width/2));near(b.project(point).y-b.height/2,2*(a.project(point).y-a.height/2));
  assert.throws(()=>hProjection(21,{zoom:0}),RangeError);
});
test('2.5D는 실제 시점의 콘텐츠를 확인하고 가려진 경우 완전한 시점으로 정렬해요',()=>{
  const source=encoded(3),back={rotateX:Math.PI,perspective:.1};
  assert.equal(hContentFitsVisibleFaces(source,{},back,hProjection(1,back).visible),false);
  const fixed=hPlanarPreviewOptions(source,back);
  assert.equal(hContentFitsVisibleFaces(source,{},fixed,hProjection(1,fixed).visible),true);
  assert.equal(hPlanarPreviewOptions(source,back,{ZP:{}}),null);
  const front={rotateX:0,rotateY:0,rotateZ:.02,perspective:.1};
  assert.deepEqual(hPlanarPreviewOptions(source,front),front);
  const pair=encoded(2),images={ZP:{}};
  const selected=hPlanarPreviewOptions(pair,{renderFaces:3},images);
  assert.ok(selected);assert.equal(hContentFitsVisibleFaces(pair,images,selected,hProjection(1,selected).visible),true);
});
test('코드 배치 아이콘은 선택 면을 표시하고 외곽선을 마지막에 그려요',()=>{
  for(const mode of [2,3,4,5,6]){const icon=hCubeIconMarkup({mode,placements:true});assert.equal((icon.match(/data-face=/g)||[]).length,mode);assert.ok(icon.lastIndexOf('<g ')>icon.lastIndexOf('<polygon '));}
});
