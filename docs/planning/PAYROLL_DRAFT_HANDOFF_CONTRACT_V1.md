# 급여초안 운영 handoff 계약 v1

- 상태: **확정**
- 기준 Issue: #232
- 상위 Goal: #226
- 작성일: 2026-09-18

## 1. 목적과 경계

이 계약은 급여 계산, 보험·세금, 지급, 실제 월잠금을 구현하거나 바꾸지 않는다.

태장 업무플랫폼이 책임지는 것은 다음 운영 handoff다.

```text
별도 급여 프로젝트
  → 급여초안 생성
  → 운영팀장 검토
  → 운영총괄 상신
  → 운영총괄 최종 승인 / 보완요청 / 반려
  → 별도 급여 프로젝트가 승인상태를 보호된 read contract로 조회
```

업무플랫폼의 `approved`는 실제 송금, 지급, 월잠금, 소급지급을 실행하지 않는다.

## 2. Source of Truth

1차 handoff의 authoritative draft는 **별도 급여 프로젝트의 외부 급여초안**이다.

필수 식별·참조:
- `payroll_period`
- `external_draft_id`
- `external_draft_revision`
- `source_fingerprint`
- `source_generated_at`
- `confirmed_attendance_ref`
- `confirmed_attendance_version`

기존 내부 `payroll_calculation_runs`는 존재하는 경우 optional reference로 연결할 수 있으나 외부 draft identity를 대체하지 않는다.

## 3. 최소 handoff 데이터

최소 저장/조회 범위:
- 대상월
- external draft id
- external draft revision
- source fingerprint
- source generated timestamp
- confirmed attendance reference/version
- employee count
- gross payroll summary amount
- unresolved/review-required exception count
- 현재 상태
- 운영팀장 actor / reviewed at / note
- submitted at
- 운영총괄 actor / final action at / note
- immutable audit history
- optional internal calculation run reference

금지:
- 주민등록번호
- 계좌정보
- 건강/장애정보
- 개별 직원 민감 HR 원문
- 업무플랫폼 내부에서 계산식 복제

## 4. 상태 계약

최소 상태는 다음 6개로 고정한다.

- `draft`
- `lead_review`
- `submitted`
- `changes_requested`
- `rejected`
- `approved`

기본 흐름:

```text
draft
  → lead_review
  → submitted
      ├─→ changes_requested
      ├─→ rejected
      └─→ approved
```

### 보완/재상신
- `changes_requested` 후 같은 `external_draft_id`는 유지할 수 있다.
- **external_draft_revision은 반드시 증가해야 한다.**
- 새 revision은 새 검토대상이다.
- 이전 revision과 결정이력은 삭제하거나 덮어쓰지 않는다.

### 반려
- `rejected` 된 동일 revision은 terminal이다.
- 동일 revision을 다시 `submitted`로 되살리지 않는다.
- 다시 진행하려면 새 revision이 필요하다.

## 5. 중복 방지

최소 idempotency/unique 의미:

`payroll_period + external_draft_id + external_draft_revision`

동일 revision 중복 상신은 server-side에서 차단한다.

## 6. 역할과 권한

### 운영팀장 (`promotion_lead`)
- draft 조회
- 검토 시작
- 검토 메모
- 운영총괄 상신
- 보완요청 후 새 revision 재검토/재상신

### 운영총괄 (`operations_manager`)
- 운영팀장이 가능한 일반 운영 handoff 기능을 모두 수행 가능
- payroll submission을 최우선 상신함에서 조회
- 보완요청
- 반려
- 최종 승인

운영총괄은 #226의 일반 운영 capability superset 원칙을 유지한다.

### lower roles
- handoff 조회/변경 금지

UI 숨김만으로 권한을 구현하지 않고 RPC/RLS/server boundary에서 동일하게 강제한다.

## 7. 운영팀장 최소 요약

운영팀장 화면에는 최소 다음을 표시한다.

- 대상월
- external draft id/revision
- 생성시각
- confirmed attendance ref/version
- 직원 수
- 총 급여 요약액
- unresolved/review-required 예외 건수
- 현재 상태
- 검토 메모

개별 급여 상세가 필요하면 기존 권한 있는 급여 화면 또는 별도 급여 프로젝트로 이동한다.

## 8. 운영총괄 상신함

payroll submission은 운영총괄 상신함 최상위 우선순위로 표시한다.

최소 표시:
- 대상월
- 운영팀장
- 상신시각
- 직원 수
- 총액 요약
- 예외/확인필요 건수
- draft revision
- 현재 상태
- 다음 action

잠금화면/Push에는 개별 직원 급여금액·민감정보를 노출하지 않는다.

## 9. 승인 결과 반환

1차는 callback/webhook이 아니라 **pull/read 방식**이다.

별도 급여 프로젝트가 보호된 RPC/API/adapter를 통해 최소 다음을 조회할 수 있어야 한다.
- external draft id/revision
- payroll period
- `approved | changes_requested | rejected`
- final actor/time
- non-sensitive decision metadata

1차에서 하지 않는다.
- 외부 시스템 callback
- 자동 지급
- 월잠금
- 은행 API
- payment export

## 10. 감사 계약

모든 상태 변경마다 최소 다음을 감사 가능하게 남긴다.
- actor
- action
- from_state
- to_state
- timestamp
- reason/note
- payroll period
- external draft id
- external draft revision

금액/개인 민감정보는 audit metadata에 넣지 않는다.

## 11. 구현 안전선

유지:
- 기존 Supabase/Auth/RLS/Employee 의미
- immutable employee identity
- 기존 급여 계산엔진
- 실제 지급/월잠금 분리
- Production 미적용
- Draft PR 유지

사용자 승인 전 금지:
- Ready for review
- main merge
- Production migration/deploy
- 실제 지급/송금/월잠금
- 신규 유료 외부 서비스

## 12. 구현 검수 기준

- 외부 draft identity/revision이 authoritative
- internal calculation run은 optional reference
- 6-state contract 반영
- rejected action/RPC/UI 존재
- changes_requested 이후 새 revision만 재상신 가능
- 이전 revision/history 불변 보존
- 외부 payroll project용 protected read contract 존재
- 운영팀장/운영총괄 승인 요약정보 표시
- operations_manager superset 유지
- audit에 from/to/reason/external identity 명시
- duplicate key가 external draft identity 기준
- 실제 지급·월잠금 side effect 없음
- Auth/RLS/browser/full CI/Preview exact-head 재검증

## 13. 결정 이력

- 2026-09-18: Issue #229 감사에서 lead-to-operations 급여 handoff 미구현을 P0로 확인.
- 2026-09-18: Issue #232에서 상태·상신·승인·감사 기본계약 승인.
- 2026-09-18: 최종 사용자 결정으로 **외부 급여초안 adapter 우선**, protected pull/read result contract, revision 증가형 재상신, 운영팀장 총액요약 열람을 확정.
