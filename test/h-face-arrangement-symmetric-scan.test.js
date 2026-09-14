import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {buildHScene} from '../src/h-render.js';
import {detectH} from '../src/h-detect.js';
import {createHScanRuntime} from '../src/h-scan-runtime.js';
import {rasterize} from '../src/raster.js';
import {relativeLuminance8} from '../src/luminance.js';
import {hDisplayMap} from '../src/h-face-arrangement.js';

// 2026-09-14 운영자 관찰 «스캐너 화면은 XM/YM 인데 실제 면은 XM/XP — 전용 로케이터가 필요한가?» 에 대한 자예요.
// 스캐너는 면 안의 태그(코드북 정확 일치)로 논리 면을 정하고(h-detect.js) 프레임 간 누적으로 완료해요(h-collector.js).
// 그래서 물리 XP 에 그려진 논리 YM 코드도 «YM» 으로 읽히고, 마주보는 두 면은 반 바퀴 뒤 두 번째 프레임에서 모여요.
// test/h-face-arrangement-symmetric.test.js 는 표시 맵·UI 만 재므로, 여기서 «대칭 렌더 → 검출 → 수집 완료» 축을 잠가요.
const PAYLOAD='https://tl.estre.so/sym';
function lumaField(raster){
  const data=new Float32Array(raster.width*raster.height);
  for(let i=0,o=0;i<data.length;i+=1,o+=4)data[i]=relativeLuminance8(raster.pixels[o],raster.pixels[o+1],raster.pixels[o+2]);
  return {width:raster.width,height:raster.height,data};
}
// test/h-scan-runtime.test.js 와 같은 래스터(pixelsPerUnit 12 · supersample 2 · perspective .18).
const frameOf=(encoded,rotateY)=>lumaField(rasterize(buildHScene(encoded,{perspective:.18,rotateY,arrangement:'symmetric',renderFaces:6,margin:2}),{pixelsPerUnit:12,supersample:2}));

test('대칭 2면: 물리 XM(논리 XM) 프레임과 반 바퀴 뒤 물리 XP(논리 YM) 프레임 두 장으로 런타임이 DONE 되고 원문을 복원해요 — 전용 로케이터 없이, frame·corners 파인더 모두',()=>{
  for(const [version,finder] of [[2,'frame'],[7,'corners']]){
    const encoded=encodeH(PAYLOAD,{version,mode:2,tones:3,ecc:'H',mask:7,finder});
    const map=hDisplayMap(encoded,{arrangement:'symmetric',renderFaces:6});
    assert.deepEqual(map.physicalToLogical,{ZM:null,XM:'XM',YM:null,ZP:null,XP:'YM',YP:null});
    const runtime=createHScanRuntime({detect:detectH,coldIntervalMs:0,activeIntervalMs:0});
    let hit=null;
    [[0,['XM']],[Math.PI,['YM']]].forEach(([rotateY,expected],k)=>{
      const field=frameOf(encoded,rotateY);
      const detected=detectH(field,{maxComponents:128});
      const tags=[...new Set(detected.faces.filter(f=>f.mode===2).map(f=>f.face))].sort();
      assert.deepEqual(tags,expected,`${finder} 프레임 ${k}: 한 프레임엔 코드 면이 하나만 보이고 태그가 논리 면을 정해요`);
      assert.ok(detected.faces.every(f=>f.mirror===false),`${finder} 프레임 ${k}: 물리 XP 국소축에 놓인 격자도 거울상이 아니에요`);
      hit=runtime.pushFrame(field,k*1000,{frameId:`k${k}`,force:true})??hit;
      assert.equal(runtime.stats.state,k===0?'COLLECTING':'DONE',`${finder} 프레임 ${k}`);
      assert.deepEqual([...runtime.stats.present].sort(),k===0?['XM']:['XM','YM']);
    });
    assert.equal(hit?.text,PAYLOAD,`${finder}: 두 프레임 누적으로 원문 복원`);
  }
});

test('대조군: 아이소메트릭 2면 6면 렌더는 첫 프레임에서 XM·YM 이 같이 보여 즉시 DONE — 대칭과의 차이는 «완료까지 반 바퀴» 뿐이에요',()=>{
  const encoded=encodeH(PAYLOAD,{version:2,mode:2,tones:3,ecc:'H',mask:7,finder:'frame'});
  const runtime=createHScanRuntime({detect:detectH,coldIntervalMs:0,activeIntervalMs:0});
  const field=lumaField(rasterize(buildHScene(encoded,{perspective:.18,rotateY:0,arrangement:'isometric',renderFaces:6,margin:2}),{pixelsPerUnit:12,supersample:2}));
  const hit=runtime.pushFrame(field,0,{frameId:'k0',force:true});
  assert.equal(runtime.stats.state,'DONE');assert.equal(hit?.text,PAYLOAD);
});
