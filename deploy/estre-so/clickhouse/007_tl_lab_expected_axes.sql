-- 007_tl_lab_expected_axes.sql
-- live `tl_lab` 에 나중에 적용할 idempotent ALTER. 이 저장소에서는 실행하지 않는다.
--
-- 왜 (2026-08-19, 운영자 실기기 피드백): 시험판 「기대」 선택이 축 셋으로 갈렸다.
--   ① 셀 표면 레이아웃 → expected_locator_layout  (006 에서 이미 있다)
--   ② 중앙 파인더       → expected_finder          (002 부터 이미 있다 — 새 컬럼 없음)
--   ③ 외곽/코너 파인더  → expected_outer_finder    (**이 파일이 더하는 유일한 컬럼**)
--
-- ②가 컬럼을 안 늘리는 이유: `expected_finder` 는 처음부터 «중앙 파인더 패턴 id» 였고
-- 관측 쪽(`observed_finder`)과 짝이다. 지금까지 기대 쪽을 아무도 안 채웠을 뿐이다.
-- 새 컬럼을 파면 같은 뜻의 컬럼이 둘이 되고, 그날부터 어느 쪽이 정본인지 물어야 한다.
--
-- ⚠ **적용 순서가 있다.** 이 ALTER 를 **먼저** 돌리고, 그다음에 `expected_outer_finder`
--   를 쓰는 relay 를 배포하라. 순서가 뒤집히면 relay 가 테이블에 없는 컬럼을 담은
--   JSONEachRow 를 밀어 넣게 되고, ClickHouse 설정에 따라 **인제스트가 통째로 실패**한다.
--   (relay 를 안 바꾸고 이 ALTER 만 먼저 도는 것은 언제나 안전하다 — 컬럼이 빈 채 남는다.)
--
-- 전제: relay/schema.sql 로 tl_lab.events 가 있고, 006 까지 적용돼 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하다.
--
-- 적용 (사람/통합자 — 이 레인은 실행하지 않음):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/007_tl_lab_expected_axes.sql

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS expected_outer_finder LowCardinality(String) DEFAULT '' AFTER expected_locator_layout;
