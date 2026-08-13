# lab 릴레이

시험판(`/lab/`) 텔레메트리 WebSocket 릴레이. 와이어 포맷은 계약 §3·§4
(공통 봉투 `v/sid/site/ts/kind/body`, kind 는 `env|gen|frame|frameShot`),
스키마는 §6 (이벤트/썸네일 분리, TTL 14일/7일) 이 정본이다.

```
브라우저(/lab/) ──WS──> 이 프로세스 ──┬──> ClickHouse (적재)
                                     └──> 관찰자 브로드캐스트
```

런타임 의존성은 없다. Node 24 내장 `http` + `crypto` 로 RFC 6455 서버를 붙였다
(같은 Node 의 `WebSocket` 은 클라이언트만 제공한다). 프레임워크는 쓰지 않는다.

## 실행

ClickHouse 스키마를 한 번 적용한다. 암호는 프롬프트나 환경에서만 넣고 파일에 적지 않는다.

```bash
clickhouse-client --multiquery < relay/schema.sql
# 주석 처리된 CREATE USER / GRANT 는 암호를 채운 뒤 따로 실행
```

릴레이:

```bash
set TL_LAB_CH_USER=tl_lab_ingest
set TL_LAB_CH_KEY=<INSERT-only 암호>
node relay/server.mjs
```

기본 바인드는 `127.0.0.1:8787`, 경로 `/lab/ws`.
공개 노출은 nginx 가 `wss://<host>/lab/ws` 로 Upgrade 를 넘겨 줄 때뿐이다
(그 conf 는 레인 A, `deploy/**`). 로컬에서 쓸 때는 브라우저가
`ws://127.0.0.1:8787/lab/ws` 로 붙으면 된다.

살아 있는지: `GET http://127.0.0.1:8787/healthz` → `ok`.

첫 텍스트 프레임이 역할이다.

```json
{ "role": "emitter" }
{ "role": "observer" }
```

이후 emitter 는 계약 §3 봉투를 한 줄 = 한 이벤트로 보낸다. observer 는 받기만 한다.

## 환경변수

| 이름 | 기본 | 의미 |
|---|---|---|
| `TL_LAB_HOST` | `127.0.0.1` | listen 주소. 공개 바인드하지 말 것 |
| `TL_LAB_PORT` | `8787` | listen 포트 |
| `TL_LAB_CH_URL` | `http://127.0.0.1:8123` | ClickHouse HTTP. 루프백만 |
| `TL_LAB_CH_USER` | (빈 값) | INSERT-only 유저 |
| `TL_LAB_CH_KEY` | (빈 값) | 그 암호. **소스·로그·클라이언트에 넣지 않는다** |
| `TL_LAB_CH_DATABASE` | `tl_lab` | `schema.sql` 의 DB 이름 |
| `TL_LAB_MAX_PAYLOAD` | `131072` | 한 WS 텍스트 프레임 바이트 상한 |
| `TL_LAB_MAX_SOCKETS` | `256` | 동시 소켓 상한 |

`TL_LAB_CH_USER` / `TL_LAB_CH_KEY` 가 없으면 적재는 건너뛰고 브로드캐스트만 한다
(로컬에서 관찰자만 붙일 때). ClickHouse 가 죽어도 방송은 계속되고, 관찰자가 0이어도
적재는 계속된다.

자격증명은 릴레이 → `127.0.0.1:8123` 헤더(`X-ClickHouse-User` / `X-ClickHouse-Key`)로만
간다. URL 쿼리에 넣지 않는다.

nginx 쪽 힌트(레인 A 가 씀. 이 디렉터리에서는 작성하지 않는다):

```
location /lab/ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

## 테스트

`relay/` 안에서, 또는 파일 경로를 직접 넘긴다. `node --test relay/` 는 이 Node 에서
인자를 glob 으로 해석해 깨진다 (`npm test` 안내와 같다).

```bash
node --test
node --test ./relay/protocol.test.js ./relay/schema.test.js ./relay/ingest.test.js ./relay/ws.test.js
cd relay
node --test
```

## 되돌리는 법

1. 프로세스 중지 (`SIGINT` / `SIGTERM`).
2. ClickHouse 에서 테이블·유저·DB 를 이 순서로 지운다. **기존 `tl_analytics` /
   `tlcube.events` 는 건드리지 않는다.**

```sql
DROP TABLE IF EXISTS tl_lab.thumbnails;
DROP TABLE IF EXISTS tl_lab.events;
DROP QUOTA IF EXISTS tl_lab_ingest_q;
DROP USER IF EXISTS tl_lab_ingest;
DROP DATABASE IF EXISTS tl_lab;
```

3. `relay/` 디렉터리를 지우면 코드도 사라진다. `deploy/` · `src/` · `sites/` 는
   이 레인이 쓰지 않았다.

TTL 만으로도 이벤트는 14일, 썸네일은 7일 뒤 행이 사라진다. DROP 은 그 전이라도
비울 때 쓴다.
