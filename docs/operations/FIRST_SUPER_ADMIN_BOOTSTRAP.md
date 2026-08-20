# 최초 시스템 최고관리자 등록 절차

상태: **staging 적용 준비 완료 · 실제 실행은 사용자 최종 승인 전 금지**

이 절차는 `taejang-phase1-staging`에서만 사용한다. 운영 production, Netlify Production, QA 시드와는 분리한다.

## 공식 RPC

`public.bootstrap_super_admin(uuid)`가 최초 시스템 최고관리자 등록의 유일한 공식 경로다. DB 운영자만 실행할 수 있고 브라우저·Netlify에는 실행 권한이 없다.

이 RPC는 한 트랜잭션에서 다음을 처리한다.

- 대상 Auth 사용자의 존재와 이메일 확인 완료 상태 확인
- `pending` 프로필 확인
- 활성 `super_admin` 존재 시 반복 실행 차단
- `active` 전환
- 부서 `operations`(운영), 직책 `operations_manager`(운영총괄) 배정
- 역할 `super_admin`, `operations_manager` 동시 부여
- 계정 상태 이력, 역할 부여 감사로그 2건, 조직 배정 감사로그, bootstrap 감사로그 기록

대상 사람의 이름·이메일은 코드나 migration에 넣지 않는다. 실제 대상 UUID는 실행 시점에 Supabase Dashboard에서만 확인한다.

## 실행 전제

1. Deploy Preview가 staging 연결인지 확인한다.
2. Authentication에서 대상 실제 사용자의 이메일 확인이 완료됐는지 확인한다.
3. 대상 `profiles.account_status`가 `pending`인지 확인한다.
4. 활성 `super_admin`이 0명인지 확인한다.
5. 새 migration이 staging에 적용됐는지 확인한다.

모두 충족하지 않으면 실행하지 않는다. `profiles` 또는 `profile_roles` 직접 수정은 금지한다.

## GitHub Actions 자동 실행 방식

`.github/workflows/staging-first-super-admin.yml`은 `workflow_dispatch` 전용이다. 대상 ref는 staging allow-list에 코드로 고정되며, `dry_run`은 검사만 하고, `apply_bootstrap`은 정확한 승인문구가 있어야 migration 적용 뒤 공식 RPC를 실행한다. QA seed·DB reset·Netlify 설정은 포함하지 않는다.

GitHub Actions Secrets에는 `SUPABASE_ACCESS_TOKEN`, `STAGING_DB_PASSWORD`만 등록한다. 대상 Auth UUID는 workflow 실행 입력값으로만 사용하고 로그에서 마스킹한다.

## 안전한 실행 방식

1. Work에서 staging allow-list·production 차단 검사를 통과시킨다.
2. 사용자가 회사의 안전한 비밀값 보관 위치에서만 Supabase CLI 인증을 1회 준비한다. 비밀값은 채팅, GitHub, Netlify, `.env` 예시파일에 넣지 않는다.
3. 사용자 최종 승인 뒤에만 Work에서 migration dry-run과 staging migration 적용을 수행한다.
4. migration 적용 후 staging Supabase SQL Editor에서 DB 운영자 권한으로 대상 UUID에 대해 공식 RPC를 **한 번만** 실행한다.
5. 즉시 상태·조직·두 역할·상태이력·감사로그와 `/staff/` 권한을 검증한다.

실행 명령과 UUID는 실제 승인 시점에만 다룬다. 비밀번호와 Service Role Key는 필요하지 않으며 조회·입력·출력하지 않는다.

## 사후 검증

- 계정 상태 `active`
- 부서 `operations`, 직책 `operations_manager`
- 활성 역할 `super_admin`, `operations_manager` 정확히 2개
- 상태 이력에 `pending → active` 보존
- 감사로그에 조직 배정, 역할 부여 2건, bootstrap 기록 존재
- 마지막 활성 최고관리자 보호가 유지됨
- `/staff/` 재로그인 후 시스템 관리와 운영총괄 화면 진입

실행 결과는 `CURRENT_PLATFORM_STATUS.md`에 비밀정보 없이 즉시 갱신한다.
