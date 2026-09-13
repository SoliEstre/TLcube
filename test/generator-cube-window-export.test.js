import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeY} from '../src/encodeY.js';
import {buildSceneY} from '../src/sceneY.js';
import {faceBasis} from '../src/ygrid.js';
import {getPreset} from '../src/luminance.js';
import {generatorCubeModel,windowCubeFaceQuads} from '../src/generator-cube-export.js';
import {voxelizeCube} from '../src/minecraft-schematic.js';

const palette={...getPreset('slate'),bullseyeLight:{r:245,g:250,b:255},bullseyeDark:{r:8,g:14,b:21}};
const qrText='HTTPS://TLSCAN.ESTRE.SO';
const encoded=encodeY('window export',{version:2,tones:2,eccLevel:'M',window:true});

for(const customGains of [false,true])test('윈도 export의 모든 QR/필러 도형은 2.5D와 동일해요: gains='+customGains,()=>{
  const p=customGains?{...palette,faceGains:{T:.6,L:.9,R:1.1}}:palette;
  const base=buildSceneY(encoded,{palette:p,cornerQr:false,cellSize:3,margin:5});
  const scene=buildSceneY(encoded,{palette:p,qrText,cornerQr:false,cellSize:3,margin:5});
  assert.deepEqual(scene.layout,base.layout);
  assert.deepEqual(scene.shapes.slice(0,base.shapes.length),base.shapes);
  const expected=scene.shapes.slice(base.shapes.length),quads=windowCubeFaceQuads({n:encoded.n,qrText,palette:p});
  assert.equal(quads.length,expected.length);
  for(let i=0;i<quads.length;i++){
    const q=quads[i],s=expected[i],{ei,ej}=faceBasis(q.face),l=scene.layout;
    assert.equal(s.kind,'polygon');assert.deepEqual(q.color,s.color);
    const points=[[q.a,q.b],[q.a+q.size,q.b],[q.a+q.size,q.b+q.size],[q.a,q.b+q.size]].map(([a,b])=>({x:l.originX+(a*ei.x+b*ej.x)*l.size,y:l.originY+(a*ei.y+b*ej.y)*l.size}));
    for(let j=0;j<4;j++){assert.ok(Math.abs(points[j].x-s.points[j].x)<1e-9);assert.ok(Math.abs(points[j].y-s.points[j].y)<1e-9);}
  }
});

test('윈도 β 전체 세 패치는 Minecraft 표면에서 빈칸 없이 채워져요',()=>{
  const sceneOpts={palette,qrText},scene=buildSceneY(encoded,sceneOpts);
  const model=generatorCubeModel({type:'Y',encoded,scene,sceneOpts});
  assert.ok(model.quads.some(q=>q.kind==='overlay'&&q.face==='ZM'));
  for(const scale of [1,2,4]){
    const vox=voxelizeCube(model,{scale}),s=vox.width;
    for(let x=0;x<s;x++)for(let y=0;y<s;y++)for(let z=0;z<s;z++){
      if(x!==0&&y!==0&&z!==0&&x!==s-1&&y!==s-1&&z!==s-1)continue;
      assert.notEqual(vox.palette[vox.blocks[x+z*s+y*s*s]],'minecraft:air');
    }
  }
});

test('윈도 내보내기는 QR이 없는 불완전 모델을 성공으로 내보내지 않아요',()=>{
  assert.throws(()=>windowCubeFaceQuads({n:21,qrText,palette}),/크기/);
  assert.throws(()=>windowCubeFaceQuads({n:25,qrText:'',palette}),/텍스트/);
  const scene=buildSceneY(encoded,{palette,cornerQr:false});
  assert.throws(()=>generatorCubeModel({type:'Y',encoded,scene,sceneOpts:{palette}}),/텍스트/);
});
