import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {hPreviewOptions,hUiLabel,clampHRotationSpeed} from '../src/generator-h.js';
import {hControlIcon} from '../src/h-preview-controls.js';
import {cubeVideoDurationMs,CUBE_VIDEO_KEY_COLORS} from '../src/cube-video-export.js';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('let cubeVideoJob=null;'),end=source.indexOf('const CUBE_EXPORT_IDS=',start);
assert.ok(start>=0&&end>start);const handlers=source.slice(start,end);
console.log(JSON.stringify({source:'index.html',sha256:createHash('sha256').update(source).digest('hex'),actualHandler:true}));
function harness({exportError=null}={}) {
  const nodes=new Map(),events=new Map(),pending=[],downloads=[],draws=[],canvases=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,textContent:'',dataset:{},children:[],classList:{toggle(){}},setAttribute(){},addEventListener(kind,handler){events.set(id,handler);}});return nodes.get(id);};
  for(const color of ['checker','green','blue','magenta']) {const card=node(color);card.dataset.videoBackground=color;node('cubeVideoBackgroundCards').children.push(card);}
  for(const fps of [24,30,60,120]){const card=node(`fps${fps}`);card.dataset.videoFps=String(fps);node('cubeVideoFpsCards').children.push(card);}
  const videoButtons=[720,1080,1440].map(size=>{const card=node(size===720?'exportCubeVideo':`exportCubeVideo${size}`);card.dataset.videoSize=String(size);return card;});
  const state={type:'Y',yRepresentation:'3d',hFaces:6,hAutoRotate:true,hRotationMode:'y',hRotationSpeed:90,orbitView:'3d',orbitYaw:5,orbitPitch:8,orbitRoll:3,orbitPersp:15,bgMode:'transparent',preset:'slate'};
  const palette={background:null,levels:[{r:12,g:34,b:56}],faceGains:[1,.8,.6]};
  const c={AbortController,structuredClone,console,Math,Number,String,hFaceImages:Object.freeze({ZP:{pixels:{id:'old'}}}),
    generatorState:state,palette,current:{type:'H',encoded:{id:'old'},hQr:{text:'https://old.example/',corner:'TL'}},hAnimation:{elapsed:1600},
    Y3D_PAD_BASE:24,y3dPreview:{pad:24,get on(){return state.orbitView==='3d';}},hGeneratorActive:()=>state.type==='Y'&&state.yRepresentation==='3d',
    hText:key=>hUiLabel(key,c.lang),lang:'ko',genI18n:{lang:'ko'},hControlIcon,videoToggle:node('cubeVideoToggle'),clampHRotationSpeed,hPreviewOptions,cubeVideoDurationMs,
    $:node,resolvedRenderProfile:()=> 'screen',window:{devicePixelRatio:2},document:{querySelectorAll:selector=>selector==='[data-video-size]'?videoButtons:[],createElement(){const canvas={width:0,height:0};canvases.push(canvas);return canvas;}},
    hImageEditor:{flush(){c.imageFlushCount++;}},imageFlushCount:0,
    flushScheduledRender(){c.flushCount++;if(c.flushCallback)c.flushCallback();},flushCount:0,
    paletteOf:()=>palette,exportFilename:ext=>c.current.encoded.id+'.'+ext,
    stopHAnimation(){c.stops++;},stops:0,syncs:0,paintY3dPreview(){c.syncs++;},
    buildHScene:(encoded,options)=>({width:100,height:100,encoded,options}),withHCornerQr:(scene,qr)=>({...scene,qr}),
    drawScene:(scene,canvas,ppu)=>{canvas.width=720;canvas.height=720;draws.push({scene,ppu});},
    exportCubeMp4(args){if(exportError)throw exportError;return new Promise((resolve,reject)=>pending.push({args,resolve,reject}));},
    download:(blob,mime,name)=>downloads.push({blob,mime,name}),
  };
  vm.createContext(c);vm.runInContext(handlers,c,{timeout:1000});
  return {c,node,pending,downloads,draws,canvases,click:id=>events.get(id)(),run:s=>vm.runInContext(s,c,{timeout:1000}),frame:i=>pending[0].args.renderFrame({context:{drawImage(){}},canvas:{width:720,height:720},timestampMs:i})};
}
test('영상 UI 정적 계약은 기본 60fps와 chroma blue #0099ff를 실제 index에 둬요',()=>{
  assert.match(source,/data-video-fps="24"[\s\S]*data-video-fps="30"[\s\S]*data-video-fps="60" aria-pressed="true"[\s\S]*data-video-fps="120"/);
  assert.match(source,/data-video-background="blue"[^>]*>[\s\S]*?style="background:#0099ff"/);
  assert.equal(CUBE_VIDEO_KEY_COLORS.blue,'#0099ff');
});
test('현재 UI는 자동회전 H3/6면·3D일 때 영상 섹션 노출',()=>{
  for(const change of [{type:'O'},{yRepresentation:'2.5d'},{hAutoRotate:false},{orbitView:'2.5d'}]) {
    const h=harness();Object.assign(h.c.generatorState,change);h.run('syncCubeVideoUi()');assert.equal(h.node('cubeVideoSection').hidden,true);
  }
  const h=harness();h.run('syncCubeVideoUi()');assert.equal(h.node('cubeVideoSection').hidden,false);assert.equal(h.node('cubeVideoTransparency').hidden,false);
  h.c.generatorState.hFaces=3;h.run('syncCubeVideoUi()');assert.equal(h.node('cubeVideoSection').hidden,false);
});
test('생성 대기 flush 뒤 새 current와 filename 사용',async()=>{
  const h=harness();h.c.flushCallback=()=>{h.c.current={type:'H',encoded:{id:'new'},hQr:{text:'https://new.example/',corner:'BR'}};};
  const job=h.click('exportCubeVideo');assert.equal(h.c.flushCount,1);assert.equal(h.c.imageFlushCount,1);h.frame(0);assert.equal(h.draws[0].scene.encoded.id,'new');assert.equal(h.draws[0].scene.qr.corner,'BR');
  h.pending[0].resolve(new Blob());await job;assert.equal(h.downloads[0].name,'new_720p_60fps.mp4');
});
test('생성 실패로 current=null이면 stale 영상 다운로드 없음',async()=>{
  const h=harness();h.c.flushCallback=()=>{h.c.current=null;};await h.click('exportCubeVideo');assert.equal(h.pending.length,0);assert.equal(h.downloads.length,0);assert.equal(h.run('cubeVideoJob'),null);
});
test('숨김 조건/비H current는 직접 click해도 내보내지 않는다',async()=>{
  for(const change of [{type:'O'},{yRepresentation:'2.5d'},{hAutoRotate:false},{orbitView:'2.5d'}]) {const h=harness();Object.assign(h.c.generatorState,change);await h.click('exportCubeVideo');assert.equal(h.pending.length,0);}
  const h=harness();h.c.current.type='Y';await h.click('exportCubeVideo');assert.equal(h.pending.length,0);
});
test('중복 click·다른 배경 card·UI sync에서도 busy가 유지',async()=>{
  const h=harness(),job=h.click('exportCubeVideo');assert.equal(h.node('exportCubeVideo').disabled,true);assert.equal(h.node('cancelCubeVideo').hidden,false);
  await h.click('exportCubeVideo');h.click('magenta');h.run('syncCubeVideoUi()');assert.equal(h.pending.length,1);assert.equal(h.run('cubeVideoBackground'),'green');assert.ok(h.node('cubeVideoBackgroundCards').children.every(n=>n.disabled));
  h.pending[0].resolve(new Blob());await job;assert.equal(h.node('exportCubeVideo').disabled,false);assert.equal(h.node('cancelCubeVideo').hidden,true);assert.ok(h.node('cubeVideoBackgroundCards').children.every(n=>!n.disabled));
});
test('옵션/타입/QR/본문/색 변경 후에도 시작 시점 snapshot으로 그린다',async()=>{
  const h=harness();const job=h.click('exportCubeVideo');h.frame(0);const before=structuredClone(h.draws[0].scene);
  Object.assign(h.c.generatorState,{type:'O',hRotationMode:'x',hRotationSpeed:1,orbitYaw:100,orbitPitch:40,preset:'custom',bgMode:'black'});
  h.c.current.hQr.text='https://changed.example/';h.c.current.hQr.corner='BR';h.c.current={type:'O',encoded:{id:'changed'}};h.c.palette.levels[0].r=255;h.c.hAnimation.elapsed=999999;h.c.y3dPreview.pad=12;
  h.frame(0);assert.deepEqual(structuredClone(h.draws[1].scene),before);assert.equal(before.options.zoom,1);assert.equal(before.options.perspective,.15);assert.equal(h.pending[0].args.durationMs,4000);assert.equal(h.pending[0].args.background,'green');assert.equal(h.pending[0].args.requireFrameAccuracy,true);
  h.run('syncCubeVideoUi()');assert.equal(h.node('cubeVideoSection').hidden,false);assert.equal(h.node('cancelCubeVideo').hidden,false);
  h.pending[0].resolve(new Blob());await job;assert.equal(h.downloads[0].name,'old_720p_60fps.mp4');assert.equal(h.node('cubeVideoSection').hidden,true);assert.equal(h.canvases[0].width,1);
});
test('취소·완료 경합에서도 signal aborted이면 다운로드하지 않는다',async()=>{
  const h=harness(),job=h.click('exportCubeVideo');h.click('cancelCubeVideo');assert.equal(h.pending[0].args.signal.aborted,true);
  h.pending[0].resolve(new Blob());await job;assert.equal(h.downloads.length,0);assert.equal(h.run('cubeVideoJob'),null);assert.equal(h.canvases[0].height,1);
});
test('AbortError와 일반 codec 실패를 구분하고 버튼/캔버스 복구',async()=>{
  for(const name of ['AbortError','Error']) {const h=harness(),job=h.click('exportCubeVideo');const e=new Error('codec broken');e.name=name;h.pending[0].reject(e);await job;
    assert.equal(h.downloads.length,0);assert.equal(h.node('exportCubeVideo').disabled,false);assert.equal(h.canvases[0].width,1);assert.equal(h.node('cubeVideoStatus').textContent,name==='AbortError'?hUiLabel('videoCancelled','ko'):'codec broken');}
});
test('동기 export 실패도 busy 복구',async()=>{const h=harness({exportError:Error('sync failed')});await h.click('exportCubeVideo');assert.equal(h.run('cubeVideoJob'),null);assert.equal(h.node('exportCubeVideo').disabled,false);assert.equal(h.canvases[0].width,1);});
test('투명 4가지 합성선택과 불투명 RGB는 서로 분리',async()=>{
  for(const color of ['checker','green','blue','magenta']) {const h=harness();h.click(color);const job=h.click('exportCubeVideo');assert.equal(h.pending[0].args.background,color);h.pending[0].resolve(new Blob());await job;}
  const h=harness();h.c.generatorState.bgMode='black';h.c.palette.background={r:0,g:0,b:0};h.click('magenta');h.run('syncCubeVideoUi()');assert.equal(h.node('cubeVideoTransparency').hidden,true);
  const job=h.click('exportCubeVideo');assert.equal(JSON.stringify(h.pending[0].args.background),'\u007b"r":0,"g":0,"b":0}');h.c.palette.background.r=200;assert.equal(h.pending[0].args.background.r,0);h.pending[0].resolve(new Blob());await job;
});
test('프레임은 전용 canvas에 투명 물체를 그리고 합성 canvas는 건드리지 않는다',async()=>{
  const h=harness(),job=h.click('exportCubeVideo');h.frame(100);const frame=h.draws[0];assert.equal(frame.scene.background,null);assert.equal(frame.ppu,3.6);assert.ok(frame.scene.options.outline);h.pending[0].resolve(new Blob());await job;
});
test('KO/EN 및 다른언어 fallback 텍스트, gyro 닫힌 주기 설명',async()=>{
  for(const lang of ['ko','en','ja','fr']) {const h=harness();h.c.lang=lang;h.c.generatorState.hRotationMode='gyro';h.run('syncCubeVideoUi()');assert.ok(h.node('cubeVideoDuration').textContent.includes(hUiLabel('videoGyro',lang)));
    const job=h.click('exportCubeVideo');h.pending[0].args.onProgress({ratio:.5});assert.ok(h.node('cubeVideoStatus').textContent.includes('50'));h.pending[0].resolve(new Blob());await job;assert.equal(h.node('cubeVideoStatus').textContent,hUiLabel('videoDone',lang));}
});

test('24/30/60/120 FPS card는 선택을 보존하고 busy 동안 FPS·배경 모두 바꾸지 못해요',async()=>{
  const h=harness();for(const fps of [24,30,60,120]) {h.click(`fps${fps}`);assert.equal(h.run('cubeVideoFps'),fps);assert.ok(h.node(`fps${fps}`).disabled===false);}
  h.click('fps24');const job=h.click('exportCubeVideo');assert.ok(h.node('cubeVideoFpsCards').children.every(n=>n.disabled));assert.ok(h.node('cubeVideoBackgroundCards').children.every(n=>n.disabled));
  h.click('fps120');h.click('magenta');assert.equal(h.run('cubeVideoFps'),24);assert.equal(h.run('cubeVideoBackground'),'green');
  h.pending[0].resolve(new Blob());await job;assert.ok(h.node('cubeVideoFpsCards').children.every(n=>!n.disabled));assert.ok(h.node('cubeVideoBackgroundCards').children.every(n=>!n.disabled));
});
test('영상 작업은 시작 시점 FPS와 face image 객체를 고정해 GPU 미리보기 이후에도 CPU export가 정확해요',async()=>{
  const h=harness(),images=h.c.hFaceImages;h.click('fps120');const job=h.click('exportCubeVideo');assert.equal(h.pending[0].args.fps,120);h.c.hFaceImages=Object.freeze({ZP:{href:'data:image/png;base64,new',width:2,height:2,pixels:{id:'new'}}});h.frame(0);
  assert.equal(h.draws[0].scene.options.faceImages,images);assert.equal(h.draws[0].scene.options.faceImages.ZP.pixels.id,'old');h.pending[0].resolve(new Blob());await job;
});



test('720/1080/1440 해상도 card는 snapshot에 고정되고 busy 중에는 바뀌지 않아요',async()=>{
  const ids=['exportCubeVideo','exportCubeVideo1080','exportCubeVideo1440'];
  for(const [i,size]of [720,1080,1440].entries()){
    const h=harness(),job=h.click(ids[i]);
    assert.equal(h.pending[0].args.width,size);assert.equal(h.pending[0].args.height,size);assert.equal(h.pending[0].args.requireFrameAccuracy,true);
    assert.ok(ids.every(id=>h.node(id).disabled));await h.click(ids[(i+1)%3]);assert.equal(h.pending.length,1);
    h.pending[0].resolve(new Blob());await job;
    assert.ok(ids.every(id=>!h.node(id).disabled));assert.equal(h.downloads[0].name,`old_${size}p_60fps.mp4`);
  }
});
