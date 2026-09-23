/**
 * §6-17 sceneToSvg 의 실척(mm) 옵션이에요.
 *   - unit:'mm' 이면 머리 줄이 width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}" 이고, 도형 줄은 옵션 없는 산출과 같아요.
 *   - 옵션이 없으면 종전과 바이트가 같아요. 핀은 svg.js 에만 의존하는 합성 장면(배경·음영·이음 다각형·qr 다각형·원)을
 *     unit 옵션을 넣기 전 svg.js(b9e1589)로 직렬화한 SHA-256 이에요. 다른 모듈이 바뀌어도 이 핀은 흔들리지 않아요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sceneToSvg} from '../src/svg.js';
import {encodeH} from '../src/h-codec.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {physicalHCube} from '../src/cube-physical.js';
import {PAPER_SIZES,paperPlan,buildPaperSheet} from '../src/paper-net.js';

const sha=s=>createHash('sha256').update(s).digest('hex');
function syntheticScene(){
  return {width:12.5,height:7,background:{r:250,g:251,b:252},
    shading:[{color:{r:10,g:20,b:30},gradient:{x1:0,y1:0,x2:3,y2:1,a1:0.5,a2:0},points:[{x:0,y:0},{x:3,y:0},{x:3,y:1}]}],
    shapes:[
      {kind:'polygon',color:{r:1,g:2,b:3},points:[{x:0.1,y:0.2},{x:1.123456,y:0.2},{x:1,y:-0.00000001}]},
      {kind:'polygon',qr:true,color:{r:200,g:100,b:0},points:[{x:2,y:2},{x:3,y:2},{x:3,y:3},{x:2,y:3}]},
      {kind:'disc',color:{r:9,g:9,b:9},cx:5,cy:5,r:1.5},
    ]};
}
/** unit 옵션 도입 전 산출의 SHA-256 (옵션 조합별). */
const LEGACY_PINS=[
  [{},'fd39f71558867d46935f135547b0f5e5c81080bf87cc80049d3b86e24193d728'],
  [{pixelsPerUnit:10},'1de4d8b39c056a656997025a1edb62d719605c38dcaecc56b6d7912dce400104'],
  [{precision:2},'9ab7efea7647699ffa5c5d6d4fda3592d9c2bc70b42cb89911f0e019acb6ce9a'],
  [{widthPx:300,heightPx:200},'c7f50be3c83ef1764f45b98ea149796510d817e7884126524823ca28b2cec646'],
];

test('unit 옵션이 없으면 종전과 바이트가 같아요(옵션 조합 4종 핀)',()=>{
  for(const [options,pin] of LEGACY_PINS)assert.equal(sha(sceneToSvg(syntheticScene(),options)),pin,JSON.stringify(options));
  assert.equal(sceneToSvg(syntheticScene(),{unit:undefined}),sceneToSvg(syntheticScene()));
});

test('심은 결함: 핀은 좌표 한 자리 차이도 잡아요',()=>{
  const scene=syntheticScene();scene.shapes[1].points[0].x+=0.0001;
  assert.notEqual(sha(sceneToSvg(scene)),LEGACY_PINS[0][1]);
});

test('unit mm: 머리 줄은 실척 mm 와 같은 수의 viewBox, 나머지 줄은 옵션 없는 산출과 같아요',()=>{
  const scene=syntheticScene(),plain=sceneToSvg(scene).split('\n'),mm=sceneToSvg(scene,{unit:'mm'}).split('\n');
  assert.equal(mm[0],'<svg xmlns="http://www.w3.org/2000/svg" width="12.5mm" height="7mm" viewBox="0 0 12.5 7">');
  assert.deepEqual(mm.slice(1),plain.slice(1));
  // 종이 도안: 8개 용지 모두 {W}mm × {H}mm, viewBox 0 0 W H.
  const phys=physicalHCube(buildHCubeModel(encodeH(Uint8Array.of(1,2,3),{version:0,mode:3,tones:3,ecc:'M',mask:0,finder:'frame'})));
  for(const paper of PAPER_SIZES){
    const svg=sceneToSvg(buildPaperSheet(phys,paperPlan(phys,{paper:paper.id,thicknessMm:0.1})),{unit:'mm'});
    const head=svg.slice(0,svg.indexOf('\n')),W=String(paper.widthMm),H=String(paper.heightMm);
    assert.equal(head,`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`,paper.id);
    // 선·글리프는 이음 스트로크 없이(qr), 모듈만 0.03 이음 스트로크를 달아요.
    assert.ok(svg.includes('stroke-width="0.03"'));
  }
});

test('unit 옵션 검증: mm 만 받고, 픽셀 크기와 함께 줄 수 없어요',()=>{
  const scene=syntheticScene();
  assert.throws(()=>sceneToSvg(scene,{unit:'px'}),RangeError);
  assert.throws(()=>sceneToSvg(scene,{unit:'cm'}),RangeError);
  assert.throws(()=>sceneToSvg(scene,{unit:'mm',widthPx:100,heightPx:100}),RangeError);
  assert.doesNotThrow(()=>sceneToSvg(scene,{unit:'mm',precision:2}));
  assert.equal(sceneToSvg({...scene,width:200,height:100.5},{unit:'mm',precision:2}).split('\n')[0],'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100.5mm" viewBox="0 0 200 100.5">');
});
