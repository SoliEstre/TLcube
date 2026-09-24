/**
 * 3D 인쇄 파일 직렬화예요: binary STL · 3MF(OPC 파트 3개) · ZIP(STORE / deflate-raw).
 *
 * 기하는 만들지 않아요. 입력은 설계 §5.1 의 Mesh = {positions: Float64Array(mm), indices: Uint32Array} 이고,
 * 파트는 {id, name, role, hex, mesh, volumeMm3} 에서 name·hex·mesh 만 읽어요. 좌표는 옮기지 않아요 —
 * 모든 파트가 같은 원점을 쓰고, 3MF component 변환은 항등(속성 없음)이에요. 판 위 자리는 build item 의 평행 이동 하나로만
 * 정해요(buildTranslationMm, 설계 §2.2) — Cura 는 3MF 원점을 판 앞-왼 모서리에 두고 옮기지 않아요.
 *
 * 포맷 규약(설계 §2.2):
 * - STL: 80 B 헤더(«solid» 로 시작 금지) + u32 삼각형 수 + 삼각형당 50 B(f32 법선·꼭짓점 3개 + u16 속성 0). 길이 84 + 50T.
 * - 3MF: `[Content_Types].xml` · `_rels/.rels` · `3D/3dmodel.model`(소문자 경로 고정). unit="millimeter".
 *   색은 파트마다 단일색 `m:colorgroup`(id 100+k) 하나이고, 접두 `m:` 은 문자 그대로예요. basematerials·
 *   requiredextensions 는 쓰지 않아요. 구조는 부모 오브젝트 하나 + components(기본) 또는 파트마다 build item.
 * - ZIP: method 0(STORE)·8(deflate)만 써요(3MF 가 허용하는 둘). CRC-32 는 png.js 구현을 그대로 써요.
 *   deflate 는 'deflate-raw' 생성자를 직접 만들어 봐서 탐지하고, 만들기·스트림 도중 어디서든 실패하면 STORE 로 다시 만들어요.
 */
import {crc32} from './png.js';
import {PRINT_TRIANGLE_CAP} from './print-mesh.js';

export const STL_HEADER_TEXT='TrilLuminance H binary STL';
export const DEFAULT_3MF_APPLICATION='TrilLuminance (cube)';
/** 3MF 필수 파트 이름. 이 순서로 ZIP 에 넣어요(OPC 관례상 [Content_Types].xml 이 먼저). */
export const THREEMF_PART_NAMES=Object.freeze(['[Content_Types].xml','_rels/.rels','3D/3dmodel.model']);
export const THREEMF_STRUCTURES=Object.freeze(['components','items']);
export const NS_3MF_CORE='http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
export const NS_3MF_MATERIAL='http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
export const NS_OPC_CONTENT_TYPES='http://schemas.openxmlformats.org/package/2006/content-types';
export const NS_OPC_RELATIONSHIPS='http://schemas.openxmlformats.org/package/2006/relationships';
export const REL_TYPE_3DMODEL='http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
export const CONTENT_TYPE_RELS='application/vnd.openxmlformats-package.relationships+xml';
export const CONTENT_TYPE_3DMODEL='application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
/** 파트 색 그룹 id 시작값이에요(설계 §2.2 «id 100+k»). 오브젝트 id 는 1 부터라 둘이 겹치지 않게 파트 수를 막아요. */
export const COLOR_GROUP_BASE_ID=100;
/** 오브젝트 id 1..K(파트) + K+1(부모)이 색 그룹 id(100 부터)와 겹치지 않는 최대 파트 수예요. */
export const MAX_3MF_PARTS=COLOR_GROUP_BASE_ID-2;
/**
 * 내보내기 삼각형 상한(설계 §2.9 제안: 정상 최대 약 11.4만의 약 2.6배). 넘으면 TLP_TRI_CAP 이에요.
 * 파트를 만드는 print-mesh 의 상한을 그대로 써요 — 사본을 두면 한쪽만 바뀌어 화면 문구({cap})가 실제 상한과 어긋나요.
 */
export const MAX_EXPORT_TRIANGLES=PRINT_TRIANGLE_CAP;
/** «Bambu 파일» 판정 접두(설계 §2.2). 이것으로 시작하면 표준 색 경로가 꺼지므로 받지 않아요. */
const BAMBU_APPLICATION_PREFIX='BambuStudio-';
/** 3MF 좌표 소수 자릿수. 1 nm 해상도라 µm 정수 격자와 핀치 분리 사본(2ε = 50 µm)을 모두 그대로 보존해요. */
const MM_DECIMALS=6;
const MAX_ABS_MM=1e6;

const ZIP_LOCAL_SIG=0x04034b50,ZIP_CENTRAL_SIG=0x02014b50,ZIP_EOCD_SIG=0x06054b50;
const ZIP_LOCAL_BYTES=30,ZIP_CENTRAL_BYTES=46,ZIP_EOCD_BYTES=22;
const ZIP_METHOD_STORE=0,ZIP_METHOD_DEFLATE=8;
/** 만든 버전: 상위 바이트 0 = MS-DOS(FAT) 속성, 하위 20 = 2.0. 풀기 버전은 STORE 1.0 · deflate 2.0 이에요. */
const ZIP_MADE_BY=20,ZIP_VERSION_STORE=10,ZIP_VERSION_DEFLATE=20;
const ZIP_FLAG_UTF8=0x0800;
const U16_MAX=0xffff,U32_MAX=0xffffffff;

const utf8=new TextEncoder();

function tlpError(code,message,extra){const error=new RangeError(message);error.code=code;if(extra)Object.assign(error,extra);return error;}

// ─────────────────────────────────────────────────────────────────────────────
// 메쉬 검사
// ─────────────────────────────────────────────────────────────────────────────

/** 설계 §5.1 Mesh 계약을 확인해요. 인덱스가 정점 밖이면 위상 결함이라 TLP_TOPOLOGY 예요. */
function checkMesh(mesh,label='mesh'){
  if(!mesh||typeof mesh!=='object')throw new TypeError(`${label}: Mesh 객체여야 해요`);
  const {positions,indices}=mesh;
  if(!(positions instanceof Float64Array))throw new TypeError(`${label}: positions 는 Float64Array(mm) 여야 해요`);
  if(!(indices instanceof Uint32Array))throw new TypeError(`${label}: indices 는 Uint32Array 여야 해요`);
  if(positions.length%3!==0)throw new RangeError(`${label}: positions 길이가 3의 배수가 아니에요`);
  if(indices.length%3!==0)throw new RangeError(`${label}: indices 길이가 3의 배수가 아니에요`);
  for(let k=0;k<positions.length;k++){
    const v=positions[k];
    if(!Number.isFinite(v)||Math.abs(v)>MAX_ABS_MM)throw new RangeError(`${label}: 좌표 ${k} 가 유한한 mm 값이 아니에요`);
  }
  const vertexCount=positions.length/3;
  for(let k=0;k<indices.length;k++){
    if(indices[k]>=vertexCount)throw tlpError('TLP_TOPOLOGY',`${label}: 삼각형 인덱스 ${indices[k]} 가 정점 수 ${vertexCount} 밖이에요`);
  }
  return {positions,indices,vertexCount,triangleCount:indices.length/3};
}

function checkTriangleCap(count,cap){
  if(!Number.isSafeInteger(cap)||cap<1)throw new TypeError('삼각형 상한은 양의 정수여야 해요');
  // 걸린 상한을 오류에 실어요 — 화면 문구는 이 값을 그대로 보여 줘요.
  if(count>cap)throw tlpError('TLP_TRI_CAP',`삼각형 ${count} 개가 상한 ${cap} 개를 넘어요`,{triangles:count,triangleCap:cap});
}

/** 파트 삼각형 합계가 상한 안인지 확인해요. STL 묶음처럼 파일을 나눠 내는 경로가 합계를 한 번에 재도록 공개해요. */
export function assertTriangleCap(parts,{triangleCap=MAX_EXPORT_TRIANGLES}={}){
  if(!Array.isArray(parts))throw new TypeError('parts 는 배열이어야 해요');
  let total=0;
  parts.forEach((part,k)=>{total+=checkMesh(part&&part.mesh,`parts[${k}].mesh`).triangleCount;});
  checkTriangleCap(total,triangleCap);
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// binary STL
// ─────────────────────────────────────────────────────────────────────────────

function stlHeaderBytes(header){
  if(typeof header!=='string')throw new TypeError('STL 헤더는 문자열이어야 해요');
  if(!/^[\x20-\x7e]*$/.test(header))throw new RangeError('STL 헤더는 인쇄 가능한 ASCII 여야 해요');
  if(header.length>80)throw new RangeError('STL 헤더는 80 바이트 이하여야 해요');
  // ASCII STL 은 «solid» 로 시작해요. 읽는 쪽이 바이너리를 ASCII 로 오판하지 않게 막아요(대소문자·앞 공백 무관).
  if(/^\s*solid/i.test(header))throw new RangeError('binary STL 헤더는 «solid» 로 시작하면 안 돼요');
  const bytes=new Uint8Array(80);
  for(let k=0;k<header.length;k++)bytes[k]=header.charCodeAt(k);
  return bytes;
}

/**
 * 메쉬 하나를 binary STL 로 써요. 좌표는 mm(f32 LE), 법선은 오른손 감김 (v2−v1)×(v3−v1) 의 단위벡터예요.
 * 넓이가 0 인 삼각형은 법선 (0,0,0) 이에요. 속성 바이트는 늘 0 이에요(색 확장은 호환되지 않아 쓰지 않아요).
 * @param {{positions:Float64Array, indices:Uint32Array}} mesh
 * @param {{header?:string, triangleCap?:number}} [options]
 * @returns {Uint8Array} 길이 84 + 50T
 */
export function meshToBinaryStl(mesh,{header=STL_HEADER_TEXT,triangleCap=MAX_EXPORT_TRIANGLES}={}){
  const {positions,indices,triangleCount}=checkMesh(mesh);
  checkTriangleCap(triangleCount,triangleCap);
  const headerBytes=stlHeaderBytes(header);
  const out=new Uint8Array(84+50*triangleCount);
  const view=new DataView(out.buffer);
  out.set(headerBytes,0);
  view.setUint32(80,triangleCount,true);
  let o=84;
  for(let t=0;t<triangleCount;t++){
    const a=3*indices[3*t],b=3*indices[3*t+1],c=3*indices[3*t+2];
    const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2];
    const vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    const len=Math.hypot(nx,ny,nz);
    if(len>0&&Number.isFinite(len)){nx/=len;ny/=len;nz/=len;}else{nx=0;ny=0;nz=0;}
    view.setFloat32(o,nx,true);view.setFloat32(o+4,ny,true);view.setFloat32(o+8,nz,true);
    o+=12;
    for(const p of [a,b,c]){
      view.setFloat32(o,positions[p],true);view.setFloat32(o+4,positions[p+1],true);view.setFloat32(o+8,positions[p+2],true);
      o+=12;
    }
    view.setUint16(o,0,true);
    o+=2;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3MF
// ─────────────────────────────────────────────────────────────────────────────

const INVALID_XML_CHAR=/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
function xmlText(value,label){
  if(typeof value!=='string')throw new TypeError(`${label}: 문자열이어야 해요`);
  if(INVALID_XML_CHAR.test(value))throw new RangeError(`${label}: XML 에 넣을 수 없는 문자가 있어요`);
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

/** mm 를 고정 소수 6자리로 쓰고 끝 0 을 지워요. 같은 double 은 늘 같은 문자열이라 평면성이 문자열에서도 유지돼요. */
function formatMm(value){
  let s=value.toFixed(MM_DECIMALS);
  if(s.includes('.'))s=s.replace(/0+$/,'').replace(/\.$/,'');
  return s==='-0'?'0':s;
}

function colorOf(hex,label){
  if(typeof hex!=='string'||!/^#[0-9a-f]{6}$/i.test(hex))throw new TypeError(`${label}: hex 는 '#rrggbb' 여야 해요`);
  return `${hex.toUpperCase()}FF`;
}

function checkApplication(application){
  if(typeof application!=='string'||application.length===0)throw new TypeError('application 은 빈 문자열이 아니어야 해요');
  if(application.startsWith(BAMBU_APPLICATION_PREFIX))throw new RangeError(`application 이 «${BAMBU_APPLICATION_PREFIX}» 로 시작하면 슬라이서가 표준 색을 읽지 않아요`);
  return xmlText(application,'application');
}

/**
 * build item 의 평행 이동만 쓰는 변환 속성이에요. 3MF 코어 §3.3 의 행 우선 4×4 아핀 행렬에서 앞 3열만 적는 꼴(4행×3열,
 * «m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32»)이고, 이동은 4행(m30 m31 m32)이에요.
 * 회전·배율은 받지 않아요 — 메쉬는 이미 인쇄 방향 틀이고, 이 변환은 판 위 자리만 정해요. null 이면 속성이 없어요(항등).
 * 판 위 자리라서 x·y 는 0 이상(양의 8분 공간 — 스펙 §3.3 권고), z 는 0 이에요(바닥이 판에 닿은 채로 둬요).
 */
function translationAttr(translation){
  if(translation==null)return '';
  if(!Array.isArray(translation)||translation.length!==3||!translation.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=MAX_ABS_MM))
    throw new RangeError('buildTranslationMm 은 유한한 mm 수 3개 [x, y, z] 여야 해요');
  if(translation[0]<0||translation[1]<0||translation[2]!==0)throw new RangeError('buildTranslationMm 은 판 위 자리예요 — x·y 는 0 이상, z 는 0 이어야 해요');
  if(translation.every(v=>v===0))return '';
  return ` transform="1 0 0 0 1 0 0 0 1 ${translation.map(formatMm).join(' ')}"`;
}

function meshObjectXml(id,name,colorGroupId,mesh,label){
  const {positions,indices,vertexCount,triangleCount}=checkMesh(mesh,label);
  // 3MF 모델 오브젝트는 닫힌 매니폴드여야 하고(삼각형 4개 이상), 삼각형의 세 정점 인덱스가 서로 달라야 해요.
  if(triangleCount<4)throw tlpError('TLP_TOPOLOGY',`${label}: 3MF 모델 오브젝트는 삼각형이 4개 이상이어야 해요`);
  const out=[`<object id="${id}" type="model" name="${name}" pid="${colorGroupId}" pindex="0">\n<mesh>\n<vertices>\n`];
  for(let v=0;v<vertexCount;v++){
    out.push(`<vertex x="${formatMm(positions[3*v])}" y="${formatMm(positions[3*v+1])}" z="${formatMm(positions[3*v+2])}"/>\n`);
  }
  out.push('</vertices>\n<triangles>\n');
  for(let t=0;t<triangleCount;t++){
    const a=indices[3*t],b=indices[3*t+1],c=indices[3*t+2];
    if(a===b||b===c||a===c)throw tlpError('TLP_TOPOLOGY',`${label}: 삼각형 ${t} 의 정점 인덱스가 겹쳐요`);
    out.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>\n`);
  }
  out.push('</triangles>\n</mesh>\n</object>\n');
  return out.join('');
}

/**
 * 파트 목록을 3MF 패키지 파트 3개로 써요. ZIP 은 zipStore / zipDeflate 가 맡아요.
 * - structure 'components'(기본): 파트 오브젝트 1..K(각자 mesh·pid·pindex=0) 뒤에 mesh 없는 부모 오브젝트 K+1 이
 *   `<components>` 로 파트를 한 번씩 참조하고, build item 은 부모 하나예요.
 * - structure 'items': 부모 없이 파트마다 build item 하나예요.
 * 메쉬 좌표는 옮기지 않아요. component 변환은 쓰지 않고, buildTranslationMm 이 있으면 build item 마다 같은 평행 이동
 * (판 위 자리 — print-mesh printBedPlacement)을 붙여요. 없으면(기본) 변환 속성이 하나도 없어요.
 * @param {Array<{name?:string, id?:string, hex:string, mesh:{positions:Float64Array, indices:Uint32Array}}>} parts
 * @param {{application?:string, structure?:'components'|'items', modelName?:string, triangleCap?:number, buildTranslationMm?:number[]|null}} [options]
 * @returns {Array<{name:string, data:Uint8Array}>} THREEMF_PART_NAMES 순서
 */
export function partsTo3mfFiles(parts,{application=DEFAULT_3MF_APPLICATION,structure='components',modelName='TrilLuminance H',triangleCap=MAX_EXPORT_TRIANGLES,buildTranslationMm=null}={}){
  if(!Array.isArray(parts)||parts.length===0)throw new RangeError('3MF 에 넣을 파트가 1개 이상 있어야 해요');
  if(parts.length>MAX_3MF_PARTS)throw new RangeError(`3MF 파트는 ${MAX_3MF_PARTS}개 이하여야 해요`);
  if(!THREEMF_STRUCTURES.includes(structure))throw new RangeError(`structure 는 ${THREEMF_STRUCTURES.join(' | ')} 중 하나여야 해요`);
  const applicationXml=checkApplication(application);
  const modelNameXml=xmlText(modelName,'modelName');
  const itemTransform=translationAttr(buildTranslationMm);
  assertTriangleCap(parts,{triangleCap});
  const groups=[],objects=[],partIds=[];
  parts.forEach((part,k)=>{
    const label=`parts[${k}]`;
    if(!part||typeof part!=='object')throw new TypeError(`${label}: 파트 객체여야 해요`);
    const color=colorOf(part.hex,label);
    const rawName=part.name??part.id??`part-${k+1}`;
    const name=xmlText(String(rawName),`${label}.name`);
    const groupId=COLOR_GROUP_BASE_ID+k,objectId=k+1;
    groups.push(`<m:colorgroup id="${groupId}">\n<m:color color="${color}"/>\n</m:colorgroup>\n`);
    objects.push(meshObjectXml(objectId,name,groupId,part.mesh,`${label}.mesh`));
    partIds.push(objectId);
  });
  let build;
  if(structure==='components'){
    const parentId=parts.length+1;
    objects.push(`<object id="${parentId}" type="model" name="${modelNameXml}">\n<components>\n${partIds.map(id=>`<component objectid="${id}"/>\n`).join('')}</components>\n</object>\n`);
    build=`<item objectid="${parentId}"${itemTransform}/>\n`;
  }else{
    build=partIds.map(id=>`<item objectid="${id}"${itemTransform}/>\n`).join('');
  }
  const model='<?xml version="1.0" encoding="UTF-8"?>\n'
    +`<model unit="millimeter" xml:lang="en-US" xmlns="${NS_3MF_CORE}" xmlns:m="${NS_3MF_MATERIAL}">\n`
    +`<metadata name="Application">${applicationXml}</metadata>\n`
    +`<resources>\n${groups.join('')}${objects.join('')}</resources>\n`
    +`<build>\n${build}</build>\n</model>\n`;
  const contentTypes='<?xml version="1.0" encoding="UTF-8"?>\n'
    +`<Types xmlns="${NS_OPC_CONTENT_TYPES}">`
    +`<Default Extension="rels" ContentType="${CONTENT_TYPE_RELS}"/>`
    +`<Default Extension="model" ContentType="${CONTENT_TYPE_3DMODEL}"/>`
    +'</Types>\n';
  const rels='<?xml version="1.0" encoding="UTF-8"?>\n'
    +`<Relationships xmlns="${NS_OPC_RELATIONSHIPS}">`
    +`<Relationship Target="/${THREEMF_PART_NAMES[2]}" Id="rel0" Type="${REL_TYPE_3DMODEL}"/>`
    +'</Relationships>\n';
  return [contentTypes,rels,model].map((text,k)=>({name:THREEMF_PART_NAMES[k],data:utf8.encode(text)}));
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DOS 시각·날짜(로컬 시각, 2초 단위)예요. mtime 이 없으면 DOS 기점 1980-01-01 00:00:00 이라
 * 시간대와 무관하게 바이트가 고정돼요. 1980 이전은 기점으로, 2107 이후는 2107-12-31 23:59:58 로 눌러요.
 */
function dosDateTime(mtime){
  if(mtime==null)return {time:0,date:(1<<5)|1};
  const date=mtime instanceof Date?mtime:typeof mtime==='number'?new Date(mtime):null;
  if(!date||!Number.isFinite(date.getTime()))throw new TypeError('mtime 은 Date 또는 유효한 ms 수여야 해요');
  const year=date.getFullYear();
  if(year<1980)return {time:0,date:(1<<5)|1};
  if(year>2107)return {time:(23<<11)|(59<<5)|29,date:(127<<9)|(12<<5)|31};
  return {
    time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),
    date:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate(),
  };
}

function normalizeEntries(files){
  if(!Array.isArray(files))throw new TypeError('files 는 {name, data} 배열이어야 해요');
  if(files.length>U16_MAX)throw new RangeError('ZIP64 없이 담을 수 있는 엔트리 수를 넘었어요');
  const seen=new Set();
  return files.map((file,k)=>{
    const label=`files[${k}]`;
    if(!file||typeof file!=='object')throw new TypeError(`${label}: {name, data} 여야 해요`);
    const {name,data}=file;
    if(typeof name!=='string'||name.length===0)throw new TypeError(`${label}: 이름이 빈 문자열이 아니어야 해요`);
    // ZIP 이름은 상대 경로 «/» 구분이에요. 절대 경로·역슬래시·NUL·«..» 조각은 풀 때 경로 밖으로 새므로 받지 않아요.
    if(name.startsWith('/')||name.includes('\\')||name.includes('\0')||name.split('/').some(seg=>seg===''||seg==='.'||seg==='..'))
      throw new RangeError(`${label}: 쓸 수 없는 엔트리 이름이에요: ${name}`);
    if(INVALID_XML_CHAR.test(name))throw new RangeError(`${label}: 이름에 제어 문자나 짝 없는 대리 쌍이 있어요`);
    if(seen.has(name))throw new RangeError(`${label}: 엔트리 이름이 겹쳐요: ${name}`);
    seen.add(name);
    if(!(data instanceof Uint8Array))throw new TypeError(`${label}: data 는 Uint8Array 여야 해요`);
    const nameBytes=utf8.encode(name);
    if(nameBytes.length>U16_MAX)throw new RangeError(`${label}: 이름이 너무 길어요`);
    return {nameBytes,utf8Name:nameBytes.some(b=>b>0x7f),data,crc:crc32(data)};
  });
}

const storedOf=entry=>({...entry,method:ZIP_METHOD_STORE,packed:entry.data});

function assembleZip(entries,mtime){
  const {time,date}=dosDateTime(mtime);
  let localBytes=0,centralBytes=0;
  for(const e of entries){
    localBytes+=ZIP_LOCAL_BYTES+e.nameBytes.length+e.packed.length;
    centralBytes+=ZIP_CENTRAL_BYTES+e.nameBytes.length;
    if(e.data.length>U32_MAX||e.packed.length>U32_MAX)throw new RangeError('ZIP64 없이 담을 수 있는 크기를 넘었어요');
  }
  const total=localBytes+centralBytes+ZIP_EOCD_BYTES;
  if(localBytes>U32_MAX||total>U32_MAX)throw new RangeError('ZIP64 없이 담을 수 있는 크기를 넘었어요');
  const out=new Uint8Array(total);
  const view=new DataView(out.buffer);
  const header=(o,e)=>{
    // 로컬 헤더와 중앙 디렉터리가 공유하는 필드(풀기 버전 · 플래그 · 방식 · 시각 · 날짜 · CRC · 크기 2 · 이름 길이)예요.
    view.setUint16(o,e.method===ZIP_METHOD_DEFLATE?ZIP_VERSION_DEFLATE:ZIP_VERSION_STORE,true);
    view.setUint16(o+2,e.utf8Name?ZIP_FLAG_UTF8:0,true);
    view.setUint16(o+4,e.method,true);
    view.setUint16(o+6,time,true);
    view.setUint16(o+8,date,true);
    view.setUint32(o+10,e.crc,true);
    view.setUint32(o+14,e.packed.length,true);
    view.setUint32(o+18,e.data.length,true);
    view.setUint16(o+22,e.nameBytes.length,true);
  };
  const offsets=[];
  let o=0;
  for(const e of entries){
    offsets.push(o);
    view.setUint32(o,ZIP_LOCAL_SIG,true);
    header(o+4,e);
    view.setUint16(o+28,0,true);
    out.set(e.nameBytes,o+ZIP_LOCAL_BYTES);
    o+=ZIP_LOCAL_BYTES+e.nameBytes.length;
    out.set(e.packed,o);
    o+=e.packed.length;
  }
  const centralOffset=o;
  entries.forEach((e,k)=>{
    view.setUint32(o,ZIP_CENTRAL_SIG,true);
    view.setUint16(o+4,ZIP_MADE_BY,true);
    header(o+6,e);
    view.setUint16(o+30,0,true); // extra 길이
    view.setUint16(o+32,0,true); // 주석 길이
    view.setUint16(o+34,0,true); // 시작 디스크
    view.setUint16(o+36,0,true); // 내부 속성
    view.setUint32(o+38,0,true); // 외부 속성
    view.setUint32(o+42,offsets[k],true);
    out.set(e.nameBytes,o+ZIP_CENTRAL_BYTES);
    o+=ZIP_CENTRAL_BYTES+e.nameBytes.length;
  });
  view.setUint32(o,ZIP_EOCD_SIG,true);
  view.setUint16(o+4,0,true);
  view.setUint16(o+6,0,true);
  view.setUint16(o+8,entries.length,true);
  view.setUint16(o+10,entries.length,true);
  view.setUint32(o+12,centralBytes,true);
  view.setUint32(o+16,centralOffset,true);
  view.setUint16(o+20,0,true);
  return out;
}

/**
 * 압축 없는(method 0) ZIP 이에요. 같은 입력·같은 mtime 이면 바이트가 같아요.
 * @param {Array<{name:string, data:Uint8Array}>} files 넣는 순서 그대로 담아요
 * @param {{mtime?:Date|number|null}} [options] 없으면 DOS 기점(시간대 무관 고정)
 * @returns {Uint8Array}
 */
export function zipStore(files,{mtime=null}={}){
  return assembleZip(normalizeEntries(files).map(storedOf),mtime);
}

/**
 * 이 런타임이 'deflate-raw' CompressionStream 을 만들 수 있는지예요. `typeof CompressionStream==='function'` 만으로는
 * 모자라요 — gzip·deflate 만 받는 구현이 있어서 형식별 생성자를 직접 만들어 봐요(설계 §2.2).
 */
export function supportsDeflateRaw(){
  const Ctor=globalThis.CompressionStream;
  if(typeof Ctor!=='function')return false;
  try{new Ctor('deflate-raw');return true;}catch{return false;}
}

async function deflateRaw(bytes){
  const stream=new globalThis.CompressionStream('deflate-raw');
  const writer=stream.writable.getWriter();
  const reader=stream.readable.getReader();
  const writing=(async()=>{await writer.write(bytes);await writer.close();})();
  // 쓰기가 실패하면 읽기 쪽이 끝나지 않을 수 있어요. 쓰기 실패만 거부로 바꿔 읽기와 경주시켜요(성공이면 영영 안 끝나요).
  const writeFailed=writing.then(()=>new Promise(()=>{}));
  writeFailed.catch(()=>{});
  const chunks=[];
  let total=0;
  try{
    for(;;){
      const {done,value}=await Promise.race([reader.read(),writeFailed]);
      if(done)break;
      const chunk=value instanceof Uint8Array?value:new Uint8Array(value);
      chunks.push(chunk);
      total+=chunk.length;
    }
    await writing;
  }catch(error){
    if(typeof reader.cancel==='function')Promise.resolve().then(()=>reader.cancel(error)).catch(()=>{});
    throw error;
  }
  const out=new Uint8Array(total);
  let o=0;
  for(const chunk of chunks){out.set(chunk,o);o+=chunk.length;}
  return out;
}

/**
 * deflate(method 8) ZIP 이에요. 엔트리마다 'deflate-raw' 로 압축하고, 결과가 원본보다 작지 않으면 그 엔트리는 STORE 로 둬요.
 * 'deflate-raw' 생성자가 없거나 던지면, 또는 어느 엔트리의 스트림 도중에 실패하면 전체를 zipStore 와 같은 바이트로 만들어요.
 * 입력 검증 오류는 폴백하지 않고 그대로 던져요.
 * @param {Array<{name:string, data:Uint8Array}>} files
 * @param {{mtime?:Date|number|null}} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function zipDeflate(files,{mtime=null}={}){
  const entries=normalizeEntries(files);
  dosDateTime(mtime); // mtime 오류도 폴백 전에 드러내요.
  let packedEntries=null;
  if(supportsDeflateRaw()){
    try{
      packedEntries=[];
      for(const entry of entries){
        const packed=await deflateRaw(entry.data);
        packedEntries.push(packed.length<entry.data.length?{...entry,method:ZIP_METHOD_DEFLATE,packed}:storedOf(entry));
      }
    }catch{
      packedEntries=null;
    }
  }
  return assembleZip(packedEntries??entries.map(storedOf),mtime);
}
