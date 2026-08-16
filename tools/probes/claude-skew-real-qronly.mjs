/**
 * claude-skew-real-qronly.mjs — §8 «QR 이 v0 로 보이는가» 실증.
 *
 * 프레임 두 종류를 **큐브 픽셀 0개**로 잘라 같은 lab 경로에 넣는다:
 *   QR 창 — 큐브 bbox 를 뺀 최대 사각형 중 **QR 을 통째로 담는** 쪽의 최대 정사각형
 *   BG 창 — 큐브도 QR 도 없는 쪽의 최대 정사각형 (**음성 대조군**)
 * 창은 `claude-skew-real-qrlocate.py` 가 결정론적으로 계산한다 (손으로 찍지 않는다).
 * BG 창이 있어야 «QR 이 v0 포즈를 만든다» 를 «화면 아무 무늬나 v0 포즈를 만든다» 와
 * 가를 수 있다 — §4.4 의 1차 실험에는 이 대조군이 없었다.
 *
 * 사용: node tools/probes/claude-skew-real-qronly.mjs --out <json> [--targets 640,960,1440]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeOnce } from './claude-skew-real-sweep.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const STD = join(ROOT, 'test', 'output', 'photos', 'skew-20260816');
const WIDE = join(ROOT, 'test', 'output', 'photos', 'skew-wide-20260816');
const PY = join(ROOT, 'tools', 'probes', 'claude-skew-real-jpeg.py');

/** 창 정의 JSON 은 qrlocate.py 산출. 경로는 --windows 로 바꿀 수 있다. */
const CORPUS = [
  { id: 'p00', dir: STD, file: 'KakaoTalk_20260816_110225527.jpg', lens: 'std' },
  { id: 'p01', dir: STD, file: 'KakaoTalk_20260816_110225527_01.jpg', lens: 'std' },
  { id: 'p02', dir: STD, file: 'KakaoTalk_20260816_110225527_02.jpg', lens: 'std' },
  { id: 'p03', dir: STD, file: 'KakaoTalk_20260816_110225527_03.jpg', lens: 'std' },
  { id: 'p04', dir: STD, file: 'KakaoTalk_20260816_110225527_04.jpg', lens: 'std' },
  { id: 'p05', dir: STD, file: 'KakaoTalk_20260816_110225527_05.jpg', lens: 'std' },
  { id: 'w00', dir: WIDE, file: 'KakaoTalk_20260816_133329976.jpg', lens: 'wide' },
  { id: 'w01', dir: WIDE, file: 'KakaoTalk_20260816_133329976_01.jpg', lens: 'wide' },
  { id: 'w02', dir: WIDE, file: 'KakaoTalk_20260816_133329976_02.jpg', lens: 'wide' },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (basename(process.argv[1]) === 'claude-skew-real-qronly.mjs') {
  // 창 정의 아카이브: test/output/lanes/claude-skew-real-qrwin_<id>.json
  const windowsDir = arg('--windows', join(ROOT, 'test', 'output', 'lanes'));
  const windowFile = (id) => join(windowsDir, `claude-skew-real-qrwin_${id}.json`);
  const targets = arg('--targets', '640,960,1440').split(',').map(Number);
  const outPath = arg('--out', join(ROOT, 'test', 'output', 'lanes', 'claude-skew-real-qronly2.json'));
  const frameDir = join(ROOT, 'test', 'output', 'photos', '_qrframes');
  mkdirSync(frameDir, { recursive: true });
  const rows = [];
  for (const p of CORPUS) {
    const spec = JSON.parse(readFileSync(windowFile(p.id), 'utf8'));
    for (const which of ['qrWindow', 'bgWindow']) {
      const w = spec[which];
      if (!w) continue;
      for (const target of targets) {
        const mode = `box${target}@${w.x.toFixed(1)},${w.y.toFixed(1)},${w.side.toFixed(1)}`;
        const out = join(frameDir, `${p.id}.${which}.${target}.rgba`);
        if (!existsSync(out)) {
          execFileSync('python', [PY, join(p.dir, p.file), out, mode],
            { stdio: ['ignore', 'pipe', 'pipe'] });
        }
        const r = decodeOnce(out, { stable: false });
        const verified = (r.csBlockLocator && r.csBlockLocator.verified) || [];
        const v0 = (r.layouts || []).find((l) => l.layoutId === 'v0') || null;
        const row = {
          photo: p.id, lens: p.lens, window: which, target, mode,
          windowSide: w.side, cubeVerticesInWindow: spec[`${which === 'qrWindow' ? 'qrWindow' : 'bgWindow'}CubeVertices`],
          frame: [r.width, r.height],
          ok: r.ok, reason: r.reason,
          poseCount: (r.csBlockLocator && r.csBlockLocator.poseCount) || null,
          verifiedCount: verified.length,
          verifiedTop3: verified.slice(0, 3).map((v) => v.score),
          v0Attempted: v0 ? v0.attempted : 0,
          v0Accepted: v0 ? v0.accepted : 0,
          v0Best: v0 ? v0.bestScore : null,
          v0Reasons: v0 ? v0.reasons : null,
          cubeHyp: r.cube ? r.cube.hypothesisCount : null,
          qrHyp: r.qr ? r.qr.hypothesisCount : null,
          formatProposal: r.format ? r.format.formatProposalCount : null,
          ms: r.ms,
        };
        rows.push(row);
        console.log(`${p.id} ${which.padEnd(9)} @${target} → pose_v0 ${String(row.poseCount?.v0 ?? 0).padStart(2)}`
          + ` | verified ${String(row.verifiedCount).padStart(2)} top3 ${JSON.stringify(row.verifiedTop3)}`
          + ` | v0 ${row.v0Accepted}/${row.v0Attempted} best ${row.v0Best === null ? '—' : row.v0Best.toFixed(4)}`
          + ` | cubeHyp ${row.cubeHyp} | ${row.reason ?? 'OK'}`);
        writeFileSync(outPath, JSON.stringify(rows, null, 1));
      }
    }
  }
  console.log(`\n${rows.length} rows → ${outPath}`);
}
