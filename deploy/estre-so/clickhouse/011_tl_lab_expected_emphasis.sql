-- 011 — 기대 축 ④ 중앙 강조 변이 열 (expected_emphasis, 2026-08-29)
-- live `tl_lab` 에 나중에 적용할 idempotent ALTER. 이 저장소에서는 실행하지 않는다.
--
-- 왜: 010(emphasis)은 gen 행에만 실린다 — 라이브 스캔 프레임과 붙일 조인 키가 없다
--   (스캐너는 config_id 를 싣지 않는다 — 2026-08-29 라이브 357프레임 실측 매칭 0/357).
--   프레임별 강조 변이 성공률을 재려면 frame 행의 expected 쪽에 축이 있어야 한다.
--   007(expected_outer_finder)과 같은 모양: 스캐너 시험판 «기대» 카드 → frame.expected
--   .centralN7Emphasis → relay expected_emphasis. 정본 폐쇄집합은
--   src/centralN7Emphasis.js CENTRAL_N7_EMPHASIS_MODES 에서 유도된다.
--
-- 값: 'default' | 'locator' | 'all' 폐쇄집합. 미선택(모름)·구버전 봉투는 빈 문자열.
--
-- 순서 (007·008·010 과 동일 규율): **이 ALTER 먼저, relay 배포 나중.**
--   (relay 를 안 바꾸고 이 ALTER 만 먼저 도는 것은 언제나 안전하다 — 컬럼이 빈 채 남는다.)
--
-- 전제: relay/schema.sql 로 tl_lab.events 가 있고, 010 까지 적용돼 있다.
-- 신규 설치는 relay/schema.sql 만으로 충분하다.
--
-- 적용 (사람/통합자 — 이 레인은 실행하지 않음):
--   clickhouse-client --multiquery \
--     < deploy/estre-so/clickhouse/011_tl_lab_expected_emphasis.sql

ALTER TABLE tl_lab.events
    ADD COLUMN IF NOT EXISTS expected_emphasis LowCardinality(String) DEFAULT '' AFTER expected_outer_finder;
