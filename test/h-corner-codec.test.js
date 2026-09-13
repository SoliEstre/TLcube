import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodeH,decodeH,hCapacity} from '../src/h-codec.js';
import {resolveHFinder,H_FACE_IDS} from '../src/h-profile.js';
import {hLayout,hReservedLevel} from '../src/h-layout.js';
import {createHCollector} from '../src/h-collector.js';
import {buildHScene} from '../src/h-render.js';

const profile=e=>({version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,routeId:e.routeId,finder:e.finder});
const observation=(e,face)=>({...profile(e),ok:true,face,levels:e.faces[face].slice(),rotation:0,mirror:false,hamming:0});

test('자동 파인더는 3F H5+와 6F H7+에만 적용하고 frame 기본값은 보존한다',()=>{
  for(let v=0;v<9;v++)for(const mode of [3,6]){
    const expected=v>=(mode===3?5:7)?'corners':'frame';
    assert.equal(resolveHFinder(v,mode,'auto'),expected);
    assert.equal(encodeH('x',{version:v,mode,mask:0}).finder,'frame');
    const e=encodeH('x',{version:v,mode,mask:0,finder:'auto'});
    assert.equal(e.finder,expected);assert.equal(decodeH(e.faces,profile(e)).text,'x');
  }
  assert.throws(()=>encodeH('x',{version:4,finder:'corners'}),RangeError);
  assert.throws(()=>encodeH('x',{finder:'unknown'}),RangeError);
  assert.equal(encodeH('x',{finder:'corners',mask:0}).version,5);
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(source,/fn:encodeH,opts:\{[^\n]+finder:'auto'/);
});

test('사각 H5..H8의 모든 톤/ECC/마스크/면 수에서 최대본문이 왕복한다',()=>{
  for(const version of [5,6,7,8])for(const mode of [3,6])for(const tones of [2,3])for(const ecc of ['L','M','H'])for(let mask=0;mask<8;mask++){
    const opts={version,mode,tones,ecc,mask,finder:'corners'};
    const cap=hCapacity(version,mode,{tones,ecc,mask,finder:'corners'});
    assert.equal(cap.cellCount,({5:537,6:801,7:1095,8:1425})[version]);
    assert.ok(cap.maxPayloadBytes<hCapacity(version,mode,{tones,ecc,mask}).maxPayloadBytes);
    const bytes=Uint8Array.from({length:cap.maxPayloadBytes},(_,i)=>(i*71+version*13+mask)%256);
    const e=encodeH(bytes,opts),d=decodeH(e.faces,profile(e));
    assert.equal(d.ok,true,JSON.stringify(opts));assert.deepEqual(d.bytes,bytes);
    assert.throws(()=>encodeH(new Uint8Array(cap.maxPayloadBytes+1),opts),RangeError);
  }
});

test('자동 버전 선택도 실제 사각 용량으로 판정하고 외곽을 늘리지 않는다',()=>{
  for(const mode of [3,6])for(const ecc of ['L','M','H']){
    for(const size of [0,3,40,110,150,210,260,300,400,500]){
      const expected=Array.from({length:9},(_,v)=>v).find(v=>hCapacity(v,mode,{ecc,finder:'auto'}).maxPayloadBytes>=size);
      if(expected===undefined){assert.throws(()=>encodeH(new Uint8Array(size),{mode,ecc,finder:'auto',mask:0}),RangeError);continue;}
      const e=encodeH(new Uint8Array(size),{mode,ecc,finder:'auto',mask:0});
      assert.equal(e.version,expected);assert.equal(buildHScene(e).hModel.surfaceN,e.n);
      assert.ok(Object.values(e.faces).every(face=>face.length===e.n*e.n));
    }
  }
});

test('같은 본문에서도 레거시/사각 CRC 도메인은 다르고 메타 바꿔치기는 실패한다',()=>{
  const opts={version:7,mode:6,mask:0},a=encodeH('domain',opts),b=encodeH('domain',{...opts,finder:'corners'});
  assert.notEqual(a.crc,b.crc);
  for(const [e,finder] of [[a,'corners'],[b,'frame']])assert.equal(decodeH(e.faces,{...profile(e),finder}).ok,false);
  for(const change of [{mode:3},{tones:2},{ecc:'H'},{mask:1},{routeId:(b.routeId+1)%256},{version:6}]){
    const d=decodeH(b.faces,{...profile(b),...change});assert.equal(d.ok,false);assert.equal(d.bytes,undefined);
  }
  // 예약영역을 거짓 ECC에 맞춰 다시 그려도 RS/CRC가 이를 승인해서는 안 돼요.
  for(const ecc of ['L','H']){
    const p={...profile(b),ecc},faces=structuredClone(b.faces);
    for(const face of H_FACE_IDS)for(const c of hLayout(7,'corners').roles.values()){
      const v=hReservedLevel(c,p,face,p.routeId);if(v!==null)faces[face][c.i*b.n+c.j]=v;
    }
    assert.equal(decodeH(faces,p).ok,false);
  }
});

test('수집은 6개 고유면 이전에 본문을 공개하지 않고 frame/corners를 혼합하지 않는다',()=>{
  const corner=encodeH('six-corners',{version:7,mode:6,mask:0,finder:'corners'}),c=createHCollector();
  for(let k=0;k<6;k++){
    const s=c.addFrame({observations:[observation(corner,H_FACE_IDS[k])],frameId:k,timestamp:k*100});
    assert.equal(s.count,k+1);assert.equal(s.state,k===5?'DONE':'COLLECTING');
    if(k<5)assert.equal(s.result,undefined);else assert.equal(s.result.text,'six-corners');
  }
  const frame=encodeH('legacy',{version:7,mode:6,mask:0}),mixed=createHCollector();
  const s=mixed.addFrame({observations:[observation(frame,'ZM'),observation(corner,'XM')],frameId:0,timestamp:0});
  assert.equal(s.state,'COLLECTING');assert.equal(s.assemblies.length,2);
  assert.deepEqual(new Set(s.assemblies.map(a=>a.profile.finder)),new Set(['frame','corners']));
});
