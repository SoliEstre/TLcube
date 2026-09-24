/**
 * §6-15 종이 판독 왕복 — 종이 도안을 실제 내보내기 경로(renderExportPng + paperPngPlan, 300 dpi PNG)로 굽고, PNG 바이트를
 * 다시 풀어 면 영역을 잘라 흰 여백 캔버스에 붙인 뒤 기존 H 검출·복호기에 넣어요.
 *   원본은 mirror === false 로 읽히고 좌우 반전본은 0면이어야 해요(짝 대조). 둘 다 0면이면 «판정 불가» 로 실패해요.
 *   P3 는 조립했을 때 보이는 모습 — 이웃 판의 절단면 띠(폭 t, 판 색)를 합성한 입력 — 도 따로 재요.
 *   대조군: 물리 좌표 교환 없이(S = I) 만든 도안은 같은 자에서 «거울상» 으로 떨어져요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {encodeH,decodeH,hCapacity} from '../src/h-codec.js';
import {H_ARRANGEMENTS,hDisplayMap} from '../src/h-face-arrangement.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {physicalHCube} from '../src/cube-physical.js';
import {renderExportPng} from '../src/export-render.js';
import {detectH} from '../src/h-detect.js';
import {paperPlan,paperPngPlan,buildPaperSheet} from '../src/paper-net.js';
import {fullOnly} from './helpers/scope.mjs';
import {fieldOfRaster,mirrorX} from './helpers/h-physical-camera.mjs';

const IDENTITY=[[1,0,0],[0,1,0],[0,0,1]];
const PAD_CELLS=3;
/** 회색 판지 절단면 색(제안). 판 색이 어두울수록 흰 링을 더 많이 가려요. */
const BOARD_EDGE={r:140,g:128,b:110};
const profile=e=>({version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,routeId:e.routeId,finder:e.finder});

/** 테스트 쪽 PNG 해독(IHDR · pHYs · IDAT, 필터 0–4). 구현의 인코더를 되쓰지 않아요. */
function decodePng(bytes){
  const u32=o=>((bytes[o]<<24)|(bytes[o+1]<<16)|(bytes[o+2]<<8)|bytes[o+3])>>>0;
  assert.deepEqual([...bytes.subarray(0,8)],[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  let o=8,width=0,height=0,colorType=0,phys=null;const idat=[],order=[];
  while(o<bytes.length){
    const len=u32(o),type=String.fromCharCode(...bytes.subarray(o+4,o+8)),data=bytes.subarray(o+8,o+8+len);
    order.push(type);
    if(type==='IHDR'){width=u32(o+8);height=u32(o+12);colorType=data[9];}
    if(type==='pHYs')phys={x:u32(o+8),y:u32(o+12),unit:data[8]};
    if(type==='IDAT')idat.push(data);
    o+=12+len;
  }
  const raw=inflateSync(Buffer.concat(idat)),ch=colorType===6?4:3,stride=width*ch,pixels=new Uint8ClampedArray(width*height*4);
  let prev=new Uint8Array(stride);
  for(let y=0;y<height;y++){
    const f=raw[y*(stride+1)],line=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)),row=new Uint8Array(stride);
    for(let x=0;x<stride;x++){
      const a=x>=ch?row[x-ch]:0,b=prev[x],c=x>=ch?prev[x-ch]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
      const pred=f===0?0:f===1?a:f===2?b:f===3?(a+b)>>1:(pa<=pb&&pa<=pc?a:pb<=pc?b:c);
      row[x]=(line[x]+pred)&255;
    }
    for(let x=0;x<width;x++){for(let k=0;k<3;k++)pixels[(y*width+x)*4+k]=row[x*ch+k];pixels[(y*width+x)*4+3]=ch===4?row[x*ch+3]:255;}
    prev=row;
  }
  return {width,height,phys,order,pixels};
}

/**
 * 도안 PNG 에서 한 면을 잘라 흰 캔버스(여백 PAD_CELLS 셀)에 붙여요. region 은 mm 사각형(보이는 영역),
 * face 는 그 면 전체 사각형이고, band 가 있으면 face − region 을 그 색으로 칠해요(조립한 판의 절단면 띠).
 */
function cropFace(png,{region,face,cellMm},{band=null,dpi=300}={}){
  // 픽셀 중심이 [v0, v1) 안인 픽셀만 가져와요(래스터라이저와 같은 반열린 규약). 반올림을 쓰면 경계가 픽셀 중심에
  // 딱 걸릴 때 바깥 재단선 한 줄이 조각에 묻어 들어와요(실측: A5 · H5 · t 0.761 에서 회색 1px 줄).
  const k=dpi/25.4,px=v=>Math.ceil(v*k-0.5),pad=Math.ceil(PAD_CELLS*cellMm*k);
  const fx0=px(face.x0),fy0=px(face.y0),fx1=px(face.x1),fy1=px(face.y1),rx0=px(region.x0),ry0=px(region.y0),rx1=px(region.x1),ry1=px(region.y1);
  const width=fx1-fx0+2*pad,height=fy1-fy0+2*pad,pixels=new Uint8ClampedArray(width*height*4).fill(255);
  if(band)for(let y=fy0;y<fy1;y++)for(let x=fx0;x<fx1;x++){const o=((y-fy0+pad)*width+(x-fx0+pad))*4;pixels[o]=band.r;pixels[o+1]=band.g;pixels[o+2]=band.b;}
  for(let y=ry0;y<ry1;y++)for(let x=rx0;x<rx1;x++){
    const from=(y*png.width+x)*4,to=((y-fy0+pad)*width+(x-fx0+pad))*4;
    pixels.set(png.pixels.subarray(from,from+4),to);
  }
  return fieldOfRaster({width,height,pixels});
}
function verdict(field){
  const original=detectH(field),mirrored=detectH(mirrorX(field));
  const v=original.faces.length===0&&mirrored.faces.length>=1?'mirrored':original.faces.length>=1&&mirrored.faces.length===0?'proper'
    :original.faces.length===0?'undecidable':'inconsistent';
  return {original,mirrored,verdict:v};
}
function assertDecided(v,context){
  assert.ok(v==='proper'||v==='mirrored',`판정 불가(${v}) — 자르기·여백·임계부터 다시 봐요: ${context}`);
  return v;
}

function codeFor({version,mode,tones,finder,ecc='M',mask=0}){
  const cap=hCapacity(version,mode,{tones,ecc,mask,finder}).maxPayloadBytes,length=Math.max(1,Math.min(6,cap));
  const bytes=Uint8Array.from({length},(_,k)=>(k*37+version*11+mode*5+tones)&255);
  return {bytes,encoded:encodeH(bytes,{version,mode,tones,ecc,mask,finder})};
}
const sheetPng=scene=>decodePng(renderExportPng(scene,paperPngPlan(scene)));

/**
 * 한 도안의 모든 데이터 면을 PNG 에서 읽어 원문으로 복호해요. 면마다 짝 대조 판정이 «정본 방향» 이어야 해요.
 * bands: 같은 PNG 에서 잴 절단면 띠 목록(null = 조각 그대로, 곧 흰색으로 칠한 절단면). 도안은 한 번만 구워요.
 * 판 색 띠는 계획이 절단면 경고(TLP_WARN_BOARD_EDGE)를 내지 않을 때만 단언해요 — «경고 없음 ⇒ 조립 모습이 읽힘» 이
 * 이 자가 지키는 성질이에요. 경고가 난 계획에서 건너뛴 띠는 skipped 로 세요(조용히 버리지 않아요).
 * @returns {{read:number, skipped:number}}
 */
function paperRoundTrip({encoded,bytes,options={},method,thicknessMm,paper='A4',sideMm,bands=[null],growMm=0,label}){
  const phys=physicalHCube(buildHCubeModel(encoded,options)),map=hDisplayMap(encoded,options);
  const plan=paperPlan(phys,{paper,thicknessMm,method,sideMm}),warned=plan.warnings.includes('TLP_WARN_BOARD_EDGE');
  const scene=buildPaperSheet(phys,plan),png=sheetPng(scene);
  let read=0,skipped=0;
  for(const band of bands){
    if(band&&warned){skipped++;continue;}
    read+=readSheet({encoded,bytes,phys,map,scene,png,band,growMm,label:`${label} ${method}`});
  }
  return {read,skipped};
}
/** 사각형을 사방으로 d mm 넓혀요. 조각을 인쇄 영역보다 바깥에서 자른 경우(재단선이 있었다면 그 가운데)를 흉내 내요. */
const grow=(r,d)=>({x0:r.x0-d,y0:r.y0-d,x1:r.x1+d,y1:r.y1+d});
function readSheet({encoded,bytes,phys,map,scene,png,band,growMm=0,label}){
  const levels={};
  for(const name of phys.dataFaces){
    const f=scene.paper.faces[name],logical=map.physicalToLogical[name],context=`${label} ${name}(${logical})${band?' +띠':''}${growMm?` +${growMm} mm`:''}`;
    const {original,mirrored,verdict:v}=verdict(cropFace(png,{region:grow(f.visible,growMm),face:f.rect,cellMm:f.cellMm},{band}));
    assert.equal(assertDecided(v,`${context}: 원본 ${original.faces.length} · 반전 ${mirrored.faces.length} ${JSON.stringify(original.rejected?.slice(0,2))}`),'proper',context);
    for(const row of original.faces){
      assert.equal(row.mirror,false,context);assert.equal(row.face,logical,context);
      assert.deepEqual([...row.levels],[...encoded.faces[logical]],context);
    }
    levels[logical]=original.faces[0].levels;
  }
  const decoded=decodeH(levels,profile(encoded));
  assert.equal(decoded.ok,true,`${label}: ${decoded.reason}`);assert.deepEqual(decoded.bytes,bytes,label);
  return phys.dataFaces.length;
}

const BASE=codeFor({version:0,mode:3,tones:3,finder:'frame'});

test('300 dpi PNG 구조: A4 = 2480 × 3508, pHYs 11,811 ppm(미터)가 IDAT 앞이에요',()=>{
  const phys=physicalHCube(buildHCubeModel(BASE.encoded)),scene=buildPaperSheet(phys,paperPlan(phys,{thicknessMm:0.1}));
  const png=sheetPng(scene);
  assert.deepEqual([png.width,png.height],[2480,3508]);
  assert.deepEqual(png.phys,{x:11811,y:11811,unit:1});
  assert.ok(png.order.indexOf('pHYs')<png.order.indexOf('IDAT'));
});

test('§6-15 P1 한 장 전개도(A4 · 0.1 mm): 세 데이터 면이 거울 없이 읽히고 원문으로 복호돼요',()=>{
  assert.deepEqual(paperRoundTrip({...BASE,method:'sheet',thicknessMm:0.1,label:'H0 3F 3톤'}),{read:3,skipped:0});
});

test('§6-15 P1 3F + 6면(반복): 한 장 전개도의 여섯 면(사본 셋 포함)이 모두 거울 없이 제 논리 면으로 읽혀요',()=>{
  assert.deepEqual(paperRoundTrip({...BASE,options:{renderFaces:6},method:'sheet',thicknessMm:0.1,label:'H0 3F rf6 3톤'}),{read:6,skipped:0});
});

test('§6-15 P3 판 직접 인쇄(A4 · 1.0 mm): 조각 그대로와 절단면 띠를 합성한 조립 모습 모두 읽혀요',()=>{
  assert.deepEqual(paperRoundTrip({...BASE,method:'board',thicknessMm:1,bands:[null,BOARD_EDGE],label:'H0 3F 3톤'}),{read:6,skipped:0});
});

test('§6-15 P3 조각 가장자리: 경고 비율(t ≈ 0.54 모듈)에서 절단면을 흰색으로 칠하고 인쇄 영역 0.1 mm 바깥을 잘라도 읽혀요 — 자 검증: 붙은 회색 실선을 심으면 빨개져요',()=>{
  // 조각 가장자리는 흰 링이에요. 인쇄 영역에 붙은 0.2 mm 회색 실선의 가운데를 자르면 0.1 mm 잔선이 흰 링과 흰 절단면 사이에
  // 남아, 링이 얇을 때(t 가 모듈에 가까울 때) 면 검출이 무너졌어요. 지금 도안은 모서리 바깥 재단 표시라 그 자리가 흰 종이예요.
  const code=codeFor({version:8,mode:3,tones:3,finder:'corners'}),phys=physicalHCube(buildHCubeModel(code.encoded));
  const plan=paperPlan(phys,{paper:'A4',thicknessMm:1,method:'board'}),ratio=plan.thicknessMm/plan.moduleMm;
  assert.ok(plan.warnings.includes('TLP_WARN_BOARD_EDGE')&&ratio>0.5&&ratio<0.6,`비율 ${ratio}`);
  assert.deepEqual(paperRoundTrip({...code,method:'board',thicknessMm:1,paper:'A4',bands:[null],growMm:0.1,label:'H8 corners A4 t=1.0'}),{read:3,skipped:0});
  // 자 검증: 같은 도안에 인쇄 영역에 붙은 0.2 mm 회색 실선(이전 도안)을 심으면 같은 자르기에서 판정이 무너져요.
  const scene=buildPaperSheet(phys,plan),w=0.2,gray={r:128,g:128,b:128};
  const ring=Object.values(scene.paper.faces).flatMap(({visible:v})=>[[v.x0-w,v.y0-w,v.x1+w,v.y0],[v.x0-w,v.y1,v.x1+w,v.y1+w],[v.x0-w,v.y0,v.x0,v.y1],[v.x1,v.y0,v.x1+w,v.y1]])
    .map(([x0,y0,x1,y1])=>({kind:'polygon',color:gray,qr:true,role:'cut',points:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]}));
  const png=sheetPng({...scene,shapes:[...scene.shapes,...ring]});
  const verdicts=phys.dataFaces.map(name=>{const f=scene.paper.faces[name];return verdict(cropFace(png,{region:grow(f.visible,0.1),face:f.rect,cellMm:f.cellMm})).verdict;});
  assert.ok(verdicts.some(v=>v!=='proper'),`붙은 실선을 심었는데 모든 면이 읽혔어요(${verdicts}) — 자가 잔선을 못 봐요`);
});

test('대조군: S = I 로 만든 도안은 같은 자에서 모든 데이터 면이 «거울상» 이에요',()=>{
  const phys=physicalHCube(buildHCubeModel(BASE.encoded),{swap:IDENTITY});
  const scene=buildPaperSheet(phys,paperPlan(phys,{thicknessMm:0.1})),png=sheetPng(scene);
  for(const name of phys.dataFaces){
    const f=scene.paper.faces[name],{original,mirrored,verdict:v}=verdict(cropFace(png,{region:f.visible,face:f.rect,cellMm:f.cellMm}));
    assert.equal(assertDecided(v,`S=I ${name}: ${original.faces.length}/${mirrored.faces.length}`),'mirrored',name);
    assert.ok(mirrored.faces.every(row=>row.mirror===false));
  }
});

test('심은 결함: 셀당 1픽셀로 뭉갠 자르기와 빈 면 자르기는 «판정 불가» 로 떨어져요',()=>{
  const phys=physicalHCube(buildHCubeModel(BASE.encoded)),scene=buildPaperSheet(phys,paperPlan(phys,{thicknessMm:0.1}));
  const f=scene.paper.faces.ZM,blank=scene.paper.faces.ZP;
  const coarse=paperPngPlan(scene,{dpi:25.4*scene.paper.faces.ZM.cellMm**-1});
  const tiny=decodePng(renderExportPng(scene,coarse));
  assert.equal(verdict(cropFace(tiny,{region:f.visible,face:f.rect,cellMm:f.cellMm},{dpi:coarse.ppi})).verdict,'undecidable');
  const png=sheetPng(scene);
  assert.equal(verdict(cropFace(png,{region:blank.visible,face:blank.rect,cellMm:blank.cellMm})).verdict,'undecidable');
});

fullOnly(()=>test('§6-15 배터리: 모드 1–6 × 배치 × 방식 3종 × 2·3톤 · corners 파인더 · 용지 셋',()=>{
  let faces=0,skipped=0;
  const add=r=>{faces+=r.read;skipped+=r.skipped;};
  const seen=new Set();
  for(const mode of [1,2,3,4,5,6])for(const tones of [2,3]){
    const code=codeFor({version:1,mode,tones,finder:'frame'});
    for(const arrangement of H_ARRANGEMENTS)for(const renderFaces of [3,6]){
      let map;try{map=hDisplayMap(code.encoded,{arrangement,renderFaces});}catch{continue;}
      if(seen.has(`${tones}:${map.cacheKey}`))continue;seen.add(`${tones}:${map.cacheKey}`);
      // 배치 조합은 A5 에서 재요(쪽 픽셀이 A4 의 절반). 용지별 차이는 아래 corners 묶음이 재요.
      const options={arrangement,renderFaces},label=`${mode}F/${arrangement}/rf${renderFaces}/${tones}톤 A5`;
      add(paperRoundTrip({...code,options,paper:'A5',method:'sheet',thicknessMm:0.3,label}));
      add(paperRoundTrip({...code,options,paper:'A5',method:'skin',thicknessMm:3.2,label}));
      add(paperRoundTrip({...code,options,paper:'A5',method:'board',thicknessMm:1,bands:[BOARD_EDGE],label}));
    }
  }
  for(const tones of [2,3]){
    const code=codeFor({version:5,mode:6,tones,finder:'corners'});
    for(const paper of ['A5','Letter','JISB4']){
      add(paperRoundTrip({...code,method:'sheet',thicknessMm:0.1,paper,label:`H5 6F corners ${tones}톤 ${paper}`}));
      add(paperRoundTrip({...code,method:'board',thicknessMm:0.8,paper,bands:[null,BOARD_EDGE],label:`H5 6F corners ${tones}톤 ${paper}`}));
    }
  }
  assert.ok(faces>=100,`읽은 면 ${faces}`);
  // A5 의 H5 조각(모듈 1.65 mm)에 0.8 mm 판은 경고 구간이라 판 색 띠 2건(2톤·3톤)만 건너뛰어요. 흰 절단면(null)은 읽었어요.
  assert.equal(skipped,2);
}));

fullOnly(()=>test('절단면 경고 경계: 경고가 없는 가장 두꺼운 판(0.4 × 모듈)에서 판 색 띠를 합성한 조립 모습이 읽혀요',()=>{
  for(const [finder,version,tones] of [['frame',2,2],['corners',5,2],['corners',5,3],['corners',8,2]])for(const paper of ['A5','A4']){
    const code=codeFor({version,mode:6,tones,finder}),phys=physicalHCube(buildHCubeModel(code.encoded));
    const side=paperPlan(phys,{paper,thicknessMm:0.3,method:'board'}).sideUm,t=Math.floor(4*side/(10*phys.n))/1000;
    if(t>1.3)continue;
    const plan=paperPlan(phys,{paper,thicknessMm:t,method:'board'}),label=`경계 ${finder} H${version} ${tones}톤 ${paper} t=${t}`;
    assert.deepEqual(plan.warnings.filter(w=>w==='TLP_WARN_BOARD_EDGE'),[],label);
    assert.deepEqual(paperRoundTrip({...code,method:'board',thicknessMm:t,paper,bands:[BOARD_EDGE],label}),{read:6,skipped:0});
  }
}));
