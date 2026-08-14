-- schema.sql — /lab/ 텔레메트리 ClickHouse DDL
--
-- 기존 tl_analytics.events / tlcube.events (계약이 말한 service_events_v1) 를
-- **재사용하지 않는다.** 프레임 루프는 행 수가 비콘과 차원이 달라 TTL·쿼터·테이블을
-- 따로 둔다. 이 파일만 적용하면 되고, deploy/** 는 건드리지 않는다.
--
-- 이미 tl_lab 이 있는 live DB 는 이 파일을 다시 실행하지 말고
-- deploy/estre-so/clickhouse/002_tl_lab_p0_instrumentation.sql 의 ALTER 를 쓴다.
--
-- 적용:  clickhouse-client --multiquery < relay/schema.sql
-- 되돌리기: README 의 DROP 순서.

CREATE DATABASE IF NOT EXISTS tl_lab;

-- env / gen / frame. frameShot 은 넣지 않는다 — 썸네일 테이블로 분리.
CREATE TABLE IF NOT EXISTS tl_lab.events
(
    v           UInt8,
    sid         String,                            -- 탭 수명 임시 ID (쿠키·영속 식별자 아님)
    site        LowCardinality(String),            -- 'gen' | 'scan'
    ts          DateTime64(3, 'UTC'),
    kind        LowCardinality(String),            -- 'env' | 'gen' | 'frame'
    -- 아래는 계약 §4 frame 본문. env/gen 은 DEFAULT 로 비고 body 만 채운다.
    seq         UInt32 DEFAULT 0,                  -- 스캔 시작부터 누적. 성공 프레임의 seq 가 본 질문
    w           UInt16 DEFAULT 0,
    h           UInt16 DEFAULT 0,
    zoom        Float32 DEFAULT 0,             -- 트랙 getSettings().zoom. 요청값이 아님
    zoom_requested Float32 DEFAULT 0,          -- applyConstraints 에 넣은 값. 미요청 0
    crop        Float32 DEFAULT 1,             -- 원본 대비 중앙 크롭 배율. 1 = 자르지 않음
    crop_requested Float32 DEFAULT 0,          -- 사용자가 요청한 크롭 배율
    effective_zoom Float32 DEFAULT 0,          -- (적용 zoom / native) * 적용 crop
    zoom_error  String DEFAULT '',             -- apply 거부·불일치. 성공은 빈 문자열
    ms_total    UInt32 DEFAULT 0,                  -- 프레임 벽시계. 단계 합과 같을 필요 없음
    ms_proposal Nullable(UInt32),                  -- 실측 구간만. 미측정은 NULL (total 복사 금지)
    ms_verify   Nullable(UInt32),
    ms_format   Nullable(UInt32),
    ms_decode   Nullable(UInt32),
    stage       LowCardinality(String) DEFAULT '',
    ok          UInt8 DEFAULT 0,
    reason      String DEFAULT '',                 -- 최종 실패 문자열. 호환 유지
    type        LowCardinality(String) DEFAULT '', -- 관측 type. 와이어 키는 cellPx → cell_px
    cell_px     Nullable(Float32),                 -- 실측 셀 크기(px). 미측정은 NULL. 거짓 0 금지
    attempt_id  String DEFAULT '',                 -- 한 스캔 시도. 카메라 세션 또는 사진 1장
    config_id   String DEFAULT '',                 -- 생성 설정 해시. 스캐너가 모르면 빈 문자열
    expected_type    LowCardinality(String) DEFAULT '',
    expected_version String DEFAULT '',
    expected_ecc     LowCardinality(String) DEFAULT '',
    expected_tones   Nullable(UInt8),
    expected_finder  String DEFAULT '',
    expected_qr      String DEFAULT '',
    expected_locator String DEFAULT '',
    expected_locator_arm LowCardinality(String) DEFAULT '', -- A | B. 셀 표면 로케이터 팔
    observed_type    LowCardinality(String) DEFAULT '',
    observed_version String DEFAULT '',
    observed_ecc     LowCardinality(String) DEFAULT '',
    observed_tones   Nullable(UInt8),
    observed_finder  String DEFAULT '',
    observed_qr      String DEFAULT '',
    observed_locator String DEFAULT '',
    observed_locator_arm LowCardinality(String) DEFAULT '', -- 디코더가 고른 팔
    chain_json       String DEFAULT '',            -- 원인 사슬 JSON
    chain_failed     LowCardinality(String) DEFAULT '',
    bbox_x      Nullable(Float32),                 -- 이미지 픽셀, 원점 좌상단
    bbox_y      Nullable(Float32),
    bbox_w      Nullable(Float32),
    bbox_h      Nullable(Float32),
    occupancy   Nullable(Float32),                 -- bbox 면적 / 프레임 면적
    clip_side   LowCardinality(String) DEFAULT '',
    rotation_deg Nullable(Float32),                -- 가설 rotationDegrees, 시계 방향
    perspective Nullable(Float32),                 -- 네 모서리 대각선비 - 1. 미측정 NULL
    residual_px Nullable(Float32),                 -- 호모그래피 재투영 잔차(px)
    cs_attempted UInt8 DEFAULT 0,                  -- 셀 표면 검출기를 이 프레임에서 돌렸는가
    cs_accepted  UInt8 DEFAULT 0,                  -- 검출기가 가설을 수락했는가
    cs_score     Nullable(Float32),                -- 셀 표면 agreement. 미시도 NULL
    cs_reason    String DEFAULT '',                -- 거절 사유. 미시도 빈 문자열
    cs_profile   LowCardinality(String) DEFAULT '', -- cell-surface-v1-A | cell-surface-v1-B
    cs_arm       LowCardinality(String) DEFAULT '', -- 관측 팔 A | B
    cs_expected_arm LowCardinality(String) DEFAULT '', -- 기대 팔. 없으면 빈 문자열
    cs_orientation_gate LowCardinality(String) DEFAULT '', -- applied | waived
    cs_orientation_gate_applied UInt8 DEFAULT 0, -- 1=방향 게이트 적용. A 는 0
    cs_ambiguous UInt8 DEFAULT 0,               -- 1=A·B 둘 다 맞아서 점수 높은 쪽을 택함
    -- env/gen 본문과 frame 의 원본 JSON. 계약이 키를 닫지 않은 쪽을 잃지 않기 위함.
    body        String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
-- 저카디널리티 → 고카디널리티. 기존 events 표와 같은 자세.
ORDER BY (site, kind, sid, ts)
TTL toDateTime(ts) + INTERVAL 14 DAY DELETE;

-- frameShot 만. 층화 표본, 세션당 상한은 릴레이가 강제한다.
CREATE TABLE IF NOT EXISTS tl_lab.thumbnails
(
    v    UInt8,
    sid  String,
    site LowCardinality(String),
    ts   DateTime64(3, 'UTC'),
    seq  UInt32,
    w    UInt16,
    h    UInt16,
    png  String,                                -- data URI. 장변 ~96px 그레이스케일
    attempt_id   String DEFAULT '',
    config_id    String DEFAULT '',
    reason       String DEFAULT '',
    stage        LowCardinality(String) DEFAULT '',
    shot_role    LowCardinality(String) DEFAULT '',
    chain_failed LowCardinality(String) DEFAULT '',
    bbox_x       Nullable(Float32),
    bbox_y       Nullable(Float32),
    bbox_w       Nullable(Float32),
    bbox_h       Nullable(Float32),
    occupancy    Nullable(Float32),
    clip_side    LowCardinality(String) DEFAULT '',
    rotation_deg Nullable(Float32),
    cell_px      Nullable(Float32)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (sid, ts, seq)
TTL toDateTime(ts) + INTERVAL 7 DAY DELETE;

-- INSERT 전용 사용자 — 자격증명은 릴레이 환경변수만 본다. 이 파일에 적어 커밋하지 않는다.
-- 클라이언트(브라우저)로는 절대 나가지 않는다. ClickHouse 는 127.0.0.1 유지.
--
-- CREATE USER IF NOT EXISTS tl_lab_ingest IDENTIFIED BY '<암호>';
-- GRANT INSERT ON tl_lab.events TO tl_lab_ingest;
-- GRANT INSERT ON tl_lab.thumbnails TO tl_lab_ingest;
-- -- 프레임 루프는 비콘보다 행이 많다. 비콘 2만/h 를 그대로 쓰면 정상 트래픽이 잘린다.
-- CREATE QUOTA IF NOT EXISTS tl_lab_ingest_q FOR INTERVAL 1 hour MAX queries 1000000 TO tl_lab_ingest;
