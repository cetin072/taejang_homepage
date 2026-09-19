# 근태 확정부터 급여 초안까지의 흐름 v1

- 상태: **확정**
- 기준: GitHub Goal #226, Issue #251~#255
- 확정일: 2026-09-19

## 목적과 범위

일반직원의 GPS 출퇴근, 지문 Excel 근거, 운영팀장 수기 보정을 하나의 재현 가능한 근태 확정 흐름으로 연결하고, 이후 기존 급여엔진의 회사 급여대장 가안과 개인별 급여명세서 초안까지 안전하게 전달한다.

이 흐름은 실제 급여 지급·송금·세금 또는 4대보험 신고·급여 최종 잠금을 포함하지 않는다. 실제 직원의 민감정보와 급여자료는 fixture·로그·공개 저장소에 넣지 않는다.

## 확정된 데이터와 승인 흐름

1. GPS·지문 Excel·수기 보정은 서로 다른 evidence로 보존한다. GPS와 지문 원본은 수정·삭제하지 않고, 수기 보정은 append-only 이력으로 남긴다.
2. `promotion_lead`와 `operations_manager`는 예외를 우선 확인한다. 누락 시간 입력, 기존 시간 변경 또는 무효화의 사유 규칙은 `ATTENDANCE_INTEGRITY_POLICY_V1.md`를 따른다.
3. 하루 전체를 한 번에 확정한다. 확정은 immutable revision이며 직원별 effective attendance와 GPS·지문·수기 provenance 및 deterministic fingerprint를 보존한다.
4. 확정된 하루의 수정은 `reopen reason → 보정 → 새 revision 재확정`으로만 수행한다. 이전 revision은 삭제하거나 덮어쓰지 않는다.
5. 장기 근태 조회는 immutable daily confirmed record에서 도출한다. 주·월·연 데이터를 별도로 복제하지 않는다.
6. 급여는 현재 근태를 직접 읽지 않고, 월별로 선택된 confirmed revision의 exact snapshot/fingerprint를 사용한다. 기존 XLS/XLSX 경로는 과거자료·비상 fallback·Golden comparison으로 유지한다.
7. 개인 급여명세서는 완료된 기존 payroll calculation result를 조회해 `급여명세서 초안 / 검토 필요`로 표시하며, 재계산이나 발송·지급을 수행하지 않는다.

## 이번 단계 구현 대조

| 항목 | 상태 | 기준 |
| --- | --- | --- |
| Step 1: 운영팀장 수기 보정 및 사유 규칙 | 구현 완료 | #256 |
| Step 2: GPS·지문 Excel evidence 비교와 예외 우선 화면 | 구현 완료 | #257 |
| Step 3: 일일 immutable confirmation revision과 reopen | 구현 완료 | #251 |
| Step 4: 장기 confirmed attendance ledger/기간 조회 | 미구현·후속 작업 | #252 |
| Step 5: monthly readiness gate와 payroll input snapshot | 미구현·후속 작업 | #253 |
| Step 6: synthetic month E2E regression | 미구현·후속 작업 | #254 |
| Step 7: 개인 급여명세서 초안 | 미구현·후속 작업 | #255 |

## 검수 기준

- 권한 판단은 화면 역할명이 아니라 server-side capability와 RLS/RPC 경계에서 수행한다.
- 정상 행별 승인 버튼이 아니라 예외 해소 후 하루 전체 확정을 기본 UX로 둔다.
- 확정된 revision은 이전 GPS·지문 evidence와 보정 이력을 그대로 추적할 수 있어야 한다.
- 확정 후 보정은 reopen 없이는 차단되고, reopen actor·시각·사유는 감사기록과 함께 보존되어야 한다.

## 결정 이력

- 2026-09-19: Goal #226의 Step 1~7 흐름과 단계별 범위를 확정 기록으로 등록했다.
