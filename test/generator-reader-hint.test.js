import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {TL_READER_URL,tlReaderUrlWithHint,qrMatrix} from '../src/qr.js';
import {sceneToSvg} from '../src/svg.js';
import {withHCornerQr} from '../src/generator-h-qr.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const expr=html.match(/qrText:\s*(configuredQrText === ''[\s\S]*?: configuredQrText),/)?.[1];
test('시험판도 기본 fallback QR에 확인 가능한 타입 힌트를 싣고 custom은 보존해요',()=>{
  assert.ok(expr);
  for(const [type,typeC,hint]of [['O',false,'O'],['A',false,'A'],['K',false,'K'],['Y',false,'Y'],['O',true,'C']]){
    for(const configuredQrText of ['',TL_READER_URL]){
      const value=vm.runInNewContext(expr,{type,typeC,configuredQrText,TL_READER_URL,tlReaderUrlWithHint});
      assert.equal(value,TL_READER_URL+'/'+hint);assert.equal(qrMatrix(value).size,21);
    }
    assert.equal(vm.runInNewContext(expr,{type,typeC,configuredQrText:'HTTPS://EXAMPLE.COM',TL_READER_URL,tlReaderUrlWithHint}),'HTTPS://EXAMPLE.COM');
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
