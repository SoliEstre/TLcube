# deploy/estre-so/ — estre.so 공용 호스트(Docker + Traefik)용 패키지

TLcube 3사이트를 estre.so 에 올리기 위한 재패키징본이다. **이쪽이 estre.so 배포의 정본**이고,
상위 `deploy/`(시스템 nginx + certbot)는 **단독 호스팅용**이다.

## 왜 별도 패키지인가

처음 보낸 배포 요청은 시스템 nginx + certbot 개별 발급이었는데, 이 호스트에서는 성립하지 않는다.
`estreso-agent` 가 짚어준 세 가지를 그대로 반영했다.

| 문제 | 이 패키지의 처리 |
|---|---|
| **포트 충돌** — Traefik 이 80/443 을 컨테이너로 점유. 시스템 nginx 를 같은 포트에 올리면 기존 서비스가 전부 죽는다 | 포트를 열지 않는다. `edge` 네트워크에 붙고 Traefik 라벨로만 노출 |
| **인증서 레이아웃** — Traefik 이 `acme.json`(named volume)으로 관리해 `/etc/letsencrypt/` 자체가 없을 수 있다 | 인증서를 참조하지 않는다. TLS 는 엣지에서 종료 |
| **개별 발급이 CT 로그에 서브도메인을 노출** | `certresolver` 를 쓰지 않는다. 기존 `*.estre.so` 와일드카드가 이미 덮는다 |

## 승인 범위 — 요청하는 것과 요청하지 않는 것

**요청**: `projects/tlcube/` 온보딩 + 컨테이너 3종 기동 (수집은 별도·선택).

**요청하지 않음** (판단 부담을 줄이려고 명시한다):

- DNS 레코드 신규·변경 — 와일드카드가 세 이름을 이미 덮는다 (외부 실측: 세 호스트 모두 HTTPS 응답)
- `certresolver` 신규 — 발급 요청 자체를 하지 않는다
- 공용 `compose.yml` · `dynamic.yml` 변경 — 손대지 않는다
- 공용 DB·백업 스코프 — 수집을 쓸 때만 `tlcube` DB 하나가 늘고, 그것도 별도 선택
- 컴퓨트 증설 — `nginx:alpine` 3개, 유휴 수십 MB 수준

## 올리기

```bash
# 콘텐츠 배치 — 전부 정적이고 dist/trilume.html 이 커밋돼 있어 빌드도 Node 도 없다
git clone https://github.com/SoliEstre/TLcube /srv/tlcube

# 사이트 3종
docker compose --env-file ~/.secrets/estre.so.env \
  -f compose.yml -f projects/tlcube/docker-compose.yml up -d
```

`projects/tlcube/docker-compose.yml` 은 이 저장소의
`deploy/estre-so/projects/tlcube/` 를 그대로 옮기거나 심볼릭 링크하면 된다.
콘텐츠 경로를 `/srv/tlcube` 가 아닌 곳에 두려면 `TLCUBE_SRC` 로 덮어쓴다.

### 갱신

```bash
git -C /srv/tlcube pull
docker compose --env-file ~/.secrets/estre.so.env \
  -f compose.yml -f projects/tlcube/docker-compose.yml restart tlcube-gen
```

⚠ **`tlcube-gen` 은 반드시 restart 해야 한다.** 나머지 둘(hub·scan)은 디렉터리를 마운트해서
`git pull` 만으로 즉시 반영되지만, gen 은 `dist/trilume.html` **파일 하나**를 마운트한다.
Docker 의 단일 파일 bind mount 는 **inode 에 묶이고**, `git pull` 은 제자리 수정이 아니라
새로 쓰고 rename 하므로 inode 가 바뀐다 → 컨테이너는 계속 **옛 파일을 서빙**한다.
증상이 "분명히 pull 했는데 안 바뀐다" 라서 원인을 찾기 어렵다.

### 수집(/i) — 선택

사이트와 **분리된 compose 파일**이다. 안 올리면 수집만 없고 사이트는 정상 동작하며,
`/i` 는 404 가 되고 비콘은 조용히 실패한다 (`sites/_shared/site.js` 가 그 전제로 쓰였다).

구조로 분리한 이유: nginx 는 `proxy_pass` 의 호스트명을 **기동 시점에** 해석해서, ClickHouse 가
없으면 `host not found in upstream` 으로 컨테이너가 안 올라온다. 정적 서빙과 한 컨테이너에
뒀다면 선택 기능 하나가 `tl.estre.so` 를 통째로 죽였을 것이다.

```bash
# 1. DB·유저 준비 (사람/main) — 비밀번호는 사람이 생성해 채운다
#    deploy/estre-so/clickhouse/001_tlcube_provisioning.sql

# 2. ~/.secrets/estre.so.env 에 추가
#    TLCUBE_INGEST_PASSWORD=<위에서 생성한 값>

# 3. 기동
docker compose --env-file ~/.secrets/estre.so.env \
  -f compose.yml \
  -f projects/tlcube/docker-compose.yml \
  -f projects/tlcube/docker-compose.ingest.yml up -d
```

ingest 계정은 `GRANT INSERT` 만 갖는다 (Estre Axes 선례와 동일). 자격증명은 nginx 가 주입하고
브라우저로 나가지 않으며, INSERT 쿼리가 설정에 고정돼 임의 SQL 이 원천 차단된다.

## 확인

```bash
curl -sI https://tl.estre.so      | head -1   # 200
curl -sI https://tlcube.estre.so  | head -1   # 200 — 생성기
curl -sI https://tlscan.estre.so  | head -1   # 200 — 폴백 QR 목적지

# 수집을 올렸다면
curl -s -X POST https://tl.estre.so/i -H 'Content-Type: text/plain' \
  --data '{"site":"hub","event":"pageview","ts":"2026-01-01 00:00:00.000"}'
```

⚠ 지금은 세 호스트 모두 **404** 다 (TLS 는 종료되는데 매칭 라우터가 없는 상태).
**404 → 200** 이 배포 성공 신호다.

## 파일

| | |
|---|---|
| `projects/tlcube/docker-compose.yml` | 사이트 3종 (hub · gen · scan) |
| `projects/tlcube/static.conf` | hub·scan 공용 정적 conf (`server_name` 없음 — Traefik 이 라우팅) |
| `projects/tlcube/docker-compose.ingest.yml` | 수집 — 선택, 별도 파일 |
| `projects/tlcube/ingest.conf.template` | `/i` conf. `${TL_CH_*}` 는 기동 시 주입 |
| `clickhouse/001_tlcube_provisioning.sql` | `tlcube` DB·테이블·INSERT 전용 유저 |

## 검증한 것 / 안 한 것

**검증함 — `docker compose config` 병합 통과 (2026-08-10).** 이 호스트의 실제 `compose.yml`
사본과 병합해 두 조합(사이트 3종 / +수집) 모두 렌더에 성공했다. 렌더 결과 실측:

- `Host(`tl.estre.so`)` · `Host(`tlcube.estre.so`)` · `Host(`tlscan.estre.so`)` — `ROOT_DOMAIN` 치환 정상
- 수집 라우터 = ``Host(`tl.estre.so`) && Path(`/i`)`` · `priority: 100`
- 네트워크 = 사이트는 `edge`, 수집은 `edge` + `analytics`, 둘 다 external
- 모든 bind mount 가 `ro`

**검증 못 함 — 런타임.** 이 워크스테이션은 Docker CLI 만 있고 데몬이 꺼져 있어
컨테이너를 실제로 띄워보지 못했다. 아래는 첫 기동 때 확인해 주면 좋겠다.

- **마운트 배치** — `_shared` 를 문서 루트 **안쪽에** 겹쳐 마운트한다. 문법은 표준이지만
  실물로 `curl https://tl.estre.so/_shared/site.js` 가 200 인지 봐 주면 확실하다.
- **템플릿 치환** — `NGINX_ENVSUBST_FILTER=^TL_CH_` 는 문서상 동작이고 이 태그에서 실행
  확인은 못 했다. 필터가 안 먹으면 `$request_method` 같은 nginx 변수가 빈 값으로 치환될 수
  있으니, 수집 컨테이너에서 `nginx -T` 로 렌더 결과를 한 번 봐 주면 확실하다.
- **라우터 우선순위 상대값** — `100` 으로 못 박은 것은 자동 계산(규칙 길이)에 의존하지
  않으려는 의도인데, 이 호스트의 다른 라우터와의 상대값까지는 확인하지 못했다.
