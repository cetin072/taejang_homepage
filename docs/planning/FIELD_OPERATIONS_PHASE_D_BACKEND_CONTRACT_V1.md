# Phase D 현장관리 백엔드 계약 V1

상태: 확정 구현 계약

기준 문서: `docs/planning/FIELD_LEAD_OPERATION_RECORDS_V1.md`
상위 Goal: #89
실행 Issue: #218

## 1. 목적

현장관리 MVP는 일반 근로자에게 진행·완료·생산실적 입력을 요구하지 않고, 현장 책임자가 작업반 단위로 당일 업무를 배정하고 예외만 조정할 수 있게 한다.

백엔드는 기존 태장 업무플랫폼의 Employee/Auth/부서/작업반/작업방법/감사로그를 재사용한다. 별도 직원 마스터나 별도 작업방법 시스템을 만들지 않는다.

## 2. 기존 자산 재사용

- 직원 Source of Truth: `people` → `employees`
- 계정 연결: `account_person_links` → `profiles`
- 부서: `departments`
- 작업반: `work_groups`
- 기존 계정 기반 작업반 호환: `work_group_members`
- 일반 근로자 Today 카드: `daily_work_assignments`
- 작업방법: `work_guides`, `work_guide_steps`
- 권한: `platform_capabilities`, `role_capability_grants`, `private_actor_can(...)`
- 범위: `department_lead`, `field_lead`, `operations_manager`
- 감사: `private_append_audit(...)`

## 3. 중요한 식별자 결정

현장 작업의 근로자 식별자는 `employees.id`를 사용한다.

이유:
- Employee는 계정이 없어도 존재한다.
- 기존 `work_group_members.profile_id`만 사용하면 계정 없는 근로자를 작업반에 배정할 수 없다.
- Auth 계정은 업무권한과 개인 Today 화면을 위한 선택적 연결이며 직원 존재 자체의 전제가 아니다.

따라서 Employee 기반 작업반 구성과 당일 예외 override를 additive하게 추가한다. 기존 profile 기반 Today Board와 `work_group_members`는 호환을 위해 유지한다.

## 4. 첫 구현 슬라이스

### 4.1 Employee 기반 작업반 구성

`work_group_employee_memberships`

- `work_group_id`
- `employee_uuid`
- `member_type`: 기존 `work_group_member_type` 재사용
- `start_date`, `end_date`
- `assigned_by`, 생성/수정 시각

정식 작업반 구성 변경은 운영총괄 또는 해당 부서 팀장만 가능하다. 현장반장은 정식 구성원을 임의 변경하지 않고 당일 예외 override를 사용한다.

### 4.2 반복업무 템플릿

`field_work_templates`

- 부서, 업무명, 업무구분
- 기본 작업반, 담당 반장
- 기본 장소
- 한 줄 설명
- 준비물
- 기존 `work_guides` 연결
- 완료 기준
- 주의사항
- 자주 발생하는 문제
- 기본 시작/종료 시각
- 권장 인원
- 인계 필요 여부
- 상태, 버전, 변경사유, 작성·수정자와 시각

작업방법 단계 자체는 중복 저장하지 않고 기존 `work_guides/work_guide_steps`를 연결한다.

### 4.3 당일 현장업무

기존 `daily_work_assignments`를 그대로 근로자 Today 카드로 사용한다.

Phase D에서 다음 메타데이터를 additive column으로 연결한다.

- `field_template_id`
- `field_time_block`
- `field_daily_note`

템플릿에서 당일 업무 생성 시 대상은 기본적으로 `work_group`이다. 기존 `status`는 게시/비활성 상태 의미를 유지하고, 작업 결과·문제·인계는 후속 기록 테이블에 분리한다.

### 4.4 당일 예외 근로자

`field_assignment_employee_overrides`

- `assignment_id`
- `employee_uuid`
- `override_action`: `include` 또는 `exclude`
- `reason`
- 작성자/시각

한 근로자를 다른 업무로 이동할 때는 기존 업무에서 `exclude`, 새 업무에서 `include`로 기록한다. 기본 작업반 구성 자체를 수정하지 않는다.

## 5. 권한 계약

신규 역할은 만들지 않는다.

신규 operational capability:

- `field.membership.manage`
- `field.template.manage`
- `field.assignment.manage`

기본 grant:

- `department_lead`: 3개 모두
- `field_lead`: `field.template.manage`, `field.assignment.manage`
- `operations_manager`: operational auto grant

`super_admin` 기술역할 자체는 일반 현장업무 권한의 우회로 사용하지 않는다.

범위 규칙:

- 운영총괄: 전사
- 부서 팀장: 자기 부서
- 현장반장: 자신이 `lead`로 배정된 작업반 및 해당 작업반이 속한 부서의 허용된 기능
- 일반 근로자: 관리 RPC 실행 불가

## 6. 쓰기·조회 경계

새 현장 테이블은 browser role에 직접 write 권한을 주지 않는다. 모든 변경은 SECURITY DEFINER RPC에서 capability + 부서/작업반 scope를 함께 검증한다.

첫 슬라이스 RPC:

- `list_field_work_group_members(...)`
- `set_field_work_group_employee(...)`
- `list_field_work_templates(...)`
- `save_field_work_template(...)`
- `create_field_assignment_from_template(...)`
- `set_field_assignment_employee_override(...)`
- `get_field_assignment_roster(...)`

`get_field_assignment_roster(...)`는 작업일 기준 작업반 Employee membership에 include/exclude override를 합성하여 유효 인원을 반환한다.

## 7. 감사·삭제 원칙

- 주요 변경은 `private_append_audit(...)`에 actor/target/reason/핵심 before-after를 남긴다.
- 템플릿은 hard delete하지 않고 `inactive`로 전환한다.
- 작업반 membership은 기간 종료로 이력을 남긴다.
- 당일 override는 변경 시 이전 값을 감사로그에 남긴다.

## 8. 민감정보 금지

현장관리에는 다음을 저장하지 않는다.

- 장애 세부정보
- 진단명·약물·상담 원문
- 주민번호·계좌
- 개인 생산성 점수·순위
- 실시간 위치

건강/상태로 인한 업무변경이 필요하면 현장에는 `상태 확인 필요` 수준의 업무사실만 기록하고 상세 내용은 근로자지원 모듈로 분리한다.

## 9. 후속 슬라이스

첫 슬라이스 안정화 후 별도 additive 변경으로 다음을 이어간다.

1. 작업 결과
2. 예외·변경
3. 문제·조치
4. 인계
5. 근로자지원 연결
6. 예외 중심 운영총괄 대시보드

후속 기록도 일반 근로자에게 입력을 강요하지 않는다.
