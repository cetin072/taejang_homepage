# 지문 출근부 직원 매칭 보강 v1

상태: 확정 — 2026-10-21 사용자 구현 지시, Issue #506. 태장 Domain.
기존 기준: [근태 확정 흐름](ATTENDANCE_TO_PAYROLL_DRAFT_FLOW_V1.md).

- 기존 검증 매핑 → 유일 정확 사번 → 이름 정확 일치 후보 순서. 이름은 양끝 표시 공백만 제거하며 추측 매칭하지 않는다.
- 이름 후보는 현재 active/비보관/근태 대상이고 해당 근무일 및 저장된 같은 번호의 모든 근무일에 재직해야 한다. 1명만 일괄 후보, 0명/복수는 수동 확인.
- 같은 번호의 과거 다른 이름, 날짜별 다른 시각은 연결 중지. 원본 근거는 보존한다.
- 조회는 읽기 전용. 일괄·수동 연결은 직원번호/이름/사번/부서/팀/직책 확인 후 기존 권한 RPC와 감사 writer 재사용. 기존 연결 교체는 별도 확인 및 이전 대상 비교.
- 같은 직원/날짜/출퇴근 시각은 비교·확정 검사에서 합치고 모든 원본 배치 ID/hash를 조회한다. 시각이 다르면 예외 유지. 수집 당시 수치와 현재 미매칭 구분.
- 기존 저장 자료를 동적으로 연결하며 재업로드/원본 수정/확정본 변경/GPS·급여 계산 변경 없음.
- Production 실제 연결·DB 배포, Ready/main/Production 배포는 별도 사용자 승인. 기존 48시간 정책 유지.

## 구현 대조

- 매칭 후보·번호 이력·재직기간·권한/감사 재사용: 구현 완료
- PC/mobile 확인 UI·일괄/수동 연결·교체 확인: 구현 완료
- 원본 보존·동적 조회·중복 비교·수집/현재 수치: 구현 완료
- 14개 회귀 및 CI/Preview 검증 구성: 구현 완료. 실제 실행 결과는 Draft PR #507 최신 검수 기록을 기준으로 한다.
- 실제 21명 운영 연결: 의도적으로 제외(최종 승인 필요)

## 검증 대응표

| 사용자 케이스 | 검증 경로 |
| --- | --- |
| 1 유일 이름 / 2 동명이인 / 3 미등록 | attendance_identity_matching.test.sql 실제 함수·가상 자료 |
| 4 퇴사·보관·비대상 / 5 입사 전 | 같은 pgTAP의 후보 제외 검사 |
| 6 기존 번호 매핑 / 7 번호 재사용 | resolver, 다음 파일 import 및 과거 이름 충돌 |
| 8 동일 파일 / 9 다른 파일 동일 기록 | 실제 import RPC idempotency, 원본 42행/비교 21건, 시각 충돌 2건 유지 |
| 10 매칭 후 기존 자료 조회 | 동적 read, 수집/현재 수치 분리, 원본 JSON payload 불변 |
| 11 운영팀장 / 12 일반직원 차단 | pgTAP 및 attendance-capability-auth-integration.mjs 실제 Auth/PostgREST 8인자 RPC |
| 13 수동 연결·감사 | 기존 writer audit, 교체 확인·오래된 화면 차단·4인자 호환 |
| 14 PC/mobile 실제 브라우저 | attendance-vendor-xls-browser.mjs + helpers/attendance-identity-browser.mjs, exact-head Preview Chrome 1440/390 |

가상 데이터는 현재 고유 이름 21명/과거 퇴사 동명 직원 16명/동일 날짜 서로 다른 hash 2배치 42행 구조를 재현한다. 실제 운영의 21명에 대한 새 RPC 결과는 운영 DB에 migration을 적용하지 않았으므로 독립 확인하지 않았다.

팀 표시는 기존 work_group_employee_memberships와 기존 field group 조회권한을 재사용한다. 권한 없는 팀은 미확인으로 남기며 매칭 권한 때문에 조직 조회범위를 확대하지 않는다. 중간 실패는 성공 건수만 보고하고 다음 저장을 중지한다. 실패 전에 저장한 건이 없으면 사용자의 수동 선택을 보존한다.

## 검증 범위와 제외

- UI 검사는 배포된 JS와 실제 브라우저 DOM을 사용하되 모든 매칭 RPC는 synthetic fixture이다. 운영 DB를 조작하지 않는다.
- DB 검사는 CI의 격리 로컬 Supabase 트랜잭션에서 실제 RPC/권한/감사를 검증한다.
- Production migration, 실제 직원 21명 연결, 운영팀장의 실제 인사정보 대조·최종 수용, Ready/main/Production 배포는 의도적으로 제외하고 사용자 승인 경계에 둔다.
