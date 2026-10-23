# 태장 백엔드 전수검사·실사용 안정화 V1

기준 main: `627a85281d8ea78a098510d87458964a52ae03e1` (2026-10-23).
전체 판정: **PARTIAL**. 코드·실행 경로 전수조사와 안전한 국소 수정을 수행했다. 실제 직원 역할로 모든 운영 업무를 저장·승인한 검수는 수행하지 않았다.
이번 브랜치는 Draft 개발본이다. main/Production/고정 QA 변경 승인이 아니다.

## 1. 조사 기준·증거 경계

확인한 기준: `AGENTS.md`, `PROJECT_CHARTER.md`, 중앙 `DEVELOPMENT_CONSTITUTION.md`와 `WEB_ARCHITECTURE_STANDARD_V1.md`, `docs/PLATFORM_CONSTITUTION.md`, `WEB_ARCHITECTURE_ADOPTION.md`, `OPEN_SOURCE_ADOPTION.md`, `TEST_MANIFEST_AUDIT.md`, `CODEX_WORKFLOW.md`, `PHASE1_INTEGRATED_READINESS_REVIEW.md`, `PHASE1_PRODUCTION_READINESS_CHECKLIST.md`, `NOTICE_SYSTEM_OPERATIONAL_READINESS.md`, 거래처 문서 감사/확정 기획 및 최근 PR 이력.

이전 문서의 PASS는 이번 결과로 승계하지 않았다. 조사 시 열린 PR에는 가입 승인 #505, 중복 직원 복구 #454, 구조 정비 #343/#347 등이 있다. #505의 권한/서버 수정과 #454의 복구 프로그램은 포함하거나 실행하지 않았다. #428의 수동 전용 수정은 기존 `fix/payroll-hosted-manual-gate-20261009`의 `f68f0c0`을 재사용하여 이번 Draft에 통합했다. 별도 PR을 추가 생성하지 않았다.

| 증거 | 의미 | 증명하지 않는 것 |
| --- | --- | --- |
| S | 현재 소스의 메뉴→진입→RPC→migration 정의/테스트 대조 | 운영 schema 적용·실제 업무 성공 |
| L | 현재 로컬 정적/단위/기존 회귀 검사 | 실제 Auth·RLS·브라우저 업무 성공 |
| B | 실제 Chromium + 실제 HTML/컨트롤러 + 합성 API | 실제 DB/실계정 권한·운영 기록 |
| I | 해당 HEAD의 CI 격리 Supabase migration/pgTAP/Auth/Data API | 공유 운영 DB 적용 상태 |
| V | 해당 HEAD Deploy Preview 자산으로 B 재실행 | 운영 직원 계정으로 저장·승인 |
| R | 현재 운영 공개 자산/메타데이터·익명 읽기 전용 RPC | 인증된 역할의 허용 범위·변경 기능 |

완료 단계는 `IMPLEMENTED → INTEGRATED → QA_PASS → PRODUCTION_VERIFIED`로 분리한다. INTEGRATED에는 격리/공유 환경을 반드시 붙이고 QA_PASS에는 검증 시나리오를 붙인다. 아래 PARTIAL은 구현이 반드시 미완성이라는 뜻이 아니라 요청된 전체 실사용 증거가 부족하다는 뜻이다. 코드 존재만으로 PASS를 주지 않는다.

## 2. 현재 운영·환경 관측

- Production/고정 QA `/app/` HTTP 200. `staff-config`의 Production 연결은 `jgsxpdflgkqroecfjzxq.supabase.co`다. 실제 역할 세션과 Supabase management credential은 이번 실행환경에 없다.
- 공개 중인 Production은 Netlify `6ada09b3d84436131970305f`, `ready`, SHA `2bb0f0397a4eb2148da701f56d9e9874a525eada`, 게시 UTC `2026-10-22T13:04:03.634Z`다. 최신 main을 운영 버전으로 간주하지 않았다.
- 더 최신 production-context 시도 `6adb25d19d0da88a2c4dfb8a`/main `627a852...`는 `error`다. 실패한 시도를 실제 공개 배포로 보고하지 않으며 해당 시도의 실패 원인은 이번 관측만으로 확정하지 않는다. 48시간 릴리스 설정/마커/스케줄은 변경하지 않았다.
- 운영의 `app.js`, `work-guide-admin.js`, `platform-navigation-registry.js` 원문은 기준 main과 각각 byte 일치했다. 이번 대상 선택/작업방법 문제의 원본 코드가 운영에도 남아 있다. HTML 전체는 main과 불일치하므로 전체 배포 정합성을 주장하지 않는다.
- 익명으로 **읽기 전용** RPC 7개(`get_my_access_context_v2`, `get_employee_management_context`, `list_existing_employee_signup_candidates`, `get_employee_field_audit`, `list_manageable_notices`, `support_get_company_profile`, `monthly_client_documents_get`) 호출: 전부 HTTP401/SQLSTATE42501. 응답 인사자료/토큰은 기록하지 않았다. 이는 익명 차단만 검증한다.
- 운영 migration history/함수 본문/실역할 grant/RLS catalog는 NOT_VERIFIED. 익명 차단 응답으로 적용 이력이나 정상 사용자의 권한을 추정하지 않는다. DB migration/DDL/DML, 계정 초기화, 직원번호·급여·사진·근태 수정 0건.

## 3. 전체 메뉴·주요 업무 검수표

경로의 JS는 별도 표기 없으면 `app/assets/`다. 기본 메뉴 소유자는 `platform-navigation-registry.js` + `dashboard-shell.js`, 업무별 화면은 아래 소유자가 담당한다. 역할 표기는 표시 기준이며 RPC/RLS의 서버 판정이 최종이다.
모든 registry 메뉴 27개와 그 하위 업무, 별도 급여 페이지, 직원앱 연결 업무를 포함했다. 아래 테스트는 존재/실행 경로와 실제 실행 결과를 구분하여 §6에 기록한다.

| 메뉴·주요 동작 | 현재 진입/소유자 → 서버 계약 | 기존 상태·발견 문제 | 수정 | 최종 상태·증거 / 남은 조치 |
| --- | --- | --- | --- | --- |
| 로그인·로그아웃·세션 복구 | `staff/assets/staff.js`, `app.js` → Auth, `get_my_access_context(_v2)` | JWT 갱신/동시 갱신/늦은 응답 보호는 기존 #491 후속에 존재 | 유지 | PARTIAL S/L/B/R; 실제 세션 만료·재로그인 연결 검수 필요 |
| 본인 비밀번호 변경·직원 초기화 | `staff/assets/change-password.js`, `employee-management.js` → Auth, `employee-password-reset` Edge | 초기화 결과 불확실 시 재실행 차단·민감 출력 만료 구현 | 유지 | PARTIAL S/L/B; 실제 초기화 금지, Edge 배포/최근 재인증은 미확인 |
| 역할·권한·역할 미리보기 | `capability-access.js`, `phase-c-role-simulation.js` → access context/capability/RLS | 서버 계약과 기존 fallback 공존 | 유지 | PARTIAL S/L/B/R; 운영 역할별 RPC 허용은 NOT_VERIFIED |
| 대시보드·사이드바·공식 채널 메뉴 | `dashboard-shell.js`, `role-navigation-priority.js`, `platform-ui-settings.js` | 단일 registry 위 후처리·observer 여러 개 | 유지 | PARTIAL S/L/B; 클릭·스크롤 합성 회귀, 운영 역할별 전체 동선 필요 |
| 직원 관리: 검색·목록·인사카드 | `employee-management.js`, `employee-management-views.js` → `get_employee_management_context` | 최근 #487/#490 인사카드 구현 | 유지 | PARTIAL S/L/B/R; 직원 정보 쓰기 없이 합성 회귀 |
| 신규 직원/등록 요청 | 같은 소유자 → `create_employee`, `submit_employee_change_request` | Employee/Person·요청 경로 구분, 중복 생성 복구 #454 별도 | 유지 | PARTIAL S/L/B; 격리 I·운영 schema 확인 필요 |
| 직원 수정·퇴사·변경 요청 | 같은 소유자 → `update_employee_core`, `update_employee_field_audit_basic`, 요청 RPC | 보호직원/일반직원·요청/직접 교정 경계 존재 | 유지 | PARTIAL S/L/B; 실직원 값 수정 금지 |
| 가입 승인·기존 직원 계정 연결·거절 | `phase-c-account-approval.js` → signup options/candidates/approve/reject RPC | #523/#524는 부서 없는 후보/다른 계정 연결 방지 최근 main 반영, 운영 migration 여부 미확인 | 유지 | PARTIAL S/L/B/R; 서버 이력과 공유 Preview 실제 연결 확인 필요 |
| 대표이사 가입 승인 선택 | 같은 소유자/승인 RPC | 기존 #504/#505 해결본 Draft, 이번 main에 전부 반영된 것으로 간주 불가 | 제외 | PARTIAL S; 기존 PR #505에서 서버/권한 승인 의미 검수 계속 |
| 직원 사진·증명사진·신분/보험 입력 | `employee-management.js` → private Storage + guarded photo/identity/insurance RPC | 업무 사진과 민감 증명사진·급여 관련 권한 구분 | 유지 | PARTIAL S/L/B; 실제 파일/인사번호/보험값 변경 안 함 |
| 현장 설치 확인·계정 연결·조사 메모 | `employee-management.js` 인사카드 → `update_employee_field_audit` | 실제 설치는 `unchecked/installed/not_installed/login_error` 현장 확인값, 계정/근태 이력과 별개 | 유지 | PARTIAL S/L/B; 독립 `employee-field-audit.js`는 현재 메뉴 소유자 아님 |
| 출근부·월별 조회·검색·Excel | `attendance-admin.js`, `attendance-monthly.js`, `attendance-monthly-xlsx.js` → attendance admin/confirmed period RPC | 앱/외부근태/확정자료 별도 | 유지 | PARTIAL S/L/B; 운영 기간별 숫자 대조 미실행 |
| 근태 보정·사유·이력·실패 복구 | `attendance-integrity-ui.js` → `create_attendance_correction`, history | 최근 compact dialog/입력 보존 구현 | 유지 | PARTIAL S/L/B; 격리 I·실계정 허용 범위 별도 |
| 지문 XLS·직원 매핑·외부근거 | `attendance-admin.js` → external evidence/identity mapping RPC | 최근 identity matching·교체 확인 구현 | 유지 | PARTIAL S/L/B; 기존 직원 매핑/원본 업로드 미변경 |
| 일별 확정·재개·급여 handoff | 같은 소유자 → confirm/reopen/status/readiness RPC | 확정 snapshot과 급여 계산 입력 분리 | 유지 | PARTIAL S/L; `issue-254-attendance-payroll-e2e.mjs`의 새 I 필요 |
| 근태·급여관리: 입력·계산·대장·출력·잠금 | `app/payroll/live.html`, `payroll-operator-live.js`, service/Edge/proxy | 메모리 Preview와 live repository 별도, 결과 검증/급여원장 보호 존재 | 유지 | PARTIAL S/L; 실제 금액 재계산·공유 Hosted E2E 미실행 |
| 외부 급여초안 상신·검토 | `app/payroll/handoff.html`, `payroll-draft-handoff.js` → guarded handoff RPC | 상신 메뉴 role 제한과 검토 capability 별도 | 유지 | PARTIAL S/L; 격리 Auth/브라우저 기존 gate, 운영 승인선 미확인 |
| 직원앱 급여명세 연결 | `payroll-payslip-draft.js`, 관련 RPC/mobile 경로 | draft/최종 employee surface 별도, #384 Draft 포함 여부 구분 | 유지 | PARTIAL S/L; 운영 지급/공개 사실로 보고 안 함 |
| 공지 목록·필터·보관·이력 | `notice-admin.js` → manageable list/page/detail/archive RPC | #510 목록·편집 분리/미저장 이동 보호 최근 main 반영 | 유지 | PARTIAL S/L/B/R; 운영 원문 미변경 |
| 공지 작성·수정·사진·링크·미리보기 | 같은 소유자 + `notice-media.js` → save/media/Storage | #491 동일 ID 저장 후 재조회 검증 유지 | 유지 | PARTIAL S/L/B; actual save/detail/사진 I는 격리에서만 |
| 공지 기간·게시·상신·승인 | 같은 소유자 + `issue-207-promotion-information-ux.js` → routine/review/publication RPC | 일반 공지/운영 승인 대상 분리, Push는 별도 outbox | 유지 | PARTIAL S/L/B; 운영 게시·승인 금지 |
| 공지 확인·직원앱 표시·Push | worker/mobile + acknowledge/outbox/dispatcher | 게시·읽음·명시 확인·푸시 수신은 별도 사실 | 유지 | PARTIAL S/L/B; 실제 단말 canary/알림은 #513 기존 흐름, 이번 미실행 |
| 업무 배정: 대상·담당자·연결 자료·저장 | `app.js` → `save_daily_work_assignment`, admin records/options | **BROKEN**: 인접 폼 초기화/조회가 부서 대상을 전체 직원으로 바꿈 | P1-01 수정 | PARTIAL S/L/B; 수정 시나리오 QA_PASS 합성, I/운영 승인은 별도 |
| 업무 안내·오늘 정보 입력 | `app.js` → `save_today_information_item` | 같은 옵션 재구성·저장 재조회 경로 영향 | P1-01/02 수정 | PARTIAL S/L/B; 인접 폼 상태 보존, 격리 연결 검수 |
| 작업방법 기본정보·단계·순서 | `app.js` + `work-guide-admin.js` → save/detail/list/step/reorder RPC | **BROKEN**: 저장 ID 누락, 숨겨진 오류·미처리 Promise | P1-02/03 수정 | PARTIAL S/L/B; 동일 ID 재저장·실패 복구·재조회 I 추가 |
| 일정 등록·수정·연결 | `schedule-admin.js` → list/save_schedule_item, worker 조회 | 독립 사이드바 메뉴는 현재 정리 정책에서 제거, 기존 패널 코드 존재 | 유지 | PARTIAL S/L; 버튼/임베디드 도달성은 활성 메뉴와 구분 |
| 상시 안내 등록·수정 | `guidance-admin.js` → save/list_staff_guidance, 관련 일정 | 독립 메뉴 제거 정책, 기존 패널/직원 조회는 존재 | 유지 | PARTIAL S/L; 없음/빈 자료를 핵심 처리 미구현과 혼동 안 함 |
| 홍보 작성·수정·보완·보낸 글 | `phase-c-workspace-v2.js`, `issue-207-promotion-information-ux.js` → content/revision RPC, Storage | 작성 소유자 V2, 일부 테스트는 별도 구 작성기 참조 | 유지 | PARTIAL S/L/B; 실제 역할 작성→검토 I와 공개 반영 분리 |
| 홍보 검토·반려·상신·승인 | V2 → review/handoff/request changes/queue RPC | lead→operations→CEO 승인선, operations-owned 경로 별도 | 유지 | PARTIAL S/L/B; 운영 승인 수행 안 함 |
| 발행 관리·예약·종료·공개글 수정/보관/복구 | V2 + `phase-c-publication-admin.js` → publication/public change/archive RPC | 공개글 관리와 미발행 보관의 계약 분리 | 유지 | PARTIAL S/L/B; 실제 공개 웹 배포/DB 상태 미확인 |
| 홍보 링크 정보·업로드·사진 순서 | V2 + `issue-181-promotion-live-ux.js`, meta stale guard → external meta/Storage | 늦은 메타 응답 덮어쓰기·실패시 첨부 보존 기존 회귀 존재 | 유지 | PARTIAL S/L/B; 원격 공급자·실파일 업로드 별도 |
| 홈페이지 글·사진 수정 요청·승인 | `issue-146-end-to-end.js` → content slots/create_slot_change/review RPC | `homepage-change-requests.js` 구 UI는 현재 로딩 그래프 밖 | 유지 | PARTIAL S/L/B; 기존 slot 계약 유지, 실제 공개 문구 미변경 |
| 홈페이지 직접 수정·원복 | `operations-homepage-direct.js` → live override RPC/Storage | 운영총괄 capability, 공개 adapter/fallback 분리 | 유지 | PARTIAL S/L/B; 실제 사이트 문구·사진 변경 안 함 |
| 거래처 문서: 월 저장·확정·해제·복사·DOCX·메일 초안 | lazy `monthly-client-documents.js` + core/docx/email/JSZip → monthly RPC | 실제 DOCX 구현, PDF/메일 자동 발송은 확정 범위 아님 | 유지 | PARTIAL S/L; I 및 Word/LibreOffice 렌더/실문서 대조 미확인 |
| 지원사업 기업 프로필·버전 | `support-radar.js`, profile polish → profile get/save RPC | 새 버전 저장·과거 평가 보존, failed input 보존 | 유지 | PARTIAL S/L/B/R; 실제 기업값 변경 안 함 |
| 지원사업 공고·출처·평가·진행 결정 | `support-radar-notices.js` → notice/source/evaluate/decision RPC | Phase1 수동·규칙 평가 구현, 기본 home 일부 안내는 구 단계 문구 | 유지 | PARTIAL S/L; 합성 화면 외 운영 공고 저장/평가 미확인 |
| 담당 배정·내 지원사업·진행/결과·보고·중복/우선순위 | assignment/my-work/result-record/report/review/alerts 모듈 → support RPC | 여러 lifecycle 확장이 같은 화면 보강 | 유지 | PARTIAL S/L; 지원사업 Auth fixture 실제 I 별도, 운영 배정 변경 안 함 |
| 지원사업 Phase2 자동수집 | 기존 #174/#175/#189 및 UI `준비 중` | Phase1의 수동 사용과 별도인 미연결 확장 | 제외 | INTENTIONALLY_DISABLED S; 새 수집 서비스 도입하지 않음 |
| 공식 블로그·YouTube 열기·공식 아카이브 동기화 | official-channel-config/registry + Netlify/기존 archive workflow | 최근 #522 수정 main 반영, 채널 링크와 동기화는 별도 | 유지 | PARTIAL S/L/R; 이번 새 외부 발행/동기화 dispatch 안 함 |
| 관리자 설정·개인 메뉴순서·공통 노출·복원 | `platform-ui-settings.js` → settings/preferences/sidebar RPC | 개인순서와 역할 공통 노출 분리, 큰 메뉴 드래그 회귀 존재 | 유지 | PARTIAL S/L/B; 실제 개인/전사 설정값 미변경 |
| 보관·복구·감사로그·계정 조직 연결 | `operations-delete-controls.js`, `issue-146-end-to-end.js` → archive/restore/audit/account RPC | 복구 기능과 #454 중복직원 복구 별개 | 유지 | PARTIAL S/L; 실계정/삭제/복구 금지, 격리 I만 |
| 직원앱 근태·일정·작업방법·공지·웹 handoff | worker/mobile 기존 RPC/Edge | 관리자 입력과 직원 읽기 연결 구현, 기기 권한·푸시는 별도 | 유지 | PARTIAL S/L/B; 실제 휴대전화·실직원 교차 화면은 NOT_VERIFIED |

`SHELL`/`NOT_CONNECTED`로 확정한 **활성 핵심 메뉴**는 이번 조사에서 없다. 이 결론은 모든 기능이 완성됐다는 뜻이 아니다. 권한 부족·빈 데이터·정책상 숨긴 메뉴·원격 미검증은 각각 구분했다. Phase2 자동수집, 자동 메일/PDF, 기존 Draft 기능을 누락 기능으로 임의 개발하지 않았다.

## 4. 결함·수정·남은 우선순위

| ID | 등급 | 원인·재현 | 조치·현재 상태 |
| --- | --- | --- | --- |
| P0-01 (#428) | P0 | PR paths에 급여 파일/workflow가 매치되면 공유 `jgsx...`에서 실제 최고권한 handoff·role simulation DELETE/복원·급여 E2E 쓰기 실행. 2026-10-23 API 상태 `active`, 과거 PR 실행 기록 확인 | **즉시 차단**: workflow362736544 PUT disable 후 GET `disabled_manually` 확인. DB 변경 0. 차단을 재확인한 뒤 기존 f68f0c0의 수동 전용 workflow/계약 검사를 재사용. PR/push/schedule 자동 trigger 제거, main·소유자·명시 승인·정확한 열린 내부 PR HEAD·성공 Preview를 선행 검증. 별도 검토/병합·실행 승인 전 재활성화/dispatch 금지 |
| P1-01 | P1 | `renderAdminOptions()`가 모든 선택을 재생성. 부서 한정 task를 작성하고 다른 폼 reset/목록 refresh → `company` 선택. main Chrome 재현 실패 로그 보관 | app.js 기존 선택 유지. 사라진 선택은 빈 값으로 두어 새 선택 요구. 대상 변경시 target 초기화 의미 유지. 4폭 합성 Chrome 회귀 통과 |
| P1-02 | P1 | save 성공의 `id`를 숨은 필드에 반영하지 않음. 작업방법 기본정보 재저장 시 신규 INSERT 경로. 목록 오류를 내부에서 삼키면 성공처럼 폼 reset | accepted ID를 조회 전에 저장, reload 결과 boolean 반환. 실패시 입력/ID 유지·구분 안내, 다음 수동 저장은 동일 ID. 단계 저장에도 적용. 네트워크 불확실 쓰기 자동 재시도 추가 없음 |
| P1-03 | P1 | work-guide 상세/단계/순서 오류에서 숨겨진 `admin-message.textContent`만 변경. 초기 목록 Promise rejection 미처리 | 기존 message 유틸리티로 unhide/error 표시, 목록 실패 catch·재시도. 읽기 실패시 편집값 유지. 실제 Chrome 검증 |
| P1-04 (#504/#505) | P1, 기존 | 대표 가입 승인 등의 기존 해결본이 Draft/공유 DB 미반영 상태. 최신 #523 후보 목록 수정과 전체 #505 해결을 같은 것으로 판단 불가 | 기존 PR에서 진행. 승인선/권한 의미 변경을 이번 UI 복구에 섞지 않음. 운영 DB 이력 및 최신 main과 재대조 필요 |
| P2-01 (#339/#340/#343) | P2 위험 | 선택 모듈 전체 완료를 기다리는 app-ready 장벽, globals·observer·후처리 메뉴 | 기존 구조 PR 재사용 후보. 이번 재현 결함 해결에 필요 없는 전체 startup 재설계 안 함 |
| P2-02 | P2 | 미사용 renderer를 직접 실행하는 fixture가 남아 있음. 예: `employee-field-audit.js` 전용 test vs 현재 인사카드 내 조사. `operations-promotion-writer.js` fixture vs 현재 V2 작성 | 삭제보다 현재 entry와 테스트 소유자 연결 우선. 전용 fixture PASS를 실제 메뉴 PASS로 집계하지 않음. 현재 인사카드 테스트 별도 존재 |
| P2-03 | P2 | 지원사업 확장 모듈은 구현됐지만 기본 dashboard의 다음 단계 안내 일부가 과거 Phase1 초기 문구 | 업무 차단 우선순위 뒤로 보류. 자동수집 준비중 표시는 의도적 제한 |

건수: P0 **1건 즉시 차단·소스 수정 완료/병합 후속 남음**, 미차단 확정 P0 **0건**. P1 **4건 중 이번 3건 수정, 기존 1건 별도 진행**. P2 **3건 기록/미수정**. P3 **0건 구현**. 실계정 검증 부재는 결함 건수와 별도 제한이다. 전 영역에 P0가 없음을 증명했다고 보고하지 않는다.

## 5. 구조·재사용 판단

```text
staff-config → Auth session → access context/capability
  → registry + dashboard shell → 업무 controller
  → app.rpc(인증 갱신/1회 한정 JWT 재시도)
  → Supabase RPC/RLS/Storage → 업무 table + audit/version
  → 실제 DB 조회 → 같은 화면/직원앱 재조회
```

- app/assets JS108개, main HTML 직접 JS16개, app-ui의 일반/lazy 목록 JS51개, app.js 관리 모듈4개. 중복 제거한 main-admin 로딩 후보71개(다른 페이지·조건부 실행 포함, 동시에 모두 실행된다는 뜻 아님). Payroll 별도 HTML의 모듈은 별도 소유자다.
- migration202개, 소스 내 함수 이름385개. app 전체 JS의 **literal RPC172개**는 migration 이름과 모두 대응했다. 동적 RPC 이름/overload/입출력 타입/실제 운영 catalog를 전부 검증한 수치가 아니다. 구 renderer도 포함한 정적 스냅샷은 [rpc-call-inventory.json](qa/backend-stability-v1/rpc-call-inventory.json).
- 과거 `homepage-change-requests.js`, phase-c ux/navigation/refinements, pilot, 독립 field-audit 등의 파일은 현재 main-admin loader 밖이다. 배포 파일 존재·전용 fixture 존재와 실제 사용을 분리했다. parity 확인 없이 일괄 삭제하지 않았다.
- 테스트 파일225개 중187개에서 source read를 사용한다(한 파일이 실행 테스트도 포함할 수 있음). 소스 문자열 assertion과 mock은 DOM 이벤트/실제 Auth·schema 적용/저장 후 재조회 실패를 놓칠 수 있다. 이번 문제의 원인은 테스트 수 부족보다 **실행 진입점·부수적 reload·실패 후 상태**에 대한 증거 부족이다.
- 기존 staff-information UI는 선택 보존을 이미 제공한다. 이번 app.js에서도 같은 단순 패턴을 사용했고 기존 message/공식 fetch/Playwright/Supabase 계약을 재사용했다. 역할별 폼 복제·새 서비스·새 범용 폼 엔진 없음.

| 비교 항목 | 이번 선택·근거 |
| --- | --- |
| 관리자 폼/모달/상태/반응형 | 기존 `admin-authoring.css`, DOM/HTML validation, message, native dialog 재사용. 이미 해결 가능한 오류에 새 admin framework 도입 이익 없음 |
| 테이블/검색/필터 | 기존 업무별 목록/필터 보존. 새 grid가 RPC 계약/권한/미적용 migration을 해결하지 않음 |
| 파일/다운로드 | 기존 Storage/RPC, Blob/download, 기존 JSZip3.10.1(MIT) 그대로. 전송/권한 의미를 별도 업로더에 복제하지 않음 |
| 날짜/일정 | 기존 KST/native date/time 유지. 새 calendar 의존성 필요 없음 |
| 테스트 | 기존 Playwright(설치 버전·lockfile 유지, Apache-2.0)와 격리 Supabase CI 재사용. 신규 의존성/라이선스/공급망 변경 없음 |

새 OSS 도입 제안은 없다. 기존 코드/플랫폼 기능으로 재현 결함을 해결했고 신규 후보의 유지보수·보안·접근성·번들 전환비용을 정당화할 근거가 없다. 기존 모든 의존성의 최신 CVE를 전수 보증한 감사는 아니다.

## 6. 이번 실행 결과

- L: 기존 전체 `npm test`1260/1260 이후 P0 게이트 추가에 따라 payroll 재실행525/525: 합계 **1261/1261** = platform595 + public141 + payroll525, 실패/skip0. stagingSafety16/16. syntax/diff 통과.
- build:netlify 통과, 공개 article10개 생성. 클라우드에서 Naver thumbnail42개 fetch 실패 → 기존 승인 fallback42개 사용. 외부 원격 조회까지 통과한 것으로 보고하지 않는다.
- B: `backend-stability-browser.mjs`에서 실제 app HTML/transport/관련 controller를 HTTP로 실행. 합성 API, 실제 manager module 로드. 대상 보존→거절 보존→accepted save/read 실패→동일 ID 재저장→목록 반영, 작업방법/단계 복구·목록 retry를 1440/768/390/320에서 확인. 권한 없는 홍보직원 합성 context의 직접 panel 접근 차단. unrelated enhancement를 생략한 controller 검사이며 전체 실로그인 증거 아님.
- B 기존: `admin-authoring-browser.mjs` 원래 기능 게이트11개×PC/모바일=22개, 입력/폼11종×4폭=44개 통과. 직원/공지/홍보/홈페이지/사이드바 원래 assertion 보존.
- I/B: `today-board-auth-integration.mjs`의 기존 격리 합성 계정을 그대로 사용해 `tests/helpers/today-board-browser-flow.mjs`를 연결했다. 실제 `/app/` HTML·전체 script·인증·업무 API를 mock 없이 실행하며 PC1440/모바일390에서 메뉴 진입→작성→저장→목록 편집 재진입→같은 ID 수정→실제 table 재조회→대상 직원 조회/다른 작업반 비노출을 검증한다. 외부 네트워크는 차단하고 loopback Supabase만 사용한다. 이 CI 실행은 필수이며 단독 Auth suite에서 브라우저 flag가 없으면 NOT_RUN을 명시한다.
- I: `today-board-auth-integration.mjs`에 같은 guide/step/task ID 재저장, 실제 table/상세 조회·다른 작업반 직원 비노출 검증 추가. localhost-only 사전 차단으로 공유 DB에서 이 쓰기 suite 실행 불가. 실행 CI 결과는 아래 인계 기록으로 추가한다.
- 안전 게이트: 기존 workflow Bash 사전검사 자체를 합성 GitHub API로 실행. 정상1종·차단13종(잘못된 event/actor/ref/repo/승인/번호/SHA, 닫힌·외부·변경된 PR, 미준비·잘못된 Preview, API 실패) 통과. 현재 PR #525의 실제 GitHub/Netlify 상태에 읽기 전용 사전검사만 실행해 정상 경로도 확인했다. Hosted workflow dispatch/DB 쓰기 실행은 하지 않았다.
- V: 기존 browser CI의 exact-HEAD Preview 대기 절차에서 새 regression 재실행·캡처 업로드. Preview 결과는 아래 인계 기록으로 추가한다.
- Production: 배포·업무 쓰기 실행 안 함. **PRODUCTION_VERIFIED 부여 대상 없음.**

캡처는 합성 데이터만 사용한다. [PC 복구 화면](qa/backend-stability-v1/work-guide-recovery-1440.png), [모바일 복구 화면](qa/backend-stability-v1/work-guide-recovery-390.png). CI artifact는 4폭 전체를 보관한다.

## 7. 다음 개발부터 적용할 완료·재발 방지 규칙

이 브랜치에서 제안한 작업 규칙이며 main 병합 전 전 프로젝트의 활성 규칙으로 보고하지 않는다.

1. IMPLEMENTED: 실제 메뉴/entry/controller/RPC·payload·DB 소유자·현재 migration을 연결한다. dormant fixture를 실제 메뉴 증거로 사용하지 않는다.
2. INTEGRATED: 실제 Auth/RPC/RLS + 같은 ID DB readback을 격리 합성 계정으로 검증한다. 계정·급여·인사 suite는 localhost-only guard를 먼저 둔다. mock 결과와 분리한다.
3. QA_PASS: Preview 정확한 SHA/자산 + 정상 저장/실패 입력 보존/저장 후 조회 실패/인접 폼 영향/역할 차단/모바일을 확인한다. 서버 성공과 조회 실패를 구분하며 불확실 쓰기를 자동 재실행하지 않는다.
4. PRODUCTION_VERIFIED: 승인된 배포의 실제 공개 SHA·서버 함수/ACL·migration readback·역할 읽기 검증을 기록한다. 운영 쓰기 검수는 명시된 합성 전용 대상/정리 정책 없이는 하지 않는다.
5. 공유 QA/Production의 Hosted 쓰기는 자동 PR gate가 아니다. #428 수동 전용 소스 검수·병합과 별도 실행 승인 전 workflow를 다시 켜지 않는다. 격리 CI는 계속 실행한다.
6. 과거 문제는 해결/배포/검수 단계를 각각 남긴다. #523 코드 병합, #505 Draft, 운영 schema 미확인처럼 서로 다른 상태를 한 PASS로 합치지 않는다.

사람/추가 환경이 필요한 항목: 실제 역할 읽기 세션, 관리 API의 schema/Edge 배포 읽기 권한, 합성 전용 격리 Hosted 환경, Word/실제 휴대전화 확인, 최종 병합·운영 반영 승인. 비밀값을 채팅이나 저장소에 전달하지 않는다.

## 8. 최종 PR·CI·Preview 인계

Draft PR: [#525](https://github.com/cetin072/taejang_homepage/pull/525). 브랜치 `fix/backend-stability-audit-v1-20261023`. 최신 HEAD·CI run·Netlify deploy ID와 검증 결과는 PR 본문에서 정확한 SHA와 함께 갱신한다(자기 SHA를 문서에 넣기 위한 불필요한 CI 재실행 방지). 개발 Preview: https://deploy-preview-525--taejang-homepage.netlify.app/app/ . 고정 QA를 강제로 교체하지 않으며 개발 Preview를 사용자 최종 수용 검수 완료로 보고하지 않는다.
