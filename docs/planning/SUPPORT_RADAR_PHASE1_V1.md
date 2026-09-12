# 태장 지원사업 레이더 Phase 1 기획 v1

Status: **확정 — 2026-09-09 사용자 승인, `SUPPORT_RADAR_APPROVAL_RECORD_V1.md` 기준**  
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
- 지원금액/현물
- 최우선 분야

### 9.2 권장 배점

- 신청자격·조건 충족: 30
- 태장 사업·전략 연관성: 20
- 지원금·현물 경제가치: 15
- 실행·준비 가능성: 15
- 선정 가능성: 10
- 시급성·희소성·전략가치: 10

합계 100점.

최우선 분야는 전략 연관성에 가중하되 자격이 맞지 않는 사업의 점수를 인위적으로 높이지 않는다.

### 9.3 `support_evaluations`

평가 결과를 공고 row에 덮어쓰지 않고 이력으로 남긴다.

최소 저장값:

- `notice_id`
- `company_profile_id`
- `evaluation_version`
- `overall_score`
- 영역별 점수
- A/B/C eligibility
- 추천 신청방식
- 추천 이유
- 자격 Gap
- 확인질문
- 다음 행동
- `confidence`
- `evidence`
- `evaluated_at`

### 9.4 AI 안전장치

모든 AI 평가에는 최소 다음이 있어야 한다.

- `confidence`: high / medium / low
- `questions_to_confirm`
- `evidence`

공고문에서 근거가 불충분하면 `verify` 또는 낮은 confidence를 사용한다.

---

## 10. 중요 알림 후보

다음은 알림의 최종조건이 아니라 1차 Trigger다.

- 태장 적합도 85점 이상
- 지원규모 500만원 이상
- 차량·시설·장비 현물지원
- 인건비·고용 / 문화 / 원예 / AI 최우선 분야
- 마감 7일 이내
- 희소한 전국단위 사업

Trigger 후 실제 태장 관련성을 다시 평가해 중요 공고만 알린다.

작은 금액이라도 장애인표준사업장 전용 차량·시설처럼 태장 가치가 큰 사업은 중요하게 취급할 수 있어야 한다.

---

## 11. 사람의 결정과 신청업무

AI 추천과 사람의 결정을 분리한다.

### `support_decisions`

- `notice_id`
- `decision`: `apply | hold | exclude`
- `decided_by_profile_id`
- `decision_reason`
- `decided_at`

### 신청 진행 상태 v1

- `reviewing`
- `contacting_agency`
- `collecting_documents`
- `drafting_application`
- `ready_to_submit`
- `submitted`
- `selected`
- `not_selected`
- `cancelled`

과거 제외·탈락·선정사업을 삭제하지 않는다.

---

## 12. 권한 v1

### 운영총괄

- 전체 지원사업 조회
- 신청 / 보류 / 제외
- 담당자 지정·변경
- 태장 지원자격 Profile 관리
- Source Registry 관리
- 결과 및 수혜이력 전체 조회

### 담당자

- 본인 배정 사업 조회
- 공고 검토
- 기관 문의 기록
- 자료수집 기록
- 신청 진행상태 기록
- 제출 및 결과 기록

`담당자` 때문에 신규 전역 Role을 만들지 않고 기존 직원 Profile과 지원사업의 assignment 관계로 우선 구현한다.

대표이사와 운영총괄의 기존 전사 조회 원칙은 유지하며 시스템 최고관리자 권한과 혼합하지 않는다.

---

## 13. MVP 화면 v1

기존 `/app/` App Shell에 `지원사업` 메뉴를 추가한다.

### 화면 1 — 대시보드

- 신규
- 신청추천
- 마감임박
- 신청진행
- 결과대기
- 이번 주 TOP 5
- 긴급확인

### 화면 2 — 전체 공고

필터:

- 추천순 / 마감순 / 신규순
- 직접 / 공동 / 협력
- 분야
- 지역
- 신청 / 보류 / 제외
- 담당자
- 마감상태

### 화면 3 — 공고 상세

- 사업/기관/기간/지원금/현물/자부담
- A/B/C 판정
- 태장 적합도
- 추천이유
- 자격 Gap
- 확인사항
- evidence
- 원문/첨부
- 신청/보류/제외
- 담당자
- 진행상태
- 결과/수혜이력

### 화면 4 — 태장 Profile

현재 자격, 미보유·예정 자격, 사업장, 사업분야, 마지막 검증일을 관리한다.

### 화면 5 — Source 관리

Source별 접근방법, 자동화 가능상태, 최근 확인, 오류 등을 본다.

---

## 14. Phase 1 구현 범위

### 포함

- Source Registry
- Company Profile
- 공고/Source occurrence DB
- 첨부 메타데이터
- 수동 공고 등록
- URL 기반 반자동 입력을 받을 수 있는 구조
- 중복 후보 판단
- Rule Engine v1
- AI 결과 저장 계약
- A/B/C 판정
- 운영총괄 결정
- 담당자 배정
- 진행/결과/수혜이력
- MVP 화면
- Audit
- RLS/RPC
- Golden Set 검증

### 제외

- 대규모 크롤링
- PDF OCR
- HWP 자동분석
- 카카오 API
- 상시 자동 AI 호출
- 자동 신청서 작성
- 자동 제출
- 승인 없는 유료 API

---

## 15. Golden Set

실제 과거·현재 지원사업 20~30건을 사용한다.

반드시 섞는다.

- 직접 신청 가능 사업
- 직접 신청 불가능 사업
- 중소기업확인서 때문에 조건부
- 비영리/공동/협력 필요
- 경남/창원/읍면 조건
- 장애인표준사업장 특화
- 차량/시설/장비 현물
- 금액은 크지만 태장과 무관
- 마감 임박
- 마감 완료
- 동일 사업의 여러 Source

Golden Set에는 사람이 기대한 판정과 이유를 먼저 기록한 뒤 시스템 결과와 비교한다.

---

## 16. Phase 1 완료 정의

다음 전체 흐름이 실제 동작해야 한다.

> 새 공고 발견 → 수동/반자동 등록 → 태장 Profile 비교 → 적합도 분석 → A/B/C 표시 → 운영총괄 결정 → 담당자 지정 → 진행관리 → 제출 → 결과 입력 → 과거 이력 보존

그리고 Golden Set을 통해 중대한 오판이 없는지 확인한다.

Phase 1 완료 후에야 공식 API 자동수집을 단계적으로 연결한다.

---

## 17. 구현 격리 원칙

지원사업 레이더 때문에 다음 기존 공통 계약을 임의로 바꾸지 않는다.

- Auth
- Profile/Employee 관계
- 기존 Role 의미
- 기존 RLS 공통 helper
- 급여
- 근태
- 홍보
- 공개 홈페이지

신규 지원사업 테이블·RPC·UI·테스트를 중심으로 격리한다.

예상 파일영역:

- `app/assets/support-radar*.js`
- `app/assets/support-radar*.css`
- `supabase/migrations/*support_radar*.sql`
- `supabase/tests/*support_radar*.sql`
- 관련 JS 회귀테스트

새 최상위 디렉터리는 기본값으로 만들지 않는다.

---

## 18. 다음 단계

1. 사용자 승인 완료 — 2026-09-09
2. `SUPPORT_RADAR_APPROVAL_RECORD_V1.md`를 최신 승인 기록으로 사용
3. 최신 `main` 기준 Phase 1 구현 브랜치/Draft PR 시작
4. `#163` Source/API 상세조사는 자동수집 연결 전까지 병행
5. 구현 Issue `#167`에서 데이터 → 수동등록 → 판정 → UI → Golden Set 순으로 진행
6. 사용자 승인 전 Ready / main merge / Production 변경 금지
