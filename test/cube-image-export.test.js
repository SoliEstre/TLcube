import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFaces, hFacePoint, hLayout } from '../src/h-layout.js';
import { buildHCubeModel, cubeModelToGltf, cubeNetScene } from '../src/cube-export.js';
import { cubeImageVoxelQuads } from '../src/cube-image-export.js';
import { voxelizeCube } from '../src/minecraft-schematic.js';
import { canonicalSceneImage } from '../src/scene-image.js';

const PNG_HREF='data:image/png;base64,iVBORw0KGgoAAA==';
const palette={background:{r:255,g:255,b:255},levels:[{r:20,g:20,b:20},{r:120,g:120,b:120},{r:220,g:220,b:220}]};
const image=(width=2,height=2,pixels=new Uint8ClampedArray(width*height*4).fill(255))=>({width,height,pixels,href:PNG_HREF});
function encoded3(){
  const layout=hLayout(0);
  return {version:0,mode:3,tones:3,ecc:'M',mask:7,faces:makeFaces({
    version:0,mode:3,tones:3,ecc:'M',mask:7,routeId:0,
    triadDigits:[Array(layout.scan.length).fill(0)],
  })};
}
function faceImages(){return {ZP:image(12,3),XP:image(3,12),YP:image(8,8)};}
function dataUri(uri){return uri.startsWith('data:');}

test('3면 빈 면 이미지는 glTF에 내장 PNG texture primitive 세 장만 더해요',()=>{
  const model=buildHCubeModel(encoded3(),{palette,faceImages:faceImages()});
  assert.deepEqual(model.images.map(row=>row.face),['ZP','XP','YP']);
  const before=JSON.stringify(model),gltf=cubeModelToGltf(model),basePrimitiveCount=1;
  assert.equal(JSON.stringify(model),before,'glTF export가 model을 변이했다');
  assert.equal(gltf.images.length,3);assert.equal(gltf.textures.length,3);assert.equal(gltf.samplers.length,1);
  assert.equal(gltf.meshes[0].primitives.length,basePrimitiveCount+3);
  for(let i=0;i<3;i++){
    assert.equal(gltf.images[i].uri,canonicalSceneImage(model.images[i].image).href);assert.ok(dataUri(gltf.images[i].uri));
    assert.deepEqual(gltf.textures[i],{source:i,sampler:0});
    const primitive=gltf.meshes[0].primitives.at(-3+i),material=gltf.materials[primitive.material];
    assert.equal(primitive.mode,4);assert.equal(material.alphaMode,'BLEND');assert.equal(material.doubleSided,true);
    assert.deepEqual(material.extensions,{KHR_materials_unlit:{}});
  }
  assert.equal(gltf.images.some(row=>/^(?:https?:)?\/\//.test(row.uri)),false,'외부 texture URI가 섞였다');
});

test('glTF 이미지 표면은 H3 빈 면 세 장·유한 좌표만 수용해요',()=>{
  const model=buildHCubeModel(encoded3(),{palette,faceImages:faceImages()});
  for(const images of [[...model.images,model.images[0]],[model.images[0],model.images[0]],[{...model.images[0],face:'ZM'}]]){
    assert.throws(()=>cubeModelToGltf({...model,images}),/한도|face/);
  }
  assert.throws(()=>cubeModelToGltf({...model,kind:'Y'}),/한도/);
  assert.throws(()=>cubeModelToGltf({...model,dataFaces:['ZM','XM','YM','ZP','XP','YP']}),/한도/);
  assert.throws(()=>cubeModelToGltf({...model,images:[{...model.images[0],corners:[[NaN,0,0],[0,0,0],[0,0,0],[0,0,0]]}]}),/좌표/);
});

test('이미지 primitive는 해당 빈 면의 바깥쪽으로 미세하게만 이동해요',()=>{
  const model=buildHCubeModel(encoded3(),{palette,faceImages:{ZP:image()}}),gltf=cubeModelToGltf(model);
  const primitive=gltf.meshes[0].primitives.at(-1),accessor=gltf.accessors[primitive.attributes.POSITION];
  const view=gltf.bufferViews[accessor.bufferView],buffer=gltf.buffers[view.buffer];
  const bytes=Buffer.from(buffer.uri.split(',')[1],'base64');
  const positions=new Float32Array(bytes.buffer,bytes.byteOffset+view.byteOffset,12);
  for(let i=2;i<positions.length;i+=3)assert.ok(Math.abs(positions[i]-(model.n+.0002))<1e-6);
});

test('cube net은 이미지를 같은 face의 polygon 뒤에 한 장으로 보존해요',()=>{
  const model=buildHCubeModel(encoded3(),{palette,faceImages:{ZP:image(12,3)}}),net=cubeNetScene(model,{margin:0});
  const imageIndex=net.shapes.findIndex(shape=>shape.kind==='image');
  assert.ok(imageIndex>=0);assert.equal(net.shapes[imageIndex].face,'ZP');
  assert.ok(net.shapes.slice(0,imageIndex).some(shape=>shape.face==='ZP'&&shape.kind==='polygon'));
  assert.equal(net.shapes[imageIndex].image.href,PNG_HREF);
});

test('schematic 경로는 이미지 면을 back quad로 양자화하고 data face를 바꾸지 않아요',()=>{
  const model=buildHCubeModel(encoded3(),{palette,faceImages:{ZP:image(1,1,new Uint8ClampedArray([142,32,33,255]))}});
  const before=JSON.stringify(model),quads=[...cubeImageVoxelQuads(model,1)];
  assert.equal(JSON.stringify(model),before);assert.ok(quads.length>0);assert.ok(quads.every(quad=>quad.kind==='back'&&quad.face==='ZP'));
  const voxels=voxelizeCube(model,{scale:1}),red=voxels.palette.indexOf('minecraft:red_concrete');
  assert.ok(red>=0);assert.ok([...voxels.blocks].includes(red),'이미지 색이 schematic에 없다');
});

test('images가 없거나 빈 배열이면 glTF·net·schematic 출력은 정확히 같다',()=>{
  const base=buildHCubeModel(encoded3(),{palette}),empty={...base,images:[]};
  assert.equal(Object.hasOwn(base,'images'),false);
  assert.deepEqual(cubeModelToGltf(empty),cubeModelToGltf(base));
  assert.deepEqual(cubeNetScene(empty),cubeNetScene(base));
  const a=voxelizeCube(base,{scale:1}),b=voxelizeCube(empty,{scale:1});
  assert.deepEqual(a,b);
});

test('data face나 6면 model에 빈 면 image가 주입되지 않아요',()=>{
  const encoded=encoded3();
  const before=Object.fromEntries(Object.entries(encoded.faces).map(([face,levels])=>[face,Array.from(levels)]));
  const dataOnly=buildHCubeModel(encoded,{palette,faceImages:{ZM:image(),XM:image(),YM:image()}});
  assert.equal(Object.hasOwn(dataOnly,'images'),false);
  assert.deepEqual(Object.fromEntries(Object.entries(encoded.faces).map(([face,levels])=>[face,Array.from(levels)])),before);
  const layout=hLayout(0),six={version:0,mode:6,tones:3,ecc:'M',mask:7,faces:makeFaces({version:0,mode:6,tones:3,ecc:'M',mask:7,routeId:0,triadDigits:[Array(layout.scan.length).fill(0),Array(layout.scan.length).fill(0)]})};
  assert.equal(Object.hasOwn(buildHCubeModel(six,{palette,faceImages:faceImages()}),'images'),false);
});
