/**
 * dev-server.mjs — 개발용 정적 서버 (의존성 0)
 *
 * index.html 은 ESM(`<script type="module">` + `src/` import)이라 file:// 로 직접
 * 열면 브라우저 CORS 정책에 막힌다. 이 서버는 그 개발 편의만 제공한다 —
 * 배포 산출물(단일 HTML 번들, T10)은 서버 없이 열린다.
 *
 * 사용: node tools/dev-server.mjs [port]   (기본 8765, repo 루트를 서빙)
 */

import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2]) || 8765;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  // 실기기 사진 검증용(tools/photo-probe.html). octet-stream 이면 브라우저가 스니핑에
  // 기대야 하고 canvas 경로에서 조용히 어긋날 수 있어 명시한다.
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/**
 * 개발 전용 쓰기 엔드포인트 — 브라우저가 뽑은 **실사진 휘도 필드**를 파일로 떨군다.
 *
 * 왜: Node 에 JPEG 디코더가 없어서 레인(외부 CLI)이 실사진으로 테스트를 못 한다. 그래서
 * 합성 모사로만 개발하다가 "합성은 고쳐졌는데 실사진은 그대로" 를 세 번 반복했다.
 * 브라우저가 canvas 로 디코드한 휘도를 raw 로 내려 두면 레인이 `fs.readFileSync` 만으로
 * 진짜 픽셀을 쓴다 — 추측 대신 측정이 된다.
 *
 * 쓰기는 `test/output/` 아래로만 허용한다(gitignore 구역). 그 밖은 403.
 */
async function handleLumaDump(req, res, url) {
  const rel = decodeURIComponent(url.searchParams.get('path') || '');
  const target = normalize(join(ROOT, rel));
  const allowed = normalize(join(ROOT, 'test', 'output')) + sep;
  if (!rel || !target.startsWith(allowed)) {
    res.writeHead(403).end('write allowed only under test/output/');
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
  res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`${body.length}`);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'PUT' && url.pathname === '/__luma') {
      await handleLumaDump(req, res, url);
      return;
    }
    const rel = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const path = normalize(join(ROOT, rel));
    if (!path.startsWith(normalize(ROOT + sep)) && path !== normalize(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`TLcube dev server → http://localhost:${PORT}/ (root: ${ROOT})`);
});
