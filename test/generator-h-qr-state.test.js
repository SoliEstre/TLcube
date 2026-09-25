import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGeneratorState,versionStateKey} from '../src/generator-state.js';
import {selectQrPosition,selectGeneratorType,commitFinderQrTransition} from '../src/finder-selection.js';
import {isHGenerator,hPreviewOptions,hUiLabel,hMaskLuminance,clampHRotationSpeed,clampHRotationTiltMode,selectHRepresentation,selectHFaceCount,selectHRenderFaces,reconcileHContentRotation} from '../src/generator-h.js';
import {encodeH,decodeH} from '../src/h-codec.js';
import {buildHScene} from '../src/h-render.js';
import {withHCornerQr,hQrPosition,hFaceQrSummary,hEffectiveQrPosition,hCornerTooCorner} from '../src/generator-h-qr.js';
import {createHImageEditor} from '../src/h-image-editor-ui.js';
import {hFaceQrMinBlockScale} from '../src/h-face-qr.js';
import {hDisplayMap} from '../src/h-face-arrangement.js';
import {rasterToPng} from '../src/png.js';
import {TL_READER_URL,tlReaderUrlWithHint,qrMatrix} from '../src/qr.js';
import {renderWithErrorDisplay} from '../src/render-status.js';
import {payloadByteLength} from '../src/header.js';
import {minRoundtripPpu,resolveExportPpi,resolveExportSize} from '../src/export-options.js';
import {cubeVideoDurationMs} from '../src/cube-video-export.js';
import {hControlIcon,hBrightestPaletteHex} from '../src/h-preview-controls.js';
import {generatorCubeModel} from '../src/generator-cube-export.js';
import {hPlanarPreviewOptions,reconcileHPositionMode} from '../src/h-preview-decor.js';
const sourceUrl=new URL('../index.html',import.meta.url),source=readFileSync(sourceUrl,'utf8');
const sha=text=>createHash('sha256').update(text).digest('hex');
const imageEntries=["els.exportPng.addEventListener('click', async () => {","els.exportSvg.addEventListener('click', () => {","$('copyPng').addEventListener('click', async () => {","$('copySvg').addEventListener('click', async () => {"];
function fn(text,name){const start=text.indexOf('function '+name+'('),end=text.indexOf('\n}',start)+2;assert.ok(start>=0&&end>start,name);return text.slice(start,end);}
const qrCount=scene=>scene.shapes.filter(shape=>shape.qr).length;
// realEditor: index.html 의 실제 `const hImageEditor=createHImageEditor({…})` 문장과 syncHFaceImagesUi 를 꽂아요.
// 스텁만 넓히면 초록이어도 실제 클릭 경로(fillQr·clearQr·syncQrText·onChange)를 안 재요(2026-09-26 H 안쪽 QR).
function harness(text,overrides={},{realEditor=false}={}){
  const nodes=new Map(),events=new Map(),draws=[],pending=[],downloads=[],copies=[];
  const node=id=>{if(!nodes.has(id)){const set=new Set(),attrs={};nodes.set(id,{id,value:'',hidden:false,disabled:false,style:{},children:[],dataset:{},clientWidth:720,attrs,
    classList:{toggle(k,on){if(on)set.add(k);else set.delete(k);},contains:k=>set.has(k),add:k=>set.add(k),remove:k=>set.delete(k)},
    append(...items){this.children.push(...items);},
    setAttribute(k,v){attrs[k]=String(v);},addEventListener(kind,cb){events.set(id+':'+kind,cb);}});}return nodes.get(id);};
  for(const pos of ['inner','TL','TR','BL','BR','none']){const card=node('qr-'+pos);card.dataset.pos=pos;node('qrPositionCards').children.push(card);}
  for(const key of ['checker','green','blue','magenta']){const card=node('video-'+key);card.dataset.videoBackground=key;node('cubeVideoBackgroundCards').children.push(card);}
  node('exportCubeVideo').dataset.videoSize='720';
  const state=createGeneratorState({type:'Y',yRepresentation:'3d',hFaces:6,versionH:7,eccLevel:'M',tone:3,hMask:0,qrPosition:'TL',orbitView:'3d',hAutoRotate:true,hRotationSpeed:90,...overrides});
  const palette={levels:[{r:104,g:104,b:104},{r:173,g:173,b:173},{r:226,g:226,b:226}],background:{r:255,g:255,b:255}};
  const c={console,Math,Number,String,Error,RangeError,TypeError,TextEncoder,AbortController,structuredClone,Blob,Uint8Array,
    generatorState:state,current:null,mode:'advanced',timer:0,palette,draws,pending,downloads,lastEncodedYn:0,lastEncodedKA:0,lastEncodedKO:0,
    hAnimation:{elapsed:500,scene:null},hFaceImages:Object.freeze({}),hGpuRenderer:null,hFacePositionMode:'outside',hPositionProfile:null,
    createHPreviewRenderer:()=>({draw:()=>false}),backdropShowing:()=>false,
    Y3D_PAD_BASE:24,y3dPreview:{on:true,pad:24},window:{devicePixelRatio:1},document:{createElement:()=>({width:0,height:0}),querySelectorAll:selector=>selector==='[data-video-size]'?[node('exportCubeVideo')]:[]},
    // 기본은 스텁 편집기예요(면 QR 없음 — 기존 코너 자들의 전제). 실제 편집기 경로는 realEditor 로 재요.
    ...(realEditor?{}:{hImageEditor:{flush(){},syncQrText:()=>c.hFaceImages,fillQr:()=>0,clearQr:()=>0,kindOf:()=>null}}),
    hFaceQrSummary,hEffectiveQrPosition,hCornerTooCorner,createHImageEditor,hBrightestPaletteHex,reconcileHContentRotation,
    // fix 단계(2026-09-26): «안쪽» 실패 플래그 · 문구 검사(qrMatrix) · .schem 면 QR 블록 수 판정.
    hQrInnerFailed:false,qrMatrix,hFaceQrMinBlockScale,hDisplayMap,
    resolvedRenderProfile:()=> 'screen',hPlanarPreviewOptions,reconcileHPositionMode,hControlIcon,paintHPositionLabels:()=>{},videoToggle:node('cubeVideoToggle'),
    els:new Proxy({qrPositionCards:node('qrPositionCards'),qrFacePlacementCards:node('qrFacePlacementCards'),qrPosInner:node('qr-inner')},{get:(o,k)=>o[k]??node(String(k))}),$:node,
    isHGenerator,hQrPosition,withHCornerQr,buildHScene,encodeH,decodeH,hPreviewOptions,hMaskLuminance,hText:key=>hUiLabel(key,'ko'),clampHRotationSpeed,clampHRotationTiltMode,cubeVideoDurationMs,
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
  for(const name of ['syncShotPresetUi','syncFaceGainLabel','syncExportPpiHint','syncQuietGaugeReadout','syncTypeYCellEditorUi','syncHFaceImagesUi','syncHUi','syncCubeMakeUi','emitProductGenerate','emitGeneratorFail','emitLabGen','applyPreviewFit','syncBackdropLayer','updateGauge','updateOverflowHighlight','syncTypeUi','renderFinderUi','syncResTierUi','syncYLocatorUi','applyAutoLocatorProfileY','syncSeatUi','deriveYLocatorForQrPosition','stopHAnimation','syncOrbitPreviewUi'])c[name]=()=>{};
  vm.createContext(c);
  for(const name of ['resolveFallback','resolvedQrText','reportedQrPosition','buildConfig','encodeWithEcc','encodeOptsFor','renderTypeH','isCapacityError','eccTierLabel','render','hSceneOptions','drawHPreviewFrame','exportPlanFor','renderQrPositionUi','hQrTextEncodable','hSchemQrNote','commitFinderQrUi','cancelScheduledRender','runScheduledRender','flushScheduledRender','schedule'])vm.runInContext(fn(text,name),c);
  if(realEditor){
    delete c.syncHFaceImagesUi;vm.runInContext(fn(text,'syncHFaceImagesUi'),c);
    const editorStart=text.indexOf('const hImageEditor=createHImageEditor(');assert.ok(editorStart>0);
    vm.runInContext(text.slice(editorStart,text.indexOf('}});',editorStart)+4),c);
  }
  const cardsStart=text.indexOf('for (const card of els.qrPositionCards.children) {',text.indexOf('// ── 일반 모드: QR 링크'));
  assert.ok(cardsStart>0);vm.runInContext(text.slice(cardsStart,text.indexOf('\n}',cardsStart)+2),c);
  const urlStart=text.indexOf("els.qrUrl.addEventListener('input',");vm.runInContext(text.slice(urlStart,text.indexOf('\n});',urlStart)+4),c);
  const tooStart=text.indexOf("els.qrCornerToo.addEventListener('change',");assert.ok(tooStart>0);vm.runInContext(text.slice(tooStart,text.indexOf('\n});',tooStart)+4),c);
  const videoStart=text.indexOf('let cubeVideoJob=null;');vm.runInContext(text.slice(videoStart,text.indexOf('const CUBE_EXPORT_IDS=',videoStart)),c);
  for(const entry of imageEntries){const start=text.indexOf(entry);assert.ok(start>=0);vm.runInContext(text.slice(start,text.indexOf('\n});',start)+4),c);}
  return {c,node,draws,downloads,copies,pending,image:id=>events.get(id+':click')(),run:code=>vm.runInContext(code,c,{timeout:20000}),click:pos=>events.get('qr-'+pos+':click')(),video:()=>events.get('exportCubeVideo:click')(),url:value=>{node('qrUrl').value=value;events.get('qrUrl:input')();},cornerToo:on=>{node('qrCornerToo').checked=on;events.get('qrCornerToo:change')();}};
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

// ⚠ 의도적 갱신 (2026-09-26): H «안쪽» 이 빈 면 QR 로 열려 «H 비지원» 이 아니에요. 이 하네스는 6면(빈 면 0)이라
//   안쪽이 잠긴 경우를 재요 — 잠김 단언을 더했고, 빈 면이 있을 때의 채움은 아래 realEditor 자들이 재요.
test('6면(빈 면 0)에서 H 안쪽은 잠기고, 저장된 Y 안쪽 선택은 UI none·클릭 불변으로 유지돼요',()=>{
  const h=harness(source,{qrPosition:'inner'}),snapshot=JSON.stringify(h.c.generatorState);
  h.run('renderQrPositionUi();render()');assert.equal(h.node('qr-none').classList.contains('active'),true);
  assert.equal(h.node('qr-inner').classList.contains('disabled'),true);
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

// ── 타입 H «안쪽» = 빈 면 TL 스캐너 QR (운영자 2026-09-25·26) ─────────────────────────────
// 실제 createHImageEditor 를 index.html 의 배선 그대로 꽂아 카드 클릭 → 편집기 → onChange → render 경로를 재요.
// 편집기 모듈은 전역 document 를 쓰니 최소 DOM 을 잠시 꽂아요.
class EditorEl {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={toggle(){}};this.listeners={};this.attributes={};this.hidden=false;this.value='';this.disabled=false;}
  append(...items){this.children.push(...items);}
  addEventListener(name,listener){this.listeners[name]=listener;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text??'';}
  set innerHTML(value){this._html=String(value);this.children=[new EditorEl('svg')];}
  get innerHTML(){return this._html??'';}
  click(){this.listeners.click?.({});}
  focus(){globalThis.document.activeElement=this;}
}
function withEditorDom(run){
  const previous=globalThis.document;
  globalThis.document={activeElement:null,createElement:tag=>new EditorEl(tag)};
  try{return run();}finally{globalThis.document=previous;}
}
const walkEl=(root,all=[])=>{for(const child of root.children??[]){all.push(child);walkEl(child,all);}return all;};
const editorCard=(h,face)=>h.node('hFaceImageCards').children.find(card=>card.id===`hFaceImage-${face}`);
const editorButton=(h,face,pick)=>walkEl(editorCard(h,face)).find(pick);
const qrFaces=images=>Object.entries(images).filter(([,asset])=>asset.content==='qr').map(([face])=>face).sort();
const qrKeys=state=>JSON.stringify({qrPosition:state.qrPosition,qrFacePlacement:state.qrFacePlacement,locatorProfileY:state.locatorProfileY,finderQrProfiles:state.finderQrProfiles,previousOuterQrPosition:state.previousOuterQrPosition});
const H3={hFaces:3,hRenderFaces:3,hArrangement:'isometric'};

test('H 안쪽: 빈 면이 있으면 열리고, 누르면 빈 대상 면에만 QR 을 넣어요 — 코너는 꺼지고 qrPosition·Y 선택은 그대로, 다시 눌러도 같아요',()=>withEditorDom(()=>{
  const h=harness(source,H3,{realEditor:true});h.run('render();renderQrPositionUi()');
  assert.equal(h.node('error').textContent,'');
  assert.equal(h.node('qr-inner').classList.contains('disabled'),false,'3면 아이소 3면 렌더는 빈 면(ZP·XP·YP)이 있어요');
  assert.equal(h.node('qr-inner').title,'g1143');
  assert.equal(h.node('qr-TL').classList.contains('active'),true);assert.ok(h.c.current.scene.hCornerQr);
  const before=qrKeys(h.c.generatorState);
  h.click('inner');h.run('flushScheduledRender()');
  assert.deepEqual(qrFaces(h.c.hFaceImages),['XP','YP','ZP']);
  assert.equal(new Set(Object.values(h.c.hFaceImages)).size,1,'모든 QR 면이 같은 공유 자산이에요');
  assert.equal(h.c.hFaceImages.ZP.qr.text,tlReaderUrlWithHint('Y'),'코너 QR 과 같은 문구예요');
  assert.equal(h.c.current.scene.hCornerQr,undefined,'코너 QR 은 꺼져요(배타)');assert.equal(qrCount(h.c.current.scene),0);
  assert.equal(h.c.current.sceneOpts.faceImages,h.c.hFaceImages);
  const cfg=h.run('buildConfig()');assert.equal(cfg.fallback.mode,'off');assert.equal(cfg.hFaceQr,true);
  assert.equal(h.node('qr-inner').classList.contains('active'),true);assert.equal(h.node('qr-TL').classList.contains('active'),false);
  assert.equal(h.node('qr-inner').attrs['aria-pressed'],'true');
  assert.equal(qrKeys(h.c.generatorState),before,'H 안쪽은 qrPosition 을 쓰지 않아요');
  assert.equal(h.run('reportedQrPosition()'),'inner');
  assert.ok(h.node('hQrInnerHint').textContent.includes('g1146'));assert.equal(h.node('hQrInnerHint').hidden,false);
  // 모델(전개도·glTF·.schem·종이의 입력)에도 같은 자산이 실려요.
  const model=generatorCubeModel(h.c.current,h.c.palette);
  assert.deepEqual(model.images.map(image=>image.face).sort(),['XP','YP','ZP']);assert.ok(model.images.every(image=>image.image.content==='qr'));
  // 멱등 — 다시 눌러도 에셋·예약이 그대로예요(onChange 없음).
  const same=h.c.hFaceImages,pending=h.pending.length;h.click('inner');
  assert.equal(h.c.hFaceImages,same);assert.equal(h.pending.length,pending);
  // Y 로 돌아가면 저장된 선택이 그대로예요.
  const back=selectHRepresentation(h.c.generatorState,'2.5d');assert.equal(back.qrPosition,'TL');assert.equal(qrKeys(back),before);
}));

test('H 안쪽 뒤 코너·없음은 면 QR 을 전부 걷고 기존 경로로 가요(배타)',()=>withEditorDom(()=>{
  const h=harness(source,H3,{realEditor:true});h.run('render()');
  h.click('inner');h.run('flushScheduledRender()');assert.equal(qrFaces(h.c.hFaceImages).length,3);
  h.click('BR');h.run('flushScheduledRender()');
  assert.deepEqual(qrFaces(h.c.hFaceImages),[]);assert.equal(h.c.generatorState.qrPosition,'BR');
  assert.equal(h.c.current.hQr?.corner,'BR');assert.equal(h.node('qr-BR').classList.contains('active'),true);assert.equal(h.node('qr-inner').classList.contains('active'),false);
  h.click('inner');h.run('flushScheduledRender()');assert.equal(qrFaces(h.c.hFaceImages).length,3);
  h.click('none');h.run('flushScheduledRender()');
  assert.deepEqual(qrFaces(h.c.hFaceImages),[]);assert.equal(qrCount(h.c.current.scene),0);assert.equal(h.node('qr-none').classList.contains('active'),true);
}));

test('고급 «코너 QR 병행» 은 H 면 QR 에도 열려 둘 다 보여요(운영자 2026-09-26)',()=>withEditorDom(()=>{
  const h=harness(source,{...H3,qrPosition:'BL'},{realEditor:true});h.run('render();renderQrPositionUi()');
  assert.equal(h.node('cornerTooRow').style.display,'none','면 QR 이 없으면 병행 줄은 닫혀 있어요');
  h.click('inner');h.run('flushScheduledRender()');
  assert.equal(h.node('cornerTooRow').style.display,'','고급 모드 + 면 QR 이면 병행 줄이 열려요');
  assert.equal(h.node('qrCornerTooLabel').dataset.i18n,'g1147');assert.equal(h.c.current.scene.hCornerQr,undefined,'기본은 배타예요');
  h.c.generatorState.qrCornerToo=true;h.run('render()');
  assert.equal(h.c.current.hQr?.corner,'BL','병행 코너는 저장된 코너예요');assert.ok(qrCount(h.c.current.scene)>200);
  assert.deepEqual(qrFaces(h.c.hFaceImages),['XP','YP','ZP']);assert.equal(h.run('buildConfig()').hFaceQr,true);
  // 저장된 코너가 없으면 좌상(O/A 중앙 QR 병행과 같아요).
  h.c.generatorState.qrPosition='none';h.run('render()');assert.equal(h.c.current.hQr?.corner,'TL');
  // 일반 모드에서는 병행 줄이 닫혀요(상태는 O/A 와 같이 그대로 적용돼요).
  h.c.mode='normal';h.run('renderQrPositionUi()');assert.equal(h.node('cornerTooRow').style.display,'none');
}));

test('빈 면이 없으면(6면 · 아이소 3면 6면 렌더) H 안쪽은 잠기고 사유를 보여요',()=>withEditorDom(()=>{
  for(const overrides of [{hFaces:6},{hFaces:3,hRenderFaces:6,hArrangement:'isometric'}]){
    const h=harness(source,overrides,{realEditor:true});h.run('render();renderQrPositionUi()');
    const inner=h.node('qr-inner');
    assert.equal(inner.classList.contains('disabled'),true,JSON.stringify(overrides));assert.equal(inner.attrs['aria-disabled'],'true');
    assert.equal(inner.title,'g1144');
    const hint=h.node('hQrInnerHint').textContent;assert.ok(hint.includes('g1144')&&hint.includes('g1146'),hint);
    assert.equal(h.node('qr-TL').classList.contains('active'),true,'저장된 코너가 보여요');
    h.click('inner');assert.deepEqual(h.c.hFaceImages,{});
  }
}));

test('빈 면마다 이미지·텍스트가 있으면 H 안쪽은 잠기고 «전부 점유» 사유를 보여요',()=>{
  const h=harness(source,H3);h.c.hFaceImages=Object.freeze({ZP:{content:'image'},XP:{content:'text'},YP:{content:'image'}});
  h.run('renderQrPositionUi()');
  assert.equal(h.node('qr-inner').classList.contains('disabled'),true);assert.equal(h.node('qr-inner').title,'g1145');
  assert.ok(h.node('hQrInnerHint').textContent.includes('g1145'));
  // 배경만 바꾼 면('fill')은 비어 있는 면이라 다시 열려요.
  h.c.hFaceImages=Object.freeze({ZP:{content:'image'},XP:{content:'text'},YP:{content:'fill'}});h.run('renderQrPositionUi()');
  assert.equal(h.node('qr-inner').classList.contains('disabled'),false);assert.equal(h.node('qr-inner').title,'g1143');
});

test('면별 «TL 스캐너 QR 넣기» 는 well 맨 위 버튼이고, 넣으면 카드가 안쪽으로 바뀌고 [제거]로 꺼져요',()=>withEditorDom(()=>{
  const h=harness(source,H3,{realEditor:true});h.run('render()');
  const well=walkEl(editorCard(h,'ZP')).find(el=>el.className==='h-image-well');
  assert.deepEqual(well.children.map(el=>el.dataset.hLabel??el.tagName),['img','imageQr','imageSample','imageText'],'[QR 넣기][테스트 이미지][텍스트 넣기] 순서예요');
  const qrButton=well.children[1];assert.equal(qrButton.attributes['aria-label'],'ZP TL 스캐너 QR 넣기');
  qrButton.click();h.run('flushScheduledRender()');
  assert.equal(h.run("hImageEditor.kindOf('ZP')"),'qr');assert.deepEqual(qrFaces(h.c.hFaceImages),['ZP']);
  assert.equal(qrButton.hidden,true,'넣은 뒤엔 형제 버튼처럼 숨어요');
  assert.equal(h.node('qr-inner').classList.contains('active'),true,'면 버튼만으로도 카드 줄이 안쪽이 돼요');
  assert.deepEqual(h.run('hFaceQrSummary(generatorState,hFaceImages)').fillable,['XP','YP'],'나머지 빈 면은 그대로예요');
  assert.equal(h.node('hFaceImageStatus').textContent,'ZP 면에 TL 스캐너 QR 을 넣었어요');
  // 잠긴 컨트롤: 회전·맞춤(배경 되돌리기·색 입력도 같은 규칙)
  const rotate=editorButton(h,'ZP',el=>el.dataset.rotate==='45'),fit=editorButton(h,'ZP',el=>el.dataset.fit==='cover');
  assert.equal(rotate.disabled,true);assert.equal(fit.disabled,true);assert.equal(rotate.attributes['aria-disabled'],'true');
  assert.ok(rotate.title.includes('QR 면은 인식을 위해'));
  const remove=editorButton(h,'ZP',el=>el.dataset.hTitle==='imageRemove');assert.equal(remove.disabled,false);
  remove.click();h.run('flushScheduledRender()');
  assert.equal(h.run("hImageEditor.kindOf('ZP')"),null);assert.deepEqual(qrFaces(h.c.hFaceImages),[]);
  assert.equal(h.node('qr-TL').classList.contains('active'),true,'마지막 QR 면이 사라지면 저장된 코너가 돌아와요');
  assert.ok(h.c.current.scene.hCornerQr);
}));

test('나중에 생긴 빈 면은 자동으로 채우지 않고, 숨은 슬롯의 QR 은 슬롯 정책대로 보존돼요',()=>withEditorDom(()=>{
  const h=harness(source,H3,{realEditor:true});h.run('render()');
  h.click('inner');h.run('flushScheduledRender()');assert.deepEqual(qrFaces(h.c.hFaceImages),['XP','YP','ZP']);
  // 1면으로 줄이면 빈 면이 ZM·YM 까지 늘어요 — 자동으로 안 채워요(운영자 2026-09-26 «자동으로 안 넣음»).
  Object.assign(h.c.generatorState,selectHFaceCount(h.c.generatorState,1));h.run('render();renderQrPositionUi()');
  const summary=h.run('hFaceQrSummary(generatorState,hFaceImages)');
  assert.deepEqual(summary.qr,['ZP','XP','YP']);assert.deepEqual(summary.fillable,['ZM','YM']);
  assert.deepEqual(qrFaces(h.c.hFaceImages),['XP','YP','ZP']);
  assert.equal(h.node('qr-inner').classList.contains('active'),true);
  h.click('inner');h.run('flushScheduledRender()');assert.deepEqual(qrFaces(h.c.hFaceImages),['XP','YM','YP','ZM','ZP'],'다시 누르면 새 빈 면을 채워요');
  // 3면 + 6면 렌더(대상 0) — QR 은 숨은 슬롯에 남고, 카드는 저장된 코너로 돌아와요.
  Object.assign(h.c.generatorState,selectHFaceCount(h.c.generatorState,3));
  Object.assign(h.c.generatorState,selectHRenderFaces(h.c.generatorState,6));h.run('render();renderQrPositionUi()');
  assert.equal(h.node('qr-inner').classList.contains('disabled'),true);assert.equal(h.c.current.hQr?.corner,'TL');
  assert.equal(h.run("hImageEditor.kindOf('ZP')"),'qr','숨은 슬롯의 QR 은 지우지 않아요');
  Object.assign(h.c.generatorState,selectHRenderFaces(h.c.generatorState,3));h.run('render();renderQrPositionUi()');
  assert.equal(h.node('qr-inner').classList.contains('active'),true,'다시 빈 면이 되면 QR 이 돌아와요');assert.equal(h.c.current.scene.hCornerQr,undefined);
  // 대상 0 에서 코너를 누르면 숨은 슬롯의 QR 까지 걷어요(나중에 되살아나지 않게).
  Object.assign(h.c.generatorState,selectHRenderFaces(h.c.generatorState,6));h.run('render();renderQrPositionUi()');
  h.click('BR');h.run('flushScheduledRender()');
  Object.assign(h.c.generatorState,selectHRenderFaces(h.c.generatorState,3));h.run('render();renderQrPositionUi()');
  assert.deepEqual(qrFaces(h.c.hFaceImages),[]);assert.equal(h.c.current.hQr?.corner,'BR');
}));

test('Y 안쪽 선택으로 H 에 들어와 면 QR 을 켰다 [제거]로 끄고 돌아가도 Y 의 안쪽이 보존돼요',()=>withEditorDom(()=>{
  const h=harness(source,{...H3,qrPosition:'inner'},{realEditor:true});h.run('render();renderQrPositionUi()');
  assert.equal(h.node('qr-none').classList.contains('active'),true);
  const before=qrKeys(h.c.generatorState);
  h.click('inner');h.run('flushScheduledRender()');assert.equal(qrFaces(h.c.hFaceImages).length,3);
  for(const face of ['ZP','XP','YP'])editorButton(h,face,el=>el.dataset.hTitle==='imageRemove').click();
  h.run('flushScheduledRender()');assert.deepEqual(qrFaces(h.c.hFaceImages),[]);
  assert.equal(qrKeys(h.c.generatorState),before);
  assert.equal(selectHRepresentation(h.c.generatorState,'2.5d').qrPosition,'inner');
}));

test('면 QR 문구는 렌더 초크포인트에서 조용히 다시 맞춰요 — onChange·회전 전환 없이 예약 1회, 잘못된 문구는 코너와 같은 오류',()=>withEditorDom(()=>{
  const h=harness(source,H3,{realEditor:true});h.run('render()');
  h.click('inner');h.run('flushScheduledRender()');
  h.c.generatorState.hAutoRotate=false;h.c.generatorState.hAutoRotateIntent='on';
  const pending=h.pending.length;h.url('HTTPS://EXAMPLE.COM');assert.equal(h.pending.length,pending+1,'입력은 한 번 예약해요');
  h.run('flushScheduledRender()');assert.equal(h.pending.length,pending+1,'렌더가 다시 예약하지 않아요(onChange 미경유)');
  assert.equal(h.c.generatorState.hAutoRotate,false,'입력마다 회전 3D 로 끌려가지 않아요');
  assert.equal(h.c.hFaceImages.ZP.qr.text,'HTTPS://EXAMPLE.COM');assert.equal(new Set(Object.values(h.c.hFaceImages)).size,1);
  assert.equal(h.c.current.sceneOpts.faceImages.XP.qr.text,'HTTPS://EXAMPLE.COM');
  const qr=qrMatrix('HTTPS://EXAMPLE.COM'),asset=h.c.hFaceImages.ZP,px=asset.qr.modulePx;
  for(let r=0;r<qr.size;r++)for(let c=0;c<qr.size;c++){const k=(((4+r)*px+(px>>1))*asset.width+(4+c)*px+(px>>1))*4;assert.equal(asset.pixels[k]<128,qr.modules[r*qr.size+c]===1);}
  h.url('https://example.com');h.run('flushScheduledRender()');assert.equal(h.c.current,null);assert.ok(h.node('error').textContent);
  h.url('');h.run('flushScheduledRender()');assert.equal(h.c.hFaceImages.ZP.qr.text,tlReaderUrlWithHint('Y'),'기본 문구로 돌아와요');
}));

// ── fix 단계(2026-09-26 리뷰) ─────────────────────────────────────────────────────────────
// 리뷰 반례: 저장 위치가 «없음» 이면 렌더는 성공하니, 잘못된 문구로 «안쪽» 을 누르면 누른 자리에 아무 변화가 없었어요.
test('잘못된 QR 문구로 «안쪽» 을 누르면 카드 줄 힌트에도 알리고, 문구가 QR 이 되면 걷혀요',()=>withEditorDom(()=>{
  const h=harness(source,{...H3,qrPosition:'none'},{realEditor:true});h.run('render();renderQrPositionUi()');
  h.url('https://x.y');h.run('flushScheduledRender()');assert.equal(h.node('error').textContent,'','저장 위치가 없음이라 렌더는 성공해요');
  const row=['inner','TL','TR','BL','BR','none'].map(pos=>h.node('qr-'+pos).classList.contains('active'));
  h.click('inner');
  assert.deepEqual(qrFaces(h.c.hFaceImages),[]);assert.equal(h.node('hFaceImageStatus').textContent,hUiLabel('imageQrInvalid','ko'),'편집기 상태줄도 그대로 알려요');
  assert.ok(h.node('hQrInnerHint').textContent.includes('g1148'),'누른 카드 옆 힌트에 실패 사유가 보여요');
  assert.deepEqual(['inner','TL','TR','BL','BR','none'].map(pos=>h.node('qr-'+pos).classList.contains('active')),row,'카드 줄 선택은 그대로예요');
  h.url('https://x.yz');assert.ok(h.node('hQrInnerHint').textContent.includes('g1148'),'여전히 QR 이 안 되는 문구면 남아요');
  h.url('HTTPS://X.Y');assert.ok(!h.node('hQrInnerHint').textContent.includes('g1148'),'문구가 QR 이 되면 걷혀요');
  h.url('https://x.y');assert.ok(!h.node('hQrInnerHint').textContent.includes('g1148'),'다시 누르기 전에는 되살아나지 않아요');
  h.url('HTTPS://X.Y');h.click('inner');h.run('flushScheduledRender()');assert.deepEqual(qrFaces(h.c.hFaceImages),['XP','YP','ZP']);
  // 실패 뒤 코너를 누르면 안내도 걷혀요.
  h.click('none');h.url('https://x.y');h.click('inner');assert.ok(h.node('hQrInnerHint').textContent.includes('g1148'));
  h.click('TL');assert.ok(!h.node('hQrInnerHint').textContent.includes('g1148'));
}));

// 리뷰 반례: 병행 코너는 전에 고른 저장값인데, 카드 줄에는 «안쪽» 만 활성이라 어느 코너에 그려지는지 안 보였어요.
test('«코너 QR 병행» 으로 그려지는 코너는 카드 줄에 보조 표시(also)와 힌트로 보여요 — 고른 카드(active)는 여전히 «안쪽» 이에요',()=>withEditorDom(()=>{
  const h=harness(source,{...H3,qrPosition:'BL'},{realEditor:true});h.run('render();renderQrPositionUi()');
  h.cornerToo(true);assert.equal(h.node('qr-BL').classList.contains('also'),false,'면 QR 이 없으면 코너가 곧 선택이라 보조 표시가 없어요');
  assert.equal(h.node('qr-BL').classList.contains('active'),true);
  h.click('inner');h.run('flushScheduledRender()');
  assert.equal(h.node('qr-inner').classList.contains('active'),true);assert.equal(h.node('qr-BL').classList.contains('active'),false);
  assert.equal(h.node('qr-BL').classList.contains('also'),true,'병행 코너는 점선 보조 표시예요');
  assert.deepEqual(['TL','TR','BR','none','inner'].filter(pos=>h.node('qr-'+pos).classList.contains('also')),[],'보조 표시는 그 코너 하나뿐이에요');
  assert.ok(h.node('hQrInnerHint').textContent.includes('g1149'));assert.equal(h.c.current.hQr?.corner,'BL','표시한 코너와 그려진 코너가 같아요');
  h.cornerToo(false);assert.equal(h.node('qr-BL').classList.contains('also'),false,'병행을 끄면 바로 사라져요');
  assert.ok(!h.node('hQrInnerHint').textContent.includes('g1149'));h.run('flushScheduledRender()');assert.equal(h.c.current.scene.hCornerQr,undefined);
  // 저장 코너가 없으면 좌상에 그려지고 좌상 카드가 보조 표시예요.
  h.c.generatorState.qrPosition='none';h.cornerToo(true);h.run('flushScheduledRender()');
  assert.equal(h.node('qr-TL').classList.contains('also'),true);assert.equal(h.c.current.hQr?.corner,'TL');
  // 보조 표시된 코너를 누르면 배타대로 면 QR 을 걷고 그 코너가 선택이 돼요.
  h.click('TL');h.run('flushScheduledRender()');
  assert.deepEqual(qrFaces(h.c.hFaceImages),[]);assert.equal(h.node('qr-TL').classList.contains('active'),true);assert.equal(h.node('qr-TL').classList.contains('also'),false);
}));

// 리뷰 반례: .schem 셀당 블록 1×1(기본) 에서 H3 면 QR 은 441 모듈 중 56 개가 틀려요. 블록 카드는 고급 전용이라 일반 모드에서도 줄로 알려요.
test('.schem 면 QR 안내: 지금 셀당 블록 수로 모듈이 빠질 때만 필요한 카드 값을 알려요',()=>withEditorDom(()=>{
  const setup=overrides=>{
    const h=harness(source,{...H3,...overrides},{realEditor:true});h.c.tf=(key,vars)=>`${key}:${JSON.stringify(vars)}`;
    for(const scale of [1,2,4]){const card=h.node('block-'+scale);card.dataset.blockScale=String(scale);h.node('cubeBlockScaleCards').children.push(card);}
    h.node('cubeBlockScale').value='1';h.run('render()');return h;
  };
  const h=setup({versionH:3});assert.equal(h.c.current.encoded.n,25);
  assert.equal(h.run('hSchemQrNote()'),'','면 QR 이 없으면 안내가 없어요');
  h.click('inner');assert.equal(h.run('hSchemQrNote()'),'','판정은 내보내기 입력(current)을 따라요 — 렌더 전에는 아직 QR 이 없어요');
  h.run('flushScheduledRender()');
  assert.equal(h.run('hSchemQrNote()'),'g1150:{"scale":"2"}');
  assert.equal(hFaceQrMinBlockScale(generatorCubeModel(h.c.current,h.c.palette)),2,'판정은 실제 내보내기 모델과 같아요');
  h.node('cubeBlockScale').value='2';assert.equal(h.run('hSchemQrNote()'),'');
  const big=setup({versionH:7});big.click('inner');big.run('flushScheduledRender()');
  assert.ok(big.c.current.encoded.n>=29);assert.equal(big.run('hSchemQrNote()'),'','n≥29 면 1×1 에서도 모든 모듈이 블록을 받아요');
}));
