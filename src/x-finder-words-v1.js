/**
 * x-finder-words-v1 — 파인더 워드 값 표(연구, rd-3 · 잠금 아님). 사이트 집합·예약·용량은 base 패턴(x-finder.js)과 같고 워드 슬롯의 «레벨» 만 이 표로 바뀌어요.
 *
 * 출처: .agent/lanes/type-x-core-20260919/rd3/finder-word-search.mjs — 목적 = F 지도(실효 구조, 'd' 는 세지 않음)에서 proper 비항등 23 변환의 최소 고정 비트 모순 · improper 24 최소 ·
 * 바깥 법선 면 경계 읽기 24 개의 다른 면 최소 · 같은 면 최소(사전순 가중합). lee-fo 프로파일(N8 = X0, N10 = X1)에서 탐색한 표를 N 별로 채택했어요(mulberry32 seed 7 · 30 재시작 × 3000 반복).
 * 중심 위 워드 슬롯은 표에 없어도 실효 1(상시 on) 로 덮여요. 표에 없는 워드 슬롯이 남으면 x-finder 가 거절해요(조용한 타이밍 대체 없음).
 *
 * 기록된 점수(탐색 프로파일의 F 지도, 검증 test/x-finder.test.js 가 재계산):
 *   edge-m1s3-v0 N8(X0): timing v0 {"score":92.25531914893617,"minProper":0,"minImproper":0,"minFace":0,"minSame":4,"meanContradictions":12.26} → {"minProper":8,"minImproper":8,"minFace":2,"minSame":4}
 *   edge-m1s3sym-v0 N8(X0): timing v0 {"score":92.25531914893617,"minProper":0,"minImproper":0,"minFace":0,"minSame":4,"meanContradictions":12.26} → {"minProper":8,"minImproper":8,"minFace":2,"minSame":4}
 *   edge-all-v0 N8(X0): timing v0 {"score":92.25531914893617,"minProper":0,"minImproper":0,"minFace":0,"minSame":4,"meanContradictions":12.26} → {"minProper":8,"minImproper":8,"minFace":2,"minSame":4}
 *   edge-m1s3sym-v0 N10(X1): timing v0 {"score":1613.6170212765958,"minProper":8,"minImproper":8,"minFace":0,"minSame":0,"meanContradictions":13.62} → {"minProper":26,"minImproper":24,"minFace":8,"minSame":8}
 *   edge-all-v0 N10(X1): timing v0 {"score":1790.468085106383,"minProper":10,"minImproper":14,"minFace":0,"minSame":8,"meanContradictions":30.47} → {"minProper":26,"minImproper":20,"minFace":7,"minSame":8}
 *   edge-m1s3-v0 N10(X1): timing v0 {"score":407.74468085106383,"minProper":0,"minImproper":4,"minFace":0,"minSame":0,"meanContradictions":7.74} → {"minProper":0,"minImproper":8,"minFace":0,"minSame":0}
 */
export const X_FINDER_WORDS_V1_ID = 'search-v1';
export const X_FINDER_WORDS_V1_PROVENANCE = Object.freeze([
 {
  "base": "edge-m1s3-v0",
  "N": 8,
  "profileSearched": "X0",
  "seed": 7,
  "restarts": 30,
  "iters": 3000,
  "variableBits": 24,
  "baseline": {
   "score": 92.25531914893617,
   "minProper": 0,
   "minImproper": 0,
   "minFace": 0,
   "minSame": 4,
   "meanContradictions": 12.26
  },
  "best": {
   "minProper": 8,
   "minImproper": 8,
   "minFace": 2,
   "minSame": 4
  }
 },
 {
  "base": "edge-m1s3sym-v0",
  "N": 8,
  "profileSearched": "X0",
  "seed": 7,
  "restarts": 30,
  "iters": 3000,
  "variableBits": 24,
  "baseline": {
   "score": 92.25531914893617,
   "minProper": 0,
   "minImproper": 0,
   "minFace": 0,
   "minSame": 4,
   "meanContradictions": 12.26
  },
  "best": {
   "minProper": 8,
   "minImproper": 8,
   "minFace": 2,
   "minSame": 4
  }
 },
 {
  "base": "edge-all-v0",
  "N": 8,
  "profileSearched": "X0",
  "seed": 7,
  "restarts": 30,
  "iters": 3000,
  "variableBits": 24,
  "baseline": {
   "score": 92.25531914893617,
   "minProper": 0,
   "minImproper": 0,
   "minFace": 0,
   "minSame": 4,
   "meanContradictions": 12.26
  },
  "best": {
   "minProper": 8,
   "minImproper": 8,
   "minFace": 2,
   "minSame": 4
  }
 },
 {
  "base": "edge-m1s3sym-v0",
  "N": 10,
  "profileSearched": "X1",
  "seed": 7,
  "restarts": 30,
  "iters": 3000,
  "variableBits": 41,
  "baseline": {
   "score": 1613.6170212765958,
   "minProper": 8,
   "minImproper": 8,
   "minFace": 0,
   "minSame": 0,
   "meanContradictions": 13.62
  },
  "best": {
   "minProper": 26,
   "minImproper": 24,
   "minFace": 8,
   "minSame": 8
  }
 },
 {
  "base": "edge-all-v0",
  "N": 10,
  "profileSearched": "X1",
  "seed": 7,
  "restarts": 30,
  "iters": 3000,
  "variableBits": 41,
  "baseline": {
   "score": 1790.468085106383,
   "minProper": 10,
   "minImproper": 14,
   "minFace": 0,
   "minSame": 8,
   "meanContradictions": 30.47
  },
  "best": {
   "minProper": 26,
   "minImproper": 20,
   "minFace": 7,
   "minSame": 8
  }
 },
 {
  "base": "edge-m1s3-v0",
  "N": 10,
  "profileSearched": "X1",
  "seed": 7,
  "restarts": 30,
  "iters": 3000,
  "variableBits": 23,
  "baseline": {
   "score": 407.74468085106383,
   "minProper": 0,
   "minImproper": 4,
   "minFace": 0,
   "minSame": 0,
   "meanContradictions": 7.74
  },
  "best": {
   "minProper": 0,
   "minImproper": 8,
   "minFace": 0,
   "minSame": 0
  }
 }
]);
/** base finderId → N → [[siteId, bit], …] (siteId = (x·N+y)·N+z, 정렬 오름차순) */
export const X_FINDER_WORDS_V1 = Object.freeze({
  'edge-m1s3-v0': Object.freeze({ 8: Object.freeze([[2,0],[5,1],[16,1],[23,1],[40,0],[47,0],[58,1],[61,1],[128,0],[135,0],[184,1],[191,0],[320,0],[327,1],[376,0],[383,0],[450,1],[453,1],[464,1],[471,1],[488,1],[495,0],[506,0],[509,0]]), 10: Object.freeze([[2,0],[5,0],[20,0],[29,1],[50,1],[59,1],[92,0],[95,0],[200,0],[209,1],[290,1],[299,1],[500,0],[509,1],[590,0],[599,1],[902,0],[905,1],[920,1],[929,0],[950,0],[959,0],[992,1]]) }),
  'edge-m1s3sym-v0': Object.freeze({ 8: Object.freeze([[2,0],[5,1],[16,1],[23,1],[40,0],[47,0],[58,1],[61,1],[128,0],[135,0],[184,1],[191,0],[320,0],[327,1],[376,0],[383,0],[450,1],[453,1],[464,1],[471,1],[488,1],[495,0],[506,0],[509,0]]), 10: Object.freeze([[2,1],[4,1],[5,1],[20,0],[29,0],[40,1],[50,0],[59,0],[79,0],[92,0],[94,0],[95,0],[97,0],[200,0],[209,1],[290,1],[299,0],[400,1],[409,0],[490,0],[500,1],[509,1],[590,0],[599,0],[709,1],[790,1],[799,1],[902,0],[905,1],[907,1],[920,1],[929,0],[940,0],[949,1],[950,0],[959,0],[970,1],[979,0],[992,0],[994,1],[997,1]]) }),
  'edge-all-v0': Object.freeze({ 8: Object.freeze([[3,0],[4,1],[24,1],[31,1],[32,0],[39,0],[59,1],[60,1],[192,0],[199,0],[248,1],[255,0],[256,0],[263,1],[312,0],[319,0],[451,1],[452,1],[472,1],[479,1],[480,1],[487,0],[507,0],[508,0]]), 10: Object.freeze([[3,0],[4,1],[5,0],[6,1],[30,0],[39,1],[40,0],[50,1],[59,1],[60,0],[69,0],[93,0],[94,0],[95,0],[96,0],[300,0],[309,0],[399,1],[400,0],[409,1],[490,0],[500,0],[509,1],[590,0],[599,1],[600,1],[609,1],[690,0],[699,1],[903,0],[905,0],[906,0],[930,1],[940,0],[949,0],[950,1],[959,1],[969,0],[993,1],[994,0],[996,1]]) }),
});
