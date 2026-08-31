# 최초 시스템 최고관리자 등록 절차

상태: **staging에서 완료·검증됨 — 재실행 금지**

이 문서는 `taejang-phase1-staging`에서 완료된 최초 등록의 공식 절차와 검증 기준을 보존하는 기록이다. 운영 production, Netlify Production, QA 시드와는 분리하며 현재 staging에서 재실행하지 않는다.

## 현재 운영 상태

김형철 시스템 최고관리자는 기존 검증 기록상 `active`이며 `super_admin`, `operations_manager` 역할과 `operations` 부서, `operations_manager` 직책이 확인됐다. 보호된 staff 최고관리자 화면과 가입 승인 대기 화면도 정상 동작 기록이 있다.

따라서 현재 staging에서는 `apply_bootstrap` workflow dispatch, `public.bootstrap_super_admin(uuid)` 호출, `profiles`·`profile_roles` 직접 수정, migration apply, QA seed 실행을 하지 않는다. 활성 `super_admin`이 존재하면 one-time bootstrap workflow와 RPC가 중단되는 것은 정상 안전장치다.

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

## 과거 실행 전제

1. Deploy Preview가 staging 연결인지 확인한다.
2. Authentication에서 대상 실제 사용자의 이메일 확인이 완료됐는지 확인한다.
3. 대상 `profiles.account_status`가 `pending`인지 확인한다.
4. 활성 `super_admin`이 0명인지 확인한다.
5. 새 migration이 staging에 적용됐는지 확인한다.

모두 충족하지 않으면 실행하지 않았다. `profiles` 또는 `profile_roles` 직접 수정은 금지한다. 이 전제는 완료된 bootstrap의 보존 기록이며 현재 실행 안내가 아니다.

## 보존된 안전한 실행 방식

1. staging allow-list·production 차단 검사를 통과했다.
2. 자격증명은 회사의 안전한 보관 위치에서만 준비했고 채팅, GitHub, Netlify, `.env` 예시파일에 넣지 않았다.
3. migration 적용 후 staging Supabase SQL Editor에서 DB 운영자 권한으로 대상 UUID에 대해 공식 RPC를 **한 번만** 실행했다.
4. 즉시 상태·조직·두 역할·상태이력·감사로그와 `/staff/` 권한을 검증했다.

실행 명령과 UUID는 재사용하지 않는다. 비밀번호와 Service Role Key는 문서에 기록하지 않으며 조회·입력·출력하지 않는다.

## 사후 검증

- 계정 상태 `active`
- 부서 `operations`, 직책 `operations_manager`
- 활성 역할 `super_admin`, `operations_manager` 정확히 2개
- 상태 이력에 `pending → active` 보존
- 감사로그에 조직 배정, 역할 부여 2건, bootstrap 기록 존재
- 마지막 활성 최고관리자 보호가 유지됨
- `/staff/` 재로그인 후 시스템 관리와 운영총괄 화면 진입

실행 결과는 `CURRENT_PLATFORM_STATUS.md`에 비밀정보 없이 갱신했다. 향후 다른 최고관리자 배정 또는 역할 변경은 최초 bootstrap을 재사용하지 않고, 확정된 계정·직책·역할 배정 정책과 별도 승인 흐름을 적용한다.
