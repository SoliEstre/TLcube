/** 화면 자세/교육용 한 셀 보기와 무관하게 전체 실제 큐브를 내보내요. */
import { buildHCubeModel, buildYCubeModel } from './cube-export.js';
import { buildOrbitMesh } from './y3d-viewer.js';
import { yLevelTables, applyFaceGain, DEFAULT_FACE_GAINS } from './sceneY.js';
import { slotQrFaceQuads } from './y3d-slot-qr.js';
import { WINDOW_SIZE_Y, WINDOW_SUPPORTED_N } from './capacityY.js';
import { qrMatrix } from './qr.js';

/** 윈도 β의 2.5D 도형을 export 전용 3D 면 패치로 옮겨요.
 * sceneY.renderWindowQr와 전수 좌표/색 대조하는 테스트가 사본 drift를 막아요.
 * 데이터 격자/검출기/기존 3D 미리보기에는 영향을 주지 않아요. */
export function windowCubeFaceQuads({n,qrText,palette}) {
  if(n!==WINDOW_SUPPORTED_N)throw new RangeError('윈도 QR 큐브 크기가 맞지 않아요');
  if(typeof qrText!=='string'||qrText.length===0)throw new TypeError('윈도 QR 내보내기에는 QR 텍스트가 필요해요');
  const qr=qrMatrix(qrText);
  if(qr.size!==21)throw new RangeError('윈도 QR은 21모듈이어야 해요');
  const gains=palette.faceGains??DEFAULT_FACE_GAINS;
  const lo=n-WINDOW_SIZE_Y,pitch=.5,quietModules=4;
  const out=[{face:'T',a:lo,b:lo,size:WINDOW_SIZE_Y,color:applyFaceGain(palette.bullseyeLight,gains.T)}];
  const dark=applyFaceGain(palette.bullseyeDark,gains.T);
  for(let qy=0;qy<qr.size;qy++)for(let qx=0;qx<qr.size;qx++){
    if(qr.modules[qy*qr.size+qx]!==1)continue;
    out.push({face:'T',a:lo+(qr.size-1-qx+quietModules)*pitch,b:lo+(qr.size-1-qy+quietModules)*pitch,size:pitch,color:dark});
  }
  for(const face of ['L','R'])out.push({face,a:lo,b:lo,size:WINDOW_SIZE_Y,color:applyFaceGain(palette.levels[0],gains[face])});
  return out;
}

export function generatorCubeModel(current, fallbackPalette) {
  if(!current||!['Y','H'].includes(current.type))throw new RangeError('Type Y 큐브가 필요해요');
  const {encoded,scene,sceneOpts={}}=current;
  const palette=sceneOpts.palette??fallbackPalette;
  if(current.type==='H')return buildHCubeModel(encoded,{palette,faceImages:sceneOpts.faceImages,arrangement:sceneOpts.arrangement,renderFaces:sceneOpts.renderFaces});
  const tables=yLevelTables(palette,scene.locatorProfile,sceneOpts.centralN7Emphasis);
  const mesh=buildOrbitMesh({
    n:encoded.n,tones:encoded.tones===2?2:3,levels:palette.levels,
    faceLevels:tables.data,locatorFaceLevels:tables.locator,layout:scene.layout,
    yaw:0,pitch:0,roll:0,perspective:0,faces:3,includeBack:true,
    digitAt:(i,j)=>encoded.cellDigits.get(`${i},${j}`)?.digit??null,
    levelAt:(i,j,face)=>{
      const value=encoded.cellDigits.get(`${i},${j}`)?.tones?.[face];
      return Number.isInteger(value)?value:null;
    },
    faceQuads:encoded.window===true
      ?windowCubeFaceQuads({n:encoded.n,qrText:sceneOpts.qrText,palette})
      :slotQrFaceQuads({layoutId:encoded.cellSurfaceLayout,n:encoded.n,qrText:sceneOpts.qrText,palette}),
  });
  return buildYCubeModel(mesh);
}
