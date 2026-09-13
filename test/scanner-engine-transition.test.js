import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {cropWindow,autoCropZoomFor} from '../src/scanner-zoom.js';
import {escalationDue,scheduleNextEscalationAt} from '../src/scanner-frame-rate.js';

// 실제 scanner callback과 crop 함수를 실행해요. 제품 함수를 복제하거나 철자만 검사하지 않아요.
const source=readFileSync(new URL('../sites/tlscan/scanner.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
function section(startToken,endToken){
  const start=source.indexOf(startToken),end=source.indexOf(endToken,start);
  assert.ok(start>=0&&end>start,`실행할 scanner 구간이 없어요: ${startToken}`);
  return source.slice(start,end);
}
function node(){return {hidden:false,dataset:{},events:{},setAttribute(){},addEventListener(name,handler){this.events[name]=handler;}};}
function context({enabled=false,shortSide=1080}={}){
  const ctx=vm.createContext({
    scannerApp:node(),engineSwitch:node(),engineSwitchControl:node(),r2Available:true,hAvailable:true,
    transientEngineSwitch:false,autoR1Active:false,r2Wanted:enabled,
    r2Runtime:{enabled,setEnabled(value){this.enabled=value;}},
    acceptStopGate:{isPending:()=>false},stopCamera(){},cameraStream:{},scanSession:3,
    resetHPhotos(){},qrBridge:{reset(){}},runtimeFamilyHint:null,r2Latched:null,r2Correction:null,
    r2StatusHoldUntil:1,r2StatusCollecting:false,setStatus(){},t:key=>key,
    window:{localStorage:{setItem(){}}},ENGINE_STORAGE_KEY:'test',
    renderR2Progress(){},renderR2CellMap(){},refreshScanGuideCopy(){},yieldFrameOnce:false,
    nextEscalationAt:1600,failStreakSince:0,clipStreakSince:0,clipHintShown:true,closerHintShown:true,
    FRAME_MAX_SIDE:960,FRAME_ESCALATED_SIDE:1440,
    frameCanvas:{},frameContext:{drawImage(){},getImageData(x,y,width,height){return {width,height,data:new Uint8ClampedArray(0)};}},
    cameraVideo:{videoWidth:shortSide*16/9,videoHeight:shortSide},
    cropWindow,autoCropZoomFor,zoomPlan:{cropApplied:1},autoCropIndex:0,
    escalationDue,scheduleNextEscalationAt,nowMs:()=>0,
    syncPreviewTransform(){},setZoomErrorVisible(){},showScanToast(){},
  });
  vm.runInContext(section('function resetFailureTiming() {','function beginScanAttempt('),ctx);
  vm.runInContext(section('function effectiveCropZoom() {','/**\n * 지금 프레임'),ctx);
  vm.runInContext(section('function imageDataCenterSquare(source,','function imageDataWhole(source,'),ctx);
  vm.runInContext(section('function grabVideoFrame(atMs','// 문은 하나다'),ctx);
  vm.runInContext(section('if (engineSwitch && engineSwitchControl && r2Available) {','const scanResetButton ='),ctx);
  return ctx;
}

test('실제 엔진 전환 callback은 양방향 모두 이전 실패·clip·승격 타이머를 비워요',()=>{
  for(const enabled of [false,true]){
    const ctx=context({enabled});ctx.engineSwitchControl.events.click();
    assert.equal(ctx.r2Runtime.enabled,!enabled);
    assert.equal(ctx.failStreakSince,null);assert.equal(ctx.clipStreakSince,null);
    assert.equal(ctx.nextEscalationAt,null);assert.equal(ctx.clipHintShown,false);assert.equal(ctx.closerHintShown,false);
    assert.equal(ctx.scanSession,3,'같은 카메라에서 엔진을 고른 것만으로 세션 번호를 바꾸지 않아요');
  }
});

test('R1 실패 뒤 R2로 전환하면 실제 grab이 960과 승격 크기 사이를 왕복하지 않아요',()=>{
  for(const shortSide of [1080,2160]){
    const ctx=context({shortSide});ctx.engineSwitchControl.events.click();
    const widths=[1000,1600,1633,3200].map(at=>vm.runInContext(`grabVideoFrame(${at}).width`,ctx));
    assert.deepEqual(widths,[960,960,960,960]);
    assert.equal(ctx.nextEscalationAt,null,'R2의 비성공 프레임만으로 R1 승격 타이머를 다시 세우지 않아요');
  }
});

test('대조군: 엔진을 바꾸지 않은 R1 실패의 기존 1600ms 해상도 승격은 유지돼요',()=>{
  for(const shortSide of [1080,2160]){
    const ctx=context({shortSide});
    const widths=[1000,1600,1633,3200].map(at=>vm.runInContext(`grabVideoFrame(${at}).width`,ctx));
    assert.deepEqual(widths,[960,Math.min(1440,shortSide),960,Math.min(1440,shortSide)]);
  }
});
