import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {buildHScene,hProjection} from '../src/h-render.js';
import {detectH} from '../src/h-detect.js';
import {createHScanRuntime} from '../src/h-scan-runtime.js';
import {rasterize} from '../src/raster.js';
import {relativeLuminance8} from '../src/luminance.js';
import {hDisplayMap} from '../src/h-face-arrangement.js';

// «6면 (반복)» 의 반대면 복제는 같은 (i,j) 사본이에요. 모든 면 틀(hFacePoint)이 바깥에서 거울 아님이라
// 사본도 거울 아님으로 읽히고, 태그가 논리 면을 정해요. 그래서 반대 꼭짓점(ZP·XP·YP)만 보이는 한 프레임으로도 DONE 이에요.
// test/h-face-arrangement-symmetric-scan.test.js 와 같은 래스터(pixelsPerUnit 12 · supersample 2 · perspective .18).
const PAYLOAD='TL-rf6';
const CANONICAL={rotateX:0,rotateY:0,rotateZ:0};
const ANTIPODAL={rotateX:Math.PI,rotateY:Math.PI/2,rotateZ:0}; // (1,1,1) → (−1,−1,−1): ZP·XP·YP 가 카메라를 봐요
function lumaField(raster){
  const data=new Float32Array(raster.width*raster.height);
  for(let i=0,o=0;i<data.length;i+=1,o+=4)data[i]=relativeLuminance8(raster.pixels[o],raster.pixels[o+1],raster.pixels[o+2]);
  return {width:raster.width,height:raster.height,data};
}
const raster=(encoded,opts)=>rasterize(buildHScene(encoded,{perspective:.18,margin:2,...opts}),{pixelsPerUnit:12,supersample:2});
function scanOne(field){
  const runtime=createHScanRuntime({detect:detectH,coldIntervalMs:0,activeIntervalMs:0});
  const hit=runtime.pushFrame(field,0,{frameId:'k0',force:true});
  return {state:runtime.stats.state,text:hit?.text};
}

test('자세 확인: ANTIPODAL 은 물리 ZP·XP·YP 만 그려요',()=>{
  assert.deepEqual(hProjection(13,{...ANTIPODAL,perspective:.18}).visible,['ZP','XP','YP']);
  assert.deepEqual(hProjection(13,{...CANONICAL,perspective:.18}).visible,['ZM','XM','YM']);
});

test('3F + 6면(반복): 반대 꼭짓점 한 프레임만으로 태그 셋이 거울 아님으로 읽히고 DONE · 원문 복원 — 2/3톤 × frame/corners',()=>{
  for(const [version,finder] of [[1,'frame'],[5,'corners']])for(const tones of [2,3]){
    const label=`H${version} ${finder} ${tones}톤`;
    const encoded=encodeH(PAYLOAD,{version,mode:3,tones,ecc:'M',mask:7,finder});
    const field=lumaField(raster(encoded,{...ANTIPODAL,arrangement:'isometric',renderFaces:6}));
    const detected=detectH(field,{maxComponents:128});
    assert.deepEqual([...new Set(detected.faces.map(f=>f.face))].sort(),['XM','YM','ZM'],label);
    assert.ok(detected.faces.every(f=>f.mirror===false),label);
    assert.equal(detected.rejected.filter(r=>r.reason==='reflection').length,0,label);
    const {state,text}=scanOne(field);
    assert.equal(state,'DONE',label);assert.equal(text,PAYLOAD,label);
  }
});

test('정본 시점은 반복과 무관해요: 3F 아이소메트릭 rf6 과 rf3 의 정본 래스터가 바이트 동일',()=>{
  for(const [version,finder,tones] of [[1,'frame',3],[5,'corners',2]]){
    const encoded=encodeH(PAYLOAD,{version,mode:3,tones,ecc:'M',mask:7,finder});
    const a=raster(encoded,{...CANONICAL,renderFaces:3}),b=raster(encoded,{...CANONICAL,renderFaces:6});
    assert.equal(Buffer.compare(Buffer.from(a.pixels),Buffer.from(b.pixels)),0,`H${version} ${finder}`);
  }
});

test('자 검증: 거울로 뒤집은 면을 심으면 그 면은 받아들이지 않아요(거울 판정이 살아 있어요)',()=>{
  const encoded=encodeH(PAYLOAD,{version:1,mode:3,tones:3,ecc:'M',mask:7,finder:'frame'}),n=encoded.n;
  const mirrored=new Uint8Array(n*n);for(let i=0;i<n;i++)for(let j=0;j<n;j++)mirrored[i*n+j]=encoded.faces.XM[i*n+n-1-j];
  const detected=detectH(lumaField(raster({...encoded,faces:{...encoded.faces,XM:mirrored}},{...CANONICAL,renderFaces:3})),{maxComponents:128});
  assert.deepEqual([...new Set(detected.faces.map(f=>f.face))].sort(),['YM','ZM']);
  assert.ok(detected.rejected.some(r=>r.reason==='reflection'||r.mirror===true));
});

test('3F 수평/수직 + 6면(반복): 반대 꼭짓점은 ZM(물리 XP)·YM(물리 YP 사본) 두 태그, 정본 한 장을 더하면 DONE',()=>{
  const encoded=encodeH(PAYLOAD,{version:1,mode:3,tones:3,ecc:'M',mask:7,finder:'frame'});
  for(const arrangement of ['horizontal','vertical']){
    const runtime=createHScanRuntime({detect:detectH,coldIntervalMs:0,activeIntervalMs:0});
    let hit=runtime.pushFrame(lumaField(raster(encoded,{...ANTIPODAL,arrangement,renderFaces:6})),0,{frameId:'a',force:true});
    assert.equal(runtime.stats.state,'COLLECTING',arrangement);assert.deepEqual([...runtime.stats.present].sort(),['YM','ZM'],arrangement);
    hit=runtime.pushFrame(lumaField(raster(encoded,{...CANONICAL,arrangement,renderFaces:6})),1000,{frameId:'b',force:true})??hit;
    assert.equal(runtime.stats.state,'DONE',arrangement);assert.equal(hit?.text,PAYLOAD,arrangement);
  }
});

test('1F·2F + 6면(반복)의 기존 사본도 반대 꼭짓점 한 프레임으로 DONE 이에요(아이소메트릭·수평·수직)',()=>{
  for(const mode of [1,2]){
    const encoded=encodeH(PAYLOAD,{version:1,mode,tones:3,ecc:'M',mask:7,finder:'frame'});
    for(const arrangement of ['isometric','horizontal','vertical']){
      const label=`${mode}F ${arrangement}`,map=hDisplayMap(encoded,{arrangement,renderFaces:6});
      const field=lumaField(raster(encoded,{...ANTIPODAL,arrangement,renderFaces:6}));
      const detected=detectH(field,{maxComponents:128});
      const expected=[...new Set(['ZP','XP','YP'].map(f=>map.physicalToLogical[f]).filter(Boolean))].sort();
      assert.deepEqual([...new Set(detected.faces.map(f=>f.face))].sort(),expected,label);
      assert.ok(detected.faces.every(f=>f.mirror===false),label);
      const {state,text}=scanOne(field);assert.equal(state,'DONE',label);assert.equal(text,PAYLOAD,label);
    }
  }
});
