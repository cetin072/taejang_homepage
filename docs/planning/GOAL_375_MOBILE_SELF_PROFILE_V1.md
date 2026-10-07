# Goal #375 — Android 내 정보 v1

상태: **구현 기준 확정**
상위 기준: GitHub Goal #368, 장기 결정 #367, [#375](https://github.com/cetin072/taejang_homepage/issues/375)

## 범위와 경계

- 직원 Android 앱은 본인의 이름, 부서, 직책, 입사일, 등록 연락처만 읽는다.
- 주민등록번호, 급여, 인사평가, 관리자 메모, 직원번호, 다른 직원 정보와 로그인 이메일은 이 화면에 포함하지 않는다.
- 앱은 설정의 보조 화면으로 진입한다. 1.0 홈의 출퇴근·오늘 업무·공지·가까운 일정 우선순위를 바꾸지 않는다.
- `get_my_employee_profile()`은 활성 계정과 해지되지 않은 Auth-Person-Employee 연결을 서버에서 확인한다. 앱의 화면 조건은 보안 경계가 아니다.
- 연락처 변경은 직원이 `employee_self_service_contact_requests`에 요청하고, 기존 `employee.review_change_requests` capability를 가진 검토자가 승인할 때에만 기존 Profile 연락처를 갱신한다.
- 직원은 `profiles`, `people`, `employees` 또는 요청 테이블을 직접 읽거나 수정하지 않는다. 웹의 기존 직원 관리 화면은 좁은 연락처 요청을 검토하는 용도로만 확장한다.

## 완료 대조

| #375 항목 | 결과 |
| --- | --- |
| 이름·부서·직책·입사일·연락처 | 구현 완료 — 최소 self read model |
| 민감 HR 정보 배제 | 구현 완료 — 허용 필드만 JSON RPC로 반환 |
| 직접 canonical HR 수정 금지 | 구현 완료 — direct table privilege 없음 |
| 변경 요청 → 관리자 승인 → 반영 | 구현 완료 — 중복 pending 차단·감사로그·기존 reviewer capability 재사용 |
| inactive account 차단 | 구현 완료 — 서버 RPC가 active account 및 연결을 확인 |
| Production DB 적용 | **DEFERRED HUMAN GATE** — migration은 코드/CI에만 포함, 운영 적용은 하지 않음 |

## 검증 기준

- mobile TypeScript typecheck 및 self-profile static test
- clean Supabase migration reset, schema lint, pgTAP
- Auth/Data API: 본인 범위, direct-table 거부, 중복 요청 거부, self approval 거부, reviewer 승인 후 반영, inactive 계정 차단
- 실제 Galaxy의 키보드·글자 확대·화면 가독성은 Human QA

## #387 Closed Testing release hardening — 2026-10-07 확정

적용 기준: [#387](https://github.com/cetin072/taejang_homepage/issues/387), #368 최신 독립감사와 사용자 작업 지시.

- 서버 eligibility는 active Profile + 해지되지 않은 account_person_links + archived_at IS NULL + employment_status IN ('active','leave')이다. 휴직은 출퇴근 자격과 다르므로 기존 #375의 연락처 확인/요청을 유지한다. departed Employee 및 suspended/departed/deleted/pending Profile은 차단한다. 근태 helper에는 attendance_required와 임원 제외 조건이 있어 self-profile helper로 사용하지 않는다.
- 기존 직원 관리 read model(#146)은 archived_at IS NULL 및 부서 범위를 사용한다. 요청 목록과 모든 review action은 같은 private_can_review_employee_contact를 호출한다. employee.review_change_requests와 view_all 또는 view_scoped + 기존 private_employee_scope_allowed가 필요하다. 본인 요청은 capability가 있어도 검토하지 못한다. 비활성/보관/연결 해지 대상도 목록·검토에서 차단한다.
- Employee scope는 현재 private_employee_scope_allowed / private_team_lead_department의 **부서** 기준이다. role_scope_type의 team/work_group 및 공지 대상 work_group은 직원 관리에 별도 scope를 부여하지 않는다. 이번 수정은 새 role literal이나 별도 범위 엔진을 만들지 않는다.

### 연락처 Source of Truth

- canonical contact field: **profiles.signup_phone**. 현재 연결된 계정의 등록 연락처이며 person identity key가 아니다.
- 근거: #274 migration은 가입 입력 필드로 도입하고 onboarding 전용이라고 comment했다. 그러나 #375는 이미 get_my_employee_profile 및 승인 review에서 이 필드를 현재 연락처로 읽고 갱신한다. 저장소와 2026-10-07 운영 DB 컬럼 조회 모두 people에는 이름만, employees에는 직원/고용/조직/보관 정보만 있고 다른 연락처 필드는 없다. 가입 승인 private_insert_employee도 phone을 People/Employee에 복사하지 않는다.
- 따라서 이름의 signup 접두사만으로 immutable 가입 스냅샷으로 해석하지 않는다. #387 corrective migration은 column comment를 현재 계약에 맞춰 정합화한다. 신규 contact 컬럼, 복제, backfill은 없다. 계정 미연결 직원의 연락처 관리는 이번 범위가 아니다.
- 사용 경로: handle_new_auth_user(초기 입력), list_pending_employee_signup_requests(가입 검토), get_my_employee_profile(본인 표시), submit_my_employee_contact_change_request(현재 값 비교), review_employee_contact_change_request(승인 후 변경). 기존 Web employee-management는 요청 proposed_phone을 표시하고 guarded review RPC로 처리한다.
- 앞으로의 변경 경로: 직원 요청 → 기존 capability 및 직원 관리 scope 검토 → 승인 시 동일 Profile 필드 갱신. People 중심 연락처 모델이 필요해지면 별도 확정 기획/호환 migration으로 이전하며 두 canonical 값을 병행 저장하지 않는다.

### 완료 대조 및 릴리스 경계

| 항목 | 결과 |
| --- | --- |
| archived/profile inactive/revoked 연결 차단 | 구현 완료 — 공통 self eligibility와 Auth/Data API 회귀 추가 |
| scoped reviewer 목록·ID 직접 호출·모든 review action | 구현 완료 — 기존 capability/scope 재사용, Auth 회귀 추가 |
| capability 보유자 본인 승인 차단 | 구현 완료 — 서버 target guard |
| 연락처 SoT 확인 | 구현 완료 — 기존 단일 Profile 필드 유지 |
| #371 generic push privacy | 기존 구현 유지 — current operational definition 대조, payload/lifecycle 통합 회귀 강화 |
| foreground profile freshness | 미구현·후속 작업 — #378 carry-forward, 이번 binary 보존 |
| 급여명세 #374/#384 | 의도적으로 제외 |
| 운영 DB apply / Galaxy / Play 제출 | DEFERRED HUMAN GATE |
