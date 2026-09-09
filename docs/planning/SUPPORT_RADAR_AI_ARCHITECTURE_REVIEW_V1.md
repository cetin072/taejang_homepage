# Support Radar AI Architecture Review v1

> 기준: 중앙 개발 거버넌스 `cetin072/ai-development-system` Issue #21
> 상태: 아키텍처 후보 적용 검토 기록. 중앙 강제 표준 아님.

## 1. 현재 구조와의 적합성

지원사업 레이더 Phase 1의 현재 구조는 중앙 Issue #21의 `Deterministic by Default, AI by Necessity` 후보 원칙과 자연스럽게 맞는다.

- 입력/저장/조회/권한/RLS/상태변경은 코드·DB가 담당
- 기업 프로필, 공고, 평가, 사람 결정, 담당자, 신청 진행, 결과는 Supabase/PostgreSQL 원장에 저장
- 명확한 금액·기한·자격·지역·우선분야 판정은 Rule Engine v1이 담당
- AI가 없어도 공고 등록, 조회, 결정적 평가, 신청관리, 긴급확인, KPI는 계속 동작

따라서 기존 Phase 1 구조를 재작성하지 않는다.

## 2. 4분류

### A. 코드가 처리해야 할 것
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

### B. 공식 데이터 원장에 저장할 것
- Source Registry
- source occurrence와 canonical notice
- 원문 URL/첨부 메타데이터
- 기업 프로필 version snapshot
- Rule Engine 평가 version
- 사람 검토/결정/담당자/신청 상태
- AI 검토 필요 여부 및 작업 큐
- AI 분석 결과 version
- AI가 사용한 source/evaluation/profile version
- 생성시각, 모델 작업 종류, confidence, 근거/확인질문

### C. AI가 처리하면 좋은 것
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

### D. 실시간 AI가 정말 필요한 것
현재 Phase 2 자동수집에는 필수 실시간 AI 기능이 없다.

우선 배치/예약 처리를 사용한다.
- 새 공고 수집 후 deterministic Rule Engine 즉시 실행
- 의미해석 필요 공고만 `AI_REVIEW_REQUIRED` 큐
- 하루 몇 차례 또는 지정 배치에서 AI 처리
- 앱은 저장된 AI 결과를 조회

향후 사용자가 공고 상세에서 `지금 이 공고를 AI에게 추가 질문`하는 기능을 원할 때에만 실시간 AI를 별도 검토한다.

## 3. Phase 2 권장 흐름

```text
공식 Source API/RSS
  ↓
Netlify Function 또는 승인된 서버 수집기
  ↓
스키마 검증 / 정규화 / 중복후보
  ↓
Supabase 공식 원장 저장
  ↓
Rule Engine v1 즉시 평가
  ↓
AI 필요 여부 결정
  ├─ 불필요 → 앱에서 즉시 사용
  └─ 필요 → AI_REVIEW_REQUIRED 큐
              ↓
          배치 AI 분석
              ↓
        AI 결과 version 저장
              ↓
          앱/주간보고 사용
```

## 4. 장애 격리

AI/API 장애가 다음 기능을 막아서는 안 된다.
- 기존 공고 조회
- 수동 공고 등록
- 기업 프로필 수정
- Rule Engine
- 사람 결정
- 담당자 배정
- 신청 진행상태
- 긴급확인/기한관리

Source API 실패와 AI 실패도 서로 분리 기록한다.

## 5. 비용·보안

- 현재 구독/무료 범위를 우선
- 별도 OpenAI/Claude API를 기본 전제로 하지 않음
- 기업마당 `crtfcKey` 등 서비스키는 브라우저 JS에 노출하지 않음
- 서버 환경변수에서만 사용
- 외부 API key 발급/유료 서비스/Production secret 등록은 사용자 별도 승인 게이트
- 동일 공고를 앱 조회마다 AI 재분석하지 않음

## 6. 다음 구현 순서

1. Source 수집 공통 contract
2. 기업마당 fixture 기반 parser/normalizer 테스트
3. 수집 run / error / cursor 원장
4. canonical notice upsert 보호 RPC 또는 서버 전용 저장 경계
5. live key 없이 dry-run fixture ingestion
6. 사용자 승인 후 기업마당 key 발급/환경변수 등록
7. staging live fetch 소량 검증
8. Rule Engine 자동연결
9. AI review queue는 이후 별도 구현

## 7. 중앙 Issue #21 변경 시

이 문서는 중앙 Issue #21의 복사본이 아니다. 향후 AI 기능 변경 시 과거 문서보다 `cetin072/ai-development-system` Issue #21 최신 내용을 먼저 확인한다.
