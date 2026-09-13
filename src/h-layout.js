/** H0..H8: 마커를 포함한 정수 면 격자. 외부추가/분수셀 없이 모든 면이 n×n이에요. */
import { digitToRanks } from './lehmer.js';
import { H_FACE_IDS, H_BINARY, normalizeHProfile, hFormatByte, hReferenceLevel, hModeGroups, hModeFaces, isLegacyHMode } from './h-profile.js';
import { FRAME_EXTRA_BOOK } from './h-mode-codebook.js';
import {hCornerLayout,hCornerMarkerLevel} from './h-corner-layout.js';
export { H_FACE_IDS as FACE_IDS } from './h-profile.js';
const key=(i,j)=>`${i},${j}`;
const cache=new Map();
export function hLayout(version=0,finder='frame') {
  if(finder==='corners')return hCornerLayout(version);
  if(finder!=='frame')throw new RangeError('H layout finder');
  const {n}=normalizeHProfile({version});
  if(cache.has(version)) return cache.get(version);
  const m=n-5,roles=new Map(),tagCells=[],formatCells=[],routeCells=[],reference=[],scan=[];
  for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
    const r=Math.min(i,j,n-1-i,n-1-j);
    roles.set(key(i,j),{i,j,role:r===0?'boundary':r===1?'rail':r===2?'ring':'free'});
  }
  const point=(side,k)=>[[2,2+k],[2+k,n-3],[n-3,n-3-k],[n-3-k,2]][side];
  for(let side=0;side<4;side++) {
    for(const k of [1,2,m-2,m-1]) {
      const [i,j]=point(side,k),c={i,j,role:'tag',bit:tagCells.length};tagCells.push(c);roles.set(key(i,j),c);
    }
    for(const [offset,k] of [0,m/2-1,m/2,m/2+1].entries()) {
      const [i,j]=point(side,k),isFormat=offset<2,c={i,j,role:isFormat?'format':'route',bit:side*2+offset%2};
      (isFormat?formatCells:routeCells).push(c);roles.set(key(i,j),c);
    }
  }
  for(let i=3;i<6;i++)for(let j=3;j<6;j++){const c={i,j,role:'reference'};reference.push(c);roles.set(key(i,j),c);}
  for(const c of roles.values())if(c.role==='free')scan.push(c);
  while(scan.length%3){const c=scan.pop();roles.set(key(c.i,c.j),{...c,role:'filler'});}
  for(const c of scan)roles.set(key(c.i,c.j),{...c,role:'data'});
  const result={version,n,finder,roles,tagCells,formatCells,routeCells,reference,scan};cache.set(version,result);return result;
}
export function transformCell({i,j},n,rotation=0,mirror=false) {
  if(mirror)j=n-1-j;
  for(let r=0;r<rotation;r++)[i,j]=[j,n-1-i];
  return {i,j};
}
export function transformTag(bits,rotation=0,mirror=false) {
  const {n,tagCells}=hLayout(0),out=new Uint8Array(16);
  for(let k=0;k<16;k++){
    const q=transformCell(tagCells[k],n,rotation,mirror),at=tagCells.findIndex(c=>c.i===q.i&&c.j===q.j);
    if(at<0)throw new Error('H tag orbit');out[at]=bits[k];
  }
  return out;
}
export function hamming(a,b){let d=0;for(let k=0;k<a.length;k++)d+=a[k]!==b[k];return d;}
const WORDS=Object.freeze([0x0017,0x002b,0x0059,0x0065,0x011c,0x0143]);
const LEGACY_BOOK=Object.freeze([3,6].flatMap(mode=>H_FACE_IDS.slice(0,mode).map((face,f)=>Object.freeze({mode,face,
  bits:Uint8Array.from({length:16},(_,k)=>((WORDS[f]>>k)&1)^(mode===6?1:0))}))));
const BOOK=Object.freeze([...LEGACY_BOOK,...FRAME_EXTRA_BOOK.map(row=>Object.freeze({mode:row.mode,face:row.face,bits:Uint8Array.from(row.bits)}))]);
// 기존 BOOK 선언은 LEGACY_BOOK으로 이름만 바꾸고 이 export는 그대로 둬요.
export function hCodebook(){return BOOK.map(entry=>({...entry,bits:entry.bits.slice()}));}
export function hReservedLevel(cell,profile,face,routeId) {
  const p=normalizeHProfile(profile),code=BOOK.find(c=>c.mode===p.mode&&c.face===face);
  if(!code||!Number.isInteger(routeId)||routeId<0||routeId>255)throw new RangeError('H face/route');
  switch(cell.role){
    case 'data':return null;
    case 'boundary':return 4;
    case 'rail':return 3;
    case 'ring':return p.mode===6?3:4;
    case 'tag':return code.bits[cell.bit]?3:4;
    case 'marker':return hCornerMarkerLevel(cell,p.mode,face);
    case 'format':return (hFormatByte(p)>>cell.bit)&1?3:4;
    case 'route':return (routeId>>cell.bit)&1?3:4;
    case 'reference':return p.finder==='corners'?(p.tones===2?cell.tone2Rank:cell.rank):hReferenceLevel(cell.i,cell.j,p.tones);
    case 'filler':return 5;
    default:throw new Error('H role');
  }
}
export function makeFaces({version=0,mode=3,tones=3,ecc='M',mask=0,finder='frame',routeId,triadDigits,groupDigits}) {
  const p=normalizeHProfile({version,mode,tones,ecc,mask,finder}),layout=hLayout(version,p.finder),faces={};
  const groups=hModeGroups(mode),legacy=isLegacyHMode(mode);
  if(legacy&&(!Array.isArray(triadDigits)||triadDigits.length!==groups.length))throw new RangeError('H triad count');
  if(!legacy&&(!Array.isArray(groupDigits)||groupDigits.length!==groups.length))throw new RangeError('H group count');
  if(mode===1) {
    const face='XM',levels=new Uint8Array(p.n*p.n),half=Math.floor(layout.scan.length/2),digits=groupDigits[0];
    if(digits.length!==half)throw new RangeError('H single digit count');
    for(const c of layout.roles.values())levels[c.i*p.n+c.j]=hReservedLevel(c,p,face,routeId)??0;
    const perSymbol=tones===2?4:3,used=Math.floor(half/perSymbol)*perSymbol;
    for(let k=0;k<used;k++){
      const digit=digits[k];if(!Number.isInteger(digit)||digit<0||digit>(tones===2?3:5))throw new RangeError('H digit');
      const a=layout.scan[k],b=layout.scan[k+half],rank=tones===3?digitToRanks(digit):null;
      levels[a.i*p.n+a.j]=rank?rank.T:(digit>>1)&1;
      levels[b.i*p.n+b.j]=rank?rank.L:digit&1;
    }
    // 잔여 digit0을 3톤 rank로 바꾸지 않고 두 물리셀 모두 level0으로 남겨요.
    for(let k=used;k<half;k++)if(digits[k]!==0)throw new RangeError('H single padding');
    return {[face]:levels};
  }
  for(let g=0;g<groups.length;g++)for(let f=0;f<groups[g].length;f++) {
    const face=groups[g][f],levels=new Uint8Array(p.n*p.n),digits=legacy?triadDigits[g]:groupDigits[g],arity=groups[g].length;
    if(digits.length!==layout.scan.length)throw new RangeError('H digit count');
    for(const c of layout.roles.values())levels[c.i*p.n+c.j]=hReservedLevel(c,p,face,routeId)??0;
    for(let k=0;k<digits.length;k++) {
      const digit=digits[k],c=layout.scan[k];if(!Number.isInteger(digit)||digit<0||digit>(arity===2&&tones===2?3:5))throw new RangeError('H digit');
      if(arity===3)levels[c.i*p.n+c.j]=tones===2?H_BINARY[digit][f]:digitToRanks(digit)[['T','L','R'][f]];
      else if(tones===2)levels[c.i*p.n+c.j]=(digit>>(1-f))&1;
      else { const rank=digitToRanks(digit); levels[c.i*p.n+c.j]=f===0?rank.T:rank.L; }
    }
    faces[face]=levels;
  }
  return faces;
}
/** 예약영역과 메타를 독립대조해요. 불명 본문255는 RS erasure 용도예요. */
export function validateHFace(levels,profile) {
  try {
    const p=normalizeHProfile(profile),l=hLayout(p.version,p.finder);
    if(!(levels instanceof Uint8Array)||levels.length!==p.n*p.n||!hModeFaces(p.mode).includes(profile.face))return false;
    for(const c of l.roles.values()) {
      const v=levels[c.i*p.n+c.j],expected=hReservedLevel(c,p,profile.face,profile.routeId);
      if(expected===null){if(v!==255&&v>=p.tones)return false;}else if(v!==expected)return false;
    }
    return true;
  }catch{return false;}
}
/** 바깥에서 보았을 때 반사되지 않는 물리표면 좌표예요. */
export function hFacePoint(face,i,j,n) {
  switch(face){case'ZM':return[i,j,0];case'XM':return[0,i,j];case'YM':return[j,0,i];
    case'ZP':return[i,n-j,n];case'XP':return[n,i,n-j];case'YP':return[n-j,n,i];default:throw new RangeError('H face');}
}
