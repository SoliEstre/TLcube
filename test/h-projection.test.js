import test from 'node:test';
import assert from 'node:assert/strict';
import {hProjection} from '../src/h-render.js';
import {hFacePoint} from '../src/h-layout.js';
import {H_FACE_IDS} from '../src/h-profile.js';
import {hScreenSpin} from '../src/h-rotation.js';

function signedArea(points){
  return points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0)/2;
}
function projectedArea(view,face,n){
  // hFacePoint의 열-행 순서는 바깥 법선이에요. 화면축 외적이 카메라 방향이므로
  // 정상적으로 보이는 표면만 양의 투영 면적을 가져요. cull 내부식을 복제하지 않아요.
  return signedArea([[0,0],[0,n],[n,n],[n,0]].map(([i,j])=>view.project(hFacePoint(face,i,j,n))));
}

test('원근에서 뒤집힌 면을 앞면 위에 칠하지 않는다',()=>{
  for(const options of [{perspective:1,rotateZ:.3},{perspective:.15,rotateY:.7}]){
    const view=hProjection(41,options);
    assert.ok(view.visible.length>0);
    for(const face of view.visible)assert.ok(projectedArea(view,face,41)>0,face);
    const expected=H_FACE_IDS.filter(face=>projectedArea(view,face,41)>1e-7);
    assert.deepEqual(view.visible,expected);
  }
});

test('평행/원근·임의 회전에서 가시성은 투영 winding과 일치한다',()=>{
  for(const perspective of [0,.15,.5,1])for(let k=0;k<120;k++){
    const options={perspective,rotateX:k*.173,rotateY:k*.271,rotateZ:k*.097};
    const view=hProjection(37,options);
    for(const face of H_FACE_IDS){
      const area=projectedArea(view,face,37);
      if(Math.abs(area)<1e-7)continue;
      assert.equal(view.visible.includes(face),area>0,JSON.stringify({face,k,perspective,area}));
    }
  }
});

test('X/Y 자동 회전은 최대 원근에서도 정위치에서 전6면을 보여준다',()=>{
  for(const axis of ['x','y'])for(const perspective of [0,.15,1]){
    const seen=new Set();
    for(let k=0;k<120;k++){
      const view=hProjection(41,{...hScreenSpin(k*200,{axis,speed:15}),perspective});
      for(const face of view.visible){assert.ok(projectedArea(view,face,41)>0);seen.add(face);}
    }
    assert.deepEqual([...seen].sort(),[...H_FACE_IDS].sort(),`${axis}/${perspective}`);
  }
});
