# lab 릴레이

시험판(`/lab/`) 텔레메트리 WebSocket 릴레이. 와이어 포맷은 공통 봉투
`v/sid/site/ts/kind/body`(kind 는 `env|gen|frame|frameShot`),
스키마는 이벤트/썸네일 분리, TTL 14일/7일이다.

P0 부터 frame 본문은 기존 `reason`/`ms`/`type`/`cellPx` 를 유지한 채
`attempt_id`, `config_id`, `expected`/`observed`, `chain`, `geometry` 를 더한다.
스캐너가 생성 설정을 모르면 `expected_*` 와 `config_id` 는 null/빈 값이다.
시간 근접성으로 생성·스캔을 잇지 않는다.

## 좌표계·단위 (geometry)

이미지 픽셀. 원점은 프레임 좌상단, +x 오른쪽, +y 아래. 단위는 1 픽셀.

| 필드 | 단위·범위 | 미측정 |
|---|---|---|
| `bbox` `{x,y,w,h}` | 이미지 px, 축 정렬 | `null` |
| `corners` | 이미지 px 점 배열(≥3) | `null` |
| `occupancy` | bbox 면적 / 프레임 면적 | `null` |
| `clipSide` | `none`/`left`/`right`/`top`/`bottom`/`multi`/`border` | `null` |
| `rotationDeg` | 디코더 `hypothesis.rotationDegrees`, 시계 방향 도 | `null` |
| `perspective` | 네 모서리 대각선비 − 1 | `null` |
| `residualPx` | 호모그래피 재투영 잔차 px | `null` |
| `cellPx` | H 스케일 또는 가설 `cellSizePx` (실측만) | `null` |

`ms.total` 은 프레임 벽시계다. `ms.proposal|verify|format|decode` 는 해당 구간
실측만 넣고, 측정하지 못하면 `null` 이다. total 을 마지막 단계에 복사하지 않는다.

원인 사슬 `chain.stages` 순서는
`input-quality → proposal → finder → geometry → sample → format → body` 다.
각 칸의 `status` 는 `reached`/`failed`/`skipped`/`unknown` 이고, 증거가 없으면
`unknown` 이다.

썸네일은 시험판 한정, 장변 96px 회색조, 세션당 최대 20장. 첫 실패 20장이 아니라
시도·사유·성공 직전·성공을 층화한다.

live ClickHouse 가 이미 있으면 `relay/schema.sql` 을 다시 실행하지 말고
`deploy/estre-so/clickhouse/002_tl_lab_p0_instrumentation.sql` 이후 번호순 마이그레이션을 적용한다.
P1 배포 스탬프 컬럼은 `009_tl_lab_build.sql` 이 추가한다.
gen 강조 변이(`emphasis`) 컬럼은 `010_tl_lab_emphasis.sql` 이 추가한다.
기대 강조 변이(`expected_emphasis`, frame 행) 컬럼은 `011_tl_lab_expected_emphasis.sql` 이 추가한다.
이 저장소의 구현 레인은 그 ALTER 를 실행하지 않는다.

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
