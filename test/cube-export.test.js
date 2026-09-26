import test from 'node:test';import assert from 'node:assert/strict';import { makeFaces,hFacePoint,hLayout } from '../src/h-layout.js';import { buildOrbitMesh } from '../src/y3d-viewer.js';import { layoutForCube } from '../src/ygrid.js';import { CUBE_FACES,buildHCubeModel,buildYCubeModel,cubeModelToGltf,cubeNetScene } from '../src/cube-export.js';
const pal={background:{r:255,g:255,b:255},levels:[{r:20,g:20,b:20},{r:120,g:120,b:120},{r:220,g:220,b:220}]},norm={ZM:[0,0,-1],XM:[-1,0,0],YM:[0,-1,0],ZP:[0,0,1],XP:[1,0,0],YP:[0,1,0]},sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function h(){const l=hLayout(0);return{version:0,mode:3,tones:3,ecc:'M',mask:0,faces:makeFaces({version:0,mode:3,tones:3,ecc:'M',mask:0,routeId:0,triadDigits:[Array(l.scan.length).fill(0)]})};}function sq(f){return[[0,0],[0,1],[1,1],[1,0]].map(([i,j])=>hFacePoint(f,i,j,1));}const keys=(s)=>new Set(s.points.map((p)=>p.x+','+p.y));
test('H는 surface 물리 N의 6면 normalized winding이며 3F 후면은 levels 없이 back이다',()=>{const m=buildHCubeModel(h(),{palette:pal});assert.equal(m.dataN,13);assert.equal(m.quads.length,6*m.n*m.n);assert.ok(m.quads.filter((q)=>q.face==='ZP').every((q)=>q.kind==='back'));for(const f of CUBE_FACES)for(const q of m.quads.filter((q)=>q.face===f))assert.ok(dot(cross(sub(q.corners[1],q.corners[0]),sub(q.corners[2],q.corners[0])),norm[f])>0);});
test('Y 회전은 거부하고 overlay model 좌표는 표면에 남는다',()=>{const o={n:2,tones:3,levels:pal.levels,layout:layoutForCube(2,{size:1,margin:0}),digitAt:()=>0,includeBack:true,faceQuads:[{face:'T',a:0,b:0,size:.5,color:pal.levels[2]}]};assert.throws(()=>buildYCubeModel(buildOrbitMesh({...o,yaw:.01})),/정위치/);const m=buildYCubeModel(buildOrbitMesh({...o,yaw:0,pitch:0,roll:0}));assert.equal(m.quads.find((q)=>q.kind==='overlay').corners[0][2],0);});
// 접는 선은 전개도 칸(물리 평면 plane) 사이예요. 2026-09-26 부터 시트(face)는 물리 좌표 교환으로 다른 칸에 놓일 수 있어요.
test('십자 net의 다섯 shared fold edge는 2점을 공유한다',()=>{const m={n:1,kind:'Y',dataFaces:CUBE_FACES,quads:CUBE_FACES.map((face)=>({face,kind:'module',color:pal.levels[0],corners:sq(face)}))},s=Object.fromEntries(cubeNetScene(m,{margin:0}).shapes.map((x)=>[x.plane,x]));for(const[a,b]of[['ZM','YM'],['ZM','XM'],['ZM','XP'],['ZM','YP'],['YP','ZP']])assert.equal([...keys(s[a])].filter((k)=>keys(s[b]).has(k)).length,2,a+'-'+b);});
test('glTF만 overlay epsilon과 linear RGBA, 큰 Uint32 index를 쓴다',()=>{const q={face:'ZM',kind:'overlay',color:{r:128,g:128,b:128},corners:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]},m={n:1,kind:'Y',dataFaces:['ZM'],quads:[q]},g=cubeModelToGltf(m),raw=Buffer.from(g.buffers[0].uri.split(',')[1],'base64'),pos=new Float32Array(raw.buffer,raw.byteOffset,3),rgba=new Float32Array(raw.buffer,raw.byteOffset+48,4);assert.ok(Math.abs(pos[2]+1e-4)<1e-9);assert.ok(Math.abs(rgba[0]-.21586)<1e-4);assert.equal(cubeModelToGltf({...m,quads:Array.from({length:16384},()=>({...q,kind:'module'}))}).accessors[2].componentType,5125);});

test('glTF QR 흰 판과 위의 모듈은 별도 깊이이며 옆 모듈끼리는 평면이다',()=>{
  for(const face of CUBE_FACES){
    const quad=(i,j,s)=>{let c=[[i,j],[i,j+s],[i+s,j+s],[i+s,j]].map(([a,b])=>hFacePoint(face,a,b,41));if(dot(cross(sub(c[1],c[0]),sub(c[2],c[0])),norm[face])<0)c=[c[0],c[3],c[2],c[1]];return{face,kind:'overlay',corners:c,color:pal.levels[0]};};
    const m={n:41,kind:'Y',dataFaces:[face],quads:[quad(0,0,4),quad(1,1,.5),quad(2,2,.5)]},before=JSON.stringify(m),g=cubeModelToGltf(m),raw=Buffer.from(g.buffers[0].uri.split(',')[1],'base64'),positions=new Float32Array(raw.buffer,raw.byteOffset,36);
    // glTF 는 물리 좌표라 바깥 법선을 파일의 좌표에서 유도해요: 첫 쿼드 네 꼭짓점이 같은 축 = 면 축, 그 값이 n 쪽이면 +.
    const axis=[0,1,2].find(k=>[1,2,3].every(v=>positions[v*3+k]===positions[k])),out=[0,0,0];out[axis]=positions[axis]>41/2?1:-1;
    const depth=i=>dot([...positions.slice(i*12,i*12+3)],out);
    assert.ok(depth(1)>depth(0),face);assert.equal(depth(1),depth(2));assert.equal(JSON.stringify(m),before);
  }
});

test('glTF는 잘못된 좌표·색·면·꼭짓점과 과도한 중첩을 직렬화 전에 거부한다',()=>{
  const q={face:'ZM',kind:'module',color:{r:128,g:128,b:128},corners:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]};
  const model=quad=>({n:1,quads:[quad]});
  for(const change of [x=>x.color.r=NaN,x=>x.corners[0][0]=Infinity,x=>x.corners.pop(),x=>x.face='constructor',x=>x.corners[1][2]=.1,x=>x.corners.reverse()]){const bad=structuredClone(q);change(bad);assert.throws(()=>cubeModelToGltf(model(bad)));}
  assert.throws(()=>cubeModelToGltf({n:1,quads:Array.from({length:33},()=>({...q,kind:'overlay'}))}),/층 한도/);
  assert.throws(()=>cubeModelToGltf({n:1,quads:Array.from({length:4097},()=>({...q,kind:'overlay'}))}),/overlay 한도/);
});
