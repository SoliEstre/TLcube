/**
 * §6-2 판독 왕복 — 물리 산출물을 S 와 무관한 오른손 카메라로 찍어 기존 H 검출·복호기로 원문이 돌아오는지 재요.
 * 이 파일이 물리 좌표 교환 S 의 결정 근거이자(설계 §2.1 0단계 (b)) 산출물 거울 여부의 수호자예요.
 *   (a) 면별: 각 데이터 물리 면을 그 면의 바깥 법선에서만 만든 오른손 카메라 4대(면 안 회전 4종)로 정사영해요.
 *   (b) 등각: 숫자 상수 카메라(정본 시점 꼭짓점 쪽 · 반대 꼭짓점 쪽). 오른손인지는 여기서 따로 단언해요.
 *   대조군: 같은 카메라로 S = I 산출을 찍으면 면이 0개여야 해요(검출기는 거울 면을 거부해요).
 * 두 표면을 재요: 착지 ① 은 PhysCube 면 격자, 착지 ② 는 3D 인쇄 «최종 메쉬»(buildPrintParts 산출)예요.
 * 최종 메쉬는 기록된 인쇄 방향 회전 Q 의 역으로 되돌린 뒤(det Q = +1 단언) 매립 파트의 바깥 삼각형 색만으로 렌더해요
 * (test/helpers/print-mesh-view.mjs) — 면 격자를 읽지 않아서, 메쉬를 만드는 경로의 반사·회전 실수를 직접 잡아요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH,decodeH,hCapacity} from '../src/h-codec.js';
import {H_ARRANGEMENTS,hDisplayMap} from '../src/h-face-arrangement.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {buildHScene} from '../src/h-render.js';
import {physicalHCube,faceHandedness,orientForBed} from '../src/cube-physical.js';
import {buildPrintParts} from '../src/print-mesh.js';
import {fullOnly} from './helpers/scope.mjs';
import {det3,meshSurface,mirrorSurfaceFace,detectMeshView} from './helpers/print-mesh-view.mjs';
import {ISO_FRONT,ISO_BACK,cross,dot,faceCameras,forwardOf,leftHanded,mirrorOneFace,detectPhysView,physViewScene} from './helpers/h-physical-camera.mjs';

const IDENTITY=[[1,0,0],[0,1,0],[0,0,1]];
const profile=e=>({version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,routeId:e.routeId,finder:e.finder});
const near=(a,b,eps=1e-12)=>a.every((v,k)=>Math.abs(v-b[k])<=eps);

/** 용량에 맞춘 결정적 본문이에요(최대 8바이트). */
function codeFor({version,mode,tones,finder,ecc='M',mask=0}){
  const cap=hCapacity(version,mode,{tones,ecc,mask,finder}).maxPayloadBytes,length=Math.max(1,Math.min(8,cap));
  const bytes=Uint8Array.from({length},(_,k)=>(k*53+version*7+mode*11+tones)&255);
  return {bytes,encoded:encodeH(bytes,{version,mode,tones,ecc,mask,finder})};
}
function cube(encoded,options,swap,cellUm){
  const model=buildHCubeModel(encoded,options);
  return {model,map:hDisplayMap(encoded,options),phys:physicalHCube(model,{...(swap?{swap}:{}),...(cellUm?{cellUm}:{})})};
}
/** PhysCube 면 격자를 찍는 기본 보기예요. 최종 메쉬는 meshViewer 로 바꿔 끼워요 — 같은 자를 두 표면에 써요. */
const physViewer=phys=>(camera,options)=>detectPhysView(phys,camera,options);
const meshViewer=(surface,phys)=>(camera,options)=>detectMeshView(surface,phys,camera,options);
/**
 * (a) 면별 왕복. pick(카메라 4대, 면 순번) 이 그 면에 쓸 카메라를 골라요(기본은 4대 전부).
 * 모든 검출은 거울이 아니고, 물리 면이 싣는 논리 면이며, 레벨이 원래 면과 같아야 해요. 모은 레벨은 원문으로 복호돼요.
 */
function perFaceRoundTrip({encoded,bytes,map,phys,label,pick=all=>all,view=physViewer(phys)}){
  const levels={};let reads=0;
  phys.dataFaces.forEach((name,index)=>{
    const logical=map.physicalToLogical[name];
    for(const camera of pick(faceCameras(phys.faces[name].normal),index)){
      const seen=view(camera,{faces:[name]}),context=`${label} ${name}(${logical}) ${camera.name}`;
      assert.deepEqual(seen.drawn,[name],context);
      assert.ok(seen.faces.length>=1,`${context}: 면 0개 ${JSON.stringify(seen.rejected?.slice(0,3))}`);
      for(const row of seen.faces){
        assert.equal(row.mirror,false,context);assert.equal(row.face,logical,context);assert.equal(row.version,encoded.version,context);
        assert.deepEqual([...row.levels],[...encoded.faces[logical]],context);
      }
      levels[logical]=seen.faces[0].levels;reads++;
    }
  });
  const decoded=decodeH(levels,profile(encoded));
  assert.equal(decoded.ok,true,`${label}: ${decoded.reason}`);assert.deepEqual(decoded.bytes,bytes,label);
  return reads;
}
/** (b) 등각 왕복. 두 고정 카메라가 보는 데이터 면이 모두 거울 아님으로 읽히고, 두 장을 합치면 원문이에요. */
function isoRoundTrip({encoded,bytes,map,phys,label,view=physViewer(phys)}){
  const levels={};
  for(const camera of [ISO_FRONT,ISO_BACK]){
    const seen=view(camera),context=`${label} ${camera.name}`;
    const expected=new Set(seen.drawn.filter(name=>!phys.faces[name].blank).map(name=>map.physicalToLogical[name]));
    assert.deepEqual(new Set(seen.faces.map(row=>row.face)),expected,context);
    for(const row of seen.faces){
      assert.equal(row.mirror,false,context);assert.deepEqual([...row.levels],[...encoded.faces[row.face]],context);
      levels[row.face]=row.levels;
    }
  }
  const decoded=decodeH(levels,profile(encoded));
  assert.equal(decoded.ok,true,`${label}: ${decoded.reason}`);assert.deepEqual(decoded.bytes,bytes,label);
}
/**
 * 대조군: S = I 산출은 같은 카메라들로 면 0개예요. 그 면을 실제로 그렸는데 0개여야 해요(아무것도 안 그려서 0개인 대조군은
 * 비어 있는 자예요).
 */
function controlIsDark({phys,label,pick=all=>all,view=physViewer(phys)}){
  assert.deepEqual([...new Set(faceHandedness(phys).values())],[-1],label);
  phys.dataFaces.forEach((name,index)=>{
    for(const camera of pick(faceCameras(phys.faces[name].normal),index)){
      const seen=view(camera,{faces:[name]});
      assert.deepEqual(seen.drawn,[name],`${label} S=I ${name} ${camera.name}: 그린 면`);
      assert.equal(seen.faces.length,0,`${label} S=I ${name} ${camera.name}`);
    }
  });
  for(const camera of [ISO_FRONT,ISO_BACK]){
    const seen=view(camera);
    assert.equal(seen.drawn.length,3,`${label} S=I ${camera.name}: 그린 면 ${seen.drawn}`);
    assert.equal(seen.faces.length,0,`${label} S=I ${camera.name}`);
  }
}

test('카메라는 오른손이에요: 등각 상수 R×D = ±(1,1,1)/√3, 면별 카메라 R×D = −n',()=>{
  const third=1/Math.sqrt(3);
  for(const [camera,sign] of [[ISO_FRONT,1],[ISO_BACK,-1]]){
    assert.ok(Math.abs(dot(camera.right,camera.right)-1)<1e-12&&Math.abs(dot(camera.down,camera.down)-1)<1e-12);
    assert.ok(Math.abs(dot(camera.right,camera.down))<1e-12);
    assert.ok(near(cross(camera.right,camera.down),[sign*third,sign*third,sign*third]),camera.name);
  }
  // 설계 §2.1 의 상수 그대로예요(S 에서 계산하지 않아요).
  assert.ok(near(ISO_FRONT.right,[-Math.SQRT1_2,Math.SQRT1_2,0]));
  assert.ok(near(ISO_FRONT.down,[-1/Math.sqrt(6),-1/Math.sqrt(6),2/Math.sqrt(6)]));
  for(let axis=0;axis<3;axis++)for(const s of [-1,1]){
    const normal=[0,0,0];normal[axis]=s;
    const cams=faceCameras(normal);
    assert.equal(new Set(cams.map(c=>c.right.join())).size,4);
    const plain=v=>v.map(x=>x+0);
    for(const c of cams){assert.deepEqual(plain(cross(c.right,c.down)),plain(normal.map(v=>-v)));assert.equal(dot(c.right,normal),0);}
    assert.deepEqual(plain(forwardOf(leftHanded(cams[0]))),plain(normal));
  }
});

test('심은 결함: 왼손 카메라와 한 면만 거울로 만든 사본은 자가 빨갛게 잡아요',()=>{
  const {encoded,bytes}=codeFor({version:0,mode:3,tones:3,finder:'frame'}),{map,phys}=cube(encoded,{});
  // 왼손 카메라(D 반전)는 올바른 물리 면도 거울로 찍어요.
  for(const name of phys.dataFaces){
    const camera=faceCameras(phys.faces[name].normal)[0];
    assert.ok(detectPhysView(phys,camera,{faces:[name]}).faces.length>=1,name);
    assert.equal(detectPhysView(phys,leftHanded(camera),{faces:[name]}).faces.length,0,name);
  }
  assert.equal(detectPhysView(phys,leftHanded(ISO_FRONT)).faces.length,0);
  // 한 면(XM)만 거울인 사본: 면별 자는 그 면만 0개, 등각 자는 그 면만 빠져요.
  const bent=mirrorOneFace(phys,'XM');
  for(const name of phys.dataFaces){
    const found=detectPhysView(bent,faceCameras(bent.faces[name].normal)[1],{faces:[name]}).faces.length;
    if(name==='XM')assert.equal(found,0);else assert.ok(found>=1,name);
  }
  const iso=detectPhysView(bent,ISO_FRONT);
  assert.deepEqual(new Set(iso.faces.map(row=>row.face)),new Set(phys.dataFaces.filter(name=>name!=='XM').map(name=>map.physicalToLogical[name])));
  assert.throws(()=>perFaceRoundTrip({encoded,bytes,map,phys:bent,label:'bent'}),/면 0개/);
});

// 기본 범위 대표 3건(설계 §6-2): H0 3F 3톤 frame · H1 1F 반대면 복제 2톤 · H8 corners 6F.
const DEFAULT_CASES=[
  {label:'H0 3F 3톤 frame',code:{version:0,mode:3,tones:3,finder:'frame'},options:{}},
  {label:'H1 1F rf6 2톤 frame',code:{version:1,mode:1,tones:2,finder:'frame'},options:{renderFaces:6}},
  {label:'H8 6F 3톤 corners',code:{version:8,mode:6,tones:3,finder:'corners'},options:{},heavy:true},
];
for(const {label,code,options,heavy} of DEFAULT_CASES){
  // H8 은 기본 범위에서 면마다 카메라 1대(면 순번으로 네 회전을 돌려 써요), 전수 범위에서 4대 전부예요.
  const pick=heavy?(all,index)=>[all[index%4]]:all=>all;
  test(`0단계 (b) · §6-2: ${label} — S 물리 표면은 면별·등각 모두 거울 아님으로 원문 복호, S = I 는 0면`,()=>{
    const {encoded,bytes}=codeFor(code),s=cube(encoded,options),control=cube(encoded,options,IDENTITY);
    const reads=perFaceRoundTrip({encoded,bytes,...s,label,pick});
    assert.ok(reads>=s.phys.dataFaces.length);
    isoRoundTrip({encoded,bytes,...s,label});
    controlIsDark({phys:control.phys,label,pick:(all,index)=>[all[index%4]]});
  });
  if(heavy)fullOnly(()=>test(`§6-2 전수: ${label} — 면마다 카메라 4대`,()=>{
    const {encoded,bytes}=codeFor(code),s=cube(encoded,options);
    perFaceRoundTrip({encoded,bytes,...s,label});
    controlIsDark({phys:cube(encoded,options,IDENTITY).phys,label});
  }));
}

/* ───────────── 착지 ② 최종 메쉬(설계 §6-2 (b) · §5.5 8단계) ───────────── */

/** 3D 인쇄 최종 메쉬(기본 옵션 = 제품 경로)를 만들고, 기록된 회전의 역으로 물리 틀에 되돌린 바깥 표면이에요. */
function meshOf(phys,options={}){
  const {parts,report}=buildPrintParts(phys,options);
  return {report,surface:meshSurface(parts,report,phys)};
}
/**
 * 되돌림이 성립하는지 먼저 재요: Q 는 정수 진회전(det +1), 되돌린 메쉬는 [0,L]³ 을 채우고, 경계 평면 위 삼각형은 모두 바깥을
 * 향하고, 데이터 면은 표면 삼각형으로 덮여요(핀치 분리 쐐기만큼만 모자랄 수 있어요 — 사본 하나가 잃는 넓이 ≤ ε·c).
 */
function assertUnoriented({report,surface},phys,label){
  const Q=report.orientation.rotation;
  assert.ok(Q.every(row=>row.every(v=>v===-1||v===0||v===1)),`${label}: 정수 회전이 아니에요`);
  assert.equal(det3(Q),1,`${label}: 인쇄 방향 회전이 진회전(det +1)이 아니에요`);
  const L=surface.sideMm;
  for(let a=0;a<3;a++)assert.ok(Math.abs(surface.bounds.min[a])<1e-9&&Math.abs(surface.bounds.max[a]-L)<1e-9,`${label}: 되돌린 메쉬가 [0,L]³ 이 아니에요`);
  assert.equal(surface.inward,0,`${label}: 경계 평면 위에 안쪽을 향한 삼각형이 있어요`);
  const slack=report.pinchVertices*(report.epsilonUm/1000)*surface.cellMm;
  for(const face of phys.dataFaces){
    const area=surface.areaByFace[face]??0;
    assert.ok(area<=L*L+1e-6&&area>=L*L-slack-1e-6,`${label} ${face}: 표면 넓이 ${area} (L² ${L*L}, 여유 ${slack})`);
  }
}
/** 한 사례의 최종 메쉬 왕복 전체: S 메쉬는 면별·등각 모두 원문, S = I 메쉬는 같은 카메라로 0면. */
function meshRoundTrip({encoded,bytes,options,label,pick,controlPick,build={},cellUm}){
  const s=cube(encoded,options,null,cellUm),mesh=meshOf(s.phys,build);
  assertUnoriented(mesh,s.phys,label);
  const view=meshViewer(mesh.surface,s.phys);
  const reads=perFaceRoundTrip({encoded,bytes,...s,label,pick,view});
  isoRoundTrip({encoded,bytes,...s,label,view});
  const control=cube(encoded,options,IDENTITY,cellUm),controlMesh=meshOf(control.phys,build);
  assertUnoriented(controlMesh,control.phys,`${label} S=I`);
  controlIsDark({phys:control.phys,label,pick:controlPick,view:meshViewer(controlMesh.surface,control.phys)});
  return {reads,s,mesh};
}

test('§6-2 (b) 최종 메쉬 자 검증: 한 면의 열 방향만 뒤집은 메쉬 사본은 면별·등각 자가 그 면에서 빨개져요',()=>{
  const {encoded,bytes}=codeFor({version:0,mode:3,tones:3,finder:'frame'}),s=cube(encoded,{}),mesh=meshOf(s.phys);
  const bent=mirrorSurfaceFace(mesh.surface,s.phys,'XM'),bentView=meshViewer(bent,s.phys),view=meshViewer(mesh.surface,s.phys);
  for(const name of s.phys.dataFaces){
    const camera=faceCameras(s.phys.faces[name].normal)[1];
    assert.ok(view(camera,{faces:[name]}).faces.length>=1,`원본 ${name}`);
    const found=bentView(camera,{faces:[name]}).faces.length;
    if(name==='XM')assert.equal(found,0,'뒤집은 면이 읽혔어요');else assert.ok(found>=1,name);
  }
  const iso=bentView(ISO_FRONT);
  assert.deepEqual(new Set(iso.faces.map(row=>row.face)),new Set(s.phys.dataFaces.filter(name=>name!=='XM').map(name=>s.map.physicalToLogical[name])));
  assert.throws(()=>perFaceRoundTrip({encoded,bytes,...s,label:'bent mesh',view:bentView}),/면 0개/);
  // 되돌림 자: 회전을 되돌리지 않은(인쇄 방향 틀 그대로) 메쉬는 경계·면 배정이 어긋나 등각 왕복이 무너져요.
  const {parts,report}=buildPrintParts(s.phys);
  const raw=meshSurface(parts,{...report,orientation:{rotation:[[1,0,0],[0,1,0],[0,0,1]],translationUm:[0,0,0]}},s.phys);
  assert.notDeepEqual(report.orientation.rotation.map(row=>[...row]),[[1,0,0],[0,1,0],[0,0,1]],'대표 사례의 인쇄 방향이 항등이면 이 대조가 비어요');
  assert.throws(()=>isoRoundTrip({encoded,bytes,...s,label:'unrotated mesh',view:meshViewer(raw,s.phys)}));
});

for(const {label,code,options,heavy} of DEFAULT_CASES){
  // H8 은 기본 범위에서 면마다 카메라 1대(면 순번으로 네 회전을 돌려 써요)예요.
  const pick=heavy?(all,index)=>[all[(index+1)%4]]:all=>all;
  test(`§6-2 (b) 최종 메쉬: ${label} — 되돌린 3D 인쇄 메쉬는 면별·등각 모두 거울 아님으로 원문 복호, S = I 메쉬는 0면`,()=>{
    const {encoded,bytes}=codeFor(code);
    const {reads,s,mesh}=meshRoundTrip({encoded,bytes,options,label,pick,controlPick:(all,index)=>[all[(index+3)%4]]});
    assert.ok(reads>=s.phys.dataFaces.length);
    // 기본 산출물이에요: 숨구멍 면이 있으면 속 비우기가 켜진 메쉬를 쟀어요(6F 는 솔리드 + 사유).
    assert.equal(mesh.report.hollow.enabled,s.phys.faces[mesh.report.bedFace].blank,label);
  });
}

/**
 * 정본 시점 일치: 고정 카메라 ISO_FRONT 로 본 물리 큐브의 데이터 셀이 2.5D 정사영 화면(buildHScene, 원근 0)의
 * 같은 (면, i, j) 셀과 평행이동 하나로 겹쳐요. 판독 왕복은 «거울이 아니다» 만 재서 어떤 반사든 통과하지만,
 * 이 성질은 x↔y 교환만 가져요 — 꼭짓점 (L,L,L) 로 세운 실물을 위에서 보면 화면과 같은 그림이라는 뜻이에요.
 */
function canonicalViewMatches(encoded,options,phys){
  const screen=buildHScene(encoded,{...options,perspective:0}),mine=physViewScene(phys,ISO_FRONT);
  const cellKey=s=>`${s.face}|${s.i}|${s.j}`;
  const ours=new Map(mine.shapes.filter(s=>!phys.faces[s.face].blank).map(s=>[cellKey(s),s]));
  const theirs=screen.shapes.filter(s=>Number.isInteger(s.i)&&Number.isInteger(s.j)&&s.face);
  if(!theirs.length||theirs.length!==ours.size)return false;
  const first=ours.get(cellKey(theirs[0]));if(!first)return false;
  const dx=first.points[0].x-theirs[0].points[0].x,dy=first.points[0].y-theirs[0].points[0].y;
  return theirs.every(s=>{
    const o=ours.get(cellKey(s));
    return !!o&&o.color.r===s.color.r&&o.color.g===s.color.g&&o.color.b===s.color.b
      &&s.points.every((p,k)=>Math.abs(o.points[k].x-p.x-dx)<1e-9&&Math.abs(o.points[k].y-p.y-dy)<1e-9);
  });
}
test('정본 시점 일치: ISO_FRONT 로 본 S 물리 큐브는 2.5D 화면과 셀마다 겹치고, 다른 반사(z 뒤집기)는 겹치지 않아요',()=>{
  const cases=[[{version:0,mode:3,tones:3,finder:'frame'},{}],[{version:1,mode:1,tones:2,finder:'frame'},{renderFaces:6}],
    [{version:2,mode:2,tones:3,finder:'frame'},{arrangement:'horizontal',renderFaces:3}],[{version:5,mode:4,tones:2,finder:'corners'},{}],
    [{version:5,mode:6,tones:3,finder:'corners'},{}]];
  const zFlip=[[1,0,0],[0,1,0],[0,0,-1]];
  for(const [code,options] of cases){
    const {encoded}=codeFor(code),s=cube(encoded,options),label=JSON.stringify([code,options]);
    assert.ok(canonicalViewMatches(encoded,options,s.phys),label);
    // z 뒤집기도 반사라 손잡이는 모두 +1 이지만(심은 결함 대조) 정본 시점 그림은 달라요.
    const flipped=cube(encoded,options,zFlip).phys;
    assert.deepEqual([...new Set(faceHandedness(flipped).values())],[1],label);
    assert.equal(canonicalViewMatches(encoded,options,flipped),false,label);
    assert.equal(canonicalViewMatches(encoded,options,cube(encoded,options,IDENTITY).phys),false,label);
  }
});

test('인쇄 방향으로 돌린 물리 큐브도 같은 카메라들로 원문이 돌아와요(진회전은 손잡이를 보존해요)',()=>{
  const {encoded,bytes}=codeFor({version:0,mode:3,tones:3,finder:'frame'}),s=cube(encoded,{});
  const {phys,rotation}=orientForBed(s.phys);
  assert.equal(dot(rotation[0],cross(rotation[1],rotation[2])),1);
  perFaceRoundTrip({encoded,bytes,map:s.map,phys,label:'oriented',pick:(all,index)=>[all[(index+1)%4]]});
  isoRoundTrip({encoded,bytes,map:s.map,phys,label:'oriented'});
});

/** 전수 배터리: 모드 × 배치 × 반대면 복제(hDisplayMap 이 받는 조합에서 유도) × 톤 × finder. */
function batteryCases(mode){
  const out=[],seen=new Set();
  for(const [finder,version] of [['frame',2],['corners',5]])for(const tones of [2,3]){
    const {encoded,bytes}=codeFor({version,mode,tones,finder,mask:(mode+tones)%8});
    for(const arrangement of H_ARRANGEMENTS)for(const renderFaces of [3,6]){
      let map;try{map=hDisplayMap(encoded,{arrangement,renderFaces});}catch{continue;}
      const key=`${finder}|${tones}|${map.cacheKey}`;if(seen.has(key))continue;seen.add(key);
      out.push({encoded,bytes,options:{arrangement,renderFaces},label:`${mode}F ${arrangement} rf${renderFaces} ${tones}톤 ${finder}`});
    }
  }
  return out;
}
for(const mode of [1,2,3,4,5,6])fullOnly(()=>test(`§6-2 전수 배터리: ${mode}면 × 배치 × 반대면 복제 × 톤 × finder`,()=>{
  const cases=batteryCases(mode);
  assert.ok(cases.length>=4,`${mode}F 조합 유도가 무너졌어요`);
  cases.forEach(({encoded,bytes,options,label},k)=>{
    const s=cube(encoded,options);
    perFaceRoundTrip({encoded,bytes,...s,label,pick:(all,index)=>[all[(index+k)%4]]});
    isoRoundTrip({encoded,bytes,...s,label});
    controlIsDark({phys:cube(encoded,options,IDENTITY).phys,label,pick:(all,index)=>[all[(index+k+2)%4]]});
  });
}));

/**
 * 최종 메쉬 전수 배터리(full): 같은 조합 유도에 셀 · 매립 깊이 · 속 비우기를 사례마다 돌려 끼워요.
 * 셀 0.8 mm(깊이 0.6) · 2.0 mm(1.0) · 5.0 mm(2.0)은 UI 범위의 양 끝과 기본값이에요. 속 비우기 끔도 섞어요.
 */
const MESH_BUILDS=[{cellUm:800,build:{depthUm:600}},{cellUm:2000,build:{}},{cellUm:5000,build:{depthUm:2000}},{cellUm:2000,build:{hollow:false}}];
for(const mode of [1,2,3,4,5,6])fullOnly(()=>test(`§6-2 (b) 최종 메쉬 전수 배터리: ${mode}면 × 배치 × 반대면 복제 × 톤 × finder × 셀·깊이`,()=>{
  const cases=batteryCases(mode);
  assert.ok(cases.length>=4,`${mode}F 조합 유도가 무너졌어요`);
  cases.forEach(({encoded,bytes,options,label},k)=>{
    const {cellUm,build}=MESH_BUILDS[k%MESH_BUILDS.length];
    meshRoundTrip({encoded,bytes,options,label:`${label} c${cellUm} ${JSON.stringify(build)}`,cellUm,build,
      pick:(all,index)=>[all[(index+k)%4]],controlPick:(all,index)=>[all[(index+k+2)%4]]});
  });
}));
