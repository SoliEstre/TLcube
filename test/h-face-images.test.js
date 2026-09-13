import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSceneImage, imageQuadTransform, inverseImageTransform,
  projectImagePoint,canonicalSceneImage,
} from '../src/scene-image.js';
import { hFaceImagePlacement, hFaceImagePlacements } from '../src/h-face-images.js';
import { buildHScene, hAutoRotation } from '../src/h-render.js';
import { encodeH } from '../src/h-codec.js';
import { rasterize } from '../src/raster.js';
import { sceneToSvg } from '../src/svg.js';

const PNG_HREF='data:image/png;base64,iVBORw0KGgoAAA==';
const image=(width=2,height=2,pixels=new Uint8ClampedArray(width*height*4).fill(255))=>({width,height,pixels,href:PNG_HREF});
const pointClose=(actual,expected,epsilon=1e-9)=>{
  assert.ok(Math.abs(actual.x-expected.x)<=epsilon,`x ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y-expected.y)<=epsilon,`y ${actual.y} != ${expected.y}`);
};

test('빈 면 자산은 RGBA 배열과 내장 PNG data URL만 수용해요',()=>{
  const valid=image();assert.equal(assertSceneImage(valid),valid);
  for(const href of ['https://example.test/a.png','//cdn.test/a.png','data:image/svg+xml;base64,PHN2Zy8+','data:text/html;base64,PGI+eDwvYj4=']){
    assert.throws(()=>assertSceneImage({...image(),href}),TypeError,href);
  }
  assert.throws(()=>assertSceneImage({...image(1025,1),pixels:new Uint8ClampedArray(1025*4)}),TypeError,'변 길이 상한');
  assert.throws(()=>assertSceneImage({...image(),pixels:new Uint8ClampedArray(15)}),TypeError,'RGBA 길이 불일치');
  assert.throws(()=>assertSceneImage({...image(),pixels:new Uint8Array(16)}),TypeError,'Uint8ClampedArray 이외');
  assert.throws(()=>assertSceneImage({...image(),href:'data:image/png;base64,not base64!'}),TypeError,'손상된 data URL');
});

test('export PNG URI는 입력 href가 아니라 RGBA에서 canonical으로 다시 만들어요',()=>{
  const asset=image(1,1,new Uint8ClampedArray([12,34,56,255]));asset.href='data:image/png;base64,iVBORw0KGgo=';
  const canonical=canonicalSceneImage(asset);assert.notEqual(canonical.href,asset.href);
  assert.equal(canonicalSceneImage(asset),canonical);
  assert.equal(canonicalSceneImage(canonical),canonical);
  const bytes=Buffer.from(canonical.href.split(',')[1],'base64');
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.ok(bytes.includes(Buffer.from('IEND')));
});

test('3면은 빈 ZP/XP/YP에만 가로·세로·정사각 contain 이미지를 배치해요',()=>{
  const encoded=encodeH('image-faces',{version:1,mode:3,mask:7});
  const assets={ZP:image(12,3),XP:image(3,12),YP:image(8,8),ZM:image(2,2)};
  const before=Object.fromEntries(Object.entries(encoded.faces).map(([face,levels])=>[face,Array.from(levels)]));
  const placed=hFaceImagePlacements(encoded,assets);
  assert.deepEqual(placed.map(p=>p.face),['ZP','XP','YP']);
  assert.equal(placed.length,3);
  for(const p of placed){
    assert.ok(p.width<=encoded.n&&p.height<=encoded.n,`${p.face}: contain 범위 밖`);
    assert.equal(p.x,(encoded.n-p.width)/2);assert.equal(p.y,(encoded.n-p.height)/2);
    assert.equal(p.corners.length,4);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(encoded.faces).map(([face,levels])=>[face,Array.from(levels)])),before,'이미지가 data face를 바꿨다');
  assert.throws(()=>hFaceImagePlacement('ZZ',image(),encoded.n),RangeError,'존재하지 않는 물리면');
});

test('6면에서는 이미지를 전부 무시하고 data faces를 바꾸지 않아요',()=>{
  const encoded=encodeH('six faces',{version:1,mode:6,mask:7});
  const before=Object.fromEntries(Object.entries(encoded.faces).map(([face,levels])=>[face,Array.from(levels)]));
  const assets={ZP:image(12,3),XP:image(3,12),YP:image(8,8)};
  assert.deepEqual(hFaceImagePlacements(encoded,assets),[]);
  const scene=buildHScene(encoded,{...hAutoRotation(24000),faceImages:assets});
  assert.equal(scene.shapes.some(shape=>shape.kind==='image'),false);
  assert.deepEqual(Object.fromEntries(Object.entries(encoded.faces).map(([face,levels])=>[face,Array.from(levels)])),before);
});

test('사영 행렬은 여러 자세의 사각형 네 꼭짓점과 내부 점을 왕복해요',()=>{
  const poses=[
    [{x:0,y:0},{x:6,y:0},{x:6,y:4},{x:0,y:4}],
    [{x:2,y:1},{x:9,y:2},{x:7,y:7},{x:0,y:5}],
    [{x:-3,y:4},{x:5,y:-1},{x:8,y:6},{x:-2,y:9}],
  ];
  const samples=[[0,0],[1,0],[1,1],[0,1],[.17,.61],[.83,.29]];
  for(const quad of poses){
    const forward=imageQuadTransform(quad),inverse=inverseImageTransform(forward);
    assert.ok(forward&&inverse,'유효한 사각형의 변환이 null 이다');
    for(const [u,v] of samples){
      const projected=projectImagePoint(forward,u,v);
      const round=projectImagePoint(inverse,projected.x,projected.y);
      pointClose(round,{x:u,y:v});
    }
  }
});

test('래스터 image shape는 정확한 nearest sample과 alpha-over 배경색을 써요',()=>{
  const pixels=new Uint8ClampedArray([200,20,100,128]);
  const scene={width:1,height:1,background:{r:10,g:30,b:50},shapes:[{
    kind:'image',color:{r:10,g:30,b:50},image:image(1,1,pixels),
    points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
  }]};
  const out=rasterize(scene,{pixelsPerUnit:1,supersample:1});
  assert.deepEqual(Array.from(out.pixels),[105,25,75,255]);
});

test('SVG image는 PNG를 문서 안에만 담고 외부 href를 만들지 않아요',()=>{
  const scene={width:1,height:1,background:{r:0,g:0,b:0},shapes:[{
    kind:'image',color:{r:0,g:0,b:0},image:image(),
    points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
  }]};
  const svg=sceneToSvg(scene);
  const hrefs=[...svg.matchAll(/\bhref="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(hrefs.some(href=>href.startsWith('data:image/png;base64,iVBORw0KGgo')),'canonical PNG href가 없다');
  assert.ok(hrefs.every(href=>href.startsWith('#')||href.startsWith('data:image/png;base64,')),`외부 href: ${hrefs.join(', ')}`);
  assert.equal(/<image\b/.test(svg),true);
});

test('이미지 없는 기존 SVG 직렬화와 래스터 결과는 정확히 그대로예요',()=>{
  const scene={width:2,height:1,background:{r:1,g:2,b:3},shapes:[{
    kind:'polygon',color:{r:4,g:5,b:6},points:[{x:0,y:0},{x:2,y:0},{x:2,y:1},{x:0,y:1}],
  }]};
  assert.equal(sceneToSvg(scene),[
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24" viewBox="0 0 2.0000 1.0000">',
    '<rect x="0" y="0" width="2.0000" height="1.0000" fill="#010203"/>',
    '<polygon points="0.0000,0.0000 2.0000,0.0000 2.0000,1.0000 0.0000,1.0000" fill="#040506" stroke="#040506" stroke-width="0.03" stroke-linejoin="round"/>',
    '</svg>',
    '',
  ].join('\n'));
  const out=rasterize(scene,{pixelsPerUnit:1,supersample:1});
  assert.deepEqual(Array.from(out.pixels),[4,5,6,255,4,5,6,255]);
});
