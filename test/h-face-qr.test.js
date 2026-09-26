/** 타입 H 빈 면 TL 스캐너 QR(운영자 2026-09-25·26) — 자산 계약 · 파생 헬퍼 · 평면 판정 · 2.5D 판독/방향 · 출력 · 스캔 A/B.
 *  repo 에는 v1 QR 범용 디코더가 없어서, «판독» 은 모듈 중심을 면 사영으로 다시 읽는 구조 판독으로 재요.
 *  실기 BarcodeDetector·비스듬한 면(약 45°) 판독은 이 스위트가 못 재는 축이에요 — 운영자 실기 확인이 덮어요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {hFaceQrImage,hFaceQrMinBlockScale,H_FACE_QR_QUIET} from '../src/h-face-qr.js';
import {hFaceQrSummary,hEffectiveQrPosition,hCornerTooCorner,hQrPosition} from '../src/generator-h-qr.js';
import {qrMatrix,tlReaderUrlWithHint} from '../src/qr.js';
import {assertSceneImage,imageQuadTransform,projectImagePoint} from '../src/scene-image.js';
import {composeHFaceImage} from '../src/h-image-editor.js';
import {hDisplayMap} from '../src/h-face-arrangement.js';
import {hModeFaces} from '../src/h-profile.js';
import {hCanPreview25,hPlanarPreviewOptions} from '../src/h-preview-decor.js';
import {normalizeHViewControls} from '../src/generator-h.js';
import {encodeH} from '../src/h-codec.js';
import {buildHScene} from '../src/h-render.js';
import {rasterize} from '../src/raster.js';
import {relativeLuminance8} from '../src/luminance.js';
import {detectH} from '../src/h-detect.js';
import {createHScanRuntime} from '../src/h-scan-runtime.js';
import {hScreenSpin,hRotationPeriodMs} from '../src/h-rotation.js';
import {buildHCubeModel,cubeNetScene,cubeModelToGltf} from '../src/cube-export.js';
import {cubeImageVoxelQuads} from '../src/cube-image-export.js';
import {voxelizeCube} from '../src/minecraft-schematic.js';
import {sceneToSvg} from '../src/svg.js';
import {physicalHCube,physicalCubeModel,faceHandedness} from '../src/cube-physical.js';
import {paperPlan,buildPaperSheet} from '../src/paper-net.js';
import {buildPrintParts} from '../src/print-mesh.js';
import {classifyQrValue,routeQrHits,qrHitToDecodeResult,QR_VALUE_KIND} from '../src/qr-bridge.js';
import {GENERATOR_STATE_SCHEMA,createGeneratorState} from '../src/generator-state.js';
import {fullOnly} from './helpers/scope.mjs';

const TEXT=tlReaderUrlWithHint('Y');
const QR=hFaceQrImage(TEXT),MATRIX=qrMatrix(TEXT);
const allFaces=mode=>Object.fromEntries(hModeFaces(mode).map(face=>[face,true]));
const signedArea=points=>{let s=0;for(let k=0;k<points.length;k++){const a=points[k],b=points[(k+1)%points.length];s+=a.x*b.y-b.x*a.y;}return s/2;};
/** 이미지 사각형(TL·TR·BR·BL) 위의 모듈 중심을 래스터에서 다시 읽어요 — 구조 판독. */
function readModules(raster,shape,ppu){
  const m=imageQuadTransform(shape.points),total=MATRIX.size+2*H_FACE_QR_QUIET,dark=[],light=[];let bad=0;
  for(let r=0;r<MATRIX.size;r++)for(let c=0;c<MATRIX.size;c++){
    const p=projectImagePoint(m,(H_FACE_QR_QUIET+c+.5)/total,(H_FACE_QR_QUIET+r+.5)/total);
    const v=raster.pixels[(Math.floor(p.y*ppu)*raster.width+Math.floor(p.x*ppu))*4],on=MATRIX.modules[r*MATRIX.size+c]===1;
    (on?dark:light).push(v);if((v<128)!==on)bad++;
  }
  return {bad,maxDark:Math.max(...dark),minLight:Math.min(...light)};
}

test('QR 면 자산: 29모듈 × 35px 정수 피치 · 불투명 흑백 두 값 · quiet 4모듈 · 공유 객체 · 합성 항등',()=>{
  assert.equal(QR.width,1015);assert.equal(QR.height,1015);assert.equal(QR.qr.modulePx,35);assert.equal(QR.qr.size,21);assert.equal(QR.qr.quiet,4);
  assert.equal(QR.content,'qr');assert.equal(QR.pixelated,true);assert.equal(QR.qr.text,TEXT);assertSceneImage(QR);
  const values=new Set();let opaque=true;
  for(let k=0;k<QR.pixels.length;k+=4){values.add(`${QR.pixels[k]},${QR.pixels[k+1]},${QR.pixels[k+2]}`);if(QR.pixels[k+3]!==255)opaque=false;}
  assert.deepEqual([...values].sort(),['0,0,0','255,255,255']);assert.equal(opaque,true);
  const quiet=4*35;
  for(let y=0;y<QR.height;y++)for(let x=0;x<QR.width;x++)if(x<quiet||y<quiet||x>=QR.width-quiet||y>=QR.height-quiet)assert.equal(QR.pixels[(y*QR.width+x)*4],255);
  for(let r=0;r<21;r++)for(let c=0;c<21;c++){const k=(((4+r)*35+17)*QR.width+(4+c)*35+17)*4;assert.equal(QR.pixels[k]===0,MATRIX.modules[r*21+c]===1,`${r},${c}`);}
  assert.equal(hFaceQrImage(TEXT),QR,'같은 문구는 같은 객체예요');
  const other=hFaceQrImage('HTTPS://EXAMPLE.COM');assert.notEqual(other,QR);assert.equal(other.qr.text,'HTTPS://EXAMPLE.COM');
  const composed=composeHFaceImage(hFaceQrImage(TEXT),{fit:'contain',rotation:0,background:'#ffffff',size:1015});
  assert.deepEqual(Buffer.compare(Buffer.from(composed.pixels),Buffer.from(hFaceQrImage(TEXT).pixels)),0,'합성기를 거쳐도 바이트 동일해요');
  assert.throws(()=>hFaceQrImage('https://example.com'),'QR 문자셋 밖 문구는 코너 QR 과 같이 던져요');
});

test('면 QR 요약·유효 위치: 현재 대상만 세고, 대상 0·전부 점유를 사유로 가르고, 저장된 Y 안쪽은 없음으로 읽어요',()=>{
  const base={hFaces:3,hArrangement:'isometric',hRenderFaces:3};
  let s=hFaceQrSummary(base,{});
  assert.deepEqual([s.targets,s.fillable,s.available,s.reason,hEffectiveQrPosition('TL',s)],[['ZP','XP','YP'],['ZP','XP','YP'],true,null,'TL']);
  s=hFaceQrSummary(base,{ZP:{content:'qr'},XP:{content:'image'},YP:{content:'fill'}});
  assert.deepEqual([s.qr,s.fillable,hEffectiveQrPosition('TL',s),hEffectiveQrPosition('inner',s)],[['ZP'],['YP'],'inner','inner']);
  s=hFaceQrSummary(base,{ZP:{content:'image'},XP:{content:'text'},YP:{content:'image'}});
  assert.deepEqual([s.available,s.reason,hEffectiveQrPosition('BR',s)],[false,'occupied','BR']);
  s=hFaceQrSummary(base,{ZP:{content:'qr'},XP:{content:'qr'},YP:{content:'qr'}});
  assert.deepEqual([s.available,s.reason,s.fillable],[true,null,[]],'전부 QR 이면 열린 채 활성이에요(누르면 무동작 — 라디오 문법)');
  s=hFaceQrSummary({...base,hRenderFaces:6},{ZP:{content:'qr'}});
  assert.deepEqual([s.targets,s.available,s.reason,hEffectiveQrPosition('TL',s)],[[],false,'noTargets','TL'],'숨은 슬롯의 QR 은 세지 않아요');
  s=hFaceQrSummary({hFaces:6,hArrangement:'isometric',hRenderFaces:6},{});assert.equal(s.reason,'noTargets');
  // 1면 6면 렌더: ZM/ZP 별칭 — 대상은 ZM 한 장이에요.
  s=hFaceQrSummary({hFaces:1,hArrangement:'isometric',hRenderFaces:6},{ZM:{content:'qr'}});
  assert.deepEqual([s.targets,s.qr],[['ZM','YM'],['ZM']]);
  assert.equal(hEffectiveQrPosition('inner',hFaceQrSummary(base,{})),'none');assert.equal(hQrPosition('inner'),'none');
  assert.deepEqual(['TL','TR','BL','BR','none','inner',undefined].map(hCornerTooCorner),['TL','TR','BL','BR','TL','TL','TL']);
});

test('대상 0 은 6면과 아이소메트릭 3면 6면 렌더뿐이에요(안쪽 카드 잠김 조건)',()=>{
  const zero=[];
  for(const arrangement of ['isometric','horizontal','vertical','symmetric'])for(const mode of [1,2,3,4,5,6])for(const rf of [3,6]){
    const state=normalizeHViewControls({hFaces:mode,hArrangement:arrangement,hRenderFaces:rf});
    if(state.hFaces!==mode||state.hArrangement!==arrangement||state.hRenderFaces!==rf)continue;
    if(!hFaceQrSummary(state,{}).targets.length)zero.push(`${mode}F/${arrangement}/rf${rf}`);
  }
  assert.deepEqual(zero,['3F/isometric/rf6','6F/isometric/rf6']);
});

// 성질: «QR 한 장이 보이는 시점이 있으면 평면(2.5D) 가능» — 같은 QR 여러 장은 공유 id 하나로 세요.
test('평면 판정: QR 면은 공유 id 하나 — 1·2면 3면 렌더는 2.5D 가 살고, 3면 아이소는 이미지처럼 불가예요',()=>{
  const rows=[];
  for(const arrangement of ['isometric','horizontal','vertical'])for(const mode of [1,2,3]){
    const state=normalizeHViewControls({hFaces:mode,hArrangement:arrangement,hRenderFaces:3});
    const targets=hDisplayMap({mode,faces:allFaces(mode)},{arrangement,renderFaces:3}).imageTargets.map(t=>t.face);
    const qr=Object.fromEntries(targets.map(face=>[face,QR])),images=Object.fromEntries(targets.map(face=>[face,{...QR,content:'image'}]));
    rows.push([`${mode}F/${arrangement}`,hCanPreview25(state,qr),hCanPreview25(state,images)]);
  }
  assert.deepEqual(rows,[
    ['1F/isometric',true,false],['2F/isometric',true,false],['3F/isometric',false,false],
    ['1F/horizontal',true,false],['2F/horizontal',true,false],['3F/horizontal',false,false],
    ['1F/vertical',true,false],['2F/vertical',true,false],['3F/vertical',false,false]]);
  // 평면 시점은 QR 이 최소 한 장 보이는 자세예요.
  const encoded=encodeH('H inner QR',{version:3,mode:1,tones:3,ecc:'M',mask:7,finder:'auto'});
  const faceImages=Object.fromEntries(hDisplayMap(encoded,{arrangement:'isometric',renderFaces:3}).imageTargets.map(t=>[t.face,QR]));
  const view=hPlanarPreviewOptions(encoded,{perspective:.18,arrangement:'isometric',renderFaces:3},faceImages);assert.ok(view);
  assert.ok(buildHScene(encoded,{...view,faceImages}).shapes.some(shape=>shape.kind==='image'&&shape.image.content==='qr'));
});

test('2.5D: 모든 자세에서 QR 면은 거울이 아니고, 정면 가까이서는 모든 모듈이 선명하게 읽혀요(조명 프로필 포함)',()=>{
  const encoded=encodeH('H inner QR',{version:3,mode:1,tones:3,ecc:'M',mask:7,finder:'auto'});
  const options={arrangement:'isometric',renderFaces:3,perspective:.18,margin:2};
  const faceImages=Object.fromEntries(hDisplayMap(encoded,options).imageTargets.map(t=>[t.face,QR]));
  let best=null,checked=0;const steps=12;
  for(let i=0;i<steps;i++)for(let j=0;j<steps;j++){
    const pose={rotateX:i*2*Math.PI/steps,rotateY:j*2*Math.PI/steps};
    for(const shape of buildHScene(encoded,{...options,...pose,faceImages}).shapes.filter(s=>s.kind==='image')){
      const area=signedArea(shape.points);checked++;
      assert.ok(area>0,`${shape.face} @ ${i},${j}: 화면(y 아래)에서 TL→TR→BR 이 시계 방향이어야 거울이 아니에요`);
      if(!best||area>best.area)best={area,face:shape.face,pose};
    }
  }
  assert.ok(checked>200);
  const PPU=12;
  for(const lighting of [undefined,{profile:'screen'},{profile:'soft'},{profile:'print'},{profile:'original'}]){
    const scene=buildHScene(encoded,{...options,...best.pose,faceImages,lighting});
    const raster=rasterize(scene,{pixelsPerUnit:PPU,supersample:2});
    for(const shape of scene.shapes.filter(s=>s.kind==='image')){
      const read=readModules(raster,shape,PPU);
      // 가장 어두운 조명 프로필(original)의 gain 바닥은 .52 — 흰 모듈이 255·.52 아래로 내려가면 안 돼요.
      if(shape.face===best.face){assert.equal(read.bad,0,JSON.stringify(lighting));assert.equal(read.maxDark,0);assert.ok(read.minLight>=132,`${read.minLight}`);}
    }
  }
  // 정본 시점(아이소, facing≈0.58)의 두 QR 면도 모듈 중심은 맞아요 — 판독기 성능은 이 자가 아니라 실기 확인이 재요.
  const canonical=buildHScene(encoded,{...options,faceImages,lighting:{profile:'screen'}}),raster=rasterize(canonical,{pixelsPerUnit:24,supersample:2});
  const shown=canonical.shapes.filter(s=>s.kind==='image');assert.deepEqual(shown.map(s=>s.face).sort(),['YM','ZM']);
  for(const shape of shown)assert.equal(readModules(raster,shape,24).bad,0,shape.face);
});

test('출력: 모델·전개도·glTF·종이·.schem 에 QR 이 실리고, 3D 인쇄는 빼고 세요 — 별칭 면은 원래 슬롯을 보존해요',()=>{
  for(const [mode,options,expected] of [[3,{arrangement:'isometric',renderFaces:3},['XP<-XP','YP<-YP','ZP<-ZP']],[1,{arrangement:'isometric',renderFaces:6},['YM<-YM','YP<-YM','ZM<-ZM','ZP<-ZM']]]){
    const encoded=encodeH('H inner QR',{version:3,mode,tones:3,ecc:'M',mask:7,finder:'auto'});
    const faceImages=Object.fromEntries(hDisplayMap(encoded,options).imageTargets.map(t=>[t.face,QR]));
    const model=buildHCubeModel(encoded,{faceImages,...options});
    assert.deepEqual(model.images.map(p=>`${p.face}<-${p.sourceFace}`).sort(),expected);assert.ok(model.images.every(p=>p.image===QR));
    // 3D 데이터 전개도: 2026-09-26 부터 물리 좌표(PHYSICAL_SWAP)로 펼쳐 코드 면과 함께 거울이 아니에요.
    // (의도적 뒤집기: 이전에는 «기존 거울» 양성 락 signedArea < 0 이었어요 — test/cube-data-orientation 이 접어서 판독까지 재요.)
    const net=cubeNetScene(model).shapes.filter(s=>s.kind==='image');
    assert.equal(net.length,expected.length);assert.ok(net.every(s=>signedArea(s.points)>0),'전개도 이미지 사각형은 거울이 아니에요');
    assert.equal(cubeModelToGltf(model).images.length,expected.length);
    // 종이 전개도(제작 도안)는 거울이 아니에요.
    const phys=physicalHCube(model);assert.ok([...faceHandedness(phys).values()].every(sign=>sign===1));
    const sheet=buildPaperSheet(phys,paperPlan(phys,{paper:'A4',thicknessMm:.1,method:'sheet'}));
    const paper=sheet.shapes.filter(s=>s.kind==='image');assert.equal(paper.length,expected.length);assert.ok(paper.every(s=>signedArea(s.points)>0&&s.image===QR));
    // 3D 인쇄(3MF/STL)는 이미지처럼 빼고 세요 — UI 는 g1103 을 띄워요.
    assert.equal(buildPrintParts(phys).report.imagesOmitted,expected.length);
    // .schem: 블록 색은 흑/백 두 값뿐이에요(판독 가능 여부는 셀당 블록 수 — 기존 안내가 말해요).
    const colors=new Set();for(const quad of cubeImageVoxelQuads(model,Math.ceil(50/model.n)))colors.add(`${quad.color.r},${quad.color.g},${quad.color.b}`);
    assert.deepEqual([...colors].sort(),['0,0,0','255,255,255']);
  }
});

// ── 방향 락(2026-09-26 수정 후): 3D 데이터 출력(glTF·.schem·전개도 SVG)의 면 QR 은 거울이 아니에요 ─────────────
// 수정 전에는 모델 좌표 출력이 코드 면처럼 거울이라 glTF·.schem 을 «기존 거울» 양성으로 잠갔어요. 모델 좌표 거울을 writer 의
// 물리 좌표 사상(PHYSICAL_SWAP)으로 고쳐 그 락을 «거울 아님» 으로 의도적으로 뒤집었어요. 락마다 심은 결함 — writer 앞에서
// 모델을 한 번 더 뒤집은 사본(= 수정 전 좌표) — 에서 빨개지는지 같이 재요. 2.5D SVG 는 이미지 정의와 use 의 합성 변환을 재요.
const sub=(a,b)=>a.map((v,k)=>v-b[k]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
/** 심은 결함: writer 가 다시 반사하므로 결과 좌표는 수정 전(모델 좌표 그대로)과 같아요. 면 이름은 옮긴 평면 이름으로 맞춰요. */
function remirror(model){
  const w=physicalCubeModel(model);
  return {...w,space:undefined,quads:w.quads.map(q=>({...q,face:q.plane})),images:w.images.map(p=>({...p,face:p.plane}))};
}
function qrModel(version,mode,options={arrangement:'isometric',renderFaces:3},payload='H inner QR'){
  const encoded=encodeH(payload,{version,mode,tones:3,ecc:'M',mask:7,finder:'auto'});
  const faceImages=Object.fromEntries(hDisplayMap(encoded,options).imageTargets.map(t=>[t.face,QR]));
  return buildHCubeModel(encoded,{faceImages,...options});
}
/** .schem 을 Minecraft(오른손: X 동 · Y 위 · Z 남)의 바깥 여섯 면마다, 면 바깥에 선 사람의 오른쪽·아래로 읽어 QR 모듈 중심과 대조해요.
 *  정사각형 대칭 8가지(회전 4 · 반사 4) 중 가장 잘 맞는 것과 맞은 모듈 수를 여섯 면 모두 돌려줘요(face = 'MC x,y,z').
 *  어느 MC 면에 QR 이 있어야 하는지는 락이 만들기용 경로(physicalHCube)에서 따로 유도해 대조해요 — writer 의 사상을 쓰지 않아요. */
function schemQrFaces(model,scale,{defect=false}={}){
  const vox=defect?mirrorVoxels(voxelizeCube(model,{scale})):voxelizeCube(model,{scale}),S=vox.width,side=S-2,n=MATRIX.size,total=n+2*H_FACE_QR_QUIET;
  const at=p=>vox.palette[vox.blocks[p[0]+p[2]*S+p[1]*S*S]];
  const D4=[['rot0',(r,c)=>[r,c]],['rot90',(r,c)=>[c,n-1-r]],['rot180',(r,c)=>[n-1-r,n-1-c]],['rot270',(r,c)=>[n-1-c,r]],
    ['mirLR',(r,c)=>[r,n-1-c]],['mirUD',(r,c)=>[n-1-r,c]],['transpose',(r,c)=>[c,r]],['antiTranspose',(r,c)=>[n-1-c,n-1-r]]];
  const rows=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(mcOut=>{
    const fwd=mcOut.map(v=>-v),up=Math.abs(mcOut[1])===1?[0,0,-1]:[0,1,0];
    const right=cross(fwd,up),down=up.map(v=>-v),start=mcOut.map((v,k)=>v>0?S-1:v<0?0:right[k]>0||down[k]>0?1:S-2);
    const hits=D4.map(()=>0);
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      const u=Math.floor((H_FACE_QR_QUIET+c+.5)/total*side),v=Math.floor((H_FACE_QR_QUIET+r+.5)/total*side);
      const dark=at(start.map((s,k)=>s+right[k]*u+down[k]*v))==='minecraft:black_concrete';
      D4.forEach(([,map],k)=>{const [a,b]=map(r,c);if(dark===(MATRIX.modules[a*n+b]===1))hits[k]++;});
    }
    const best=hits.indexOf(Math.max(...hits));
    return {face:`MC ${mcOut.join(',')}`,name:D4[best][0],reflection:best>=4,hits:hits[best],rotationBest:Math.max(...hits.slice(0,4)),reflectionBest:Math.max(...hits.slice(4))};
  });
  return rows;
}
/** 가장 잘 맞는 MC 면을 QR 면 수만큼 골라요(심은 결함처럼 위치를 미리 알 수 없는 쪽에 써요). */
const bestSchemRows=(rows,count)=>rows.slice().sort((a,b)=>b.hits-a.hits).slice(0,count);
/** 면 QR 이 놓여야 할 MC 면 — 만들기용 PhysCube 가 그 면을 두는 물리 평면의 바깥 법선 n 을 MC Y-up 회전 [n0, −n2, n1] 로 옮겨요.
 *  (수정 전 락은 모델 좌표 법선 OUT[face] 에서 같은 회전으로 유도했어요 — 물리 좌표로 옮겨 쓰면서 기준을 PhysCube 로 바꿨어요.) */
function expectedSchemQrFaces(model){
  const phys=physicalHCube(model);
  return model.images.map(({face})=>{const nrm=phys.faces[face].normal;return `MC ${[nrm[0],-nrm[2],nrm[1]].join(',')}`;});
}
/** 심은 결함(.schem): 블록 배열의 MC X·Z 를 맞바꾼 반사(det −1)예요 — 수정 전 .schem 과 같은 배치예요.
 *  (면 이미지 블록은 시트 틀에서 표본하므로 모델을 한 번 더 뒤집는 remirror 로는 되돌아가지 않아서, 출력 쪽을 뒤집어요.) */
function mirrorVoxels(vox){
  const S=vox.width,blocks=new Uint8Array(vox.blocks.length);
  for(let y=0;y<S;y++)for(let z=0;z<S;z++)for(let x=0;x<S;x++)blocks[x+z*S+y*S*S]=vox.blocks[z+x*S+y*S*S];
  return {...vox,blocks};
}
/** glTF 면 QR 프리미티브마다 sign(cross(UV 오른쪽, UV 아래) · 바깥 법선). 바깥 법선은 파일 좌표에서 유도해요(면 축 = 네 꼭짓점이 같은 축). */
function gltfQrSigns(model){
  const gltf=cubeModelToGltf(model),n=model.n;
  const read=index=>{const accessor=gltf.accessors[index],view=gltf.bufferViews[accessor.bufferView],raw=Buffer.from(gltf.buffers[view.buffer].uri.split(',')[1],'base64'),from=raw.byteOffset+(view.byteOffset??0);return new Float32Array(raw.buffer.slice(from,from+view.byteLength));};
  const prims=gltf.meshes[0].primitives.filter(prim=>prim.attributes.TEXCOORD_0!==undefined);
  assert.equal(prims.length,model.images.length);
  return prims.map(prim=>{
    const pos=read(prim.attributes.POSITION),uv=read(prim.attributes.TEXCOORD_0),corner=(u,v)=>{const i=[0,1,2,3].find(j=>uv[j*2]===u&&uv[j*2+1]===v);return [pos[i*3],pos[i*3+1],pos[i*3+2]];};
    const axis=[0,1,2].find(k=>[1,2,3].every(i=>pos[i*3+k]===pos[k])),out=[0,0,0];out[axis]=pos[axis]>n/2?1:-1;
    const tl=corner(0,0);return Math.sign(dot(cross(sub(corner(1,0),tl),sub(corner(0,1),tl)),out));
  });
}
/** SVG 안 면 이미지의 합성 변환(use × 이미지 정의) 행렬식 부호 목록이에요. 이미지 공간(y 아래) → SVG(y 아래)라 > 0 이면 거울이 아니에요. */
function svgImageSigns(svg){
  const det=text=>{const [a,b,c,d]=text.trim().split(/[\s,]+/).map(Number);return a*d-b*c;},defs=new Map(),signs=[];
  for(const [,id,attrs] of svg.matchAll(/<image id="([^"]+)"([^>]*)>/g)){
    const transform=attrs.match(/\stransform="([^"]*)"/)?.[1];
    if(transform===undefined){defs.set(id,1);continue;}
    const matrix=transform.match(/^matrix\(([^)]*)\)$/);assert.ok(matrix,`이미지 정의 변환은 matrix 형태만 재요: ${transform}`);defs.set(id,det(matrix[1]));
  }
  for(const [,id,matrix] of svg.matchAll(/<use href="#([^"]+)" transform="matrix\(([^)]*)\)"/g)){assert.ok(defs.has(id),id);signs.push({id,sign:Math.sign(det(matrix)*defs.get(id))});}
  return signs;
}

test('방향 락 — glTF: 오른손 좌표에서 바깥에서 본 QR 면은 거울이 아니에요 · 심은 결함(한 번 더 뒤집기)은 빨개져요',()=>{
  // glTF UV (0,0) 은 이미지 좌상이에요. 바깥에서 볼 때 거울이 아니면 cross(오른쪽, 아래)·바깥 법선 < 0 이에요.
  // (의도적 뒤집기: 수정 전 락은 «기존 거울» sign > 0 이었어요.)
  for(const model of [qrModel(3,1),qrModel(3,3)]){
    assert.deepEqual(gltfQrSigns(model),model.images.map(()=>-1),'glTF QR 면은 거울이 아니에요');
    assert.deepEqual(gltfQrSigns(remirror(model)),model.images.map(()=>1),'심은 결함: 거울 glTF 는 이 락에서 빨개져야 해요');
  }
});

test('방향 락 — .schem: 면 QR 은 PhysCube 평면의 MC 면에 놓이고, 바깥에서 본 QR 이 정본 QR 과 회전으로 모든 모듈이 맞으며 어떤 반사와도 안 맞아요 · 심은 결함은 빨개져요',()=>{
  // (의도적 뒤집기: 수정 전 락은 «반사로만 441» 이었어요. 위치 대조는 유지하되 기준 법선을 모델 좌표에서 PhysCube 로 옮겼어요.)
  for(const model of [qrModel(3,1),qrModel(3,3)]){
    const rows=schemQrFaces(model,4),expected=expectedSchemQrFaces(model);
    assert.equal(new Set(expected).size,model.images.length,'면 QR 마다 다른 MC 면이어야 해요');
    // 위치: 기대한 MC 면이 곧 가장 잘 맞는 면들이에요(다른 MC 면에 QR 이 새지 않아요).
    assert.deepEqual(bestSchemRows(rows,model.images.length).map(r=>r.face).sort(),[...expected].sort(),'.schem 면 QR 이 PhysCube 평면의 MC 면에 있어야 해요');
    for(const face of expected){
      const row=rows.find(r=>r.face===face);
      assert.equal(row.hits,441,`${row.face}: ${row.name}`);assert.equal(row.reflection,false,`${row.face}: .schem QR 면이 거울이에요(${row.name})`);
      assert.ok(row.reflectionBest<441,`${row.face}: 반사로도 맞으면 거울 여부를 가를 수 없어요`);
    }
    for(const row of bestSchemRows(schemQrFaces(model,4,{defect:true}),model.images.length))assert.equal(row.reflection,true,`심은 결함 ${row.face}: 거울 .schem 은 이 락에서 빨개져야 해요(${row.name})`);
  }
});

test('방향 락 — 3D 데이터 전개도 SVG: 면 QR 의 합성 변환은 거울이 아니에요 · 심은 결함은 빨개져요',()=>{
  for(const model of [qrModel(3,1),qrModel(3,3)]){
    const signs=svgImageSigns(sceneToSvg(cubeNetScene(model)));
    assert.ok(signs.length>0,'QR 이미지가 실제로 전개도 SVG 에 있어야 빈 자가 아니에요');
    assert.deepEqual([...new Set(signs.map(s=>s.sign))],[1],'전개도 SVG 면 QR 은 거울이 아니에요');
    assert.deepEqual([...new Set(svgImageSigns(sceneToSvg(cubeNetScene(remirror(model)))).map(s=>s.sign))],[-1],'심은 결함: 거울 전개도는 이 락에서 빨개져야 해요');
  }
});

test('.schem 블록 수 하한: hFaceQrMinBlockScale 에서 모든 모듈이 맞고, 한 칸 아래에서는 깨져요(실제 복셀로 재요)',()=>{
  const rows=[];
  for(const version of [1,3,4]){
    const model=qrModel(version,1,undefined,'H'),min=hFaceQrMinBlockScale(model);
    const expected=expectedSchemQrFaces(model),allRight=scale=>{
      const own=schemQrFaces(model,scale).filter(row=>expected.includes(row.face));
      assert.equal(own.length,expected.length,'QR 면마다 MC 면 하나');return own.every(row=>row.hits===441);
    };
    rows.push([`H${version}`,model.n,min]);
    assert.equal(allRight(min),true,`H${version} n=${model.n}: ${min} × ${min} 에서 모든 모듈이 맞아요`);
    if(min>1)assert.equal(allRight(min-1),false,`H${version} n=${model.n}: ${min-1} × ${min-1} 에서는 모듈이 빠져요`);
  }
  assert.deepEqual(rows,[['H1',17,2],['H3',25,2],['H4',29,1]]);
  // QR 면이 없으면 1 이에요(안내 없음).
  assert.equal(hFaceQrMinBlockScale(buildHCubeModel(encodeH('H inner QR',{version:3,mode:1,tones:3,ecc:'M',mask:7,finder:'auto'}),{arrangement:'isometric',renderFaces:3})),1);
});

test('방향 락 — SVG: QR 면 이미지의 합성 변환(use × 이미지 정의)은 모든 자세에서 거울이 아니에요',()=>{
  const encoded=encodeH('H inner QR',{version:3,mode:1,tones:3,ecc:'M',mask:7,finder:'auto'});
  const options={arrangement:'isometric',renderFaces:3,perspective:.18,margin:2};
  const faceImages=Object.fromEntries(hDisplayMap(encoded,options).imageTargets.map(t=>[t.face,QR]));
  let uses=0;
  for(const [rotateX,rotateY] of [[0,0],[.4,.3],[1.2,-.5],[2.5,1],[-.8,2]]){
    for(const {id,sign} of svgImageSigns(sceneToSvg(buildHScene(encoded,{...options,rotateX,rotateY,faceImages})))){
      uses++;
      // 이미지 공간(y 아래) → SVG(y 아래)라 합성 행렬식 > 0 이면 거울이 아니에요.
      assert.ok(sign>0,`${id} @ ${rotateX},${rotateY}: SVG QR 면이 거울이면 안 돼요`);
    }
  }
  assert.ok(uses>0,'QR 이미지가 실제로 SVG 에 있어야 빈 자가 아니에요');
});

test('기본 문구는 스캐너에서 TL 힌트(cube)라 노출·자동 열기가 없어요',()=>{
  const hit=classifyQrValue(TEXT);
  assert.equal(hit.kind,QR_VALUE_KIND.TL_HINT);assert.equal(hit.family,'cube');
  assert.equal(routeQrHits([hit]).expose,null);assert.equal(qrHitToDecodeResult(hit),null);
});

test('면 QR 은 저장·공유 상태에 들어가지 않아요(페이지 메모리 전용)',()=>{
  const keys=Object.keys(GENERATOR_STATE_SCHEMA);
  assert.deepEqual(keys.filter(key=>/face.?(qr|image)|hFaceQr/i.test(key)),[]);
  assert.deepEqual(Object.keys(createGeneratorState()).filter(key=>/face.?(qr|image)|hFaceQr/i.test(key)),[]);
});

// ── 스캔 A/B: QR 팔(빈 면 QR)과 대조 팔(빈 면 단색)의 H 검출이 같아야 해요 ─────────────────────
// 정확도 축(태그·거울·가짜 면·DONE 프레임·원문)을 게이트로 재고, 성분 수는 지연 축의 기록으로만 남겨요(벽시계 금지).
const PPU_SCAN=12,PAYLOAD='https://tl.estre.so/h-inner-qr';
const luma=raster=>{const data=new Float32Array(raster.width*raster.height);for(let i=0,o=0;i<data.length;i++,o+=4)data[i]=relativeLuminance8(raster.pixels[o],raster.pixels[o+1],raster.pixels[o+2]);return {width:raster.width,height:raster.height,data};};
const inside=(p,poly)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)c=!c;}return c;};
function scanAB(t,{version,finder,mode,poses}){
  const encoded=encodeH(PAYLOAD,{version,mode,tones:3,ecc:'M',mask:7,finder}),options={arrangement:'isometric',renderFaces:3};
  const faceImages=Object.fromEntries(hDisplayMap(encoded,options).imageTargets.map(target=>[target.face,QR]));
  const runtimes=[0,1].map(()=>createHScanRuntime({detect:detectH,coldIntervalMs:0,activeIntervalMs:0})),done=[null,null],texts=[null,null];
  let qrVisible=0;const components=[[],[]];
  poses.forEach((pose,k)=>{
    const view={perspective:.18,...pose,...options,margin:2},withQr=buildHScene(encoded,{...view,faceImages}),plain=buildHScene(encoded,view);
    const fields=[withQr,plain].map(scene=>luma(rasterize(scene,{pixelsPerUnit:PPU_SCAN,supersample:2})));
    const [dq,dc]=fields.map(field=>detectH(field,{maxComponents:128}));
    const tags=d=>[...new Set(d.faces.map(f=>`${f.face}:${f.version}`))].sort();
    assert.deepEqual(tags(dq),tags(dc),`${finder} H${version} ${mode}F 프레임 ${k}: 태그 집합이 같아야 해요`);
    assert.ok(dq.faces.every(f=>f.mirror===false),`프레임 ${k}: 거울 판정 없음`);
    const polys=withQr.shapes.filter(s=>s.kind==='image').map(s=>s.points.map(p=>({x:p.x*PPU_SCAN,y:p.y*PPU_SCAN})));qrVisible+=polys.length;
    for(const f of dq.faces){const c=f.quad.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});assert.ok(!polys.some(poly=>inside(c,poly)),`프레임 ${k}: QR 위에 가짜 H 면`);}
    components[0].push(dq.stats.components);components[1].push(dc.stats.components);
    fields.forEach((field,arm)=>{const hit=runtimes[arm].pushFrame(field,k*1000,{frameId:`${arm}-${k}`,force:true});if(hit&&done[arm]===null){done[arm]=k;texts[arm]=hit.text;}});
  });
  assert.ok(qrVisible>0,'QR 이 실제로 보이는 프레임이 있어야 무해 표적이 아니에요');
  assert.deepEqual(done,[done[1],done[1]],'두 팔이 같은 프레임에서 DONE');assert.notEqual(done[1],null);
  assert.deepEqual(texts,[PAYLOAD,PAYLOAD]);
  t.diagnostic(`H${version} ${finder} ${mode}F · QR 가시 ${qrVisible} · 성분 QR ${components[0].join('/')} · 대조 ${components[1].join('/')} (지연 축 기록, 게이트 아님)`);
}
const spin=(axis,ks,of=12)=>ks.map(k=>hScreenSpin(k*hRotationPeriodMs({axis})/of,{axis}));
test('스캔 A/B: 1면 정본(QR 이 코드 면 옆에 보여요)·3면 회전 프레임 — H 검출·수집 결과가 같아요',t=>{
  // 3면 정본 시점은 빈 면이 전부 뒷면이라 QR 이 안 보여요(무해 표적) — 그래서 회전 프레임부터 누적해요.
  scanAB(t,{version:3,finder:'frame',mode:1,poses:[{rotateX:0,rotateY:0,rotateZ:0}]});
  scanAB(t,{version:3,finder:'frame',mode:3,poses:spin('x',[1,3,5,7,9,11])});
});
fullOnly(()=>test('스캔 A/B(전수): 1면 H7 사각 파인더·1면 H3 회전 프레임',t=>{
  scanAB(t,{version:7,finder:'corners',mode:1,poses:[{rotateX:0,rotateY:0,rotateZ:0},...spin('x',[1,3,5,7,9,11])]});
  scanAB(t,{version:3,finder:'frame',mode:1,poses:spin('y',[1,3,5,7,9,11])});
}));
