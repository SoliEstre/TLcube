import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {hLayout} from '../src/h-layout.js';
import {hModeFaces} from '../src/h-profile.js';
import {hAlignmentRotation} from '../src/h-rotation.js';
import {hDisplayMap} from '../src/h-face-arrangement.js';
import {buildHScene} from '../src/h-render.js';
import {buildHCubeModel,cubeModelToGltf,cubeNetScene} from '../src/cube-export.js';
import {cubeImageVoxelQuads} from '../src/cube-image-export.js';
import {voxelizeCube} from '../src/minecraft-schematic.js';
import {rasterToPng} from '../src/png.js';

const palette={background:{r:255,g:255,b:255},levels:[{r:17,g:31,b:47},{r:71,g:149,b:203},{r:229,g:91,b:43}]};
const levelFor=Object.freeze({ZM:2,XM:0,YM:1,ZP:1,XP:2,YP:0});
const normal=Object.freeze({ZM:[0,0,-1],XM:[-1,0,0],YM:[0,-1,0],ZP:[0,0,1],XP:[1,0,0],YP:[0,1,0]});
function image(r,g,b){const pixels=Uint8ClampedArray.of(r,g,b,255),png=rasterToPng({width:1,height:1,pixels});return{width:1,height:1,pixels,href:'data:image/png;base64,'+Buffer.from(png).toString('base64')};}
const assets=Object.freeze({ZM:image(142,32,33),XM:image(31,149,203),YM:image(17,31,47),ZP:image(71,149,203),XP:image(229,91,43),YP:image(255,255,255)});
function fixture(mode){const encoded=encodeH(`display-map-${mode}`,{version:5,mode,tones:3,ecc:'M',mask:0,finder:'corners'}),probe=hLayout(5,'corners').scan[0];for(const face of hModeFaces(mode)){const levels=encoded.faces[face].slice();levels[probe.i*encoded.n+probe.j]=levelFor[face];encoded.faces[face]=levels;}return{encoded,probe};}
const faces=(model,kind)=>[...new Set(model.quads.filter(q=>q.kind===kind).map(q=>q.face))];
const colorOf=level=>palette.levels[level];
function sceneCell(scene,face,probe){return scene.shapes.find(shape=>shape.face===face&&shape.i===probe.i&&shape.j===probe.j);}
function modelCell(model,face,probe){return model.quads.find(q=>q.face===face&&q.kind==='module'&&q.i===probe.i&&q.j===probe.j);}
function gltfImageNormals(gltf){return gltf.meshes[0].primitives.slice(1).map((primitive,index)=>{const accessor=gltf.accessors[primitive.attributes.POSITION],view=gltf.bufferViews[accessor.bufferView],raw=Buffer.from(gltf.buffers[view.buffer].uri.split(',')[1],'base64'),points=new Float32Array(raw.buffer,raw.byteOffset+view.byteOffset,12);return{index,points};});}
function assertImageOutward(gltf,model){for(const {index,points} of gltfImageNormals(gltf)){const face=model.images[index].face,n=normal[face],axis=n.findIndex(Boolean),plane=n[axis]>0?model.n+.0002:-.0002;for(let p=axis;p<points.length;p+=3)assert.ok(Math.abs(points[p]-plane)<1e-5,face);}}

test('H2 six-render uses four physical code faces and one shared cap asset in every Node export',()=>{
  const {encoded,probe}=fixture(2),options={renderFaces:6},before=Object.fromEntries(Object.entries(encoded.faces).map(([f,v])=>[f,Array.from(v)])),map=hDisplayMap(encoded,options),scene=buildHScene(encoded,{...options,palette,faceImages:assets}),model=buildHCubeModel(encoded,{...options,palette,faceImages:assets}),net=cubeNetScene(model,{margin:0}),gltf=cubeModelToGltf(model);
  assert.deepEqual(map.physicalDataFaces,['XM','YM','XP','YP']);assert.deepEqual(faces(model,'module'),map.physicalDataFaces);assert.deepEqual(model.dataFaces,['XM','YM']);
  for(const [physical,logical] of Object.entries(map.physicalToLogical))if(logical)assert.deepEqual(modelCell(model,physical,probe).color,colorOf(levelFor[logical]));
  assert.deepEqual([sceneCell(scene,'XM',probe).color,sceneCell(scene,'YM',probe).color],[colorOf(levelFor.XM),colorOf(levelFor.YM)]);assert.equal(sceneCell(scene,'ZM',probe),undefined);
  assert.deepEqual(model.images.map(row=>row.face),['ZM','ZP']);assert.equal(model.images[0].image,assets.ZM);assert.equal(model.images[1].image,assets.ZM);
  assert.deepEqual(net.shapes.filter(shape=>shape.kind==='image').map(shape=>shape.face),['ZM','ZP']);assert.equal(gltf.images.length,2);assertImageOutward(gltf,model);
  assert.deepEqual([...new Set([...cubeImageVoxelQuads(model,1)].map(q=>q.face))],['ZM','ZP']);const voxels=voxelizeCube(model,{scale:1});assert.ok(voxels.palette.includes('minecraft:red_concrete'));
  assert.deepEqual(Object.fromEntries(Object.entries(encoded.faces).map(([f,v])=>[f,Array.from(v)])),before);
});

test('H3 horizontal/vertical show XM/YM while physical XP reads logical ZM',()=>{
  for(const arrangement of ['horizontal','vertical']){const {encoded,probe}=fixture(3),options={arrangement,renderFaces:3,palette,faceImages:assets},map=hDisplayMap(encoded,options),pose=hAlignmentRotation(arrangement),scene=buildHScene(encoded,{...options,...pose}),model=buildHCubeModel(encoded,options),xp=modelCell(model,'XP',probe);
    assert.deepEqual(map.physicalToLogical,{ZM:null,XM:'XM',YM:'YM',ZP:null,XP:'ZM',YP:null});assert.deepEqual(scene.hModel.visible,['XM','YM']);assert.equal(sceneCell(scene,'ZM',probe),undefined);assert.deepEqual(xp.color,colorOf(levelFor.ZM));assert.deepEqual(model.images.map(row=>row.face),['ZM','ZP','YP']);
  }
});

test('H4/H5 permit physical blank images only, consistently through net glTF and voxel image quads',()=>{
  // 4면: 논리 YP 가 물리 ZM 에 놓여 빈 면이 ZP·YP 로 이웃해요(2026-09-14). 물리 면 순서는 H_DISPLAY_FACES 순이에요.
  for(const [mode,expectedModules,expectedImages] of [[4,['ZM','XM','YM','XP'],['ZP','YP']],[5,['ZM','XM','YM','XP','YP'],['ZP']]]){const {encoded}=fixture(mode),model=buildHCubeModel(encoded,{palette,faceImages:assets}),net=cubeNetScene(model,{margin:0}),gltf=cubeModelToGltf(model);
    assert.deepEqual(faces(model,'module'),expectedModules);assert.deepEqual(model.images.map(row=>row.face),expectedImages);assert.equal(model.images.some(row=>faces(model,'module').includes(row.face)),false);
    assert.deepEqual(net.shapes.filter(shape=>shape.kind==='image').map(shape=>shape.face),expectedImages);assert.equal(gltf.images.length,expectedImages.length);assertImageOutward(gltf,model);assert.deepEqual([...new Set([...cubeImageVoxelQuads(model,1)].map(q=>q.face))],expectedImages);
  }
});
