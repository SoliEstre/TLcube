/**
 * 매립 깊이(설계 §6-5)와 모서리 소유(§6-6)를 산출 메쉬 그대로 재요.
 * 자는 반직선 홀짝 탐침(test/helpers/print-mesh-probe.mjs)이라 재질 규칙을 다시 부르지 않아요 — 메쉬가 실제로 어떤 색을
 * 그 자리에 두었는지만 봐요. 자마다 심은 결함(얕은 매립 · 색 라벨 뒤바꿈 · «가까운 면» 소유 규칙)으로 빨개지는지도 봐요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {H_FACE_IDS} from '../src/h-profile.js';
import {H_ARRANGEMENTS} from '../src/h-face-arrangement.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {physicalHCube} from '../src/cube-physical.js';
import {buildPrintParts,PRINT_WHITE} from '../src/print-mesh.js';
import {fullOnly} from './helpers/scope.mjs';
import {partLocator,orientedPhys,modulePoint} from './helpers/print-mesh-probe.mjs';

function physFor({version=0,mode=3,tones=3,finder='frame'},{options={},cellUm}={}){
  const encoded=encodeH(Uint8Array.of(mode*16+tones+version),{version,mode,tones,finder,ecc:'M'});
  return physicalHCube(buildHCubeModel(encoded,options),cellUm?{cellUm}:{});
}

/**
 * §6-5 매립 깊이: 모든 데이터 면 모든 모듈 중심 아래 깊이 δ(0.05 mm · d/2 · d − 0.05 mm)의 재질이 그 모듈 색이에요.
 * 그리고 다른 모든 면까지 거리가 d + 0.05 mm 보다 먼 모듈은 깊이 d + 0.05 mm 가 코어예요.
 * @returns 어긋난 탐침 목록(빈 배열이면 통과)
 */
function embedMismatches(phys,{parts,report},{claimedDepthUm=report.depthUm,deep=true}={}){
  const oriented=orientedPhys(phys,report),loc=partLocator(parts),n=oriented.n,c=oriented.cellUm,d=claimedDepthUm,out=[];
  const depths=[50,Math.round(d/2),d-50];
  for(const face of oriented.dataFaces){
    const f=oriented.faces[face];
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const expected=f.hex[i*n+j];
      for(const depth of depths){
        const found=loc.at(modulePoint(oriented,face,i,j,depth));
        if(found.length!==1||found[0].hex!==expected||found[0].role==='core')out.push({face,i,j,depth,expected,found:found.map(p=>p.name)});
      }
      if(!deep)continue;
      const edge=Math.min(i+0.5,n-i-0.5,j+0.5,n-j-0.5)*c;
      if(edge<=d+50)continue;
      const core=loc.at(modulePoint(oriented,face,i,j,d+50));
      if(core.length!==1||core[0].role!=='core')out.push({face,i,j,depth:d+50,expected:'core',found:core.map(p=>p.name)});
    }
  }
  return out;
}

const EMBED_CASES=[
  {label:'H0 3F 3톤 frame (속 비우기 켬)',code:{version:0,mode:3,tones:3}},
  {label:'H1 1F rf6 2톤 frame',code:{version:1,mode:1,tones:2},options:{renderFaces:6}},
  {label:'H5 6F 3톤 corners (솔리드)',code:{version:5,mode:6,tones:3,finder:'corners'}},
  {label:'H2 4F 2톤 c=1.4 d=1.0',code:{version:2,mode:4,tones:2},cellUm:1400},
  {label:'H0 3F d = 0.9c 경계',code:{version:0,mode:3,tones:3},depthUm:1800},
];
test('§6-5 매립 깊이: 모든 데이터 면·모듈에서 깊이 0.05 · d/2 · d − 0.05 mm 가 모듈 색, 가장자리에서 먼 모듈은 d + 0.05 mm 가 코어',()=>{
  for(const {label,code,options,cellUm,depthUm} of EMBED_CASES){
    const phys=physFor(code,{options,cellUm}),built=buildPrintParts(phys,depthUm?{depthUm}:{});
    assert.deepEqual(embedMismatches(phys,built).slice(0,5),[],label);
  }
});

test('§6-5 자 검증: 얕게 매립한 산출과 색 라벨을 뒤바꾼 산출은 빨개져요',()=>{
  const phys=physFor({version:0,mode:3,tones:3});
  // d = 0.6 mm 로 만든 파트를 d = 1.0 mm 라고 주장하면, 깊이 0.95 mm 탐침이 코어를 만나요.
  const shallow=buildPrintParts(phys,{depthUm:600});
  const shallowMiss=embedMismatches(phys,shallow,{claimedDepthUm:1000,deep:false});
  assert.ok(shallowMiss.length>100,`얕은 매립 ${shallowMiss.length}`);
  assert.ok(shallowMiss.every(m=>m.depth===950),'어긋남은 d − 0.05 깊이에서만 나야 해요');
  // 검정·흰색 파트의 색 라벨을 맞바꾸면 그 두 색 모듈이 모두 어긋나요.
  const built=buildPrintParts(phys),swap={'#000000':PRINT_WHITE,[PRINT_WHITE]:'#000000'};
  const relabelled={...built,parts:built.parts.map(p=>p.role==='core'?p:{...p,hex:swap[p.hex]??p.hex})};
  const miss=embedMismatches(phys,relabelled,{deep:false});
  assert.ok(miss.length>0&&miss.every(m=>m.expected==='#000000'||m.expected===PRINT_WHITE));
});

/**
 * §6-6 모서리 소유: 인접한 두 면(A, B)의 모서리를 따라(양 끝 모듈 제외) 모듈 중심마다 탐침해요.
 *   데이터-데이터: d×d 띠 안(깊이 쌍 (d/2,d/2) · (d−0.05,d−0.05) · (0.05,d−0.05) · (d−0.05,0.05))은 흰색.
 *   데이터-빈 면: 데이터 면 A 의 모듈 기둥이 깊이 0.05 … d − 0.05 까지 빈 면 B 에서 0.05 mm 떨어진 곳에서도 A 모듈 색.
 */
function cornerMismatches(phys,{parts,report}){
  const oriented=orientedPhys(phys,report),loc=partLocator(parts),n=oriented.n,c=oriented.cellUm,L=oriented.sideUm,d=report.depthUm;
  const names=Object.keys(oriented.faces),out=[];let probes=0;
  const coord=(face,depth)=>{const f=oriented.faces[face];return f.side?L-depth:depth;};
  for(let x=0;x<names.length;x++)for(let y=0;y<names.length;y++){
    if(x===y)continue;
    const A=oriented.faces[names[x]],B=oriented.faces[names[y]];
    if(A.axis===B.axis||A.blank)continue;
    if(!B.blank&&x>y)continue; // 데이터-데이터 쌍은 한 번만
    const e=3-A.axis-B.axis;
    const pairs=B.blank?[[50,50],[Math.round(d/2),50],[d-50,50]]:[[d/2,d/2],[d-50,d-50],[50,d-50],[d-50,50]];
    for(let k=1;k<n-1;k++)for(const [da,db] of pairs){
      const p=[0,0,0];p[e]=(k+0.5)*c;p[A.axis]=coord(names[x],da);p[B.axis]=coord(names[y],db);
      let expected=PRINT_WHITE;
      if(B.blank){
        const q=p.map(v=>v/c),rel=q.map((v,a)=>v-A.origin[a]);
        const i=Math.floor(rel[0]*A.di[0]+rel[1]*A.di[1]+rel[2]*A.di[2]),j=Math.floor(rel[0]*A.dj[0]+rel[1]*A.dj[1]+rel[2]*A.dj[2]);
        expected=A.hex[i*n+j];
      }
      const found=loc.hexAt(p);probes++;
      if(found.length!==1||found[0]!==expected)out.push({A:names[x],B:names[y],k,da,db,expected,found});
    }
  }
  return {out,probes};
}
test('§6-6 모서리 소유: 데이터-데이터 d×d 띠는 흰색, 데이터-빈 면 모서리에서 데이터 면 모듈 기둥은 깊이 d 까지 제 색',()=>{
  for(const {label,code,options,depthUm} of [
    {label:'H0 3F 3톤(빈 면 회색)',code:{version:0,mode:3,tones:3}},
    {label:'H1 2F rf3 3톤',code:{version:1,mode:2,tones:3},options:{renderFaces:3}},
    {label:'H2 5F 3톤 d=1.6',code:{version:2,mode:5,tones:3},depthUm:1600},
    {label:'H0 6F 3톤',code:{version:0,mode:6,tones:3}},
  ]){
    const phys=physFor(code,{options}),built=buildPrintParts(phys,depthUm?{depthUm}:{});
    const {out,probes}=cornerMismatches(phys,built);
    assert.ok(probes>100,label);
    assert.deepEqual(out.slice(0,5),[],label);
  }
});

/*
 * 모서리 d×d 기둥은 격자에서 상자 하나이고 그 중심은 두 면에서 같은 거리예요. 그래서 «가장 가까운 면» 규칙은 동률 규칙
 * (H_FACE_IDS 순서)으로 떨어지고, 빈 면이 데이터 면보다 앞선 모서리에서만 데이터 면 우선과 갈라져요.
 * 3F(데이터 ZM·XM·YM 이 앞)에서는 두 규칙이 같고, 1F·2F·4F 에서 빈 면이 앞서는 모서리(예: ZM–XM, 4F 의 ZP–XP)에서 갈라져요.
 */
test('§6-6 자 검증: «가장 가까운 면» 소유 규칙이면 빈 면이 앞서는 모서리의 흰 링이 빈 면 색으로 바뀌어 빨개져요',()=>{
  let red=0;
  for(const code of [{version:1,mode:1,tones:3},{version:1,mode:2,tones:3},{version:2,mode:4,tones:3}]){
    const phys=physFor(code),built=buildPrintParts(phys,{ownership:'nearest'});
    assert.notEqual(built.report.blankHex,PRINT_WHITE,'빈 면이 흰색이면 두 규칙이 구별되지 않아요');
    const {out}=cornerMismatches(phys,built);
    assert.ok(out.length>0,JSON.stringify(code));
    assert.ok(out.every(m=>m.found[0]===built.report.blankHex&&m.expected===PRINT_WHITE));
    // 데이터-데이터 띠는 두 규칙 모두 흰색이라, 어긋남은 동률 순서에서 빈 면이 데이터 면보다 앞선 쌍에서만 나요.
    assert.ok(out.every(m=>phys.faces[m.B].blank&&H_FACE_IDS.indexOf(m.B)<H_FACE_IDS.indexOf(m.A)));
    red+=out.length;
  }
  // 대조: 3F 는 데이터 면이 동률 순서에서 앞서 두 규칙이 같은 메쉬를 내요.
  const three=physFor({version:0,mode:3,tones:3});
  assert.deepEqual(cornerMismatches(three,buildPrintParts(three,{ownership:'nearest'})).out,[]);
  assert.ok(red>0);
});

test('§6-6 d > 0.9c 는 TLP_DEPTH_GT_CELL, d = 0.9c 는 통과해요(셀 격자)',()=>{
  for(const cellUm of [800,1000,2000,3000]){
    const phys=physFor({version:0,mode:3,tones:3},{cellUm}),limit=cellUm*9/10;
    assert.throws(()=>buildPrintParts(phys,{depthUm:limit+1}),e=>e.code==='TLP_DEPTH_GT_CELL',`c=${cellUm}`);
    if(limit>=100)assert.doesNotThrow(()=>buildPrintParts(phys,{depthUm:limit}),`c=${cellUm}`);
  }
});

fullOnly(()=>test('§6-5 · §6-6 전수: 배치 × 반대면 복제 × 톤 × finder × 깊이 격자',()=>{
  let cases=0;
  for(const [finder,version] of [['frame',1],['frame',3],['corners',5]])for(const tones of [2,3])for(const mode of [1,2,3,4,5,6]){
    for(const arrangement of H_ARRANGEMENTS)for(const renderFaces of [3,6])for(const depthUm of [600,1600]){
      let model;
      try{model=buildHCubeModel(encodeH(Uint8Array.of(mode+tones),{version,mode,tones,finder,mask:(mode+version)%8}),{arrangement,renderFaces});}catch{continue;}
      if((cases+mode+tones+version+depthUm)%3)continue; // 결정적 표본(약 1/3)
      const phys=physicalHCube(model),built=buildPrintParts(phys,{depthUm}),label=`H${version} ${mode}F ${arrangement} rf${renderFaces} ${tones}톤 ${finder} d=${depthUm}`;
      assert.deepEqual(embedMismatches(phys,built).slice(0,3),[],label);
      assert.deepEqual(cornerMismatches(phys,built).out.slice(0,3),[],label);
      cases++;
    }
  }
  assert.ok(cases>=40,`표본 ${cases}건`);
}));
