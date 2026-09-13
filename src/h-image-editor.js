/**
 * H blank-face image compositor.
 *
 * A raw loaded image is never mutated.  Call composeHFaceImage(raw, settings)
 * whenever settings change, and put only its result in `faceImages[face]`.
 * The result is a canonical, opaque, square PNG so canvas/SVG/net/glTF/video
 * consumers all receive exactly the same pixels.
 */
import {rasterToPng} from './png.js';
import {assertSceneImage} from './scene-image.js';

const MAX_SIDE=1024;
const FITS=new Set(['contain','cover','fill']);
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,label)=>{const number=Number(value);if(!Number.isFinite(number))throw new TypeError(`${label}은 유한한 수여야 해요`);return number;};
const byte=value=>Math.round(clamp(finite(value,'RGB'),0,255));
const percent=value=>clamp(finite(value,'HSL'),0,100);

export function normalizeHFaceImageSettings({rotation=0,fit='contain',background='#ffffff',size}={}){
  if(!Number.isFinite(rotation)||rotation%45!==0)throw new RangeError('rotation은 45도 단위여야 해요');
  if(!FITS.has(fit))throw new RangeError('fit은 contain, cover, fill 중 하나여야 해요');
  const rgb=hexToRgb(background);
  if(size!==undefined&&(!Number.isInteger(size)||size<1||size>MAX_SIDE))throw new RangeError('size는 1..1024 정수여야 해요');
  return Object.freeze({rotation:((rotation%360)+360)%360,fit,background:rgbToHex(rgb),size});
}

/** HSL uses degrees/percent, RGB uses sRGB 8 bit, HEX is always lower-case #rrggbb. */
export function rgbToHex({r,g,b}){return '#'+[r,g,b].map(value=>byte(value).toString(16).padStart(2,'0')).join('');}
export function hexToRgb(hex){
  if(typeof hex!=='string'||!/^#[0-9a-fA-F]{6}$/.test(hex))throw new TypeError('HEX는 #rrggbb 형식이어야 해요');
  return Object.freeze({r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)});
}
export function hslToRgb({h=0,s=0,l=0}={}){
  h=clamp(finite(h,'HSL'),0,360)%360;s=percent(s)/100;l=percent(l)/100;
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
  const [r,g,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return Object.freeze({r:Math.round((r+m)*255),g:Math.round((g+m)*255),b:Math.round((b+m)*255)});
}
export function rgbToHsl({r,g,b}={}){
  r=byte(r)/255;g=byte(g)/255;b=byte(b)/255;const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo,l=(hi+lo)/2;
  let h=0;if(d){h=hi===r?60*((g-b)/d%6):hi===g?60*((b-r)/d+2):60*((r-g)/d+4);if(h<0)h+=360;}
  return Object.freeze({h:Math.round(h),s:Math.round((d?(d/(1-Math.abs(2*l-1))):0)*100),l:Math.round(l*100)});
}

function pngHref(width,height,pixels){
  const bytes=rasterToPng({width,height,pixels});
  if(typeof Buffer!=='undefined')return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
  let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return `data:image/png;base64,${btoa(text)}`;
}
function composite(pixels,k,bg){const a=pixels[k+3]/255;return [pixels[k]*a+bg.r*(1-a),pixels[k+1]*a+bg.g*(1-a),pixels[k+2]*a+bg.b*(1-a)];}
function bilinear(image,x,y,bg){
  // x/y are source pixel-center coordinates.  Outside samples are background.
  if(x<-.5||y<-.5||x>image.width-.5||y>image.height-.5)return [bg.r,bg.g,bg.b];
  if(image.pixelated)return composite(image.pixels,(clamp(Math.round(y),0,image.height-1)*image.width+clamp(Math.round(x),0,image.width-1))*4,bg);
  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,out=[0,0,0];
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const sx=clamp(x0+dx,0,image.width-1),sy=clamp(y0+dy,0,image.height-1),w=(dx?fx:1-fx)*(dy?fy:1-fy),c=composite(image.pixels,(sy*image.width+sx)*4,bg);
    out[0]+=c[0]*w;out[1]+=c[1]*w;out[2]+=c[2]*w;
  }return out;
}
function scales(image,size,fit,cos,sin){
  const ac=Math.abs(cos),as=Math.abs(sin),cover=Math.abs(cos)+Math.abs(sin);
  if(fit==='fill')return {x:size*cover/image.width,y:size*cover/image.height};
  if(fit==='contain'){
    const n=Math.min(size/(ac*image.width+as*image.height),size/(as*image.width+ac*image.height));
    return {x:n,y:n};
  }
  // cover means each corner of the output square maps inside the unrotated rectangle.
  // At 45° a square needs sqrt(2) expansion: the rotated square is a diamond
  // larger than the output square, and its four corners are intentionally clipped.
  const n=Math.max(size*cover/image.width,size*cover/image.height);return {x:n,y:n};
}
/** Deterministic CPU compositor; no canvas, DOM, network, or cumulative resampling. */
export function composeHFaceImage(imageOrNull,options={}){
  const settings=normalizeHFaceImageSettings(options),bg=hexToRgb(settings.background);
  if(imageOrNull!==null&&imageOrNull!==undefined)assertSceneImage(imageOrNull);
  // UI preview calls this with the stable 256px default; final export can request up to 1024.
  const size=settings.size??256;
  const pixels=new Uint8ClampedArray(size*size*4);if(!imageOrNull){for(let k=0;k<pixels.length;k+=4){pixels[k]=bg.r;pixels[k+1]=bg.g;pixels[k+2]=bg.b;pixels[k+3]=255;}return Object.freeze({width:size,height:size,pixels,href:pngHref(size,size,pixels)});}
  const rad=settings.rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad),scale=scales(imageOrNull,size,settings.fit,cos,sin);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=x+.5-size/2,dy=y+.5-size/2,sx=(cos*dx+sin*dy)/scale.x+imageOrNull.width/2-.5,sy=(-sin*dx+cos*dy)/scale.y+imageOrNull.height/2-.5,c=bilinear(imageOrNull,sx,sy,bg),k=(y*size+x)*4;
    pixels[k]=Math.round(c[0]);pixels[k+1]=Math.round(c[1]);pixels[k+2]=Math.round(c[2]);pixels[k+3]=255;
  }
  return Object.freeze({width:size,height:size,pixels,href:pngHref(size,size,pixels)});
}
