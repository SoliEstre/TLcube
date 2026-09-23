/**
 * 3D 인쇄 파트 메쉬(print-mesh.js)를 «산출물 그대로» 재는 자들이에요.
 *   - partLocator: 점이 어느 파트 안에 있는지 반직선 홀짝으로 재요(재질 규칙을 다시 부르지 않아요).
 *   - exactSixVolume: µm 정수 좌표 메쉬의 6·부피를 BigInt 로 정확히 재요.
 *   - surfaceComponents: 삼각형이 정점을 공유하는 연결 성분 수(밀폐 공동이면 2 이상).
 *   - fixture: 위상 자를 빨갛게 만드는 심은 결함 메쉬.
 * 좌표 단위는 메쉬와 같은 mm 예요. 탐침 점에는 격자 평면·쿼드 대각선에 걸리지 않게 무리수 꼴 오프셋을 더해요.
 */
import {orientForBed} from '../../src/cube-physical.js';

export const PROBE_OFFSET_MM=Object.freeze([0.3183e-3,0.1591e-3,0.2718e-3]);

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const vertex=(mesh,i)=>[mesh.positions[3*i],mesh.positions[3*i+1],mesh.positions[3*i+2]];

/** 파트마다 z 축 반직선용 2D 버킷(1 mm)을 만들어요. z 에 평행한 삼각형(수직 벽)은 반직선과 만나지 않아 빼요. */
function zIndex(mesh,bucketMm=1){
  const buckets=new Map(),tris=[];
  const T=mesh.indices.length/3;
  for(let t=0;t<T;t++){
    const a=vertex(mesh,mesh.indices[3*t]),b=vertex(mesh,mesh.indices[3*t+1]),c=vertex(mesh,mesh.indices[3*t+2]);
    const nz=cross(sub(b,a),sub(c,a))[2];
    if(Math.abs(nz)<1e-15)continue;
    const id=tris.length;tris.push([a,b,c]);
    const x0=Math.floor(Math.min(a[0],b[0],c[0])/bucketMm),x1=Math.floor(Math.max(a[0],b[0],c[0])/bucketMm);
    const y0=Math.floor(Math.min(a[1],b[1],c[1])/bucketMm),y1=Math.floor(Math.max(a[1],b[1],c[1])/bucketMm);
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const k=`${x},${y}`;let list=buckets.get(k);if(!list)buckets.set(k,list=[]);list.push(id);}
  }
  return {buckets,tris,bucketMm};
}
/** 점 p 에서 +z 로 쏜 반직선이 메쉬를 몇 번 지나는지. 모서리에 정확히 걸리면(자의 모호함) 던져요. */
function zCrossings(index,p){
  const list=index.buckets.get(`${Math.floor(p[0]/index.bucketMm)},${Math.floor(p[1]/index.bucketMm)}`)??[];
  let count=0;
  for(const id of list){
    const [a,b,c]=index.tris[id];
    const e=(u,v)=>(v[0]-u[0])*(p[1]-u[1])-(v[1]-u[1])*(p[0]-u[0]);
    const s=[e(a,b),e(b,c),e(c,a)],pos=s.filter(v=>v>0).length,neg=s.filter(v=>v<0).length;
    if(pos===3||neg===3){
      const n=cross(sub(b,a),sub(c,a));
      const z=a[2]-(n[0]*(p[0]-a[0])+n[1]*(p[1]-a[1]))/n[2];
      if(z>p[2])count++;
    }else if(pos+neg<3&&(pos===0||neg===0)){
      throw new Error(`탐침 반직선이 삼각형 모서리에 걸렸어요: ${p}`);
    }
  }
  return count;
}

/**
 * 파트 목록에 대한 위치 판정기예요. at(pUm) → 그 점을 품은 파트 목록(보통 0개 또는 1개).
 * pUm 은 인쇄 방향 틀의 µm 좌표이고, 오프셋을 더한 뒤 mm 로 바꿔 재요.
 */
export function partLocator(parts){
  const indices=parts.map(part=>zIndex(part.mesh));
  const at=pUm=>{
    const p=pUm.map((v,k)=>v/1000+PROBE_OFFSET_MM[k]);
    return parts.filter((part,k)=>zCrossings(indices[k],p)%2===1);
  };
  return {at,hexAt:pUm=>at(pUm).map(part=>part.hex)};
}

/** µm 정수 좌표 메쉬의 6·부피(µm³, BigInt). 좌표가 정수가 아니면 던져요(ε > 0 메쉬에는 쓰지 않아요). */
export function exactSixVolume(mesh){
  const p=mesh.positions,ix=mesh.indices;
  const um=new Array(p.length);
  for(let k=0;k<p.length;k++){
    const v=p[k]*1000,r=Math.round(v);
    if(Math.abs(v-r)>1e-6)throw new Error(`µm 정수 좌표가 아니에요: ${v}`);
    um[k]=BigInt(r);
  }
  let six=0n;
  for(let t=0;t<ix.length;t+=3){
    const a=3*ix[t],b=3*ix[t+1],c=3*ix[t+2];
    six+=um[a]*(um[b+1]*um[c+2]-um[b+2]*um[c+1])+um[a+1]*(um[b+2]*um[c]-um[b]*um[c+2])+um[a+2]*(um[b]*um[c+1]-um[b+1]*um[c]);
  }
  return six;
}

/** 삼각형이 정점 인덱스를 공유하면 같은 성분이에요. 밀폐 공동은 바깥 표면과 따로 떨어진 성분이 돼요. */
export function surfaceComponents(mesh){
  const V=mesh.positions.length/3,parent=Int32Array.from({length:V},(_,k)=>k);
  const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  const used=new Uint8Array(V);
  for(let t=0;t<mesh.indices.length;t+=3){
    const a=mesh.indices[t],b=mesh.indices[t+1],c=mesh.indices[t+2];
    used[a]=used[b]=used[c]=1;parent[find(a)]=find(b);parent[find(b)]=find(c);
  }
  const roots=new Set();for(let v=0;v<V;v++)if(used[v])roots.add(find(v));
  return roots.size;
}

export const triangleArea=(mesh,t)=>{
  const a=vertex(mesh,mesh.indices[3*t]),b=vertex(mesh,mesh.indices[3*t+1]),c=vertex(mesh,mesh.indices[3*t+2]);
  return Math.hypot(...cross(sub(b,a),sub(c,a)))/2;
};
export const triangleNormal=(mesh,t)=>{
  const a=vertex(mesh,mesh.indices[3*t]),b=vertex(mesh,mesh.indices[3*t+1]),c=vertex(mesh,mesh.indices[3*t+2]);
  const n=cross(sub(b,a),sub(c,a)),len=Math.hypot(...n);
  return n.map(v=>v/len);
};
export const triangleVertices=(mesh,t)=>[0,1,2].map(k=>vertex(mesh,mesh.indices[3*t+k]));

/** 보고서의 바닥면으로 다시 돌린 PhysCube(인쇄 방향 틀). 모듈 위치를 메쉬 좌표로 옮길 때 써요. */
export const orientedPhys=(phys,report)=>orientForBed(phys,{bedFace:report.bedFace}).phys;

/** 면 f 의 모듈 (i,j) 중심에서 바깥 법선 반대로 depthUm 들어간 점(µm). */
export function modulePoint(phys,face,i,j,depthUm){
  const f=phys.faces[face],c=phys.cellUm;
  return [0,1,2].map(k=>(f.origin[k]+(i+0.5)*f.di[k]+(j+0.5)*f.dj[k])*c-f.normal[k]*depthUm);
}

/* ───────────── 위상 자의 심은 결함 fixture ───────────── */

/** 바깥 법선으로 감긴 단위 정육면체(정점 8, 삼각형 12)예요. */
export function unitCube(offset=[0,0,0]){
  const positions=[];
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)positions.push(x+offset[0],y+offset[1],z+offset[2]);
  const v=(x,y,z)=>x+2*y+4*z;
  const quads=[
    [v(0,0,0),v(0,1,0),v(1,1,0),v(1,0,0)],[v(0,0,1),v(1,0,1),v(1,1,1),v(0,1,1)],
    [v(0,0,0),v(1,0,0),v(1,0,1),v(0,0,1)],[v(0,1,0),v(0,1,1),v(1,1,1),v(1,1,0)],
    [v(0,0,0),v(0,0,1),v(0,1,1),v(0,1,0)],[v(1,0,0),v(1,1,0),v(1,1,1),v(1,0,1)],
  ];
  const indices=quads.flatMap(([a,b,c,d])=>[a,b,c,a,c,d]);
  return {positions,indices};
}
const asMesh=({positions,indices})=>({positions:Float64Array.from(positions),indices:Uint32Array.from(indices)});
export const fixtures={
  good:()=>asMesh(unitCube()),
  hole:()=>{const m=unitCube();return asMesh({positions:m.positions,indices:m.indices.slice(0,-3)});},
  flipped:()=>{const m=unitCube(),ix=m.indices.slice();[ix[1],ix[2]]=[ix[2],ix[1]];return asMesh({positions:m.positions,indices:ix});},
  inverted:()=>{const m=unitCube(),ix=m.indices.slice();for(let t=0;t<ix.length;t+=3)[ix[t+1],ix[t+2]]=[ix[t+2],ix[t+1]];return asMesh({positions:m.positions,indices:ix});},
  /** 두 정육면체가 모서리 하나(x=1, y=1)만 공유 — 그 엣지를 삼각형 4개가 써요. */
  pinch:()=>{
    const a=unitCube(),b=unitCube([1,1,0]);
    const positions=[...a.positions],remap=[];
    for(let k=0;k<8;k++){
      const p=b.positions.slice(3*k,3*k+3),same=[0,1,2,3,4,5,6,7].find(q=>a.positions.slice(3*q,3*q+3).every((v,d)=>v===p[d]));
      if(same!==undefined)remap.push(same);else{remap.push(positions.length/3);positions.push(...p);}
    }
    return asMesh({positions,indices:[...a.indices,...b.indices.map(i=>remap[i])]});
  },
  /** 한쪽 삼각형만 엣지 중점을 넣어 둘로 쪼갠 T-정션이에요. */
  tJunction:()=>{
    const m=unitCube(),ix=m.indices.slice(),positions=m.positions.slice();
    // 삼각형 0 = (a,b,c) 의 엣지 (a,b) 를 반대로 쓰는 삼각형을 찾아 중점 m 으로 쪼개요.
    const [a,b]=[ix[0],ix[1]];
    let t=-1;for(let k=3;k<ix.length;k+=3){const tri=ix.slice(k,k+3);for(let e=0;e<3;e++)if(tri[e]===b&&tri[(e+1)%3]===a)t=k;}
    const tri=ix.slice(t,t+3),e=tri.findIndex((v,k)=>v===b&&tri[(k+1)%3]===a),d=tri[(e+2)%3];
    const mid=positions.length/3;positions.push(...[0,1,2].map(k=>(positions[3*a+k]+positions[3*b+k])/2));
    ix.splice(t,3,b,mid,d,mid,a,d);
    return asMesh({positions,indices:ix});
  },
  /** 인덱스 중복 삼각형 하나를 덧붙여요. */
  degenerate:()=>{const m=unitCube();return asMesh({positions:m.positions,indices:[...m.indices,0,0,1]});},
  /** 공선 세 점 삼각형 한 쌍(엣지는 서로 상쇄)을 덧붙여요 — 면적 0 만 걸려야 해요. */
  collinear:()=>{
    const m=unitCube(),base=m.positions.length/3;
    return asMesh({positions:[...m.positions,5,0,0,6,0,0,7,0,0],indices:[...m.indices,base,base+1,base+2,base,base+2,base+1]});
  },
  /** 바깥 정육면체 안에 뒤집힌 작은 정육면체(밀폐 공동) — 연결 성분이 2 개예요. */
  sealed:()=>{
    const outer=unitCube(),inner=unitCube();
    const positions=[...outer.positions.map(v=>v*4),...inner.positions.map(v=>1+v*2)];
    const innerIx=[];for(let t=0;t<inner.indices.length;t+=3)innerIx.push(8+inner.indices[t],8+inner.indices[t+2],8+inner.indices[t+1]);
    return asMesh({positions,indices:[...outer.indices,...innerIx]});
  },
};
