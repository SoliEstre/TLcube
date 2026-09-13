import test from 'node:test';import assert from 'node:assert/strict';
import {hAlignmentRotation,hScreenSpin,composeHRotation} from '../src/h-rotation.js';import {hProjection} from '../src/h-render.js';
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
test('aligned screen-axis full turn keeps physical Z caps hidden and central seam axis-aligned',()=>{
  const n=29,speed=75,period=360000/speed;
  for(const [arrangement,axis] of [['horizontal','y'],['vertical','x']]){
    const base=hAlignmentRotation(arrangement);
    for(const direction of [-1,1])for(let step=0;step<=24;step++){
      // 정렬 4면은 wobble을 끄고 주축 한 개만 돈다. 부축 흔들림으로 cap이 다시 보이면 안 돼요.
      const pose=composeHRotation(base,hScreenSpin(period*step/24,{axis,speed,wobble:false,[axis==='x'?'directionX':'directionY']:direction})),view=hProjection(n,{...pose,perspective:4/60});
      assert.ok(!view.visible.includes('ZM')&&!view.visible.includes('ZP'),`${arrangement}:${direction}:${step}`);
      const a=view.project([n/2,n/2,0]),b=view.project([n/2,n/2,n]);
      if(arrangement==='horizontal'){near(a.x,b.x);near((a.x+b.x)/2,view.width/2);}
      else{near(a.y,b.y);near((a.y+b.y)/2,view.height/2);}
    }
    assert.deepEqual(hProjection(n,{...base,perspective:4/60}).visible,['XM','YM']);
  }
});
test('alignment matrices retain their intended screen-Z seam and reject invalid names',()=>{
  assert.deepEqual(hAlignmentRotation(),{rotateX:0,rotateY:0,rotateZ:0});
  assert.throws(()=>hAlignmentRotation('diagonal'),/H alignment/);
});
