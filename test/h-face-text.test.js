import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {H_FACE_TEXT_FONT_HOSTS,H_FACE_TEXT_MARGIN,H_FACE_TEXT_SYSTEM_FONTS,H_FACE_TEXT_WEB_FONTS,H_FACE_TEXT_DEFAULT_FONT,detectHFaceSystemFonts,filterHFaceFonts,hFaceFontById,hFaceFontShorthand,hFaceTextColor,hFaceTextFontSize,hFaceTextLines,ensureHFaceFontCss,loadHFaceFont} from '../src/h-face-text.js';
import {hUiLabel} from '../src/generator-h.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/h-image-editor-ui.js',import.meta.url),'utf8');

test('웹폰트 카탈로그: 요청한 가족(Noto Sans KR·SUIT·SUITE·Pretendard·Spoqa·나눔 5+)이 있고 시트는 허용 CDN 둘에서만 와요',()=>{
  const ids=H_FACE_TEXT_WEB_FONTS.map(f=>f.id);
  assert.equal(new Set(ids).size,ids.length,'id 중복 없음');
  for(const family of ['Noto Sans KR','SUIT','SUITE','Pretendard','Spoqa Han Sans Neo'])assert.ok(H_FACE_TEXT_WEB_FONTS.some(f=>f.family===family),family);
  assert.ok(H_FACE_TEXT_WEB_FONTS.filter(f=>/nanum/i.test(f.family)).length>=5,'나눔 계열 5종 이상');
  for(const font of H_FACE_TEXT_WEB_FONTS){
    const url=new URL(font.css);
    assert.equal(url.protocol,'https:');assert.ok(H_FACE_TEXT_FONT_HOSTS.includes(url.hostname),`${font.id}: ${url.hostname}`);
    assert.ok(font.label&&font.family&&Array.isArray(font.weights)&&font.weights.length,font.id);
  }
  const system=H_FACE_TEXT_SYSTEM_FONTS.map(f=>f.id);
  assert.equal(new Set([...ids,...system]).size,ids.length+system.length,'시스템·웹 id 도 겹치지 않아요');
  assert.ok(hFaceFontById(H_FACE_TEXT_SYSTEM_FONTS,H_FACE_TEXT_DEFAULT_FONT)?.generic,'기본 폰트는 generic 시스템 산세리프');
  // ctx 가 없으면 generic 셋만, 있으면 폭이 달라지는 가족만 남아요.
  assert.deepEqual(detectHFaceSystemFonts(H_FACE_TEXT_SYSTEM_FONTS,null).map(f=>f.id),['sys-sans','sys-serif','sys-mono']);
  const fakeCtx={font:'',measureText(){return {width:this.font.includes('Arial')?101:100};}};
  assert.deepEqual(detectHFaceSystemFonts(H_FACE_TEXT_SYSTEM_FONTS,fakeCtx).map(f=>f.id),['sys-sans','sys-serif','sys-mono','sys-arial']);
});

test('줄 나누기·글자 크기·대비색은 순수 계산이에요',()=>{
  assert.deepEqual(hFaceTextLines('   '),[]);assert.deepEqual(hFaceTextLines('\n\nHello\r\nWorld  \n\n'),['Hello','World']);
  assert.deepEqual(hFaceTextLines('a\n\nb'),['a','','b'],'가운데 빈 줄은 간격으로 남겨요');
  const inner=1000*(1-2*H_FACE_TEXT_MARGIN); // 840
  // 한 줄, 기준 100px 에서 폭 200 → 폭 한계 420 · 높이 한계 700 → 420
  assert.equal(hFaceTextFontSize({lines:['x'],widthAt:()=>200,box:1000}),Math.floor(inner/200*100));
  // 두 줄이면 높이 한계 840/(2·1.2)=350 이 더 작아요
  assert.equal(hFaceTextFontSize({lines:['x','y'],widthAt:()=>200,box:1000}),Math.floor(inner/2.4));
  // 긴 줄은 폭이 묶어요
  assert.equal(hFaceTextFontSize({lines:['long'],widthAt:()=>2000,box:1000}),Math.floor(inner/2000*100));
  assert.equal(hFaceTextFontSize({lines:[],widthAt:()=>1}),0);
  assert.equal(hFaceTextFontSize({lines:['x'],widthAt:()=>1,box:1000,max:300}),300,'max 로 캡');
  assert.equal(hFaceTextColor('#ffffff'),'#111111');assert.equal(hFaceTextColor('#000000'),'#ffffff');assert.equal(hFaceTextColor('#ffe000'),'#111111');assert.equal(hFaceTextColor('#1a3a8f'),'#ffffff');assert.equal(hFaceTextColor('garbage'),'#111111');
  assert.equal(hFaceFontShorthand({family:'Nanum Pen Script',weights:[400]},32),'400 32px "Nanum Pen Script"');
  assert.equal(hFaceFontShorthand({family:'system-ui, sans-serif',weights:[400,700],generic:true},12),'700 12px system-ui, sans-serif');
});

test('검색은 라벨·family·키워드 어디든 부분 일치예요',()=>{
  const all=[...H_FACE_TEXT_SYSTEM_FONTS,...H_FACE_TEXT_WEB_FONTS];
  assert.equal(filterHFaceFonts(all,'').length,all.length);
  assert.ok(filterHFaceFonts(all,'나눔').every(f=>/nanum/i.test(f.family))&&filterHFaceFonts(all,'나눔').length>=5);
  assert.deepEqual(filterHFaceFonts(all,'suit').map(f=>f.id),['suit','suite']);
  assert.deepEqual(filterHFaceFonts(all,'PRETEN').map(f=>f.id),['pretendard']);
  assert.equal(filterHFaceFonts(all,'zzz-none').length,0);
});

test('폰트 적재는 DOM 없이 조용히 건너뛰고, 시트는 한 번만 붙여요',async()=>{
  const entry=H_FACE_TEXT_WEB_FONTS[0];
  assert.equal(ensureHFaceFontCss(entry,null),false);
  assert.equal(await loadHFaceFont(entry,'가',null),false);
  const appended=[];const doc={createElement:()=>({dataset:{}}),head:{append:el=>appended.push(el)},fonts:{load:async()=>[]}};
  assert.equal(ensureHFaceFontCss({...entry,id:'probe-once',css:'https://cdn.jsdelivr.net/gh/x/y@1/z.css'},doc),true);
  assert.equal(ensureHFaceFontCss({...entry,id:'probe-once',css:'https://cdn.jsdelivr.net/gh/x/y@1/z.css'},doc),false,'같은 시트는 두 번 안 붙여요');
  assert.equal(appended.length,1);assert.equal(appended[0].rel,'stylesheet');
  assert.equal(await loadHFaceFont({...entry,css:'https://cdn.jsdelivr.net/gh/x/y@1/w.css'},'가',doc),true);
});

test('UI·사전 배선: 토글 버튼이 테스트 이미지 아래에, 폰트 콤보는 화살표/검색으로만 열려요',()=>{
  assert.match(ui,/well\.append\(preview,sample\);[\s\S]*?textToggle[\s\S]*?well\.append\(textToggle\)/);
  assert.match(ui,/fontOpen\.addEventListener\('click',\(\)=>\{if\(fontList\.hidden\)openList\(''\);else closeList\(\);\}\)/);
  assert.match(ui,/fontInput\.addEventListener\('input',\(\)=>openList\(fontInput\.value\)\)/);
  assert.doesNotMatch(ui,/fontInput\.addEventListener\('(click|focus)'/,'입력란 클릭/포커스는 목록을 열지 않아요');
  assert.match(ui,/left\.append\(well,textRow,sizeRow,chooseRow,input\)/);
  assert.match(html,/\.h-font-list \{ position:absolute/);assert.match(html,/GENERATOR_BUILD = '2026-09-14.08';/);
  for(const key of ['imageText','imageTextPlaceholder','imageTextEmpty','imageFont','imageFontSearch','imageFontOpen','imageFontSystem','imageFontWeb','imageFontSans','imageFontSerif','imageFontMono','imageFontNone'])
    for(const lang of ['ko','en'])assert.notEqual(hUiLabel(key,lang),key,`${key}/${lang}`);
  assert.equal(hUiLabel('imageText','ko'),'텍스트 넣기');
});
