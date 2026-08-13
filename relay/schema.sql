-- schema.sql — /lab/ 텔레메트리 ClickHouse DDL (계약 lab-telemetry.md §6)
--
-- 기존 tl_analytics.events / tlcube.events (계약이 말한 service_events_v1) 를
-- **재사용하지 않는다.** 프레임 루프는 행 수가 비콘과 차원이 달라 TTL·쿼터·테이블을
-- 따로 둔다. 이 파일만 적용하면 되고, deploy/** 는 건드리지 않는다.
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
    zoom        Float32 DEFAULT 0,
    ms_total    UInt32 DEFAULT 0,
    ms_proposal UInt32 DEFAULT 0,
    ms_verify   UInt32 DEFAULT 0,
    ms_format   UInt32 DEFAULT 0,
    ms_decode   UInt32 DEFAULT 0,
    stage       LowCardinality(String) DEFAULT '',
    ok          UInt8 DEFAULT 0,
    reason      String DEFAULT '',
    type        LowCardinality(String) DEFAULT '', -- 성공 시. 와이어 키는 cellPx → cell_px
    cell_px     Float32 DEFAULT 0,
    -- env/gen 본문과 frame 의 원본 JSON. 계약이 키를 닫지 않은 쪽을 잃지 않기 위함.
    body        String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
-- 저카디널리티 → 고카디널리티. 기존 events 표와 같은 자세.
ORDER BY (site, kind, sid, ts)
TTL toDateTime(ts) + INTERVAL 14 DAY DELETE;

-- frameShot 만. 실패 프레임 표본, 세션당 상한은 릴레이가 강제한다(계약 §5).
CREATE TABLE IF NOT EXISTS tl_lab.thumbnails
(
    v    UInt8,
    sid  String,
    site LowCardinality(String),
    ts   DateTime64(3, 'UTC'),
    seq  UInt32,
    w    UInt16,
    h    UInt16,
    png  String                                 -- data URI. 장변 ~96px 그레이스케일
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
