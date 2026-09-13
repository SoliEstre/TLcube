import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {detectH} from '../src/h-detect.js';
import {detectHCornerQuads} from '../src/h-corner-detect.js';
import {createHCollector} from '../src/h-collector.js';
import {buildHScene,buildHFaceSheet,hAutoRotation} from '../src/h-render.js';
import {hLayout} from '../src/h-layout.js';
import {rasterize} from '../src/raster.js';
import {relativeLuminance8,getPreset} from '../src/luminance.js';
import {hScreenSpin} from '../src/h-rotation.js';

function optical(scene,size=960,exposure=false){
  const r=rasterize(scene,{pixelsPerUnit:size/scene.width,supersample:2});
  const data=Float32Array.from({length:r.width*r.height},(_,i)=>{
    const v=relativeLuminance8(r.pixels[i*4],r.pixels[i*4+1],r.pixels[i*4+2]);
    return exposure?.085+.665*v:v;
  });return {width:r.width,height:r.height,data};
}
function finish(e,fields){
  const c=createHCollector();let s;
  for(let i=0;i<fields.length;i++){
    const hit=detectH(fields[i],{debug:true});
    s=c.addFrame({observations:hit.faces,frameId:i,timestamp:i*100});
    assert.ok(hit.faces.some(f=>f.finder==='corners'),JSON.stringify({i,stats:hit.stats,rejected:hit.rejected}));
  }return s;
}

function smallCube(e,pose={},occupancy=.35){
  const scene=buildHScene(e,{perspective:.18,outline:true,...pose}),points=scene.shapes.flatMap(s=>s.points);
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const scale=1080*occupancy/Math.max(x1-x0,y1-y0);
  return optical({...scene,width:1080,height:1080,shapes:scene.shapes.map(s=>({...s,points:s.points.map(p=>({x:540+(p.x-(x0+x1)/2)*scale,y:540+(p.y-(y0+y1)/2)*scale}))}))},1080);
}

for(const contrast of [1,.4])test(`H5 실제 폭85%·대비${contrast}의 작은 윤곽 조각이 파인더 예산을 소모하지 않는다`,()=>{
  const text=`final-scale/H5/3F/0.85/${contrast}`,e=encodeH(text,{version:5,mode:3,tones:3,ecc:'M',mask:0,finder:'auto'});
  const field=smallCube(e,{},.85);
  for(let i=0;i<field.data.length;i++)field.data[i]=1-contrast*(1-field.data[i]);
  const hit=detectH(field,{debug:true});
  assert.equal(hit.stats.capped,false,JSON.stringify(hit.stats));
  assert.deepEqual(hit.faces.map(f=>f.face).sort(),['XM','YM','ZM']);
  const done=createHCollector().addFrame({observations:hit.faces,frameId:0,timestamp:0});
  assert.equal(done.state,'DONE');assert.equal(done.count,3);assert.equal(done.result.text,text);
});

test('강한 원근의 윤곽선도 먼 코너 quiet를 덮지 않고 Y축 반주기에 6면을 모은다',()=>{
  const text='H020-rotation-six-face',e=encodeH(text,{version:7,mode:6,tones:3,ecc:'M',mask:0,finder:'auto'});
  const palette={levels:getPreset('slate').levels,background:{r:255,g:255,b:255}};
  const frames=[0,12000].map(t=>optical(buildHScene(e,{...hScreenSpin(t,{axis:'y',speed:15}),perspective:.5,outline:true,palette}),1080));
  const first=finish(e,[frames[0]]);assert.equal(first.state,'COLLECTING');assert.equal(first.count,3);assert.equal(first.result,undefined);
  const done=finish(e,frames);assert.equal(done.state,'DONE');assert.equal(done.count,6);assert.equal(done.result.text,text);
});

test('실제 큐브 폭35%의 사선 AA/윤곽선에서도 H5 이상은 전체 본문을 모은다',()=>{
  for(const version of [5,6,7]){
    const e=encodeH('small-corners',{version,mode:3,tones:3,mask:0,finder:'auto'});
    const s=finish(e,[smallCube(e)]);assert.equal(s.state,'DONE');assert.equal(s.count,3);assert.equal(s.result.text,'small-corners');
  }
  const e=encodeH('small-six',{version:7,mode:6,tones:3,mask:0,finder:'auto'});
  const front=smallCube(e),back=smallCube(e,{rotateX:Math.PI/2,rotateY:Math.PI});
  assert.equal(finish(e,[front]).state,'COLLECTING');
  const s=finish(e,[front,back]);assert.equal(s.state,'DONE');assert.equal(s.count,6);assert.equal(s.result.text,'small-six');
});

test('기하로 고른 quiet 표본도 실제 밝은 데이터색을 흰 예약셀로 인정하지 않는다',()=>{
  const e=encodeH('quiet-guard',{version:7,mode:3,tones:3,mask:0,finder:'corners'});
  e.faces.YM[37*e.n+40]=2; // high data luma 약0.76 < 흰색 문턱0.82
  const hit=detectH(smallCube(e),{debug:true});
  assert.ok(hit.faces.length>0);assert.equal(hit.faces.some(f=>f.face==='YM'),false);
  const s=createHCollector().addFrame({observations:hit.faces,frameId:0,timestamp:0});
  assert.notEqual(s.state,'DONE');assert.equal(s.result,undefined);
});

test('검정 seed와 AA 연결을 분리해 유색 데이터가 사각 후보 예산을 소모하지 않는다',()=>{
  const palettes=[
    {levels:[{r:40,g:75,b:110},{r:85,g:156,b:195},{r:187,g:223,b:242}]},
    {levels:[{r:121,g:66,b:27},{r:204,g:144,b:71},{r:248,g:216,b:161}]},
  ];
  for(const palette of palettes)for(const tones of [2,3]){
    const e=encodeH('colored-six',{version:7,mode:6,tones,mask:0,finder:'corners'});
    const fields=[smallCube(e,{palette}),smallCube(e,{palette,rotateX:Math.PI/2,rotateY:Math.PI})];
    const first=detectH(fields[0]);
    assert.equal(first.stats.photometric.seedThreshold,.04);
    assert.equal(first.stats.photometric.threshold,.12);
    const s=finish(e,fields);assert.equal(s.state,'DONE');assert.equal(s.count,6);assert.equal(s.result.text,'colored-six');
  }
});

test('외부 사각 API는 null/희소/비유한 점을 예외 없이 거부한다',()=>{
  const field={width:20,height:20,data:new Float32Array(400).fill(1)};
  for(const q of [[null,null,null,null],Array(4),[{x:Infinity,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]]){
    const result=detectHCornerQuads(field,[q]);assert.equal(result.faces.length,0);assert.equal(result.rejected[0].reason,'quad');
  }
});

test('직사각 화면의 특정 AA 위상에서도 hull 축약이 실제 코너를 잃지 않는다',()=>{
  for(const tones of [2,3]){
    const e=encodeH('H014-fixed-profile-payload',{version:7,mode:3,tones,mask:7,finder:'corners'});
    const scene=buildHScene(e,{perspective:.18,outline:true}),pts=scene.shapes.flatMap(s=>s.points);
    const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    const scale=900*.62/Math.max(x1-x0,y1-y0);
    const field=optical({...scene,width:1440,height:900,shapes:scene.shapes.map(s=>({...s,points:s.points.map(p=>({x:720+(p.x-(x0+x1)/2)*scale,y:450+(p.y-(y0+y1)/2)*scale}))}))},1440);
    for(let i=0;i<field.data.length;i++)field.data[i]=1-.65*(1-field.data[i]);
    const hit=detectH(field),s=createHCollector().addFrame({observations:hit.faces,frameId:0,timestamp:0});
    assert.deepEqual(hit.faces.map(f=>f.face).sort(),['XM','YM','ZM']);
    assert.equal(s.state,'DONE');assert.equal(s.result.text,'H014-fixed-profile-payload');
  }
});

test('3면 H5/H6/H7/H8 사각은 픽셀만으로 서로 다른 크기와 압축 명암에서 수집된다',()=>{
  for(const version of [5,6,7,8])for(const tones of [2,3]){
    const text=`H${version}-${tones}`,e=encodeH(text,{version,tones,ecc:'M',mask:version%8,finder:'corners'});
    const scene=buildHScene(e,{perspective:.15,outline:true});
    for(const size of [720,1200]){
      const s=finish(e,[optical(scene,size,size===1200)]);
      assert.equal(s.state,'DONE',JSON.stringify({version,tones,size,assemblies:s.assemblies}));
      assert.equal(s.result.text,text);
    }
  }
});

test('6면 H7/H8은 반대편 사진까지 모여야 정확한 본문을 완료한다',()=>{
  for(const version of [7,8])for(const tones of [2,3]){
    const e=encodeH('six-corners',{version,mode:6,tones,mask:7,finder:'corners'});
    const a=optical(buildHScene(e,{perspective:.15}),1080),b=optical(buildHScene(e,{...hAutoRotation(12000),perspective:.15}),1080);
    const partial=finish(e,[a]);assert.equal(partial.state,'COLLECTING');assert.equal(partial.count,3);assert.equal(partial.result,undefined);
    const full=finish(e,[a,b]);assert.equal(full.state,'DONE');assert.equal(full.result.text,'six-corners');
  }
});

test('사각 H의 반사상과 format 단일bit 손상은 본문으로 승격하지 않는다',()=>{
  const e=encodeH('reject',{version:5,mask:0,finder:'corners'});
  const f=optical(buildHScene(e,{perspective:0}),1000);
  const mirror={...f,data:new Float32Array(f.data.length)};
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)mirror.data[y*f.width+x]=f.data[y*f.width+f.width-x-1];
  assert.equal(detectH(mirror).faces.length,0);
  const changed=structuredClone(e);
  for(const levels of Object.values(changed.faces))for(const cell of hLayout(5,'corners').formatCells.filter(c=>c.bit===0))levels[cell.i*e.n+cell.j]^=7;
  assert.equal(detectH(optical(buildHScene(changed),1000)).faces.length,0);
});

test('마커 두 bit는 교정하되 세 bit·한 슬롯 가림·거짓 route로 완료하지 않는다',()=>{
  const e=encodeH('marker-repair',{version:5,mask:0,finder:'corners'}),layout=hLayout(5,'corners');
  const bits=[...layout.roles.values()].filter(c=>c.role==='marker'&&c.kind==='bit'&&c.slot===0);
  for(const errors of [2,3]){
    const changed=structuredClone(e);
    for(const c of [bits[5],bits[18],bits[23]].slice(0,errors))changed.faces.ZM[c.i*e.n+c.j]^=7;
    const hit=detectH(optical(buildHFaceSheet(changed),1500));
    const collector=createHCollector(),s=collector.addFrame({observations:hit.faces,frameId:0,timestamp:0});
    if(errors===2){assert.equal(s.state,'DONE');assert.equal(s.result.text,'marker-repair');assert.equal(hit.faces.find(f=>f.face==='ZM').hamming,2);}
    else{assert.notEqual(s.state,'DONE');assert.equal(s.result,undefined);}
  }
  const hidden=structuredClone(e);
  for(const c of layout.roles.values())if(c.role==='marker'&&c.slot===0)hidden.faces.ZM[c.i*e.n+c.j]=4;
  assert.ok(!detectH(optical(buildHFaceSheet(hidden),1500)).faces.some(f=>f.face==='ZM'));
  const wrong=structuredClone(e);
  for(const levels of Object.values(wrong.faces))for(const c of layout.routeCells)if(c.bit===0)levels[c.i*e.n+c.j]^=7;
  const observations=detectH(optical(buildHFaceSheet(wrong),1500)).faces;
  assert.equal(observations.length,3);
  const s=createHCollector().addFrame({observations,frameId:0,timestamp:0});
  assert.equal(s.state,'COLLECTING');assert.equal(s.result,undefined);
});
