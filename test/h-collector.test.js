import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH,decodeH} from '../src/h-codec.js';
import {H_FACE_IDS} from '../src/h-profile.js';
import {hLayout} from '../src/h-layout.js';
import {createHCollector} from '../src/h-collector.js';
function obs(encoded,face,score=.8){return {ok:true,version:encoded.version,n:encoded.n,mode:encoded.mode,
  tones:encoded.tones,ecc:encoded.ecc,mask:encoded.mask,routeId:encoded.routeId,face,
  levels:encoded.faces[face].slice(),rotation:0,mirror:false,hamming:0,quality:{score}};}
function push(c,observations,frame,timestamp=frame*100,more={}){return c.addFrame({observations,frameId:frame,timestamp,...more});}
function damaged(e,face,score=.9){const o=obs(e,face,score);for(const cell of hLayout(e.version).scan)o.levels[cell.i*e.n+cell.j]=(o.levels[cell.i*e.n+cell.j]+1)%e.tones;return o;}

test('H 부분면은3/6 unique가 모인 뒤에만 정확한 본문을 복호해요',()=>{
  for(const version of [0,2,4,7])for(const mode of [3,6])for(const tones of [2,3]){
    const e=encodeH('A',{version,mode,tones,ecc:'M',mask:3});let calls=0;
    const c=createHCollector({decode:(...args)=>{calls++;return decodeH(...args);}});
    for(let k=0;k<mode;k++){
      const s=push(c,[obs(e,H_FACE_IDS[k])],k);
      assert.equal(s.count,k+1);assert.equal(s.required,mode);
      if(k<mode-1){assert.equal(calls,0);assert.equal(s.state,'COLLECTING');assert.equal(s.result,undefined);}
      else {assert.equal(calls,1);assert.equal(s.state,'DONE');assert.equal(s.result.text,'A');}
    }
  }
});
test('동일 프레임/면은 중복 계산하지 않고 입력/출력 배열 변경에서 분리해요',()=>{
  const e=encodeH('copy',{version:2,mode:3,mask:0}),c=createHCollector(),first=obs(e,'ZM');
  push(c,[first],1);first.levels.fill(0);const same=push(c,[obs(e,'XM')],1);assert.equal(same.count,1);
  push(c,[obs(e,'ZM')],2);assert.equal(c.snapshot().count,1);
  const done=push(c,[obs(e,'XM'),obs(e,'YM')],3);assert.equal(done.result.text,'copy');
  done.result.bytes.fill(0);assert.equal(new TextDecoder().decode(c.snapshot().result.bytes),'copy');
});
test('나쁜 두 면 뒤 좋은 재관측으로 같은 수집을 수리해요',()=>{
  const e=encodeH('repair repeated faces',{version:2,mode:3,tones:2,ecc:'L',mask:0}),c=createHCollector();
  const bad=push(c,[damaged(e,'ZM'),damaged(e,'XM'),obs(e,'YM')],1);
  assert.equal(bad.state,'COLLECTING');assert.equal(bad.result,undefined);
  push(c,[obs(e,'ZM',.4)],2);
  const done=push(c,[obs(e,'XM',.4)],3);assert.equal(done.state,'DONE');assert.equal(done.result.text,'repair repeated faces');
});
test('반사·1bit tag·잘못된 예약영역·누락 프로파일은 묶음조차 만들지 않아요',()=>{
  const e=encodeH('A',{version:0}),bad=[{...obs(e,'ZM'),mirror:true},{...obs(e,'ZM'),hamming:1},obs(e,'ZM'),obs(e,'ZM')];
  bad[2].levels[0]=3;delete bad[3].tones;
  const s=push(createHCollector(),bad,1);assert.equal(s.state,'EMPTY');assert.equal(s.assemblies.length,0);assert.equal(s.stats.rejected,4);
});
test('90초 수명은48초 회전을 보존하고 오래된 면은 따로 만료해요',()=>{
  const e=encodeH('A',{version:0,mode:6}),c=createHCollector();
  push(c,H_FACE_IDS.slice(0,3).map(f=>obs(e,f)),1,0);
  assert.equal(push(c,H_FACE_IDS.slice(3).map(f=>obs(e,f)),2,48_000).state,'DONE');
  c.reset();push(c,[obs(e,'ZM')],3,0);push(c,[obs(e,'XM')],4,89_000);
  assert.deepEqual(c.snapshot().assemblies[0].faceExpiresAt,{ZM:90000,XM:179000});
  const live=c.advance(91_000);assert.equal(live.count,1);assert.equal(live.missing.includes('ZM'),true);
  c.advance(180_000);assert.equal(c.snapshot().state,'EMPTY');
  const expired=push(c,[obs(e,'YM')],5,90_000);assert.equal(expired.state,'EMPTY');
});
test('다른 세션/track은 독립이고 취소는 대상 세션만 지워요',()=>{
  const e=encodeH('tracks',{version:2}),c=createHCollector();
  push(c,[obs(e,'ZM')],1,0,{sessionId:'one',trackId:'a'});
  push(c,[obs(e,'XM')],2,10,{sessionId:'one',trackId:'b'});
  push(c,[obs(e,'YM')],3,20,{sessionId:'two'});
  assert.equal(c.snapshot('one').assemblies.length,2);assert.equal(c.snapshot('two').count,1);
  c.cancel('one');assert.equal(c.snapshot('one').state,'EMPTY');assert.equal(c.snapshot('two').count,1);
});
test('동일route8의 다른 본문은 혼합 완료하지 않고 재수집으로 회복해요',()=>{
  const map=new Map();let pair=null;
  for(let k=0;k<2048&&!pair;k++){
    const text=`route collision payload ${k}`,e=encodeH(text,{version:2,mode:3,tones:2,ecc:'L',mask:0});
    if(map.has(e.routeId))pair=[map.get(e.routeId),{e,text}];else map.set(e.routeId,{e,text});
  }
  assert.ok(pair,'서로 다른 fullCRC의 route8 충돌 표본');const [a,b]=pair;assert.notEqual(a.e.crc,b.e.crc);
  const c=createHCollector(),mix=push(c,[obs(a.e,'ZM'),obs(b.e,'XM'),obs(b.e,'YM')],1);
  assert.equal(mix.state,'COLLECTING');assert.equal(mix.result,undefined);
  const fixed=push(c,[obs(a.e,'XM'),obs(a.e,'YM')],2);assert.equal(fixed.state,'DONE');assert.equal(fixed.result.text,a.text);
});
test('후보 수와 매 갱신 복호 시도는 유한해요',()=>{
  const e=encodeH('limit',{version:2,mode:6,tones:2,ecc:'L',mask:0});let calls=0;
  const c=createHCollector({maxAssemblies:2,maxDecodeAttemptsPerUpdate:8,decode:()=>{calls++;return {ok:false,reason:'fixture'};}});
  const s=push(c,H_FACE_IDS.flatMap(f=>[obs(e,f),damaged(e,f)]),1);
  assert.equal(calls,8);assert.equal(s.stats.lastAttempts,8);assert.equal(s.state,'COLLECTING');assert.equal(s.result,undefined);
  const next=push(c,[],2);assert.equal(calls,16);assert.equal(next.stats.lastAttempts,8);
  push(c,[obs(e,'ZM')],3,300,{trackId:'second'});push(c,[obs(e,'ZM')],4,400,{trackId:'third'});
  assert.equal(c.snapshot().assemblies.length,2);
  assert.equal(Object.values(c.snapshot().assemblies[0].variants).every(n=>n<=2),true);
});
