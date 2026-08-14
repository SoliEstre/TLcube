-- 002_tl_lab_p0_instrumentation.sql
-- live `tl_lab` 에 나중에 적용할 idempotent ALTER. 이 저장소에서는 실행하지 않는다.
--
-- 전제: relay/schema.sql 로 tl_lab.events / tl_lab.thumbnails 가 이미 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하고 이 파일을 다시 돌릴 필요는 없다
-- (ADD COLUMN IF NOT EXISTS / MODIFY COLUMN 이라 두 번 돌려도 안전하다).
--
-- 적용 (사람/통합자 — 이 레인은 실행하지 않음):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/002_tl_lab_p0_instrumentation.sql
--
-- 순서: 1) 릴레이를 새 코드로 교체하기 전에 ALTER 를 먼저 적용한다.
--       2) 그 다음 릴레이를 재시작한다. 반대면 새 컬럼 INSERT 가 거절될 수 있다.
--       3) 구 클라이언트는 새 컬럼을 안 보내도 DEFAULT/NULL 로 들어간다.
--
-- 위험: 기존 ms_* / cell_px 의 0 은 «미측정»과 «실제 0ms»를 구분하지 못한다.
--       MODIFY 뒤에도 옛 0 은 0 으로 남는다. 새 행만 NULL 을 쓴다.

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS attempt_id String DEFAULT '' AFTER cell_px,
    ADD COLUMN IF NOT EXISTS config_id String DEFAULT '' AFTER attempt_id,
    ADD COLUMN IF NOT EXISTS expected_type LowCardinality(String) DEFAULT '' AFTER config_id,
    ADD COLUMN IF NOT EXISTS expected_version String DEFAULT '' AFTER expected_type,
    ADD COLUMN IF NOT EXISTS expected_ecc LowCardinality(String) DEFAULT '' AFTER expected_version,
    ADD COLUMN IF NOT EXISTS expected_tones Nullable(UInt8) AFTER expected_ecc,
    ADD COLUMN IF NOT EXISTS expected_finder String DEFAULT '' AFTER expected_tones,
    ADD COLUMN IF NOT EXISTS expected_qr String DEFAULT '' AFTER expected_finder,
    ADD COLUMN IF NOT EXISTS observed_type LowCardinality(String) DEFAULT '' AFTER expected_qr,
    ADD COLUMN IF NOT EXISTS observed_version String DEFAULT '' AFTER observed_type,
    ADD COLUMN IF NOT EXISTS observed_ecc LowCardinality(String) DEFAULT '' AFTER observed_version,
    ADD COLUMN IF NOT EXISTS observed_tones Nullable(UInt8) AFTER observed_ecc,
    ADD COLUMN IF NOT EXISTS observed_finder String DEFAULT '' AFTER observed_tones,
    ADD COLUMN IF NOT EXISTS observed_qr String DEFAULT '' AFTER observed_finder,
    ADD COLUMN IF NOT EXISTS chain_json String DEFAULT '' AFTER observed_qr,
    ADD COLUMN IF NOT EXISTS chain_failed LowCardinality(String) DEFAULT '' AFTER chain_json,
    ADD COLUMN IF NOT EXISTS bbox_x Nullable(Float32) AFTER chain_failed,
    ADD COLUMN IF NOT EXISTS bbox_y Nullable(Float32) AFTER bbox_x,
    ADD COLUMN IF NOT EXISTS bbox_w Nullable(Float32) AFTER bbox_y,
    ADD COLUMN IF NOT EXISTS bbox_h Nullable(Float32) AFTER bbox_w,
    ADD COLUMN IF NOT EXISTS occupancy Nullable(Float32) AFTER bbox_h,
    ADD COLUMN IF NOT EXISTS clip_side LowCardinality(String) DEFAULT '' AFTER occupancy,
    ADD COLUMN IF NOT EXISTS rotation_deg Nullable(Float32) AFTER clip_side,
    ADD COLUMN IF NOT EXISTS perspective Nullable(Float32) AFTER rotation_deg,
    ADD COLUMN IF NOT EXISTS residual_px Nullable(Float32) AFTER perspective,
    ADD COLUMN IF NOT EXISTS cs_attempted UInt8 DEFAULT 0 AFTER residual_px,
    ADD COLUMN IF NOT EXISTS cs_accepted UInt8 DEFAULT 0 AFTER cs_attempted,
    ADD COLUMN IF NOT EXISTS cs_score Nullable(Float32) AFTER cs_accepted,
    ADD COLUMN IF NOT EXISTS cs_reason String DEFAULT '' AFTER cs_score,
    ADD COLUMN IF NOT EXISTS cs_profile LowCardinality(String) DEFAULT '' AFTER cs_reason;

ALTER TABLE tl_lab.events
    MODIFY COLUMN ms_proposal Nullable(UInt32),
    MODIFY COLUMN ms_verify Nullable(UInt32),
    MODIFY COLUMN ms_format Nullable(UInt32),
    MODIFY COLUMN ms_decode Nullable(UInt32),
    MODIFY COLUMN cell_px Nullable(Float32);

ALTER TABLE tl_lab.thumbnails
    ADD COLUMN IF NOT EXISTS attempt_id String DEFAULT '' AFTER png,
    ADD COLUMN IF NOT EXISTS config_id String DEFAULT '' AFTER attempt_id,
    ADD COLUMN IF NOT EXISTS reason String DEFAULT '' AFTER config_id,
    ADD COLUMN IF NOT EXISTS stage LowCardinality(String) DEFAULT '' AFTER reason,
    ADD COLUMN IF NOT EXISTS shot_role LowCardinality(String) DEFAULT '' AFTER stage,
    ADD COLUMN IF NOT EXISTS chain_failed LowCardinality(String) DEFAULT '' AFTER shot_role,
    ADD COLUMN IF NOT EXISTS bbox_x Nullable(Float32) AFTER chain_failed,
    ADD COLUMN IF NOT EXISTS bbox_y Nullable(Float32) AFTER bbox_x,
    ADD COLUMN IF NOT EXISTS bbox_w Nullable(Float32) AFTER bbox_y,
    ADD COLUMN IF NOT EXISTS bbox_h Nullable(Float32) AFTER bbox_w,
    ADD COLUMN IF NOT EXISTS occupancy Nullable(Float32) AFTER bbox_h,
    ADD COLUMN IF NOT EXISTS clip_side LowCardinality(String) DEFAULT '' AFTER occupancy,
    ADD COLUMN IF NOT EXISTS rotation_deg Nullable(Float32) AFTER clip_side,
    ADD COLUMN IF NOT EXISTS cell_px Nullable(Float32) AFTER rotation_deg;
