import test from 'node:test';
import assert from 'node:assert/strict';
import {rasterToPng} from '../src/png.js';
import {createHImageEditor} from '../src/h-image-editor-ui.js';
import {hFaceQrImage} from '../src/h-face-qr.js';
import {hUiLabel} from '../src/generator-h.js';
import {tlReaderUrlWithHint} from '../src/qr.js';

// 빈 면 편집기의 면 콘텐츠 수명(이미지·텍스트·TL 스캐너 QR)을 실제 createHImageEditor 로 재요.
// DOM 은 최소 스텁이에요 — 텍스트 raster 는 투명 캔버스라 합성 결과의 모서리 픽셀이 곧 배경색이에요.
const transparentPngHref=`data:image/png;base64,${Buffer.from(rasterToPng({width:1,height:1,pixels:new Uint8ClampedArray([0,0,0,0])})).toString('base64')}`;
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={toggle(){}};this.listeners={};this.attributes={};this.hidden=false;this.value='';this.disabled=false;this.parent=null;}
  append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
  addEventListener(name,listener){this.listeners[name]=listener;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text??'';}
  set innerHTML(value){this._html=String(value);this.children=[new Element('svg')];}
  get innerHTML(){return this._html??'';}
  click(){this.listeners.click?.({});}
  focus(){globalThis.document.activeElement=this;}
  setCustomValidity(){}
  reportValidity(){return true;}
  getBoundingClientRect(){return {left:0,top:0,width:100,height:100};}
  setPointerCapture(){}
}
class Canvas extends Element {
  constructor(){super('canvas');this.width=1;this.height=1;}
  getContext(){
    const canvas=this;
    return {imageSmoothingEnabled:true,font:'',textAlign:'',textBaseline:'',fillStyle:'',drawImage(){},fillText(){},
      measureText:text=>({width:String(text).length*50}),
      getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),canvas};
  }
  toDataURL(){return transparentPngHref;}
}
const walk=(root,all=[])=>{for(const child of root.children){all.push(child);walk(child,all);}return all;};
const find=(root,predicate)=>walk(root).find(predicate);
async function withDom(run){
  const previous=globalThis.document;
  globalThis.document={activeElement:null,createElement:tag=>tag==='canvas'?new Canvas():new Element(tag)};
  try{return await run();}finally{globalThis.document=previous;}
}
const pixel=(image,x=0,y=0)=>[...image.pixels.slice((y*image.width+x)*4,(y*image.width+x)*4+3)];

test('반례: 텍스트 면도 팔레트 기본 배경을 따라 다시 그려져요(setDefaultBackground)',()=>withDom(()=>{
  let palette='#ffffff';
  const host=new Element(),status=new Element();
  const editor=createHImageEditor({container:host,status,text:key=>key,onChange(){},getDefaultBackground:()=>palette});
  editor.sync({hFaces:3,hArrangement:'isometric',hRenderFaces:3});
  const card=find(host,node=>node.id==='hFaceImage-ZP');
  find(card,node=>node.dataset.hLabel==='imageText').click();
  const area=find(card,node=>node.tagName==='textarea');area.value='TL';
  // 입력 이벤트는 150ms 디바운스라 200ms 기다려요 — 사용자와 같은 applyText 경로예요.
  area.listeners.input();
  return new Promise(resolve=>setTimeout(resolve,200)).then(()=>{
    assert.ok(editor.images.ZP,'텍스트 면 에셋이 있어요');
    assert.equal(editor.images.ZP.content,'text');
    assert.deepEqual(pixel(editor.images.ZP),[255,255,255]);
    palette='#123456';editor.setDefaultBackground(palette);
    assert.deepEqual(pixel(editor.images.ZP),[0x12,0x34,0x56],'텍스트 면이 옛 배경으로 남으면 안 돼요');
  });
}));

// ── TL 스캐너 QR 면 (운영자 2026-09-25·26) ─────────────────────────────────────────
const QR_TEXT=tlReaderUrlWithHint('Y');
function makeEditor({qrText=()=>QR_TEXT,palette=()=>'#ffffff'}={}){
  const host=new Element(),status=new Element(),changes=[];
  const editor=createHImageEditor({container:host,status,text:key=>hUiLabel(key,'ko'),onChange:images=>changes.push(images),getDefaultBackground:palette,getQrText:qrText});
  editor.sync({hFaces:3,hArrangement:'isometric',hRenderFaces:3});
  const card=face=>find(host,node=>node.id===`hFaceImage-${face}`);
  const button=(face,pick)=>find(card(face),pick);
  return {editor,host,status,changes,card,
    qr:face=>button(face,node=>node.dataset.hLabel==='imageQr'),
    remove:face=>button(face,node=>node.dataset.hTitle==='imageRemove'),
    textToggle:face=>button(face,node=>node.dataset.hLabel==='imageText'),
    file:face=>button(face,node=>node.type==='file'),
    control:(face,pick)=>button(face,pick)};
}
async function loadImage(h,face){
  const file=h.file(face);file.files=[{type:'image/png',size:1}];file.listeners.change();
  await new Promise(resolve=>setTimeout(resolve,0));
}
const withBitmap=async run=>{const previous=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});try{return await run();}finally{globalThis.createImageBitmap=previous;}};

test('면별 QR 버튼은 well 맨 위에 있고 면 id 를 담은 이름을 가져요 — 넣으면 공유 QR 자산, [제거]로 꺼져요',()=>withDom(()=>{
  const h=makeEditor(),well=find(h.card('ZP'),node=>node.className==='h-image-well');
  assert.deepEqual(well.children.map(node=>node.dataset.hLabel??node.tagName),['img','imageQr','imageSample','imageText']);
  const qr=h.qr('ZP');assert.equal(qr.textContent,'TL 스캐너 QR 넣기');assert.equal(qr.attributes['aria-label'],'ZP TL 스캐너 QR 넣기');assert.equal(qr.hidden,false);
  qr.click();
  assert.equal(h.editor.kindOf('ZP'),'qr');assert.equal(h.editor.images.ZP,hFaceQrImage(QR_TEXT),'면 설정을 우회한 공유 자산이에요');
  assert.equal(h.changes.length,1);assert.equal(qr.hidden,true);
  assert.equal(h.status.textContent,'ZP 면에 TL 스캐너 QR 을 넣었어요');
  assert.equal(globalThis.document.activeElement,h.remove('ZP'),'숨는 버튼 대신 [제거]로 포커스가 가요');
  const size=find(h.card('ZP'),node=>node.className==='hint'&&node.textContent==='TL 스캐너 QR');assert.ok(size,'상태 줄은 «TL 스캐너 QR» 이에요');
  const preview=find(h.card('ZP'),node=>node.tagName==='img');assert.equal(preview.src,h.editor.images.ZP.href);assert.equal(preview.title,QR_TEXT);
  h.remove('ZP').click();assert.equal(h.editor.kindOf('ZP'),null);assert.equal(h.editor.images.ZP,undefined);assert.equal(qr.hidden,false);
}));

test('QR 면은 회전·맞춤·배경을 잠그고, 이미 걸린 45° 같은 옛 설정도 QR 을 망가뜨리지 않아요',()=>withBitmap(()=>withDom(async()=>{
  const h=makeEditor();await loadImage(h,'XP');
  h.control('XP',node=>node.dataset.rotate==='45').click();h.control('XP',node=>node.dataset.fit==='cover').click();
  h.remove('XP').click();h.qr('XP').click();
  assert.equal(h.editor.images.XP,hFaceQrImage(QR_TEXT),'회전 45°·cover 가 남아 있어도 QR 자산 그대로예요');
  const locked=[node=>node.dataset.rotate==='45',node=>node.dataset.rotate==='-45',node=>node.dataset.fit==='contain',node=>node.dataset.fit==='cover',node=>node.dataset.fit==='fill',node=>node.dataset.hTitle==='imageBackgroundReset',node=>node.type==='range',node=>node.type==='text'];
  for(const pick of locked){const control=h.control('XP',pick);assert.equal(control.disabled,true);}
  const pad=h.control('XP',node=>node.className==='h-color-pad');assert.equal(pad.tabIndex,-1);assert.equal(pad.attributes['aria-disabled'],'true');
  const changes=h.changes.length;pad.listeners.keydown({key:'ArrowLeft',preventDefault(){}});pad.listeners.pointerdown({pointerId:1,clientX:10,clientY:10});pad.listeners.pointerup();
  assert.equal(h.changes.length,changes,'잠긴 색 패드는 입력을 받지 않아요');assert.equal(h.editor.images.XP,hFaceQrImage(QR_TEXT));
  h.remove('XP').click();
  for(const pick of [node=>node.dataset.fit==='cover',node=>node.dataset.hTitle==='imageBackgroundReset',node=>node.type==='range'])assert.equal(h.control('XP',pick).disabled,false,'QR 을 걷으면 다시 열려요');
})));

// 리뷰 반례(2026-09-26): 잠긴 컨트롤이 저장된 «채우기 · 빨강» 을 보여 줬는데 실제로는 «맞추기 · 흰 배경» 으로 그려졌어요.
test('QR 면의 잠긴 컨트롤은 그려진 값(맞추기 · 흰 배경)을 보이고, [제거] 뒤엔 저장된 맞춤·배경이 돌아와요',()=>withDom(()=>{
  const h=makeEditor(),pick=fit=>h.control('ZP',node=>node.dataset.fit===fit),field=type=>h.control('ZP',node=>node.type===type);
  const hex=field('text'),rgb=()=>walk(h.card('ZP')).filter(node=>node.type==='number').slice(0,3).map(input=>input.value);
  pick('cover').click();hex.value='#ff0000';hex.listeners.change();
  assert.equal(h.editor.images.ZP.content,'fill');assert.equal(pick('cover').attributes['aria-pressed'],'true');assert.equal(hex.value,'#ff0000');
  h.qr('ZP').click();
  assert.equal(h.editor.images.ZP.content,'qr');assert.deepEqual(pixel(h.editor.images.ZP),[255,255,255]);
  assert.deepEqual(['contain','fill','cover'].map(fit=>pick(fit).attributes['aria-pressed']),['true','false','false'],'QR 은 맞추기로 그려져요');
  assert.equal(hex.value,'#ffffff','HEX 는 그려진 흰 배경이에요');assert.equal(hex.disabled,true);
  assert.deepEqual(rgb(),['255','255','255'],'R·G·B 도 흰색이에요');assert.equal(field('range').value,'100','밝기도 흰색(100)이에요');
  h.remove('ZP').click();
  assert.equal(pick('cover').attributes['aria-pressed'],'true','저장된 맞춤이 돌아와요');assert.equal(hex.value,'#ff0000','저장된 배경이 돌아와요');
  assert.deepEqual(rgb(),['255','0','0']);
  assert.equal(h.editor.images.ZP.content,'fill');assert.deepEqual(pixel(h.editor.images.ZP),[255,0,0]);
}));

test('일괄 채우기 상태줄은 실제로 그려지는 물리 면 수(별칭 포함)를 세요 — 1면 6면 렌더는 카드 2장 · 면 4곳',()=>withDom(()=>{
  const h=makeEditor();h.editor.sync({hFaces:1,hArrangement:'isometric',hRenderFaces:6});
  assert.equal(h.card('ZM').hidden,false);assert.equal(h.card('ZP').hidden,true,'ZP 는 ZM 카드의 별칭이에요');
  assert.equal(h.editor.fillQr(['ZM','YM']),2,'돌려주는 값은 넣은 대상(카드) 수예요');
  assert.equal(h.status.textContent,'빈 면 4곳에 TL 스캐너 QR 을 넣었어요');
}));

test('이미지·텍스트·QR 은 서로를 지워요 — 대기 중인 이미지 로드도 QR 을 덮지 못해요',()=>withBitmap(()=>withDom(async()=>{
  const h=makeEditor();
  h.qr('ZP').click();await loadImage(h,'ZP');
  assert.equal(h.editor.kindOf('ZP'),'image','이미지 선택은 QR 을 대체해요');assert.equal(h.editor.images.ZP.content,'image');
  h.qr('ZP').click();assert.equal(h.editor.kindOf('ZP'),'qr','QR 넣기는 이미지를 지워요');
  h.textToggle('ZP').click();assert.equal(h.editor.kindOf('ZP'),'text','텍스트 넣기는 QR 을 지워요');
  // 대기 중 로드: 파일을 고른 직후(아직 안 읽힘) QR 을 넣으면 로드 결과는 버려져요.
  const file=h.file('YP');file.files=[{type:'image/png',size:1}];file.listeners.change();
  h.qr('YP').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(h.editor.kindOf('YP'),'qr');assert.equal(h.editor.images.YP.content,'qr');
})));

test('fillQr 는 빈 면(에셋 없음·배경만·빈 텍스트)만 한 번에 채우고 onChange 는 한 번, 다시 부르면 0 이에요',()=>withBitmap(()=>withDom(async()=>{
  const h=makeEditor();
  await loadImage(h,'ZP');                                        // 이미지 면 — 건너뛰어요
  h.control('XP',node=>node.type==='text').value='#abcdef';h.control('XP',node=>node.type==='text').listeners.change(); // 배경만 → 'fill'
  h.textToggle('YP').click();                                     // 빈 텍스트 면 — «텍스트 설정 안 한 면» 이라 채워요
  assert.deepEqual([h.editor.images.ZP.content,h.editor.images.XP.content,h.editor.images.YP],['image','fill',undefined]);
  const changes=h.changes.length;
  assert.equal(h.editor.fillQr(['ZP','XP','YP']),2);assert.equal(h.changes.length,changes+1,'일괄 채우기는 onChange 한 번이에요');
  assert.deepEqual(['ZP','XP','YP'].map(face=>h.editor.kindOf(face)),['image','qr','qr']);
  assert.equal(h.status.textContent,'빈 면 2곳에 TL 스캐너 QR 을 넣었어요');
  assert.equal(h.editor.fillQr(['ZP','XP','YP']),0);assert.equal(h.changes.length,changes+1,'멱등 — 두 번째는 아무것도 안 해요');
  assert.equal(h.editor.fillQr(['NOPE']),0);
})));

test('clearQr 는 숨은 슬롯까지 QR 을 걷고, 배경을 바꾼 면은 배경 에셋으로 돌아가요',()=>withDom(()=>{
  const h=makeEditor(),hex=h.control('XP',node=>node.type==='text');hex.value='#abcdef';hex.listeners.change();
  assert.equal(h.editor.images.XP.content,'fill');
  assert.equal(h.editor.fillQr(['ZP','XP','YP']),3);
  h.editor.sync({hFaces:3,hArrangement:'isometric',hRenderFaces:6});   // 대상 0 — 카드는 숨지만 QR 은 슬롯에 남아요
  assert.equal(h.card('ZP').hidden,true);assert.equal(h.editor.kindOf('ZP'),'qr');
  const changes=h.changes.length;
  assert.equal(h.editor.clearQr(),3);assert.equal(h.changes.length,changes+1);
  assert.deepEqual(Object.keys(h.editor.images),['XP'],'배경을 바꾼 면만 배경 에셋이 남아요');assert.equal(h.editor.images.XP.content,'fill');
  assert.deepEqual(pixel(h.editor.images.XP),[0xab,0xcd,0xef]);
  assert.equal(h.editor.clearQr(),0);assert.equal(h.changes.length,changes+1,'걷을 게 없으면 onChange 도 없어요');
}));

test('syncQrText 는 문구가 바뀔 때만 QR 면 자산을 갈아 끼우고 onChange 를 부르지 않아요',()=>withDom(()=>{
  const h=makeEditor();
  assert.equal(h.editor.syncQrText('https://not-alnum.example'),h.editor.images,'QR 면이 없으면 문구를 보지도 않아요(던지지 않아요)');
  h.editor.fillQr(['ZP','XP']);
  const changes=h.changes.length,before=h.editor.images;
  assert.equal(h.editor.syncQrText(QR_TEXT),before,'같은 문구면 그대로예요');
  const next=h.editor.syncQrText('HTTPS://EXAMPLE.COM');
  assert.notEqual(next,before);assert.equal(next.ZP,next.XP);assert.equal(next.ZP.qr.text,'HTTPS://EXAMPLE.COM');
  assert.equal(h.changes.length,changes,'onChange 없음 — 렌더 초크포인트 전용이에요');
  assert.throws(()=>h.editor.syncQrText('https://example.com'),'QR 로 안 되는 문구는 코너처럼 던져요');
  assert.equal(h.editor.images.ZP.qr.text,'HTTPS://EXAMPLE.COM','던져도 상태는 그대로예요');
}));

test('문구가 QR 로 안 되면 면 버튼·fillQr 는 상태줄에 알리고 아무것도 바꾸지 않아요',()=>withDom(()=>{
  const h=makeEditor({qrText:()=>'https://example.com'});
  h.qr('ZP').click();assert.equal(h.editor.kindOf('ZP'),null);assert.equal(h.changes.length,0);
  assert.equal(h.status.textContent,hUiLabel('imageQrInvalid','ko'));
  assert.equal(h.editor.fillQr(['ZP','XP','YP']),0);assert.deepEqual(Object.keys(h.editor.images),[]);
}));

test('QR 면은 팔레트 기본 배경이 바뀌어도 그대로예요(흰 배경 고정)',()=>withDom(()=>{
  let palette='#ffffff';const h=makeEditor({palette:()=>palette});h.qr('ZP').click();
  const asset=h.editor.images.ZP;palette='#223344';h.editor.setDefaultBackground(palette);
  assert.equal(h.editor.images.ZP,asset);
}));

test('편집기 새 문구는 한국어·영어 둘 다 있어요',()=>{
  for(const key of ['imageQr','imageQrState','imageQrLocked','imageQrInvalid','imageQrFilled','imageQrAdded'])
    for(const lang of ['ko','en'])assert.notEqual(hUiLabel(key,lang),key,`${key}/${lang}`);
  assert.match(hUiLabel('imageQrFilled','ko'),/\{count\}/);assert.match(hUiLabel('imageQrAdded','en'),/\{face\}/);
});
