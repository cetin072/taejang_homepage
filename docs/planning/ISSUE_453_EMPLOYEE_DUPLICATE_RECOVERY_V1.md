# Issue #453 직원 중복 복구 — 실행 전 준비

상태: 2026-10-14 사용자 확정 범위. 실제 실행·DB 설치·main/Production 승인은 아님.
기준: Issue #453, PROJECT_CHARTER.md, PLATFORM_CONSTITUTION.md, ACCOUNT_ROLE_ASSIGNMENT_POLICY_V1.md, ISSUE_150_RECOVERY_AUDIT_PHASE_A.md.
분류: 태장 Domain 일회성 복구. 상시 서비스·새 공개 RPC·권한/RLS 변경 없음.

## 절대 보존과 현재 감사

- 기존 Employee UUID/직원번호/Person/인사 및 모든 급여·확정근태·보험/민감 참조를 보존한다.
- 앱 Auth/Profile/이메일/비밀번호/역할/소속/세션/원본 출퇴근 이벤트는 변경하지 않는다. 2026년 10월 이벤트 이관은 필수가 아니나 삭제하지 않는다.
- 읽기 감사: 11그룹/23개, 1:1 10그룹/3개 레코드 1그룹. 기존 급여 80/확정근태 441/근로조건 14, 신규는 0. 전체 25개 Employee FK 테이블의 신규 참조 0. work_date 기준 신규 10월 이벤트 25/10월 이전 0, 사진·민감정보 0. event_at이 없는 1건을 포함하며, 기존 시간값 기준 집계 24건을 정정한다.
- 1:1 모두 기존 Employee와 Profile 부서 또는 직책이 다르다. 구조 후보 10개는 자동 대상이 아니다. 신원·조직 차이 미확인으로 자동 실행 0개. 3개 레코드 그룹은 이 도구로 처리하지 않는다.
- 실제 매핑은 공개 저장소/로그 대신 현 PC CurrentUser DPAPI·사용자 전용 ACL 파일에 둔다. 집계는 감사 시점 값이며 실행 전 다시 조회한다.

## 원자적 도구

`scripts/recovery/issue-453-employee-recovery.sql`은 세션 pg_temp에 invoker 함수만 정의한다. 로드만으로 데이터가 변하지 않으며 영구 migration/API가 아니다.

1. 활성 운영총괄 실제 역할 및 기존 link/unlink/archive capability 검사.
2. 명시 UUID/두 직원번호/신원 확인/승인 참조/최신 fingerprint 필수.
3. 보호·고위험 역할·모호 그룹·연결 충돌·신규 참조·예상하지 못한 FK·상태 변화 차단.
4. 작업 advisory lock과 관련 테이블/행 NOWAIT 잠금. 업무 writer가 있으면 즉시 실패. 승인된 짧은 유지보수 트랜잭션만 사용.
5. before snapshot 후 기존 unlink RPC. 기존 link RPC는 Profile 소속을 바꾸므로 기존 동일 link-row/unique-index/감사 계약만 재사용해 기존 Person에 연결한다. Profile에는 DML을 하지 않는다. 이는 계정 권한 의미를 보존하는 최소 경계다.
6. 링크 해제된 신규 Employee만 기존 archive RPC로 보관해 계정을 차단하지 않는다. 표준 archive/restore guard와 source/link before 및 참조 digest marker를 보존한다.
7. 기존 직원/Person·Profile/Auth/roles/sessions/events·전체 참조 보존 검증. 중간 실패는 전체 롤백. 정확한 완료 marker와 연결이면 재실행 no-op.

## 실행 Gate와 검증

- 이름/입사일은 검사 조건이며 신원 증명이 아니다. 자동 대상 선택 금지.
- 역할·조직 차이 확인 및 제한 snapshot, 실제 1건 pilot/전체 대상의 별도 명시 승인 후에만 실사용 실행 검토. QA도 shared live DB이므로 DDL/DML 금지.
- 테스트 runner는 loopback Docker Supabase만 사용한다. pg_temp 함수는 PUBLIC execute를 revoke한다. 신뢰된 운영 DB 세션과 서버 역할/capability를 사용하며 user_metadata로 권한을 판단하지 않는다.
- Auth 비밀번호/토큰 원문은 snapshot/출력에 넣지 않고 digest만 비교한다. snapshot은 접근 제한된 Employee archive/내부 감사에만 기록.
- 역복구도 재감사·승인 대상. 표준 restore만으로 원래 Profile 링크까지 되돌리지 않으며 이후 인사/급여/계정 변경을 먼저 점검한다.
- 실제 복구 전에 #443 신규 중복 방지 rollout 승인·적용 계획 필요.
- 구현 대상: preflight/명시 mapping, 키/참조/계정 보존, 원자적 처리, 실패·동시 실행·반복·모호 그룹 차단, 로그인/출퇴근/목록 회귀. 검증 결과는 Draft PR에 기록.
- 구현 완료: 위 도구 및 격리 DB 회귀 42개 assertion 통과. 검증 코드 커밋 f27efbb3502737e63b4061ea9c0f721f4f30e303, GitHub Actions DB run 38516558324 성공. 이후 변경은 이 감사 집계·검증 기록 문서 정정만 해당한다.
- 의도적 제외: 실사용 실행, 인사/권한 정합화, 이벤트 삭제/이관, Auth 재생성/비밀번호 변경, 영구 RPC/migration/서비스. 미확인은 PASS로 기록하지 않는다.
