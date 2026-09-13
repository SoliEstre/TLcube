import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodeH} from '../src/h-codec.js';
import {buildHScene} from '../src/h-render.js';
import {withHCornerQr,hQrPosition} from '../src/generator-h-qr.js';
import {selectHRepresentation,selectHFaceCount} from '../src/generator-h.js';
import {sceneToSvg} from '../src/svg.js';
import {TL_READER_URL} from '../src/qr.js';

function sample(corner='BR'){
  const encoded=encodeH('H QR',{version:6,mode:3,tones:3,finder:'auto'});
  return withHCornerQr(buildHScene(encoded,{outline:true,perspective:.5}),{text:TL_READER_URL,corner});
}

test('H QR SVG는 QR 셀만 stroke를 생략하고 기존 다각형의 stroke는 보존해요',()=>{
  for(const corner of ['TL','TR','BL','BR']){
    const scene=sample(corner),polygons=scene.shapes.filter(s=>s.kind==='polygon');
    const lines=sceneToSvg(scene).split('\n').filter(line=>line.startsWith('<polygon '));
    assert.equal(lines.length,polygons.length);
    for(const [i,shape]of polygons.entries()){
      if(shape.qr)assert.ok(!/\bstroke(?:-width)?=/.test(lines[i]));
      else assert.match(lines[i],/stroke-width="0\.03" stroke-linejoin="round"/);
    }
  }
});

test('실제 Canvas drawScene 함수는 QR shape에 stroke를 호출하지 않아요',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('function drawScene('),end=html.indexOf('\n}',start)+2;
  assert.ok(start>=0&&end>start);
  const drawScene=new Function('window','rgbCss','backdropShowing','paintShading',
    'return ('+html.slice(start,end)+');')({devicePixelRatio:1},c=>`rgb(${c.r},${c.g},${c.b})`,()=>false,()=>{});
  const strokes=[],fills=[];let shapeIndex=-1;
  const ctx={setTransform(){},clearRect(){},fillRect(){},moveTo(){},lineTo(){},closePath(){},arc(){},
    beginPath(){shapeIndex++;},fill(){fills.push(shapeIndex);},stroke(){strokes.push(shapeIndex);}};
  const canvas={getContext:()=>ctx,classList:{toggle(){}}},scene=sample(),before=JSON.stringify(scene);
  drawScene(scene,canvas,10);
  assert.equal(JSON.stringify(scene),before);
  assert.equal(fills.length,scene.shapes.length);
  assert.deepEqual(strokes,scene.shapes.flatMap((shape,i)=>shape.kind==='polygon'&&!shape.qr?[i]:[]));
  assert.ok(scene.shapes.some(shape=>shape.qr));
});

test('Y 안쪽 QR 선택은 H와 6면을 거쳐 돌아와도 보존돼요',()=>{
  const initial={type:'Y',yRepresentation:'2.5d',qrPosition:'inner',qrFacePlacement:'far',
    locatorProfileY:'cell-surface-v0try',hFaces:3,hAutoRotate:false};
  const before=JSON.stringify(initial),h=selectHRepresentation(initial,'3d');
  const six=selectHFaceCount(h,6),back=selectHRepresentation(six,'2.5d');
  assert.equal(JSON.stringify(initial),before);
  assert.equal(hQrPosition(h.qrPosition),'none');
  for(const state of [h,six,back]){
    assert.equal(state.qrPosition,'inner');
    assert.equal(state.qrFacePlacement,'far');
    assert.equal(state.locatorProfileY,initial.locatorProfileY);
  }
  assert.equal(back.hFaces,3);
  assert.equal(back.hAutoRotate,false);
});
