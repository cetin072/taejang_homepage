# 태장 지원사업 레이더 — 데이터·권한 계약 v1

Status: **검토 중**  
Parent: #161 / #164  
Purpose: Phase 1 구현 전에 데이터 경계, 상태 의미, 역할별 접근 범위, 감사기록 기준을 고정하기 위한 설계안.

> 이 문서는 SQL migration이 아니다. 기존 Auth/Profile/Employee/RLS 공통 의미를 바꾸지 않고 지원사업 신규 모듈 내부 계약만 제안한다.

---

## 1. 설계 원칙

1. **Auth ≠ Employee ≠ 지원사업 담당자 배정**을 유지한다.
2. 기존 `profiles`, `employees`, `roles`, `profile_roles`, `audit_logs`를 재사용한다.
3. 지원사업 때문에 별도 사용자 마스터를 만들지 않는다.
4. 공고 원문, 정규화 공고, 태장 평가, 사람의 결정, 신청 진행을 서로 다른 기록으로 분리한다.
5. AI가 만든 평가를 사람의 최종결정처럼 저장하지 않는다.
6. 과거 평가·결정·신청결과는 덮어쓰지 않고 이력으로 보존한다.
7. 삭제보다 archive/비활성화를 우선한다.
8. 공개 홈페이지와 지원사업 DB 사이에 직접 의존성을 만들지 않는다.
9. 브라우저 UI에서 권한을 숨기는 것만으로 보안을 구현하지 않고 DB/RPC가 최종 권한을 판정한다.
10. service-role/API secret는 브라우저에 노출하지 않는다.

---

## 2. 엔터티 관계

```text
support_sources
    │
    └── support_notice_occurrences ── support_documents
                 │
                 ▼
           support_notices
                 │
        ┌────────┼─────────┐
        ▼        ▼         ▼
support_evaluations  support_decisions  support_applications
        │                         │
        │                         ├── support_assignments
        │                         ├── support_application_events
        │                         └── support_benefit_results
        ▼
support_company_profiles
    ├── support_company_locations
    ├── support_company_qualifications
    └── support_company_business_areas
```

핵심 분리:

- `occurrence`: 어디서 발견했는가
- `notice`: 실제 어떤 사업인가
- `evaluation`: 태장과 얼마나 맞는가
- `decision`: 신청할지 말지 사람이 무엇을 결정했는가
- `application`: 실제 신청업무가 어디까지 갔는가

---

## 3. `support_sources`

### 역할

공고가 올라오는 정보원을 관리한다.

### 필수 속성

| 필드 | 타입 개념 | 의미 |
| --- | --- | --- |
| `id` | UUID | 내부 ID |
| `code` | text unique | 안정적인 내부 코드 |
| `name` | text | 화면 표시명 |
| `organization_name` | text | 운영기관 |
| `base_url` | URL | 대표주소 |
| `scope` | enum/text | 전국/경남/창원/특화 등 |
| `access_method` | enum | api/rss/open_data/public_search/html/manual |
| `official_source` | boolean | 공식기관 정보원 여부 |
| `api_auth_required` | boolean | 인증키 필요 여부 |
| `terms_review_status` | enum | 자동접근 정책 검토상태 |
| `automation_status` | enum | 자동수집 운영상태 |
| `priority` | integer | 우선순위 |
| `active` | boolean | 수집대상 여부 |
| `last_checked_at` | timestamp | 마지막 확인 |
| `last_success_at` | timestamp | 마지막 성공 |
| `last_error_summary` | text | 민감정보 없는 오류요약 |
| `notes` | text | 운영메모 |
| `created_at` / `updated_at` | timestamp | 이력 |

### 상태값

`terms_review_status`
- `unreviewed`
- `allowed`
- `restricted`
- `prohibited`
- `unknown`

`automation_status`
- `manual_only`
- `candidate`
- `ready`
- `enabled`
- `paused`
- `error`

`candidate`와 `ready`를 분리한다.

- `candidate`: 공식 구조화 접근경로는 확인됐으나 실제 연결 검증 전
- `ready`: 이용조건·필드·인증·테스트 호출까지 확인되어 구현 가능

기업마당은 실제 API key 테스트 전에는 `candidate`가 더 정확하다.

---

## 4. `support_notice_occurrences`

### 역할

동일 실제 사업이 여러 사이트에 올라오는 현상을 보존한다.

### 핵심 필드

- `id`
- `source_id`
- `source_notice_id`
- `source_url`
- `raw_title`
- `raw_payload`
- `content_hash`
- `source_published_at`
- `source_updated_at`
- `discovered_at`
- `last_seen_at`
- `notice_id` nullable
- `match_status`
- `match_confidence`
- `match_reason`

### `match_status`

- `unmatched`
- `matched`
- `duplicate_candidate`
- `ignored`

### 안전 원칙

- Source가 동일하고 `source_notice_id`가 안정적이면 idempotent하게 같은 occurrence로 취급한다.
- cross-source 자동병합은 확실한 근거가 없으면 하지 않는다.
- `raw_payload` 크기는 제한하고 비밀키/토큰을 저장하지 않는다.
- API 요청 URL에 인증키가 붙는 경우 전체 요청 URL을 raw payload/audit에 저장하지 않는다.

---

## 5. `support_notices`

### 역할

정규화된 하나의 지원사업.

### 식별/기관

- `id`
- `title`
- `managing_organization`
- `implementing_organization`
- `canonical_url`
- `application_url`
- `official_notice_number`

URL 분리:

- `canonical_url`: 대표/원기관 공고 URL
- `application_url`: 실제 신청 시스템 URL
- occurrence `source_url`: 발견한 사이트 게시 URL

### 기간

- `announced_at`
- `application_start_at`
- `deadline_at`
- `notice_status`

`notice_status`
- `upcoming`
- `open`
- `closed`
- `cancelled`
- `unknown`

### 경제조건

- `cash_support_min`
- `cash_support_max`
- `cash_support_description`
- `in_kind_available`
- `in_kind_description`
- `estimated_in_kind_value`
- `self_funding_required`
- `self_funding_rate`
- `self_funding_description`

금액이 공고에 명확하지 않으면 숫자를 임의 추정하지 않고 description + null을 허용한다.

### 조건/분류

- `target_regions`
- `source_categories`
- `normalized_categories`
- `eligibility_summary`
- `application_process_summary`
- `duplicate_support_rule`
- `contact_summary`

### 생명주기

- `first_discovered_at`
- `last_verified_at`
- `created_at`
- `updated_at`
- `archived_at`

`archived_at`는 공고가 마감됐다는 뜻이 아니다. 중복 오등록 등 운영상 레코드를 일반 목록에서 숨기는 경우에만 사용한다.

---

## 6. `support_documents`

### 역할

공고 원문 및 첨부파일 메타데이터를 보존한다.

필드:

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

`document_type`
- `notice`
- `attachment`
- `application_form`
- `guideline`
- `notice_print`
- `other`

`parse_status`
- `not_requested`
- `queued`
- `parsed`
- `unsupported`
- `failed`

Phase 1에서는 `parsed_text`를 필수로 하지 않는다.

---

## 7. 태장 회사 Profile snapshot

### `support_company_profiles`

하나의 평가 시점에 사용한 태장 기준정보 snapshot.

필드:

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

### Snapshot 원칙

현재 Profile을 수정했다고 과거 평가의 회사조건이 바뀌어서는 안 된다.

새로운 중요한 자격/사업장/법인상태 변화가 있으면 새 version을 만들고 새 평가에 사용한다.

---

## 8. `support_company_locations`

필드:

- `id`
- `company_profile_id`
- `site_name`
- `site_type`
- `province`
- `city`
- `district`
- `eup_myeon`
- `rural_area`
- `active`
- `verified_at`

Phase 1 seed 기준:

1. 창원시 의창구 사업장
2. 창원시 마산합포구 진전면 농장

정확한 세부 주소는 지원자격 판정에 필요한 수준에서만 다루고, 공개 GitHub fixture에 민감/불필요한 상세정보를 넣지 않는다.

---

## 9. `support_company_qualifications`

### 목적

중소기업확인서 등 자격을 `있다/없다` 하나로 처리하지 않는다.

필드:

- `id`
- `company_profile_id`
- `qualification_code`
- `qualification_name`
- `status`
- `obtainable`
- `estimated_days_to_obtain`
- `valid_from`
- `valid_until`
- `verified_at`
- `evidence_summary`

`status`
- `valid`
- `missing`
- `planned`
- `expired`
- `not_applicable`
- `unknown`

현재 중소기업확인서는 `missing`; 취득 가능성은 `obtainable` 또는 후속 검토필드로 표현한다.

---

## 10. `support_company_business_areas`

필드:

- `id`
- `company_profile_id`
- `category_code`
- `category_name`
- `status`
- `priority`
- `evidence_summary`

`status`
- `current`
- `developing`
- `planned`
- `inactive`

이를 통해 현재 실제 사업과 장래 계획을 같은 강도로 평가하지 않는다.

---

## 11. `support_evaluations`

### 원칙

평가 결과는 append/version 방식으로 보존한다.

필드:

- `id`
- `notice_id`
- `company_profile_id`
- `evaluation_version`
- `ruleset_version`
- `evaluation_method`
- `overall_score`
- 6개 세부 점수
- `direct_eligibility`
- `joint_eligibility`
- `partner_eligibility`
- `recommended_application_mode`
- `recommendation`
- `recommendation_reason`
- `taejang_possible_role`
- `qualification_gaps`
- `questions_to_confirm`
- `next_action`
- `confidence`
- `evidence`
- `evaluated_at`
- `evaluated_by_profile_id` nullable
- `supersedes_evaluation_id` nullable

`evaluation_method`
- `rules_only`
- `rules_plus_ai`
- `human_reviewed`
- `human_override`

`eligibility`
- `eligible`
- `conditional`
- `ineligible`
- `verify`

`recommendation`
- `strong_recommend`
- `recommend`
- `review`
- `low_priority`
- `do_not_apply`

`confidence`
- `high`
- `medium`
- `low`

### DB validation

- overall 0~100
- 각 세부점수는 해당 최대점수를 넘지 않음
- 전체점수는 세부점수 합계와 일치하도록 DB 또는 RPC에서 검증
- `rules_plus_ai`라도 evidence/questions가 비어 있지 않도록 앱/RPC 계약에서 검증

---

## 12. `support_decisions`

### 역할

운영총괄의 사람 결정.

필드:

- `id`
- `notice_id`
- `decision`
- `decision_reason`
- `decided_by_profile_id`
- `decided_at`
- `supersedes_decision_id`

`decision`
- `apply`
- `hold`
- `exclude`

### 중요

- AI `recommendation`과 섞지 않는다.
- 결정을 바꾸면 이전 row를 UPDATE하여 삭제하지 않고 새 결정으로 supersede한다.
- UI는 최신 유효결정만 기본 표시하되 이력조회 가능.

---

## 13. `support_applications`

### 생성 시점

원칙적으로 최신 결정이 `apply`가 된 뒤 실제 신청업무를 시작할 때 생성.

필드:

- `id`
- `notice_id`
- `status`
- `started_at`
- `submission_deadline_at`
- `submitted_at`
- `result_announced_at`
- `created_by_profile_id`
- `created_at`
- `updated_at`

`status`
- `reviewing`
- `agency_inquiry`
- `collecting_documents`
- `drafting`
- `ready_to_submit`
- `submitted`
- `selected`
- `not_selected`
- `cancelled`

상태전이는 후속 구현에서 RPC로 제한한다.

---

## 14. `support_assignments`

필드:

- `id`
- `application_id`
- `assignee_profile_id`
- `assignment_role`
- `assigned_by_profile_id`
- `assigned_at`
- `ended_at`

`assignment_role`
- `primary`
- `support`
- `reviewer`

Phase 1 UI는 primary 담당자 1명 중심으로 시작해도 DB는 다중 배정을 허용하는 관계형 구조를 권장한다.

---

## 15. `support_application_events`

신청 진행의 감사 가능한 업무 이력.

예:

- 기관문의
- 서류요청
- 자료수집
- 초안완료
- 보완요청
- 제출
- 결과수신

필드:

- `id`
- `application_id`
- `event_type`
- `summary`
- `actor_profile_id`
- `occurred_at`
- `created_at`

장문의 신청서 원문이나 민감 계약자료를 여기 넣지 않는다. 파일은 별도 자료경계로 연결한다.

---

## 16. `support_benefit_results`

선정 이후 실제 수혜이력.

필드:

- `id`
- `application_id`
- `result`
- `cash_awarded`
- `in_kind_value`
- `self_funding_actual`
- `project_start_at`
- `project_end_at`
- `obligation_summary`
- `result_summary`
- `recorded_by_profile_id`
- `recorded_at`

`result`
- `selected`
- `not_selected`
- `withdrawn`
- `cancelled`
- `unknown`

선정금액/현물가치는 공고의 최대 지원금과 별도다.

---

## 17. 역할별 접근 Matrix — 초안

| 데이터/행위 | 운영총괄 | 대표이사 | 배정 담당자 | 일반 사무직 | 일반 근로자 | 시스템 수집기 |
| --- | --- | --- | --- | --- | --- | --- |
| Source 조회 | 전체 | 전체 | 필요범위 | 제한 | 없음 | 읽기 |
| Source 생성/수정 | O | 조회 중심 | X | X | X | 상태갱신 일부 |
| 전체 공고 조회 | O | O | O | 정책에 따라 | X | O |
| 평가 전체 조회 | O | O | 배정/업무상 필요 | 제한 | X | 생성 |
| Company Profile 조회 | O | O | 최소 필요정보 | 제한 | X | 판정용 읽기 |
| Company Profile 수정 | O | 원칙상 조회/최종경영 판단 | X | X | X | X |
| 신청/보류/제외 | O | 필요 시 최종조회/향후 승인체계 연계 | X | X | X | X |
| 담당자 배정 | O | 조회 | X | X | X | X |
| 배정 신청업무 변경 | O | 조회 | O | 본인 배정 시 O | X | X |
| 결과/수혜이력 변경 | O | 조회 | 배정건 입력 | X | X | X |

### 대표이사 권한 주의

기존 프로젝트 헌장의 `전사 조회 + 핵심 최종의사결정` 원칙을 존중하되, 지원사업 모듈 하나만으로 대표이사에게 시스템관리 또는 데이터관리 mutation 권한을 자동 추가하지 않는다.

대표이사의 지원사업 `승인` 단계를 별도로 둘지는 실제 운영 필요가 생기면 승인체계 문서와 함께 확정한다. 현재 인수인계 기준의 최종 신청/보류/제외 주체는 운영총괄이다.

---

## 18. RLS/RPC 구현 원칙

### 직접 table write 최소화

중요 mutation은 RPC를 우선한다.

예상 RPC 범주:

- Source 생성/수정/중지
- 수동 공고 등록
- occurrence → notice 연결/중복병합
- Company Profile 새 version 발행
- 지원자격 갱신
- 평가 생성
- 운영총괄 결정 생성
- application 시작
- 담당자 지정/종료
- 진행상태 전이
- 제출완료
- 결과/수혜 기록

### 이유

- 역할검사 일관성
- 상태전이 검증
- audit 기록 동시처리
- append-only 이력 보장
- 브라우저 임의 UPDATE 최소화

---

## 19. Audit 계약

기존 `audit_logs`에 최소 다음 action을 기록한다.

### Source
- `support_source_created`
- `support_source_updated`
- `support_source_paused`

### Notice
- `support_notice_manual_created`
- `support_notice_occurrence_matched`
- `support_notice_duplicate_merged`

### Company Profile
- `support_company_profile_version_created`
- `support_company_qualification_changed`

### Evaluation
- `support_evaluation_created`
- `support_evaluation_human_overridden`

### Decision/Application
- `support_decision_created`
- `support_application_started`
- `support_assignment_changed`
- `support_application_status_changed`
- `support_application_submitted`
- `support_result_recorded`
- `support_benefit_changed`

### Audit metadata에 넣지 않을 것

- API key/token
- 신청서 원문
- PDF/HWP 전체 본문
- 계좌/주민번호/민감 인사자료
- 전체 AI prompt/response

대신 ID, 이전/신규 상태, 안전한 요약, source code, evaluation version 등을 기록한다.

---

## 20. 삭제·보존 원칙

- `support_notices`: 과거 공고 보존
- `support_evaluations`: append-only 중심
- `support_decisions`: append/supersede
- `support_application_events`: append-only
- 결과·수혜: 변경 시 audit + 이전값 추적
- Source는 삭제보다 `active=false`/paused

실제 법적 개인정보 삭제요청과는 별개다. 이 모듈은 원칙적으로 민감 개인정보를 보유하지 않는 방향으로 설계한다.

---

## 21. 테스트 계약

구현 Issue에서 최소 다음을 자동검증한다.

### 권한

1. 일반 근로자는 지원사업 내부데이터 접근 불가
2. 미배정 담당자는 제한된 application mutation 불가
3. 배정 담당자는 본인 배정건만 허용된 진행업무 변경
4. 운영총괄은 전체 운영 mutation 가능
5. 비활성/퇴사/정지 계정은 모든 보호된 mutation 차단
6. 대표이사 전사 조회는 가능하되 지원사업 모듈이 임의로 시스템관리권한을 주지 않음

### 상태

7. closed 공고에 신규 apply decision을 만들 때 경고/검증
8. `submitted`에는 제출일 필요
9. `selected/not_selected`에는 결과기록 필요
10. 잘못된 상태 점프 차단

### 이력

11. 평가 재실행 시 과거 평가 보존
12. 결정 변경 시 과거 결정 보존
13. 담당자 교체 이력 보존
14. 수혜금 변경 audit 기록

### 중복

15. 동일 Source 동일 `source_notice_id` 재수집 시 occurrence 중복생성 방지
16. cross-source 애매한 후보 자동병합 금지

---

## 22. 미확정 사항

사용자 승인/실제 운영 검토 전 다음은 확정하지 않는다.

- 대표이사 별도 신청승인 단계 추가 여부
- 일반 사무직의 전체 공고 조회 범위
- 다중 담당자 UI 제공 시점
- 실제 문서 파일을 Supabase Storage에 저장할지 원문 URL만 유지할지
- AI 평가를 어떤 제공자/API로 자동화할지
- Source collector가 Supabase 직접 RPC를 호출할지 별도 ingest endpoint를 둘지

이 항목은 Phase 1 구현을 불필요하게 막지 않는 범위에서 최소안으로 시작한다.

---

## 23. 구현 전 승인 체크

- [ ] 데이터 엔터티 분리 승인
- [ ] 지원자격 상태값 승인
- [ ] A/B/C eligibility 상태 승인
- [ ] 운영총괄 권한 승인
- [ ] 담당자 배정 방식 승인
- [ ] 신청 진행상태 승인
- [ ] 평가/결정 append-only 원칙 승인
- [ ] audit 범위 승인
- [ ] 미확정 대표이사 승인단계는 현 Phase에서 보류 확인

승인 전 SQL migration을 만들지 않는다.
