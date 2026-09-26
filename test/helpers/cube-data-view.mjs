/**
 * 3D 데이터 출력(glTF · 3D 데이터 전개도 · .schem)을 «오른손 세계에서 바깥에서 본 모습» 으로 되돌려 보는 자들이에요.
 * 구현의 좌표 사상(cube-physical)을 쓰지 않아요 — 파일에 적힌 좌표·UV·블록만 읽고, 카메라는 h-physical-camera 의
 * 고정 오른손 카메라(ISO_FRONT · ISO_BACK)나 면 법선에서만 만든 오른손 카메라(faceCameras)를 써요.
 *   - glTF: POSITION · COLOR_0(선형 → sRGB) · TEXCOORD_0(UV 0,0 = 이미지 좌상)을 그대로 정사영해요.
 *   - 전개도: 전개도 장면의 면 사각형과 공유 변만으로 인쇄면 바깥 산접기(paper-fold.foldPaper)를 해요. 접는 선 표를 베끼지 않아요.
 *   - .schem: 블록 배열을 Minecraft(오른손: X 동 · Y 위 · Z 남) 바깥 면에서 본 격자로 읽어요.
 */
import {canonicalSceneImage} from '../../src/scene-image.js';
import {CONCRETE_COLORS} from '../../src/minecraft-schematic.js';
import {foldPaper} from './paper-fold.mjs';
import {dot,cross,forwardOf,faceCameras} from './h-physical-camera.mjs';

const sub=(a,b)=>a.map((v,k)=>v-b[k]);
const WHITE=Object.freeze({r:255,g:255,b:255});
const srgb8=v=>{const c=v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;return Math.round(Math.min(1,Math.max(0,c))*255);};

/** glTF 접근자 하나를 형식대로 풀어요(내장 data URI 버퍼만). */
export function gltfAccessor(gltf,index){
  const accessor=gltf.accessors[index],view=gltf.bufferViews[accessor.bufferView];
  const raw=Buffer.from(gltf.buffers[view.buffer].uri.split(',')[1],'base64'),from=raw.byteOffset+(view.byteOffset??0);
  const Type=accessor.componentType===5126?Float32Array:accessor.componentType===5125?Uint32Array:Uint16Array;
  return new Type(raw.buffer.slice(from,from+view.byteLength));
}

/**
 * glTF 의 사각형(삼각형 둘)을 모두 풀어요. 쿼드마다 꼭짓점 4개(원래 순서), 바깥 법선(큐브 중심 → 쿼드 중심, 볼록 큐브),
 * 색(정점 색) 또는 텍스처(UV 로 TL·TR·BR·BL 을 찾은 꼭짓점)를 돌려줘요.
 * @param {object} gltf cubeModelToGltf 결과
 * @param {(uri:string)=>object} [imageOfUri] 텍스처 data URI → scene image(렌더용). 없으면 이미지 쿼드는 image:null 이에요.
 */
export function gltfQuads(gltf,imageOfUri){
  const base=gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION],mid=base.min.map((v,k)=>(v+base.max[k])/2),quads=[];
  for(const prim of gltf.meshes[0].primitives){
    const pos=gltfAccessor(gltf,prim.attributes.POSITION),ind=gltfAccessor(gltf,prim.indices),at=i=>[pos[i*3],pos[i*3+1],pos[i*3+2]];
    const color=prim.attributes.COLOR_0===undefined?null:gltfAccessor(gltf,prim.attributes.COLOR_0);
    const uv=prim.attributes.TEXCOORD_0===undefined?null:gltfAccessor(gltf,prim.attributes.TEXCOORD_0);
    const texture=uv?gltf.textures[gltf.materials[prim.material].pbrMetallicRoughness.baseColorTexture.index]:null;
    const uri=texture?gltf.images[texture.source].uri:null;
    for(let t=0;t<ind.length;t+=6){
      const tri=[...ind.slice(t,t+6)],ids=[...new Set(tri)];
      if(ids.length!==4)throw new Error('glTF 사각형이 아니에요');
      const center=ids.map(at).reduce((s,p)=>s.map((v,k)=>v+p[k]/4),[0,0,0]),d=sub(center,mid);
      const axis=d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs))),outward=[0,0,0];outward[axis]=Math.sign(d[axis]);
      // 삼각형 (0,1,2) 가 바깥을 보는지 — 앞면 판정은 뷰어 규약(CCW)이라 따로 재요.
      const [a,b,c]=tri.slice(0,3).map(at),frontOutward=dot(cross(sub(b,a),sub(c,a)),outward)>0;
      if(uv){
        const corner=(u,v)=>ids.find(i=>uv[i*2]===u&&uv[i*2+1]===v);
        const order=[corner(0,0),corner(1,0),corner(1,1),corner(0,1)];
        if(order.some(i=>i===undefined))throw new Error('glTF 이미지 UV 가 사각형 모서리가 아니에요');
        quads.push({kind:'image',points:order.map(at),outward,frontOutward,uri,image:imageOfUri?imageOfUri(uri):null});
      }else{
        const order=[tri[0],tri[1],tri[2],tri[5]],i0=order[0];
        quads.push({kind:'polygon',points:order.map(at),outward,frontOutward,color:{r:srgb8(color[i0*4]),g:srgb8(color[i0*4+1]),b:srgb8(color[i0*4+2])}});
      }
    }
  }
  return quads;
}

/** 모델의 면 이미지(scene image)를 glTF 텍스처 URI 로 찾는 표를 만들어요(같은 자산은 같은 URI). */
export function imageLookup(model){
  const byUri=new Map();for(const p of model.images??[])byUri.set(canonicalSceneImage(p.image).href,p.image);
  return uri=>byUri.get(uri)??null;
}

/**
 * 3D 쿼드 목록을 오른손 카메라로 정사영한 scene 이에요. 카메라를 향한 면(바깥 법선 · 전방 < 0)만 그리고, 이미지를 위에 얹어요.
 * @param {Array<{kind:string,points:number[][],outward:number[],color?:object,image?:object}>} quads
 */
export function viewScene(quads,camera,{margin=3}={}){
  const forward=forwardOf(camera),shapes=[];
  const project=p=>({x:dot(p,camera.right),y:dot(p,camera.down)});
  for(const q of quads){
    if(!(dot(q.outward,forward)<-1e-9))continue;
    if(q.kind==='image'){if(q.image)shapes.push({kind:'image',image:q.image,color:WHITE,points:q.points.map(project),layer:1});}
    else shapes.push({kind:'polygon',color:q.color,points:q.points.map(project),layer:0});
  }
  shapes.sort((a,b)=>a.layer-b.layer);
  if(!shapes.length)return {width:1,height:1,background:WHITE,shapes};
  const xs=shapes.flatMap(s=>s.points.map(p=>p.x)),ys=shapes.flatMap(s=>s.points.map(p=>p.y));
  const x0=Math.min(...xs)-margin,y0=Math.min(...ys)-margin;
  for(const s of shapes)for(const p of s.points){p.x-=x0;p.y-=y0;}
  return {width:Math.max(...xs)-x0+margin,height:Math.max(...ys)-y0+margin,background:WHITE,shapes};
}

/**
 * 3D 데이터 전개도(cubeNetScene)를 인쇄면이 바깥이 되게 접어 3D 쿼드로 돌려요. 면 사각형 = 같은 face 도형의 외접 사각형,
 * 접는 선 = 두 면 사각형이 한 변 전체를 공유하는 곳이에요(전개도 배치 표를 베끼지 않아요).
 * @returns {{quads:Array, faces:string[]}} quads 의 face 는 전개도 도형의 face(시트 이름)예요.
 */
export function foldCubeNet(net){
  const rects={};
  for(const s of net.shapes){
    const r=rects[s.face]??={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
    for(const p of s.points){r.x0=Math.min(r.x0,p.x);r.y0=Math.min(r.y0,p.y);r.x1=Math.max(r.x1,p.x);r.y1=Math.max(r.y1,p.y);}
  }
  const names=Object.keys(rects),faces=Object.fromEntries(names.map(name=>[name,{rect:rects[name]}])),folds=[],eps=1e-9;
  for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++){
    const a=rects[names[i]],b=rects[names[j]];
    const shareX=[[a.x1,b.x0],[a.x0,b.x1]].find(([u,v])=>Math.abs(u-v)<eps),shareY=[[a.y1,b.y0],[a.y0,b.y1]].find(([u,v])=>Math.abs(u-v)<eps);
    const ySpan=[Math.max(a.y0,b.y0),Math.min(a.y1,b.y1)],xSpan=[Math.max(a.x0,b.x0),Math.min(a.x1,b.x1)];
    if(shareX&&ySpan[1]-ySpan[0]>eps&&Math.abs((ySpan[1]-ySpan[0])-(a.y1-a.y0))<eps)folds.push({faces:[names[i],names[j]],a:{x:shareX[0],y:ySpan[0]},b:{x:shareX[0],y:ySpan[1]}});
    else if(shareY&&xSpan[1]-xSpan[0]>eps&&Math.abs((xSpan[1]-xSpan[0])-(a.x1-a.x0))<eps)folds.push({faces:[names[i],names[j]],a:{x:xSpan[0],y:shareY[0]},b:{x:xSpan[1],y:shareY[0]}});
  }
  if(folds.length!==names.length-1)throw new Error(`전개도 접는 선이 나무가 아니에요(${folds.length})`);
  const degree=name=>folds.filter(f=>f.faces.includes(name)).length,root=names.reduce((best,name)=>degree(name)>degree(best)?name:best,names[0]);
  const maps=foldPaper(faces,folds,root),quads=[];
  for(const s of net.shapes){
    const points=s.points.map(p=>maps.get(s.face)(p));
    quads.push({kind:s.kind,face:s.face,points,color:s.kind==='polygon'?s.color:undefined,image:s.kind==='image'?s.image:undefined});
  }
  // 큐브 중심은 외접 상자 중심이에요 — 점 평균은 면마다 쿼드 수가 다르면(Y: 데이터 면 n² · 뒷면 1장) 한쪽으로 쏠려 법선을 틀리게 내요.
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const q of quads)for(const p of q.points)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
  const center=lo.map((v,k)=>(v+hi[k])/2);
  for(const q of quads){
    const c=q.points.reduce((s,p)=>s.map((v,k)=>v+p[k]/q.points.length),[0,0,0]),d=sub(c,center);
    const axis=d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs)));q.outward=[0,0,0];q.outward[axis]=Math.sign(d[axis]);
  }
  return {quads,faces:names};
}

/** 한 면의 바깥 법선에서 만든 오른손 카메라(4 회전 중 첫째)로 그 면 쿼드만 그려요. */
export function faceViewScene(quads,face,options){
  const own=quads.filter(q=>q.face===face);
  return viewScene(own,faceCameras(own[0].outward)[0],options);
}

const MC_OUT=Object.freeze([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]);
/**
 * .schem 블록(voxelizeCube 결과)을 Minecraft 오른손 좌표의 바깥 여섯 면에서 본 scene 으로 돌려요.
 * 블록 한 개 = 1 단위 정사각형, 색 = 콘크리트 대표색. 오른쪽·아래는 그 면 바깥 법선에서 만든 오른손 카메라예요.
 * @returns {Array<{out:number[], scene:object}>}
 */
export function schemFaceScenes(voxels,{margin=3}={}){
  const S=voxels.width,colorOf=id=>{const name=voxels.palette[id].replace(/^minecraft:|_concrete$/g,'');return CONCRETE_COLORS.find(c=>c.name===name)??null;};
  const at=(x,y,z)=>voxels.blocks[x+z*S+y*S*S];
  return MC_OUT.map(out=>{
    const camera=faceCameras(out)[0],axis=out.findIndex(v=>v!==0),plane=out[axis]>0?S-1:0,uv=[0,1,2].filter(k=>k!==axis),shapes=[];
    for(let a=0;a<S;a++)for(let b=0;b<S;b++){
      const p=[0,0,0];p[axis]=plane;p[uv[0]]=a;p[uv[1]]=b;
      const color=colorOf(at(p[0],p[1],p[2]));if(!color)continue;
      // 블록 바깥 면의 네 꼭짓점(블록 좌표 → 모서리)
      const corner=(du,dv)=>{const q=p.slice();q[axis]+=out[axis]>0?1:0;q[uv[0]]+=du;q[uv[1]]+=dv;return {x:dot(q,camera.right),y:dot(q,camera.down)};};
      shapes.push({kind:'polygon',color:{r:color.r,g:color.g,b:color.b},points:[corner(0,0),corner(1,0),corner(1,1),corner(0,1)]});
    }
    const xs=shapes.flatMap(s=>s.points.map(p=>p.x)),ys=shapes.flatMap(s=>s.points.map(p=>p.y));
    const x0=Math.min(...xs)-margin,y0=Math.min(...ys)-margin;
    for(const s of shapes)for(const p of s.points){p.x-=x0;p.y-=y0;}
    return {out,scene:{width:Math.max(...xs)-x0+margin,height:Math.max(...ys)-y0+margin,background:WHITE,shapes}};
  });
}
