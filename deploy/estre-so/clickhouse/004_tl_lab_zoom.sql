-- 004_tl_lab_zoom.sql
-- live `tl_lab` 에 나중에 적용할 idempotent ALTER. 이 저장소에서는 실행하지 않는다.
--
-- 전제: relay/schema.sql 로 tl_lab.events 가 이미 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하다.
--
-- 적용 (사람/통합자 — 이 레인은 실행하지 않음):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/004_tl_lab_zoom.sql

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS zoom_requested Float32 DEFAULT 0 AFTER zoom,
    ADD COLUMN IF NOT EXISTS crop Float32 DEFAULT 1 AFTER zoom_requested,
    ADD COLUMN IF NOT EXISTS crop_requested Float32 DEFAULT 0 AFTER crop,
    ADD COLUMN IF NOT EXISTS effective_zoom Float32 DEFAULT 0 AFTER crop_requested,
    ADD COLUMN IF NOT EXISTS zoom_error String DEFAULT '' AFTER effective_zoom;
