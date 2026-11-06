# 출퇴근 미기록 안내 — 서버 판정 격리 초안

2026-11-01, PR #571. 사용자 승인: 조사·설계·격리 구현. **운영 배포·위치 수집·실제 발송은 미구현/미활성**이다.

## 원본 조사와 미확정 업무 판단

- 운영 연결 프로젝트 `jgsxpdflgkqroecfjzxq`의 스키마와 저장소 migration을 읽었다. 직원·프로필에는 개인별 출퇴근 예정시각이 없다. `get_my_attendance_today`에도 없다.
- `payroll_employment_terms.daily_scheduled_hours`는 적용기간별 시간 수이며 출퇴근 시각이 아니다. 급여/계약 자료를 알림 시각으로 추정하지 않는다.
- `daily_work_assignments`, `field_work_templates`, `today_information_items`, 일반 `schedule_items`는 작업·일정이다. 소정 출퇴근시각 원본으로 채택할 근거가 없다. 직원별 시각과 휴가/외근의 승인 원본은 사용자에게 확인 중이다.
- 기존 `private_attendance_is_workday`, 휴일근무 배정, `private_attendance_effective_status`, 출퇴근 유효 기록 및 예외 처리 의미를 최종 서버 adapter에서 재사용한다. 검수 권한 `attendance.qa_validate`와 실제 앱 package/variant는 별개이며 보호 분기를 제거하지 않는다.

## 격리 구현과 실패 경계

`supabase/tests/database/attendance_reminder_sandbox.test.sql`에 **pg_temp 함수·합성 snapshot·임시 중복방지 표만** 구현한다. CI의 로컬 Postgres 트랜잭션에서 실행 후 rollback한다. migration, public RPC, Edge 배포, 직원/근태 쓰기, 스케줄러, 푸시/OS 알림 연결은 없다.

흐름: 인증 본인 → 서버가 승인 원본과 당일 예외/미기록 상태를 재조회 → 현재 권한으로 새 위치 1회 요청 → 무쓰기 서버 위치·조건 판정 → 별도 알림 수령표 원자적 claim → 본인 안내. 클라이언트가 제공하는 근무일/원본확정/예외/기록 플래그를 신뢰하는 RPC를 만들지 않는다. 테스트 snapshot은 미래 server adapter의 신뢰 입력 모형일 뿐 운영 데이터 계약이 아니다.

- 예정 출근/퇴근 각각 +5분부터 당일만, 원본 미확정·빈 값·잘못된 시각·당일 불일치면 보류. 야간/익일 근무는 원본·업무 규칙 확정 전 지원하지 않는다.
- 본인 활성·근태 대상·명시 opt-in·근무일이고 당일 상태가 work일 때만. 휴가/휴일/외근/예외가 있거나 제외 상태를 확인할 수 없으면 안내하지 않는다. 기존 퇴근 저장 규칙과 같이 유효한 출근 기록이 있어야 퇴근 안내 후보가 된다.
- 예정시각은 서버가 확정하며 앱의 09시 기본값은 없다. 수신 직전 기록/예외를 재검사하고 이미 해당 이벤트가 존재하면 안내하지 않는다(예외 처리 중·거절 포함 보수적 억제).
- 위치는 저장하지 않는 입력으로만 사용한다. 본사 좌표/반경은 서버 설정, 거리 계산은 기존 `private_attendance_distance_m` 재사용. 신선도 120초 이내·미래 시각 불가·accuracy 0~80m는 격리 검증용 보수적 초안이다. 운영 적용 전 기준 확정 필요. 장치 보고값은 물리적 위치의 암호학적 증명이 아니며, 기존 출퇴근 위치 판정의 한계를 그대로 가진다.
- 원자적 중복키는 본인/한국 근무일/출근·퇴근 구분. 위치/근태 판정 자체는 무쓰기이고 1일 1회 표는 별도 메타데이터다. 발송 실패·다중기기/재설치/재시도까지의 실전 전달 계약과 기존 notification outbox 결합은 미구현이다. 임시표 테스트를 실제 수신 보장으로 보고하지 않는다.
- 본인 근태·휴가 세부사유·좌표·알림 토큰을 로그/응답에 남기지 않는다. 실패/불명은 알림 없음으로 끝난다.

## 앱 종료·절전 상태

현재 앱은 foreground 위치만 사용한다. 앱이 닫혀 있을 때 신선한 본사 위치를 얻을 경로가 없으므로, 기존 위치나 출퇴근/QA 쓰기 RPC를 재사용해 자동 판정하지 않는다. 종료/절전에서 예정시각의 정확 실행·수신을 보장하지 않는다.

백그라운드 제공은 별도 업무 판단 후 최소 범위·보존기간·철회 방법·직원 opt-in, 위치 목적의 명시 안내, Android 별도 권한 흐름과 Play 선언/심사·시연 영상·개인정보처리방침/Data Safety 검토를 마친 뒤에만 구현한다. 알림 허용과 백그라운드 위치 동의를 혼동하지 않는다. 강제 동의·배터리 제한 우회·exact alarm 권한 추가는 이번 범위에서 하지 않는다.

공식 근거(2026-11-01 확인): [Android 백그라운드 위치 제한](https://developer.android.com/develop/sensors-and-location/location/background), [Play 백그라운드 위치 심사·안내/동의](https://support.google.com/googleplay/android-developer/answer/9799150).

## 출시와 구현 대조

| 항목 | 상태 |
| --- | --- |
| #571 녹색·중앙 정렬·퇴근 회전·패치노트 | 기존 구현 보존 |
| Play code8 제공 확인·optional 최신만 CAS 갱신·staff-config 확인 | 0.1.7/code8 확인, minimum null/force false 유지 |
| 다음 앱 후보 | 0.1.8/code9, 업로드 직전 최고 번호 재확인 |
| 무쓰기 판정·중복방지 격리 prototype | 합성 pg_temp 구현, CI 결과는 PR에 기록 |
| 실제 예정시각 원본/서버 adapter/생산 RPC/실제 수신 | 미확정·미구현, 사용자 원본 판단 필요 |
| 백그라운드 수집·실제 직원 발송·실기기 검증 | 미실행 |
