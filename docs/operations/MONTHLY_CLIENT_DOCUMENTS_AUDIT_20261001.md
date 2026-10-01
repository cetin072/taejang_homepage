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

## 사용자 제공 원본 및 감사 정정 — 2026-10-01

이후 사용자가 `taejang-docgen-codex-handoff.zip`을 제공했다. `core.js`, `ui.html`, `taejang-docgen.html`, `tpl.json`, `pkg.zip`을 대조하여 기존 감사의 원본 미확보 blocker는 해소됐다. 4사 Artifact 기본값, deterministic 계산식, 공문·견적서·결과보고서 WordprocessingML template, DOCX package skeleton, 2026-09 golden과 2026-10 scenario를 확인했다. 첨부 ZIP·추출 텍스트는 공개 저장소에 추가하지 않고 실행에 필요한 template/package asset과 최소 회사 설정만 반영한다.

기존 기획의 PDF 전제는 원본과 달라 폐기했다. 결과물은 회사별 3쪽 DOCX, 4사 합본 12쪽 DOCX이며 파일명도 `.docx`로 바꾼다. PDF 엔진을 추가하지 않는다. 회사 기본값에는 범한 override 6명과 Artifact의 지급기한(삼현/청우 10일)을 포함하되, 후자의 계약상 법률 사실성을 주장하지 않고 변경 가능한 운영 기본값으로 취급한다.

이 정정은 당시 조사 메모를 삭제하지 않고 과거 검색 결과로 보존한다. 현재 구현·테스트·Preview 진행 상황은 [MONTHLY_CLIENT_DOCUMENTS_V1.md](../planning/MONTHLY_CLIENT_DOCUMENTS_V1.md)와 Draft PR #388에서 대조한다. 로컬 계산·메일 단위 테스트와 DOCX XML 구조 검증은 추가했으며 clean migration replay/pgTAP, Preview browser flow, PC/mobile QA 및 Word/LibreOffice 직접 렌더는 아직 별도 확인 대상이다.
