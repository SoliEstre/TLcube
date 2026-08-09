-- TLcube 애널리틱스 provisioning — estre.so 공용 ClickHouse(shared/clickhouse/)용.
--
-- 이 호스트의 관례를 따른다: 서버는 하나, DB 는 사이트별로 분리, 공개 노출 없음(analytics 내부망).
-- 사이트 격리는 컨테이너가 아니라 **ClickHouse 권한**으로 한다.
--
-- 실행 (사람/main — 좌석 경계 밖):
--   docker compose --env-file ~/.secrets/estre.so.env \
--     -f shared/clickhouse/docker-compose.yml exec -T clickhouse \
--     clickhouse-client --multiquery < deploy/.../001_tlcube_provisioning.sql
--
-- ⚠ 아래 <비밀번호> 는 **사람이 생성해서** 채운다. 생성한 값은 저장소가 아니라
--   ~/.secrets/estre.so.env 의 TLCUBE_INGEST_PASSWORD 에 넣는다 (수집 컨테이너가 거기서 읽는다).
--
-- 수집 스탠스: 페이로드 **내용은 저장하지 않는다**. 크기·종류 같은 메타만 남긴다.
--   referrer 는 도메인만, 세션 ID 는 탭 수명 임시값(쿠키 없음).

CREATE DATABASE IF NOT EXISTS tlcube;

CREATE TABLE IF NOT EXISTS tlcube.events
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
CREATE TABLE IF NOT EXISTS tlcube.daily_stats
(
    date     Date,
    site     LowCardinality(String),
    event    LowCardinality(String),
    views    AggregateFunction(count),
    sessions AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (site, event, date);

CREATE MATERIALIZED VIEW IF NOT EXISTS tlcube.daily_stats_mv
TO tlcube.daily_stats AS
SELECT toDate(ts) AS date, site, event,
       countState() AS views, uniqState(session) AS sessions
FROM tlcube.events
GROUP BY date, site, event;

-- ── ingest 계정 ────────────────────────────────────────────────────────────
-- **INSERT 만** 준다. Estre Axes 선례와 같은 자세다 — 수집 컨테이너가 하는 일은 한 줄
-- 넣는 것뿐이라 SELECT·DDL 권한은 침해 시 피해만 넓힌다. 조회는 관리자 계정으로 한다.
CREATE USER IF NOT EXISTS tlcube_ingest IDENTIFIED WITH sha256_password BY '<비밀번호>';
GRANT INSERT ON tlcube.events TO tlcube_ingest;

-- 비콘 유실을 허용하는 설계라 쿼터는 넉넉히 두되 상한은 둔다.
CREATE QUOTA IF NOT EXISTS tlcube_ingest_q FOR INTERVAL 1 hour MAX queries 20000 TO tlcube_ingest;

-- ── 확인 쿼리 (관리자 계정으로) ────────────────────────────────────────────
-- SELECT site, event, count() FROM tlcube.events GROUP BY site, event ORDER BY count() DESC;
-- SELECT date, site, countMerge(views) v, uniqMerge(sessions) s
--   FROM tlcube.daily_stats GROUP BY date, site ORDER BY date DESC LIMIT 30;
