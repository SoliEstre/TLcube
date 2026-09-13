/** H의 빈 ZP/XP/YP 면 전용 표시 자산. 본문/wire나 생성 상태 저장에 포함하지 않아요. */
import {hFacePoint} from './h-layout.js';
import {normalizeHProfile} from './h-profile.js';
import {H_DISPLAY_FACES,hDisplayImageSource,hDisplayMap} from './h-face-arrangement.js';
import {assertSceneImage} from './scene-image.js';
// Legacy H3 isometric에서의 실제 target 순서는 hFaceImagePlacements가 보존해요.
export const H_IMAGE_FACES=H_DISPLAY_FACES;
export function hFaceImagePlacement(face,image,n){
  if(!H_DISPLAY_FACES.includes(face)||!Number.isFinite(n)||n<=0)throw new RangeError('H 빈 면 이미지 위치');
  assertSceneImage(image);
  const width=n*Math.min(1,image.width/image.height),height=n*Math.min(1,image.height/image.width),x=(n-width)/2,y=(n-height)/2;
  return{face,image,x,y,width,height,corners:[[y,x],[y,x+width],[y+height,x+width],[y+height,x]].map(([i,j])=>hFacePoint(face,i,j,n))};
}
export function hFaceImagePlacements(encoded,faceImages={},options={}){
  const map=hDisplayMap(encoded,options),n=encoded.n??normalizeHProfile(encoded).n;
  return map.blankFaces.flatMap(face=>{
    const source=hDisplayImageSource(map,faceImages,face);if(!source)return[];
    return [{...hFaceImagePlacement(face,source.image,n),sourceFace:source.sourceFace}];
  });
}
const MAX_FILE_BYTES=12*1024*1024,MAX_INPUT_PIXELS=40_000_000,SVG_NS='http://www.w3.org/2000/svg';
const SVG_TAGS=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','radialGradient','stop','clipPath','title','desc']);
const SVG_ATTRS=new Set(['id','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','width','height','viewBox','d','points','transform','fill','fill-opacity','stroke','stroke-width','stroke-opacity','opacity','offset','stop-color','stop-opacity','clip-path','href','shape-rendering','preserveAspectRatio','xmlns']);
const SVG_PREFLIGHT_REJECT=/<!DOCTYPE|<!ENTITY|<\?[^]*?\?>|\bon[a-z]+\s*=|\b(?:xml:base|style)\s*=|@import/i;
const LOCAL_ID=/^#[A-Za-z_][\w:.-]*$/;
/** Node-testable cheap rejection. The browser parser below is the security authority. */
export function preflightHFaceSvg(source){
  if(typeof source!=='string'||source.length<1||source.length>MAX_FILE_BYTES)throw new RangeError('안전한 정적 SVG만 사용할 수 있어요.');
  source=source.replace(/^\uFEFF?\s*<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?(?:\s+standalone=(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>/i,'');
  if(SVG_PREFLIGHT_REJECT.test(source))throw new RangeError('안전한 정적 SVG만 사용할 수 있어요.');return source;
}
function svgLength(value,name){if(value===null)return null;const match=/^\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:px)?\s*$/.exec(value);if(!match||!(Number(match[1])>0))throw new RangeError(`SVG ${name} 크기`);return Number(match[1]);}
function localPaint(value){return value==='none'||/^#[0-9a-fA-F]{3,8}$/.test(value)||/^rgb\([^)]*\)$/.test(value)||/^url\(#[A-Za-z_][\w:.-]*\)$/.test(value);}
/** Browser-only XML authority; SVG is never appended to a document. */
export function sanitizeHFaceSvg(source){
  source=preflightHFaceSvg(source);if(typeof DOMParser!=='function'||typeof XMLSerializer!=='function')throw new Error('SVG 검증에는 브라우저 XML parser가 필요해요.');
  const document=new DOMParser().parseFromString(source,'image/svg+xml');
  if(document.querySelector('parsererror')||!document.documentElement||document.documentElement.localName!=='svg'||document.documentElement.namespaceURI!==SVG_NS)throw new RangeError('유효한 SVG 루트가 필요해요.');
  const ids=new Set(),refs=[];
  const visit=node=>{
    if(node.nodeType===Node.ELEMENT_NODE){
      if(node.namespaceURI!==SVG_NS||!SVG_TAGS.has(node.localName))throw new RangeError('허용하지 않는 SVG 요소/namespace예요.');
      for(const attr of node.attributes){
        if(attr.namespaceURI==='http://www.w3.org/2000/xmlns/'&&(attr.localName!=='xmlns'||attr.value!==SVG_NS))throw new RangeError('SVG namespace 변경을 허용하지 않아요.');
        if(attr.namespaceURI&&attr.namespaceURI!=='http://www.w3.org/2000/xmlns/')throw new RangeError('SVG namespace attribute를 허용하지 않아요.');
        if(!SVG_ATTRS.has(attr.name)||/^on/i.test(attr.name)||attr.name==='xml:base')throw new RangeError(`허용하지 않는 SVG attribute: ${attr.name}`);
        const value=attr.value.trim();if(attr.name==='id'){if(!/^[A-Za-z_][\w:.-]*$/.test(value)||ids.has(value))throw new RangeError('SVG id');ids.add(value);}
        if(attr.name==='href'){if(!LOCAL_ID.test(value))throw new RangeError('외부 SVG href를 허용하지 않아요.');refs.push(value.slice(1));}
        if(['fill','stroke','stop-color','clip-path'].includes(attr.name)&&!localPaint(value))throw new RangeError('외부 SVG paint/reference를 허용하지 않아요.');
        for(const match of value.matchAll(/url\(\s*([^)]*?)\s*\)/gi)){if(!LOCAL_ID.test(match[1]))throw new RangeError('외부 SVG URL을 허용하지 않아요.');refs.push(match[1].slice(1));}
      }
    }else if(node.nodeType===Node.COMMENT_NODE){/* inert */}
    else if(node.nodeType===Node.TEXT_NODE&&(node.parentNode?.localName==='title'||node.parentNode?.localName==='desc'||!node.nodeValue.trim())){/* safe text */}
    else throw new RangeError('SVG text/processing node를 허용하지 않아요.');
    for(const child of node.childNodes)visit(child);
  };visit(document.documentElement);for(const id of refs)if(!ids.has(id))throw new RangeError('존재하지 않는 local SVG reference예요.');
  const root=document.documentElement,width=svgLength(root.getAttribute('width'),'width'),height=svgLength(root.getAttribute('height'),'height'),viewBox=root.getAttribute('viewBox');
  const values=viewBox&&viewBox.trim().split(/[ ,]+/).map(Number);if(values&&(!values||values.length!==4||values.some(x=>!Number.isFinite(x))||values[2]<=0||values[3]<=0))throw new RangeError('SVG viewBox');
  const sourceWidth=width??values?.[2],sourceHeight=height??values?.[3];if(!sourceWidth||!sourceHeight||sourceWidth*sourceHeight>MAX_INPUT_PIXELS)throw new RangeError('SVG 크기는 양수, 4천만 픽셀 이하여야 해요.');if(!viewBox)root.setAttribute('viewBox',`0 0 ${sourceWidth} ${sourceHeight}`);
  const scale=Math.min(1,1024/Math.max(sourceWidth,sourceHeight));root.setAttribute('width',String(Math.max(1,Math.round(sourceWidth*scale))));root.setAttribute('height',String(Math.max(1,Math.round(sourceHeight*scale))));
  return new XMLSerializer().serializeToString(root);
}
async function svgBitmap(source){
  const safe=sanitizeHFaceSvg(source),blob=new Blob([safe],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),crisp=/\bshape-rendering\s*=\s*["']crispEdges["']/i.test(safe);
  try{if(typeof createImageBitmap==='function')try{return{bitmap:await createImageBitmap(blob),crisp};}catch{/* SVG decode fallback */}const bitmap=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('SVG를 읽을 수 없어요.'));image.src=url;});return{bitmap,crisp};}finally{URL.revokeObjectURL(url);}
}
export async function loadHFaceImage(file){
  if(!file||file.size>MAX_FILE_BYTES||file.size<1||!['image/png','image/jpeg','image/webp','image/svg+xml'].includes(file.type))throw new RangeError('PNG/JPG/WebP/SVG 이미지(12MB 이하)를 선택해 주세요.');
  const decoded=file.type==='image/svg+xml'?await svgBitmap(await file.text()):{bitmap:await createImageBitmap(file),crisp:false},bitmap=decoded.bitmap;
  try{
    if(bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>MAX_INPUT_PIXELS)throw new RangeError('이미지는 4천만 픽셀 이하여야 해요.');
    const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('이미지를 읽을 수 없어요.');ctx.imageSmoothingEnabled=!decoded.crisp;
    ctx.drawImage(bitmap,0,0,width,height);
    return assertSceneImage({width,height,pixels:ctx.getImageData(0,0,width,height).data,href:canvas.toDataURL('image/png'),pixelated:decoded.crisp});
  }finally{bitmap.close?.();}
}
