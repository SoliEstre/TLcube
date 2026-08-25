/**
 * corpus-ab.mjs — 실사진 휘도 덤프 전수 코퍼스 A/B 러너 (이식 가능판)
 *
 * 레인마다 절대경로를 박은 임시 스크립트(kcm-ab.mjs 등)를 만들어 쓰던 것을
 * 하나로 승격한 것. 원격 머신에서도 그대로 돈다.
 *
 *   node tools/corpus-ab.mjs <라벨> [옵션]
 *
 *   --frontend <경로>  비교할 decodeFrontend 구현 (기본: 이 트리의 src/decoder/frontend.js)
 *   --out <경로>       행 JSON 출력 (기본: test/output/corpus-ab/<라벨>.json)
 *   --base <경로>      기준 JSON. 주면 A/B 차이를 내고 죽음 플립이 있으면 exit 1
 *   --expect <N>       기대 덤프 수. **기본값은 손 상수가 아니라**
 *                      `test/photo-corpus-fingerprint.json` 의 행 수에서 유도한다
 *                      (그 파일이 코퍼스 자의 정본이다 — F-105 규율).
 *                      ⚠ 명시로 낮춰서 통과시키지 마라. listLumaDumps() 는 덤프
 *                      디렉토리가 없으면 조용히 빈 배열을 주므로 «0/0 전부 통과»
 *                      라는 거짓 초록이 열린다.
 *                      ⭐ 2026-08-25: 종전엔 여기 `379` 가 박혀 있었고 그 값이
 *                      네 곳에 흩어져 있었다. 코퍼스가 379 → 433 으로 자라자
 *                      **넷을 다 손으로 올려야 했다** — 그게 사본 목록이 썩는
 *                      방식이다. 이제 둘(여기 · run-corpus.ps1)은 유도한다.
 *
 * 코퍼스가 **자라는 것**은 정상이다 (사진이 추가된다). 그래서 --base 대조는
 * 「기준 행이 빠졌나」만 거부하고, 늘어난 행은 교집합 밖으로 빼서 따로 보고한다 —
 * 둘을 한 조건으로 묶어 죽이면 사진을 추가할 때마다 게이트가 막히고, 그러면
 * 사람이 게이트를 우회한다. 그게 게이트가 죽는 방식이다.
 *   --opts <JSON>      decodeFrontend 두 번째 인자 (기본 {})
 *
 * ⚠ --expect 는 장식이 아니다. listLumaDumps() 는 덤프 디렉토리가 없으면 조용히
 *   빈 배열을 준다 — 그러면 "0/0 전부 통과"라는 거짓 초록이 나온다. 워크트리에서
 *   실제로 세 번 밟은 자리라, 개수 단언을 게이트로 박아 둔다.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ── 인자 ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const label = argv[0];
if (!label || label.startsWith('--')) {
  console.error('사용: node tools/corpus-ab.mjs <라벨> [--frontend p] [--out p] [--base p] [--expect N] [--opts JSON]');
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const frontendPath = resolve(flag('frontend', join(REPO, 'src', 'decoder', 'frontend.js')));
const outPath = resolve(flag('out', join(REPO, 'test', 'output', 'corpus-ab', `${label}.json`)));
const basePath = flag('base', null);
/** 코퍼스 자의 정본 — 지문 JSON 의 행 수. 못 읽으면 «모른다» 로 죽는다
 *  (임의 기본값을 지어내면 그 순간 다섯 번째 사본이 된다). */
function fingerprintCount() {
  const path = join(REPO, 'test', 'photo-corpus-fingerprint.json');
  if (!existsSync(path)) return null;
  try {
    // 지문 JSON 은 `{ _note, count, digest }` 다 — 행 목록이 아니라 **수와 다이제스트**만
    // 담는다 (목록을 담으면 그 자체가 또 하나의 사본이 된다). count 를 그대로 쓴다.
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Number.isInteger(parsed?.count) ? parsed.count : null;
  } catch {
    return null;
  }
}

const expectFlag = flag('expect', null);
const derived = expectFlag === null ? fingerprintCount() : null;
if (expectFlag === null && derived === null) {
  console.error('✗ 기대 덤프 수를 모른다 — 지문 JSON 을 못 읽었고 --expect 도 없다.');
  console.error('  자를 모르는 채로 재면 «0/0 전부 통과» 거짓 초록이 열린다.');
  process.exit(3);
}
const expect = Number(expectFlag ?? derived);
const decodeOpts = JSON.parse(flag('opts', '{}'));

// ── 재료 ──────────────────────────────────────────────────────────
const { listLumaDumps, readLumaDump, lumaToRaster } =
  await import(pathToFileURL(join(REPO, 'tools', 'read-luma.mjs')).href);
if (!existsSync(frontendPath)) {
  console.error(`frontend 없음: ${frontendPath}`);
  process.exit(2);
}
const { decodeFrontend } = await import(pathToFileURL(frontendPath).href);

const dumps = listLumaDumps();
if (dumps.length !== expect) {
  console.error(`✗ 덤프 ${dumps.length}건 — 기대 ${expect}건. 자가 어긋났으니 측정하지 않는다.`);
  console.error('  워크트리라면 test/output/photos 에 정션을 붙여라 (덤프는 메인 트리에만 있다).');
  process.exit(3);
}
console.log(`덤프 ${dumps.length}건 · frontend = ${frontendPath}`);

// ── 측정 ──────────────────────────────────────────────────────────
const rows = [];
for (const { name, path } of dumps) {
  const raster = lumaToRaster(readLumaDump(path));
  const t0 = process.hrtime.bigint();
  let result;
  try {
    result = decodeFrontend(raster, decodeOpts);
  } catch (err) {
    result = { ok: false, reason: { code: `THROW:${err?.message ?? 'unknown'}` } };
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  rows.push({
    name,
    ok: Boolean(result.ok),
    text: result.ok ? (result.text ?? null) : null,
    family: result.ok ? (result.family ?? null) : null,
    hyp: result.ok ? (result.hypothesis?.id ?? null) : null,
    reason: result.ok ? null : (typeof result.reason === 'string' ? result.reason : result.reason?.code ?? null),
    ms: Math.round(ms),
  });
  process.stdout.write(result.ok ? '.' : 'x');
}
process.stdout.write('\n');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(rows), 'utf8');

const okCount = rows.filter((r) => r.ok).length;
const totalMs = rows.reduce((a, r) => a + r.ms, 0);
console.log(`[${label}] ok ${okCount}/${rows.length} · 합계 ${Math.round(totalMs / 1000)}s → ${outPath}`);

// ── A/B ───────────────────────────────────────────────────────────
if (!basePath) process.exit(0);

const resolvedBase = resolve(basePath);
if (!existsSync(resolvedBase)) {
  console.error(`기준 JSON 없음: ${resolvedBase}`);
  process.exit(2);
}
const base = new Map(JSON.parse(readFileSync(resolvedBase, 'utf8')).map((r) => [r.name, r]));

// ⚠ «다르다» 에는 두 종류가 있다 (2026-08-25, 코퍼스 367 → 379 로 자라며 배움):
//   (가) **기준 행이 빠졌다** — 진짜 다른 코퍼스다. 대조 자체가 무의미하니 죽는다.
//   (나) **행이 늘었다** — 코퍼스가 자란 것이다. 기준 교집합에서 무회귀를 증명할
//        수 있고, 신규 행은 따로 보고하면 된다.
// 둘을 한 조건으로 묶어 죽이면 «사진을 추가할 때마다 게이트가 막히는» 상태가 되고,
// 그러면 사람이 게이트를 우회하게 된다 — 그게 게이트가 죽는 방식이다.
const droppedFromBase = [...base.keys()].filter((name) => !rows.some((r) => r.name === name));
if (droppedFromBase.length) {
  console.error(`✗ 기준 행 ${droppedFromBase.length}건이 이번 실행에 없다 — 자란 것이 아니라 다른 코퍼스다.`);
  for (const name of droppedFromBase.slice(0, 5)) console.error(`   - ${name}`);
  process.exit(3);
}
const addedRows = rows.filter((r) => !base.has(r.name));
const commonRows = rows.filter((r) => base.has(r.name));

// 플립은 **교집합에서만** 잰다 — 신규 행은 기준이 없어 비교 대상이 아니다.
const died = commonRows.filter((r) => !r.ok && base.get(r.name).ok);
const revived = commonRows.filter((r) => r.ok && !base.get(r.name).ok);
const textFlip = commonRows.filter((r) => r.ok && base.get(r.name).ok && r.text !== base.get(r.name).text);
const famFlip = commonRows.filter((r) => r.ok && base.get(r.name).ok && r.family !== base.get(r.name).family);
const baseOk = [...base.values()].filter((r) => r.ok).length;
const baseMs = [...base.values()].reduce((a, r) => a + r.ms, 0);
const commonOk = commonRows.filter((r) => r.ok).length;

console.log('');
console.log(`기준 ${resolvedBase}`);
console.log(`  ok        ${baseOk}/${base.size}  →  ${commonOk}/${commonRows.length}   (교집합)`);
console.log(`  죽음 플립  ${died.length}`);
console.log(`  소생 플립  ${revived.length}`);
console.log(`  원문 플립  ${textFlip.length}`);
console.log(`  패밀리플립 ${famFlip.length}`);
console.log(`  시간       ${(totalMs / baseMs).toFixed(2)}×`);
for (const r of died) console.log(`  † ${r.name}  (${r.reason})`);
for (const r of textFlip) console.log(`  ≠ ${r.name}  "${base.get(r.name).text}" → "${r.text}"`);

// 신규 행은 **따로** 보고한다 — 기준이 없으니 플립 계산에 못 들어가지만,
// 안 적으면 «코퍼스가 자랐다» 는 사실이 화면에서 사라진다.
if (addedRows.length) {
  const addedOk = addedRows.filter((r) => r.ok).length;
  console.log('');
  console.log(`신규 ${addedRows.length}행 (기준에 없던 프레임) — ok ${addedOk}/${addedRows.length}`);
  for (const r of addedRows) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}  ${r.ok ? '' : r.reason}`);
  }
  console.log('');
  console.log('⚠ 신규 행은 무회귀 게이트의 대상이 아니다. 기준선을 새로 뜨려면');
  console.log('   --base 없이 한 번 돌려 새 BASE 를 만든다.');
}

// 게이트: 죽음 플립·원문 플립은 0 이어야 한다. 완화 금지.
if (died.length || textFlip.length) {
  console.error('✗ 게이트 실패');
  process.exit(1);
}
console.log('✓ 게이트 통과 (죽음 0 · 원문 플립 0)');
