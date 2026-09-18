# Issue #229 — 4역할 핵심 흐름 감사

기준: `origin/main`의 2026-09-18 확인 결과. 이 문서는 확정 기획을 변경하지 않는 감사 기록이며, 실제 계정·Production 데이터는 다루지 않는다.

## 적용 기준

- `PROJECT_CHARTER.md`
- `docs/PLATFORM_CONSTITUTION.md`
- `docs/planning/GENERAL_WORKER_INFORMATION_BOARD_V1.md`
- `docs/planning/PROMOTION_EMPLOYEE_DASHBOARD_V1.md`
- GitHub Issue #226, #229

## 확인 결과

| 역할 | 흐름 | 분류 | 근거 / 남은 검증 |
| --- | --- | --- | --- |
| 일반직원 | 로그인 후 출퇴근·오늘 상태 | 구현 및 자동 계약 PASS | 위치·중복·근무 제외·퇴사 경계는 `worker-mobile-attendance`와 Auth/RLS 통합 테스트에 있다. 실제 브라우저/기기 검증은 대기다. |
| 일반직원 | 공지 목록·상세·읽음 | 구현 및 자동 계약 PASS | 미래·만료·대상 외 공지 차단과 중요공지 읽음 버전 계약은 `staff-schedules-notices-auth-integration`에 있다. 실제 알림 전달은 #227 범위다. |
| 일반직원 | 공식 채널 바로가기 | 구현 및 자동 계약 PASS | 공통 공식채널 구성과 하단 바로가기 계약이 플랫폼 정적 회귀에 있다. |
| 홍보직원 | 작성→임시저장→상신 | 구현 및 자동 계약 PASS | `save_promotion_draft`와 `submit_promotion_revision` 경로 및 상태 표기가 정적 회귀로 고정되어 있다. |
| 홍보직원 | 보완 요청→수정→재상신 | 구현 및 자동 계약 PASS | `needs_revision` 전용 큐, 피드백 조회, 새 revision 상신 경로가 정적 회귀에 있다. 실제 계정 브라우저 QA는 대기다. |
| 운영팀장 | 직원 등록·수정 요청·삭제 제한 | 구현 및 자동 계약 PASS | 전사 신규 직원 등록, 기존 직원 직접수정 제한, 복구 가능한 삭제/감사 경계는 capability 및 Employee Auth/RLS 통합 테스트에 있다. |
| 운영팀장 | 홍보 검토·보완·승인·운영총괄 상신 | 구현 및 자동 계약 PASS | 역할별 review action과 상위 승인선 guard가 promotion 정적 회귀와 DB 계약 테스트에 있다. |
| 운영팀장 | 홈페이지 허용 콘텐츠 관리 | 구현 및 자동 계약 PASS | allow-list, 현재값/변경값, preview, recoverable history 경계가 정적 회귀에 있다. |
| 운영총괄 | 일반 운영 capability superset | 구현 및 자동 계약 PASS | capability registry와 UI gate가 `operations_manager_auto_grant` 및 개인 출퇴근 제외를 검증한다. 실제 RLS 실행은 CI 재검증 대기다. |
| 운영총괄 | 급여초안 최종 승인 | **P0 기능 결함** | `payroll_month` 초안/계산·잠금 계약은 있지만, 운영팀장 검토→운영총괄 상신→최종승인의 도메인 상태·상신함·감사·동일 월/초안 중복 방지 계약을 찾지 못했다. |

## P0-229-01 — 급여 handoff 계약 미구현

Issue #226/#229의 범위인 급여 계산엔진 자체는 변경하지 않는다. 다만 다음 업무플랫폼 계약이 필요하다.

```text
확정 근태 / 외부 급여초안
  → 운영팀장 검토
  → 운영총괄 상신
  → 최종 승인 또는 보완
```

현재 이 상태전이와 상신함은 존재하지 않는다. 이는 `PayrollDraft`의 소유 경계, 외부 계산 결과 식별자, 최종 승인 효과, 수정/재상신 규칙을 새로 결정해야 하는 데이터·상태 계약 변경이다. 따라서 Auth/RLS/Employee 의미를 보존한 채 임의로 migration/RPC를 추가하지 않는다.

필요한 사용자/기획 결정:

1. 별도 급여 프로젝트가 전달하는 최소 draft 식별·상태·근태 확정 참조 계약
2. 운영총괄 최종 승인 후 업무플랫폼이 기록할 결과와 외부 급여 프로젝트로의 반환 방식
3. 보완/반려 가능 여부와 재상신 규칙

## 검증 상태

- PASS: `npm test` — 792 tests (platform static, public homepage, payroll regression)
- PASS: `npm run test:staging-safety` — 15 tests
- PASS: `git diff --check`
- 미실행: 로컬 Supabase Auth/RLS integration — Docker/Podman이 이 실행 환경에 없음
- 미실행: Promotion Browser QA — Chrome/Chromium 실행 파일이 이 환경에 없음
- 다음: Draft PR CI에서 Linux/Docker/Chrome 검증 후 결과를 이 기록과 Issue #229에 갱신

## 감사 중 수정한 회귀 인프라

Windows checkout의 CRLF 때문에 source-contract 정규식 4개가 거짓 실패하던 문제를 테스트 입력의 LF 정규화로 해결했다. 제품 동작이나 Auth/RLS/Employee/급여 계약은 변경하지 않는다.
