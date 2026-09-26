/**
 * 3D 데이터 출력(glTF · 3D 데이터 전개도 · .schem)의 방향 왕복 — 2026-09-26 모델 좌표 거울 수정의 자예요.
 * 2.5D 화면 기저는 왼손 투영이라, 모델 좌표를 오른손 세계(glTF 뷰어 · Minecraft · 접은 종이)에 그대로 두면 모든 면이 거울이었어요.
 * 지금은 writer 가 물리 좌표(PHYSICAL_SWAP)로 옮겨 쓰므로, 파일만 읽어(구현의 사상을 쓰지 않고) 오른손 카메라로 보면:
 *   - glTF: H 검출기가 모든 데이터 면을 mirror === false · 제 태그 · 제 레벨로 읽고 수집기가 원문까지 DONE 해요.
 *     2.5D 정본 시점(원근 0)과 같은 면이 같은 자리 · 같은 회전으로 보여요(같은 물체).
 *   - 전개도: 인쇄면을 바깥으로 접은 큐브에서 모든 데이터 면이 거울 없이 읽혀 원문으로 복호돼요.
 *   - .schem: 바깥에서 본 코드 면 격자가 정본 면 시트와 회전으로만 모든 셀이 맞아요(콘크리트 색 근사라 검출기 대신 표본으로 재요).
 *   - 타입 Y glTF: 같은 카메라로 본 그림이 Y 복호기로 원문까지 읽혀요.
 *   - 타입 Y 안쪽 QR(윈도 β · 슬롯): 알려진 예외예요. 2.5D 미리보기부터 거울로 그려지고 출력은 미리보기를 따라요 — 양성 락으로 잠가요.
 * 심은 결함: writer 앞에서 한 번 더 뒤집은(= 수정 전과 같은 좌표) 모델은 같은 자에서 전부 «거울» 로 떨어져요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH,decodeH} from '../src/h-codec.js';
import {encodeY} from '../src/encodeY.js';
import {buildSceneY} from '../src/sceneY.js';
import {getPreset,BULLSEYE_DARK,BULLSEYE_LIGHT,DEFAULT_PRESET} from '../src/luminance.js';
import {buildHScene} from '../src/h-render.js';
import {hDisplayMap} from '../src/h-face-arrangement.js';
import {buildHCubeModel,cubeModelToGltf,cubeNetScene} from '../src/cube-export.js';
import {generatorCubeModel} from '../src/generator-cube-export.js';
import {physicalCubeModel,physicalHCube} from '../src/cube-physical.js';
import {voxelizeCube,nearestConcrete} from '../src/minecraft-schematic.js';
import {hFaceQrImage} from '../src/h-face-qr.js';
import {tlReaderUrlWithHint,qrMatrix} from '../src/qr.js';
import {rasterize} from '../src/raster.js';
import {detectH} from '../src/h-detect.js';
import {createHScanRuntime} from '../src/h-scan-runtime.js';
import {decodeFrontend} from '../src/decoder/frontend.js';
import {fullOnly} from './helpers/scope.mjs';
import {ISO_FRONT,ISO_BACK,forwardOf,cross,dot,sceneField,mirrorX,faceCameras} from './helpers/h-physical-camera.mjs';
import {gltfQuads,imageLookup,viewScene,foldCubeNet,faceViewScene,schemFaceScenes} from './helpers/cube-data-view.mjs';

const PPU=12;
const QR=hFaceQrImage(tlReaderUrlWithHint('Y'));
const profile=e=>({version:e.version,n:e.n,mode:e.mode,tones:e.tones,ecc:e.ecc,mask:e.mask,routeId:e.routeId,finder:e.finder});
const signedArea=points=>{let s=0;for(let k=0;k<points.length;k++){const a=points[k],b=points[(k+1)%points.length];s+=a.x*b.y-b.x*a.y;}return s/2;};

/**
 * 심은 결함: writer 앞에서 모델을 한 번 더 반사해요. writer 가 다시 반사하므로 결과 좌표는 수정 전(모델 좌표 그대로)과 같아요.
 * 면 이름은 옮긴 평면 이름으로 바꿔야 writer 의 평면 판정이 좌표와 맞아요 — 그래서 이 사본의 전개도 face 는 평면 이름이에요.
 */
function remirror(model){
  const w=physicalCubeModel(model);
  return {...w,space:undefined,quads:w.quads.map(q=>({...q,face:q.plane})),...(w.images?{images:w.images.map(p=>({...p,face:p.plane}))}:{})};
}
function hCode({version,mode,finder,tones=3,qr=false,payload=`orient H${version} ${mode}F`}){
  const encoded=encodeH(payload,{version,mode,tones,ecc:'M',mask:3,finder}),options={arrangement:'isometric',renderFaces:mode>=4?6:3};
  const map=hDisplayMap(encoded,options),faceImages=qr?Object.fromEntries(map.imageTargets.map(t=>[t.face,QR])):undefined;
  return {encoded,payload,options,map,faceImages,model:buildHCubeModel(encoded,{...options,faceImages})};
}
const CASES=[
  {version:3,mode:3,finder:'frame',qr:true},
  {version:7,mode:1,finder:'corners',qr:true},
  {version:2,mode:6,finder:'frame'},
];
const tags=found=>found.faces.map(f=>f.face).sort();

function gltfViews(model){
  const quads=gltfQuads(cubeModelToGltf(model),imageLookup(model));
  return [ISO_FRONT,ISO_BACK].map(camera=>({camera,scene:viewScene(quads,camera)}));
}

test('glTF 왕복: 오른손 고정 카메라로 본 glTF 에서 모든 데이터 면이 거울 없이 제 태그·레벨로 읽히고 수집기가 원문까지 DONE 해요',()=>{
  for(const c of CASES){
    const {encoded,payload,map,model}=hCode(c),label=`H${c.version} ${c.mode}F ${c.finder}`;
    const runtime=createHScanRuntime({detect:detectH,coldIntervalMs:0,activeIntervalMs:0});
    const seen=new Set();let done=null;
    gltfViews(model).forEach(({camera,scene},k)=>{
      const field=sceneField(scene,PPU),found=detectH(field);
      for(const f of found.faces){
        assert.equal(f.mirror,false,`${label} ${camera.name} ${f.face}`);
        assert.deepEqual([...f.levels],[...encoded.faces[f.face]],`${label} ${camera.name} ${f.face}: 레벨이 정본 면 시트와 같아요`);
        seen.add(f.face);
      }
      // 짝 대조: 같은 그림의 좌우 반전본은 0면이에요(검출기가 거울을 거부해요).
      assert.equal(detectH(mirrorX(field)).faces.length,0,`${label} ${camera.name}: 반전본은 읽히면 안 돼요`);
      // 빈 면 QR 사각형(TL→TR→BR→BL)은 y 아래 화면에서 시계 방향 = 거울 아님이에요.
      for(const shape of scene.shapes.filter(s=>s.kind==='image'))assert.ok(signedArea(shape.points)>0,`${label} ${camera.name}: glTF 면 QR 이 거울이에요`);
      const hit=runtime.pushFrame(field,k*1000,{frameId:`${label}-${k}`,force:true});if(hit&&done===null)done=hit.text;
    });
    assert.deepEqual([...seen].sort(),[...map.logicalDataFaces].sort(),`${label}: 모든 논리 데이터 면을 읽어야 해요`);
    assert.equal(done,payload,`${label}: 수집기 DONE 원문`);
    // 삼각형 감기: 코드 면 쿼드와 면 이미지 모두 바깥에서 CCW(glTF 앞면)예요 — 뒷면 컬링하는 뷰어에서도 바깥이 보여요.
    const quads=gltfQuads(cubeModelToGltf(model));
    assert.deepEqual(quads.filter(q=>!q.frontOutward).length,0,`${label}: 안쪽을 보는 glTF 삼각형`);
    assert.equal(quads.filter(q=>q.kind==='image').length,model.images?.length??0);
  }
});

/**
 * 2.5D 장면(원근 0)과 glTF 를 ISO_FRONT 로 본 장면을 도형 단위로 대조해요. 두 장면의 외접 사각형 좌상을 맞춘 뒤,
 * 2.5D 셀 사각형(i·j 가 있는 코드 면 셀)마다 꼭짓점 집합이 같은 glTF 사각형이 있고 색이 같은지, 면 이미지는 TL·TR·BR·BL 순서까지
 * 같은지 세요. 2.5D 의 빈 면은 면 하나짜리 단색 도형이라 셀 대조에서 빠지고, 그 위의 면 이미지는 이미지 대조가 재요.
 */
function sameView(a,b){
  // 원점은 다각형만으로 잡아요 — glTF 면 이미지는 바깥으로 .0002 떠 있어 외접 사각형을 미세하게 넓혀요.
  const origin=scene=>{const pts=scene.shapes.filter(s=>s.kind==='polygon').flatMap(s=>s.points);return {x:Math.min(...pts.map(p=>p.x)),y:Math.min(...pts.map(p=>p.y))};};
  const oa=origin(a),ob=origin(b),key=(points,o)=>points.map(p=>`${(p.x-o.x).toFixed(5)},${(p.y-o.y).toFixed(5)}`);
  const polygons=new Map(b.shapes.filter(s=>s.kind==='polygon').map(s=>[key(s.points,ob).sort().join('|'),s]));
  // 면 이미지 꼭짓점은 .0002 셀 띄움의 사영만큼(< 0.001) 달라서 허용오차 0.01 로 대조해요 — 순서(방향)는 그대로 재요.
  const images=b.shapes.filter(s=>s.kind==='image').map(s=>s.points.map(p=>({x:p.x-ob.x,y:p.y-ob.y})));
  const sameImage=points=>images.some(other=>other.every((q,k)=>Math.hypot(q.x-(points[k].x-oa.x),q.y-(points[k].y-oa.y))<.01));
  let cells=0,cellHits=0,imageCount=0,imageHits=0;
  for(const s of a.shapes){
    if(s.kind==='polygon'&&Number.isInteger(s.i)&&Number.isInteger(s.j)){cells++;const hit=polygons.get(key(s.points,oa).sort().join('|'));if(hit&&hit.color.r===s.color.r&&hit.color.g===s.color.g&&hit.color.b===s.color.b)cellHits++;}
    if(s.kind==='image'){imageCount++;if(sameImage(s.points))imageHits++;}
  }
  return {cells,cellHits,imageCount,imageHits};
}
test('glTF 는 2.5D 미리보기와 같은 물체예요: 오른손 ISO_FRONT 로 본 glTF 가 정본 시점(원근 0) 2.5D 와 셀·색·면 이미지 방향까지 같은 그림이에요',()=>{
  // ISO_FRONT 는 숫자 상수 카메라예요(물리 교환 S 에서 유도하지 않아요). 오른손인지 먼저 단언해요.
  assert.ok(dot(forwardOf(ISO_FRONT),[1,1,1])>0);assert.ok(Math.abs(dot(cross(ISO_FRONT.right,ISO_FRONT.down),forwardOf(ISO_FRONT))-1)<1e-12);
  for(const c of CASES){
    const {encoded,options,faceImages,model}=hCode(c),label=`H${c.version} ${c.mode}F`;
    const flat=buildHScene(encoded,{...options,faceImages,perspective:0,margin:3});
    const view=same=>sameView(flat,viewScene(gltfQuads(cubeModelToGltf(same),imageLookup(model)),ISO_FRONT));
    const product=view(model),defect=view(remirror(model));
    assert.ok(product.cells>0&&product.cells%(encoded.n*encoded.n)===0,`${label}: 2.5D 셀 수 ${product.cells}`);
    assert.deepEqual([product.cellHits,product.imageHits],[product.cells,product.imageCount],`${label}: 셀·면 이미지가 모두 같은 자리·같은 색이어야 해요`);
    if(c.qr&&c.mode===1)assert.ok(product.imageCount>0,`${label}: 정본 시점에 면 QR 이 보여야 무해 표적이 아니에요`);
    // 대조군: 결함 사본(수정 전 좌표)은 좌우 반전된 그림이에요. 테두리·레일 같은 대칭 셀은 우연히 맞으므로(실측 약 60 %)
    // «전부 맞음» 과 확실히 갈리는지만 재요.
    assert.ok(defect.cellHits<defect.cells*.8,`${label}: 결함 사본이 같은 그림이면 자가 거울을 못 가려요(${defect.cellHits}/${defect.cells})`);
    assert.equal(defect.imageHits,0,`${label}: 결함 사본의 면 이미지`);
  }
});

test('3D 데이터 전개도 왕복: 인쇄면을 바깥으로 접은 큐브에서 모든 데이터 면이 거울 없이 제 태그로 읽혀 원문으로 복호돼요',()=>{
  for(const c of CASES){
    const {encoded,payload,map,model}=hCode(c),label=`H${c.version} ${c.mode}F`,net=cubeNetScene(model),{quads}=foldCubeNet(net);
    // 전개도 면 QR 사각형도 종이에서 거울이 아니에요(y 아래 시계 방향).
    for(const shape of net.shapes.filter(s=>s.kind==='image'))assert.ok(signedArea(shape.points)>0,`${label}: 전개도 면 QR`);
    const levels={};
    for(const face of map.physicalDataFaces){
      const field=sceneField(faceViewScene(quads,face),PPU),found=detectH(field),logical=map.physicalToLogical[face];
      assert.deepEqual(tags(found),[logical],`${label} 전개도 ${face}`);
      assert.equal(found.faces[0].mirror,false);assert.deepEqual([...found.faces[0].levels],[...encoded.faces[logical]]);
      assert.equal(detectH(mirrorX(field)).faces.length,0,`${label} 전개도 ${face}: 반전본`);
      levels[logical]=found.faces[0].levels;
    }
    const decoded=decodeH(levels,profile(encoded));assert.equal(decoded.ok,true,label);assert.equal(decoded.text,payload);
  }
});

/** .schem 바깥 여섯 면을 셀 중심 블록으로 읽어 정본 면 시트(모델 쿼드 색의 근사 블록)와 정사각형 대칭 8가지로 대조해요. */
const D4=[['rot0',(r,c,n)=>[r,c]],['rot90',(r,c,n)=>[c,n-1-r]],['rot180',(r,c,n)=>[n-1-r,n-1-c]],['rot270',(r,c,n)=>[n-1-c,r]],
  ['mirLR',(r,c,n)=>[r,n-1-c]],['mirUD',(r,c,n)=>[n-1-r,c]],['transpose',(r,c,n)=>[c,r]],['antiTranspose',(r,c,n)=>[n-1-c,n-1-r]]];
function schemSheetMatches(model,scale){
  const n=model.n,vox=voxelizeCube(model,{scale}),S=vox.width,views=schemFaceScenes(vox);
  // 바깥 면 장면의 도형은 블록마다 하나이고 (a,b) 격자 순서예요 — 장면 좌표로 셀 중심 블록을 찾아요.
  const grids=views.map(({out,scene})=>{
    const cell=new Map();for(const s of scene.shapes){const x=Math.min(...s.points.map(p=>p.x)),y=Math.min(...s.points.map(p=>p.y));cell.set(`${Math.round(x)},${Math.round(y)}`,s.color);}
    const x0=Math.min(...scene.shapes.flatMap(s=>s.points.map(p=>p.x))),y0=Math.min(...scene.shapes.flatMap(s=>s.points.map(p=>p.y)));
    // 회색 테두리 1블록 안쪽이 n·scale 블록 면이에요. 셀 (r,c) 중심 블록 = 1 + r·scale + ⌊scale/2⌋.
    return {out,at:(r,c)=>cell.get(`${Math.round(x0)+1+c*scale+Math.floor(scale/2)},${Math.round(y0)+1+r*scale+Math.floor(scale/2)}`)};
  });
  const key=c=>c?nearestConcrete(c):'none';
  return [...new Set(model.quads.filter(q=>q.kind==='module').map(q=>q.face))].map(face=>{
    const sheet=new Array(n*n);for(const q of model.quads)if(q.face===face)sheet[q.i*n+q.j]=nearestConcrete(q.color);
    let best={hits:-1};
    for(const {out,at} of grids)D4.forEach(([name,map],k)=>{
      let hits=0;for(let r=0;r<n;r++)for(let c=0;c<n;c++){const [i,j]=map(r,c,n);if(key(at(r,c))===sheet[i*n+j])hits++;}
      if(hits>best.hits)best={face,out:out.join(','),name,reflection:k>=4,hits};
    });
    return {...best,cells:n*n,size:S};
  });
}

test('.schem: 바깥에서 본 코드 면 격자는 정본 면 시트와 회전으로만 모든 셀이 맞아요(거울 아님) · 심은 결함은 반사로만 맞아요',()=>{
  for(const c of [{version:3,mode:3,finder:'frame'},{version:2,mode:6,finder:'frame'}]){
    const {model}=hCode(c);
    for(const scale of [1,2]){
      for(const row of schemSheetMatches(model,scale)){
        assert.equal(row.hits,row.cells,`H${c.version} ${c.mode}F ×${scale} ${row.face}: ${row.name}@${row.out}`);
        assert.equal(row.reflection,false,`H${c.version} ${c.mode}F ×${scale} ${row.face}: .schem 코드 면이 거울이에요(${row.name})`);
      }
      for(const row of schemSheetMatches(remirror(model),scale))assert.equal(row.reflection,true,`심은 결함 ${row.face}: 반사로만 맞아야 자가 거울을 가려요`);
    }
  }
});

test('심은 결함: 한 번 더 뒤집은 모델의 glTF·전개도는 같은 자에서 0면이고 좌우 반전본에서만 읽혀요',()=>{
  const {map,model}=hCode({version:3,mode:3,finder:'frame',qr:true}),defect=remirror(model);
  for(const {camera,scene} of gltfViews(defect)){
    const field=sceneField(scene,PPU);
    if(camera===ISO_FRONT){assert.equal(detectH(field).faces.length,0,'glTF 결함 원본');assert.deepEqual(tags(detectH(mirrorX(field))),['XM','YM','ZM'],'glTF 결함 반전본');}
    for(const shape of scene.shapes.filter(s=>s.kind==='image'))assert.ok(signedArea(shape.points)<0,'glTF 결함 QR 은 거울이어야 해요');
  }
  // 결함 사본의 전개도 face 는 평면 이름이라, 도형 face 로 물리 데이터 평면을 찾아요.
  const net=cubeNetScene(defect),{quads}=foldCubeNet(net),planes=[...new Set(defect.quads.filter(q=>q.kind==='module').map(q=>q.face))];
  assert.equal(planes.length,map.physicalDataFaces.length);
  for(const face of planes){
    const field=sceneField(faceViewScene(quads,face),PPU);
    assert.equal(detectH(field).faces.length,0,`전개도 결함 ${face} 원본`);assert.equal(detectH(mirrorX(field)).faces.length,1,`전개도 결함 ${face} 반전본`);
  }
  for(const shape of net.shapes.filter(s=>s.kind==='image'))assert.ok(signedArea(shape.points)<0,'전개도 결함 QR 은 거울이어야 해요');
});

test('만들기용 파일과 같은 물체예요: glTF 데이터 면의 평면·셀 틀이 PhysCube(종이·3D 인쇄) 와 셀마다 같아요',()=>{
  // PhysCube 는 모델 쿼드에서 면 틀을 따로 유도해요(physicalHCube). glTF 의 정점 색 쿼드를 그 틀의 셀 사각형과 대조해요.
  for(const c of CASES){
    const {model}=hCode(c),phys=physicalHCube(model),quads=gltfQuads(cubeModelToGltf(model)).filter(q=>q.kind==='polygon');
    const byCorners=new Map(quads.map(q=>[q.points.map(p=>p.map(v=>Math.round(v*1e6)/1e6).join(',')).sort().join('|'),q]));
    let matched=0;
    for(const [name,f] of Object.entries(phys.faces))for(let i=0;i<phys.n;i++)for(let j=0;j<phys.n;j++){
      const at=(a,b)=>[0,1,2].map(k=>f.origin[k]+a*f.di[k]+b*f.dj[k]).join(',');
      const q=byCorners.get([at(i,j),at(i,j+1),at(i+1,j+1),at(i+1,j)].sort().join('|'));
      assert.ok(q,`${name}(${i},${j}): PhysCube 셀과 같은 glTF 쿼드가 없어요`);
      assert.deepEqual(q.color,f.colors[i*phys.n+j],`${name}(${i},${j}) 색`);
      assert.deepEqual(q.outward,f.normal,`${name}(${i},${j}) 바깥 법선`);matched++;
    }
    assert.equal(matched,6*phys.n*phys.n);
  }
});

const Y_PALETTE=(()=>{const p=getPreset(DEFAULT_PRESET);return {background:p.background,levels:p.levels,bullseyeDark:BULLSEYE_DARK,bullseyeLight:BULLSEYE_LIGHT};})();
function yModel(text,options){
  const encoded=encodeY(text,options),sceneOpts={palette:Y_PALETTE},scene=buildSceneY(encoded,sceneOpts);
  return generatorCubeModel({type:'Y',encoded,scene,sceneOpts},Y_PALETTE);
}
const mirrorRaster=r=>{const px=new Uint8ClampedArray(r.pixels.length);for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)px.set(r.pixels.subarray((y*r.width+x)*4,(y*r.width+x)*4+4),(y*r.width+r.width-1-x)*4);return {...r,pixels:px};};
function yRead(model){
  const raster=rasterize(viewScene(gltfQuads(cubeModelToGltf(model)),ISO_FRONT,{margin:4}),{pixelsPerUnit:PPU,supersample:2});
  const a=decodeFrontend(raster),b=decodeFrontend(mirrorRaster(raster));
  return {original:a.ok?a.text:null,mirrored:b.ok?b.text:null};
}
test('타입 Y glTF 왕복: 같은 오른손 카메라로 본 glTF 가 Y 복호기로 원문까지 읽히고, 심은 결함은 좌우 반전본에서만 읽혀요',()=>{
  const model=yModel('orient y',{version:1,tones:3,eccLevel:'M'});
  assert.deepEqual(yRead(model),{original:'orient y',mirrored:null});
  assert.deepEqual(yRead(remirror(model)),{original:null,mirrored:'orient y'});
});

// ── 타입 Y 안쪽 QR(윈도 β · 슬롯): 알려진 예외의 양성 락 ─────────────────────────────────────────────
// 2.5D 미리보기가 Y 안쪽 QR 을 이미 거울로 그려요(sceneY renderWindowQr · renderSlotQr 가 QR 열·행을 면 T 의 (a, b) 에 두는데,
// 그 (a, b) 틀이 화면에서 반사예요). 3D 데이터 출력은 미리보기와 같은 물체라 그 거울을 그대로 물려받아요. 두 성질을 따로 잠가요.
//   ① 출력 = 미리보기: glTF 를 오른손 ISO_FRONT 로 본 QR 모듈 배치가 2.5D 와 같은 그림이에요 — 뿌리를 고쳐도 지켜야 할 성질.
//   ② 알려진 거울: 면 카메라로 본 glTF · 접은 전개도의 QR 이 qrMatrix 와 반사로만 441/441 이에요 — 양성 락.
//      뿌리(QR → (a, b) 사상, 2.5D 까지 바뀌는 별도 결정)를 고치면 ② 는 의도적으로 뒤집고 ① 은 초록이어야 해요.
// .schem 은 같은 물리 좌표 사상(physicalCubeModel)을 지나지만 이 락은 재지 않아요 — 블록 격자에서 QR 모듈만 골라내는 자를
// 따로 세우지 않았어요(이 축을 덮으려면 Y .schem 의 T 평면 블록을 QR 판 영역으로 잘라 같은 D4 로 대조하면 돼요).
const Y_QR_TEXT=tlReaderUrlWithHint('Y'),Y_QR=qrMatrix(Y_QR_TEXT);
const Y_D4=(()=>{const n=Y_QR.size;return [['rot0',(r,c)=>[r,c]],['rot90',(r,c)=>[c,n-1-r]],['rot180',(r,c)=>[n-1-r,n-1-c]],['rot270',(r,c)=>[n-1-c,r]],
  ['mirLR',(r,c)=>[r,n-1-c]],['mirUD',(r,c)=>[n-1-r,c]],['transpose',(r,c)=>[c,r]],['antiTranspose',(r,c)=>[n-1-c,n-1-r]]];})();
const quadCenter=q=>q.points.reduce((s,p)=>s.map((v,k)=>v+p[k]/q.points.length),[0,0,0]);
/** 3D 쿼드 중 가장 작은 정사각형(한 변 < 최소 × 1.5)이 Y 안쪽 QR 의 어두운 모듈이에요(데이터 셀·QR 판은 더 커요 — 락이 개수를 qrMatrix 의 어두운 모듈 수와 대조해요). */
function yQrModules3d(quads){
  const side=q=>Math.hypot(...q.points[1].map((v,k)=>v-q.points[0][k])),poly=quads.filter(q=>q.kind==='polygon'),min=Math.min(...poly.map(side));
  return {pitch:min,modules:poly.filter(q=>side(q)<min*1.5)};
}
/** 한 면에 모인 QR 모듈을 그 면 바깥 법선의 오른손 카메라로 보고 격자로 읽어 qrMatrix 와 정사각형 대칭 8가지로 대조해요. */
function yQrFaceD4(quads){
  const {pitch,modules}=yQrModules3d(quads),outs=[...new Set(modules.map(q=>q.outward.join(',')))];
  assert.equal(outs.length,1,`QR 모듈이 한 면에 있어야 해요: ${outs}`);
  const camera=faceCameras(outs[0].split(',').map(Number))[0];
  const centers=modules.map(q=>{const c=quadCenter(q);return {x:dot(c,camera.right),y:dot(c,camera.down)};});
  const x0=Math.min(...centers.map(p=>p.x)),y0=Math.min(...centers.map(p=>p.y)),n=Y_QR.size;
  const cells=new Set(centers.map(p=>`${Math.round((p.y-y0)/pitch)},${Math.round((p.x-x0)/pitch)}`));
  const hits=Y_D4.map(([,map])=>{let h=0;for(let r=0;r<n;r++)for(let c=0;c<n;c++){const [i,j]=map(r,c);if(cells.has(`${r},${c}`)===(Y_QR.modules[i*n+j]===1))h++;}return h;});
  const best=hits.indexOf(Math.max(...hits));
  return {count:modules.length,name:Y_D4[best][0],reflection:best>=4,hits:hits[best],rotationBest:Math.max(...hits.slice(0,4)),reflectionBest:Math.max(...hits.slice(4))};
}
/** 두 점 집합이 외접 사각형 정규화(평행이동 · 축별 배율, 방향 보존) 뒤 같은지 세요. */
function samePointSet(a,b,tol=1e-4){
  const norm=pts=>{const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0;return pts.map(p=>({x:(p.x-x0)/w,y:(p.y-y0)/h}));};
  const A=norm(a),B=norm(b);
  return {count:[A.length,B.length],miss:A.filter(p=>!B.some(q=>Math.abs(p.x-q.x)<tol&&Math.abs(p.y-q.y)<tol)).length};
}
/** 2.5D 장면의 가장 작은 사각형(= QR 모듈) 중심이에요. */
function flatQrCenters(scene){
  const area=s=>{let a=0;for(let k=0;k<4;k++){const p=s.points[k],q=s.points[(k+1)%4];a+=p.x*q.y-q.x*p.y;}return Math.abs(a/2);};
  const polys=scene.shapes.filter(s=>s.kind==='polygon'&&s.points.length===4),min=Math.min(...polys.map(area));
  return polys.filter(s=>area(s)<min*1.5).map(s=>({x:s.points.reduce((t,p)=>t+p.x/4,0),y:s.points.reduce((t,p)=>t+p.y/4,0)}));
}
function yQrCase(encoded){
  const sceneOpts={palette:Y_PALETTE,qrText:Y_QR_TEXT,cornerQr:false},scene=buildSceneY(encoded,sceneOpts);
  return {scene,model:generatorCubeModel({type:'Y',encoded,scene,sceneOpts},Y_PALETTE)};
}
test('타입 Y 안쪽 QR(윈도 β · 슬롯) 양성 락: 출력은 2.5D 와 같은 그림이고, 그 QR 은 미리보기부터 거울이라 glTF · 접은 전개도에서도 반사로만 맞아요',()=>{
  const dark=Y_QR.modules.reduce((s,v)=>s+(v===1),0),cells=Y_QR.size*Y_QR.size;
  for(const [label,encoded] of [
    ['윈도 β',encodeY('window export',{version:2,tones:2,eccLevel:'M',window:true})],
    ['슬롯 v0wy',encodeY('slot export',{cellSurface:true,cellSurfaceLayout:'v0wy',version:1,tones:2,eccLevel:'M'})],
    ['슬롯 v0wq',encodeY('slot export',{cellSurface:true,cellSurfaceLayout:'v0wq',version:1,tones:2,eccLevel:'M'})],
  ]){
    const {scene,model}=yQrCase(encoded),gltf=gltfQuads(cubeModelToGltf(model));
    // ① 출력 = 미리보기: ISO_FRONT(오른손 상수 카메라)로 본 glTF QR 모듈 중심이 2.5D QR 모듈 중심과 같은 그림이에요.
    const flat=flatQrCenters(scene),iso=yQrModules3d(gltf).modules;
    assert.equal(flat.length,dark,`${label}: 2.5D QR 모듈 수`);assert.equal(iso.length,dark,`${label}: glTF QR 모듈 수`);
    assert.ok(dot(iso[0].outward,forwardOf(ISO_FRONT))<0,`${label}: QR 면이 ISO_FRONT 를 향해야 무해 표적이 아니에요`);
    const project=q=>{const c=quadCenter(q);return {x:dot(c,ISO_FRONT.right),y:dot(c,ISO_FRONT.down)};};
    assert.equal(samePointSet(flat,iso.map(project)).miss,0,`${label}: glTF 를 ISO_FRONT 로 본 QR 이 2.5D 와 같은 그림이어야 해요`);
    const before=yQrModules3d(gltfQuads(cubeModelToGltf(remirror(model)))).modules.map(project);
    assert.ok(samePointSet(flat,before).miss>0,`${label}: 대조군 — 수정 전 좌표의 glTF 는 2.5D 와 다른(반전된) 그림이어야 자가 방향을 가려요`);
    // ② 알려진 거울(양성 락): 면 카메라로 본 glTF · 접은 전개도의 QR 은 반사로만 모든 모듈이 맞아요.
    for(const [output,quads] of [['glTF',gltf],['전개도',foldCubeNet(cubeNetScene(model)).quads]]){
      const row=yQrFaceD4(quads);
      assert.equal(row.count,dark,`${label} ${output}: QR 모듈 수`);assert.equal(row.hits,cells,`${label} ${output}: ${row.name}`);
      assert.equal(row.reflection,true,`${label} ${output}: Y 안쪽 QR 은 미리보기부터 거울이에요(${row.name}) — 뿌리를 고쳤다면 이 락을 의도적으로 뒤집어요`);
      assert.ok(row.rotationBest<cells,`${label} ${output}: 회전으로도 맞으면 거울 여부를 가를 수 없어요`);
    }
  }
});

fullOnly(()=>test('전수: 2·3톤 × frame·corners × 1…6면 · 배치 넷 — glTF·전개도 데이터 면이 모두 거울 없이 읽혀요',()=>{
  let faces=0;const modesRead=new Set();
  for(const tones of [2,3])for(const [finder,version] of [['frame',3],['corners',5]])for(const mode of [1,2,3,4,5,6])
    for(const arrangement of ['isometric','horizontal','vertical','symmetric'])for(const renderFaces of [3,6]){
      const encoded=encodeH(`b${mode}`,{version,mode,tones,ecc:'M',mask:5,finder});
      let map;try{map=hDisplayMap(encoded,{arrangement,renderFaces});}catch{continue;}
      const model=buildHCubeModel(encoded,{arrangement,renderFaces}),label=`${tones}톤 ${finder} ${mode}F ${arrangement} rf${renderFaces}`;
      const {quads}=foldCubeNet(cubeNetScene(model)),gltf=gltfQuads(cubeModelToGltf(model));
      for(const face of map.physicalDataFaces){
        const logical=map.physicalToLogical[face],netFound=detectH(sceneField(faceViewScene(quads,face),PPU));
        assert.deepEqual(netFound.faces.map(f=>`${f.face}:${f.mirror}`),[`${logical}:false`],`${label} 전개도 ${face}`);
        // glTF 는 같은 평면의 쿼드만 골라 면 카메라로 봐요(PhysCube 평면으로 찾아요).
        const plane=physicalHCube(model).faces[face].normal,own=gltf.filter(q=>q.outward.every((v,k)=>v===plane[k]));
        const gltfFound=detectH(sceneField(viewScene(own,faceCameras(plane)[0]),PPU));
        assert.deepEqual(gltfFound.faces.map(f=>`${f.face}:${f.mirror}`),[`${logical}:false`],`${label} glTF ${face}`);
        faces+=2;modesRead.add(mode);
      }
    }
  assert.ok(faces>=200,`읽은 면 ${faces}`);
  // 배치 조합이 불가해 건너뛴 모드가 통째로 빠지면 그 모드는 재지 않은 것이에요 — 여섯 모드 모두 실제로 읽었는지 세요.
  assert.deepEqual([...modesRead].sort(),[1,2,3,4,5,6],'모든 면 수 모드를 읽어야 해요');
}));
