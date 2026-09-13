import test from 'node:test';
import assert from 'node:assert/strict';
import {cubeVideoDurationMs,cubeVideoSupport,exportCubeMp4,muxAvcMp4,CUBE_VIDEO_LIMITS,CUBE_VIDEO_KEY_COLORS} from '../src/cube-video-export.js';

// 이 짧은 SPS/PPS는 mux 구조/실패 경계용이다. 실제 H.264 디코딩 성공을 주장하지 않는다.
const DESC=Uint8Array.from([1,66,0,31,255,225,0,2,103,66,1,0,2,104,0]);
const FRAME=Uint8Array.from([0,0,0,2,101,128]);
const DELTA=Uint8Array.from([0,0,0,2,65,128]);
function boxes(b,start=0,end=b.length) {
  const out=[]; let at=start;
  while(at<end) {
    assert.ok(at+8<=end,'box header');
    const n=new DataView(b.buffer,b.byteOffset+at,4).getUint32(0);
    assert.ok(n>=8&&at+n<=end,'box size');
    out.push({type:String.fromCharCode(...b.slice(at+4,at+8)),start:at,end:at+n,data:at+8,size:n}); at+=n;
  }
  assert.equal(at,end); return out;
}
const get=(list,type)=>{const x=list.find(b=>b.type===type);assert.ok(x,type);return x;};
const read32=(b,at)=>new DataView(b.buffer,b.byteOffset+at,4).getUint32(0);
const child=(b,p,type)=>get(boxes(b,p.data,p.end),type);
function inspect(b) {
  const roots=boxes(b),mdat=get(roots,'mdat'),moov=get(roots,'moov');
  const trak=child(b,moov,'trak'),mdia=child(b,trak,'mdia'),minf=child(b,mdia,'minf'),stbl=child(b,minf,'stbl');
  const tb=boxes(b,stbl.data,stbl.end);
  const stsd=get(tb,'stsd'); const avc1=get(boxes(b,stsd.data+8,stsd.end),'avc1');
  const avcc=get(boxes(b,avc1.data+78,avc1.end),'avcC');
  return {roots,mdat,moov,trak,mdia,minf,stbl,tb,avc1,avcc};
}

test('X/Y/gyro는 회전 정본의 닫힌 최소 주기를 쓰고 gyro 2:1도 한 주기에 닫혀요',()=>{
  for(const axis of ['x','y','gyro']) {assert.equal(cubeVideoDurationMs({speed:1,axis}),360000);assert.equal(cubeVideoDurationMs({speed:90,axis}),4000);}
  assert.equal(cubeVideoDurationMs({speed:15,axis:'gyro'}),24000);
  for(const speed of [0,91,NaN,Infinity]) assert.throws(()=>cubeVideoDurationMs({speed}));
  assert.throws(()=>cubeVideoDurationMs({axis:'z'}));
});
test('MP4 독립 box/offset/duration/sample/index 및 무음 트랙 구조',async()=>{
  const samples=[{data:FRAME,timestamp:0,duration:41667,key:true},{data:DELTA,timestamp:41667,duration:41666,key:false},{data:DELTA,timestamp:83333,duration:41667,key:false}];
  const blob=muxAvcMp4({width:720,height:480,samples,description:DESC}); assert.equal(blob.type,'video/mp4');
  const b=new Uint8Array(await blob.arrayBuffer()),p=inspect(b);
  assert.deepEqual(p.roots.map(x=>x.type),['ftyp','mdat','moov']);
  assert.equal(p.mdat.size,26); assert.deepEqual(b.slice(p.avcc.data,p.avcc.end),DESC);
  const stco=get(p.tb,'stco');assert.equal(read32(b,stco.data+4),1);assert.equal(read32(b,stco.data+8),p.mdat.data);
  const stsc=get(p.tb,'stsc');assert.deepEqual([0,1,2,3].map(i=>read32(b,stsc.data+4+i*4)),[1,1,3,1]);
  const stsz=get(p.tb,'stsz');assert.equal(read32(b,stsz.data+8),3); assert.deepEqual([0,1,2].map(i=>read32(b,stsz.data+12+i*4)),[6,6,6]);
  const stss=get(p.tb,'stss');assert.equal(read32(b,stss.data+4),1);assert.equal(read32(b,stss.data+8),1);
  const stts=get(p.tb,'stts');assert.equal(read32(b,stts.data+4),3); let duration=0; for(let i=0;i<3;i++) duration+=read32(b,stts.data+8+i*8)*read32(b,stts.data+12+i*8); assert.equal(duration,125000);
  const mdhd=child(b,p.mdia,'mdhd'); assert.equal(read32(b,mdhd.data+12),1000000);assert.equal(read32(b,mdhd.data+16),125000);
  const mvhd=child(b,p.moov,'mvhd'); assert.equal(read32(b,mvhd.data+16),125000);
  const tkhd=child(b,p.trak,'tkhd'); assert.equal(read32(b,tkhd.end-8),720*65536); assert.equal(read32(b,tkhd.end-4),480*65536);
  assert.equal(boxes(b,p.moov.data,p.moov.end).filter(x=>x.type==='trak').length,1);
  const hdlr=child(b,p.mdia,'hdlr'); assert.equal(String.fromCharCode(...b.slice(hdlr.data+8,hdlr.data+12)),'vide');
});
test('mux는 잘못된 크기/AVCC/순서/IDR/샘플 상한을 거부',()=>{
  const good={width:720,height:720,description:DESC,samples:[{data:FRAME,timestamp:0,duration:4000,key:true}]};
  for(const bad of [{width:1441},{height:0},{description:new Uint8Array(7)},{samples:[]},{samples:Array(8641).fill(good.samples[0])},{samples:[{...good.samples[0],timestamp:1}]},{samples:[{...good.samples[0],duration:Infinity}]},{samples:[{...good.samples[0],key:false}]},{samples:[{...good.samples[0],data:DELTA}]},{samples:[{...good.samples[0],data:Uint8Array.from([0,0,0,99,101])}]}]) assert.throws(()=>muxAvcMp4({...good,...bad}));
});
test('최장 360초/8640 샘플도 32비트 duration/offset 안에서 결속',async()=>{
  const samples=Array.from({length:8640},(_,i)=>{const t=Math.round(i*360000000/8640);return {data:i===0?FRAME:DELTA,timestamp:t,duration:Math.round((i+1)*360000000/8640)-t,key:i===0};});
  const b=new Uint8Array(await muxAvcMp4({width:720,height:720,description:DESC,samples}).arrayBuffer());const p=inspect(b);
  assert.equal(read32(b,child(b,p.mdia,'mdhd').data+16),360000000);
  assert.equal(read32(b,get(p.tb,'stsz').data+8),8640);
});

function install(options={}) {
  const old=new Map(),log={frames:0,closedFrames:0,encoderClosed:0,maxPending:0,pending:0,draws:[],fills:[],resizes:[],tracksStopped:0,recorderConstructed:0,captureFps:[]};
  function set(name,value) {old.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});}
  const context={setTransform(){},save(){},restore(){},fillRect(...args){log.fills.push([this.fillStyle,...args]);}};
  const canvas={width:0,height:0,getContext(){return options.noContext?null:context;}};
  if(options.recorder) canvas.captureStream=fps=>{log.captureFps.push(fps);return {getAudioTracks:()=>[],getVideoTracks:()=>[{}],getTracks:()=>[{stop(){log.tracksStopped++;}}]};};
  set('document',{createElement(){return canvas;}});
  set('HTMLCanvasElement',function(){}); if(options.recorder) globalThis.HTMLCanvasElement.prototype.captureStream=()=>{};
  set('VideoFrame',class{constructor(canvas,opts){this.opts=opts;log.frames++;}close(){log.closedFrames++;}});
  set('VideoEncoder',options.noEncoder?undefined:class{
    static async isConfigSupported(config){log.config=config;if(options.supportHang)return new Promise(()=>{});return {supported:!options.unsupported};}
    constructor(callbacks){this.callbacks=callbacks;this.state='unconfigured';this.queue=[];}
    configure(config){if(options.configureError)throw Error('configure failed');this.state='configured';log.actualConfig=config;}
    encode(frame,{keyFrame}){if(options.encodeError)throw Error('encode failed');this.queue.push({opts:frame.opts,keyFrame});log.pending++;log.maxPending=Math.max(log.maxPending,log.pending);}
    async flush(){
      if(options.hangFlush)return new Promise(()=>{});
      if(options.errorCallback){this.callbacks.error(Error('codec failed'));return;}
      for(const f of this.queue.splice(0)) {
        log.pending--;if(options.drop)continue;
        const data=f.keyFrame?FRAME:DELTA;
        const chunk={type:f.keyFrame?'key':'delta',timestamp:f.opts.timestamp+(options.reorder?1:0),byteLength:options.huge?9*1024*1024:data.length,copyTo(out){out.set(data);}};
        this.callbacks.output(chunk,options.noDescription?{}:{decoderConfig:{description:DESC}});
      }
    }
    close(){this.state='closed';log.encoderClosed++;}
  });
  set('MediaRecorder',options.recorder?class{
    static isTypeSupported(type){return type.includes('avc1');}
    constructor(stream,config){log.recorderConstructed++;this.mimeType=options.webm?'video/webm':config.mimeType;this.state='inactive';}
    start(){this.state='recording';if(options.recorderError)queueMicrotask(()=>this.onerror?.({error:Error('recorder failed')}));else if(!options.startHang)queueMicrotask(()=>{if(options.mimeChanged)this.mimeType='video/mp4;codecs=av01';this.onstart?.();});}
    stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([options.badMp4?'not mp4 bytes':Uint8Array.from([0,0,0,12,102,116,121,112,105,115,111,109])])});this.onstop?.();});}
  }:undefined);
  return {log,canvas,restore(){for(const[name,descriptor]of old)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}};
}
async function mocked(options,fn){const env=install(options);try{return await fn(env);}finally{env.restore();}}
const basic={durationMs:125,width:16,height:16,fps:24,renderFrame(){}};
test('WebCodecs 순차 프레임/2개 flush/backpressure/close 및 정확 타임스탬프',()=>mocked({},async({log,canvas})=>{
  const progress=[];const blob=await exportCubeMp4({...basic,onProgress:p=>progress.push(p),renderFrame(frame){log.draws.push(frame.timestampMs);}});
  assert.equal(blob.type,'video/mp4');assert.equal(log.frames,3);assert.equal(log.closedFrames,3);assert.equal(log.encoderClosed,1);assert.equal(log.maxPending,2);
  assert.deepEqual(log.draws,[0,125/3,250/3]);assert.equal(log.actualConfig.avc.format,'avc');assert.equal(log.actualConfig.latencyMode,'quality');assert.equal(progress.at(-1).ratio,1);assert.ok(progress.slice(0,-1).every(p=>p.ratio<1));assert.equal(canvas.width,1);
}));
test('미지원 AVC는 WebM으로 이름 변경하지 않고 안내',()=>mocked({unsupported:true},async()=>{
  assert.equal((await cubeVideoSupport()).supported,false);await assert.rejects(exportCubeMp4(basic),{name:'NotSupportedError'});
}));
test('WebCodecs 미지원이면 AVC MP4 MediaRecorder만 선택',()=>mocked({noEncoder:true,recorder:true},async({log})=>{
  assert.equal((await cubeVideoSupport()).method,'mediarecorder');const blob=await exportCubeMp4({...basic,durationMs:1});assert.equal(blob.type,'video/mp4');assert.equal(log.tracksStopped,1);
}));
for(const [name,opts,pattern]of [
  ['configure',{configureError:true},/configure failed/],['encode',{encodeError:true},/encode failed/],['codec callback',{errorCallback:true},/codec failed/],
  ['dropped',{drop:true},/omitted/],['reordered',{reorder:true},/reordered/],['description',{noDescription:true},/configuration/],['byte budget',{huge:true},/sample bytes/],
]) test(`${name} 실패는 리소스 정리하고 빈/손상 MP4를 반환하지 않는다`,()=>mocked(opts,async({log})=>{
  await assert.rejects(exportCubeMp4(basic),pattern);assert.equal(log.encoderClosed,1);assert.equal(log.closedFrames,log.frames);
}));
test('시작 전 취소는 canvas/encoder를 만들지 않는다',()=>mocked({},async({log})=>{
  const controller=new AbortController();controller.abort();await assert.rejects(exportCubeMp4({...basic,signal:controller.signal}),{name:'AbortError'});assert.equal(log.frames,0);assert.equal(log.encoderClosed,0);
}));
test('flush 무응답 타임아웃도 close',()=>mocked({hangFlush:true},async({log})=>{
  await assert.rejects(exportCubeMp4({...basic,timeoutMs:20}),{name:'TimeoutError'});assert.equal(log.encoderClosed,1);assert.equal(log.closedFrames,log.frames);
}));
test('capability 무응답도 export timeout에 묶인다',()=>mocked({supportHang:true},async({log})=>{
  await assert.rejects(exportCubeMp4({...basic,timeoutMs:20}),{name:'TimeoutError'});assert.equal(log.encoderClosed,0);
}));
test('대기 중 취소 및 draw 오류는 정리',()=>mocked({},async({log})=>{
  const controller=new AbortController();const p=exportCubeMp4({...basic,signal:controller.signal,renderFrame(){controller.abort();return new Promise(()=>{});}});
  await assert.rejects(p,{name:'AbortError'});assert.equal(log.encoderClosed,1);assert.equal(log.frames,0);
}));
test('잘못된 입력은 렌더 시작 전 거부',()=>mocked({},async({log})=>{
  for(const bad of [{width:721},{height:17},{fps:121},{durationMs:360001},{durationMs:NaN},{timeoutMs:600001},{background:'transparent'},{background:{r:0,g:0,b:256}},{renderFrame:null}])await assert.rejects(exportCubeMp4({...basic,...bad}));assert.equal(log.frames,0);
}));
test('합성 배경 RGB 보존/키 색/체커보드와 default green',()=>mocked({},async({log})=>{
  assert.equal(CUBE_VIDEO_KEY_COLORS.blue,'#0099ff');
  for(const [background,color]of [[undefined,'#00ff00'],['green','#00ff00'],['blue','#0099ff'],['magenta','#ff00ff'],[{r:12,g:34,b:56},'rgb(12,34,56)'],['checker','#ffffff']]){
    log.fills.length=0;await exportCubeMp4({...basic,durationMs:1,background});assert.equal(log.fills[0][0],color);
  }
}));
test('renderFrame이 canvas 크기를 바꾸면 실패',()=>mocked({},async()=>{
  await assert.rejects(exportCubeMp4({...basic,renderFrame({canvas}){canvas.width=18;}}),/resized/);
}));
for(const [name,opts,pattern]of [['WebM MIME',{webm:true},/select MP4/],['잘못된 컨테이너',{badMp4:true},/not an MP4/],['recorder error',{recorderError:true},/recorder failed/]])test(`MediaRecorder ${name} 거부/track stop`,()=>mocked({noEncoder:true,recorder:true,...opts},async({log})=>{
  await assert.rejects(exportCubeMp4({...basic,durationMs:1}),pattern);assert.equal(log.tracksStopped,1);
}));
test('MediaRecorder 시작 후 AVC가 아닌 codec 변화 거부',()=>mocked({noEncoder:true,recorder:true,mimeChanged:true},async({log})=>{
  await assert.rejects(exportCubeMp4({...basic,durationMs:1}),/start AVC\/MP4/);assert.equal(log.tracksStopped,1);
}));
test('MediaRecorder start 무응답도 timeout/track stop',()=>mocked({noEncoder:true,recorder:true,startHang:true},async({log})=>{
  await assert.rejects(exportCubeMp4({...basic,durationMs:1,timeoutMs:20}),{name:'TimeoutError'});assert.equal(log.tracksStopped,1);
}));
test('명시한 상한은 최장 저속 영상과 일치',()=>{assert.equal(CUBE_VIDEO_LIMITS.maxFrames,CUBE_VIDEO_LIMITS.maxDurationMs*CUBE_VIDEO_LIMITS.maxFps/1000);assert.equal(CUBE_VIDEO_LIMITS.batchFrames,2);});
test('24/30/60/120 capability는 실제 fps·baseline AVC 설정을 묻고 121을 거부해요',()=>mocked({},async({log})=>{
  const expected={24:'avc1.42001f',30:'avc1.42001f',60:'avc1.420020',120:'avc1.42002a'};
  for(const fps of [24,30,60,120]) {assert.deepEqual(await cubeVideoSupport({width:720,height:720,fps}),{supported:true,method:'webcodecs'});assert.equal(log.config.framerate,fps);assert.equal(log.config.codec,expected[fps]);}
  await assert.rejects(cubeVideoSupport({fps:121}),RangeError);
}));
test('60/120 또는 frame-accurate 요청은 MediaRecorder fallback으로 거짓 FPS/루프를 만들지 않아요',()=>mocked({noEncoder:true,recorder:true},async({log})=>{
  for(const fps of [60,120]) {const support=await cubeVideoSupport({fps});assert.equal(support.supported,false);assert.equal(support.method,null);await assert.rejects(exportCubeMp4({...basic,fps,durationMs:1}),{name:'NotSupportedError'});}
  const exact=await cubeVideoSupport({fps:24,requireFrameAccuracy:true});assert.equal(exact.supported,false);assert.equal(exact.method,null);
  await assert.rejects(exportCubeMp4({...basic,durationMs:1,requireFrameAccuracy:true}),{name:'NotSupportedError'});
  assert.equal(log.recorderConstructed,0);assert.deepEqual(log.captureFps,[]);
  assert.equal((await cubeVideoSupport({fps:30})).method,'mediarecorder');
}));



test('1440 상한과 720/1080/1440 120fps capability는 요청 크기·FPS를 낮추지 않아요',()=>mocked({},async({log})=>{
  assert.equal(CUBE_VIDEO_LIMITS.maxDimension,1440);
  const codecs={720:'avc1.42002a',1080:'avc1.420033',1440:'avc1.420033'};
  for(const size of [720,1080,1440]){
    assert.deepEqual(await cubeVideoSupport({width:size,height:size,fps:120}),{supported:true,method:'webcodecs'});
    assert.equal(log.config.width,size);assert.equal(log.config.height,size);assert.equal(log.config.framerate,120);assert.equal(log.config.codec,codecs[size]);
  }
  await assert.rejects(cubeVideoSupport({width:1441,height:2,fps:24}),RangeError);
}));

test('비정수 frame duration은 requested FPS의 정수 count와 endpoint 없는 phase를 함께 보존해요',()=>mocked({},async({log})=>{
  const phases=[];
  await exportCubeMp4({durationMs:4800,width:16,height:16,fps:24,renderFrame:frame=>phases.push(frame.timestampMs)});
  assert.equal(log.frames,116);assert.equal(log.actualConfig.framerate,24);
  assert.equal(phases[0],0);assert.equal(phases.at(-1),4800*115/116);assert.ok(phases.at(-1)<4800);
}));
