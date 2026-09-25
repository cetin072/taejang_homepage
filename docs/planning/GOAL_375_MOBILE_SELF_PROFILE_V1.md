# Goal #375 — Android 내 정보 v1

상태: **구현 기준 확정**
상위 기준: GitHub Goal #368, 장기 결정 #367, [#375](https://github.com/cetin072/taejang_homepage/issues/375)

## 범위와 경계

- 직원 Android 앱은 본인의 이름, 부서, 직책, 입사일, 등록 연락처만 읽는다.
- 주민등록번호, 급여, 인사평가, 관리자 메모, 직원번호, 다른 직원 정보와 로그인 이메일은 이 화면에 포함하지 않는다.
- 앱은 설정의 보조 화면으로 진입한다. 1.0 홈의 출퇴근·오늘 업무·공지·가까운 일정 우선순위를 바꾸지 않는다.
- `get_my_employee_profile()`은 활성 계정과 해지되지 않은 Auth-Person-Employee 연결을 서버에서 확인한다. 앱의 화면 조건은 보안 경계가 아니다.
- 연락처 변경은 직원이 `employee_self_service_contact_requests`에 요청하고, 기존 `employee.review_change_requests` capability를 가진 검토자가 승인할 때에만 기존 Profile 연락처를 갱신한다.
- 직원은 `profiles`, `people`, `employees` 또는 요청 테이블을 직접 읽거나 수정하지 않는다. 웹의 기존 직원 관리 화면은 좁은 연락처 요청을 검토하는 용도로만 확장한다.

## 완료 대조

| #375 항목 | 결과 |
| --- | --- |
| 이름·부서·직책·입사일·연락처 | 구현 완료 — 최소 self read model |
| 민감 HR 정보 배제 | 구현 완료 — 허용 필드만 JSON RPC로 반환 |
| 직접 canonical HR 수정 금지 | 구현 완료 — direct table privilege 없음 |
| 변경 요청 → 관리자 승인 → 반영 | 구현 완료 — 중복 pending 차단·감사로그·기존 reviewer capability 재사용 |
| inactive account 차단 | 구현 완료 — 서버 RPC가 active account 및 연결을 확인 |
| Production DB 적용 | **DEFERRED HUMAN GATE** — migration은 코드/CI에만 포함, 운영 적용은 하지 않음 |

## 검증 기준

- mobile TypeScript typecheck 및 self-profile static test
- clean Supabase migration reset, schema lint, pgTAP
- Auth/Data API: 본인 범위, direct-table 거부, 중복 요청 거부, self approval 거부, reviewer 승인 후 반영, inactive 계정 차단
- 실제 Galaxy의 키보드·글자 확대·화면 가독성은 Human QA
