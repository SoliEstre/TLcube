/**
 * build-stamp-freshness.test.js — 배포 스탬프가 **소스보다 오래되지 않았는가**.
 *
 * 왜 생겼나 (2026-08-19, 운영자 지적). 하루에 다섯 번 배포하는 동안
 * `GENERATOR_BUILD` 가 `2026-08-14.04` 에 멈춰 있었다. 코드는 최신이었고 해시
 * 대조도 전부 «일치» 였는데, 운영자가 시험판을 열어 보고 「8월 14일자야」 —
 * **배포가 안 된 줄 알았다.**
 *
 * 이것은 «표시만 틀린» 문제가 아니다. 운영자는 **이 숫자로 배포 여부를 판정**한다.
 * 틀린 스탬프는 「배포 실패」라는 잘못된 결론을 만들고, 그 결론 위에서 재배포·
 * 원인 조사 같은 헛일이 벌어진다. 실제로 그렇게 됐다.
 *
 * 그리고 이 사고는 **두 번째**다. `index.html` 의 상수 주석이 그걸 기록하고 있다:
 * 「`d91a34d` 가 제목에만 «.10» 을 달고 이 상수를 안 올려서 라이브는 계속 .09 를
 * 표시했다」. 같은 자리에서 두 번 넘어졌으면 회귀로 묶을 때다.
 *
 * ─ 무엇을 재는가 ───────────────────────────────────────────────────────────
 * 「스탬프가 최신 커밋과 같은 날인가」로 재면 문서만 고친 커밋에도 터져서 못 쓴다.
 * 실제 불변식은 **«배포 표면의 소스가 마지막으로 바뀐 날 ≤ 스탬프 날짜»** 다.
 * 즉 스탬프는 그 표면의 마지막 실질 변경을 **덮고 있어야** 한다.
 *
 * git 이 없거나(배포된 tarball 등) 이력을 못 읽으면 **skip 하지 않고** 형식만
 * 검사한다 — skip 은 «통과» 로 읽히고, 그렇게 거짓 초록이 난다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** `YYYY-MM-DD.NN` 형식인가. 형식이 깨지면 날짜 비교 자체가 무의미하다. */
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})\.(\d{2})$/;

/** 그 경로들이 마지막으로 바뀐 커밋의 작성일(YYYY-MM-DD). git 이 없으면 null. */
function lastChangeDate(paths) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ad', '--date=short', '--', ...paths],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

const SURFACES = [
  {
    name: 'GENERATOR_BUILD',
    file: 'index.html',
    re: /const GENERATOR_BUILD = '([^']+)'/,
    // 생성기 번들이 나르는 것 — 이들이 바뀌면 라이브 생성기가 바뀐 것이다.
    watch: ['index.html', 'src/finder-patterns.js', 'src/finder-oak-patterns.js',
      'src/finder-daehan.js', 'src/finder-card-ui.js', 'src/scene.js'],
  },
  {
    name: 'SCANNER_BUILD',
    file: 'sites/tlscan/scanner.js',
    re: /export const SCANNER_BUILD = '([^']+)'/,
    watch: ['sites/tlscan/scanner.js', 'sites/tlscan/index.html',
      'src/decoder/bootstrap.js', 'src/decoder/cell-finder-detect.js',
      'src/decoder/frontend.js'],
  },
];

for (const surface of SURFACES) {
  test(surface.name + ' 은 형식이 YYYY-MM-DD.NN 이다', () => {
    const source = readFileSync(ROOT + surface.file, 'utf8');
    const match = surface.re.exec(source);
    assert.ok(match, surface.file + ' 에서 ' + surface.name + ' 을 못 찾았다');
    assert.match(match[1], STAMP_RE,
      surface.name + ' 형식이 깨졌다: ' + match[1] + ' — 날짜 비교가 무의미해진다');
  });

  test(surface.name + ' 이 그 표면의 마지막 소스 변경을 덮는다', () => {
    const source = readFileSync(ROOT + surface.file, 'utf8');
    const stamp = surface.re.exec(source)[1];
    const stampDate = stamp.slice(0, 10);
    const changed = lastChangeDate(surface.watch);
    if (changed === null) {
      // git 을 못 읽는 환경 — 조용히 통과시키지 않고, 잴 수 있는 것만 잰다.
      assert.match(stamp, STAMP_RE);
      return;
    }
    assert.ok(stampDate >= changed,
      surface.name + ' = ' + stamp + ' 인데 감시 경로가 ' + changed + ' 에 바뀌었다.\n'
      + '    → 배포는 됐는데 화면은 옛 날짜를 말한다. 운영자는 이 숫자로 배포 여부를\n'
      + '      판정하므로 「배포 실패」라는 잘못된 결론이 만들어진다 (2026-08-19 실제 발생).\n'
      + '    감시 경로: ' + surface.watch.join(' '));
  });
}

test('두 스탬프가 서로 다른 날짜로 갈리지 않는다 (같은 배포에서 함께 오른다)', () => {
  // 갈려 있어도 그 자체로 결함은 아니다 — 한쪽만 바뀐 배포가 있을 수 있다.
  // 다만 **둘 다 오늘 바뀐 소스를 갖고 있는데 한쪽만 오른** 경우는 잡는다.
  const stamps = SURFACES.map((s) => {
    const src = readFileSync(ROOT + s.file, 'utf8');
    return { name: s.name, stamp: s.re.exec(src)[1], changed: lastChangeDate(s.watch) };
  });
  if (stamps.some((s) => s.changed === null)) return;
  const newest = stamps.reduce((a, b) => (a.changed > b.changed ? a : b));
  for (const s of stamps) {
    if (s.changed !== newest.changed) continue;
    assert.ok(s.stamp.slice(0, 10) >= s.changed,
      s.name + ' 만 안 올랐다 (' + s.stamp + ' vs 소스 ' + s.changed + ')');
  }
});
