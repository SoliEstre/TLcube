// H image editing regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import {composeHFaceImage,hexToRgb,hslToRgb,rgbToHex,rgbToHsl,normalizeHFaceImageSettings} from '../src/h-image-editor.js';
import {preflightHFaceSvg} from '../src/h-face-images.js';
import {rasterToPng} from '../src/png.js';
test('pixel-art nearest 확대와 90도 회전은 원래 팔레트를 보존해요',()=>{
  const palette=[[255,0,0],[0,255,0],[0,0,255],[255,255,0]];
  const source={...raw(2,2,palette.flatMap(c=>[...c,255])),pixelated:true};
  const result=composeHFaceImage(source,{size:16,fit:'fill',rotation:90});
  for(let k=0;k<result.pixels.length;k+=4)assert.ok(palette.some(c=>c.every((v,i)=>v===result.pixels[k+i])));
  assert.deepEqual([...result.pixels.slice(0,3)],[0,0,255]);
});
const raw=(w,h,p)=>({width:w,height:h,pixels:Uint8ClampedArray.from(p),href:'data:image/png;base64,'+Buffer.from(rasterToPng({width:w,height:h,pixels:Uint8ClampedArray.from(p)})).toString('base64')});
test('빈 원본은 배경만 있는 완결 정사각 PNG가 된다',()=>{const x=composeHFaceImage(null,{background:'#123456',size:2});assert.deepEqual([...x.pixels],[18,52,86,255,18,52,86,255,18,52,86,255,18,52,86,255]);assert.match(x.href,/^data:image\/png;base64,iVBOR/);});
test('투명 원본은 PNG에 남지 않고 선택 배경에 합성된다',()=>{const x=composeHFaceImage(raw(1,1,[255,0,0,128]),{size:1,fit:'fill',background:'#0000ff'});assert.deepEqual([...x.pixels],[128,0,127,255]);});
test('회전은 45도 정수 배수만 받고 양수는 시계 방향으로 정규화한다',()=>{assert.equal(normalizeHFaceImageSettings({rotation:-45}).rotation,315);assert.throws(()=>composeHFaceImage(null,{rotation:1}));});
test('45도 cover와 fill은 expanded square로 네 모서리를 모두 채운다',()=>{const one=raw(1,1,[240,1,2,255]);for(const fit of ['cover','fill']){const x=composeHFaceImage(one,{size:17,rotation:45,fit,background:'#000000'});for(let k=0;k<x.pixels.length;k+=4)assert.equal(x.pixels[k],240,fit);}});
test('같은 원본과 설정은 바이트까지 결정적이고 원본은 바꾸지 않는다',()=>{const source=raw(2,1,[255,0,0,255,0,0,255,255]),before=[...source.pixels],a=composeHFaceImage(source,{size:32,rotation:135,fit:'contain'}),b=composeHFaceImage(source,{size:32,rotation:135,fit:'contain'});assert.deepEqual(a.pixels,b.pixels);assert.equal(a.href,b.href);assert.deepEqual([...source.pixels],before);});
test('HEX RGB HSL 변환은 범위를 clamp하고 canonical HEX를 낸다',()=>{assert.deepEqual(hslToRgb({h:360,s:100,l:50}),{r:255,g:0,b:0});assert.deepEqual(hslToRgb({h:-1,s:100,l:50}),{r:255,g:0,b:0});assert.deepEqual(rgbToHsl({r:255,g:0,b:0}),{h:0,s:100,l:50});assert.equal(rgbToHex({r:1.2,g:15,b:255}),'#010fff');assert.equal(rgbToHex({r:-10,g:512,b:1.6}),'#00ff02');assert.deepEqual(hexToRgb('#ABCDEF'),{r:171,g:205,b:239});assert.throws(()=>rgbToHex({r:NaN,g:0,b:0}));assert.throws(()=>hexToRgb('#fff'));});
test('SVG 문자열 preflight는 DTD, entity, PI, event handler, style/import를 거부한다',()=>{const ok='<svg viewBox="0 0 1 1"><rect width="1" height="1" fill="#000"/></svg>';assert.equal(preflightHFaceSvg(ok),ok);for(const bad of ['<!DOCTYPE svg><svg/>','<!ENTITY x "y"><svg/>','<?xml-stylesheet href="x"?><svg/>','<svg onload="x()"/>','<svg><rect style="fill:url(https://x)"/></svg>'])assert.throws(()=>preflightHFaceSvg(bad));});
