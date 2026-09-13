import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodeH} from '../src/h-codec.js';
import {buildHScene,hProjection} from '../src/h-render.js';
import {hFacePoint} from '../src/h-layout.js';
import {withHCornerQr} from '../src/generator-h-qr.js';
import {qrMatrix,TL_READER_URL} from '../src/qr.js';

test('H 공유 격자 계산은 모든 셀의 독립 투영 순서와 값을 유지해요',()=>{
  for(const version of [0,5,7])for(const mode of [3,6])for(let k=0;k<6;k++){
    const e=encodeH('P',{version,mode,finder:'auto'}),options={
      rotateX:k*.47,rotateY:k*.31,rotateZ:k*.19,perspective:[0,4/60,.5,1][k%4],outline:true,
    };
    const scene=buildHScene(e,options),view=hProjection(e.n,options),cells=scene.shapes.filter(s=>s.face);
    assert.equal(cells.length,view.visible.filter(f=>e.faces[f]).length*e.n*e.n);
    for(const s of cells){
      const expected=[[s.i,s.j],[s.i,s.j+1],[s.i+1,s.j+1],[s.i+1,s.j]].map(
        ([i,j])=>view.project(hFacePoint(s.face,i,j,e.n)));
      assert.deepEqual(s.points,expected);
    }
  }
});

test('H 회전 삼각함수는 각 셀이 아니라 투영 생성 때 한 번만 계산해요',()=>{
  const e=encodeH('P',{version:7,mode:6,finder:'auto'});
  const originalSin=Math.sin,originalCos=Math.cos;let sin=0,cos=0;
  try{
    Math.sin=x=>{sin++;return originalSin(x);};
    Math.cos=x=>{cos++;return originalCos(x);};
    buildHScene(e,{rotateX:.3,rotateY:.6,rotateZ:.2,perspective:.4,outline:true});
  }finally{Math.sin=originalSin;Math.cos=originalCos;}
  assert.equal(sin,4);assert.equal(cos,3);
});

test('H 공유 좌표 계산 뒤에도 셀과 다음 장면의 point 소유권은 독립이에요',()=>{
  const e=encodeH('P',{version:7,mode:6,finder:'auto'}),options={perspective:0};
  const scene=buildHScene(e,options),cells=scene.shapes.filter(s=>s.face);
  const a=cells.find(s=>s.face==='ZM'&&s.i===0&&s.j===0),b=cells.find(s=>s.face==='ZM'&&s.i===0&&s.j===1);
  assert.deepEqual(a.points[1],b.points[0]);assert.notEqual(a.points[1],b.points[0]);
  const saved={...b.points[0]};a.points[1].x+=100;
  assert.deepEqual(b.points[0],saved);
  const next=buildHScene(e,options).shapes.find(s=>s.face==='ZM'&&s.i===0&&s.j===0);
  assert.deepEqual(next.points[1],saved);
});

test('H 프레임 사이 본문과 팔레트 변경은 계산 캐시에 가려지지 않아요',()=>{
  const e=encodeH('P',{version:5,mode:6,finder:'auto'}),options={perspective:0};
  const first=buildHScene(e,options).shapes.find(s=>s.face==='ZM'&&s.i===8&&s.j===8);
  const index=8*e.n+8;e.faces.ZM[index]=(e.faces.ZM[index]+1)%3;
  const palette={levels:[{r:12,g:25,b:38},{r:77,g:91,b:104},{r:166,g:194,b:230}],background:null};
  const second=buildHScene(e,{...options,palette}),cell=second.shapes.find(s=>s.face==='ZM'&&s.i===8&&s.j===8);
  assert.deepEqual(cell.color,palette.levels[e.faces.ZM[index]]);
  assert.notDeepEqual(cell.color,first.color);assert.equal(second.background,null);
  e.faces.ZM[index]=255;
  assert.throws(()=>buildHScene(e,options),/H render level/);
});

async function countedQrModule(){
  const url=new URL('../src/generator-h-qr.js',import.meta.url);
  const source=readFileSync(url,'utf8').replace(
    /import\s*\{qrMatrix\}\s*from\s*['"]\.\/qr\.js['"];?/,
    'import {qrMatrix as encodeQrMatrix} from '+JSON.stringify(new URL('../src/qr.js',import.meta.url).href)+';\n'+
    'export let qrCalls=0;function qrMatrix(text){qrCalls++;return encodeQrMatrix(text);}'
  );
  assert.ok(source.includes('export let qrCalls=0;'));
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}

test('H QR matrix는 한 text만 재사용하며 코너 변경과 비활성화는 재인코딩하지 않아요',async()=>{
  const module=await countedQrModule(),base=buildHScene(encodeH('P',{version:0}));
  const start=module.qrCalls;
  for(const corner of ['TL','TR','BL','BR']){
    const scene=module.withHCornerQr(base,{text:TL_READER_URL,corner});
    const qr=qrMatrix(TL_READER_URL),marks=scene.shapes.filter(s=>s.qr);
    assert.equal(marks.length,1+qr.modules.reduce((a,b)=>a+b,0));
    assert.equal(scene.hCornerQr.corner,corner);
  }
  assert.equal(module.qrCalls-start,1);
  assert.equal(module.withHCornerQr(base,{text:TL_READER_URL,corner:'none'}),base);
  assert.equal(module.withHCornerQr(base),base);assert.equal(module.qrCalls-start,1);
  const other='HELLO';
  module.withHCornerQr(base,{text:other,corner:'TL'});assert.equal(module.qrCalls-start,2);
  assert.throws(()=>module.withHCornerQr(base,{text:'lowercase',corner:'TL'}),RangeError);
  module.withHCornerQr(base,{text:other,corner:'TL'});assert.equal(module.qrCalls-start,3);
  module.withHCornerQr(base,{text:TL_READER_URL,corner:'TL'});assert.equal(module.qrCalls-start,4);
  for(let i=0;i<2;i++)assert.throws(()=>module.withHCornerQr(base,{text:null,corner:'TL'}),TypeError);
  assert.equal(module.qrCalls-start,6);
});

test('H QR 반환 도형 수정은 다음 프레임 QR이나 원본 장면을 오염시키지 않아요',()=>{
  const base=buildHScene(encodeH('P',{version:5,finder:'auto'})),before=JSON.stringify(base);
  const args={text:TL_READER_URL,corner:'TL'},first=withHCornerQr(base,args);
  const expected=JSON.stringify(first);const mark=first.shapes.find(s=>s.qr);
  mark.points[0].x+=100;mark.color.r=1;first.shapes[0].points[0].y+=100;
  assert.equal(JSON.stringify(withHCornerQr(base,args)),expected);
  assert.equal(JSON.stringify(base),before);
});


import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function previewHarness(overrides={}){
  const start=html.indexOf('function paintHPreview(){'),end=html.indexOf("\ndocument.addEventListener('visibilitychange'",start);
  assert.ok(start>=0&&end>start);
  const animation={request:0,last:0,elapsed:0,encoded:null},pending=new Map(),frames=[];
  const state={hAutoRotate:true,hFaces:6,...overrides};let serial=0;
  const context={hAnimation:animation,generatorState:state,current:{type:'H',encoded:{}},y3dPreview:{on:true},
    els:{view3d:{classList:{add(){},remove(){}}}},document:{hidden:false},cubeVideoJob:null,
    hGeneratorActive:()=>true,syncOrbitPreviewUi(){},
    drawHPreviewFrame:()=>frames.push(animation.elapsed),
    requestAnimationFrame:fn=>{const id=++serial;pending.set(id,fn);return id;},
    cancelAnimationFrame:id=>pending.delete(id),
    stopHAnimation:()=>{if(animation.request)pending.delete(animation.request);animation.request=0;animation.last=0;}
  };
  vm.runInNewContext(html.slice(start,end)+'\nthis.paint=paintHPreview;',context);
  const step=now=>{assert.equal(pending.size,1);const[id,fn]=pending.entries().next().value;pending.delete(id);fn(now);};
  return{animation,state,pending,frames,context,step,paint:context.paint};
}
test('H 실제 프리뷰 callback은 60Hz와 120Hz 각각의 vsync에서 새 프레임을 그려요',()=>{
  for(const hFaces of [3,6])for(const hz of [60,120]){
    const h=previewHarness({hFaces});h.paint();assert.equal(h.frames.length,1);
    for(let k=0;k<=12;k++)h.step(1000+k*1000/hz);
    assert.equal(h.frames.length,13);assert.equal(h.pending.size,1);
    assert.ok(Math.abs(h.animation.elapsed-12000/hz)<1e-9);
  }
});
test('H 실제 프리뷰 callback의 긴 정지는 100ms만 반영하고 중복 시각은 다시 그리지 않아요',()=>{
  const h=previewHarness();h.paint();h.step(1000);h.step(1016);h.step(3016);
  assert.equal(h.animation.elapsed,116);assert.equal(h.frames.length,3);
  h.step(3016);assert.equal(h.frames.length,3);h.step(3032);
  assert.equal(h.animation.elapsed,132);assert.equal(h.frames.length,4);
});
test('H 프리뷰는 일시정지와 비활성·숨김·영상 내보내기에서 rAF를 남기지 않아요',()=>{
  for(const setting of [{hAutoRotate:false}]){
    const h=previewHarness(setting);h.paint();assert.equal(h.frames.length,1);assert.equal(h.pending.size,0);
  }
  for(const stop of [
    h=>{h.context.document.hidden=true;},h=>{h.context.cubeVideoJob={};},
    h=>{h.context.y3dPreview.on=false;},h=>{h.context.hGeneratorActive=()=>false;},
    h=>{h.state.hAutoRotate=false;}
  ]){
    const h=previewHarness();h.paint();h.step(1000);stop(h);h.step(1016);
    assert.equal(h.frames.length,1);assert.equal(h.pending.size,0);assert.equal(h.animation.last,0);
  }
});
