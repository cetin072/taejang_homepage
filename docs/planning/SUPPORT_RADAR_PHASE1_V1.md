# 태장 지원사업 레이더 Phase 1 기획 v1

Status: **확정 기획 초안 — Issue #161 기준, 구현 전 사용자 검토 대상**  
Parent Issue: #161  
Scope: 기획·데이터 계약·권한·화면·검수 기준만 정의. 이 문서 자체로 DB migration, Production 배포, 외부 API 연결을 수행하지 않는다.

---

## 1. 목적

태장 지원사업 레이더는 단순한 공고 검색기가 아니다.

핵심 흐름은 다음과 같다.

> 공고 발견 → 원문·첨부 보존 → 태장 기업 Profile 비교 → 신청 가능성 판정 → 태장 적합도 산정 → 중요 공고 선별 → 운영총괄 결정 → 담당자 배정 → 신청 진행 → 결과·수혜이력 보존

최우선 목표는 **태장이 실제로 신청하거나 참여할 수 있는 중요한 지원사업을 놓치지 않는 것**이다.

핵심 KPI는 공고 수집량이 아니라 다음이다.

1. 시스템 때문에 새로 발견한 신청가능 사업 수
2. 실제 신청 건수
3. 선정 건수
4. 확보 지원금 총액
5. 확보 현물 가치
6. 놓친 중요공고 수
7. 공고 발견부터 운영 검토까지 걸린 시간

---

## 2. 기존 태장 업무플랫폼과의 통합 원칙

지원사업 레이더는 별도 제품으로 만들지 않고 기존 태장 업무플랫폼 안의 독립 모듈로 추가한다.

### 재사용

- `/staff/` 로그인
- `/app/` App Shell과 역할별 메뉴 구조
- Supabase Auth
- 기존 Profile / Employee 연결 구조
- 기존 Department / Position / Role
- RLS / RPC 패턴
- `audit_logs`
- Netlify Functions
- 기존 테스트 및 기능 브랜치 / Draft PR 흐름

### 새로 만들지 않는 것

- 지원사업 레이더 전용 별도 로그인
- 지원사업 담당자 전용 사용자 DB
- 기존 Employee와 중복되는 담당자 마스터
- 별도 프론트엔드 프레임워크
- 별도 저장소

### 장애 경계

공개 홈페이지는 기존 Static by Default 원칙을 유지한다. 지원사업 레이더 장애가 공개 홈페이지 핵심 정보 표시와 연결 동선을 막아서는 안 된다.

---

## 3. 태장 판정 기준 Profile v1

### 3.1 기본 사실

- 법인명: 농업회사법인 태장 주식회사
- 법인형태: 주식회사
- 농업회사법인: 해당
- 자회사형 장애인표준사업장: 해당
- 장애인 고용기업: 해당
- 업종: 농업, 제조업
- 중소기업확인서: 현재 미보유
- 현재 수혜사업: 장애인고용공단 고용장려금
- 협력기관: 현재 미지정

### 3.2 지역

판정 대상 사업장은 최소 두 곳을 포함한다.

1. 경상남도 창원시 의창구 사업장
2. 경상남도 창원시 마산합포구 진전면 농장

지역조건 판정은 `회사 주소 문자열` 하나로 끝내지 않고 사업장별 행정구역과 용도를 따로 저장한다.

권장 속성:

- `province`
- `city`
- `district`
- `eup_myeon`
- `site_type`
- `rural_area`
- `active`
- `verified_at`

### 3.3 지원사업 관련 자격 상태

지원자격은 boolean 하나로 저장하지 않는다.

권장 상태:

- `valid`: 현재 유효하게 보유
- `missing`: 현재 미보유
- `planned`: 취득 계획 또는 가능성 있음
- `expired`: 과거 보유했으나 만료
- `not_applicable`: 해당 없음
- `unknown`: 확인 필요

추가 속성:

- `obtainable`
- `estimated_days_to_obtain`
- `valid_from`
- `valid_until`
- `verified_at`
- `evidence_summary`

예: 중소기업확인서는 `missing`으로 저장하되 향후 취득 가능성을 별도로 표현한다.

### 3.4 사업 분야

초기 사업영역은 최소 다음을 태그로 관리한다.

- 농업
- 제조
- 장애인 고용
- 장애인 직무개발
- 원예
- 농식품
- 민화
- 문화예술
- 공예
- 환경정비
- ESG
- AI·디지털
- 교육
- 판로·유통
- 홍보·마케팅

향후 사업이 늘어날 때 평가 Prompt나 코드 상수를 직접 고치기보다 Profile 데이터를 확장하는 구조를 우선한다.

---

## 4. Source Registry 계약

지원사업 공고보다 먼저 `정보원` 자체를 관리대상으로 둔다.

### 4.1 `support_sources`

권장 필드:

- `id`
- `code`
- `name`
- `organization_name`
- `base_url`
- `scope`
- `access_method`
- `official_source`
- `api_auth_required`
- `terms_review_status`
- `automation_status`
- `priority`
- `active`
- `last_checked_at`
- `last_success_at`
- `last_error_summary`
- `notes`
- `created_at`
- `updated_at`

### 4.2 접근방식 enum

`access_method`

- `api`
- `rss`
- `open_data`
- `public_search`
- `html`
- `manual`

### 4.3 자동접근 검토상태

`terms_review_status`

- `unreviewed`
- `allowed`
- `restricted`
- `prohibited`
- `unknown`

`automation_status`

- `manual_only`
- `ready`
- `enabled`
- `paused`
- `error`

Phase 1에서는 Source Registry를 만들되 대규모 자동수집은 하지 않는다.

### 4.4 초기 조사 우선군

- 기업마당
- 한국장애인고용공단
- e나라도움 / 국고보조금 공모정보
- 경상남도 기업·지원사업 채널
- 창원시 지원사업 공고
- 농업·농식품 관련 중앙·지역 지원정보
- 문화·예술 관련 공모기관

각 Source는 공식 API → RSS/공식 공개데이터 → 공개검색 → 이용조건을 확인한 HTML 수집 → 수동등록 순으로 접근한다.

---

## 5. 공고 데이터 모델 계약

같은 지원사업이 여러 정보원에 반복 게시될 수 있으므로 `정규화된 공고`와 `Source에서 발견된 게시물`을 분리한다.

### 5.1 `support_notices`

하나의 실제 지원사업을 나타내는 대표 레코드.

권장 필드:

- `id`
- `title`
- `managing_organization`
- `implementing_organization`
- `canonical_url`
- `announced_at`
- `application_start_at`
- `deadline_at`
- `notice_status`
- `cash_support_min`
- `cash_support_max`
- `cash_support_description`
- `in_kind_available`
- `in_kind_description`
- `estimated_in_kind_value`
- `self_funding_required`
- `self_funding_rate`
- `self_funding_description`
- `target_regions`
- `categories`
- `eligibility_summary`
- `application_process_summary`
- `duplicate_support_rule`
- `contact_summary`
- `first_discovered_at`
- `source_updated_at`
- `created_at`
- `updated_at`
- `archived_at`

`notice_status` 권장값:

- `upcoming`
- `open`
- `closed`
- `cancelled`
- `unknown`

공고 자체 상태와 태장의 신청 진행상태를 섞지 않는다.

### 5.2 `support_notice_occurrences`

Source별 실제 게시물을 보존한다.

권장 필드:

- `id`
- `notice_id`
- `source_id`
- `source_notice_id`
- `source_url`
- `raw_title`
- `raw_payload`
- `content_hash`
- `discovered_at`
- `last_seen_at`
- `source_published_at`
- `source_updated_at`

동일 지원사업이 기업마당·지자체·원기관에 동시에 존재해도 `support_notices`는 한 건으로 유지할 수 있어야 한다.

### 5.3 중복 판정 v1

Phase 1에서는 자동 병합을 과도하게 하지 않는다.

중복 후보 판단 신호:

1. 원기관 공고 ID 일치
2. canonical URL 일치
3. 사업명 + 기관 + 마감일 강한 일치
4. 제목 유사도 + 지원기간 + 지원금액 조합

불확실한 경우 자동 병합하지 않고 `duplicate_candidate`로 표시해 운영자가 확인한다.

---

## 6. 첨부 문서 계약

### `support_documents`

권장 필드:

- `id`
- `notice_id`
- `occurrence_id`
- `document_type`
- `original_filename`
- `source_url`
- `storage_path`
- `mime_type`
- `content_hash`
- `parse_status`
- `parsed_text`
- `parse_error_summary`
- `parsed_at`
- `created_at`

`parse_status`:

- `not_requested`
- `queued`
- `parsed`
- `unsupported`
- `failed`

Phase 1에서는 원문 URL·첨부 존재·파일 메타데이터 보존을 우선한다. PDF/HWP 자동해석은 후속 Phase로 둔다.

---

## 7. 회사 Profile 데이터 모델

### 7.1 `support_company_profiles`

지원사업 판정용 회사 Snapshot을 관리한다.

권장 필드:

- `id`
- `version`
- `company_name`
- `corporation_type`
- `agricultural_corporation`
- `subsidiary_standard_workplace`
- `disabled_employment_company`
- `industries`
- `current_benefit_summary`
- `valid_from`
- `valid_until`
- `is_current`
- `verified_at`
- `created_by_profile_id`
- `created_at`

평가 시 당시 사용한 Profile 버전을 반드시 남긴다.

### 7.2 `support_company_locations`

한 회사 Profile에 여러 사업장/농장을 연결한다.

### 7.3 `support_company_qualifications`

인증·확인서·등록·자격을 관리한다.

### 7.4 `support_company_business_areas`

현재 및 확장 사업분야를 관리한다.

---

## 8. 신청 가능성 A/B/C 판정 계약

모든 공고는 세 경로를 각각 판정한다.

### A. 직접 신청

`direct_eligibility`

### B. 공동신청

`joint_eligibility`

### C. 협력기관 활용

`partner_eligibility`

각 값은 다음 중 하나:

- `eligible`
- `conditional`
- `ineligible`
- `verify`

추가 저장값:

- `recommended_application_mode`: `direct | joint | partner | none | verify`
- `taejang_possible_role`
- `qualification_gaps`
- `questions_to_confirm`

비영리법인 전용 사업도 직접신청 불가만으로 버리지 않는다.

예:

> 직접신청: ineligible  
> 공동신청: conditional  
> 협력기관: conditional  
> 태장 역할: 장애인 고용·원예 프로그램 수행기관  
> 확인사항: 주관기관 자격과 컨소시엄 허용 조항

---

## 9. 태장 적합도 평가 계약

### 9.1 평가 구조

`Rule Engine → AI 해석/보완 → 사람 최종결정`

Rule Engine은 가능한 한 다음 사실조건을 먼저 처리한다.

- 지역
- 법인형태
- 업종
- 필수 인증·확인서
- 기업규모
- 공고 마감 여부
- 중복지원 제한
- 지원분야
- 지원규모
- 자부담

LLM/AI는 애매한 조건, 전략적 연관성, 공동·협력 참여 가능성, 수행역할, 확인질문 등의 해석에 사용한다.

### 9.2 100점 배점 v1

| 영역 | 최대점수 |
| --- | ---: |
| 신청자격·조건 충족 | 30 |
| 태장 사업·전략 연관성 | 20 |
| 지원금·현물 경제가치 | 15 |
| 실행·준비 가능성 | 15 |
| 선정 가능성 | 10 |
| 시급성·희소성·전략가치 | 10 |
| 합계 | 100 |

최우선 분야 `인건비·고용 / 문화 / 원예 / AI·디지털`은 전략 연관성 판단에서 가중하되 자격 불일치를 무시할 수는 없다.

### 9.3 `support_evaluations`

권장 필드:

- `id`
- `notice_id`
- `company_profile_id`
- `evaluation_version`
- `evaluation_method`
- `overall_score`
- `eligibility_score`
- `strategic_fit_score`
- `economic_value_score`
- `execution_score`
- `selection_score`
- `urgency_score`
- `direct_eligibility`
- `joint_eligibility`
- `partner_eligibility`
- `recommended_application_mode`
- `recommendation`
- `recommendation_reason`
- `qualification_gaps`
- `questions_to_confirm`
- `next_action`
- `confidence`
- `evidence`
- `evaluated_at`
- `evaluated_by`

`evaluation_method` 예:

- `rules_only`
- `rules_plus_ai`
- `human_override`

`confidence`:

- `high`
- `medium`
- `low`

### 9.4 AI 결과 보존 원칙

최신 평가 결과로 과거 평가를 UPDATE하여 지우지 않는다.

새 평가가 필요하면 새 `support_evaluations` 레코드를 만들고 당시:

- 회사 Profile 버전
- 평가 규칙 버전
- AI 사용 여부
- 근거

를 남긴다.

---

## 10. 알림 후보 규칙

다음 조건을 1차 Trigger로 사용한다.

1. 태장 적합도 85점 이상
2. 지원규모 500만원 이상
3. 차량·시설·장비 현물지원
4. 최우선 분야
5. 마감 7일 이내
6. 희소한 전국단위 공모

단 하나의 Trigger만 충족했다고 즉시 알림하지 않는다.

처리 순서:

> Trigger 탐지 → 실제 태장 관련성 재평가 → 중요도 확정 → 알림 후보 생성

금액이 크지만 태장이 참여할 수 없는 사업은 알림에서 내려갈 수 있고, 금액이 작더라도 장애인표준사업장 전용 차량·시설 지원처럼 희소성이 높은 사업은 높은 우선순위를 가질 수 있다.

Phase 1에서는 실제 카카오/이메일 자동발송보다 `알림 후보` 상태를 DB와 화면에서 먼저 검증한다.

---

## 11. 사람의 결정과 신청 진행 모델

AI 추천과 운영총괄 최종결정을 같은 필드에 저장하지 않는다.

### 11.1 `support_decisions`

권장값:

`decision`

- `apply`
- `hold`
- `exclude`

권장 필드:

- `id`
- `notice_id`
- `decision`
- `decision_reason`
- `decided_by_profile_id`
- `decided_at`
- `supersedes_decision_id`

결정을 바꿀 경우 과거 결정은 삭제하지 않고 새 결정을 남긴다.

### 11.2 담당자 배정

별도 지원사업 사용자 테이블을 만들지 않는다.

권장 관계 `support_assignments`:

- `id`
- `notice_id`
- `assignee_profile_id`
- `assigned_by_profile_id`
- `assignment_role`
- `assigned_at`
- `ended_at`

Phase 1에서 최소 `primary` 담당자 한 명을 지원하고 다중 담당이 필요하면 관계 구조를 그대로 확장한다.

### 11.3 신청 진행상태

공고 상태와 별개로 태장 내부 진행상태를 관리한다.

권장 `application_status`:

- `reviewing`
- `agency_inquiry`
- `collecting_documents`
- `drafting`
- `ready_to_submit`
- `submitted`
- `selected`
- `not_selected`
- `cancelled`

결정이 `hold` 또는 `exclude`인 사업은 필요 시 진행상태를 생성하지 않아도 된다.

### 11.4 결과·수혜이력

최소 저장:

- 제출일
- 결과 발표일
- 선정/미선정
- 실제 지원금액
- 실제 현물 가치
- 자부담 실제액
- 사업기간
- 주요 결과 메모
- 후속 의무사항

과거 탈락·제외·선정 사업은 삭제하지 않는다.

---

## 12. 권한과 RLS 원칙

### 운영총괄

- 전체 공고 열람
- 태장 평가 전체 열람
- `신청 / 보류 / 제외` 최종 결정
- 담당자 지정·변경
- 지원사업용 회사 Profile 수정
- Source Registry 관리
- 결과·수혜이력 전체 조회
- 잘못된 수동 입력의 복구/보정

### 담당자

- 본인에게 배정된 사업 열람
- 기관문의·확인사항 기록
- 자료수집 상태 기록
- 신청서 준비 상태 변경
- 제출일·결과 입력

### 대표이사

기존 프로젝트 헌장 기준 전사 조회 및 핵심 경영 판단 접근권한을 존중한다. 지원사업 레이더 때문에 대표이사에 시스템 최고관리자 권한을 자동 부여하지 않는다.

### 시스템

수집·중복제거·평가·마감관리·알림후보 생성은 시스템 행위로 처리하되 브라우저에서 service-role 키를 노출하지 않는다.

### 감사기록

다음 사용자 행위는 최소 감사대상이다.

- Source 생성·비활성화
- 회사 Profile 변경
- 지원자격 변경
- 수동 공고 생성/병합
- 운영총괄 결정
- 담당자 변경
- 제출완료 처리
- 결과 변경
- 수혜금액 변경

공고 원문 자체나 불필요하게 큰 AI 응답을 `audit_logs`에 그대로 넣지 않고 식별자·행위·요약만 기록한다.

---

## 13. MVP 화면 계약

`/app/` 기존 App Shell 안에 **지원사업** 메뉴를 추가한다.

### 13.1 대시보드

상단 요약:

- 신규
- 신청추천
- 마감임박
- 신청진행
- 결과대기

주요 영역:

- 이번 주 TOP 5
- 긴급확인
- 나에게 배정된 사업
- 최근 결정

TOP 카드 최소 정보:

- 사업명
- 주관기관
- 태장 적합도
- 신청방식 A/B/C
- 지원규모
- 자부담
- 마감일/D-day
- 추천 이유
- 확인 필요사항
- 다음 행동

### 13.2 전체 공고

필터 최소값:

- 추천순 / 마감순 / 신규순
- 직접 / 공동 / 협력
- 분야
- 지역
- 신청 / 보류 / 제외
- 담당자
- 마감 상태

### 13.3 공고 상세

한 화면 안에서 다음을 연결한다.

1. 공고 요약
2. 태장 분석
3. 신청방식 A/B/C
4. 자격 Gap
5. 확인질문
6. 평가 근거
7. 원문/첨부 링크
8. 운영총괄 결정
9. 담당자
10. 진행상태
11. 결과·수혜이력

### 13.4 태장 지원자격 Profile

운영총괄이 현재 판정기준을 직접 확인할 수 있어야 한다.

예:

- 자회사형 장애인표준사업장: 보유
- 농업회사법인: 해당
- 제조업: 해당
- 중소기업확인서: 미보유
- 의창구 사업장: 활성
- 진전면 농장: 활성

자격이 바뀌면 기존 후보 사업을 재평가할 수 있는 구조를 준비한다.

### 13.5 Source 관리

- Source 이름
- 접근방식
- 자동화 검토상태
- 활성/중지
- 마지막 확인
- 최근 오류

Phase 1에서는 운영진용 최소 화면이면 충분하다.

---

## 14. 주간보고 계약

기본 운영기준: **매주 월요일 오전**.

Phase 1에서는 실제 예약발송보다 `주간보고 데이터 생성 결과`를 화면 또는 수동 출력으로 검증해도 된다.

요약 예:

- 신규 수집
- 태장 관련
- 직접신청 가능
- 공동/협력 가능
- 신청추천
- 긴급

TOP 5 각 사업:

- 사업명
- 주관기관
- 태장 적합도
- 신청방식
- 지원금액/현물
- 자부담
- 마감일
- 추천이유
- 확인필요사항
- 다음 행동

Phase 2에서 이메일 자동화, 이후 카카오 및 내부 알림으로 확장한다.

---

## 15. Golden Set 검수

자동수집과 자동 AI를 확대하기 전에 실제 공고 **20~30건**을 Golden Set으로 만든다.

반드시 섞을 사례:

- 태장 직접 신청 가능
- 태장 직접 신청 불가
- 중소기업확인서 때문에 조건부
- 공동신청 가능
- 협력기관 필요
- 경남 소재 조건
- 창원 소재 조건
- 읍·면 농어촌 조건
- 장애인표준사업장 특화
- 현물 차량/시설/장비
- 지원금은 크지만 태장과 무관
- 마감 임박
- 이미 마감
- 중복 Source 게시

각 Golden Case에는 최소 다음 Human Expected 값을 남긴다.

- 직접신청 예상판정
- 공동신청 예상판정
- 협력기관 예상판정
- 적합도 허용범위
- 핵심 이유
- 반드시 확인할 조건
- 추천/비추천 예상

초기 목표는 `정답 점수 하나`보다 **잘못된 신청추천을 줄이고 중요한 사업 누락을 줄이는 것**이다.

---

## 16. Phase 1 실제 구현 범위

### 포함

1. Source Registry DB/관리 최소기능
2. 태장 지원사업용 Company Profile
3. 공고/Source occurrence/첨부 메타데이터 구조
4. 수동 공고 등록
5. URL/Source 데이터가 향후 들어올 수 있는 ingest 계약
6. 중복후보 판단
7. Rule Engine v1
8. 평가 결과 버전보존
9. A/B/C 판정
10. 운영총괄 결정
11. 담당자 배정
12. 기본 신청 진행상태
13. 결과·수혜이력
14. 대시보드
15. 목록
16. 상세
17. Profile 화면
18. Source 화면
19. 감사기록
20. Golden Set 테스트

### 제외

- 대규모 크롤러
- PDF OCR
- HWP 자동분석
- 카카오 API
- 자동 신청서 작성
- 자동 제출
- 매일 유료 AI API 대량 호출
- 공개 홈페이지에 지원사업 데이터를 노출하는 기능

---

## 17. 구현 격리 원칙

지원사업 레이더는 기존 급여·근태·홍보·Employee/Auth 공통계약의 진행을 방해하지 않도록 신규 모듈 중심으로 격리한다.

권장 파일 경계 예시:

```text
app/assets/support-radar*.js
app/assets/support-radar*.css
supabase/migrations/<timestamp>_support_radar_*.sql
supabase/tests/support_radar_*.sql
tests/support-radar-*.test.js
```

실제 파일명은 구현 Issue에서 인접 모듈 패턴을 확인한 뒤 확정한다.

공통 Auth/RLS/Employee 계약의 변경이 필요해지면 지원사업 Issue 내부에서 임의로 수정하지 않고 별도 위험 판단과 사용자 승인을 거친다.

---

## 18. Phase 1 완료 정의

다음 흐름이 한 번에 실제로 동작해야 Phase 1 MVP 완료로 본다.

> 새 지원사업 발견 → 수동/반자동 등록 → 태장 Profile 비교 → 적합도 분석 → 직접/공동/협력 판정 → 운영총괄 결정 → 담당자 지정 → 진행상태 관리 → 제출 → 결과 입력 → 수혜이력 보존

추가 완료조건:

- 중복 Source 공고가 중복 사업으로 무작정 늘어나지 않는다.
- 중소기업확인서 미보유 같은 Gap이 `무조건 탈락`으로 처리되지 않는다.
- AI 추천과 운영총괄 결정이 구분된다.
- 평가 근거와 확인필요사항을 볼 수 있다.
- 과거 미선정/제외 공고도 보존된다.
- Golden Set 20~30건에서 중대한 자격 오판을 검토할 수 있다.
- 지원사업 레이더 장애가 공개 홈페이지로 전파되지 않는다.

---

## 19. 구현 순서

### Phase 1-1 — 계약 고정

- Source
- Company Profile
- 상태값
- 평가배점
- A/B/C 판정
- 권한
- 화면
- Golden Set

### Phase 1-2 — DB/RLS 기반

- 신규 테이블
- RLS/RPC
- 감사기록
- fixture/test

### Phase 1-3 — UI MVP

- 대시보드
- 목록
- 상세
- Profile
- Source 관리

### Phase 1-4 — Rule Engine

- 자격조건
- 점수
- Gap
- 알림후보
- 평가 버전

### Phase 1-5 — 실제 공고 검증

- 20~30건 입력
- 사람 판단과 비교
- 오판 수정
- 가중치 보정

### Phase 2 이후

- 공식 API 수집
- 정기 수집
- 이메일 보고
- 마감 알림
- PDF/HWP 분석
- 카카오/내부 알림

---

## 20. 사용자 승인 게이트

다음은 구현 중 자동으로 진행하지 않는다.

- 기존 Auth/RLS/Employee 공통 의미 변경
- 중요한 DB 계약 변경
- 새로운 외부 유료 서비스
- 유료 AI API 대량 자동호출
- Production DB 적용
- Netlify Production 설정 변경
- Ready for review
- `main` 병합
- Production 배포

작은 신규 모듈 내부 구현·테스트·Preview 오류 수정은 승인된 Issue 범위 안에서 self-heal할 수 있다.

---

## 21. 이 문서 다음 작업

Issue #161의 Phase 1을 다음 하위 작업으로 분리한다.

1. Source Registry 및 공식 접근방식 조사
2. 지원사업/Company Profile 데이터 계약 및 RLS 설계
3. Rule Engine v1 + Golden Set 평가규칙
4. `/app/` 지원사업 UX/UI 명세
5. Phase 1 구현 Issue

하위 구현을 시작하기 전 이 문서에서 미확정으로 남은 값이 실제 DB 상태·권한 의미를 바꾸는 수준인지 확인한다.
