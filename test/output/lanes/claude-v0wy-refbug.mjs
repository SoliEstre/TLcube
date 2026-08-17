// index.html:5797 (HEAD 36c14f1) 의 형태를 그대로 축약한 재현.
// `LOCATOR_PROFILE_CELL_SURFACE_V0XQ` 는 import 목록에서 빠졌는데 비교식에 남아 있다.
const LOCATOR_PROFILE_CELL_SURFACE_V0WQ = 'cell-surface-v0wq';
const LOCATOR_PROFILE_CELL_SURFACE_V0W = 'cell-surface-v0w';
const LOCATOR_PROFILE_CELL_SURFACE_V0X = 'cell-surface-v0x';
const generatorState = { locatorProfileY: 'off' };   // «면» 카드 클릭 시의 흔한 상태

function onPlaneCardClick() {
  if (generatorState.locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0WQ) {
    generatorState.locatorProfileY = LOCATOR_PROFILE_CELL_SURFACE_V0W;
  } else if (generatorState.locatorProfileY === LOCATOR_PROFILE_CELL_SURFACE_V0XQ) {
    generatorState.locatorProfileY = LOCATOR_PROFILE_CELL_SURFACE_V0X;
  }
  return 'ok';
}

// ① 상태가 v0wq 면 첫 분기에서 끝나 살아난다 (그래서 눈에 안 띈다).
generatorState.locatorProfileY = LOCATOR_PROFILE_CELL_SURFACE_V0WQ;
try { console.log('상태=v0wq :', onPlaneCardClick()); }
catch (e) { console.log('상태=v0wq :', e.constructor.name, e.message); }

// ② 그 외 상태 (off / v0 / v0w / v0x …) 는 둘째 비교식을 평가한다.
for (const state of ['off', 'cell-surface-v0', 'cell-surface-v0w', 'cell-surface-v0x']) {
  generatorState.locatorProfileY = state;
  try { console.log('상태=' + state.padEnd(16), ':', onPlaneCardClick()); }
  catch (e) { console.log('상태=' + state.padEnd(16), ':', e.constructor.name + ': ' + e.message); }
}
