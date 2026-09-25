/** H의 논리 데이터와 표시 물리면을 분리해 모든 렌더·내보내기가 같은 배치를 사용해요. */
import {H_FACE_IDS,hModeFaces} from './h-profile.js';
export const H_DISPLAY_FACES = H_FACE_IDS;
/** symmetric: 2면 전용 — 두 논리 면(XM·YM)을 마주보는 물리 XM·XP 에 둬요(운영자 2026-09-14). */
export const H_ARRANGEMENTS = Object.freeze(['isometric', 'horizontal', 'vertical', 'symmetric']);
const DISPLAY_FACES = new Set(H_DISPLAY_FACES);
const H_OPPOSITE_PAIRS = Object.freeze([['ZM', 'ZP'], ['XM', 'XP'], ['YM', 'YP']]);

function checkedMode(encoded) {
  const mode = Number(encoded?.mode);
  if (![1,2,3,4,5,6].includes(mode)) throw new RangeError('H display map mode must be 1..6');
  return mode;
}
function checkedArrangement(value = 'isometric') {
  if (!H_ARRANGEMENTS.includes(value)) throw new RangeError('H arrangement must be isometric, horizontal, vertical, or symmetric');
  return value;
}
function checkedRenderFaces(mode, arrangement, value) {
  const fallback = mode >= 4 || arrangement === 'symmetric' ? 6 : 3;
  const renderFaces = value ?? fallback;
  if (![3, 6].includes(renderFaces)) throw new RangeError('H renderFaces must be 3 or 6');
  if (mode >= 4 && renderFaces !== 6) throw new RangeError('H 4..6 data requires renderFaces=6');
  if (arrangement === 'symmetric') {
    if (renderFaces !== 6) throw new RangeError('symmetric arrangement requires renderFaces=6');
  } else if (arrangement !== 'isometric' && mode > 4) throw new RangeError('horizontal/vertical arrangement accepts at most 4 data faces');
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
  const mode = checkedMode(encoded);
  // 대칭은 2면 전용이에요. 면 수를 바꾼 직후 재인코딩 전 프레임처럼 mode 가 2가 아니면 아이소메트릭으로 그려요(상태 정규화가 뒤따라요).
  const resolvedArrangement = checkedArrangement(arrangement) === 'symmetric' && mode !== 2 ? 'isometric' : checkedArrangement(arrangement);
  const resolvedRenderFaces = checkedRenderFaces(mode, resolvedArrangement, renderFaces);
  const present = new Set(sourceFaces(encoded, mode));
  const physicalToLogical = Object.fromEntries(H_DISPLAY_FACES.map(face => [face, null]));
  if (resolvedArrangement === 'isometric') {
    for (const face of present) physicalToLogical[face] = face;
    // 4면(논리 XM·YM·XP·YP)은 논리 YP 를 물리 ZM 에 두어 빈 면이 ZP·YP 로 이웃하게 해요(운영자 2026-09-14).
    // 면 tag·wire 는 그대로라 스캐너/HUD 는 계속 논리 ID 를 읽어요 — 수평/수직의 ZM→XP 이동과 같은 부류예요.
    if (mode === 4) { physicalToLogical.ZM = present.has('YP') ? 'YP' : null; physicalToLogical.YP = null; }
  } else if (resolvedArrangement === 'symmetric') {
    // 두 논리 면을 마주보는 물리 XM·XP 에 둬요. 반대편 복제는 하지 않아요 — 나머지 네 면은 이미지 자리예요.
    physicalToLogical.XM = present.has('XM') ? 'XM' : null;
    physicalToLogical.XP = present.has('YM') ? 'YM' : null;
  } else {
    // Z-/Z+는 회전축 cap이라 code를 싣지 않아요. logical ZM만 XP로 옮겨요.
    for (const face of ['XM', 'YM', 'XP', 'YP']) if (present.has(face)) physicalToLogical[face] = face;
    if (present.has('ZM')) physicalToLogical.XP = 'ZM';
  }
  // 1…3면 + 6면 렌더(«6면 (반복)»)는 코드가 있는 물리면을 마주보는 빈 물리면에 같은 (i,j) 로 복제해요.
  // 표시용이며 encoded.faces 에는 쓰지 않아요. 수평/수직의 ZM/ZP cap 은 둘 다 비어 있어 자동으로 빠지고,
  // 대칭은 XM·XP 가 서로 짝이라 복제가 없어요. 4…6면은 «반복» 이 아니라 6면 렌더가 필수라 제외해요.
  const repeat = mode <= 3 && resolvedRenderFaces === 6 && resolvedArrangement !== 'symmetric';
  if (repeat) for (const [m, p] of H_OPPOSITE_PAIRS) physicalToLogical[p] ??= physicalToLogical[m];
  const physicalDataFaces = H_DISPLAY_FACES.filter(face => physicalToLogical[face] !== null);
  const logicalDataFaces = hModeFaces(mode).filter(face => present.has(face));
  const imageAlias = Object.fromEntries(H_DISPLAY_FACES.map(face => [face, face]));
  // 반복 렌더에서 둘 다 빈 마주보는 짝은 하나의 이미지 선택을 공유해요(P 는 독립 source 가 아니에요).
  if (repeat) for (const [m, p] of H_OPPOSITE_PAIRS) if (!physicalToLogical[m] && !physicalToLogical[p]) imageAlias[p] = m;
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
/** 코드 logical ID와 사용자가 설정한 image source를 한 큐브 시점에서 모두 보여줄 수 있나요?
 *  TL 스캐너 QR 면(content 'qr')은 모두 같은 QR 이라 공유 id 'qr' 하나로 세요 — 한 장만 보여도 되고, 평면 보기에는 최소 한 장이 보여요. */
function hFaceContents(encoded,faceImages,options){
  const map=hDisplayMap(encoded,options),contents={};
  for(const face of H_DISPLAY_FACES){
    const code=map.physicalToLogical[face],image=map.imageAlias[face],asset=faceImages[image];
    contents[face]=code?`code:${code}`:asset?(asset.content==='qr'?'qr':`image:${image}`):null;
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
