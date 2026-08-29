-- 010 — gen 강조 변이 열 (centralN7Emphasis, 2026-08-29)
-- live `tl_lab` 에 나중에 적용할 idempotent ALTER. 이 저장소에서는 실행하지 않는다.
--
-- 왜: 클라(lab-telemetry GEN_BODY_KEYS)는 gen 봉투에 centralN7Emphasis 를 이미 싣는데
--   relay 매핑과 이 컬럼이 없어 조용히 폐기됐다 (JSONEachRow + skip_unknown_fields=1 —
--   에러 없이 그 키만 사라진다). 라이브 스캔 프레임을 강조 변이별로 가르려면 gen 행에
--   이 열이 있어야 한다. frame 봉투는 이 키를 싣지 않는다 — frame 행은 config_id 로
--   gen 행과 조인해 변이를 얻는다.
--
-- 값: 'default' | 'locator' | 'all' 폐쇄집합. 구버전 봉투·frame/env 행은 빈 문자열.
--
-- 순서 (007·008 과 동일 규율): **이 ALTER 먼저, relay 배포 나중.**
--   (relay 를 안 바꾸고 이 ALTER 만 먼저 도는 것은 언제나 안전하다 — 컬럼이 빈 채 남는다.)
--
-- 전제: relay/schema.sql 로 tl_lab.events 가 있고, 009 까지 적용돼 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하다.
--
-- 적용 (사람/통합자 — 이 레인은 실행하지 않음):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/010_tl_lab_emphasis.sql

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS emphasis LowCardinality(String) DEFAULT '' AFTER config_id;
