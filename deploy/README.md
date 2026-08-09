# deploy/ — 3사이트 배포

전부 정적 파일이다. 빌드 서버도, 런타임도 필요 없다.

## 필요한 것

| | |
|---|---|
| DNS | `tl` · `tlcube` · `tlscan` 서브도메인 A/AAAA 레코드 |
| 웹서버 | Nginx (예시 제공) |
| TLS | certbot 등 |
| (선택) | ClickHouse — 사용 이벤트 수집. **없어도 사이트는 정상 동작한다** |

## 순서

```bash
# 1. 배치
git clone https://github.com/SoliEstre/TLcube /srv/tlcube
cd /srv/tlcube && node tools/build-single.mjs      # dist/trilume.html 생성

# 2. Nginx
cp deploy/nginx.conf /etc/nginx/sites-available/tlcube
#    TL_CH_USER / TL_CH_KEY 를 실제 값으로 교체 (수집을 쓸 때만)
ln -s /etc/nginx/sites-available/tlcube /etc/nginx/sites-enabled/
certbot --nginx -d tl.estre.so -d tlcube.estre.so -d tlscan.estre.so
nginx -t && systemctl reload nginx

# 3. (선택) 수집
clickhouse-client --multiquery < deploy/clickhouse-init.sql
#    파일 하단 주석의 INSERT 전용 사용자 생성 블록도 실행
```

## 확인

```bash
curl -sI https://tl.estre.so      | head -1   # 200
curl -sI https://tlcube.estre.so  | head -1   # 200 — 생성기
curl -sI https://tlscan.estre.so  | head -1   # 200 — 폴백 QR 목적지

# 수집 (설정했다면)
curl -s -X POST https://tl.estre.so/i \
  -H 'Content-Type: text/plain' \
  --data '{"site":"hub","event":"pageview","ts":"2026-01-01 00:00:00.000"}'
clickhouse-client -q "SELECT count() FROM tl_analytics.events"
```

## 왜 이 구성인가

- **ClickHouse 를 외부에 노출하지 않는다.** 8123 을 여는 것은 반복되는 사고 패턴이다. INSERT 전용 사용자여도 **자격증명이 클라이언트로 나가는 구조 자체가 결격**이다. Nginx 가 자격증명을 주입하고, 클라이언트는 본문만 보낸다.
- **INSERT 쿼리를 Nginx 설정에 고정한다.** 클라이언트는 `FORMAT JSONEachRow` 본문만 보낼 수 있어 임의 SQL 이 원천 차단된다.
- **엔드포인트가 `/i` 다.** `analytics`·`collect`·`track`·`event` 같은 단어를 경로에 쓰면 광고차단 필터가 패턴으로 잡는다.
- **클라이언트 배칭이 없다.** 이벤트당 요청 1개를 보내고 서버측 `async_insert=1` 이 배칭한다. `wait_for_async_insert=0` 이라 브라우저 연결을 잡아두지 않는다 — 비콘은 응답을 보지 않고 유실을 허용하는 것이 전제다.

## 수집 스탠스

- 페이로드 **내용은 수집하지 않는다**. 크기·종류 같은 메타만 남긴다.
- referrer 는 **도메인만** 남기고 전체 URL 은 저장하지 않는다.
- 세션 ID 는 `sessionStorage` 기반 **탭 수명 임시값**이다. 쿠키를 쓰지 않는다.
- 원본은 13개월 TTL 로 지워지고 일별 집계만 남는다.
- 엔드포인트가 없으면 비콘은 조용히 실패한다. **사이트 기능에는 영향이 없다.**
