/**
 * 물리 큐브(PhysCube) 판독 왕복용 카메라·래스터 도우미예요.
 *
 * 카메라는 물리 좌표 교환 S 에서 유도하지 않아요(설계 §2.1). S 에서 유도하면 (S·RIGHT)·(S·p) = RIGHT·p 라서
 * S 가 무엇이든 2.5D 와 같은 그림이 나와 대조군이 성립하지 않아요. 그래서 둘 중 하나만 써요.
 *   - 등각 카메라: 숫자 상수. 오른손(R×D = 전방 F)인지는 테스트가 따로 단언해요.
 *   - 면별 카메라: 그 면의 바깥 법선에서만 만든 오른손 틀(F = −n, R ⊥ F, D = F×R).
 * 투영은 정사영 (p·R, p·D) 이고, 이미지 좌표는 x 오른쪽 · y 아래예요.
 */
import {rasterize} from '../../src/raster.js';
import {relativeLuminance8} from '../../src/luminance.js';
import {detectH} from '../../src/h-detect.js';

export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

const R2=Math.SQRT1_2,R6=1/Math.sqrt(6);
/** 정본 시점 꼭짓점(0,0,0) 쪽에서 큐브를 보는 고정 오른손 카메라예요. 설계 §2.1 의 상수 그대로예요. */
export const ISO_FRONT=Object.freeze({name:'iso-front',right:Object.freeze([-R2,R2,0]),down:Object.freeze([-R6,-R6,2*R6])});
/** 반대 꼭짓점(L,L,L) 쪽에서 보는 고정 오른손 카메라예요. 6면·반대면 복제 모드의 나머지 세 면을 봐요. */
export const ISO_BACK=Object.freeze({name:'iso-back',right:Object.freeze([R2,-R2,0]),down:Object.freeze([-R6,-R6,2*R6])});

/** 카메라 전방 = R×D (오른손 카메라 규약: x 오른쪽, y 아래, z 앞). */
export const forwardOf=camera=>cross(camera.right,camera.down);

/**
 * 한 면의 바깥 법선만으로 만든 오른손 카메라 4개(R 을 면 안 축 네 방향으로 돌린 것)예요.
 * 복호기는 회전 4종을 받으므로 네 카메라 모두 읽혀야 하고, 이 틀은 (i,j) 배치 가정 없이 거울 여부만 재요.
 */
export function faceCameras(normal){
  const forward=normal.map(v=>-v),inPlane=[0,1,2].filter(k=>normal[k]===0);
  const rights=[];
  for(const sign of [1,-1])for(const k of inPlane){const r=[0,0,0];r[k]=sign;rights.push(r);}
  return rights.map((right,index)=>({name:`face-${index}`,right,down:cross(forward,right)}));
}

/** 오른손 규약을 일부러 깬 카메라(D 부호 반전)예요. 자가 거울을 잡는지 보는 심은 결함 fixture 용이에요. */
export const leftHanded=camera=>({name:`${camera.name}-left`,right:camera.right,down:camera.down.map(v=>-v)});

/**
 * 카메라를 향한(법선·전방 < 0) 물리 면의 셀을 정사영한 scene 이에요. 볼록 큐브라 보이는 면끼리 겹치지 않아요.
 * @param {object} phys PhysCube
 * @param {{right:number[],down:number[]}} camera
 * @param {{faces?:string[], margin?:number}} [options] faces: 그릴 면을 좁혀요. margin: 흰 여백(셀).
 */
export function physViewScene(phys,camera,{faces,margin=3}={}){
  const forward=forwardOf(camera),n=phys.n,shapes=[],drawn=[];
  const project=p=>({x:dot(p,camera.right),y:dot(p,camera.down)});
  for(const [name,face] of Object.entries(phys.faces)){
    if(faces&&!faces.includes(name))continue;
    if(!(dot(face.normal,forward)<-1e-9))continue;
    drawn.push(name);
    const at=(i,j)=>project([0,1,2].map(k=>face.origin[k]+i*face.di[k]+j*face.dj[k]));
    for(let i=0;i<n;i++)for(let j=0;j<n;j++)
      shapes.push({kind:'polygon',color:face.colors[i*n+j],face:name,i,j,points:[at(i,j),at(i,j+1),at(i+1,j+1),at(i+1,j)]});
  }
  if(!shapes.length)return {width:1,height:1,background:{r:255,g:255,b:255},shapes,drawn};
  const xs=shapes.flatMap(s=>s.points.map(p=>p.x)),ys=shapes.flatMap(s=>s.points.map(p=>p.y));
  const x0=Math.min(...xs)-margin,y0=Math.min(...ys)-margin;
  for(const shape of shapes)for(const p of shape.points){p.x-=x0;p.y-=y0;}
  return {width:Math.max(...xs)-x0+margin,height:Math.max(...ys)-y0+margin,background:{r:255,g:255,b:255},shapes,drawn};
}

export function fieldOfRaster({width,height,pixels}){
  const data=new Float32Array(width*height);
  for(let k=0;k<data.length;k++)data[k]=relativeLuminance8(pixels[k*4],pixels[k*4+1],pixels[k*4+2]);
  return {width,height,data};
}
export const sceneField=(scene,pixelsPerUnit=12)=>fieldOfRaster(rasterize(scene,{pixelsPerUnit,supersample:2}));
export function mirrorX({width,height,data}){
  const out=new Float32Array(data.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)out[y*width+x]=data[y*width+width-1-x];
  return {width,height,data:out};
}

/** 심은 결함: 한 면의 열 방향을 뒤집어(내용은 그대로) 그 면만 거울상으로 만든 PhysCube 사본이에요. */
export function mirrorOneFace(phys,name){
  const f=phys.faces[name];
  return {...phys,faces:{...phys.faces,[name]:{...f,dj:f.dj.map(v=>-v),origin:f.origin.map((v,k)=>v+phys.n*f.dj[k])}}};
}

/** 카메라 한 대로 렌더해 H 검출기에 넣어요. */
export function detectPhysView(phys,camera,{faces,pixelsPerUnit=12,margin=3}={}){
  const scene=physViewScene(phys,camera,{faces,margin});
  if(!scene.shapes.length)return {drawn:[],faces:[],stats:null};
  const found=detectH(sceneField(scene,pixelsPerUnit));
  return {drawn:scene.drawn,faces:found.faces,stats:found.stats,rejected:found.rejected};
}
