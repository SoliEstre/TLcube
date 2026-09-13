import test from 'node:test';import assert from 'node:assert/strict';
import {createGeneratorState} from '../src/generator-state.js';
import {hPreviewOptions,normalizeHViewControls,selectHAlignmentPose,selectHArrangement,selectHFaceCount,selectHRenderFaces,selectHRepresentation} from '../src/generator-h.js';
import {hAlignmentRotation} from '../src/h-rotation.js';
import {hFacePoint} from '../src/h-layout.js';import {hProjection} from '../src/h-render.js';import {cubeVideoDurationMs} from '../src/cube-video-export.js';
const clone=value=>structuredClone(value);const samePose=(actual,expected)=>{for(const key of ['rotateX','rotateY','rotateZ'])assert.ok(Math.abs(actual[key]-expected[key])<1e-10,`${key}: ${actual[key]} != ${expected[key]}`);};
const quadArea=points=>Math.abs(points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point.x*next.y-next.x*point.y;},0))/2;
test('isometric allows H2..H6; side arrangements cap data at H4 and preserve rotation selection',()=>{
  const base=createGeneratorState({type:'Y',yRepresentation:'3d'});
  for(const count of [2,3,4,5,6]){const out=selectHFaceCount(base,count);assert.equal(out.hFaces,count);assert.equal(out.hRenderFaces,count>3?6:3);}
  for(const arrangement of ['horizontal','vertical']){
    const original={...selectHFaceCount(base,6),hAutoRotate:true},out=selectHArrangement(original,arrangement);
    const paused={...out,hAutoRotate:false,hAutoRotateIntent:'off'},options=hPreviewOptions(paused,{elapsedMs:1777});
    assert.equal(out.hFaces,4);assert.equal(out.hRenderFaces,6);assert.equal(out.hAutoRotate,true);assert.equal(out.hRotationMode,arrangement==='horizontal'?'y':'x');
    samePose({rotateX:options.rotateX,rotateY:options.rotateY,rotateZ:options.rotateZ},hAlignmentRotation(arrangement));
    assert.equal(original.hFaces,6);
  }
});
test('render count changes only display state, and invalid arrangement/count pairs fail rather than downgrade',()=>{
  const two=selectHFaceCount(createGeneratorState({type:'Y',yRepresentation:'3d'}),2),six=selectHRenderFaces(two,6);
  assert.equal(six.hFaces,2);assert.equal(six.hRenderFaces,6);assert.equal(six.hAutoRotate,true);
  assert.throws(()=>selectHRenderFaces(selectHFaceCount(two,4),3),/H render face count/);
  assert.throws(()=>selectHFaceCount({...two,hArrangement:'horizontal'},5),/H face count/);
});
test('H/Y transition resets only the documented H display state and preserves no stale alignment',()=>{
  const h=selectHArrangement(selectHFaceCount(createGeneratorState({type:'Y',yRepresentation:'3d'}),4),'vertical'),before=clone(h),y=selectHRepresentation(h,'2.5d'),back=selectHRepresentation(y,'3d');
  assert.equal(y.yRepresentation,'2.5d');assert.equal(y.hArrangement,'isometric');assert.equal(y.hFaces,3);assert.equal(y.hRenderFaces,3);assert.equal(y.hAutoRotate,false);
  assert.equal(back.yRepresentation,'3d');assert.equal(back.hArrangement,'isometric');assert.notDeepEqual(before,y);
});
test('normalization repairs persisted side H5/H6 to H4+six-render without mutating input',()=>{
  const raw={...createGeneratorState({type:'Y',yRepresentation:'3d'}),hArrangement:'horizontal',hFaces:6,hRenderFaces:3},before=clone(raw),out=normalizeHViewControls(raw);
  assert.equal(out.hFaces,4);assert.equal(out.hRenderFaces,6);assert.deepEqual(raw,before);
});

test('데이터 면 수와 렌더 면 수를 바꿔도 기존 회전 on/off와 축·속도를 보존해요',()=>{
  for(const hArrangement of ['isometric','horizontal','vertical'])for(const hAutoRotate of [false,true])for(const hRotationMode of ['x','y','gyro']){
    const counts=hArrangement==='isometric'?[2,3,4,5,6]:[2,3,4];
    for(const from of counts)for(const to of counts){
      const state=createGeneratorState({type:'Y',yRepresentation:'3d',orbitView:'3d',hFaces:from,hRenderFaces:6,hArrangement,hAutoRotate,hRotationMode,hRotationSpeed:37,orbitPersp:23});
      const before=clone(state),changed=selectHFaceCount(state,to);
      assert.equal(changed.hFaces,to);assert.equal(changed.hAutoRotate,hAutoRotate);
      assert.equal(changed.hRotationMode,hRotationMode);assert.equal(changed.hRotationSpeed,37);assert.equal(changed.orbitPersp,23);
      assert.deepEqual(state,before);
      for(const renderFaces of to>3?[6]:[3,6]){
        const rendered=selectHRenderFaces(changed,renderFaces);
        assert.equal(rendered.hFaces,to);assert.equal(rendered.hRenderFaces,renderFaces);assert.equal(rendered.hAutoRotate,hAutoRotate);
        assert.equal(rendered.hRotationMode,hRotationMode);assert.equal(rendered.hRotationSpeed,37);
        if(hAutoRotate)assert.notDeepEqual(hPreviewOptions(rendered,{elapsedMs:731}),hPreviewOptions(rendered));
        else assert.deepEqual(hPreviewOptions(rendered,{elapsedMs:731}),hPreviewOptions(rendered));
      }
    }
  }
});

test('정렬 4면 preview/video는 wobble 없이 닫히고 side face마다 충분한 peak를 가져요',()=>{
  const n=29,speed=37;
  for(const [arrangement,axis] of [['horizontal','y'],['vertical','x']])for(const direction of [-1,1]){
    const period=cubeVideoDurationMs({axis,speed});
    const state={...selectHArrangement(selectHFaceCount(createGeneratorState({type:'Y',yRepresentation:'3d'}),4),arrangement),hAutoRotate:true,hRotationMode:axis,hRotationSpeed:speed,hRotationDirectionX:direction,hRotationDirectionY:direction};
    const start=hPreviewOptions(state,{elapsedMs:0}),end=hPreviewOptions(state,{elapsedMs:period});
    samePose(start,end);
    const peaks=Object.fromEntries(['XM','YM','XP','YP'].map(face=>[face,0]));
    for(let step=0;step<24;step++){
      const options=hPreviewOptions(state,{elapsedMs:period*step/24}),view=hProjection(n,options);
      assert.ok(!view.visible.includes('ZM')&&!view.visible.includes('ZP'),`${arrangement}:${direction}:cap:${step}`);
      for(const face of Object.keys(peaks))if(view.visible.includes(face)){
        const points=[[0,0],[0,n],[n,n],[n,0]].map(([i,j])=>view.project(hFacePoint(face,i,j,n)));
        peaks[face]=Math.max(peaks[face],quadArea(points));
      }
    }
    const front=n*n/(1-Math.sin(4*Math.PI/180)/Math.sqrt(3))**2;
    for(const [face,area] of Object.entries(peaks))assert.ok(area/front>.95,`${arrangement}:${direction}:${face} peak/front too small: ${area/front}`);
  }
});
