import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {TL_READER_URL,tlReaderUrlWithHint,qrMatrix} from '../src/qr.js';
import {sceneToSvg} from '../src/svg.js';
import {withHCornerQr} from '../src/generator-h-qr.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
// ⚠ 의도적 갱신 (2026-09-26): 문구 식이 buildConfig 인라인에서 resolvedQrText() 로 옮겨졌어요 — 코너 QR 과 H 면 QR 이
//   같은 함수를 읽어야 링크가 안 갈려요. 식을 그 함수에서 뽑고, buildConfig 가 그 함수를 부르는지도 같이 재요. 값 단언은 그대로예요.
const resolvedFn=(()=>{const start=html.indexOf('function resolvedQrText()');return start<0?null:html.slice(start,html.indexOf('\n}',start)+2);})();
test('시험판도 기본 fallback QR에 확인 가능한 타입 힌트를 싣고 custom은 보존해요',()=>{
  assert.ok(resolvedFn);
  assert.match(html.slice(html.indexOf('function buildConfig()'),html.indexOf('// ── 렌더',html.indexOf('function buildConfig()'))),/qrText: resolvedQrText\(\),/);
  const run=(type,typeC,qrText)=>vm.runInNewContext(resolvedFn+';resolvedQrText()',{generatorState:{type,qrText},typeCGeneratorActive:()=>typeC,TL_READER_URL,tlReaderUrlWithHint});
  for(const [type,typeC,hint]of [['O',false,'O'],['A',false,'A'],['K',false,'K'],['Y',false,'Y'],['O',true,'C']]){
    for(const configuredQrText of ['',TL_READER_URL]){
      const value=run(type,typeC,configuredQrText);
      assert.equal(value,TL_READER_URL+'/'+hint);assert.equal(qrMatrix(value).size,21);
    }
    assert.equal(run(type,typeC,'HTTPS://EXAMPLE.COM'),'HTTPS://EXAMPLE.COM');
  }
});
test('H QR은 SVG·Canvas seam stroke로 4모듈 quiet를 잠식하지 않아요',()=>{
  const base={width:100,height:100,background:null,hModel:{surfaceN:40,projection:{perspective:0}},shapes:[{kind:'polygon',color:{r:0,g:0,b:0},points:[{x:30,y:30},{x:70,y:30},{x:70,y:70},{x:30,y:70}]}]};
  const scene=withHCornerQr(base,{text:TL_READER_URL,corner:'TL'}),svg=sceneToSvg(scene);
  const polygons=svg.match(/<polygon\b[^>]*>/g);
  assert.equal(polygons.length,scene.shapes.length);assert.ok(polygons[0].includes('stroke='));
  assert.ok(polygons.slice(1).every(p=>!p.includes('stroke=')));
  assert.match(html,/if\(!s\.qr\)\{ctx\.strokeStyle = ctx\.fillStyle;ctx\.stroke\(\);\}/);
});
