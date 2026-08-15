-- 006_tl_lab_cellsurface_layouts.sql
-- live `tl_lab` 에 나중에 적용할 idempotent ALTER. 이 저장소에서는 실행하지 않는다.
--
-- 전제: relay/schema.sql 로 tl_lab.events 가 이미 있고,
-- 003 의 cs_arm / expected_locator_arm 컬럼이 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하다.
--
-- 적용 (사람/통합자 — 이 레인은 실행하지 않음):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/006_tl_lab_cellsurface_layouts.sql

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS expected_locator_layout LowCardinality(String) DEFAULT '' AFTER expected_locator_arm,
    ADD COLUMN IF NOT EXISTS observed_locator_layout LowCardinality(String) DEFAULT '' AFTER observed_locator_arm,
    ADD COLUMN IF NOT EXISTS cs_layout LowCardinality(String) DEFAULT '' AFTER cs_expected_arm,
    ADD COLUMN IF NOT EXISTS cs_expected_layout LowCardinality(String) DEFAULT '' AFTER cs_layout;
