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

## 모듈 배치 (예정)

```
index.html          ← M0: 단일 파일 인코더
src/
  gf256.js          ← ✅ GF(2⁸) 유한체 산술 (원시 다항식 0x11D)
  rs.js             ← ✅ Reed-Solomon (체계적, BM+Chien+Forney)
  base6.js          ← ✅ 64bit ↔ base-6 digit 25
  lehmer.js         ← ✅ digit ↔ (T,L,R) 순위
  hexgrid.js        ← ✅ axial 격자 · rhombille 3면 분할 · 샘플 원판
  layout.js         ← 불스아이 · 앵커 · 레퍼런스 · 데이터 셀 배치 맵
  header.js         ← 페이로드 헤더 (길이 필드) — 미설계
  mask.js           ← m(q,r)
  encode.js
  render-canvas.js
  render-svg.js
  style-presets.js  ← 휘도 배정 (순서 + Δmin 계약만 지키면 자유)
decoder/            ← M1
test/               ← 테스트 벡터 + 왜곡 하네스
```

테스트: `npm test` (= `node --test`). **`node --test test/` 는 이 Node 에서 동작하지 않는다** —
인자를 glob 으로 해석해 매치 0 이 되고 `test` 를 모듈로 로드하려다 죽는다.

⚠ `base6.js` 의 꼬리 청크 규약과 digit 순서·엔디안은 **SPEC 에 없는 본 구현의 단독 결정**이다
(소스 `[C5]` 참조). SPEC 승격 전까지 잠정이며, 공개 시 상호운용 문제가 된다.

`render-*.js` 와 `style-presets.js` 는 **순서 + Δmin 계약만** 지키면 나머지는 자유다. 이 경계를 침범하지 않는다.
