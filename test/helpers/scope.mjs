/** 공통 테스트 범위: default는 대표 기능, full은 승격 전 전수 측정 블록까지 연다. */
const rawScope = process.env.TL_TEST_SCOPE ?? 'default';

if (rawScope !== 'default' && rawScope !== 'full') {
  throw new RangeError(`TL_TEST_SCOPE는 default 또는 full이어야 한다: ${rawScope}`);
}

export const TEST_SCOPE = rawScope;
export const isFullScope = () => TEST_SCOPE === 'full';
export const isBenchScope = () => process.env.TL_TEST_BENCH === '1';
export const fullOnly = (register) => {
  if (isFullScope()) register();
};
