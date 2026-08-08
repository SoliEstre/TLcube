# AGENTS.md — TLcube (public 코드 repo)

> **이 repo 는 공개 대상이다.** 커밋 메시지를 포함해 여기 쓰는 모든 것이 영구히 공개된다고 가정하고 작업한다.

---

## 이 repo 의 위치

TLcube 는 **private 개발문서 repo 안에 중첩된 독립 public repo** 다. 서브모듈이 아니다.

- 상위 private repo 가 SSoT (`../AGENTS.md`) — 규약·계획·스펙 초안·리스크가 거기 있다
- 이 repo 는 **구현과 공개 스펙만** 담는다
- 상위 repo 는 `.gitignore` 로 이 폴더를 무시한다. 바깥에서 `git add TLcube` 금지

git 조작은 항상 대상을 명시한다: `git -C TLcube <cmd>` (상위에서) 또는 이 폴더 안에서 직접.

## 여기 쓰면 안 되는 것

커밋 **전**에 상위 repo 의 `.agent/public-boundary.md` 승격 체크리스트를 통과시킨다. 요약:

- ❌ 미확정 TBD (확정 후 반영)
- ❌ 마일스톤 **킬 기준 · 중단 조건**
- ❌ 수익 · 가격 · 파트너 관련 서술
- ❌ 법무 판단 **과정** (결론인 `LICENSE` 만 허용)
- ❌ 내부 경로 · 자격증명 · 사설 URL
- ❌ 상위 repo 파일의 **복사본** (다시 쓴 것만)
- ❌ 위 항목이 새는 **커밋 메시지**

한 항목이라도 걸리면 상위 repo 에 두고 `../.agent/_questions/open/` 에 승격 질문을 연다.

## 외부 발행 게이트

**원격 추가 · push · repo 공개는 사용자 명시 승인 없이 수행하지 않는다.** 되돌릴 수 없다 — force-push 로 지워도 fork·캐시·아카이브에 남는다.

현재 원격 **없음**. 라이선스도 **미정** — 라이선스가 정해지기 전에 공개하지 않는다.

## 작업 규칙

- 언어: 문서·커밋 메시지 **한국어**, 코드 식별자 영문. **공개 README·스펙은 향후 영문 병기 검토** (미결정)
- 커밋 형식: `[태그] 제목` — `[Feat]` `[Fix]` `[Docs]` `[Style]` `[Refactor]` `[Chore]`
- `git commit -a` 금지 → 항상 `git add` → `git commit`
- 런타임 의존성 **0 원칙**. 추가는 중대 분기 결정 → 상위 repo 의 리서치 루프 + `docs/adr/`
- 설계 SSoT 는 상위 `SPEC.md`. **구현이 스펙과 어긋나면 스펙을 고치거나 구현을 고친다 — 조용히 벌어지게 두지 않는다**

## 모듈 배치 (M0 완료 시점)

```
index.html          ← ✅ 인코더 UI (개발용 — dev-server 로 연다. canvas 미리보기 + export)
dist/trilume.html   ← ✅ 생성물: 단일 파일 (blob-URL 로더, file:// 로 열림) — build-single 이 만든다
src/
  gfp.js            ← ✅ GF(211) 소수체 산술 (ADR 0001 — 표수≠2, 부호 실재)
  rs211.js          ← ✅ RS over GF(211) (체계적, BM+Chien+Forney, NSYM_TABLE 규범)
  base211.js        ← ✅ 3 digit ↔ 1 심볼 + 27B↔28심볼 청커 (불법값 211..215 소거 후보)
  lehmer.js         ← ✅ digit ↔ (T,L,R) 순위
  hexgrid.js        ← ✅ axial 격자 · rhombille 3면 분할 · 샘플 원판
  gf256.js/rs.js/base6.js ← ⚠ 사장(deprecated) — ADR 비교 기준·회귀 대조군. 수정 금지
  placement.js      ← ✅ 앵커 · 포맷 · 레퍼런스 배치 (T6) / bullseye.js ← ✅ 불스아이 형상 (T5)
  layout.js         ← ✅ 캐노니컬 scan order + 배치 파사드 (T8, sha256 와이어 계약)
  header.js         ← ✅ 페이로드 헤더 1B + 0x00 패딩 (SPEC §4.5)
  capacity.js       ← ✅ 버전별 용량 (GF(211) 심볼 회계) — SPEC §5.5 표의 생성원
  mask.js           ← ✅ m(q,r) 정수 해시형 (T4, 수정 금지) / formatinfo.js ← ✅ CRC-6 포맷 5digit (T7)
  encode.js         ← ✅ §7.1 파이프라인 통합: 텍스트 → 셀별 digit (T9)
  luminance.js      ← ✅ 휘도 프리셋 (slate 1종, Δmin 실측 0.182 ≥ 계약 0.12) (T9)
  scene.js          ← ✅ digit → 도형 목록 (canvas/래스터/SVG 공용 단일 진실) (T9)
  raster.js         ← ✅ 순수 결정적 래스터라이저 (서브샘플 박스 평균) (T9)
  verify.js         ← ✅ 렌더 자체 검증 — 원판 median 통계로 digit 왕복 (T9)
  png.js            ← ✅ 자체 PNG 인코더 (고정 허프만 + 거리-1 RLE, zlib 오라클 검증) (T10)
  svg.js            ← ✅ SVG 직렬화 (고정 소수 표기, 결정적) (T10)
tools/
  epsilon-harness.mjs ← ✅ ε_real 선행 측정 (ECC 불필요·임시 렌더러, T9 승격 금지 — 승격 안 함 이행)
  dev-server.mjs      ← ✅ 개발용 정적 서버 / build-single.mjs ← ✅ 단일 파일 생성기
decoder/            ← M1
test/               ← ✅ 테스트 (전 모듈 + 왕복 e2e + 결정성)
```

테스트: `npm test` (= `node --test`). **`node --test test/` 는 이 Node 에서 동작하지 않는다** —
인자를 glob 으로 해석해 매치 0 이 되고 `test` 를 모듈로 로드하려다 죽는다.

⚠ **SPEC §5.5 용량표는 `capacity.js` 의 생성물이다.** 손으로 고치지 마라 — `capacity.js` 를 고치고
생성 결과를 붙여넣는다. `test/capacity.test.js` 스냅샷이 무단 변경을 잡는다.

`render-*.js` 와 `style-presets.js` 는 **순서 + Δmin 계약만** 지키면 나머지는 자유다. 이 경계를 침범하지 않는다.
