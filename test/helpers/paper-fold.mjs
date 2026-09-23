/**
 * 종이 도안(buildPaperSheet 장면)을 재는 자들이에요. 구현(paper-net.js)의 유도 경로를 다시 쓰지 않고,
 * 종이 위 기하와 «인쇄면 기준 산접기» 규칙만으로 접어 본 결과를 물리 큐브(PhysCube)와 대조해요.
 *
 * 접기 모형: 종이는 z = 0 평면, 인쇄면은 −z 를 향해요(x 오른쪽 · y 아래 · 시선 +z 인 오른손 카메라).
 * 산접기는 자식 면을 인쇄면 반대쪽(+z, 뒤)으로 90° 접어요. 그래서 접힌 큐브는 종이 뒤에 생기고 인쇄면이 바깥이에요.
 */
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];

/** 종이 위 면 틀 (i,j) → mm 점. */
export const pageAt=(face,i,j)=>({x:face.corner[0]+i*face.di[0]+j*face.dj[0],y:face.corner[1]+i*face.di[1]+j*face.dj[1]});
/** 종이에서 본 면의 손잡이: det[∂j, ∂i] (열 = 오른쪽, 행 = 아래 가 정본). 양수면 거울 아님. */
export const pageHandedness=face=>Math.sign(face.dj[0]*face.di[1]-face.di[0]*face.dj[1]);

/**
 * 접는 선 목록(folds: {faces:[부모,자식], a, b})만으로 종이를 산접기해 면마다 종이 → 3D 아핀 사상을 만들어요.
 * @returns {Map<face, (p:{x,y}) => number[3]>}
 */
export function foldPaper(faces,folds,root){
  const maps=new Map([[root,{o:[0,0,0],ex:[1,0,0],ey:[0,1,0],back:[0,0,1],anchor:{x:0,y:0}}]]);
  const lin=(M,v)=>add(scale(M.ex,v.x),scale(M.ey,v.y));
  const apply=(M,p)=>add(M.o,lin(M,{x:p.x-M.anchor.x,y:p.y-M.anchor.y}));
  const pending=folds.slice();
  while(pending.length){
    const k=pending.findIndex(f=>maps.has(f.faces[0])!==maps.has(f.faces[1]));
    if(k<0)throw new Error('접는 선이 한 나무로 이어지지 않아요');
    const fold=pending.splice(k,1)[0],parent=maps.has(fold.faces[0])?fold.faces[0]:fold.faces[1],child=parent===fold.faces[0]?fold.faces[1]:fold.faces[0];
    const P=maps.get(parent),a=fold.a,b=fold.b,L=Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2),e={x:(b.x-a.x)/L,y:(b.y-a.y)/L};
    // 자식 쪽 종이 법선 d: 자식 면 중심이 선의 어느 쪽인지로 정해요.
    const c=faces[child],center={x:(c.rect.x0+c.rect.x1)/2,y:(c.rect.y0+c.rect.y1)/2};
    let d={x:-e.y,y:e.x};if((center.x-a.x)*d.x+(center.y-a.y)*d.y<0)d={x:-d.x,y:-d.y};
    const E=lin(P,e),origin=apply(P,a);
    // 종이 벡터 v → 3D: 선 방향 성분은 부모 그대로, 선에서 멀어지는 성분은 부모의 뒤쪽(산접기)으로.
    const ex=add(scale(E,e.x),scale(P.back,d.x)),ey=add(scale(E,e.y),scale(P.back,d.y));
    maps.set(child,{o:origin,ex,ey,back:scale(lin(P,d),-1),anchor:{x:a.x,y:a.y}});
  }
  return new Map([...maps].map(([face,M])=>[face,p=>apply(M,p)]));
}

/**
 * 접은 종이가 물리 큐브와 일치하는지 재요. 뿌리 면의 세 점 (0,0)·(n,0)·(0,n) 을 맞추는 직교 정렬을 둘 만들어요:
 * 진회전(det +1)과 반사(det −1). 모든 면의 모든 셀 꼭짓점을 PhysCube 좌표(셀 × 피치/n)와 대조해 각 정렬의 최대 오차를 내요.
 * 올바른 도안은 properError ≈ 0 이고 mirrorError 가 커요. 거울 도안은 반대예요.
 * @returns {{properError:number, mirrorError:number, worst:string|null}}
 */
export function foldAgainstPhys(scene,phys,{faceIds}={}){
  const meta=scene.paper,folded=foldPaper(meta.faces,meta.folds,meta.layout.root),n=phys.n,unit=meta.pitchMm/n;
  const physAt=(name,i,j)=>{const f=phys.faces[name];return scale(add(f.origin,add(scale(f.di,i),scale(f.dj,j))),unit);};
  const root=meta.layout.root,fold=(name,i,j)=>folded.get(name)(pageAt(meta.faces[name],i,j));
  const f0=fold(root,0,0),f1=fold(root,n,0),f2=fold(root,0,n),g0=physAt(root,0,0),g1=physAt(root,n,0),g2=physAt(root,0,n);
  const norm=v=>scale(v,1/Math.sqrt(dot(v,v)));
  const fa=norm(sub(f1,f0)),fb=norm(sub(f2,f0)),fc=cross(fa,fb),ga=norm(sub(g1,g0)),gb=norm(sub(g2,g0));
  const measure=sign=>{
    const gc=scale(cross(ga,gb),sign),R=[0,1,2].map(r=>[0,1,2].map(c=>ga[r]*fa[c]+gb[r]*fb[c]+gc[r]*fc[c]));
    let maxError=0,worst=null;
    for(const name of faceIds??Object.keys(meta.faces))for(let i=0;i<=n;i++)for(let j=0;j<=n;j++){
      const q=sub(fold(name,i,j),f0),mapped=add(g0,[dot(R[0],q),dot(R[1],q),dot(R[2],q)]),d=sub(mapped,physAt(name,i,j)),err=Math.sqrt(dot(d,d));
      if(err>maxError){maxError=err;worst=`${name}(${i},${j})`;}
    }
    return {maxError,worst};
  };
  const proper=measure(1),mirror=measure(-1);
  return {properError:proper.maxError,mirrorError:mirror.maxError,worst:proper.worst};
}

/** 볼록 다각형 겹침(분리축, 테스트 쪽 독립 구현). 가장자리 접촉은 겹침이 아니에요. */
export function overlap(P,Q,eps=1e-7){
  for(const poly of [P,Q])for(let k=0;k<poly.length;k++){
    const a=poly[k],b=poly[(k+1)%poly.length],ex=b.x-a.x,ey=b.y-a.y,L=Math.sqrt(ex*ex+ey*ey);
    if(L<1e-12)continue;
    const nx=ey/L,ny=-ex/L,pp=P.map(p=>p.x*nx+p.y*ny),qq=Q.map(p=>p.x*nx+p.y*ny);
    if(Math.min(Math.max(...pp),Math.max(...qq))-Math.max(Math.min(...pp),Math.min(...qq))<=eps)return false;
  }
  return true;
}
const rect=r=>[{x:r.x0,y:r.y0},{x:r.x1,y:r.y0},{x:r.x1,y:r.y1},{x:r.x0,y:r.y1}];

/**
 * 도안 영역들을 모아 서로 다른 무리끼리 겹침을 세요. 면(인쇄 영역) · 날개 · 글리프 라벨 · 막대 · 틱 · 재단선 · 접기 파선 · 조립 지도.
 * 허용: 같은 무리 안 · 접기 파선과 그 날개(파선은 날개 위에 그려요).
 * @returns {string[]} 겹친 쌍 설명
 */
export function paperOverlaps(scene){
  const meta=scene.paper,items=[];
  for(const [name,f] of Object.entries(meta.faces))items.push({group:`face:${name}`,points:rect(f.visible)});
  for(const t of meta.tabs??[])items.push({group:`tab:${t.cut}`,points:t.polygon});
  for(const s of scene.shapes){
    if(s.role==='module'||s.role==='image')continue;
    const group=s.role==='glyph'?`glyph:${s.group}`:s.role==='fold'?`fold:${s.tab}`:s.role==='cut'?`cut:${s.face??''}`:s.role==='tick'?`tick:${s.fold}:${s.points[0].x}`:s.role;
    items.push({group,points:s.points});
  }
  const allowed=(a,b)=>a===b||(a.startsWith('fold:')&&b===`tab:${a.slice(5)}`)||(b.startsWith('fold:')&&a===`tab:${b.slice(5)}`);
  const found=[];
  for(let x=0;x<items.length;x++)for(let y=x+1;y<items.length;y++){
    if(allowed(items[x].group,items[y].group))continue;
    if(overlap(items[x].points,items[y].points))found.push(`${items[x].group} × ${items[y].group}`);
  }
  return found;
}

/** 여백 m 밖으로 나간 도형(재단선 잉크는 바깥쪽 선폭 cutMm 까지 허용). */
export function marginViolations(scene,{cutMm=0.2}={}){
  const {marginMm:m,widthMm:W,heightMm:H}=scene.paper,out=[];
  scene.shapes.forEach((s,k)=>{
    const slack=(s.role==='cut'?cutMm:0)+1e-6;
    if(s.points.some(p=>p.x<m-slack||p.x>W-m+slack||p.y<m-slack||p.y>H-m+slack))out.push(`${k}:${s.role}`);
  });
  return out;
}
