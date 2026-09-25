import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodeH} from '../src/h-codec.js';
import {buildHScene} from '../src/h-render.js';
import {withHCornerQr,hQrPosition} from '../src/generator-h-qr.js';
import {qrMatrix,TL_READER_URL} from '../src/qr.js';
const corners=['TL','TR','BL','BR'],text=TL_READER_URL;
// ⚠ 제목 갱신 (2026-09-26): H «안쪽» 은 이제 빈 면 QR 이라 «끈다» 가 아니에요. 저장된 Y 의 'inner' 는 H 코너 축에서 '없음' 으로 읽어요.
test('H 코너 축은 저장된 안쪽(Y) 선택을 없음으로 읽고 네 코너 선택을 보존해요',()=>{
  for(const pos of corners)assert.equal(hQrPosition(pos),pos);
  for(const pos of ['inner','none','bad',undefined])assert.equal(hQrPosition(pos),'none');
});
test('QR 전체 모듈과 4모듈 quiet를 큐브와 분리해 배치해요',()=>{
  const encoded=encodeH('H QR',{version:6,mode:3,tones:3,finder:'auto'});
  for(const perspective of [0,.5,1])for(const corner of corners){
    const base=buildHScene(encoded,{outline:true,perspective}),before=JSON.stringify(base);
    const scene=withHCornerQr(base,{text,corner}),meta=scene.hCornerQr,qr=qrMatrix(text);
    assert.equal(JSON.stringify(base),before);assert.equal(scene.hModel,base.hModel);
    const marks=scene.shapes.filter(s=>s.qr);assert.equal(marks.length,1+qr.modules.reduce((a,b)=>a+b,0));
    assert.equal(meta.quiet,4);assert.ok(meta.module>0);
    assert.equal(scene.width,base.width);assert.equal(scene.height,base.height);
    assert.deepEqual(scene.shapes.filter(s=>!s.qr),base.shapes);
    const cube=scene.shapes.filter(s=>!s.qr).flatMap(s=>s.points);
    assert.ok(cube.every(p=>p.x<meta.x||p.x>meta.x+meta.size||p.y<meta.y||p.y>meta.y+meta.size));
    let k=1;
    for(let row=0;row<21;row++)for(let col=0;col<21;col++)if(qr.modules[row*21+col]){
      assert.deepEqual(marks[k++].points[0],{x:meta.x+(4+col)*meta.module,y:meta.y+(4+row)*meta.module});
    }
    assert.equal(withHCornerQr(base,{text,corner:'inner'}),base);assert.equal(withHCornerQr(base),base);
  }
});
test('H 일반·현재시점 출력과 미리보기는 같은 코너 합성 함수를 써요',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  // 일반 출력·Canvas 미리보기·MP4·현재시점 출력·GPU용 현재시점 스냅샷을 함께 검사해요.
  assert.equal((html.match(/withHCornerQr\(buildHScene\(/g)||[]).length,5);
  // ⚠ 의도적 갱신 (2026-09-26): 잠금 술어가 `isH` → `hInnerLocked`(H 이면서 빈 면 QR 불가)로 좁아졌어요.
  //   술어 정의(`isH && !hq.available`) 철자는 generator-exclusion-matrix 한 곳에서만 재요(같은 줄을 두 파일이 고정하면 리팩터링 한 번에 둘 다 빨개져요).
  //   잠김·열림 성질은 generator-h-qr-state 의 실제 클릭 하네스가 재요.
  assert.match(html,/card\.classList\.toggle\('disabled',hInnerLocked\)/);
  // ⚠ 의도적 갱신 (2026-09-26): 3면 렌더 잠금이 «4…6면 데이터 또는 마주보는 면 배치» 술어(hRenderFacesLockedToSix)로 넓어졌어요.
  //   성질(잠긴 상태에서 3면을 못 고름)은 generator-h-alignment-state 의 상태 함수 단언과 generator-h-controls-state 클릭 하네스가 재요.
  assert.match(html,/els\.y3dFaces3\.disabled=isH&&hRenderFacesLockedToSix\(generatorState\)/);
  const sidebar=html.slice(html.indexOf('id="hOptions"'),html.indexOf('data-h-label="notice"'));
  assert.ok(!sidebar.includes('hRotationModeCards'));assert.ok(!sidebar.includes('hRotationSpeed'));
  assert.ok(!sidebar.includes('hVersionCards')&&!sidebar.includes('hMaskCards'));
});
