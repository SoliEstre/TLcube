# deploy/ — 3사이트 배포

전부 정적 파일이다. 빌드 서버도, 런타임도 필요 없다. **서버에 Node 조차 필요 없다** —
생성기 산출물 `dist/trilume.html` 은 repo 에 커밋돼 있다.

## 필요한 것

| | |
|---|---|
| DNS | `tl` · `tlcube` · `tlscan` 서브도메인 A 레코드 — **인증서 발급 전에 먼저 떠 있어야 한다** (AAAA 를 쓸 거면 conf 의 IPv6 `listen` 주석도 함께 해제) |
| 웹서버 | Nginx (설정 제공) |
| TLS | certbot |
| (선택) | ClickHouse — 사용 이벤트 수집. **없어도 사이트는 정상 동작한다** |

## 순서

⚠ **인증서가 먼저, TLS conf 가 나중이다.** `deploy/nginx.conf` 는 `listen 443 ssl` +
`ssl_certificate` 를 갖고 있어서, 인증서 파일이 없는 상태로 올리면 nginx 가 설정 검증에서
바로 실패한다 (`no "ssl_certificate" is defined ...`). certbot 이 내부적으로 돌리는 검사도
같이 터지므로 "conf 먼저 깔고 certbot" 순서는 성립하지 않는다.

### 0. 먼저 확인 — 인증서가 이미 있는가

```bash
certbot certificates            # 서버에서
# 또는 밖에서: echo | openssl s_client -connect tl.estre.so:443 -servername tl.estre.so \
#              2>/dev/null | openssl x509 -noout -subject -ext subjectAltName
```

세 이름을 이미 커버하는 인증서(특히 **와일드카드**)가 있으면 **발급 단계를 통째로 건너뛴다.**
`*.estre.so` 같은 와일드카드가 있는데도 절차대로 `certbot` 을 돌리면, 이미 커버되는 이름에
대해 **중복 인증서**가 발급돼 갱신 표면만 하나 늘어난다. estre.so 는 실제로 이 경우다
(2026-08-10 실측: `CN=estre.so`, `SAN=*.estre.so, estre.so`).

### A. 인증서가 이미 있을 때 (2단계)

```bash
git clone https://github.com/SoliEstre/TLcube /srv/tlcube

cp deploy/nginx.conf /etc/nginx/sites-available/tlcube
# 인증서 경로 3쌍을 실제 lineage 로 교체 — 이름은 `certbot certificates` 로 확인, 추측 금지
sed -i 's#/etc/letsencrypt/live/tlcube/#/etc/letsencrypt/live/<실제lineage>/#g' \
  /etc/nginx/sites-available/tlcube
# TL_CH_USER / TL_CH_KEY 도 실제 값으로 교체 (수집을 쓸 때만)
ln -sf /etc/nginx/sites-available/tlcube /etc/nginx/sites-enabled/tlcube
nginx -t && systemctl reload nginx
```

### B. 인증서를 새로 받아야 할 때 (4단계)

```bash
# 1. 배치
git clone https://github.com/SoliEstre/TLcube /srv/tlcube

# 2. 부트스트랩 — ACME 챌린지만 받는 임시 conf 로 인증서를 발급받는다
mkdir -p /var/www/acme
cp deploy/nginx.bootstrap.conf /etc/nginx/sites-available/tlcube
ln -sf /etc/nginx/sites-available/tlcube /etc/nginx/sites-enabled/tlcube
nginx -t && systemctl reload nginx

certbot certonly --webroot -w /var/www/acme --cert-name tlcube \
  -d tl.estre.so -d tlcube.estre.so -d tlscan.estre.so
#    → 3개 SAN 을 가진 인증서 1장이 /etc/letsencrypt/live/tlcube/ 에 생긴다
#    ⚠ --cert-name 을 반드시 준다. 없으면 lineage 이름이 첫 -d 도메인에서 파생되는데,
#      동명 lineage 가 이미 있으면 조용히 `-0001` 이 붙어 nginx.conf 의 인증서 경로와
#      어긋난다. 이름을 못 박으면 그 분기가 아예 사라진다.

# 3. 본 설정 — 여기서부터 실제 서빙
cp deploy/nginx.conf /etc/nginx/sites-available/tlcube
#    TL_CH_USER / TL_CH_KEY 를 실제 값으로 교체 (수집을 쓸 때만)
nginx -t && systemctl reload nginx
```

### 공통 — (선택) 수집

```bash
clickhouse-client --multiquery < deploy/clickhouse-init.sql
#    파일 하단 주석의 INSERT 전용 사용자 생성 블록도 실행
```

소스를 고쳤을 때만 생성기를 다시 빌드한다 (서버가 아니라 **개발 머신에서**):

```bash
node tools/build-single.mjs      # dist/trilume.html 갱신 → 커밋
```

## 확인

```bash
curl -sI https://tl.estre.so      | head -1   # 200
curl -sI https://tlcube.estre.so  | head -1   # 200 — 생성기
curl -sI https://tlscan.estre.so  | head -1   # 200 — 폴백 QR 목적지

# 평문 → HTTPS 리다이렉트
curl -sI http://tl.estre.so | head -1         # 301

# 갱신 리허설 — 90일 뒤가 아니라 지금 깨져 있는지 본다
certbot renew --dry-run

# 수집 (설정했다면)
curl -s -X POST https://tl.estre.so/i \
  -H 'Content-Type: text/plain' \
  --data '{"site":"hub","event":"pageview","ts":"2026-01-01 00:00:00.000"}'
clickhouse-client -q "SELECT count() FROM tl_analytics.events"
```

## 왜 이 구성인가

- **`certbot --nginx` 를 쓰지 않는다.** 그 플러그인은 conf 를 제자리에서 재작성하면서
  주석과 서식을 날린다. 이 파일들의 주석은 설계 근거라서 보존 대상이다. 그래서
  발급은 `certonly --webroot` 로 분리하고 conf 는 사람이 소유한다.
- **ACME location 이 본 설정의 :80 블록에도 남아 있다.** webroot(HTTP-01)로 받은
  인증서의 갱신은 평문 80 을 타는데, 리다이렉트가 그것까지 삼키면 **90일 뒤에 조용히
  실패**한다. 그때는 이미 사이트가 죽은 뒤라서 발견이 가장 늦는 고장 유형이다.
  `location ^~` 로 우선권을 준다.
  (경로 A — 기존 **와일드카드**를 쓰는 경우는 대개 DNS-01 이라 이 경로를 타지 않는다.
  그래도 남겨둔다: 해가 없고, 나중에 HTTP-01 로 바뀌어도 그때 다시 안 겪는다.)
- **TLS 공통값을 http 레벨로 올리지 않는다.** 이 conf 는 `http{}` 안으로 include 되므로
  최상위 `ssl_protocols` 는 같은 서버의 **다른 사이트에도 적용된다**. estre.so 는 공용
  호스트라 server 블록마다 반복해서 blast radius 를 0 으로 둔다.
- **`listen 443 ssl http2;` 구형 표기를 쓴다.** nginx 1.25.1+ 는 `http2 on;` 을 권하지만
  구형(Debian 12 = 1.22, Ubuntu 24.04 = 1.24)에서 그 지시자는 **하드 실패**한다.
  반대로 구형 표기는 신형에서 경고에 그친다 — 어디서나 뜨는 쪽을 고른다.
- **ClickHouse 를 외부에 노출하지 않는다.** 8123 을 여는 것은 반복되는 사고 패턴이다.
  INSERT 전용 사용자여도 **자격증명이 클라이언트로 나가는 구조 자체가 결격**이다.
  Nginx 가 자격증명을 주입하고, 클라이언트는 본문만 보낸다.
- **INSERT 쿼리를 Nginx 설정에 고정한다.** 클라이언트는 `FORMAT JSONEachRow` 본문만
  보낼 수 있어 임의 SQL 이 원천 차단된다.
- **엔드포인트가 `/i` 다.** `analytics`·`collect`·`track`·`event` 같은 단어를 경로에 쓰면
  광고차단 필터가 패턴으로 잡는다.
- **클라이언트 배칭이 없다.** 이벤트당 요청 1개를 보내고 서버측 `async_insert=1` 이
  배칭한다. `wait_for_async_insert=0` 이라 브라우저 연결을 잡아두지 않는다 — 비콘은
  응답을 보지 않고 유실을 허용하는 것이 전제다.

## 수집 스탠스

- 페이로드 **내용은 수집하지 않는다**. 크기·종류 같은 메타만 남긴다.
- referrer 는 **도메인만** 남기고 전체 URL 은 저장하지 않는다.
- 세션 ID 는 `sessionStorage` 기반 **탭 수명 임시값**이다. 쿠키를 쓰지 않는다.
- 원본은 13개월 TTL 로 지워지고 일별 집계만 남는다.
- 엔드포인트가 없으면 비콘은 조용히 실패한다. **사이트 기능에는 영향이 없다.**
