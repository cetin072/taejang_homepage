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
