/** H의 논리 데이터와 표시 물리면을 분리해 모든 렌더·내보내기가 같은 배치를 사용해요. */
import {H_FACE_IDS,hModeFaces} from './h-profile.js';
export const H_DISPLAY_FACES = H_FACE_IDS;
export const H_ARRANGEMENTS = Object.freeze(['isometric', 'horizontal', 'vertical']);
const DISPLAY_FACES = new Set(H_DISPLAY_FACES);

function checkedMode(encoded) {
  const mode = Number(encoded?.mode);
  if (![1,2,3,4,5,6].includes(mode)) throw new RangeError('H display map mode must be 1..6');
  return mode;
}
function checkedArrangement(value = 'isometric') {
  if (!H_ARRANGEMENTS.includes(value)) throw new RangeError('H arrangement must be isometric, horizontal, or vertical');
  return value;
}
function checkedRenderFaces(mode, arrangement, value) {
  const fallback = mode >= 4 ? 6 : 3;
  const renderFaces = value ?? fallback;
  if (![3, 6].includes(renderFaces)) throw new RangeError('H renderFaces must be 3 or 6');
  if (mode >= 4 && renderFaces !== 6) throw new RangeError('H 4..6 data requires renderFaces=6');
  if (arrangement !== 'isometric' && mode > 4) throw new RangeError('horizontal/vertical arrangement accepts at most 4 data faces');
  return renderFaces;
}
function sourceFaces(encoded, mode) {
  // 새 encoder는 mode별 논리 face만 넣어야 해요. 레거시3/6을 그대로 통과시키되
  // unknown key나 불완전 입력은 소비자가 명시적으로 실패하게 남겨요.
  const source = encoded?.faces ?? {};
  for (const face of Object.keys(source)) if (!DISPLAY_FACES.has(face)) throw new RangeError('H logical face id');
  return hModeFaces(mode).filter(face => Object.hasOwn(source, face));
}

/**
 * 각 physical face에서 읽을 logical encoded.faces key예요. null은 빈 display face예요.
 * 배열을 만들 때 복제해 반환하므로 호출자가 map을 변이해도 encoded에는 영향이 없어요.
 */
export function hDisplayMap(encoded, { arrangement = 'isometric', renderFaces } = {}) {
  const mode = checkedMode(encoded), resolvedArrangement = checkedArrangement(arrangement);
  const resolvedRenderFaces = checkedRenderFaces(mode, resolvedArrangement, renderFaces);
  const present = new Set(sourceFaces(encoded, mode));
  const physicalToLogical = Object.fromEntries(H_DISPLAY_FACES.map(face => [face, null]));
  if (resolvedArrangement === 'isometric') {
    for (const face of present) physicalToLogical[face] = face;
  } else {
    // Z-/Z+는 회전축 cap이라 code를 싣지 않아요. logical ZM만 XP로 옮겨요.
    for (const face of ['XM', 'YM', 'XP', 'YP']) if (present.has(face)) physicalToLogical[face] = face;
    if (present.has('ZM')) physicalToLogical.XP = 'ZM';
  }
  // 2F six-render만 반대 side에 code를 복제해요. 이는 표시용이며 encoded.faces에는 쓰지 않아요.
  if (mode === 2 && resolvedRenderFaces === 6) {
    physicalToLogical.XP = present.has('XM') ? 'XM' : null;
    physicalToLogical.YP = present.has('YM') ? 'YM' : null;
  }
  if (mode === 1 && resolvedRenderFaces === 6) physicalToLogical.XP = present.has('XM') ? 'XM' : null;
  const physicalDataFaces = H_DISPLAY_FACES.filter(face => physicalToLogical[face] !== null);
  const logicalDataFaces = hModeFaces(mode).filter(face => present.has(face));
  const imageAlias = Object.fromEntries(H_DISPLAY_FACES.map(face => [face, face]));
  // 2F/6-render의 두 cap은 하나의 이미지 선택을 공유해요. ZP는 독립 source가 아니에요.
  if (mode === 2 && resolvedRenderFaces === 6 && !physicalToLogical.ZM && !physicalToLogical.ZP) imageAlias.ZP = 'ZM';
  if (mode === 1 && resolvedRenderFaces === 6) {
    imageAlias.ZP = 'ZM';
    imageAlias.YP = 'YM';
  }
  const blankFaces = H_DISPLAY_FACES.filter(face => !physicalToLogical[face]);
  const imageTargets = blankFaces.filter(face => imageAlias[face] === face)
    .map(face => Object.freeze({ face, aliases: Object.freeze(blankFaces.filter(other => imageAlias[other] === face)) }));
  const sourceSignature = H_DISPLAY_FACES.map(face => `${face}:${physicalToLogical[face] ?? '-'}`).join(',');
  const imageSignature = H_DISPLAY_FACES.map(face => `${face}:${imageAlias[face]}`).join(',');
  return Object.freeze({ mode, arrangement: resolvedArrangement, renderFaces: resolvedRenderFaces,
    physicalToLogical: Object.freeze(physicalToLogical), physicalDataFaces: Object.freeze(physicalDataFaces),
    logicalDataFaces: Object.freeze(logicalDataFaces), blankFaces: Object.freeze(blankFaces),
    imageAlias: Object.freeze(imageAlias), imageTargets: Object.freeze(imageTargets),
    cacheKey: `${mode}|${resolvedArrangement}|${resolvedRenderFaces}|${sourceSignature}|${imageSignature}` });
}

/** UI는 physical image card와 alias를 이 결과만으로 만들어야 해요. */
export function hImageTargets(encoded, options = {}) {
  return hDisplayMap(encoded, options).imageTargets.map(target => ({ face: target.face, aliases: [...target.aliases] }));
}
/** 코드 logical ID와 사용자가 설정한 image source를 한 큐브 시점에서 모두 보여줄 수 있나요? */
function hFaceContents(encoded,faceImages,options){
  const map=hDisplayMap(encoded,options),contents={};
  for(const face of H_DISPLAY_FACES){
    const code=map.physicalToLogical[face],image=map.imageAlias[face];
    contents[face]=code?`code:${code}`:faceImages[image]?`image:${image}`:null;
  }
  return contents;
}
/** 현재 투영의 실제 visible face가 모든 고유 콘텐츠를 포함하나요? */
export function hContentFitsVisibleFaces(encoded,faceImages={},options={},faces=[]){
  const contents=hFaceContents(encoded,faceImages,options),required=new Set(Object.values(contents).filter(Boolean));
  const visible=new Set(faces.map(face=>contents[face]).filter(Boolean));
  return [...required].every(id=>visible.has(id));
}
export function hContentFitsSingleView(encoded,faceImages={},options={}){
  const contents=hFaceContents(encoded,faceImages,options),required=new Set(Object.values(contents).filter(Boolean));
  for(const x of ['XM','XP'])for(const y of ['YM','YP'])for(const z of ['ZM','ZP']){
    const visible=new Set([x,y,z].map(face=>contents[face]).filter(Boolean));
    if([...required].every(id=>visible.has(id)))return true;
  }
  return false;
}

/** physical face에 표시할 자산과 원래 asset key를 함께 반환해 cache/import가 alias를 보존해요. */
export function hDisplayImageSource(displayMap, faceImages, physicalFace) {
  if (!displayMap?.blankFaces?.includes(physicalFace)) return null;
  const sourceFace = displayMap.imageAlias[physicalFace];
  const image = faceImages?.[sourceFace];
  return image ? { face: physicalFace, sourceFace, image } : null;
}
