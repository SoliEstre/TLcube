/** 표시 타입Y 아래의 실질 와이어 선택과 옵션 전이. 기존Y 상태는 따로 보존해요. */
import {orbitStateToViewerInput,orbitTToPersp,orbitRadToDeg,ORBIT_PERSP_MAX_DEG} from './generator-orbit-view.js';
import {hAutoRotation,hPalette} from './h-render.js';
import {hMaskValue} from './h-profile.js';
import {H_ARRANGEMENTS} from './h-face-arrangement.js';
import {composeHRotation,hOrbitRotation,hOrbitFromRotation,hDragRotation,hAlignmentRotation,H_ROTATION_TILT_MAX_DEG,H_ROTATION_TILT_DEFAULT_DEG,H_ROTATION_TILT_MODES} from './h-rotation.js';
export {H_ROTATION_TILT_MAX_DEG,H_ROTATION_TILT_DEFAULT_DEG,H_ROTATION_TILT_MODES} from './h-rotation.js';
export {H_ARRANGEMENTS} from './h-face-arrangement.js';
export {hOrbitFromRotation} from './h-rotation.js';
export const H_RESOLUTION_VERSIONS=Object.freeze({auto:'auto',low:0,mid:2,high:4,max:6,ultra:8});
export const H_ROTATION_MODES=Object.freeze(['x','y','gyro']);
export const H_ROTATION_SPEED_MIN=1;
export const H_ROTATION_SPEED_MAX=90;
export const H_ROTATION_SPEED_DEFAULT=75;
export const H_GYRO_ROTATION_SPEED_DEFAULT=60;
/** 고밀도 H는 한 면을 읽을 시간을 더 줘요. 나머지 버전은 기존 속도예요. */
export function hRotationSpeedDefault(version,axis='y'){
  if(version===8)return axis==='gyro'?35:50;
  if(version===6||version===7)return axis==='gyro'?45:60;
  return axis==='gyro'?H_GYRO_ROTATION_SPEED_DEFAULT:H_ROTATION_SPEED_DEFAULT;
}
/** 자동 해상도는 실제 인코딩 버전을 따르고, 명시 속도와 해상도 선택은 보존해요. */
export function reconcileHRotationSpeed(state,resolvedVersion){
  if(state.hRotationSpeedIntent==='manual')return {...state};
  const version=state.versionH==='auto'?resolvedVersion:state.versionH;
  return {...state,hRotationSpeedIntent:'auto',hRotationSpeed:hRotationSpeedDefault(version,state.hRotationMode)};
}
export const H_PERSPECTIVE_DEFAULT_DEG=4;
export const H_PERSPECTIVE_DEFAULT=orbitTToPersp(H_PERSPECTIVE_DEFAULT_DEG/ORBIT_PERSP_MAX_DEG);
export function clampHRotationSpeed(value){
  const number=Number(value);
  if(!Number.isFinite(number))return H_ROTATION_SPEED_DEFAULT;
  return Math.min(H_ROTATION_SPEED_MAX,Math.max(H_ROTATION_SPEED_MIN,Math.round(number)));
}
/** UI는 0.5° 눈금이며 옛 저장에 값이 없으면 중간값을 사용해요. */
export function clampHRotationTilt(value){
  if(value===undefined||value===null||value==='')return H_ROTATION_TILT_DEFAULT_DEG;
  const number=Number(value);
  return Number.isFinite(number)?Math.max(0,Math.min(H_ROTATION_TILT_MAX_DEG,Math.round(number*2)/2)):H_ROTATION_TILT_DEFAULT_DEG;
}
export function selectHRotationTilt(state,value){return {...state,hRotationTiltDeg:clampHRotationTilt(value)};}
/** 기울임 보정 방식 — 옛 저장에 값이 없으면 «회전마다»(기본)예요. */
export const H_ROTATION_TILT_MODE_DEFAULT='turn';
export function clampHRotationTiltMode(value){return H_ROTATION_TILT_MODES.includes(value)?value:H_ROTATION_TILT_MODE_DEFAULT;}
export function selectHRotationTiltMode(state,value){return {...state,hRotationTiltMode:clampHRotationTiltMode(value)};}
/** 저장 복원·UI 입력이 같은 H 회전 도메인으로 들어오게 해요. */
export function normalizeHViewControls(state){
  const requestedFaces=[1,2,3,4,5,6].includes(state.hFaces)?state.hFaces:3;
  // 대칭은 2면 전용 — 다른 면 수로 저장/복원되면 아이소메트릭으로 돌아가요.
  const hArrangement=H_ARRANGEMENTS.includes(state.hArrangement)?(state.hArrangement==='symmetric'&&requestedFaces!==2?'isometric':state.hArrangement):'isometric';
  const hFaces=Math.min(requestedFaces,hArrangement==='isometric'?6:hArrangement==='symmetric'?2:4);
  const hRenderFaces=hFaces>3||hArrangement==='symmetric'?6:[3,6].includes(state.hRenderFaces)?state.hRenderFaces:3;
  return {...state,
    hArrangement,hFaces,hRenderFaces,
    hRotationMode:H_ROTATION_MODES.includes(state.hRotationMode)?state.hRotationMode:'y',
    hRotationDirectionX:state.hRotationDirectionX===-1?-1:1,
    hRotationDirectionY:state.hRotationDirectionY===-1?-1:1,
    hRotationSpeed:clampHRotationSpeed(state.hRotationSpeed),
    hRotationTiltDeg:clampHRotationTilt(state.hRotationTiltDeg),
    hRotationTiltMode:clampHRotationTiltMode(state.hRotationTiltMode),
    hRotationSpeedIntent:state.hRotationSpeedIntent==='manual'?'manual':'auto'};
}
/** 축을 고르면 auto 속도만 현재 버전·축의 기본값으로 바꿔요. */
export function selectHRotationMode(state,axis,resolvedVersion){
  if(!H_ROTATION_MODES.includes(axis))throw new RangeError('H rotation mode');
  const hRotationSpeedIntent=state.hRotationSpeedIntent==='manual'?'manual':'auto';
  return reconcileHRotationSpeed({...state,hRotationMode:axis,hRotationSpeedIntent},resolvedVersion);
}
/** 속도 UI/복원에서 고른 값은 축 기본값을 더는 따라가지 않아요. */
export function selectHRotationSpeed(state,value){
  return {...state,hRotationSpeed:clampHRotationSpeed(value),hRotationSpeedIntent:'manual'};
}
/** 기본값 버튼은 수동 속도만 해제하고 해상도·축 자동 정책을 다시 켜요. */
export function selectHRotationSpeedDefault(state,resolvedVersion){
  return reconcileHRotationSpeed({...state,hRotationSpeedIntent:'auto'},resolvedVersion);
}
/** 기존 Y의 포인터 델타예요. H는 hPointerDragPose의 화면축 합성을 사용해요. */
export function hPointerDragDelta({dx=0,dy=0,rollDelta=0}={}){
  return {yaw:-dx*.01,pitch:-dy*.01,roll:-rollDelta};
}
/** H 상태는 Y와 같은 화면 궤도 각이고, 드래그는 현재 자세의 화면축 증분이에요. */
export function hPointerDragPose(view,delta={}) {
  return hOrbitFromRotation(hDragRotation(hOrbitRotation(view),delta));
}
function svgIcon(inner){return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${inner}</svg>`;}
/** 버전 카드용 격자 밀도 아이콘. 장식이며 버튼 글자가 이름을 담당해요. */
export function hVersionIconMarkup(version){
  if(version==='auto'){
    return svgIcon('<rect x="1" y="1" width="6" height="6" fill="currentColor" opacity=".3"/><rect x="9" y="1" width="6" height="6" fill="currentColor" opacity=".55"/><rect x="1" y="9" width="6" height="6" fill="currentColor" opacity=".75"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/>');
  }
  const n=Number(version);
  const cells=3+Math.max(0,Math.min(5,Number.isInteger(n)?n:0));
  const s=16/cells;let g='';
  for(let i=0;i<cells;i++)for(let j=0;j<cells;j++){
    g+=`<rect x="${(j*s).toFixed(2)}" y="${(i*s).toFixed(2)}" width="${(s-.35).toFixed(2)}" height="${(s-.35).toFixed(2)}" fill="currentColor" opacity="${0.25+((i+j)%2)*0.5}"/>`;
  }
  return svgIcon(g);
}
/** 마스크 카드용 작은 격자. 실제 hMaskValue 규칙을 그려요. */
export function hMaskIconMarkup(mask){
  const cells=6,s=16/6;let g='';
  for(let i=0;i<cells;i++)for(let j=0;j<cells;j++){
    const v=mask==='auto'?((i*3+j)%6):hMaskValue(Number(mask),i,j);
    g+=`<rect x="${(j*s).toFixed(2)}" y="${(i*s).toFixed(2)}" width="${(s-.25).toFixed(2)}" height="${(s-.25).toFixed(2)}" fill="currentColor" opacity="${(0.18+v/6*0.82).toFixed(3)}"/>`;
  }
  return svgIcon(g);
}
/** 현재 H 렌더 팔레트의 여섯 protocol level을 상대 휘도로 바꿔 auto-mask에 전달해요. */
export function hMaskLuminance(palette,tones=3){
  const colors=hPalette(palette,tones).colors;
  return Object.freeze(colors.map(color=>{
    if(!color||![color.r,color.g,color.b].every(Number.isFinite))throw new TypeError('H palette RGB');
    const linear=value=>{const srgb=Math.max(0,Math.min(255,value))/255;return srgb<=.04045?srgb/12.92:((srgb+.055)/1.055)**2.4;};
    return .2126*linear(color.r)+.7152*linear(color.g)+.0722*linear(color.b);
  }));
}
export function isHGenerator(state){return state.type==='Y'&&state.yRepresentation==='3d';}
/** H 기본은 회전이며, 명시 pause만 이를 막아요. 콘텐츠·면수는 판단하지 않아요. */
export function reconcileHContentRotation(state){
  if(!isHGenerator(state)||state.hAutoRotateIntent==='off')return {...state};
  return {...state,hAutoRotate:true,orbitView:'3d'};
}
export function selectHRepresentation(state,value){
  if(!['2.5d','3d'].includes(value))throw new RangeError('Y representation');
  if(value===state.yRepresentation)return {...state};
  const enteringH=value==='3d'&&state.yRepresentation!=='3d';
  return {...state,yRepresentation:value,orbitView:value,
    ...(value==='3d'&&state.yRepresentation!=='3d'?{orbitPersp:H_PERSPECTIVE_DEFAULT}:{}),
    // H 첫 선택은 면수·이미지·2.5D 가능성과 무관하게 회전부터 보여줘요.
    ...(enteringH&&state.hAutoRotateIntent!=='off'?{hAutoRotate:true}:{}),
    ...(value==='2.5d'?{hFaces:3,hRenderFaces:3,hArrangement:'isometric',hAutoRotate:false}:{}),orbitYaw:0,orbitPitch:0,orbitRoll:0};
}
export function selectHFaceCount(state,count){
  if(![1,2,3,4,5,6].includes(count)||count>4&&!['isometric','symmetric'].includes(state.hArrangement??'isometric'))throw new RangeError('H face count');
  const next=count!==3&&state.yRepresentation!=='3d'?selectHRepresentation(state,'3d'):{...state};
  // 대칭 배치는 2면 전용이라 다른 면 수를 고르면 아이소메트릭으로 돌아가요.
  const hArrangement=next.hArrangement==='symmetric'&&count!==2?'isometric':(next.hArrangement??'isometric');
  const hRenderFaces=count>3||hArrangement==='symmetric'?6:(next.hRenderFaces??3);
  return {...next,hArrangement,hFaces:count,hRenderFaces,orbitView:count>3?'3d':next.orbitView};
}
/** 렌더 면 수는 본문의 고유 면 수를 바꾸지 않아요. */
export function selectHRenderFaces(state,count){
  if(![3,6].includes(count)||count===3&&state.hFaces>3)throw new RangeError('H render face count');
  return {...state,hRenderFaces:count,orbitView:'3d'};
}
/** 원근·데이터 배치는 그대로 두고 자세만 정렬해요. */
export function selectHAlignmentPose(state,arrangement){
  const pose=hOrbitFromRotation(hAlignmentRotation(arrangement));
  // 정렬은 읽기 위한 명시 고정 자세예요. 자동 정책이 다음 refresh에서 덮지 않게 남겨요.
  return {...state,orbitView:'3d',hAutoRotate:false,hAutoRotateIntent:'off',orbitYaw:orbitRadToDeg(pose.yaw),orbitPitch:orbitRadToDeg(pose.pitch),orbitRoll:orbitRadToDeg(pose.roll)};
}
export function selectHArrangement(state,arrangement){
  if(!H_ARRANGEMENTS.includes(arrangement))throw new RangeError('H arrangement');
  const next=normalizeHViewControls({...state,hArrangement:arrangement});
  // 배치 카드는 콘텐츠 선택이지 pause가 아니에요. 정렬 pose만 쓰고 회전 선택은 보존해요. 대칭은 축을 강제하지 않아요.
  const rotated=arrangement==='symmetric'?{...next}:selectHRotationMode(next,arrangement==='vertical'?'x':'y');
  const aligned=selectHAlignmentPose(rotated,arrangement);
  return {...aligned,hAutoRotate:next.hAutoRotate,hAutoRotateIntent:next.hAutoRotateIntent};
}
/** 화면·검증이 같은 도→라디안 및 회전 유도를 사용해요. */
export function hPreviewOptions(state,{elapsedMs=0,palette}={}){
  const view=orbitStateToViewerInput(state);
  const axis=state.hRotationMode??'y';
  // 옆 4면 전용 배치는 정렬축을 지켜 Z cap을 숨겨요. 기본 iso에는 읽기용 S 기울임을 적용해요.
  const wobble=!((state.hArrangement==='horizontal'&&axis==='y')||(state.hArrangement==='vertical'&&axis==='x'));
  const auto=state.hAutoRotate&&view.on
    ?hAutoRotation(elapsedMs,{axis,speed:state.hRotationSpeed??H_ROTATION_SPEED_DEFAULT,directionX:state.hRotationDirectionX??1,directionY:state.hRotationDirectionY??1,wobble,tiltDeg:clampHRotationTilt(state.hRotationTiltDeg),tiltMode:clampHRotationTiltMode(state.hRotationTiltMode),uniformSpeed:true})
    :{rotateX:0,rotateY:0,rotateZ:0};
  const pose=composeHRotation(hOrbitRotation(view),auto);
  return {palette,margin:2,...pose,perspective:view.perspective,arrangement:state.hArrangement??'isometric',renderFaces:state.hRenderFaces??(state.hFaces>3?6:3)};
}
const EN={true3d:'True 3D',faces:'Data faces',face1:'1 face',face2:'2 faces',face3:'3 faces',face4:'4 faces',face5:'5 faces',face6:'6 faces',version:'Resolution (module density = capacity)',mask:'Data mask',auto:'Automatic',
  arrangement:'Face arrangement',isometric:'Isometric',horizontal:'Horizontal alignment',vertical:'Vertical alignment',symmetric:'Opposite faces',arrangementNote:'Horizontal/vertical uses the four side faces and hides the Z caps during aligned Y/X rotation. Up to four data faces; changing from five or six selects four. Opposite faces (two data faces only) puts the two codes on facing sides. In opposite-faces mode the logical YM code is drawn on the physical XP face; the scanner reads logical faces (XM · YM) from the embedded tags, so its labels and net stay logical, and the two facing codes collect one after the other over a half turn. Isometric with four faces keeps the two blank faces adjacent (ZP·YP).',
  faceImages:'Blank-face images',imageChoose:'Choose image',imageRemove:'Remove',imageChooseShort:'Image',imageRemoveShort:'Remove',imageEmpty:'No image',imageBusy:'Loading image…',
  imageNote:'Each image is centered with its aspect ratio preserved (contain). PNG/JPG/WebP, up to 12 MB; normalized to a maximum side of 1024 px. Stored only in this page, not in links or saved settings. Included in views, nets, glTF and video; schematic colors are approximated.',videoFps:'Video frame rate',
  autoRotate:'Auto-rotate',rotationAxis:'Rotation axis',axisX:'X axis',axisY:'Y axis',axisGyro:'Gyroscope',
  axisXNote:'Screen-horizontal axis. From reset pose, a full turn shows all six faces.',axisYNote:'Screen-vertical axis. From reset pose, a full turn shows all six faces.',
  axisGyroNote:'Closed composite spin with two-axis scan tilt. Not a device motion sensor.',rotationSpeed:'Rotation speed',
  speedDecrease:'Decrease rotation speed by 1 degree per second',speedIncrease:'Increase rotation speed by 1 degree per second',
  speedValue:'{speed} degrees per second',resetPose:'Reset pose',plane:'Planar',perspectiveDecrease:'Decrease perspective by 1 degree',perspectiveIncrease:'Increase perspective by 1 degree',
  profile:'H · frame or four-corner finder + face ID',
  frame:'One- to five-face H5+ and six-face H7+ use four square finders inside the same face grid. Smaller sizes retain the frame finder. Exports keep two cells of outer spacing; Y quiet-zone and emphasis controls do not apply.',
  viewer:'H cube preview',perspective:'Perspective',
  notice:'H needs all selected unique data faces to verify the payload. One- to three-face six-view (except the opposite-faces arrangement) repeats the data on the free opposite faces; opposite faces that are both blank share one image. Corner QR is supported; inset QR, Y locators and shading are unavailable.',
  videoHeading:'3D rotation video',videoDownload:'Download one-turn MP4',videoCancel:'Cancel rendering',
  videoBackground:'Video transparency treatment',videoChecker:'Checkerboard',videoGreen:'Green',videoBlue:'Blue',videoMagenta:'Magenta',
  videoNote:'Silent MP4 · 720 × 720 · 24/30/60/120 fps. Transparency is replaced by the selected background, not an alpha channel. 60/120 fps requires WebCodecs AVC support; there is no silent downgrade.',
  videoDuration:'{seconds} seconds · {speed} degrees per second',videoGyro:'Gyroscope: full joint period with seamless scan tilt.',
  videoBusy:'Rendering {percent}% — keep this tab open.',videoDone:'MP4 download ready.',videoCancelled:'Video rendering cancelled.',
  selfCheckFailure:'H codec self-check failed:',
  export:'H image export',sheet:'All data faces',view:'Current view only',
  exportNote:'All data faces exports a face sheet. A single 3D view of a six-face code contains only part of its data.',
  renderNote:'H snapshot: the visible faces only. Use the 3D data section for a full cube net or model.',
  presets:'H 3D presets (trial)',presetNote:'These set H geometry and background, not a measured camera success guarantee.',
  pause:'Pause rotation',resume:'Rotate all faces',selfCheck:'Codec self-check passed; camera scan is separate.',unavailable:'This control belongs to the 2.5D Y format.'};
const KO={true3d:'True 3D 여부',faces:'면 수',face1:'1면',face2:'2면',face3:'3면',face4:'4면',face5:'5면',face6:'6면',version:'해상도 (모듈 밀도 = 용량)',mask:'데이터 마스크',auto:'자동',
  arrangement:'면 배치',isometric:'아이소매트릭',horizontal:'수평 정렬',vertical:'수직 정렬',symmetric:'대칭',arrangementNote:'수평·수직은 옆 4면을 사용하고 정렬된 Y축·X축 회전에서 위아래 Z면을 숨겨요. 최대 4면이며 5·6면에서 바꾸면 4면을 선택해요. 대칭(2면 전용)은 두 코드를 서로 마주보는 면에 둬요. 대칭에서는 물리 XP 면에 논리 YM 코드가 그려져요 — 스캐너는 면 안의 태그로 논리 면(XM·YM)을 읽어 라벨·전개도도 논리 면으로 보여 주고, 마주보는 두 코드는 반 바퀴 돌리는 동안 차례로 모여요. 아이소매트릭 4면은 빈 두 면(ZP·YP)이 이웃해요.',
  faceImages:'빈 면 이미지',imageChoose:'이미지 선택',imageRemove:'제거',imageChooseShort:'이미지',imageRemoveShort:'제거',imageEmpty:'이미지 없음',imageBusy:'이미지 읽는 중…',
  imageNote:'이미지 비율을 유지해 면 중앙에 contain 배치해요. PNG/JPG/WebP 12MB 이하, 긴 변 최대 1024px로 보관해요. 현재 페이지에서만 유지되며 링크·설정 저장에는 포함하지 않아요. 시점·전개도·glTF·영상에 포함하고 스키매틱은 근사 색으로 바꿔요.',videoFps:'영상 프레임 수',
  autoRotate:'자동 회전',rotationAxis:'회전 축',axisX:'X축',axisY:'Y축',axisGyro:'자이로스코프',
  axisXNote:'화면 가로축이에요. 정위치 기준 한 바퀴에 여섯 면을 보여요.',axisYNote:'화면 세로축이에요. 정위치 기준 한 바퀴에 여섯 면을 보여요.',
  axisGyroNote:'두 축 읽기용 기울임을 포함한 주기 합성 회전이에요. 기기 동작 센서가 아니에요.',rotationSpeed:'회전 속도',
  speedDecrease:'회전 속도를 초당 1도씩 낮추기',speedIncrease:'회전 속도를 초당 1도씩 높이기',
  speedValue:'초당 {speed}도',resetPose:'정위치',plane:'평면',perspectiveDecrease:'원근을 1도 줄이기',perspectiveIncrease:'원근을 1도 높이기',
  profile:'H · 면 프레임 또는 네 모서리 파인더 + 면 ID',
  frame:'1·2·3·4·5면 H5 이상·6면 H7 이상은 같은 면 격자 안에 사각 파인더 4개를 넣어요. 작은 크기는 면 프레임을 유지해요. 내보내기 바깥 2셀 간격은 그대로예요. Y 안전영역·검출기 강조 옵션은 적용하지 않아요.',
  viewer:'H 큐브 미리보기',perspective:'원근 강도',
  notice:'선택한 고유 데이터 면을 모두 모아야 본문 검증이 끝나요. 1…3면·6면 렌더(대칭 배치 제외)는 비어 있는 반대편에 본문을 반복하고, 둘 다 빈 마주보는 면은 이미지를 공유해요. 코너 QR은 지원하고, 안쪽 QR·Y 전용 로케이터·장식 음영은 적용하지 않아요.',
  videoHeading:'3D 회전 영상 다운로드',videoDownload:'한 바퀴 MP4 다운로드',videoCancel:'렌더링 취소',
  videoBackground:'영상 투명 처리',videoChecker:'투명 표시 격자',videoGreen:'그린',videoBlue:'블루',videoMagenta:'마젠타',
  videoNote:'무음 MP4 · 720 × 720 · 24/30/60/120 fps예요. 투명 배경은 선택한 색이나 격자로 바뀌며 알파 채널은 포함하지 않아요. 60/120 fps는 WebCodecs AVC 지원이 필요하며 지원하지 않으면 낮은 FPS로 대체하지 않아요.',
  videoDuration:'{seconds}초 · 초당 {speed}도',videoGyro:'자이로스코프 · 읽기용 기울임을 포함한 전체 주기 반복',
  videoBusy:'렌더링 {percent}% — 이 탭을 열어 두세요.',videoDone:'MP4 다운로드를 준비했어요.',videoCancelled:'영상 렌더링을 취소했어요.',
  selfCheckFailure:'H 자체검증 실패:',
  export:'H 이미지 내보내기',sheet:'전체 데이터 면',view:'현재 시점만',
  exportNote:'전체 면은 면시트로 내보내요. 6면 코드의 3D 한 장에는 일부 본문만 보여요.',
  renderNote:'H 스냅샷은 현재 보이는 면만 담아요. 전체 전개도·큐브 모델은 3D 데이터 섹션에서 내보내요.',
  presets:'H 3D 프리셋 (시험판)',presetNote:'H의 자세·배경을 설정해요. 실카메라 인식 성능을 보증하는 프리셋은 아니에요.',
  pause:'회전 멈춤',resume:'6면 자동회전',selfCheck:'본문 자체검증 통과 · 카메라 검증과 별개예요.',unavailable:'2.5D 타입 Y 전용 옵션이에요.'};
const EDITOR_KO={
  tiltMode:'보정 방식',tiltNone:'없음',tiltTurn:'회전마다',tiltFace:'면마다',
  tiltModeNote:'회전마다: 두 바퀴 동안 한 바퀴씩 위·아래 면을 번갈아 넓게 비추고 수평·수직 회전 느낌을 유지해요(기본). 면마다: 바퀴마다 세 번 S자로 흔들려요. 없음: 기울임 없이 돌아요. 자이로에는 적용하지 않아요.',
  tiltCorrection:'기울임 보정',tiltDecrease:'기울임 보정을 0.5도 줄이기',tiltIncrease:'기울임 보정을 0.5도 높이기',
  tiltReset:'기울임 보정 기본값',tiltResetNote:'기울임만 기본값 17.5°로 되돌려요. 회전 속도와 재생 상태는 유지해요.',
  tiltNote:'수평·수직 회전의 S자 기울임이에요. 0°는 보정 없음, 35°는 최대, 기본은 17.5°예요. 영상에도 같은 값을 써요. 수평·수직 면 배치의 정렬축에서는 적용하지 않아요.',
  positionNone:'면 확인 없음',positionOutside:'큐브 밖',positionInside:'큐브 안',positionInsideNote:'면 중앙에 위치를 표시해요. 코드 일부를 가려 스캔이 어려울 수 있어요.',
  speedReset:'회전 속도 기본값',speedResetNote:'현재 해상도·회전 방식에 맞는 기본값으로 복원하고 자동 조정을 다시 켜요.',
  playRotation:'자동 회전 재생',pauseRotation:'일시정지',playRotationShort:'자동 회전',pauseRotationShort:'회전 정지',isoShort:'아이소',gyroShort:'자이로',axisXShort:'X · 수직',axisYShort:'Y · 수평',snapshot:'스냅샷',expandVideo:'영상 설정 펼치기',collapseVideo:'영상 설정 접기',
  axisX:'X축 (수직 회전)',axisY:'Y축 (수평회전)',forward:'정회전',reverse:'역회전',rotationDirection:'회전 방향',
  axisXNote:'수직 회전에 좌우 S자 기울임을 섞어 좁게 보이는 면을 펼쳐요. 수직 면 배치의 정렬축에서는 기울임을 생략해요. 속도는 기본축 기준이에요.',
  axisYNote:'수평 회전에 상하 S자 기울임을 섞어 위아래 면을 펼쳐요. 수평 면 배치의 정렬축에서는 기울임을 생략해요. 속도는 기본축 기준이에요.',
  axisGyroNote:'기본 X 1회전·Y 2회전에 두 축의 읽기용 기울임을 섞어요. 모든 움직임이 같은 주기로 돌아와 자세·속도가 자연스럽게 이어져요. 속도는 기본 X축 기준이에요.',
  videoGyro:'자이로스코프 · X 1회전 + Y 2회전 + 읽기용 기울임 · 전체 주기 반복',videoDownload:'반복 MP4 다운로드',
  videoNote:'무음 정사각 MP4 · 720p/1080p/1440p · 24/30/60/120 fps예요. 전체 회전 주기를 담아 무한반복할 수 있어요. 투명 배경은 선택한 색이나 격자로 바뀌며 알파 채널은 포함하지 않아요. 고해상도·고FPS 지원 여부는 브라우저와 장치에 따라 달라요. 미지원 시 몰래 낮추지 않아요.',
  imagePosition:'위치 확인',imageSample:'테스트 이미지 넣어보기',imageText:'텍스트 넣기',imageTextPlaceholder:'글자를 입력하면 면을 채워요 · 줄바꿈은 Enter',imageTextEmpty:'글자를 입력해 주세요',imageFont:'폰트',imageFontSearch:'폰트 검색 · 입력하면 목록이 좁혀져요',imageFontOpen:'폰트 목록 열기',imageFontSystem:'시스템 폰트',imageFontWeb:'웹폰트 (CDN에서 받아요)',imageFontSans:'시스템 산세리프',imageFontSerif:'시스템 세리프',imageFontMono:'시스템 고정폭',imageFontNone:'일치하는 폰트가 없어요',imageRotateLeft:'이미지를 반시계 방향으로 45° 회전',imageRotateRight:'이미지를 시계 방향으로 45° 회전',
  imageFitcontain:'맞추기',imageFitfill:'늘이기',imageFitcover:'채우기',imageBackground:'배경색',imageBackgroundReset:'배경색 기본값',imageColorPad:'배경색: 가로 색상, 세로 채도',imageLightness:'배경색 밝기 (HSL 명도)',imageColorInvalid:'올바른 색상 값을 입력해 주세요.',
  imageNote:'PNG/JPG/WebP/SVG · 12MB 이하 · 최대 1024px예요. 맞추기는 전체 이미지, 채우기는 비율 유지 크롭, 늘이기만 비율을 바꿔요. 회전·맞춤·배경색은 시점·전개도·glTF·영상·스키매틱에 반영돼요. 위치 표시는 미리보기 전용이에요. 이미지는 현재 페이지에서만 유지돼요. 텍스트 넣기는 글자를 여백을 뺀 최대 크기로 가운데 맞춰 면 이미지로 만들고, 글자색은 배경색 대비로 검정/흰색이 골라져요. 웹폰트는 고를 때 CDN(Google Fonts · jsDelivr)에서 받아요.',
  resetRoll:'Z축 정위치',resetZoom:'확대/축소 초기화',face6Repeat:'6면 (반복)',
  planarUnavailable:'코드와 이미지를 한 시점에 모두 보여줄 수 없어 3D 보기를 사용해요.',
  notice:'고유 데이터 면을 모두 모아 본문을 검증해요. 1…3면의 6면 렌더(대칭 배치 제외)는 비어 있는 반대편에 코드를 반복하고, 둘 다 빈 마주보는 면은 이미지를 공유해요. 코너 QR은 지원하며 안쪽 QR·Y 전용 로케이터는 적용하지 않아요.',
};
const EDITOR_EN={
  tiltMode:'Tilt pattern',tiltNone:'None',tiltTurn:'Per turn',tiltFace:'Per face',
  tiltModeNote:'Per turn: over two turns, tilt toward the top cap for one turn and the bottom cap for the next, keeping the horizontal/vertical feel (default). Per face: three S wobbles per turn. None: no tilt. Not applied to gyro.',
  tiltCorrection:'Tilt correction',tiltDecrease:'Decrease tilt correction by 0.5 degrees',tiltIncrease:'Increase tilt correction by 0.5 degrees',
  tiltReset:'Reset tilt correction',tiltResetNote:'Restore only the tilt correction to 17.5°. Keep the rotation speed and playback state.',
  tiltNote:'S tilt for horizontal/vertical spin: 0° off, 35° maximum, 17.5° default. Video uses the same value. Omitted on the aligned axis of horizontal/vertical face arrangements.',
  positionNone:'No face labels',positionOutside:'Outside cube',positionInside:'Inside cube',positionInsideNote:'Show positions at face centers. Labels cover part of the code and can make scanning harder.',
  speedReset:'Default rotation speed',speedResetNote:'Restore the default for the current resolution and rotation mode, and resume automatic speed adjustment.',
  playRotation:'Play rotation',pauseRotation:'Pause rotation',playRotationShort:'Auto-rotate',pauseRotationShort:'Stop rotation',isoShort:'Iso',gyroShort:'Gyro',axisXShort:'X · vertical',axisYShort:'Y · horizontal',snapshot:'Snapshot',expandVideo:'Expand video settings',collapseVideo:'Collapse video settings',
  axisX:'X axis (vertical spin)',axisY:'Y axis (horizontal spin)',forward:'Forward',reverse:'Reverse',rotationDirection:'Spin direction',
  axisXNote:'Vertical spin with a side-to-side S tilt to expose narrow faces. Tilt is omitted on the aligned axis of a vertical face arrangement. Speed refers to the main axis.',
  axisYNote:'Horizontal spin with an up/down S tilt to expose the caps. Tilt is omitted on the aligned axis of a horizontal face arrangement. Speed refers to the main axis.',
  axisGyroNote:'X one turn and Y two turns, plus two-axis scan tilt. All motions share one period with continuous pose and velocity. Speed refers to the main X axis.',
  videoGyro:'Gyroscope · X 1 turn + Y 2 turns + scan tilt · seamless full period',videoDownload:'Download loop MP4',
  videoNote:'Silent square MP4 · 720p/1080p/1440p · 24/30/60/120 fps. Exports the full joint rotation period for looping. Transparency uses the selected color/checkerboard, not alpha. High resolution/FPS depends on browser/device support and is never silently reduced.',
  imagePosition:'Show positions',imageSample:'Try a sample image',imageText:'Add text',imageTextPlaceholder:'Type to fill the face · Enter for a new line',imageTextEmpty:'Type some text',imageFont:'Font',imageFontSearch:'Search fonts · typing narrows the list',imageFontOpen:'Open font list',imageFontSystem:'System fonts',imageFontWeb:'Web fonts (fetched from CDN)',imageFontSans:'System sans-serif',imageFontSerif:'System serif',imageFontMono:'System monospace',imageFontNone:'No matching font',imageRotateLeft:'Rotate image 45° counterclockwise',imageRotateRight:'Rotate image 45° clockwise',
  imageFitcontain:'Contain',imageFitfill:'Fill',imageFitcover:'Cover',imageBackground:'Background',imageBackgroundReset:'Reset background color',imageColorPad:'Background: horizontal hue, vertical saturation',imageLightness:'Background lightness (HSL)',imageColorInvalid:'Enter a valid color value.',
  imageNote:'PNG/JPG/WebP/SVG · up to 12 MB · max 1024 px. Contain shows the full image; cover crops with aspect ratio preserved; only fill stretches. Rotation, fit and background apply to views, nets, glTF, video and schematic. Position labels are preview-only. Images stay in this page session only. Add text renders centered text at the largest size that fits inside the margin as a face image; its color is black/white by background contrast. Web fonts are fetched from CDN (Google Fonts · jsDelivr) when selected.',
  resetRoll:'Reset Z rotation',resetZoom:'Reset zoom',face6Repeat:'6 faces (repeat)',planarUnavailable:'The meaningful code/image faces cannot all fit in one view. Use 3D.',
  notice:'Collect every unique data face to verify the payload. One- to three-face six-view (except the opposite-faces arrangement) repeats code on the free opposite faces; opposite faces that are both blank share one image. Corner QR is supported; inset QR and Y locators are not applied.',
};
export function hUiLabel(key,lang='ko'){const ko=lang.startsWith('ko');return (ko?EDITOR_KO:EDITOR_EN)[key]??(ko?KO:EN)[key]??key;}
