import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH,decodeH,hCapacity} from '../src/h-codec.js';
import {hModeFaces,hModeGroups,H_FACE_IDS} from '../src/h-profile.js';
import {hLayout,hCodebook,transformTag,hamming} from '../src/h-layout.js';
import {hCornerCodebook,transformCornerBits} from '../src/h-corner-layout.js';
import {createHCollector} from '../src/h-collector.js';
import {buildHScene,buildHFaceSheet} from '../src/h-render.js';
import {detectH} from '../src/h-detect.js';
import {rasterize} from '../src/raster.js';
import {relativeLuminance8} from '../src/luminance.js';
import {hDisplayMap,hContentFitsSingleView} from '../src/h-face-arrangement.js';
import {normalizeHViewControls,selectHFaceCount,reconcileHContentRotation,hUiLabel} from '../src/generator-h.js';
import {hHitToDecodeResult,createHScanRuntime} from '../src/h-scan-runtime.js';
import {hProgressModel} from '../src/h-scanner-ui.js';
import {buildHCubeModel,cubeModelToGltf,cubeNetScene} from '../src/cube-export.js';
import {cubeImageVoxelQuads} from '../src/cube-image-export.js';
import {voxelizeCube} from '../src/minecraft-schematic.js';
import {rasterToPng} from '../src/png.js';

const profile=e=>({version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,routeId:e.routeId,finder:e.finder});
const observation=e=>({ok:true,...profile(e),face:'XM',levels:e.faces.XM.slice(),rotation:0,mirror:false,hamming:0,quality:{score:.9}});
function field(scene){const r=rasterize(scene,{pixelsPerUnit:12,supersample:2}),data=new Float32Array(r.width*r.height);for(let k=0;k<data.length;k++)data[k]=relativeLuminance8(...r.pixels.subarray(k*4,k*4+3));return {width:r.width,height:r.height,data};}
function rotate90({width,height,data}){const out=new Float32Array(data.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++)out[x*height+height-1-y]=data[y*width+x];return {width:height,height:width,data:out};}
function mirrorX({width,height,data}){const out=new Float32Array(data.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++)out[y*width+x]=data[y*width+width-1-x];return {width,height,data:out};}

test('1면은 XM 하나이며 가상 pair member가 실제 face ID 목록에 섞이지 않아요',()=>{
 assert.deepEqual(hModeFaces(1),['XM']);assert.deepEqual(hModeGroups(1),[['XM']]);
 assert.equal(H_FACE_IDS.length,6);assert.equal(hUiLabel('face1','ko'),'1면');
});
test('새 1면 tag/marker는 기존 모든 D4 궤도와 거리5/8 이상이에요',()=>{
 for(const [book,transform,threshold,total] of [[hCodebook(),transformTag,5,21],[hCornerCodebook(),transformCornerBits,8,84]]){
  assert.equal(book.length,total);
  const orbit=row=>[false,true].flatMap(m=>[0,1,2,3].map(r=>transform(row.bits,r,m)));
  const old=book.filter(row=>row.mode!==1).flatMap(orbit),fresh=book.filter(row=>row.mode===1).flatMap(orbit);
  for(let i=0;i<fresh.length;i++){
   for(const prior of old)assert.ok(hamming(fresh[i],prior)>=threshold);
   for(let j=i+1;j<fresh.length;j++)assert.ok(hamming(fresh[i],fresh[j])>=threshold);
  }
 }
});
test('1면 576 지원 프로파일은 최대 본문 왕복, +1 overflow와 H0 48 미지원 경계를 지켜요',()=>{
 let supported=0,unsupported=0;
 for(const finder of ['frame','corners'])for(let version=0;version<9;version++)for(const tones of [2,3])for(const ecc of ['L','M','H'])for(let mask=0;mask<8;mask++){
  if(finder==='corners'&&version<5){assert.throws(()=>hCapacity(version,1,{tones,ecc,mask,finder}),RangeError);continue;}
  const p={version,mode:1,tones,ecc,mask,finder};
  if(version===0){assert.throws(()=>hCapacity(version,1,{tones,ecc,mask,finder}),/packet|심볼|패리티/);unsupported++;continue;}
  const cap=hCapacity(version,1,{tones,ecc,mask,finder}),half=Math.floor(hLayout(version,finder).scan.length/2),g=cap.groups[0];
  assert.equal(cap.groups.length,1);assert.deepEqual(g.faces,['XM','XM']);assert.deepEqual(g.scanOffsets,[0,half]);
  assert.equal(g.symbolCount,Math.floor(half/(tones===2?4:3)));assert.equal(cap.maxPayloadBytes,g.dataBytes-6);
  const bytes=Uint8Array.from({length:cap.maxPayloadBytes},(_,i)=>(i*37+mask+version)&255),e=encodeH(bytes,p),d=decodeH(e.faces,profile(e));
  assert.equal(d.ok,true,JSON.stringify(p)+' '+d.reason);assert.deepEqual(d.bytes,bytes);assert.deepEqual(Object.keys(e.faces),['XM']);
  assert.throws(()=>encodeH(new Uint8Array(cap.maxPayloadBytes+1),p),/용량 초과/);supported++;
 }
 assert.equal(supported,576);assert.equal(unsupported,48);
});
test('1면 강ECC 기본 URL은 양쪽 톤 모두 자동 H3을 선택해요',()=>{
 for(const tones of [2,3]){
  const e=encodeH('https://tl.estre.so',{mode:1,tones,ecc:'H',mask:7,finder:'auto'});
  assert.equal(e.version,3);assert.equal(e.finder,'frame');assert.equal(e.ecc,'H');assert.equal(decodeH(e.faces,profile(e)).text,'https://tl.estre.so');
  assert.equal(hCapacity(3,1,{tones,ecc:'H'}).maxPayloadBytes,tones===2?19:27);
 }
});
test('1면 ECC는 pair 양쪽 소거를 복구하고 모든 미사용 셀의 0과 도메인을 검사해요',()=>{
 for(const finder of ['frame','corners'])for(const tones of [2,3]){
  const e=encodeH('ECC single',{version:5,mode:1,tones,ecc:'H',mask:7,finder}),p=profile(e),scan=hLayout(5,finder).scan,half=Math.floor(scan.length/2),used=e.capacity.groups[0].usedCells;
  for(const offset of [0,half]){
   const damaged=structuredClone(e.faces);for(const c of scan.slice(offset,offset+4))damaged.XM[c.i*e.n+c.j]=255;
   const d=decodeH(damaged,p);assert.equal(d.ok,true,d.reason);assert.deepEqual(d.bytes,new TextEncoder().encode('ECC single'));
  }
  let tails=0;
  for(let k=0;k<scan.length;k++)if(!(k<used||k>=half&&k<half+used)){
   const damaged=structuredClone(e.faces),c=scan[k];assert.equal(damaged.XM[c.i*e.n+c.j],0);damaged.XM[c.i*e.n+c.j]=1;
   assert.equal(decodeH(damaged,p).reason,'pair-padding');tails++;
  }
  assert.equal(tails,scan.length-2*used);
  if(finder==='corners')assert.ok(tails>0);
  assert.equal(decodeH(e.faces,{...p,mode:2}).ok,false);
  assert.equal(decodeH({...e.faces,YM:e.faces.XM},p).ok,false);
  assert.equal(decodeH(e.faces,{...p,routeId:(p.routeId+1)&255}).ok,false);
  const swapped=structuredClone(e.faces);for(let k=0;k<half;k++){const a=scan[k],b=scan[k+half];[swapped.XM[a.i*e.n+a.j],swapped.XM[b.i*e.n+b.j]]=[swapped.XM[b.i*e.n+b.j],swapped.XM[a.i*e.n+a.j]];}
  assert.equal(decodeH(swapped,p).ok,false);
 }
});
test('단일 XM 관측은 전체 본문 검증 뒤에만 collector와 HUD 1/1로 완료해요',()=>{
 for(const finder of ['frame','corners']){
  const e=encodeH('one',{version:5,mode:1,ecc:'H',mask:7,finder}),c=createHCollector(),s=c.addFrame({observations:[observation(e)],frameId:0,timestamp:0});
  assert.equal(s.required,1);assert.equal(s.count,1);assert.equal(s.state,'DONE');assert.equal(s.result.text,'one');
  assert.equal(hProgressModel(s,'ko',{now:0}).required,1);
  assert.equal(c.addFrame({observations:[observation(e)],frameId:1,timestamp:1}).count,1);
  const broken=observation(e),scan=hLayout(5,finder).scan;for(const cell of scan)broken.levels[cell.i*e.n+cell.j]=0;
  const failed=createHCollector().addFrame({observations:[broken],frameId:0,timestamp:0});assert.equal(failed.state,'COLLECTING');assert.equal(failed.result,undefined);
 }
});
test('1면 3/6 미리보기·빈면 이미지 반복·명시 OFF·단일시점 게이트는 독립이에요',()=>{
 const e=encodeH('one',{version:3,mode:1,mask:7});
 for(const arrangement of ['isometric','horizontal','vertical']){
  const three=hDisplayMap(e,{arrangement,renderFaces:3}),six=hDisplayMap(e,{arrangement,renderFaces:6});
  assert.deepEqual(three.physicalDataFaces,['XM']);assert.equal(three.imageTargets.length,5);
  assert.deepEqual(six.physicalDataFaces,['XM','XP']);assert.equal(six.imageAlias.ZP,'ZM');assert.equal(six.imageAlias.YP,'YM');assert.equal(six.imageTargets.length,2);
  assert.throws(()=>hDisplayMap(e,{arrangement,renderFaces:1}),RangeError);
 }
 const state={type:'Y',yRepresentation:'3d',hFaces:1,hRenderFaces:3,hAutoRotate:false,hAutoRotateIntent:'auto',hArrangement:'isometric'};
 assert.equal(normalizeHViewControls(state).hFaces,1);assert.equal(selectHFaceCount({...state,hAutoRotate:true},2).hAutoRotate,true);
 assert.equal(hContentFitsSingleView(e,{XP:true},{renderFaces:3}),false);
 assert.equal(reconcileHContentRotation(state,{XP:true}).hAutoRotate,true);
 assert.equal(reconcileHContentRotation({...state,hAutoRotateIntent:'off'},{XP:true}).hAutoRotate,false);
 assert.equal(hContentFitsSingleView(e,{ZM:true,YM:true},{renderFaces:6}),true);
});
test('1면 frame/corners 양톤은 실제 픽셀 4회전을 읽고 거울은 거부해요',()=>{
 for(const finder of ['frame','corners'])for(const tones of [2,3]){
  const e=encodeH('one',{version:finder==='frame'?3:7,mode:1,tones,ecc:'H',mask:7,finder});
  let pixels=field(buildHFaceSheet(e));
  for(let r=0;r<4;r++){
   const found=detectH(pixels),row=found.faces.find(x=>x.face==='XM'&&x.mode===1);
   assert.ok(row,`${finder}/${tones}/rotation${r}: ${JSON.stringify(found.stats)}`);assert.equal(row.mirror,false);
   assert.equal(decodeH({XM:row.levels},profile(e)).text,'one');assert.equal(detectH(mirrorX(pixels)).faces.length,0);pixels=rotate90(pixels);
  }
  const scene=buildHScene(e,{perspective:.18});assert.ok(scene.hModel.visible.includes('XM'));
  const runtime=createHScanRuntime(),hit=runtime.pushFrame(field(buildHFaceSheet(e)),0,{frameId:0});
  assert.equal(hit?.text,'one');assert.equal(hit.layoutId,finder==='frame'?'h-v2s-1f':'h-v2sc-1f');
  assert.equal(hHitToDecodeResult(hit)?.payload,'one');assert.equal(runtime.stats.required,1);
 }
});
test('1면의 다섯 빈면과 반복 alias는 전개도·glTF·콘크리트 출력에 포함돼요',()=>{
 const e=encodeH('one',{version:3,mode:1,mask:7}),pixels=Uint8ClampedArray.of(142,32,33,255);
 const image={width:1,height:1,pixels,href:'data:image/png;base64,'+Buffer.from(rasterToPng({width:1,height:1,pixels})).toString('base64')};
 const faceImages=Object.fromEntries(H_FACE_IDS.map(face=>[face,image])),before=JSON.stringify(e.faces);
 for(const renderFaces of [3,6]){
  const model=buildHCubeModel(e,{renderFaces,faceImages}),expected=renderFaces===3?['ZM','YM','ZP','XP','YP']:['ZM','YM','ZP','YP'];
  assert.deepEqual(model.dataFaces,['XM']);assert.deepEqual(model.images.map(row=>row.face),expected);
  assert.deepEqual(cubeNetScene(model).shapes.filter(row=>row.kind==='image').map(row=>row.face),expected);
  assert.equal(cubeModelToGltf(model).images.length,expected.length);
  assert.deepEqual([...new Set([...cubeImageVoxelQuads(model,1)].map(row=>row.face))],expected);
  assert.ok(voxelizeCube(model,{scale:1}).palette.includes('minecraft:red_concrete'));
 }
 assert.equal(JSON.stringify(e.faces),before);
});
