/** 통합 public codec 대상: root 원격 큐 전용 exhaustive matrix예요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {hCapacity,encodeH,decodeH} from '../src/h-codec.js';
const profile=e=>({version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,finder:e.finder,routeId:e.routeId});
test('H2/4/5 all-version×tone×ECC×mask frame/corners capacity 끝과 +1 경계',()=>{
  for(const finder of ['frame','corners'])for(let version=0;version<=8;version++)for(const mode of [2,4,5])for(const tones of [2,3])for(const ecc of ['L','M','H'])for(let mask=0;mask<8;mask++){
    if(finder==='corners'&&version<5){assert.throws(()=>hCapacity(version,mode,{tones,ecc,mask,finder}),RangeError);continue;}
    let cap;try{cap=hCapacity(version,mode,{tones,ecc,mask,finder});}catch(error){assert.match(String(error?.message),/packet|심볼|패리티/);continue;}
    assert.equal(cap.maxPayloadBytes,cap.groups.reduce((sum,group)=>sum+group.chunkBytes,0));
    const bytes=Uint8Array.from({length:cap.maxPayloadBytes},(_,i)=>(i*71+version*19+mode*7+tones+mask)&255);
    const encoded=encodeH(bytes,{version,mode,tones,ecc,mask,finder}),decoded=decodeH(encoded.faces,profile(encoded));
    assert.equal(decoded.ok,true,`${finder}/${version}/${mode}/${tones}/${ecc}/${mask}`);assert.deepEqual(decoded.bytes,bytes);
    assert.throws(()=>encodeH(new Uint8Array(cap.maxPayloadBytes+1),{version,mode,tones,ecc,mask,finder}),RangeError);
  }
});
