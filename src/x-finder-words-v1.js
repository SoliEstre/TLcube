/**
 * x-finder-words-v1 — 파인더 워드 값 표(연구, rd-3 · 잠금 아님). 사이트 집합·예약·용량은 base 패턴(x-finder.js)과 같고 워드 슬롯의 «레벨» 만 이 표로 바뀌어요.
 *
 * 출처: .agent/lanes/type-x-core-20260919/rd3/finder-word-search.mjs — 목적 = F 지도(실효 구조, 'd' 는 세지 않음)에서 proper 비항등 23 변환의 최소 고정 비트 모순 · improper 24 최소 ·
 * 바깥 법선 면 경계 읽기 24 개의 다른 면 최소 · 같은 면 최소 — cap 8 가중합(100·min(①,8)+100·min(②,8)+30·min(③,8)+20·min(④,8)) + 평균 모순 tie-break(비보장; 사전순 아님, codex 0400). lee-fo 프로파일(N8 = X0, N10 = X1)에서 탐색한 표를 N 별로 채택했어요(mulberry32 seed 7 · 30 재시작 × 3000 반복).
 * 중심 위 워드 슬롯은 표에 없어도 실효 1(상시 on) 로 덮여요. 표에 없는 워드 슬롯이 남으면 x-profile 이 거절해요(조용한 타이밍 대체 없음). 표는 deep-freeze 이고 x-finder 가 닫힌 표 검증(범위·bit·중복·워드 슬롯 소속)을 해요.
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
  'edge-m1s3-v0': Object.freeze({ 8: Object.freeze([Object.freeze([2,0]),Object.freeze([5,1]),Object.freeze([16,1]),Object.freeze([23,1]),Object.freeze([40,0]),Object.freeze([47,0]),Object.freeze([58,1]),Object.freeze([61,1]),Object.freeze([128,0]),Object.freeze([135,0]),Object.freeze([184,1]),Object.freeze([191,0]),Object.freeze([320,0]),Object.freeze([327,1]),Object.freeze([376,0]),Object.freeze([383,0]),Object.freeze([450,1]),Object.freeze([453,1]),Object.freeze([464,1]),Object.freeze([471,1]),Object.freeze([488,1]),Object.freeze([495,0]),Object.freeze([506,0]),Object.freeze([509,0])]), 10: Object.freeze([Object.freeze([2,0]),Object.freeze([5,0]),Object.freeze([20,0]),Object.freeze([29,1]),Object.freeze([50,1]),Object.freeze([59,1]),Object.freeze([92,0]),Object.freeze([95,0]),Object.freeze([200,0]),Object.freeze([209,1]),Object.freeze([290,1]),Object.freeze([299,1]),Object.freeze([500,0]),Object.freeze([509,1]),Object.freeze([590,0]),Object.freeze([599,1]),Object.freeze([902,0]),Object.freeze([905,1]),Object.freeze([920,1]),Object.freeze([929,0]),Object.freeze([950,0]),Object.freeze([959,0]),Object.freeze([992,1])]) }),
  'edge-m1s3sym-v0': Object.freeze({ 8: Object.freeze([Object.freeze([2,0]),Object.freeze([5,1]),Object.freeze([16,1]),Object.freeze([23,1]),Object.freeze([40,0]),Object.freeze([47,0]),Object.freeze([58,1]),Object.freeze([61,1]),Object.freeze([128,0]),Object.freeze([135,0]),Object.freeze([184,1]),Object.freeze([191,0]),Object.freeze([320,0]),Object.freeze([327,1]),Object.freeze([376,0]),Object.freeze([383,0]),Object.freeze([450,1]),Object.freeze([453,1]),Object.freeze([464,1]),Object.freeze([471,1]),Object.freeze([488,1]),Object.freeze([495,0]),Object.freeze([506,0]),Object.freeze([509,0])]), 10: Object.freeze([Object.freeze([2,1]),Object.freeze([4,1]),Object.freeze([5,1]),Object.freeze([20,0]),Object.freeze([29,0]),Object.freeze([40,1]),Object.freeze([50,0]),Object.freeze([59,0]),Object.freeze([79,0]),Object.freeze([92,0]),Object.freeze([94,0]),Object.freeze([95,0]),Object.freeze([97,0]),Object.freeze([200,0]),Object.freeze([209,1]),Object.freeze([290,1]),Object.freeze([299,0]),Object.freeze([400,1]),Object.freeze([409,0]),Object.freeze([490,0]),Object.freeze([500,1]),Object.freeze([509,1]),Object.freeze([590,0]),Object.freeze([599,0]),Object.freeze([709,1]),Object.freeze([790,1]),Object.freeze([799,1]),Object.freeze([902,0]),Object.freeze([905,1]),Object.freeze([907,1]),Object.freeze([920,1]),Object.freeze([929,0]),Object.freeze([940,0]),Object.freeze([949,1]),Object.freeze([950,0]),Object.freeze([959,0]),Object.freeze([970,1]),Object.freeze([979,0]),Object.freeze([992,0]),Object.freeze([994,1]),Object.freeze([997,1])]) }),
  'edge-all-v0': Object.freeze({ 8: Object.freeze([Object.freeze([3,0]),Object.freeze([4,1]),Object.freeze([24,1]),Object.freeze([31,1]),Object.freeze([32,0]),Object.freeze([39,0]),Object.freeze([59,1]),Object.freeze([60,1]),Object.freeze([192,0]),Object.freeze([199,0]),Object.freeze([248,1]),Object.freeze([255,0]),Object.freeze([256,0]),Object.freeze([263,1]),Object.freeze([312,0]),Object.freeze([319,0]),Object.freeze([451,1]),Object.freeze([452,1]),Object.freeze([472,1]),Object.freeze([479,1]),Object.freeze([480,1]),Object.freeze([487,0]),Object.freeze([507,0]),Object.freeze([508,0])]), 10: Object.freeze([Object.freeze([3,0]),Object.freeze([4,1]),Object.freeze([5,0]),Object.freeze([6,1]),Object.freeze([30,0]),Object.freeze([39,1]),Object.freeze([40,0]),Object.freeze([50,1]),Object.freeze([59,1]),Object.freeze([60,0]),Object.freeze([69,0]),Object.freeze([93,0]),Object.freeze([94,0]),Object.freeze([95,0]),Object.freeze([96,0]),Object.freeze([300,0]),Object.freeze([309,0]),Object.freeze([399,1]),Object.freeze([400,0]),Object.freeze([409,1]),Object.freeze([490,0]),Object.freeze([500,0]),Object.freeze([509,1]),Object.freeze([590,0]),Object.freeze([599,1]),Object.freeze([600,1]),Object.freeze([609,1]),Object.freeze([690,0]),Object.freeze([699,1]),Object.freeze([903,0]),Object.freeze([905,0]),Object.freeze([906,0]),Object.freeze([930,1]),Object.freeze([940,0]),Object.freeze([949,0]),Object.freeze([950,1]),Object.freeze([959,1]),Object.freeze([969,0]),Object.freeze([993,1]),Object.freeze([994,0]),Object.freeze([996,1])]) }),
});
