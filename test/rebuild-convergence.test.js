/**
 * rebuild-convergence.test.js — 고정점 러너의 수렴 지문이 **내용**을 보는가.
 *
 * ── 왜 생겼나 (2026-08-29) ──────────────────────────────────────────────────
 *
 * `tools/rebuild-all.mjs` 의 수렴 판정이 `git status --porcelain`(파일 **집합**)
 * 이었다. `dist/tlscan.html` 이 패스 1에서도 「수정됨」· 패스 2에서도 「수정됨」이면
 * porcelain 출력은 바이트 동일 — 내용이 한 빌드 낡았는데 「수렴」으로 통과했다.
 * 그 낡은 번들은 러너가 아니라 하류의 `generated-artifacts-fresh.test.js` 가
 * 빨개져서야 발견됐다. 러너가 스스로 알았어야 할 것을 하류 자가 잡은 것이다.
 *
 * ── 여기서 잠그는 성질 ──────────────────────────────────────────────────────
 *
 * 구현 철자(porcelain 호출 여부)가 아니라 지문의 **성질**을 잰다 — 그래야
 * mtime·크기·파일 집합 같은 다른 잘못된 지문으로의 회귀도 같은 자에 걸린다:
 *
 *   1) 파일 집합이 같고 **내용만** 달라도 지문이 달라진다  ← 2026-08-29 사고의 재현
 *   2) 내용이 같으면 지문이 같다 (수렴이 도달 가능해야 한다)
 *   3) 결측 → 생성 도 변화로 잡힌다 (첫 패스가 만든 파일이 수렴을 조기 선언 못 하게)
 *   4) 대상 목록은 빌더들의 OUTPUTS 선언 합집합에서 유도된다 — 손 목록이 없고,
 *      선언 없는 새 빌더는 유도 단계가 거부한다
 *
 * ── 이 자가 안 지키는 축 (이름을 붙여 둔다) ─────────────────────────────────
 *
 *   · **과소 선언**: 빌더가 OUTPUTS 에 없는 파일을 쓰면 그 파일은 지문 밖이다.
 *     그물은 `generated-artifacts-fresh.test.js` — 커밋 바이트 == 빌드 결과를 산출물
 *     단위로 재므로, 지문이 놓친 stale 도 스위트에서는 빨개진다 (08-29 를 잡은 그 자).
 *   · **배선**: main() 이 이 지문을 실제로 수렴 판정에 쓰는가는 같은 파일 안의
 *     대여섯 줄 글루라 코드 리뷰 축으로 남긴다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  listBuilders, collectDeclaredOutputs, fingerprintOutputs,
} from '../tools/rebuild-all.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tlcube-convergence-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('파일 집합이 같고 내용만 달라도 지문이 달라진다 (2026-08-29 재현)', () => {
  withTempDir((dir) => {
    // 두 상태 모두 «같은 파일 하나가 존재하고 수정된» 모양이다 — 집합·이름·개수가
    // 동일하므로 파일 집합 기반 지문은 여기서 반드시 «수렴» 이라 잘못 말한다.
    // 길이까지 같게 해서 크기 기반 지문도 함께 걸리게 한다.
    writeFileSync(path.join(dir, 'a.html'), 'A'.repeat(2048));
    const stale = fingerprintOutputs(dir, ['a.html']);
    writeFileSync(path.join(dir, 'a.html'), 'B'.repeat(2048));
    const fresh = fingerprintOutputs(dir, ['a.html']);
    assert.notEqual(stale, fresh,
      '내용이 다른 두 상태의 지문이 같다 — 낡은 산출물이 「수렴」으로 통과한다 (2026-08-29 사고 재발)');
  });
});

test('내용이 같으면 지문이 같다 — 수렴이 도달 가능하다', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'a.html'), 'A'.repeat(2048));
    writeFileSync(path.join(dir, 'b.html'), '내용 B');
    const first = fingerprintOutputs(dir, ['a.html', 'b.html']);
    // 같은 내용을 다시 쓴다 — mtime 은 바뀐다. mtime 기반 지문은 여기서 걸린다.
    writeFileSync(path.join(dir, 'a.html'), 'A'.repeat(2048));
    const second = fingerprintOutputs(dir, ['a.html', 'b.html']);
    assert.equal(first, second,
      '내용이 같은데 지문이 다르다 — 러너가 영원히 수렴하지 못한다');
  });
});

test('결측 → 생성 도 변화로 잡힌다', () => {
  withTempDir((dir) => {
    const before = fingerprintOutputs(dir, ['a.html']);
    writeFileSync(path.join(dir, 'a.html'), '첫 생성');
    const after = fingerprintOutputs(dir, ['a.html']);
    assert.notEqual(before, after,
      '파일이 새로 생겼는데 지문이 그대로다 — 첫 패스가 만든 산출물이 수렴 판정에 안 잡힌다');
  });
});

test('산출물 대상은 빌더 OUTPUTS 선언의 합집합에서 유도된다 — 손 목록이 없다', async () => {
  const builders = listBuilders();
  assert.ok(builders.length >= 9,
    '빌더를 ' + builders.length + '개밖에 못 찾았다 — 글롭 유도가 깨졌다');

  const outputs = await collectDeclaredOutputs(builders);
  assert.ok(outputs.length > 0, '유도된 산출물이 0개다');

  // 유도 결과는 repo 상대 POSIX 여야 하고(러너가 그렇게 정규화한다), 전부 실재해야 한다
  // — 실재하지 않는 선언은 오타이거나 커밋 안 된 산출물이다.
  for (const rel of outputs) {
    assert.ok(!path.isAbsolute(rel) && !rel.includes('\\'),
      rel + ' — repo 상대 POSIX 가 아니다');
    assert.ok(existsSync(path.join(ROOT, rel)),
      rel + ' — 선언은 됐는데 실재하지 않는다 (빌더의 OUTPUTS 가 쓰기와 어긋났다)');
  }

  // 사고 파일이 대상 안에 있는지 못박는다 — 08-29 에 낡은 채 통과한 바로 그 파일이
  // 유도에서 빠지면 이 개편 전체가 헛돈다.
  assert.ok(outputs.includes('dist/tlscan.html'),
    'dist/tlscan.html 이 지문 대상에 없다 — 2026-08-29 사고 파일이 유도에서 빠졌다');
});

test('OUTPUTS 를 선언하지 않는 빌더는 유도 단계가 거부한다', async () => {
  // 실재 빌더에 결함을 심을 수는 없으니, 선언 없는 가짜 빌더 하나로 거부 성질만 잰다.
  // withTempDir 를 못 쓰는 이유: 콜백이 async 면 정리(rmSync)가 완료 전에 돈다.
  const dir = mkdtempSync(path.join(tmpdir(), 'tlcube-convergence-'));
  try {
    writeFileSync(path.join(dir, 'build-undeclared.mjs'), 'export const nothing = 1;\n');
    await assert.rejects(
      () => collectDeclaredOutputs(['build-undeclared.mjs'], { toolsDir: dir, root: dir }),
      /OUTPUTS/,
      '선언 없는 빌더가 조용히 통과했다 — 그 빌더의 산출물은 영원히 지문 밖이다');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
