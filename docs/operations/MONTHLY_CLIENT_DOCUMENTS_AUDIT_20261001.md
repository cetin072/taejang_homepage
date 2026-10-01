# 월별 거래처 문서 기능 사전 감사 — 2026-10-01

기준 main: 7cde06cdc2ae8700feb9df9d9b6d40a22b6cf9ce
기능 브랜치: feat/monthly-client-documents
기획: ../planning/MONTHLY_CLIENT_DOCUMENTS_V1.md

## 기존 구현과 재사용 경계

| 항목 | 확인 코드/문서 | 판단 |
| --- | --- | --- |
| Capability | app/assets/capability-access.js; supabase/migrations/20260909150000_issue_148_capability_foundation.sql | get_my_access_context_v2 / private_actor_can 재사용 |
| 운영총괄 권한 | supabase/migrations/20260921233000_issue_320_unified_operations_authority.sql | operational auto-grant 사용. 다른 역할 권한 자동 확대 금지 |
| Simulation | private_effective_role_codes / private_actor_capabilities; CAPABILITY_ACCESS_BEHAVIOR_MATRIX.md | actual-role 우회 대신 effective capability로 보호 |
| Sidebar | app/assets/dashboard-shell.js; platform-navigation-registry.js; role-navigation-priority.js; capability-ui-gates.js | 기존 업무 운영 section에 슬롯 추가, 단일 소유자 유지 |
| 문서 출력 | app/assets/payroll-ledger-xlsx.js; support-radar-report.js; payroll-payslip-draft.js | XLSX/HTML 조회/print 참고. 자동 PDF 엔진은 확인되지 않음 |
| Migration | docs/operations/PHASE1_STAGING_SETUP_STEP_BY_STEP.md | 파일 작성 허용, Production 금지. 기존 Staging 문서는 phase1 전용으로 신규 기능 적용 근거가 아님 |
| Unit/browser | package.json; scripts/run-test-group.mjs; tests/issue-320-unified-capability-sidebar.test.js; tests/browser/sidebar-runtime-gate.html | Node 회귀 및 Playwright 기반을 재사용 |
| RLS 테스트 | supabase/tests/database/issue_148_capability_foundation.test.sql | 신규 RPC/테이블 pgTAP 접근 및 확정 경쟁 테스트 필요 |

## 원본 검색 결과

- docs/assets/tests/supabase의 범한·삼현·부담기초액·총 산입·monthly_client·공문견적 키워드 검색: 공개 콘텐츠의 공동출자기업 이름 외 계산/계약/출력 원본 없음.
- docs/planning의 거래처·공문·견적·결과보고 검색: 범용 장기 방향 외 해당 기능의 확정 계약 없음.
- GitHub 전체 상태 Issue에서 거래처, 공문, 견적 검색: 해당 작업 없음. 월별 검색 결과는 기존 급여 Issue이며 이 기능 원본이 아님.
- 열린 PR과 remote monthly/client branch 검색: 해당 기능 흐름 없음.
- 첨부 지시문은 요구사항이며 Claude 소스, URL, 실문서 또는 9월 golden 값은 포함하지 않음.

## 아직 수행하지 않은 항목

runtime 구현, capability/DB migration, 문서 생성, 기능/권한 테스트, 9월 golden, 10월 시나리오, Deploy Preview 대표 흐름, PC/mobile 자체 검수는 미수행이다. planning-only Draft PR/Preview가 생겨도 기능 구현 또는 기능 QA PASS로 보고하지 않는다.

기존 작업 폴더의 모바일 미커밋 변경은 포함하지 않았고 별도 managed worktree를 사용했다. 기존 정상 Core를 재작성하거나 계약값을 추정하지 않았다. 원본 자료가 제공되면 같은 브랜치/PR에서 구현을 이어간다.

## 후속 메일 구현 기록

사용자가 2026-10-01 표준 메일 요구사항과 9월 메일 golden 숫자를 추가 제공했다. app/assets/monthly-client-document-email.js에 순수 생성 모듈을 작성했고 tests/monthly-client-document-email.test.js를 기존 platformStatic 그룹에 등록했다. 담당자 DB/편집·복사 UI/실제 PDF 비교는 아직 구현되지 않았다. 기존 원본 부재 기록은 전체 문서 양식/4사 계약/계산식에 대해 계속 유효하며 메일 표시 fixture 부재는 해소되었다.
