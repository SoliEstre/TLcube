/** 실제 생성기 이벤트와 상태 접근자를 실행해 조작 축의 독립성을 검사해요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createGeneratorState} from '../src/generator-state.js';
import {hPreviewOptions,hOrbitFromRotation,reconcileHContentRotation,reconcileHRotationSpeed,selectHFaceCount,selectHRenderFaces,selectHArrangement,selectHAlignmentPose,clampHRotationSpeed,clampHRotationTilt,selectHRotationMode,selectHRotationSpeed,selectHRotationSpeedDefault,selectHRotationTilt,H_ROTATION_TILT_DEFAULT_DEG} from '../src/generator-h.js';
import {hAlignmentRotation} from '../src/h-rotation.js';
import {hDisplayMap} from '../src/h-face-arrangement.js';
import {hModeFaces} from '../src/h-profile.js';
import {defineOrbitViewAccessors,orbitPerspToDeg,orbitTToPersp,ORBIT_PERSP_MAX_DEG} from '../src/generator-orbit-view.js';
import {hRotationSpaceKey} from '../src/h-preview-controls.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function section(start,end){
  const a=html.indexOf(start),b=html.indexOf(end,a);
  assert.ok(a>=0&&b>a,`이벤트 구간을 찾을 수 없어요: ${start}`);
  return html.slice(a,b);
}
function node(id){
  return {id,events:{},dataset:{},value:'',checked:false,children:[],hidden:false,
    addEventListener(kind,fn){this.events[kind]=fn;},
    querySelector(selector){return selector==='span'?this.children.find(child=>child.tagName==='span')??null:null;},
    querySelectorAll(selector){return selector==='button'?this.children.filter(child=>child.tagName==='button'):[];},
    classList:{toggle(){}},setAttribute(){}};
}
function cards(id,attribute,key){
  const start=html.indexOf(`id="${id}"`);
  assert.ok(start>=0,id);
  const body=html.slice(start,html.indexOf('</div>',start));
  return [...body.matchAll(new RegExp(`<button\\b[^>]*${attribute}="([^"]+)"`,'g'))]
    .map(([,value])=>({...node(value),tagName:'button',dataset:{[key]:value}}));
}
function directionGroups(){
  return ['x','y'].map(axis=>{
    const group=node(`direction-${axis}`);
    group.dataset.directionAxis=axis;
    group.children=[{tagName:'span',hidden:false},...['1','-1'].map(value=>({...node(`${axis}:${value}`),tagName:'button',dataset:{directionAxis:axis,hDirection:value}}))];
    return group;
  });
}
function harness(overrides={}){
  const state={...selectHFaceCount(createGeneratorState({type:'Y'}),6),hAutoRotate:true,hRotationSpeed:17,hRotationSpeedIntent:'manual',...overrides};
  const names=['hAutoRotate','hRotationModeCards','hRotationDirections','hRotationSpeed','hRotationSpeedReset','hRotationSpeedDown','hRotationSpeedUp','hRotationTilt','hRotationTiltReset','hRotationTiltDown','hRotationTiltUp','hVersionCards','hMaskCards','hFaceCards','hArrangementCards','hAlignHorizontal','hAlignVertical','y3dPersp','y3dPerspPlane','y3dPerspDown','y3dPerspUp','y3dPoseReset','y3dRollReset','y3dZoomReset','y3dReset'];
  const els=Object.fromEntries([...names,'y3dFaces3','y3dFaces6'].map(id=>[id,node(id)]));
  els.hRotationModeCards.children=cards('hRotationModeCards','data-h-rotation-mode','hRotationMode');
  // 기울임 보정 방식 토글(없음/회전마다/면마다) — 실제 index.html 카드에서 mock 해요.
  els.hRotationTiltModeRow=node('hRotationTiltModeRow');
  els.hRotationTiltModeCards=node('hRotationTiltModeCards');
  els.hRotationTiltModeCards.children=cards('hRotationTiltModeCards','data-h-tilt-mode','hTiltMode');
  els.hRotationDirections.children=directionGroups();
  els.hRotationDirections.querySelectorAll=function(selector){return selector==='button'?this.children.flatMap(group=>group.querySelectorAll('button')):[];};
  els.hVersionCards.children=cards('hVersionCards','data-h-version','hVersion');
  // index.html이 런타임에 H8을 append하므로, 정적 HTML 카드와 함께 실제 등록 대상도 mock해요.
  els.hVersionCards.children.push({...node('8'),tagName:'button',dataset:{hVersion:'8'}});
  els.hMaskCards.children=cards('hMaskCards','data-h-mask','hMask');
  els.hFaceCards.children=cards('hFaceCards','data-h-faces','hFaces');
  els.hArrangementCards.children=cards('hArrangementCards','data-h-arrangement','hArrangement');
  const viewer={pad:41};defineOrbitViewAccessors(viewer,state);
  const animation={elapsed:8123},calls={sync:0,paint:0,refresh:[]};
  const documentEvents={};
  const document={addEventListener(kind,fn){documentEvents[kind]=fn;}};
  const current={type:'H',encoded:{version:6}};
  const context=vm.createContext({generatorState:state,current,y3dPreview:viewer,hAnimation:animation,els,$:id=>els[id],hPreviewOptions,hOrbitFromRotation,selectHFaceCount,selectHRenderFaces,selectHArrangement,selectHAlignmentPose,clampHRotationSpeed,clampHRotationTilt,selectHRotationMode,selectHRotationSpeed,selectHRotationSpeedDefault,selectHRotationTilt,H_ROTATION_TILT_DEFAULT_DEG,reconcileHRotationSpeed,
    hGeneratorActive:()=>state.type==='Y'&&state.yRepresentation==='3d',
    syncHUi:()=>{calls.sync++;},paintY3dPreview:()=>{calls.paint++;},refreshHSelection:()=>{
      // production refresh의 상태 전이와 animation reset은 그대로 모사해요.
      Object.assign(state,reconcileHContentRotation(state,{}));
      animation.elapsed=0;animation.last=0;
      calls.refresh.push({versionH:state.versionH,hMask:state.hMask});
    },
    orbitPerspToDeg,orbitTToPersp,ORBIT_PERSP_MAX_DEG,Y3D_PAD_BASE:24,document,hRotationSpaceKey});
  for(const source of [section('function freezeHSpin(){','function syncHUi(){'),
    section("for(const button of $('hFaceCards').children)button.addEventListener",'function toggleHRotation(){'),
    // toggle 뒤에 회전 축·방향·속도·해상도·마스크 handler가 모두 연속 등록돼요.
    section('function toggleHRotation(){','function stopHAnimation(){'),
    section("els.y3dFaces3.addEventListener('click'",'function setY3dPerspectiveDegrees(value){'),
    section('function setY3dPerspectiveDegrees(value){',"for (const btn of els.y3dDigits")])vm.runInContext(source,context,{timeout:1000});
  return {state,viewer,animation,els,calls,documentEvents};
}
const pose=state=>[state.orbitYaw,state.orbitPitch,state.orbitRoll];
const currentPose=h=>hPreviewOptions(h.state,{elapsedMs:h.animation.elapsed});
const mapFor=state=>{
  const faces=Object.fromEntries(hModeFaces(state.hFaces).map(face=>[face,[0]]));
  const map=hDisplayMap({mode:state.hFaces,faces},{arrangement:state.hArrangement,renderFaces:state.hRenderFaces});
  return {physicalToLogical:map.physicalToLogical,physicalDataFaces:map.physicalDataFaces,blankFaces:map.blankFaces};
};
// Euler 값은 짐벌 자세에서 달라도 같은 자세일 수 있어요. 독립 quaternion으로 기저를 비교해요.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function multiply(a,b){return [a[0]*b[0]-dot(a.slice(1),b.slice(1)),...a.slice(1).map((v,i)=>a[0]*b[i+1]+b[0]*v+cross(a.slice(1),b.slice(1))[i])];}
function rotated(e,p){
  const x=e.rotateX,y=e.rotateY,z=e.rotateZ;
  const q=multiply([Math.cos(z/2),0,0,Math.sin(z/2)],multiply([Math.cos(y/2),0,Math.sin(y/2),0],[Math.cos(x/2),Math.sin(x/2),0,0]));
  return multiply(multiply(q,[0,...p]),[q[0],-q[1],-q[2],-q[3]]).slice(1);
}
function samePose(a,b,label){
  for(const basis of [[1,0,0],[0,1,0],[0,0,1]]){
    const x=rotated(a,basis),y=rotated(b,basis);
    for(let i=0;i<3;i++)assert.ok(Math.abs(x[i]-y[i])<1e-10,label);
  }
}

test('X/Y/gyro 실제 카드 클릭은 자동·수동 자세를 연속으로 보존해요',()=>{
  for(const running of [false,true])for(const axis of ['x','y','gyro'])for(const base of [[0,0,0],[90,90,27],[-90,-90,-42],[33,-128,97]])for(const next of ['x','y','gyro']){
    const h=harness({hAutoRotate:running,hRotationMode:axis,orbitPitch:base[0],orbitYaw:base[1],orbitRoll:base[2],orbitPersp:23});
    const before=currentPose(h);
    const button=h.els.hRotationModeCards.children.find(n=>n.dataset.hRotationMode===next);assert.ok(button,next);button.events.click();
    assert.equal(h.state.hRotationMode,next);assert.equal(h.state.hAutoRotate,running);assert.equal(h.animation.elapsed,0);
    assert.equal(h.state.orbitPersp,23);assert.equal(h.calls.sync,1);assert.equal(h.calls.paint,1);
    samePose(before,currentPose(h),`${axis}→${next}, running=${running}, pose=${base}`);
  }
});

test('방향 버튼은 freeze 뒤 각 축의 부호만 바꾸고 pose continuity를 보존해요',()=>{
  for(const [axis,direction]of [['x',-1],['y',-1]]){
    const h=harness({hRotationMode:'gyro',hRotationDirectionX:1,hRotationDirectionY:1,orbitYaw:31,orbitPitch:-47,orbitRoll:13});
    const before=currentPose(h);
    const button=h.els.hRotationDirections.querySelectorAll('button').find(candidate=>candidate.dataset.directionAxis===axis&&Number(candidate.dataset.hDirection)===direction);
    assert.ok(button,axis);button.events.click();
    assert.equal(h.state[axis==='x'?'hRotationDirectionX':'hRotationDirectionY'],direction);
    assert.equal(h.state[axis==='x'?'hRotationDirectionY':'hRotationDirectionX'],1);
    assert.equal(h.animation.elapsed,0);assert.equal(h.calls.sync,1);assert.equal(h.calls.paint,1);
    samePose(before,currentPose(h),`direction ${axis}`);
  }
});

test('속도 게이지와 양쪽 화살표는 실제 이벤트로 증감하고 자세를 보존해요',()=>{
  for(const axis of ['x','y','gyro'])for(const running of [false,true])for(const [action,value,expected]of [['up',null,18],['down',null,16],['input','90',90],['input','0',1],['input','91',90]]){
    const h=harness({hRotationMode:axis,hAutoRotate:running,orbitPitch:33,orbitYaw:-128,orbitRoll:97,orbitPersp:23}),before=currentPose(h);
    if(action==='input'){h.els.hRotationSpeed.value=value;h.els.hRotationSpeed.events.input();}
    else h.els[action==='up'?'hRotationSpeedUp':'hRotationSpeedDown'].events.click();
    assert.equal(h.state.hRotationSpeed,expected);assert.equal(h.state.hRotationSpeedIntent,'manual');assert.equal(h.animation.elapsed,0);assert.equal(h.state.orbitPersp,23);
    assert.equal(h.calls.sync,1);assert.equal(h.calls.paint,1);samePose(before,currentPose(h),axis+' '+action);
  }
  for(const [speed,id]of [[1,'hRotationSpeedDown'],[90,'hRotationSpeedUp']]){
    const h=harness({hRotationSpeed:speed});h.els[id].events.click();assert.equal(h.state.hRotationSpeed,speed);
  }
});

test('기울임 보정 실제 input은 freeze 뒤 pose를 보존하고 상태만 0…35°로 바꿔요',()=>{
  for(const axis of ['x','y'])for(const running of [false,true])for(const tilt of ['0','17.5','35']){
    const h=harness({hRotationMode:axis,hAutoRotate:running,hRotationTiltDeg:12.5,orbitPitch:33,orbitYaw:-128,orbitRoll:97,orbitPersp:23}),before=currentPose(h),speed=h.state.hRotationSpeed;
    h.els.hRotationTilt.value=tilt;h.els.hRotationTilt.events.input();
    assert.equal(h.state.hRotationTiltDeg,Number(tilt));assert.equal(h.state.hRotationSpeed,speed);assert.equal(h.state.hRotationSpeedIntent,'manual');
    assert.equal(h.state.hAutoRotate,running);assert.equal(h.state.yRepresentation,'3d');assert.equal(h.viewer.on,true);
    assert.equal(h.animation.elapsed,0);assert.equal(h.state.orbitPersp,23);assert.equal(h.calls.sync,1);assert.equal(h.calls.paint,1);
    samePose(before,currentPose(h),`${axis}:${running}:${tilt}`);
  }
});

test('기울임 기본값 복원 실제 click은 XY의 0/35°를 17.5°로만 되돌려요',()=>{
  for(const axis of ['x','y'])for(const running of [false,true])for(const initialTilt of [0,35]){
    const h=harness({hRotationMode:axis,hAutoRotate:running,hRotationTiltDeg:initialTilt,orbitPitch:33,orbitYaw:-128,orbitRoll:97,orbitPersp:23}),before=currentPose(h),speed=h.state.hRotationSpeed;
    h.els.hRotationTiltReset.events.click();
    assert.equal(h.state.hRotationTiltDeg,H_ROTATION_TILT_DEFAULT_DEG);assert.equal(h.state.hRotationSpeed,speed);assert.equal(h.state.hRotationSpeedIntent,'manual');
    assert.equal(h.state.hAutoRotate,running);assert.equal(h.state.yRepresentation,'3d');assert.equal(h.viewer.on,true);
    assert.equal(h.animation.elapsed,0);assert.equal(h.state.orbitPersp,23);assert.equal(h.calls.sync,1);assert.equal(h.calls.paint,1);assert.equal(h.calls.refresh.length,0);
    samePose(before,currentPose(h),`reset:${axis}:${running}:${initialTilt}`);
  }
});

test('실제 H6에서 자이로 자동 45도, X/Y 자동 60도이며 직접 정한 속도는 보존해요',()=>{
  for(const running of [false,true]){
    const h=harness({hAutoRotate:running,hRotationSpeed:75,hRotationSpeedIntent:'auto'});
    for(const [axis,speed]of [['gyro',45],['x',60],['gyro',45],['y',60]]){
      const before=currentPose(h);
      h.els.hRotationModeCards.children.find(n=>n.dataset.hRotationMode===axis).events.click();
      assert.equal(h.state.hRotationSpeed,speed);assert.equal(h.state.hRotationSpeedIntent,'auto');
      assert.equal(h.state.hAutoRotate,running);samePose(before,currentPose(h),'자동 기본 속도 변경');
    }
    for(const action of ['input','up','down']){
      const custom=harness({hAutoRotate:running,hRotationSpeed:75,hRotationSpeedIntent:'auto'});
      if(action==='input'){custom.els.hRotationSpeed.value='75';custom.els.hRotationSpeed.events.input();}
      else custom.els[action==='up'?'hRotationSpeedUp':'hRotationSpeedDown'].events.click();
      const chosen=custom.state.hRotationSpeed;
      assert.equal(custom.state.hRotationSpeedIntent,'manual');
      for(const axis of ['gyro','x','y','gyro']){
        custom.els.hRotationModeCards.children.find(n=>n.dataset.hRotationMode===axis).events.click();
        assert.equal(custom.state.hRotationSpeed,chosen);assert.equal(custom.state.hAutoRotate,running);
      }
    }
  }
});

test('자동회전 play/pause 버튼 실제 click은 마지막 자세에서 멈춰요',()=>{
  for(const axis of ['x','y','gyro']){
    const h=harness({hRotationMode:axis,orbitPitch:31,orbitYaw:-47,orbitRoll:13}),before=currentPose(h);
    h.els.hAutoRotate.events.click();
    assert.equal(h.state.hAutoRotate,false);assert.equal(h.animation.elapsed,0);samePose(before,currentPose(h),axis);
  }
});

test('문서 Space는 실제 keydown listener에서만 H 3D 회전을 토글하고 텍스트 입력은 무시해요',()=>{
  const h=harness({yRepresentation:'3d',hAutoRotate:false,orbitPitch:31,orbitYaw:-47,orbitRoll:13});
  h.viewer.on=true;
  const keydown=h.documentEvents.keydown;
  assert.equal(typeof keydown,'function');
  let prevented=0;
  keydown({code:'Space',key:' ',repeat:false,defaultPrevented:false,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,target:null,preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.equal(h.state.hAutoRotate,true);assert.equal(h.animation.elapsed,0);
  const input={isContentEditable:false,closest(selector){return selector==='input,textarea,select,button,a,[role="textbox"],[contenteditable="true"]'?{}:null;}};
  keydown({code:'Space',key:' ',repeat:false,defaultPrevented:false,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,target:input,preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.equal(h.state.hAutoRotate,true);
});

test('Y/H 정위치 실제 버튼은 원근을 보존하고 회전만 초기화해요',()=>{
  for(const representation of ['2.5d','3d'])for(const degrees of [0,1,9,30,59,60]){
    const h=harness({yRepresentation:representation,hAutoRotate:representation==='3d',orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:degrees/60*100});
    h.els.y3dPoseReset.events.click();assert.deepEqual(pose(h.state),[0,0,0]);
    assert.ok(Math.abs(orbitPerspToDeg(h.state.orbitPersp)-degrees)<1e-9);assert.equal(h.viewer.pad,41);assert.equal(h.calls.paint,1);
    if(representation==='3d'){assert.equal(h.state.hAutoRotate,false);assert.equal(h.animation.elapsed,0);}
  }
});

test('roll reset은 H 회전을 freeze한 뒤 roll만 초기화해요',()=>{
  const h=harness({hAutoRotate:true,orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:47});
  h.els.y3dRollReset.events.click();
  assert.equal(h.state.hAutoRotate,false);assert.equal(h.animation.elapsed,0);
  assert.equal(h.state.orbitRoll,0);assert.equal(h.state.orbitPersp,47);assert.equal(h.calls.paint,1);
  const stopped=harness({hAutoRotate:false,hAutoRotateIntent:'off',orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:47});
  stopped.els.y3dRollReset.events.click();
  assert.deepEqual(pose(stopped.state),[31,-47,0]);
});

test('zoom reset은 pad만 기준값으로 복원하고 pose와 자동회전을 건드리지 않아요',()=>{
  for(const running of [false,true]){
    const h=harness({hAutoRotate:running,orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:47});
    const before=pose(h.state),elapsed=h.animation.elapsed;
    h.els.y3dZoomReset.events.click();
    assert.deepEqual(pose(h.state),before);assert.equal(h.viewer.pad,24);assert.equal(h.state.hAutoRotate,running);assert.equal(h.animation.elapsed,elapsed);assert.equal(h.calls.paint,1);
  }
});

test('Y/H 평면 실제 버튼은 원근만 없애고 자세와 회전 상태를 보존해요',()=>{
  for(const representation of ['2.5d','3d'])for(const running of [false,true]){
    const h=harness({yRepresentation:representation,hAutoRotate:running,orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:47});
    const before=pose(h.state),visible=currentPose(h),elapsed=h.animation.elapsed;
    h.els.y3dPerspPlane.events.click();assert.equal(h.state.orbitPersp,0);assert.deepEqual(pose(h.state),before);
    assert.equal(h.state.hAutoRotate,running);assert.equal(h.animation.elapsed,elapsed);assert.equal(h.calls.paint,1);samePose(visible,currentPose(h),representation);
  }
});

test('Y/H 원근 실제 ±1도 버튼과 입력은 0–60 경계를 지켜요',()=>{
  for(const representation of ['2.5d','3d'])for(const degrees of [0,1,9,30,59,60])for(const delta of [-1,1]){
    const h=harness({yRepresentation:representation,hAutoRotate:false,orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:degrees/60*100}),before=pose(h.state);
    h.els[delta<0?'y3dPerspDown':'y3dPerspUp'].events.click();
    assert.ok(Math.abs(orbitPerspToDeg(h.state.orbitPersp)-Math.max(0,Math.min(60,degrees+delta)))<1e-9);
    assert.deepEqual(pose(h.state),before);assert.equal(h.calls.paint,1);
  }
  for(const [value,expected]of [['-1',0],['0',0],['9',9],['59.6',60],['61',60],['invalid',0]]){
    const h=harness({hAutoRotate:false,orbitYaw:31,orbitPitch:-47,orbitRoll:13}),before=pose(h.state);
    h.els.y3dPersp.value=value;h.els.y3dPersp.events.input();
    assert.ok(Math.abs(orbitPerspToDeg(h.state.orbitPersp)-expected)<1e-9);assert.deepEqual(pose(h.state),before);
  }
});

test('Y/H 기존 아이소메트릭은 자세·원근·맞춤을 함께 초기화해요',()=>{
  for(const representation of ['2.5d','3d']){
    const h=harness({yRepresentation:representation,orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:47});
    h.els.y3dReset.events.click();assert.deepEqual(pose(h.state),[0,0,0]);assert.equal(h.state.orbitPersp,0);assert.equal(h.viewer.pad,24);
  }
});

test('H sidebar 배치 실제 클릭은 side clamp·map·축·정렬 pose와 회전 선택을 원자 전이해요',()=>{
  for(const hAutoRotate of [false,true])for(const [arrangement,axis]of [['horizontal','y'],['vertical','x']]){
    const h=harness({hAutoRotate,hAutoRotateIntent:hAutoRotate?'auto':'off',hRotationMode:'gyro',orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:47,hMask:5,eccLevel:'H'});
    assert.equal(h.state.hFaces,6);assert.equal(h.state.hRenderFaces,6);assert.equal(h.state.hArrangement,'isometric');
    h.els.hArrangementCards.children.find(button=>button.dataset.hArrangement===arrangement).events.click();
    assert.equal(h.state.hArrangement,arrangement);assert.equal(h.state.hFaces,4);assert.equal(h.state.hRenderFaces,6);
    assert.equal(h.state.hAutoRotate,hAutoRotate);assert.equal(h.state.hAutoRotateIntent,hAutoRotate?'auto':'off');assert.equal(h.state.hRotationMode,axis);assert.equal(h.state.orbitPersp,47);
    assert.equal(h.state.hMask,5);assert.equal(h.state.eccLevel,'H');assert.equal(h.calls.refresh.length,1);
    assert.equal(h.animation.elapsed,0);
    samePose(currentPose(h),hAlignmentRotation(arrangement),arrangement+' sidebar pose');
    assert.deepEqual(mapFor(h.state).physicalToLogical,{ZM:null,ZP:null,XM:'XM',XP:'XP',YM:'YM',YP:'YP'});
  }
});

test('H 우측 정렬과 정위치 실제 클릭은 data map·ECC·mask·원근을 보존하고 회전을 멈춰요',()=>{
  for(const [id,arrangement]of [['hAlignHorizontal','horizontal'],['hAlignVertical','vertical']]){
    const h=harness({hArrangement:'horizontal',hFaces:4,hRenderFaces:6,hAutoRotate:true,hRotationMode:'y',orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:47,hMask:5,eccLevel:'H'});
    const beforeMap=mapFor(h.state),before={arrangement:h.state.hArrangement,faces:h.state.hFaces,render:h.state.hRenderFaces,mask:h.state.hMask,ecc:h.state.eccLevel,perspective:h.state.orbitPersp,axis:h.state.hRotationMode};
    h.els[id].events.click();
    assert.equal(h.state.hArrangement,before.arrangement);assert.equal(h.state.hFaces,before.faces);assert.equal(h.state.hRenderFaces,before.render);
    assert.equal(h.state.hMask,before.mask);assert.equal(h.state.eccLevel,before.ecc);assert.equal(h.state.orbitPersp,before.perspective);assert.equal(h.state.hRotationMode,before.axis);
    assert.equal(h.state.hAutoRotate,false);assert.equal(h.animation.elapsed,0);assert.deepEqual(mapFor(h.state),beforeMap);
    samePose(currentPose(h),hAlignmentRotation(arrangement),id+' pose-only');
  }
  const h=harness({hArrangement:'vertical',hFaces:3,hRenderFaces:6,hAutoRotate:true,orbitYaw:31,orbitPitch:-47,orbitRoll:13,orbitPersp:47,hMask:5,eccLevel:'H'});
  const beforeMap=mapFor(h.state),before={arrangement:h.state.hArrangement,faces:h.state.hFaces,render:h.state.hRenderFaces,mask:h.state.hMask,ecc:h.state.eccLevel,perspective:h.state.orbitPersp};
  h.els.y3dPoseReset.events.click();
  assert.equal(h.state.hArrangement,before.arrangement);assert.equal(h.state.hFaces,before.faces);assert.equal(h.state.hRenderFaces,before.render);
  assert.equal(h.state.hMask,before.mask);assert.equal(h.state.eccLevel,before.ecc);assert.equal(h.state.orbitPersp,before.perspective);assert.equal(h.state.hAutoRotate,false);
  assert.deepEqual(pose(h.state),[0,0,0]);assert.deepEqual(mapFor(h.state),beforeMap);
});

test('H 크기 10개(H8 동적 포함)와 마스크 9개 실제 카드가 독립 상태를 갱신하고 재생성을 요청해요',()=>{
  const h=harness({versionH:2,hMask:4}),expected={hVersion:['auto','0','1','2','3','4','5','6','7','8'],hMask:['auto','0','1','2','3','4','5','6','7']};
  for(const [id,dataset,key,other]of [['hVersionCards','hVersion','versionH','hMask'],['hMaskCards','hMask','hMask','versionH']]){
    assert.deepEqual(h.els[id].children.map(n=>n.dataset[dataset]),expected[dataset]);
    for(const button of h.els[id].children){
      const previous=h.state[other],count=h.calls.refresh.length,value=button.dataset[dataset]==='auto'?'auto':Number(button.dataset[dataset]);
      button.events.click();assert.equal(h.state[key],value);assert.equal(h.state[other],previous);assert.equal(h.calls.refresh.length,count+1);
      assert.equal(h.calls.refresh.at(-1)[key],value);assert.equal(h.state.type,'Y');assert.equal(h.state.yRepresentation,'3d');
    }
  }
  assert.equal(h.calls.refresh.length,19);
});

test('실제 데이터 면 카드와 미리보기 6/3 버튼은 자동회전 상태를 유지해요',()=>{
  for(const running of [false,true]){
    const h=harness({hAutoRotate:running,hAutoRotateIntent:running?'auto':'off',hRotationMode:'gyro'});
    for(const count of [2,3,4,5,6,3,2]){
      h.els.hFaceCards.children.find(button=>Number(button.dataset.hFaces)===count).events.click();
      assert.equal(h.state.hFaces,count);assert.equal(h.state.hAutoRotate,running);
      assert.equal(h.state.hRotationMode,'gyro');assert.equal(h.state.hRotationSpeed,17);
      for(const render of [6,3]){
        const before=h.calls.refresh.length;
        h.els[render===6?'y3dFaces6':'y3dFaces3'].events.click();
        assert.equal(h.state.hAutoRotate,running);assert.equal(h.state.hFaces,count);
        assert.equal(h.calls.refresh.length,before+(render===3&&count>3?0:1));
        assert.equal(h.state.hRenderFaces,render===3&&count>3?6:render);
      }
    }
  }
});
