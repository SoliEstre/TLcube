import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createGeneratorState} from '../src/generator-state.js';
import {hPreviewOptions,H_CELL_GROUND_DEFAULT} from '../src/generator-h.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('H 반사광은 실제 자동 회전 미리보기에만 켜고 pause·2.5D에서는 꺼요',()=>{
  const start=html.indexOf('function hSceneOptions(){'),end=html.indexOf('function paintHPositionLabels(',start);
  assert.ok(start>=0&&end>start);
  for(const hAutoRotate of [false,true])for(const on of [false,true]){
    // current.encoded — 단계 D3 부터 미리보기 옵션이 실제 인코딩을 넘겨요(H 셀 꾸미기 문맥 — 그 배선은
    // decoration-ui.test.js ④ 가 hSceneOptions 를 돌려 재요). 이 자는 반사광만 재요.
    const context={generatorState:{preset:'slate',shading:'off',hAutoRotate},current:{encoded:null},hAnimation:{elapsed:123},y3dPreview:{pad:24,on},Y3D_PAD_BASE:24,hFaceImages:{},hPreviewOptions:()=>({}),paletteOf:()=>({}),resolvedRenderProfile:()=>'screen'};
    const lighting=vm.runInNewContext(html.slice(start,end)+'hSceneOptions().lighting',context);
    assert.equal(lighting.rotationFill,hAutoRotate&&on);
    assert.equal(lighting.profile,'screen');assert.equal(lighting.shading,'off');
  }
});

/**
 * 실제 index.html 의 회전 영상 click 리스너를 vm 에서 돌려 첫 프레임의 생산자 입력을 잡아요(철자가 아니라 행동).
 * 바깥 의존은 전부 스텁이고 hPreviewOptions 만 진짜 함수예요 — 테스트 전용 fixture 허용표(allow)를 끼워
 * «영상 프레임이 미리보기와 같은 인코딩을 넘겨 H 셀 꾸미기가 열리는가» 까지 재요(decoration-ui ④ 는 미리보기
 * hSceneOptions 만 재고 영상 경로는 안 재요).
 */
// 영상 프레임 옵션의 «값의 출처» 를 가르려는 표지들 — 기본값·빈 객체와 구별돼야 빠진 필드가 초록으로 새지 않아요.
// pad 48 ≠ Y3D_PAD_BASE 24 라 zoom 은 1 이 아니라 0.5 여야 해요(zoom 누락 = undefined, 상수 1 로 바꿈 = 1 → 둘 다 빨강).
const FACE_IMAGES_SENTINEL=Object.freeze({sentinel:'face-images'});
const H_QR_SENTINEL=Object.freeze({deco:null,sentinel:'h-qr'});
const VIDEO_PAD=48,VIDEO_PAD_BASE=24;

async function runVideoListener({state,encoded,allow,elapsed=500,timestampMs=40}){
  const start=html.indexOf("for(const videoButton of document.querySelectorAll('[data-video-size]'))");
  const end=html.indexOf('const CUBE_EXPORT_IDS',start);
  assert.ok(start>=0&&end>start,'전제: 회전 영상 리스너 블록이 없어요');
  const calls={hPreviewOptions:[],hPreviewState:[],buildHScene:[],withHCornerQr:[]};
  let listener=null;
  const button={dataset:{videoSize:'480'},addEventListener:(type,fn)=>{assert.equal(type,'click');listener=fn;}};
  const status={textContent:''};
  const context={
    document:{querySelectorAll:()=>[button],createElement:()=>({width:0,height:0})},
    window:{devicePixelRatio:1},AbortController,structuredClone,
    cubeVideoJob:null,cubeVideoFps:30,cubeVideoBackground:'green',
    hImageEditor:{flush:()=>{}},flushScheduledRender:()=>{},
    current:{type:'H',encoded,hQr:H_QR_SENTINEL},hGeneratorActive:()=>true,generatorState:{...state},
    y3dPreview:{on:true,pad:VIDEO_PAD},Y3D_PAD_BASE:VIDEO_PAD_BASE,hAnimation:{elapsed},hFaceImages:FACE_IMAGES_SENTINEL,
    paletteOf:()=>({background:{r:1,g:2,b:3},levels:[]}),resolvedRenderProfile:()=>'screen',
    exportFilename:()=>'x.mp4',stopHAnimation:()=>{},syncCubeVideoUi:()=>{},paintY3dPreview:()=>{},
    cubeVideoDurationMs:()=>1000,clampHRotationTiltMode:m=>m,
    hPreviewOptions:(s,o)=>{calls.hPreviewState.push(s);calls.hPreviewOptions.push(o);return hPreviewOptions(s,{...o,allow});},
    buildHScene:(enc,opts)=>{calls.buildHScene.push({enc,opts});return {width:10,shapes:[]};},
    withHCornerQr:(scene,qr)=>{calls.withHCornerQr.push(qr);return scene;},
    drawScene:()=>{},download:()=>{},$:()=>status,hText:()=>'{percent}',
    // 인코딩 도중 사용자가 조작을 바꿔도 영상은 클릭 시점 스냅샷으로 그려야 해요 — 첫 프레임 전에 라이브 상태를
    // 흔들어 둬요(라이브 generatorState · current.encoded 를 직접 읽으면 여기서 바뀐 값이 프레임에 새요).
    exportCubeMp4:async({renderFrame})=>{
      context.generatorState.hRotationTiltDeg=(state.hRotationTiltDeg??0)+11;context.generatorState.preset='__live-mutated__';
      context.current.encoded={version:99,finder:'live-mutated'};
      renderFrame({context:{drawImage:()=>{}},canvas:{width:10,height:10},timestampMs});return new Uint8Array(0);
    },
  };
  vm.runInNewContext(html.slice(start,end),context);
  assert.ok(listener,'전제: 리스너가 안 걸렸어요');
  await listener();
  assert.equal(context.cubeVideoJob,null,'리스너가 끝까지 안 돌았어요(finally 미도달)');
  return {calls,status:status.textContent};
}

const H_ENCODED=Object.freeze({version:2,finder:'center',tones:3});

test('회전 영상은 같은 반사광을 사용하고 일반 정적 렌더 경로에는 추가하지 않아요',async()=>{
  const state=createGeneratorState({type:'Y',yRepresentation:'3d',orbitView:'3d',hAutoRotate:true,shading:'off',preset:'slate'});
  const {calls,status}=await runVideoListener({state,encoded:H_ENCODED,allow:{ROWS:[]}});
  assert.equal(calls.buildHScene.length,1,`첫 프레임이 안 그려졌어요(상태 문구: ${status})`);
  const {enc,opts}=calls.buildHScene[0];
  assert.equal(enc,H_ENCODED);
  assert.deepEqual({...opts.lighting},{profile:'screen',shading:'off',rotationFill:true});
  assert.equal(opts.outline,true);
  // 빈 면 이미지 · 확대 — 빠지면 MP4 에서 면 이미지나 줌이 조용히 사라져요(구 철자 정규식이 잡던 필드).
  assert.equal(opts.faceImages,FACE_IMAGES_SENTINEL,'영상 프레임에 빈 면 이미지(hFaceImages)가 안 실렸어요');
  assert.equal(opts.zoom,VIDEO_PAD_BASE/VIDEO_PAD,'영상 프레임 zoom 이 Y3D_PAD_BASE/y3dPreview.pad 가 아니에요');
  // 코너 QR 은 클릭 시점 current.hQr 의 값으로 씌워요.
  assert.equal(calls.withHCornerQr.length,1);
  assert.deepEqual({...calls.withHCornerQr[0]},{...H_QR_SENTINEL},'영상 프레임이 current.hQr 로 코너 QR 을 안 씌워요');
  // 영상 시각 = 미리보기 경과 + 프레임 타임스탬프 · 같은 팔레트 · 같은 인코딩(단계 D3).
  const [po]=calls.hPreviewOptions;
  assert.equal(po.elapsedMs,540);
  assert.equal(po.encoded,H_ENCODED,'영상 프레임이 인코딩을 hPreviewOptions 에 안 넘겨요');
  assert.deepEqual({...po.palette},{background:{r:1,g:2,b:3},levels:[]});
  // 스냅샷: 인코딩 도중 라이브 상태가 바뀌어도(exportCubeMp4 스텁이 흔들어요) 클릭 시점 값으로 그려요.
  const [ps]=calls.hPreviewState;
  assert.equal(ps.preset,'slate','hPreviewOptions 가 클릭 시점 스냅샷이 아니라 라이브 generatorState 를 받았어요');
  assert.equal(ps.hRotationTiltDeg,state.hRotationTiltDeg);
  const staticOptions=html.match(/let sceneOpts=([^\n]+)/)?.[1];
  assert.ok(staticOptions);assert.ok(!staticOptions.includes('rotationFill'));
});

test('회전 영상 프레임도 H 셀 꾸미기를 미리보기와 같은 resolver 로 받아요 — 허용표가 열면 싣고, 스텁이면 안 실어요',async()=>{
  const state=createGeneratorState({type:'Y',yRepresentation:'3d',orbitView:'3d',hAutoRotate:true,preset:'slate',hCellStyle:'dots'});
  assert.equal(state.hCellStyle,'dots','전제: 상태 스키마가 hCellStyle 을 받아요');
  const row={table:'h',version:2,finder:'center',tones:3,ground:H_CELL_GROUND_DEFAULT,paletteGrade:'slate',hCellStyle:'dots'};
  const opened=(await runVideoListener({state,encoded:H_ENCODED,allow:{ROWS:[row]}})).calls.buildHScene[0].opts;
  assert.equal(opened.hCellStyle,'dots','영상 프레임에 H 셀 스타일이 안 실렸어요');
  assert.equal(opened.hCellGround,H_CELL_GROUND_DEFAULT);
  const locked=(await runVideoListener({state,encoded:H_ENCODED,allow:{ROWS:[]}})).calls.buildHScene[0].opts;
  assert.equal('hCellStyle' in locked,false,'스텁 허용표인데 셀 스타일이 실렸어요');
  assert.equal('hCellGround' in locked,false);
});
