/**
 * proposal-ab.mjs — **경계 동등성 하네스** (PM/023 §4, W-2).
 *
 * WASM 포팅의 게이트다. 「WASM 과 JS 가 같은 답을 내는가」를 코퍼스 전수로 재되,
 * **원문이 아니라 경계를 건너는 값**을 비교한다.
 *
 * ⭐ 왜 원문이 아닌가 — ECC 가 차이를 덮는다. 포즈가 조금 달라도 RS 가 고쳐서
 * 원문은 같게 나올 수 있다. 그러면 「같다」는 판정이 **거짓 안심**이 된다.
 * 경계값을 직접 비교하는 것이 한 층 엄격하다.
 *
 * ⭐ 무엇이 «경계값» 인가 — 종전 계획(§2)은 digit 이었으나 W-1 실측(§11)이
 * 경계를 옮겼다: `enumerateGeometryHypotheses(luma) → hypotheses`.
 * 그게 실제로 경계를 건너는 값이므로 그걸 비교한다.
 *
 * ── 사용 ────────────────────────────────────────────────────────────────
 *   기준 만들기:   node tools/proposal-ab.mjs BASE
 *   대조:          node tools/proposal-ab.mjs WASM --impl <경로> --base out/BASE.json
 *   자가 시험:     node tools/proposal-ab.mjs SELFTEST --selftest
 *
 * `--impl` 은 `enumerateGeometryHypotheses(luma, familyEvidence, options)` 를
 * export 하는 모듈이면 된다 (WASM 래퍼가 그 모양을 맞추면 그대로 꽂힌다).
 *
 * ── ⚠ 자가 시험이 왜 필수인가 ──────────────────────────────────────────
 * **차이를 못 잡는 하네스는 초록이 무의미하다.** 이 저장소는 그 함정을 여러 번
 * 밟았다 — 감시 목록이 0개로 무너졌는데 테스트가 통과했고(2026-08-26), 코퍼스 자가
 * 어긋난 채 «전부 실패» 를 냈다. 그래서 `--selftest` 는 **일부러 흔든 구현**을 넣어
 * 하네스가 그것을 **잡는지** 본다. 안 잡히면 exit 5 로 죽는다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const label = argv[0];
if (!label || label.startsWith('--')) {
  console.error('사용: node tools/proposal-ab.mjs <라벨> [--impl p] [--base p] [--out p] [--limit N] [--selftest]');
  process.exit(2);
}
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes('--' + name);

const implPath = resolve(flag('impl', join(REPO, 'src', 'decoder', 'bootstrap.js')));
const outPath = resolve(flag('out', join(REPO, 'test', 'output', 'proposal-ab', label + '.json')));
const basePath = flag('base', '');
const limit = Number(flag('limit', 0)) || 0;

const { listLumaDumps, readLumaDump, lumaToRaster } =
  await import(pathToFileURL(join(REPO, 'tools', 'read-luma.mjs')).href);
const { toRelativeLuminance } =
  await import(pathToFileURL(join(REPO, 'src', 'decoder', 'luma.js')).href);
const impl = await import(pathToFileURL(implPath).href);
if (typeof impl.enumerateGeometryHypotheses !== 'function') {
  console.error(`✗ ${implPath} 가 enumerateGeometryHypotheses 를 export 하지 않는다`);
  process.exit(2);
}

/*
 * 비교 대상 — 「경계를 건너는 값」에서 **의미 있는 부분만** 고른다.
 *
 * ⚠ 여기 무엇을 넣고 무엇을 빼는지가 이 하네스의 전부다.
 *   · 넣는다: 포즈를 정하는 값 (family·k·orientation·turn·H) + 그 포즈를 고르게 만든
 *     증거 점수 (score·anchorMargin·geometryResidual·hardChecks).
 *   · 뺀다: 진단 카운터·문자열 id 처럼 **선택에 영향이 없는** 것. 넣으면 무해한 확장이
 *     회귀로 보인다 (2026-08-26 에 실제로 그 구분이 판정을 갈랐다).
 * H 는 Float64Array 라 그대로는 JSON 이 안 된다 — 배열로 편다.
 */
function digestHypothesis(h) {
  return {
    family: h.family,
    k: h.k,
    n: h.n,
    orientation: h.orientation,
    turn: h.turn === true,
    centerQr: h.centerQr === true,
    source: h.source,
    H: Array.from(h.H || []),
    score: h.score,
    anchorMargin: h.anchorMargin,
    geometryResidual: h.geometryResidual,
    hardChecks: h.hardChecks,
  };
}

/*
 * 동률 근방 — §4 가 «부동소수 차이가 드러나는 유일한 자리» 라 부른 곳.
 * 앵커 측정의 면 분리(separation)가 tieEpsilon 근처인 셀을 따로 센다.
 * WASM 과 JS 가 여기서 갈리면 **순위가 뒤집혀** 조용히 다른 답이 된다.
 */
const TIE_EPSILON = 0.02;
const TIE_BAND = 0.01; // ε 를 중심으로 이 폭 안이면 «근방»

function tieNeighborhood(h) {
  const out = [];
  for (const m of h.measurements || []) {
    const sep = m.separation;
    if (!Number.isFinite(sep)) continue;
    if (Math.abs(sep - TIE_EPSILON) <= TIE_BAND) {
      out.push({ q: m.canonical?.q, r: m.canonical?.r, sep: Number(sep.toFixed(6)), tie: m.tie === true });
    }
  }
  return out;
}

const dumps = listLumaDumps();
if (dumps.length === 0) {
  console.error('✗ 휘도 덤프 0건 — 워크트리면 test/output/photos 에 정션을 붙여라.');
  process.exit(3);
}
const picked = limit > 0 ? dumps.slice(0, limit) : dumps;
console.log(`덤프 ${picked.length}건 (전체 ${dumps.length}) · impl = ${implPath}`);

function runOne(raster) {
  const luma = toRelativeLuminance(raster, {});
  if (luma && luma.ok === false) return { ok: false, reason: 'luma', hyp: [], tie: [] };
  let g;
  try {
    g = impl.enumerateGeometryHypotheses(luma, undefined, {});
  } catch (err) {
    return { ok: false, reason: 'THROW:' + (err?.message ?? '?'), hyp: [], tie: [] };
  }
  if (!g || !g.ok) return { ok: false, reason: String(g?.reason?.code ?? g?.reason ?? 'no-ok'), hyp: [], tie: [] };
  const hs = g.hypotheses || [];
  return {
    ok: true,
    reason: null,
    hyp: hs.map(digestHypothesis),
    tie: hs.flatMap(tieNeighborhood),
  };
}

const rows = [];
for (const { name, path } of picked) {
  const raster = lumaToRaster(readLumaDump(path));
  const t0 = process.hrtime.bigint();
  const r = runOne(raster);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  rows.push({ name, ok: r.ok, reason: r.reason, count: r.hyp.length, hyp: r.hyp, tie: r.tie, ms });
  process.stdout.write(r.ok ? '.' : 'x');
}
process.stdout.write('\n');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(rows, null, 0));
const okCount = rows.filter((r) => r.ok).length;
const totalMs = rows.reduce((s, r) => s + r.ms, 0);
console.log(`[${label}] 가설 선 장 ${okCount}/${rows.length} · 합계 ${(totalMs / 1000).toFixed(1)}s → ${outPath}`);

// ── 대조 ────────────────────────────────────────────────────────────────
function compare(baseRows, headRows, tag) {
  const base = new Map(baseRows.map((r) => [r.name, r]));
  const flips = { dead: 0, revived: 0, count: 0, pose: 0, tie: 0 };
  const examples = [];
  let shared = 0;
  for (const h of headRows) {
    const b = base.get(h.name);
    if (!b) continue;
    shared += 1;
    if (b.ok && !h.ok) { flips.dead += 1; examples.push(`죽음 ${h.name}: ${h.reason}`); continue; }
    if (!b.ok && h.ok) { flips.revived += 1; continue; }
    if (!b.ok && !h.ok) continue;
    if (b.count !== h.count) {
      flips.count += 1;
      examples.push(`가설수 ${h.name}: ${b.count} → ${h.count}`);
    }
    // 포즈 동일성 — 순서까지 같아야 한다 (선택기가 순서에 기댄다).
    const bs = JSON.stringify(b.hyp);
    const hs = JSON.stringify(h.hyp);
    if (bs !== hs) {
      flips.pose += 1;
      if (examples.length < 12) examples.push(`포즈 ${h.name}`);
    }
    if (JSON.stringify(b.tie) !== JSON.stringify(h.tie)) {
      flips.tie += 1;
      if (examples.length < 12) examples.push(`동률근방 ${h.name}`);
    }
  }
  console.log(`\n  ${tag}`);
  console.log(`    교집합      ${shared}`);
  console.log(`    죽음 플립   ${flips.dead}`);
  console.log(`    소생 플립   ${flips.revived}`);
  console.log(`    가설수 차이 ${flips.count}`);
  console.log(`    포즈 차이   ${flips.pose}`);
  console.log(`    동률근방 차 ${flips.tie}`);
  for (const e of examples.slice(0, 8)) console.log(`      · ${e}`);
  return flips;
}

let exitCode = 0;
if (basePath) {
  const p = resolve(basePath);
  if (!existsSync(p)) { console.error(`✗ 기준 없음: ${p}`); process.exit(2); }
  const flips = compare(JSON.parse(readFileSync(p, 'utf8')), rows, `기준 ${p}`);
  const pass = flips.dead === 0 && flips.pose === 0 && flips.tie === 0 && flips.count === 0;
  console.log(pass ? '  ✓ 경계 동등' : '  ✗ 경계가 갈렸다');
  if (!pass) exitCode = 1;
}

/*
 * ── 자가 시험 ──────────────────────────────────────────────────────────
 * 하네스가 **차이를 잡는지** 본다. 잡아야 할 것을 못 잡으면 이 하네스로 잰
 * 모든 초록이 무의미하므로 exit 5 로 죽는다.
 *
 * 흔드는 법: 같은 결과에서 한 가설의 H 한 칸을 **1 ulp 수준**으로 민다.
 * 그 정도도 못 잡으면 부동소수 차이를 절대 못 잡는다.
 */
if (has('selftest')) {
  console.log('\n── 자가 시험 (하네스가 차이를 잡는가) ──');
  const withPose = rows.find((r) => r.ok && r.hyp.length > 0);
  if (!withPose) {
    console.error('✗ 가설이 선 장이 없어 자가 시험을 못 한다 — 표본을 늘려라');
    process.exit(5);
  }
  const checks = [];

  // ① H 를 1 ulp 민다
  {
    const perturbed = JSON.parse(JSON.stringify(rows));
    const row = perturbed.find((r) => r.name === withPose.name);
    const before = row.hyp[0].H[0];
    row.hyp[0].H[0] = before + Math.abs(before) * Number.EPSILON;
    const f = compare(rows, perturbed, '① H 1 ulp 흔들기');
    checks.push(['H 1 ulp', f.pose > 0]);
  }
  // ② 가설을 하나 뺀다
  {
    const perturbed = JSON.parse(JSON.stringify(rows));
    const row = perturbed.find((r) => r.name === withPose.name);
    row.hyp.pop();
    row.count -= 1;
    const f = compare(rows, perturbed, '② 가설 하나 제거');
    checks.push(['가설 수', f.count > 0]);
  }
  // ③ 성공을 실패로 뒤집는다
  {
    const perturbed = JSON.parse(JSON.stringify(rows));
    const row = perturbed.find((r) => r.name === withPose.name);
    row.ok = false; row.reason = 'SELFTEST'; row.hyp = []; row.tie = [];
    const f = compare(rows, perturbed, '③ 성공 → 실패');
    checks.push(['죽음 플립', f.dead > 0]);
  }

  console.log('\n  자가 시험 판정');
  let bad = 0;
  for (const [name, caught] of checks) {
    console.log(`    ${caught ? '✓' : '✗'} ${name} — ${caught ? '잡았다' : '**못 잡았다**'}`);
    if (!caught) bad += 1;
  }
  if (bad > 0) {
    console.error(`\n✗ 하네스가 ${bad}종을 못 잡는다. 이 자로 잰 초록은 무의미하다.`);
    process.exit(5);
  }
  console.log('  ✓ 셋 다 잡는다 — 이 하네스의 초록은 의미가 있다');
}

process.exit(exitCode);
