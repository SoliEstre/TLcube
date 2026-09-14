/** 빈 면 텍스트 — 글자를 면 raster 로 만들어 이미지 경로(맞추기·회전·배경색·전개도·glTF·영상)에 그대로 태워요.
 *  운영자 2026-09-14: 테스트 이미지 아래 «텍스트 넣기» · 가운데 정렬 · 여백을 뺀 최대 크기 · 폰트 검색 콤보 · 웹폰트는 CDN 에서 고를 때 받아요.
 *  순수 계산(줄 나누기·크기·대비·검색·카탈로그)은 DOM 없이 돌고, raster·폰트 적재만 브라우저를 써요. */

export const H_FACE_TEXT_SIZE=1024;          // raster 한 변(px) — 이미지 경로의 최대 변과 같아요
export const H_FACE_TEXT_MARGIN=.08;         // 면 한 변 대비 바깥 여백(각 변)
export const H_FACE_TEXT_LINE_HEIGHT=1.2;    // 줄 간격(글자 크기 배수)
export const H_FACE_TEXT_REFERENCE_PX=100;   // 폭 측정 기준 글자 크기 — 폭은 글자 크기에 선형이라 한 번만 재요
export const H_FACE_TEXT_DEFAULT_FONT='sys-sans';

/** 허용 CDN host — 카탈로그 자(test/h-face-text.test.js)가 이 둘 밖의 host 를 막아요. */
export const H_FACE_TEXT_FONT_HOSTS=Object.freeze(['fonts.googleapis.com','cdn.jsdelivr.net']);

/** 웹폰트 카탈로그 — css 는 @font-face 시트, family 는 그 시트가 선언한 이름 그대로예요(2026-09-14 curl 로 확인). weights 는 시트가 제공하는 굵기. */
export const H_FACE_TEXT_WEB_FONTS=Object.freeze([
  {id:'noto-sans-kr',label:'Noto Sans KR',family:'Noto Sans KR',weights:[400,700],keywords:['노토 산스','noto'],css:'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap'},
  {id:'pretendard',label:'Pretendard',family:'Pretendard',weights:[400,700],keywords:['프리텐다드'],css:'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css'},
  {id:'suit',label:'SUIT',family:'SUIT',weights:[400,700],keywords:['수트'],css:'https://cdn.jsdelivr.net/gh/sunn-us/SUIT/fonts/static/woff2/SUIT.css'},
  {id:'suite',label:'SUITE',family:'SUITE',weights:[400,700],keywords:['스위트'],css:'https://cdn.jsdelivr.net/gh/sunn-us/SUITE/fonts/static/woff2/SUITE.css'},
  {id:'spoqa-han-sans-neo',label:'Spoqa Han Sans Neo',family:'Spoqa Han Sans Neo',weights:[400,700],keywords:['스포카 한 산스','spoqa'],css:'https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans@latest/css/SpoqaHanSansNeo.css'},
  {id:'nanum-gothic',label:'나눔고딕 · Nanum Gothic',family:'Nanum Gothic',weights:[400,700],keywords:['나눔','nanum'],css:'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap'},
  {id:'nanum-myeongjo',label:'나눔명조 · Nanum Myeongjo',family:'Nanum Myeongjo',weights:[400,700],keywords:['나눔','nanum','serif','명조'],css:'https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700&display=swap'},
  {id:'nanum-gothic-coding',label:'나눔고딕코딩 · Nanum Gothic Coding',family:'Nanum Gothic Coding',weights:[400],keywords:['나눔','nanum','mono','코딩'],css:'https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding&display=swap'},
  {id:'nanum-pen',label:'나눔손글씨 펜 · Nanum Pen Script',family:'Nanum Pen Script',weights:[400],keywords:['나눔','nanum','손글씨','pen'],css:'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap'},
  {id:'nanum-brush',label:'나눔손글씨 붓 · Nanum Brush Script',family:'Nanum Brush Script',weights:[400],keywords:['나눔','nanum','손글씨','brush'],css:'https://fonts.googleapis.com/css2?family=Nanum+Brush+Script&display=swap'},
  {id:'nanum-square',label:'나눔스퀘어 · NanumSquare',family:'NanumSquare',weights:[400,700],keywords:['나눔','nanum','square'],css:'https://cdn.jsdelivr.net/gh/moonspam/NanumSquare@2.0/nanumsquare.css'},
  {id:'nanum-square-round',label:'나눔스퀘어라운드 · Nanum Square Round',family:'Nanum Square Round',weights:[400,700],keywords:['나눔','nanum','square','round'],css:'https://cdn.jsdelivr.net/gh/fonts-archive/NanumSquareRound/NanumSquareRound.css'},
  {id:'nanum-square-neo',label:'나눔스퀘어 네오 · Nanum Square Neo',family:'Nanum Square Neo',weights:[400,700],keywords:['나눔','nanum','square','neo'],css:'https://cdn.jsdelivr.net/gh/fonts-archive/NanumSquareNeo/NanumSquareNeo.css'},
  {id:'nanum-barun-gothic',label:'나눔바른고딕 · NanumBarunGothic',family:'NanumBarunGothic',weights:[400,700],keywords:['나눔','nanum','바른'],css:'https://cdn.jsdelivr.net/gh/moonspam/NanumBarunGothic@1.0/nanumbarungothicsubset.css'},
]);

/** 시스템 폰트 후보 — generic 셋은 항상 있고, 나머지는 브라우저에서 detectHFaceSystemFonts 로 걸러요. labelKey 는 UI 사전 키. */
export const H_FACE_TEXT_SYSTEM_FONTS=Object.freeze([
  {id:'sys-sans',labelKey:'imageFontSans',family:'system-ui, sans-serif',weights:[400,700],generic:true,keywords:['system','sans','기본']},
  {id:'sys-serif',labelKey:'imageFontSerif',family:'serif',weights:[400,700],generic:true,keywords:['system','serif','명조','기본']},
  {id:'sys-mono',labelKey:'imageFontMono',family:'monospace',weights:[400,700],generic:true,keywords:['system','mono','고정폭','기본']},
  ...[['Malgun Gothic','맑은 고딕'],['Apple SD Gothic Neo','애플 산돌고딕'],['Noto Sans CJK KR','노토 산스 CJK'],['Gulim','굴림'],['Dotum','돋움'],['Batang','바탕'],['Gungsuh','궁서'],
    ['Segoe UI',''],['Arial',''],['Helvetica Neue',''],['Roboto',''],['Verdana',''],['Tahoma',''],['Trebuchet MS',''],['Georgia',''],['Times New Roman',''],['Courier New',''],['Consolas',''],['Impact',''],['Comic Sans MS','']]
    .map(([family,ko])=>({id:'sys-'+family.toLowerCase().replace(/[^a-z0-9]+/g,'-'),label:ko?`${ko} · ${family}`:family,family:`"${family}"`,weights:[400,700],keywords:ko?[ko]:[]})),
]);

/** 입력 문자열 → 줄 목록. 앞뒤 빈 줄은 버리고 가운데 빈 줄은 남겨요(의도한 간격). 공백만 있으면 []. */
export function hFaceTextLines(text){
  const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(/\s+$/,''));
  while(lines.length&&!lines[0].trim())lines.shift();
  while(lines.length&&!lines[lines.length-1].trim())lines.pop();
  return lines;
}

/** 면(box 한 변) 안에서 여백을 뺀 영역을 가장 넓은 줄과 줄 수가 동시에 넘지 않는 최대 글자 크기(px, 정수).
 *  widthAt(line) 은 referenceSize 에서 잰 줄 폭 — 글자 폭은 크기에 선형이라 이분 탐색이 필요 없어요. */
export function hFaceTextFontSize({lines,widthAt,referenceSize=H_FACE_TEXT_REFERENCE_PX,box=H_FACE_TEXT_SIZE,margin=H_FACE_TEXT_MARGIN,lineHeight=H_FACE_TEXT_LINE_HEIGHT,min=1,max=Infinity}){
  if(!Array.isArray(lines)||!lines.length)return 0;
  const inner=Math.max(1,box*(1-2*margin));
  const widest=Math.max(0,...lines.map(line=>Number(widthAt(line))||0));
  const byWidth=widest>0?inner/widest*referenceSize:Infinity;
  const byHeight=inner/(lines.length*lineHeight);
  return Math.max(min,Math.floor(Math.min(byWidth,byHeight,max)));
}

/** 배경색(#rrggbb) 대비로 글자색을 골라요 — 상대 휘도 .5 위면 검정, 아래면 흰색. */
export function hFaceTextColor(backgroundHex){
  const hex=/^#?([0-9a-f]{6})$/i.exec(String(backgroundHex??''))?.[1]??'ffffff';
  const channel=k=>{const c=parseInt(hex.slice(k,k+2),16)/255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4;};
  const luminance=.2126*channel(0)+.7152*channel(2)+.0722*channel(4);
  return luminance>.5?'#111111':'#ffffff';
}

/** 검색 — label·family·keywords 어디든 부분 일치(대소문자 무시). 빈 질의는 전부. */
export function filterHFaceFonts(entries,query){
  const q=String(query??'').trim().toLowerCase();
  if(!q)return [...entries];
  return entries.filter(entry=>[entry.label??'',entry.family??'',...(entry.keywords??[])].some(s=>String(s).toLowerCase().includes(q)));
}

export function hFaceFontById(entries,id){return entries.find(entry=>entry.id===id)??null;}

/** CSS font 약식 — family 는 시트 이름을 따옴표로, generic 은 그대로. 굵기는 시트가 주는 가장 굵은 것. */
export function hFaceFontShorthand(entry,px){
  const weight=Math.max(...(entry.weights??[400]));
  const family=entry.generic?entry.family:entry.family.startsWith('"')?entry.family:`"${entry.family}"`;
  return `${weight} ${px}px ${family}`;
}

// ───────────────────────── 브라우저 전용 ─────────────────────────

/** canvas 폭 비교로 설치된 시스템 폰트만 남겨요(generic 셋은 항상). ctx 가 없으면 generic 만 돌려줘요. */
export function detectHFaceSystemFonts(entries=H_FACE_TEXT_SYSTEM_FONTS,ctx=null){
  if(!ctx)return entries.filter(entry=>entry.generic);
  const probe='mmmmmmmmmmlliWWW가나다漢字0123';
  const width=font=>{ctx.font=`72px ${font}`;return ctx.measureText(probe).width;};
  const base=[['monospace',width('monospace')],['sans-serif',width('sans-serif')],['serif',width('serif')]];
  return entries.filter(entry=>entry.generic||base.some(([generic,w])=>width(`${entry.family}, ${generic}`)!==w));
}

const linkedCss=new Set();
/** 웹폰트 시트를 한 번만 <head> 에 붙여요(드롭다운을 열 때 전부, 고를 때 하나). 실제 글리프 파일은 쓰일 때 받아요. */
export function ensureHFaceFontCss(entry,doc=globalThis.document){
  if(!entry?.css||!doc||linkedCss.has(entry.css))return false;
  linkedCss.add(entry.css);
  const link=doc.createElement('link');link.rel='stylesheet';link.href=entry.css;link.dataset.hFaceFont=entry.id;doc.head.append(link);
  return true;
}
/** 고른 폰트를 렌더 전에 실제로 받아요 — Google 시트는 unicode-range 조각이라 그릴 글자를 같이 넘겨요. 실패는 조용히(대체 폰트로 그려요). */
export async function loadHFaceFont(entry,sample='',doc=globalThis.document){
  ensureHFaceFontCss(entry,doc);
  if(!entry?.css||!doc?.fonts?.load)return false;
  try{await doc.fonts.load(hFaceFontShorthand(entry,16),sample||'가A0');return true;}catch{return false;}
}

/** 글자를 투명 배경 정사각 raster 로 — 이미지 경로가 배경색·맞추기·회전을 얹어요. 빈 입력은 null. */
export function renderHFaceText({text,font,color='#111111',size=H_FACE_TEXT_SIZE,margin=H_FACE_TEXT_MARGIN,lineHeight=H_FACE_TEXT_LINE_HEIGHT,doc=globalThis.document}){
  const lines=hFaceTextLines(text);
  if(!lines.length)return null;
  const canvas=doc.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('텍스트를 그릴 수 없어요.');
  ctx.font=hFaceFontShorthand(font,H_FACE_TEXT_REFERENCE_PX);
  const fontSize=hFaceTextFontSize({lines,widthAt:line=>ctx.measureText(line).width,box:size,margin,lineHeight,max:size});
  ctx.font=hFaceFontShorthand(font,fontSize);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;
  const step=fontSize*lineHeight,top=size/2-(lines.length-1)*step/2;
  lines.forEach((line,i)=>{if(line.trim())ctx.fillText(line,size/2,top+i*step);});
  return {width:size,height:size,pixels:ctx.getImageData(0,0,size,size).data,href:canvas.toDataURL('image/png'),fontSize,lines:lines.length};
}
