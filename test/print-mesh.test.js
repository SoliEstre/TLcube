/**
 * 3D 인쇄 파트 메쉬(print-mesh.js)의 성질이에요(설계 §6-3 · §6-4 · §6-10 · §6-11 · §6-12 · §6-13).
 * 자는 산출 메쉬 그대로를 재요(위상 · 정확 부피 · 연결 성분 · 반직선 탐침). 자마다 심은 결함으로 한 번 빨개지는지도 봐요.
 * 매립 깊이(§6-5)와 모서리 소유(§6-6)는 print-mesh-embed.test.js 에 있어요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {H_FACE_IDS} from '../src/h-profile.js';
import {H_ARRANGEMENTS,hDisplayMap} from '../src/h-face-arrangement.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {physicalHCube,orientForBed} from '../src/cube-physical.js';
import {buildPrintParts,buildVertexStand,standCornerFaces,meshTopology,filamentSet,printBlankHex,colorChangeEstimate,hollowPlan,
  PRINT_HOLLOW_DEFAULTS,PRINT_RIB_UM,PRINT_STAND_DEFAULTS,PRINT_TRIANGLE_CAP,PRINT_WHITE} from '../src/print-mesh.js';
import {fullOnly} from './helpers/scope.mjs';
import {fixtures,exactSixVolume,surfaceComponents,partLocator,triangleArea,triangleNormal,triangleVertices,orientedPhys,modulePoint} from './helpers/print-mesh-probe.mjs';

/** 모드·톤·finder 가 받는 가장 작은 버전으로 인코딩해요. */
function encodeFor({mode,tones=3,finder='frame',version=0,mask=0}){
  for(let v=version;v<=8;v++){
    if(finder==='corners'&&v<5)continue;
    try{return encodeH(Uint8Array.of(mode*16+tones),{version:v,mode,tones,finder,mask,ecc:'M'});}catch{/* 다음 버전 */}
  }
  throw new Error(`인코딩 가능한 버전이 없어요: ${mode}F ${tones}톤 ${finder}`);
}
const physFor=(code,{options={},cellUm}={})=>physicalHCube(buildHCubeModel(encodeFor(code),options),cellUm?{cellUm}:{});

/**
 * 한 방 부피 × 6(µm³, BigInt). src 식과 다른 경로로 재요: 폭 w(z) 가 조각마다 일차라 w² 는 이차이고,
 * 심프슨 공식이 이차식에 정확하므로 6·∫w² = Δz·(w0² + (w0+w1)² + w1²) 예요.
 */
function roomSix({h,t,b,ribs}){
  const A=h+b/2,width=z=>ribs?Math.min(h,A-z)-t:2*Math.min(h,A-z);
  const knots=[-h,...(b/2<h?[b/2]:[]),h];
  let six=0n;
  for(let k=0;k+1<knots.length;k++){
    const z0=knots[k],z1=knots[k+1],w0=BigInt(width(z0)),w1=BigInt(width(z1));
    six+=BigInt(z1-z0)*(w0*w0+(w0+w1)*(w0+w1)+w1*w1);
  }
  return six;
}
/** 기대 부피 × 6 = 6·(L³ − 방 부피 합 − 숨구멍 부피). 보고서의 부피 필드는 쓰지 않고 입력 파라미터로만 계산해요. */
function expectedSix(report,{depthUm,hollow}){
  const L=BigInt(report.sideUm);let six=6n*L*L*L;
  if(!report.hollow.enabled)return six;
  const o={...PRINT_HOLLOW_DEFAULTS,...hollow},h=report.sideUm/2-depthUm-o.wallUm,ribs=report.hollow.ribs;
  const rooms=ribs?4:1;
  six-=BigInt(rooms)*roomSix({h,t:PRINT_RIB_UM/2,b:o.ceilingUm,ribs});
  six-=6n*BigInt(rooms)*BigInt(o.ventUm)**2n*BigInt(depthUm+o.wallUm);
  return six;
}
const partsSix=parts=>parts.reduce((s,p)=>s+exactSixVolume(p.mesh),0n);

/** 같은 설정의 ε 메쉬와 ε=0 메쉬를 짝지어 |V_ε − V_0| ≤ ε·Σ(이동 정점 인접 삼각형 면적)/3 을 재요(설계 §6-4). */
function epsilonBound(partsEps,partsZero,epsilonMm){
  let diff=0,bound=0;
  partsEps.forEach((part,k)=>{
    const zero=partsZero[k].mesh,eps=part.mesh;
    assert.deepEqual(eps.indices,zero.indices,'ε 는 위상을 바꾸지 않아요');
    const moved=new Uint8Array(zero.positions.length/3);
    for(let v=0;v<moved.length;v++)for(let a=0;a<3;a++)if(eps.positions[3*v+a]!==zero.positions[3*v+a])moved[v]=1;
    for(let t=0;t<zero.indices.length/3;t++){
      const count=moved[zero.indices[3*t]]+moved[zero.indices[3*t+1]]+moved[zero.indices[3*t+2]];
      if(count)bound+=count*triangleArea(zero,t);
    }
    // 사본은 제 상자 안쪽으로만 움직여요: 파트는 줄기만 하고(이웃 파트와 겹침 0) 늘지 않아요.
    assert.ok(part.volumeMm3<=partsZero[k].volumeMm3+1e-9,`${part.name}: ε 분리가 부피를 늘렸어요(바깥으로 이동 = 겹침)`);
    diff+=part.volumeMm3-partsZero[k].volumeMm3;
  });
  return {diff:Math.abs(diff),bound:epsilonMm*bound/3};
}

/** 파트 불변식 묶음: 위상 · 양의 부피 · 코어 표면 연결 성분 1 · 필라멘트 = 파트 색 · 삼각형 상한. */
function assertPartInvariants(parts,report,label){
  for(const part of parts){
    const topology=meshTopology(part.mesh);
    assert.equal(topology.ok,true,`${label} ${part.name} ${JSON.stringify(topology)}`);
    assert.ok(part.volumeMm3>0,`${label} ${part.name}`);
  }
  const core=parts.at(-1);
  assert.equal(core.role,'core');assert.equal(core.hex,PRINT_WHITE);
  assert.equal(surfaceComponents(core.mesh),1,`${label}: 코어 표면이 둘 이상 — 밀폐 공동`);
  assert.deepEqual([...new Set(parts.map(p=>p.hex))].sort(),[...report.filaments].sort(),label);
  assert.ok(report.triangles<=PRINT_TRIANGLE_CAP,label);
  assert.equal(report.triangles,parts.reduce((s,p)=>s+p.mesh.indices.length/3,0));
}

/* ───────────── §6-3 위상 자 ───────────── */

test('§6-3 자 검증: 심은 결함 fixture 는 결함마다 제 필드로만 빨개져요',()=>{
  const zero={openEdges:0,overEdges:0,misorientedEdges:0,degenerate:0};
  const fields=r=>({openEdges:r.openEdges,overEdges:r.overEdges,misorientedEdges:r.misorientedEdges,degenerate:r.degenerate});
  const good=meshTopology(fixtures.good());
  assert.equal(good.ok,true);assert.deepEqual(fields(good),zero);assert.ok(Math.abs(good.signedVolume-1)<1e-12);
  const cases={hole:{openEdges:3},flipped:{misorientedEdges:3},pinch:{overEdges:1},tJunction:{openEdges:3},degenerate:{degenerate:1},collinear:{degenerate:2}};
  for(const [name,expected] of Object.entries(cases)){
    const r=meshTopology(fixtures[name]());
    assert.equal(r.ok,false,name);
    assert.deepEqual(fields(r),{...zero,...expected},name);
  }
  const inverted=meshTopology(fixtures.inverted());
  assert.equal(inverted.ok,false);assert.deepEqual(fields(inverted),zero);assert.ok(Math.abs(inverted.signedVolume+1)<1e-12);
  // 밀폐 공동은 위상으로는 정상(닫힌 2-다양체 두 겹)이라 연결 성분 자가 따로 잡아요(§6-11).
  const sealed=fixtures.sealed();
  assert.equal(meshTopology(sealed).ok,true);assert.equal(surfaceComponents(sealed),2);
  assert.equal(surfaceComponents(fixtures.good()),1);
  assert.throws(()=>meshTopology({positions:[0,0,0],indices:[0,0]}),TypeError);
  assert.throws(()=>meshTopology({positions:[0,0,0],indices:[0,1,2]}),RangeError);
});

test('§6-3 실제 산출: 핀치 분리를 끄면 과다 공유 엣지가 드러나고 자체검사가 TLP_TOPOLOGY 로 막아요',()=>{
  const phys=physFor({mode:3,tones:3});
  const {report}=buildPrintParts(phys);
  assert.ok(report.pinchVertices>0,'대표 코드에 대각 접촉이 없으면 이 대조군이 성립하지 않아요');
  assert.throws(()=>buildPrintParts(phys,{pinchSplit:false}),error=>{
    assert.equal(error.code,'TLP_TOPOLOGY');assert.ok(error.topology.overEdges>0);assert.equal(error.topology.openEdges,0);
    return true;
  });
});

/* ───────────── §6-3 · §6-4 모드 전수(기본 범위, 작은 버전) ───────────── */

const MODE_TONE_CASES=[1,2,3,4,5,6].flatMap(mode=>[2,3].map(tones=>({mode,tones})));
test('§6-3 · §6-4 모든 모드 1F–6F × 2/3톤 × 속 비우기 켬/끔: 파트마다 닫힌 2-다양체, 부피 합 = L³ − 공동 − 숨구멍(ε=0 정확), ε 쐐기 상한',()=>{
  let hollowBuilds=0;
  for(const code of MODE_TONE_CASES)for(const hollow of [PRINT_HOLLOW_DEFAULTS,false]){
    const phys=physFor(code),label=`${code.mode}F ${code.tones}톤 hollow=${!!hollow}`;
    const depthUm=1000,{parts,report}=buildPrintParts(phys,{hollow});
    assertPartInvariants(parts,report,label);
    const zero=buildPrintParts(phys,{hollow,epsilonUm:0});
    assert.equal(partsSix(zero.parts),expectedSix(zero.report,{depthUm,hollow:hollow||{}}),label);
    const {diff,bound}=epsilonBound(parts,zero.parts,0.025);
    assert.ok(diff<=bound+1e-9,`${label}: |ΔV| ${diff} > ${bound}`);
    assert.ok(Math.abs(report.volumeMm3-report.expectedVolumeMm3)<=bound+1e-6,label);
    if(report.hollow.enabled)hollowBuilds++;
    // 6F 만 빈 면이 없어요. 속 비우기를 요청해도 솔리드이고 사유가 남아요.
    if(code.mode===6)assert.equal(report.hollow.reason,hollow?'TLP_NO_VENT_FACE':null,label);
    else assert.equal(report.hollow.enabled,!!hollow,label);
  }
  assert.equal(hollowBuilds,10);
});

/* ───────────── §6-10 공동 자립 ───────────── */

/**
 * 아래를 향하는 코어 삼각형(법선 z < 0)은 셋 중 하나예요:
 *   (a) 45° 이상 경사(|n_z| ≤ cos 45°), (b) 폭 b 이하 평탄 천장, (c) z = d 코어 바닥(바닥면 매립층 위에 얹힘).
 * 리브·숨구멍 채널 면은 수직(n_z = 0)이고, 코어 정점은 µm 정수예요.
 */
function supportViolations(core,report,{ceilingUm}){
  const L=report.sideUm,C=L/2,d=report.depthUm,h=report.hollow.halfUm,t=PRINT_RIB_UM/2,out=[];
  const T=core.indices.length/3;
  for(let t3=0;t3<T;t3++){
    const n=triangleNormal(core,t3),pts=triangleVertices(core,t3).map(p=>p.map(v=>Math.round(v*1000)));
    const zs=pts.map(p=>p[2]),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
    if(n[2]<-1e-12){
      const slope=Math.abs(n[2])<=Math.SQRT1_2+1e-12;
      const flat=Math.abs(n[2]+1)<1e-12;
      const ceiling=flat&&zs.every(z=>z===C+h)&&Math.max(...xs)-Math.min(...xs)<=ceilingUm&&Math.max(...ys)-Math.min(...ys)<=ceilingUm;
      const bottom=flat&&zs.every(z=>z===d);
      if(!slope&&!ceiling&&!bottom)out.push({kind:'overhang',pts,n});
    }
    const onRib=report.hollow.ribs&&([0,1].some(a=>pts.every(p=>p[a]===C+t)||pts.every(p=>p[a]===C-t)));
    const inChannel=zs.every(z=>z>=d&&z<=report.hollow.floorZUm)&&Math.max(...zs)>Math.min(...zs);
    if((onRib||inChannel)&&n[2]!==0)out.push({kind:'not-vertical',pts,n});
  }
  for(const v of core.positions)if(Math.abs(v*1000-Math.round(v*1000))>1e-6)out.push({kind:'non-integer',v});
  return out;
}
test('§6-10 공동 자립(고정 방향): 아래 향한 코어 면은 45° 경사·폭 b 이하 천장·코어 바닥뿐, 리브·채널은 수직, 정점은 µm 정수',()=>{
  const cases=[
    {label:'H4 3F 리브 켬',code:{mode:3,tones:3,version:4},hollow:{}},
    {label:'H4 3F 리브 끔',code:{mode:3,tones:3,version:4},hollow:{ribs:false}},
    {label:'H2 1F rf6 천장 8 mm',code:{mode:1,tones:2,version:2},options:{renderFaces:6},hollow:{ceilingUm:8000}},
    // L/2 − d − t_s = 4 mm = b/2 → 지붕이 닿지 않는 상자 공동, 리브 없음(h < 8 mm).
    {label:'H0 c=1.0 상자 공동',code:{mode:3,tones:3},cellUm:1000,depthUm:600,hollow:{wallUm:1900,ceilingUm:8000}},
  ];
  for(const {label,code,options,cellUm,depthUm=1000,hollow} of cases){
    const phys=physFor(code,{options,cellUm}),{parts,report}=buildPrintParts(phys,{hollow,depthUm});
    assert.equal(report.hollow.enabled,true,label);
    const o={...PRINT_HOLLOW_DEFAULTS,...hollow};
    const core=parts.at(-1).mesh;
    assert.deepEqual(supportViolations(core,report,o),[],label);
    // 지붕 경사면이 실제로 있고 정확히 45° 예요(상자 공동은 없음).
    const slopes=[...Array(core.indices.length/3).keys()].map(t=>triangleNormal(core,t)).filter(n=>n[2]<-1e-12&&n[2]>-1+1e-12);
    if(report.hollow.halfUm>o.ceilingUm/2){assert.ok(slopes.length>0,label);for(const n of slopes)assert.ok(Math.abs(Math.abs(n[2])-Math.SQRT1_2)<1e-12,label);}
    else assert.equal(slopes.length,0,label);
  }
  // 심은 결함: 천장 폭 판정을 b 보다 좁게 잡으면 평탄 천장이 오버행으로 빨개져요(자가 천장을 실제로 재는지).
  const phys=physFor({mode:3,tones:3,version:4}),{parts,report}=buildPrintParts(phys);
  assert.ok(supportViolations(parts.at(-1).mesh,report,{ceilingUm:1000}).some(v=>v.kind==='overhang'));
});

/* ───────────── §6-11 숨구멍 · 빈 면 ───────────── */

function displayConfigs(tones=3){
  const out=[],seen=new Set();
  for(const mode of [1,2,3,4,5,6]){
    const encoded=encodeFor({mode,tones});
    for(const arrangement of H_ARRANGEMENTS)for(const renderFaces of [3,6]){
      let map;try{map=hDisplayMap(encoded,{arrangement,renderFaces});}catch{continue;}
      if(seen.has(map.cacheKey))continue;seen.add(map.cacheKey);
      out.push({encoded,options:{arrangement,renderFaces},map,label:`${mode}F/${arrangement}/rf${renderFaces}`});
    }
  }
  return out;
}
test('§6-11 빈 면 = hDisplayMap.blankFaces, 6F 만 0개(속 비우기 비활성 + TLP_NO_VENT_FACE), 그 밖은 방마다 숨구멍 1개 · 모두 바닥 빈 면 · 코어 표면 1개',()=>{
  const configs=displayConfigs();
  assert.ok(configs.length>=20);
  for(const {encoded,options,map,label} of configs){
    const phys=physicalHCube(buildHCubeModel(encoded,options)),{parts,report}=buildPrintParts(phys);
    assert.deepEqual([...report.blankFaces],[...map.blankFaces],label);
    const plan=hollowPlan(phys);
    assert.equal(plan.enabled,report.hollow.enabled,label);assert.equal(plan.reason,report.hollow.reason,label);
    if(!map.blankFaces.length){
      assert.equal(encoded.mode,6,label);
      assert.equal(report.hollow.requested,true);assert.equal(report.hollow.enabled,false);assert.equal(report.hollow.reason,'TLP_NO_VENT_FACE');
      assert.equal(report.hollow.vents.length,0);assert.equal(parts.at(-1).mesh.indices.length/3,12,'솔리드 코어 상자');
      continue;
    }
    assert.equal(report.hollow.enabled,true,label);
    assert.ok(map.blankFaces.includes(report.bedFace),label);
    if(encoded.mode===5)assert.deepEqual([...map.blankFaces],['ZP']);
    const {vents,rooms,ribs}=report.hollow,L=report.sideUm,d=report.depthUm,t=PRINT_RIB_UM/2,C=L/2,h=report.hollow.halfUm;
    assert.ok(vents.length>=1);assert.equal(vents.length,rooms);assert.equal(rooms,ribs?4:1);
    // 방 바닥(사분면 또는 공동 전체) 하나에 숨구멍 정확히 하나.
    const floors=ribs?[[1,1],[-1,1],[-1,-1],[1,-1]].map(([sx,sy])=>({x0:sx>0?C+t:C-h,x1:sx>0?C+h:C-t,y0:sy>0?C+t:C-h,y1:sy>0?C+h:C-t})):[{x0:C-h,x1:C+h,y0:C-h,y1:C+h}];
    for(const f of floors)assert.equal(vents.filter(v=>v.x0>f.x0&&v.x1<f.x1&&v.y0>f.y0&&v.y1<f.y1).length,1,label);
    for(const v of vents)assert.ok(v.x0>d+report.hollow.wallUm&&v.x1<L-d-report.hollow.wallUm&&v.y0>d&&v.y1<L-d,label);
    assert.equal(surfaceComponents(parts.at(-1).mesh),1,label);
  }
});

test('§6-11 숨구멍은 실제로 뚫려 있고(탐침), 데이터 면 재질은 속 비우기 켬·끔에서 같아요',()=>{
  for(const code of [{mode:3,tones:3},{mode:5,tones:2,version:2},{mode:1,tones:3,version:1}]){
    const phys=physFor(code),label=JSON.stringify(code);
    const on=buildPrintParts(phys,{epsilonUm:0}),off=buildPrintParts(phys,{hollow:false,epsilonUm:0});
    const locOn=partLocator(on.parts),locOff=partLocator(off.parts);
    const {report}=on,d=report.depthUm,fz=report.hollow.floorZUm,C=report.sideUm/2;
    for(const v of report.hollow.vents){
      const cx=(v.x0+v.x1)/2,cy=(v.y0+v.y1)/2;
      assert.deepEqual(locOn.hexAt([cx,cy,d/2]),[],`${label} 매립층 숨구멍`);
      assert.deepEqual(locOn.hexAt([cx,cy,(d+fz)/2]),[],`${label} 코어 채널`);
      assert.deepEqual(locOn.hexAt([cx,cy,fz+500]),[],`${label} 방`);
      assert.deepEqual(locOn.hexAt([v.x0-300,cy,d/2]),[report.blankHex],`${label} 숨구멍 옆 매립층`);
      assert.deepEqual(locOff.hexAt([cx,cy,d/2]),[report.blankHex],`${label} 끔이면 막혀 있음`);
      assert.deepEqual(locOff.hexAt([cx,cy,C]),[PRINT_WHITE],`${label} 끔이면 코어`);
    }
    // 데이터 면 모듈 탐침(깊이 d/2)이 켬·끔에서 같은 색이에요.
    const oriented=orientedPhys(phys,report);let probes=0;
    for(const face of oriented.dataFaces)for(let i=0;i<oriented.n;i+=2)for(let j=0;j<oriented.n;j+=2){
      const p=modulePoint(oriented,face,i,j,d/2);
      assert.deepEqual(locOn.hexAt(p),locOff.hexAt(p),`${label} ${face}(${i},${j})`);probes++;
    }
    assert.ok(probes>=49);
    // 빈 면 색 파트만 숨구멍 매립 부피(v²·d)만큼 줄고, 나머지 색 파트는 정확히 같아요.
    const vent=BigInt(report.hollow.ventUm)**2n*BigInt(d)*BigInt(report.hollow.vents.length);
    for(const part of off.parts.slice(0,-1)){
      const other=on.parts.find(p=>p.hex===part.hex&&p.role===part.role);
      const delta=exactSixVolume(part.mesh)-exactSixVolume(other.mesh);
      assert.equal(delta,part.hex===report.blankHex?6n*vent:0n,`${label} ${part.name}`);
    }
  }
});

test('속 비우기 사유: 데이터 면을 바닥으로 지정하면 TLP_NO_VENT_FACE, 공동이 작으면 TLP_HOLLOW_SMALL — 둘 다 솔리드로 내보내요',()=>{
  const phys=physFor({mode:3,tones:3});
  const onData=buildPrintParts(phys,{bedFace:'XM'});
  assert.equal(onData.report.bedFace,'XM');assert.equal(onData.report.hollow.reason,'TLP_NO_VENT_FACE');
  assert.equal(onData.parts.at(-1).mesh.indices.length/3,12);
  // H0 c=0.8 → L = 10.4 mm, h = 5.2 − 0.6 − 1.2 < 4 mm.
  const small=buildPrintParts(physFor({mode:3,tones:3},{cellUm:800}),{depthUm:600});
  assert.equal(small.report.hollow.reason,'TLP_HOLLOW_SMALL');assert.equal(small.report.hollow.enabled,false);
  // 숨구멍이 방 바닥 − 2 mm 보다 크면 공동을 만들지 않아요.
  const plan=hollowPlan(phys);
  const big=buildPrintParts(phys,{hollow:{ventUm:plan.ventMaxUm+1}});
  assert.equal(big.report.hollow.reason,'TLP_HOLLOW_SMALL');
  assert.equal(buildPrintParts(phys,{hollow:{ventUm:plan.ventMaxUm}}).report.hollow.enabled,true);
  // h < 8 mm 이면 리브만 꺼요(방 1개 · 숨구멍 1개).
  const noRib=buildPrintParts(physFor({mode:3,tones:3},{cellUm:1400}));
  assert.ok(noRib.report.hollow.halfUm<8000);
  assert.equal(noRib.report.hollow.ribs,false);assert.equal(noRib.report.hollow.ribsReason,'TLP_HOLLOW_SMALL');assert.equal(noRib.report.hollow.vents.length,1);
});

test('숨구멍 모서리는 격자 평면과 같거나 충분히 떨어져요(얇은 상자 방지) — 셀·깊이·숨구멍 크기 격자에서',()=>{
  const phys0=physFor({mode:3,tones:3,version:4});
  let moved=0;
  for(const cellUm of [1400,2000,2600])for(const depthUm of [600,1000])for(const ventUm of [1000,1990,2000,2010,3333]){
    if(depthUm*10>cellUm*9)continue;
    const phys=physicalHCube(buildHCubeModel(encodeFor({mode:3,tones:3,version:4})),{cellUm});
    const plan=hollowPlan(phys,{depthUm,hollow:{ventUm}});
    if(!plan.enabled)continue;
    const L=phys.sideUm;
    for(const v of plan.vents)for(const e of [v.x0,v.x1,v.y0,v.y1]){
      const r=((e%cellUm)+cellUm)%cellUm,gap=Math.min(r,cellUm-r,Math.abs(e-depthUm),Math.abs(e-(L-depthUm)));
      assert.ok(gap===0||gap>=100,`c=${cellUm} d=${depthUm} v=${ventUm} 모서리 ${e} 간격 ${gap}`);
    }
    // 방 바닥 중심에서 크게 벗어나지 않아요(셀 반 폭 이내).
    const t=PRINT_RIB_UM/2,h=plan.halfUm,C=L/2;
    const ideal=plan.ribs?C+(t+h)/2:C,centre=(plan.vents[0].x0+plan.vents[0].x1)/2;
    const shift=Math.abs(centre-ideal);
    assert.ok(shift<=cellUm/2+1,`c=${cellUm} v=${ventUm} 이동 ${shift}`);
    if(shift>1)moved++;
    buildPrintParts(phys,{depthUm,hollow:{ventUm}}); // 자체검사 통과
  }
  assert.ok(moved>0,'옮김 경로가 한 번도 안 쓰였으면 이 자는 비어 있어요');
  void phys0;
});

/* ───────────── §6-12 받침대 ───────────── */

/** 볼록 껍질(xy, 단조 사슬). */
function hull(points){
  const p=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]),crossZ=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower=[],upper=[];
  for(const q of p){while(lower.length>=2&&crossZ(lower.at(-2),lower.at(-1),q)<=1e-12)lower.pop();lower.push(q);}
  for(const q of p.reverse()){while(upper.length>=2&&crossZ(upper.at(-2),upper.at(-1),q)<=1e-12)upper.pop();upper.push(q);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
const lineDistance=(p,a,b)=>Math.abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/Math.hypot(b[0]-a[0],b[1]-a[1]);
/** 받침대 메쉬에서 치수를 다시 재요(info 를 쓰지 않아요). 단위 mm. */
function standMeasure(stand,sideMm){
  const pts=[];for(let k=0;k<stand.positions.length;k+=3)pts.push([stand.positions[k],stand.positions[k+1],stand.positions[k+2]]);
  const zs=pts.map(p=>p[2]),zmin=Math.min(...zs),zmax=Math.max(...zs);
  const top=pts.filter(p=>Math.abs(p[2]-zmax)<1e-9),topHull=hull(top);
  const onHull=p=>topHull.some(q=>Math.abs(q[0]-p[0])<1e-12&&Math.abs(q[1]-p[1])<1e-12);
  const rim=top.filter(p=>!onHull(p));
  const wall=Math.min(...rim.flatMap(p=>topHull.map((a,k)=>lineDistance(p,a,topHull[(k+1)%topHull.length]))));
  const foot=hull(pts.filter(p=>Math.abs(p[2]-zmin)<1e-9)),centre=[0,1].map(a=>foot.reduce((s,p)=>s+p[a],0)/foot.length);
  const footApothem=Math.min(...foot.map((a,k)=>lineDistance(centre,a,foot[(k+1)%foot.length])));
  const apexIndex=pts.findIndex(p=>Math.hypot(p[0]-centre[0],p[1]-centre[1])<1e-9&&p[2]<zmax-1e-9);
  const apex=pts[apexIndex],cgHeight=apex[2]+sideMm*Math.sqrt(3)/2;
  const pocket=[];for(let t=0;t<stand.indices.length/3;t++)if([0,1,2].some(k=>stand.indices[3*t+k]===apexIndex))pocket.push(triangleNormal(stand,t));
  return {zmin,zmax,rim,wall,footApothem,apex,cgHeight,pocket,legs:rim.map(p=>Math.hypot(p[0]-apex[0],p[1]-apex[1],p[2]-apex[2]))};
}
/**
 * 틈 g 의 성질(설계 §2.7): 다리 ℓ = L/4 로 림에 닿게 놓은 큐브 모서리(꼭짓점 높이 = 림 − ℓ/√3)가 포켓 세 면에서
 * 정확히 g 떨어져 있어요. 포켓 면은 꼭짓점(apex)을 지나고 법선의 수직 성분이 1/√3 이라 거리 = (그 높이 − apex)/√3 이에요.
 * 메쉬에서 잰 값만 써요(info 를 쓰지 않아요).
 */
const standGapMm=(m,sideMm)=>((m.zmax-sideMm/4/Math.sqrt(3))-m.apex[2])/Math.sqrt(3);
test('§6-12 받침대: 매니폴드 · 바닥 z=0 · 포켓 꼭짓점이 바닥판 위 · 벽 ≥ 2 mm · 발 아포템/무게중심 ≥ 0.35 · 포켓은 수직 세 면',()=>{
  const g=PRINT_STAND_DEFAULTS.clearanceUm/1000;
  for(const [code,cellUm] of [[{mode:3,tones:3},800],[{mode:3,tones:3},2000],[{mode:3,tones:3,version:4},2000],[{mode:6,tones:3,version:8},2000],[{mode:6,tones:3,version:8},5000]]){
    const phys=physFor(code,{cellUm}),stand=buildVertexStand(phys),L=phys.sideUm/1000,label=`L=${L}`;
    const topology=meshTopology(stand);
    assert.equal(topology.ok,true,`${label} ${JSON.stringify(topology)}`);
    const m=standMeasure(stand,L);
    assert.equal(m.zmin,0,label);
    assert.ok(m.apex[2]>=2-1e-9,`${label}: 포켓 꼭짓점이 바닥판 윗면 아래`);
    assert.equal(m.rim.length,3,label);
    assert.ok(m.wall>=2-1e-9,`${label}: 벽 ${m.wall}`);
    assert.ok(m.footApothem/m.cgHeight>=0.35-1e-12,`${label}: ${m.footApothem}/${m.cgHeight}`);
    // 포켓 면 위 다리는 큐브 다리 ℓ 에 틈 몫 3g 를 더한 길이이고, 림에 닿는 큐브 모서리와 포켓 면 사이는 g 예요.
    for(const leg of m.legs)assert.ok(Math.abs(leg-(L/4+3*g))<1e-9,`${label}: 포켓 다리 ${leg}`);
    assert.ok(Math.abs(standGapMm(m,L)-g)<1e-9,`${label}: 틈 ${standGapMm(m,L)}`);
    assert.equal(m.pocket.length,3);
    // 포켓 세 면은 서로 수직(큐브 모서리)이고, 각 법선은 수직축과 arccos(1/√3) — 몸 대각선이 수직이에요.
    for(let a=0;a<3;a++){
      assert.ok(Math.abs(m.pocket[a][2]-1/Math.sqrt(3))<1e-9,label);
      for(let b=a+1;b<3;b++)assert.ok(Math.abs(m.pocket[a][0]*m.pocket[b][0]+m.pocket[a][1]*m.pocket[b][1]+m.pocket[a][2]*m.pocket[b][2])<1e-9,label);
    }
    // 부피 = 발 육각기둥 + 기둥 − 포켓(다리³/6, 다리 = 메쉬에서 잰 포켓 다리).
    const i=stand.info,hex=r=>1.5*Math.sqrt(3)*r*r,depth=m.zmax-i.floorUm/1000;
    const expected=hex(i.footRadiusUm/1000)*i.floorUm/1000+hex(i.pillarRadiusUm/1000)*depth-m.legs[0]**3/6;
    assert.ok(Math.abs(topology.signedVolume-expected)<=1e-9*expected,label);
    assert.deepEqual([...i.cornerFaces],['ZP','XP','YP']);
    assert.deepEqual([...i.coveredDataFaces],i.cornerFaces.filter(face=>!phys.faces[face].blank),label);
  }
  // 틈은 기하에 들어가요: g 를 바꾸면 메쉬가 바뀌고 잰 틈이 g 를 따라가요. 심은 결함: g 를 무시한 받침대(g = 0 메쉬)를
  // g = 0.2 mm 로 주장하면 잰 틈이 0 이라 자가 빨개져요.
  {
    const phys=physFor({mode:3,tones:3,version:4}),L=phys.sideUm/1000;
    const gaps=[0,200,1000].map(clearanceUm=>standGapMm(standMeasure(buildVertexStand(phys,{clearanceUm}),L),L));
    gaps.forEach((gap,k)=>assert.ok(Math.abs(gap-[0,0.2,1][k])<1e-9,`g=${[0,0.2,1][k]}: ${gap}`));
    const ignored=standMeasure(buildVertexStand(phys,{clearanceUm:0}),L);
    assert.ok(Math.abs(standGapMm(ignored,L)-0.2)>0.1,'g 를 무시한 받침대가 틈 자를 통과했어요');
  }
  // 심은 결함: 원 설계식(외접반지름 = e√2 + 2 mm, 반지름 방향 벽)으로 기둥 윗면을 좁히면 최단 벽이 약 1.73 mm 라 자가 빨개져요.
  const phys=physFor({mode:3,tones:3,version:4}),stand=buildVertexStand(phys),i=stand.info;
  const radial=(i.rimRadiusUm+2000)/i.pillarRadiusUm,positions=Float64Array.from(stand.positions);
  for(let k=0;k<positions.length;k+=3)if(Math.abs(positions[k+2]-i.heightUm/1000)<1e-9&&Math.hypot(positions[k],positions[k+1])>i.rimRadiusUm/1000+1e-6){positions[k]*=radial;positions[k+1]*=radial;}
  const narrowed=standMeasure({positions,indices:stand.indices},phys.sideUm/1000);
  assert.ok(narrowed.wall<2&&narrowed.wall>1.7,`좁힌 벽 ${narrowed.wall}`);
  assert.throws(()=>buildVertexStand(phys,{wallUm:0}),RangeError);
});

test('§6-12 받침대 꼭짓점: 세 면 = 물리 (L,L,L) 의 +x·+y·+z 면(인쇄 방향으로 돌려도 같음), 가리는 데이터 면 = 그중 데이터 면',()=>{
  const seen={covered:0,clear:0};
  for(const mode of [1,2,3,4,5,6])for(const arrangement of H_ARRANGEMENTS)for(const renderFaces of [3,6]){
    const encoded=encodeFor({mode});
    try{hDisplayMap(encoded,{arrangement,renderFaces});}catch{continue;}
    const phys=physicalHCube(buildHCubeModel(encoded,{arrangement,renderFaces})),label=`${mode}F ${arrangement} rf${renderFaces}`;
    const {cornerFaces,coveredDataFaces}=standCornerFaces(phys);
    assert.deepEqual(cornerFaces.map(face=>phys.faces[face].plane).sort(),['+x','+y','+z'],label);
    assert.deepEqual(standCornerFaces(orientForBed(phys).phys),{cornerFaces,coveredDataFaces},`${label}: 회전 뒤`);
    assert.deepEqual([...coveredDataFaces],phys.dataFaces.filter(face=>cornerFaces.includes(face)),label);
    seen[coveredDataFaces.length?'covered':'clear']++;
  }
  // 자가 비어 있지 않아요: 데이터 면을 가리는 배치와 가리지 않는 배치가 둘 다 있어요.
  assert.ok(seen.covered>0&&seen.clear>0,JSON.stringify(seen));
});

/* ───────────── §6-13 추정 ───────────── */

/** 모델의 모든 쿼드 색을 바꾼 합성 PhysCube(6F 라 빈 면 없음). */
function synthetic(colorOf,{version=0}={}){
  const model=buildHCubeModel(encodeFor({mode:6,tones:3,version}));
  return physicalHCube({...model,quads:model.quads.map(q=>({...q,color:colorOf(q)}))});
}
/** 층 k 가 열린 구간 (lo, hi) 와 양의 길이로 겹치는지. */
const overlaps=(k,layer,lo,hi)=>k*layer<hi&&(k+1)*layer>lo;
test('§6-13 색 교체 추정: 손 계산 가능한 합성 면에서 정확값',()=>{
  const grey={r:120,g:120,b:120},A={r:40,g:40,b:40},B={r:200,g:200,b:200};
  for(const depthUm of [1000,1100]){
    // 단색 면: 바닥·윗면 d 층 안은 1색, 코어가 있는 층은 면 색 + 흰색 = 2색.
    const mono=synthetic(()=>grey),L=mono.sideUm,layers=Math.ceil(L/200);
    const middle=[...Array(layers).keys()].filter(k=>overlaps(k,200,depthUm,L-depthUm)).length;
    const est=colorChangeEstimate(mono,{depthUm});
    assert.equal(est.layers,layers);assert.equal(est.changes,middle,`d=${depthUm}`);
    assert.deepEqual(est.colors,['#787878',PRINT_WHITE]);
    // 체커 면(행마다 2색): 바닥·윗면 층은 2색(교체 1), 코어 층은 2색 + 흰색(교체 2).
    const checker=synthetic(q=>(q.i+q.j)%2?A:B),est2=colorChangeEstimate(checker,{depthUm});
    assert.equal(est2.changes,2*middle+(layers-middle),`d=${depthUm}`);
    assert.equal(est2.maxPerLayer,3);
  }
  assert.throws(()=>colorChangeEstimate(synthetic(()=>grey),{layerUm:0}),RangeError);
});

/** 메쉬에서 층마다 색을 다시 세요(ε=0, µm 정수 z). 삼각형이 층의 열린 구간과 양의 길이로 겹치거나, 수평 삼각형이 층 안쪽에 있으면 그 색이 있어요. */
function meshLayerCounts(parts,layerUm,sideUm){
  const layers=Math.ceil(sideUm/layerUm),sets=[...Array(layers)].map(()=>new Set());
  for(const part of parts){
    const m=part.mesh;
    for(let t=0;t<m.indices.length/3;t++){
      const zs=[0,1,2].map(k=>Math.round(m.positions[3*m.indices[3*t+k]+2]*1000)),lo=Math.min(...zs),hi=Math.max(...zs);
      const k0=Math.max(0,Math.floor(lo/layerUm)-1),k1=Math.min(layers-1,Math.floor(hi/layerUm)+1);
      for(let k=k0;k<=k1;k++){
        const z0=k*layerUm,z1=Math.min(sideUm,(k+1)*layerUm);
        if(lo<hi?(lo<z1&&hi>z0):(lo>z0&&lo<z1))sets[k].add(part.hex);
      }
    }
  }
  return sets.map(s=>s.size);
}
test('§6-13 실제 H: 층별 색 수 = 메쉬에서 다시 센 값, 교체 ≤ 4 × 층 수, 필라멘트 = 파트 색',()=>{
  for(const [code,hollow] of [[{mode:3,tones:3},true],[{mode:1,tones:2,version:1},false],[{mode:6,tones:3,finder:'corners',version:5},true],[{mode:4,tones:3,version:2},true]]){
    const phys=physFor(code),label=JSON.stringify(code);
    const est=colorChangeEstimate(phys),{parts,report}=buildPrintParts(phys,{hollow,epsilonUm:0});
    assert.deepEqual([...est.perLayer],meshLayerCounts(parts,200,report.sideUm),label);
    assert.ok(est.changes<=4*est.layers,label);
    assert.ok(est.maxPerLayer<=est.colors.length&&est.maxPerLayer<=5,label);
    assert.deepEqual(est.colors,filamentSet(phys));
    assert.deepEqual([...report.filaments],filamentSet(phys),label);
  }
  // 심은 결함: 층 높이를 바꿔 센 메쉬 값은 추정과 달라요(자가 층 경계를 실제로 가르는지).
  const phys=physFor({mode:3,tones:3}),{parts,report}=buildPrintParts(phys,{epsilonUm:0});
  assert.notDeepEqual([...colorChangeEstimate(phys,{depthUm:1600}).perLayer],meshLayerCounts(parts,200,report.sideUm));
});

test('§6-13 필라멘트 수: frame 2톤은 H0·H1·H3·H4·H6·H7 = 5, H2·H5·H8 = 4(filler 유무), 3톤은 5 — 파트 색과 같아요',()=>{
  for(let version=0;version<=8;version++)for(const tones of [2,3]){
    const phys=physicalHCube(buildHCubeModel(encodeH(Uint8Array.of(1),{version,mode:3,tones,finder:'frame'})));
    const expected=tones===3?5:[2,5,8].includes(version)?4:5;
    assert.equal(filamentSet(phys).length,expected,`H${version} ${tones}톤`);
    // filler 가 없으면 모델 빈 면 색(levels[1])이 데이터에 없어 빈 면은 흰색으로 찍어요.
    assert.equal(printBlankHex(phys),expected===4?PRINT_WHITE:phys.blankHex,`H${version} ${tones}톤`);
    if(version<=2){const {report}=buildPrintParts(phys);assert.equal(report.filaments.length,expected);assert.equal(report.amsOverflow,expected>4);}
  }
});

/* ───────────── 옵션 · 결정성 · 오류 ───────────── */

test('결정성: 같은 입력은 같은 메쉬, 입력 PhysCube 는 변하지 않고, 이미 돌린 PhysCube 도 같은 결과예요',async()=>{
  const {orientForBed}=await import('../src/cube-physical.js');
  const phys=physFor({mode:3,tones:3}),before=JSON.stringify(phys);
  const a=buildPrintParts(phys),b=buildPrintParts(phys),c=buildPrintParts(orientForBed(phys).phys);
  assert.equal(JSON.stringify(phys),before);
  for(const other of [b,c])a.parts.forEach((part,k)=>{
    assert.deepEqual(other.parts[k].mesh.positions,part.mesh.positions);assert.deepEqual(other.parts[k].mesh.indices,part.mesh.indices);
    assert.equal(other.parts[k].name,part.name);
  });
  assert.deepEqual(c.report.orientation,a.report.orientation);
  // 이름·역할: 휘도 오름차순 순번, k·t0…·w·core.
  assert.deepEqual(a.parts.map(p=>p.name),['1-k-000000','2-t0-686868','3-t1-adadad','4-t2-e2e2e2','5-w-ffffff','6-core-ffffff']);
  assert.deepEqual(H_FACE_IDS.filter(face=>a.report.dataFaces.includes(face)),['ZM','XM','YM']);
});

test('오류: 매립 깊이 > 0.9c 는 TLP_DEPTH_GT_CELL, 삼각형 상한 초과는 TLP_TRI_CAP, 범위 밖 옵션은 RangeError',()=>{
  const phys=physFor({mode:3,tones:3});
  assert.throws(()=>buildPrintParts(phys,{depthUm:1801}),e=>e.code==='TLP_DEPTH_GT_CELL');
  assert.doesNotThrow(()=>buildPrintParts(phys,{depthUm:1800}));
  assert.throws(()=>colorChangeEstimate(phys,{depthUm:1801}),e=>e.code==='TLP_DEPTH_GT_CELL');
  assert.throws(()=>buildPrintParts(phys,{triangleCap:1000}),e=>e.code==='TLP_TRI_CAP'&&e.triangles>1000);
  for(const hollow of [{wallUm:800},{wallUm:3001},{ceilingUm:5100},{ceilingUm:1800},{ventUm:999},{ribs:'yes'}])
    assert.throws(()=>buildPrintParts(phys,{hollow}),hollow.ribs?TypeError:RangeError,JSON.stringify(hollow));
  assert.throws(()=>buildPrintParts(phys,{depthUm:50}),RangeError);
  assert.throws(()=>buildPrintParts(phys,{epsilonUm:-1}),RangeError);
  assert.throws(()=>buildPrintParts({kind:'H'}),TypeError);
});

/* ───────────── 전수 범위 ───────────── */

/** 결정적 난수(mulberry32). */
function rng(seed){return()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
fullOnly(()=>test('§6-3 · §6-4 · §6-11 · §6-13 전수: 무작위 60건 × (버전 · 모드 · 배치 · 반대면 복제 · 톤 · finder · 셀 · 깊이 · 속 비우기 변형)',()=>{
  const random=rng(20260923),pick=list=>list[Math.floor(random()*list.length)];
  let done=0,hollowDone=0,maxTriangles=0;
  for(let attempt=0;done<60&&attempt<400;attempt++){
    const mode=1+Math.floor(random()*6),tones=pick([2,3]),finder=pick(['frame','corners']),version=finder==='corners'?5+Math.floor(random()*4):Math.floor(random()*9);
    const arrangement=pick(H_ARRANGEMENTS),renderFaces=pick([3,6]),cellUm=pick([800,1200,1400,2000,2600,3400,5000]);
    const depthUm=pick([600,1000,1600,2000].filter(d=>d*10<=cellUm*9));
    const hollow=pick([true,false,{ribs:false},{ceilingUm:2000,wallUm:900},{ventUm:1000,wallUm:3000,ceilingUm:8000}]);
    let encoded,model;
    try{encoded=encodeH(Uint8Array.of(attempt&255),{version,mode,tones,finder,mask:attempt%8});model=buildHCubeModel(encoded,{arrangement,renderFaces});}catch{continue;}
    const phys=physicalHCube(model,{cellUm}),label=`H${version} ${mode}F ${arrangement} rf${renderFaces} ${tones}톤 ${finder} c=${cellUm} d=${depthUm} ${JSON.stringify(hollow)}`;
    const {parts,report}=buildPrintParts(phys,{depthUm,hollow});
    assertPartInvariants(parts,report,label);
    const zero=buildPrintParts(phys,{depthUm,hollow,epsilonUm:0});
    assert.equal(partsSix(zero.parts),expectedSix(zero.report,{depthUm,hollow:typeof hollow==='object'?hollow:{}}),label);
    const {diff,bound}=epsilonBound(parts,zero.parts,0.025);
    assert.ok(diff<=bound+1e-9,label);
    const est=colorChangeEstimate(phys,{depthUm});
    assert.ok(est.changes<=4*est.layers,label);
    assert.deepEqual([...est.perLayer],meshLayerCounts(zero.parts,200,report.sideUm),label);
    if(report.hollow.enabled){hollowDone++;assert.ok(report.hollow.vents.length>=1);}
    else if(hollow!==false)assert.ok(['TLP_NO_VENT_FACE','TLP_HOLLOW_SMALL'].includes(report.hollow.reason),label);
    maxTriangles=Math.max(maxTriangles,report.triangles);done++;
  }
  assert.equal(done,60);assert.ok(hollowDone>=20,`속 비우기 켬 ${hollowDone}건`);
  assert.ok(maxTriangles<PRINT_TRIANGLE_CAP);
}));

fullOnly(()=>test('삼각형 상한 여유: H8 모든 모드 × 톤 × finder × 속 비우기 최대가 상한의 절반 아래',()=>{
  let max=0,worst='';
  for(const mode of [1,2,3,4,5,6])for(const tones of [2,3])for(const finder of ['frame','corners'])for(const hollow of [true,false])for(const renderFaces of [3,6]){
    let model;try{model=buildHCubeModel(encodeH(Uint8Array.of(7),{version:8,mode,tones,finder}),{renderFaces});}catch{continue;}
    const {report}=buildPrintParts(physicalHCube(model),{hollow});
    if(report.triangles>max){max=report.triangles;worst=`${mode}F ${tones}톤 ${finder} rf${renderFaces} hollow=${hollow}`;}
  }
  assert.ok(max<PRINT_TRIANGLE_CAP/2,`${worst}: ${max}`);
}));
