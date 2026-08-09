# sites/ — 3사이트 정적 산출물

TLcube 는 도메인 세 개로 나뉜다. 전부 **정적 파일**이고 빌드 툴체인이 없다 — 그대로 서빙하면 된다.

| 도메인 | 루트 | 내용 |
|---|---|---|
| `tl.estre.so` | `sites/tl/` | 소개 허브 (+ `/i` 수집 엔드포인트) |
| `tlscan.estre.so` | `sites/tlscan/` | 스캐너 (1차 배포 = 랜딩) |
| `tlcube.estre.so` | `dist/trilume.html` | 생성기 — 단일 파일을 `index.html` 로 서빙 |

`sites/_shared/` 는 tl·tlscan 이 공유하는 CSS·JS 다. 생성기는 단일 파일 원칙 때문에 스타일을 인라인으로 갖고 있고, 이 공유분은 나머지 두 사이트만 쓴다.

## 배포

```bash
node tools/build-single.mjs      # dist/trilume.html 갱신 (생성기)
```

정적 서빙이라 그 외 빌드 단계가 없다. `sites/` 를 그대로 올리고, 생성기는 `dist/trilume.html` 을 `tlcube.estre.so` 의 `index.html` 로 두면 된다.

### Nginx 예시

```nginx
# ── 소개 허브 + 수집 엔드포인트 ──────────────────────────────
server {
    server_name tl.estre.so;
    root /srv/tlcube/sites/tl;
    index index.html;

    # _shared 는 문서 루트 밖이므로 별도 alias
    location /_shared/ { alias /srv/tlcube/sites/_shared/; }

    # 수집 엔드포인트 — 경로에 analytics/collect/track/event 를 쓰지 않는다
    # (광고차단 필터가 그 단어를 경로 패턴으로 잡는다)
    location = /i {
        if ($request_method != POST) { return 405; }

        add_header Access-Control-Allow-Origin "$http_origin" always;
        add_header Vary Origin always;

        access_log off;

        # INSERT 쿼리를 **서버 설정에 고정**한다 — 클라이언트는 JSONEachRow 본문만
        # 보낼 수 있고 임의 SQL 은 원천 차단된다.
        proxy_set_header X-ClickHouse-User     "$TL_CH_USER";
        proxy_set_header X-ClickHouse-Key      "$TL_CH_KEY";
        proxy_pass http://127.0.0.1:8123/?async_insert=1&wait_for_async_insert=0&query=INSERT%20INTO%20tl_analytics.events%20FORMAT%20JSONEachRow;
    }
}

# ── 생성기 ──────────────────────────────────────────────────
server {
    server_name tlcube.estre.so;
    root /srv/tlcube/dist;
    location / { try_files /trilume.html =404; }
}

# ── 스캐너 ──────────────────────────────────────────────────
server {
    server_name tlscan.estre.so;
    root /srv/tlcube/sites/tlscan;
    index index.html;
    location /_shared/ { alias /srv/tlcube/sites/_shared/; }
}
```

⚠ **ClickHouse 는 `127.0.0.1` 에만 바인딩한다.** 8123 을 외부에 여는 것은 반복되는 사고 패턴이다 — INSERT-only 사용자여도 자격증명이 클라이언트로 나가는 구조 자체가 결격이다. 자격증명은 Nginx 가 주입하고, 클라이언트는 본문만 보낸다.

⚠ **자격증명을 이 repo 에 커밋하지 않는다.** 위 `$TL_CH_USER` / `$TL_CH_KEY` 는 서버 환경에서 주입한다.

## 수집 스탠스

- 페이로드 **내용은 수집하지 않는다**. 크기·종류 같은 메타만 남긴다.
- referrer 는 **도메인만** 남기고 전체 URL 은 저장하지 않는다.
- 세션 ID 는 `sessionStorage` 기반 **탭 수명 임시값**이다 — 영속 식별자가 아니고 쿠키를 쓰지 않는다.
- 엔드포인트가 없으면 비콘은 조용히 실패한다. 사이트 기능에는 영향이 없다.

## 크로스링크

세 사이트는 서로를 링크한다. 폴백 QR 이 `tlscan.estre.so` 로 들어오는 동선이 실작동 검증의 핵심 경로다.
