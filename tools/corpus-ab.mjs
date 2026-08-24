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
 *   --expect <N>       기대 덤프 수 (기본 367). 어긋나면 즉시 죽는다.
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
const expect = Number(flag('expect', '367'));
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
const missing = rows.filter((r) => !base.has(r.name));
if (missing.length) {
  console.error(`✗ 기준에 없는 행 ${missing.length}건 — 같은 코퍼스가 아니다.`);
  process.exit(3);
}

const died = rows.filter((r) => !r.ok && base.get(r.name).ok);
const revived = rows.filter((r) => r.ok && !base.get(r.name).ok);
const textFlip = rows.filter((r) => r.ok && base.get(r.name).ok && r.text !== base.get(r.name).text);
const famFlip = rows.filter((r) => r.ok && base.get(r.name).ok && r.family !== base.get(r.name).family);
const baseOk = [...base.values()].filter((r) => r.ok).length;
const baseMs = [...base.values()].reduce((a, r) => a + r.ms, 0);

console.log('');
console.log(`기준 ${resolvedBase}`);
console.log(`  ok        ${baseOk}/${base.size}  →  ${okCount}/${rows.length}`);
console.log(`  죽음 플립  ${died.length}`);
console.log(`  소생 플립  ${revived.length}`);
console.log(`  원문 플립  ${textFlip.length}`);
console.log(`  패밀리플립 ${famFlip.length}`);
console.log(`  시간       ${(totalMs / baseMs).toFixed(2)}×`);
for (const r of died) console.log(`  † ${r.name}  (${r.reason})`);
for (const r of textFlip) console.log(`  ≠ ${r.name}  "${base.get(r.name).text}" → "${r.text}"`);

// 게이트: 죽음 플립·원문 플립은 0 이어야 한다. 완화 금지.
if (died.length || textFlip.length) {
  console.error('✗ 게이트 실패');
  process.exit(1);
}
console.log('✓ 게이트 통과 (죽음 0 · 원문 플립 0)');
