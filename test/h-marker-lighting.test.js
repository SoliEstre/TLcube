import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {buildHScene,hPalette} from '../src/h-render.js';
import {isHUnshadedLevel,applyHRotationFill} from '../src/h-lighting.js';

test('H 음영 제외는 식별 level3/4뿐이고 RGB나 톤 순위로 추측하지 않아요',()=>{
  assert.deepEqual([0,1,2,3,4,5,255].map(isHUnshadedLevel),[false,false,false,true,true,false,false]);
  const encoded=encodeH('markers',{version:2,mode:6,tones:3,ecc:'H',mask:7});
  // 데이터 high도 흰색이에요. 흰 RGB 필터라면 이 테스트에서 실패해요.
  const palette={levels:[{r:30,g:55,b:80},{r:120,g:140,b:160},{r:255,g:255,b:255}]};
  for(const profile of ['screen','soft','original'])for(const rotationFill of [false,true]){
    const scene=buildHScene(encoded,{palette,lighting:{profile,shading:'off',rotationFill}});
    const colors=hPalette(palette,3).colors;
    const seen=new Set();
    for(const shape of scene.shapes.filter(s=>s.face==='YM')){
      const level=encoded.faces.YM[shape.i*encoded.n+shape.j];seen.add(level);
      if(level===3||level===4){assert.deepEqual(shape.color,colors[level]);assert.equal(shape.gain,1);}
      else{
        const readGain=scene.hLighting.faceReadGains?.YM??scene.hLighting.faceGains.YM;
        assert.deepEqual(shape.color,applyHRotationFill(colors[level],scene.hLighting.faceFills?.YM??0,readGain));
        if(level===2&&readGain<1)assert.ok(shape.color.r<255,'보정 peak 밖 흰 데이터 high는 음영을 유지해요');
      }
    }
    for(const level of [0,1,2,3,4])assert.ok(seen.has(level));
  }
});

test('H 조명 생략과 print의 기존 색상·격자·입력 소유권은 유지해요',()=>{
  const encoded=encodeH('markers',{version:7,mode:6,tones:3,ecc:'H',mask:7,finder:'corners'});
  const before=Object.fromEntries(Object.entries(encoded.faces).map(([face,levels])=>[face,levels.slice()]));
  const plain=buildHScene(encoded),print=buildHScene(encoded,{lighting:{profile:'print',shading:'off'}});
  assert.deepEqual(print.shapes.map(s=>({color:s.color,points:s.points})),plain.shapes.map(s=>({color:s.color,points:s.points})));
  assert.deepEqual(encoded.faces,before);
});
