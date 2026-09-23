/**
 * 타입 H 큐브 모델(buildHCubeModel)을 오른손 «물리 좌표»로 옮겨요. 3D 인쇄·종이공작 산출물의 공통 입력이에요.
 *
 * 왜 따로 두나(설계 §2.1): 2.5D 화면 기저(h-render.js RIGHT·DOWN)는 RIGHT×DOWN 이 시선의 반대라서
 * 모델 좌표를 그대로 오른손 공간(3MF·STL·접은 종이)에 두면 여섯 면이 모두 정본 면 시트의 거울상이 돼요.
 * H 검출기는 거울 면을 거부하므로, 물리 산출물은 모델 좌표에 반사 S 를 한 번 걸어 만들어요.
 * S 는 이 파일의 상수 하나(PHYSICAL_SWAP)이고, 결정 근거는 S 와 무관한 고정 카메라 판독 왕복 테스트예요.
 *
 * 면 틀은 손 표가 아니라 모델 쿼드의 꼭짓점에서 유도해요. 모델 좌표가 바뀌면 틀도 따라 바뀌고,
 * faceHandedness 가 그 변화를 드러내요.
 */
import {H_FACE_IDS} from './h-profile.js';

const freezeMatrix=m=>Object.freeze(m.map(row=>Object.freeze(row.slice())));
/** 모델 → 물리 반사. S(x,y,z) = (y,x,z). det = −1 이라 면 시트의 손잡이를 뒤집어요. */
export const PHYSICAL_SWAP=freezeMatrix([[0,1,0],[1,0,0],[0,0,1]]);
/** 인쇄 바닥면 후보 순서(모델 면 이름). 2.5D 에서 보이지 않는 꼭짓점 (L,L,L)의 세 면이 먼저예요(설계 §2.3.6). */
export const BED_FACE_ORDER=Object.freeze(['ZP','XP','YP','ZM','XM','YM']);
export const DEFAULT_CELL_UM=2000;
/** 3D 인쇄 셀 하한·단위(µm, 설계 §2.5). 단위 0.2 mm 와 홀수 n 이면 L·L/2 가 모두 µm 정수예요. */
export const PRINT_CELL_MIN_UM=800;
export const PRINT_CELL_STEP_UM=200;
const MAX_N=64,AXIS_NAMES='xyz';
const IDENTITY=freezeMatrix([[1,0,0],[0,1,0],[0,0,1]]);

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const mulMV=(m,v)=>[0,1,2].map(r=>m[r][0]*v[0]+m[r][1]*v[1]+m[r][2]*v[2]);
const mulMM=(a,b)=>[0,1,2].map(r=>[0,1,2].map(c=>a[r][0]*b[0][c]+a[r][1]*b[1][c]+a[r][2]*b[2][c]));
const det3=m=>dot(m[0],cross(m[1],m[2]));
const isUnitAxis=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isInteger)&&v.reduce((s,x)=>s+Math.abs(x),0)===1;
const hex2=v=>v.toString(16).padStart(2,'0');

function tlpError(code,message){const error=new RangeError(message);error.code=code;return error;}

function checkCellUm(cellUm){
  if(typeof cellUm!=='number'||!Number.isFinite(cellUm))throw new TypeError('셀 크기(µm)는 유한한 수여야 해요');
  if(cellUm<PRINT_CELL_MIN_UM)throw tlpError('TLP_CELL_MIN',`셀 크기는 ${PRINT_CELL_MIN_UM} µm 이상이어야 해요`);
  if(!Number.isSafeInteger(cellUm)||cellUm%PRINT_CELL_STEP_UM!==0)throw tlpError('TLP_CELL_STEP',`셀 크기는 ${PRINT_CELL_STEP_UM} µm 단위여야 해요`);
  return cellUm;
}
/** 부호 있는 치환 행렬(성분 −1·0·1, 행·열마다 0 아닌 성분 1개)만 받아요. 격자를 격자로 보내요. */
function checkSignedPermutation(m,name){
  if(!Array.isArray(m)||m.length!==3||m.some(row=>!Array.isArray(row)||row.length!==3||row.some(x=>x!==-1&&x!==0&&x!==1)))
    throw new TypeError(`${name}: 3×3 정수 행렬이어야 해요`);
  for(let k=0;k<3;k++){
    if(m[k].filter(x=>x!==0).length!==1||m.filter(row=>row[k]!==0).length!==1)throw new RangeError(`${name}: 부호 있는 치환 행렬이어야 해요`);
  }
  return m;
}
/** 부호 있는 치환 M 이 [0,n]³ 을 [0,n]³ 으로 보내도록 더할 평행이동이에요(−1 이 있는 행만 n). */
const cubeOffset=(m,n)=>m.map(row=>row.some(x=>x<0)?n:0);

function checkColor(color){
  if(!color||![color.r,color.g,color.b].every(v=>Number.isInteger(v)&&v>=0&&v<=255))throw new TypeError('쿼드 색은 0..255 정수 RGB 여야 해요');
  return Object.freeze({r:color.r,g:color.g,b:color.b});
}
function checkCorners(corners){
  if(!Array.isArray(corners)||corners.length!==4||corners.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isInteger)))
    throw new TypeError('H 쿼드 꼭짓점은 정수 좌표 4개여야 해요');
  return corners;
}
const centerOf=corners=>scale(corners.reduce((s,p)=>add(s,p),[0,0,0]),1/4);
/**
 * 쿼드 꼭짓점 4개가 셀 {p, p+b, p+a+b, p+a} 와 순서 무관하게 같은 집합인지 재요. 문자열 키를 만들지 않고 정수로 비교해요 —
 * H 렌더마다 도는 상태 줄 계산에서 이 검사가 가장 무거웠어요(H8 6F 약 1.2만 쿼드).
 */
function cornersMatchCell(corners,p,a,b){
  let seen=0;
  for(const c of corners){
    const d0=c[0]-p[0],d1=c[1]-p[1],d2=c[2]-p[2];
    const bit=d0===0&&d1===0&&d2===0?1
      :d0===b[0]&&d1===b[1]&&d2===b[2]?2
      :d0===a[0]+b[0]&&d1===a[1]+b[1]&&d2===a[2]+b[2]?4
      :d0===a[0]&&d1===a[1]&&d2===a[2]?8:0;
    if(!bit||seen&bit)return false;
    seen|=bit;
  }
  return seen===15;
}

/** 모델 쿼드에서 면마다 시트 틀(원점 O, 행 방향 a, 열 방향 b)과 바깥 법선을 유도하고, 모든 쿼드가 그 격자와 맞는지 확인해요. */
function modelSheets(model){
  if(!model||typeof model!=='object')throw new TypeError('H 큐브 모델이 필요해요');
  if(model.kind!=='H')throw new RangeError('타입 H 큐브 모델만 물리 좌표로 옮겨요');
  const n=model.n;
  if(!Number.isInteger(n)||n<2||n>MAX_N)throw new RangeError('H 큐브 한 변 셀 수');
  if(!Array.isArray(model.quads)||model.quads.length!==6*n*n)throw new RangeError('H 큐브 쿼드 수는 6·n² 이어야 해요');
  const cells=new Map(H_FACE_IDS.map(face=>[face,new Array(n*n)]));
  for(const q of model.quads){
    const grid=cells.get(q?.face);
    if(!grid)throw new RangeError('H 큐브 면 이름');
    if(!Number.isInteger(q.i)||!Number.isInteger(q.j)||q.i<0||q.j<0||q.i>=n||q.j>=n)throw new RangeError('H 쿼드 셀 번호');
    if(q.kind!=='module'&&q.kind!=='back')throw new RangeError('H 쿼드 종류는 module·back 이어야 해요');
    if(grid[q.i*n+q.j])throw new RangeError('H 쿼드 셀 중복');
    grid[q.i*n+q.j]=q;
  }
  const sheets={};
  for(const face of H_FACE_IDS){
    const grid=cells.get(face);
    if(grid.some(q=>!q))throw new RangeError('H 면 격자에 빈 셀이 있어요');
    const blank=grid[0].kind==='back';
    if(grid.some(q=>(q.kind==='back')!==blank))throw new RangeError('H 면 하나에 module·back 이 섞였어요');
    const c00=centerOf(checkCorners(grid[0].corners)),a=sub(centerOf(checkCorners(grid[n].corners)),c00),b=sub(centerOf(checkCorners(grid[1].corners)),c00);
    if(!isUnitAxis(a)||!isUnitAxis(b)||dot(a,b)!==0)throw new RangeError('H 면 격자가 축 정렬 단위 셀이 아니에요');
    const origin=sub(c00,scale(add(a,b),1/2)),axis=[0,1,2].find(k=>a[k]===0&&b[k]===0),plane=origin[axis];
    if(plane!==0&&plane!==n)throw new RangeError('H 면이 큐브 표면 밖이에요');
    const normal=[0,0,0];normal[axis]=plane===n?1:-1;
    const hex=new Array(n*n),colors=new Array(n*n);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const q=grid[i*n+j],p=add(origin,add(scale(a,i),scale(b,j)));
      if(!cornersMatchCell(checkCorners(q.corners),p,a,b))throw new RangeError('H 쿼드 꼭짓점이 면 격자와 맞지 않아요');
      const color=checkColor(q.color);
      colors[i*n+j]=color;hex[i*n+j]=`#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
    }
    sheets[face]={face,blank,origin,di:a,dj:b,normal,hex:Object.freeze(hex),colors:Object.freeze(colors),image:null};
  }
  for(const placement of model.images??[]){
    const sheet=sheets[placement?.face];
    if(!sheet||!sheet.blank||sheet.image)throw new RangeError('면 이미지는 빈 면마다 하나까지예요');
    const {x,y,width,height}=placement;
    if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>n+1e-9||y+height>n+1e-9)throw new RangeError('면 이미지 범위');
    // 면 이미지는 시트 틀(x = 열 j 방향, y = 행 i 방향)에 놓여요. 모델 꼭짓점이 그 틀과 맞는지 확인해요.
    const expected=[[y,x],[y,x+width],[y+height,x+width],[y+height,x]].map(([i,j])=>add(sheet.origin,add(scale(sheet.di,i),scale(sheet.dj,j))));
    if(!Array.isArray(placement.corners)||placement.corners.length!==4
      ||placement.corners.some((p,k)=>!Array.isArray(p)||p.length!==3||p.some((v,d)=>!(Math.abs(v-expected[k][d])<=1e-9))))
      throw new RangeError('면 이미지 꼭짓점이 면 시트 틀과 맞지 않아요');
    sheet.image=Object.freeze({image:placement.image,x,y,width,height,sourceFace:placement.sourceFace??placement.face,
      ...(placement.background?{background:checkColor(placement.background)}:{})});
  }
  return {n,sheets};
}

const freezeVec=v=>Object.freeze(v.slice());
function physFace(sheet,{matrix,offset,n}){
  const normal=mulMV(matrix,sheet.normal),axis=normal.findIndex(v=>v!==0),side=normal[axis]>0?1:0;
  const origin=add(mulMV(matrix,sheet.origin),offset);
  if(origin[axis]!==side*n)throw new RangeError('물리 면 평면 불일치');
  return Object.freeze({face:sheet.face,blank:sheet.blank,axis,side,plane:`${side?'+':'-'}${AXIS_NAMES[axis]}`,
    normal:freezeVec(normal),origin:freezeVec(origin),di:freezeVec(mulMV(matrix,sheet.di)),dj:freezeVec(mulMV(matrix,sheet.dj)),
    hex:sheet.hex,colors:sheet.colors,image:sheet.image});
}
function assemble({n,cellUm,matrix,offset,faces,logicalDataFaces,orientation}){
  const byPlane={};
  for(const face of H_FACE_IDS){
    if(byPlane[faces[face].plane])throw new RangeError('물리 면 두 개가 같은 평면에 있어요');
    byPlane[faces[face].plane]=face;
  }
  const blankFaces=H_FACE_IDS.filter(face=>faces[face].blank),dataFaces=H_FACE_IDS.filter(face=>!faces[face].blank);
  return Object.freeze({kind:'H-physical',n,cellUm,sideUm:n*cellUm,
    matrix:freezeMatrix(matrix),offsetCells:freezeVec(offset),
    faces:Object.freeze(Object.fromEntries(H_FACE_IDS.map(face=>[face,faces[face]]))),
    byPlane:Object.freeze(byPlane),dataFaces:Object.freeze(dataFaces),blankFaces:Object.freeze(blankFaces),
    logicalDataFaces:Object.freeze(logicalDataFaces.slice()),
    blankHex:blankFaces.length?faces[blankFaces[0]].hex[0]:null,
    orientation});
}

/**
 * 모델(buildHCubeModel 결과)을 물리 큐브로 옮겨요. 모델을 변이하지 않아요.
 * @param {object} model buildHCubeModel / generatorCubeModel(H) 반환값
 * @param {{cellUm?:number, swap?:number[][]}} [options] cellUm: 한 셀 µm(800 이상, 200 단위, 기본 2000).
 *   swap: 모델→물리 부호 있는 치환(기본 PHYSICAL_SWAP). 대조군·검증 전용이고 제품 경로는 생략해요.
 * @returns PhysCube — 구조는 파일 끝 주석을 봐요.
 */
export function physicalHCube(model,{cellUm=DEFAULT_CELL_UM,swap=PHYSICAL_SWAP}={}){
  checkCellUm(cellUm);
  const matrix=checkSignedPermutation(swap,'물리 좌표 교환'),{n,sheets}=modelSheets(model),offset=cubeOffset(matrix,n);
  if(!Number.isSafeInteger(n*cellUm))throw new RangeError('한 변 µm 가 너무 커요');
  const faces=Object.fromEntries(H_FACE_IDS.map(face=>[face,physFace(sheets[face],{matrix,offset,n})]));
  const logical=Array.isArray(model.dataFaces)?model.dataFaces:[];
  if(logical.some(face=>!H_FACE_IDS.includes(face)))throw new RangeError('논리 데이터 면 이름');
  return assemble({n,cellUm,matrix,offset,faces,logicalDataFaces:logical,orientation:null});
}

function checkPhys(phys){
  if(!phys||phys.kind!=='H-physical'||!Number.isInteger(phys.n)||!(Number.isSafeInteger(phys.cellUm)&&phys.cellUm>0)||!phys.faces)throw new TypeError('PhysCube 가 필요해요');
  for(const face of H_FACE_IDS){
    const f=phys.faces[face];
    if(!f||![f.normal,f.di,f.dj].every(isUnitAxis)||!Array.isArray(f.origin)||f.origin.length!==3||!f.origin.every(Number.isInteger))
      throw new TypeError(`PhysCube 면 ${face} 형식`);
  }
  return phys;
}

/**
 * 면마다 sign(cross(di, dj) · 바깥 법선) 이에요. +1 이면 오른손 공간에서 바깥에서 본 면이 정본 면 시트와 같고(거울 아님),
 * −1 이면 거울상이에요. 설계 규약식을 다시 재는 싼 불변식이고, 거울 여부의 수호자는 판독 왕복 테스트예요.
 * @returns {Map<string, 1|-1>} H_FACE_IDS 순서
 */
export function faceHandedness(phys){
  checkPhys(phys);
  return new Map(H_FACE_IDS.map(face=>{
    const f=phys.faces[face],s=dot(cross(f.di,f.dj),f.normal);
    if(s!==1&&s!==-1)throw new RangeError(`PhysCube 면 ${face} 틀이 퇴화했어요`);
    return [face,s];
  }));
}

/** 정수 단위 축벡터 a 를 b 로 보내는 가장 작은 진회전(det +1)이에요. 손 표 없이 로드리게스 식으로 만들어요. */
function rotationTaking(a,b){
  const d=dot(a,b);
  if(d===1)return IDENTITY.map(row=>row.slice());
  if(d===-1){
    // 180°: a 에 수직인 첫 좌표축 e 둘레, Q = 2eeᵀ − I.
    const e=IDENTITY.find(u=>dot(u,a)===0);
    return [0,1,2].map(r=>[0,1,2].map(c=>2*e[r]*e[c]-(r===c?1:0)));
  }
  // 90°: k = a×b 둘레, Q = [k]× + kkᵀ.
  const k=cross(a,b);
  return [[k[0]*k[0],k[0]*k[1]-k[2],k[0]*k[2]+k[1]],[k[1]*k[0]+k[2],k[1]*k[1],k[1]*k[2]-k[0]],[k[2]*k[0]-k[1],k[2]*k[1]+k[0],k[2]*k[2]]];
}

/**
 * 인쇄 방향을 정해요. 바닥면 = BED_FACE_ORDER 에서 첫 빈 면(없으면 첫 후보). 그 면의 바깥 법선을 (0,0,−1)로 보내는
 * 가장 작은 진회전 Q(정수 행렬, det +1)와 큐브를 [0,L]³ 에 되돌리는 평행이동을 걸어요.
 * @param {object} phys PhysCube
 * @param {{bedFace?:string}} [options] bedFace: 규칙 대신 쓸 바닥면(모델 면 이름). 생략이 기본이에요.
 * @returns {{phys:object, rotation:number[][], translationUm:number[], bedFace:string}}
 *   p' = rotation·p + translationUm (물리 µm). phys.orientation 에 원래 물리 틀 기준 누적 회전이 남아요.
 */
export function orientForBed(phys,{bedFace}={}){
  checkPhys(phys);
  const bed=bedFace??BED_FACE_ORDER.find(face=>phys.faces[face].blank)??BED_FACE_ORDER[0];
  if(!H_FACE_IDS.includes(bed))throw new RangeError('바닥면 이름');
  const n=phys.n,rotation=rotationTaking(phys.faces[bed].normal,[0,0,-1]),shift=cubeOffset(rotation,n);
  if(det3(rotation)!==1)throw new RangeError('인쇄 방향 회전은 진회전이어야 해요');
  const move=v=>add(mulMV(rotation,v),shift);
  const faces=Object.fromEntries(H_FACE_IDS.map(face=>{
    const f=phys.faces[face],normal=mulMV(rotation,f.normal),axis=normal.findIndex(v=>v!==0),side=normal[axis]>0?1:0;
    return [face,Object.freeze({...f,axis,side,plane:`${side?'+':'-'}${AXIS_NAMES[axis]}`,normal:freezeVec(normal),
      origin:freezeVec(move(f.origin)),di:freezeVec(mulMV(rotation,f.di)),dj:freezeVec(mulMV(rotation,f.dj))})];
  }));
  const translationUm=shift.map(v=>v*phys.cellUm),prior=phys.orientation;
  const total=prior?mulMM(rotation,prior.rotation):rotation;
  const totalShift=prior?add(mulMV(rotation,prior.translationUm),translationUm):translationUm;
  const orientation=Object.freeze({bedFace:bed,rotation:freezeMatrix(total),translationUm:freezeVec(totalShift)});
  const out=assemble({n,cellUm:phys.cellUm,matrix:mulMM(rotation,phys.matrix),offset:move(phys.offsetCells),faces,
    logicalDataFaces:phys.logicalDataFaces,orientation});
  if(out.faces[bed].plane!=='-z')throw new RangeError('바닥면이 z=0 에 오지 않았어요');
  return {phys:out,rotation:freezeMatrix(rotation),translationUm:Object.freeze(translationUm),bedFace:bed};
}

/*
 * PhysCube (얼린 객체)
 *   kind: 'H-physical'
 *   n: 한 변 셀 수 · cellUm: 셀 한 변 µm · sideUm: n·cellUm
 *   matrix, offsetCells: 모델 좌표 p(셀 단위) → 물리 셀 좌표 q = matrix·p + offsetCells. 물리 µm = cellUm·q
 *   faces: {ZM, XM, YM, ZP, XP, YP} — 키는 모델 면 이름. 각 면:
 *     face, blank(모델 쿼드 kind 'back'), axis(0=x·1=y·2=z), side(0 → 평면 좌표 0, 1 → 평면 좌표 n),
 *     plane('-x'…'+z', 바깥 법선 방향), normal(정수 단위 바깥 법선),
 *     origin(시트 셀 (0,0)의 모서리, 셀 단위 정수), di(행 i +1 방향), dj(열 j +1 방향),
 *     hex[i*n+j]('#rrggbb'), colors[i*n+j]({r,g,b}), image(빈 면 이미지 | null: {image,x,y,width,height,sourceFace,background?},
 *     셀 단위 시트 틀 — x 는 j 방향, y 는 i 방향)
 *     셀 (i,j) 의 네 꼭짓점 = origin + i·di + j·dj 에서 +dj, +di+dj, +di.
 *   byPlane: {'-x': 면 이름, …} · dataFaces / blankFaces: 모듈 면 / 빈 면(H_FACE_IDS 순서)
 *   logicalDataFaces: model.dataFaces 사본 · blankHex: 빈 면 색(없으면 null)
 *   orientation: null | {bedFace, rotation, translationUm} (orientForBed 누적)
 */
