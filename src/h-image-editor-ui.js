/** 페이지 수명 안에서만 보관하는 빈 면 이미지 편집기. 원본과 합성본을 분리해요. */
import {H_IMAGE_FACES,loadHFaceImage} from './h-face-images.js';
import {hImageTargets} from './h-face-arrangement.js';
import {hModeFaces} from './h-profile.js';
import {composeHFaceImage,normalizeHFaceImageSettings,hslToRgb,rgbToHsl,hexToRgb,rgbToHex} from './h-image-editor.js';
import {testHFaceImageFile} from './h-image-sample.js';
import {hExportIconMarkup} from './h-preview-decor.js';

export function createHImageEditor({container,status,text,onChange,getDefaultBackground=()=> '#ffffff'}){
  const raws={},settings={},tokens={},cards=new Map(),timers=new Map(),backgroundEdited=new Set();
  let images=Object.freeze({});
  // The provider may be a live palette getter.  This cache is the color already
  // baked into canonical assets, so a palette change cannot be mistaken for a no-op.
  let appliedDefaultBackground=rgbToHex(hexToRgb(getDefaultBackground()));
  const node=(tag,cls)=>{const el=document.createElement(tag);if(cls)el.className=cls;return el;};
  const icon=name=>({contain:'<svg viewBox="0 0 24 16" class="h-fit-icon"><rect x="6" y="2" width="12" height="12" fill="none" stroke="currentColor"/><rect x="7" y="5.5" width="10" height="5" fill="currentColor"/><path d="M12 2.6v2.2m0 0-1.1-1.1m1.1 1.1 1.1-1.1M12 13.4v-2.2m0 0-1.1 1.1m1.1-1.1 1.1 1.1" fill="none" stroke="currentColor" stroke-width=".9"/></svg>',fill:'<svg viewBox="0 0 24 16" class="h-fit-icon"><rect x="6" y="2" width="12" height="12" fill="currentColor"/><path d="M12 3.6v8.8M12 3.6l-1.6 1.6M12 3.6l1.6 1.6M12 12.4l-1.6-1.6M12 12.4l1.6-1.6" fill="none" style="stroke:var(--panel,#fff)" stroke-width="1"/></svg>',cover:'<svg viewBox="0 0 24 16" class="h-fit-icon"><rect x="6" y="2" width="12" height="12" fill="none" stroke="currentColor"/><rect x="6.5" y="4.5" width="11" height="7" fill="currentColor"/><path d="M1.5 4.5h4.5M1.5 11.5h4.5M18 4.5h4.5M18 11.5h4.5" fill="none" stroke="currentColor" stroke-dasharray="1.2 .9" stroke-width=".8"/><path d="M5 8H1.5m0 0 1.1-1.1M1.5 8l1.1 1.1M19 8h3.5m0 0-1.1-1.1m1.1 1.1-1.1 1.1" fill="none" stroke="currentColor" stroke-width=".9"/></svg>',add:'<svg viewBox="0 0 16 16"><path d="M2 3h12v10H2z" fill="none" stroke="currentColor"/><path d="M8 5v6M5 8h6" stroke="currentColor"/></svg>',trash:'<svg viewBox="0 0 16 16"><path d="M5 5v8h6V5M4 4h8M6 2h4" fill="none" stroke="currentColor"/></svg>',reset:'<svg viewBox="0 0 16 16"><path d="M13 7a5 5 0 1 1-1.4-3.5M13 2v5H8" fill="none" stroke="currentColor"/></svg>'})[name];
  const defaultBackground=()=>appliedDefaultBackground;
  const setting=face=>settings[face]??normalizeHFaceImageSettings({background:defaultBackground()});
  function commit(face){
    clearTimeout(timers.get(face));timers.delete(face);
    const next={...images},config=setting(face),raw=raws[face];
    // Unedited empty slots retain the cube palette rather than a synthetic white texture.
    if(!raw&&!backgroundEdited.has(face))delete next[face];
    else next[face]=composeHFaceImage(raw??null,{...config,size:raw?Math.max(256,Math.min(1024,Math.max(raw.width,raw.height))):256});
    images=Object.freeze(next);onChange(images);refresh(face);
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
      raws[face]=raw;commit(face);status.textContent='';
    }catch(error){if(tokens[face]===token)status.textContent=String(error?.message??error);}
  }
  function refresh(face){
    const card=cards.get(face);if(!card)return;
    const {preview,sample,size,remove,rotate,fitButtons,pad,cursor,brightness,inputs,reset,choose}=card;
    for(const control of [reset,choose,remove,...rotate,...fitButtons])if(control.dataset.hTitle){const label=text(control.dataset.hTitle);control.title=label;control.setAttribute('aria-label',label);}
    const raw=raws[face],config=setting(face),asset=images[face];
    preview.hidden=!raw;sample.hidden=!!raw;
    if(raw&&asset&&preview.getAttribute('src')!==asset.href)preview.src=asset.href;
    if(!raw)preview.removeAttribute('src');
    size.textContent=raw?`${raw.width} × ${raw.height} · ${config.rotation}°`:text('imageEmpty');
    remove.disabled=!raw;for(const button of rotate)button.disabled=!raw;
    for(const button of fitButtons){const on=button.dataset.fit===config.fit;button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on));}
    const rgb=hexToRgb(config.background),hsl=rgbToHsl(rgb);
    // Keep a user's hue while saturation or lightness is zero.
    const retained={...(card.hsl??hsl)};
    if(hsl.l>0&&hsl.l<100){if(hsl.s>0)retained.h=hsl.h;retained.s=hsl.s;}
    retained.l=hsl.l;card.hsl=retained;
    // Hue/saturation stay visible even when the selected final lightness is white/black.
    pad.style.setProperty('--color-lightness','50%');
    cursor.style.left=`${retained.h/360*100}%`;cursor.style.top=`${100-retained.s}%`;
    brightness.value=String(Math.round(hsl.l));brightness.style.background=`linear-gradient(to right,#000,hsl(${retained.h} ${retained.s}% 50%),#fff)`;
    const values={hex:config.background,...rgb,h:Math.round(retained.h),s:Math.round(retained.s),l:Math.round(hsl.l)};
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
    sample.type='button';sample.dataset.hLabel='imageSample';sample.textContent=text('imageSample');sample.addEventListener('click',()=>load(face,testHFaceImageFile()));well.append(preview,sample);
    const sizeRow=node('div','h-image-size-row'),size=node('span','hint'),fitGroup=node('div','h-image-fit');
    const fitButtons=['contain','fill','cover'].map(fit=>{
      const button=node('button','y3d-btn');button.type='button';button.dataset.fit=fit;button.dataset.hTitle=`imageFit${fit}`;button.innerHTML=icon(fit);button.title=text(`imageFit${fit}`);button.setAttribute('aria-label',button.title);button.addEventListener('click',()=>edit(face,{fit}));fitGroup.append(button);return button;
    });sizeRow.append(size,fitGroup);
    const input=node('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/svg+xml,.svg';input.hidden=true;input.setAttribute('aria-label',`${face} ${text('imageChoose')}`);
    const choose=node('button','y3d-btn'),remove=node('button','y3d-btn');choose.type=remove.type='button';choose.dataset.hLabel='imageChoose';choose.textContent=text('imageChoose');remove.dataset.hLabel='imageRemove';remove.textContent=text('imageRemove');
    choose.removeAttribute('data-h-label');remove.removeAttribute('data-h-label');choose.dataset.hTitle='imageChoose';remove.dataset.hTitle='imageRemove';choose.innerHTML=icon('add');remove.innerHTML=icon('trash');
    // 아이콘만으로는 구분이 어려워요(운영자 2026-09-14) — 짧은 캡션을 같이 둬요. 전체 문구는 title/aria 에 그대로예요.
    for(const [button,key] of [[choose,'imageChooseShort'],[remove,'imageRemoveShort']]){const caption=node('span','h-image-caption');caption.dataset.hLabel=key;caption.textContent=text(key);button.append(caption);}choose.title=text('imageChoose');remove.title=text('imageRemove');choose.setAttribute('aria-label',choose.title);remove.setAttribute('aria-label',remove.title);choose.addEventListener('click',()=>input.click());input.addEventListener('change',()=>{const file=input.files?.[0];input.value='';if(file)load(face,file);});
    remove.addEventListener('click',()=>{tokens[face]=(tokens[face]??0)+1;delete raws[face];commit(face);});
    const chooseRow=node('div','h-image-actions');chooseRow.append(choose,remove);left.append(well,sizeRow,chooseRow,input);
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
    pad.addEventListener('pointerdown',event=>{drag=true;pad.setPointerCapture(event.pointerId);pick(event);});pad.addEventListener('pointermove',event=>{if(drag)pick(event);});
    pad.addEventListener('pointerup',()=>{drag=false;commit(face);});pad.addEventListener('pointercancel',()=>{drag=false;commit(face);});
    pad.addEventListener('keydown',event=>{const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];if(!delta)return;event.preventDefault();const hsl=cards.get(face).hsl;colorFromHsl(face,{h:Math.max(0,Math.min(360,hsl.h+delta[0])),s:Math.max(0,Math.min(100,hsl.s+delta[1])),l:hsl.l});});
    brightness.addEventListener('input',()=>colorFromHsl(face,{...cards.get(face).hsl,l:Number(brightness.value)},true));brightness.addEventListener('change',()=>commit(face));
    right.append(colorLabel,pad,brightness,fields);body.append(left,right);card.append(header,body);container.append(card);
    cards.set(face,{card,label,preview,sample,size,remove,rotate,fitButtons,pad,cursor,brightness,inputs,reset,choose,hsl:{h:0,s:0,l:100}});refresh(face);
  }
  return {
    sync(state){
      const mode=state.hFaces,targets=hImageTargets({mode,faces:Object.fromEntries(hModeFaces(mode).map(face=>[face,true]))},{arrangement:state.hArrangement,renderFaces:state.hRenderFaces});
      for(const [face,row]of cards){const target=targets.find(t=>t.face===face);row.card.hidden=!target;row.label.textContent=target?target.aliases.join(' / '):face;refresh(face);}
      return targets.length;
    },
    flush(){for(const face of [...timers.keys()])commit(face);},
    setDefaultBackground(color){const next=rgbToHex(hexToRgb(color));if(next===appliedDefaultBackground)return;appliedDefaultBackground=next;for(const face of H_IMAGE_FACES)if(!backgroundEdited.has(face)){if(settings[face])settings[face]=normalizeHFaceImageSettings({...settings[face],background:next});if(raws[face])commit(face);else refresh(face);}},
    get images(){return images;},
  };
}
