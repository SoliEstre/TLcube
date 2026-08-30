// build-scan-variants.mjs — 스캐너를 **여러 디코더 버전으로** 빌드해 나란히 배포한다.
//
// ## 왜 필요했나
//
// 디코더 최적화 뒤 실기기에서 Type A 인식이 크게 떨어졌다는 보고가 왔는데, 통합자가
// 가진 수단으로는 **재현이 안 됐다**: 실사진 덤프 52장이 사진 경로·라이브 크롭 경로
// 양쪽에서 전후 출력이 완전히 동일했고, 속도는 1.49배 빨라졌으며 GC 압력은 오히려
// 0.75배로 줄었다. 즉 데스크톱 Node 에서 관측 가능한 축은 전부 «차이 없음» 이었다.
//
// 이럴 때 필요한 건 더 정교한 합성 테스트가 아니라 **실기기에서 두 버전을 직접 가르는
// 것**이다. 브라우저 JIT·모바일 GC·실제 카메라 프레임(모션 블러·롤링 셔터·노출 변동)은
// 어느 것도 Node 를 거치지 않는다.
//
// ## 배포 경로를 `_shared` 로 고른 이유
//
// `sites/_shared` 는 세 컨테이너에 **이미 디렉터리로 마운트**돼 있다
// (deploy/estre-so/projects/tlcube/docker-compose.yml). 그래서
//   · compose 를 안 건드린다 — 새 마운트는 운영 게이트를 하나 더 만든다
//   · nginx conf 를 안 건드린다 — `/_shared/` alias 가 이미 있다
//   · **디렉터리 마운트라 `git pull` 만으로 반영된다** (dist/*.html 은 파일 마운트라
//     inode 에 묶여 재기동이 필요하지만 이건 아니다)
// 즉 변형본 추가는 배포 위험이 사실상 0 이고, 운영 페이지(`/`)는 손대지 않는다.
//
// 서비스 워커가 캐시로 굳힐 걱정도 없다 — `tlscan-sw.js` 는 네트워크 우선이라
// 온라인이면 항상 최신을 가져온다.
//
// ## 쓰는 법
//   node tools/build-scan-variants.mjs
//   → sites/_shared/scan-<id>.html 생성. 각 파일은 상단에 버전 선택 바를 갖는다.

import { execFileSync } from 'node:child_process';
import { rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildScannerHtml } from './build-scanner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'sites', '_shared');
export const LAB_SCANNER_PATH = path.join(OUT_DIR, 'lab-scan.html');

/** 현재 작업트리의 스캐너를 /lab/ 용으로 만든다. 기존 단일 파일 빌더를 그대로 쓴다. */
export function buildScannerLabHtml() {
  return buildScannerHtml();
}

/**
 * 비교할 버전들. `ref: null` 은 **현재 작업트리**를 뜻한다.
 *
 * 새 후보를 넣을 때는 여기에 한 줄 더한다. id 가 URL 이 되므로 짧고 안정적으로 둔다 —
 * 사용자가 폰에서 눌러 오가고, 결과를 보고할 때 이 이름으로 부르게 된다.
 */
export const VARIANTS = [
  {
    id: 'new',
    ref: null,
    name: '새 디코더',
    note: '1.3“1.8배 빠름 (2026-08-11 최적화)',
  },
  {
    id: 'old',
    ref: '09596a3',
    name: '이전 디코더',
    note: '최적화 직전 — 느리지만 검증된 동작',
  },
];

/** 변형 파일 경로 — 쓰기 루프와 OUTPUTS 가 같은 유도를 쓴다 (철자 사본 금지). */
const variantFile = (v) => path.join(OUT_DIR, `scan-${v.id}.html`);

// 수렴 지문 대상 (rebuild-all.mjs) — VARIANTS 테이블에서 유도한다.
export const OUTPUTS = Object.freeze([...VARIANTS.map(variantFile), LAB_SCANNER_PATH]);

/** 번들에 박힌 빌드 태그를 꺼내 라벨에 쓴다 — 어느 빌드를 보고 있는지 스스로 증명한다. */
function buildTagOf(html) {
  const m = /SCANNER_BUILD\s*=\s*'([^']+)'/.exec(html);
  return m ? m[1] : '(태그 없음)';
}

/**
 * 버전 선택 바. **빌드된 HTML 에 주입**한다 — 옛 커밋에서 뽑은 변형본에도 붙어야 해서
 * 스캐너 소스를 고치는 방식으로는 안 된다(그 커밋엔 이 기능이 없으니까).
 *
 * iPhone 노치를 고려해 safe-area 를 준다. 카메라 화면 위에 뜨므로 높이를 최소로 둔다.
 */
function pickerBar(active, tags) {
  /*
   * ⚠ **상단 고정 바로 두면 안 된다.** 스캐너 앱은 전체화면 고정 레이아웃이라 스페이서
   *   div 가 아무것도 밀지 못하고, 바가 로고와 언어 토글을 그대로 덮는다(실측).
   *   그래서 하단 중앙에 작은 알약으로 띄운다 — 스캔 가이드는 화면 중앙이고 하단은
   *   여백이라 무엇도 가리지 않는다.
   */
  const links = VARIANTS.map((v) => {
    const on = v.id === active;
    const style = on
      ? 'background:#fff;color:#7a1020;font-weight:700'
      : 'background:rgba(255,255,255,.18);color:#fff';
    return `<a href="/_shared/scan-${v.id}.html" style="${style};padding:.3em .75em;border-radius:999px;text-decoration:none;white-space:nowrap">${v.name}</a>`;
  }).join('');
  return `<div style="position:fixed;left:50%;transform:translateX(-50%);`
    + `bottom:calc(env(safe-area-inset-bottom,0px) + .5em);z-index:99999;`
    + `padding:.4em .6em;border-radius:999px;background:rgba(122,16,32,.94);color:#fff;`
    + `box-shadow:0 2px 12px rgba(0,0,0,.45);`
    + `font:600 12px/1 system-ui,-apple-system,sans-serif;`
    + `display:flex;gap:.4em;align-items:center;white-space:nowrap">`
    + `<span style="opacity:.9;padding-left:.3em">${tags[active]}</span>${links}`
    + `<a href="/" style="color:#fff;opacity:.7;padding:.3em .5em;text-decoration:underline">운영본</a>`
    + `</div>`;
}

function buildAt(dir) {
  execFileSync(process.execPath, [path.join(dir, 'tools', 'build-scanner.mjs')], { cwd: dir, stdio: 'pipe' });
  return readFileSync(path.join(dir, 'dist', 'tlscan.html'), 'utf8');
}

function main() {
  const built = {};
  const tags = {};
  for (const v of VARIANTS) {
    if (v.ref === null) {
      built[v.id] = buildAt(ROOT);
    } else {
      /*
       * 그 커밋의 트리를 통째로 꺼내 **그 안에서** 빌드한다. 작업트리 파일을 섞으면
       * 어느 코드가 들어갔는지 알 수 없게 된다.
       *
       * `git archive | tar` 대신 worktree 를 쓰는 이유는 순전히 Windows 경로 때문이다 —
       * GNU tar 은 `C:\...` 의 콜론을 원격 호스트 구분자로 읽어 "Cannot connect to C" 로
       * 죽고, `--force-local` 을 붙이면 이번엔 `-C` 인자의 역슬래시를 망가뜨린다.
       * worktree 는 경로를 git 이 직접 다루므로 인용 문제가 없다.
       */
      const tmp = path.join(tmpdir(), `tlscan-variant-${v.id}`);
      rmSync(tmp, { recursive: true, force: true });
      execFileSync('git', ['worktree', 'add', '--detach', tmp, v.ref], { cwd: ROOT, stdio: 'pipe' });
      try {
        built[v.id] = buildAt(tmp);
      } finally {
        // remove 가 실패해도(락 등) 다음 실행이 막히지 않게 prune 까지 돌린다.
        try { execFileSync('git', ['worktree', 'remove', '--force', tmp], { cwd: ROOT, stdio: 'pipe' }); } catch { /* 아래 prune 이 정리한다 */ }
        rmSync(tmp, { recursive: true, force: true });
        try { execFileSync('git', ['worktree', 'prune'], { cwd: ROOT, stdio: 'pipe' }); } catch { /* 정리 실패는 빌드 결과와 무관하다 */ }
      }
    }
    tags[v.id] = buildTagOf(built[v.id]);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const v of VARIANTS) {
    const html = built[v.id];
    const at = html.indexOf('>', html.indexOf('<body')) + 1;
    if (at <= 0) throw new Error(`${v.id}: <body> 를 못 찾았다`);
    const out = html.slice(0, at) + pickerBar(v.id, tags) + html.slice(at);
    const file = variantFile(v);
    writeFileSync(file, out);
    console.log(`sites/_shared/scan-${v.id}.html  ${tags[v.id].padEnd(16)} ${(out.length / 1024).toFixed(0)} KB  (${v.name})`);
  }

  // 비교 UI가 없는 현재 스캐너 원본을 시험판 경로용으로 함께 둔다.
  writeFileSync(LAB_SCANNER_PATH, built.new, 'utf8');
  console.log(`sites/_shared/lab-scan.html ${tags.new.padEnd(16)} ${(built.new.length / 1024).toFixed(0)} KB`);

  console.log('\n배포되면:');
  for (const v of VARIANTS) console.log(`  https://tlscan.estre.so/_shared/scan-${v.id}.html  — ${v.name}`);
  console.log('  https://tlscan.estre.so/lab/ — 시험판');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
