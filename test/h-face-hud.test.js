/** H 면 HUD의 접힘 기하·프레임 사영·관측 만료 회귀. */
import test from 'node:test';
import assert from 'node:assert/strict';
const mod=path=>import(new URL(`../${path}`,import.meta.url));
const [{H_FACE_IDS},{H_FACE_NET,H_FACE_NET_EDGES,hFaceNetModel,hFrameToStageMapping,hLiveFaceLabelsModel,cssMatrix3dForHomography},{cameraLiveness}]=await Promise.all([
  mod('src/h-profile.js'),mod('src/h-face-hud.js'),mod('src/scanner-camera-lifecycle.js'),
]);
const N={ZM:[0,0,-1],XM:[-1,0,0],YM:[0,-1,0],ZP:[0,0,1],XP:[1,0,0],YP:[0,1,0]};
const eq=(a,b)=>a.every((x,i)=>x===b[i]),neg=v=>v.map(x=>-x),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function fold({u,v,n},dir){if(dir==='E')return{u:neg(n),v:[...v],n:[...u]};if(dir==='W')return{u:[...n],v:[...v],n:neg(u)};if(dir==='S')return{u:[...u],v:neg(n),n:[...v]};return{u:[...u],v:[...n],n:neg(v)};}
function direction(a,b){const dx=b.x-a.x,dy=b.y-a.y;return dx===1?'E':dx===-1?'W':dy===1?'S':'N';}
function stats(overrides={}){return {required:3,leadingId:'a',observedAt:1000,frameWidth:100,frameHeight:100,observedFaces:[{face:'ZM',n:1,H:[1,0,0,0,1,0,0,0,1],quality:{score:1}}],assemblies:[{id:'a',present:['ZM','XM'],expiresAt:5000,faceExpiresAt:{ZM:5000,XM:5000}}],...overrides};}
function renderDom(net,labels){const label={hidden:false,dataset:{},children:[],replaceChildren(...children){this.children=children;}},faceNet={hidden:false,dataset:{},children:[],replaceChildren(...children){this.children=children;}};label.replaceChildren(...labels.map(x=>({face:x.face,transform:x.matrix3d})));label.hidden=labels.length===0;faceNet.replaceChildren(...net.cells.map(x=>({face:x.face,state:x.state,column:x.x+1,row:x.y+1})));faceNet.hidden=net.required===0;return{label,faceNet};}

test('4x3 H zigzag has a connected five-edge integer basis folding with six physical normals',()=>{
  assert.deepEqual(H_FACE_NET,{ZM:{x:0,y:0},XP:{x:1,y:0},YM:{x:1,y:1},ZP:{x:2,y:1},XM:{x:2,y:2},YP:{x:3,y:2}});
  assert.equal(H_FACE_NET_EDGES.length,5);const byPos=new Map(H_FACE_IDS.map(face=>[`${H_FACE_NET[face].x},${H_FACE_NET[face].y}`,face]));
  const basis=new Map([['ZM',{u:[1,0,0],v:[0,-1,0],n:[0,0,-1]}]]),queue=['ZM'];
  while(queue.length){const face=queue.shift(),p=H_FACE_NET[face];for(const [d,[dx,dy]] of Object.entries({E:[1,0],W:[-1,0],S:[0,1],N:[0,-1]})){const next=byPos.get(`${p.x+dx},${p.y+dy}`);if(!next)continue;const candidate=fold(basis.get(face),d),prior=basis.get(next);if(prior)assert.ok(eq(prior.u,candidate.u)&&eq(prior.v,candidate.v)&&eq(prior.n,candidate.n),`basis conflict ${face}/${next}`);else{basis.set(next,candidate);queue.push(next);}}}
  assert.equal(basis.size,6);assert.equal(new Set([...basis.values()].map(b=>b.n.join(','))).size,6);
  for(const [face,b] of basis){assert.ok(eq(b.n,N[face]),face);assert.equal(dot(b.u,b.v),0);assert.equal(dot(b.u,b.n),0);assert.equal(dot(b.v,b.n),0);assert.ok(eq(cross(b.u,b.v),b.n));for(const v of [b.u,b.v,b.n])assert.ok(v.every(Number.isInteger));}
});

test('H HUD shares progress TTL and current-label TTL, rejecting stale/reset/mirror mappings',()=>{
  const live=stats(),mapping=hFrameToStageMapping({frameCrop:{sourceX:0,sourceY:0,sourceSide:100,target:100},stageCrop:{x:0,y:0,width:100,height:100},side:100});
  const net=hFaceNetModel(live,1500),labels=hLiveFaceLabelsModel({stats:live,now:1500,cameraActive:true,runtimeEnabled:true,mapping});
  assert.equal(net.required,3);assert.equal(net.cells.find(x=>x.face==='ZM').state,'CURRENT');assert.equal(net.cells.find(x=>x.face==='XM').state,'PRESENT');assert.equal(labels.length,1);
  assert.deepEqual(labels[0].corners,[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);assert.match(labels[0].matrix3d,/^matrix3d\(/);
  for(const args of [{now:1501,cameraActive:true,runtimeEnabled:true,mapping},{now:1500,cameraActive:false,runtimeEnabled:true,mapping},{now:1500,cameraActive:true,runtimeEnabled:false,mapping},{now:1500,cameraActive:true,runtimeEnabled:true,mapping:{...mapping,mirrorX:true}},{now:1500,cameraActive:true,runtimeEnabled:true,mapping:null}])assert.deepEqual(hLiveFaceLabelsModel({stats:live,...args}),[]);
  const expired=hFaceNetModel(stats({assemblies:[{id:'a',present:['ZM'],expiresAt:1499}]}),1500);assert.equal(expired.required,0);assert.ok(expired.cells.every(x=>x.state==='NOT_REQUIRED'));
});

test('crop affine preserves projected corners and center; mock DOM hides ghost labels at expiry',()=>{
  const mapping=hFrameToStageMapping({frameCrop:{sourceX:20,sourceY:10,sourceSide:200,target:100},stageCrop:{x:10,y:20,width:200,height:100},side:400});
  assert.deepEqual(mapping.frameToStage,{xScale:4,xOffset:20,yScale:8,yOffset:-40});
  const row={face:'ZM',n:1,H:[.5,0,10,0,.25,5,0,0,1],quality:{score:2}},s=stats({observedFaces:[row]});
  const labels=hLiveFaceLabelsModel({stats:s,now:1200,cameraActive:true,runtimeEnabled:true,mapping});assert.equal(labels.length,1);
  assert.deepEqual(labels[0].corners,[{x:60,y:0},{x:62,y:0},{x:62,y:2},{x:60,y:2}]);
  assert.match(cssMatrix3dForHomography(labels[0].H),/^matrix3d\(/);
  const liveDom=renderDom(hFaceNetModel(s,1200),labels),staleDom=renderDom(hFaceNetModel(s,1501),hLiveFaceLabelsModel({stats:s,now:1501,cameraActive:true,runtimeEnabled:true,mapping}));
  assert.equal(liveDom.label.hidden,false);assert.equal(liveDom.faceNet.children.length,6);assert.equal(staleDom.label.hidden,true);assert.equal(staleDom.label.children.length,0);
});

test('camera lifecycle vocabulary is live, not ready',()=>{
  assert.equal(cameraLiveness({hasStream:true,videoTrackStates:['live'],srcObjectMatches:true,videoEnded:false}),'live');
  assert.notEqual(cameraLiveness({hasStream:true,videoTrackStates:['live'],srcObjectMatches:true,videoEnded:false}),'ready');
});
