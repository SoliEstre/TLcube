-- 008 — 관측 외곽/코너 파인더 열 (F-65 · 패키지 2, 2026-08-23)
--
-- 왜: 기대 축 ③(expected_outer_finder, 007)은 있는데 관측 짝이 없어
--   expected_outer ↔ observed 조인이 원리적으로 불가능했고, daehan 검출은
--   중앙 열(observed_finder='oak-daehan-k*')로 새서 중앙 파인더 순위표를
--   오염시켰다. 클라(SCANNER_BUILD 2026-08-23.03+)는 이제 daehan 을
--   observed.outerFinderId='daehan' 으로 싣는다 — k 는 포함 사슬(k6 ⊂ k8 ⊂ k10)
--   이라 검출이 못 가르므로 축 키까지만.
--
-- 순서 (007 과 동일 규율): **이 ALTER 먼저, relay 배포 나중.**
--   (relay 를 안 바꾸고 이 ALTER 만 먼저 도는 것은 언제나 안전하다 — 컬럼이 빈 채 남는다.)
--
-- 전제: relay/schema.sql 로 tl_lab.events 가 있고, 007 까지 적용돼 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하다.
--
-- 적용 (사람/통합자):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/008_tl_lab_observed_outer.sql

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS observed_outer_finder LowCardinality(String) DEFAULT '' AFTER observed_locator_layout;
