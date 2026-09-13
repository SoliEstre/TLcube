/** 미리보기 전용 위치 라벨과 배치 아이콘. 코드/내보내기 scene에 들어가지 않아요. */
import {hProjection} from './h-render.js';
import {hFacePoint} from './h-layout.js';
import {H_FACE_IDS,hModeFaces,normalizeHProfile} from './h-profile.js';
import {hDisplayMap,hContentFitsSingleView,hContentFitsVisibleFaces} from './h-face-arrangement.js';

export function hPreviewDisplayMap(state){
  const mode=state.hFaces??3;
  return hDisplayMap({mode,faces:Object.fromEntries(hModeFaces(mode).map(face=>[face,true]))},
    {arrangement:state.hArrangement??'isometric',renderFaces:state.hRenderFaces??(mode>3?6:3)});
}
/** 새 사각 로케이터 프로필은 안전한 외부 표시부터 시작하고 같은 프로필의 명시 선택은 유지해요. */
export function reconcileHPositionMode(mode,previous,next){
  const selected=['none','outside','inside'].includes(mode)?mode:'outside';
  const changed=!previous||['version','mode','finder'].some(key=>previous[key]!==next?.[key]);
  return next?.finder==='corners'&&changed?'outside':selected;
}
/** 반대 면의 중복 본문은 같은 logical ID로 세어요. */
export function hCanPreview25(state,faceImages={}){
  const mode=state.hFaces??3;
  return hContentFitsSingleView({mode,faces:Object.fromEntries(hModeFaces(mode).map(face=>[face,true]))},faceImages,
    {arrangement:state.hArrangement,renderFaces:state.hRenderFaces});
}
/** 현재 시점이 완전하면 유지하고, 아니면 모든 콘텐츠가 보이는 아이소메트릭 시점을 골라요. */
export function hPlanarPreviewOptions(encoded,options={},faceImages={}){
  const fits=view=>hContentFitsVisibleFaces(encoded,faceImages,view,hProjection(1,view).visible);
  if(fits(options))return {...options};
  for(const rotateX of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const rotateY of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
    const view={...options,rotateX,rotateY,rotateZ:0};
    if(fits(view))return view;
  }
  return null;
}
function quad(face,n,project){return [[0,0],[0,n],[n,n],[n,0]].map(([i,j])=>project(hFacePoint(face,i,j,n)));}
/** 단위 정사각형 -> 사영 사각형. 라벨 글리프도 원근 분모를 그대로 가져요. */
export function hQuadHomography(p){
  const [a,b,c,d]=p,dx1=b.x-c.x,dx2=d.x-c.x,dy1=b.y-c.y,dy2=d.y-c.y;
  const dx3=a.x-b.x+c.x-d.x,dy3=a.y-b.y+c.y-d.y,det=dx1*dy2-dx2*dy1;
  if(!Number.isFinite(det)||Math.abs(det)<1e-10)return null;
  const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
  return [b.x-a.x+g*b.x,d.x-a.x+h*d.x,a.x,b.y-a.y+g*b.y,d.y-a.y+h*d.y,a.y,g,h,1];
}
export function hBlankFaceLabels(encoded,options={},side=100){
  const n=normalizeHProfile(encoded).n,projection=hProjection(n,options),map=hDisplayMap(encoded,options),scale=side/projection.width;
  const faces=options.labelCodeFaces?[...map.blankFaces,...map.physicalDataFaces]:map.blankFaces;
  return [...new Set(faces)].filter(face=>projection.visible.includes(face)).flatMap(face=>{
    const points=quad(face,n,projection.project).map(p=>({x:p.x*scale,y:p.y*scale})),H=hQuadHomography(points);
    if(!H)return [];
    const [a,b,c,d,e,f,g,h]=H;
    const matrix=[a/100,d/100,0,g/100,b/100,e/100,0,h/100,0,0,1,0,c,f,0,1];
    return [{face,points,matrix3d:`matrix3d(${matrix.map(v=>Number(v.toFixed(12))).join(',')})`}];
  });
}
/** 코드 면은 실루엣 바깥에 표시해요. 여백이 없으면 참조 셀을 가리지 않고 숨겨요. */
export function hPreviewPositionLabels(encoded,options={},side=100){
  const positionMode=['none','outside','inside'].includes(options.positionMode)?options.positionMode:'outside';
  if(positionMode==='none')return [];
  const rows=hBlankFaceLabels(encoded,{...options,labelCodeFaces:true},side);
  if(positionMode==='inside')return rows.map(row=>({...row,kind:'surface'}));
  const points=rows.flatMap(row=>row.points),placed=[],result=[],width=64,height=40,gap=8;
  // 코너 QR의 최대 크기(.17)와 inset(.035)보다 넓은 보수적 제외 영역이에요.
  const corner=options.qr?.corner,qrSize=side*.21;
  const qr=corner?{x:corner.endsWith('R')?side-qrSize:0,y:corner.startsWith('B')?side-qrSize:0,width:qrSize,height:qrSize}:null;
  const overlaps=(a,b)=>a.x<b.x+b.width+2&&a.x+a.width+2>b.x&&a.y<b.y+b.height+2&&a.y+a.height+2>b.y;
  for(const row of rows){
    const center=row.points.reduce((sum,p)=>({x:sum.x+p.x/4,y:sum.y+p.y/4}),{x:0,y:0}),candidates=[];
    for(let i=0;i<4;i++){
      const a=row.points[i],b=row.points[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      if(length<1)continue;
      const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};let nx=-dy/length,ny=dx/length;
      if((center.x-mid.x)*nx+(center.y-mid.y)*ny>0){nx=-nx;ny=-ny;}
      if(points.some(p=>(p.x-mid.x)*nx+(p.y-mid.y)*ny>1e-5))continue;
      const extent=Math.abs(nx)*width/2+Math.abs(ny)*height/2;
      const box={x:mid.x+nx*(extent+gap)-width/2,y:mid.y+ny*(extent+gap)-height/2,width,height};
      if(box.x<3||box.y<3||box.x+width>side-3||box.y+height>side-3||qr&&overlaps(box,qr)||placed.some(p=>overlaps(box,p)))continue;
      const line=[{x:mid.x+nx*3,y:mid.y+ny*3},{x:mid.x+nx*(gap-2),y:mid.y+ny*(gap-2)}];
      const lineBox={x:Math.min(...line.map(p=>p.x)),y:Math.min(...line.map(p=>p.y)),width:Math.abs(line[1].x-line[0].x),height:Math.abs(line[1].y-line[0].y)};
      if(qr&&overlaps(lineBox,qr))continue;
      candidates.push({box,line,length});
    }
    candidates.sort((a,b)=>b.length-a.length);
    if(!candidates.length)continue;
    const {box,line}=candidates[0];placed.push(box);
    result.push({...row,kind:'callout',box,line,matrix3d:`translate3d(${box.x}px,${box.y}px,0)`});
  }
  return result;
}
export function hCubeIconMarkup({representation='2.5d',mode=3,arrangement='isometric',placements=false}={}){
  const projection=hProjection(1,{margin:.13,perspective:representation==='3d'?.15:0,
    rotateX:representation==='3d'?.12:0,rotateY:representation==='3d'?-.14:0,rotateZ:representation==='3d'?.06:0});
  const safeMode=arrangement!=='isometric'?Math.min(4,mode):mode;
  const map=hPreviewDisplayMap({hFaces:safeMode,hArrangement:arrangement,hRenderFaces:safeMode>3?6:3});
  const all=H_FACE_IDS.map(face=>({face,points:quad(face,1,projection.project)}));
  const polygons=all.filter(row=>placements?map.physicalDataFaces.includes(row.face):projection.visible.includes(row.face))
    .map(row=>`<polygon data-face="${row.face}" points="${row.points.map(p=>`${p.x},${p.y}`).join(' ')}" fill="currentColor" opacity="${placements?'.23':row.face==='ZM'?'.12':row.face==='XM'?'.28':'.45'}"/>`).join('');
  // 두 면이 공유하는 edge도 한 번만. 모든 외곽선은 마지막에 그려 면에 가려지지 않아요.
  const edges=new Map();
  for(const row of all)for(let i=0;i<4;i++){
    const a=row.points[i],b=row.points[(i+1)%4],key=[`${a.x},${a.y}`,`${b.x},${b.y}`].sort().join('|');
    if(placements||projection.visible.includes(row.face))edges.set(key,`<path d="M${a.x} ${a.y}L${b.x} ${b.y}"/>`);
  }
  return `<svg viewBox="0 0 ${projection.width} ${projection.height}" width="28" height="28" aria-hidden="true">${polygons}<g fill="none" stroke="currentColor" stroke-width=".027" stroke-linejoin="round">${[...edges.values()].join('')}</g></svg>`;
}
export function hExportIconMarkup(kind){
  let path;
  if(kind==='net')path='<path d="M2 8h20v5H2ZM7 3h5v15H7ZM2 8v5m10-5v5m5-5v5"/>';
  else if(kind==='copy')path='<rect x="8" y="7" width="12" height="14" rx="2"/><path d="M16 7V3H4v14h4"/>';
  else if(kind==='reset')path='<path d="M4 8a9 9 0 1 1 0 9M4 3v5h5"/><path d="M12 7s-4 5-4 7a4 4 0 0 0 8 0c0-2-4-7-4-7Z"/>';
  else if(kind==='schem')path='<rect x="2" y="2" width="20" height="20" rx="1"/><path fill="currentColor" stroke="none" d="M5 6h5v5H5Zm9 0h5v5h-5Zm-4 4h4v4h3v5h-4v-3h-2v3H7v-5h3Z"/>';
  else if(kind==='rotateLeft'||kind==='rotateRight')return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><g${kind==='rotateRight'?' transform="translate(24 0) scale(-1 1)"':''}><path d="M5 9a8 8 0 1 1-1 7M5 3v6h6"/></g></svg>`;
  else return hCubeIconMarkup({representation:'3d'});
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
export function hBlockIconMarkup(scale){
  let cells='';for(let y=0;y<scale;y++)for(let x=0;x<scale;x++)cells+=`<rect x="${3+x*18/scale}" y="${3+y*18/scale}" width="${18/scale-1}" height="${18/scale-1}"/>`;
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" opacity=".7" aria-hidden="true">${cells}</svg>`;
}
