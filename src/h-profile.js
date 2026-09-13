/** H-v2 광학 프로파일. 표시는 Y 그룹, 와이어와 부분면 수집은 독립이에요. */
export const H_SCHEMA = 'TL:YH:v2;ringCW;tag=1,2,m-2,m-1;format=0,m/2-1;route=m/2,m/2+1;side-major-LSB;formatBits=tone3@0,ecc[L,M,H]@1:2,mask@3:5,xor024@6,xor135@7;tagWords=0017,002b,0059,0065,011c,0143;tag3=first3;tag6=complement6;binary=100,010,001,011,101,110;A=ZM,XM,YM;B=ZP,XP,YP;block-concat;';
// 내부 사각 파인더는 별도 CRC 도메인이에요. 기존 frame 바이트열을 바꾸지 않아요.
export const H_SCHEMA_CORNER = 'TL:YH:v2c;corners10;book=544c4843-d8;row-major-LSB36;format2x2;route2x2;ref2x2x9;A=ZM,XM,YM;B=ZP,XP,YP;block-concat;';
export const H_SCHEMA_FACES = 'TL:YH:v2f;groups=mode-bound;pair2=radix4-msd4;pair3=lehmerTL;triad=base6;packet=group;length=u16;crc32c=shared;route=crc8;';
export const H_SCHEMA_FACES_CORNER = 'TL:YH:v2fc;corners10;groups=mode-bound;pair2=radix4-msd4;pair3=lehmerTL;triad=base6;packet=group;length=u16;crc32c=shared;route=crc8;';
// 한 물리면의 scan 전반/후반을 짝지으며, 기존 다면 CRC 도메인은 바꾸지 않아요.
export const H_SCHEMA_SINGLE = 'TL:YH:v2s;frame;face=XM;half=floor(scan/2);pair=k,k+half;mask=first-cell;tail=unmasked0;pair2=radix4-msd4;pair3=lehmerTL;packet=single;length=u16;crc32c=shared;route=crc8;';
export const H_SCHEMA_SINGLE_CORNER = 'TL:YH:v2sc;corners10;face=XM;half=floor(scan/2);pair=k,k+half;mask=first-cell;tail=unmasked0;pair2=radix4-msd4;pair3=lehmerTL;packet=single;length=u16;crc32c=shared;route=crc8;';
export const H_FACE_IDS = Object.freeze(['ZM', 'XM', 'YM', 'ZP', 'XP', 'YP']);
const H_MODE_GROUPS = Object.freeze({
  1: Object.freeze([Object.freeze(['XM'])]),
  2: Object.freeze([Object.freeze(['XM','YM'])]),
  3: Object.freeze([Object.freeze(['ZM','XM','YM'])]),
  4: Object.freeze([Object.freeze(['XM','YM']),Object.freeze(['XP','YP'])]),
  5: Object.freeze([Object.freeze(['ZM','XM','YM']),Object.freeze(['XP','YP'])]),
  6: Object.freeze([Object.freeze(['ZM','XM','YM']),Object.freeze(['ZP','XP','YP'])]),
});
export function hModeGroups(mode) { const groups=Number.isInteger(mode)&&H_MODE_GROUPS[mode]; if(!groups)throw new RangeError('H mode'); return groups.map(group=>group.slice()); }
export function hModeFaces(mode) { return hModeGroups(mode).flat(); }
export function isLegacyHMode(mode) { return mode===3||mode===6; }
export const H_ECC = Object.freeze(['L', 'M', 'H']);
export const H_ECC_RATIOS = Object.freeze({ L: 0.12, M: 0.25, H: 0.40 });
export const H_BINARY = Object.freeze([[1,0,0],[0,1,0],[0,0,1],[0,1,1],[1,0,1],[1,1,0]].map(Object.freeze));
/** 생성기의 자동 배치 정책. 라이브러리 기본값 frame은 하위 호환을 유지해요. */
export function resolveHFinder(version,mode,finder='frame') {
  if(!Number.isInteger(version)||version<0||version>8||!Number.isInteger(mode)||!H_MODE_GROUPS[mode]
    ||!['frame','corners','auto'].includes(finder))throw new RangeError('H finder profile');
  const resolved=finder==='auto'?(isLegacyHMode(mode)?(version>=(mode===3?5:7)?'corners':'frame'):(version>=5?'corners':'frame')):finder;
  if(resolved==='corners'&&version<5)throw new RangeError('H corners requires H5..H8');
  return resolved;
}
export function normalizeHProfile({version=0, mode=3, tones=3, ecc='M', mask=0,finder='frame'}={}) {
  if (!Number.isInteger(version) || version < 0 || version > 8 || !Number.isInteger(mode)||!H_MODE_GROUPS[mode]
    || ![2,3].includes(tones) || !H_ECC.includes(ecc) || !Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new RangeError('H profile: H0..H8, 1..6 faces, 2/3 tones, ECC L/M/H, mask 0..7');
  }
  return {version, n:13+4*version, mode, tones, ecc, mask,finder:resolveHFinder(version,mode,finder)};
}
/** 하위6bit=톤1+ECC2+마스크3, 위2bit=짝/홀 위치 패리티. 1bit 오류는 모두 거부해요. */
export function hFormatByte(profile) {
  const p=normalizeHProfile(profile), d=(p.tones===3?1:0)|(H_ECC.indexOf(p.ecc)<<1)|(p.mask<<3);
  const a=((d>>0)^(d>>2)^(d>>4))&1, b=((d>>1)^(d>>3)^(d>>5))&1;
  return d|(a<<6)|(b<<7);
}
export function readHFormatByte(byte) {
  if (!Number.isInteger(byte)||byte<0||byte>255) return null;
  const ecc=H_ECC[(byte>>1)&3];
  if (!ecc) return null;
  const p={tones:(byte&1)?3:2,ecc,mask:(byte>>3)&7};
  return hFormatByte(p)===byte?p:null;
}
/** 마스크는 면색이 아니라 base-6 digit에 가산해2톤의 합법6상태를 보존해요. */
export function hMaskValue(mask,i,j) {
  return [0,(i+j)%2,i%2,j%3,(i+j)%3,(Math.floor(i/2)+Math.floor(j/3))%2,(i*j)%6,((i*j)%3+i+j)%6][mask];
}
export function hReferenceLevel(i,j,tones) { return (i+j)%tones; }
