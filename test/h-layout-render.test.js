import test from 'node:test';
import assert from 'node:assert/strict';
import {H_ECC,hFormatByte,readHFormatByte} from '../src/h-profile.js';
import {hLayout,hCodebook,transformTag,hamming,makeFaces,validateHFace,hFacePoint} from '../src/h-layout.js';
import {hAutoRotation,hProjection,H_ROTATION_PERIOD_MS,buildHScene,buildHFaceSheet} from '../src/h-render.js';
test('H format의 모든48프로파일 왕복과384단일bit변조 거부',()=>{
  const codes=new Set();for(const tones of[2,3])for(const ecc of H_ECC)for(let mask=0;mask<8;mask++){
    const p={tones,ecc,mask},b=hFormatByte(p);assert.deepEqual(readHFormatByte(b),p);assert(!codes.has(b));codes.add(b);
    for(let bit=0;bit<8;bit++)assert.equal(readHFormatByte(b^(1<<bit)),null);
  }assert.equal(codes.size,48);
});
test('legacy frame9 prefix와 append frame12의 168 tag D4 orbit은 최소거리4',()=>{
  assert.equal(hCodebook().length,21);
  assert.deepEqual(hCodebook().slice(0,9).map(row=>`${row.mode}:${row.face}`),['3:ZM','3:XM','3:YM','6:ZM','6:XM','6:YM','6:ZP','6:XP','6:YP']);
  assert.deepEqual(hCodebook().slice(9).map(row=>`${row.mode}:${row.face}`),['2:XM','2:YM','4:XM','4:YM','4:XP','4:YP','5:ZM','5:XM','5:YM','5:XP','5:YP','1:XM']);
  const words=hCodebook().flatMap(code=>[false,true].flatMap(m=>[0,1,2,3].map(r=>transformTag(code.bits,r,m))));
  assert.equal(words.length,168);for(let i=0;i<words.length;i++)for(let j=i+1;j<words.length;j++)assert(hamming(words[i],words[j])>=4);
});
test('코드북을 받은 호출자의 변이가 인코더 정본을 오염하지 않는다',()=>{
  const expected=hCodebook()[0].bits.slice(),copy=hCodebook();copy[0].bits[0]^=1;copy[0].face='XP';
  assert.deepEqual(hCodebook()[0].bits,expected);assert.equal(hCodebook()[0].face,'ZM');
});
for(let version=0;version<9;version++)test(`H${version} 전체면격자/예약/2톤/6면내보내기`,()=>{
  const l=hLayout(version);assert.equal(l.n,13+4*version);assert.equal(l.roles.size,l.n*l.n);
  assert.equal(l.tagCells.length,16);assert.equal(l.formatCells.length,8);assert.equal(l.routeCells.length,8);
  assert.equal(l.scan.length%3,0);assert.equal(l.reference.length,9);
  for(const mode of[3,6])for(const tones of[2,3]){
    const p={version,mode,tones,ecc:'H',mask:7,routeId:197},triadDigits=Array.from({length:mode/3},()=>Uint8Array.from(l.scan,(_,k)=>k%6));
    const faces=makeFaces({...p,triadDigits}),e={...p,n:l.n,faces};
    for(const [face,levels] of Object.entries(faces)){
      assert(validateHFace(levels,{...p,face}));assert(!validateHFace(levels,{...p,mask:6,face}));
      assert(l.scan.every(c=>levels[c.i*l.n+c.j]<tones));
    }
    const sheet=buildHFaceSheet(e),scene=buildHScene(e);
    assert.equal(sheet.shapes.length,mode*l.n*l.n);assert.deepEqual(scene.hModel.visible,['ZM','XM','YM']);
    assert(scene.shapes.every(s=>s.points.every(q=>q.x>=0&&q.y>=0&&q.x<=scene.width&&q.y<=scene.height)));
  }
});
test('X중심보조회전은한cycle에서6면모두와양triad를보여요',()=>{
  const all=new Set();let front=false,back=false;
  for(let t=0;t<H_ROTATION_PERIOD_MS;t+=250){const v=hProjection(25,hAutoRotation(t)).visible;v.forEach(f=>all.add(f));
    front ||= ['ZM','XM','YM'].every(f=>v.includes(f));back ||= ['ZP','XP','YP'].every(f=>v.includes(f));}
  assert.equal(all.size,6);assert(front&&back);assert.deepEqual(hAutoRotation(0),hAutoRotation(H_ROTATION_PERIOD_MS));
});
test('모든 가시 면의 화면 열/행 방향은 회전해도 반사되지 않아요',()=>{
  let checked=0;
  for(let t=0;t<H_ROTATION_PERIOD_MS;t+=500){
    const view=hProjection(21,{...hAutoRotation(t),perspective:0});
    for(const face of view.visible){
      const origin=view.project(hFacePoint(face,10,10,21));
      const col=view.project(hFacePoint(face,10,11,21));
      const row=view.project(hFacePoint(face,11,10,21));
      const jacobian=(col.x-origin.x)*(row.y-origin.y)-(col.y-origin.y)*(row.x-origin.x);
      assert(jacobian>0,`${face} t=${t} reflected determinant=${jacobian}`);checked++;
    }
  }
  assert(checked>200);
});
