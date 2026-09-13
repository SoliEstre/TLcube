import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {buildHFaceSheet} from '../src/h-render.js';
import {detectH} from '../src/h-detect.js';
import {createHCollector} from '../src/h-collector.js';
import {rasterize} from '../src/raster.js';
import {hPhotoLuma} from '../src/h-photo-worker-entry.js';

function result(field,encoded){
  const detection=detectH(field),collection=createHCollector().addFrame({observations:detection.faces,frameId:'noise',timestamp:0});
  const done=collection.assemblies.find(a=>a.state==='DONE');
  assert.equal(collection.state,'DONE',JSON.stringify(detection.stats));
  assert.equal(collection.count,encoded.mode);
  assert.equal(collection.result.text,'H');
  assert.equal(collection.result.crc,encoded.crc);
  assert.deepEqual(Array.from(collection.result.bytes),[72]);
  assert.equal(done.profile.version,encoded.version);
  assert.equal(done.profile.mode,encoded.mode);
  assert.equal(done.profile.mask,encoded.mask);
  assert.equal(done.profile.routeId,encoded.routeId);
  return detection;
}

for(const version of [0,5,7])for(const mode of [3,6])for(const ppu of [2,3]){
  test(`H${version}/${mode}면/ppu${ppu}: 작은 파인더 앞의 2픽셀 잡음은 후보 예산을 쓰지 않아요`,()=>{
    const encoded=encodeH('H',{version,mode,tones:3,ecc:'M',mask:3,finder:'auto'});
    const r=rasterize(buildHFaceSheet(encoded),{pixelsPerUnit:ppu,supersample:2});
    const clean=hPhotoLuma({width:r.width,height:r.height,data:r.pixels});
    result(clean,encoded);
    const header=128,width=clean.width,height=clean.height+header,data=new Float32Array(width*height);
    data.fill(1);data.set(clean.data,header*width);
    let noise=0;
    for(let y=2;y<header-2;y+=2)for(let x=2;x<width-3;x+=4){
      data[y*width+x]=0;data[y*width+x+1]=0;noise++;
    }
    assert.ok(noise>512);
    const before=data.slice(),hit=result({width,height,data},encoded);
    assert.deepEqual(data,before);
    assert.ok(hit.stats.rawComponents>512);
    assert.ok(hit.stats.tinyComponents>=noise);
    assert.ok(hit.stats.candidateComponents<=512);
    assert.ok(hit.stats.components<=128);
    assert.ok(hit.stats.floodPixels<=data.length);
    assert.equal(hit.stats.capped,false);
  });
}

test('400만 픽셀의 2픽셀 잡음은 선형 방문만 하고 파인더로 수락하지 않아요',()=>{
  const width=2000,height=2000,data=new Float32Array(width*height);data.fill(1);
  for(let y=1;y<height-1;y+=2)for(let x=1;x<width-2;x+=4){data[y*width+x]=0;data[y*width+x+1]=0;}
  const hit=detectH({width,height,data});
  assert.equal(hit.faces.length,0);
  assert.equal(hit.stats.rawComponents,499500);
  assert.equal(hit.stats.tinyComponents,499500);
  assert.equal(hit.stats.floodPixels,999000);
  assert.equal(hit.stats.candidateComponents,0);
  assert.equal(hit.stats.components,0);
  assert.equal(hit.stats.capped,false);
});
