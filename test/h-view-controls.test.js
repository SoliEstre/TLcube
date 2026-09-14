import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGeneratorState} from '../src/generator-state.js';
import {clampHRotationSpeed,hPointerDragDelta,normalizeHViewControls} from '../src/generator-h.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('H 회전 상태는 저장 복원에서 축을 정화하고 속도를 1~90으로 고정해요',()=>{
  const fresh=createGeneratorState({hRotationMode:'y',hRotationSpeed:15});
  assert.equal(fresh.hRotationMode,'y');assert.equal(fresh.hRotationSpeed,15);
  assert.equal(clampHRotationSpeed(0),1);assert.equal(clampHRotationSpeed(91),90);
  assert.deepEqual(normalizeHViewControls({hRotationMode:'gyro',hRotationSpeed:12.6}),{hRotationMode:'gyro',hRotationSpeed:13,hRotationSpeedIntent:'auto',hRotationTiltDeg:17.5,hRotationTiltMode:'turn',hArrangement:'isometric',hFaces:3,hRenderFaces:3,hRotationDirectionX:1,hRotationDirectionY:1});
});

test('H 카드와 속도 조작은 native button이며 범위에서 비활성화해요',()=>{
  assert.match(html,/id="hRotationModeCards"[\s\S]*data-h-rotation-mode="x"[\s\S]*data-h-rotation-mode="y"[\s\S]*data-h-rotation-mode="gyro"/);
  assert.match(html,/id="hRotationSpeed"[^>]*min="1"[^>]*max="90"[^>]*step="1"/);
  assert.match(html,/hRotationSpeedDown[^\n]*disabled=!rotationReady\|\|speed<=1/);
  assert.match(html,/hRotationSpeedUp[^\n]*disabled=!rotationReady\|\|speed>=90/);
  assert.equal(/<select id="hVersion"/.test(html),false);assert.equal(/<select id="hMask"/.test(html),false);
  assert.match(html,/data-h-version="auto"[\s\S]*data-h-version="7"/);
  assert.match(html,/data-h-mask="auto"[\s\S]*data-h-mask="7"/);
  assert.match(html,/\.h-speed-row \{ display: grid; grid-template-columns: 36px minmax\(0, 1fr\) 36px;/);
  assert.match(html,/id="hPreviewRotationControls"[\s\S]*id="hRotationModeCards"[\s\S]*class="y3d-row y3d-adjust-row"[\s\S]*id="hRotationSpeedDown"[\s\S]*id="hRotationSpeed"[\s\S]*id="hRotationSpeedUp"/);
  assert.match(html,/#hVersionCards, #hMaskCards \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
});

test('원근 표시는 도 단위이고 평면·정위치와 각도 단추가 독립이에요',()=>{
  assert.match(html,/id="y3dPersp"[^>]*min="0"[^>]*max="60"[^>]*step="1"/);
  assert.match(html,/orbitTToPersp\(degrees\/ORBIT_PERSP_MAX_DEG\)/);
  assert.match(html,/id="y3dPerspPlane"/);assert.match(html,/id="y3dPerspDown"/);assert.match(html,/id="y3dPerspUp"/);
  assert.match(html,/els\.y3dPoseReset\.hidden=false/);
  const pose=html.slice(html.indexOf("els.y3dPoseReset.addEventListener('click'"),html.indexOf('});',html.indexOf("els.y3dPoseReset.addEventListener('click'")));
  assert.match(pose,/yaw=0/);assert.match(pose,/pitch=0/);assert.match(pose,/roll=0/);assert.equal(pose.includes('persp='),false);
});

test('Y 포인터 순수 델타는 기존 부호를 보존해요',()=>{
  assert.deepEqual(hPointerDragDelta({dx:8,dy:3,rollDelta:.25}),{yaw:-.08,pitch:-.03,roll:-.25});
});
