/**
 * 0단계 실측 (a) — 기존 전개도(cubeNetScene)가 접었을 때 읽히는 방향인지 재요(설계 §2.1).
 *
 * 1면(XM 만 데이터) 코드의 전개도 래스터에서 XM 영역을 잘라, 흰 여백 2셀 이상을 두른 캔버스에 붙여요.
 * 라틴 십자에서는 면이 이웃 면과 맞닿아 있어 그냥 자르면 여백이 0 이고, 검출기는 영상 가장자리에 닿은
 * 성분을 버리므로 «0개» 가 코드 탓인지 자르기 탓인지 가릴 수 없어요. 그래서 원본과 좌우 반전본을 짝으로 넣어요.
 *   (원본 0, 반전 ≥1) → 전개도 면은 정본의 거울상 · (원본 ≥1, 반전 0) → 정본 방향 · (둘 다 0) → 판정 불가(실패).
 * 같은 자르기 경로를 정본 면 시트(buildHFaceSheet)에 대 «정본 방향» 이 나오는지도 대조군으로 재요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH,decodeH} from '../src/h-codec.js';
import {buildHCubeModel,cubeNetScene} from '../src/cube-export.js';
import {buildHFaceSheet} from '../src/h-render.js';
import {rasterize} from '../src/raster.js';
import {detectH} from '../src/h-detect.js';
import {hModeFaces} from '../src/h-profile.js';
import {fullOnly} from './helpers/scope.mjs';
import {fieldOfRaster,mirrorX} from './helpers/h-physical-camera.mjs';

const PPU=12,PAD_CELLS=3;
const profile=e=>({version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,routeId:e.routeId,finder:e.finder});

/** scene 에서 face 가 칠한 영역의 경계를 도형에서 유도해(전개도 배치 표를 베끼지 않아요) 흰 캔버스에 옮겨요. */
function cropFace(scene,face,{padCells=PAD_CELLS,ppu=PPU}={}){
  const raster=rasterize(scene,{pixelsPerUnit:ppu,supersample:2});
  const points=scene.shapes.filter(shape=>shape.face===face&&shape.kind==='polygon').flatMap(shape=>shape.points);
  assert.ok(points.length>0,`scene 에 ${face} 도형이 없어요`);
  const px=v=>Math.round(v*ppu);
  const x0=px(Math.min(...points.map(p=>p.x))),x1=px(Math.max(...points.map(p=>p.x)));
  const y0=px(Math.min(...points.map(p=>p.y))),y1=px(Math.max(...points.map(p=>p.y)));
  const pad=padCells*ppu,width=x1-x0+2*pad,height=y1-y0+2*pad,pixels=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const from=(y*raster.width+x)*4;
    pixels.set(raster.pixels.subarray(from,from+4),((y-y0+pad)*width+(x-x0+pad))*4);
  }
  return fieldOfRaster({width,height,pixels});
}

/** 짝 대조 판정이에요. 넷째 칸(둘 다 ≥1)은 손잡이가 있는 코드에서 나올 수 없으니 자의 고장으로 봐요. */
function mirrorVerdict(originalFaces,mirroredFaces){
  if(originalFaces===0&&mirroredFaces>=1)return 'mirrored';
  if(originalFaces>=1&&mirroredFaces===0)return 'proper';
  if(originalFaces===0&&mirroredFaces===0)return 'undecidable';
  return 'inconsistent';
}
function assertDecided(verdict,context){
  assert.ok(verdict==='mirrored'||verdict==='proper',`판정 불가(${verdict}) — S 를 확정하지 말고 자르기·여백·임계부터 다시 봐요: ${context}`);
  return verdict;
}
function probe(field){
  const original=detectH(field),mirrored=detectH(mirrorX(field));
  return {original,mirrored,verdict:mirrorVerdict(original.faces.length,mirrored.faces.length)};
}
const singleFace=(finder,tones)=>encodeH('one',{version:finder==='frame'?3:7,mode:1,tones,ecc:'H',mask:7,finder});

test('판정 규칙은 짝 대조 네 칸이고, 둘 다 0 이면 «판정 불가» 로 실패해요',()=>{
  assert.equal(mirrorVerdict(0,1),'mirrored');
  assert.equal(mirrorVerdict(1,0),'proper');
  assert.equal(mirrorVerdict(0,0),'undecidable');
  assert.equal(mirrorVerdict(1,1),'inconsistent');
  assert.throws(()=>assertDecided('undecidable','fixture'),/판정 불가/);
  assert.throws(()=>assertDecided('inconsistent','fixture'),/판정 불가/);
});

test('심은 결함: 코드 없는 빈 면과 셀당 1픽셀로 뭉갠 자르기는 «판정 불가» 로 떨어져요',()=>{
  const e=singleFace('frame',3),net=cubeNetScene(buildHCubeModel(e));
  // 빈 면(ZM) — 코드가 없으니 방향도 없어요.
  assert.equal(probe(cropFace(net,'ZM')).verdict,'undecidable');
  // 셀당 1픽셀 — 자르기 경로가 고장 나면 «거울» 이 아니라 «판정 불가» 가 나와야 해요. 같은 면을 셀당 12픽셀로 자르면 판정돼요.
  assert.equal(probe(cropFace(net,'XM',{ppu:1})).verdict,'undecidable');
  assert.notEqual(probe(cropFace(net,'XM')).verdict,'undecidable');
});

test('자른 캔버스는 네 변 모두 흰 여백이 2셀 이상이에요',()=>{
  const field=cropFace(cubeNetScene(buildHCubeModel(singleFace('frame',2))),'XM'),band=2*PPU;
  const white=(x,y)=>field.data[y*field.width+x]>=.999;
  for(let d=0;d<band;d++)for(let x=0;x<field.width;x++)assert.ok(white(x,d)&&white(x,field.height-1-d));
  for(let d=0;d<band;d++)for(let y=0;y<field.height;y++)assert.ok(white(d,y)&&white(field.width-1-d,y));
});

test('대조군: 같은 자르기 경로로 정본 면 시트의 XM 은 «정본 방향» 이에요',()=>{
  for(const finder of ['frame','corners'])for(const tones of [2,3]){
    const e=singleFace(finder,tones),{original,verdict}=probe(cropFace(buildHFaceSheet(e),'XM'));
    assert.equal(assertDecided(verdict,`${finder}/${tones}`),'proper');
    const hit=original.faces.find(row=>row.face==='XM');
    assert.equal(hit.mirror,false);assert.equal(decodeH({XM:hit.levels},profile(e)).text,'one');
  }
});

test('0단계 (a): 기존 전개도의 1면 XM 은 정본의 좌우 거울상이에요(원본 0면 · 반전본 1면 이상)',()=>{
  for(const finder of ['frame','corners'])for(const tones of [2,3]){
    const e=singleFace(finder,tones),{original,mirrored,verdict}=probe(cropFace(cubeNetScene(buildHCubeModel(e)),'XM'));
    const context=`${finder}/${tones}톤: 원본 ${original.faces.length} · 반전본 ${mirrored.faces.length}`;
    assert.equal(assertDecided(verdict,context),'mirrored',context);
    // 반전본은 순수 좌우 반전이면 그대로 복호돼요. 전치·회전이 섞인 거울이 아니라는 뜻이에요.
    const hit=mirrored.faces.find(row=>row.face==='XM');
    assert.ok(hit,context);assert.equal(hit.mirror,false);
    assert.equal(decodeH({XM:hit.levels},profile(e)).text,'one',context);
  }
});

fullOnly(()=>test('0단계 (a) 확장: 6면 코드의 전개도 여섯 면이 모두 거울상이에요',()=>{
  for(const [finder,version] of [['frame',2],['corners',5]])for(const tones of [2,3]){
    const e=encodeH(Uint8Array.of(7,9),{version,mode:6,tones,ecc:'M',mask:3,finder}),net=cubeNetScene(buildHCubeModel(e));
    for(const face of hModeFaces(6)){
      const {original,mirrored,verdict}=probe(cropFace(net,face));
      const context=`${finder}/${tones}톤/${face}: 원본 ${original.faces.length} · 반전본 ${mirrored.faces.length}`;
      assert.equal(assertDecided(verdict,context),'mirrored',context);
      assert.ok(mirrored.faces.some(row=>row.face===face&&row.mirror===false),context);
    }
  }
}));
