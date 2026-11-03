# 근무조건·연차·출근 알림 V1 구현 현황

PR #572. 확정 기획은 `docs/planning/WORK_TERMS_ATTENDANCE_REMINDERS_AND_LEAVE_V1.md` 최신 절을 따른다.
운영 DB·실직원 데이터·발송·예약 활성화·Play 제출은 하지 않는다.

## 연결

- 웹 직원관리 → `save_employee_work_terms` / `initialize_employee_leave` → 직원 UUID 기준 원본.
- 앱 → `get_my_leave_context` → 신청 예약을 반영한 남은 개수만 표시.
- 앱 종일/앞반차/뒤반차 신청 → 서버의 KST 3일 기한·근무일·잔여 검증 및 account 행 잠금.
- 웹 운영총괄·운영팀장 → `review_employee_leave` → 사용 차감과 근태 연동을 같은 트랜잭션에서 처리.
- 대기 취소는 서버 예약을 해제한다. 승인 후 취소는 미확정 정책이므로 차단한다.
- `private_employee_schedule` 하나가 휴무·종일·반차·휴게시간을 계산하며 앱 출근 조회와 서버 알림 판정이 재사용한다.
- 실제 출근 저장은 기존 위치·06시·예외·권한·QA 경로를 유지하고 새 휴무 제한만 추가한다.
- 출근 누락은 기존 `notification_devices/events/deliveries`를 사용한다. 공지 subject와 출근 subject를 DB check로 구분한다.
- `attendance-reminders` 함수는 기존 ticket/receipt 완료 RPC·Expo 전송 계약을 재사용한다. 기존 공지 canary 함수와 활성화 설정은 변경하지 않는다.

## 월 발생

관리자가 오늘 기준 발생량·잔여량과 월 발생 대상 여부를 확인한다. 기준일 이전 사용분을 다시 차감하지 않는다.
기준일 다음 달부터 매월 1일 +1, 직원/월 키로 중복 발생을 방지한다.
`private_reconcile_leave_monthly`는 service_role 전용이며 앱/관리자 guarded 조회에서도 같은 함수로 보충 반영한다.
매월 실제 예약 실행은 아직 활성화하지 않는다. 승인된 스케줄러에서 이 RPC 또는 Edge의 monthly mode를 호출하도록 연결해야 한다.
현재 재직상태만으로 과거 휴직/복직 여부를 추정하지 않는다. 발생일 이후 직원정보가 변경돼 과거 상태 확인이 필요한 월은 `monthly_hold`로 기록하고 자동 부여하지 않는다. 담당자가 근거 확인 후 조정한다.

## 의도적으로 차단하거나 남은 항목

- 알림 지연/재알림 정책 미확정: policy row는 enabled=false, delay=null. Edge는 `ATTENDANCE_REMINDERS_ENABLED` 없으면 OFF. 예약/발송 활성화 없음.
- 입퇴사·휴직 경계의 월 발생 규칙, 자기승인·대리신청·승인 후 취소 미확정: 자기승인/대리신청/승인 후 취소는 허용하지 않음.
- 반차의 유급시간·실제 근무 혼합 입력을 기존 급여 계약이 지원하지 않음: 근태에는 반차와 남은 근무시간을 보존하되 `half_day_payroll_review` blocker로 일별 확정을 차단한다. 자동 급여 확정까지 완료한 것으로 보고하지 않는다.
- 기본 근무조건 이력, 날짜별 시간/장소 예외 및 철회, 회사/개인 휴무와 철회는 구현.
- 최초 연차 기준일은 오늘로 제한해 확인되지 않은 과거 발생분 자동 소급을 막는다. 과거 기준일 입력을 지원하는 기능은 아님.
- 근무장소 선택은 기존 허용장소를 참조한다. 지정 장소를 새로운 출근 지오펜스로 강제하는 권한 변경은 하지 않는다.
- 잔여 조정은 운영총괄의 좁은 근무조건 관리권한으로 제한. 운영팀장의 승인권한이 최초 잔여 수정·급여권한으로 확대되지 않는다.
- Push 수신 성공·종료 앱/절전 동작·실기기 설치는 코드나 합성 테스트로 주장하지 않는다.

## 검증·배포 경계

- Node/mobile 계약 검사와 TypeScript, 플랫폼 회귀, publish build.
- pgTAP ACL/RLS·기본 OFF 검사.
- CI-created local Supabase의 실제 Auth/RPC 테스트: 최초 입력→앱 조회→신청→운영팀장 승인→앱 잔여·반차 일정→취소·월 중복 방지.
- 합성 웹 브라우저: 390/1440px 초기 입력·오류 시 입력 보존·RPC payload.
- 로컬 Chromium은 컨테이너 socket 제한으로 실행 불가. 브라우저 검사는 기존 GitHub Ubuntu CI에 연결했다.
- 보조 로컬 PGlite에서 실제 신규 PL/pgSQL과 합성 기존 helper를 사용해 동작을 검사했다. 이는 전체 Supabase/Auth 검증과 구분한다.
- CI/QA 결과는 PR의 정확한 HEAD를 기준으로 기록한다. Netlify 배포, DB/Edge 적용, 앱 빌드는 서로 다른 단계다.


## 2026-11-02 알림 1단계 보강

- 출근 예정+5분 및 유효 출근 있음/퇴근 없음/퇴근 예정+5분의 서버 판정을 같은 outbox에 연결.
- 출근/퇴근 이벤트별 독립 중복 키, 기기별 claim, 발송 직전 재검사, ticket/receipt 경로 재사용.
- 정책 delay=5는 사용자 지시에 따라 확정했으나 enabled=false 및 Edge OFF 유지. 운영 적용·예약·실제 발송은 실행하지 않음.
- 종료 시각은 날짜 예외·반차를 반영한 private_employee_schedule을 사용. GPS 추가 수집 없음.
- 격리 실제 Auth 통합 runner에 5분 직전/정각, 미출근, 출근/퇴근 완료, 퇴근 예외대기, 휴무·근태제외 조건을 추가. 신규 HEAD의 CI 결과를 별도 확인해야 함.


## 2026-11-03 연결 재점검 (main b4277c2)

기획 최신 절과 코드/현재 서버를 나눠 확인했다. 앞부분의 PR572 착수 기록은 현재 배포 완료를 뜻하지 않는다. 직원앱 신규 신청은 현재 종일만 제공하며 승인 일정 변경은 별도 관리자 승인 흐름으로 구현됐다.

| 연결 | 코드/검증 | 현재 연결 서버 상태 |
| --- | --- | --- |
| 직원관리 근무조건 → 서버 → 근태/알림 일정 | 같은 employee UUID·private_employee_schedule 재사용 | 기본 RPC 적용됨 |
| 연차 초기 등록 → 앱 잔여 조회 | initialize_employee_leave / get_my_leave_context | 기본 RPC 적용됨 |
| 앱 신청 → ERP 승인 → 미래 출근부 연차 | submit_my_leave_request / review_employee_leave / get_attendance_admin_today → 월간 renderer | 기본 승인 함수 적용됨. ERP 진입은 아래 metadata 누락으로 차단됨 |
| 승인 전 반복 수정 / 승인 후 1회 변경 요청 → 관리자 검토 → 출근부·잔여 복구 | edit_my_pending_leave / request_my_leave_change / review_employee_leave_change | 세 RPC 모두 없음. 20261102051510 migration 미적용 |
| 현재 재직자·직급별 ERP 조회 | roster_version 계약 | metadata 없음. 20261102140441 migration 미적용 |
| 앱 재진입/foreground → 서버 잔여 재조회 | useMyLeave 및 기존 화면 재조회 경로 | 설치 APK 버전·실단말 왕복은 별도 확인 필요 |
| 매월 1일 +1 | 중복 방지 ledger·guarded 조회 보충·내부 batch | 조회 시 보충 RPC는 있음. cron.job의 leave/reminder 예약은 0건이며 정기 실행 미확인 |
| 승인 휴가 → 출퇴근 알림 제외 | 공통 schedule/outbox·직전 재검사·앱 이동 adapter | enabled=false / delay=5. 운영 발송·실수신 미검증 |

읽기 전용 staff-config 확인: taejang.co.kr, qa-preview, deploy-preview-578 모두 jgsxpdflgkqroecfjzxq를 반환하며 ‘태장 비운영 사전테스트’ 표시였다. 앱은 API base의 같은 staff-config로 Supabase client를 초기화한다. 설치 APK가 실제 선택한 base/버전은 단말에서 확인하지 않았으며 동일 환경이라고 추정하지 않는다.

QA 화면 체험은 합성 데이터이며 실제 신청/조회가 차단된다. 이 모드로 서버 왕복 검증을 대신할 수 없다. 하단 탭 PR577은 open Draft로 main에 미포함이다.

검증 근거: ec8a9e5의 기존 CI 5개 success, 격리 Supabase 실제 Auth/RPC LEAVE_AUTH_INTEGRATION_PASS 105 assertions 및 pgTAP 1041 통과 로그를 재확인했다. 실제 신청→운영팀장 승인→미래 월간 출근부 ‘연차(승인)’→관리자 취소 승인→‘근무 예정’ 복구가 포함된다. 이번 재점검의 앱/알림 계약 검사 14개 통과. 공유 서버에서 TEST 직원 생성이나 실제 신청/승인/알림은 실행하지 않았다.

적용 순서: 누락 migration 두 개 검토·동일 검수 서버 적용 → ERP와 최신 QA APK를 같은 서버/employee UUID로 접속 → 초기 등록/신청/승인/미래 출근부/수정·취소/foreground 잔여 확인 → 월 정기 발생 예약 별도 적용·중복 실행 검증 → 알림은 별도 활성화와 실기기 수신 확인. 부분 화면이나 CI 성공만으로 전체 연동 완료라고 표시하지 않는다.

지문 Excel 제거는 UI 업로드와 안내를 제거하고 역사 자료·비교 조회·월간 Excel 다운로드는 보존한다. 출근부 확정의 fingerprint_import_missing만 제거하는 별도 migration을 준비했다. GPS 누락·예외 미처리·과거 지문 불일치·확정 재개방·반차 급여 검토 등 다른 검증은 유지한다. 이 migration도 공유 DB에는 미적용이며 UI 배포만으로 서버 필수 조건이 사라지지 않는다.
