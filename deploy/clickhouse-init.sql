-- clickhouse-init.sql — 사용 이벤트 수집 스키마
--
-- 수집 스탠스: 페이로드 **내용은 저장하지 않는다**. 크기·종류 같은 메타만 남긴다.
-- referrer 는 도메인만, 세션 ID 는 탭 수명 임시값(쿠키 없음).
--
-- 적용:  clickhouse-client --multiquery < deploy/clickhouse-init.sql

CREATE DATABASE IF NOT EXISTS tl_analytics;

CREATE TABLE IF NOT EXISTS tl_analytics.events
(
    site       LowCardinality(String),            -- 'tlcube' | 'tlscan' | 'hub'
    event      LowCardinality(String),            -- pageview | generate | export | fail | scan_ok | scan_fail | out
    ts         DateTime64(3, 'UTC'),
    path       String DEFAULT '',
    ref        LowCardinality(String) DEFAULT '', -- referrer 도메인만 (전체 URL 미저장)
    ua_browser LowCardinality(String) DEFAULT '', -- UA 힌트 (문자열 파싱 안 함)
    ua_os      LowCardinality(String) DEFAULT '',
    session    String DEFAULT '',                 -- sessionStorage 임시 ID — 영속 식별자 아님
    props      Map(LowCardinality(String), String) DEFAULT map()
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
-- 저카디널리티 → 고카디널리티 순. 시간을 앞세우지 않는다.
ORDER BY (site, event, toStartOfDay(ts))
TTL toDateTime(ts) + INTERVAL 13 MONTH DELETE;

-- 롤업 — 원본이 TTL 로 지워져도 일별 집계는 남는다.
CREATE TABLE IF NOT EXISTS tl_analytics.daily_stats
(
    date     Date,
    site     LowCardinality(String),
    event    LowCardinality(String),
    views    AggregateFunction(count),
    sessions AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (site, event, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS tl_analytics.daily_stats_mv
TO tl_analytics.daily_stats AS
SELECT toDate(ts) AS date, site, event,
       countState() AS views, uniqState(session) AS sessions
FROM tl_analytics.events
GROUP BY date, site, event;

-- INSERT 전용 사용자 — 자격증명은 Nginx 가 주입하고 클라이언트는 절대 보지 않는다.
-- 비밀번호는 실제 값으로 바꿔서 실행할 것 (이 파일에 적어 커밋하지 않는다).
--
-- CREATE USER IF NOT EXISTS tl_ingest IDENTIFIED BY '<암호>';
-- GRANT INSERT ON tl_analytics.events TO tl_ingest;
-- CREATE QUOTA IF NOT EXISTS tl_ingest_q FOR INTERVAL 1 hour MAX queries 20000 TO tl_ingest;

-- 확인 쿼리
-- SELECT site, event, count() FROM tl_analytics.events GROUP BY site, event ORDER BY count() DESC;
-- SELECT date, site, countMerge(views) v, uniqMerge(sessions) s FROM tl_analytics.daily_stats GROUP BY date, site ORDER BY date DESC LIMIT 30;
