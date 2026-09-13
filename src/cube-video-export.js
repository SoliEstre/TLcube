/**
 * 한 회전 무음 AVC/MP4. 네트워크·패키지 의존성 없음.
 * WebCodecs의 AVCC access unit + decoderConfig.description(avcC)를 ISO BMFF로 묶는다.
 * 지원하지 않는 경우에만 실제 video/mp4 MediaRecorder를 사용한다. WebM 위장 금지.
 */
import {hRotationPeriodMs} from './h-rotation.js';
export const CUBE_VIDEO_LIMITS = Object.freeze({
  maxDimension: 1440, maxFps: 120, maxDurationMs: 360000,
  maxBytes: 96 * 1024 * 1024, maxFrames: 43200, batchFrames: 2,
  timeoutMs: 600000,
});

const MP4_MIMES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1'];
// OBS chroma-key presets use RGBA-packed 0xFF9900 for blue: CSS RGB #0099ff.
export const CUBE_VIDEO_KEY_COLORS = Object.freeze({ green: '#00ff00', blue: '#0099ff', magenta: '#ff00ff' });
const COLORS = CUBE_VIDEO_KEY_COLORS;
const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));
const zeros = n => new Uint8Array(n);
function u16(...values) { const b = new Uint8Array(values.length * 2); const v = new DataView(b.buffer); values.forEach((n,i) => v.setUint16(i*2,n)); return b; }
function u32(...values) { const b = new Uint8Array(values.length * 4); const v = new DataView(b.buffer); values.forEach((n,i) => v.setUint32(i*4,n)); return b; }
function join(parts) { const b = new Uint8Array(parts.reduce((n,p) => n+p.byteLength,0)); let at=0; for(const p of parts) { b.set(p,at); at+=p.byteLength; } return b; }
function box(type,...parts) { return join([u32(8+parts.reduce((n,p)=>n+p.byteLength,0)),ascii(type),...parts]); }
function full(type,flags,...parts) { return box(type,u32(flags),...parts); }
const MATRIX = u32(0x10000,0,0,0,0x10000,0,0,0,0x40000000);
function failure(message,name='Error') { const e = new Error(message); e.name=name; return e; }
function range(value,min,max,name,integer=false) {
  if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value))) throw new RangeError(`${name}: ${min}..${max}`);
  return value;
}
function dimensions(width,height,fps) {
  range(width,2,CUBE_VIDEO_LIMITS.maxDimension,'width',true); range(height,2,CUBE_VIDEO_LIMITS.maxDimension,'height',true); range(fps,1,CUBE_VIDEO_LIMITS.maxFps,'fps',true);
  if(width%2||height%2) throw new RangeError('AVC dimensions must be even');
}
function backgroundValue(background) {
  if(background==='checker'||Object.hasOwn(COLORS,background)) return background;
  if(background&&typeof background==='object') {
    for(const c of ['r','g','b']) range(background[c],0,255,`background.${c}`);
    return {r:background.r,g:background.g,b:background.b};
  }
  throw new TypeError('background must be checker/green/blue/magenta or RGB');
}

/** H 회전 정본의 최소 반복 길이를 그대로 영상 길이로 써서 시작/끝 자세를 맞춰요. */
export function cubeVideoDurationMs({speed=15,axis='y',tiltMode='face'}={}) {
  return hRotationPeriodMs({axis,speed,tiltMode});
}

function encoderConfig(width,height,fps) {
  // AVC level은 실제 macroblock 처리량(ceil(width/16)*ceil(height/16)*fps)으로 고르고, capability에는 요청 FPS를 그대로 물어요.
  const frameBlocks=Math.ceil(width/16)*Math.ceil(height/16),macroblocks=frameBlocks*fps;
  const bitrate=Math.min(32000000,Math.max(2000000,Math.round(8000000*width*height/(720*720)*Math.max(1,fps/24))));
  const levels=[['1f',3600,108000,14000000],['20',5120,216000,20000000],['28',8192,245760,20000000],['2a',8704,522240,50000000],['33',36864,983040,240000000]];
  const level=levels.find(([,fs,mbps,br])=>frameBlocks<=fs&&macroblocks<=mbps&&bitrate<=br);
  if(!level)throw new RangeError('AVC level budget');
  const codec='avc1.4200'+level[0];
  return {codec,width,height,framerate:fps,bitrate,
    latencyMode:'quality',hardwareAcceleration:'no-preference',alpha:'discard',avc:{format:'avc'}};
}

/** capability는 성공 보증이 아니다. configure/start 자원 부족은 호출 시 명시적으로 실패한다. */
export async function cubeVideoSupport({width=720,height=720,fps=24,requireFrameAccuracy=false}={}) {
  dimensions(width,height,fps);
  if(typeof globalThis.VideoEncoder==='function'&&typeof globalThis.VideoFrame==='function') {
    try { if((await globalThis.VideoEncoder.isConfigSupported(encoderConfig(width,height,fps))).supported) return {supported:true,method:'webcodecs'}; } catch { /* 실제 MP4 capability만 다음으로 */ }
  }
  // captureStream은 요청 FPS를 보증하지 않아요. 고 FPS를 조용히 낮추지 않아요.
  if(fps>30||requireFrameAccuracy) return {supported:false,method:null,reason:'정확한 FPS와 반복 경계를 유지하는 AVC/MP4 내보내기는 WebCodecs 지원이 필요해요.'};
  if(typeof globalThis.MediaRecorder==='function'&&typeof globalThis.HTMLCanvasElement?.prototype?.captureStream==='function') {
    for(const mimeType of MP4_MIMES) {
      try { if(globalThis.MediaRecorder.isTypeSupported(mimeType)) return {supported:true,method:'mediarecorder',mimeType}; } catch { /* 다음 MP4 타입 */ }
    }
  }
  return {supported:false,method:null,reason:'This browser does not support AVC/MP4 export.'};
}

function avcDescription(description) {
  const b = description instanceof ArrayBuffer ? new Uint8Array(description) : ArrayBuffer.isView(description) ? new Uint8Array(description.buffer,description.byteOffset,description.byteLength) : null;
  if(!b||b.length<7||b.length>65536||b[0]!==1||b[1]!==66) throw failure('Invalid baseline AVC configuration');
  const lengthSize=(b[4]&3)+1;
  if(lengthSize===3) throw failure('Invalid AVC NAL length size');
  let p=6; const spsCount=b[5]&31;
  if(spsCount<1) throw failure('Missing AVC SPS');
  function units(count,type) {
    for(let i=0;i<count;i++) {
      if(p+2>b.length) throw failure('Truncated AVC configuration');
      const n=(b[p]<<8)|b[p+1]; p+=2;
      if(n<1||p+n>b.length||(b[p]&31)!==type) throw failure('Invalid AVC parameter set');
      p+=n;
    }
  }
  units(spsCount,7);
  if(p>=b.length) throw failure('Missing AVC PPS');
  const ppsCount=b[p++]; if(ppsCount<1) throw failure('Missing AVC PPS'); units(ppsCount,8);
  if(p!==b.length) throw failure('Unsupported AVC configuration extension');
  return {bytes:b.slice(),lengthSize};
}
function validAccessUnit(bytes,lengthSize,key) {
  let at=0,hasPicture=false,hasIdr=false;
  while(at<bytes.length) {
    if(at+lengthSize>bytes.length) throw failure('Truncated AVC NAL');
    let n=0; for(let i=0;i<lengthSize;i++) n=n*256+bytes[at++];
    if(n<1||at+n>bytes.length) throw failure('Invalid AVC NAL length');
    const type=bytes[at]&31; hasPicture ||= type===1||type===5; hasIdr ||= type===5; at+=n;
  }
  if(!hasPicture||(key&&!hasIdr)) throw failure('Missing AVC picture/IDR');
}

/** 내부 샘플 테이블: 단일 비디오 트랙, DTS=PTS baseline AVC, 원본 바이트 재연결 없음. */
function finishMp4({width,height,samples,description,totalBytes}) {
  const duration=samples.reduce((n,s)=>n+s.duration,0);
  const ftyp=box('ftyp',ascii('isom'),u32(512),ascii('isomiso2avc1mp41'));
  const mvhd=full('mvhd',0,u32(0,0,1000000,duration,0x10000),u16(0x100,0),zeros(8),MATRIX,zeros(24),u32(2));
  const tkhd=full('tkhd',7,u32(0,0,1,0,duration),zeros(8),u16(0,0,0,0),MATRIX,u32(width*65536,height*65536));
  const mdhd=full('mdhd',0,u32(0,0,1000000,duration),u16(0x55c4,0));
  const hdlr=full('hdlr',0,u32(0),ascii('vide'),zeros(12),ascii('TLcube Video\0'));
  const compressor=zeros(32); compressor[0]=6; compressor.set(ascii('TLcube'),1);
  const avc1=box('avc1',zeros(6),u16(1),zeros(16),u16(width,height),u32(0x480000,0x480000,0),u16(1),compressor,u16(24,0xffff),box('avcC',description));
  const runs=[];
  for(const s of samples) { const last=runs[runs.length-1]; if(last&&last[1]===s.duration) last[0]++; else runs.push([1,s.duration]); }
  const keys=samples.flatMap((s,i)=>s.key?[i+1]:[]);
  const stbl=box('stbl',full('stsd',0,u32(1),avc1),full('stts',0,u32(runs.length),...runs.map(r=>u32(...r))),
    full('stsc',0,u32(1,1,samples.length,1)),full('stsz',0,u32(0,samples.length),u32(...samples.map(s=>s.size))),
    full('stco',0,u32(1,ftyp.length+8)),full('stss',0,u32(keys.length),u32(...keys)));
  const dinf=box('dinf',full('dref',0,u32(1),full('url ',1)));
  const minf=box('minf',full('vmhd',1,u16(0,0,0,0)),dinf,stbl);
  const moov=box('moov',mvhd,box('trak',tkhd,box('mdia',mdhd,hdlr,minf)));
  return new Blob([ftyp,u32(totalBytes+8),ascii('mdat'),...samples.map(s=>s.data),moov],{type:'video/mp4'});
}

/** 독립 mux 회귀용 공개 경계. 입력은 AVCC(Annex B 아님), 순서대로 0부터 연속이다. */
export function muxAvcMp4({width,height,fps=24,samples,description}) {
  dimensions(width,height,fps);
  if(!Array.isArray(samples)||samples.length<1||samples.length>CUBE_VIDEO_LIMITS.maxFrames) throw new RangeError('sample count');
  const desc=avcDescription(description); let totalBytes=0,timestamp=0;
  const validated=[];
  for(const s of samples) {
    const data=s.data;
    if(!(data instanceof Uint8Array)||data.length<1) throw new TypeError('sample bytes');
    range(s.duration,1,360000000,'sample duration',true);
    if(s.timestamp!==timestamp) throw failure('AVC samples must have continuous DTS=PTS');
    timestamp+=s.duration; range(timestamp,1,360000000,'duration');
    totalBytes+=data.length; range(totalBytes,1,CUBE_VIDEO_LIMITS.maxBytes,'encoded bytes');
    validAccessUnit(data,desc.lengthSize,!!s.key);
    validated.push({data,size:data.length,duration:s.duration,key:!!s.key});
  }
  if(!validated[0].key) throw failure('First AVC sample must be a key frame');
  return finishMp4({width,height,samples:validated,description:desc.bytes,totalBytes});
}

function paintBackground(context,width,height,background) {
  context.setTransform(1,0,0,1,0,0); context.globalAlpha=1; context.globalCompositeOperation='source-over';
  if(background==='checker') {
    context.fillStyle='#ffffff'; context.fillRect(0,0,width,height); context.fillStyle='#c8c8c8';
    for(let y=0;y<height;y+=24) for(let x=0;x<width;x+=24) if(((x/24+y/24)&1)===1) context.fillRect(x,y,24,24);
  } else {
    context.fillStyle=typeof background==='string'?COLORS[background]:`rgb(${background.r},${background.g},${background.b})`;
    context.fillRect(0,0,width,height);
  }
}

function guardOperation(signal,timeoutMs) {
  let stopped=null; const listeners=new Set();
  const fail=e=>{ if(!stopped) { stopped=e; for(const reject of listeners) reject(e); listeners.clear(); } };
  const abort=()=>fail(failure('MP4 export cancelled','AbortError'));
  if(signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>fail(failure('MP4 export timed out','TimeoutError')),timeoutMs);
  return {
    check(){ if(stopped) throw stopped; }, fail,
    wait(promise) {
      if(stopped) return Promise.reject(stopped);
      return new Promise((resolve,reject)=>{
        const rejectStopped=e=>reject(e); listeners.add(rejectStopped);
        Promise.resolve(promise).then(v=>{listeners.delete(rejectStopped);if(stopped)reject(stopped);else resolve(v);},e=>{listeners.delete(rejectStopped);reject(e);});
      });
    },
    dispose(){ clearTimeout(timer); signal?.removeEventListener('abort',abort); listeners.clear(); },
  };
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/**
 * renderFrame은 전용 canvas/context에 투명한 물체만 합성하고, 호출자가 입력 상태를 고정해요.
 * 배경 삭제나 canvas 크기 변경은 하지 않아요. signal은 같은 작업의 취소 신호예요.
 * onProgress({method,completed,total,ratio})。完了前に ratio=1 は通知しない。
 */
export async function exportCubeMp4({renderFrame,durationMs,width=720,height=720,fps=24,
  background='green',signal,onProgress,requireFrameAccuracy=false,timeoutMs=CUBE_VIDEO_LIMITS.timeoutMs}={}) {
  dimensions(width,height,fps); range(durationMs,1,360000,'durationMs'); range(timeoutMs,1,600000,'timeoutMs');
  if(typeof renderFrame!=='function') throw new TypeError('renderFrame');
  if(onProgress!==undefined&&typeof onProgress!=='function') throw new TypeError('onProgress');
  const bg=backgroundValue(background); const count=Math.ceil(durationMs*fps/1000);
  range(count,1,CUBE_VIDEO_LIMITS.maxFrames,'frames',true);
  const guard=guardOperation(signal,timeoutMs); let canvas,encoder,stream,recorder;
  try {
    guard.check();
    const support=await guard.wait(cubeVideoSupport({width,height,fps,requireFrameAccuracy}));
    if(!support.supported) throw failure(support.reason,'NotSupportedError');
    canvas=globalThis.document?.createElement('canvas')??(typeof globalThis.OffscreenCanvas==='function'?new globalThis.OffscreenCanvas(width,height):null);
    if(!canvas) throw failure('Canvas is unavailable','NotSupportedError');
    canvas.width=width; canvas.height=height;
    const context=canvas.getContext('2d',{alpha:false}); if(!context) throw failure('2D canvas is unavailable');
    const draw=async(index,timestampMs)=>{
      guard.check(); paintBackground(context,width,height,bg); context.save();
      try { await guard.wait(renderFrame({context,canvas,index,timestampMs,durationMs,signal})); }
      finally { context.restore(); }
      if(canvas.width!==width||canvas.height!==height) throw failure('renderFrame resized the export canvas');
      guard.check();
    };
    const progress=(completed,done=false)=>onProgress?.({method:support.method,completed,total:count,ratio:done?1:Math.min(.999,completed/count)});
    let result;
    if(support.method==='webcodecs') {
      // Integer frame count at the requested FPS. Render phase still spans exactly
      // one caller-specified cycle, without duplicating the endpoint frame.
      const samples=[]; const totalUs=Math.round(count*1000000/fps); let description=null,lengthSize=0,totalBytes=0;
      encoder=new globalThis.VideoEncoder({
        output(chunk,metadata) {
          try {
            guard.check();
            if(metadata?.decoderConfig?.description) {
              const next=avcDescription(metadata.decoderConfig.description);
              if(description&&(description.length!==next.bytes.length||description.some((b,i)=>b!==next.bytes[i]))) throw failure('AVC configuration changed during export');
              description=next.bytes; lengthSize=next.lengthSize;
            }
            if(!description) throw failure('Encoder omitted AVC decoder configuration');
            const i=samples.length;
            if(i>=count||chunk.timestamp!==Math.round(i*totalUs/count)) throw failure('Encoder dropped or reordered an AVC frame');
            range(chunk.byteLength,1,8*1024*1024,'encoded sample bytes',true);
            totalBytes+=chunk.byteLength; range(totalBytes,1,CUBE_VIDEO_LIMITS.maxBytes,'encoded bytes');
            const data=new Uint8Array(chunk.byteLength); chunk.copyTo(data);
            const key=chunk.type==='key'; if(i===0&&!key) throw failure('First AVC frame is not key');
            validAccessUnit(data,lengthSize,key);
            samples.push({data:new Blob([data]),size:data.length,duration:Math.round((i+1)*totalUs/count)-chunk.timestamp,key});
          } catch(e) { guard.fail(e); }
        },
        error(e) { guard.fail(e); },
      });
      encoder.configure(encoderConfig(width,height,fps));
      for(let i=0;i<count;i++) {
        const timestamp=Math.round(i*totalUs/count),duration=Math.round((i+1)*totalUs/count)-timestamp;
        await draw(i,i*durationMs/count);
        const frame=new globalThis.VideoFrame(canvas,{timestamp,duration,alpha:'discard'});
        try { encoder.encode(frame,{keyFrame:i%(fps*2)===0}); } finally { frame.close(); }
        // flush는 JS 대기열뿐 아니라 codec 내부 대기 프레임도 2개씩 배출한다.
        if((i+1)%2===0||i===count-1) {
          await guard.wait(encoder.flush());
          if(samples.length!==i+1) throw failure('Encoder omitted AVC frames');
          progress(i+1); await guard.wait(delay(0));
        }
      }
      guard.check();
      result=finishMp4({width,height,samples,description,totalBytes});
    } else {
      if(typeof canvas.captureStream!=='function') throw failure('Canvas capture is unavailable','NotSupportedError');
      // MediaRecorder는 실시간 경로다. 프레임을 빨리 제출해 가짜 길이의 영상을 만들지 않는다.
      await draw(0,0); stream=canvas.captureStream(fps);
      if(stream.getAudioTracks().length||stream.getVideoTracks().length!==1) throw failure('Silent canvas video track required');
      recorder=new globalThis.MediaRecorder(stream,{mimeType:support.mimeType,videoBitsPerSecond:2000000});
      if(!/^video\/mp4(?:;|$)/i.test(recorder.mimeType)) throw failure('Recorder did not select MP4');
      const chunks=[]; let bytes=0;
      const started=new Promise(resolve=>{ recorder.onstart=resolve; });
      const ended=new Promise(resolve=>{ recorder.onstop=resolve; });
      recorder.onerror=e=>guard.fail(e.error??failure('MP4 recorder failed'));
      recorder.ondataavailable=e=>{
        if(!e.data?.size) return;
        bytes+=e.data.size;
        if(bytes>CUBE_VIDEO_LIMITS.maxBytes) {guard.fail(failure('MP4 recording exceeded byte budget'));return;}
        chunks.push(e.data);
      };
      recorder.start(1000); await guard.wait(started);
      if(!/^video\/mp4(?:;|$)/i.test(recorder.mimeType)||(/codecs=/i.test(recorder.mimeType)&&!/avc1/i.test(recorder.mimeType))) throw failure('Recorder did not start AVC/MP4');
      const start=performance.now();
      for(let i=1;i<count;i++) {
        const target=i*durationMs/count;
        await guard.wait(delay(Math.max(0,start+target-performance.now())));
        // 지연된 그리기를 따라잡으려고 많은 프레임을 한꺼번에 만들지 않는다.
        const elapsed=performance.now()-start;
        if(elapsed>target+2000) throw failure('Recording is too slow; keep this tab visible');
        await draw(i,target); progress(i);
      }
      await guard.wait(delay(Math.max(0,start+durationMs-performance.now())));
      recorder.stop(); await guard.wait(ended); guard.check();
      result=new Blob(chunks,{type:'video/mp4'});
      const head=new Uint8Array(await guard.wait(result.slice(0,12).arrayBuffer()));
      if(head.length<12||String.fromCharCode(...head.slice(4,8))!=='ftyp') throw failure('Recorder output is not an MP4 file');
    }
    guard.check(); progress(count,true); return result;
  } finally {
    if(encoder&&encoder.state!=='closed') { try {encoder.close();} catch { /* 자원 정리 */ } }
    if(recorder) {
      recorder.ondataavailable=null; recorder.onerror=null; recorder.onstart=null; recorder.onstop=null;
      if(recorder.state!=='inactive') {try {recorder.stop();} catch { /* 자원 정리 */ }}
    }
    for(const track of stream?.getTracks()??[]) track.stop();
    if(canvas) {canvas.width=1;canvas.height=1;}
    guard.dispose();
  }
}
