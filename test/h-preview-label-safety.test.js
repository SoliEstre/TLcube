import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {hBlankFaceLabels,hPreviewPositionLabels} from '../src/h-preview-decor.js';
import {hScreenSpin} from '../src/h-rotation.js';
function separated(a,b){
  return [a,b].some(poly=>poly.some((p,i)=>{
    const q=poly[(i+1)%poly.length],nx=q.y-p.y,ny=p.x-q.x;
    const aa=a.map(v=>v.x*nx+v.y*ny),bb=b.map(v=>v.x*nx+v.y*ny);
    return Math.max(...aa)<Math.min(...bb)-1e-5||Math.max(...bb)<Math.min(...aa)-1e-5;
  }));
}
const rect=({x,y,width,height})=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
test('회전·원근·확대 중 코드 위치표시와 연결선은 모든 코드 면 바깥에 있어요',()=>{
  let checked=0;
  for(const version of [5,7,8]){
    const encoded=encodeH('https://tl.estre.so',{version,mode:6,tones:3,ecc:'H',mask:7});
    for(const axis of ['x','y','gyro'])for(const side of [320,960])for(const zoom of [1,1.8])for(let phase=0;phase<360;phase+=30){
      const options={...hScreenSpin(phase/75*1000,{axis,speed:75}),perspective:.3,zoom};
      const faces=hBlankFaceLabels(encoded,{...options,labelCodeFaces:true},side);
      for(const label of hPreviewPositionLabels(encoded,options,side)){
        assert.equal(label.kind,'callout');checked++;
        for(const face of faces){assert.ok(separated(rect(label.box),face.points));assert.ok(separated(label.line,face.points));}
        assert.ok(label.box.x>=3&&label.box.y>=3&&label.box.x+label.box.width<=side-3&&label.box.y+label.box.height<=side-3);
      }
    }
  }
  assert.ok(checked>300,'전체 라벨을 숨겨 통과시키지 않아요');
});
test('코너 QR과 겹치지 않고 기본 시점은 세 코드 면을 표시해요',()=>{
  const encoded=encodeH('https://tl.estre.so',{version:7,mode:6,tones:3,ecc:'H',mask:7});
  for(const corner of ['TL','TR','BL','BR']){
    const labels=hPreviewPositionLabels(encoded,{perspective:4/60,qr:{corner}},640),size=640*.21;
    assert.equal(labels.length,3);
    const qr=rect({x:corner.endsWith('R')?640-size:0,y:corner.startsWith('B')?640-size:0,width:size,height:size});
    for(const label of labels){assert.ok(separated(rect(label.box),qr));assert.ok(separated(label.line,qr));}
    for(const axis of ['x','y','gyro'])for(const zoom of [1,1.8])for(let phase=0;phase<360;phase+=20){
      const options={...hScreenSpin(phase/75*1000,{axis,speed:75}),perspective:.3,zoom,qr:{corner}};
      for(const label of hPreviewPositionLabels(encoded,options,640)){
        assert.ok(separated(rect(label.box),qr));assert.ok(separated(label.line,qr));
      }
    }
  }
});
test('빈 면의 중앙 원근 라벨은 유지하고 코드 면만 외부로 옮겨요',()=>{
  const encoded=encodeH('https://tl.estre.so',{version:7,mode:3,tones:3,ecc:'H',mask:7}),options={rotateX:Math.PI,perspective:.3};
  const blank=hBlankFaceLabels(encoded,{...options,labelCodeFaces:true},640),labels=hPreviewPositionLabels(encoded,{...options,positionMode:'inside'},640);
  assert.ok(blank.length>0);
  assert.equal(labels.length,blank.length);
  for(const original of blank){const label=labels.find(v=>v.face===original.face);assert.equal(label.kind,'surface');assert.equal(label.matrix3d,original.matrix3d);}
});
test('위치표시는 none, inside, outside 세 모드를 명시적으로 나눠요',()=>{
  const encoded=encodeH('https://tl.estre.so',{version:7,mode:3,tones:3,ecc:'H',mask:7});
  const options={perspective:4/60};
  const visible=hBlankFaceLabels(encoded,{...options,labelCodeFaces:true},640);
  assert.ok(visible.length>0);
  assert.deepEqual(hPreviewPositionLabels(encoded,{...options,positionMode:'none'},640),[]);
  const inside=hPreviewPositionLabels(encoded,{...options,positionMode:'inside'},640);
  assert.equal(inside.length,visible.length);
  for(const row of visible){const label=inside.find(value=>value.face===row.face);assert.equal(label.kind,'surface');assert.equal(label.matrix3d,row.matrix3d);}
  const outside=hPreviewPositionLabels(encoded,{...options,positionMode:'outside'},640);
  const fallback=hPreviewPositionLabels(encoded,options,640);
  assert.deepEqual(outside,fallback);
  assert.ok(outside.length>0);
  assert.ok(outside.every(label=>label.kind==='callout'&&label.box.width===64&&label.box.height===40));
});
