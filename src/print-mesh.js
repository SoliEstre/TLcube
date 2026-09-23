/**
 * 타입 H 물리 큐브(PhysCube)를 3D 인쇄용 «색별 파트» 메쉬로 만들어요(설계 §2.3 · §2.5 · §2.7 · §2.8).
 *
 * 무엇을 만드나
 *   - 매립 파트: 서로 다른 색마다 하나. 모듈 색이 겉에서 깊이 d 까지 같은 색 기둥으로 박혀 있어요.
 *     겉이 d 미만으로 닳아도 코드가 남게 하려는 거예요.
 *   - 코어 파트: [d, L−d]³ 상자. 속 비우기를 켜면 인쇄 방향을 고정한 공동(수직 벽 + 45° 지붕 + 폭 b 이하 평탄 천장),
 *     공동을 네 방으로 나누는 수직 십자 리브, 방마다 바닥면 숨구멍 1개가 들어가요. 밀폐 공동은 만들지 않아요.
 *   - 받침대: 숨은 꼭짓점 (L,L,L) 을 아래로 세워 잡는 단색 메쉬(buildVertexStand).
 *
 * 기하 규약
 *   - 모든 격자 평면과 코어 정점은 µm 정수로 계산해요. 출력할 때만 mm 로 바꿔요(부동소수 평면 중복 방지).
 *   - 좌표는 인쇄 방향(orientForBed)으로 돌린 틀이에요. 바닥면이 z = 0, 큐브는 [0, L]³ 이에요.
 *   - 한 파트 안에서는 모든 정점이 같은 격자 꼭짓점이라 T-정션이 생기지 않아요.
 *   - 같은 색 상자가 대각으로만 닿는 꼭짓점(핀치)은 성분마다 사본을 만들어 ε 만큼 떼어 놓아요.
 *     엣지당 삼각형이 정확히 2개(방향 반대 1쌍)가 되게 하려는 거예요.
 *
 * 오류 코드(err.code): TLP_DEPTH_GT_CELL · TLP_TOPOLOGY · TLP_TRI_CAP.
 * 속 비우기를 만들 수 없는 경우(TLP_NO_VENT_FACE · TLP_HOLLOW_SMALL)는 던지지 않고 솔리드로 내보내며 report 에 사유를 남겨요.
 */
import {H_FACE_IDS} from './h-profile.js';
import {orientForBed} from './cube-physical.js';

/** 기본 매립 깊이(µm, 층 0.2 mm 기준 5층). */
export const PRINT_DEPTH_UM=1000;
/** 핀치 분리 거리(µm). 마주 보는 두 사본 사이가 2ε 예요(설계 §2.3.4). */
export const PRINT_EPSILON_UM=25;
/** 수직 십자 리브 두께(µm) = 선폭 0.45 mm 의 3배. 고정값이에요. */
export const PRINT_RIB_UM=1350;
/** 파트 합계 삼각형 상한(설계 §2.9). */
export const PRINT_TRIANGLE_CAP=300000;
export const PRINT_WHITE='#ffffff';
/**
 * 속 비우기 기본값. 기본은 «켬»이에요(리브 · 방별 숨구멍 포함). 숨구멍을 둘 빈 면이 없으면(6F) 자동으로 솔리드가 돼요.
 * wallUm = 구조 벽 t_s, ceilingUm = 평탄 천장 폭 b, ventUm = 숨구멍 한 변 v.
 */
export const PRINT_HOLLOW_DEFAULTS=Object.freeze({enabled:true,wallUm:1200,ceilingUm:5000,ribs:true,ventUm:2000});
/** 입력 범위와 유도 임계(µm). UI 는 이 값으로 입력을 막아요. */
export const PRINT_LIMITS=Object.freeze({
  depthMinUm:100,depthRatioMax:0.9,
  wallMinUm:900,wallMaxUm:3000,
  ceilingMinUm:2000,ceilingMaxUm:8000,ceilingStepUm:200,
  ventMinUm:1000,ventRoomMarginUm:2000,ventPlacementMarginUm:500,
  hollowMinHalfUm:4000,ribMinHalfUm:8000,
  epsilonMaxUm:100,
  buildVolumeUm:180000,smallCellUm:1200,amsSlots:4,
});
/** 받침대 기본값(설계 §2.7). */
export const PRINT_STAND_DEFAULTS=Object.freeze({clearanceUm:200,wallUm:2000,floorUm:2000,footRatio:0.35,footStepUm:1000});

const INTERIOR=-1,EMPTY=-2,OUTSIDE=-3;
const COS30=Math.sqrt(3)/2;

function tlpError(code,message,extra){const error=new RangeError(message);error.code=code;if(extra)Object.assign(error,extra);return error;}

/* ───────────── 색 · 필라멘트 ───────────── */

function hexLuminance(hex){
  const lin=[1,3,5].map(k=>parseInt(hex.slice(k,k+2),16)/255).map(s=>s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4);
  return 0.2126*lin[0]+0.7152*lin[1]+0.0722*lin[2];
}
const byLuminance=(a,b)=>hexLuminance(a)-hexLuminance(b)||(a<b?-1:a>b?1:0);

function checkPhys(phys){
  if(!phys||phys.kind!=='H-physical'||!Number.isInteger(phys.n)||!Number.isSafeInteger(phys.cellUm)||!phys.faces
    ||!Array.isArray(phys.dataFaces)||!Array.isArray(phys.blankFaces))throw new TypeError('PhysCube 가 필요해요');
  for(const face of H_FACE_IDS)if(!phys.faces[face]||!Array.isArray(phys.faces[face].hex)||phys.faces[face].hex.length!==phys.n*phys.n)throw new TypeError(`PhysCube 면 ${face}`);
  return phys;
}

/**
 * 인쇄용 빈 면 색이에요(설계 §2.3.2). 모델 빈 면 색이 이미 데이터 색에 있으면 그대로(정본 렌더와 같음), 없으면 흰색이에요.
 * 빈 면이 없으면 null.
 */
export function printBlankHex(phys){
  checkPhys(phys);
  if(!phys.blankFaces.length)return null;
  const data=new Set(phys.dataFaces.flatMap(face=>phys.faces[face].hex));
  return data.has(phys.blankHex)?phys.blankHex:PRINT_WHITE;
}

/** 필라멘트 = 실제 파트 색 종류예요(코어 흰색 포함). 휘도 오름차순. 메쉬 없이 O(n²) 로 세요. */
export function filamentSet(phys){
  checkPhys(phys);
  const set=new Set(phys.dataFaces.flatMap(face=>phys.faces[face].hex));
  const blank=printBlankHex(phys);if(blank)set.add(blank);
  set.add(PRINT_WHITE);
  return [...set].sort(byLuminance);
}

/* ───────────── 옵션 · 인쇄 방향 ───────────── */

function checkDepth(phys,depthUm){
  if(!Number.isSafeInteger(depthUm)||depthUm<PRINT_LIMITS.depthMinUm)throw new RangeError(`매립 깊이는 ${PRINT_LIMITS.depthMinUm} µm 이상 정수여야 해요`);
  // d ≤ 0.9c 를 정수로 비교해요. d ≥ c 이면 레일 셀끼리 모서리에서 대각으로만 닿는 경우가 생겨요(설계 §2.3.3).
  if(depthUm*10>phys.cellUm*9)throw tlpError('TLP_DEPTH_GT_CELL','매립 깊이는 셀 크기의 0.9 배 이하여야 해요',{depthUm,cellUm:phys.cellUm});
  return depthUm;
}
function checkEpsilon(epsilonUm){
  if(typeof epsilonUm!=='number'||!Number.isFinite(epsilonUm)||epsilonUm<0||epsilonUm>PRINT_LIMITS.epsilonMaxUm)
    throw new RangeError(`핀치 분리 ε 는 0..${PRINT_LIMITS.epsilonMaxUm} µm 이어야 해요`);
  return epsilonUm;
}
function resolveHollow(hollow){
  const given=hollow===undefined||hollow===true?{}:hollow===false?{enabled:false}:hollow;
  if(!given||typeof given!=='object')throw new TypeError('hollow 옵션');
  const o={...PRINT_HOLLOW_DEFAULTS,...given};
  if(typeof o.enabled!=='boolean'||typeof o.ribs!=='boolean')throw new TypeError('hollow.enabled · hollow.ribs 는 참/거짓이에요');
  const L=PRINT_LIMITS;
  if(!Number.isSafeInteger(o.wallUm)||o.wallUm<L.wallMinUm||o.wallUm>L.wallMaxUm)throw new RangeError(`구조 벽은 ${L.wallMinUm}..${L.wallMaxUm} µm 정수예요`);
  if(!Number.isSafeInteger(o.ceilingUm)||o.ceilingUm<L.ceilingMinUm||o.ceilingUm>L.ceilingMaxUm||o.ceilingUm%L.ceilingStepUm!==0)
    throw new RangeError(`천장 평탄 폭은 ${L.ceilingMinUm}..${L.ceilingMaxUm} µm, ${L.ceilingStepUm} µm 단위예요`);
  if(!Number.isSafeInteger(o.ventUm)||o.ventUm<L.ventMinUm)throw new RangeError(`숨구멍 한 변은 ${L.ventMinUm} µm 이상 정수예요`);
  return {enabled:o.enabled,wallUm:o.wallUm,ceilingUm:o.ceilingUm,ribs:o.ribs,ventUm:o.ventUm};
}
/** 바닥면: 옵션 → 이미 돌린 phys 의 바닥면 → 규칙(BED_FACE_ORDER 첫 빈 면). 두 번 걸어도 같아요. */
function orient(phys,bedFace){
  checkPhys(phys);
  const bed=bedFace??phys.orientation?.bedFace;
  return orientForBed(phys,bed?{bedFace:bed}:{});
}

/* ───────────── 속 비우기 계획 (메쉬 없음, O(1)) ───────────── */

/** 격자 평면(한 축): {k·c} ∪ {d, L−d}. 숨구멍 모서리가 이 평면들과 얼마나 떨어졌는지 재요. */
function gridGap(value,{cellUm,sideUm,depthUm}){
  const r=((value%cellUm)+cellUm)%cellUm;
  return Math.min(r,cellUm-r,Math.abs(value-depthUm),Math.abs(value-(sideUm-depthUm)));
}

/**
 * 공동 · 리브 · 숨구멍 계획이에요. 좌표는 인쇄 방향 틀(µm 정수)이에요.
 * 숨구멍 모서리는 전역 격자 평면이 되므로, 기존 평면(셀 경계 · d · L−d)과 «같거나 gap 이상» 떨어지게 방 안에서 조금 옮겨요.
 * 너무 가까우면 폭이 ε 수준인 얇은 상자가 생겨 핀치 사본이 그 너머로 넘어가요.
 */
function planHollow(oriented,bedFace,depthUm,hollow,epsilonUm){
  const L=oriented.sideUm,C=L/2,t=PRINT_RIB_UM/2,lim=PRINT_LIMITS;
  const base={requested:hollow.enabled,enabled:false,reason:null,wallUm:hollow.wallUm,ceilingUm:hollow.ceilingUm,
    ribUm:PRINT_RIB_UM,ribsRequested:hollow.ribs,ribs:false,ribsReason:null,ventUm:hollow.ventUm,
    halfUm:null,floorZUm:null,roomSideUm:null,ventMaxUm:null,rooms:[],vents:[],cavityVolumeUm3:0,ventVolumeUm3:0};
  if(!hollow.enabled)return base;
  if(!oriented.faces[bedFace].blank)return {...base,reason:'TLP_NO_VENT_FACE'};
  const h=C-depthUm-hollow.wallUm;
  base.halfUm=h;base.floorZUm=C-h;
  if(h<lim.hollowMinHalfUm)return {...base,reason:'TLP_HOLLOW_SMALL'};
  let ribs=hollow.ribs,ribsReason=null;
  if(ribs&&h<lim.ribMinHalfUm){ribs=false;ribsReason='TLP_HOLLOW_SMALL';}
  const roomSide=ribs?h-t:2*h,v=hollow.ventUm,ventMax=roomSide-lim.ventRoomMarginUm;
  const planned={...base,ribs,ribsReason,roomSideUm:roomSide,ventMaxUm:ventMax};
  if(v>ventMax)return {...planned,reason:'TLP_HOLLOW_SMALL'};
  const grid={cellUm:oriented.cellUm,sideUm:L,depthUm};
  const gap=Math.max(100,4*epsilonUm),fits=value=>{const g=gridGap(value,grid);return g===0||g>=gap;};
  const margin=lim.ventPlacementMarginUm;
  // 방 바닥 중심에 가장 가까운 자리부터 0, +1, −1, +2 … µm 순서로 찾아요.
  let edges=null;
  if(ribs){
    const a0=Math.floor((t+h)/2-v/2),aMin=t+margin,aMax=h-margin-v,sMax=Math.max(a0-aMin,aMax-a0);
    for(let s=0;s<=sMax&&!edges;s++)for(const a of s?[a0+s,a0-s]:[a0]){
      if(a<aMin||a>aMax)continue;
      if([C+a,C+a+v,C-a,C-a-v].every(fits)){edges=[[C+a,C+a+v],[C-a-v,C-a]];break;}
    }
  }else{
    const x0=C-Math.floor(v/2),lo=C-h+margin,hi=C+h-margin,sMax=Math.max(x0-lo,hi-v-x0);
    for(let s=0;s<=sMax&&!edges;s++)for(const x of s?[x0+s,x0-s]:[x0]){
      if(x<lo||x+v>hi)continue;
      if(fits(x)&&fits(x+v)){edges=[[x,x+v]];break;}
    }
  }
  if(!edges)return {...planned,reason:'TLP_HOLLOW_SMALL'};
  // 공동 = {|x|,|y|,|z| ≤ h} ∩ {±x + z ≤ h + b/2, ±y + z ≤ h + b/2} (큐브 중심 좌표). 방 = 공동 ∩ 사분면 반공간.
  const A=h+hollow.ceilingUm/2;
  const cavity=[[[1,0,0],h],[[-1,0,0],h],[[0,1,0],h],[[0,-1,0],h],[[0,0,1],h],[[0,0,-1],h],
    [[1,0,1],A],[[-1,0,1],A],[[0,1,1],A],[[0,-1,1],A]];
  const quadrants=ribs?[[1,1],[-1,1],[-1,-1],[1,-1]]:[null];
  const toBed=([a,r])=>({a,r:r+C*(a[0]+a[1]+a[2])});
  const rooms=[],vents=[];
  for(const q of quadrants){
    const planes=cavity.map(toBed);
    if(q)planes.push(toBed([[-q[0],0,0],-t]),toBed([[0,-q[1],0],-t]));
    const [x0,x1]=q?edges[q[0]>0?0:1]:edges[0],[y0,y1]=q?edges[q[1]>0?0:1]:edges[0];
    rooms.push(Object.freeze({quadrant:q?Object.freeze(q.slice()):null,planes:Object.freeze(planes.map(p=>Object.freeze({a:Object.freeze(p.a.slice()),r:p.r})))}));
    vents.push(Object.freeze({x0,x1,y0,y1}));
  }
  const roomVolume6=roomVolumeTimes6({h,t:ribs?t:null,b:hollow.ceilingUm});
  return {...planned,enabled:true,rooms,vents,
    cavityVolumeUm3:rooms.length*roomVolume6/6,
    ventVolumeUm3:vents.length*v*v*(depthUm+hollow.wallUm)};
}
/**
 * 한 방 부피 × 6 (µm³, 정수). A = h + b/2.
 *   리브 켬(t = 리브 반두께): 방 = {t ≤ x,y ≤ h, −h ≤ z ≤ h, x + z ≤ A, y + z ≤ A} → 폭 min(h, A − z) − t
 *   리브 끔(t = null): 방 = 공동 전체 → 폭 2·min(h, A − z)
 * z ≤ b/2 에서는 지붕이 닿지 않아 폭이 일정하고, 그 위(b/2 ≤ z ≤ h)는 45° 로 좁아져요. h ≤ b/2 이면 지붕 없는 상자예요.
 */
function roomVolumeTimes6({h,t,b}){
  const A=h+b/2;
  if(t===null){
    if(h<=b/2)return 6*(2*h)**2*2*h;
    return 24*h*h*(b/2+h)+8*((A-b/2)**3-(A-h)**3);
  }
  const w=h-t;
  if(h<=b/2)return 6*w*w*2*h;
  const K=A-t;
  return 6*w*w*(b/2+h)+2*((K-b/2)**3-(K-h)**3);
}

/**
 * 속 비우기 계획만 계산해요(메쉬 없음). UI 상태 줄·입력 범위용이에요.
 * @returns {{requested,enabled,reason,halfUm,ribs,ribsReason,roomSideUm,ventMaxUm,vents,rooms,cavityVolumeUm3,ventVolumeUm3,...}}
 */
export function hollowPlan(phys,{depthUm=PRINT_DEPTH_UM,hollow,bedFace,epsilonUm=PRINT_EPSILON_UM}={}){
  const {phys:oriented,bedFace:bed}=orient(phys,bedFace);
  return planHollow(oriented,bed,checkDepth(oriented,depthUm),resolveHollow(hollow),checkEpsilon(epsilonUm));
}

/* ───────────── 재질 격자 ───────────── */

/** 2×2×2 상자 묶음의 면-인접 연결 성분 표(256 마스크)와 핀치 사본 이동 방향이에요. */
const COMP=new Int8Array(256*8).fill(-1),NCOMP=new Uint8Array(256),PINCH_DIR=new Float64Array(256*4*3);
{
  const bitOffset=b=>[b&1,(b>>1)&1,(b>>2)&1];
  for(let mask=0;mask<256;mask++){
    const parent=[0,1,2,3,4,5,6,7],find=x=>parent[x]===x?x:(parent[x]=find(parent[x]));
    for(let a=0;a<8;a++)for(let b=a+1;b<8;b++){
      const x=a^b;
      if((mask>>a&1)&&(mask>>b&1)&&(x===1||x===2||x===4))parent[find(a)]=find(b);
    }
    const label=new Map();
    for(let b=0;b<8;b++)if(mask>>b&1){const root=find(b);if(!label.has(root))label.set(root,label.size);COMP[mask*8+b]=label.get(root);}
    NCOMP[mask]=label.size;
    if(label.size<2)continue;
    const all=[0,0,0],sums=[...label.keys()].map(()=>[0,0,0,0]);let count=0;
    for(let b=0;b<8;b++)if(mask>>b&1){
      const o=bitOffset(b),c=COMP[mask*8+b];
      for(let k=0;k<3;k++){all[k]+=o[k];sums[c][k]+=o[k];}
      sums[c][3]++;count++;
    }
    sums.forEach((s,c)=>{
      const dir=[0,1,2].map(k=>s[k]/s[3]-all[k]/count),len=Math.hypot(...dir);
      if(!(len>0))throw new Error('핀치 방향 표가 퇴화했어요');
      for(let k=0;k<3;k++)PINCH_DIR[(mask*4+c)*3+k]=dir[k]/len;
    });
  }
}

/** 한 축 격자 평면(µm 정수, 정렬·중복 제거). */
function axisPlanes(n,cellUm,depthUm,extra){
  const set=new Set();
  for(let k=0;k<=n;k++)set.add(k*cellUm);
  set.add(depthUm);set.add(n*cellUm-depthUm);
  for(const v of extra)set.add(v);
  return Int32Array.from([...set].sort((a,b)=>a-b));
}

/**
 * 재질 규칙(설계 §2.3.3): 상자 중심 p 에서 거리가 d 미만인 면이 후보예요. 후보가 없으면 «내부»(코어).
 * 데이터 면 우선: 후보에 데이터 면이 있으면 그중 가장 가까운 면, 없으면 빈 면 중 가장 가까운 면이 주인이에요.
 * 동률은 H_FACE_IDS 순서. 색은 주인 면 격자에서 p 가 속한 셀의 색(빈 면이면 인쇄용 빈 면 색)이에요.
 * 숨구멍 사각형 안의 바닥면 매립 상자는 비워요.
 * 좌표는 모두 «두 배 µm»(상자 중심이 반정수일 수 있어서)로 정확히 비교해요.
 */
function materialField(oriented,{depthUm,vents=[],bedFace,ownership='data-first'}){
  const n=oriented.n,cellUm=oriented.cellUm,L=oriented.sideUm,L2=2*L,d2=2*depthUm;
  const blankHex=printBlankHex(oriented);
  const materials=[],indexOf=new Map();
  const materialIndex=hex=>{let k=indexOf.get(hex);if(k===undefined){k=materials.length;materials.push(hex);indexOf.set(hex,k);}return k;};
  const faces=H_FACE_IDS.map((name,order)=>{
    const f=oriented.faces[name],ai=f.di.findIndex(v=>v!==0),aj=f.dj.findIndex(v=>v!==0);
    const cells=new Int16Array(n*n);
    for(let k=0;k<n*n;k++)cells[k]=materialIndex(f.blank?blankHex:f.hex[k]);
    return {name,order,axis:f.axis,side:f.side,data:!f.blank,cells,
      ai,si:f.di[ai],oi:2*cellUm*f.origin[ai],aj,sj:f.dj[aj],oj:2*cellUm*f.origin[aj]};
  });
  const bed=faces.find(f=>f.name===bedFace);
  const xs=vents.flatMap(v=>[v.x0,v.x1]),ys=vents.flatMap(v=>[v.y0,v.y1]);
  const P=[axisPlanes(n,cellUm,depthUm,xs),axisPlanes(n,cellUm,depthUm,ys),axisPlanes(n,cellUm,depthUm,[])];
  const NB=P.map(p=>p.length-1);
  const cellOf=(f,c2)=>{
    const i=Math.floor(f.si*(c2[f.ai]-f.oi)/(2*cellUm)),j=Math.floor(f.sj*(c2[f.aj]-f.oj)/(2*cellUm));
    if(i<0||j<0||i>=n||j>=n)throw new Error('주인 면 셀 번호가 격자 밖이에요');
    return f.cells[i*n+j];
  };
  const centres=P.map(p=>Int32Array.from({length:p.length-1},(_,k)=>p[k]+p[k+1])),c2=[0,0,0];
  /** 상자 (i,j,k) 의 재질. c2 = 두 배 중심(재사용 배열). */
  const materialAt=(i,j,k)=>{
    c2[0]=centres[0][i];c2[1]=centres[1][j];c2[2]=centres[2][k];
    let best=null,bestDist=Infinity,bestData=false;
    for(const f of faces){
      const dist=f.side?L2-c2[f.axis]:c2[f.axis];
      if(dist>=d2)continue;
      if(ownership==='data-first'){
        if(f.data&&!bestData){best=f;bestDist=dist;bestData=true;continue;}
        if(f.data!==bestData)continue;
      }
      if(dist<bestDist){best=f;bestDist=dist;}
    }
    if(!best)return INTERIOR;
    if(best===bed&&vents.length){
      for(const v of vents)if(c2[0]>2*v.x0&&c2[0]<2*v.x1&&c2[1]>2*v.y0&&c2[1]<2*v.y1)return EMPTY;
    }
    return cellOf(best,c2);
  };
  return {n,cellUm,L,P,NB,materials,materialAt,blankHex};
}

/* ───────────── 매립 셸 메쉬 ───────────── */

/** 방향 6개(축, 부호)와 그 면의 꼭짓점 순서(면 안 두 축 u·v, 바깥 법선 기준 반시계). */
const DIRS=[[0,-1],[0,1],[1,-1],[1,1],[2,-1],[2,1]];
const LOOP_POS=[[0,0],[1,0],[1,1],[0,1]],LOOP_NEG=[[0,0],[0,1],[1,1],[1,0]];

function shellParts(field,{epsilonUm,pinchSplit}){
  const {P,NB,materials,materialAt}=field,[NX,NY,NZ]=NB,NVX=NX+1,NVY=NY+1;
  const mat=new Int16Array(NX*NY*NZ);
  for(let k=0;k<NZ;k++)for(let j=0;j<NY;j++)for(let i=0;i<NX;i++)mat[i+NX*(j+NY*k)]=materialAt(i,j,k);
  const parts=materials.map(hex=>({hex,positions:[],indices:[],vmap:new Map(),boxes:0}));
  let pinchVertices=0;
  const box=[0,0,0],g=[0,0,0];
  const vertexFor=(part,m)=>{
    let mask=0;
    for(let b=0;b<8;b++){
      const bx=g[0]-1+(b&1),by=g[1]-1+((b>>1)&1),bz=g[2]-1+((b>>2)&1);
      if(bx<0||by<0||bz<0||bx>=NX||by>=NY||bz>=NZ)continue;
      if(mat[bx+NX*(by+NY*bz)]===m)mask|=1<<b;
    }
    const bit=(box[0]-g[0]+1)|((box[1]-g[1]+1)<<1)|((box[2]-g[2]+1)<<2);
    const comp=pinchSplit?COMP[mask*8+bit]:0;
    if(comp<0)throw new Error('핀치 성분 표 불일치');
    const key=(g[0]+NVX*(g[1]+NVY*g[2]))*4+comp;
    let index=part.vmap.get(key);
    if(index===undefined){
      index=part.positions.length/3;part.vmap.set(key,index);
      const p=[P[0][g[0]],P[1][g[1]],P[2][g[2]]];
      if(pinchSplit&&NCOMP[mask]>=2){
        pinchVertices++;
        if(epsilonUm>0)for(let a=0;a<3;a++)p[a]+=epsilonUm*PINCH_DIR[(mask*4+comp)*3+a];
      }
      part.positions.push(p[0],p[1],p[2]);
    }
    return index;
  };
  const q=[0,0,0,0],stride=[1,NX,NX*NY];
  for(let k=0;k<NZ;k++)for(let j=0;j<NY;j++)for(let i=0;i<NX;i++){
    const id=i+NX*(j+NY*k),m=mat[id];
    if(m<0)continue;
    const part=parts[m];part.boxes++;
    box[0]=i;box[1]=j;box[2]=k;
    for(const [a,s] of DIRS){
      const nIndex=box[a]+s;
      const neighbour=nIndex>=0&&nIndex<NB[a]?mat[id+s*stride[a]]:OUTSIDE;
      if(neighbour===m)continue;
      const u=(a+1)%3,v=(a+2)%3,loop=s>0?LOOP_POS:LOOP_NEG;
      for(let c=0;c<4;c++){
        g[a]=box[a]+(s>0?1:0);g[u]=box[u]+loop[c][0];g[v]=box[v]+loop[c][1];
        q[c]=vertexFor(part,m);
      }
      part.indices.push(q[0],q[1],q[2],q[0],q[2],q[3]);
    }
  }
  return {parts:parts.filter(p=>p.indices.length),pinchVertices};
}

/* ───────────── 코어 메쉬 (명시적 구성, CSG 없음) ───────────── */

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];

/** 정점을 좌표 키로 합치는 메쉬 조립기. tri 는 기대 법선과 반대로 감기면 뒤집어요. */
function meshBuilder(){
  const positions=[],indices=[],map=new Map();
  const vertex=p=>{
    const key=`${p[0]},${p[1]},${p[2]}`;let index=map.get(key);
    if(index===undefined){index=positions.length/3;map.set(key,index);positions.push(p[0],p[1],p[2]);}
    return index;
  };
  const at=i=>[positions[3*i],positions[3*i+1],positions[3*i+2]];
  const tri=(a,b,c,expect)=>{
    const ia=vertex(a),ib=vertex(b),ic=vertex(c);
    const nrm=cross(sub(at(ib),at(ia)),sub(at(ic),at(ia)));
    if(nrm[0]===0&&nrm[1]===0&&nrm[2]===0)throw new Error('코어 삼각형이 퇴화했어요');
    if(dot(nrm,expect)<0)indices.push(ia,ic,ib);else indices.push(ia,ib,ic);
  };
  /** 볼록 다각형을 부채꼴로 나눠요. 공선 세 점이 생기지 않는 시작점을 골라요. */
  const polygon=(points,expect)=>{
    const m=points.length;
    for(let s=0;s<m;s++){
      const p=k=>points[(s+k)%m];let okay=true;
      for(let k=1;k+1<m;k++){const nrm=cross(sub(p(k),p(0)),sub(p(k+1),p(0)));if(!nrm[0]&&!nrm[1]&&!nrm[2]){okay=false;break;}}
      if(!okay)continue;
      for(let k=1;k+1<m;k++)tri(p(0),p(k),p(k+1),expect);
      return;
    }
    throw new Error('다각형을 삼각화할 시작점이 없어요');
  };
  /**
   * 수평 사각 고리(바깥 사각형 − 안쪽 사각 구멍)를 추가 정점 없이 삼각형 8개로 나눠요.
   * 네 변마다 바깥 변 · 안쪽 변(평행)이 만드는 볼록 사다리꼴을 대각선 하나로 나눠요.
   */
  const ring=(outer,hole,z,expect)=>{
    const O=[[outer.x0,outer.y0],[outer.x1,outer.y0],[outer.x1,outer.y1],[outer.x0,outer.y1]].map(([x,y])=>[x,y,z]);
    const I=[[hole.x0,hole.y0],[hole.x1,hole.y0],[hole.x1,hole.y1],[hole.x0,hole.y1]].map(([x,y])=>[x,y,z]);
    if(!(hole.x0>outer.x0&&hole.x1<outer.x1&&hole.y0>outer.y0&&hole.y1<outer.y1))throw new Error('숨구멍이 바닥 사각형 안에 있지 않아요');
    for(let k=0;k<4;k++){const k1=(k+1)%4;tri(O[k],O[k1],I[k1],expect);tri(O[k],I[k1],I[k],expect);}
  };
  return {vertex,tri,polygon,ring,positions,indices};
}

/**
 * 정수 반공간 a·p ≤ r 들의 교집합(볼록 다면체)의 면 다각형이에요. 꼭짓점은 세 평면의 교점 중 모든 제약을 만족하는 것이고,
 * 정수로 나누어떨어지지 않으면 설계 가정(µm 정수 교점)이 깨진 것이라 던져요.
 * @returns {{plane, points}[]} 점은 평면 바깥 법선(a) 기준 반시계 순서예요.
 */
function convexFaces(planes){
  const verts=[],seen=new Set();
  for(let i=0;i<planes.length;i++)for(let j=i+1;j<planes.length;j++)for(let k=j+1;k<planes.length;k++){
    const A=planes[i],B=planes[j],Cc=planes[k],bc=cross(B.a,Cc.a),det=dot(A.a,bc);
    if(det===0)continue;
    const ca=cross(Cc.a,A.a),ab=cross(A.a,B.a);
    const num=[0,1,2].map(t=>A.r*bc[t]+B.r*ca[t]+Cc.r*ab[t]);
    if(num.some(v=>v%det!==0))throw new Error('공동 꼭짓점이 µm 정수가 아니에요');
    const p=num.map(v=>v/det+0);
    if(!planes.every(pl=>dot(pl.a,p)<=pl.r))continue;
    const key=p.join(',');if(seen.has(key))continue;seen.add(key);verts.push(p);
  }
  const faces=[];
  for(const plane of planes){
    const on=verts.filter(p=>dot(plane.a,p)===plane.r);
    if(on.length<3)continue;
    const c=[0,1,2].map(t=>on.reduce((s,p)=>s+p[t],0)/on.length);
    const e1=sub(on[0],c),e2=cross(plane.a,e1);
    const angle=p=>{const w=sub(p,c);return Math.atan2(dot(w,e2),dot(w,e1));};
    faces.push({plane,points:on.slice().sort((p,q)=>angle(p)-angle(q))});
  }
  return faces;
}

/**
 * 코어 파트예요. 속 비우기 끔이면 상자 [d, L−d]³(삼각형 12개). 켬이면
 *   바깥 상자(바닥은 숨구멍 구멍이 난 면) + 숨구멍 채널 벽(수직) + 뒤집은 방 면들(방 바닥은 구멍 난 고리).
 * 숨구멍이 방마다 있어 코어 표면은 연결 성분 1개예요(밀폐 공동 0).
 */
function coreMesh({L,depthUm,plan}){
  const B=meshBuilder(),lo=depthUm,hi=L-depthUm,C=L/2;
  if(!plan.enabled){
    B.polygon([[lo,lo,lo],[lo,hi,lo],[hi,hi,lo],[hi,lo,lo]],[0,0,-1]);
    B.polygon([[lo,lo,hi],[hi,lo,hi],[hi,hi,hi],[lo,hi,hi]],[0,0,1]);
    B.polygon([[lo,lo,lo],[lo,lo,hi],[lo,hi,hi],[lo,hi,lo]],[-1,0,0]);
    B.polygon([[hi,lo,lo],[hi,hi,lo],[hi,hi,hi],[hi,lo,hi]],[1,0,0]);
    B.polygon([[lo,lo,lo],[hi,lo,lo],[hi,lo,hi],[lo,lo,hi]],[0,-1,0]);
    B.polygon([[lo,hi,lo],[lo,hi,hi],[hi,hi,hi],[hi,hi,lo]],[0,1,0]);
    return B;
  }
  const split=plan.vents.length===4,fz=plan.floorZUm;
  // 바깥 상자: 윗면 · 옆면(숨구멍 4개면 바닥 변 중점을 정점으로 넣어 바닥 사분면 고리와 맞물려요).
  B.polygon([[lo,lo,hi],[hi,lo,hi],[hi,hi,hi],[lo,hi,hi]],[0,0,1]);
  const mid=split?[C]:[];
  B.polygon([[lo,hi,hi],[lo,lo,hi],[lo,lo,lo],...mid.map(m=>[lo,m,lo]),[lo,hi,lo]],[-1,0,0]);
  B.polygon([[hi,lo,hi],[hi,hi,hi],[hi,hi,lo],...mid.map(m=>[hi,m,lo]),[hi,lo,lo]],[1,0,0]);
  B.polygon([[hi,lo,hi],[lo,lo,hi],[lo,lo,lo],...mid.map(m=>[m,lo,lo]),[hi,lo,lo]],[0,-1,0]);
  B.polygon([[lo,hi,hi],[hi,hi,hi],[hi,hi,lo],...mid.map(m=>[m,hi,lo]),[lo,hi,lo]],[0,1,0]);
  // 바닥(z = d): 숨구멍 1개면 고리 하나, 4개면 사분면 고리 넷.
  const quads=split?[[lo,C,lo,C],[C,hi,lo,C],[C,hi,C,hi],[lo,C,C,hi]].map(([x0,x1,y0,y1])=>({x0,x1,y0,y1})):[{x0:lo,x1:hi,y0:lo,y1:hi}];
  for(const q of quads){
    const vent=plan.vents.find(v=>v.x0>q.x0&&v.x1<q.x1&&v.y0>q.y0&&v.y1<q.y1);
    if(!vent)throw new Error('바닥 사분면에 숨구멍이 없어요');
    B.ring(q,vent,lo,[0,0,-1]);
  }
  // 숨구멍 채널 벽: z ∈ [d, 방 바닥], 법선은 채널 안쪽(빈 곳)을 향해요.
  for(const v of plan.vents){
    B.polygon([[v.x0,v.y0,lo],[v.x0,v.y1,lo],[v.x0,v.y1,fz],[v.x0,v.y0,fz]],[1,0,0]);
    B.polygon([[v.x1,v.y0,lo],[v.x1,v.y0,fz],[v.x1,v.y1,fz],[v.x1,v.y1,lo]],[-1,0,0]);
    B.polygon([[v.x0,v.y0,lo],[v.x0,v.y0,fz],[v.x1,v.y0,fz],[v.x1,v.y0,lo]],[0,1,0]);
    B.polygon([[v.x0,v.y1,lo],[v.x1,v.y1,lo],[v.x1,v.y1,fz],[v.x0,v.y1,fz]],[0,-1,0]);
  }
  // 방: 볼록 다면체 면을 뒤집어(코어 바깥 = 방 안쪽) 넣고, 바닥은 숨구멍 구멍이 난 고리로 바꿔요.
  plan.rooms.forEach((room,index)=>{
    const vent=plan.vents[index];
    for(const {plane,points} of convexFaces(room.planes)){
      const inward=plane.a.map(v=>-v);
      if(plane.a[0]===0&&plane.a[1]===0&&plane.a[2]===-1){
        const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
        const floor={x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};
        if(points.length!==4||points.some(p=>p[2]!==fz))throw new Error('방 바닥이 사각형이 아니에요');
        B.ring(floor,vent,fz,[0,0,1]);
        continue;
      }
      B.polygon(points,inward);
    }
  });
  return B;
}

/* ───────────── 위상 검사 ───────────── */

const AREA_EPS_MM2=1e-9;
/**
 * 닫힌 방향 2-다양체 검사예요(설계 §2.3.6 «다운로드 직전 자체검사»). 엣지 키는 문자열이 아니라 수치(lo·V + hi)예요.
 *   openEdges: 삼각형 1개만 쓰는 엣지(구멍 · T-정션)
 *   overEdges: 삼각형 3개 이상이 쓰는 엣지(핀치 · 비다양체)
 *   misorientedEdges: 2개가 쓰지만 같은 방향으로 감긴 엣지(뒤집힌 삼각형)
 *   degenerate: 인덱스 중복 또는 면적 ≈ 0 삼각형
 *   signedVolume: mm³, 바깥 법선이면 양수
 * @param {{positions:Float64Array|number[], indices:Uint32Array|number[]}} mesh positions 는 mm
 */
export function meshTopology(mesh){
  const positions=mesh?.positions,indices=mesh?.indices;
  if(!positions||!indices||positions.length%3||indices.length%3)throw new TypeError('메쉬는 positions(3의 배수) · indices(3의 배수)예요');
  const V=positions.length/3,T=indices.length/3;
  if(V>=2**26)throw new RangeError('정점이 너무 많아요');
  const keys=new Float64Array(T*3),areaLimit=(2*AREA_EPS_MM2)**2;let used=0,degenerate=0,volume=0;
  const edgeKey=(u,v)=>(u<v?u*V+v:v*V+u)*2+(u<v?0:1);
  for(let t=0;t<T;t++){
    const a=indices[3*t],b=indices[3*t+1],c=indices[3*t+2];
    if(!(Number.isInteger(a)&&Number.isInteger(b)&&Number.isInteger(c)&&a>=0&&b>=0&&c>=0&&a<V&&b<V&&c<V))throw new RangeError('삼각형 인덱스가 정점 범위 밖이에요');
    if(a===b||b===c||a===c){degenerate++;continue;}
    const ax=positions[3*a],ay=positions[3*a+1],az=positions[3*a+2];
    const bx=positions[3*b],by=positions[3*b+1],bz=positions[3*b+2];
    const cx=positions[3*c],cy=positions[3*c+1],cz=positions[3*c+2];
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    if(nx*nx+ny*ny+nz*nz<=areaLimit)degenerate++;
    volume+=(ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx))/6;
    keys[used++]=edgeKey(a,b);keys[used++]=edgeKey(b,c);keys[used++]=edgeKey(c,a);
  }
  const sorted=keys.subarray(0,used).sort();
  let openEdges=0,overEdges=0,misorientedEdges=0;
  for(let s=0;s<used;){
    // 키 = 엣지·2 + 방향 비트라, 같은 엣지는 짝수 키 e·2 와 홀수 키 e·2+1 로만 나타나요.
    const base=sorted[s]-(sorted[s]%2);let forward=0,backward=0,e=s;
    while(e<used&&sorted[e]-base<2){if(sorted[e]!==base)backward++;else forward++;e++;}
    const total=forward+backward;
    if(total===1)openEdges++;else if(total>2)overEdges++;else if(forward!==1)misorientedEdges++;
    s=e;
  }
  const ok=openEdges===0&&overEdges===0&&misorientedEdges===0&&degenerate===0&&volume>0;
  return {ok,openEdges,overEdges,misorientedEdges,degenerate,signedVolume:volume,triangles:T,vertices:V};
}

/* ───────────── 파트 조립 ───────────── */

function toMesh(positionsUm,indices){
  const positions=new Float64Array(positionsUm.length);
  for(let k=0;k<positions.length;k++)positions[k]=positionsUm[k]/1000;
  return Object.freeze({positions,indices:Uint32Array.from(indices)});
}

/**
 * 색별 매립 파트 + 코어를 만들어요.
 * @param {object} phys PhysCube(physicalHCube 결과). 인쇄 방향은 안에서 orientForBed 로 정해요.
 * @param {object} [options]
 *   depthUm: 매립 깊이 d(µm, 기본 1000, d ≤ 0.9c 아니면 TLP_DEPTH_GT_CELL)
 *   hollow: {enabled=true, wallUm=1200, ceilingUm=5000, ribs=true, ventUm=2000} | true | false
 *   epsilonUm: 핀치 분리(기본 25, 0 이면 사본이 같은 자리 — 부피 검증용)
 *   bedFace: 바닥면(모델 면 이름). 생략하면 규칙대로예요.
 *   triangleCap: 삼각형 상한(기본 300000, 넘으면 TLP_TRI_CAP)
 *   pinchSplit · ownership: 검증 전용 대조군 스위치(제품 경로는 생략해요)
 * @returns {{parts: Part[], report: object}} Part = {id, name, role, hex, mesh:{positions(mm), indices}, volumeMm3}
 */
export function buildPrintParts(phys,{depthUm=PRINT_DEPTH_UM,hollow,epsilonUm=PRINT_EPSILON_UM,bedFace,
  triangleCap=PRINT_TRIANGLE_CAP,pinchSplit=true,ownership='data-first'}={}){
  const {phys:oriented,bedFace:bed}=orient(phys,bedFace);
  checkDepth(oriented,depthUm);checkEpsilon(epsilonUm);
  if(ownership!=='data-first'&&ownership!=='nearest')throw new RangeError('ownership');
  if(!Number.isSafeInteger(triangleCap)||triangleCap<12)throw new RangeError('triangleCap');
  const plan=planHollow(oriented,bed,depthUm,resolveHollow(hollow),epsilonUm);
  const L=oriented.sideUm;
  // 핀치 사본의 이동이 이웃 격자 평면을 넘지 않게, 평면 간격이 2ε 보다 넓은지 확인해요.
  const field=materialField(oriented,{depthUm,vents:plan.vents,bedFace:bed,ownership});
  for(const planes of field.P)for(let k=1;k<planes.length;k++)if(planes[k]-planes[k-1]<=2*epsilonUm)throw new Error('격자 평면 간격이 핀치 분리보다 좁아요');
  const shell=shellParts(field,{epsilonUm,pinchSplit});
  const core=coreMesh({L,depthUm,plan});
  const triangles=shell.parts.reduce((s,p)=>s+p.indices.length/3,0)+core.indices.length/3;
  if(triangles>triangleCap)throw tlpError('TLP_TRI_CAP',`삼각형 ${triangles} 개가 상한 ${triangleCap} 을 넘어요`,{triangles,triangleCap});
  const ordered=shell.parts.slice().sort((a,b)=>byLuminance(a.hex,b.hex));
  let tone=0;
  const parts=[];
  const push=(hex,role,mesh)=>{
    const topology=meshTopology(mesh);
    if(!topology.ok)throw tlpError('TLP_TOPOLOGY',`파트 ${role} ${hex} 위상 검사 실패`,{topology});
    const id=parts.length+1;
    parts.push(Object.freeze({id,name:`${id}-${role}-${hex.slice(1)}`,role,hex,mesh,volumeMm3:topology.signedVolume}));
  };
  for(const part of ordered){
    const role=part.hex==='#000000'?'k':part.hex===PRINT_WHITE?'w':`t${tone++}`;
    push(part.hex,role,toMesh(part.positions,part.indices));
  }
  push(PRINT_WHITE,'core',toMesh(core.positions,core.indices));
  const lim=PRINT_LIMITS,filaments=[...new Set(parts.map(p=>p.hex))].sort(byLuminance);
  const cubeVolume=(L/1000)**3;
  const report=Object.freeze({
    bedFace:bed,orientation:oriented.orientation,
    n:oriented.n,cellUm:oriented.cellUm,sideUm:L,depthUm,epsilonUm,
    dataFaces:oriented.dataFaces,blankFaces:oriented.blankFaces,
    blankHex:printBlankHex(oriented),filaments:Object.freeze(filaments),
    hollow:Object.freeze({...plan,rooms:plan.rooms.length,roomPlanes:plan.rooms,
      cavityVolumeMm3:plan.cavityVolumeUm3/1e9,ventVolumeMm3:plan.ventVolumeUm3/1e9}),
    triangles,vertices:parts.reduce((s,p)=>s+p.mesh.positions.length/3,0),pinchVertices:shell.pinchVertices,
    gridPlanes:Object.freeze(field.P.map(p=>p.length)),
    volumeMm3:parts.reduce((s,p)=>s+p.volumeMm3,0),
    expectedVolumeMm3:cubeVolume-plan.cavityVolumeUm3/1e9-plan.ventVolumeUm3/1e9,
    imagesOmitted:oriented.blankFaces.filter(face=>oriented.faces[face].image).length,
    exceedsBuildVolume:L>lim.buildVolumeUm,smallCell:oriented.cellUm<lim.smallCellUm,amsOverflow:filaments.length>lim.amsSlots,
  });
  return {parts,report};
}

/* ───────────── 색 교체 추정 (메쉬 없음, O(n²)) ───────────── */

/**
 * 예상 색 교체 수 = Σ층 (그 층의 색 수 − 1)(설계 §2.8). 기본 인쇄 방향에서 층(기본 0.2 mm)마다
 * 매립 재질 격자와 코어(흰색)가 차지하는 색을 세요. 가운데 층은 옆면 둘레 상자만, 바닥·윗면 d 층만 전면을 봐요.
 * 공동·숨구멍은 흰색 · 빈 면 색만 덜어 내므로 층의 색 집합을 바꾸지 않아요.
 * @returns {{layers, changes, colors: string[], perLayer: Uint8Array, maxPerLayer}}
 */
export function colorChangeEstimate(phys,{layerUm=200,depthUm=PRINT_DEPTH_UM,bedFace}={}){
  if(!Number.isSafeInteger(layerUm)||layerUm<=0)throw new RangeError('층 높이(µm)는 양의 정수예요');
  const {phys:oriented,bedFace:bed}=orient(phys,bedFace);
  checkDepth(oriented,depthUm);
  const field=materialField(oriented,{depthUm,bedFace:bed}),{P,NB,materials,materialAt,L}=field;
  let white=materials.indexOf(PRINT_WHITE);if(white<0){white=materials.length;materials.push(PRINT_WHITE);}
  if(materials.length>30)throw new RangeError('색이 너무 많아요');
  const slab=new Int32Array(NB[2]);
  for(let k=0;k<NB[2];k++){
    let bits=0;
    const z0=P[2][k],z1=P[2][k+1],middle=z0>=depthUm&&z1<=L-depthUm;
    const visit=(i,j)=>{const m=materialAt(i,j,k);if(m>=0)bits|=1<<m;else if(m===INTERIOR)bits|=1<<white;};
    if(middle){
      for(let i=0;i<NB[0];i++){visit(i,0);visit(i,NB[1]-1);}
      for(let j=1;j<NB[1]-1;j++){visit(0,j);visit(NB[0]-1,j);}
      bits|=1<<white; // 가운데 층은 코어가 있어요.
    }else for(let j=0;j<NB[1];j++)for(let i=0;i<NB[0];i++)visit(i,j,k);
    slab[k]=bits;
  }
  const layers=Math.ceil(L/layerUm),perLayer=new Uint8Array(layers);let changes=0,maxPerLayer=0;
  for(let t=0,k=0;t<layers;t++){
    const z0=t*layerUm,z1=Math.min(L,(t+1)*layerUm);let bits=0;
    while(k<NB[2]&&P[2][k+1]<=z0)k++;
    for(let s=k;s<NB[2]&&P[2][s]<z1;s++)bits|=slab[s];
    let count=0;for(let b=bits;b;b&=b-1)count++;
    perLayer[t]=count;maxPerLayer=Math.max(maxPerLayer,count);changes+=Math.max(0,count-1);
  }
  return {layers,changes,colors:filamentSet(oriented),perLayer,maxPerLayer};
}

/* ───────────── 받침대 ───────────── */

/**
 * 받침대가 잡는 꼭짓점의 세 면이에요 — 2.5D 정본 시점에서 보이지 않는 꼭짓점 (L,L,L)(물리 좌표, 인쇄 방향 회전 전)이에요.
 * coveredDataFaces 는 그중 데이터 면이에요. 포켓이 그 면의 꼭짓점 쪽 삼각형(다리 ℓ + 3g)을 가려요.
 * isometric 1F–3F 는 0 개지만, 3F horizontal·vertical 과 4F·5F·6F 는 1 개 이상이에요 — 화면이 이것을 알려요.
 * @returns {{cornerFaces:string[], coveredDataFaces:string[]}} H_FACE_IDS 순서
 */
export function standCornerFaces(phys){
  checkPhys(phys);
  const Q=phys.orientation?.rotation;
  // 인쇄 방향으로 돌린 phys 여도 회전 전 틀의 바깥 법선(Qᵀ·n)으로 판정해요.
  const original=v=>Q?[0,1,2].map(c=>Q[0][c]*v[0]+Q[1][c]*v[1]+Q[2][c]*v[2]):v;
  const cornerFaces=H_FACE_IDS.filter(face=>original(phys.faces[face].normal).some(x=>x>0));
  if(cornerFaces.length!==3)throw new RangeError('받침대 꼭짓점의 면이 셋이 아니에요');
  return {cornerFaces:Object.freeze(cornerFaces),coveredDataFaces:Object.freeze(cornerFaces.filter(face=>!phys.faces[face].blank))};
}

/**
 * 꼭짓점 세움 받침대(설계 §2.7). 2.5D 에서 보이지 않는 꼭짓점 (L,L,L)(standCornerFaces)을 아래로, 몸 대각선을 수직으로 잡아요.
 *   포켓: 큐브 모서리 세 면(서로 수직)을 바깥 법선으로 틈 g 만큼 옮긴 삼면 오목이에요. 옮긴 세 평면의 교점(포켓 꼭짓점)을
 *        바닥판 윗면(z = floor)에 두고, 다리 ℓ = L/4 인 큐브 모서리를 덮도록 수직 깊이 e + g√3(e = ℓ/√3),
 *        윗면(림) 삼각형 외접반지름 (e + g√3)√2 로 잡아요 — 포켓 면 위 다리는 ℓ + 3g 예요.
 *        삼면 원뿔이라 안착한 큐브는 g 틈을 두고 뜨지 않고 g√3 더 내려앉아 세 면에 모두 닿아요(안착 꼭짓점 = 포켓 꼭짓점).
 *        그래서 g 는 여유 깊이예요: 과압출 등으로 포켓 면이 δ ≤ g 만큼 안으로 들어와도 큐브는 δ√3 만큼만 떠서
 *        다리 ℓ 이상이 포켓 면에 닿아요(림 모서리가 아니라 면에 앉아요).
 *   육각기둥: 포켓 삼각형 꼭짓점이 육각형 꼭짓점을 향해요. 삼각형 꼭짓점에서 육각형 변까지 «최단 거리»가 wallUm 이 되게
 *        외접반지름 R = (e + g√3)√2 + wall / cos30° 로 잡아요.
 *   넓힌 발: 육각 판, 아포템 ≥ footRatio × (안착한 큐브 무게중심 높이 = floor + L·√3/2).
 * 좌표는 mm, 바닥 z = 0, 축은 z(위)예요. 메쉬는 phys 의 한 변 L 로만 정해지고, 어느 면이 데이터인지는 info 에만 적어요.
 * @returns Mesh {positions, indices} + info(치수 기록)
 */
export function buildVertexStand(phys,{clearanceUm=PRINT_STAND_DEFAULTS.clearanceUm,wallUm=PRINT_STAND_DEFAULTS.wallUm,
  floorUm=PRINT_STAND_DEFAULTS.floorUm,footRatio=PRINT_STAND_DEFAULTS.footRatio}={}){
  const {cornerFaces,coveredDataFaces}=standCornerFaces(phys);
  for(const [name,value] of [['clearanceUm',clearanceUm],['wallUm',wallUm],['floorUm',floorUm],['footRatio',footRatio]])
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||(name!=='clearanceUm'&&value===0))throw new RangeError(`받침대 ${name}`);
  const L=phys.sideUm,leg=L/4,e=leg/Math.sqrt(3),seatDrop=clearanceUm*Math.sqrt(3),depth=e+seatDrop,rim=depth*Math.SQRT2,F=floorUm;
  const pillarR=rim+wallUm/COS30,pillarApothem=pillarR*COS30;
  const cgHeight=F+L*Math.sqrt(3)/2;
  const footApothem=Math.max(footRatio*cgHeight,pillarApothem+PRINT_STAND_DEFAULTS.footStepUm),footR=footApothem/COS30;
  const top=F+depth;
  const polar=(r,deg,z)=>[r*Math.cos(deg*Math.PI/180),r*Math.sin(deg*Math.PI/180),z];
  const B=meshBuilder();
  const hex=(r,z)=>[0,1,2,3,4,5].map(m=>polar(r,60*m,z));
  const footBottom=hex(footR,0),footTop=hex(footR,F),pillarBottom=hex(pillarR,F),pillarTop=hex(pillarR,top);
  const T=[0,1,2].map(k=>polar(rim,120*k,top)),apex=[0,0,F];
  B.polygon(footBottom.slice().reverse(),[0,0,-1]);
  for(let m=0;m<6;m++){
    const m1=(m+1)%6,outward=polar(1,60*m+30,0);
    B.polygon([footBottom[m],footBottom[m1],footTop[m1],footTop[m]],outward);
    B.polygon([pillarBottom[m],pillarBottom[m1],pillarTop[m1],pillarTop[m]],outward);
    // 발 윗면: 동심 육각 고리(사다리꼴 6개 = 삼각형 12개).
    B.tri(footTop[m],footTop[m1],pillarBottom[m1],[0,0,1]);B.tri(footTop[m],pillarBottom[m1],pillarBottom[m],[0,0,1]);
  }
  // 기둥 윗면: 삼각 구멍 둘레의 볼록 오각형 3개(T_k, H_2k, H_2k+1, H_2k+2, T_k+1)를 가운데 육각 꼭짓점에서 부채꼴로.
  for(let k=0;k<3;k++){
    const k1=(k+1)%3,h0=pillarTop[2*k],h1=pillarTop[2*k+1],h2=pillarTop[(2*k+2)%6];
    B.tri(h1,h2,T[k1],[0,0,1]);B.tri(h1,T[k1],T[k],[0,0,1]);B.tri(h1,T[k],h0,[0,0,1]);
  }
  // 포켓: 꼭짓점과 윗면 삼각형 변으로 된 세 면. 법선은 포켓 빈 곳(위 · 안쪽)을 향해요.
  const rimCenter=[0,0,top];
  for(let k=0;k<3;k++){
    const k1=(k+1)%3,centroid=[0,1,2].map(a=>(apex[a]+T[k][a]+T[k1][a])/3);
    B.tri(apex,T[k],T[k1],sub(rimCenter,centroid));
  }
  const mesh=toMesh(B.positions,B.indices);
  // legUm = 큐브 다리 ℓ(덮기 목표), pocketLegUm = 포켓 면 위 다리 ℓ + 3g, seatDropUm = 틈 g 가 만드는 추가 내려앉음 g√3.
  const info=Object.freeze({sideUm:L,legUm:leg,pocketLegUm:depth*Math.sqrt(3),pocketDepthUm:depth,rimRadiusUm:rim,
    pillarRadiusUm:pillarR,pillarApothemUm:pillarApothem,
    footRadiusUm:footR,footApothemUm:footApothem,floorUm:F,heightUm:top,cgHeightUm:cgHeight,
    tipAngleDeg:Math.atan(footApothem/cgHeight)*180/Math.PI,wallUm,clearanceUm,seatDropUm:seatDrop,
    cornerFaces,coveredDataFaces});
  return Object.freeze({positions:mesh.positions,indices:mesh.indices,info});
}
