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
 *   --shards <N>       워커 수 (기본: 논리 CPU − 2, 최소 1). 장별 decodeFrontend 는
 *                      완전 독립이라 worker_threads N개가 동적 큐로 나눠 돈다.
 *                      `--shards 1` 은 워커 없이 종전 순차 경로 그대로다.
 *                      병합 출력은 **덤프명 정렬**이라 샤드 수·완료 순서와 무관하게
 *                      결정적이고, 행 집합·내용(ms 제외)은 순차 실행과 동일하다.
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
 *   --opts <JSON>      decodeFrontend 두 번째 인자 (기본 {})
 *
 * 코퍼스가 **자라는 것**은 정상이다 (사진이 추가된다). 그래서 --base 대조는
 * 「기준 행이 빠졌나」만 거부하고, 늘어난 행은 교집합 밖으로 빼서 따로 보고한다 —
 * 둘을 한 조건으로 묶어 죽이면 사진을 추가할 때마다 게이트가 막히고, 그러면
 * 사람이 게이트를 우회한다. 그게 게이트가 죽는 방식이다.
 *
 * ⚠ --expect 는 장식이 아니다. listLumaDumps() 는 덤프 디렉토리가 없으면 조용히
 *   빈 배열을 준다 — 그러면 "0/0 전부 통과"라는 거짓 초록이 나온다. 워크트리에서
 *   실제로 세 번 밟은 자리라, 개수 단언을 게이트로 박아 둔다.
 *
 * ── 시간 수치의 의미 (2026-08-30, 병렬화하며 확정) ─────────────────────
 * `ms` 는 **워커 안에서 잰 장별 복호 시간**이다. 병렬 샤드에서는 SMT·메모리
 * 대역 경합으로 장당 수치가 순차 실행보다 부푼다. 따라서:
 *   - 행 합계(`장별 ms 합`) ≈ 총 CPU 시간. **벽시계가 아니다** — 벽시계는 요약에
 *     따로 찍는다.
 *   - A/B 의 `시간 X.XX×` 는 양쪽 행 합계의 비율이다. **같은 --shards 로 돌린
 *     실행끼리만 의미가 있다** — 순차 기준선 vs 샤드 실행의 비는 경합 부풀림이
 *     섞여 참고용이다. 시간 A/B 가 목적이면 양쪽을 --shards 1 로 돌려라.
 *   - 게이트(exit 코드)는 시간을 보지 않는다 — 죽음·원문 플립만 본다. 불변.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/** 장 하나를 재서 행으로. 순차 경로와 워커가 **같은 함수**를 쓴다 —
 *  두 경로의 행 내용이 갈라질 자리를 구조적으로 없앤다. */
function measureRow(decodeFrontend, lumaToRaster, readLumaDump, decodeOpts, { name, path }) {
  const raster = lumaToRaster(readLumaDump(path));
  const t0 = process.hrtime.bigint();
  let result;
  try {
    result = decodeFrontend(raster, decodeOpts);
  } catch (err) {
    result = { ok: false, reason: { code: `THROW:${err?.message ?? 'unknown'}` } };
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return {
    name,
    ok: Boolean(result.ok),
    text: result.ok ? (result.text ?? null) : null,
    family: result.ok ? (result.family ?? null) : null,
    hyp: result.ok ? (result.hypothesis?.id ?? null) : null,
    reason: result.ok ? null : (typeof result.reason === 'string' ? result.reason : result.reason?.code ?? null),
    ms: Math.round(ms),
  };
}

// ── 워커 본체 ─────────────────────────────────────────────────────
// 같은 파일이 워커로도 뜬다 (이식 가능판 유지 — 배포 파일은 여전히 하나).
// 워커별 모듈 로드는 독립이라 안전하다 — decodeFrontend 는 장별로 완전 독립.
if (!isMainThread) {
  const { frontendPath, decodeOpts } = workerData;
  const { readLumaDump, lumaToRaster } =
    await import(pathToFileURL(join(REPO, 'tools', 'read-luma.mjs')).href);
  const { decodeFrontend } = await import(pathToFileURL(frontendPath).href);
  parentPort.on('message', (job) => {
    if (job === null) {
      parentPort.close();
      return;
    }
    parentPort.postMessage(measureRow(decodeFrontend, lumaToRaster, readLumaDump, decodeOpts, job));
  });
  parentPort.postMessage('ready');
} else {
  await main();
}

async function main() {
  // ── 인자 ──────────────────────────────────────────────────────────
  const argv = process.argv.slice(2);
  const label = argv[0];
  if (!label || label.startsWith('--')) {
    console.error('사용: node tools/corpus-ab.mjs <라벨> [--frontend p] [--out p] [--base p] [--shards N] [--expect N] [--opts JSON]');
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

  const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const shardsFlag = flag('shards', null);
  const shardsRaw = shardsFlag === null ? Math.max(1, cpuCount - 2) : Number(shardsFlag);
  if (!Number.isInteger(shardsRaw) || shardsRaw < 1) {
    console.error(`✗ --shards 는 1 이상의 정수여야 한다: ${shardsFlag}`);
    process.exit(2);
  }

  // ── 재료 ──────────────────────────────────────────────────────────
  const { listLumaDumps, readLumaDump, lumaToRaster } =
    await import(pathToFileURL(join(REPO, 'tools', 'read-luma.mjs')).href);
  if (!existsSync(frontendPath)) {
    console.error(`frontend 없음: ${frontendPath}`);
    process.exit(2);
  }
  // 샤드 실행이어도 메인에서 한 번 로드한다 — 깨진 모듈이면 워커를 띄우기 전에,
  // 종전 순차 러너와 같은 모양으로 죽는다.
  const { decodeFrontend } = await import(pathToFileURL(frontendPath).href);

  const dumps = listLumaDumps();
  if (dumps.length !== expect) {
    console.error(`✗ 덤프 ${dumps.length}건 — 기대 ${expect}건. 자가 어긋났으니 측정하지 않는다.`);
    console.error('  워크트리라면 test/output/photos 에 정션을 붙여라 (덤프는 메인 트리에만 있다).');
    process.exit(3);
  }
  // 하한 1 — 덤프 0건(--expect 0 명시)이어도 순차 빈 루프로 내려가 구판처럼
  // 빈 출력을 낸다 (워커 0개면 완료 신호가 없어 매달린다).
  const shardCount = Math.max(1, Math.min(shardsRaw, dumps.length));
  console.log(`덤프 ${dumps.length}건 · frontend = ${frontendPath}`);
  console.log(`샤드 ${shardCount} (논리 CPU ${cpuCount}${shardsFlag === null ? ' · 기본 CPU−2' : ''})`);

  // ── 측정 ──────────────────────────────────────────────────────────
  const wallT0 = process.hrtime.bigint();
  const rows = shardCount === 1
    ? runSequential(dumps, decodeFrontend, lumaToRaster, readLumaDump, decodeOpts)
    : await runSharded(dumps, shardCount, frontendPath, decodeOpts);
  const wallMs = Number(process.hrtime.bigint() - wallT0) / 1e6;
  process.stdout.write('\n');

  // 병합 자기 검증 — 워커 경로가 행을 흘리거나 겹치면 여기서 죽는다.
  // (dumps 와 병합 결과가 같은 비교자로 정렬돼 있으므로 index 대조가 집합 동일성이다.)
  rows.sort((left, right) => (left.name < right.name ? -1 : 1));
  if (rows.length !== dumps.length || rows.some((r, i) => r.name !== dumps[i].name)) {
    console.error(`✗ 병합 행 ${rows.length}건이 덤프 목록과 안 맞는다 — 러너 내부 결함이다. 출력을 버린다.`);
    process.exit(2);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(rows), 'utf8');

  const okCount = rows.filter((r) => r.ok).length;
  const totalMs = rows.reduce((a, r) => a + r.ms, 0);
  console.log(`[${label}] ok ${okCount}/${rows.length} · 장별 ms 합 ${Math.round(totalMs / 1000)}s · 벽시계 ${Math.round(wallMs / 1000)}s · 샤드 ${shardCount} → ${outPath}`);

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
  console.log(`  시간       ${(totalMs / baseMs).toFixed(2)}×  (장별 ms 합 기준)`);
  if (shardCount !== 1) {
    console.log(`  ⚠ 이번 실행은 ${shardCount}샤드 — 경합으로 장별 ms 가 부푼다. 기준이 다른 샤드 수`);
    console.log('    (특히 순차)로 잰 것이면 이 시간비는 참고용이다. 시간 A/B 는 같은 --shards 로.');
  }
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
}

/** 종전 순차 경로 그대로 (`--shards 1`). 시간 A/B 의 순수 기준이기도 하다. */
function runSequential(dumps, decodeFrontend, lumaToRaster, readLumaDump, decodeOpts) {
  const rows = [];
  for (const dump of dumps) {
    const row = measureRow(decodeFrontend, lumaToRaster, readLumaDump, decodeOpts, dump);
    rows.push(row);
    process.stdout.write(row.ok ? '.' : 'x');
  }
  return rows;
}

/**
 * 워커 N개 + 동적 큐. 정적 분할이 아니라 «끝난 워커가 다음 장을 받아가는» 방식이라
 * 느린 장(고해상 덤프)이 몰려도 부하가 자동 균형된다. 완료 순서는 비결정적이지만
 * 병합은 호출부에서 덤프명 정렬로 하므로 출력은 결정적이다.
 */
async function runSharded(dumps, shardCount, frontendPath, decodeOpts) {
  const rows = [];
  let nextIndex = 0;
  await new Promise((finish, abort) => {
    let liveWorkers = shardCount;
    for (let i = 0; i < shardCount; i += 1) {
      const worker = new Worker(fileURLToPath(import.meta.url), {
        workerData: { frontendPath, decodeOpts },
      });
      const assign = () => {
        if (nextIndex < dumps.length) {
          worker.postMessage(dumps[nextIndex]);
          nextIndex += 1;
        } else {
          worker.postMessage(null); // 큐 소진 — 워커가 포트를 닫고 exit 0 으로 내려간다
        }
      };
      worker.on('message', (msg) => {
        if (msg === 'ready') {
          assign();
          return;
        }
        rows.push(msg);
        process.stdout.write(msg.ok ? '.' : 'x');
        assign();
      });
      worker.on('error', (err) => abort(err));
      worker.on('exit', (code) => {
        liveWorkers -= 1;
        if (code !== 0) {
          abort(new Error(`워커 비정상 종료 (exit ${code})`));
          return;
        }
        if (liveWorkers === 0) finish();
      });
    }
  }).catch((err) => {
    console.error(`\n✗ 워커 실패 — 부분 결과(${rows.length}/${dumps.length}행)를 버린다: ${err?.message ?? err}`);
    process.exit(2);
  });
  return rows;
}
