/**
 * 3D 인쇄 최종 메쉬(buildPrintParts 산출)를 판독 왕복 카메라로 찍는 도우미예요(설계 §6-2 (b), 착지 ②).
 *
 * - 메쉬는 인쇄 방향 틀(바닥면 z = 0)에 있어요. 보고서에 기록된 회전 Q · 평행이동 t 의 역 p = Qᵀ(p′ − t) 로
 *   물리 틀(physicalHCube 산출과 같은 틀)로 되돌려요. Q 가 진회전(det +1)인지는 테스트가 따로 단언해요.
 * - 매립 파트(코어 제외)의 삼각형 중 큐브 경계 평면(좌표 0 또는 L) 위에 놓이고 바깥을 향하는 것만 골라,
 *   그 파트 색으로 칠해요. 면 격자(PhysCube 의 hex)는 읽지 않아요 — 메쉬가 실제로 칠한 색만 봐요.
 * - 카메라는 h-physical-camera.mjs 의 것(숫자 상수 · 면 바깥 법선에서만 만든 틀)을 그대로 써요. S 에서 유도하지 않아요.
 * 좌표 단위: 메쉬는 mm, 장면은 셀 단위(mm / 셀 mm)라 PhysCube 카메라 도우미와 같은 배율로 래스터해요.
 */
import {detectH} from '../../src/h-detect.js';
import {sceneField,forwardOf,dot} from './h-physical-camera.mjs';

const AXES='xyz';
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const hexColor=hex=>({r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)});

/** 3×3 정수 행렬식이에요. */
export const det3=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);

/** 인쇄 방향 틀 좌표(mm) → 물리 틀 좌표(mm). p = Qᵀ(p′ − t), t 는 µm 로 기록돼 있어요. */
export function unorientPositions(positions,{rotation,translationUm}){
  const Q=rotation,t=translationUm.map(v=>v/1000),out=new Float64Array(positions.length);
  for(let k=0;k<positions.length;k+=3){
    const d=[positions[k]-t[0],positions[k+1]-t[1],positions[k+2]-t[2]];
    for(let c=0;c<3;c++)out[k+c]=Q[0][c]*d[0]+Q[1][c]*d[1]+Q[2][c]*d[2];
  }
  return out;
}

/**
 * 최종 메쉬의 바깥 표면이에요. 물리 틀로 되돌린 매립 파트 삼각형 중 경계 평면 위 · 바깥 향 삼각형을 면별로 모아요.
 * @param {object[]} parts buildPrintParts().parts
 * @param {object} report buildPrintParts().report (orientation · sideUm)
 * @param {object} phys buildPrintParts 에 넣은 PhysCube(물리 틀) — 평면 → 면 이름(byPlane)만 읽어요.
 * @returns {{sideMm, cellMm, triangles:{face,hex,points}[], inward:number, bounds:{min:number[],max:number[]}, areaByFace:object}}
 */
export function meshSurface(parts,report,phys,{toleranceMm=1e-9}={}){
  const L=report.sideUm/1000,cellMm=report.cellUm/1000,triangles=[],areaByFace={},min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let inward=0;
  for(const part of parts){
    const p=unorientPositions(part.mesh.positions,report.orientation),ix=part.mesh.indices;
    for(let k=0;k<p.length;k+=3)for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[k+a]);max[a]=Math.max(max[a],p[k+a]);}
    if(part.role==='core')continue;
    for(let t=0;t<ix.length;t+=3){
      const pts=[0,1,2].map(v=>[p[3*ix[t+v]],p[3*ix[t+v]+1],p[3*ix[t+v]+2]]);
      for(let a=0;a<3;a++){
        const side=pts.every(q=>Math.abs(q[a])<=toleranceMm)?0:pts.every(q=>Math.abs(q[a]-L)<=toleranceMm)?1:-1;
        if(side<0)continue;
        const n=cross(sub(pts[1],pts[0]),sub(pts[2],pts[0]));
        if((n[a]>0)!==(side===1)){inward++;break;}
        const face=phys.byPlane[`${side?'+':'-'}${AXES[a]}`];
        triangles.push({face,hex:part.hex,points:pts});
        areaByFace[face]=(areaByFace[face]??0)+Math.hypot(...n)/2;
        break;
      }
    }
  }
  return {sideMm:L,cellMm,triangles,inward,bounds:{min,max},areaByFace};
}

/**
 * 심은 결함: 한 면의 표면 삼각형만 그 면의 열(dj) 방향으로 뒤집은 사본이에요(내용은 그대로, 그 면만 거울상).
 */
export function mirrorSurfaceFace(surface,phys,face){
  const axis=phys.faces[face].dj.findIndex(v=>v!==0),L=surface.sideMm;
  return {...surface,triangles:surface.triangles.map(tri=>tri.face!==face?tri
    :{...tri,points:tri.points.map(q=>q.map((v,a)=>a===axis?L-v:v))})};
}

/**
 * 카메라를 향한(면 법선 · 전방 < 0) 면의 표면 삼각형을 정사영한 scene 이에요. faces 로 그릴 면을 좁혀요.
 * dilate(셀 단위): 래스터라이저는 점 표본을 짝홀로 판정해서, 표본이 두 삼각형의 공유 모서리(셀 대각선 등)에 정확히 놓이면
 * 부동소수 경계 탓에 둘 다 놓칠 수 있어요 — 메쉬에 없는 흰 점선이 셀마다 생겨요. 그래서 삼각형을 무게중심에서 dilate 만큼
 * 키워 그려요. 같은 색 이웃과의 겹침은 무해하고, 다른 색 경계는 dilate(기본 1e-4 셀)만큼만 움직여요. 핀치 분리 틈(ε,
 * 셀 2 mm 에서 약 1e-2 셀)보다 두 자릿수 작아 그 틈은 메우지 않아요.
 */
export function meshViewScene(surface,phys,camera,{faces,margin=3,dilate=1e-4}={}){
  const forward=forwardOf(camera),shapes=[],drawn=new Set(),unit=surface.cellMm;
  const project=q=>({x:dot(q,camera.right)/unit,y:dot(q,camera.down)/unit});
  for(const tri of surface.triangles){
    if(faces&&!faces.includes(tri.face))continue;
    if(!(dot(phys.faces[tri.face].normal,forward)<-1e-9))continue;
    drawn.add(tri.face);
    const points=tri.points.map(project),cx=(points[0].x+points[1].x+points[2].x)/3,cy=(points[0].y+points[1].y+points[2].y)/3;
    if(dilate>0)for(const p of points){
      const dx=p.x-cx,dy=p.y-cy,len=Math.hypot(dx,dy);
      if(len>0){p.x+=dx/len*dilate;p.y+=dy/len*dilate;}
    }
    shapes.push({kind:'polygon',color:hexColor(tri.hex),points});
  }
  const order=Object.keys(phys.faces).filter(face=>drawn.has(face));
  if(!shapes.length)return {width:1,height:1,background:{r:255,g:255,b:255},shapes,drawn:order};
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const s of shapes)for(const q of s.points){x0=Math.min(x0,q.x);y0=Math.min(y0,q.y);x1=Math.max(x1,q.x);y1=Math.max(y1,q.y);}
  x0-=margin;y0-=margin;
  for(const s of shapes)for(const q of s.points){q.x-=x0;q.y-=y0;}
  return {width:x1-x0+margin,height:y1-y0+margin,background:{r:255,g:255,b:255},shapes,drawn:order};
}

/** 카메라 한 대로 최종 메쉬 표면을 렌더해 H 검출기에 넣어요. */
export function detectMeshView(surface,phys,camera,{faces,pixelsPerUnit=12,margin=3,dilate}={}){
  const scene=meshViewScene(surface,phys,camera,{faces,margin,dilate});
  if(!scene.shapes.length)return {drawn:[],faces:[],stats:null};
  const found=detectH(sceneField(scene,pixelsPerUnit));
  return {drawn:scene.drawn,faces:found.faces,stats:found.stats,rejected:found.rejected};
}
