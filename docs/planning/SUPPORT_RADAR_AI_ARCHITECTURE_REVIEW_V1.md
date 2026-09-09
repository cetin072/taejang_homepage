# Support Radar AI Architecture Review v1

> 최신 중앙 기준: `cetin072/ai-development-system/main/docs/AI_INTEGRATION_ARCHITECTURE_STANDARD_V1.md`
> 중앙 문서 상태 표기: `v1 Draft`
> 이력: architecture-candidate Issue #21은 Pilot A/B 검증 후 목적 완료로 닫혔고, 후속 PR #23을 통해 위 v1 문서가 main에 병합됨.

## 1. 현재 구조와의 적합성

지원사업 레이더 Phase 1의 현재 구조는 중앙 v1의 `Deterministic by Default, AI by Necessity`와 자연스럽게 맞는다.

- 입력/저장/조회/권한/RLS/상태변경은 코드·DB가 담당
- 기업 프로필, 공고, 평가, 사람 결정, 담당자, 신청 진행, 결과는 Supabase/PostgreSQL authoritative ledger에 저장
- 명확한 금액·기한·자격·지역·우선분야 판정은 Rule Engine v1이 담당
- AI가 없어도 공고 등록, 조회, 결정적 평가, 신청관리, 긴급확인, KPI는 계속 동작
- 신청/보류/제외 최종결정과 Auth/RLS/중요 상태전이는 AI에 넘기지 않음

따라서 중앙 v1을 이유로 기존 Phase 1 구조를 재작성하지 않는다.

## 2. 4분류

### A. Deterministic Code
- 공식 API 호출 및 pagination
- 응답 스키마 검증
- 공고 원본 ID/URL/기관/날짜/금액 정규화
- 중복 후보 탐지
- 권한·RLS·감사로그
- 마감일 계산
- 금액 500만원 이상 여부
- 7일 내 마감 여부
- 태장 기업 프로필의 명확한 자격 보유/미보유 판정
- Rule Engine의 결정적 점수 부분
- 신청/보류/제외 및 진행상태 변경
- AI 작업 큐 상태 변경과 재시도 횟수

### B. Authoritative Ledger
- Source Registry
- source occurrence와 canonical notice
- 원문 URL/첨부 메타데이터
- 기업 프로필 version snapshot
- Rule Engine 평가 version
- 사람 검토/결정/담당자/신청 상태
- AI 검토 필요 여부 및 작업 큐
- AI 분석 결과 version/materialized result
- AI가 사용한 source/evaluation/profile/document version 또는 hash
- 생성시각, task/rule version, confidence, evidence/provenance

### C. Semantic AI
- 긴 공고문/첨부문서 의미 요약
- 복잡하거나 서술형인 지원대상 해석
- 태장 직접(A)/공동(B)/협력(C) 가능성의 설명 보강
- 여러 자격조건 사이의 관계 해석
- 태장에 필요한 확인질문 생성
- 유사 공고 간 실질적 차이 설명
- TOP 후보의 경영 브리핑
- 여러 공고의 우선순위/추천 이유 설명
- 문서 간 모순/누락 탐지

AI 결과는 최종 결재가 아니라 보조 판단이며 원장에 별도 version으로 저장한다.

### D. Realtime AI
현재 Phase 2 자동수집에는 필수 실시간 AI 기능이 없다.

우선 배치/예약 처리를 사용한다.
- 새 공고 수집 후 deterministic Rule Engine 즉시 실행
- 의미해석 필요 공고만 `AI_REVIEW_REQUIRED` 등 프로젝트 로컬 큐 상태로 등록
- 예약/배치에서 AI 처리
- 앱은 저장된 AI 결과를 조회·재사용

향후 사용자가 공고 상세에서 `지금 이 공고를 AI에게 추가 질문`하는 기능을 제품 요구로 확정할 때에만 실시간 AI를 별도 검토한다.

## 3. Phase 2 권장 흐름

```text
공식 Source API/RSS
  ↓
Netlify Function 또는 승인된 서버 수집기
  ↓
스키마 검증 / 정규화 / 중복후보
  ↓
Supabase authoritative ledger 저장
  ↓
Rule Engine v1 즉시 평가
  ↓
AI 필요 여부 결정
  ├─ 불필요 → 앱에서 즉시 사용
  └─ 필요 → AI_REVIEW_REQUIRED 큐
              ↓
          Batch / Scheduled AI
              ↓
      Materialized AI Result 저장
              ↓
          앱/주간보고 재사용
              ↓
        필요 시 별도 전달 계층
```

## 4. AI 입력 최소화

AI가 도입되더라도 authoritative ledger 전체를 넘기지 않는다.

- 해당 분석에 필요한 공고/문서 조각과 기업 프로필 필드만 전달
- API key, 인증정보, 비밀값 제외
- 불필요한 개인정보 제외
- 장애·건강·급여·인사 등 민감정보가 AI 업무에 필요하지 않으면 전달하지 않음
- 외부 AI/API 도입 시 데이터 전송·보존·권한 조건을 별도 승인 게이트에서 검토

AI 편의를 이유로 기존 RLS나 데이터 접근통제를 넓히지 않는다.

## 5. Freshness / Provenance

중앙 v1에서 두 Pilot의 공통 개선점으로 확인된 항목을 Support Radar에도 명시적으로 적용한다.

AI 결과는 단순 `generated_at`만으로 최신이라고 판단하지 않는다. 프로젝트 상황에 따라 다음 중 필요한 정보를 보존한다.

- `source_updated_at` snapshot
- source/document `content_hash` 또는 `input_hash`
- company profile version
- rule/task/model-task version
- result/evaluation version
- generated/evaluated timestamp
- evidence/provenance

공고 원문, 첨부문서 또는 기업 프로필이 바뀌어 기존 AI 결과의 입력이 달라졌다면:
- 기존 결과를 stale로 표시하거나
- 재평가 Queue에 등록하거나
- 새 result version을 만들고
- 중요한 경우 사람 재검토를 요청한다.

오래된 AI 결과를 최신 사실처럼 조용히 재사용하지 않는다.

## 6. 장애 격리

AI/API 장애가 다음 기능을 막아서는 안 된다.
- 기존 공고 조회
- 수동 공고 등록
- 기업 프로필 수정
- Rule Engine
- 사람 결정
- 담당자 배정
- 신청 진행상태
- 긴급확인/기한관리

Source API 실패, AI 생성 실패, 원장 저장 실패, 이메일/카카오 등 전달 실패는 가능한 범위에서 서로 분리 기록하고 재시도한다.

## 7. 비용·보안

- 현재 ChatGPT/Codex 포함 사용량과 무료/기존 서비스 범위를 우선
- 별도 OpenAI/Claude API를 기본 전제로 하지 않음
- 기업마당 `crtfcKey` 등 서비스키는 브라우저 JS에 노출하지 않음
- 서버 환경변수에서만 사용
- 외부 API key 발급/유료 서비스/Production secret 등록은 사용자 별도 승인 게이트
- 동일 공고를 앱 조회마다 AI 재분석하지 않음

## 8. 다음 구현 순서

1. Source 수집 공통 contract
2. 기업마당 fixture 기반 parser/normalizer 테스트
3. live key 없는 dry-run fixture ingestion
4. 수집 run / error / cursor 원장
5. canonical notice upsert 보호 RPC 또는 서버 전용 저장 경계
6. source/document freshness/hash 계약
7. 사용자 승인 후 기업마당 key 발급/환경변수 등록
8. staging live fetch 소량 검증
9. Rule Engine 자동연결
10. AI review queue + materialized result는 이후 별도 구현

## 9. 중앙 기준 변경 시

이 문서는 중앙 표준의 복사본이 아니다.

향후 AI 기능 기획·변경 시 이 문서나 과거 채팅 설명보다 먼저:
1. `cetin072/ai-development-system` main의 `docs/AI_INTEGRATION_ARCHITECTURE_STANDARD_V1.md`
2. 그 문서가 가리키는 최신 중앙 거버넌스/후속 문서
를 확인한다.

중앙 기준이 바뀌면 최신 내용을 우선하되, 기존 정상 시스템을 자동으로 재작성하지 않고 실제 효익과 충돌 여부를 다시 검토한다.
