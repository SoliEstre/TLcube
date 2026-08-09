# sites/ — 3사이트 정적 산출물

TLcube 는 도메인 세 개로 나뉜다. 전부 **정적 파일**이고 빌드 툴체인이 없다 — 그대로 서빙하면 된다.

| 도메인 | 루트 | 내용 |
|---|---|---|
| `tl.estre.so` | `sites/tl/` | 소개 허브 (+ `/i` 수집 엔드포인트) |
| `tlscan.estre.so` | `sites/tlscan/` | 스캐너 (1차 배포 = 랜딩) |
| `tlcube.estre.so` | `dist/trilume.html` | 생성기 — 단일 파일을 `index.html` 로 서빙 |

`sites/_shared/` 는 tl·tlscan 이 공유하는 CSS·JS 다. 생성기는 단일 파일 원칙 때문에 스타일을 인라인으로 갖고 있고, 이 공유분은 나머지 두 사이트만 쓴다.

## 배포

서버에서는 빌드 단계가 **없다**. `dist/trilume.html` 이 repo 에 커밋돼 있어서 Node 조차 필요 없다 — clone 한 것을 그대로 서빙하면 된다.

생성기 소스를 고쳤을 때만, **개발 머신에서** 다시 빌드해 커밋한다:

```bash
node tools/build-single.mjs      # dist/trilume.html 갱신 (생성기)
```

**Nginx·ClickHouse 설정과 절차는 [`deploy/`](../deploy/) 에 실제 파일로 있다** — `deploy/nginx.bootstrap.conf`(인증서 발급용 1회성) · `deploy/nginx.conf` · `deploy/clickhouse-init.sql` · `deploy/README.md`.

⚠ 인증서가 **먼저**, TLS conf 가 나중이다. 순서를 뒤집으면 nginx 가 설정 검증에서 실패한다 — 이유는 `deploy/README.md`.

⚠ **ClickHouse 는 `127.0.0.1` 에만 바인딩한다.** 8123 을 외부에 여는 것은 반복되는 사고 패턴이다 — INSERT-only 사용자여도 자격증명이 클라이언트로 나가는 구조 자체가 결격이다. 자격증명은 Nginx 가 주입하고, 클라이언트는 본문만 보낸다.

⚠ **자격증명을 이 repo 에 커밋하지 않는다.** 위 `$TL_CH_USER` / `$TL_CH_KEY` 는 서버 환경에서 주입한다.

## 수집 스탠스

- 페이로드 **내용은 수집하지 않는다**. 크기·종류 같은 메타만 남긴다.
- referrer 는 **도메인만** 남기고 전체 URL 은 저장하지 않는다.
- 세션 ID 는 `sessionStorage` 기반 **탭 수명 임시값**이다 — 영속 식별자가 아니고 쿠키를 쓰지 않는다.
- 엔드포인트가 없으면 비콘은 조용히 실패한다. 사이트 기능에는 영향이 없다.

## 크로스링크

세 사이트는 서로를 링크한다. 폴백 QR 이 `tlscan.estre.so` 로 들어오는 동선이 실작동 검증의 핵심 경로다.
