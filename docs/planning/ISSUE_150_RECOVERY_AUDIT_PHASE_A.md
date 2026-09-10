# Issue #150 — Archive recovery + target audit Phase A

기준 main: `c20dc1aba39070a068b7517b77575af212af5578` (PR #170 merge)

## 목표
기존 Employee / promotion restore 패턴을 다른 recoverable 운영 리소스에 일반화하고, 운영총괄이 특정 업무대상의 변경이력을 제품 안에서 확인할 수 있게 한다.

## 구현 순서
1. schedule / notice / staff guidance의 현재 delete/archive 구현과 저장 컬럼을 재확인한다.
2. 물리 삭제가 있다면 recoverable archive로 바꾸고, 이미 archive라면 대칭 restore RPC를 추가한다.
3. archive 중 ordinary update를 서버에서 거부한다.
4. restore에는 reason을 필수로 하고 actor/time/reason + before/after 핵심 snapshot을 audit에 남긴다.
5. `audit.target_history.read` capability를 operational capability로 추가하되, operations_manager만 기본 superset으로 받게 하고 lower role에는 명시 grant하지 않는다.
6. target audit RPC는 allow-listed target type만 허용한다. 전체 raw audit browser를 노출하지 않는다.
7. Employee/account link, promotion content, homepage request/live override, schedule, notice, guidance의 대상별 이력을 읽을 수 있게 한다.
8. Employee restore 고급 충돌은 자동 덮어쓰지 않는다. link/re-hire/account-status 충돌은 명시적 conflict 결과로 중단한다.

## 안전선
- archive는 purge가 아니다.
- 원본 identity / revision / employee_id를 바꾸지 않는다.
- 기존 Auth != Employee 계약 유지.
- technical `super_admin`은 target 업무이력의 일반 운영자격이 아니다.
- raw/global audit는 technical 영역으로 분리한다.
- lower-role simulation 중 target audit capability는 사라져야 한다.
- Production 데이터 수동 복구/대량 변경 금지.

## 필수 행동 테스트
- archive → 일반 목록 제외
- archive 중 update denied
- restore(reason 필수) → 일반 목록 복귀
- restore 후 update PASS
- restore actor/time/reason/before-after audit 존재
- operations_manager target audit read PASS
- lower role / super_admin-only target audit read FAIL
- simulation 중 FAIL, exit 후 PASS
- Employee restore conflict는 자동 overwrite 없이 명시적으로 거부/해결필요 반환

## 작업 운영
- branch: `codex/issue-150-recovery-audit-generalization`
- 같은 Draft PR에서 진행
- 단계별 required CI Green 후 다음 단계로 이동
- Ready/main merge/Production 변경은 사용자 승인 전 금지
