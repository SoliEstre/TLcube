/**
 * 물리 좌표 큐브(cube-physical.js)의 성질이에요(설계 §2.1 · §6-1).
 * 손잡이 불변식은 설계 규약식을 다시 재는 싼 자예요. 거울 여부의 수호자는 print-scan-roundtrip 의 판독 왕복이에요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {H_FACE_IDS,hModeFaces} from '../src/h-profile.js';
import {H_ARRANGEMENTS,hDisplayMap} from '../src/h-face-arrangement.js';
import {hProjection} from '../src/h-render.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {generatorCubeModel} from '../src/generator-cube-export.js';
import {rasterToPng} from '../src/png.js';
import {PHYSICAL_SWAP,BED_FACE_ORDER,DEFAULT_CELL_UM,physicalHCube,faceHandedness,orientForBed} from '../src/cube-physical.js';
import {cross,dot,mirrorOneFace} from './helpers/h-physical-camera.mjs';

const IDENTITY=[[1,0,0],[0,1,0],[0,0,1]];
const det3=m=>dot(m[0],cross(m[1],m[2]));
const mulMV=(m,v)=>[0,1,2].map(r=>dot(m[r],v));
const key=p=>p.join(',');
const cellCorners=(face,i,j)=>[[i,j],[i,j+1],[i+1,j+1],[i+1,j]].map(([a,b])=>[0,1,2].map(k=>face.origin[k]+a*face.di[k]+b*face.dj[k]));

/** 모드 × 배치 × 반대면 복제 조합은 손 목록 대신 hDisplayMap 이 받는 것에서 유도해요(같은 배치는 cacheKey 로 한 번만). */
function displayConfigs({version=2,finder='frame',tones=2}={}){
  const out=[],seen=new Set();
  for(const mode of [1,2,3,4,5,6]){
    const encoded=encodeH(Uint8Array.of(mode),{version,mode,tones,ecc:'M',mask:mode%8,finder});
    for(const arrangement of H_ARRANGEMENTS)for(const renderFaces of [3,6]){
      let map;try{map=hDisplayMap(encoded,{arrangement,renderFaces});}catch{continue;}
      if(seen.has(map.cacheKey))continue;seen.add(map.cacheKey);
      out.push({encoded,options:{arrangement,renderFaces},map,label:`${mode}F/${arrangement}/rf${renderFaces}`});
    }
  }
  return out;
}
const CONFIGS=displayConfigs();
/** 48개 부호 있는 치환 행렬(축 치환 6 × 부호 8)이에요. */
function signedPermutations(){
  const perms=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]],out=[];
  for(const perm of perms)for(let signs=0;signs<8;signs++)out.push(perm.map((column,row)=>{const r=[0,0,0];r[column]=(signs>>row)&1?-1:1;return r;}));
  return out;
}

test('PHYSICAL_SWAP 은 x↔y 교환 반사이고, BED_FACE_ORDER 는 정본 시점에서 숨은 세 면이 먼저예요',()=>{
  assert.deepEqual(PHYSICAL_SWAP.map(r=>[...r]),[[0,1,0],[1,0,0],[0,0,1]]);
  assert.equal(det3(PHYSICAL_SWAP),-1);
  assert.ok(Object.isFrozen(PHYSICAL_SWAP)&&PHYSICAL_SWAP.every(Object.isFrozen));
  assert.deepEqual([...BED_FACE_ORDER].sort(),[...H_FACE_IDS].sort());
  const visible=hProjection(13,{perspective:0}).visible;
  assert.deepEqual(new Set(BED_FACE_ORDER.slice(0,3)),new Set(H_FACE_IDS.filter(face=>!visible.includes(face))));
  assert.deepEqual(new Set(BED_FACE_ORDER.slice(3)),new Set(visible));
  assert.equal(DEFAULT_CELL_UM,2000);
});

test('§6-1: 모든 모드·배치·반대면 복제에서 S 면은 모두 오른손(+1), S = I 면은 모두 거울(−1)이에요',()=>{
  assert.ok(CONFIGS.length>=20,`조합 유도가 무너졌어요: ${CONFIGS.length}`);
  for(const {encoded,options,label} of CONFIGS){
    const model=buildHCubeModel(encoded,options);
    assert.deepEqual([...faceHandedness(physicalHCube(model)).values()],H_FACE_IDS.map(()=>1),label);
    assert.deepEqual([...faceHandedness(physicalHCube(model,{swap:IDENTITY})).values()],H_FACE_IDS.map(()=>-1),label);
  }
});

test('손잡이는 교환 행렬의 행렬식만 따라가요: 48개 부호 있는 치환 전부에서 모든 면 = −det',()=>{
  const model=buildHCubeModel(encodeH('H',{version:0,mode:3}));
  const all=signedPermutations();
  assert.equal(new Set(all.map(m=>JSON.stringify(m))).size,48);
  for(const m of all){
    const phys=physicalHCube(model,{swap:m}),expected=-det3(m);
    assert.deepEqual([...faceHandedness(phys).values()],H_FACE_IDS.map(()=>expected),JSON.stringify(m));
    // 어떤 치환이든 큐브는 [0,n]³ 에 남고 여섯 면이 여섯 평면을 하나씩 차지해요.
    assert.equal(Object.keys(phys.byPlane).length,6);
    for(const face of Object.values(phys.faces))for(const p of cellCorners(face,phys.n-1,phys.n-1))assert.ok(p.every(v=>v>=0&&v<=phys.n));
  }
});

test('물리 면 격자는 모델 쿼드를 S 로 옮긴 것과 꼭짓점·색이 셀마다 같아요',()=>{
  for(const {encoded,options,label} of CONFIGS){
    const model=buildHCubeModel(encoded,options),phys=physicalHCube(model),n=phys.n;
    assert.equal(n,model.n);
    for(const q of model.quads){
      const face=phys.faces[q.face],k=q.i*n+q.j;
      const expected=q.corners.map(p=>key(mulMV(PHYSICAL_SWAP,p).map((v,d)=>v+phys.offsetCells[d]))).sort();
      assert.deepEqual(cellCorners(face,q.i,q.j).map(key).sort(),expected,`${label} ${q.face}(${q.i},${q.j})`);
      assert.deepEqual({...face.colors[k]},q.color);
      assert.equal(face.hex[k],'#'+[q.color.r,q.color.g,q.color.b].map(v=>v.toString(16).padStart(2,'0')).join(''));
      assert.equal(face.blank,q.kind==='back');
    }
  }
});

test('빈 면·데이터 면 목록은 hDisplayMap 과 같고, 면마다 서로 다른 평면이에요',()=>{
  for(const {encoded,options,map,label} of CONFIGS){
    const phys=physicalHCube(buildHCubeModel(encoded,options));
    assert.deepEqual(phys.blankFaces,[...map.blankFaces],label);
    assert.deepEqual(phys.dataFaces,[...map.physicalDataFaces],label);
    assert.deepEqual(phys.logicalDataFaces,[...map.logicalDataFaces],label);
    assert.deepEqual(new Set(Object.keys(phys.byPlane)),new Set(['-x','+x','-y','+y','-z','+z']));
    for(const [plane,name] of Object.entries(phys.byPlane)){
      const f=phys.faces[name];
      assert.equal(f.plane,plane);assert.equal(f.normal[f.axis],f.side?1:-1);assert.equal(f.origin[f.axis],f.side*phys.n);
    }
    assert.equal(phys.blankHex,phys.blankFaces.length?phys.faces[phys.blankFaces[0]].hex[0]:null);
    for(const name of phys.blankFaces)assert.ok(phys.faces[name].hex.every(h=>h===phys.blankHex),label);
  }
});

test('모델 XM 은 물리 y = 0 면, 모델 YM 은 물리 x = 0 면이에요(S 가 x·y 를 맞바꿔요)',()=>{
  const phys=physicalHCube(buildHCubeModel(encodeH('H',{version:0,mode:3})));
  assert.equal(phys.byPlane['-y'],'XM');assert.equal(phys.byPlane['-x'],'YM');assert.equal(phys.byPlane['-z'],'ZM');
  assert.equal(phys.byPlane['+y'],'XP');assert.equal(phys.byPlane['+x'],'YP');assert.equal(phys.byPlane['+z'],'ZP');
});

test('셀 µm: 기본 2000, 한 변 = n·c, 800 미만은 TLP_CELL_MIN, 200 단위가 아니면 TLP_CELL_STEP',()=>{
  const model=buildHCubeModel(encodeH('H',{version:4,mode:3}));
  const base=physicalHCube(model);
  assert.equal(base.cellUm,2000);assert.equal(base.sideUm,model.n*2000);
  for(const cellUm of [800,1200,5000])assert.equal(physicalHCube(model,{cellUm}).sideUm,model.n*cellUm);
  for(const cellUm of [0,-200,600,799])assert.throws(()=>physicalHCube(model,{cellUm}),e=>e.code==='TLP_CELL_MIN');
  for(const cellUm of [2100,1999.5,801])assert.throws(()=>physicalHCube(model,{cellUm}),e=>e.code==='TLP_CELL_STEP');
  for(const cellUm of ['2000',Number.NaN,Infinity])assert.throws(()=>physicalHCube(model,{cellUm}),TypeError);
  // 셀 크기는 격자 모양을 바꾸지 않아요(셀 단위 틀은 같고 µm 만 달라요).
  assert.deepEqual(physicalHCube(model,{cellUm:1200}).faces,base.faces);
});

test('모델을 변이하지 않고, images 없음과 [] 는 같은 결과이며, 산출물은 얼어 있어요',()=>{
  const model=buildHCubeModel(encodeH('H',{version:0,mode:3})),before=JSON.stringify(model);
  const phys=physicalHCube(model);
  assert.equal(JSON.stringify(model),before);
  assert.deepEqual(physicalHCube({...model,images:[]}),phys);
  assert.ok(Object.isFrozen(phys)&&Object.isFrozen(phys.faces)&&Object.isFrozen(phys.dataFaces));
  for(const face of Object.values(phys.faces))assert.ok([face,face.origin,face.di,face.dj,face.normal,face.hex,face.colors,face.colors[0]].every(Object.isFrozen));
});

test('빈 면 이미지는 시트 틀 그대로 빈 면에만 실려요',()=>{
  const e=encodeH('one',{version:3,mode:1,mask:7}),pixels=Uint8ClampedArray.of(142,32,33,255,10,20,30,255);
  const image={width:2,height:1,pixels,href:'data:image/png;base64,'+Buffer.from(rasterToPng({width:2,height:1,pixels})).toString('base64')};
  for(const renderFaces of [3,6]){
    const model=buildHCubeModel(e,{renderFaces,faceImages:Object.fromEntries(H_FACE_IDS.map(face=>[face,image]))}),phys=physicalHCube(model);
    const placed=new Map(model.images.map(p=>[p.face,p]));
    for(const name of H_FACE_IDS){
      const face=phys.faces[name],p=placed.get(name);
      if(!p){assert.equal(face.image,null);continue;}
      assert.equal(face.blank,true);assert.equal(face.image.image,image);
      for(const k of ['x','y','width','height'])assert.equal(face.image[k],p[k]);
      // 이미지 가로(x)는 열 j 방향이라 가로로 긴 이미지는 dj 방향으로 길어요.
      assert.ok(face.image.width>face.image.height);
    }
  }
  const model=buildHCubeModel(e,{faceImages:{ZM:image}});
  const moved={...model,images:model.images.map(p=>({...p,corners:p.corners.map(c=>c.map((v,k)=>k===0?v+.5:v))}))};
  assert.throws(()=>physicalHCube(moved),/시트 틀/);
  const onData={...model,images:[{...model.images[0],face:'XM'}]};
  assert.throws(()=>physicalHCube(onData),/빈 면/);
});

test('generatorCubeModel(H) 경로의 모델도 그대로 받아요',()=>{
  const encoded=encodeH('H',{version:0,mode:3});
  const model=generatorCubeModel({type:'H',encoded,sceneOpts:{renderFaces:6,arrangement:'isometric'}});
  const phys=physicalHCube(model);
  assert.deepEqual([...faceHandedness(phys).values()],H_FACE_IDS.map(()=>1));
  assert.deepEqual(phys.dataFaces,['ZM','XM','YM']);
});

test('형식이 틀린 입력은 거부해요',()=>{
  const model=buildHCubeModel(encodeH('H',{version:0,mode:3}));
  assert.throws(()=>physicalHCube(null),TypeError);
  assert.throws(()=>physicalHCube({...model,kind:'Y'}),RangeError);
  assert.throws(()=>physicalHCube({...model,quads:model.quads.slice(1)}),RangeError);
  assert.throws(()=>physicalHCube({...model,quads:[...model.quads.slice(1),model.quads[0+1]]}),/중복/);
  const mixed=model.quads.map((q,k)=>k===0?{...q,kind:q.kind==='module'?'back':'module'}:q);
  assert.throws(()=>physicalHCube({...model,quads:mixed}),/섞였/);
  const bent=model.quads.map((q,k)=>k===5?{...q,corners:q.corners.map((c,m)=>m===0?[c[0],c[1],c[2]+1]:c)}:q);
  assert.throws(()=>physicalHCube({...model,quads:bent}),RangeError);
  const colour=model.quads.map((q,k)=>k===7?{...q,color:{r:256,g:0,b:0}}:q);
  assert.throws(()=>physicalHCube({...model,quads:colour}),TypeError);
  assert.throws(()=>physicalHCube(model,{swap:[[1,1,0],[0,1,0],[0,0,1]]}),RangeError);
  assert.throws(()=>physicalHCube(model,{swap:[[2,0,0],[0,1,0],[0,0,1]]}),TypeError);
  assert.throws(()=>faceHandedness({kind:'H-physical',n:13,faces:{}}),TypeError);
});

test('심은 결함: 한 면만 거울로 만든 사본은 그 면만 −1 이고, 퇴화 틀은 거부돼요',()=>{
  const phys=physicalHCube(buildHCubeModel(encodeH('H',{version:0,mode:3})));
  for(const name of H_FACE_IDS){
    const hand=faceHandedness(mirrorOneFace(phys,name));
    assert.deepEqual([...hand.entries()].filter(([,s])=>s===-1).map(([f])=>f),[name]);
  }
  const f=phys.faces.XM;
  assert.throws(()=>faceHandedness({...phys,faces:{...phys.faces,XM:{...f,dj:f.di}}}),/퇴화/);
});

test('orientForBed: 규칙대로 바닥면을 골라 진회전으로 z = 0 에 놓고, 손잡이·면 내용·목록을 보존해요',()=>{
  for(const {encoded,options,label} of CONFIGS){
    const phys=physicalHCube(buildHCubeModel(encoded,options),{cellUm:1400}),n=phys.n;
    const {phys:out,rotation,translationUm,bedFace}=orientForBed(phys);
    const expectedBed=BED_FACE_ORDER.find(face=>phys.faces[face].blank)??BED_FACE_ORDER[0];
    assert.equal(bedFace,expectedBed,label);
    // 숨은 꼭짓점 세 면 중 빈 면이 있으면 보이는 면을 바닥으로 쓰지 않아요.
    if(BED_FACE_ORDER.slice(0,3).some(face=>phys.faces[face].blank))assert.ok(BED_FACE_ORDER.slice(0,3).includes(bedFace),label);
    assert.equal(out.faces[bedFace].plane,'-z');assert.deepEqual([...out.faces[bedFace].normal],[0,0,-1]);
    assert.ok(rotation.flat().every(Number.isInteger));assert.equal(det3(rotation),1);
    for(let r=0;r<3;r++)for(let c=0;c<3;c++)assert.equal(dot([0,1,2].map(k=>rotation[k][r]),[0,1,2].map(k=>rotation[k][c])),r===c?1:0);
    assert.deepEqual([...faceHandedness(out).values()],H_FACE_IDS.map(()=>1),label);
    assert.deepEqual(out.blankFaces,phys.blankFaces);assert.deepEqual(out.dataFaces,phys.dataFaces);
    assert.equal(out.sideUm,phys.sideUm);
    for(const name of H_FACE_IDS){
      const a=phys.faces[name],b=out.faces[name];
      assert.equal(b.hex,a.hex);assert.equal(b.colors,a.colors);
      for(const [i,j] of [[0,0],[n-1,0],[0,n-1],[n-1,n-1],[n>>1,3]]){
        const before=cellCorners(a,i,j).map(p=>p.map(v=>v*phys.cellUm)),after=cellCorners(b,i,j).map(p=>p.map(v=>v*phys.cellUm));
        assert.deepEqual(after,before.map(p=>mulMV(rotation,p).map((v,k)=>v+translationUm[k])),`${label} ${name}`);
        assert.ok(after.flat().every(v=>v>=0&&v<=phys.sideUm));
      }
    }
    // 현재 모든 모드·배치에서 규칙의 결과는 모델 ZP 예요(설계 §6-9). 새 배치가 ZP 에 데이터를 실으면 여기서 드러나요.
    assert.equal(bedFace,'ZP',label);
    assert.deepEqual(out.orientation,{bedFace,rotation,translationUm});
  }
});

test('orientForBed 는 두 번 걸어도 같고, bedFace 를 지정하면 그 면을 바닥에 놓아요',()=>{
  const phys=physicalHCube(buildHCubeModel(encodeH('H',{version:0,mode:3})));
  const once=orientForBed(phys),twice=orientForBed(once.phys);
  assert.deepEqual(twice.rotation.map(r=>[...r]),IDENTITY);assert.deepEqual([...twice.translationUm],[0,0,0]);
  assert.deepEqual(twice.phys.orientation,once.phys.orientation);assert.deepEqual(twice.phys.faces,once.phys.faces);
  for(const bedFace of H_FACE_IDS){
    const r=orientForBed(phys,{bedFace});
    assert.equal(r.phys.faces[bedFace].plane,'-z');assert.equal(det3(r.rotation),1);
    assert.deepEqual([...faceHandedness(r.phys).values()],H_FACE_IDS.map(()=>1));
  }
  assert.throws(()=>orientForBed(phys,{bedFace:'QQ'}),RangeError);
  // 6면은 빈 면이 없어 첫 후보(ZP)를 바닥으로 써요.
  const six=physicalHCube(buildHCubeModel(encodeH('H',{version:0,mode:6})));
  assert.equal(six.blankFaces.length,0);assert.equal(orientForBed(six).bedFace,'ZP');
  assert.deepEqual(hModeFaces(6).filter(face=>six.faces[face].blank),[]);
});
