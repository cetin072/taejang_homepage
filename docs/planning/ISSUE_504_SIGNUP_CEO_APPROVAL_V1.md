# Issue #504 — 기존 직원 연결 및 대표이사 가입 승인 수정

상태: 사용자 요청으로 확정 (2026-10-21). 구현/검증은 Draft PR, 운영 적용은 별도 승인.

## 기준과 분류
- PROJECT_CHARTER.md §9, Issue #89, #453, AGENTS.md
- ACCOUNT_ROLE_ASSIGNMENT_POLICY_V1.md / CAPABILITY_AUTHORIZATION_PHASE_A_V1.md / GOAL_376_MOBILE_ROLE_CAPABILITIES_V1.md
- 기존 Platform/Core 계정 연결 및 태장 Domain 역할 계약 보수. 새 추상화·역할·capability·데이터 테이블 없음.

## 확정 요구
1. 재직·미보관·미연결 Employee 선택 목록은 부서/직책의 선택적 조직 정보가 없어도 유지한다. attendance_required는 승인 자격과 무관하다. 퇴사/보관/기존 연결 차단을 유지한다.
2. 기존 ceo 역할만 재사용한다. 운영총괄만 대표 역할 승인 가능하며 운영팀장·일반 직원·가입자·익명은 허용하지 않는다. 기존/new/legacy 승인 API 모두 서버 검증을 유지한다.
3. 기존 직원은 UUID와 직원번호를 명시 선택·재입력하고 신원·입사일 차이를 확인한다. 이름/이메일 자동 연결 및 빈 목록의 암묵적 신규 생성 금지.
4. Employee/Person 원문·직원번호·인사/급여/근태와 Auth 계정·비밀번호 보존. 실제 직원 승인/역할 변경/복구는 수행하지 않는다.
5. 대표 승인·기존 전사 조회 계약 유지. ceo에 operations_manager/super_admin 권한을 복제하지 않는다. 모바일은 서버의 promotion.review_ceo로 업무플랫폼 진입을 표시한다.
6. 새 migration은 격리 CI에서만 적용한다. 공유 live DB에 적용하지 않는다. Preview는 웹 자산만 배포하며 live DB schema 변경과 Android binary 배포를 대신하지 않는다.

## 원인과 조사 방법
- 읽기 전용 DB에서 대상의 Person/Employee 존재, 재직·보관·연결, 부서/직책 null, 근태 여부를 확인했다. 개인 UUID/직원번호/연락처·급여 상세는 저장하지 않는다.
- 후보 RPC는 부서/직책 INNER JOIN으로 부서 미지정 임원을 제거했다. active/archived/link 조건과 근태 여부를 구분한다.
- 승인 options와 실제 승인 RPC들의 역할 allowlist에서 ceo가 누락됐다. 모바일 업무플랫폼 capability 목록도 promotion.review_ceo를 누락했다.
- ceo registry 및 promotion.review_ceo / support_radar.management_view 구현은 이미 존재한다. 모든 부서의 모든 기록·민감정보를 무제한 조회하는 포괄 권한의 완성은 이번 수정으로 주장하지 않는다.

## 검증과 완료 대조
- 구현 완료: 선택적 조직 JOIN, ceo 선택/승인 guard, 직원번호 명시 확인 및 중복 방지 보존, 모바일 capability 진입, 빈 목록 안내.
- 검증 코드: 기존 onboarding Auth/Data API runner에 합성 대표 fixture 추가; 기존 UI fixture/모바일 실제 TS transpile 렌더링 테스트 보강.
- 실행 결과·CI/Preview 정확한 SHA와 미확인 항목은 Draft PR에 기록한다.
- 의도적으로 제외: 실제 가입 승인/권한 변경, Auth reset/재생성, 운영 migration, Android 빌드/Play 배포, main merge/Production, 전사 조회권한 재설계.
