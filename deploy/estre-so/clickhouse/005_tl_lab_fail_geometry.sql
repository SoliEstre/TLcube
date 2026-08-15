-- 005_tl_lab_fail_geometry.sql
-- live `tl_lab` 에 나중에 적용할 idempotent ALTER. 이 저장소에서는 실행하지 않는다.
--
-- 전제: relay/schema.sql 로 tl_lab.events 가 이미 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하다.
--
-- 실패 프레임에도 추정 가능한 지점까지의 기하를 남긴다.
-- cell_px / bbox / occupancy 는 기존 Nullable 컬럼을 그대로 쓴다 (거짓 0 금지).
-- 이 파일이 더하는 것은 「어디서 끊겼는지」와 「어느 경로인지」뿐이다.
--
-- 적용 (사람/통합자 — 이 레인은 실행하지 않음):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/005_tl_lab_fail_geometry.sql

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS geo_stage LowCardinality(String) DEFAULT '' AFTER residual_px,
    ADD COLUMN IF NOT EXISTS detect_path LowCardinality(String) DEFAULT '' AFTER geo_stage;
