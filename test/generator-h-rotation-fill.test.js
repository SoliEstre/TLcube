import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('H 반사광은 실제 자동 회전 미리보기에만 켜고 pause·2.5D에서는 꺼요',()=>{
  const start=html.indexOf('function hSceneOptions(){'),end=html.indexOf('function paintHPositionLabels(',start);
  assert.ok(start>=0&&end>start);
  for(const hAutoRotate of [false,true])for(const on of [false,true]){
    const context={generatorState:{preset:'slate',shading:'off',hAutoRotate},hAnimation:{elapsed:123},y3dPreview:{pad:24,on},Y3D_PAD_BASE:24,hFaceImages:{},hPreviewOptions:()=>({}),paletteOf:()=>({}),resolvedRenderProfile:()=>'screen'};
    const lighting=vm.runInNewContext(html.slice(start,end)+'hSceneOptions().lighting',context);
    assert.equal(lighting.rotationFill,hAutoRotate&&on);
    assert.equal(lighting.profile,'screen');assert.equal(lighting.shading,'off');
  }
});
test('회전 영상은 같은 반사광을 사용하고 일반 정적 렌더 경로에는 추가하지 않아요',()=>{
  const video=html.slice(html.indexOf("for(const videoButton of document.querySelectorAll('[data-video-size]'))"),html.indexOf('const CUBE_EXPORT_IDS'));
  assert.match(video,/lighting=\{profile:resolvedRenderProfile\(\),shading:state\.shading,rotationFill:true\}/);
  assert.match(video,/buildHScene\(encoded,\{\.\.\.hPreviewOptions\(state,\{elapsedMs:elapsed\+timestampMs,palette\}\),outline:true,faceImages,lighting,zoom\}\)/);
  const staticOptions=html.match(/let sceneOpts=([^\n]+)/)?.[1];
  assert.ok(staticOptions);assert.ok(!staticOptions.includes('rotationFill'));
});
