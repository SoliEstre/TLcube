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
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
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
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
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
