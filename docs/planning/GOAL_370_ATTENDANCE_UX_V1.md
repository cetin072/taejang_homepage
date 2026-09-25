# Goal #370 — 직원 출퇴근 UX 완성 기록

상태: 구현 완료 / 운영·실기기 검수는 별도 Human Gate

## 적용 기준

- GitHub Goal #370
- `docs/planning/ATTENDANCE_INTEGRITY_POLICY_V1.md`
- `docs/operations/MOBILE_APP_DEVELOPMENT_STANDARD.md`

## 구현 범위

- 기존 단일 행동 흐름을 유지한다: `출근했습니다` → `퇴근했습니다` → `오늘 근무 완료`.
- `get_my_attendance_today()`의 서버 권위 읽기 모델로 출근·퇴근 시각과 기록 상태를 함께 표시한다.
- 일반 기록, 예외 확인 중·승인·반려, 관리자 보정·무효 처리 결과를 직원이 구분할 수 있게 한다.
- 앱이 foreground로 돌아올 때 서버 읽기 모델을 다시 불러와 보정·예외 결과를 갱신한다.
- QA 모드는 기존 no-write RPC와 별도 표기를 유지하며 실제 근태 상태 요약을 섞지 않는다.

## 의도적으로 변경하지 않은 경계

- 서버 시간, 06:00 출근 허용, GPS/geofence, 휴일근무, idempotency, 예외·보정의 최종 판정은 기존 Supabase RPC가 계속 권위다.
- 모바일은 급여 계산, 근태 보정, 예외 승인·반려를 수행하지 않는다.
- 이 Goal에는 DB migration이 없다. CI의 isolated Supabase 계약 검증은 기존 서버 계약 회귀를 확인한다.

## 완료 조건 대조

| #370 완료 조건 | 결과 |
| --- | --- |
| 단일 버튼·서버 시각·06:00 경계 | 기존 서버 계약 유지, UI 표시 및 foreground 재조회 확인 |
| 휴일/휴일근무·조퇴 | 기존 서버 계약 유지, 앱의 조퇴 최소 시각 제한 없음 |
| GPS/geofence·중복 방지 | 기존 foreground-only 위치 수집과 서버 RPC/idempotency 유지 |
| 예외·보정 결과 | 직원용 상태 요약에 확인 중·승인·반려·보정·무효 처리 표시 |
| QA no-write 분리 | 기존 QA badge/RPC/write guard 유지 |

## Deferred Human Gate

- 실제 Galaxy에서 위치 권한 허용/거부, geofence, foreground 복귀, 글자 확대, 네트워크 저하를 사람 검수한다.
- Production DB·RLS·실제 직원 근태 데이터에는 변경 또는 실행하지 않는다.
