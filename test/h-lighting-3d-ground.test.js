import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {buildHScene} from '../src/h-render.js';
import {hLightingGround,resolveHLighting} from '../src/h-lighting.js';

const encoded=encodeH('ground-3d',{version:2,mode:6,tones:3,ecc:'H',mask:7,finder:'auto'});
const scene=(pose,shading='on')=>buildHScene(encoded,{...pose,perspective:4/60,lighting:{profile:'screen',shading}});
const extent=points=>({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))});
const cubeExtent=s=>extent(s.shapes.filter(shape=>shape.face).flatMap(shape=>shape.points));

test('3D 장면의 «그림자·반사광» 은 2.5D 띠가 아니라 바닥 사영 볼록 껍질 두 개예요(그림자·반사광), 뷰포트 안에 잘려요',()=>{
  for(const pose of [{},{rotateY:.8},{rotateX:.6,rotateY:1.2},{rotateX:2.5,rotateZ:1}]){
    const s=scene(pose);
    assert.equal(s.shading.length,2);
    const [shadow,reflect]=s.shading;
    assert.equal(shadow.role,'shadow');assert.equal(reflect.role,'reflect');
    for(const band of s.shading){
      assert.ok(band.points.length>=3&&band.points.length<=8,'볼록 껍질은 3…8 점이에요');
      assert.ok(band.points.every(p=>p.x>=0&&p.x<=s.width&&p.y>=0&&p.y<=s.height));
      assert.equal(band.group,'h-ground');assert.equal(band.gradient.a2,0);assert.ok(band.gradient.a1>0);
    }
    const cube=cubeExtent(s),sh=extent(shadow.points),re=extent(reflect.points);
    // 바닥은 큐브의 가장 낮은 꼭짓점 아래라 두 효과 모두 큐브 아래쪽(화면 y 큰 쪽)까지 이어져요.
    assert.ok(sh.maxY>cube.maxY-1e-9&&re.maxY>cube.maxY-1e-9,'그림자·반사광이 큐브 바닥 아래로 내려가요');
    // 그림자는 화면 오른쪽(아래) 으로 떨어져요 — 2.5D 띠의 관례와 같은 방향.
    assert.ok(sh.maxX>cube.maxX-1e-9,'그림자가 큐브 오른쪽 바깥까지 이어져요');
  }
});

test('바닥 사영은 자세를 따라 변하고, 색·알파 계약은 옛 띠와 같아요',()=>{
  const a=scene({}).shading[0],b=scene({rotateY:.8}).shading[0];
  assert.notDeepEqual(a.points,b.points);
  assert.deepEqual(a.color,{r:0,g:0,b:0});assert.equal(a.gradient.a1,.22);
  assert.deepEqual(scene({}).shading[1].color,{r:255,g:255,b:255});assert.equal(scene({}).shading[1].gradient.a1,.16);
  assert.equal(scene({},'off').shading.length,0);
});

test('project 가 없는 장면(2.5D 면시트 등)은 옛 4점 띠를 그대로 돌려줘요',()=>{
  const light=resolveHLighting({profile:'screen',shading:'on'},{rotateY:.3});
  assert.ok(light.groundCast,'3D 사영용 벡터는 shading on 일 때만 있어요');
  assert.equal(resolveHLighting({profile:'screen',shading:'off'},{}).groundCast,undefined);
  const bands=hLightingGround({width:20,height:20},light);
  assert.equal(bands.length,2);for(const band of bands)assert.equal(band.points.length,4);
});
