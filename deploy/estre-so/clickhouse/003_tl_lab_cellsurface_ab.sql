-- 003_tl_lab_cellsurface_ab.sql
-- live `tl_lab` 에 나중에 적용할 idempotent ALTER. 이 저장소에서는 실행하지 않는다.
--
-- 전제: relay/schema.sql 로 tl_lab.events 가 이미 있고,
-- 002_tl_lab_p0_instrumentation.sql 의 cs_* 컬럼이 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하다.
--
-- 적용 (사람/통합자 — 이 레인은 실행하지 않음):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/003_tl_lab_cellsurface_ab.sql

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS expected_locator String DEFAULT '' AFTER expected_qr,
    ADD COLUMN IF NOT EXISTS expected_locator_arm LowCardinality(String) DEFAULT '' AFTER expected_locator,
    ADD COLUMN IF NOT EXISTS observed_locator String DEFAULT '' AFTER observed_qr,
    ADD COLUMN IF NOT EXISTS observed_locator_arm LowCardinality(String) DEFAULT '' AFTER observed_locator,
    ADD COLUMN IF NOT EXISTS cs_arm LowCardinality(String) DEFAULT '' AFTER cs_profile,
    ADD COLUMN IF NOT EXISTS cs_expected_arm LowCardinality(String) DEFAULT '' AFTER cs_arm,
    ADD COLUMN IF NOT EXISTS cs_orientation_gate LowCardinality(String) DEFAULT '' AFTER cs_expected_arm,
    ADD COLUMN IF NOT EXISTS cs_orientation_gate_applied UInt8 DEFAULT 0 AFTER cs_orientation_gate,
    ADD COLUMN IF NOT EXISTS cs_ambiguous UInt8 DEFAULT 0 AFTER cs_orientation_gate_applied;
