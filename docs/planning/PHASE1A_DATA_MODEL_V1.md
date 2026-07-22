# 태장 업무플랫폼 Phase 1A 데이터 모델 v1

상태: **확정**

## 1. 목적

이 문서는 1차 개발 범위인 로그인·가입승인·조직·역할·일반 근로자 정보게시판·관리자 작성화면·공용 태블릿·기본 감사기록을 구현하기 위한 논리 데이터 모델이다. 기존 공개 홈페이지 콘텐츠용 데이터 모델과 구분하며, 실제 SQL migration은 별도 개발 PR에서 작성한다.

## 2. 설계 원칙

- Supabase Auth 사용자와 업무 프로필을 1:1로 분리한다.
- 가입만으로 내부자료를 볼 수 없으며 `pending` 상태에서는 승인 대기 화면만 접근한다.
- 이름이 아니라 역할·부서·작업반 관계로 권한을 판단한다.
- 일반 근로자에게 시작·완료·실적·출퇴근 입력 필드를 만들지 않는다.
- 개인용 화면과 공용 태블릿용 화면은 같은 원본 데이터를 사용하되 공개 범위를 다르게 조회한다.
- 과거 작성자·수정자 관계를 보존하고 실제 삭제보다 비활성화·보관을 우선한다.
- 민감한 상담·지원 데이터는 3차 개발의 별도 테이블과 정책으로 분리한다.

## 3. 핵심 엔터티

### 3.1 `profiles`

업무플랫폼 사용자 기본 프로필이다.

필드:

- `id`
- `auth_user_id`
- `display_name`
- `work_email`
- `phone_last4` 선택
- `account_status`: `pending | active | suspended | departed | deleted`
- `department_id` 선택
- `position_id` 선택
- `work_group_id` 선택
- `support_view_mode`: `basic | photo_first | large_text | high_contrast | assisted | shared_device_first`
- `approved_at`, `approved_by`
- `status_changed_at`, `status_changed_by`, `status_reason`
- `created_at`, `updated_at`

원칙:

- `pending` 계정은 내부 업무데이터를 조회하지 못한다.
- 장애명·진단명은 저장하지 않는다.
- 퇴사자는 `departed`로 유지하며 과거 기록의 작성자 참조를 보존한다.

### 3.2 `departments`

부서 기준정보다.

필드:

- `id`
- `code`
- `name`
- `active`
- `sort_order`
- timestamps

초기 예시:

- 생산
- 물류
- 홍보
- 근로자지원
- 운영

### 3.3 `positions`

직책 기준정보다.

필드:

- `id`
- `code`
- `name`
- `description`
- `active`
- `sort_order`

초기 예시:

- 대표이사
- 운영총괄
- 시스템 최고관리자
- 부서 팀장
- 총괄반장
- 업무반장
- 현장 관리자
- 담당자
- 일반 근로자
- 근로지원인
- 외부지도자

직책은 화면 표시와 운영분류용이며 실제 권한은 역할과 범위 관계로 판단한다.

### 3.4 `roles`

권한 역할 기준정보다.

초기 코드:

- `ceo`
- `operations_manager`
- `super_admin`
- `department_lead`
- `field_lead`
- `worker_support_lead`
- `worker_support_staff`
- `promotion_lead`
- `promotion_staff`
- `office_staff`
- `general_worker`
- `work_assistant`
- `external_guide`

### 3.5 `profile_roles`

사용자와 역할의 N:M 관계다.

필드:

- `profile_id`
- `role_id`
- `scope_type`: `company | department | work_group | self`
- `scope_id` 선택
- `granted_by`
- `granted_at`
- `revoked_at`, `revoked_by`

한 사용자가 시스템 최고관리자와 운영총괄처럼 여러 역할을 가질 수 있다.

### 3.6 `work_groups`

오전반·오후반·작업반 등 현장 운영 단위다.

필드:

- `id`
- `department_id`
- `name`
- `shift_type`: `morning | afternoon | full_day | flexible`
- `active`
- `sort_order`
- timestamps

### 3.7 `work_group_members`

작업반 소속 이력을 관리한다.

필드:

- `id`
- `work_group_id`
- `profile_id`
- `member_type`: `worker | lead | assistant`
- `start_date`
- `end_date` 선택
- `assigned_by`
- timestamps

## 4. 일반 근로자 정보게시판 데이터

### 4.1 `worker_tasks`

오늘의 업무 카드 원본이다.

필드:

- `id`
- `title`
- `task_date`
- `start_time`, `end_time`
- `department_id`
- `work_group_id` 선택
- `profile_id` 선택
- `location`
- `lead_profile_id` 선택
- `preparation_text`
- `caution_text`
- `work_guide_id` 선택
- `status`: `scheduled | changed | cancelled | archived`
- `created_by`, `updated_by`
- timestamps

대상 우선순위:

1. 개인 지정
2. 작업반 지정
3. 부서 지정

같은 시간대에 중복되면 개인 지정이 우선한다.

### 4.2 `work_guides`

작업방법 자료의 기본정보다.

필드:

- `id`
- `title`
- `category`
- `department_id`
- `representative_image_url`
- `purpose_text`
- `materials_text`
- `completion_text`
- `common_mistakes_text`
- `caution_text`
- `owner_profile_id`
- `status`: `editing | active | retired`
- `version_no`
- `change_reason`
- `published_at`
- `created_by`, `updated_by`
- timestamps

### 4.3 `work_guide_steps`

작업방법 3~7단계 자료다.

필드:

- `id`
- `work_guide_id`
- `step_no`
- `instruction_text`
- `image_url`
- `alt_text`
- `active`
- timestamps

규칙:

- 활성 작업방법은 단계가 3~7개여야 한다.
- 한 단계는 한 행동 중심의 짧은 문장으로 작성한다.

### 4.4 `schedules`

근무시간·교육·외부활동·휴무·이동일정 원본이다.

필드:

- `id`
- `title`
- `schedule_type`: `work | training | external_activity | holiday | location_change | event | transport`
- `start_at`, `end_at`
- `location`
- `department_id` 선택
- `work_group_id` 선택
- `profile_id` 선택
- `preparation_text`
- `transport_text`
- `status`: `scheduled | changed | cancelled | completed`
- `created_by`, `updated_by`
- timestamps

### 4.5 `notices`

중요공지와 일반안내 원본이다.

필드:

- `id`
- `title`
- `body_easy`
- `notice_type`: `general | work_time | location | training | external_activity | preparation | clothing | safety | holiday | transport`
- `importance`: `normal | important`
- `confirmation_required`
- `display_from`, `display_until`
- `department_id` 선택
- `work_group_id` 선택
- `profile_id` 선택
- `image_url` 선택
- `related_url` 선택
- `status`: `draft | active | expired | archived`
- `created_by`, `updated_by`
- timestamps

### 4.6 `notice_confirmations`

중요공지 확인 기록이다.

필드:

- `notice_id`
- `profile_id`
- `confirmed_at`

이 데이터는 안내 전달 확인용이며 실적·평가에 사용하지 않는다.

### 4.7 `frequent_guides`

자주 보는 안내다.

필드:

- `id`
- `title`
- `body_easy`
- `image_url` 선택
- `department_id` 선택
- `work_group_id` 선택
- `profile_id` 선택
- `sort_order`
- `active`
- `created_by`, `updated_by`
- timestamps

## 5. 공용 태블릿

### 5.1 `shared_devices`

공용 태블릿·안내화면 설정이다.

필드:

- `id`
- `name`
- `device_token_hash`
- `department_id` 선택
- `work_group_id` 선택
- `display_mode`: `group_board | notice_board`
- `active`
- `last_seen_at`
- `created_by`
- timestamps

공용기기는 작업반 업무·작업방법·공지처럼 개인식별이 필요 없는 데이터만 조회한다.

## 6. 계정 운영과 감사

### 6.1 `account_status_history`

계정상태 변경의 불변 이력이다.

필드:

- `id`
- `profile_id`
- `previous_status`
- `new_status`
- `reason`
- `changed_by`
- `created_at`

### 6.2 `audit_logs`

중요행위 감사기록이다.

필드:

- `id`
- `actor_profile_id`
- `action`
- `target_type`
- `target_id`
- `before_summary`
- `after_summary`
- `reason`
- `created_at`

1차 필수 감사대상:

- 가입 승인·거절
- 부서·직책·역할·작업반 변경
- 계정 정지·퇴사·복구·삭제
- 마지막 최고관리자 관련 변경 시도
- 공지·작업방법의 게시·사용중지
- 공용기기 생성·비활성화

## 7. 핵심 관계

- Auth 사용자 1명 ↔ `profiles` 1개
- `profiles` N:M `roles` via `profile_roles`
- `profiles` N:1 `departments`, `positions`, `work_groups`
- `departments` 1:N `work_groups`
- `work_groups` N:M `profiles` via `work_group_members`
- `worker_tasks` N:1 `work_guides`
- `work_guides` 1:N `work_guide_steps`
- `notices` 1:N `notice_confirmations`
- 사용자·부서·작업반은 업무·일정·공지·안내의 대상 범위를 결정한다.

## 8. 화면별 주요 데이터

### 일반 근로자 첫 화면

- `profiles`
- 오늘 날짜의 `worker_tasks`
- 가까운 `schedules`
- 활성 `notices`
- 연결된 `work_guides`

### 관리자 작성화면

- `worker_tasks`
- `work_guides`, `work_guide_steps`
- `schedules`
- `notices`
- `frequent_guides`

### 최고관리자 화면

- `profiles`
- `departments`, `positions`, `roles`
- `profile_roles`
- `work_groups`, `work_group_members`
- `account_status_history`
- `audit_logs`

### 공용 태블릿

- `shared_devices`
- 작업반 대상 `worker_tasks`
- 작업반 대상 `notices`
- 연결된 `work_guides`

## 9. 1차 개발에서 제외하는 데이터

- 작업 시작·완료·개인실적·출퇴근
- 현장 결과·문제·인계 테이블
- 상담 원문·지원기록
- 홍보 승인·콘텐츠 상세기록
- 급여·근태·평가
- AI 분석·추천·점수
- Google Drive API 파일 메타 동기화

이 데이터는 2차 또는 3차 개발에서 별도 테이블과 RLS로 확장한다.

## 10. 검수 기준

- 승인 대기 사용자가 내부 데이터를 조회하지 못하는가
- 일반 근로자가 본인·소속 작업반에 필요한 정보만 조회하는가
- 공용기기에서 개인 일정과 개인정보가 노출되지 않는가
- 역할과 직책이 분리되어 권한이 이름에 하드코딩되지 않는가
- 퇴사자 기록의 작성자 관계가 유지되는가
- 작업방법 단계·공지 대상·일정 대상이 구현 가능한 관계로 정의됐는가
