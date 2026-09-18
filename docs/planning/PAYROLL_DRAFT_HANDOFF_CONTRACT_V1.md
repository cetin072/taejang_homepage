# 급여초안 운영 handoff 계약 v1

- 상태: **검토 중 — 사용자 승인 전 구현 금지**
- 기준 Issue: #232
- 상위 Goal: #226
- 작성일: 2026-09-18

## 1. 목적과 경계

이 계약은 급여 계산, 보험·세금, 지급, 실제 월잠금을 구현하거나 바꾸지 않는다. 이미 계산된 급여초안이 다음 운영 절차에서 누락되지 않도록 하는 업무플랫폼 계약만 정의한다.

```text
확정 근태 / 별도 급여 프로젝트의 초안
  → 운영팀장 검토
  → 운영총괄 상신
  → 운영총괄 최종 승인 또는 보완 요청
```

현재 `payroll_months`와 `payroll_calculation_runs`는 가안 계산·근태 예외 검토용이며, 위 상신 상태나 운영총괄 상신함을 제공하지 않는다.

## 2. 기존 정본과 재사용

- 직원 연결은 기존 immutable `employees.id` / `employee_id`만 사용한다.
- 근태·계산 초안 식별은 기존 `payroll_months.id`, `payroll_months.payroll_month`, `payroll_calculation_runs.id`, `input_fingerprint`를 우선 참조한다.
- 기존 급여 가안의 `locked`는 실제 급여 확정·월잠금 승인 gate로 남긴다. handoff 최종승인은 이를 자동으로 `locked`로 바꾸지 않는다.
- 새 handoff는 급여 금액·주민등록번호·은행정보·건강·장애 정보를 audit, push, 일반 상신함 제목/본문에 기록하지 않는다.

## 3. 제안하는 최소 handoff 단위

각 handoff는 하나의 `payroll_month`와 하나의 정확한 calculation run 또는 외부초안 참조를 묶는다.

| 필드 | 제안 | 목적 |
| --- | --- | --- |
| `payroll_month_id` | 필수 FK | 대상 월 고정 |
| `calculation_run_id` | 내부 가안일 때 필수 FK | 정확한 근태/계산 기준 고정 |
| `external_draft_ref` | 외부 급여 프로젝트 초안일 때 필수 | 외부 시스템의 변경 불가능한 초안 식별 |
| `source_fingerprint` | 필수 | 상신 이후 기준 변경 감지 |
| `status` | 아래 상태집합 | 재시도·보완·상신 추적 |
| `submitted_by/at`, `reviewed_by/at`, `approved_by/at` | 최소 감사 필드 | actor/time 보존 |
| `reason` | 보완/승인 때 필수, 짧은 텍스트 | 다음 행동 설명 |

`calculation_run_id`와 `external_draft_ref`는 정확히 하나만 존재해야 한다. 외부 초안의 금액 상세는 업무플랫폼에 복사하지 않으며, 권한 있는 별도 급여 화면/시스템으로 안전한 링크 또는 adapter 조회를 사용한다.

## 4. 제안 상태와 불변식

```text
lead_review
  ├─(보완 요청)→ changes_requested ─(수정 기준 재검토)→ lead_review
  └─(상신)→ submitted_to_operations
                 ├─(보완 요청)→ changes_requested
                 └─(최종 승인)→ operations_approved
```

- 운영팀장만 `lead_review → submitted_to_operations`를 수행한다.
- 운영총괄만 `submitted_to_operations → operations_approved` 또는 `changes_requested`를 수행한다.
- `operations_approved`는 급여 계산·지급·월잠금 효과를 발생시키지 않는 업무플랫폼 승인 기록이다.
- 동일한 `payroll_month_id`와 동일 source reference에는 열린 handoff를 하나만 허용한다.
- source fingerprint가 달라지면 기존 상신을 자동 승인하지 않고 `changes_requested` 또는 재검토 상태로 되돌린다.
- 모든 전이는 security-definer RPC 내부에서 현재 계정 상태·capability·대상 run/월 일치·현재 상태를 transaction lock 아래 재확인하고 짧은 audit event를 남긴다.

## 5. 역할과 화면

### 운영팀장 (`promotion_lead`)

- 본인의 검토 대기 초안, 예외 수, 기준월, 다음 행동만 본다.
- unresolved exception 또는 review-required 상태가 있으면 상신할 수 없다.
- 상신 시 전체 금액을 자유 텍스트로 복사하지 않고 계산 기준·예외 해소 여부·짧은 검토 메모만 전달한다.

### 운영총괄 (`operations_manager`)

- 상신함에서 급여 handoff를 가장 높은 우선순위로 표시한다.
- 상신자, 시각, 기준월, 현재 상태, 예외 해소 여부, 다음 행동을 확인한다.
- 승인 또는 보완 요청을 하고 감사기록을 남긴다.

### 일반직원·홍보직원

- 급여 handoff·상신함·급여초안에 접근하지 않는다.

## 6. 외부 급여 프로젝트 adapter 결정

아래 중 하나를 사용자 승인으로 확정해야 한다.

1. **내부 가안 참조 우선**: 현재 `calculation_run_id`를 1차 handoff의 정본으로 사용하고, 별도 급여 프로젝트는 운영총괄 승인 상태를 사람이 확인한다.
2. **외부초안 adapter 우선**: 별도 급여 프로젝트가 불변 `external_draft_ref`, 기준월, source fingerprint, 예외 개수만 안전한 API/파일 adapter로 전달한다. 업무플랫폼은 이를 조회·상신하지만 계산 상세를 저장하지 않는다.
3. **혼합**: 내부 calculation run과 외부초안 ref가 같은 기준월/fingerprint로 대조된 경우에만 handoff를 연다.

## 7. 승인 필요 사항

다음은 현재 확정되지 않았으므로 사용자 승인 없이는 migration, RPC, 권한, UI를 구현하지 않는다.

1. 1차 adapter 방식(내부 가안 참조, 외부초안 adapter, 혼합)
2. 운영총괄 승인 결과의 반환 방식(사람 확인만, 외부 시스템 상태 callback, 후속 export)
3. 보완 요청 뒤 이전 초안의 재사용 여부와 새 fingerprint 발생 규칙
4. 운영팀장이 열람할 급여 요약의 최소 범위

## 8. 구현 후 검수 기준

- 같은 기준월/초안의 동시 상신이 하나의 열린 handoff로 수렴한다.
- 기준 run 또는 fingerprint가 바뀌면 이전 상신은 최종승인할 수 없다.
- 일반직원·홍보직원은 조회·변경 모두 거부된다.
- 운영팀장은 검토/상신만, 운영총괄은 상신함 승인/보완만 가능하다.
- audit에는 actor, time, transition, 참조 ID와 사유만 남고 급여 금액·민감정보는 남지 않는다.
- handoff 승인으로 실제 급여 지급, 계산규칙 변경, `payroll_months.status='locked'` 전환이 발생하지 않는다.

## 9. 결정 이력

- 2026-09-18: Issue #229 감사에서 lead-to-operations 급여 handoff 계약 미구현을 P0로 확인. 이 문서를 검토용 초안으로 작성했으며 제품 계약은 아직 변경하지 않았다.
