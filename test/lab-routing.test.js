import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (relativePath) => readFileSync(ROOT + relativePath, 'utf8');
const LAB_COMPOSE = 'deploy/estre-so/projects/tlcube/docker-compose.lab.yml';

const ROUTES = Object.freeze([
  {
    label: '단독 nginx 생성기',
    file: 'deploy/nginx.conf',
    alias: '/srv/tlcube/sites/_shared/lab-gen.html',
  },
  {
    label: '단독 nginx 스캐너',
    file: 'deploy/nginx.conf',
    alias: '/srv/tlcube/sites/_shared/lab-scan.html',
  },
  {
    label: 'estre.so 생성기',
    file: 'deploy/estre-so/projects/tlcube/static-gen.conf',
    alias: '/srv/_shared/lab-gen.html',
  },
  {
    label: 'estre.so 스캐너',
    file: 'deploy/estre-so/projects/tlcube/static.conf',
    alias: '/srv/_shared/lab-scan.html',
  },
]);

const WS_ROUTES = Object.freeze([
  {
    label: '단독 nginx 생성기·스캐너',
    file: 'deploy/nginx.conf',
    count: 2,
    upstream: /proxy_pass\s+http:\/\/127\.0\.0\.1:8787;/,
    dockerDns: false,
  },
  {
    label: 'estre.so 생성기',
    file: 'deploy/estre-so/projects/tlcube/static-gen.conf',
    count: 1,
    upstream: /set\s+\$lab_relay_upstream\s+http:\/\/tlcube-lab-relay:8787;[\s\S]*proxy_pass\s+\$lab_relay_upstream\$request_uri;/,
    dockerDns: true,
  },
  {
    label: 'estre.so 스캐너',
    file: 'deploy/estre-so/projects/tlcube/static.conf',
    count: 1,
    upstream: /set\s+\$lab_relay_upstream\s+http:\/\/tlcube-lab-relay:8787;[\s\S]*proxy_pass\s+\$lab_relay_upstream\$request_uri;/,
    dockerDns: true,
  },
]);

function exactLocationBlocks(source, requestPath) {
  const marker = `location = ${requestPath} {`;
  const blocks = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(marker, cursor);
    if (start < 0) break;

    let depth = 0;
    let end = -1;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    assert.ok(end > start, `${requestPath} location 블록의 닫는 괄호를 못 찾았다`);
    blocks.push(source.slice(start, end));
    cursor = end;
  }

  return blocks;
}

function validateLabHtmlRoute(source, expectedAlias) {
  const candidates = exactLocationBlocks(source, '/lab/');
  const block = candidates.find((candidate) => candidate.includes(`alias ${expectedAlias};`));

  assert.ok(block, `/lab/ 이 ${expectedAlias} 를 alias 하지 않는다`);
  assert.match(block, /add_header\s+Cache-Control\s+"no-store"\s+always;/);
  assert.doesNotMatch(block, /expires\s+7d|Cache-Control\s+"public/);
  return block;
}

function validateWebSocketRoute(block, route) {
  assert.match(block, /proxy_http_version\s+1\.1;/);
  assert.match(block, /proxy_set_header\s+Upgrade\s+\$http_upgrade;/);
  assert.match(block, /proxy_set_header\s+Connection\s+"upgrade";/);
  assert.match(block, route.upstream);
  if (route.dockerDns) {
    assert.match(block, /resolver\s+127\.0\.0\.11\s+ipv6=off\s+valid=10s;/);
  }
}

test('생성기와 스캐너의 /lab/ HTML은 exact alias와 no-store로 서빙된다', () => {
  for (const route of ROUTES) {
    assert.doesNotThrow(
      () => validateLabHtmlRoute(read(route.file), route.alias),
      route.label,
    );
  }
});

test('기존 _shared 7일 캐시는 유지되지만 /lab/ 블록 안으로 들어오지 않는다', () => {
  for (const file of [...new Set(ROUTES.map((route) => route.file))]) {
    const source = read(file);
    assert.match(source, /location \/_shared\/ \{[\s\S]*?expires 7d;/);
  }
});

test('/lab/ws는 8787 릴레이로 WebSocket Upgrade 헤더를 보존해 프록시한다', () => {
  for (const route of WS_ROUTES) {
    const blocks = exactLocationBlocks(read(route.file), '/lab/ws');
    assert.equal(blocks.length, route.count, `${route.label}: /lab/ws 블록 수가 다르다`);
    for (const block of blocks) validateWebSocketRoute(block, route);
  }
});

test('estre.so 프록시는 릴레이 DNS를 지연 해석해 릴레이 부재를 nginx 기동 실패로 번지게 하지 않는다', () => {
  for (const route of WS_ROUTES.filter((candidate) => candidate.dockerDns)) {
    const [block] = exactLocationBlocks(read(route.file), '/lab/ws');
    assert.match(block, /set\s+\$lab_relay_upstream\s+http:\/\/tlcube-lab-relay:8787;/);
    assert.doesNotMatch(block, /proxy_pass\s+http:\/\/tlcube-lab-relay:8787;/);
  }
});

test('estre.so 릴레이 overlay는 8787을 내부 네트워크에만 열고 호스트 포트를 만들지 않는다', () => {
  const compose = read(LAB_COMPOSE);
  assert.match(compose, /^\s{2}tlcube-lab-relay:\s*$/m);
  assert.match(compose, /TL_LAB_HOST:\s*"0\.0\.0\.0"/);
  assert.match(compose, /TL_LAB_PORT:\s*"8787"/);
  assert.match(compose, /TL_LAB_CH_URL:\s*"http:\/\/clickhouse:8123"/);
  assert.match(compose, /expose:\s*\n\s*-\s*"8787"/);
  assert.match(compose, /networks:[\s\S]*?- edge[\s\S]*?- analytics/);
  assert.doesNotMatch(compose, /^\s+ports:\s*$/m);
  assert.match(compose, /traefik\.enable:\s*"false"/);
});

test('가드 반증: /lab/의 no-store를 public 7일 캐시로 바꾸면 검증이 실패한다', () => {
  const route = ROUTES[2];
  const source = read(route.file);
  const mutated = source.replace(
    'add_header Cache-Control "no-store" always;',
    'expires 7d;\n        add_header Cache-Control "public";',
  );

  assert.notEqual(mutated, source, '반증용 mutation이 적용되지 않았다');
  assert.throws(() => validateLabHtmlRoute(mutated, route.alias));
});

test('가드 반증: /lab/ alias가 안정판 index로 돌아가면 검증이 실패한다', () => {
  const route = ROUTES[3];
  const source = read(route.file);
  const mutated = source.replace(route.alias, '/usr/share/nginx/html/index.html');

  assert.notEqual(mutated, source, '반증용 mutation이 적용되지 않았다');
  assert.throws(() => validateLabHtmlRoute(mutated, route.alias));
});

test('가드 반증: WebSocket Upgrade 헤더를 제거하면 프록시 검증이 실패한다', () => {
  const route = WS_ROUTES[1];
  const [block] = exactLocationBlocks(read(route.file), '/lab/ws');
  const mutated = block.replace('proxy_set_header Upgrade $http_upgrade;\n', '');

  assert.notEqual(mutated, block, '반증용 mutation이 적용되지 않았다');
  assert.throws(() => validateWebSocketRoute(mutated, route));
});
