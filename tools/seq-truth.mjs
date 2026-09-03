/**
 * seq-truth.mjs — 라벨된 영상 시퀀스의 단발 복호를 정답과 대조한다.
 *
 *   node tools/seq-truth.mjs [--shards N] [--out p] [--base p]
 *
 * falseAccept = ok ∧ expect≠null ∧ text≠expect
 * expect:null 시퀀스는 집계에서 제외한다 (정답이 없는 것을 틀렸다고 셀 수 없다).
 * 합격선: falseAccept == 0. --base 가 있으면 trueAccept 비감소도 잰다.
 *
 * 러너는 추적 파일이다. 휘도 덤프만 test/output/photos/luma/ (gitignore) 에 있다.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const LABELS_PATH = join(REPO, 'test', 'sequence-truth.json');

function sequenceKey(name) {
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function measureFrame(decodeFrontend, lumaToRaster, readLumaDump, { name, path }) {
  const raster = lumaToRaster(readLumaDump(path));
  let result;
  try {
    result = decodeFrontend(raster, {});
  } catch (err) {
    result = { ok: false, reason: { code: `THROW:${err?.message ?? 'unknown'}` } };
  }
  const ok = Boolean(result.ok);
  return {
    name,
    ok,
    text: ok ? (result.text ?? null) : null,
    family: ok ? (result.family ?? null) : null,
    versionName: ok ? (result.versionName ?? null) : null,
    reason: ok ? null : (typeof result.reason === 'string' ? result.reason : result.reason?.code ?? null),
  };
}

if (!isMainThread) {
  const { frontendPath } = workerData;
  const { readLumaDump, lumaToRaster } =
    await import(pathToFileURL(join(REPO, 'tools', 'read-luma.mjs')).href);
  const { decodeFrontend } = await import(pathToFileURL(frontendPath).href);
  parentPort.on('message', (job) => {
    if (job === null) {
      parentPort.close();
      return;
    }
    parentPort.postMessage(measureFrame(decodeFrontend, lumaToRaster, readLumaDump, job));
  });
  parentPort.postMessage('ready');
} else {
  await main();
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  if (!existsSync(LABELS_PATH)) {
    console.error(`라벨 JSON 없음: ${LABELS_PATH}`);
    process.exit(2);
  }
  const labelsFile = JSON.parse(readFileSync(LABELS_PATH, 'utf8'));
  const labels = new Map();
  for (const [key, value] of Object.entries(labelsFile)) {
    if (key.startsWith('_')) continue;
    labels.set(key, value);
  }

  const frontendPath = resolve(flag('frontend', join(REPO, 'src', 'decoder', 'frontend.js')));
  const outPath = resolve(flag('out', join(REPO, 'test', 'output', 'seq-truth.json')));
  const basePath = flag('base', null);

  const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const shardsFlag = flag('shards', null);
  const shardsRaw = shardsFlag === null ? Math.max(1, cpuCount - 2) : Number(shardsFlag);
  if (!Number.isInteger(shardsRaw) || shardsRaw < 1) {
    console.error(`✗ --shards 는 1 이상의 정수여야 한다: ${shardsFlag}`);
    process.exit(2);
  }

  const { listLumaSequences, readLumaDump, lumaToRaster } =
    await import(pathToFileURL(join(REPO, 'tools', 'read-luma.mjs')).href);
  const { decodeFrontend } = await import(pathToFileURL(frontendPath).href);

  const sequences = listLumaSequences();
  if (sequences.length === 0) {
    console.error('✗ 시퀀스 프레임이 없다 — test/output/photos/luma 를 확인하라.');
    process.exit(3);
  }

  const frames = sequences.flatMap((sequence) => sequence.frames);
  const shardCount = Math.max(1, Math.min(shardsRaw, frames.length));
  console.log(`시퀀스 ${sequences.length} · 프레임 ${frames.length} · 샤드 ${shardCount}`);

  const wallT0 = process.hrtime.bigint();
  const rows = shardCount === 1
    ? runSequential(frames, decodeFrontend, lumaToRaster, readLumaDump)
    : await runSharded(frames, shardCount, frontendPath);
  const wallMs = Number(process.hrtime.bigint() - wallT0) / 1e6;
  process.stdout.write('\n');

  const rowByName = new Map(rows.map((row) => [row.name, row]));
  const unlabeled = [];
  const missingLabels = [];
  const perSequence = [];
  let falseAccept = 0;
  let trueAccept = 0;
  const surpriseTexts = {};

  const seenKeys = new Set();
  for (const sequence of sequences) {
    const key = labels.has(sequence.name) ? sequence.name : sequenceKey(sequence.name);
    const label = labels.get(sequence.name) ?? labels.get(key);
    if (!label) {
      unlabeled.push(sequence.name);
      continue;
    }
    seenKeys.add(labels.has(sequence.name) ? sequence.name : key);
    const expect = Object.prototype.hasOwnProperty.call(label, 'expect') ? label.expect : null;
    const frameRows = sequence.frames.map((frame) => rowByName.get(frame.name)).filter(Boolean);
    const okRows = frameRows.filter((row) => row.ok);
    const texts = [...new Set(okRows.map((row) => row.text))];
    let seqTrue = 0;
    let seqFalse = 0;
    if (expect !== null) {
      for (const row of okRows) {
        if (row.text === expect) seqTrue += 1;
        else seqFalse += 1;
      }
      trueAccept += seqTrue;
      falseAccept += seqFalse;
    } else if (okRows.length > 0) {
      surpriseTexts[key] = texts;
    }
    perSequence.push({
      name: sequence.name,
      key,
      expect,
      note: label.note ?? null,
      frames: frameRows.length,
      ok: okRows.length,
      trueAccept: seqTrue,
      falseAccept: seqFalse,
      uniqueTexts: texts,
    });
  }

  for (const key of labels.keys()) {
    if (!seenKeys.has(key)) missingLabels.push(key);
  }

  const report = {
    sequences: perSequence,
    unlabeled,
    missingLabels,
    totals: {
      sequences: sequences.length,
      frames: frames.length,
      falseAccept,
      trueAccept,
      wallMs: Math.round(wallMs),
      shards: shardCount,
    },
    surpriseTexts,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  for (const entry of perSequence) {
    const scored = entry.expect === null
      ? `expect=null 제외 · ok ${entry.ok}/${entry.frames}`
      : `trueAccept ${entry.trueAccept} · falseAccept ${entry.falseAccept} · ok ${entry.ok}/${entry.frames}`;
    console.log(`${entry.key}\t${scored}`
      + (entry.uniqueTexts.length ? ` · texts=${JSON.stringify(entry.uniqueTexts)}` : ''));
  }
  if (unlabeled.length) {
    console.log(`미라벨 시퀀스 ${unlabeled.length}: ${unlabeled.join(', ')}`);
  }
  if (missingLabels.length) {
    console.log(`라벨은 있는데 덤프 없음 ${missingLabels.length}: ${missingLabels.join(', ')}`);
  }
  const surpriseKeys = Object.keys(surpriseTexts);
  if (surpriseKeys.length) {
    console.log('⚠ expect:null 인데 복호된 시퀀스 (정답 확정 후보):');
    for (const key of surpriseKeys) {
      console.log(`  ${key}: ${JSON.stringify(surpriseTexts[key])}`);
    }
  }

  console.log(`falseAccept ${falseAccept} · trueAccept ${trueAccept} · 벽시계 ${Math.round(wallMs / 1000)}s → ${outPath}`);

  if (basePath) {
    const resolvedBase = resolve(basePath);
    if (!existsSync(resolvedBase)) {
      console.error(`기준 JSON 없음: ${resolvedBase}`);
      process.exit(2);
    }
    const base = JSON.parse(readFileSync(resolvedBase, 'utf8'));
    const baseTrue = Number(base?.totals?.trueAccept);
    console.log(`기준 trueAccept ${baseTrue} → ${trueAccept}`);
    if (!Number.isInteger(baseTrue)) {
      console.error('✗ 기준 JSON 에 totals.trueAccept 가 없다');
      process.exit(2);
    }
    if (trueAccept < baseTrue) {
      console.error(`✗ trueAccept 감소 ${baseTrue} → ${trueAccept}`);
      process.exit(1);
    }
  }

  if (falseAccept !== 0) {
    console.error('✗ falseAccept ≠ 0');
    process.exit(1);
  }
  console.log('✓ falseAccept 0');
}

function runSequential(frames, decodeFrontend, lumaToRaster, readLumaDump) {
  const rows = [];
  for (const frame of frames) {
    const row = measureFrame(decodeFrontend, lumaToRaster, readLumaDump, frame);
    rows.push(row);
    process.stdout.write(row.ok ? '.' : 'x');
  }
  return rows;
}

async function runSharded(frames, shardCount, frontendPath) {
  const rows = [];
  let nextIndex = 0;
  await new Promise((finish, abort) => {
    let liveWorkers = shardCount;
    for (let i = 0; i < shardCount; i += 1) {
      const worker = new Worker(fileURLToPath(import.meta.url), {
        workerData: { frontendPath },
      });
      const assign = () => {
        if (nextIndex < frames.length) {
          worker.postMessage(frames[nextIndex]);
          nextIndex += 1;
        } else {
          worker.postMessage(null);
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
    console.error(`\n✗ 워커 실패 — 부분 결과(${rows.length}/${frames.length}행)를 버린다: ${err?.message ?? err}`);
    process.exit(2);
  });
  return rows;
}
