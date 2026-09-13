import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {buildHScene,hProjection} from '../src/h-render.js';
import {hFacePoint} from '../src/h-layout.js';

// 볼록 다각형 SAT: 한 분리축만 있어도 선이 표본 영역 안에 들어가지 않아요.
function disjoint(a,b){
  for(const polygon of [a,b])for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],axis={x:p.y-q.y,y:q.x-p.x};
    const aa=a.map(v=>v.x*axis.x+v.y*axis.y),bb=b.map(v=>v.x*axis.x+v.y*axis.y);
    if(Math.max(...aa)<=Math.min(...bb)+1e-9||Math.max(...bb)<=Math.min(...aa)+1e-9)return true;
  }
  return false;
}

test('원근 윤곽선은 모든 가시 면 outer 셀 중심70%와 꼭짓점에서 겹치지 않는다',()=>{
  const poses=[0,.2,.8,1.5,2.3].map(angle=>({rotateX:angle,rotateY:angle*.7,rotateZ:angle*.3}));
  // 화면 사각형의 선 끝이 제3면을 침범했던 거의 edge-on 자세도 보존해요.
  poses.push({rotateX:.8697115582687707,rotateY:-.34635864702218516,rotateZ:-1.192630214155525});
  for(const version of [0,5,7])for(const perspective of [0,.18,.5,1])for(const pose of poses){
    const encoded=encodeH('x',{version,mode:6,mask:0}),n=encoded.n;
    const options={perspective,...pose,outline:true};
    const scene=buildHScene(encoded,options),view=hProjection(n,options),lines=scene.shapes.filter(s=>s.face===undefined);
    assert.ok(lines.length>0&&lines.length<=12);
    for(const line of lines){
      assert.deepEqual(line.color,{r:34,g:34,b:34});
      assert.ok(line.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
      const width=Math.hypot(line.points[0].x-line.points[3].x,line.points[0].y-line.points[3].y);
      assert.ok(width>0);
    }
    for(const face of view.visible)for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      if(i!==0&&j!==0&&i!==n-1&&j!==n-1)continue;
      const center=[[.15,.15],[.15,.85],[.85,.85],[.85,.15]].map(([di,dj])=>view.project(hFacePoint(face,i+di,j+dj,n)));
      for(const line of lines)assert.ok(disjoint(line.points,center),JSON.stringify({version,perspective,pose,face,i,j}));
    }
  }
});
