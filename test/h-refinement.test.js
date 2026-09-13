import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {encodeY} from '../src/encodeY.js';
import {buildSceneY} from '../src/sceneY.js';
import {hAutoRotation,hProjection,buildHScene,buildHSurface} from '../src/h-render.js';
import {hFacePoint} from '../src/h-layout.js';
import {hVersionIconMarkup,hMaskIconMarkup} from '../src/generator-h.js';
import {generatorCubeModel} from '../src/generator-cube-export.js';
import {yCubeOutline,buildOrbitMesh} from '../src/y3d-viewer.js';
import {layoutForCube} from '../src/ygrid.js';
import {getPreset} from '../src/luminance.js';
import {voxelizeCube} from '../src/minecraft-schematic.js';
import {hScreenSpin} from '../src/h-rotation.js';
const palette={levels:getPreset('mono').levels,background:{r:255,g:255,b:255}};
test('X/Y/gyro 옵션은 화면축 회전의 같은 각속도 정본을 쓴다',()=>{
  for(const axis of ['x','y','gyro'])assert.deepEqual(hAutoRotation(1234,{axis,speed:17}),hScreenSpin(1234,{axis,speed:17}));
});
test('원근 전범위와 회전에서 H 외곽은 화면 안에 있다',()=>{
  for(const perspective of [0,.5,1])for(const rotateX of [0,.8,2])for(const rotateY of [0,1,2]){
    const v=hProjection(41,{perspective,rotateX,rotateY});
    for(const f of ['ZM','XM','YM','ZP','XP','YP'])for(const [i,j]of[[0,0],[0,41],[41,41],[41,0]]){
      const p=v.project(hFacePoint(f,i,j,41));assert.ok(p.x>0&&p.x<v.width&&p.y>0&&p.y<v.height);
    }
  }
});
test('카드 아이콘은 서로 다른 실제 마스크와 밀도를 표현한다',()=>{
  assert.match(hVersionIconMarkup('auto'),/aria-hidden="true"/);
  assert.notEqual(hVersionIconMarkup(0),hVersionIconMarkup(7));
  assert.equal(new Set(Array.from({length:8},(_,i)=>hMaskIconMarkup(i))).size,8);
});
test('H 외곽 확장은 없으며 outline은 본문 모델을 바꾸지 않는다',()=>{
  const e=encodeH('refinement',{version:7,mode:6,mask:0});const s=buildHSurface(e,{palette});
  assert.equal(s.n,e.n);assert.equal(s.offset,0);assert.equal(s.faces.ZM,e.faces.ZM);
  const a=buildHScene(e),b=buildHScene(e,{outline:true});
  assert.equal(b.shapes.length-a.shapes.length,12);assert.deepEqual(a.shapes,b.shapes.slice(0,a.shapes.length));
  const model=generatorCubeModel({type:'H',encoded:e,scene:a,sceneOpts:{palette}});
  const vox=voxelizeCube(model);assert.equal(vox.width,e.n+2);
});
test('Y 전체 mesh는 정위치/전6물리면이며 outline은 숨은 면을 제외한다',()=>{
  const encoded=encodeY('export',{version:0,eccLevel:'H',tones:3}),scene=buildSceneY(encoded,{palette});
  const model=generatorCubeModel({type:'Y',encoded,scene,sceneOpts:{palette}});
  assert.equal(new Set(model.quads.map(q=>q.face)).size,6);
  const n=13,layout=layoutForCube(n,{size:1,margin:2});
  for(const yaw of [0,1,2]){
    const mesh=buildOrbitMesh({n,layout,levels:palette.levels,digitAt:()=>0,yaw,pitch:.2,roll:.1});
    assert.equal(yCubeOutline(mesh,layout).length,9);
  }
});
