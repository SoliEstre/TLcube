/** 내장 이미지의 glTF 텍스처와 콘크리트 표본. 데이터 면을 수정하지 않아요. */
import {assertSceneImage,canonicalSceneImage,imageColorOver} from './scene-image.js';
import {hFacePoint} from './h-layout.js';
const NORMALS={ZM:[0,0,-1],XM:[-1,0,0],YM:[0,-1,0],ZP:[0,0,1],XP:[1,0,0],YP:[0,1,0]};
function b64(bytes){if(typeof Buffer!=='undefined')return Buffer.from(bytes).toString('base64');let text='';for(const b of bytes)text+=String.fromCharCode(b);return btoa(text);}
export function appendCubeImageGltf(gltf,model){
  if(!model.images?.length)return gltf;
  if(!Array.isArray(model.images)||model.images.length>6||model.kind!=='H'
    ||!Array.isArray(model.dataFaces)||model.dataFaces.length<1||model.dataFaces.length>6)throw new RangeError('빈 면 이미지 glTF 한도');
  const physicalDataFaces=new Set(model.quads?.filter(quad=>quad?.kind==='module').map(quad=>quad.face));
  if(physicalDataFaces.size<model.dataFaces.length||model.images.length>6-physicalDataFaces.size
    ||!Number.isFinite(model.n)||model.n<=0)throw new RangeError('빈 면 이미지 glTF 한도');
  const seen=new Set();
  for(const placement of model.images){
    if(!placement||!Object.hasOwn(NORMALS,placement.face)||seen.has(placement.face)
      ||physicalDataFaces.has(placement.face))throw new RangeError('빈 면 이미지 face');
    const axis=NORMALS[placement.face].findIndex(v=>v!==0);
    const plane=NORMALS[placement.face][axis]>0?model.n:0;
    if(!Array.isArray(placement.corners)||placement.corners.length!==4
      ||placement.corners.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)
        ||p.some(v=>v<0||v>model.n)||Math.abs(p[axis]-plane)>1e-9))throw new RangeError('빈 면 이미지 좌표');
    seen.add(placement.face);assertSceneImage(placement.image);
  }
  gltf.images=[];gltf.textures=[];gltf.samplers=[{magFilter:9729,minFilter:9729,wrapS:33071,wrapT:33071}];
  for(const placement of model.images){
    const image=canonicalSceneImage(placement.image),normal=NORMALS[placement.face];
    if(!normal)throw new RangeError('빈 면 이미지 face');
    const buffer=new ArrayBuffer(92),pos=new Float32Array(buffer,0,12),uv=new Float32Array(buffer,48,8),indices=new Uint16Array(buffer,80,6);
    for(let i=0;i<4;i++)pos.set(placement.corners[i].map((v,k)=>v+normal[k]*.0002),i*3);
    uv.set([0,0,1,0,1,1,0,1]);indices.set([0,1,2,0,2,3]);
    const bi=gltf.buffers.length,vi=gltf.bufferViews.length,ai=gltf.accessors.length,ti=gltf.textures.length,mi=gltf.materials.length;
    gltf.buffers.push({byteLength:92,uri:'data:application/octet-stream;base64,'+b64(new Uint8Array(buffer))});
    gltf.bufferViews.push({buffer:bi,byteOffset:0,byteLength:48,target:34962},{buffer:bi,byteOffset:48,byteLength:32,target:34962},{buffer:bi,byteOffset:80,byteLength:12,target:34963});
    const bounds=max=>[0,1,2].map(k=>(max?Math.max:Math.min)(pos[k],pos[k+3],pos[k+6],pos[k+9]));
    gltf.accessors.push({bufferView:vi,componentType:5126,count:4,type:'VEC3',min:bounds(false),max:bounds(true)},
      {bufferView:vi+1,componentType:5126,count:4,type:'VEC2'},{bufferView:vi+2,componentType:5123,count:6,type:'SCALAR'});
    gltf.images.push({uri:image.href});gltf.textures.push({source:ti,sampler:0});
    gltf.materials.push({doubleSided:true,alphaMode:'BLEND',extensions:{KHR_materials_unlit:{}},pbrMetallicRoughness:{baseColorTexture:{index:ti},baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1}});
    gltf.meshes[0].primitives.push({attributes:{POSITION:ai,TEXCOORD_0:ai+1},indices:ai+2,mode:4,material:mi});
  }
  return gltf;
}
/** 블록 중심을 이미지에 사영해 현재 셀당 블록 해상도로만 색을 양자화해요. */
export function* cubeImageVoxelQuads(model,scale){
  for(const p of model.images??[]){
    assertSceneImage(p.image);
    const x0=Math.max(0,Math.ceil(p.x*scale-.5)),x1=Math.min(model.n*scale,Math.ceil((p.x+p.width)*scale-.5));
    const y0=Math.max(0,Math.ceil(p.y*scale-.5)),y1=Math.min(model.n*scale,Math.ceil((p.y+p.height)*scale-.5));
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const u=((x+.5)/scale-p.x)/p.width,v=((y+.5)/scale-p.y)/p.height;
      yield{kind:'back',face:p.face,color:imageColorOver(p.image,u,v,p.background),corners:[[y,x],[y,x+1],[y+1,x+1],[y+1,x]].map(([i,j])=>hFacePoint(p.face,i/scale,j/scale,model.n))};
    }
  }
}
