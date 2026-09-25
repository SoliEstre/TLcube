/** 페이지 수명 안에서만 보관하는 빈 면 이미지 편집기. 원본과 합성본을 분리해요. */
import {H_IMAGE_FACES,loadHFaceImage} from './h-face-images.js';
import {hImageTargets} from './h-face-arrangement.js';
import {hModeFaces} from './h-profile.js';
import {composeHFaceImage,normalizeHFaceImageSettings,hslToRgb,rgbToHsl,hexToRgb,rgbToHex} from './h-image-editor.js';
import {testHFaceImageFile} from './h-image-sample.js';
import {hExportIconMarkup} from './h-preview-decor.js';
import {H_FACE_TEXT_DEFAULT_FONT,H_FACE_TEXT_SYSTEM_FONTS,H_FACE_TEXT_WEB_FONTS,detectHFaceSystemFonts,ensureHFaceFontCss,filterHFaceFonts,hFaceFontById,hFaceTextColor,loadHFaceFont,renderHFaceText} from './h-face-text.js';
import {hFaceQrImage} from './h-face-qr.js';

export function createHImageEditor({container,status,text,onChange,getDefaultBackground=()=> '#ffffff',getQrText=()=>null}){
  const raws={},settings={},tokens={},cards=new Map(),timers=new Map(),backgroundEdited=new Set();
  // 텍스트 면: texts[face]={text,fontId} 가 있으면 raws 대신 textRaws(글자 raster)가 이미지 경로로 들어가요(운영자 2026-09-14).
  const texts={},textRaws={};let fontCatalog=null;
  // TL 스캐너 QR 면(운영자 2026-09-25): 네 번째 면 콘텐츠예요. 모든 QR 면이 같은 공유 자산(qrImage)을 써요.
  // 문구는 코너 QR 과 같은 getQrText() 이고, 렌더 초크포인트가 syncQrText 로 조용히 다시 맞춰요(onChange 를 타지 않아요).
  const qrs=new Set();let qrImage=null;
  function fonts(){
    if(fontCatalog)return fontCatalog;
    let ctx=null;try{ctx=document.createElement('canvas').getContext('2d');}catch{ctx=null;}
    let system;try{system=detectHFaceSystemFonts(H_FACE_TEXT_SYSTEM_FONTS,ctx);}catch{system=detectHFaceSystemFonts(H_FACE_TEXT_SYSTEM_FONTS,null);}
    return fontCatalog=[...system,...H_FACE_TEXT_WEB_FONTS];
  }
  const fontLabel=entry=>entry.labelKey?text(entry.labelKey):entry.label;
  const currentFont=face=>hFaceFontById(fonts(),texts[face]?.fontId)??fonts()[0];
  const fontFamilyCss=entry=>entry.generic?entry.family:entry.family.startsWith('"')?entry.family:`"${entry.family}"`;
  const rawOf=face=>qrs.has(face)?qrImage:texts[face]?textRaws[face]??null:raws[face]??null;
  /** 면 콘텐츠 종류 — 'qr' · 'text' · 'image' · null. 이미지 선택·텍스트 넣기·QR 넣기·제거가 서로를 지워 배타를 지켜요. */
  const kindOf=face=>qrs.has(face)?'qr':texts[face]?'text':raws[face]?'image':null;
  // 채울 수 있는 빈 면 — 이미지·글자가 없는 면이에요. 글자를 비운 텍스트 면도 들어가요(운영자 문구 «텍스트 설정 안 한 면»).
  const emptyFace=face=>!qrs.has(face)&&!raws[face]&&!(texts[face]&&textRaws[face]);
  let images=Object.freeze({});
  // The provider may be a live palette getter.  This cache is the color already
  // baked into canonical assets, so a palette change cannot be mistaken for a no-op.
  let appliedDefaultBackground=rgbToHex(hexToRgb(getDefaultBackground()));
  const node=(tag,cls)=>{const el=document.createElement(tag);if(cls)el.className=cls;return el;};
  const icon=name=>({contain:'<svg viewBox="0 0 24 16" class="h-fit-icon"><rect x="6" y="2" width="12" height="12" fill="none" stroke="currentColor"/><rect x="7" y="5.5" width="10" height="5" fill="currentColor"/><path d="M12 2.6v2.2m0 0-1.1-1.1m1.1 1.1 1.1-1.1M12 13.4v-2.2m0 0-1.1 1.1m1.1-1.1 1.1 1.1" fill="none" stroke="currentColor" stroke-width=".9"/></svg>',fill:'<svg viewBox="0 0 24 16" class="h-fit-icon"><rect x="6" y="2" width="12" height="12" fill="currentColor"/><path d="M12 3.6v8.8M12 3.6l-1.6 1.6M12 3.6l1.6 1.6M12 12.4l-1.6-1.6M12 12.4l1.6-1.6" fill="none" style="stroke:var(--panel,#fff)" stroke-width="1"/></svg>',cover:'<svg viewBox="0 0 24 16" class="h-fit-icon"><rect x="6" y="2" width="12" height="12" fill="none" stroke="currentColor"/><rect x="6.5" y="4.5" width="11" height="7" fill="currentColor"/><path d="M1.5 4.5h4.5M1.5 11.5h4.5M18 4.5h4.5M18 11.5h4.5" fill="none" stroke="currentColor" stroke-dasharray="1.2 .9" stroke-width=".8"/><path d="M5 8H1.5m0 0 1.1-1.1M1.5 8l1.1 1.1M19 8h3.5m0 0-1.1-1.1m1.1 1.1-1.1 1.1" fill="none" stroke="currentColor" stroke-width=".9"/></svg>',add:'<svg viewBox="0 0 16 16"><path d="M2 3h12v10H2z" fill="none" stroke="currentColor"/><path d="M8 5v6M5 8h6" stroke="currentColor"/></svg>',trash:'<svg viewBox="0 0 16 16"><path d="M5 5v8h6V5M4 4h8M6 2h4" fill="none" stroke="currentColor"/></svg>',reset:'<svg viewBox="0 0 16 16"><path d="M13 7a5 5 0 1 1-1.4-3.5M13 2v5H8" fill="none" stroke="currentColor"/></svg>'})[name];
  const defaultBackground=()=>appliedDefaultBackground;
  const setting=face=>settings[face]??normalizeHFaceImageSettings({background:defaultBackground()});
  /** 정본 에셋 하나 — content 태그('image'|'text'|'qr'|'fill')를 달아 index 쪽 파생(요약·평면 판정·보고)이 에셋만 읽게 해요. */
  function assetOf(face){
    // QR 면은 합성기와 면 설정(회전·맞춤·배경)을 우회해요 — 남은 45° 같은 옛 값이 파인더를 자르지 않게요. 정수 피치라 합성해도 항등이에요.
    if(qrs.has(face))return qrImage;
    const config=setting(face);
    // 글자색은 배경색 대비로 고르니 배경이 바뀌면 여기서 다시 그려요.
    if(texts[face])textRaws[face]=renderHFaceText({text:texts[face].text,font:currentFont(face),color:hFaceTextColor(config.background)});
    const raw=rawOf(face);
    // Unedited empty slots retain the cube palette rather than a synthetic white texture.
    if(!raw&&!backgroundEdited.has(face))return null;
    return Object.freeze({...composeHFaceImage(raw??null,{...config,size:raw?Math.max(256,Math.min(1024,Math.max(raw.width,raw.height))):256}),content:raw?(texts[face]?'text':'image'):'fill'});
  }
  /** 여러 면을 한 번에 바꿔도 onChange 는 한 번이에요(일괄 QR 채우기·걷기). */
  function commitMany(faces){
    const next={...images};
    for(const face of faces){clearTimeout(timers.get(face));timers.delete(face);const asset=assetOf(face);if(asset)next[face]=asset;else delete next[face];}
    images=Object.freeze(next);onChange(images);for(const face of faces)refresh(face);
  }
  function commit(face){commitMany([face]);}
  /** 현재 문구의 QR 자산. 문구가 QR 로 안 되면(고급 QR URL 오류) 상태줄에 알리고 null 이에요 — 상태는 바꾸지 않아요. */
  function qrAssetNow(){
    try{return hFaceQrImage(getQrText());}catch{status.textContent=text('imageQrInvalid');return null;}
  }
  /** 면들에 QR 을 넣어요. 대기 중인 이미지 로드는 취소하고 이미지·텍스트를 지워요. 문구가 바뀌었으면 기존 QR 면도 같이 갈아 끼워요. */
  function putQr(faces){
    const image=qrAssetNow();if(!image)return 0;
    const changed=image!==qrImage,touched=new Set(faces);qrImage=image;
    for(const face of faces){
      tokens[face]=(tokens[face]??0)+1;delete raws[face];delete texts[face];delete textRaws[face];qrs.add(face);
      const card=cards.get(face);if(card){card.textarea.value='';card.closeList();}
    }
    if(changed)for(const face of qrs)touched.add(face);
    if(touched.size)commitMany([...touched]);
    return faces.length;
  }
  function edit(face,delta,{defer=false}={}){
    if(Object.hasOwn(delta,'background'))backgroundEdited.add(face);
    settings[face]=normalizeHFaceImageSettings({...setting(face),...delta});
    refresh(face);
    if(defer){clearTimeout(timers.get(face));timers.set(face,setTimeout(()=>commit(face),100));}
    else commit(face);
  }
  async function load(face,file){
    const token=tokens[face]=(tokens[face]??0)+1;status.textContent=text('imageBusy');
    try{
      const raw=await loadHFaceImage(file);if(tokens[face]!==token)return;
      raws[face]=raw;delete texts[face];delete textRaws[face];qrs.delete(face);commit(face);status.textContent='';
    }catch(error){if(tokens[face]===token)status.textContent=String(error?.message??error);}
  }
  function refresh(face){
    const card=cards.get(face);if(!card)return;
    const {label,preview,qrToggle,sample,size,remove,rotate,fitButtons,pad,cursor,brightness,inputs,reset,choose,textToggle,textRow,textarea,fontInput,fontOpen}=card;
    const isQr=qrs.has(face),locked=[reset,...rotate,...fitButtons];
    // 언어 전환 시 텍스트 모드 문구도 같이 바뀌어요(data-h-label 이 없는 placeholder/title).
    textarea.placeholder=text('imageTextPlaceholder');fontInput.placeholder=text('imageFontSearch');fontOpen.title=text('imageFontOpen');fontOpen.setAttribute('aria-label',fontOpen.title);
    // QR 면은 인식을 위해 회전·맞춤·배경을 잠가요 — 잠긴 이유를 title 에 같이 적어요.
    for(const control of [reset,choose,remove,...rotate,...fitButtons])if(control.dataset.hTitle){const name=text(control.dataset.hTitle);control.title=isQr&&locked.includes(control)?`${name} — ${text('imageQrLocked')}`:name;control.setAttribute('aria-label',name);}
    qrToggle.setAttribute('aria-label',`${label.textContent} ${text('imageQr')}`);
    const raw=rawOf(face),config=setting(face),asset=images[face],textMode=!!texts[face];
    preview.hidden=!raw;qrToggle.hidden=!!raw||textMode;sample.hidden=!!raw||textMode;textToggle.hidden=!!raw||textMode;textRow.hidden=!textMode;
    if(raw&&asset&&preview.getAttribute('src')!==asset.href)preview.src=asset.href;
    if(!raw)preview.removeAttribute('src');
    if(isQr)preview.title=qrImage.qr.text;else preview.removeAttribute('title');
    size.textContent=isQr?text('imageQrState'):raw?(textMode?`${fontLabel(currentFont(face))} · ${raw.fontSize}px · ${config.rotation}°`:`${raw.width} × ${raw.height} · ${config.rotation}°`):text(textMode?'imageTextEmpty':'imageEmpty');
    remove.disabled=!raw&&!textMode;for(const button of rotate)button.disabled=!raw||isQr;
    reset.disabled=isQr;
    // QR 면은 합성기를 우회해 늘 «맞추기 · 흰 배경» 으로 그려져요 — 잠긴 컨트롤도 그려진 값을 보여요.
    // 저장된 면 설정(settings[face])은 건드리지 않아서 [제거] 뒤에는 원래 맞춤·배경이 다시 보여요.
    const shown=isQr?{fit:'contain',background:'#ffffff'}:config;
    for(const button of fitButtons){const on=button.dataset.fit===shown.fit;button.disabled=isQr;button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on));}
    for(const control of locked)control.setAttribute('aria-disabled',String(control.disabled));
    pad.tabIndex=isQr?-1:0;pad.setAttribute('aria-disabled',String(isQr));pad.title=isQr?text('imageQrLocked'):'';brightness.disabled=isQr;
    for(const input of Object.values(inputs))input.disabled=isQr;
    const rgb=hexToRgb(shown.background),hsl=rgbToHsl(rgb);
    // Keep a user's hue while saturation or lightness is zero.
    const retained={...(card.hsl??hsl)};
    if(hsl.l>0&&hsl.l<100){if(hsl.s>0)retained.h=hsl.h;retained.s=hsl.s;}
    // QR 면의 흰색 표시는 사용자가 고른 색상이 아니라 card.hsl(패드가 기억하는 색상)에 남기지 않아요.
    retained.l=hsl.l;if(!isQr)card.hsl=retained;
    // Hue/saturation stay visible even when the selected final lightness is white/black.
    pad.style.setProperty('--color-lightness','50%');
    cursor.style.left=`${retained.h/360*100}%`;cursor.style.top=`${100-retained.s}%`;
    brightness.value=String(Math.round(hsl.l));brightness.style.background=`linear-gradient(to right,#000,hsl(${retained.h} ${retained.s}% 50%),#fff)`;
    const values={hex:shown.background,...rgb,h:Math.round(retained.h),s:Math.round(retained.s),l:Math.round(hsl.l)};
    for(const [key,input]of Object.entries(inputs))if(document.activeElement!==input)input.value=String(values[key]);
  }
  function colorFromHsl(face,hsl,defer=false){cards.get(face).hsl={...hsl};edit(face,{background:rgbToHex(hslToRgb(hsl))},{defer});}
  for(const face of H_IMAGE_FACES){
    const card=node('div','h-image-card');card.id=`hFaceImage-${face}`;
    const header=node('div','h-image-header'),label=node('strong'),actions=node('div','h-image-actions'),reset=node('button','y3d-btn');label.textContent=face;
    const rotate=[-45,45].map(angle=>{
      const button=node('button','y3d-btn');button.type='button';button.dataset.rotate=String(angle);
      button.innerHTML=hExportIconMarkup(angle<0?'rotateLeft':'rotateRight');button.dataset.hTitle=angle<0?'imageRotateLeft':'imageRotateRight';button.title=text(button.dataset.hTitle);button.setAttribute('aria-label',button.title);
      button.addEventListener('click',()=>edit(face,{rotation:setting(face).rotation+angle}));actions.append(button);return button;
    });reset.type='button';reset.dataset.hTitle='imageBackgroundReset';reset.innerHTML=icon('reset');reset.title=text(reset.dataset.hTitle);reset.setAttribute('aria-label',reset.title);reset.addEventListener('click',()=>{backgroundEdited.delete(face);settings[face]=normalizeHFaceImageSettings({...setting(face),background:defaultBackground()});commit(face);});header.append(label,actions,reset);
    const body=node('div','h-image-body'),left=node('div','h-image-left'),right=node('div','h-image-color');
    const well=node('div','h-image-well'),preview=node('img'),sample=node('button','y3d-btn h-image-sample');preview.alt=face;
    sample.type='button';sample.dataset.hLabel='imageSample';sample.textContent=text('imageSample');sample.addEventListener('click',()=>load(face,testHFaceImageFile()));
    // «TL 스캐너 QR 넣기» — 미리보기 영역 버튼들의 맨 위(운영자 2026-09-25). 토글이 아니라 넣기 동작이고, 끄기는 형제처럼 [제거]예요.
    const qrToggle=node('button','y3d-btn h-image-sample h-image-qr-toggle');qrToggle.type='button';qrToggle.dataset.hLabel='imageQr';qrToggle.textContent=text('imageQr');
    qrToggle.addEventListener('click',()=>{if(!putQr([face]))return;cards.get(face).remove.focus?.();status.textContent=text('imageQrAdded').replace('{face}',cards.get(face).label.textContent);});
    well.append(preview,qrToggle,sample);
    // «텍스트 넣기» — 테스트 이미지 아래. 누르면 이 면은 텍스트 모드(입력란 + 폰트 콤보)가 되고 글자 raster 가 이미지 자리로 들어가요.
    const textToggle=node('button','y3d-btn h-image-sample h-image-text-toggle');textToggle.type='button';textToggle.dataset.hLabel='imageText';textToggle.textContent=text('imageText');well.append(textToggle);
    const textRow=node('div','h-image-text-row');textRow.hidden=true;
    const textarea=node('textarea','h-image-text-input');textarea.rows=2;textarea.placeholder=text('imageTextPlaceholder');textarea.setAttribute('aria-label',`${face} ${text('imageText')}`);
    const combo=node('div','h-font-combo'),fontInput=node('input','h-font-input'),fontOpen=node('button','y3d-btn h-font-open'),fontList=node('ul','h-font-list');
    fontInput.type='search';fontInput.placeholder=text('imageFontSearch');fontInput.autocomplete='off';fontInput.setAttribute('role','combobox');fontInput.setAttribute('aria-expanded','false');fontInput.setAttribute('aria-label',`${face} ${text('imageFont')}`);
    fontOpen.type='button';fontOpen.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 5.8 8 10.6l4.8-4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';fontOpen.title=text('imageFontOpen');fontOpen.setAttribute('aria-label',fontOpen.title);
    fontList.hidden=true;fontList.setAttribute('role','listbox');
    combo.append(fontInput,fontOpen,fontList);textRow.append(textarea,combo);
    let textTimer=0;
    const applyText=()=>{
      const entry=texts[face];if(!entry)return;entry.text=textarea.value;
      const font=currentFont(face),render=()=>{if(texts[face]===entry)commit(face);};
      // 웹폰트는 그릴 글자 조각까지 받은 뒤 그려요(Google 시트는 unicode-range 분할). 실패해도 대체 폰트로 그려요.
      if(font.css)loadHFaceFont(font,entry.text).then(render,render);else render();
    };
    textarea.addEventListener('input',()=>{clearTimeout(textTimer);textTimer=setTimeout(applyText,150);});
    const closeList=()=>{fontList.hidden=true;fontInput.setAttribute('aria-expanded','false');};
    const selectFont=entry=>{const t=texts[face];if(!t)return;t.fontId=entry.id;fontInput.value=fontLabel(entry);closeList();applyText();};
    // 목록은 화살표 버튼(전체) 또는 검색 입력(좁힌 결과)으로만 열려요. 열 때 웹폰트 시트를 붙여 항목이 제 폰트로 보여요.
    const openList=query=>{
      const entries=filterHFaceFonts(fonts(),query);fontList.textContent='';
      if(!entries.length){const none=node('li','h-font-group');none.textContent=text('imageFontNone');fontList.append(none);}
      let group='';
      for(const entry of entries){
        const kind=entry.css?'web':'system';
        if(kind!==group){group=kind;const head=node('li','h-font-group');head.textContent=text(kind==='web'?'imageFontWeb':'imageFontSystem');fontList.append(head);}
        if(entry.css)ensureHFaceFontCss(entry);
        const item=node('li','h-font-option');item.setAttribute('role','option');item.dataset.fontId=entry.id;item.textContent=fontLabel(entry);item.style.fontFamily=fontFamilyCss(entry);
        item.setAttribute('aria-selected',String(texts[face]?.fontId===entry.id));
        item.addEventListener('pointerdown',event=>event.preventDefault?.());item.addEventListener('click',()=>selectFont(entry));
        fontList.append(item);
      }
      fontList.hidden=false;fontInput.setAttribute('aria-expanded','true');
    };
    fontOpen.addEventListener('click',()=>{if(fontList.hidden)openList('');else closeList();});
    fontInput.addEventListener('input',()=>openList(fontInput.value));
    fontInput.addEventListener('keydown',event=>{
      if(event.key==='Escape'){closeList();return;}
      if(event.key==='Enter'){event.preventDefault?.();const first=filterHFaceFonts(fonts(),fontInput.value).find(entry=>entry)??null;if(first)selectFont(first);return;}
      if(event.key==='ArrowDown'&&fontList.hidden)openList(fontInput.value);
    });
    fontInput.addEventListener('blur',()=>{setTimeout(()=>{if(!(combo.contains?.(document.activeElement)))closeList();},120);if(texts[face])fontInput.value=fontLabel(currentFont(face));});
    textToggle.addEventListener('click',()=>{texts[face]={text:'',fontId:H_FACE_TEXT_DEFAULT_FONT};delete raws[face];delete textRaws[face];qrs.delete(face);textarea.value='';fontInput.value=fontLabel(currentFont(face));commit(face);textarea.focus?.();});
    const sizeRow=node('div','h-image-size-row'),size=node('span','hint'),fitGroup=node('div','h-image-fit');
    const fitButtons=['contain','fill','cover'].map(fit=>{
      const button=node('button','y3d-btn');button.type='button';button.dataset.fit=fit;button.dataset.hTitle=`imageFit${fit}`;button.innerHTML=icon(fit);button.title=text(`imageFit${fit}`);button.setAttribute('aria-label',button.title);button.addEventListener('click',()=>edit(face,{fit}));fitGroup.append(button);return button;
    });sizeRow.append(size,fitGroup);
    const input=node('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/svg+xml,.svg';input.hidden=true;input.setAttribute('aria-label',`${face} ${text('imageChoose')}`);
    const choose=node('button','y3d-btn'),remove=node('button','y3d-btn');choose.type=remove.type='button';choose.dataset.hLabel='imageChoose';choose.textContent=text('imageChoose');remove.dataset.hLabel='imageRemove';remove.textContent=text('imageRemove');
    choose.removeAttribute('data-h-label');remove.removeAttribute('data-h-label');choose.dataset.hTitle='imageChoose';remove.dataset.hTitle='imageRemove';choose.innerHTML=icon('add');remove.innerHTML=icon('trash');
    // 아이콘만으로는 구분이 어려워요(운영자 2026-09-14) — 짧은 캡션을 같이 둬요. 전체 문구는 title/aria 에 그대로예요.
    for(const [button,key] of [[choose,'imageChooseShort'],[remove,'imageRemoveShort']]){const caption=node('span','h-image-caption');caption.dataset.hLabel=key;caption.textContent=text(key);button.append(caption);}choose.title=text('imageChoose');remove.title=text('imageRemove');choose.setAttribute('aria-label',choose.title);remove.setAttribute('aria-label',remove.title);choose.addEventListener('click',()=>input.click());input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';if(file)load(face,file);});
    remove.addEventListener('click',()=>{tokens[face]=(tokens[face]??0)+1;delete raws[face];delete texts[face];delete textRaws[face];qrs.delete(face);textarea.value='';closeList();commit(face);});
    const chooseRow=node('div','h-image-actions');chooseRow.append(choose,remove);left.append(well,textRow,sizeRow,chooseRow,input);
    const colorLabel=node('label','hint');colorLabel.dataset.hLabel='imageBackground';colorLabel.textContent=text('imageBackground');
    const pad=node('div','h-color-pad');pad.tabIndex=0;pad.setAttribute('role','group');pad.setAttribute('aria-label',`${face} ${text('imageColorPad')}`);
    const cursor=node('span','h-color-cursor');pad.append(cursor);
    const brightness=node('input','h-color-brightness');brightness.type='range';brightness.min='0';brightness.max='100';brightness.step='1';brightness.setAttribute('aria-label',`${face} ${text('imageLightness')}`);
    const fields=node('div','h-color-fields'),inputs={};
    for(const key of ['hex','r','g','b','h','s','l']){
      const wrap=node('label'),caption=node('span');caption.textContent=key.toUpperCase();const entry=node('input');entry.type=key==='hex'?'text':'number';entry.setAttribute('aria-label',`${face} ${key.toUpperCase()}`);
      if(key==='hex'){entry.maxLength=7;wrap.className='h-color-hex';}else{entry.min='0';entry.max=key==='h'?'360':['s','l'].includes(key)?'100':'255';entry.step='1';}
      const applyColor=defer=>{
        if(key==='hex')edit(face,{background:rgbToHex(hexToRgb(entry.value))},{defer});
        else if(['r','g','b'].includes(key)){const rgb={...hexToRgb(setting(face).background)};rgb[key]=Number(entry.value);edit(face,{background:rgbToHex(rgb)},{defer});}
        else colorFromHsl(face,{...cards.get(face).hsl,[key]:Number(entry.value)},defer);
      };
      entry.addEventListener('input',()=>{
        // A completed value must enter state before another control refreshes the card.
        // Incomplete typing is allowed; commit validation belongs to change/blur.
        const valid=key==='hex'?/^#[0-9a-f]{6}$/i.test(entry.value):entry.value.trim()!==''&&Number.isFinite(Number(entry.value));
        if(!valid)return;
        try{applyColor(true);entry.setCustomValidity('');}catch{ /* keep incomplete input editable */ }
      });
      entry.addEventListener('change',()=>{
        try{
          if(entry.value.trim()==='')throw new RangeError('Empty color');
          applyColor(false);
          entry.setCustomValidity('');entry.value=key==='hex'?setting(face).background:String(Math.max(0,Math.min(Number(entry.max),Number(entry.value))));
        }catch{entry.setCustomValidity(text('imageColorInvalid'));entry.reportValidity();}
      });inputs[key]=entry;wrap.append(caption,entry);fields.append(wrap);
    }
    let drag=false;
    const pick=event=>{const rect=pad.getBoundingClientRect();const h=Math.max(0,Math.min(360,(event.clientX-rect.left)/rect.width*360)),s=Math.max(0,Math.min(100,100-(event.clientY-rect.top)/rect.height*100));colorFromHsl(face,{h,s,l:cards.get(face).hsl.l},true);};
    // QR 면의 색 패드는 잠겨 있어요(흰 배경 고정) — 포인터·키 입력을 받지 않아요.
    pad.addEventListener('pointerdown',event=>{if(qrs.has(face))return;drag=true;pad.setPointerCapture(event.pointerId);pick(event);});pad.addEventListener('pointermove',event=>{if(drag&&!qrs.has(face))pick(event);});
    pad.addEventListener('pointerup',()=>{drag=false;if(!qrs.has(face))commit(face);});pad.addEventListener('pointercancel',()=>{drag=false;if(!qrs.has(face))commit(face);});
    pad.addEventListener('keydown',event=>{const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];if(!delta||qrs.has(face))return;event.preventDefault();const hsl=cards.get(face).hsl;colorFromHsl(face,{h:Math.max(0,Math.min(360,hsl.h+delta[0])),s:Math.max(0,Math.min(100,hsl.s+delta[1])),l:hsl.l});});
    brightness.addEventListener('input',()=>colorFromHsl(face,{...cards.get(face).hsl,l:Number(brightness.value)},true));brightness.addEventListener('change',()=>commit(face));
    right.append(colorLabel,pad,brightness,fields);body.append(left,right);card.append(header,body);container.append(card);
    cards.set(face,{card,label,preview,qrToggle,sample,size,remove,rotate,fitButtons,pad,cursor,brightness,inputs,reset,choose,textToggle,textRow,textarea,fontInput,fontOpen,closeList,hsl:{h:0,s:0,l:100}});refresh(face);
  }
  return {
    sync(state){
      const mode=state.hFaces,targets=hImageTargets({mode,faces:Object.fromEntries(hModeFaces(mode).map(face=>[face,true]))},{arrangement:state.hArrangement,renderFaces:state.hRenderFaces});
      for(const [face,row]of cards){const target=targets.find(t=>t.face===face);row.card.hidden=!target;row.aliases=target?target.aliases:[face];row.label.textContent=row.aliases.join(' / ');refresh(face);}
      return targets.length;
    },
    flush(){for(const face of [...timers.keys()])commit(face);},
    // 이미지·텍스트 면만 다시 합성해요. 텍스트 면도 배경·글자색이 팔레트를 따라요(종전엔 이미지 면만 다시 그려 텍스트 면이 옛 배경으로 남았어요).
    // QR 면은 흰 배경 고정이라 건너뛰어요.
    setDefaultBackground(color){const next=rgbToHex(hexToRgb(color));if(next===appliedDefaultBackground)return;appliedDefaultBackground=next;const dirty=[];for(const face of H_IMAGE_FACES)if(!backgroundEdited.has(face)){if(settings[face])settings[face]=normalizeHFaceImageSettings({...settings[face],background:next});if(['image','text'].includes(kindOf(face)))dirty.push(face);else refresh(face);}if(dirty.length)commitMany(dirty);},
    kindOf,
    /** «안쪽» 카드: 주어진 대상 중 빈 면에만 QR 을 한 번 넣어요(멱등). 넣은 대상(편집기 카드) 수를 돌려주고 onChange 는 한 번이에요.
     *  나중에 생긴 빈 면은 자동으로 채우지 않아요. 상태줄은 실제로 QR 이 그려지는 물리 면 수(별칭 포함)를 알려요 —
     *  1·2면 6면 렌더에서는 카드 하나(ZM / ZP)가 마주보는 두 면에 같이 그려져요. */
    fillQr(faces){
      const empty=[...new Set(faces)].filter(face=>cards.has(face)&&emptyFace(face));if(!empty.length)return 0;
      const count=putQr(empty),drawn=empty.reduce((sum,face)=>sum+(cards.get(face).aliases?.length||1),0);
      if(count)status.textContent=text('imageQrFilled').replace('{count}',String(drawn));
      return count;
    },
    /** 코너·없음 카드: 숨은 슬롯까지 QR 면을 전부 걷어요(나중에 되살아나지 않게). 걷은 면 수를 돌려줘요. */
    clearQr(){const faces=[...qrs];if(!faces.length)return 0;qrs.clear();commitMany(faces);return faces.length;},
    /** 렌더 초크포인트 전용 — 문구가 바뀌었을 때만 QR 면 에셋을 새 공유 자산으로 갈아 끼워요. onChange 를 부르지 않아요.
     *  QR 면이 없으면 아무것도 하지 않고, 문구가 QR 로 안 되면 코너 QR 과 같이 던져 렌더 오류 표시로 가요. */
    syncQrText(nextText){
      if(!qrs.size||qrImage?.qr.text===nextText)return images;
      qrImage=hFaceQrImage(nextText);
      const next={...images};for(const face of qrs)next[face]=qrImage;
      images=Object.freeze(next);for(const face of qrs)refresh(face);
      return images;
    },
    get images(){return images;},
  };
}
