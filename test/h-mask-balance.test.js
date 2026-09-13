import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeH, encodeH, hMaskBalance } from '../src/h-codec.js';
import { hMaskLuminance } from '../src/generator-h.js';

function primary(score) {
  return [score.spread,score.variance,score.quadrantSpread,score.quadrantVariance];
}
function lexicographic(a,b) {
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];
  return 0;
}

function profileOf(encoded){const {version,mode,tones,ecc,mask,routeId,finder}=encoded;return {version,mode,tones,ecc,mask,routeId,finder};}
test('auto mask는 실제 여덟 encoding의 전체 면 휘도 균일성 최저 후보를 고르고 진단을 남겨요', () => {
  const options={version:7,mode:4,tones:3,ecc:'H',finder:'corners'};
  const payload='mask-balance / payload with enough variation 0123456789';
  const auto=encodeH(payload,{...options,mask:'auto'}),again=encodeH(payload,{...options,mask:'auto'});
  assert.equal(auto.mask,again.mask);
  assert.deepEqual(auto.maskDiagnostics,again.maskDiagnostics);
  const decoded=decodeH(auto.faces,profileOf(auto));assert.ok(decoded.ok,JSON.stringify(decoded));assert.equal(decoded.text,payload);
  const candidates=Array.from({length:8},(_,mask)=>{
    const encoded=encodeH(payload,{...options,mask});
    return {mask,balance:hMaskBalance(encoded.faces)};
  });
  const selected=candidates.find(row=>row.mask===auto.mask).balance;
  const minimum=candidates.map(row=>primary(row.balance)).sort(lexicographic)[0];
  assert.deepEqual(primary(selected),minimum);
  assert.deepEqual(primary(auto.maskDiagnostics),minimum);
  assert.equal(auto.maskDiagnostics.faceMeans.length,4);
  assert.equal(auto.maskDiagnostics.quadrantMeans.length,16);
});

test('1면 auto mask는 face spread 동률에서도 quadrant 진단으로 결정적이에요', () => {
  const options={version:7,mode:1,tones:3,ecc:'H',finder:'corners',mask:'auto'};
  const first=encodeH('one face mask balance',options),second=encodeH('one face mask balance',options);
  assert.equal(first.mask,second.mask);
  assert.equal(first.maskDiagnostics.faceMeans.length,1);
  assert.equal(first.maskDiagnostics.spread,0);
  assert.equal(first.maskDiagnostics.quadrantMeans.length,4);
});

test('수동 mask 7은 기존 선택을 보존하고 auto-only 진단을 붙이지 않아요', () => {
  const encoded=encodeH('manual mask seven',{version:2,mode:3,tones:3,ecc:'H',finder:'frame',mask:7});
  assert.equal(encoded.mask,7);
  assert.equal(Object.hasOwn(encoded,'maskDiagnostics'),false);
  const balance=hMaskBalance(encoded.faces);
  assert.equal(balance.faceMeans.length,3);
  assert.ok(balance.spread>=0&&balance.variance>=0&&balance.quadrantSpread>=0&&balance.quadrantVariance>=0);
});

test('auto mask는 generator 팔레트의 실제 여섯 level 휘도를 비와이어 선택 입력으로 받아요', () => {
  const palette={levels:[{r:16,g:28,b:44},{r:94,g:136,b:177},{r:236,g:245,b:252}]};
  const luminance=hMaskLuminance(palette,3);
  assert.equal(luminance.length,6);
  assert.equal(luminance[3],0);
  assert.ok(luminance[4]>luminance[2]);
  const options={version:7,mode:4,tones:3,ecc:'H',finder:'corners',mask:'auto',maskLuminance:luminance};
  const first=encodeH('palette-bound auto mask',options),second=encodeH('palette-bound auto mask',options);
  assert.equal(first.mask,second.mask);
  const decoded=decodeH(first.faces,profileOf(first));assert.ok(decoded.ok,JSON.stringify(decoded));assert.equal(decoded.text,'palette-bound auto mask');
  assert.throws(()=>encodeH('x',{...options,maskLuminance:[0,1]}),/maskLuminance/);
});
