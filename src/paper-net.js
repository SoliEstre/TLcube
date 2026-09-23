/**
 * 타입 H 종이공작 도안을 실척 mm 장면(scene)으로 만들어요(설계 §3).
 *   'sheet' (P1) 한 장 전개도 — 라틴 십자 + 풀칠 날개 7개. 얇은 종이(t ≤ 0.45 mm) 전용이에요.
 *   'skin'  (P2) 감싸기 스킨 — 날개 없는 라틴 십자 한 장 + 판재 코어 재단표. 면끼리 붙어 있어 정체·회전이 보존돼요.
 *   'board' (P3) 판에 직접 인쇄 — 맞대기 조각 6장. 이웃 판이 덮는 가장자리 t 를 잘라 낸 영역만 인쇄해요.
 *                재단선은 인쇄 영역에 붙은 실선이 아니라 모서리 바깥 재단 표시예요(흰 링 가장자리에 회색 잔선이 남지 않게).
 *
 * 입력은 물리 큐브(cube-physical.js 의 PhysCube)예요. 전개도는 손 표가 아니라 유도해요(설계 §3.1):
 * 뿌리 면(ZM)에서 트리를 따라 이웃 면을 공유 모서리 둘레로 90° 펼치는 강체 회전(정수 행렬)을 누적하고,
 * 뿌리를 바깥에서 보는 종이 좌표(오른쪽 u0, 아래 v0, u0×v0 = −n0)로 옮겨요. 회전만 쓰므로 물리 면이
 * 거울이 아니면 종이에서도 거울이 아니에요. 마지막으로 긴 축이 세로가 되게 90° 단위로만 돌려요(반사 없음).
 *
 * 장면은 기존 sceneToSvg·rasterize 가 그대로 받는 형식이에요(도형 = polygon | image, 단위 mm, y 아래).
 * 선(재단·접기·틱)과 글자도 모두 얇은 다각형이라 SVG·PNG·PDF 가 같은 도형을 공유해요. 글자는 언어 중립
 * 문자만 쓰는 자체 스트로크 글리프예요(폰트·텍스트 경로 없음, 설계 §3.7).
 *
 * 수치 규칙: 용지·여백·피치·두께는 µm 정수로 계산하고(자동 최대는 0.1 mm 아래로 버림), 도형 좌표만 mm 실수예요.
 * 오류는 err.code 가 'TLP_' 로 시작하는 RangeError 로 던져요(UI 가 문구 키로 옮겨요).
 */
import {H_FACE_IDS} from './h-profile.js';
import {rasterToPng} from './png.js';
import {assertSceneImage} from './scene-image.js';

// ─────────────────────────────────────────────────────────────────────────────
// 상수 (설계 §3.2–§3.6. «제안» 값은 설계 표기를 따라 여기 한곳에 모아요)
// ─────────────────────────────────────────────────────────────────────────────

export const PAPER_METHODS=Object.freeze(['sheet','skin','board']);
export const PAPER_MARGIN_MM=7;
/** 하단 띠(보정 막대·캡션, board 는 조각 번호·조립 지도까지) 높이. */
export const PAPER_BAND_MM=Object.freeze({sheet:8,skin:8,board:20});
export const BOARD_GAP_MM=6;
/** 감싸기 스킨 종이 두께(고정). 코어 바깥 한 변 s 에 대해 스킨 피치 p = s + 이 값이에요. */
export const SKIN_THICKNESS_MM=0.1;
export const SHEET_MAX_THICKNESS_MM=0.45;
export const BOARD_MAX_THICKNESS_MM=1.3;
/**
 * P3 절단면 띠 경고: t > 이 비율 × 종이 모듈. 설계 제안은 0.5 였지만, 판 색 띠를 합성한 조립 모습의 판독 실측에서
 * 0.44 까지 40/40, 0.46 에서 38/40, 0.5 에서 15/40 이라 0.4 로 낮췄어요(흰색으로 칠한 절단면은 0.7 까지 40/40).
 * 이 비율들은 조각 가장자리에 다른 잉크가 없을 때 이야기예요. 인쇄 영역에 붙은 0.2 mm 재단 실선을 가운데로 자르면 0.1 mm 회색
 * 잔선이 남아, 흰색으로 칠한 절단면이어도 비율 약 0.43–0.54 부터 검출이 0 이 됐어요(합성 실측). 그래서 P3 는 재단 표시(CROP_MARK_*)를
 * 써요 — test/paper-scan-roundtrip 이 경고 비율에서 «0.1 mm 바깥 자르기 + 흰 절단면» 을 재고, 붙은 실선을 심으면 빨개져요.
 */
export const BOARD_EDGE_WARN_RATIO=0.4;
export const PAPER_MODULE_MIN_MM=1.0;
export const PAPER_MODULE_WARN_MM=1.2;
/** 한 변 하한: 날개 최소 6 mm 와 날개 ≤ 0.45 × 변에서 나온 값(6 / 0.45 = 13.33…을 0.1 mm 올림). */
export const PAPER_SIDE_MIN_MM=13.4;
export const TAB_MIN_MM=6;
export const TAB_MAX_MM=15;
export const TAB_RATIO=0.18;
export const TAB_MAX_RATIO=0.45;
export const TAB_INSET_MM=0.5;
export const CUT_LINE_MM=0.2;
export const FOLD_DASH_MM=Object.freeze([2,1.5]);
export const FOLD_TICK_MM=3;
/** 틱을 재단선에서 띄우는 간격이에요(재단선 폭 바깥에서 시작). */
const TICK_CLEAR_MM=0.5;
export const CALIBRATION_BAR_MM=50;
/**
 * P3 재단 표시(crop mark). 조각은 인쇄 영역에 붙은 실선 대신 모서리 바깥의 짧은 표시로 재단 위치를 알려요.
 * 조각 가장자리는 흰 링이라, 붙은 회색 선의 가운데를 자르면 약 0.1 mm 회색 잔선이 흰 링과 이웃 판 절단면 사이에 남아
 * 링이 얇을 때(t 가 모듈에 가까울 때) 면 검출을 무너뜨려요. 표시는 모서리에서 OFFSET 만큼 떨어져 시작해 LENGTH 만큼
 * 가장자리 연장선을 따라 바깥으로 나가요. 이웃 조각 표시끼리 닿지 않게 OFFSET + LENGTH < 조각 간격 / 2 예요.
 */
export const CROP_MARK_OFFSET_MM=1;
export const CROP_MARK_LENGTH_MM=1.8;
/** P3 조각 번호(모델 면 이름 기준, 설계 §3.6). */
export const BOARD_FACE_NUMBERS=Object.freeze({ZM:1,XM:2,YM:3,ZP:4,XP:5,YP:6});

// µm 정수 사본은 위 mm 상수에서 유도해요(손으로 나란히 적지 않아요).
const um=mm=>Math.round(mm*1000);
const MARGIN_UM=um(PAPER_MARGIN_MM),GAP_UM=um(BOARD_GAP_MM),SKIN_UM=um(SKIN_THICKNESS_MM),SHEET_MAX_UM=um(SHEET_MAX_THICKNESS_MM);
const BOARD_MAX_UM=um(BOARD_MAX_THICKNESS_MM),SIDE_MIN_UM=um(PAPER_SIDE_MIN_MM),TAB_INSET_UM=um(TAB_INSET_MM);
const MODULE_MIN_UM=um(PAPER_MODULE_MIN_MM),MODULE_WARN_UM=um(PAPER_MODULE_WARN_MM),TAB_MIN_UM=um(TAB_MIN_MM),TAB_MAX_UM=um(TAB_MAX_MM);
const BAND_UM=Object.freeze(Object.fromEntries(Object.entries(PAPER_BAND_MM).map(([k,v])=>[k,um(v)])));
/** 재단 표시가 조각 격자 둘레로 나가는 거리(µm). board 배치는 위 · 왼쪽 · 오른쪽에 이만큼 자리를 둬요. */
const CROP_REACH_UM=um(CROP_MARK_OFFSET_MM+CROP_MARK_LENGTH_MM);
if(2*CROP_REACH_UM>=GAP_UM)throw new Error('재단 표시가 조각 간격의 절반을 넘으면 이웃 조각 표시와 닿아요');
/** 정수 비교용 백분율: 날개 ≤ 45 % × s, 절단면 경고 t > 40 % × 모듈. */
const TAB_MAX_PCT=Math.round(TAB_MAX_RATIO*100),BOARD_EDGE_WARN_PCT=Math.round(BOARD_EDGE_WARN_RATIO*100);
const LINE_GRAY=Object.freeze({r:128,g:128,b:128});
const INK=Object.freeze({r:0,g:0,b:0});
const WHITE=Object.freeze({r:255,g:255,b:255});
const EPS=1e-9;

const round3=v=>Math.round(v*1000)/1000;
function paperEntry(id,label,standard,widthMm,heightMm,pageKeyword){
  return Object.freeze({id,label,standard,widthMm,heightMm,widthUm:Math.round(widthMm*1000),heightUm:Math.round(heightMm*1000),
    pageKeyword,pdfWidthPt:round3(widthMm*72/25.4),pdfHeightPt:round3(heightMm*72/25.4)});
}
/**
 * 용지 8종(설계 §3.4 표 순서, 첫 항목이 기본). id 는 파일명 토큰, pageKeyword 는 CSS `@page size` 키워드,
 * pdf*Pt 는 mm × 72 / 25.4 를 소수 셋째 자리로 반올림한 값이에요. 한국 관행의 B5·B4 는 JIS 규격이에요.
 */
export const PAPER_SIZES=Object.freeze([
  paperEntry('A4','A4','ISO',210,297,'A4'),
  paperEntry('A3','A3','ISO',297,420,'A3'),
  paperEntry('A5','A5','ISO',148,210,'A5'),
  paperEntry('JISB5','B5 (JIS)','JIS',182,257,'JIS-B5'),
  paperEntry('JISB4','B4 (JIS)','JIS',257,364,'JIS-B4'),
  paperEntry('B5','B5 (ISO)','ISO',176,250,'B5'),
  paperEntry('B4','B4 (ISO)','ISO',250,353,'B4'),
  paperEntry('Letter','Letter','ANSI',215.9,279.4,'letter'),
]);
/** 두께 프리셋(설계 §3.5). 직접 입력(캘리퍼 값)은 UI 가 µm 로 반올림해 thicknessMm 로 넘겨요. */
export const THICKNESS_PRESETS=Object.freeze([
  ['plain','paper',100],['card','card',300],
  ['board10','board',1000],['board15','board',1500],['board20','board',2000],
  ['fluteE','corrugated',1600],['fluteB','corrugated',3200],['fluteC','corrugated',4000],
].map(([id,kind,thicknessUm])=>Object.freeze({id,kind,thicknessUm,thicknessMm:thicknessUm/1000})));

export function paperSize(id){
  const found=PAPER_SIZES.find(p=>p.id===id);
  if(!found)throw new RangeError(`용지 이름: ${id}`);
  return found;
}

function tlpError(code,message){const error=new RangeError(message);error.code=code;return error;}

// ─────────────────────────────────────────────────────────────────────────────
// 작은 벡터 도우미 (3D 는 정수 셀 단위, 2D 종이는 셀 단위 정수 또는 mm 실수)
// ─────────────────────────────────────────────────────────────────────────────

const dot3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const add3=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const neg3=a=>[-a[0],-a[1],-a[2]];
const mulMV=(m,v)=>[0,1,2].map(r=>m[r][0]*v[0]+m[r][1]*v[1]+m[r][2]*v[2]);
const mulMM=(a,b)=>[0,1,2].map(r=>[0,1,2].map(c=>a[r][0]*b[0][c]+a[r][1]*b[1][c]+a[r][2]*b[2][c]));
const IDENTITY3=[[1,0,0],[0,1,0],[0,0,1]];
const isUnitAxis=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isInteger)&&v.reduce((s,x)=>s+Math.abs(x),0)===1;
const axisOf=normal=>normal.findIndex(v=>v!==0);
/** 2D 진회전 k×90°(반사 없음). 종이 좌표는 y 아래예요. */
const rot2=(k,[x,y])=>[[x,y],[-y,x],[-x,-y],[y,-x]][k];
const pt=(x,y)=>({x,y});
const dist=(a,b)=>Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2);

function checkPhys(phys){
  if(!phys||phys.kind!=='H-physical'||!Number.isInteger(phys.n)||phys.n<2||!phys.faces)throw new TypeError('PhysCube 가 필요해요');
  for(const face of H_FACE_IDS){
    const f=phys.faces[face];
    if(!f||![f.normal,f.di,f.dj].every(isUnitAxis)||!Array.isArray(f.origin)||f.origin.length!==3||!f.origin.every(Number.isInteger)
      ||!Array.isArray(f.colors)||f.colors.length!==phys.n*phys.n)throw new TypeError(`PhysCube 면 ${face} 형식`);
  }
  return phys;
}

// ─────────────────────────────────────────────────────────────────────────────
// 전개도 유도
// ─────────────────────────────────────────────────────────────────────────────

/** 면 트리(모델 면 이름): ZM 중심, 네 옆면이 둘레, ZP 는 YP 에 붙어요(설계 §3.1, 기존 전개도와 같은 트리). */
export const NET_TREE=Object.freeze([['ZM','YM'],['ZM','XM'],['ZM','XP'],['ZM','YP'],['YP','ZP']].map(Object.freeze));
const NET_ROOT='ZM';

/** 정수 단위 축 k 둘레 +90° 회전 [k]× + kkᵀ (로드리게스, sin = 1 · cos = 0). */
function rot90About(k){
  return [[k[0]*k[0],k[0]*k[1]-k[2],k[0]*k[2]+k[1]],[k[1]*k[0]+k[2],k[1]*k[1],k[1]*k[2]-k[0]],[k[2]*k[0]-k[1],k[2]*k[1]+k[0],k[2]*k[2]]];
}
/** 이웃한 두 물리 면이 공유하는 모서리의 두 끝점(셀 단위 정수)이에요. */
function sharedEdge3(f,g,n){
  const af=axisOf(f.normal),ag=axisOf(g.normal);
  if(af===ag)throw new RangeError('평행한 두 면은 모서리를 공유하지 않아요');
  const third=3-af-ag,p=[0,0,0];
  p[af]=f.normal[af]>0?n:0;p[ag]=g.normal[ag]>0?n:0;
  const q=p.slice();q[third]=n;
  return [p,q];
}
/** 면 위 3D 점 → 그 면 시트 좌표 (i, j) (셀 단위). */
const sheetCoords=(f,q)=>[dot3(sub3(q,f.origin),f.di),dot3(sub3(q,f.origin),f.dj)];

/**
 * PhysCube 를 라틴 십자로 펼쳐요. 좌표는 셀 단위 정수이고 한 면이 n × n 셀이에요(mm = 셀 × 피치 / n).
 * @returns NetLayout {
 *   kind:'H-net', n, root, cols, rows (세로 배치라 rows > cols),
 *   faces: {면: {face, blank, col, row, corner:[x,y], di:[x,y], dj:[x,y]}} — 시트 (i,j) 의 종이 점 = corner + i·di + j·dj,
 *   folds: [{faces:[부모,자식], a, b}] 접는 모서리 5개(트리 순서),
 *   cuts: [{faces:[F,G], segments:[{face,a,b,outward},{…}]}] 자르는 모서리 7개(H_FACE_IDS 순서 쌍) — 같은 3D 모서리가 종이에 두 번 나와요,
 *   empty: [[col,row]…] 경계 상자 안 빈 칸(읽는 순서)
 * }
 */
export function unfoldCube(phys){
  checkPhys(phys);
  const n=phys.n,F=phys.faces,root=F[NET_ROOT];
  const transforms={[NET_ROOT]:{Q:IDENTITY3,c:[0,0,0]}};
  for(const [parent,child] of NET_TREE){
    const P=F[parent],C=F[child];
    if(dot3(P.normal,C.normal)!==0)throw new RangeError(`전개도 트리의 ${parent}·${child} 가 이웃 면이 아니에요`);
    // 자식을 공유 모서리 둘레로 90° 펼쳐 부모 평면(부모 반대편)에 놓아요: R·n_C = n_P, 축 k = n_C × n_P.
    const R=rot90About(cross3(C.normal,P.normal)),[a]=sharedEdge3(P,C,n),tp=transforms[parent];
    transforms[child]={Q:mulMM(tp.Q,R),c:add3(mulMV(tp.Q,sub3(a,mulMV(R,a))),tp.c)};
  }
  const rootPlane=dot3(root.origin,root.normal);
  const u0=root.dj,v0=cross3(neg3(root.normal),u0); // 뿌리를 바깥에서 보는 오른손 종이 틀: u0 × v0 = −n0
  const raw={};
  for(const face of H_FACE_IDS){
    const f=F[face],{Q,c}=transforms[face],T=p=>add3(mulMV(Q,p),c);
    if(dot3(mulMV(Q,f.normal),root.normal)!==1||dot3(T(f.origin),root.normal)!==rootPlane)throw new RangeError(`${face} 가 뿌리 평면에 펼쳐지지 않았어요`);
    const to2=v=>[dot3(v,u0),dot3(v,v0)];
    raw[face]={corner:to2(T(f.origin)),di:to2(mulMV(Q,f.di)),dj:to2(mulMV(Q,f.dj))};
  }
  // 긴 축이 세로(rows > cols)이고 뿌리가 가장 위에 오는 진회전 하나를 골라요.
  let best=null;
  for(let k=0;k<4;k++){
    const placed=Object.fromEntries(H_FACE_IDS.map(face=>{const r=raw[face];return [face,{corner:rot2(k,r.corner),di:rot2(k,r.di),dj:rot2(k,r.dj)}];}));
    const xs=[],ys=[];
    for(const face of H_FACE_IDS){
      const r=placed[face];
      for(const [s,t] of [[0,0],[n,0],[0,n],[n,n]]){xs.push(r.corner[0]+s*r.di[0]+t*r.dj[0]);ys.push(r.corner[1]+s*r.di[1]+t*r.dj[1]);}
    }
    const x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0;
    if(!(h>w))continue;
    const rootTop=Math.min(...[0,n].flatMap(s=>[0,n].map(t=>placed[NET_ROOT].corner[1]+s*placed[NET_ROOT].di[1]+t*placed[NET_ROOT].dj[1])))-y0;
    if(!best||rootTop<best.rootTop)best={k,placed,x0,y0,w,h,rootTop};
  }
  if(!best)throw new RangeError('전개도를 세로로 놓을 수 없어요');
  const faces={},occupied=new Set();
  for(const face of H_FACE_IDS){
    const r=best.placed[face],corner=[r.corner[0]-best.x0,r.corner[1]-best.y0];
    const minX=Math.min(corner[0],corner[0]+n*r.di[0],corner[0]+n*r.dj[0]),minY=Math.min(corner[1],corner[1]+n*r.di[1],corner[1]+n*r.dj[1]);
    if(minX%n!==0||minY%n!==0)throw new RangeError('전개도 면이 격자 칸에 맞지 않아요');
    const col=minX/n,row=minY/n,key=`${col},${row}`;
    if(occupied.has(key))throw new RangeError('전개도 면 두 개가 같은 칸에 있어요');
    occupied.add(key);
    faces[face]=Object.freeze({face,blank:!!F[face].blank,col,row,corner:Object.freeze(corner),di:Object.freeze(r.di.slice()),dj:Object.freeze(r.dj.slice())});
  }
  const pageOf=(face,q)=>{const f=faces[face],[i,j]=sheetCoords(F[face],q);return [f.corner[0]+i*f.di[0]+j*f.dj[0],f.corner[1]+i*f.di[1]+j*f.dj[1]];};
  const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  const treeKey=new Set(NET_TREE.map(([a,b])=>[a,b].sort().join('|')));
  const folds=NET_TREE.map(([parent,child])=>{
    const [p,q]=sharedEdge3(F[parent],F[child],n),a=pageOf(parent,p),b=pageOf(parent,q);
    if(!same(a,pageOf(child,p))||!same(b,pageOf(child,q)))throw new RangeError(`접는 모서리 ${parent}·${child} 가 종이에서 이어지지 않아요`);
    return Object.freeze({faces:Object.freeze([parent,child]),a:Object.freeze(a),b:Object.freeze(b)});
  });
  const cuts=[];
  for(let x=0;x<6;x++)for(let y=x+1;y<6;y++){
    const f=H_FACE_IDS[x],g=H_FACE_IDS[y];
    if(dot3(F[f].normal,F[g].normal)!==0||treeKey.has([f,g].sort().join('|')))continue;
    const [p,q]=sharedEdge3(F[f],F[g],n);
    const segments=[f,g].map(face=>{
      const a=pageOf(face,p),b=pageOf(face,q),L=faces[face];
      const cx=L.corner[0]+n*(L.di[0]+L.dj[0])/2,cy=L.corner[1]+n*(L.di[1]+L.dj[1])/2;
      const mx=(a[0]+b[0])/2-cx,my=(a[1]+b[1])/2-cy;
      return Object.freeze({face,a:Object.freeze(a),b:Object.freeze(b),outward:Object.freeze([Math.sign(mx),Math.sign(my)])});
    });
    cuts.push(Object.freeze({faces:Object.freeze([f,g]),segments:Object.freeze(segments)}));
  }
  const cols=best.w/n,rows=best.h/n,empty=[];
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)if(!occupied.has(`${col},${row}`))empty.push(Object.freeze([col,row]));
  return Object.freeze({kind:'H-net',n,root:NET_ROOT,cols,rows,faces:Object.freeze(faces),folds:Object.freeze(folds),cuts:Object.freeze(cuts),empty:Object.freeze(empty)});
}

// ─────────────────────────────────────────────────────────────────────────────
// 볼록 다각형 겹침 (분리축). 가장자리 접촉은 겹침이 아니에요.
// ─────────────────────────────────────────────────────────────────────────────

function project(points,nx,ny){let lo=Infinity,hi=-Infinity;for(const p of points){const v=p.x*nx+p.y*ny;if(v<lo)lo=v;if(v>hi)hi=v;}return [lo,hi];}
/** 두 볼록 다각형의 내부가 eps 보다 깊게 겹치면 true. */
export function convexOverlap(P,Q,eps=1e-7){
  for(const poly of [P,Q])for(let k=0;k<poly.length;k++){
    const a=poly[k],b=poly[(k+1)%poly.length],ex=b.x-a.x,ey=b.y-a.y,len=Math.sqrt(ex*ex+ey*ey);
    if(len<1e-12)continue;
    const nx=ey/len,ny=-ex/len,[p0,p1]=project(P,nx,ny),[q0,q1]=project(Q,nx,ny);
    if(Math.min(p1,q1)-Math.max(p0,q0)<=eps)return false;
  }
  return true;
}
const rectPoly=(x0,y0,x1,y1)=>[pt(x0,y0),pt(x1,y0),pt(x1,y1),pt(x0,y1)];

// ─────────────────────────────────────────────────────────────────────────────
// 날개 (P1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 날개 폭(µm): clamp(0.18 × 바깥 한 변 s, 6, 15) mm (설계 §3.2). s 기준이라 한 변 하한 13.4 mm(= 6 / 0.45 올림)에서도
 * w ≤ 0.45·s 가 서요. 인쇄 모서리(p = s − t)에서 사다리꼴 윗변 p − 2·0.5 − 2w 가 양수인지는 paperPlan 이 따로 봐요.
 */
export function tabWidthUm(sideUm){return Math.min(TAB_MAX_UM,Math.max(TAB_MIN_UM,Math.round(sideUm*TAB_RATIO)));}

/** 밑변 a→b(mm), 바깥 방향 out(단위), 폭 w, 양끝 들임 inset 인 45° 사다리꼴이에요. */
function tabPolygon(a,b,out,w,inset){
  const L=dist(a,b),ux=(b.x-a.x)/L,uy=(b.y-a.y)/L;
  if(!(L-2*inset-2*w>EPS))throw tlpError('TLP_PAPER_FIT','날개가 모서리보다 넓어요');
  const a1=pt(a.x+ux*inset,a.y+uy*inset),b1=pt(b.x-ux*inset,b.y-uy*inset);
  return [a1,b1,pt(b1.x-ux*w+out[0]*w,b1.y-uy*w+out[1]*w),pt(a1.x+ux*w+out[0]*w,a1.y+uy*w+out[1]*w)];
}

/**
 * 자르는 모서리 7쌍마다 날개를 한쪽에만 달아요. 2^7 = 128 조합을 전수로 보고(설계 §3.2)
 *   하드 제약: 날개가 면·다른 날개·예약 영역과 겹치지 않아요.
 *   목적: 짧은 축 방향으로 경계 상자 밖에 나가는 날개 수 → 긴 축 방향 수 → 조합 번호(고정 순서) 순으로 최소.
 * 좌표는 전개도 경계 상자 왼쪽 위가 (0,0) 인 mm 예요.
 * @param {object} layout unfoldCube 결과
 * @param {number} pitchMm 인쇄 피치(면 한 변)
 * @param {number} tabMm 날개 폭
 * @param {{insetMm?:number, reserved?:Array<{x0,y0,x1,y1}>}} [options]
 * @returns {Tab[]} layout.cuts 순서. Tab = {cut, face, partner, a, b, outward, base:[a1,b1], polygon, outside:{short,long}}
 */
export function assignTabs(layout,pitchMm,tabMm,{insetMm=TAB_INSET_MM,reserved=[]}={}){
  if(!layout||layout.kind!=='H-net')throw new TypeError('NetLayout 이 필요해요');
  if(!(pitchMm>0)||!(tabMm>0)||!(insetMm>=0))throw new RangeError('날개 치수');
  const scale=pitchMm/layout.n,W=layout.cols*pitchMm,H=layout.rows*pitchMm,shortIsX=layout.cols<=layout.rows;
  const facePolys=Object.values(layout.faces).map(f=>rectPoly(f.col*pitchMm,f.row*pitchMm,(f.col+1)*pitchMm,(f.row+1)*pitchMm));
  const reservedPolys=reserved.map(r=>rectPoly(r.x0,r.y0,r.x1,r.y1));
  const candidates=layout.cuts.map((cut,index)=>cut.segments.map((seg,side)=>{
    const a=pt(seg.a[0]*scale,seg.a[1]*scale),b=pt(seg.b[0]*scale,seg.b[1]*scale),polygon=tabPolygon(a,b,seg.outward,tabMm,insetMm);
    const outX=polygon.some(p=>p.x<-EPS||p.x>W+EPS),outY=polygon.some(p=>p.y<-EPS||p.y>H+EPS);
    const valid=!facePolys.some(q=>convexOverlap(polygon,q))&&!reservedPolys.some(q=>convexOverlap(polygon,q));
    return {cut:index,face:seg.face,partner:cut.segments[1-side].face,a,b,outward:seg.outward,base:[polygon[0],polygon[1]],polygon,valid,
      outside:{short:shortIsX?outX:outY,long:shortIsX?outY:outX}};
  }));
  const count=candidates.length;
  let best=null;
  for(let mask=0;mask<(1<<count);mask++){
    const chosen=candidates.map((pair,k)=>pair[(mask>>k)&1]);
    if(chosen.some(tab=>!tab.valid))continue;
    let clash=false;
    for(let x=0;x<count&&!clash;x++)for(let y=x+1;y<count;y++)if(convexOverlap(chosen[x].polygon,chosen[y].polygon)){clash=true;break;}
    if(clash)continue;
    const score=[chosen.filter(t=>t.outside.short).length,chosen.filter(t=>t.outside.long).length];
    if(!best||score[0]<best.score[0]||(score[0]===best.score[0]&&score[1]<best.score[1]))best={score,chosen};
  }
  if(!best)throw tlpError('TLP_PAPER_FIT','날개를 겹치지 않게 놓을 수 없어요');
  return Object.freeze(best.chosen.map(({valid,...tab})=>Object.freeze(tab)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 스트로크 글리프 (설계 §3.7) — 언어 중립 문자만. 좌표는 글자 높이 h 기준 단위, y 아래.
// ─────────────────────────────────────────────────────────────────────────────

const GLYPH_STROKE=0.12,GLYPH_SPACING=0.22;
const GLYPHS=Object.freeze({
  '0':{w:0.6,s:[[[0,0],[0.6,0],[0.6,1],[0,1],[0,0]],[[0.6,0.15],[0,0.85]]]},
  '1':{w:0.6,s:[[[0.12,0.22],[0.34,0],[0.34,1]],[[0.1,1],[0.58,1]]]},
  '2':{w:0.6,s:[[[0,0],[0.6,0],[0.6,0.5],[0,0.5],[0,1],[0.6,1]]]},
  '3':{w:0.6,s:[[[0,0],[0.6,0],[0.6,1],[0,1]],[[0.14,0.5],[0.6,0.5]]]},
  '4':{w:0.6,s:[[[0,0],[0,0.55],[0.6,0.55]],[[0.46,0.2],[0.46,1]]]},
  '5':{w:0.6,s:[[[0.6,0],[0,0],[0,0.48],[0.6,0.48],[0.6,1],[0,1]]]},
  '6':{w:0.6,s:[[[0.6,0],[0,0],[0,1],[0.6,1],[0.6,0.5],[0,0.5]]]},
  '7':{w:0.6,s:[[[0,0],[0.6,0],[0.22,1]]]},
  '8':{w:0.6,s:[[[0,0],[0.6,0],[0.6,1],[0,1],[0,0]],[[0,0.5],[0.6,0.5]]]},
  '9':{w:0.6,s:[[[0.6,0.5],[0,0.5],[0,0],[0.6,0],[0.6,1],[0,1]]]},
  '.':{w:0,s:[[[0,1],[0,1]]]},
  'm':{w:0.6,s:[[[0,1],[0,0.4],[0.6,0.4],[0.6,1]],[[0.3,0.4],[0.3,1]]]},
  's':{w:0.45,s:[[[0.45,0.4],[0,0.4],[0,0.7],[0.45,0.7],[0.45,1],[0,1]]]},
  't':{w:0.45,s:[[[0.16,0.1],[0.16,1],[0.45,1]],[[0,0.4],[0.42,0.4]]]},
  '=':{w:0.5,s:[[[0,0.42],[0.5,0.42]],[[0,0.72],[0.5,0.72]]]},
  '×':{w:0.5,s:[[[0.04,0.42],[0.46,0.96]],[[0.46,0.42],[0.04,0.96]]]},
  '-':{w:0.4,s:[[[0,0.6],[0.4,0.6]]]},
  'A':{w:0.6,s:[[[0,1],[0.3,0],[0.6,1]],[[0.12,0.64],[0.48,0.64]]]},
  'B':{w:0.6,s:[[[0,0.5],[0.45,0.5],[0.6,0.62],[0.6,0.88],[0.45,1],[0,1],[0,0],[0.4,0],[0.55,0.12],[0.55,0.38],[0.4,0.5]]]},
  'C':{w:0.6,s:[[[0.6,0],[0,0],[0,1],[0.6,1]]]},
  '↑':{w:0.6,s:[[[0.3,1],[0.3,0]],[[0.04,0.3],[0.3,0],[0.56,0.3]]]},
  ' ':{w:0.35,s:[]},
});
/** 도안에 쓸 수 있는 문자 집합이에요(공백 포함). */
export const GLYPH_CHARS=Object.freeze(Object.keys(GLYPHS).join(''));

/** 선분 a→b 를 폭 w 의 사각형으로 바꿔요. cap 이면 양끝을 w/2 늘여 이음매를 덮어요. 길이 0 이면 축 정렬 정사각형이에요. */
function strokeRect(a,b,w,cap=true){
  let dx=b.x-a.x,dy=b.y-a.y,len=Math.sqrt(dx*dx+dy*dy);
  if(len<1e-12){dx=1;dy=0;len=1;}
  const ux=dx/len,uy=dy/len,h=w/2,px=-uy*h,py=ux*h,ex=cap?ux*h:0,ey=cap?uy*h:0;
  return [pt(a.x-ex+px,a.y-ey+py),pt(b.x+ex+px,b.y+ey+py),pt(b.x+ex-px,b.y+ey-py),pt(a.x-ex-px,a.y-ey-py)];
}
function glyphOf(ch){
  const g=GLYPHS[ch];
  if(!g)throw new RangeError(`도안 글리프에 없는 문자예요: ${JSON.stringify(ch)} (쓸 수 있는 문자: ${GLYPH_CHARS})`);
  return g;
}
/** 글자열 획의 사각형들(점 4개씩)이에요. strokeGlyphs 와 measureGlyphs 가 같은 획을 써요. */
function glyphRects(text,x,y,h){
  const sw=GLYPH_STROKE*h,inner=h-sw,out=[];
  let cursor=x;
  for(const ch of String(text)){
    const g=glyphOf(ch);
    for(const line of g.s){
      const points=line.map(([gx,gy])=>pt(cursor+sw/2+gx*inner,y+sw/2+gy*inner));
      if(points.length===1)points.push(points[0]);
      for(let k=0;k+1<points.length;k++)out.push(strokeRect(points[k],points[k+1],sw));
    }
    cursor+=g.w*inner+sw+GLYPH_SPACING*h;
  }
  return out;
}
/**
 * 글자열이 차지하는 크기(mm)예요. 높이 h 는 획 굵기까지 포함한 글자 높이예요.
 * 폭은 «글자 상자 합 + 간격» 과 **실제 잉크 오른쪽 끝** 중 큰 값이에요. 대각 획('7' · '×' 등)의 사각 캡은 모서리가 돌아가
 * 글자 상자 밖으로 최대 sw/2·(|ux|+|uy| − 1) 삐져나와요 — 이 폭으로 오른쪽 정렬해야 잉크가 여백 안에 머물러요.
 * left · top · bottom 은 글자 상자 왼쪽 위(x, y) 기준 잉크의 왼쪽 · 위 · 아래 끝이에요(left ≤ 0, top ≤ 0 ≤ h ≤ bottom).
 * @returns {{width:number, height:number, left:number, top:number, bottom:number}}
 */
export function measureGlyphs(text,h){
  const chars=[...String(text)],sw=GLYPH_STROKE*h;
  let width=0,left=0,top=0,bottom=h;
  chars.forEach((ch,k)=>{width+=glyphOf(ch).w*(h-sw)+sw+(k?GLYPH_SPACING*h:0);});
  for(const rect of glyphRects(text,0,0,h))for(const q of rect){
    if(q.x>width)width=q.x;if(q.x<left)left=q.x;if(q.y<top)top=q.y;if(q.y>bottom)bottom=q.y;
  }
  return {width,height:h,left,top,bottom};
}
/**
 * 글자열을 얇은 다각형 목록으로 바꿔요. (x, y) 는 글자 상자의 왼쪽 위, h 는 글자 높이(mm)예요.
 * @returns {object[]} scene polygon 도형 {kind:'polygon', color, qr:true, role:'glyph', points}
 */
export function strokeGlyphs(text,x,y,h,{color=INK}={}){
  if(!(h>0))throw new RangeError('글자 높이는 양수여야 해요');
  return glyphRects(text,x,y,h).map(points=>({kind:'polygon',color,qr:true,role:'glyph',points}));
}

// ─────────────────────────────────────────────────────────────────────────────
// 용지 계획 (설계 §3.4–§3.6)
// ─────────────────────────────────────────────────────────────────────────────

/** 두께에 따른 기본 방식: t ≤ 0.45 mm 면 한 장 전개도, 그보다 두꺼우면 감싸기 스킨(설계 §3.5). */
export function defaultPaperMethod(thicknessMm){return Math.round(thicknessMm*1000)<=SHEET_MAX_UM?'sheet':'skin';}

function fitsPaper(method,W,H,pitchUm,tUm){
  const across=W-2*MARGIN_UM,down=H-2*MARGIN_UM-BAND_UM[method];
  if(method==='sheet')return 3*pitchUm<=across&&4*pitchUm+tabWidthUm(pitchUm+tUm)<=down;
  if(method==='skin')return 3*pitchUm<=across&&4*pitchUm<=down;
  // board: 조각 격자 둘레(위 · 왼쪽 · 오른쪽)에 재단 표시 자리를 둬요. 아래는 하단 띠가 받아요.
  return 2*pitchUm+GAP_UM+2*CROP_REACH_UM<=across&&3*pitchUm+2*GAP_UM+CROP_REACH_UM<=down;
}
/** 자동 최대(µm, 0.1 mm 단위로 버림). sheet·skin 은 인쇄 피치, board 는 조각 한 변이에요. */
function maxPitchUm(method,W,H,tUm){
  const across=W-2*MARGIN_UM,down=H-2*MARGIN_UM-BAND_UM[method];
  if(method==='skin')return Math.min(Math.floor(across/300),Math.floor(down/400))*100;
  if(method==='board')return Math.min(Math.floor((across-GAP_UM-2*CROP_REACH_UM)/200),Math.floor((down-2*GAP_UM-CROP_REACH_UM)/300))*100;
  // sheet: 3p ≤ 폭, 4p + 날개(p + t) ≤ 높이. 날개 폭이 p 에 단조라 0.1 mm 격자에서 이분 탐색해요.
  let lo=0,hi=Math.floor(across/300);
  const ok=k=>4*k*100+tabWidthUm(k*100+tUm)<=down;
  if(ok(hi))return hi*100;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(ok(mid))lo=mid;else hi=mid;}
  return lo*100;
}
const formatMm=um=>(um/1000).toFixed(3).replace(/\.?0+$/,'');
/** 코어 재단표 치수는 0.1 mm 로 적어요 — 손 재단 정밀도이고, 상태 줄(0.1 mm)과 같은 값이에요. */
const formatMm1=um=>(Math.round(um/100)/10).toFixed(1);

/** 하단 띠 캡션이에요(한 변 · 두께를 µm 그대로). */
const captionText=(sideUm,tUm)=>`s=${formatMm(sideUm)} t=${formatMm(tUm)}`;
/** 조립 지도(board 하단 띠 오른쪽): 라틴 십자 칸 한 변과, 막대·캡션과의 간격(mm). */
const MAP_CELL_MM=4,MAP_GAP_MM=2;
/** 라틴 십자를 세로로 놓은 전개도의 칸 수(가로 3 × 세로 4). buildPaperSheet 가 유도한 배치와 같은지 확인해요. */
const NET_COLS=3,NET_ROWS=4;
/** 하단 띠(막대 + 캡션)가 가로로 놓일 수 있는 구간 [lo, hi] 이에요. board 는 오른쪽에 조립 지도가 있어요. */
function bandSpan(method,W){
  const m=PAPER_MARGIN_MM;
  // 왼쪽 끝은 막대 첫 틱의 잉크(선폭 절반)가 여백 안에 남도록 선폭만큼 들여요.
  return {lo:m+CUT_LINE_MM,hi:method==='board'?W-m-NET_COLS*MAP_CELL_MM-MAP_GAP_MM:W-m};
}
/** 띠 시작 x: 선호 위치를 구간 안으로 넣어요. 캡션이 구간보다 길면 null(계획 · 조립이 같은 판정을 써요). */
function bandStartX(method,W,preferredX,caption){
  const {lo,hi}=bandSpan(method,W),contentW=bandContentWidth(caption);
  if(hi-contentW<lo-1e-9)return null;
  return Math.min(Math.max(lo,preferredX),hi-contentW);
}
/** 감싸기 스킨 코어 재단표: 줄 글자열과, 빈 칸(피치 p) 안쪽 여백 1.5 mm 에 들어가는 글자 높이(최대 3 mm)예요. */
const CORE_TABLE_PAD_MM=1.5,CORE_TABLE_LEADING=1.6,CORE_TABLE_MIN_H_MM=1,CORE_TABLE_MAX_H_MM=3;
function coreTable(core,pitchMm){
  const lines=core.map(c=>`${c.id} ${c.count}× ${formatMm1(c.wUm)}×${formatMm1(c.hUm)}`);
  const avail=pitchMm-2*CORE_TABLE_PAD_MM,units=Math.max(...lines.map(t=>measureGlyphs(t,1).width));
  return {lines,h:Math.min(CORE_TABLE_MAX_H_MM,avail/units,avail/(lines.length*CORE_TABLE_LEADING))};
}

/**
 * 용지·한 변·두께·방식을 정해 도안 계획을 만들어요. 수치는 메쉬나 장면 없이 O(1) 이라 UI 상태 줄에 바로 써요.
 * @param {object} phys PhysCube (n 만 써요)
 * @param {{paper?:string, sideMm?:number, thicknessMm?:number, method?:'sheet'|'skin'|'board'}} [options]
 *   paper: PAPER_SIZES id(기본 'A4'). sideMm: 바깥 한 변 s(생략하면 용지에 맞는 최대). thicknessMm: 종이·판 두께(기본 0.1).
 *   method: 생략하면 defaultPaperMethod(두께).
 * @returns Plan — 구조는 이 파일 끝 주석을 봐요.
 * @throws RangeError code TLP_PAPER_FIT(한 변이 하한 미만·용지 초과·날개 불가) · TLP_PAPER_MODULE(종이 모듈 < 1.0 mm) ·
 *   TLP_BOARD_THICK(방식의 두께 상한 초과 · 코어가 두께에 못 미침) · TLP_BOARD_EDGE(P3 에서 t ≥ 모듈)
 */
export function paperPlan(phys,{paper='A4',sideMm,thicknessMm=0.1,method}={}){
  checkPhys(phys);
  const sheet=paperSize(typeof paper==='string'?paper:paper?.id);
  if(typeof thicknessMm!=='number'||!Number.isFinite(thicknessMm)||thicknessMm<=0)throw new RangeError('두께(mm)는 양수여야 해요');
  const tUm=Math.round(thicknessMm*1000);
  if(tUm<1)throw new RangeError('두께는 1 µm 이상이어야 해요');
  const m=method??defaultPaperMethod(thicknessMm);
  if(!PAPER_METHODS.includes(m))throw new RangeError(`도안 방식: ${m}`);
  if(m==='sheet'&&tUm>SHEET_MAX_UM)throw tlpError('TLP_BOARD_THICK',`한 장 전개도는 두께 ${SHEET_MAX_THICKNESS_MM} mm 이하만 돼요`);
  if(m==='board'&&tUm>BOARD_MAX_UM)throw tlpError('TLP_BOARD_THICK',`판 직접 인쇄는 두께 ${BOARD_MAX_THICKNESS_MM} mm 이하만 돼요`);
  const W=sheet.widthUm,H=sheet.heightUm,n=phys.n,auto=sideMm===undefined||sideMm===null;
  let sideUm,pitchUm;
  if(auto){
    const max=maxPitchUm(m,W,H,tUm);
    pitchUm=max;sideUm=m==='sheet'?max+tUm:m==='skin'?max-SKIN_UM:max;
  }else{
    if(typeof sideMm!=='number'||!Number.isFinite(sideMm)||sideMm<=0)throw new RangeError('한 변(mm)은 양수여야 해요');
    sideUm=Math.round(sideMm*1000);
    pitchUm=m==='sheet'?sideUm-tUm:m==='skin'?sideUm+SKIN_UM:sideUm;
  }
  if(sideUm<SIDE_MIN_UM)throw tlpError('TLP_PAPER_FIT',`한 변은 ${PAPER_SIDE_MIN_MM} mm 이상이어야 해요`);
  if(!fitsPaper(m,W,H,pitchUm,tUm))throw tlpError('TLP_PAPER_FIT',`한 변 ${formatMm(sideUm)} mm 는 ${sheet.id} 에 들어가지 않아요`);
  // 종이 위 모듈 = 인쇄되는 면 한 변 / n (sheet·skin 은 인쇄 피치, board 는 조각 한 변).
  if(pitchUm<n*MODULE_MIN_UM)throw tlpError('TLP_PAPER_MODULE',`종이 모듈이 ${PAPER_MODULE_MIN_MM} mm 보다 작아요`);
  const warnings=[];
  if(pitchUm<n*MODULE_WARN_UM)warnings.push('TLP_WARN_MODULE_SMALL');
  let tabUm=0,core=null,pieces=null;
  if(m==='sheet'){
    tabUm=tabWidthUm(sideUm);
    // 날개 ≤ TAB_MAX_RATIO × s(정수 비교), 그리고 인쇄 모서리에서 사다리꼴 윗변(p − 2·들임 − 2w)이 남아야 해요.
    if(tabUm*100>TAB_MAX_PCT*sideUm||pitchUm-2*TAB_INSET_UM-2*tabUm<=0)throw tlpError('TLP_PAPER_FIT','날개가 한 변에 비해 너무 넓어요');
  }else if(m==='skin'){
    const inner=sideUm-2*tUm;
    if(inner<=0)throw tlpError('TLP_BOARD_THICK','판 두께가 코어 한 변의 절반 이상이에요');
    core=Object.freeze([['A',sideUm,sideUm],['B',sideUm,inner],['C',inner,inner]].map(([id,wUm,hUm])=>Object.freeze({id,count:2,wUm,hUm})));
  }else{
    // 절단면 띠(폭 t)가 흰 링(폭 = 모듈) 안에 떨어져야 해요: t < s/n ⟺ t·n < s.
    if(tUm*n>=sideUm)throw tlpError('TLP_BOARD_EDGE','판 두께가 종이 모듈보다 작아야 해요');
    if(100*tUm*n>BOARD_EDGE_WARN_PCT*sideUm)warnings.push('TLP_WARN_BOARD_EDGE'); // t > BOARD_EDGE_WARN_RATIO × 모듈(s/n), 정수 비교
    const inner=sideUm-2*tUm;
    pieces=Object.freeze(H_FACE_IDS.map(face=>{
      const axis=axisOf(phys.faces[face].normal),piece=axis===2?'A':axis===0?'B':'C';
      const [wUm,hUm]=piece==='A'?[sideUm,sideUm]:piece==='B'?[sideUm,inner]:[inner,inner];
      return Object.freeze({face,number:BOARD_FACE_NUMBERS[face],piece,wUm,hUm});
    }).sort((a,b)=>a.number-b.number));
  }
  // 도안 조립(buildPaperSheet)이 다시 재는 배치 제약을 계획에서 같은 함수로 재요 — «계획 통과 ⇒ 도안 생성 통과».
  // 상태 줄 · 버튼은 계획만 보고 켜지므로, 여기서 빠진 제약은 «버튼은 켜졌는데 눌러도 안 되는» 상태가 돼요.
  if(bandStartX(m,W/1000,0,captionText(sideUm,tUm))===null)throw tlpError('TLP_PAPER_FIT','하단 띠(막대 · 캡션)가 용지 폭에 들어가지 않아요');
  // 재단표를 0.1 mm 로 적는 지금은 한 변 하한(13.4 mm)에서도 글자 높이가 약 1.02 mm 라 이 검사에 걸리는 입력이 없어요
  // (test/paper-net 의 «계획 통과 ⇒ 도안 생성 통과» 격자가 재요). 글리프나 재단표 형식이 바뀌면 조립보다 먼저 여기서 걸려요.
  if(core&&coreTable(core,pitchUm/1000).h<CORE_TABLE_MIN_H_MM)throw tlpError('TLP_PAPER_FIT','코어 재단표 글자가 빈 칸에 들어가지 않아요');
  return Object.freeze({kind:'paper-plan',method:m,paper:sheet,n,auto,
    widthMm:W/1000,heightMm:H/1000,marginMm:PAPER_MARGIN_MM,bandMm:BAND_UM[m]/1000,gapMm:m==='board'?BOARD_GAP_MM:0,
    thicknessUm:tUm,sideUm,pitchUm,tabUm,skinUm:m==='skin'?SKIN_UM:0,
    thicknessMm:tUm/1000,sideMm:sideUm/1000,pitchMm:pitchUm/1000,moduleMm:pitchUm/1000/n,tabMm:tabUm/1000,
    cutBandMm:m==='board'?tUm/1000:0,core,pieces,warnings:Object.freeze(warnings),
    fileTag:`${m}-${sheet.id}-s${sideUm}um-t${tUm}um`});
}

/**
 * 두께·용지에서 고를 수 있는 방식 카드와 막힌 사유(TLP 코드)예요(설계 §3.5). t ≤ 0.45 면 한 장 전개도뿐이에요.
 * @returns {{method:string, enabled:boolean, reason:string|null}[]}
 */
export function paperMethodOptions(phys,{paper='A4',thicknessMm=0.1,sideMm}={}){
  const methods=Math.round(thicknessMm*1000)<=SHEET_MAX_UM?['sheet']:['skin','board'];
  return methods.map(method=>{
    try{paperPlan(phys,{paper,thicknessMm,sideMm,method});return {method,enabled:true,reason:null};}
    catch(error){if(typeof error?.code==='string'&&error.code.startsWith('TLP_'))return {method,enabled:false,reason:error.code};throw error;}
  });
}

/** renderExportPng(scene, 이 값) 이 300 dpi 실척 PNG(pHYs 포함)를 내요. 기존 PNG 경로를 그대로 써요. */
export function paperPngPlan(scene,{dpi=300}={}){
  if(!(dpi>0))throw new RangeError('dpi 는 양수여야 해요');
  const ppu=dpi/25.4;
  return {ppu,width:Math.round(scene.width*ppu),height:Math.round(scene.height*ppu),ppi:dpi,supersample:1};
}

// ─────────────────────────────────────────────────────────────────────────────
// 장면 조립
// ─────────────────────────────────────────────────────────────────────────────

function base64(bytes){
  if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');
  let s='';for(let k=0;k<bytes.length;k+=32768)s+=String.fromCharCode(...bytes.subarray(k,k+32768));
  return btoa(s);
}
/** 면 이미지의 픽셀 직사각형만 잘라 새 이미지 자산을 만들어요(원본은 그대로). */
function cropImageAsset(image,px0,py0,px1,py1){
  const w=px1-px0,h=py1-py0,pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)pixels.set(image.pixels.subarray(((py0+y)*image.width+px0)*4,((py0+y)*image.width+px1)*4),y*w*4);
  return {width:w,height:h,pixels,href:'data:image/png;base64,'+base64(rasterToPng({width:w,height:h,pixels}))};
}

/**
 * 한 물리 면을 그려요. at(i,j) 는 시트 좌표(셀) → 종이 mm, crop 은 보이는 시트 영역 [i0,i1]×[j0,j1](셀, 실수)이에요.
 * 데이터 면은 모듈마다 사각형, 빈 면은 보이는 영역 사각형 하나 + 면 이미지(설계 §2.6: 종이에는 넣어요)예요.
 */
function drawFace(shapes,name,f,n,at,crop={i0:0,i1:n,j0:0,j1:n}){
  const quad=(ia,ib,ja,jb)=>[at(ia,ja),at(ia,jb),at(ib,jb),at(ib,ja)];
  if(f.blank){
    shapes.push({kind:'polygon',color:f.colors[0],role:'module',face:name,points:quad(crop.i0,crop.i1,crop.j0,crop.j1)});
  }else{
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const ia=Math.max(i,crop.i0),ib=Math.min(i+1,crop.i1),ja=Math.max(j,crop.j0),jb=Math.min(j+1,crop.j1);
      if(ib-ia<=EPS||jb-ja<=EPS)continue;
      shapes.push({kind:'polygon',color:f.colors[i*n+j],role:'module',face:name,i,j,points:quad(ia,ib,ja,jb)});
    }
  }
  const placed=f.image;
  if(!placed)return;
  const image=assertSceneImage(placed.image),background=placed.background??f.colors[0];
  const i0=Math.max(placed.y,crop.i0),i1=Math.min(placed.y+placed.height,crop.i1),j0=Math.max(placed.x,crop.j0),j1=Math.min(placed.x+placed.width,crop.j1);
  if(i1-i0<=EPS||j1-j0<=EPS)return;
  const whole=i0===placed.y&&i1===placed.y+placed.height&&j0===placed.x&&j1===placed.x+placed.width;
  if(whole){
    shapes.push({kind:'image',image,color:background,role:'image',face:name,points:quad(placed.y,placed.y+placed.height,placed.x,placed.x+placed.width)});
    return;
  }
  // 잘린 조각(P3): 보이는 부분 안쪽으로 픽셀 경계를 맞춰 잘라요. 남는 틈은 한 픽셀 미만이고 빈 면 색이에요.
  const u=j=>(j-placed.x)/placed.width,v=i=>(i-placed.y)/placed.height;
  const px0=Math.ceil(u(j0)*image.width-1e-9),px1=Math.floor(u(j1)*image.width+1e-9),py0=Math.ceil(v(i0)*image.height-1e-9),py1=Math.floor(v(i1)*image.height+1e-9);
  if(px1<=px0||py1<=py0)return;
  const asset=cropImageAsset(image,px0,py0,px1,py1);
  const ja=placed.x+placed.width*px0/image.width,jb=placed.x+placed.width*px1/image.width,ia=placed.y+placed.height*py0/image.height,ib=placed.y+placed.height*py1/image.height;
  shapes.push({kind:'image',image:asset,color:background,role:'image',face:name,points:quad(ia,ib,ja,jb)});
}

/** 닫힌 다각형 윤곽 바깥쪽으로 폭 width 의 재단선 띠를 사각형들로 깔아요(마이터 이음, 겹침·틈 없음). */
function outlineRing(points,width){
  const pts=[];
  for(const p of points){const last=pts[pts.length-1];if(!last||dist(last,p)>1e-9)pts.push(p);}
  if(dist(pts[0],pts[pts.length-1])<=1e-9)pts.pop();
  for(let changed=true;changed;){ // 한 직선 위의 중간 꼭짓점을 지워요.
    changed=false;
    for(let k=0;k<pts.length&&pts.length>3;k++){
      const a=pts[(k+pts.length-1)%pts.length],b=pts[k],c=pts[(k+1)%pts.length];
      const cr=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x),dt=(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y);
      if(Math.abs(cr)<=1e-9&&dt>0){pts.splice(k,1);changed=true;break;}
    }
  }
  let area=0;
  for(let k=0;k<pts.length;k++){const a=pts[k],b=pts[(k+1)%pts.length];area+=a.x*b.y-b.x*a.y;}
  const s=area>0?1:-1,count=pts.length;
  const normals=pts.map((a,k)=>{const b=pts[(k+1)%count],L=dist(a,b);return pt(s*(b.y-a.y)/L,s*(a.x-b.x)/L);});
  const miters=pts.map((v,k)=>{const n1=normals[(k+count-1)%count],n2=normals[k],d=1+n1.x*n2.x+n1.y*n2.y;return pt(v.x+width*(n1.x+n2.x)/d,v.y+width*(n1.y+n2.y)/d);});
  return pts.map((v,k)=>({kind:'polygon',color:LINE_GRAY,qr:true,role:'cut',points:[v,pts[(k+1)%count],miters[(k+1)%count],miters[k]]}));
}

/** 보정 막대(0–50 mm, 10 mm 틱, 틱 중심 간 거리가 50 mm) + «50mm» 글리프. 반환은 차지한 너비예요. */
function drawBar(shapes,x,y){
  const w=CUT_LINE_MM;
  for(let k=0;k<=5;k++){const cx=x+10*k,top=k===0||k===5?y:y+1;shapes.push({kind:'polygon',color:INK,qr:true,role:'bar',points:rectPoly(cx-w/2,top,cx+w/2,y+3)});}
  shapes.push({kind:'polygon',color:INK,qr:true,role:'bar',points:rectPoly(x-w/2,y+3-w,x+CALIBRATION_BAR_MM+w/2,y+3)});
  const label=strokeGlyphs('50mm',x+CALIBRATION_BAR_MM+1.5,y+0.5,2.5).map(p=>({...p,group:'bar-label'}));
  shapes.push(...label);
  return CALIBRATION_BAR_MM+1.5+measureGlyphs('50mm',2.5).width;
}
function label(shapes,labels,id,text,x,y,h){
  const box=measureGlyphs(text,h);
  shapes.push(...strokeGlyphs(text,x,y,h).map(p=>({...p,group:id})));
  labels.push(Object.freeze({id,text,x,y,h,width:box.width}));
  return box.width;
}
/** 막대 + «s=… t=…» 캡션. 캡션은 막대 오른쪽이에요. 반환은 전체 너비예요. */
function bandContentWidth(caption){return CALIBRATION_BAR_MM+1.5+measureGlyphs('50mm',2.5).width+4+measureGlyphs(caption,2.5).width;}
function drawBand(shapes,labels,x,y,caption){
  const barWidth=drawBar(shapes,x,y);
  labels.push(Object.freeze({id:'bar-label',text:'50mm',x:x+CALIBRATION_BAR_MM+1.5,y:y+0.5,h:2.5,width:measureGlyphs('50mm',2.5).width}));
  label(shapes,labels,'caption',caption,x+barWidth+4,y+0.5,2.5);
  return {x0:x-CUT_LINE_MM/2,x1:x+bandContentWidth(caption),barStart:x,barEnd:x+CALIBRATION_BAR_MM};
}

/** 전개도 경계(면 합집합)의 방향 있는 모서리를 순환 순서로 이어요(셀 단위). 각 모서리는 면 한 변 전체예요. */
function netBoundary(layout){
  const n=layout.n,edges=new Map();
  for(const f of Object.values(layout.faces)){
    const x0=f.col*n,y0=f.row*n,x1=x0+n,y1=y0+n,c=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
    for(let k=0;k<4;k++)edges.set(`${c[k]}>${c[(k+1)%4]}`,{a:c[k],b:c[(k+1)%4],face:f.face});
  }
  for(const key of [...edges.keys()]){const e=edges.get(key);if(e&&edges.has(`${e.b}>${e.a}`)){edges.delete(key);edges.delete(`${e.b}>${e.a}`);}}
  const byStart=new Map([...edges.values()].map(e=>[`${e.a}`,e]));
  const first=[...edges.values()].sort((p,q)=>p.a[1]-q.a[1]||p.a[0]-q.a[0])[0],ring=[];
  for(let e=first;;){ring.push(e);e=byStart.get(`${e.b}`);if(!e)throw new RangeError('전개도 외곽이 닫히지 않아요');if(e===first)break;if(ring.length>edges.size)throw new RangeError('전개도 외곽 순환 오류');}
  if(ring.length!==edges.size)throw new RangeError('전개도 외곽이 한 고리가 아니에요');
  return ring;
}

/** P1·P2: 라틴 십자 도안. */
function buildNetSheet(phys,plan){
  const layout=unfoldCube(phys),n=phys.n,p=plan.pitchMm,cell=p/n,shapes=[],labels=[];
  const W=plan.widthMm,H=plan.heightMm,m=PAPER_MARGIN_MM,withTabs=plan.method==='sheet';
  const tabs=withTabs?assignTabs(layout,p,plan.tabMm):[];
  let minX=0,minY=0,maxX=layout.cols*p,maxY=layout.rows*p;
  for(const tab of tabs)for(const q of tab.polygon){minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);minY=Math.min(minY,q.y);maxY=Math.max(maxY,q.y);}
  const blockW=maxX-minX,blockH=maxY-minY+plan.bandMm;
  if(blockW>W-2*m+1e-6||blockH>H-2*m+1e-6)throw tlpError('TLP_PAPER_FIT','도안이 용지에 들어가지 않아요');
  const ox=m+(W-2*m-blockW)/2-minX,oy=m+(H-2*m-blockH)/2-minY,mv=q=>pt(ox+q.x,oy+q.y);
  const faces={};
  for(const name of H_FACE_IDS){
    const L=layout.faces[name],at=(i,j)=>pt(ox+cell*(L.corner[0]+i*L.di[0]+j*L.dj[0]),oy+cell*(L.corner[1]+i*L.di[1]+j*L.dj[1]));
    drawFace(shapes,name,phys.faces[name],n,at);
    const rect=Object.freeze({x0:ox+L.col*p,y0:oy+L.row*p,x1:ox+(L.col+1)*p,y1:oy+(L.row+1)*p});
    faces[name]=Object.freeze({face:name,blank:!!phys.faces[name].blank,cellMm:cell,corner:Object.freeze([at(0,0).x,at(0,0).y]),
      di:Object.freeze([cell*L.di[0],cell*L.di[1]]),dj:Object.freeze([cell*L.dj[0],cell*L.dj[1]]),rect,visible:rect,crop:Object.freeze({i0:0,i1:n,j0:0,j1:n})});
  }
  // 재단선: 면 + 날개의 합집합 외곽을 따라 바깥쪽 0.2 mm.
  const tabOf=new Map(tabs.map(t=>[`${t.face}:${[t.a.x,t.a.y].join(',')}|${[t.b.x,t.b.y].join(',')}`,t]));
  const findTab=(face,a,b)=>tabOf.get(`${face}:${a.x},${a.y}|${b.x},${b.y}`)??tabOf.get(`${face}:${b.x},${b.y}|${a.x},${a.y}`);
  const outline=[];
  for(const e of netBoundary(layout)){
    const a=pt(e.a[0]*cell,e.a[1]*cell),b=pt(e.b[0]*cell,e.b[1]*cell),tab=findTab(e.face,a,b);
    outline.push(mv(a));
    if(tab){
      const L=dist(a,b),u=pt((b.x-a.x)/L,(b.y-a.y)/L),w=plan.tabMm,d=TAB_INSET_MM,o=tab.outward;
      outline.push(mv(pt(a.x+u.x*d,a.y+u.y*d)),mv(pt(a.x+u.x*(d+w)+o[0]*w,a.y+u.y*(d+w)+o[1]*w)),
        mv(pt(b.x-u.x*(d+w)+o[0]*w,b.y-u.y*(d+w)+o[1]*w)),mv(pt(b.x-u.x*d,b.y-u.y*d)));
    }
  }
  const cutShapes=outlineRing(outline,CUT_LINE_MM);
  shapes.push(...cutShapes);
  const pageTabs=tabs.map(t=>Object.freeze({...t,a:mv(t.a),b:mv(t.b),base:t.base.map(mv),polygon:t.polygon.map(mv)}));
  // 날개 밑변 접는 선: 날개 쪽에만 파선(2 / 1.5 mm). 양끝은 재단선 폭만큼 비켜요.
  for(const t of pageTabs){
    const [a1,b1]=t.base,L=dist(a1,b1),u=pt((b1.x-a1.x)/L,(b1.y-a1.y)/L),o=t.outward,wd=CUT_LINE_MM;
    for(let s=wd;s<L-wd-EPS;s+=FOLD_DASH_MM[0]+FOLD_DASH_MM[1]){
      const e=Math.min(s+FOLD_DASH_MM[0],L-wd),p0=pt(a1.x+u.x*s,a1.y+u.y*s),p1=pt(a1.x+u.x*e,a1.y+u.y*e);
      shapes.push({kind:'polygon',color:LINE_GRAY,qr:true,role:'fold',tab:t.cut,points:[p0,p1,pt(p1.x+o[0]*wd,p1.y+o[1]*wd),pt(p0.x+o[0]*wd,p0.y+o[1]*wd)]});
    }
  }
  const folds=layout.folds.map(f=>Object.freeze({faces:f.faces,a:mv(pt(f.a[0]*cell,f.a[1]*cell)),b:mv(pt(f.b[0]*cell,f.b[1]*cell))}));
  // 면-면 접기 틱: 연장선이 빈 여백에 닿는 끝에만 3 mm(설계 §3.3). 면·날개·재단선과 겹치면 그리지 않아요.
  const blockers=[...Object.values(faces).map(f=>rectPoly(f.rect.x0,f.rect.y0,f.rect.x1,f.rect.y1)),...pageTabs.map(t=>t.polygon),...cutShapes.map(s=>s.points)];
  const ticks=[];
  for(const f of folds)for(const [end,from] of [[f.b,f.a],[f.a,f.b]]){
    const L=dist(from,end),u=pt((end.x-from.x)/L,(end.y-from.y)/L),s0=CUT_LINE_MM+TICK_CLEAR_MM;
    const points=strokeRect(pt(end.x+u.x*s0,end.y+u.y*s0),pt(end.x+u.x*(s0+FOLD_TICK_MM),end.y+u.y*(s0+FOLD_TICK_MM)),CUT_LINE_MM,false);
    if(points.some(q=>q.x<m-EPS||q.x>W-m+EPS||q.y<m-EPS||q.y>H-m+EPS))continue;
    if(blockers.some(b=>convexOverlap(points,b))||ticks.some(t=>convexOverlap(points,t.points)))continue;
    const tick={kind:'polygon',color:LINE_GRAY,qr:true,role:'tick',fold:f.faces.join('-'),points};
    ticks.push(tick);shapes.push(tick);
  }
  // 하단 띠: 보정 막대 + 캡션. 가로 자리는 paperPlan 과 같은 함수(bandStartX)로 정해요.
  const caption=captionText(plan.sideUm,plan.thicknessUm),bandTop=oy+maxY;
  const bandX=bandStartX(plan.method,W,ox+minX,caption);
  if(bandX===null)throw tlpError('TLP_PAPER_FIT','하단 띠(막대 · 캡션)가 용지 폭에 들어가지 않아요');
  const band=drawBand(shapes,labels,bandX,bandTop+2.5,caption);
  // P2 코어 재단표: 빈 칸에 글리프로(설계 §3.6). 겹침 없이 들어가는 첫 빈 칸(읽는 순서)이에요.
  // 글자 높이는 paperPlan 과 같은 함수(coreTable)로 정해요. 빈 칸 안쪽 1.5 mm 여백이라 면 · 재단선 · 틱(모두 칸 경계에서
  // 0.2 mm 안)과는 구성상 닿지 않지만, 겹침 검사는 그대로 둬요.
  if(plan.method==='skin'){
    const {lines,h}=coreTable(plan.core,p),lead=CORE_TABLE_LEADING;
    let placed=false;
    if(h>=CORE_TABLE_MIN_H_MM)for(const [col,row] of layout.empty){
      const x=ox+col*p+CORE_TABLE_PAD_MM,y=oy+row*p+(p-lines.length*lead*h+(lead-1)*h)/2;
      const trial=[];lines.forEach((t,k)=>trial.push(...strokeGlyphs(t,x,y+k*lead*h,h)));
      if(trial.some(s=>blockers.some(b=>convexOverlap(s.points,b))||ticks.some(t=>convexOverlap(s.points,t.points))))continue;
      lines.forEach((t,k)=>label(shapes,labels,`core-${plan.core[k].id}`,t,x,y+k*lead*h,h));
      placed=true;break;
    }
    if(!placed)throw tlpError('TLP_PAPER_FIT','코어 재단표를 놓을 빈 칸이 없어요');
  }
  const cuts=layout.cuts.map(c=>Object.freeze({faces:c.faces,segments:c.segments.map(s=>Object.freeze({face:s.face,outward:s.outward,a:mv(pt(s.a[0]*cell,s.a[1]*cell)),b:mv(pt(s.b[0]*cell,s.b[1]*cell))}))}));
  return {shapes,meta:{layout,faces,tabs:pageTabs,folds,cuts,ticks:ticks.map(t=>Object.freeze({fold:t.fold,points:t.points})),labels,band:Object.freeze({...band,y0:bandTop,y1:bandTop+plan.bandMm})}};
}

/** 조각이 놓이는 물리 축 순위: z 쌍(A) < x 쌍(B) < y 쌍(C). 순위가 낮은 판이 높은 판의 가장자리를 덮어요(맞대기). */
const BOARD_RANK=[1,2,0];
const boardRank=f=>BOARD_RANK[axisOf(f.normal)];

/**
 * 사각형(조각의 인쇄 영역) 네 모서리의 재단 표시예요. 모서리마다 두 가장자리의 연장선을 따라 바깥으로 짧은 선을 하나씩,
 * 모서리에서 CROP_MARK_OFFSET_MM 떨어져 CROP_MARK_LENGTH_MM 만큼 그려요. 인쇄 영역에 닿는 잉크가 없어서, 표시 둘을 잇는
 * 선을 따라 자르면 조각 가장자리가 흰 링 그대로 남아요.
 */
function cropMarks(r,width=CUT_LINE_MM){
  const o=CROP_MARK_OFFSET_MM,e=o+CROP_MARK_LENGTH_MM,h=width/2,out=[];
  for(const [x,sx] of [[r.x0,-1],[r.x1,1]])for(const [y,sy] of [[r.y0,-1],[r.y1,1]]){
    const hx=[x+sx*o,x+sx*e],vy=[y+sy*o,y+sy*e];
    out.push({edge:'y',points:rectPoly(Math.min(...hx),y-h,Math.max(...hx),y+h)}); // 가로 가장자리(y)의 연장선
    out.push({edge:'x',points:rectPoly(x-h,Math.min(...vy),x+h,Math.max(...vy))}); // 세로 가장자리(x)의 연장선
  }
  return out.map(({edge,points})=>({kind:'polygon',color:LINE_GRAY,qr:true,role:'cut',mark:edge,points}));
}

/** P3: 맞대기 조각 6장 + 조각 번호 + 조립 지도. */
function buildBoardSheet(phys,plan){
  const layout=unfoldCube(phys),n=phys.n,s=plan.sideMm,t=plan.thicknessMm,g=BOARD_GAP_MM,cell=s/n,shapes=[],labels=[];
  if(layout.cols!==NET_COLS||layout.rows!==NET_ROWS)throw new RangeError('전개도 칸 수가 조립 지도 자리와 달라요');
  // 조각 격자 둘레(위 · 왼쪽 · 오른쪽)에 재단 표시 자리 k 를 둬요(paperPlan 의 fitsPaper · maxPitchUm 과 같은 값).
  const k=CROP_REACH_UM/1000;
  const W=plan.widthMm,H=plan.heightMm,m=PAPER_MARGIN_MM,blockW=2*s+g+2*k,blockH=k+3*s+2*g+plan.bandMm;
  if(blockW>W-2*m+1e-6||blockH>H-2*m+1e-6)throw tlpError('TLP_PAPER_FIT','조각이 용지에 들어가지 않아요');
  const ox=m+(W-2*m-blockW)/2+k,oy=m+(H-2*m-blockH)/2+k; // 첫 조각의 왼쪽 위
  const byNormal=new Map(H_FACE_IDS.map(name=>[phys.faces[name].normal.join(','),name]));
  const faces={},glyphH=2.5,cut=t*n/s; // 잘라 낼 폭(셀)
  for(const name of H_FACE_IDS){
    const f=phys.faces[name],L=layout.faces[name],number=BOARD_FACE_NUMBERS[name],col=(number-1)%2,row=Math.floor((number-1)/2);
    const cx=ox+col*(s+g),cy=oy+row*(s+g),rc=[L.corner[0]-L.col*n,L.corner[1]-L.row*n];
    const at=(i,j)=>pt(cx+cell*(rc[0]+i*L.di[0]+j*L.dj[0]),cy+cell*(rc[1]+i*L.di[1]+j*L.dj[1]));
    // 시트 가장자리 너머 이웃 면(바깥 법선 = ±di, ±dj)의 판이 이 판을 덮으면 그 변을 t 만큼 잘라요.
    const covered=dir=>boardRank(phys.faces[byNormal.get(dir.join(','))])<boardRank(f);
    const crop=Object.freeze({i0:covered(neg3(f.di))?cut:0,i1:n-(covered(f.di)?cut:0),j0:covered(neg3(f.dj))?cut:0,j1:n-(covered(f.dj)?cut:0)});
    drawFace(shapes,name,f,n,at,crop);
    const a=at(crop.i0,crop.j0),b=at(crop.i1,crop.j1);
    const visible=Object.freeze({x0:Math.min(a.x,b.x),y0:Math.min(a.y,b.y),x1:Math.max(a.x,b.x),y1:Math.max(a.y,b.y)});
    // 재단선은 인쇄 영역에 붙은 실선이 아니라 모서리 바깥 재단 표시예요(흰 링에 회색 잔선이 남지 않게).
    shapes.push(...cropMarks(visible).map(q=>({...q,face:name})));
    // 조각 번호 + 위쪽 화살표: 칸 아래 간격(맨 아래 줄은 하단 띠 위쪽)에 둬요. 재단선 바깥이라 잘려 나가요.
    const text=`${number}↑`,box=measureGlyphs(text,glyphH),ty=cy+s+(row<2?(g-glyphH)/2:1);
    label(shapes,labels,`piece-${number}`,text,cx+(s-box.width)/2,ty,glyphH);
    const piece=plan.pieces.find(q=>q.face===name).piece;
    faces[name]=Object.freeze({face:name,blank:!!f.blank,number,piece,cellMm:cell,corner:Object.freeze([at(0,0).x,at(0,0).y]),
      di:Object.freeze([cell*L.di[0],cell*L.di[1]]),dj:Object.freeze([cell*L.dj[0],cell*L.dj[1]]),
      rect:Object.freeze({x0:cx,y0:cy,x1:cx+s,y1:cy+s}),visible,crop});
  }
  // 하단 띠: 막대·캡션(왼쪽) + 조립 지도(오른쪽, 라틴 십자 12 × 16 mm, 칸마다 번호와 화살표).
  // 막대 · 캡션의 가로 자리는 paperPlan 과 같은 함수(bandStartX)로 정해요.
  const bandTop=oy+3*s+2*g,caption=captionText(plan.sideUm,plan.thicknessUm);
  const mapCell=MAP_CELL_MM,mapX=W-m-NET_COLS*mapCell,mapY=bandTop+4,bandX=bandStartX('board',W,ox,caption);
  if(bandX===null)throw tlpError('TLP_PAPER_FIT','하단 띠(막대 · 캡션)가 용지 폭에 들어가지 않아요');
  const band=drawBand(shapes,labels,bandX,bandTop+10,caption);
  const map=[];
  for(const name of H_FACE_IDS){
    const L=layout.faces[name],x0=mapX+L.col*mapCell,y0=mapY+L.row*mapCell,x1=x0+mapCell,y1=y0+mapCell,w=0.15;
    for(const r of [[x0,y0,x1,y0+w],[x0,y1-w,x1,y1],[x0,y0,x0+w,y1],[x1-w,y0,x1,y1]])shapes.push({kind:'polygon',color:INK,qr:true,role:'map',points:rectPoly(...r)});
    const text=`${BOARD_FACE_NUMBERS[name]}↑`,h=1.5,box=measureGlyphs(text,h);
    shapes.push(...strokeGlyphs(text,x0+(mapCell-box.width)/2,y0+(mapCell-h)/2,h).map(q=>({...q,role:'map'})));
    map.push(Object.freeze({face:name,number:BOARD_FACE_NUMBERS[name],x0,y0,x1,y1}));
  }
  return {shapes,meta:{layout,faces,labels,map:Object.freeze(map),band:Object.freeze({...band,y0:bandTop,y1:bandTop+plan.bandMm})}};
}

/**
 * 계획대로 실척 mm 장면을 만들어요. sceneToSvg(scene, {unit:'mm'}) · renderExportPng(scene, paperPngPlan(scene)) 가 그대로 받아요.
 * @param {object} phys PhysCube
 * @param {object} plan paperPlan 결과(같은 phys.n)
 * @returns {{width, height, background, shapes, paper}} — paper 는 검증·UI 용 메타데이터(파일 끝 주석)예요.
 */
export function buildPaperSheet(phys,plan){
  checkPhys(phys);
  if(!plan||plan.kind!=='paper-plan')throw new TypeError('paperPlan 결과가 필요해요');
  if(plan.n!==phys.n)throw new RangeError('계획과 큐브의 한 변 셀 수가 달라요');
  const built=plan.method==='board'?buildBoardSheet(phys,plan):buildNetSheet(phys,plan);
  const W=plan.widthMm,H=plan.heightMm,m=PAPER_MARGIN_MM;
  // 자체 검사: 모든 도형이 여백 m 안(재단선 잉크만 바깥쪽 선폭까지)이에요. 프린터 비인쇄 여백에 내용이 잘리지 않게 해요.
  for(const shape of built.shapes){
    const slack=shape.role==='cut'?CUT_LINE_MM+1e-6:1e-6;
    if(shape.points.some(q=>q.x<m-slack||q.x>W-m+slack||q.y<m-slack||q.y>H-m+slack))throw tlpError('TLP_PAPER_FIT',`도형(${shape.role})이 여백 안에 들어가지 않아요`);
  }
  const {layout,...rest}=built.meta;
  return {width:W,height:H,background:WHITE,shapes:built.shapes,
    paper:Object.freeze({method:plan.method,paper:plan.paper.id,widthMm:W,heightMm:H,marginMm:m,n:phys.n,
      sideMm:plan.sideMm,pitchMm:plan.pitchMm,thicknessMm:plan.thicknessMm,tabMm:plan.tabMm,fileTag:plan.fileTag,layout,...rest})};
}

/*
 * Plan (paperPlan, 얼린 객체)
 *   kind 'paper-plan' · method 'sheet'|'skin'|'board' · paper (PAPER_SIZES 항목) · n · auto(한 변 자동 최대 여부)
 *   widthMm·heightMm (용지) · marginMm 7 · bandMm (8 | 20) · gapMm (board 6)
 *   µm 정수: thicknessUm · sideUm (바깥 한 변 s: sheet = p + t · skin = 코어 · board = 조각) · pitchUm (인쇄되는 면 한 변:
 *     sheet p = s − t · skin p = s + 0.1 · board s) · tabUm (sheet 날개 폭, 그 밖 0) · skinUm (skin 100)
 *   mm 실수: thicknessMm · sideMm · pitchMm · moduleMm (= pitch / n) · tabMm · cutBandMm (board 절단면 띠 = t)
 *   core (skin): [{id:'A'|'B'|'C', count:2, wUm, hUm}] — A s×s · B s×(s−2t) · C (s−2t)²
 *   pieces (board): [{face, number 1–6, piece:'A'|'B'|'C', wUm, hUm}] — 번호순, 물리 z 쌍 A · x 쌍 B · y 쌍 C
 *   warnings: ['TLP_WARN_MODULE_SMALL' (모듈 < 1.2 mm) | 'TLP_WARN_BOARD_EDGE' (board t > 0.4 × 모듈 — 절단면을 흰색으로 칠하라는 안내)]
 *   fileTag: '{method}-{paper.id}-s{sideUm}um-t{thicknessUm}um' (파일명 접미사용)
 *
 * scene.paper (buildPaperSheet 메타데이터)
 *   method · paper(id) · widthMm · heightMm · marginMm · n · sideMm · pitchMm · thicknessMm · tabMm · fileTag · layout (NetLayout)
 *   faces: {면: {face, blank, cellMm, corner:[x,y], di:[x,y], dj:[x,y], rect, visible, crop, (board) number·piece}}
 *     — 시트 (i,j) 의 종이 점 = corner + i·di + j·dj (mm). rect 는 면 전체 정사각형, visible 은 인쇄된 영역(board 는 잘린 조각).
 *   (sheet·skin) tabs · folds · cuts · ticks — 종이 mm. tabs[k] = {cut, face, partner, a, b, outward, base, polygon, outside}
 *   (board) map — 조립 지도 칸 · labels — 글리프 라벨 {id, text, x, y, h, width} · band — 하단 띠 {x0,x1,y0,y1,barStart,barEnd}
 *   도형(shapes[k]) 은 role 을 달아요: module · image · cut · fold · tick · glyph · bar · map. 글리프는 group(라벨 id)도 달아요.
 *   board 의 cut 은 조각마다 재단 표시 8개(face, mark:'x'|'y' = 연장하는 가장자리 축)예요.
 */
