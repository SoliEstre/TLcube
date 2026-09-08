import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLumaDump } from '../tools/read-luma.mjs';
import { Session } from 'node:inspector';
import { createVerifiedCursorPrototype } from '../src/decoder/cs-verified-cursor-prototype.js';
import { createVerifiedCursorPrototypeV3, SORT_CURSOR_PROTOTYPE_INTERNALS } from '../src/decoder/cs-verified-cursor-v3-prototype.js';
import { detectCellSurfaceBlockShapes } from '../src/decoder/cellsurface-block-detect.js';
const make = () => ({width:48,height:40,data:Float32Array.from({length:1920},(_,i)=>((i%48>>2)+(Math.floor(i/48)>>2))%2),alpha:new Uint8Array(1920).fill(255)});
const identity = l => ({frameId:'f0',timestamp:100,width:l.width,height:l.height,generation:2});
test('군집화 재개 사본은 yield를 빼면 정본의 동일 문장이다',()=>{
  const source=readFileSync(new URL('../src/decoder/cellsurface-block-detect.js',import.meta.url),'utf8');
  const proto=readFileSync(new URL('../src/decoder/cs-verified-cursor-prototype.js',import.meta.url),'utf8');
  const body=s=>s.slice(s.indexOf('{')).replace(/yield '[^']+';/g,'').replace(/\s/g,'');
  assert.equal(body(source.match(/function clusterCores\(candidates, cfg\) \{[\s\S]*?\n\}/)[0]),
    body(proto.match(/function\* clusterSteps\(candidates, cfg\) \{[\s\S]*?\n\}/)[0]));
});
function finish(c, m) { for(let i=0;i<1000000;i++) {const s=c.resume(m); if(s.state==='done'||s.state==='discarded')return s;} throw Error('커서 미종료'); }
test('커서는 원본 verified와 순서·수치가 같고 타이머 on/off가 반환값을 바꾸지 않는다',()=>{
  const l=make(),m=identity(l),events=[];
  const ref=detectCellSurfaceBlockShapes(l), timed=detectCellSurfaceBlockShapes(l,{timing:e=>events.push(e)});
  assert.deepEqual(ref,timed);assert.equal(events.filter(e=>e.stage==='cs.scan').length,1);
  const c=createVerifiedCursorPrototype(l,m,{timing:e=>events.push(e)}); finish(c,m);
  const out=c.takeForFrame(m);assert.deepEqual(out.verified,ref.diagnostics.verified);
  assert.equal(out.coreCandidates,ref.diagnostics.coreCandidates);assert.equal(out.clusterCount,ref.diagnostics.clusterCount);
  assert.equal(out.currentFrameUsable,false);assert.ok(Object.isFrozen(out.verified));
  assert.equal(c.status.snapshotBytes,l.data.byteLength+l.alpha.byteLength);
  assert.ok(events.some(e=>e.stage==='cursor.snapshot-copy'));
});
test('같은 버퍼의 내용·alpha 교체 뒤에도 이전 frame snapshot만 재개한다',()=>{
  const l=make(),m=identity(l),ref=detectCellSurfaceBlockShapes(l).diagnostics;
  const c=createVerifiedCursorPrototype(l,m);c.resume(m);l.data.fill(1);l.alpha.fill(0);
  const current={...m,frameId:'f1',timestamp:133};finish(c,current);
  assert.equal(c.takeForFrame(current),null);
  assert.deepEqual(c.takeForFrame(m).verified,ref.verified);
  assert.equal(c.resume(current).ageMs,33);assert.equal(c.status.origin.frameId,'f0');
});
test('생성 직후 첫 resume 전 픽셀·alpha 교체도 스냅샷의 cores와 결과를 보존한다',()=>{
  for(const create of [createVerifiedCursorPrototype,createVerifiedCursorPrototypeV3]){
    const l=make(),m=identity(l),ref=detectCellSurfaceBlockShapes(l).diagnostics;
    assert.ok(ref.coreCandidates>0,'빈 대조군이면 별칭 변이를 관측할 수 없어요');
    const c=create(l,m);
    l.data.fill(1);l.alpha.fill(0);
    const current={...m,frameId:'f1',timestamp:133};
    const first=c.resume(current);
    assert.equal(first.originFrameId,m.frameId);assert.equal(first.ageMs,33);
    finish(c,current);
    const out=c.takeForFrame(m);
    assert.equal(out.coreCandidates,ref.coreCandidates);
    assert.equal(out.clusterCount,ref.clusterCount);
    assert.deepEqual(out.verified,ref.verified);
    assert.equal(c.takeForFrame(current),null);
  }
});
test('스냅샷 복사 비용은 첫 resume 전부터 최대 단위와 메모리에 포함된다',()=>{
  // 시계 분해능이나 뒤의 긴 단위에 가려지지 않도록 복사 구간의 시계만 결정적으로 제어해요.
  const original=Object.getOwnPropertyDescriptor(performance,'now');
  let tick=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>{tick+=7;return tick;}});
  try{
    for(const create of [createVerifiedCursorPrototype,createVerifiedCursorPrototypeV3]){
      const l=make(),m=identity(l),events=[],c=create(l,m,{timing:e=>events.push(e)});
      assert.equal(c.status.steps,0);assert.equal(c.status.copyMs,7);
      assert.equal(c.status.maxUnitMs,7,'첫 단위인 복사를 최대 단위에서 빼면 안 돼요');
      assert.equal(c.status.snapshotBytes,l.data.byteLength+l.alpha.byteLength);
      assert.deepEqual(events,[{stage:'cursor.snapshot-copy',ms:7}]);
      c.discard();
    }
  }finally{
    if(original)Object.defineProperty(performance,'now',original);else delete performance.now;
  }
});
test('이동·교체 프레임은 미검증 old H를 사용할 수 없고 resize는 진행중 작업을 버린다',()=>{
  for(const create of [createVerifiedCursorPrototype,createVerifiedCursorPrototypeV3]){
  const l=make(),m=identity(l),c=create(l,m);c.resume(m);
  l.data.reverse();const moved={...m,frameId:'moved',timestamp:140};finish(c,moved);
  assert.equal(c.takeForFrame(moved),null);
  const d=create(l,m);d.resume(m);
  assert.equal(d.resume({...m,width:49}).state,'discarded');assert.equal(d.takeForFrame(m),null);
  }
});
test('획득 세대 교체·invalidate·reset은 snapshot 및 결과를 모두 폐기한다',()=>{
  for(const create of [createVerifiedCursorPrototype,createVerifiedCursorPrototypeV3])for(const kind of ['generation','invalidate','reset']) {
    const l=make(),m=identity(l),c=create(l,m);finish(c,m);
    if(kind==='generation')c.resume({...m,generation:3});else if(kind==='reset')c.reset();else c.discard();
    assert.equal(c.status.phase,'discarded');assert.equal(c.takeForFrame(m),null);assert.equal(c.resume(m).state,'discarded');
  }
});
test('identity 없는 cursor를 만들지 않는다',()=>{
  const l=make();assert.throws(()=>createVerifiedCursorPrototype(l,{}),TypeError);
  assert.throws(()=>createVerifiedCursorPrototype(l,{...identity(l),width:0}),TypeError);
});
test('v3 병합 정렬은 중복 키의 원래 순서까지 native stable sort와 같다',()=>{
  for(const length of [0,1,2,3,17,128,513])for(const chunk of [1,7,128]){
    const values=Array.from({length},(_,i)=>({key:(i*37)%13,index:i})),expected=[...values].sort((a,b)=>a.key-b.key);
    const it=SORT_CURSOR_PROTOTYPE_INTERNALS.stableSortSteps(values,(a,b)=>a.key-b.key,chunk);
    while(!it.next().done){};
    assert.deepEqual(values,expected);
  }
});
test('v3도 원본/alpha 교체와 현재 프레임 보류·세대 폐기를 보존한다',()=>{
  const l=make(),m=identity(l),reference=detectCellSurfaceBlockShapes(l).diagnostics;
  const c=createVerifiedCursorPrototypeV3(l,m,{sortMoveChunk:7});c.resume(m);
  l.data.fill(1);l.alpha.fill(0);const current={...m,frameId:'f1',timestamp:133};finish(c,current);
  assert.deepEqual(c.takeForFrame(m).verified,reference.verified);assert.equal(c.takeForFrame(current),null);
  c.resume({...current,generation:3});assert.equal(c.status.phase,'discarded');assert.equal(c.takeForFrame(m),null);
  let invalidTimingCalls=0;
  assert.throws(()=>createVerifiedCursorPrototypeV3(l,m,{sortMoveChunk:0,timing:()=>invalidTimingCalls++}),TypeError);
  assert.equal(invalidTimingCalls,0);
});

test('종료·폐기는 실제 클로저의 스냅샷·파생 캐시 참조를 해제한다',async()=>{
  // cleanup 문장의 철자를 읽지 않아요. Node Inspector로 다음 resume 진입 시
  // 살아 있는 lexical 슬롯을 관측해요. 중단 조건은 항상 false라 실행을 멈추지 않아요.
  // 새로운 숨은 슬롯까지 증명하는 heap 누수 검사는 아니고, 아래 소유 슬롯의 해제 자예요.
  const slots=['snapshot','reduced','cut','scratch','scan','clustering','result','cores','clusters','verified','occupied'];
  const post=(session,method,params={})=>new Promise((resolve,reject)=>{
    session.post(method,params,(error,result)=>error?reject(error):resolve(result));
  });
  const session=new Session(),scripts=[];
  session.connect();session.on('Debugger.scriptParsed',({params})=>scripts.push(params));
  const flag='__tlcubeCursorCleanupProbe';
  assert.equal(Object.hasOwn(globalThis,flag),false);
  try{
    await post(session,'Debugger.enable');
    for(const [file,create]of[
      ['cs-verified-cursor-prototype.js',createVerifiedCursorPrototype],
      ['cs-verified-cursor-v3-prototype.js',createVerifiedCursorPrototypeV3],
    ]){
      const url=new URL('../src/decoder/'+file,import.meta.url).href;
      const script=scripts.find(s=>s.url===url);assert.ok(script,file+'의 실행 스크립트가 있어야 해요');
      const {scriptSource}=await post(session,'Debugger.getScriptSource',{scriptId:script.scriptId});
      const at=scriptSource.indexOf('function resume(current = identity) {');
      assert.notEqual(at,-1,'관측할 public resume 진입점이 있어야 해요');
      const breakpoint=await post(session,'Debugger.setBreakpoint',{
        location:{scriptId:script.scriptId,lineNumber:scriptSource.slice(0,at).split('\n').length-1,columnNumber:0},
        condition:`globalThis[${JSON.stringify(flag)}] = [${slots.map(s=>s+' === null').join(',')}], false`,
      });
      try{
        const read=()=>{const value=globalThis[flag];assert.equal(value?.length,slots.length,'관측 훅이 실행돼야 해요');return Object.fromEntries(slots.map((s,i)=>[s,value[i]]));};
        for(const phase of ['scan-line','cluster','done'])for(const action of ['discard','reset','generation']){
          const l=make(),m=identity(l),c=create(l,m);
          for(let i=0;c.status.phase!==phase&&i<100000;i++)c.resume(m);
          assert.equal(c.status.phase,phase);
          delete globalThis[flag];c.resume(m);const before=read();
          if(phase==='scan-line')for(const slot of ['snapshot','reduced','cut','scratch','scan'])assert.equal(before[slot],false,'대조군 '+slot);
          if(phase==='cluster')assert.equal(before.clustering,false,'generator가 살아 있는 대조군');
          if(phase==='done'){
            assert.equal(before.result,false,'done 결과는 조회 가능한 채 보존해야 해요');
            for(const slot of slots.filter(s=>s!=='result'))assert.equal(before[slot],true,file+' done '+slot);
          }
          if(action==='discard')c.discard();else if(action==='reset')c.reset();else c.resume({...m,generation:3});
          delete globalThis[flag];assert.equal(c.resume(m).state,'discarded');
          const after=read();for(const slot of slots)assert.equal(after[slot],true,file+' '+phase+'/'+action+' '+slot);
          assert.equal(c.takeForFrame(m),null);
        }
      }finally{await post(session,'Debugger.removeBreakpoint',{breakpointId:breakpoint.breakpointId});}
    }
  }finally{delete globalThis[flag];session.disconnect();}
});
test('부분 투명 마스크와 작은 kind별 검증 cap도 정본 verified 순서를 보존한다',()=>{
  const width=96,height=80,data=new Float32Array(width*height).fill(1),alpha=new Uint8Array(width*height).fill(255);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const r=Math.max(Math.abs(x-47.5),Math.abs(y-39.5));
    if(r<9||(r>=15&&r<21))data[y*width+x]=0;
    if(x<3||y<2)alpha[y*width+x]=0;
  }
  const l={width,height,data,alpha},m=identity(l);
  for(const create of [createVerifiedCursorPrototype,createVerifiedCursorPrototypeV3])for(const maximumVerifiedPerKind of [1,2,80]){
    const options={calibration:{csBlockLocator:{maximumVerifiedPerKind}}};
    const ref=detectCellSurfaceBlockShapes(l,options).diagnostics;
    assert.ok(ref.coreCandidates>0);assert.ok(ref.clusterCount>0);
    const c=create(l,m,options);finish(c,m);
    assert.deepEqual(c.takeForFrame(m).verified,ref.verified);
    assert.equal(c.takeForFrame(m).clusterCount,ref.clusterCount);
  }
});

test('비대칭 다중 링은 최종 verified 정렬의 비항등 순서까지 정본과 같다',()=>{
  const width=240,height=180,data=new Float32Array(width*height).fill(1);
  for(const[cx,cy,u,dark]of[[55,48,6,0],[173,71,8,0.12],[100,143,4,0.03]]){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const r=Math.max(Math.abs(x-cx),Math.abs(y-cy));
      if(r<1.5*u||(r>=2.5*u&&r<3.5*u))data[y*width+x]=dark;
    }
  }
  const l={width,height,data,alpha:null},m=identity(l);
  const options={calibration:{csBlockLocator:{maximumVerifiedPerKind:80}}};
  const ref=detectCellSurfaceBlockShapes(l,options).diagnostics;
  assert.equal(ref.verified.length,4,'정렬을 재는 합성 입력의 검출이 퇴화하면 실패해요');
  assert.deepEqual(ref.verified.map(h=>h.kind),['v0-center','v0-center','v0-center','legacy-v2r2-center']);
  assert.ok(ref.verified[3].count>ref.verified[0].count);
  assert.ok(ref.verified[3].score<ref.verified[0].score);
  for(const create of [createVerifiedCursorPrototype,createVerifiedCursorPrototypeV3]){
    const c=create(l,m,options);finish(c,m);
    assert.deepEqual(c.takeForFrame(m).verified,ref.verified);
    assert.equal(c.takeForFrame(m).coreCandidates,ref.coreCandidates);
    assert.equal(c.takeForFrame(m).clusterCount,ref.clusterCount);
  }
});

test('실사진 3장의 verified 순서·수치·cores는 두 재개 커서 모두 정본과 같다',()=>{
  // 코퍼스 누락은 skip하지 않아요. 실사진 정션이 빠진 검증을 초록으로 세지 않아요.
  const paths=['c3-tl/c3-tl.f0000.960.luma','y0/y0.f0007.960.luma',
    'swap-c3tl-c3daehan/swap-c3tl-c3daehan.f0090.960.luma'];
  const options={calibration:{csBlockLocator:{centreWindowFraction:0.5,searchMaxSide:1920,maximumPosesPerFamily:6}}};
  for(const path of paths){
    const l=readLumaDump('test/output/photos/luma/'+path),m={...identity(l),frameId:path};
    const ref=detectCellSurfaceBlockShapes(l,options).diagnostics;
    assert.ok(ref.verified.length>1,path+'에 정렬을 검사할 복수 검출이 있어야 해요');
    for(const create of [createVerifiedCursorPrototype,createVerifiedCursorPrototypeV3]){
      const c=create(l,m,options);finish(c,m);const out=c.takeForFrame(m);
      assert.deepEqual(out.verified,ref.verified,path+'/'+create.name);
      assert.equal(out.coreCandidates,ref.coreCandidates);assert.equal(out.clusterCount,ref.clusterCount);
    }
  }
});
