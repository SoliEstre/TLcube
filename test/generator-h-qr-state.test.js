import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGeneratorState,versionStateKey} from '../src/generator-state.js';
import {selectQrPosition,selectGeneratorType,commitFinderQrTransition} from '../src/finder-selection.js';
import {isHGenerator,hPreviewOptions,hUiLabel,clampHRotationSpeed,selectHRepresentation} from '../src/generator-h.js';
import {encodeH,decodeH} from '../src/h-codec.js';
import {buildHScene} from '../src/h-render.js';
import {withHCornerQr,hQrPosition} from '../src/generator-h-qr.js';
import {TL_READER_URL,tlReaderUrlWithHint,qrMatrix} from '../src/qr.js';
import {renderWithErrorDisplay} from '../src/render-status.js';
import {payloadByteLength} from '../src/header.js';
import {minRoundtripPpu,resolveExportPpi,resolveExportSize} from '../src/export-options.js';
import {cubeVideoDurationMs} from '../src/cube-video-export.js';
import {generatorCubeModel} from '../src/generator-cube-export.js';
import {hPlanarPreviewOptions} from '../src/h-preview-decor.js';
const sourceUrl=new URL('../index.html',import.meta.url),source=readFileSync(sourceUrl,'utf8');
const sha=text=>createHash('sha256').update(text).digest('hex');
const imageEntries=["els.exportPng.addEventListener('click', async () => {","els.exportSvg.addEventListener('click', () => {","$('copyPng').addEventListener('click', async () => {","$('copySvg').addEventListener('click', async () => {"];
function fn(text,name){const start=text.indexOf('function '+name+'('),end=text.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start,name);return text.slice(start,end);}
const qrCount=scene=>scene.shapes.filter(shape=>shape.qr).length;
function harness(text,overrides={}){
  const nodes=new Map(),events=new Map(),draws=[],pending=[],downloads=[],copies=[];
  const node=id=>{if(!nodes.has(id)){const set=new Set();nodes.set(id,{id,value:'',hidden:false,disabled:false,style:{},children:[],dataset:{},clientWidth:720,
    classList:{toggle(k,on){if(on)set.add(k);else set.delete(k);},contains:k=>set.has(k),add:k=>set.add(k),remove:k=>set.delete(k)},
    setAttribute(){},addEventListener(kind,cb){events.set(id+':'+kind,cb);}});}return nodes.get(id);};
  for(const pos of ['inner','TL','TR','BL','BR','none']){const card=node('qr-'+pos);card.dataset.pos=pos;node('qrPositionCards').children.push(card);}
  for(const key of ['checker','green','blue','magenta']){const card=node('video-'+key);card.dataset.videoBackground=key;node('cubeVideoBackgroundCards').children.push(card);}
  node('exportCubeVideo').dataset.videoSize='720';
  const state=createGeneratorState({type:'Y',yRepresentation:'3d',hFaces:6,versionH:7,eccLevel:'M',tone:3,hMask:0,qrPosition:'TL',orbitView:'3d',hAutoRotate:true,hRotationSpeed:90,...overrides});
  const palette={levels:[{r:104,g:104,b:104},{r:173,g:173,b:173},{r:226,g:226,b:226}],background:{r:255,g:255,b:255}};
  const c={console,Math,Number,String,Error,RangeError,TypeError,TextEncoder,AbortController,structuredClone,Blob,Uint8Array,
    generatorState:state,current:null,mode:'advanced',timer:0,palette,draws,pending,downloads,lastEncodedYn:0,lastEncodedKA:0,lastEncodedKO:0,
    hAnimation:{elapsed:500,scene:null},hFaceImages:Object.freeze({}),hGpuRenderer:null,
    createHPreviewRenderer:()=>({draw:()=>false}),backdropShowing:()=>false,
    Y3D_PAD_BASE:24,y3dPreview:{on:true,pad:24},window:{devicePixelRatio:1},document:{createElement:()=>({width:0,height:0}),querySelectorAll:selector=>selector==='[data-video-size]'?[node('exportCubeVideo')]:[]},
    hImageEditor:{flush(){}},
    resolvedRenderProfile:()=> 'screen',hPlanarPreviewOptions,paintHPositionLabels:()=>{},
    els:new Proxy({qrPositionCards:node('qrPositionCards'),qrFacePlacementCards:node('qrFacePlacementCards'),qrPosInner:node('qr-inner')},{get:(o,k)=>o[k]??node(String(k))}),$:node,
    isHGenerator,hQrPosition,withHCornerQr,buildHScene,encodeH,decodeH,hPreviewOptions,hText:key=>hUiLabel(key,'ko'),clampHRotationSpeed,cubeVideoDurationMs,
    selectQrPosition,selectGeneratorType,commitFinderQrTransition,GENERATOR_DEFAULT_FINDER_PATTERN_ID:state.finderPatternId,
    TL_READER_URL,tlReaderUrlWithHint,payloadByteLength,versionStateKey,renderWithErrorDisplay,
    minRoundtripPpu,resolveExportPpi,resolveExportSize,EXPORT_MARGIN_TRIM:'trim',
    LOCATOR_PROFILE_CELL_SURFACE_V0:'cell-surface-v0',Y_T_SERIES_PROFILES:[],detectorAutoY:false,
    hGeneratorActive:()=>isHGenerator(state),currentType:()=>state.type,typeCGeneratorActive:()=>false,
    normalPayloadText:()=>c.payload??'H QR current handoff',effectiveVersionYForEncode:()=>0,cornerMarkerSeatActive:()=>false,currentFaceGains:()=>({T:1,L:1,R:1}),paletteOf:()=>palette,
    t:key=>key,tf:key=>key,isLabPath:()=>true,decorActive:()=>false,yWindowActive:()=>false,ySlotLocatorActive:()=>false,
    exportDitherBits:()=>undefined,exportFilename:ext=>'qr-current.'+ext,download:(blob,mime,name)=>downloads.push({blob,mime,name}),
    renderExportSvg:scene=>{c.lastImageScene=scene;return '<svg/>';},renderExportPng:scene=>{c.lastImageScene=scene;return new Uint8Array([1]);},emitProductExport:()=>{},
    navigator:{clipboard:{write:async data=>copies.push(data),writeText:async data=>copies.push(data)}},ClipboardItem:class{constructor(data){this.data=data;}},flashCopied:()=>{},
    drawScene:(scene,canvas)=>{draws.push({scene,canvas});canvas.width=720;canvas.height=720;},
    setTimeout:cb=>{pending.push(cb);return pending.length;},clearTimeout:()=>{},
    paintY3dPreview:()=>{if(c.y3dPreview.on&&c.current?.type==='H')vm.runInContext('drawHPreviewFrame()',c);},
    exportCubeMp4:async args=>{args.renderFrame({canvas:{width:720,height:720},context:{drawImage(){}},timestampMs:0});return new Blob(['mock-codec']);},
  };
  for(const name of ['syncShotPresetUi','syncFaceGainLabel','syncExportPpiHint','syncQuietGaugeReadout','syncTypeYCellEditorUi','emitProductGenerate','emitGeneratorFail','emitLabGen','applyPreviewFit','syncBackdropLayer','updateGauge','updateOverflowHighlight','syncTypeUi','renderFinderUi','syncResTierUi','syncYLocatorUi','applyAutoLocatorProfileY','syncSeatUi','deriveYLocatorForQrPosition','stopHAnimation'])c[name]=()=>{};
  vm.createContext(c);
  for(const name of ['resolveFallback','buildConfig','encodeWithEcc','encodeOptsFor','renderTypeH','isCapacityError','eccTierLabel','render','hSceneOptions','drawHPreviewFrame','exportPlanFor','renderQrPositionUi','commitFinderQrUi','cancelScheduledRender','runScheduledRender','flushScheduledRender','schedule'])vm.runInContext(fn(text,name),c);
  const cardsStart=text.indexOf('for (const card of els.qrPositionCards.children) {',text.indexOf('// ── 일반 모드: QR 링크'));
  assert.ok(cardsStart>0);vm.runInContext(text.slice(cardsStart,text.indexOf('\n}',cardsStart)+2),c);
  const urlStart=text.indexOf("els.qrUrl.addEventListener('input',");vm.runInContext(text.slice(urlStart,text.indexOf('\n});',urlStart)+4),c);
  const videoStart=text.indexOf('let cubeVideoJob=null;');vm.runInContext(text.slice(videoStart,text.indexOf('const CUBE_EXPORT_IDS=',videoStart)),c);
  for(const entry of imageEntries){const start=text.indexOf(entry);assert.ok(start>=0);vm.runInContext(text.slice(start,text.indexOf('\n});',start)+4),c);}
  return {c,node,draws,downloads,copies,image:id=>events.get(id+':click')(),run:code=>vm.runInContext(code,c,{timeout:20000}),click:pos=>events.get('qr-'+pos+':click')(),video:()=>events.get('exportCubeVideo:click')(),url:value=>{node('qrUrl').value=value;events.get('qrUrl:input')();}};
}

test('H 실제 render에서 current를 거친 3D·현재시점 SVG·MP4도 코너 QR을 유지해요',async()=>{
  for(const faces of [3,6]){
    const h=harness(source,{hFaces:faces});h.run('render()');assert.equal(h.node('error').textContent,'');
    const expected=qrCount(h.c.current.scene);assert.ok(expected>200);
    assert.equal(h.c.current.hQr?.text,tlReaderUrlWithHint('Y'));
    assert.equal(qrCount(h.c.hAnimation.scene),expected);
    assert.equal(qrCount(h.run("exportPlanFor('svg')").scene),expected);
    if(faces===6){const start=h.draws.length;await h.video();assert.equal(qrCount(h.draws[start].scene),expected);}
  }
});

test('실제 H QR 위치 카드의 없음→네 코너→없음은 3/6면 current와 미리보기를 함께 바꿔요',()=>{
  for(const faces of [3,6])for(const corner of ['TL','TR','BL','BR']){
    const h=harness(source,{hFaces:faces,qrPosition:'none'});h.run('render()');assert.equal(qrCount(h.c.current.scene),0);
    h.click(corner);assert.equal(h.c.generatorState.qrPosition,corner);assert.equal(h.c.current.hQr?.corner,corner);
    assert.equal(h.c.hAnimation.scene.hCornerQr?.corner,corner);
    h.c.y3dPreview.on=false;assert.equal(h.run("exportPlanFor('svg')").scene.hCornerQr?.corner,corner);
    h.c.y3dPreview.on=true;h.click('none');assert.equal(qrCount(h.c.hAnimation.scene),0);
  }
});

test('실제 고급 QR URL input 직후 MP4는 예약 render를 비우고 새 QR을 사용해요',async()=>{
  const h=harness(source);h.run('render()');h.url('HTTPS://EXAMPLE.COM');
  assert.notEqual(h.c.current.hQr?.text,'HTTPS://EXAMPLE.COM');
  await h.video();assert.equal(h.c.current.hQr?.text,'HTTPS://EXAMPLE.COM');
  assert.equal(h.draws.at(-1).scene.hCornerQr?.text,'HTTPS://EXAMPLE.COM');
  h.url('https://example.com');h.run('flushScheduledRender()');assert.equal(h.c.current,null);assert.ok(h.node('error').textContent);
});

test('H 비지원 inner QR은 UI none으로 보이며 기존 Y/O 선택은 유지돼요',()=>{
  const h=harness(source,{qrPosition:'inner'}),snapshot=JSON.stringify(h.c.generatorState);
  h.run('renderQrPositionUi();render()');assert.equal(h.node('qr-none').classList.contains('active'),true);
  assert.equal(qrCount(h.c.current.scene),0);h.click('inner');assert.equal(JSON.stringify(h.c.generatorState),snapshot);
  assert.equal(selectHRepresentation(h.c.generatorState,'2.5d').qrPosition,'inner');
  const o=harness(source,{type:'O'}),initial=selectQrPosition(o.c.generatorState,'inner','O',o.c.GENERATOR_DEFAULT_FINDER_PATTERN_ID);
  const toH=selectGeneratorType(initial,'Y',o.c.GENERATOR_DEFAULT_FINDER_PATTERN_ID);assert.equal(toH.qrPosition,'TL');
  assert.equal(selectGeneratorType(toH,'O',o.c.GENERATOR_DEFAULT_FINDER_PATTERN_ID).qrPosition,'inner');
});

test('H 화면 바깥 QR 선택은 실제 큐브 model의 면·도형을 변경하지 않아요',()=>{
  const h=harness(source);h.run('render()');const a=generatorCubeModel(h.c.current,h.c.palette);
  h.click('none');const b=generatorCubeModel(h.c.current,h.c.palette);assert.equal(JSON.stringify(a),JSON.stringify(b));
});

test('PNG/SVG 다운로드·복사는 예약 QR 변경을 즉시 반영하고 실패 후 복구해요',async()=>{
  for(const id of ['exportPng','exportSvg','copyPng','copySvg']){
    const h=harness(source);h.run('render()');h.url('HTTPS://EXAMPLE.COM');await h.image(id);
    assert.equal(h.c.lastImageScene?.hCornerQr?.text,'HTTPS://EXAMPLE.COM',id);
    assert.equal(h.c.timer,0,id);
    const draws=h.draws.length;await h.image(id);assert.equal(h.draws.length,draws,'대기 작업이 없으면 추가 render 없음: '+id);
    const outputs=h.downloads.length+h.copies.length;h.url('https://example.com');await h.image(id);
    assert.equal(h.c.current,null,id);assert.equal(h.downloads.length+h.copies.length,outputs,id);
    h.url('HTTPS://EXAMPLE.ORG');await h.image(id);
    assert.equal(h.c.current.hQr.text,'HTTPS://EXAMPLE.ORG',id);
    assert.equal(h.downloads.length+h.copies.length,outputs+1,id);
  }
});
