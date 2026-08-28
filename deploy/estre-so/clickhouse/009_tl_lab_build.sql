-- 009_tl_lab_build.sql
-- 기존 tl_lab.events 에 P1 클라이언트 배포 스탬프를 받을 컬럼을 추가한다.
-- 이 저장소에서는 실행하지 않는다. ClickHouse ALTER 뒤 릴레이를 교체한다.

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS build LowCardinality(String) DEFAULT '' AFTER kind;
