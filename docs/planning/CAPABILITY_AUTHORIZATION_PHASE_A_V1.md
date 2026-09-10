# Capability Authorization Phase A v1

Issue #148의 첫 단계 구현 계약이다.

## 목표
- `route`는 화면 기본 진입점, 레이아웃, 역할 라벨과 메뉴 정렬 용도로 유지한다.
- 실제 일반 업무 권한은 서버가 계산한 capability 목록을 source of truth로 사용한다.
- `operations_manager`는 일반 운영 capability의 기본 superset이다.
- technical `super_admin` capability는 일반 운영권한과 분리한다.
- role simulation 중에는 operational capability를 선택한 lower role 수준으로 축소한다.
- technical/safety capability는 simulation과 별개로 actual role 기준을 유지한다.

## operations_manager 자동 상속 예외
`attendance.self_record`는 운영 capability지만 대표이사·운영총괄 본인 근태 제외 정책 때문에 `operations_manager` 자동 상속 대상에서 제외한다.

실제 출퇴근 기록은 capability 외에도 Employee eligibility, 대표이사·운영총괄 제외, 60m geofence, server time 등 기존 서버 규칙을 계속 통과해야 한다.

## Phase A 전환 전략
1. 기존 `get_my_access_context()`는 호환성 때문에 유지한다.
2. `get_my_access_context_v2()`가 다음을 추가한다.
   - `access_contract_version`
   - `actual_roles`
   - `effective_roles`
   - `capabilities`
3. 브라우저는 v2를 우선 호출하고, 새 RPC가 아직 배포되지 않은 환경에서는 v1으로 fallback한다.
4. `window.TaejangApp.can(capability)`를 추가한다.
5. 첫 실제 이관 대상으로 업무배정·일정·공지·상시안내 관리 모듈의 진입 판단을 capability 기반으로 전환한다.
6. 이후 각 기능의 route/role 문자열 guard를 실제 behavior test와 함께 단계적으로 이관한다.

## capability 분류
### operational
일반 업무를 수행하는 권한. 기본적으로 `operations_manager`가 자동 상속하되 정책 예외는 registry에서 명시한다.

### technical
시스템 bootstrap, 마지막 super_admin 보호, 비상 접근, 전체 raw audit처럼 정상 업무운영과 분리해야 하는 권한. `operations_manager`가 자동 상속하지 않는다.

## lower-role 원칙
Phase A는 기존 lower role 범위를 넓히지 않는다.
- `promotion_staff`: 기존 홍보 작성/자기 초안 범위
- `promotion_lead`: 기존 홍보 검토·허용된 발행관리, 전사 신규 Employee 등록, 홈페이지 safe draft 범위
- `department_lead`, `field_lead`: 기존 부서/현장 관리 범위
- 일반 직원 역할: 기존 본인 기능 범위
- `ceo`: 기존 대표 승인/escalation 범위만 유지
- `super_admin`: technical capability만 부여

## 안전선
- Auth account != Employee
- Person / Employee / Auth profile 분리 유지
- immutable server-issued employee_id 유지
- attendance 60m server-side geofence 유지
- attendance server time 유지
- CEO / operations_manager 본인 근태 제외 유지
- public static fallback 유지
- forward migration only
- Production destructive 변경 금지
